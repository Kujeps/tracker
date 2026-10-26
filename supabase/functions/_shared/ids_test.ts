import { assertEquals, assertThrows } from "@std/assert";
import { packUuid, unpackUuid } from "./ids.ts";

Deno.test("UUID упаковывается в 22 символа и распаковывается обратно", () => {
  const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const packed = packUuid(uuid);
  assertEquals(packed.length, 22);
  assertEquals(unpackUuid(packed), uuid);
  assertEquals(
    unpackUuid(packUuid("ffffffff-ffff-ffff-ffff-ffffffffffff")),
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
  );
});

Deno.test("мусор вместо UUID", () => {
  assertEquals(unpackUuid("short"), null);
  assertEquals(unpackUuid("!!!!!!!!!!!!!!!!!!!!!!"), null);
  assertThrows(() => packUuid("not-a-uuid"));
});
