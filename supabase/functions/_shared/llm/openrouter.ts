// OpenRouter: API в формате OpenAI, https://openrouter.ai/docs/api-reference/chat-completion
import {
  LlmError,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from "./provider.ts";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

// Провайдеры, у которых structured output по нашей схеме сломан (проверено
// 2026-10-26 на google/gemma-4-26b-a4b-it): SiliconFlow на любую фразу отвечает
// {"type":"other"}, Venice зацикливается на пробелах вместо пропущенного поля.
const BROKEN_STRUCTURED_PROVIDERS = ["siliconflow", "venice"];

interface ChatResult {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { code?: number; message?: string };
}

export function createOpenRouterProvider(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): LlmProvider {
  return {
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const body: Record<string, unknown> = {
        model: request.model,
        messages: request.messages,
        temperature: 0,
        // Ответ на фразу — сотни токенов; потолок обрывает зациклившийся ответ
        max_tokens: 800,
        // Рассуждения модели нам не нужны: ответ короткий, а время дорого
        reasoning: { enabled: false },
      };
      if (request.jsonSchema) {
        body.response_format = {
          type: "json_schema",
          json_schema: {
            name: request.jsonSchema.name,
            strict: true,
            schema: request.jsonSchema.schema,
          },
        };
        // Только провайдеры, которые умеют structured output
        body.provider = {
          require_parameters: true,
          ignore: BROKEN_STRUCTURED_PROVIDERS,
        };
      } else {
        body.response_format = { type: "json_object" };
      }

      const started = Date.now();
      const elapsed = () => Date.now() - started;
      let res: Response;
      try {
        res = await fetchFn(ENDPOINT, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "X-Title": "Tracker bot",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(request.timeoutMs),
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "TimeoutError") {
          throw new LlmError(
            "timeout",
            "Нейросеть не ответила вовремя",
            elapsed(),
          );
        }
        throw new LlmError("http", `Сеть: ${String(err)}`, elapsed());
      }

      let data: ChatResult;
      try {
        data = await res.json();
      } catch {
        throw new LlmError(
          "http",
          `HTTP ${res.status}, ответ не JSON`,
          elapsed(),
        );
      }
      const ms = elapsed();
      // Ошибка может прийти и со статусом 200, поэтому смотрим ещё и поле error
      const code = data.error?.code ?? (res.ok ? undefined : res.status);
      if (code !== undefined) {
        const message = `HTTP ${code}: ${
          data.error?.message ?? "без описания"
        }`;
        if (code === 429) throw new LlmError("rate_limit", message, ms);
        if (code === 402) throw new LlmError("no_credits", message, ms);
        throw new LlmError("http", message, ms);
      }
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new LlmError("empty", "Пустой ответ нейросети", ms);
      }
      return {
        content,
        model: data.model ?? request.model,
        tokensIn: data.usage?.prompt_tokens ?? 0,
        tokensOut: data.usage?.completion_tokens ?? 0,
        ms,
      };
    },
  };
}
