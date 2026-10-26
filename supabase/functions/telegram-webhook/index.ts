import { requireEnv } from "../_shared/env.ts";
import { upsertUser } from "../_shared/users.ts";
import { createBot } from "./bot.ts";
import { createWebhookHandler } from "./handler.ts";
import { markProcessed, unmarkProcessed } from "./processed-updates.ts";

const bot = createBot(requireEnv("TELEGRAM_BOT_TOKEN"), { upsertUser });

const handler = createWebhookHandler({
  secret: requireEnv("TELEGRAM_WEBHOOK_SECRET"),
  markProcessed,
  unmarkProcessed,
  handleUpdate: async (update) => {
    // getMe один раз на холодный старт
    if (!bot.isInited()) {
      await bot.init();
    }
    await bot.handleUpdate(update);
  },
});

Deno.serve(handler);
