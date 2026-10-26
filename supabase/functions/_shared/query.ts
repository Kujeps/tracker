// Ответы на вопросы вроде «сколько я потратил на кафе в октябре».
// Модель только назвала метрику и период, суммы считает SQL (transaction_totals).
import { formatMoney } from "./money.ts";
import type { QueryDraft } from "./parser/normalize.ts";
import { plural } from "./plural.ts";
import type { Store, Totals, User } from "./store.ts";
import {
  addDaysToDate,
  formatWhen,
  localDatesPeriod,
  monthNamePrepositional,
  MONTHS_GENITIVE,
  toLocalDate,
} from "./time.ts";

const MAX_EVENTS_IN_ANSWER = 20;

const TRANSACTIONS = ["трата", "траты", "трат"] as const;
const INCOMES = ["поступление", "поступления", "поступлений"] as const;

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// «26 октября», с годом, если он не текущий
function dayLabel(date: string, currentYear: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS_GENITIVE[m - 1]}${y === currentYear ? "" : ` ${y}`}`;
}

// Период словами для начала ответа: «В октябре», «Сегодня», «С 1 по 15 октября»
export function periodLabel(
  fromDate: string,
  toDate: string,
  today: string,
): string {
  const currentYear = Number(today.slice(0, 4));
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  if (fromDate === toDate) {
    if (fromDate === today) return "Сегодня";
    if (fromDate === addDaysToDate(today, -1)) return "Вчера";
    return dayLabel(fromDate, currentYear);
  }
  if (fy === ty && fm === tm && fd === 1 && td === lastDayOfMonth(ty, tm)) {
    return `В ${monthNamePrepositional(fm)}${
      fy === currentYear ? "" : ` ${fy}`
    }`;
  }
  if (fy === ty && fm === tm) {
    return `С ${fd} по ${dayLabel(toDate, currentYear)}`;
  }
  return `С ${dayLabel(fromDate, currentYear)} по ${
    dayLabel(toDate, currentYear)
  }`;
}

// Суммы по валютам: валюта пользователя первой. Курсы не пересчитываем.
export function sumByCurrency(
  totals: Totals[],
  mainCurrency: string,
): Map<string, number> {
  const sums = new Map<string, number>([[mainCurrency, 0]]);
  for (const t of totals) {
    sums.set(t.currency, (sums.get(t.currency) ?? 0) + t.totalMinor);
  }
  for (const [currency, sum] of sums) {
    if (sum === 0 && currency !== mainCurrency) sums.delete(currency);
  }
  return sums;
}

export function formatSums(totals: Totals[], mainCurrency: string): string {
  const parts = [...sumByCurrency(totals, mainCurrency)]
    .filter(([currency, sum]) => sum > 0 || currency === mainCurrency)
    .map(([currency, sum]) => formatMoney(sum, currency));
  return parts.join(" и ");
}

export function countOf(totals: Totals[]): number {
  return totals.reduce((n, t) => n + t.count, 0);
}

export async function answerQuery(
  store: Store,
  user: User,
  query: QueryDraft,
  now: Date,
): Promise<string> {
  const tz = user.timezone;
  const label = periodLabel(query.fromDate, query.toDate, toLocalDate(now, tz));
  const period = localDatesPeriod(query.fromDate, query.toDate, tz);

  switch (query.metric) {
    case "expense_sum": {
      const totals = await store.transactionTotals(
        user.id,
        "expense",
        period,
        query.categoryId,
      );
      const count = countOf(totals);
      const what = query.categoryName ? ` на «${query.categoryName}»` : "";
      if (count === 0) return `${label}${what} трат нет.`;
      return `${label}${what || " расходы"}: ${
        formatSums(totals, user.currency)
      }, ${count} ${plural(count, TRANSACTIONS)}`;
    }
    case "income_sum": {
      const totals = await store.transactionTotals(
        user.id,
        "income",
        period,
        query.categoryId,
      );
      const count = countOf(totals);
      const what = query.categoryName ? ` «${query.categoryName}»` : "";
      if (count === 0) return `${label} доходов${what} нет.`;
      return `${label} доходы${what}: ${
        formatSums(totals, user.currency)
      }, ${count} ${plural(count, INCOMES)}`;
    }
    case "balance": {
      const [income, expense] = await Promise.all([
        store.transactionTotals(user.id, "income", period),
        store.transactionTotals(user.id, "expense", period),
      ]);
      if (countOf(income) + countOf(expense) === 0) {
        return `${label} операций нет.`;
      }
      const incomeSums = sumByCurrency(income, user.currency);
      const expenseSums = sumByCurrency(expense, user.currency);
      const currencies = [
        ...new Set([...incomeSums.keys(), ...expenseSums.keys()]),
      ];
      const lines = currencies.map((currency) => {
        const inc = incomeSums.get(currency) ?? 0;
        const exp = expenseSums.get(currency) ?? 0;
        const diff = inc - exp;
        return `доходы ${formatMoney(inc, currency)}, расходы ${
          formatMoney(exp, currency)
        }, разница ${diff > 0 ? "+" : ""}${formatMoney(diff, currency)}`;
      });
      return lines.length === 1
        ? `${label}: ${lines[0]}`
        : [`${label}:`, ...lines.map((l) => `• ${l}`)].join("\n");
    }
    case "events_list": {
      const events = await store.listEvents(user.id, period);
      if (events.length === 0) return `${label} в планах пусто.`;
      const lines = events.slice(0, MAX_EVENTS_IN_ANSWER).map((e) =>
        `• ${
          formatWhen(e.startsAt, tz, now, { allDay: e.allDay })
        } — ${e.title}`
      );
      if (events.length > MAX_EVENTS_IN_ANSWER) {
        lines.push(`…и ещё ${events.length - MAX_EVENTS_IN_ANSWER}`);
      }
      return [`${label} в планах:`, ...lines].join("\n");
    }
  }
}
