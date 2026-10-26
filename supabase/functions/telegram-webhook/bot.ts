import { Bot, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import {
  confirmationKeyboard,
  renderConfirmation,
} from "../_shared/confirmation.ts";
import type { IngestInput, IngestResult } from "../_shared/ingest.ts";
import { SUPPORTED_CURRENCIES } from "../_shared/money.ts";
import type { Store, User } from "../_shared/store.ts";
import { parseCallbackData, toMarkup } from "../_shared/telegram.ts";
import {
  canonicalTimeZone,
  parseTimeZoneInput,
  timeZoneLabel,
} from "../_shared/timezones.ts";
import {
  categoryKeyboard,
  currencyKeyboard,
  DIGEST_TIMES,
  digestTimeKeyboard,
  HELP_TEXT,
  ONBOARDING_HINT,
  pickTransactionKeyboard,
  settingsView,
  START_TEXT,
  statsView,
  timezoneKeyboard,
  todayView,
  TZ_INVALID,
  TZ_PROMPT,
  weekView,
} from "./views.ts";

// «Отменить» работает 48 часов
export const UNDO_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface BotDeps {
  store: Store;
  ingest(input: IngestInput): Promise<IngestResult>;
  now(): Date;
}

// botInfo передают тесты, чтобы бот не ходил в Telegram за getMe
export function createBot(
  token: string,
  deps: BotDeps,
  botInfo?: UserFromGetMe,
): Bot {
  const bot = new Bot(token, { botInfo });
  const { store } = deps;

  // Пользователь по апдейту: создаём или обновляем имя и username
  const currentUser = (ctx: Context): Promise<User> | null => {
    const from = ctx.from;
    if (!from || from.is_bot) return null;
    return store.upsertUser({
      telegramId: from.id,
      firstName: from.first_name ?? null,
      username: from.username ?? null,
    });
  };

  // Сохраняет пояс. В первый раз — конец онбординга и подсказка.
  const applyTimezone = async (
    ctx: Context,
    user: User,
    tz: string,
    fromSettings: boolean,
  ) => {
    const updated = await store.updateUser(user.id, {
      timezone: tz,
      ...(user.onboardedAt ? {} : { onboardedAt: deps.now() }),
    });
    const label = timeZoneLabel(tz, deps.now());
    if (fromSettings) {
      const view = settingsView(updated, deps.now());
      await ctx.editMessageText(view.text, {
        reply_markup: toMarkup(view.keyboard),
      });
    } else if (ctx.callbackQuery) {
      await ctx.editMessageText(
        `Часовой пояс: ${label}. Поменять можно в /settings.`,
      );
    } else {
      await ctx.reply(`Часовой пояс: ${label}. Поменять можно в /settings.`);
    }
    if (!user.onboardedAt) {
      await ctx.reply(ONBOARDING_HINT);
    }
  };

  // --- команды ---

  bot.command("start", async (ctx) => {
    if (!(await currentUser(ctx))) return;
    await ctx.reply(START_TEXT, {
      reply_markup: toMarkup(timezoneKeyboard(false)),
    });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(HELP_TEXT);
  });

  bot.command("today", async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return;
    await ctx.reply(await todayView(store, user, deps.now()));
  });

  bot.command("week", async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return;
    await ctx.reply(await weekView(store, user, deps.now()));
  });

  bot.command("stats", async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return;
    await ctx.reply(await statsView(store, user, deps.now()));
  });

  bot.command("settings", async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return;
    const view = settingsView(user, deps.now());
    await ctx.reply(view.text, { reply_markup: toMarkup(view.keyboard) });
  });

  // --- часовой пояс ---

  bot.callbackQuery(/^(s?tz):(.+)$/, async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return;
    const fromSettings = ctx.match[1] === "stz";
    const value = ctx.match[2];
    await ctx.answerCallbackQuery();
    if (value === "other") {
      await ctx.reply(TZ_PROMPT, {
        reply_markup: {
          force_reply: true,
          input_field_placeholder: "Europe/Berlin или UTC+4",
        },
      });
      return;
    }
    const tz = canonicalTimeZone(value);
    if (tz) await applyTimezone(ctx, user, value, fromSettings);
  });

  // --- /settings ---

  bot.callbackQuery(/^st:(menu|tz|cur|dg|dt)$/, async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return;
    await ctx.answerCallbackQuery();
    switch (ctx.match[1]) {
      case "tz":
        await ctx.editMessageReplyMarkup({
          reply_markup: toMarkup(timezoneKeyboard(true)),
        });
        return;
      case "cur":
        await ctx.editMessageReplyMarkup({
          reply_markup: toMarkup(currencyKeyboard(user.currency)),
        });
        return;
      case "dt":
        await ctx.editMessageReplyMarkup({
          reply_markup: toMarkup(digestTimeKeyboard(user.digestTime)),
        });
        return;
      case "dg": {
        const updated = await store.updateUser(user.id, {
          digestEnabled: !user.digestEnabled,
        });
        const view = settingsView(updated, deps.now());
        await ctx.editMessageText(view.text, {
          reply_markup: toMarkup(view.keyboard),
        });
        return;
      }
      default: {
        const view = settingsView(user, deps.now());
        await ctx.editMessageText(view.text, {
          reply_markup: toMarkup(view.keyboard),
        });
      }
    }
  });

  bot.callbackQuery(/^(cur|dt):(.+)$/, async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return;
    await ctx.answerCallbackQuery();
    const value = ctx.match[2];
    let updated = user;
    if (
      ctx.match[1] === "cur" &&
      (SUPPORTED_CURRENCIES as readonly string[]).includes(value)
    ) {
      updated = await store.updateUser(user.id, { currency: value });
    } else if (ctx.match[1] === "dt" && DIGEST_TIMES.includes(value)) {
      updated = await store.updateUser(user.id, {
        digestTime: value,
        digestEnabled: true,
      });
    }
    const view = settingsView(updated, deps.now());
    await ctx.editMessageText(view.text, {
      reply_markup: toMarkup(view.keyboard),
    });
  });

  // --- кнопки под подтверждением ---

  bot.on("callback_query:data", async (ctx) => {
    const action = parseCallbackData(ctx.callbackQuery.data);
    const user = await currentUser(ctx);
    if (!action || !user) {
      await ctx.answerCallbackQuery();
      return;
    }
    const now = deps.now();
    const categories = await store.listCategories(user.id);

    // Траты одной фразы и сама фраза; чужие записи не трогаем
    const loadEntry = async (entryId: string) => {
      const entry = await store.getEntry(entryId);
      return entry && entry.userId === user.id ? entry : null;
    };

    if (action.action === "undo") {
      const entry = await loadEntry(action.entryId);
      if (!entry) return void await ctx.answerCallbackQuery();
      if (entry.status === "undone") {
        await ctx.answerCallbackQuery({ text: "Уже отменено" });
        await ctx.editMessageText("Отменено");
        return;
      }
      if (now.getTime() - entry.createdAt.getTime() > UNDO_WINDOW_MS) {
        await ctx.answerCallbackQuery({
          text: "Отменить можно только в течение 48 часов",
        });
        return;
      }
      await store.undoEntry(entry.id, now);
      await ctx.answerCallbackQuery({ text: "Отменено" });
      await ctx.editMessageText("Отменено");
      return;
    }

    if (action.action === "category" || action.action === "back") {
      const entry = await loadEntry(action.entryId);
      if (!entry) return void await ctx.answerCallbackQuery();
      await ctx.answerCallbackQuery();
      if (entry.status === "undone") {
        await ctx.editMessageText("Отменено");
        return;
      }
      const records = await store.getEntryRecords(entry.id);
      if (action.action === "back") {
        await ctx.editMessageReplyMarkup({
          reply_markup: toMarkup(confirmationKeyboard(entry.id, records)),
        });
        return;
      }
      const expenses = records.transactions.filter((t) =>
        t.kind === "expense" && !t.deletedAt
      );
      const keyboard = expenses.length === 1
        ? categoryKeyboard(entry.id, expenses[0], categories)
        : pickTransactionKeyboard(entry.id, expenses, categories);
      await ctx.editMessageReplyMarkup({ reply_markup: toMarkup(keyboard) });
      return;
    }

    // Выбор траты или новой категории
    const transaction = await store.getTransaction(action.transactionId);
    if (
      !transaction || transaction.userId !== user.id || !transaction.entryId
    ) {
      return void await ctx.answerCallbackQuery();
    }
    const entry = await loadEntry(transaction.entryId);
    if (!entry || entry.status === "undone" || transaction.deletedAt) {
      await ctx.answerCallbackQuery({ text: "Запись отменена" });
      return;
    }
    if (action.action === "pickTransaction") {
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup({
        reply_markup: toMarkup(
          categoryKeyboard(entry.id, transaction, categories),
        ),
      });
      return;
    }
    const category = categories.find((c) =>
      c.id === action.categoryId && c.kind === transaction.kind
    );
    if (!category) return void await ctx.answerCallbackQuery();
    await store.setTransactionCategory(transaction.id, category.id);
    await ctx.answerCallbackQuery({ text: `Категория: ${category.name}` });
    const records = await store.getEntryRecords(entry.id);
    await ctx.editMessageText(
      renderConfirmation(records, { timezone: user.timezone, now, categories }),
      { reply_markup: toMarkup(confirmationKeyboard(entry.id, records)) },
    );
  });

  // --- фразы ---

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const user = await currentUser(ctx);
    if (!user) return;

    // Ответ на просьбу написать часовой пояс
    const replyTo = ctx.message.reply_to_message;
    if (
      replyTo?.from?.id === ctx.me.id &&
      (replyTo.text === TZ_PROMPT || replyTo.text === TZ_INVALID)
    ) {
      const tz = parseTimeZoneInput(text);
      if (!tz) {
        await ctx.reply(TZ_INVALID, { reply_markup: { force_reply: true } });
        return;
      }
      await applyTimezone(ctx, user, tz, false);
      return;
    }

    if (text.startsWith("/")) {
      await ctx.reply("Не знаю такой команды. Список — в /help.");
      return;
    }

    await ctx.replyWithChatAction("typing");
    const result = await deps.ingest({
      user,
      source: "bot_text",
      text,
      now: deps.now(),
    });
    const sent = await ctx.reply(result.reply.text, {
      reply_markup: result.reply.keyboard
        ? toMarkup(result.reply.keyboard)
        : undefined,
    });
    if (result.entryId) {
      // Запись уже сохранена и подтверждение отправлено. Если упасть здесь,
      // Telegram пришлёт сообщение снова и запись задвоится, поэтому только лог.
      try {
        await store.setEntryMessage(result.entryId, sent.message_id);
      } catch (err) {
        console.error(String(err));
      }
    }
  });

  return bot;
}
