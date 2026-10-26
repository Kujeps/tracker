import { getDb } from "./db.ts";

export interface TelegramProfile {
  telegramId: number;
  firstName: string | null;
  username: string | null;
}

// Создаёт пользователя по telegram_id или обновляет имя и username.
// Настройки (пояс, тариф и прочее) не трогает.
export async function upsertUser(profile: TelegramProfile): Promise<void> {
  const { error } = await getDb()
    .from("users")
    .upsert(
      {
        telegram_id: profile.telegramId,
        first_name: profile.firstName,
        username: profile.username,
      },
      { onConflict: "telegram_id" },
    );
  if (error) {
    throw new Error(`Не удалось сохранить пользователя: ${error.message}`);
  }
}
