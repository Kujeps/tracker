// Текст подтверждения: строка на запись, итоговые дата и время в поясе пользователя.
// «Записал: расход 520 ₽ · Кафе и рестораны · сегодня 15:51»
import { formatMoney } from "./money.ts";
import { describeRrule } from "./recurrence.ts";
import type { Category, EntryRecords } from "./store.ts";
import { callbackData, type Keyboard } from "./telegram.ts";
import { formatWhen } from "./time.ts";

export interface RenderContext {
  timezone: string;
  now: Date;
  categories: Category[];
}

// 60 → «за час», 1440 → «за день», 90 → «за 90 мин»
export function formatLead(minutes: number): string {
  if (minutes === 0) return "в момент начала";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "за день" : `за ${days} дн.`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "за час" : `за ${hours} ч`;
  }
  return `за ${minutes} мин`;
}

export function categoryName(
  categories: Category[],
  id: string | null,
): string {
  return categories.find((c) => c.id === id)?.name ?? "Без категории";
}

export function renderRecordLines(
  records: EntryRecords,
  ctx: RenderContext,
): string[] {
  const { timezone: tz, now } = ctx;
  const lines: string[] = [];
  for (const t of records.transactions) {
    lines.push([
      `${t.kind === "expense" ? "расход" : "доход"} ${
        formatMoney(t.amountMinor, t.currency)
      }`,
      categoryName(ctx.categories, t.categoryId),
      formatWhen(t.occurredAt, tz, now),
    ].join(" · "));
  }
  for (const e of records.events) {
    const parts = [
      `событие «${e.title}»`,
      formatWhen(e.startsAt, tz, now, { allDay: e.allDay }),
    ];
    const leads = records.reminders
      .filter((r) => r.eventId === e.id && r.nextFireAt)
      .map((r) =>
        Math.round((e.startsAt.getTime() - r.nextFireAt!.getTime()) / 60_000)
      );
    if (leads.length > 0) {
      parts.push(`напомню ${leads.map(formatLead).join(" и ")}`);
    }
    lines.push(parts.join(" · "));
  }
  for (const r of records.reminders) {
    if (r.eventId !== null || r.nextFireAt === null) continue;
    const parts = [`напоминание «${r.text}»`];
    if (r.rrule && r.dtstartLocal) {
      parts.push(describeRrule(r.rrule, r.dtstartLocal));
      parts.push(`ближайшее ${formatWhen(r.nextFireAt, tz, now)}`);
    } else {
      parts.push(formatWhen(r.nextFireAt, tz, now));
    }
    lines.push(parts.join(" · "));
  }
  return lines;
}

export function renderConfirmation(
  records: EntryRecords,
  ctx: RenderContext,
): string {
  const lines = renderRecordLines(records, ctx);
  if (lines.length === 1) return `Записал: ${lines[0]}`;
  return ["Записал:", ...lines.map((l) => `• ${l}`)].join("\n");
}

// «Отменить» всегда, «Категория» — если есть траты
export function confirmationKeyboard(
  entryId: string,
  records: EntryRecords,
): Keyboard {
  const row = [{ text: "Отменить", data: callbackData.undo(entryId) }];
  if (records.transactions.some((t) => t.kind === "expense")) {
    row.push({ text: "Категория", data: callbackData.category(entryId) });
  }
  return [row];
}
