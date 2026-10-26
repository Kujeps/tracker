import { assertEquals } from "@std/assert";
import { isValidWebhookSecret } from "./auth.ts";

Deno.test("секрет вебхука: совпадает", () => {
  assertEquals(isValidWebhookSecret("s3cret-token", "s3cret-token"), true);
});

Deno.test("секрет вебхука: другой той же длины", () => {
  assertEquals(isValidWebhookSecret("s3cret-tokeN", "s3cret-token"), false);
});

Deno.test("секрет вебхука: другой длины", () => {
  assertEquals(isValidWebhookSecret("s3cret", "s3cret-token"), false);
});

Deno.test("секрет вебхука: заголовка нет", () => {
  assertEquals(isValidWebhookSecret(null, "s3cret-token"), false);
});

Deno.test("секрет вебхука: пустой ожидаемый секрет никого не пускает", () => {
  assertEquals(isValidWebhookSecret("", ""), false);
});
