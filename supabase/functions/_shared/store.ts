// Доступ к данным за интерфейсом: в функциях — Supabase (store-supabase.ts),
// в юнит-тестах — память (testing/memory-store.ts). Все моменты — Date в UTC.
import type { Draft } from "./parser/normalize.ts";
import type { Period } from "./time.ts";

export type Kind = "expense" | "income";
export type EntrySource = "bot_text" | "bot_voice" | "shortcut" | "miniapp";
export type EntryStatus = "saved" | "needs_clarification" | "failed" | "undone";

export interface TelegramProfile {
  telegramId: number;
  firstName: string | null;
  username: string | null;
}

export interface User {
  id: string;
  telegramId: number;
  timezone: string;
  currency: string;
  digestEnabled: boolean;
  digestTime: string; // «08:00»
  onboardedAt: Date | null;
}

export interface UserPatch {
  timezone?: string;
  currency?: string;
  digestEnabled?: boolean;
  digestTime?: string;
  onboardedAt?: Date;
}

export interface Category {
  id: string;
  userId: string | null;
  kind: Kind;
  name: string;
  sort: number;
}

export interface Entry {
  id: string;
  userId: string;
  source: EntrySource;
  rawText: string;
  status: EntryStatus;
  botMessageId: number | null;
  createdAt: Date;
}

export interface NewEntry {
  userId: string;
  source: EntrySource;
  rawText: string;
  parsed: unknown;
  status: EntryStatus;
  llmModel: string | null;
  llmTokensIn: number | null;
  llmTokensOut: number | null;
  llmMs: number | null;
}

export interface Transaction {
  id: string;
  userId: string;
  entryId: string | null;
  kind: Kind;
  amountMinor: number;
  currency: string;
  categoryId: string | null;
  note: string | null;
  occurredAt: Date;
  deletedAt: Date | null;
}

export interface CalendarEvent {
  id: string;
  userId: string;
  entryId: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  deletedAt: Date | null;
}

export interface Reminder {
  id: string;
  userId: string;
  entryId: string | null;
  eventId: string | null;
  text: string;
  nextFireAt: Date | null;
  rrule: string | null;
  dtstartLocal: string | null; // «2026-11-05T10:00:00», местное время
  active: boolean;
}

// Все записи одной фразы
export interface EntryRecords {
  transactions: Transaction[];
  events: CalendarEvent[];
  reminders: Reminder[];
}

export interface Totals {
  categoryId: string | null;
  currency: string;
  totalMinor: number;
  count: number;
}

export interface Store {
  upsertUser(profile: TelegramProfile): Promise<User>;
  updateUser(userId: string, patch: UserPatch): Promise<User>;

  // Общие категории и свои, без скрытых, по порядку
  listCategories(userId: string): Promise<Category[]>;

  createEntry(entry: NewEntry): Promise<Entry>;
  getEntry(entryId: string): Promise<Entry | null>;
  getLatestEntry(userId: string): Promise<Entry | null>;
  setEntryStatus(entryId: string, status: EntryStatus): Promise<void>;
  setEntryMessage(entryId: string, botMessageId: number): Promise<void>;
  // Вводы пользователя с момента since: лимит в минуту
  countUserEntriesSince(userId: string, since: Date): Promise<number>;
  // Вводы через нейросеть на весь сервис с момента since: потолок в сутки
  countLlmEntriesSince(since: Date): Promise<number>;

  // Сохраняет записи фразы (запросы пропускает) и возвращает их
  saveRecords(
    userId: string,
    entryId: string,
    drafts: Draft[],
  ): Promise<EntryRecords>;
  getEntryRecords(entryId: string): Promise<EntryRecords>;
  // Мягко удаляет все записи фразы, выключает напоминания, entries.status = undone
  undoEntry(entryId: string, now: Date): Promise<void>;

  getTransaction(transactionId: string): Promise<Transaction | null>;
  setTransactionCategory(
    transactionId: string,
    categoryId: string,
  ): Promise<void>;

  // Суммы считает SQL: функция transaction_totals
  transactionTotals(
    userId: string,
    kind: Kind,
    period: Period,
    categoryId?: string | null,
  ): Promise<Totals[]>;
  listTransactions(userId: string, period: Period): Promise<Transaction[]>;
  listEvents(userId: string, period: Period): Promise<CalendarEvent[]>;
  // Активные напоминания, которые сработают в период
  listReminders(userId: string, period: Period): Promise<Reminder[]>;
}
