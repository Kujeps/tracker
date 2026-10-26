// Регистрация вебхука и списка команд бота.
// Запуск: deno task set-webhook (переменные берутся из .env)
import { Api } from "grammy";
import { requireEnv } from "../supabase/functions/_shared/env.ts";

// Апдейты, которые нужны боту. Изменённые сообщения не принимаем.
const ALLOWED_UPDATES = [
  "message",
  "callback_query",
  "pre_checkout_query",
] as const;

// Команды в меню бота: добавляются по мере того, как появляются в коде
const COMMANDS = [
  { command: "today", description: "План и траты на сегодня" },
  { command: "week", description: "События на 7 дней" },
  { command: "stats", description: "Траты за месяц по категориям" },
  { command: "settings", description: "Часовой пояс, сводка, валюта" },
  { command: "help", description: "Примеры фраз" },
  { command: "start", description: "Начать сначала" },
];

const api = new Api(requireEnv("TELEGRAM_BOT_TOKEN"));
const url = new URL(
  "/functions/v1/telegram-webhook",
  requireEnv("SUPABASE_URL"),
).toString();

await api.setWebhook(url, {
  secret_token: requireEnv("TELEGRAM_WEBHOOK_SECRET"),
  allowed_updates: [...ALLOWED_UPDATES],
});
await api.setMyCommands(COMMANDS);

const info = await api.getWebhookInfo();
console.log(`Вебхук: ${info.url}`);
console.log(`Апдейтов в очереди: ${info.pending_update_count}`);
if (info.last_error_message) {
  console.log(`Последняя ошибка доставки: ${info.last_error_message}`);
}
console.log(`Команды: ${COMMANDS.map((c) => "/" + c.command).join(", ")}`);
