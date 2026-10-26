import { createAdminNotifier, parseAdminIds } from "../_shared/admin.ts";
import { getDb } from "../_shared/db.ts";
import { requireEnv } from "../_shared/env.ts";
import { ingest } from "../_shared/ingest.ts";
import { createLlmProvider } from "../_shared/llm/index.ts";
import { parsePhrase } from "../_shared/parser/parse.ts";
import { createSupabaseStore } from "../_shared/store-supabase.ts";
import { createBot } from "./bot.ts";
import { createWebhookHandler } from "./handler.ts";
import { markProcessed, unmarkProcessed } from "./processed-updates.ts";

const store = createSupabaseStore(getDb());
const llm = createLlmProvider();
const models = {
  primary: requireEnv("LLM_MODEL"),
  fallback: requireEnv("LLM_FALLBACK_MODEL"),
};
const llmDailyCap = Number(requireEnv("LLM_DAILY_CAP"));
if (!Number.isSafeInteger(llmDailyCap) || llmDailyCap < 0) {
  throw new Error("LLM_DAILY_CAP должен быть целым числом");
}

const bot = createBot(requireEnv("TELEGRAM_BOT_TOKEN"), {
  store,
  now: () => new Date(),
  ingest: (input) =>
    ingest({
      store,
      parse: (ctx, phrase) => parsePhrase(llm, models, ctx, phrase),
      llmDailyCap,
      notifyAdmins,
    }, input),
});

const notifyAdmins = createAdminNotifier(
  parseAdminIds(Deno.env.get("ADMIN_TELEGRAM_IDS")),
  (chatId, text) => bot.api.sendMessage(chatId, text),
);

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
