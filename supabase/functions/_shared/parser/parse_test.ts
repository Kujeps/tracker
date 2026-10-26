import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  LlmError,
  type LlmProvider,
  type LlmRequest,
} from "../llm/provider.ts";
import { checkResponse, parsePhrase } from "./parse.ts";
import type { PromptContext } from "./prompt.ts";

const CTX: PromptContext = {
  now: new Date("2026-10-26T11:51:00Z"),
  timezone: "Europe/Samara",
  currency: "RUB",
  expenseCategories: ["Кафе и рестораны", "Другое"],
  incomeCategories: ["Зарплата", "Другое"],
};
const MODELS = { primary: "free-model", fallback: "paid-model" };
const VALID =
  '{"items":[{"type":"expense","amount":520,"currency":"RUB","category":"Кафе и рестораны","note":"кафе","occurred_at":"2026-10-26T15:51"}]}';

// Нейросеть по сценарию: каждый вызов берёт следующий ответ или ошибку
function scripted(answers: (string | LlmError)[]) {
  const requests: LlmRequest[] = [];
  const llm: LlmProvider = {
    complete(request) {
      requests.push(request);
      const next = answers.shift();
      if (next === undefined) throw new Error("лишний вызов");
      if (next instanceof LlmError) return Promise.reject(next);
      return Promise.resolve({
        content: next,
        model: request.model,
        tokensIn: 100,
        tokensOut: 20,
        ms: 300,
      });
    },
  };
  return { llm, requests };
}

Deno.test("парсер: верный ответ с первого раза — один вызов в JSON-режиме", async () => {
  const { llm, requests } = scripted([VALID]);
  const result = await parsePhrase(llm, MODELS, CTX, "потратил 520 руб в кафе");
  assertEquals(result.ok, true);
  assertEquals(result.attempts.length, 1);
  assertEquals(requests[0].model, "free-model");
  assertEquals(requests[0].jsonSchema, undefined);
  assertEquals(requests[0].timeoutMs, 15_000);
  assertEquals(requests[0].messages[1], {
    role: "user",
    content: "потратил 520 руб в кафе",
  });
});

Deno.test("парсер: ошибка схемы → повтор с текстом ошибки", async () => {
  const { llm, requests } = scripted([
    '{"items":[{"type":"expense","amount":"много"}]}',
    VALID,
  ]);
  const result = await parsePhrase(llm, MODELS, CTX, "кофе 250");
  assertEquals(result.ok, true);
  assertEquals(requests.length, 2);
  assertEquals(requests[1].model, "free-model");
  assertEquals(requests[1].messages.length, 4);
  assertStringIncludes(requests[1].messages[3].content, "items.0.amount");
});

Deno.test("парсер: две ошибки → запасная модель со structured output", async () => {
  const { llm, requests } = scripted(["не json", "опять не json", VALID]);
  const result = await parsePhrase(llm, MODELS, CTX, "кофе 250");
  assertEquals(result.ok, true);
  assertEquals(requests.map((r) => r.model), [
    "free-model",
    "free-model",
    "paid-model",
  ]);
  assertEquals(requests[2].jsonSchema?.name, "parsed_phrase");
  // Запасная модель получает чистый диалог без неудачных ответов
  assertEquals(requests[2].messages.length, 2);
});

Deno.test("парсер: лимит или таймаут основной модели → сразу запасная", async () => {
  const { llm, requests } = scripted([
    new LlmError("rate_limit", "HTTP 429", 50),
    VALID,
  ]);
  const result = await parsePhrase(llm, MODELS, CTX, "кофе 250");
  assertEquals(result.ok, true);
  assertEquals(requests.map((r) => r.model), ["free-model", "paid-model"]);
  assertEquals(result.attempts[0].error, "HTTP 429");
});

Deno.test("парсер: все попытки неудачны → отказ", async () => {
  const { llm } = scripted([
    "{}",
    "{}",
    new LlmError("no_credits", "HTTP 402", 10),
  ]);
  const result = await parsePhrase(llm, MODELS, CTX, "кофе 250");
  assertEquals(result.ok, false);
  assertEquals(result.attempts.length, 3);
});

