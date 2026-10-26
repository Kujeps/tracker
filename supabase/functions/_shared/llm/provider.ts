// Нейросеть за интерфейсом: OpenRouter сегодня, GigaChat или YandexGPT завтра.

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  model: string;
  messages: LlmMessage[];
  // Есть схема — structured output по ней; нет — просто JSON-режим
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  timeoutMs: number;
}

export interface LlmResponse {
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  ms: number;
}

export type LlmErrorKind =
  | "timeout"
  | "rate_limit" // 429: лимит провайдера
  | "no_credits" // 402: кончились деньги на счёте
  | "http"
  | "empty";

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly ms: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface LlmProvider {
  complete(request: LlmRequest): Promise<LlmResponse>;
}
