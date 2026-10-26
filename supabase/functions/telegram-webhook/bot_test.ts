import { assertEquals, assertStringIncludes } from "@std/assert";
import type { InlineKeyboardMarkup, Update, UserFromGetMe } from "grammy/types";
import { harness, NOW } from "../_shared/testing/fakes.ts";
import { callbackData } from "../_shared/telegram.ts";
import { createBot, UNDO_WINDOW_MS } from "./bot.ts";
import {
  HELP_TEXT,
  ONBOARDING_HINT,
  START_TEXT,
  TZ_INVALID,
  TZ_PROMPT,
} from "./views.ts";

const BOT_INFO: UserFromGetMe = {
  id: 42,
  is_bot: true,
  first_name: "Трекер",
  username: "AI_Tracker_everything_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

const CHAT_ID = 555;

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

// Бот без сети: память вместо базы, парсер по сценарию, вызовы Bot API записываются
function setup() {
  const h = harness();
  const calls: ApiCall[] = [];
  const bot = createBot("123:test", {
    store: h.memory.store,
    now: () => h.clock.now,
    ingest: h.run,
  }, BOT_INFO);
  let messageId = 100;
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const result = method === "sendMessage"
      ? {
        message_id: ++messageId,
        date: 0,
        chat: { id: CHAT_ID, type: "private" },
        text: "",
      }
      : true;
    // deno-lint-ignore no-explicit-any
    return Promise.resolve({ ok: true, result } as any);
  });
  const send = async (update: Update) => {
    calls.length = 0;
    await bot.handleUpdate(update);
    return calls;
  };
  return { h, bot, calls, send };
}

const FROM = {
  id: CHAT_ID,
  is_bot: false,
  first_name: "Иван",
  username: "ivan",
};
let updateId = 1;

function textUpdate(
  text: string,
  replyTo?: { text: string; fromBot: boolean },
): Update {
  const isCommand = text.startsWith("/");
  return {
    update_id: updateId++,
    message: {
      message_id: 10,
      date: 1_790_000_000,
      chat: { id: CHAT_ID, type: "private", first_name: "Иван" },
      from: FROM,
      text,
      entities: isCommand
        ? [{
          type: "bot_command",
          offset: 0,
          length: text.split(" ")[0].length,
        }]
        : undefined,
      reply_to_message: replyTo
        ? {
          message_id: 9,
          date: 1_790_000_000,
          chat: { id: CHAT_ID, type: "private", first_name: "Иван" },
          from: replyTo.fromBot ? BOT_INFO : FROM,
          text: replyTo.text,
          reply_to_message: undefined,
        }
        : undefined,
    },
  };
}

function callbackUpdate(data: string, fromId = CHAT_ID): Update {
  return {
    update_id: updateId++,
    callback_query: {
      id: "cb",
      chat_instance: "ci",
      from: { ...FROM, id: fromId },
      data,
      message: {
        message_id: 101,
        date: 1_790_000_000,
        chat: { id: CHAT_ID, type: "private", first_name: "Иван" },
        text: "Записал: …",
      },
    },
  };
}

function buttons(call: ApiCall): string[][] {
  const markup = call.payload.reply_markup as InlineKeyboardMarkup;
  return markup.inline_keyboard.map((row) => row.map((b) => b.text));
}

function callbackOf(call: ApiCall, text: string): string {
  const markup = call.payload.reply_markup as InlineKeyboardMarkup;
  for (const row of markup.inline_keyboard) {
    for (const b of row) {
      if (b.text === text && "callback_data" in b) return b.callback_data!;
    }
  }
  throw new Error(`Нет кнопки ${text}`);
}

const cafe = (amount: number, at = "2026-10-26T15:51") => ({
  type: "expense" as const,
  amount,
  currency: "RUB",
  category: "Кафе и рестораны",
  note: null,
  occurred_at: at,
});

// --- онбординг и пояс ---

Deno.test("/start: создаёт пользователя и предлагает выбрать пояс", async () => {
  const { h, send } = setup();
  const calls = await send(textUpdate("/start"));
  assertEquals(h.memory.state.users.length, 1);
  assertEquals(calls[0].payload.text, START_TEXT);
  assertEquals(buttons(calls[0]).flat().length, 11);
  assertEquals(buttons(calls[0]).flat().at(-1), "Другой");
});

