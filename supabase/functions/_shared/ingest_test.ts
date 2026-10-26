import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  CLARIFY_WINDOW_MS,
  TEXT_DAILY_CAP,
  TEXT_FAILED,
  TEXT_OTHER,
  TEXT_RATE_LIMIT,
} from "./ingest.ts";
import type { User } from "./store.ts";
import { harness, NOW, TZ } from "./testing/fakes.ts";
import { parseCallbackData } from "./telegram.ts";

async function userIn(
  h: ReturnType<typeof harness>,
  timezone = TZ,
): Promise<User> {
  const user = await h.memory.store.upsertUser({
    telegramId: 1,
    firstName: null,
    username: null,
  });
  return h.memory.store.updateUser(user.id, { timezone });
}

const cafe = (amount: number, at = "2026-10-26T15:51") => ({
  type: "expense" as const,
  amount,
  currency: "RUB",
  category: "Кафе и рестораны",
  note: "кафе",
  occurred_at: at,
});

Deno.test("ingest: трата сохраняется в копейках, подтверждение с кнопками", async () => {
  const h = harness();
  const user = await userIn(h);
  h.answers.set("потратил 520 руб в кафе", [cafe(520)]);
  const result = await h.run({
    user,
    source: "bot_text",
    text: "потратил 520 руб в кафе",
    now: NOW,
  });

  assertEquals(
    result.reply.text,
    "Записал: расход 520 ₽ · Кафе и рестораны · сегодня 15:51",
  );
  assertEquals(result.reply.keyboard?.[0].map((b) => b.text), [
    "Отменить",
    "Категория",
  ]);
  assertEquals(parseCallbackData(result.reply.keyboard![0][0].data), {
    action: "undo",
    entryId: result.entryId!,
  });
  assertEquals(h.memory.state.transactions[0].amountMinor, 52000);
  assertEquals(
    h.memory.state.transactions[0].occurredAt,
    new Date("2026-10-26T11:51:00Z"),
  );
  const entry = h.memory.state.entries[0];
  assertEquals([entry.status, entry.source, entry.rawText, entry.llmModel], [
    "saved",
    "bot_text",
    "потратил 520 руб в кафе",
    "free-model",
  ]);
});

Deno.test("ingest: несколько записей — строка на каждую", async () => {
  const h = harness();
  const user = await userIn(h);
  h.answers.set("такси 340 и обед 450", [
    { ...cafe(340), category: "Такси", note: "такси" },
    cafe(450),
  ]);
  const result = await h.run({
    user,
    source: "bot_text",
    text: "такси 340 и обед 450",
    now: NOW,
  });
  assertEquals(
    result.reply.text,
    [
      "Записал:",
      "• расход 340 ₽ · Такси · сегодня 15:51",
      "• расход 450 ₽ · Кафе и рестораны · сегодня 15:51",
    ].join("\n"),
  );
});

Deno.test("ingest: дата и время в подтверждении — в поясе пользователя", async () => {
  const h = harness();
  const user = await userIn(h, "Asia/Vladivostok");
  h.answers.set("завтра в 7 вечера встреча", [{
    type: "event",
    title: "Встреча",
    starts_at: "2026-10-27T19:00",
    ends_at: null,
    all_day: false,
    remind_before_min: [60],
  }]);
  const result = await h.run({
    user,
    source: "bot_text",
    text: "завтра в 7 вечера встреча",
    now: NOW,
  });
  assertEquals(
    result.reply.text,
    "Записал: событие «Встреча» · завтра 19:00 · напомню за час",
  );
  // 19:00 во Владивостоке (UTC+10) = 09:00 UTC
  assertEquals(
    h.memory.state.events[0].startsAt,
    new Date("2026-10-27T09:00:00Z"),
  );
  assertEquals(
    h.memory.state.reminders[0].nextFireAt,
    new Date("2026-10-27T08:00:00Z"),
  );
  // У события нет трат — нет и кнопки «Категория»
  assertEquals(result.reply.keyboard?.[0].map((b) => b.text), ["Отменить"]);
});

Deno.test("ingest: повтор — правило словами и ближайшая дата", async () => {
  const h = harness();
  const user = await userIn(h);
  const phrase = "напомни каждый месяц 5 и 10 числа оплатить кредит";
  h.answers.set(phrase, [{
    type: "reminder",
    text: "Оплатить кредит",
    first_at: "2026-11-05T10:00",
    rrule: "FREQ=MONTHLY;BYMONTHDAY=5,10;BYHOUR=10;BYMINUTE=0",
  }]);
  const result = await h.run({
    user,
    source: "bot_text",
    text: phrase,
    now: NOW,
  });
  assertEquals(
    result.reply.text,
    "Записал: напоминание «Оплатить кредит» · каждый месяц 5 и 10 числа в 10:00 · ближайшее чт 5 ноября 10:00",
  );
});

