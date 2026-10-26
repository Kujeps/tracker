// Store поверх Supabase (service role). Строки базы → типы из store.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Draft } from "./parser/normalize.ts";
import type {
  CalendarEvent,
  Category,
  Entry,
  EntryRecords,
  EntryStatus,
  Kind,
  Reminder,
  Store,
  Totals,
  Transaction,
  User,
  UserPatch,
} from "./store.ts";

type Row = Record<string, unknown>;

const USER_COLUMNS =
  "id, telegram_id, timezone, currency, digest_enabled, digest_time, onboarded_at";
const ENTRY_COLUMNS =
  "id, user_id, source, raw_text, status, bot_message_id, created_at";

function date(value: unknown): Date {
  return new Date(value as string);
}

function dateOrNull(value: unknown): Date | null {
  return value === null || value === undefined ? null : date(value);
}

function toUser(row: Row): User {
  return {
    id: row.id as string,
    telegramId: Number(row.telegram_id),
    timezone: row.timezone as string,
    currency: row.currency as string,
    digestEnabled: row.digest_enabled as boolean,
    digestTime: (row.digest_time as string).slice(0, 5),
    onboardedAt: dateOrNull(row.onboarded_at),
  };
}

function toEntry(row: Row): Entry {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    source: row.source as Entry["source"],
    rawText: row.raw_text as string,
    status: row.status as EntryStatus,
    botMessageId: row.bot_message_id === null
      ? null
      : Number(row.bot_message_id),
    createdAt: date(row.created_at),
  };
}

function toTransaction(row: Row): Transaction {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    entryId: row.entry_id as string | null,
    kind: row.kind as Kind,
    amountMinor: Number(row.amount_minor),
    currency: row.currency as string,
    categoryId: row.category_id as string | null,
    note: row.note as string | null,
    occurredAt: date(row.occurred_at),
    deletedAt: dateOrNull(row.deleted_at),
  };
}

function toEvent(row: Row): CalendarEvent {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    entryId: row.entry_id as string | null,
    title: row.title as string,
    startsAt: date(row.starts_at),
    endsAt: dateOrNull(row.ends_at),
    allDay: row.all_day as boolean,
    deletedAt: dateOrNull(row.deleted_at),
  };
}

function toReminder(row: Row): Reminder {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    entryId: row.entry_id as string | null,
    eventId: row.event_id as string | null,
    text: row.text as string,
    nextFireAt: dateOrNull(row.next_fire_at),
    rrule: row.rrule as string | null,
    dtstartLocal: row.dtstart_local === null
      ? null
      : (row.dtstart_local as string).slice(0, 19),
    active: row.active as boolean,
  };
}

// Ошибка запроса → исключение с понятным текстом, без данных пользователя.
// Строка может не найтись (maybeSingle) — тогда null.
function checkMaybe<T>(
  result: { data: T; error: { message: string } | null },
  what: string,
): T {
  if (result.error) {
    throw new Error(`${what}: ${result.error.message}`);
  }
  return result.data;
}

// Запись без возврата строк (update без select): у такого запроса data всегда
// null, поэтому проверяем только ошибку
function checkWrite(
  result: { error: { message: string } | null },
  what: string,
): void {
  if (result.error) {
    throw new Error(`${what}: ${result.error.message}`);
  }
}

// То же, но данные обязаны быть
function check<T>(
  result: { data: T; error: { message: string } | null },
  what: string,
): NonNullable<T> {
  const data = checkMaybe(result, what);
  if (data === null || data === undefined) {
    throw new Error(`${what}: пустой ответ`);
  }
  return data;
}