Deno.test("пояс: кнопка сохраняет пояс, в первый раз — подсказка", async () => {
  const { h, send } = setup();
  await send(textUpdate("/start"));
  const calls = await send(callbackUpdate("tz:Europe/Samara"));
  const user = h.memory.state.users[0];
  assertEquals(user.timezone, "Europe/Samara");
  assertEquals(user.onboardedAt, NOW);
  assertEquals(calls.map((c) => c.method), [
    "answerCallbackQuery",
    "editMessageText",
    "sendMessage",
  ]);
  assertEquals(
    calls[1].payload.text,
    "Часовой пояс: Самара (UTC+4). Поменять можно в /settings.",
  );
  assertEquals(calls[2].payload.text, ONBOARDING_HINT);

  // Повторный выбор подсказку не шлёт
  const again = await send(callbackUpdate("tz:Asia/Omsk"));
  assertEquals(again.map((c) => c.method), [
    "answerCallbackQuery",
    "editMessageText",
  ]);
});

Deno.test("пояс «Другой»: просьба ответом, неверный ввод, затем UTC+4", async () => {
  const { h, send } = setup();
  const ask = await send(callbackUpdate("tz:other"));
  assertEquals(ask[1].payload.text, TZ_PROMPT);
  assertEquals(
    (ask[1].payload.reply_markup as { force_reply: boolean }).force_reply,
    true,
  );

  const wrong = await send(
    textUpdate("Марс", { text: TZ_PROMPT, fromBot: true }),
  );
  assertEquals(wrong[0].payload.text, TZ_INVALID);
  assertEquals(h.phrases, []);

  await send(textUpdate("UTC+4", { text: TZ_INVALID, fromBot: true }));
  assertEquals(h.memory.state.users[0].timezone, "Etc/GMT-4");
});

// --- фразы и кнопки под подтверждением ---

Deno.test("фраза: «печатает», подтверждение с кнопками, id сообщения в entries", async () => {
  const { h, send } = setup();
  h.answers.set("кофе 250", [cafe(250)]);
  const calls = await send(textUpdate("кофе 250"));
  assertEquals(calls[0].method, "sendChatAction");
  assertEquals(calls[0].payload.action, "typing");
  assertEquals(
    calls[1].payload.text,
    "Записал: расход 250 ₽ · Кафе и рестораны · сегодня 15:51",
  );
  assertEquals(buttons(calls[1]), [["Отменить", "Категория"]]);
  assertEquals(h.memory.state.entries[0].botMessageId, 101);
});

Deno.test("неизвестная команда не уходит в нейросеть", async () => {
  const { h, send } = setup();
  const calls = await send(textUpdate("/foo"));
  assertStringIncludes(calls[0].payload.text as string, "/help");
  assertEquals(h.phrases, []);
});

Deno.test("«Отменить» убирает все записи одной фразы", async () => {
  const { h, send } = setup();
  h.answers.set("такси 340, обед 450 и завтра в 15 созвон", [
    { ...cafe(340), category: "Такси" },
    cafe(450),
    {
      type: "event",
      title: "Созвон",
      starts_at: "2026-10-27T15:00",
      ends_at: null,
      all_day: false,
      remind_before_min: [60],
    },
  ]);
  h.answers.set("кофе 250", [cafe(250)]);
  const first = await send(
    textUpdate("такси 340, обед 450 и завтра в 15 созвон"),
  );
  const undo = callbackOf(first[1], "Отменить");
  await send(textUpdate("кофе 250"));

  const calls = await send(callbackUpdate(undo));
  assertEquals(
    calls.find((c) => c.method === "editMessageText")?.payload.text,
    "Отменено",
  );
  const { transactions, events, reminders, entries } = h.memory.state;
  assertEquals(transactions.map((t) => t.deletedAt !== null), [
    true,
    true,
    false,
  ]);
  assertEquals(events[0].deletedAt !== null, true);
  assertEquals(reminders[0].active, false);
  assertEquals(entries.map((e) => e.status), ["undone", "saved"]);
});

Deno.test("«Отменить» через 48 часов не работает", async () => {
  const { h, send } = setup();
  h.answers.set("кофе 250", [cafe(250)]);
  const first = await send(textUpdate("кофе 250"));
  h.clock.now = new Date(NOW.getTime() + UNDO_WINDOW_MS + 1000);
  const calls = await send(callbackUpdate(callbackOf(first[1], "Отменить")));
  assertStringIncludes(calls[0].payload.text as string, "48 часов");
  assertEquals(h.memory.state.transactions[0].deletedAt, null);
});

