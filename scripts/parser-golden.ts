// Эталонный прогон парсера через настоящую нейросеть. Запускать вручную
// перед сменой промпта или модели: deno task golden
//   --spec       только 11 фраз из таблицы в SPEC.md
//   --only=3,7   только фразы с этими номерами
//   --delay=3000 пауза между фразами, мс (бесплатная модель не любит частых запросов)
// Момент проверки: 2026-10-26 15:51, понедельник, Europe/Samara.
import { parseArgs } from "@std/cli/parse-args";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
} from "../supabase/functions/_shared/categories.ts";
import { requireEnv } from "../supabase/functions/_shared/env.ts";
import { createLlmProvider } from "../supabase/functions/_shared/llm/index.ts";
import {
  type Draft,
  type Normalized,
  normalizeItems,
} from "../supabase/functions/_shared/parser/normalize.ts";
import { parsePhrase } from "../supabase/functions/_shared/parser/parse.ts";
import { nextOccurrence } from "../supabase/functions/_shared/recurrence.ts";
import { toLocalIso } from "../supabase/functions/_shared/time.ts";

const NOW = new Date("2026-10-26T11:51:00Z");
const TZ = "Europe/Samara";

type ExpectItem =
  | { t: "expense" | "income"; amount: number; category?: string; at?: string }
  | { t: "event"; at: string; allDay?: boolean; remind?: number[] }
  | { t: "reminder"; at: string; then?: string; repeat?: boolean }
  | {
    t: "query";
    metric: string;
    from: string;
    to: string;
    category?: string | null;
  };

type Expect =
  | { kind: "drafts"; items: ExpectItem[] }
  | { kind: "clarify" }
  | { kind: "other" };

interface Golden {
  phrase: string;
  spec?: boolean; // фраза из таблицы в SPEC.md: должна проходить всегда
  expect: Expect;
}

const drafts = (...items: ExpectItem[]): Expect => ({ kind: "drafts", items });
const exp = (amount: number, category?: string, at?: string): ExpectItem => ({
  t: "expense",
  amount,
  category,
  at,
});

