/**
 * encoding.ts — base64/UTF-8/byte helpers for the Contents API (which speaks
 * base64 both ways) and human-readable sizes. Pure functions, no deps.
 */

/** Decode a base64 payload as UTF-8 text (Contents API file content). */
export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** Encode UTF-8 text as base64 (for ghPutFile). */
export function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return bytesToBase64(bytes);
}

/** Encode arbitrary bytes (uploads) as base64, chunked to avoid arg limits. */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buf));
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Heuristic: does this decoded text look like a real text file? */
export function looksLikeText(text: string): boolean {
  if (text.length === 0) return true;
  let weird = 0;
  const n = Math.min(text.length, 2000);
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 0xfffd || (c < 32 && c !== 9 && c !== 10 && c !== 13)) weird++;
  }
  return weird / n < 0.02;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