Deno.test("чужую запись отменить нельзя", async () => {
  const { h, send } = setup();
  h.answers.set("кофе 250", [cafe(250)]);
  const first = await send(textUpdate("кофе 250"));
  await send(callbackUpdate(callbackOf(first[1], "Отменить"), 777));
  assertEquals(h.memory.state.transactions[0].deletedAt, null);
});

Deno.test("«Категория»: выбор из списка и обновлённое подтверждение", async () => {
  const { h, send } = setup();
  h.answers.set("кофе 250", [cafe(250)]);
  const first = await send(textUpdate("кофе 250"));

  const list = await send(callbackUpdate(callbackOf(first[1], "Категория")));
  const markup = list.find((c) => c.method === "editMessageReplyMarkup")!;
  assertEquals(buttons(markup).flat().length, 16);
  assertEquals(buttons(markup)[0], ["Продукты", "✓ Кафе и рестораны"]);

  const set = await send(callbackUpdate(callbackOf(markup, "Продукты")));
  assertEquals(
    h.memory.state.transactions[0].categoryId,
    h.memory.categoryId("expense", "Продукты"),
  );
  const edited = set.find((c) => c.method === "editMessageText")!;
  assertEquals(
    edited.payload.text,
    "Записал: расход 250 ₽ · Продукты · сегодня 15:51",
  );
  assertEquals(buttons(edited), [["Отменить", "Категория"]]);
});

Deno.test("«Категория» при нескольких тратах: сначала выбор траты", async () => {
  const { h, send } = setup();
  h.answers.set("такси 340 и обед 450", [
    { ...cafe(340), category: "Такси" },
    cafe(450),
  ]);
  const first = await send(textUpdate("такси 340 и обед 450"));
  const pick = (await send(callbackUpdate(callbackOf(first[1], "Категория"))))
    .find((c) => c.method === "editMessageReplyMarkup")!;
  assertEquals(buttons(pick), [
    ["340 ₽ · Такси"],
    ["450 ₽ · Кафе и рестораны"],
    ["← Назад"],
  ]);

  const cats =
    (await send(callbackUpdate(callbackOf(pick, "450 ₽ · Кафе и рестораны"))))
      .find((c) => c.method === "editMessageReplyMarkup")!;
  await send(callbackUpdate(callbackOf(cats, "Подарки")));
  const [taxi, lunch] = h.memory.state.transactions;
  assertEquals(taxi.categoryId, h.memory.categoryId("expense", "Такси"));
  assertEquals(lunch.categoryId, h.memory.categoryId("expense", "Подарки"));
});

Deno.test("категорию дохода в трату не подсунуть", async () => {
  const { h, send } = setup();
  h.answers.set("кофе 250", [cafe(250)]);
  await send(textUpdate("кофе 250"));
  const tx = h.memory.state.transactions[0];
  await send(
    callbackUpdate(
      callbackData.setCategory(
        tx.id,
        h.memory.categoryId("income", "Зарплата"),
      ),
    ),
  );
  assertEquals(
    h.memory.state.transactions[0].categoryId,
    h.memory.categoryId("expense", "Кафе и рестораны"),
  );
});

// --- команды ---

Deno.test("/help", async () => {
  const { send } = setup();
  const calls = await send(textUpdate("/help"));
  assertEquals(calls[0].payload.text, HELP_TEXT);
});

Deno.test("/today: план, напоминания и траты на сегодня в поясе пользователя", async () => {
  const { h, send } = setup();
  await send(callbackUpdate("tz:Europe/Samara"));
  h.answers.set("a", [
    cafe(520, "2026-10-26T09:00"),
    { ...cafe(450), category: "Такси" },
    cafe(100, "2026-10-25T23:30"), // вчера — не попадает
    {
      type: "event",
      title: "Ужин",
      starts_at: "2026-10-26T19:00",
      ends_at: null,
      all_day: false,
      remind_before_min: [60],
    },
    {
      type: "event",
      title: "День рождения Ани",
      starts_at: "2026-10-26",
      ends_at: null,
      all_day: true,
      remind_before_min: [],
    },
    {
      type: "event",
      title: "Стоматолог",
      starts_at: "2026-10-30T10:00",
      ends_at: null,
      all_day: false,
      remind_before_min: [60],
    },
    {
      type: "reminder",
      text: "Позвонить маме",
      first_at: "2026-10-26T17:51",
      rrule: null,
    },
  ]);
  await send(textUpdate("a"));
  const calls = await send(textUpdate("/today"));
  assertEquals(
    calls[0].payload.text,
    [
      "Сегодня, 26 октября, понедельник",
      "",
      "План:",
      "• весь день — День рождения Ани",
      "• 19:00 — Ужин",
      "",
      "Напоминания:",
      "• 17:51 — Позвонить маме",
      "",
      "Траты:",
      "• 09:00 · 520 ₽ · Кафе и рестораны",
      "• 15:51 · 450 ₽ · Такси",
      "Итого: 970 ₽",
    ].join("\n"),
  );
});

