// Заголовок, в котором Telegram присылает secret_token вебхука
export const WEBHOOK_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

// Проверка секрета вебхука. Сравнение за постоянное время,
// чтобы по времени ответа нельзя было подобрать секрет.
export function isValidWebhookSecret(
  received: string | null,
  expected: string,
): boolean {
  if (received === null || expected.length === 0) {
    return false;
  }
  return timingSafeEqual(received, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
}
