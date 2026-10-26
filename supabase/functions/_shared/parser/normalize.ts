// Ответ нейросети → черновики записей. Здесь код, а не модель, считает
// копейки, моменты в UTC и ближайшее срабатывание повтора, и проверяет смысл:
// сумма в разумных пределах, трата не в будущем, встреча не в прошлом.
// Нарушение смысла — вопрос пользователю (clarify), а не ошибка модели.
import { FALLBACK_CATEGORY } from "../categories.ts";
import { MAX_AMOUNT_MINOR, toMinor } from "../money.ts";
import { nextOccurrence, normalizeRrule } from "../recurrence.ts";
import {
  fromLocal,
  localDateStart,
  parseLocalDateTime,
  toLocalDate,
} from "../time.ts";
import type { ParsedItem } from "./schema.ts";

// Трата может быть «завтра утром» по ошибке часов, но не позже суток вперёд
const MAX_FUTURE_EXPENSE_MS = 24 * 60 * 60 * 1000;
// Напоминание к событию со временем, если человек не сказал иначе
const DEFAULT_REMIND_BEFORE_MIN = 60;
// Запас на секунды, пока фраза шла до нас
const PAST_TOLERANCE_MS = 60 * 1000;

export interface CategoryRef {
  id: string;
  kind: "expense" | "income";
  name: string;
}

export interface NormalizeContext {
  now: Date;
  timezone: string;
  currency: string;
  categories: CategoryRef[];
}

export interface TransactionDraft {
  kind: "transaction";
  type: "expense" | "income";
  amountMinor: number;
  currency: string;
  categoryId: string | null;
  categoryName: string;
  note: string | null;
  occurredAt: Date;
}

export interface EventDraft {
  kind: "event";
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  // Напоминания к событию: минуты до начала и момент срабатывания
  reminders: { beforeMin: number; fireAt: Date }[];
}

export interface ReminderDraft {
  kind: "reminder";
  text: string;
  nextFireAt: Date;
  rrule: string | null;
  dtstartLocal: string | null;
}

export interface QueryDraft {
  kind: "query";
  metric: "expense_sum" | "income_sum" | "balance" | "events_list";
  fromDate: string; // местная дата, включительно
  toDate: string; // местная дата, включительно
  categoryId: string | null;
  categoryName: string | null;
}

export type Draft = TransactionDraft | EventDraft | ReminderDraft | QueryDraft;

export type Normalized =
  | { kind: "drafts"; drafts: Draft[] }
  | { kind: "clarify"; question: string }
  | { kind: "other" };

class NeedsClarification {
  constructor(readonly question: string) {}
}

function findCategory(
  ctx: NormalizeContext,
  kind: "expense" | "income",
  name: string | null,
): CategoryRef | null {
  const own = ctx.categories.filter((c) => c.kind === kind);
  if (name !== null) {
    const wanted = name.trim().toLowerCase();
    const found = own.find((c) => c.name.toLowerCase() === wanted);
    if (found) return found;
  }
  return null;
}

// Категория траты или дохода: только из списка, иначе «Другое»
function categoryOrFallback(
  ctx: NormalizeContext,
  kind: "expense" | "income",
  name: string,
): { id: string | null; name: string } {
  const found = findCategory(ctx, kind, name) ??
    findCategory(ctx, kind, FALLBACK_CATEGORY);
  return found
    ? { id: found.id, name: found.name }
    : { id: null, name: FALLBACK_CATEGORY };
}

// Местные дата и время из ответа модели → момент в UTC
function localMoment(value: string, tz: string): Date {
  const parsed = parseLocalDateTime(value)!;
  return fromLocal(`${parsed.date}T${parsed.time ?? "00:00"}:00`, tz);
}

