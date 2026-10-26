// Часовые пояса: кнопки онбординга и ввод «Другого» текстом
import { utcOffsetLabel } from "./time.ts";

export const DEFAULT_TIMEZONE = "Europe/Moscow";

export const RUSSIAN_TIMEZONES = [
  { city: "Калининград", tz: "Europe/Kaliningrad" },
  { city: "Москва", tz: "Europe/Moscow" },
  { city: "Самара", tz: "Europe/Samara" },
  { city: "Екатеринбург", tz: "Asia/Yekaterinburg" },
  { city: "Омск", tz: "Asia/Omsk" },
  { city: "Новосибирск", tz: "Asia/Novosibirsk" },
  { city: "Красноярск", tz: "Asia/Krasnoyarsk" },
  { city: "Иркутск", tz: "Asia/Irkutsk" },
  { city: "Якутск", tz: "Asia/Yakutsk" },
  { city: "Владивосток", tz: "Asia/Vladivostok" },
] as const;

// Каноническое имя IANA или null, если такого пояса нет
export function canonicalTimeZone(name: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: name })
      .resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

// Ввод пользователя: «Europe/Berlin», «UTC+4», «GMT-3», «+5».
// Смещение превращается в пояс Etc/GMT, у которого знак наоборот (так в IANA).
export function parseTimeZoneInput(input: string): string | null {
  const text = input.trim();
  const offset = /^(?:utc|gmt)?\s*([+-−])\s*(\d{1,2})(?::00)?$/i.exec(text) ??
    /^(utc|gmt)$/i.exec(text);
  if (offset) {
    if (offset.length === 2) return "Etc/UTC";
    const hours = Number(offset[2]);
    const sign = offset[1] === "+" ? "-" : "+";
    if (hours === 0) return "Etc/UTC";
    if (sign === "-" && hours > 14) return null;
    if (sign === "+" && hours > 12) return null;
    return `Etc/GMT${sign}${hours}`;
  }
  if (!/^[A-Za-z_]+(?:\/[A-Za-z_+-]+){1,2}$/.test(text)) {
    return null;
  }
  const canonical = canonicalTimeZone(text);
  if (canonical === null) return null;
  // Intl иногда возвращает устаревшее имя (Asia/Kolkata → Asia/Calcutta).
  // Если человек написал имя с правильным регистром, оставляем его вариант.
  const properlyCased = text.split("/").every((part) => /^[A-Z]/.test(part));
  return properlyCased ? text : canonical;
}

// «Самара (UTC+4)» для пояса из списка, «Europe/Berlin (UTC+1)» для остальных
export function timeZoneLabel(tz: string, at: Date): string {
  const known = RUSSIAN_TIMEZONES.find((z) => z.tz === tz);
  const offset = utcOffsetLabel(tz, at);
  if (known) return `${known.city} (${offset})`;
  if (tz.startsWith("Etc/")) return offset;
  return `${tz} (${offset})`;
}
