import { assertEquals } from "@std/assert";
import { WEBHOOK_SECRET_HEADER } from "../_shared/auth.ts";
import type { Update } from "grammy/types";
import { createWebhookHandler } from "./handler.ts";

const SECRET = "test-secret";

// Обработчик с хранилищем update_id в памяти вместо базы
function setup(
  handleUpdate: (update: Update) => Promise<void> = async () => {},
) {
  const processed = new Set<number>();
  const handled: number[] = [];
  const handler = createWebhookHandler({
    secret: SECRET,
    markProcessed: (id) => {
      if (processed.has(id)) return Promise.resolve(false);
      processed.add(id);
      return Promise.resolve(true);
    },
    unmarkProcessed: (id) => {
      processed.delete(id);
      return Promise.resolve();
    },
    handleUpdate: async (update) => {
      await handleUpdate(update);
      handled.push(update.update_id);
    },
  });
  return { handler, handled, processed };
}

function request(body: unknown, secret: string | null = SECRET): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (secret !== null) headers.set(WEBHOOK_SECRET_HEADER, secret);
  return new Request("https://example.test/telegram-webhook", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

Deno.test("вебхук: без секретного заголовка — 401 и без обработки", async () => {
  const { handler, handled } = setup();
  const res = await handler(request({ update_id: 1 }, null));
  assertEquals(res.status, 401);
  assertEquals(handled, []);
});

Deno.test("вебхук: неверный секрет — 401", async () => {
  const { handler, handled } = setup();
  const res = await handler(request({ update_id: 1 }, "wrong"));
  assertEquals(res.status, 401);
  assertEquals(handled, []);
});

Deno.test("вебхук: верный секрет — 200 и апдейт обработан", async () => {
  const { handler, handled } = setup();
  const res = await handler(request({ update_id: 1 }));
  assertEquals(res.status, 200);
  assertEquals(handled, [1]);
});

Deno.test("вебхук: повтор того же update_id — 200 без повторной обработки", async () => {
  const { handler, handled } = setup();
  assertEquals((await handler(request({ update_id: 7 }))).status, 200);
  assertEquals((await handler(request({ update_id: 7 }))).status, 200);
  assertEquals((await handler(request({ update_id: 8 }))).status, 200);
  assertEquals(handled, [7, 8]);
});

Deno.test("вебхук: обработка упала — 500, отметка снята, повтор обрабатывается", async () => {
  let fail = true;
  const { handler, handled, processed } = setup(() => {
    if (fail) return Promise.reject(new Error("сбой"));
    return Promise.resolve();
  });
  const res = await handler(request({ update_id: 3 }));
  assertEquals(res.status, 500);
  assertEquals(processed.has(3), false);

  fail = false;
  assertEquals((await handler(request({ update_id: 3 }))).status, 200);
  assertEquals(handled, [3]);
});

Deno.test("вебхук: тело без update_id — 400", async () => {
  const { handler } = setup();
  assertEquals((await handler(request({ message: {} }))).status, 400);
});

Deno.test("вебхук: не JSON — 400", async () => {
  const { handler } = setup();
  const req = new Request("https://example.test/telegram-webhook", {
    method: "POST",
    headers: { [WEBHOOK_SECRET_HEADER]: SECRET },
    body: "not json",
  });
  assertEquals((await handler(req)).status, 400);
});

Deno.test("вебхук: GET — 405", async () => {
  const { handler } = setup();
  const res = await handler(
    new Request("https://example.test/telegram-webhook"),
  );
  assertEquals(res.status, 405);
});
