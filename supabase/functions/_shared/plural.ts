// Русское множественное число: plural(5, ["трата", "траты", "трат"]) → «трат»
export function plural(
  n: number,
  forms: readonly [one: string, few: string, many: string],
): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}
