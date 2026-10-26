import {
  isValidWebhookSecret,
  WEBHOOK_SECRET_HEADER,
} from "../_shared/auth.ts";
import type { Update } from "grammy/types";

export interface WebhookDeps {
  secret: string;
  // Отмечает update_id как принятый. false — такой апдейт уже был.
  markProcessed(updateId: number): Promise<boolean>;
  // Снимает отметку, если обработка упала: Telegram пришлёт апдейт ещё раз.
  unmarkProcessed(updateId: number): Promise<void>;
  handleUpdate(update: Update): Promise<void>;
}

// HTTP-обработчик вебхука: секрет → защита от повтора → обработка апдейта
export function createWebhookHandler(
  deps: WebhookDeps,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    if (
      !isValidWebhookSecret(req.headers.get(WEBHOOK_SECRET_HEADER), deps.secret)
    ) {
      return new Response("Unauthorized", { status: 401 });
    }

    let update: Update;
    try {
      update = await req.json();
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
    if (!Number.isSafeInteger(update?.update_id)) {
      return new Response("Bad Request", { status: 400 });
    }

    const updateId = update.update_id;
    if (!(await deps.markProcessed(updateId))) {
      return new Response("OK");
    }

    try {
      await deps.handleUpdate(update);
    } catch (err) {
      // В лог только номер апдейта и причина, без текста сообщения
      console.error(`Ошибка обработки апдейта ${updateId}:`, errorMessage(err));
      await deps.unmarkProcessed(updateId);
      return new Response("Internal Server Error", { status: 500 });
    }
    return new Response("OK");
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
