import { assertEquals, assertRejects } from "@std/assert";
import { createOpenRouterProvider } from "./openrouter.ts";
import { LlmError } from "./provider.ts";

function fakeFetch(
  status: number,
  body: unknown,
  seen: RequestInit[] = [],
): typeof fetch {
  return (_input, init) => {
    seen.push(init!);
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}

const OK = {
  model: "google/gemma",
  choices: [{ message: { content: '{"items":[]}' } }],
  usage: { prompt_tokens: 500, completion_tokens: 40 },
};

Deno.test("OpenRouter: JSON-режим, температура 0, токены в ответе", async () => {
  const seen: RequestInit[] = [];
  const llm = createOpenRouterProvider("key", fakeFetch(200, OK, seen));
  const res = await llm.complete({
    model: "m",
    messages: [{ role: "user", content: "x" }],
    timeoutMs: 1000,
  });
  assertEquals([res.content, res.model, res.tokensIn, res.tokensOut], [
    '{"items":[]}',
    "google/gemma",
    500,
    40,
  ]);
  const body = JSON.parse(seen[0].body as string);
  assertEquals(body.temperature, 0);
  assertEquals(body.response_format, { type: "json_object" });
  assertEquals(body.provider, undefined);
  assertEquals(
    (seen[0].headers as Record<string, string>).Authorization,
    "Bearer key",
  );
});

Deno.test("OpenRouter: structured output только у провайдеров с поддержкой", async () => {
  const seen: RequestInit[] = [];
  const llm = createOpenRouterProvider("key", fakeFetch(200, OK, seen));
  await llm.complete({
    model: "m",
    messages: [],
    timeoutMs: 1000,
    jsonSchema: { name: "parsed_phrase", schema: { type: "object" } },
  });
  const body = JSON.parse(seen[0].body as string);
  assertEquals(body.response_format.type, "json_schema");
  assertEquals(body.response_format.json_schema.strict, true);
  assertEquals(body.provider, {
    require_parameters: true,
    ignore: ["siliconflow", "venice"],
  });
});

Deno.test("OpenRouter: ошибки по видам", async () => {
  const kindOf = async (status: number, body: unknown) => {
    const llm = createOpenRouterProvider("key", fakeFetch(status, body));
    const err = await assertRejects(
      () => llm.complete({ model: "m", messages: [], timeoutMs: 1000 }),
      LlmError,
    );
    return err.kind;
  };
  assertEquals(
    await kindOf(429, { error: { code: 429, message: "rate" } }),
    "rate_limit",
  );
  assertEquals(
    await kindOf(402, { error: { code: 402, message: "credits" } }),
    "no_credits",
  );
  assertEquals(
    await kindOf(200, { error: { code: 502, message: "upstream" } }),
    "http",
  );
  assertEquals(
    await kindOf(200, { choices: [{ message: { content: "" } }] }),
    "empty",
  );
});

Deno.test("OpenRouter: таймаут", async () => {
  const llm = createOpenRouterProvider(
    "key",
    () => Promise.reject(new DOMException("t", "TimeoutError")),
  );
  const err = await assertRejects(
    () => llm.complete({ model: "m", messages: [], timeoutMs: 1 }),
    LlmError,
  );
  assertEquals(err.kind, "timeout");
});