function normalizeItem(item: ParsedItem, ctx: NormalizeContext): Draft | null {
  const { now, timezone: tz } = ctx;
  switch (item.type) {
    case "expense":
    case "income": {
      const minor = toMinor(item.amount);
      if (minor === null || minor === 0 || minor >= MAX_AMOUNT_MINOR) {
        throw new NeedsClarification(
          "Какая сумма? Не получилось её разобрать.",
        );
      }
      const occurredAt = localMoment(item.occurred_at, tz);
      if (occurredAt.getTime() > now.getTime() + MAX_FUTURE_EXPENSE_MS) {
        throw new NeedsClarification(
          item.type === "expense"
            ? "Когда была трата? Дата получилась в будущем."
            : "Когда пришли деньги? Дата получилась в будущем.",
        );
      }
      const category = categoryOrFallback(ctx, item.type, item.category);
      return {
        kind: "transaction",
        type: item.type,
        amountMinor: minor,
        currency: item.currency ?? ctx.currency,
        categoryId: category.id,
        categoryName: category.name,
        note: item.note?.trim() || null,
        occurredAt,
      };
    }

    case "event": {
      const start = parseLocalDateTime(item.starts_at)!;
      const allDay = item.all_day === true || start.time === null;
      if (allDay) {
        if (start.date < toLocalDate(now, tz)) {
          throw new NeedsClarification(
            "Дата события получилась в прошлом. Когда оно?",
          );
        }
        return {
          kind: "event",
          title: item.title.trim(),
          startsAt: localDateStart(start.date, tz),
          endsAt: null,
          allDay: true,
          reminders: [],
        };
      }
      const startsAt = localMoment(item.starts_at, tz);
      if (startsAt.getTime() < now.getTime() - PAST_TOLERANCE_MS) {
        throw new NeedsClarification(
          "Встреча получилась в прошлом. Когда она?",
        );
      }
      let endsAt = item.ends_at ? localMoment(item.ends_at, tz) : null;
      if (endsAt && endsAt <= startsAt) endsAt = null;
      // Напоминание, которое уже опоздало, не создаём
      const reminders = [
        ...new Set(item.remind_before_min ?? [DEFAULT_REMIND_BEFORE_MIN]),
      ]
        .sort((a, b) => b - a)
        .map((beforeMin) => ({
          beforeMin,
          fireAt: new Date(startsAt.getTime() - beforeMin * 60_000),
        }))
        .filter((r) => r.fireAt.getTime() > now.getTime());
      return {
        kind: "event",
        title: item.title.trim(),
        startsAt,
        endsAt,
        allDay: false,
        reminders,
      };
    }

    case "reminder": {
      const first = parseLocalDateTime(item.first_at)!;
      const dtstartLocal = `${first.date}T${first.time}:00`;
      if (item.rrule === null) {
        const fireAt = fromLocal(dtstartLocal, tz);
        if (fireAt.getTime() < now.getTime() - PAST_TOLERANCE_MS) {
          throw new NeedsClarification(
            "Время напоминания получилось в прошлом. Когда напомнить?",
          );
        }
        return {
          kind: "reminder",
          text: item.text.trim(),
          nextFireAt: fireAt,
          rrule: null,
          dtstartLocal: null,
        };
      }
      const rule = normalizeRrule(item.rrule);
      if (!rule.ok) {
        throw new NeedsClarification(
          "Могу повторять напоминание не чаще раза в день. Как часто напоминать?",
        );
      }
      // Ближайшее срабатывание считает код, а не модель
      const next = nextOccurrence(rule.rule, dtstartLocal, tz, now, true);
      if (next === null) {
        throw new NeedsClarification(
          "По такому правилу напоминание не сработает ни разу. Когда напоминать?",
        );
      }
      return {
        kind: "reminder",
        text: item.text.trim(),
        nextFireAt: next,
        rrule: rule.rule,
        dtstartLocal,
      };
    }

    case "query": {
      let fromDate = item.period_from;
      let toDate = item.period_to;
      if (fromDate > toDate) [fromDate, toDate] = [toDate, fromDate];
      const kind = item.metric === "expense_sum"
        ? "expense"
        : item.metric === "income_sum"
        ? "income"
        : null;
      const category = kind ? findCategory(ctx, kind, item.category) : null;
      return {
        kind: "query",
        metric: item.metric,
        fromDate,
        toDate,
        categoryId: category?.id ?? null,
        categoryName: category?.name ?? null,
      };
    }

    case "clarify":
      throw new NeedsClarification(item.question.trim());

    case "other":
      return null;
  }
}

export function normalizeItems(
  items: ParsedItem[],
  ctx: NormalizeContext,
): Normalized {
  // Уточнение важнее всего остального: по правилам ничего не сохраняем
  const clarify = items.find((i) => i.type === "clarify");
  if (clarify) return { kind: "clarify", question: clarify.question.trim() };
  try {
    const drafts = items
      .map((item) => normalizeItem(item, ctx))
      .filter((d): d is Draft => d !== null);
    return drafts.length > 0 ? { kind: "drafts", drafts } : { kind: "other" };
  } catch (err) {
    if (err instanceof NeedsClarification) {
      return { kind: "clarify", question: err.question };
    }
    throw err;
  }
}
