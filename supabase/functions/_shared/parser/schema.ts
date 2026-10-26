// Схема ответа нейросети. Здесь только форма ответа: если она нарушена,
// модель ошиблась и получает повтор. Смысловые проверки (дата в прошлом,
// сумма слишком большая) — в normalize.ts, они ведут к уточнению.
import { z } from "zod";
import { toMinor } from "../money.ts";
import { normalizeRrule } from "../recurrence.ts";
import { parseLocalDateTime } from "../time.ts";

const localDateTime = z.string().refine(
  (v) => parseLocalDateTime(v)?.time != null,
  "нужны дата и время в формате YYYY-MM-DDTHH:MM",
);
const localDateOrDateTime = z.string().refine(
  (v) => parseLocalDateTime(v) !== null,
  "нужна дата YYYY-MM-DD или дата и время YYYY-MM-DDTHH:MM",
);
const localDate = z.string().refine(
  (v) => parseLocalDateTime(v)?.time === null,
  "нужна дата в формате YYYY-MM-DD",
);
const amount = z.number().positive().refine(
  (v) => toMinor(v) !== null,
  "сумма — число, не больше двух знаков после точки",
);
const currency = z.string().regex(
  /^[A-Z]{3}$/,
  "код валюты ISO 4217, например RUB",
).nullish().transform((v) => v ?? null);

// Необязательное поле: модель может его пропустить, считаем это null
const optionalString = z.string().nullish().transform((v) => v ?? null);

const money = {
  amount,
  currency,
  category: z.string().min(1),
  note: optionalString,
  occurred_at: localDateTime,
};

export const expenseItem = z.object({ type: z.literal("expense"), ...money });
export const incomeItem = z.object({ type: z.literal("income"), ...money });

export const eventItem = z.object({
  type: z.literal("event"),
  title: z.string().min(1),
  starts_at: localDateOrDateTime,
  ends_at: localDateOrDateTime.nullish().transform((v) => v ?? null),
  // Пропущено — решает код: без времени весь день, со временем за 60 минут
  all_day: z.boolean().optional(),
  remind_before_min: z.array(z.number().int().min(0).max(60 * 24 * 30)).max(5)
    .optional(),
});

export const reminderItem = z.object({
  type: z.literal("reminder"),
  text: z.string().min(1),
  first_at: localDateTime,
  // Слишком частый повтор — не ошибка модели, а просьба человека: её разбирает normalize.ts
  rrule: z.string().refine(
    (v) => {
      const rule = normalizeRrule(v);
      return rule.ok || rule.reason === "too_frequent";
    },
    "правило повтора по RFC 5545, например FREQ=MONTHLY;BYMONTHDAY=5;BYHOUR=10;BYMINUTE=0",
  ).nullish().transform((v) => v ?? null),
});

export const QUERY_METRICS = [
  "expense_sum",
  "income_sum",
  "balance",
  "events_list",
] as const;

export const queryItem = z.object({
  type: z.literal("query"),
  metric: z.enum(QUERY_METRICS),
  period_from: localDate,
  period_to: localDate,
  category: optionalString,
});

export const clarifyItem = z.object({
  type: z.literal("clarify"),
  question: z.string().min(1),
});

export const otherItem = z.object({ type: z.literal("other") });

export const parsedItem = z.discriminatedUnion("type", [
  expenseItem,
  incomeItem,
  eventItem,
  reminderItem,
  queryItem,
  clarifyItem,
  otherItem,
]);

export const parserResponse = z.object({
  items: z.array(parsedItem).min(1).max(20),
});

export type ParsedItem = z.infer<typeof parsedItem>;
export type ParserResponse = z.infer<typeof parserResponse>;

// Ограничения, которые не все провайдеры понимают в строгом режиме.
// Их всё равно проверяет zod после ответа.
const UNSUPPORTED_KEYWORDS = new Set([
  "$schema",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "minLength",
  "pattern",
]);

// Для structured output: строгий режим требует, чтобы у объектов
// были перечислены все поля и запрещены лишние, а варианты шли через anyOf.
function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    out[key === "oneOf" ? "anyOf" : key] = strictify(value);
  }
  if (out.type === "object" && out.properties) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as object);
  }
  return out;
}

export const PARSER_JSON_SCHEMA = strictify(
  z.toJSONSchema(parserResponse, { io: "input" }),
) as Record<string, unknown>;
