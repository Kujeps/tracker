// Обязательная переменная окружения: без неё функция не стартует
export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Не задана переменная окружения ${name}`);
  }
  return value;
}
