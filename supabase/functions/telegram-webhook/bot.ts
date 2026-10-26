import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { TelegramProfile } from "../_shared/users.ts";

export interface BotDeps {
  upsertUser(profile: TelegramProfile): Promise<void>;
}

export const START_TEXT = [
  "Привет! Я Трекер: записываю траты, доходы, встречи и напоминания из одной фразы.",
  "Пиши как другу: «кофе 250», «завтра в 15 созвон», «напомни 5 числа оплатить интернет».",
].join("\n");

// botInfo передают тесты, чтобы бот не ходил в Telegram за getMe
export function createBot(
  token: string,
  deps: BotDeps,
  botInfo?: UserFromGetMe,
): Bot {
  const bot = new Bot(token, { botInfo });

  bot.command("start", async (ctx) => {
    const from = ctx.from;
    if (!from) {
      return;
    }
    await deps.upsertUser({
      telegramId: from.id,
      firstName: from.first_name ?? null,
      username: from.username ?? null,
    });
    await ctx.reply(START_TEXT);
  });

  return bot;
}
