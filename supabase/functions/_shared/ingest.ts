// Фраза → записи → подтверждение. Сюда сходятся все входы: бот, голосовые,
// команда iPhone и поле ввода в Mini App, поэтому ведут себя одинаково.
import type { AdminNotifier } from "./admin.ts";
import { confirmationKeyboard, renderConfirmation } from "./confirmation.ts";
import {
  type Draft,
  normalizeItems,
  type QueryDraft,
} from "./parser/normalize.ts";
import type { LlmAttempt, ParseResult } from "./parser/parse.ts";
import type { PromptContext } from "./parser/prompt.ts";
import { answerQuery } from "./query.ts";
import type {
  EntrySource,
  EntryStatus,
  NewEntry,
  Store,
  User,
} from "./store.ts";
import type { Reply } from "./telegram.ts";

// Не больше 20 вводов через нейросеть в минуту на пользователя
export const MAX_ENTRIES_PER_MINUTE = 20;
// Ответ на уточняющий вопрос ждём 10 минут
export const CLARIFY_WINDOW_MS = 10 * 60 * 1000;

export const HELP_EXAMPLES = [
  "Пиши как другу, одной фразой:",
  "• кофе 250",
  "• такси 340 и обед 450",
  "• вчера купил продукты на 2,3к",
  "• пришла зарплата 85000",
  "• завтра в 15 созвон с командой",
  "• 26 ноября встреча с Вадимом в 7 вечера",
  "• напомни через 2 часа позвонить маме",
  "• напомни каждый месяц 5 числа оплатить интернет",
  "• сколько я потратил на кафе в октябре",
].join("\n");

export const TEXT_RATE_LIMIT =
  "Слишком много записей за минуту. Подожди немного и попробуй снова.";
export const TEXT_DAILY_CAP =
  "Сегодня я уже разобрал слишком много фраз, нейросеть отдыхает до завтра (до 03:00 по Москве). Ручной ввод без нейросети появится в Mini App.";
export const TEXT_FAILED = "Не понял, перефразируй, пожалуйста.";
export const TEXT_OTHER =
  `Я записываю траты, доходы, встречи и напоминания.\n\n${HELP_EXAMPLES}`;

export interface IngestDeps {
  store: Store;
  parse(ctx: PromptContext, phrase: string): Promise<ParseResult>;
  llmDailyCap: number;
  notifyAdmins: AdminNotifier;
}

export interface IngestInput {
  user: User;
  source: EntrySource;
  text: string;
  now: Date;
}

export interface IngestResult {
  // Строка в entries: к ней бот привяжет сообщение-подтверждение
  entryId: string | null;
  reply: Reply;
}

// Начало суток по UTC: в это время сбрасывается дневной лимит OpenRouter
function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

// Расход на нейросеть за ввод: модель последнего вызова, токены и время — сумма
function llmUsage(
  attempts: LlmAttempt[],
): Pick<NewEntry, "llmModel" | "llmTokensIn" | "llmTokensOut" | "llmMs"> {
  if (attempts.length === 0) {
    return {
      llmModel: null,
      llmTokensIn: null,
      llmTokensOut: null,
      llmMs: null,
    };
  }
  const last = attempts.findLast((a) => a.error === null) ??
    attempts[attempts.length - 1];
  return {
    llmModel: last.model,
    llmTokensIn: attempts.reduce((n, a) => n + a.tokensIn, 0),
    llmTokensOut: attempts.reduce((n, a) => n + a.tokensOut, 0),
    llmMs: attempts.reduce((n, a) => n + a.ms, 0),
  };
}

export async function ingest(
  deps: IngestDeps,
  input: IngestInput,
): Promise<IngestResult> {
  const { store } = deps;
  const { user, now } = input;

  const recent = await store.countUserEntriesSince(
    user.id,
    new Date(now.getTime() - 60_000),
  );
  if (recent >= MAX_ENTRIES_PER_MINUTE) {
    return { entryId: null, reply: { text: TEXT_RATE_LIMIT } };
  }

  const used = await store.countLlmEntriesSince(startOfUtcDay(now));
  if (used >= deps.llmDailyCap) {
    await deps.notifyAdmins(
      "llm_daily_cap",
      `Достигнут LLM_DAILY_CAP (${deps.llmDailyCap} вызовов в сутки): бот не принимает фразы до 00:00 UTC.`,
    );
    return { entryId: null, reply: { text: TEXT_DAILY_CAP } };
  }

  // Ответ на уточняющий вопрос: склеиваем с исходной фразой и разбираем заново
  let phrase = input.text.trim();
  const latest = await store.getLatestEntry(user.id);
  if (
    latest?.status === "needs_clarification" &&
    now.getTime() - latest.createdAt.getTime() <= CLARIFY_WINDOW_MS
  ) {
    phrase = `${latest.rawText}\n${phrase}`;
  }

  const categories = await store.listCategories(user.id);
  const ctx: PromptContext = {
    now,
    timezone: user.timezone,
    currency: user.currency,
    expenseCategories: categories.filter((c) => c.kind === "expense").map((c) =>
      c.name
    ),
    incomeCategories: categories.filter((c) => c.kind === "income").map((c) =>
      c.name
    ),
  };
  const parsed = await deps.parse(ctx, phrase);

  const saveEntry = (status: EntryStatus) =>
    store.createEntry({
      userId: user.id,
      source: input.source,
      rawText: phrase,
      parsed: parsed.ok ? { items: parsed.items } : null,
      status,
      ...llmUsage(parsed.attempts),
    });

  if (!parsed.ok) {
    const entry = await saveEntry("failed");
    // Без текста фразы: только модели и причины
    const reasons = parsed.attempts.map((a) =>
      `${a.model}: ${a.error ?? "ответ не прошёл проверку"}`
    );
    await deps.notifyAdmins(
      "parser_failed",
      `Парсер не разобрал фразу.\n${reasons.join("\n")}`,
    );
    return { entryId: entry.id, reply: { text: TEXT_FAILED } };
  }

  const normalized = normalizeItems(parsed.items, {
    now,
    timezone: user.timezone,
    currency: user.currency,
    categories,
  });

  if (normalized.kind === "clarify") {
    const entry = await saveEntry("needs_clarification");
    return { entryId: entry.id, reply: { text: normalized.question } };
  }
  if (normalized.kind === "other") {
    const entry = await saveEntry("saved");
    return { entryId: entry.id, reply: { text: TEXT_OTHER } };
  }

  const records = normalized.drafts.filter((
    d,
  ): d is Exclude<Draft, QueryDraft> => d.kind !== "query");
  const queries = normalized.drafts.filter((d): d is QueryDraft =>
    d.kind === "query"
  );

  const entry = await saveEntry("saved");
  const parts: string[] = [];
  let keyboard;
  if (records.length > 0) {
    try {
      const saved = await store.saveRecords(user.id, entry.id, records);
      parts.push(
        renderConfirmation(saved, { timezone: user.timezone, now, categories }),
      );
      keyboard = confirmationKeyboard(entry.id, saved);
    } catch (err) {
      await store.setEntryStatus(entry.id, "failed");
      throw err;
    }
  }
  for (const query of queries) {
    parts.push(await answerQuery(store, user, query, now));
  }
  return { entryId: entry.id, reply: { text: parts.join("\n\n"), keyboard } };
}
