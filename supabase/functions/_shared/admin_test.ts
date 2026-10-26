import { assertEquals } from "@std/assert";
import { createAdminNotifier, parseAdminIds } from "./admin.ts";

Deno.test("алерты: не чаще раза в 10 минут на тип ошибки", async () => {
  const sent: [number, string][] = [];
  let now = new Date("2026-10-26T12:00:00Z");
  const notify = createAdminNotifier([1, 2], (id, text) => {
    sent.push([id, text]);
    return Promise.resolve();
  }, () => now);
  const originalError = console.error;
  console.error = () => {};
  try {
    await notify("cap", "лимит");
    await notify("cap", "лимит");
    await notify("parser", "сбой");
    now = new Date("2026-10-26T12:10:01Z");
    await notify("cap", "лимит");
  } finally {
    console.error = originalError;
  }
  assertEquals(sent.length, 6);
  assertEquals(sent[0], [1, "⚠️ лимит"]);
});

Deno.test("алерты: список админов из переменной", () => {
  assertEquals(parseAdminIds("123, 456,abc,"), [123, 456]);
  assertEquals(parseAdminIds(undefined), []);
});
