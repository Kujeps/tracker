import { assertEquals } from "@std/assert";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
} from "./categories.ts";

// Списки в коде и в seed.sql не должны разойтись: по ним работает эталонный прогон
Deno.test("категории по умолчанию совпадают с seed.sql", async () => {
  const seed = await Deno.readTextFile(
    new URL("../../seed.sql", import.meta.url),
  );
  const rows = [...seed.matchAll(/\('(expense|income)', '([^']+)', \d+\)/g)];
  assertEquals(rows.filter((r) => r[1] === "expense").map((r) => r[2]), [
    ...DEFAULT_EXPENSE_CATEGORIES,
  ]);
  assertEquals(rows.filter((r) => r[1] === "income").map((r) => r[2]), [
    ...DEFAULT_INCOME_CATEGORIES,
  ]);
});