Deno.test("ingest: уточнение — ничего не сохраняется, ответ склеивается с фразой", async () => {
  const h = harness();
  const user = await userIn(h);
  h.answers.set("купил кроссовки", [{
    type: "clarify",
    question: "Сколько стоили кроссовки?",
  }]);
  h.answers.set("купил кроссовки\n7990", [{
    ...cafe(7990),
    category: "Одежда и обувь",
    note: "кроссовки",
  }]);

  const first = await h.run({
    user,
    source: "bot_text",
    text: "купил кроссовки",
    now: NOW,
  });
  assertEquals(first.reply, { text: "Сколько стоили кроссовки?" });
  assertEquals(h.memory.state.transactions.length, 0);
  assertEquals(h.memory.state.entries[0].status, "needs_clarification");

  h.clock.now = new Date(NOW.getTime() + 60_000);
  const second = await h.run({
    user,
    source: "bot_text",
    text: "7990",
    now: h.clock.now,
  });
  assertEquals(h.phrases[1], "купил кроссовки\n7990");
  assertStringIncludes(second.reply.text, "расход 7 990 ₽ · Одежда и обувь");
  assertEquals(h.memory.state.transactions.length, 1);
});

Deno.test("ingest: через 10 минут уточнение уже не ждём", async () => {
  const h = harness();
  const user = await userIn(h);
  h.answers.set("купил кроссовки", [{
    type: "clarify",
    question: "Сколько стоили кроссовки?",
  }]);
  await h.run({ user, source: "bot_text", text: "купил кроссовки", now: NOW });
  h.clock.now = new Date(NOW.getTime() + CLARIFY_WINDOW_MS + 1000);
  await h.run({ user, source: "bot_text", text: "кофе 250", now: h.clock.now });
  assertEquals(h.phrases[1], "кофе 250");
});

Deno.test("ingest: парсер не справился — failed, «Не понял», алерт без текста фразы", async () => {
  const h = harness();
  const user = await userIn(h);
  const result = await h.run({
    user,
    source: "bot_text",
    text: "секретная фраза",
    now: NOW,
  });
  assertEquals(result.reply.text, TEXT_FAILED);
  assertEquals(h.memory.state.entries[0].status, "failed");
  assertEquals(h.alerts[0].kind, "parser_failed");
  assertEquals(h.alerts[0].text.includes("секретная"), false);
});

Deno.test("ingest: не про деньги и планы — подсказка", async () => {
  const h = harness();
  const user = await userIn(h);
  h.answers.set("привет", [{ type: "other" }]);
  const result = await h.run({
    user,
    source: "bot_text",
    text: "привет",
    now: NOW,
  });
  assertEquals(result.reply, { text: TEXT_OTHER });
});

Deno.test("ingest: больше 20 вводов в минуту — отказ без нейросети", async () => {
  const h = harness();
  const user = await userIn(h);
  h.answers.set("кофе 250", [cafe(250)]);
  for (let i = 0; i < 20; i++) {
    await h.run({ user, source: "bot_text", text: "кофе 250", now: NOW });
  }
  const result = await h.run({
    user,
    source: "bot_text",
    text: "кофе 250",
    now: NOW,
  });
  assertEquals(result.reply.text, TEXT_RATE_LIMIT);
  assertEquals(h.phrases.length, 20);
});

Deno.test("ingest: потолок вызовов в сутки — отказ и алерт админу", async () => {
  const h = harness(2);
  const user = await userIn(h);
  h.answers.set("кофе 250", [cafe(250)]);
  await h.run({ user, source: "bot_text", text: "кофе 250", now: NOW });
  await h.run({ user, source: "bot_text", text: "кофе 250", now: NOW });
  const result = await h.run({
    user,
    source: "bot_text",
    text: "кофе 250",
    now: NOW,
  });
  assertEquals(result.reply.text, TEXT_DAILY_CAP);
  assertEquals(h.phrases.length, 2);
  assertEquals(h.alerts.map((a) => a.kind), ["llm_daily_cap"]);
});

Deno.test("ingest: запрос — сумму считает код", async () => {
  const h = harness();
  const user = await userIn(h);
  h.answers.set("a", [
    cafe(520, "2026-10-01T09:00"),
    cafe(6910.5, "2026-10-20T13:00"),
    { ...cafe(100), category: "Такси" },
  ]);
  h.answers.set("b", [cafe(1000, "2026-09-30T23:59")]);
  await h.run({ user, source: "bot_text", text: "a", now: NOW });
  await h.run({ user, source: "bot_text", text: "b", now: NOW });
  h.answers.set("сколько я потратил на кафе в октябре", [{
    type: "query",
    metric: "expense_sum",
    period_from: "2026-10-01",
    period_to: "2026-10-31",
    category: "Кафе и рестораны",
  }]);
  const result = await h.run({
    user,
    source: "bot_text",
    text: "сколько я потратил на кафе в октябре",
    now: NOW,
  });
  assertEquals(
    result.reply.text,
    "В октябре на «Кафе и рестораны»: 7 430,50 ₽, 2 траты",
  );
  assertEquals(result.reply.keyboard, undefined);
});
