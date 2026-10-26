// Store в памяти для юнит-тестов: ведёт себя как Supabase-версия, включая
// подсчёт сумм (как SQL-функция transaction_totals) и мягкое удаление.
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
} from "../categories.ts";
import type { Draft } from "../parser/normalize.ts";
import type {
  CalendarEvent,
  Category,
  Entry,
  EntryRecords,
  NewEntry,
  Reminder,
  Store,
  Totals,
  Transaction,
  User,
} from "../store.ts";

export interface MemoryState {
  users: User[];
  categories: Category[];
  entries: (Entry & { parsed: unknown; llmModel: string | null })[];
  transactions: Transaction[];
  events: CalendarEvent[];
  reminders: Reminder[];
}

export function createMemoryStore(clock: () => Date = () => new Date()) {
  let seq = 0;
  // Предсказуемые UUID: 00000000-0000-4000-8000-000000000001 и дальше
  const uuid = () =>
    `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

  const state: MemoryState = {
    users: [],
    categories: [
      ...DEFAULT_EXPENSE_CATEGORIES.map((name, i) => ({
        id: uuid(),
        userId: null,
        kind: "expense" as const,
        name,
        sort: (i + 1) * 10,
      })),
      ...DEFAULT_INCOME_CATEGORIES.map((name, i) => ({
        id: uuid(),
        userId: null,
        kind: "income" as const,
        name,
        sort: (i + 1) * 10,
      })),
    ],
    entries: [],
    transactions: [],
    events: [],
    reminders: [],
  };

  const inPeriod = (d: Date | null, p: { from: Date; to: Date }) =>
    d !== null && d >= p.from && d < p.to;

  const records = (entryId: string): EntryRecords => ({
    transactions: state.transactions.filter((t) => t.entryId === entryId),
    events: state.events.filter((e) => e.entryId === entryId),
    reminders: state.reminders.filter((r) => r.entryId === entryId),
  });

  const store: Store = {
    upsertUser(profile) {
      let user = state.users.find((u) => u.telegramId === profile.telegramId);
      if (!user) {
        user = {
          id: uuid(),
          telegramId: profile.telegramId,
          timezone: "Europe/Moscow",
          currency: "RUB",
          digestEnabled: true,
          digestTime: "08:00",
          onboardedAt: null,
        };
        state.users.push(user);
      }
      return Promise.resolve({ ...user });
    },

    updateUser(userId, patch) {
      const user = state.users.find((u) => u.id === userId)!;
      Object.assign(user, patch);
      return Promise.resolve({ ...user });
    },

    listCategories(userId) {
      return Promise.resolve(
        state.categories
          .filter((c) => c.userId === null || c.userId === userId)
          .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
      );
    },

    createEntry(entry: NewEntry) {
      const row = {
        id: uuid(),
        userId: entry.userId,
        source: entry.source,
        rawText: entry.rawText,
        status: entry.status,
        botMessageId: null,
        createdAt: clock(),
        parsed: entry.parsed,
        llmModel: entry.llmModel,
      };
      state.entries.push(row);
      return Promise.resolve({ ...row });
    },

    getEntry(entryId) {
      const e = state.entries.find((x) => x.id === entryId);
      return Promise.resolve(e ? { ...e } : null);
    },

    getLatestEntry(userId) {
      const own = state.entries.filter((e) => e.userId === userId);
      const e = own[own.length - 1];
      return Promise.resolve(e ? { ...e } : null);
    },

    setEntryStatus(entryId, status) {
      state.entries.find((e) => e.id === entryId)!.status = status;
      return Promise.resolve();
    },

    setEntryMessage(entryId, botMessageId) {
      state.entries.find((e) => e.id === entryId)!.botMessageId = botMessageId;
      return Promise.resolve();
    },

    countUserEntriesSince(userId, since) {
      return Promise.resolve(
        state.entries.filter((e) => e.userId === userId && e.createdAt >= since)
          .length,
      );
    },

    countLlmEntriesSince(since) {
      return Promise.resolve(
        state.entries.filter((e) => e.llmModel !== null && e.createdAt >= since)
          .length,
      );
    },

    saveRecords(userId, entryId, drafts: Draft[]) {
      for (const d of drafts) {
        if (d.kind === "transaction") {
          state.transactions.push({
            id: uuid(),
            userId,
            entryId,
            kind: d.type,
            amountMinor: d.amountMinor,
            currency: d.currency,
            categoryId: d.categoryId,
            note: d.note,
            occurredAt: d.occurredAt,
            deletedAt: null,
          });
        } else if (d.kind === "event") {
          const id = uuid();
          state.events.push({
            id,
            userId,
            entryId,
            title: d.title,
            startsAt: d.startsAt,
            endsAt: d.endsAt,
            allDay: d.allDay,
            deletedAt: null,
          });
          for (const r of d.reminders) {
            state.reminders.push({
              id: uuid(),
              userId,
              entryId,
              eventId: id,
              text: d.title,
              nextFireAt: r.fireAt,
              rrule: null,
              dtstartLocal: null,
              active: true,
            });
          }
        } else if (d.kind === "reminder") {
          state.reminders.push({
            id: uuid(),
            userId,
            entryId,
            eventId: null,
            text: d.text,
            nextFireAt: d.nextFireAt,
            rrule: d.rrule,
            dtstartLocal: d.dtstartLocal,
            active: true,
          });
        }
      }
      return Promise.resolve(records(entryId));
    },

    getEntryRecords(entryId) {
      return Promise.resolve(records(entryId));
    },

    undoEntry(entryId, now) {
      for (const t of state.transactions) {
        if (t.entryId === entryId && !t.deletedAt) t.deletedAt = now;
      }
      for (const e of state.events) {
        if (e.entryId === entryId && !e.deletedAt) e.deletedAt = now;
      }
      for (const r of state.reminders) {
        if (r.entryId === entryId) r.active = false;
      }
      state.entries.find((e) => e.id === entryId)!.status = "undone";
      return Promise.resolve();
    },

    getTransaction(transactionId) {
      const t = state.transactions.find((x) => x.id === transactionId);
      return Promise.resolve(t ? { ...t } : null);
    },

    setTransactionCategory(transactionId, categoryId) {
      state.transactions.find((t) => t.id === transactionId)!.categoryId =
        categoryId;
      return Promise.resolve();
    },

    transactionTotals(userId, kind, period, categoryId = null) {
      const groups = new Map<string, Totals>();
      for (const t of state.transactions) {
        if (t.userId !== userId || t.kind !== kind || t.deletedAt) continue;
        if (!inPeriod(t.occurredAt, period)) continue;
        if (categoryId && t.categoryId !== categoryId) continue;
        const key = `${t.categoryId}|${t.currency}`;
        const g = groups.get(key) ??
          {
            categoryId: t.categoryId,
            currency: t.currency,
            totalMinor: 0,
            count: 0,
          };
        g.totalMinor += t.amountMinor;
        g.count += 1;
        groups.set(key, g);
      }
      return Promise.resolve([...groups.values()]);
    },

    listTransactions(userId, period) {
      return Promise.resolve(
        state.transactions
          .filter((t) =>
            t.userId === userId && !t.deletedAt &&
            inPeriod(t.occurredAt, period)
          )
          .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()),
      );
    },

    listEvents(userId, period) {
      return Promise.resolve(
        state.events
          .filter((e) =>
            e.userId === userId && !e.deletedAt && inPeriod(e.startsAt, period)
          )
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
      );
    },

    listReminders(userId, period) {
      return Promise.resolve(
        state.reminders
          .filter((r) =>
            r.userId === userId && r.active && inPeriod(r.nextFireAt, period)
          )
          .sort((a, b) => a.nextFireAt!.getTime() - b.nextFireAt!.getTime()),
      );
    },
  };

  const categoryId = (kind: "expense" | "income", name: string) =>
    state.categories.find((c) => c.kind === kind && c.name === name)!.id;

  return { store, state, categoryId };
}
