import { getDb } from "../_shared/db.ts";

// Код ошибки Postgres «нарушение уникальности»
const UNIQUE_VIOLATION = "23505";

// Вставка в processed_updates. Вставка атомарна, поэтому даже два
// одновременных запроса с одним update_id не обработаются дважды.
export async function markProcessed(updateId: number): Promise<boolean> {
  const { error } = await getDb()
    .from("processed_updates")
    .insert({ update_id: updateId });
  if (!error) {
    return true;
  }
  if (error.code === UNIQUE_VIOLATION) {
    return false;
  }
  throw new Error(`Не удалось отметить апдейт: ${error.message}`);
}

export async function unmarkProcessed(updateId: number): Promise<void> {
  const { error } = await getDb()
    .from("processed_updates")
    .delete()
    .eq("update_id", updateId);
  if (error) {
    console.error(
      `Не удалось снять отметку апдейта ${updateId}:`,
      error.message,
    );
  }
}
