// Повторы по RFC 5545 (rrule). Правило считается в «плавающем» местном времени
// пользователя: 10:00 остаётся 10:00 и после перевода часов. В UTC переводим в конце.
import rrulePkg from "rrule";
import { fromLocal, MONTHS_GENITIVE, toLocalIso } from "./time.ts";

// Пакет rrule в Deno грузится как CommonJS: именованные экспорты лежат в default
const { RRule } = rrulePkg;

// Чаще раза в день не повторяем: это уже не напоминание, а спам
const ALLOWED_FREQ = new Set([
  RRule.DAILY,
  RRule.WEEKLY,
  RRule.MONTHLY,
  RRule.YEARLY,
]);
const ALLOWED_KEYS = new Set([
  "FREQ",
  "INTERVAL",
  "COUNT",
  "UNTIL",
  "BYDAY",
  "BYMONTHDAY",
  "BYMONTH",
  "BYHOUR",
  "BYMINUTE",
  "BYSETPOS",
  "WKST",
]);

export type RruleCheck =
  | { ok: true; rule: string }
  | { ok: false; reason: "invalid" | "too_frequent" };

// Проверка и нормализация правила от нейросети: «RRULE:freq=monthly;…» → «FREQ=MONTHLY;…»
export function normalizeRrule(raw: string): RruleCheck {
  const rule = raw.trim().replace(/^RRULE:/i, "").toUpperCase();
  if (rule.length === 0 || rule.length > 200) {
    return { ok: false, reason: "invalid" };
  }
  const keys = rule.split(";").map((part) => part.split("=")[0]);
  if (keys.some((key) => !ALLOWED_KEYS.has(key))) {
    return { ok: false, reason: "invalid" };
  }
  let options;
  try {
    options = RRule.parseString(rule);
    // Конструктор проверяет значения, которые parseString пропускает
    new RRule(options);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (options.freq === undefined) {
    return { ok: false, reason: "invalid" };
  }
  if (!ALLOWED_FREQ.has(options.freq)) {
    return { ok: false, reason: "too_frequent" };
  }
  return { ok: true, rule };
}

// Местное время без пояса как будто оно в UTC: так rrule не трогает часовые пояса
function floating(localIso: string): Date {
  return new Date(localIso.slice(0, 19) + "Z");
}

// Следующее срабатывание строго после момента after (или в сам момент, если inclusive).
// dtstartLocal — отсчёт повтора в поясе пользователя, «2026-11-05T10:00:00».
// null — повторов больше не будет.
export function nextOccurrence(
  rule: string,
  dtstartLocal: string,
  tz: string,
  after: Date,
  inclusive = false,
): Date | null {
  const rrule = new RRule({
    ...RRule.parseString(rule),
    dtstart: floating(dtstartLocal),
  });
  const next = rrule.after(floating(toLocalIso(after, tz)), inclusive);
  return next ? fromLocal(next.toISOString().slice(0, 19), tz) : null;
}

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

function joinRu(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + " и " + items[items.length - 1];
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function weekdayIndex(day: unknown): number {
  if (typeof day === "number") return day;
  return (day as { weekday: number }).weekday;
}

// Правило словами: «каждый месяц 5 и 10 числа в 10:00».
// Понимает частые случаи, для остальных — «по расписанию».
export function describeRrule(rule: string, dtstartLocal: string): string {
  const o = RRule.parseString(rule);
  const interval = o.interval ?? 1;
  const hour = asArray(o.byhour)[0] ?? Number(dtstartLocal.slice(11, 13));
  const minute = asArray(o.byminute)[0] ?? Number(dtstartLocal.slice(14, 16));
  const time = ` в ${String(hour).padStart(2, "0")}:${
    String(minute).padStart(2, "0")
  }`;
  const monthDays = asArray(o.bymonthday);
  const months = asArray(o.bymonth);
  const weekdays = asArray(o.byweekday).map(weekdayIndex);

  if (
    o.byweekday &&
    asArray(o.byweekday).some((d) =>
      typeof d === "object" && (d as { n?: number }).n
    )
  ) {
    return "по расписанию" + time;
  }
  if (o.bysetpos) return "по расписанию" + time;

  switch (o.freq) {
    case RRule.DAILY:
      if (interval === 1) return "каждый день" + time;
      return `раз в ${interval} дн.` + time;
    case RRule.WEEKLY: {
      const prefix = interval === 1
        ? "каждую неделю"
        : `раз в ${interval} нед.`;
      if (weekdays.length === 0) return prefix + time;
      const days = joinRu(weekdays.map((d) => WEEKDAYS[d]));
      return (interval === 1 ? `каждый ${days}` : `${prefix}: ${days}`) + time;
    }
    case RRule.MONTHLY: {
      const prefix = interval === 1 ? "каждый месяц" : `раз в ${interval} мес.`;
      if (monthDays.length === 0) {
        return `${prefix} ${Number(dtstartLocal.slice(8, 10))} числа` + time;
      }
      const days = monthDays.map((d) =>
        d === -1 ? "в последний день" : String(d)
      );
      if (days.length === 1 && monthDays[0] === -1) {
        return `${prefix} в последний день` + time;
      }
      if (monthDays.some((d) => d < 0)) return "по расписанию" + time;
      return `${prefix} ${joinRu(days)} числа` + time;
    }
    case RRule.YEARLY: {
      const month = months[0] ?? Number(dtstartLocal.slice(5, 7));
      const day = monthDays[0] ?? Number(dtstartLocal.slice(8, 10));
      if (months.length > 1 || monthDays.length > 1) {
        return "по расписанию" + time;
      }
      return `каждый год ${day} ${MONTHS_GENITIVE[month - 1]}` + time;
    }
    default:
      return "по расписанию" + time;
  }
}
