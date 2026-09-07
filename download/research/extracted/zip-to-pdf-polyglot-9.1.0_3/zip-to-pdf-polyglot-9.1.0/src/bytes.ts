// src/bytes.ts
//
// Low-level byte helpers. Pure functions; safe in browser and Node.
//
// v5.0: SEC-09 fix — sanitizeEntryName() strips control characters and
// path-traversal sequences from manifest entry names before they reach the
// PDF cover page, the canonical ZIP, or any downstream tool.

import { createHash } from "node:crypto";

export function u16(buf: Uint8Array, off: number): number {
  return buf[off] | (buf[off + 1] << 8);
}

export function u32(buf: Uint8Array, off: number): number {
  return (
    (buf[off] |
      (buf[off + 1] << 8) |
      (buf[off + 2] << 16) |
      (buf[off + 3] << 24)) >>>
    0
  );
}

export function writeU16(buf: Uint8Array, off: number, val: number): void {
  buf[off] = val & 0xff;
  buf[off + 1] = (val >>> 8) & 0xff;
}

export function writeU32(buf: Uint8Array, off: number, val: number): void {
  buf[off] = val & 0xff;
  buf[off + 1] = (val >>> 8) & 0xff;
  buf[off + 2] = (val >>> 16) & 0xff;
  buf[off + 3] = (val >>> 24) & 0xff;
}

export function concatBytes(arrs: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/** Strip characters that would break out of a PDF literal string, and cap length. */
export function sanitizeForPdfText(s: string, max = 80): string {
  return s.replace(/[()\\]/g, "").replace(/[^\x20-\x7e]/g, "?").slice(0, max);
}

/**
 * SEC-09 v5.0 — sanitize a ZIP entry name before it reaches:
 *   1. The PDF cover-page text layer (prevents terminal-escape injection via
 *      ESC, CR, LF, FF in filenames from a malicious ZIP).
 *   2. The canonical ZIP output (prevents downstream tools from creating files
 *      with control-character names).
 *   3. The manifest JSON (prevents JSON/display confusion).
 *
 * Rules applied (in order):
 *   - Strip leading slashes (absolute-path sanitization — SEC-01).
 *   - Replace any path component that is exactly ".." with "__dotdot__"
 *     (path-traversal sanitization — SEC-01).
 *   - Replace C0 control bytes (0x00–0x1F) and DEL (0x7F) with "?".
 *   - Replace bytes 0x80–0xFF (high bytes that can be ambiguous in
 *     ASCII contexts) with "?" in the cover-page representation; they
 *     are left intact in the canonical ZIP (UTF-8 is fine in ZIP names).
 *
 * This function is used for the DISPLAY name in the cover page. The actual
 * bytes stored in the canonical ZIP go through a separate check in zip-writer.
 */
export function sanitizeEntryName(name: string): string {
  // Strip leading slashes
  let n = name.replace(/^\/+/, "");
  // Replace .. components
  n = n
    .split("/")
    .map((part) => (part === ".." ? "__dotdot__" : part))
    .join("/");
  // Replace control characters with ?
  n = n.replace(/[\x00-\x1f\x7f]/g, "?");
  return n;
}

/** Encode bytes as uppercase ASCII hex (ASCIIHexDecode PDF filter body). */
export function toHex(bytes: Uint8Array): Uint8Array {
  const HEX = "0123456789ABCDEF";
  const out = new Uint8Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) {
    out[i * 2] = HEX.charCodeAt(bytes[i] >> 4);
    out[i * 2 + 1] = HEX.charCodeAt(bytes[i] & 0xf);
  }
  return out;
}

/** Decode an ASCIIHexDecode stream body back into raw bytes (spec-compliant). */
export function fromHex(bytes: Uint8Array): Uint8Array {
  const HEX = "0123456789ABCDEFabcdef";
  const val: Record<string, number> = {};
  for (const c of HEX) val[c] = parseInt(c, 16);
  const digits: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const ch = String.fromCharCode(bytes[i]);
    if (ch === ">") break;
    if (ch in val) digits.push(val[ch]);
  }
  if (digits.length % 2 === 1) digits.push(0);
  const out = new Uint8Array(digits.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = (digits[i * 2] << 4) | digits[i * 2 + 1];
  }
  return out;
}

/** Find a byte subsequence; returns index or -1. */
export function findBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

const te = new TextEncoder();
const td = new TextDecoder("utf-8", { fatal: false });

export function utf8(s: string): Uint8Array {
  return te.encode(s);
}

export function fromUtf8(bytes: Uint8Array): string {
  return td.decode(bytes);
}

/**
 * Escape bytes for a PDF literal string `(...)`. Escapes the four
 * PDF-structural bytes (backslash, open/close paren, NUL). All other bytes
 * pass through — including CR — so the round trip is byte-exact.
 */
export function escapePdfLiteral(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x5c) {
      out.push(0x5c, 0x5c);
    } else if (b === 0x28) {
      out.push(0x5c, 0x28);
    } else if (b === 0x29) {
      out.push(0x5c, 0x29);
    } else if (b === 0x00) {
      out.push(0x5c, 0x30, 0x30, 0x30);
    } else {
      out.push(b);
    }
  }
  return new Uint8Array(out);
}

/**
 * Inverse of escapePdfLiteral: parse a PDF literal-string body (the bytes
 * between an opening `(` and its matching `)`), honoring backslash escapes.
 * Returns the raw bytes and the index just past the closing `)`.
 *
 * @param src  the full PDF byte stream
 * @param from index of the opening `(` in src
 */
export function unescapePdfLiteral(
  src: Uint8Array,
  from: number
): { bytes: Uint8Array; next: number } {
  if (src[from] !== 0x28) throw new Error("unescapePdfLiteral: not at '('");
  const out: number[] = [];
  let i = from + 1;
  let depth = 1;
  while (i < src.length) {
    const b = src[i];
    if (b === 0x5c) {
      const next = src[i + 1];
      if (next === 0x6e) { out.push(0x0a); i += 2; }
      else if (next === 0x72) { out.push(0x0d); i += 2; }
      else if (next === 0x74) { out.push(0x09); i += 2; }
      else if (next === 0x62) { out.push(0x08); i += 2; }
      else if (next === 0x66) { out.push(0x0c); i += 2; }
      else if (next === 0x28) { out.push(0x28); i += 2; }
      else if (next === 0x29) { out.push(0x29); i += 2; }
      else if (next === 0x5c) { out.push(0x5c); i += 2; }
      else if (next === 0x0a) { i += 2; }
      else if (next === 0x0d) {
        i += 2;
        if (src[i] === 0x0a) i += 1;
      } else if (next >= 0x30 && next <= 0x37) {
        let val = next - 0x30;
        let j = i + 2;
        let count = 1;
        while (count < 3 && j < src.length && src[j] >= 0x30 && src[j] <= 0x37) {
          val = val * 8 + (src[j] - 0x30);
          j++;
          count++;
        }
        out.push(val & 0xff);
        i = j;
      } else {
        out.push(next);
        i += 2;
      }
    } else if (b === 0x28) {
      depth++;
      out.push(b);
      i++;
    } else if (b === 0x29) {
      depth--;
      if (depth === 0) {
        return { bytes: new Uint8Array(out), next: i + 1 };
      }
      out.push(b);
      i++;
    } else {
      out.push(b);
      i++;
    }
  }
  throw new Error("unescapePdfLiteral: unterminated literal string");
}

/** Synchronous SHA-256 hex digest. */
export function sha256HexSync(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
