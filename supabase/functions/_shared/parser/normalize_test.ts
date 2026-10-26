import { assertEquals } from "@std/assert";
import { type NormalizeContext, normalizeItems } from "./normalize.ts";
import type { ParsedItem } from "./schema.ts";

// 2026-10-26 15:51, понедельник, Самара
const CTX: NormalizeContext = {
  now: new Date("2026-10-26T11:51:00Z"),
  timezone: "Europe/Samara",
  currency: "RUB",
  categories: [
    { id: "cafe", kind: "expense", name: "Кафе и рестораны" },
    { id: "other-exp", kind: "expense", name: "Другое" },
    { id: "salary", kind: "income", name: "Зарплата" },
    { id: "other-inc", kind: "income", name: "Другое" },
  ],
};

const expense = (
  patch: Partial<Extract<ParsedItem, { type: "expense" }>> = {},
): ParsedItem => ({
  type: "expense",
  amount: 520,
  currency: "RUB",
  category: "Кафе и рестораны",
  note: "кафе",
  occurred_at: "2026-10-26T15:51",
  ...patch,
});

Deno.test("нормализация: трата в копейках и UTC", () => {
  const result = normalizeItems(
    [expense({ amount: 99.9, currency: null })],
    CTX,
  );
  assertEquals(result, {
    kind: "drafts",
    drafts: [{
      kind: "transaction",
      type: "expense",
      amountMinor: 9990,
      currency: "RUB",
      categoryId: "cafe",
      categoryName: "Кафе и рестораны",
      note: "кафе",
      occurredAt: new Date("2026-10-26T11:51:00Z"),
    }],
  });
});

Deno.test("нормализация: неизвестная категория → «Другое» нужного вида", () => {
  const result = normalizeItems([
    expense({ category: "Космос" }),
    {
      type: "income",
      amount: 100,
      currency: "RUB",
      category: "Наследство",
      note: null,
      occurred_at: "2026-10-26T15:51",
    },
  ], CTX);
  if (result.kind !== "drafts") throw new Error(result.kind);
  assertEquals(
    result.drafts.map((d) => d.kind === "transaction" && d.categoryId),
    ["other-exp", "other-inc"],
  );
});

Deno.test("нормализация: сумма 100 млн и больше → уточнение", () => {
  assertEquals(
    normalizeItems([expense({ amount: 100_000_000 })], CTX).kind,
    "clarify",
  );
  assertEquals(
    normalizeItems([expense({ amount: 99_999_999.99 })], CTX).kind,
    "drafts",
  );
});

Deno.test("нормализация: трата позже чем через сутки → уточнение", () => {
  assertEquals(
    normalizeItems([expense({ occurred_at: "2026-10-27T15:00" })], CTX).kind,
    "drafts",
  );
  assertEquals(
    normalizeItems([expense({ occurred_at: "2026-10-28T15:00" })], CTX).kind,
    "clarify",
  );
});

Deno.test("нормализация: встреча в прошлом → уточнение, ничего не сохраняется", () => {
  const result = normalizeItems([
    expense(),
    {
      type: "event",
      title: "Стоматолог",
      starts_at: "2026-10-26T10:00",
      ends_at: null,
      all_day: false,
      remind_before_min: [60],
    },
  ], CTX);
  assertEquals(result.kind, "clarify");
});

Deno.test("нормализация: событие со временем и напоминанием за 60 минут", () => {
  const result = normalizeItems([{
    type: "event",
    title: "Встреча с Вадимом",
    starts_at: "2026-11-26T19:00:00+04:00",
    ends_at: null,
    all_day: false,
    remind_before_min: [60, 60],
  }], CTX);
  if (result.kind !== "drafts") throw new Error(result.kind);
  assertEquals(result.drafts[0], {
    kind: "event",
    title: "Встреча с Вадимом",
    startsAt: new Date("2026-11-26T15:00:00Z"),
    endsAt: null,
    allDay: false,
    reminders: [{ beforeMin: 60, fireAt: new Date("2026-11-26T14:00:00Z") }],
  });
});

Deno.test("нормализация: напоминание к скорой встрече, которое уже опоздало, не создаётся", () => {
  const result = normalizeItems([{
    type: "event",
    title: "Созвон",
    starts_at: "2026-10-26T16:20",
    ends_at: null,
    all_day: false,
    remind_before_min: [60],
  }], CTX);
  if (result.kind !== "drafts" || result.drafts[0].kind !== "event") {
    throw new Error();
  }
  assertEquals(result.drafts[0].reminders, []);
});

