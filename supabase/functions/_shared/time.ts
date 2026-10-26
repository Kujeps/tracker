// Часовые пояса и даты. В базе всё в UTC, пользователю показываем в его поясе.
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { ru } from "date-fns/locale";

const DAY_MS = 24 * 60 * 60 * 1000;

// Местная дата и время без пояса: «2026-10-26T15:51:00»
export function toLocalIso(date: Date, tz: string): string {
  return formatInTimeZone(date, tz, "yyyy-MM-dd'T'HH:mm:ss");
}

// Местная дата: «2026-10-26»
export function toLocalDate(date: Date, tz: string): string {
  return formatInTimeZone(date, tz, "yyyy-MM-dd");
}

// Местные дата и время в поясе tz → момент в UTC.
// Несуществующее время при переводе часов date-fns-tz сдвигает вперёд.
export function fromLocal(localIso: string, tz: string): Date {
  return fromZonedTime(localIso, tz);
}

// Дата «2026-10-26» плюс n дней, без поясов: календарная арифметика
export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

// Начало местного дня (полночь в поясе tz) в UTC
export function startOfLocalDay(date: Date, tz: string): Date {
  return fromLocal(toLocalDate(date, tz) + "T00:00:00", tz);
}

// Полночь местной даты «2026-10-26» в UTC
export function localDateStart(date: string, tz: string): Date {
  return fromLocal(date + "T00:00:00", tz);
}

export interface Period {
  from: Date; // включительно
  to: Date; // не включительно
}

// Местные даты с from по to включительно → полуоткрытый период в UTC
export function localDatesPeriod(
  fromDate: string,
  toDate: string,
  tz: string,
): Period {
  return {
    from: localDateStart(fromDate, tz),
    to: localDateStart(addDaysToDate(toDate, 1), tz),
  };
}

// Сегодня в поясе пользователя
export function todayPeriod(now: Date, tz: string): Period {
  const today = toLocalDate(now, tz);
  return localDatesPeriod(today, today, tz);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Текущий месяц с 1 числа по сегодня и прошлый месяц с 1 числа по то же число.
// Если в прошлом месяце такого числа нет (31 октября → сентябрь), берём его последний день.
export function monthToDatePeriods(
  now: Date,
  tz: string,
): { current: Period; previous: Period; day: number; previousDay: number } {
  const [y, m, d] = toLocalDate(now, tz).split("-").map(Number);
  const prevYear = m === 1 ? y - 1 : y;
  const prevMonth = m === 1 ? 12 : m - 1;
  const previousDay = Math.min(d, daysInMonth(prevYear, prevMonth));
  const ymd = (yy: number, mm: number, dd: number) =>
    `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return {
    current: localDatesPeriod(ymd(y, m, 1), ymd(y, m, d), tz),
    previous: localDatesPeriod(
      ymd(prevYear, prevMonth, 1),
      ymd(prevYear, prevMonth, previousDay),
      tz,
    ),
    day: d,
    previousDay,
  };
}

// Строка для промпта: «2026-10-26 15:51, понедельник, Europe/Samara»
export function promptNow(now: Date, tz: string): string {
  return `${
    formatInTimeZone(now, tz, "yyyy-MM-dd HH:mm, EEEE", { locale: ru })
  }, ${tz}`;
}

// Смещение пояса в момент at: «UTC+4», «UTC+5:30», «UTC−3»
export function utcOffsetLabel(tz: string, at: Date): string {
  const offset = formatInTimeZone(at, tz, "xxx"); // +04:00
  if (offset === "+00:00") return "UTC";
  const sign = offset[0] === "-" ? "−" : "+";
  const hours = String(Number(offset.slice(1, 3)));
  const minutes = offset.slice(4, 6);
  return `UTC${sign}${hours}${minutes === "00" ? "" : ":" + minutes}`;
}

export function formatTime(date: Date, tz: string): string {
  return formatInTimeZone(date, tz, "HH:mm");
}

// «26 октября, понедельник»
export function formatDayHeader(date: Date, tz: string): string {
  return formatInTimeZone(date, tz, "d MMMM, EEEE", { locale: ru });
}

// «26 октября» или «26 октября 2027», если год не текущий
export function formatDate(date: Date, tz: string, now: Date): string {
  const sameYear = formatInTimeZone(date, tz, "yyyy") ===
    formatInTimeZone(now, tz, "yyyy");
  return formatInTimeZone(date, tz, sameYear ? "d MMMM" : "d MMMM yyyy", {
    locale: ru,
  });
}

// Дата записи для подтверждения: «сегодня 15:51», «вчера», «пт 30 октября 10:00».
// День недели помогает сразу заметить ошибку в дате.
export function formatWhen(
  date: Date,
  tz: string,
  now: Date,
  options: { allDay?: boolean } = {},
): string {
  const day = toLocalDate(date, tz);
  const today = toLocalDate(now, tz);
  let dayLabel: string;
  if (day === today) dayLabel = "сегодня";
  else if (day === addDaysToDate(today, -1)) dayLabel = "вчера";
  else if (day === addDaysToDate(today, 1)) dayLabel = "завтра";
  else {
    dayLabel = formatInTimeZone(date, tz, "EEEEEE", { locale: ru }) + " " +
      formatDate(date, tz, now);
  }
  return options.allDay
    ? `${dayLabel}, весь день`
    : `${dayLabel} ${formatTime(date, tz)}`;
}

// Название месяца в именительном падеже: «октябрь»
export function monthName(date: Date, tz: string): string {
  return formatInTimeZone(date, tz, "LLLL", { locale: ru });
}

// Название месяца в родительном падеже: «5 ноября»
export const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

// Название месяца в предложном падеже для «в октябре»
const MONTHS_PREPOSITIONAL = [
  "январе",
  "феврале",
  "марте",
  "апреле",
  "мае",
  "июне",
  "июле",
  "августе",
  "сентябре",
  "октябре",
  "ноябре",
  "декабре",
];

export function monthNamePrepositional(month: number): string {
  return MONTHS_PREPOSITIONAL[month - 1];
}

// Разбор даты и времени от нейросети: «2026-10-26T15:51:00+04:00»,
// «2026-10-26T15:51», «2026-10-26». Смещение из ответа не используем:
// время считаем местным в поясе пользователя, так ошибка модели в смещении не страшна.
export function parseLocalDateTime(
  value: string,
): { date: string; time: string | null } | null {
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
      .exec(value.trim());
  if (!match) return null;
  const [, date, hh, mm] = match;
  const [y, m, d] = date.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  if (hh === undefined) return { date, time: null };
  if (Number(hh) > 23 || Number(mm) > 59) return null;
  return { date, time: `${hh}:${mm}` };
}
