import { assertEquals } from "@std/assert";
import { parseTimeZoneInput, timeZoneLabel } from "./timezones.ts";

const NOW = new Date("2026-10-26T11:51:00Z");

Deno.test("пояс: имя IANA", () => {
  assertEquals(parseTimeZoneInput("Europe/Berlin"), "Europe/Berlin");
  assertEquals(parseTimeZoneInput(" europe/berlin "), "Europe/Berlin");
  assertEquals(parseTimeZoneInput("Asia/Kolkata"), "Asia/Kolkata");
  assertEquals(parseTimeZoneInput("Europe/Nowhere"), null);
  assertEquals(parseTimeZoneInput("кофе 250"), null);
});

Deno.test("пояс: смещение от UTC", () => {
  assertEquals(parseTimeZoneInput("UTC+4"), "Etc/GMT-4");
  assertEquals(parseTimeZoneInput("gmt-3"), "Etc/GMT+3");
  assertEquals(parseTimeZoneInput("+5"), "Etc/GMT-5");
  assertEquals(parseTimeZoneInput("UTC"), "Etc/UTC");
  assertEquals(parseTimeZoneInput("UTC+0"), "Etc/UTC");
  assertEquals(parseTimeZoneInput("UTC+15"), null);
});

Deno.test("пояс: подпись", () => {
  assertEquals(timeZoneLabel("Europe/Samara", NOW), "Самара (UTC+4)");
  assertEquals(timeZoneLabel("Europe/Berlin", NOW), "Europe/Berlin (UTC+1)");
  assertEquals(timeZoneLabel("Etc/GMT-4", NOW), "UTC+4");
});