// Даты в ожиданиях — местные: «2026-10-26 15:51» или «2026-10-25» (только день)
const GOLDEN: Golden[] = [
  // --- таблица из SPEC.md ---
  {
    phrase: "потратил 520 руб в кафе",
    spec: true,
    expect: drafts(exp(520, "Кафе и рестораны", "2026-10-26 15:51")),
  },
  {
    phrase: "такси 340 и обед 450",
    spec: true,
    expect: drafts(exp(340, "Такси"), exp(450, "Кафе и рестораны")),
  },
  {
    phrase: "вчера купил продукты на 2,3к",
    spec: true,
    expect: drafts(exp(2300, "Продукты", "2026-10-25")),
  },
  {
    phrase: "пришла зарплата 85000",
    spec: true,
    expect: drafts({ t: "income", amount: 85000, category: "Зарплата" }),
  },
  {
    phrase: "26 ноября встреча с Вадимом в 7 вечера",
    spec: true,
    expect: drafts({ t: "event", at: "2026-11-26 19:00", remind: [60] }),
  },
  {
    phrase: "в пятницу стоматолог в 10",
    spec: true,
    expect: drafts({ t: "event", at: "2026-10-30 10:00" }),
  },
  {
    phrase: "напомни каждый месяц 5 и 10 числа оплатить кредит",
    spec: true,
    expect: drafts({
      t: "reminder",
      at: "2026-11-05 10:00",
      then: "2026-11-10 10:00",
      repeat: true,
    }),
  },
  {
    phrase: "напомни через 2 часа позвонить маме",
    spec: true,
    expect: drafts({ t: "reminder", at: "2026-10-26 17:51", repeat: false }),
  },
  {
    phrase: "сколько я потратил на кафе в октябре",
    spec: true,
    expect: drafts({
      t: "query",
      metric: "expense_sum",
      from: "2026-10-01",
      to: "2026-10-31",
      category: "Кафе и рестораны",
    }),
  },
  { phrase: "купил кроссовки", spec: true, expect: { kind: "clarify" } },
  { phrase: "привет", spec: true, expect: { kind: "other" } },

  // --- суммы и категории ---
  { phrase: "кофе 250", expect: drafts(exp(250, "Кафе и рестораны")) },
  { phrase: "5к на подарок маме", expect: drafts(exp(5000, "Подарки")) },
  { phrase: "полторы тысячи на такси", expect: drafts(exp(1500, "Такси")) },
  { phrase: "отдал косарь за стрижку", expect: drafts(exp(1000, "Красота")) },
  { phrase: "пятихатка на бензин", expect: drafts(exp(500, "Транспорт")) },
  {
    phrase: "заплатил за интернет 650 ₽",
    expect: drafts(exp(650, "Связь и интернет")),
  },
  { phrase: "купил корм коту 99,90", expect: drafts(exp(99.9, "Животные")) },
  {
    phrase: "подписка на музыку 299",
    expect: drafts(exp(299, "Подписки")),
  },
  { phrase: "аптека 1240", expect: drafts(exp(1240, "Здоровье")) },
  {
    phrase: "кэшбэк 312 рублей",
    expect: drafts({ t: "income", amount: 312, category: "Кэшбэк" }),
  },
  {
    phrase: "вернули долг 3000",
    expect: drafts({ t: "income", amount: 3000 }),
  },
  {
    phrase: "в субботу купил билеты в кино на 1200",
    expect: drafts(exp(1200, "Развлечения", "2026-10-24")),
  },
  {
    phrase: "обед 450 и такси 200, а ещё завтра в 10 планёрка",
    expect: drafts(
      exp(450, "Кафе и рестораны"),
      exp(200, "Такси"),
      { t: "event", at: "2026-10-27 10:00" },
    ),
  },

  // --- планы и напоминания ---
  {
    phrase: "завтра в 15 созвон с командой",
    expect: drafts({ t: "event", at: "2026-10-27 15:00", remind: [60] }),
  },
  {
    phrase: "в четверг день рождения Ани",
    expect: drafts({ t: "event", at: "2026-10-29", allDay: true }),
  },
  {
    phrase: "приём у врача 3 ноября в 9 утра, напомни за день",
    expect: drafts({ t: "event", at: "2026-11-03 09:00", remind: [1440] }),
  },
  {
    phrase: "1 января баня с друзьями в 18",
    expect: drafts({ t: "event", at: "2027-01-01 18:00" }),
  },
  {
    phrase: "в 8 зарядка",
    expect: drafts({ t: "event", at: "2026-10-26 20:00" }),
  },
  {
    phrase: "напомни завтра в 9 выпить таблетки",
    expect: drafts({ t: "reminder", at: "2026-10-27 09:00", repeat: false }),
  },
  {
    phrase: "напоминай каждый день в 21:00 принимать витамины",
    expect: drafts({
      t: "reminder",
      at: "2026-10-26 21:00",
      then: "2026-10-27 21:00",
      repeat: true,
    }),
  },

  // --- вопросы ---
  {
    phrase: "сколько я заработал в сентябре",
    expect: drafts({
      t: "query",
      metric: "income_sum",
      from: "2026-09-01",
      to: "2026-09-30",
      category: null,
    }),
  },
  {
    phrase: "какой у меня баланс за октябрь",
    expect: drafts({
      t: "query",
      metric: "balance",
      from: "2026-10-01",
      to: "2026-10-31",
    }),
  },
  {
    phrase: "сколько потратил на такси вчера",
    expect: drafts({
      t: "query",
      metric: "expense_sum",
      from: "2026-10-25",
      to: "2026-10-25",
      category: "Такси",
    }),
  },
  {
    phrase: "что у меня запланировано на ноябрь",
    expect: drafts({
      t: "query",
      metric: "events_list",
      from: "2026-11-01",
      to: "2026-11-30",
    }),
  },

  // --- уточнение и прочее ---
  { phrase: "потратил деньги", expect: { kind: "clarify" } },
  { phrase: "как дела?", expect: { kind: "other" } },
];

// Местное время записи в формате ожиданий
function local(date: Date, withTime: boolean): string {
  const iso = toLocalIso(date, TZ);
  return withTime
    ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
    : iso.slice(0, 10);
}

function matches(e: ExpectItem, d: Draft): boolean {
  switch (e.t) {
    case "expense":
    case "income":
      return d.kind === "transaction" && d.type === e.t &&
        d.amountMinor === Math.round(e.amount * 100) &&
        (e.category === undefined || d.categoryName === e.category) &&
        (e.at === undefined || local(d.occurredAt, e.at.length > 10) === e.at);
    case "event":
      return d.kind === "event" &&
        local(d.startsAt, !d.allDay) === e.at &&
        (e.allDay === undefined || d.allDay === e.allDay) &&
        (e.remind === undefined ||
          JSON.stringify(d.reminders.map((r) => r.beforeMin)) ===
            JSON.stringify(e.remind));
    case "reminder": {
      if (d.kind !== "reminder" || local(d.nextFireAt, true) !== e.at) {
        return false;
      }
      if (e.repeat !== undefined && (d.rrule !== null) !== e.repeat) {
        return false;
      }
      if (e.then === undefined) return true;
      const second = d.rrule && d.dtstartLocal
        ? nextOccurrence(d.rrule, d.dtstartLocal, TZ, d.nextFireAt)
        : null;
      return second !== null && local(second, true) === e.then;
    }
    case "query":
      return d.kind === "query" && d.metric === e.metric &&
        d.fromDate === e.from && d.toDate === e.to &&
        (e.category === undefined || d.categoryName === e.category);
  }
}

