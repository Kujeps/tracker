import { assertEquals } from "@std/assert";
import { plural } from "./plural.ts";

Deno.test("множественное число", () => {
  const forms = ["трата", "траты", "трат"] as const;
  assertEquals(
    [0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map((n) =>
      plural(n, forms)
    ),
    [
      "трат",
      "трата",
      "траты",
      "траты",
      "трат",
      "трат",
      "трат",
      "трат",
      "трата",
      "траты",
      "трат",
      "трата",
      "трат",
    ],
  );
});
