import { assertEquals } from "@std/assert";
import { describeRrule, nextOccurrence, normalizeRrule } from "./recurrence.ts";

const TZ = "Europe/Samara";
const NOW = new Date("2026-10-26T11:51:00Z");

Deno.test("повтор: каждый месяц 5 и 10 числа, ближайшее — 5 ноября", () => {
  const rule = "FREQ=MONTHLY;BYMONTHDAY=5,10;BYHOUR=10;BYMINUTE=0";
  const first = nextOccurrence(rule, "2026-11-05T10:00:00", TZ, NOW, true);
  assertEquals(first?.toISOString(), "2026-11-05T06:00:00.000Z");
  const second = nextOccurrence(rule, "2026-11-05T10:00:00", TZ, first!);
  assertEquals(second?.toISOString(), "2026-11-10T06:00:00.000Z");
});

Deno.test("повтор: декабрь → январь", () => {
  const rule = "FREQ=MONTHLY;BYMONTHDAY=10;BYHOUR=10;BYMINUTE=0";
  const next = nextOccurrence(
    rule,
    "2026-11-10T10:00:00",
    TZ,
    new Date("2026-12-10T06:00:00Z"),
  );
  assertEquals(next?.toISOString(), "2027-01-10T06:00:00.000Z");
});

Deno.test("повтор: 31-е число пропускает короткие месяцы", () => {
  const rule = "FREQ=MONTHLY;BYMONTHDAY=31;BYHOUR=10;BYMINUTE=0";
  const next = nextOccurrence(
    rule,
    "2026-10-31T10:00:00",
    TZ,
    new Date("2026-10-31T07:00:00Z"),
  );
  assertEquals(next?.toISOString(), "2026-12-31T06:00:00.000Z");
});

Deno.test("повтор: последний день месяца в феврале", () => {
  const rule = "FREQ=MONTHLY;BYMONTHDAY=-1;BYHOUR=10;BYMINUTE=0";
  const next = nextOccurrence(
    rule,
    "2027-01-31T10:00:00",
    TZ,
    new Date("2027-01-31T07:00:00Z"),
  );
  assertEquals(next?.toISOString(), "2027-02-28T06:00:00.000Z");
});

Deno.test("повтор: 10:00 остаётся 10:00 после перевода часов", () => {
  const rule = "FREQ=DAILY;BYHOUR=10;BYMINUTE=0";
  const tz = "Europe/Berlin";
  // 25 октября 2026 Берлин переходит на зимнее время
  const before = nextOccurrence(
    rule,
    "2026-10-20T10:00:00",
    tz,
    new Date("2026-10-24T09:00:00Z"),
  );
  assertEquals(before?.toISOString(), "2026-10-25T09:00:00.000Z");
  const after = nextOccurrence(rule, "2026-10-20T10:00:00", tz, before!);
  assertEquals(after?.toISOString(), "2026-10-26T09:00:00.000Z");
});

Deno.test("повтор: проверка правила от нейросети", () => {
  assertEquals(normalizeRrule("RRULE:freq=monthly;bymonthday=5,10"), {
    ok: true,
    rule: "FREQ=MONTHLY;BYMONTHDAY=5,10",
  });
  assertEquals(normalizeRrule("FREQ=HOURLY"), {
    ok: false,
    reason: "too_frequent",
  });
  assertEquals(normalizeRrule("FREQ=MINUTELY;INTERVAL=5"), {
    ok: false,
    reason: "too_frequent",
  });
  assertEquals(normalizeRrule("FREQ=SOMETIMES"), {
    ok: false,
    reason: "invalid",
  });
  assertEquals(normalizeRrule("DTSTART:20260101T000000Z;FREQ=DAILY"), {
    ok: false,
    reason: "invalid",
  });
  assertEquals(normalizeRrule("BYMONTHDAY=5"), {
    ok: false,
    reason: "invalid",
  });
  assertEquals(normalizeRrule(""), { ok: false, reason: "invalid" });
});

Deno.test("повтор: правило словами", () => {
  assertEquals(
    describeRrule(
      "FREQ=MONTHLY;BYMONTHDAY=5,10;BYHOUR=10;BYMINUTE=0",
      "2026-11-05T10:00:00",
    ),
    "каждый месяц 5 и 10 числа в 10:00",
  );
  assertEquals(
    describeRrule("FREQ=DAILY;BYHOUR=9;BYMINUTE=30", "2026-10-27T09:30:00"),
    "каждый день в 09:30",
  );
  assertEquals(
    describeRrule("FREQ=WEEKLY;BYDAY=MO,WE", "2026-10-28T10:00:00"),
    "каждый пн и ср в 10:00",
  );
  assertEquals(
    describeRrule("FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=8", "2027-03-08T10:00:00"),
    "каждый год 8 марта в 10:00",
  );
  assertEquals(
    describeRrule("FREQ=MONTHLY", "2026-11-05T10:00:00"),
    "каждый месяц 5 числа в 10:00",
  );
  assertEquals(
    describeRrule("FREQ=MONTHLY;BYMONTHDAY=-1", "2026-10-31T10:00:00"),
    "каждый месяц в последний день в 10:00",
  );
});