export function createSupabaseStore(db: SupabaseClient): Store {
  const store: Store = {
    async upsertUser(profile) {
      const row = check(
        await db.from("users").upsert({
          telegram_id: profile.telegramId,
          first_name: profile.firstName,
          username: profile.username,
        }, { onConflict: "telegram_id" }).select(USER_COLUMNS).single(),
        "Не удалось сохранить пользователя",
      );
      return toUser(row);
    },

    async updateUser(userId, patch: UserPatch) {
      const values: Row = {};
      if (patch.timezone !== undefined) values.timezone = patch.timezone;
      if (patch.currency !== undefined) values.currency = patch.currency;
      if (patch.digestEnabled !== undefined) {
        values.digest_enabled = patch.digestEnabled;
      }
      if (patch.digestTime !== undefined) values.digest_time = patch.digestTime;
      if (patch.onboardedAt !== undefined) {
        values.onboarded_at = patch.onboardedAt.toISOString();
      }
      const row = check(
        await db.from("users").update(values).eq("id", userId).select(
          USER_COLUMNS,
        ).single(),
        "Не удалось обновить настройки",
      );
      return toUser(row);
    },

    async listCategories(userId) {
      const rows = check(
        await db.from("categories")
          .select("id, user_id, kind, name, sort")
          .or(`user_id.is.null,user_id.eq.${userId}`)
          .eq("archived", false)
          .order("sort")
          .order("name"),
        "Не удалось загрузить категории",
      );
      return rows.map((row: Row): Category => ({
        id: row.id as string,
        userId: row.user_id as string | null,
        kind: row.kind as Kind,
        name: row.name as string,
        sort: row.sort as number,
      }));
    },

    async createEntry(entry) {
      const row = check(
        await db.from("entries").insert({
          user_id: entry.userId,
          source: entry.source,
          raw_text: entry.rawText,
          parsed: entry.parsed,
          status: entry.status,
          llm_model: entry.llmModel,
          llm_tokens_in: entry.llmTokensIn,
          llm_tokens_out: entry.llmTokensOut,
          llm_ms: entry.llmMs,
        }).select(ENTRY_COLUMNS).single(),
        "Не удалось сохранить ввод",
      );
      return toEntry(row);
    },

    async getEntry(entryId) {
      const row = checkMaybe(
        await db.from("entries").select(ENTRY_COLUMNS).eq("id", entryId)
          .maybeSingle(),
        "Не удалось загрузить ввод",
      );
      return row ? toEntry(row) : null;
    },

    async getLatestEntry(userId) {
      const row = checkMaybe(
        await db.from("entries").select(ENTRY_COLUMNS)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "Не удалось загрузить последний ввод",
      );
      return row ? toEntry(row) : null;
    },

    async setEntryStatus(entryId, status) {
      checkWrite(
        await db.from("entries").update({ status }).eq("id", entryId),
        "Не удалось обновить ввод",
      );
    },

    async setEntryMessage(entryId, botMessageId) {
      checkWrite(
        await db.from("entries").update({ bot_message_id: botMessageId }).eq(
          "id",
          entryId,
        ),
        "Не удалось обновить ввод",
      );
    },

    async countUserEntriesSince(userId, since) {
      const { count, error } = await db.from("entries")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", since.toISOString());
      if (error) {
        throw new Error(`Не удалось посчитать вводы: ${error.message}`);
      }
      return count ?? 0;
    },

    async countLlmEntriesSince(since) {
      const { count, error } = await db.from("entries")
        .select("id", { count: "exact", head: true })
        .not("llm_model", "is", null)
        .gte("created_at", since.toISOString());
      if (error) {
        throw new Error(
          `Не удалось посчитать вызовы нейросети: ${error.message}`,
        );
      }
      return count ?? 0;
    },

    async saveRecords(userId, entryId, drafts: Draft[]) {
      const records: EntryRecords = {
        transactions: [],
        events: [],
        reminders: [],
      };
      try {
        const transactions = drafts.filter((d) => d.kind === "transaction");
        if (transactions.length > 0) {
          const rows = check(
            await db.from("transactions").insert(transactions.map((t) => ({
              user_id: userId,
              entry_id: entryId,
              kind: t.type,
              amount_minor: t.amountMinor,
              currency: t.currency,
              category_id: t.categoryId,
              note: t.note,
              occurred_at: t.occurredAt.toISOString(),
            }))).select(),
            "Не удалось сохранить операции",
          );
          records.transactions = rows.map(toTransaction);
        }

        const reminderRows: Row[] = [];
        for (const draft of drafts) {
          if (draft.kind === "event") {
            const row = check(
              await db.from("events").insert({
                user_id: userId,
                entry_id: entryId,
                title: draft.title,
                starts_at: draft.startsAt.toISOString(),
                ends_at: draft.endsAt?.toISOString() ?? null,
                all_day: draft.allDay,
              }).select().single(),
              "Не удалось сохранить событие",
            );
            records.events.push(toEvent(row));
            for (const r of draft.reminders) {
              reminderRows.push({
                user_id: userId,
                entry_id: entryId,
                event_id: row.id,
                text: draft.title,
                next_fire_at: r.fireAt.toISOString(),
              });
            }
          } else if (draft.kind === "reminder") {
            reminderRows.push({
              user_id: userId,
              entry_id: entryId,
              text: draft.text,
              next_fire_at: draft.nextFireAt.toISOString(),
              rrule: draft.rrule,
              dtstart_local: draft.dtstartLocal,
            });
          }
        }
        if (reminderRows.length > 0) {
          const rows = check(
            await db.from("reminders").insert(reminderRows).select(),
            "Не удалось сохранить напоминания",
          );
          records.reminders = rows.map(toReminder);
        }
        return records;
      } catch (err) {
        // Не оставляем половину фразы: то, что успело сохраниться, помечаем удалённым
        await store.undoEntry(entryId, new Date()).catch(() => {});
        throw err;
      }
    },

    async getEntryRecords(entryId) {
      const [transactions, events, reminders] = await Promise.all([
        db.from("transactions").select().eq("entry_id", entryId).order(
          "created_at",
        ),
        db.from("events").select().eq("entry_id", entryId).order("created_at"),
        db.from("reminders").select().eq("entry_id", entryId).order(
          "created_at",
        ),
      ]);
      return {
        transactions: check(transactions, "Не удалось загрузить операции").map(
          toTransaction,
        ),
        events: check(events, "Не удалось загрузить события").map(toEvent),
        reminders: check(reminders, "Не удалось загрузить напоминания").map(
          toReminder,
        ),
      };
    },

    async undoEntry(entryId, now) {
      const at = now.toISOString();
      const results = await Promise.all([
        db.from("transactions").update({ deleted_at: at }).eq(
          "entry_id",
          entryId,
        ).is("deleted_at", null),
        db.from("events").update({ deleted_at: at }).eq("entry_id", entryId).is(
          "deleted_at",
          null,
        ),
        db.from("reminders").update({ active: false }).eq("entry_id", entryId),
        db.from("entries").update({ status: "undone" }).eq("id", entryId),
      ]);
      for (const result of results) {
        checkWrite(result, "Не удалось отменить запись");
      }
    },

    async getTransaction(transactionId) {
      const row = checkMaybe(
        await db.from("transactions").select().eq("id", transactionId)
          .maybeSingle(),
        "Не удалось загрузить операцию",
      );
      return row ? toTransaction(row) : null;
    },

    async setTransactionCategory(transactionId, categoryId) {
      checkWrite(
        await db.from("transactions").update({ category_id: categoryId }).eq(
          "id",
          transactionId,
        ),
        "Не удалось сменить категорию",
      );
    },

    async transactionTotals(userId, kind, period, categoryId = null) {
      const rows = check(
        await db.rpc("transaction_totals", {
          p_user_id: userId,
          p_kind: kind,
          p_from: period.from.toISOString(),
          p_to: period.to.toISOString(),
          p_category_id: categoryId,
        }),
        "Не удалось посчитать суммы",
      ) as Row[];
      return rows.map((row): Totals => ({
        categoryId: row.category_id as string | null,
        currency: row.currency as string,
        totalMinor: Number(row.total_minor),
        count: Number(row.tx_count),
      }));
    },

    async listTransactions(userId, period) {
      const rows = check(
        await db.from("transactions").select()
          .eq("user_id", userId)
          .is("deleted_at", null)
          .gte("occurred_at", period.from.toISOString())
          .lt("occurred_at", period.to.toISOString())
          .order("occurred_at"),
        "Не удалось загрузить операции",
      );
      return rows.map(toTransaction);
    },

    async listEvents(userId, period) {
      const rows = check(
        await db.from("events").select()
          .eq("user_id", userId)
          .is("deleted_at", null)
          .gte("starts_at", period.from.toISOString())
          .lt("starts_at", period.to.toISOString())
          .order("starts_at"),
        "Не удалось загрузить события",
      );
      return rows.map(toEvent);
    },

    async listReminders(userId, period) {
      const rows = check(
        await db.from("reminders").select()
          .eq("user_id", userId)
          .eq("active", true)
          .gte("next_fire_at", period.from.toISOString())
          .lt("next_fire_at", period.to.toISOString())
          .order("next_fire_at"),
        "Не удалось загрузить напоминания",
      );
      return rows.map(toReminder);
    },
  };
  return store;
}
