import { assertEquals } from "@std/assert";
import {
  formatWhen,
  fromLocal,
  monthToDatePeriods,
  parseLocalDateTime,
  promptNow,
  todayPeriod,
  utcOffsetLabel,
} from "./time.ts";

// Момент из эталонных фраз: 2026-10-26 15:51, понедельник, Europe/Samara
const NOW = new Date("2026-10-26T11:51:00Z");
const TZ = "Europe/Samara";

Deno.test("время: строка для промпта", () => {
  assertEquals(
    promptNow(NOW, TZ),
    "2026-10-26 15:51, понедельник, Europe/Samara",
  );
});

Deno.test("время: местное время → UTC", () => {
  assertEquals(
    fromLocal("2026-11-26T19:00:00", TZ).toISOString(),
    "2026-11-26T15:00:00.000Z",
  );
  assertEquals(
    fromLocal("2026-11-26T19:00:00", "Asia/Vladivostok").toISOString(),
    "2026-11-26T09:00:00.000Z",
  );
});

Deno.test("время: подтверждение в поясе пользователя", () => {
  assertEquals(formatWhen(NOW, TZ, NOW), "сегодня 15:51");
  assertEquals(formatWhen(NOW, "Europe/Moscow", NOW), "сегодня 14:51");
  assertEquals(
    formatWhen(new Date("2026-10-25T08:00:00Z"), TZ, NOW),
    "вчера 12:00",
  );
  assertEquals(
    formatWhen(new Date("2026-10-27T06:00:00Z"), TZ, NOW),
    "завтра 10:00",
  );
  assertEquals(
    formatWhen(new Date("2026-10-30T06:00:00Z"), TZ, NOW),
    "пт 30 октября 10:00",
  );
  assertEquals(
    formatWhen(new Date("2027-01-05T06:00:00Z"), TZ, NOW),
    "вт 5 января 2027 10:00",
  );
  assertEquals(
    formatWhen(new Date("2026-10-29T20:00:00Z"), TZ, NOW, { allDay: true }),
    "пт 30 октября, весь день",
  );
});

Deno.test("время: поздний вечер в UTC — уже завтра у пользователя", () => {
  // 21:30 UTC 26 октября = 01:30 27 октября во Владивостоке
  const now = new Date("2026-10-26T21:30:00Z");
  assertEquals(formatWhen(now, "Asia/Vladivostok", now), "сегодня 07:30");
  const today = todayPeriod(now, "Asia/Vladivostok");
  assertEquals(today.from.toISOString(), "2026-10-26T14:00:00.000Z");
  assertEquals(today.to.toISOString(), "2026-10-27T14:00:00.000Z");
});

Deno.test("время: смещение пояса словами", () => {
  assertEquals(utcOffsetLabel(TZ, NOW), "UTC+4");
  assertEquals(utcOffsetLabel("Asia/Kolkata", NOW), "UTC+5:30");
  assertEquals(utcOffsetLabel("America/Sao_Paulo", NOW), "UTC−3");
  assertEquals(utcOffsetLabel("Etc/UTC", NOW), "UTC");
});

Deno.test("время: месяц на ту же дату и прошлый месяц", () => {
  const p = monthToDatePeriods(NOW, TZ);
  assertEquals(p.current.from.toISOString(), "2026-09-30T20:00:00.000Z");
  assertEquals(p.current.to.toISOString(), "2026-10-26T20:00:00.000Z");
  assertEquals(p.previous.from.toISOString(), "2026-08-31T20:00:00.000Z");
  assertEquals(p.previous.to.toISOString(), "2026-09-26T20:00:00.000Z");
});

Deno.test("время: 31-е число, в прошлом месяце дней меньше", () => {
  const p = monthToDatePeriods(new Date("2026-10-31T10:00:00Z"), TZ);
  assertEquals(p.previousDay, 30);
  assertEquals(p.previous.to.toISOString(), "2026-09-30T20:00:00.000Z");
});

Deno.test("время: январь сравнивается с декабрём прошлого года", () => {
  const p = monthToDatePeriods(new Date("2027-01-10T10:00:00Z"), TZ);
  assertEquals(p.previous.from.toISOString(), "2026-11-30T20:00:00.000Z");
});

Deno.test("время: разбор даты от нейросети", () => {
  assertEquals(parseLocalDateTime("2026-10-26T15:51:00+04:00"), {
    date: "2026-10-26",
    time: "15:51",
  });
  assertEquals(parseLocalDateTime("2026-10-26T15:51"), {
    date: "2026-10-26",
    time: "15:51",
  });
  assertEquals(parseLocalDateTime("2026-10-26T15:51:00Z"), {
    date: "2026-10-26",
    time: "15:51",
  });
  assertEquals(parseLocalDateTime("2026-10-26"), {
    date: "2026-10-26",
    time: null,
  });
  assertEquals(parseLocalDateTime("2026-02-30"), null);
  assertEquals(parseLocalDateTime("2026-10-26T25:00"), null);
  assertEquals(parseLocalDateTime("завтра"), null);
});