Deno.test("парсер: длинная фраза обрезается до 500 символов", async () => {
  const { llm, requests } = scripted([VALID]);
  await parsePhrase(llm, MODELS, CTX, "кофе 250 ".repeat(100));
  assertEquals(requests[0].messages[1].content.length, 500);
});

Deno.test("схема: JSON в ```, голый массив и одиночный объект", () => {
  const item = '{"type":"other"}';
  assertEquals(
    checkResponse('```json\n{"items":[' + item + "]}\n```").ok,
    true,
  );
  assertEquals(checkResponse("[" + item + "]").ok, true);
  assertEquals(checkResponse(item).ok, true);
});

Deno.test("схема: все типы элементов из ТЗ проходят проверку", () => {
  const response = {
    items: [
      {
        type: "expense",
        amount: 520,
        currency: "RUB",
        category: "Кафе и рестораны",
        note: "кафе",
        occurred_at: "2026-10-26T15:51:00+04:00",
      },
      {
        type: "income",
        amount: 85000,
        currency: "RUB",
        category: "Зарплата",
        note: null,
        occurred_at: "2026-10-26T15:51:00+04:00",
      },
      {
        type: "event",
        title: "Встреча с Вадимом",
        starts_at: "2026-11-26T19:00:00+04:00",
        ends_at: null,
        all_day: false,
        remind_before_min: [60],
      },
      {
        type: "reminder",
        text: "Оплатить кредит",
        first_at: "2026-11-05T10:00:00+04:00",
        rrule: "FREQ=MONTHLY;BYMONTHDAY=5,10;BYHOUR=10;BYMINUTE=0",
      },
      {
        type: "query",
        metric: "expense_sum",
        period_from: "2026-10-01",
        period_to: "2026-10-31",
        category: "Кафе и рестораны",
      },
      { type: "clarify", question: "Сколько стоили кроссовки?" },
      { type: "other" },
    ],
  };
  assertEquals(checkResponse(JSON.stringify(response)).ok, true);
});

Deno.test("схема: ошибки формы ловятся", () => {
  const bad = (item: unknown) =>
    checkResponse(JSON.stringify({ items: [item] })).ok;
  const expense = {
    type: "expense",
    amount: 520,
    currency: "RUB",
    category: "Другое",
    note: null,
    occurred_at: "2026-10-26T15:51",
  };
  assertEquals(bad({ ...expense, amount: -5 }), false);
  assertEquals(bad({ ...expense, amount: 1.555 }), false);
  assertEquals(bad({ ...expense, currency: "руб" }), false);
  assertEquals(bad({ ...expense, occurred_at: "вчера" }), false);
  assertEquals(bad({ ...expense, occurred_at: "2026-10-26" }), false);
  assertEquals(
    bad({
      type: "reminder",
      text: "x",
      first_at: "2026-11-05T10:00",
      rrule: "каждый месяц",
    }),
    false,
  );
  assertEquals(
    bad({
      type: "query",
      metric: "avg",
      period_from: "2026-10-01",
      period_to: "2026-10-31",
      category: null,
    }),
    false,
  );
  assertEquals(bad({ type: "unknown" }), false);
  assertEquals(checkResponse('{"items":[]}').ok, false);
  // Слишком частый повтор — не ошибка формы, а вопрос пользователю
  assertEquals(
    bad({
      type: "reminder",
      text: "x",
      first_at: "2026-11-05T10:00",
      rrule: "FREQ=HOURLY",
    }),
    true,
  );
});

Deno.test("схема: пропущенные необязательные поля считаются null", () => {
  const checked = checkResponse(JSON.stringify({
    items: [
      {
        type: "query",
        metric: "balance",
        period_from: "2026-10-01",
        period_to: "2026-10-31",
      },
      {
        type: "expense",
        amount: 250,
        category: "Кафе и рестораны",
        occurred_at: "2026-10-26T15:51",
      },
      { type: "event", title: "Созвон", starts_at: "2026-10-27T15:00" },
    ],
  }));
  if (!checked.ok) throw new Error(checked.error);
  const [query, expense, event] = checked.items;
  assertEquals(query.type === "query" && query.category, null);
  assertEquals(
    expense.type === "expense" && [expense.currency, expense.note],
    [null, null],
  );
  assertEquals(event.type === "event" && event.ends_at, null);
});
