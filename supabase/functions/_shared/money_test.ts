import { assertEquals } from "@std/assert";
import { formatMoney, toMinor } from "./money.ts";

Deno.test("деньги: целые и копейки переводятся без float", () => {
  assertEquals(toMinor(520), 52000);
  assertEquals(toMinor(2300), 230000);
  assertEquals(toMinor(99.9), 9990);
  assertEquals(toMinor(99.99), 9999);
  assertEquals(toMinor(0.1), 10);
  assertEquals(toMinor(1500.5), 150050);
});

Deno.test("деньги: больше двух знаков после запятой и мусор — null", () => {
  assertEquals(toMinor(1.005), null);
  assertEquals(toMinor(-5), null);
  assertEquals(toMinor(Number.NaN), null);
  assertEquals(toMinor(Infinity), null);
  assertEquals(toMinor(1e-7), null);
});

Deno.test("деньги: форматирование «7 430 ₽» с неразрывными пробелами", () => {
  assertEquals(formatMoney(743000, "RUB"), "7 430 ₽");
  assertEquals(formatMoney(9990, "RUB"), "99,90 ₽");
  assertEquals(formatMoney(52000, "RUB"), "520 ₽");
  assertEquals(formatMoney(8500000, "RUB"), "85 000 ₽");
  assertEquals(formatMoney(123456789, "RUB"), "1 234 567,89 ₽");
  assertEquals(formatMoney(2000, "USD"), "20 $");
  assertEquals(formatMoney(2000, "GBP"), "20 GBP");
  assertEquals(formatMoney(-1500, "RUB"), "−15 ₽");
  assertEquals(formatMoney(5, "RUB"), "0,05 ₽");
});
