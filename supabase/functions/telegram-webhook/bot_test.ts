import { assertEquals } from "@std/assert";
import type { Update, UserFromGetMe } from "grammy/types";
import type { TelegramProfile } from "../_shared/users.ts";
import { createBot, START_TEXT } from "./bot.ts";

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

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

// Бот без сети: вызовы Bot API перехватываются и записываются
function setup() {
  const users: TelegramProfile[] = [];
  const calls: ApiCall[] = [];
  const bot = createBot("123:test", {
    upsertUser: (profile) => {
      users.push(profile);
      return Promise.resolve();
    },
  }, BOT_INFO);
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    // deno-lint-ignore no-explicit-any
    return Promise.resolve({ ok: true, result: true } as any);
  });
  return { bot, users, calls };
}

function textUpdate(text: string): Update {
  const isCommand = text.startsWith("/");
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: 1_790_000_000,
      chat: { id: 555, type: "private", first_name: "Иван" },
      from: { id: 555, is_bot: false, first_name: "Иван", username: "ivan" },
      text,
      entities: isCommand
        ? [{
          type: "bot_command",
          offset: 0,
          length: text.split(" ")[0].length,
        }]
        : undefined,
    },
  };
}

Deno.test("/start: создаёт пользователя и отвечает приветствием", async () => {
  const { bot, users, calls } = setup();
  await bot.handleUpdate(textUpdate("/start"));

  assertEquals(users, [{
    telegramId: 555,
    firstName: "Иван",
    username: "ivan",
  }]);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].method, "sendMessage");
  assertEquals(calls[0].payload.chat_id, 555);
  assertEquals(calls[0].payload.text, START_TEXT);
});

Deno.test("обычный текст на Этапе 0 не трогает базу и не отвечает", async () => {
  const { bot, users, calls } = setup();
  await bot.handleUpdate(textUpdate("кофе 250"));
  assertEquals(users, []);
  assertEquals(calls, []);
});
