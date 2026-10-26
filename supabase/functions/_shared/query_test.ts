import { assertEquals } from "@std/assert";
import { periodLabel } from "./query.ts";

Deno.test("период словами", () => {
  const today = "2026-10-26";
  assertEquals(periodLabel("2026-10-01", "2026-10-31", today), "В октябре");
  assertEquals(
    periodLabel("2025-10-01", "2025-10-31", today),
    "В октябре 2025",
  );
  assertEquals(periodLabel("2026-02-01", "2026-02-28", today), "В феврале");
  assertEquals(periodLabel("2026-10-26", "2026-10-26", today), "Сегодня");
  assertEquals(periodLabel("2026-10-25", "2026-10-25", today), "Вчера");
  assertEquals(
    periodLabel("2026-10-01", "2026-10-15", today),
    "С 1 по 15 октября",
  );
  assertEquals(
    periodLabel("2026-10-26", "2026-11-02", today),
    "С 26 октября по 2 ноября",
  );
});
