// Тексты и клавиатуры команд бота. Даты — в поясе пользователя, суммы считает SQL.
import { categoryName } from "../_shared/confirmation.ts";
import { HELP_EXAMPLES } from "../_shared/ingest.ts";
import {
  currencySign,
  formatMoney,
  SUPPORTED_CURRENCIES,
} from "../_shared/money.ts";
import { countOf, formatSums, sumByCurrency } from "../_shared/query.ts";
import type { Category, Store, Transaction, User } from "../_shared/store.ts";
import { callbackData, type Keyboard } from "../_shared/telegram.ts";
import {
  addDaysToDate,
  formatDayHeader,
  formatTime,
  localDatesPeriod,
  monthName,
  monthNamePrepositional,
  MONTHS_GENITIVE,
  monthToDatePeriods,
  todayPeriod,
  toLocalDate,
} from "../_shared/time.ts";
import { RUSSIAN_TIMEZONES, timeZoneLabel } from "../_shared/timezones.ts";

export const START_TEXT = [
  "Привет! Я Трекер: записываю траты, доходы, встречи и напоминания из одной фразы. Например: «потратил 520 в кафе».",
  "",
  "Сначала выбери часовой пояс — по нему я считаю даты и время:",
].join("\n");

export const ONBOARDING_HINT =
  "Готово! Пиши как другу: «кофе 250», «завтра в 15 созвон», «напомни 5 числа оплатить интернет». Больше примеров — /help.";

export const HELP_TEXT = [
  HELP_EXAMPLES,
  "",
  "Под каждой записью есть кнопка «Отменить», под тратой — «Категория».",
  "",
  "/today — план и траты на сегодня",
  "/week — события на 7 дней вперёд",
  "/stats — траты за месяц по категориям",
  "/settings — часовой пояс, сводка, валюта",
].join("\n");

export const TZ_PROMPT =
  "Напиши часовой пояс ответом на это сообщение: название вроде Europe/Berlin или смещение от UTC, например UTC+4.";

export const TZ_INVALID =
  "Не нашёл такой часовой пояс. Напиши название вроде Europe/Berlin или смещение, например UTC+4.";

// Время утренней сводки на выбор
export const DIGEST_TIMES = [
  "06:00",
  "07:00",
  "08:00",
  "09:00",
  "10:00",
  "11:00",
];

// Кнопки поясов. fromSettings — после выбора вернуться в /settings, иначе это онбординг.
export function timezoneKeyboard(fromSettings: boolean): Keyboard {
  const prefix = fromSettings ? "stz:" : "tz:";
  const buttons = [
    ...RUSSIAN_TIMEZONES.map((z) => ({ text: z.city, data: prefix + z.tz })),
    { text: "Другой", data: prefix + "other" },
  ];
  const rows: Keyboard = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  if (fromSettings) rows.push([{ text: "← Назад", data: "st:menu" }]);
  return rows;
}

// --- /today ---

export async function todayView(
  store: Store,
  user: User,
  now: Date,
): Promise<string> {
  const tz = user.timezone;
  const period = todayPeriod(now, tz);
  const [events, reminders, transactions, totals, categories] = await Promise
    .all([
      store.listEvents(user.id, period),
      store.listReminders(user.id, period),
      store.listTransactions(user.id, period),
      store.transactionTotals(user.id, "expense", period),
      store.listCategories(user.id),
    ]);
  const expenses = transactions.filter((t) => t.kind === "expense");
  const ownReminders = reminders.filter((r) => r.eventId === null);

  const lines = [`Сегодня, ${formatDayHeader(now, tz)}`];
  if (
    events.length === 0 && ownReminders.length === 0 && expenses.length === 0
  ) {
    lines.push(
      "",
      "Пока пусто. Напиши, например, «кофе 250» или «завтра в 15 созвон».",
    );
    return lines.join("\n");
  }
  if (events.length > 0) {
    // События на весь день сначала
    const sorted = [...events].sort((a, b) =>
      Number(b.allDay) - Number(a.allDay)
    );
    lines.push("", "План:");
    for (const e of sorted) {
      lines.push(
        `• ${e.allDay ? "весь день" : formatTime(e.startsAt, tz)} — ${e.title}`,
      );
    }
  }
  if (ownReminders.length > 0) {
    lines.push("", "Напоминания:");
    for (const r of ownReminders) {
      lines.push(`• ${formatTime(r.nextFireAt!, tz)} — ${r.text}`);
    }
  }
  if (expenses.length > 0) {
    lines.push("", "Траты:");
    for (const t of expenses) {
      lines.push(`• ${transactionLine(t, categories, tz)}`);
    }
    lines.push(`Итого: ${formatSums(totals, user.currency)}`);
  }
  return lines.join("\n");
}

function transactionLine(
  t: Transaction,
  categories: Category[],
  tz: string,
): string {
  const parts = [
    formatTime(t.occurredAt, tz),
    formatMoney(t.amountMinor, t.currency),
    categoryName(categories, t.categoryId),
  ];
  if (t.note) parts.push(t.note);
  return parts.join(" · ");
}

// --- /week ---

export async function weekView(
  store: Store,
  user: User,
  now: Date,
): Promise<string> {
  const tz = user.timezone;
  const today = toLocalDate(now, tz);
  const events = await store.listEvents(
    user.id,
    localDatesPeriod(today, addDaysToDate(today, 6), tz),
  );
  if (events.length === 0) {
    return "На 7 дней вперёд планов нет. Напиши, например, «в пятницу стоматолог в 10».";
  }
  const lines = ["План на 7 дней:"];
  let currentDay = "";
  for (const e of events) {
    const day = toLocalDate(e.startsAt, tz);
    if (day !== currentDay) {
      currentDay = day;
      const header = day === today
        ? `Сегодня, ${formatDayHeader(e.startsAt, tz)}`
        : formatDayHeader(e.startsAt, tz);
      lines.push("", header);
    }
    lines.push(
      `• ${e.allDay ? "весь день" : formatTime(e.startsAt, tz)} — ${e.title}`,
    );
  }
  return lines.join("\n");
}

