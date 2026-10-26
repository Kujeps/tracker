// Упаковка UUID в 22 символа base64url: в callback_data Telegram
// помещается не больше 64 байт, а два обычных UUID занимают 72.

export function packUuid(uuid: string): string {
  const hex = uuid.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    throw new Error("Некорректный UUID");
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

// null — строка не похожа на упакованный UUID
export function unpackUuid(packed: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(packed)) {
    return null;
  }
  const binary = atob(packed.replaceAll("-", "+").replaceAll("_", "/") + "==");
  const hex = Array.from(
    binary,
    (ch) => ch.charCodeAt(0).toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20)}`;
}
