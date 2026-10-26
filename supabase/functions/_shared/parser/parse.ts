// Вызов нейросети и проверка ответа схемой zod.
// Цепочка: основная модель → повтор с текстом ошибки → запасная модель со
// structured output → отказ. Ошибка сети, таймаут или лимит у основной
// модели сразу ведут к запасной: повторять их бессмысленно.
import {
  LlmError,
  type LlmMessage,
  type LlmProvider,
} from "../llm/provider.ts";
import {
  buildSystemPrompt,
  preparePhrase,
  type PromptContext,
} from "./prompt.ts";
import {
  type ParsedItem,
  PARSER_JSON_SCHEMA,
  parserResponse,
} from "./schema.ts";

export const LLM_TIMEOUT_MS = 15_000;

export interface ParserModels {
  primary: string;
  fallback: string;
}

// Один вызов нейросети: для учёта расходов в entries
export interface LlmAttempt {
  model: string;
  tokensIn: number;
  tokensOut: number;
  ms: number;
  error: string | null;
}

export type ParseResult =
  | { ok: true; items: ParsedItem[]; attempts: LlmAttempt[] }
  | { ok: false; attempts: LlmAttempt[] };

type Check =
  | { ok: true; items: ParsedItem[] }
  | { ok: false; error: string };

// Достаёт JSON из ответа. В JSON-режиме модель иногда оборачивает его
// в ```json … ``` или отдаёт голый массив элементов вместо {"items": [...]}.
export function checkResponse(content: string): Check {
  const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(
    /\s*```$/,
    "",
  );
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "ответ не является корректным JSON" };
  }
  if (Array.isArray(data)) {
    data = { items: data };
  } else if (
    data && typeof data === "object" && "type" in data && !("items" in data)
  ) {
    data = { items: [data] };
  }
  const result = parserResponse.safeParse(data);
  if (result.success) {
    return { ok: true, items: result.data.items };
  }
  const issues = result.error.issues.slice(0, 5).map((issue) =>
    `${issue.path.join(".") || "ответ"}: ${issue.message}`
  );
  return { ok: false, error: issues.join("; ") };
}

export async function parsePhrase(
  llm: LlmProvider,
  models: ParserModels,
  ctx: PromptContext,
  phrase: string,
): Promise<ParseResult> {
  const attempts: LlmAttempt[] = [];
  const base: LlmMessage[] = [
    { role: "system", content: buildSystemPrompt(ctx) },
    { role: "user", content: preparePhrase(phrase) },
  ];

  // Возвращает содержимое ответа или null, если вызов упал
  const call = async (
    model: string,
    messages: LlmMessage[],
    structured: boolean,
  ): Promise<string | null> => {
    try {
      const res = await llm.complete({
        model,
        messages,
        timeoutMs: LLM_TIMEOUT_MS,
        jsonSchema: structured
          ? { name: "parsed_phrase", schema: PARSER_JSON_SCHEMA }
          : undefined,
      });
      attempts.push({
        model: res.model,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        ms: res.ms,
        error: null,
      });
      return res.content;
    } catch (err) {
      const ms = err instanceof LlmError ? err.ms : 0;
      const message = err instanceof Error ? err.message : String(err);
      attempts.push({ model, tokensIn: 0, tokensOut: 0, ms, error: message });
      return null;
    }
  };

  // 1. Основная модель в JSON-режиме
  const first = await call(models.primary, base, false);
  if (first !== null) {
    const checked = checkResponse(first);
    if (checked.ok) return { ok: true, items: checked.items, attempts };

    // 2. Повтор с текстом ошибки
    const retry = await call(models.primary, [
      ...base,
      { role: "assistant", content: first },
      {
        role: "user",
        content:
          `Ответ не прошёл проверку: ${checked.error}. Верни исправленный JSON {"items":[...]} целиком, без пояснений.`,
      },
    ], false);
    if (retry !== null) {
      const again = checkResponse(retry);
      if (again.ok) return { ok: true, items: again.items, attempts };
    }
  }

  // 3. Запасная модель со structured output
  const fallback = await call(models.fallback, base, true);
  if (fallback !== null) {
    const checked = checkResponse(fallback);
    if (checked.ok) return { ok: true, items: checked.items, attempts };
  }
  return { ok: false, attempts };
}
