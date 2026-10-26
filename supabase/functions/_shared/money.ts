// Деньги: в базе только целые копейки (minor units), никаких float.

// Потолок одной суммы: меньше 100 000 000 в основной единице валюты
export const MAX_AMOUNT_MINOR = 100_000_000 * 100;

// Валюты, которые можно выбрать по умолчанию в /settings
export const SUPPORTED_CURRENCIES = [
  "RUB",
  "USD",
  "EUR",
  "KZT",
  "BYN",
] as const;

const CURRENCY_SIGNS: Record<string, string> = {
  RUB: "₽",
  USD: "$",
  EUR: "€",
  KZT: "₸",
  BYN: "Br",
};

// Неразрывный пробел: сумма не переносится посередине
const NBSP = " ";

// Сумма от нейросети (число вроде 520 или 99.9) → копейки.
// Разбираем десятичную запись строкой, чтобы не умножать float.
// null — не больше двух знаков после запятой или не число.
export function toMinor(amount: number): number | null {
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount));
  if (!match) {
    return null;
  }
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const minor = whole * 100 + fraction;
  return Number.isSafeInteger(minor) ? minor : null;
}

export function currencySign(currency: string): string {
  return CURRENCY_SIGNS[currency] ?? currency;
}

// 743000 → «7 430 ₽», 9990 → «99,90 ₽»
export function formatMoney(minor: number, currency: string): string {
  const sign = minor < 0 ? "−" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const tail = fraction === 0 ? "" : "," + String(fraction).padStart(2, "0");
  return `${sign}${grouped}${tail}${NBSP}${currencySign(currency)}`;
}