Deno.test("/week: события на 7 дней по дням", async () => {
  const { h, send } = setup();
  await send(callbackUpdate("tz:Europe/Samara"));
  h.answers.set("a", [
    {
      type: "event",
      title: "Стоматолог",
      starts_at: "2026-10-30T10:00",
      ends_at: null,
      all_day: false,
      remind_before_min: [60],
    },
    {
      type: "event",
      title: "Ужин",
      starts_at: "2026-10-26T19:00",
      ends_at: null,
      all_day: false,
      remind_before_min: [],
    },
    {
      type: "event",
      title: "Через неделю",
      starts_at: "2026-11-02T10:00",
      ends_at: null,
      all_day: false,
      remind_before_min: [],
    },
  ]);
  await send(textUpdate("a"));
  const calls = await send(textUpdate("/week"));
  assertEquals(
    calls[0].payload.text,
    [
      "План на 7 дней:",
      "",
      "Сегодня, 26 октября, понедельник",
      "• 19:00 — Ужин",
      "",
      "30 октября, пятница",
      "• 10:00 — Стоматолог",
    ].join("\n"),
  );
});

Deno.test("/stats: суммы по категориям совпадают с ручным подсчётом", async () => {
  const { h, send } = setup();
  await send(callbackUpdate("tz:Europe/Samara"));
  h.answers.set("октябрь", [
    cafe(520, "2026-10-01T00:30"), // 30 сентября 20:30 UTC — уже октябрь у пользователя
    cafe(1200.5, "2026-10-15T13:00"),
    { ...cafe(340), category: "Такси" },
    { ...cafe(5000), category: "Продукты" },
  ]);
  h.answers.set("сентябрь", [
    cafe(3000, "2026-09-10T12:00"),
    cafe(999, "2026-09-27T12:00"),
  ]);
  h.answers.set("отменённая", [cafe(100000)]);
  await send(textUpdate("октябрь"));
  await send(textUpdate("сентябрь"));
  const cancelled = await send(textUpdate("отменённая"));
  await send(callbackUpdate(callbackOf(cancelled[1], "Отменить")));

  const calls = await send(textUpdate("/stats"));
  // Октябрь: 520 + 1200,50 + 340 + 5000 = 7060,50. Сентябрь 1–26: только 3000
  assertEquals(
    calls[0].payload.text,
    [
      "Траты за октябрь, 1–26 число:",
      "",
      "• Продукты — 5 000 ₽",
      "• Кафе и рестораны — 1 720,50 ₽",
      "• Такси — 340 ₽",
      "",
      "Итого: 7 060,50 ₽",
      "Это на 135% больше, чем за 1–26 сентября: 3 000 ₽.",
    ].join("\n"),
  );
});

Deno.test("/settings: валюта и время сводки", async () => {
  const { h, send } = setup();
  const calls = await send(textUpdate("/settings"));
  assertStringIncludes(
    calls[0].payload.text as string,
    "Часовой пояс: Москва (UTC+3)",
  );
  assertStringIncludes(
    calls[0].payload.text as string,
    "Утренняя сводка: включена, в 08:00",
  );

  const cur = await send(callbackUpdate("st:cur"));
  assertEquals(buttons(cur[1])[0], [
    "✓ RUB ₽",
    "USD $",
    "EUR €",
    "KZT ₸",
    "BYN Br",
  ]);
  const done = await send(callbackUpdate("cur:USD"));
  assertEquals(h.memory.state.users[0].currency, "USD");
  assertStringIncludes(done[1].payload.text as string, "Валюта: USD ($)");

  await send(callbackUpdate("st:dg"));
  assertEquals(h.memory.state.users[0].digestEnabled, false);
  await send(callbackUpdate("dt:07:00"));
  assertEquals([
    h.memory.state.users[0].digestTime,
    h.memory.state.users[0].digestEnabled,
  ], ["07:00", true]);

  await send(callbackUpdate("stz:Asia/Irkutsk"));
  assertEquals(h.memory.state.users[0].timezone, "Asia/Irkutsk");
  await send(callbackUpdate("cur:XYZ"));
  assertEquals(h.memory.state.users[0].currency, "USD");
});
