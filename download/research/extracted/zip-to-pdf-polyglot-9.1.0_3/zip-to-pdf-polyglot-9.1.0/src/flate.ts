// src/lib/polyglot/flate.ts
//
// Thin synchronous wrappers over node:zlib for the strategies and API.
// v2.2: added Brotli (15-25% better than FlateDecode for text/code).

import { deflateRawSync, inflateRawSync, deflateSync, inflateSync, brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";

/** Raw deflate (no zlib header) — for ZIP-style stored entries. */
export function deflateRaw(bytes: Uint8Array, level = 9): Uint8Array {
  return deflateRawSync(bytes, { level });
}

// v4.3 SECURITY FIX (SEC-02): cap raw inflate to prevent zip-bomb OOM.
const MAX_ZIP_INFLATED = 256 * 1024 * 1024; // 256 MB

export function inflateRaw(bytes: Uint8Array, maxBytes = MAX_ZIP_INFLATED): Uint8Array {
  const out = inflateRawSync(bytes, { maxOutputLength: maxBytes });
  if (out.length > maxBytes) {
    throw new Error(`Inflate limit exceeded: ${out.length} bytes > ${maxBytes} cap (possible zip bomb — SEC-02)`);
  }
  return out;
}

/** Zlib (FlateDecode) — for PDF streams. */
export function flateDeflate(bytes: Uint8Array, level = 9): Uint8Array {
  return deflateSync(bytes, { level });
}

// v2.5 SECURITY FIX (SEC-04): cap inflation at 512 MB to block PDF decompression bombs.
const MAX_PDF_INFLATED = 512 * 1024 * 1024;

export function flateInflate(bytes: Uint8Array): Uint8Array {
  const result = inflateSync(bytes, { maxOutputLength: MAX_PDF_INFLATED });
  if (result.length >= MAX_PDF_INFLATED && bytes.length < result.length / 100) {
    throw new Error("FlateDecode inflation exceeded 512MB limit (possible decompression bomb)");
  }
  return result;
}

/** Brotli compression — v2.2. Used for the manifest + binary store streams. */
export function brotliDeflate(bytes: Uint8Array, quality = 11): Uint8Array {
  return brotliCompressSync(bytes, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: quality } });
}

export function brotliInflate(bytes: Uint8Array): Uint8Array {
  // Brotli doesn't support maxOutputLength in node:zlib, so we check the result size.
  const result = brotliDecompressSync(bytes);
  if (result.length > MAX_PDF_INFLATED) {
    throw new Error("Brotli inflation exceeded 512MB limit (possible decompression bomb)");
  }
  return result;
}
