// Кнопки под сообщениями бота и разбор их callback_data.
// В callback_data не больше 64 байт, поэтому UUID упакованы в 22 символа (ids.ts).
import type { InlineKeyboardMarkup } from "grammy/types";
import { packUuid, unpackUuid } from "./ids.ts";

export interface Button {
  text: string;
  data: string;
}

export type Keyboard = Button[][];

// Ответ пользователю: текст и, может быть, кнопки
export interface Reply {
  text: string;
  keyboard?: Keyboard;
}

export function toMarkup(keyboard: Keyboard): InlineKeyboardMarkup {
  return {
    inline_keyboard: keyboard.map((row) =>
      row.map((b) => ({ text: b.text, callback_data: b.data }))
    ),
  };
}

// Действия кнопок. Префиксы короткие, чтобы влезали два UUID.
export const callbackData = {
  undo: (entryId: string) => `u:${packUuid(entryId)}`,
  category: (entryId: string) => `c:${packUuid(entryId)}`,
  back: (entryId: string) => `b:${packUuid(entryId)}`,
  pickTransaction: (transactionId: string) => `ct:${packUuid(transactionId)}`,
  setCategory: (transactionId: string, categoryId: string) =>
    `cs:${packUuid(transactionId)}:${packUuid(categoryId)}`,
};

export type CallbackAction =
  | { action: "undo"; entryId: string }
  | { action: "category"; entryId: string }
  | { action: "back"; entryId: string }
  | { action: "pickTransaction"; transactionId: string }
  | { action: "setCategory"; transactionId: string; categoryId: string };

export function parseCallbackData(data: string): CallbackAction | null {
  const [prefix, a, b] = data.split(":");
  const first = a ? unpackUuid(a) : null;
  if (first === null) return null;
  switch (prefix) {
    case "u":
      return { action: "undo", entryId: first };
    case "c":
      return { action: "category", entryId: first };
    case "b":
      return { action: "back", entryId: first };
    case "ct":
      return { action: "pickTransaction", transactionId: first };
    case "cs": {
      const second = b ? unpackUuid(b) : null;
      return second
        ? { action: "setCategory", transactionId: first, categoryId: second }
        : null;
    }
    default:
      return null;
  }
}