Deno.test("нормализация: событие без времени — на весь день, с местной полуночи", () => {
  const result = normalizeItems([{
    type: "event",
    title: "Стоматолог",
    starts_at: "2026-10-30",
    ends_at: null,
    all_day: true,
    remind_before_min: [60],
  }], CTX);
  if (result.kind !== "drafts" || result.drafts[0].kind !== "event") {
    throw new Error();
  }
  assertEquals(result.drafts[0].allDay, true);
  assertEquals(result.drafts[0].startsAt, new Date("2026-10-29T20:00:00Z"));
  assertEquals(result.drafts[0].reminders, []);
});

Deno.test("нормализация: повтор — ближайшее срабатывание считает код", () => {
  const result = normalizeItems([{
    type: "reminder",
    text: "Оплатить кредит",
    // Модель ошиблась и назвала 10 ноября: код всё равно найдёт 5-е
    first_at: "2026-10-26T10:00",
    rrule: "FREQ=MONTHLY;BYMONTHDAY=5,10;BYHOUR=10;BYMINUTE=0",
  }], CTX);
  if (result.kind !== "drafts" || result.drafts[0].kind !== "reminder") {
    throw new Error();
  }
  assertEquals(result.drafts[0].nextFireAt, new Date("2026-11-05T06:00:00Z"));
  assertEquals(
    result.drafts[0].rrule,
    "FREQ=MONTHLY;BYMONTHDAY=5,10;BYHOUR=10;BYMINUTE=0",
  );
  assertEquals(result.drafts[0].dtstartLocal, "2026-10-26T10:00:00");
});

Deno.test("нормализация: напоминание через 2 часа", () => {
  const result = normalizeItems([{
    type: "reminder",
    text: "Позвонить маме",
    first_at: "2026-10-26T17:51",
    rrule: null,
  }], CTX);
  if (result.kind !== "drafts" || result.drafts[0].kind !== "reminder") {
    throw new Error();
  }
  assertEquals(result.drafts[0].nextFireAt, new Date("2026-10-26T13:51:00Z"));
});

Deno.test("нормализация: напоминание в прошлом или чаще раза в день → уточнение", () => {
  assertEquals(
    normalizeItems([{
      type: "reminder",
      text: "x",
      first_at: "2026-10-26T09:00",
      rrule: null,
    }], CTX).kind,
    "clarify",
  );
  assertEquals(
    normalizeItems([{
      type: "reminder",
      text: "x",
      first_at: "2026-10-26T17:00",
      rrule: "FREQ=HOURLY",
    }], CTX).kind,
    "clarify",
  );
});

Deno.test("нормализация: clarify и other", () => {
  assertEquals(
    normalizeItems([expense(), {
      type: "clarify",
      question: "Сколько стоили кроссовки?",
    }], CTX),
    { kind: "clarify", question: "Сколько стоили кроссовки?" },
  );
  assertEquals(normalizeItems([{ type: "other" }], CTX), { kind: "other" });
  assertEquals(
    normalizeItems([{ type: "other" }, expense()], CTX).kind,
    "drafts",
  );
});

Deno.test("нормализация: запрос с категорией и без", () => {
  const result = normalizeItems([
    {
      type: "query",
      metric: "expense_sum",
      period_from: "2026-10-31",
      period_to: "2026-10-01",
      category: "кафе и рестораны",
    },
    {
      type: "query",
      metric: "expense_sum",
      period_from: "2026-10-01",
      period_to: "2026-10-31",
      category: "Космос",
    },
  ], CTX);
  if (result.kind !== "drafts") throw new Error();
  assertEquals(result.drafts[0], {
    kind: "query",
    metric: "expense_sum",
    fromDate: "2026-10-01",
    toDate: "2026-10-31",
    categoryId: "cafe",
    categoryName: "Кафе и рестораны",
  });
  assertEquals(
    result.drafts[1].kind === "query" && result.drafts[1].categoryId,
    null,
  );
});

Deno.test("нормализация: модель не назвала напоминание — за 60 минут", () => {
  const result = normalizeItems([{
    type: "event",
    title: "Созвон",
    starts_at: "2026-10-27T15:00",
    ends_at: null,
  }], CTX);
  if (result.kind !== "drafts" || result.drafts[0].kind !== "event") {
    throw new Error();
  }
  assertEquals(result.drafts[0].allDay, false);
  assertEquals(result.drafts[0].reminders.map((r) => r.beforeMin), [60]);
});
