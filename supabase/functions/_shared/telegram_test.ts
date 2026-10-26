import { assertEquals } from "@std/assert";
import { callbackData, parseCallbackData } from "./telegram.ts";

const A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

Deno.test("callback_data: туда и обратно, не длиннее 64 байт", () => {
  const all = [
    callbackData.undo(A),
    callbackData.category(A),
    callbackData.back(A),
    callbackData.pickTransaction(A),
    callbackData.setCategory(A, B),
  ];
  for (const data of all) {
    assertEquals(new TextEncoder().encode(data).length <= 64, true);
  }
  assertEquals(parseCallbackData(all[0]), { action: "undo", entryId: A });
  assertEquals(parseCallbackData(all[3]), {
    action: "pickTransaction",
    transactionId: A,
  });
  assertEquals(parseCallbackData(all[4]), {
    action: "setCategory",
    transactionId: A,
    categoryId: B,
  });
  assertEquals(parseCallbackData("u:мусор"), null);
  assertEquals(parseCallbackData("x:" + all[0].slice(2)), null);
});
