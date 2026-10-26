import { assertEquals, assertRejects } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseStore } from "./store-supabase.ts";

// Клиент-заглушка: любая цепочка .from().update().eq()… завершается ответом
// result. Так ведёт себя PostgREST: update без select возвращает data: null.
function fakeDb(result: { data: unknown; error: { message: string } | null }) {
  const calls: string[] = [];
  const chain: unknown = new Proxy(() => {}, {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(result);
      }
      return (...args: unknown[]) => {
        calls.push(
          `${String(prop)}(${args.map((a) => JSON.stringify(a)).join(", ")})`,
        );
        return chain;
      };
    },
  });
  return { db: chain as SupabaseClient, calls };
}

const OK_WITHOUT_ROWS = { data: null, error: null };
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

Deno.test("Supabase: запись без возврата строк — не ошибка", async () => {
  const { db } = fakeDb(OK_WITHOUT_ROWS);
  const store = createSupabaseStore(db);
  await store.setEntryMessage(ID, 101);
  await store.setEntryStatus(ID, "failed");
  await store.setTransactionCategory(ID, ID);
  await store.undoEntry(ID, new Date());
});

Deno.test("Supabase: настоящая ошибка базы пробрасывается", async () => {
  const { db } = fakeDb({ data: null, error: { message: "нет связи" } });
  const store = createSupabaseStore(db);
  const err = await assertRejects(() => store.setEntryMessage(ID, 101));
  assertEquals((err as Error).message, "Не удалось обновить ввод: нет связи");
});