// Совпадение без учёта порядка: каждой ожидаемой записи — своя найденная
function check(expect: Expect, got: Normalized): boolean {
  if (expect.kind !== got.kind) return false;
  if (expect.kind !== "drafts" || got.kind !== "drafts") return true;
  if (expect.items.length !== got.drafts.length) return false;
  const free = [...got.drafts];
  for (const e of expect.items) {
    const i = free.findIndex((d) => matches(e, d));
    if (i === -1) return false;
    free.splice(i, 1);
  }
  return true;
}

function describe(got: Normalized): string {
  if (got.kind === "clarify") return `уточнение: «${got.question}»`;
  if (got.kind === "other") return "other";
  return got.drafts.map((d) => {
    switch (d.kind) {
      case "transaction":
        return `${d.type} ${
          d.amountMinor / 100
        } ${d.currency} · ${d.categoryName} · ${local(d.occurredAt, true)}`;
      case "event":
        return `event «${d.title}» ${local(d.startsAt, !d.allDay)}${
          d.allDay ? " весь день" : ""
        } напомнить за ${JSON.stringify(d.reminders.map((r) => r.beforeMin))}`;
      case "reminder":
        return `reminder «${d.text}» ${local(d.nextFireAt, true)}${
          d.rrule ? ` ${d.rrule}` : ""
        }`;
      case "query":
        return `query ${d.metric} ${d.fromDate}…${d.toDate} ${
          d.categoryName ?? "все категории"
        }`;
    }
  }).join("; ");
}

const args = parseArgs(Deno.args, {
  boolean: ["spec"],
  string: ["only", "delay"],
});
const only = args.only?.split(",").map(Number);
const delay = Number(args.delay ?? 3000);
const cases = GOLDEN
  .map((g, i) => ({ ...g, n: i + 1 }))
  .filter((g) => (!args.spec || g.spec) && (!only || only.includes(g.n)));

const llm = createLlmProvider();
const models = {
  primary: requireEnv("LLM_MODEL"),
  fallback: requireEnv("LLM_FALLBACK_MODEL"),
};
const categories = [
  ...DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
    id: `expense:${name}`,
    kind: "expense" as const,
    name,
  })),
  ...DEFAULT_INCOME_CATEGORIES.map((name) => ({
    id: `income:${name}`,
    kind: "income" as const,
    name,
  })),
];

console.log(
  `Эталонный прогон: ${cases.length} фраз, модель ${models.primary}, запасная ${models.fallback}\n`,
);

let passed = 0;
let specPassed = 0;
let calls = 0;
let fallbackUsed = 0;
let failures = 0;
const ms: number[] = [];

for (const [index, g] of cases.entries()) {
  if (index > 0) await new Promise((r) => setTimeout(r, delay));
  const result = await parsePhrase(llm, models, {
    now: NOW,
    timezone: TZ,
    currency: "RUB",
    expenseCategories: [...DEFAULT_EXPENSE_CATEGORIES],
    incomeCategories: [...DEFAULT_INCOME_CATEGORIES],
  }, g.phrase);
  calls += result.attempts.length;
  ms.push(result.attempts.reduce((sum, a) => sum + a.ms, 0));
  const answered = result.attempts.findLast((a) => a.error === null);
  if (answered && answered.model !== models.primary) fallbackUsed++;
  const errors = result.attempts.filter((a) => a.error).map((a) =>
    `${a.model}: ${a.error}`
  );

  let ok = false;
  let got = "отказ: ни одна попытка не прошла проверку";
  if (result.ok) {
    const normalized = normalizeItems(result.items, {
      now: NOW,
      timezone: TZ,
      currency: "RUB",
      categories,
    });
    ok = check(g.expect, normalized);
    got = describe(normalized);
  } else {
    failures++;
  }
  if (ok) {
    passed++;
    if (g.spec) specPassed++;
  }
  const tag = g.spec ? " [ТЗ]" : "";
  console.log(`${ok ? "✓" : "✗"} ${g.n}.${tag} ${g.phrase}`);
  if (!ok) {
    console.log(`    получено: ${got}`);
    if (answered) console.log(`    ответила: ${answered.model}`);
  }
  for (const e of errors) console.log(`    попытка: ${e}`);
}

const specTotal = cases.filter((g) => g.spec).length;
const accuracy = cases.length ? Math.round((passed / cases.length) * 100) : 0;
const sorted = [...ms].sort((a, b) => a - b);
console.log(`
Точность: ${passed}/${cases.length} (${accuracy}%)
Фразы из ТЗ: ${specPassed}/${specTotal}
Вызовов нейросети: ${calls}, ответила запасная модель: ${fallbackUsed}, отказов: ${failures}
Время на фразу: медиана ${
  sorted[Math.floor(sorted.length / 2)] ?? 0
} мс, максимум ${sorted.at(-1) ?? 0} мс`);

const ok = accuracy >= 90 && specPassed === specTotal;
console.log(
  ok
    ? "\nПрогон пройден."
    : "\nПрогон НЕ пройден: нужно ≥ 90% и все фразы из ТЗ.",
);
Deno.exit(ok ? 0 : 1);
