// Алерты админам в Telegram: не чаще раза в 10 минут на один тип ошибки.
// Счётчик живёт в памяти экземпляра функции: после холодного старта алерт
// может прийти раньше, это приемлемо. Текстов фраз в алертах нет.

const THROTTLE_MS = 10 * 60 * 1000;

export type AdminNotifier = (kind: string, text: string) => Promise<void>;

export function parseAdminIds(value: string | undefined): number[] {
  return (value ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
}

export function createAdminNotifier(
  adminIds: number[],
  send: (chatId: number, text: string) => Promise<unknown>,
  clock: () => Date = () => new Date(),
): AdminNotifier {
  const lastSent = new Map<string, number>();
  return async (kind, text) => {
    console.error(`[${kind}] ${text}`);
    const now = clock().getTime();
    const last = lastSent.get(kind);
    if (last !== undefined && now - last < THROTTLE_MS) return;
    lastSent.set(kind, now);
    for (const id of adminIds) {
      try {
        await send(id, `⚠️ ${text}`);
      } catch (err) {
        console.error(`Не удалось отправить алерт админу: ${String(err)}`);
      }
    }
  };
}