// --- /stats ---

export async function statsView(
  store: Store,
  user: User,
  now: Date,
): Promise<string> {
  const tz = user.timezone;
  const { current, previous, day, previousDay } = monthToDatePeriods(now, tz);
  const [totals, prevTotals, categories] = await Promise.all([
    store.transactionTotals(user.id, "expense", current),
    store.transactionTotals(user.id, "expense", previous),
    store.listCategories(user.id),
  ]);
  const month = monthName(now, tz);
  const prevMonthIndex = Number(toLocalDate(previous.from, tz).slice(5, 7));
  const prevRange = `1–${previousDay} ${MONTHS_GENITIVE[prevMonthIndex - 1]}`;
  const lines: string[] = [];

  if (countOf(totals) === 0) {
    lines.push(
      `Трат в ${
        monthNamePrepositional(Number(toLocalDate(now, tz).slice(5, 7)))
      } пока нет.`,
    );
  } else {
    lines.push(`Траты за ${month}, 1–${day} число:`, "");
    // Категории по убыванию суммы в основной валюте
    const byCategory = new Map<string | null, typeof totals>();
    for (const t of totals) {
      byCategory.set(t.categoryId, [
        ...(byCategory.get(t.categoryId) ?? []),
        t,
      ]);
    }
    const rows = [...byCategory.entries()].map(([categoryId, rows]) => ({
      name: categoryName(categories, categoryId),
      main: sumByCurrency(rows, user.currency).get(user.currency) ?? 0,
      text: formatSums(rows, user.currency),
    })).sort((a, b) => b.main - a.main || a.name.localeCompare(b.name));
    for (const r of rows) lines.push(`• ${r.name} — ${r.text}`);
    lines.push("", `Итого: ${formatSums(totals, user.currency)}`);
  }

  const cur = sumByCurrency(totals, user.currency).get(user.currency) ?? 0;
  const prev = sumByCurrency(prevTotals, user.currency).get(user.currency) ?? 0;
  if (prev > 0) {
    const diff = Math.round(((cur - prev) / prev) * 100);
    const comparison = diff === 0
      ? "столько же, сколько"
      : diff > 0
      ? `на ${diff}% больше, чем`
      : `на ${-diff}% меньше, чем`;
    lines.push(
      `Это ${comparison} за ${prevRange}: ${formatMoney(prev, user.currency)}.`,
    );
  } else {
    lines.push(`За ${prevRange} трат не было.`);
  }
  return lines.join("\n");
}

// --- /settings ---

export function settingsView(
  user: User,
  now: Date,
): { text: string; keyboard: Keyboard } {
  const text = [
    "Настройки",
    "",
    `Часовой пояс: ${timeZoneLabel(user.timezone, now)}`,
    `Утренняя сводка: ${
      user.digestEnabled ? `включена, в ${user.digestTime}` : "выключена"
    }`,
    `Валюта: ${user.currency} (${currencySign(user.currency)})`,
  ].join("\n");
  const keyboard: Keyboard = [
    [{ text: "Часовой пояс", data: "st:tz" }, {
      text: "Валюта",
      data: "st:cur",
    }],
    [
      {
        text: user.digestEnabled ? "Выключить сводку" : "Включить сводку",
        data: "st:dg",
      },
      { text: "Время сводки", data: "st:dt" },
    ],
  ];
  return { text, keyboard };
}

export function currencyKeyboard(current: string): Keyboard {
  return [
    SUPPORTED_CURRENCIES.map((c) => ({
      text: `${c === current ? "✓ " : ""}${c} ${currencySign(c)}`,
      data: `cur:${c}`,
    })),
    [{ text: "← Назад", data: "st:menu" }],
  ];
}

export function digestTimeKeyboard(current: string): Keyboard {
  const buttons = DIGEST_TIMES.map((t) => ({
    text: `${t === current ? "✓ " : ""}${t}`,
    data: `dt:${t}`,
  }));
  return [buttons.slice(0, 3), buttons.slice(3), [{
    text: "← Назад",
    data: "st:menu",
  }]];
}

// --- кнопка «Категория» ---

// Выбор траты, если в фразе их несколько
export function pickTransactionKeyboard(
  entryId: string,
  expenses: Transaction[],
  categories: Category[],
): Keyboard {
  return [
    ...expenses.map((t) => [{
      text: `${formatMoney(t.amountMinor, t.currency)} · ${
        categoryName(categories, t.categoryId)
      }`,
      data: callbackData.pickTransaction(t.id),
    }]),
    [{ text: "← Назад", data: callbackData.back(entryId) }],
  ];
}

// Категории расходов по две в ряд, текущая отмечена галочкой
export function categoryKeyboard(
  entryId: string,
  transaction: Transaction,
  categories: Category[],
): Keyboard {
  const buttons = categories
    .filter((c) => c.kind === "expense")
    .map((c) => ({
      text: `${c.id === transaction.categoryId ? "✓ " : ""}${c.name}`,
      data: callbackData.setCategory(transaction.id, c.id),
    }));
  const rows: Keyboard = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  rows.push([{ text: "← Назад", data: callbackData.back(entryId) }]);
  return rows;
}
