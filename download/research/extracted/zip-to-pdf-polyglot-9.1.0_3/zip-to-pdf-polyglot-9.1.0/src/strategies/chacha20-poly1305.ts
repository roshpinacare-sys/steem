// src/strategies/chacha20-poly1305.ts — v8.1 NEW STRATEGY
//
// ChaCha20-Poly1305 AEAD passphrase-protected polyglot PDF.
//
// ChaCha20-Poly1305 is the other IETF AEAD standard (RFC 8439), used in
// TLS 1.3 and WireGuard. It provides equivalent security to AES-256-GCM
// but is faster on platforms WITHOUT hardware AES-NI (most mobile SoCs,
// older ARM chips). Node.js exposes it natively via OpenSSL.
//
// Key derivation: PBKDF2-SHA256, 600 000 iterations (NIST SP 800-132, 2024)
// Encryption:     ChaCha20-Poly1305 (RFC 8439 IETF variant, 12-byte nonce)
// Auth tag:       Poly1305 (128-bit)
//
// Stream payload format: <salt_hex>:<nonce_hex>:<tag_hex>:<ciphertext_hex>
//
// isTrueByteLevelPolyglot: false
// isExtractable: true (given the correct passphrase)

import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
  type CipherCCM,
} from "node:crypto";
import { findBytes, toHex, fromHex, utf8 } from "../bytes";
import { readZipStructure } from "../zip-reader";
import { assemblePdf, buildCatalog, buildCoverPage, streamObject } from "../pdf-writer";
import type { StrategyModule } from "../polyglot";

export const name = "chacha20-poly1305" as const;
export const label =
  "ChaCha20-Poly1305 — RFC 8439 AEAD + PBKDF2 (TLS 1.3 cipher, best for no-AES-NI) [v8.1]";
export const isTrueByteLevelPolyglot = false;
export const isExtractable = true;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SALT_LEN = 16;          // 128-bit PBKDF2 salt
const NONCE_LEN = 12;         // 96-bit ChaCha20-Poly1305 IETF nonce (RFC 8439)
const TAG_LEN = 16;           // 128-bit Poly1305 tag
const KEY_LEN = 32;           // 256-bit key
const PBKDF2_ITERS = 600_000;
const PBKDF2_DIGEST = "sha256" as const;

const ALGO = "chacha20-poly1305" as const;
const MARKER = utf8("/PolyglotChaCha20Poly1305");
const STREAM_OPEN = utf8("stream\n");
const STREAM_CLOSE = utf8("\nendstream");

// ---------------------------------------------------------------------------
// Key derivation (same as encrypted.ts for API consistency)
// ---------------------------------------------------------------------------
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERS, KEY_LEN, PBKDF2_DIGEST);
}

// ---------------------------------------------------------------------------
// ChaCha20-Poly1305 encrypt / decrypt
// ---------------------------------------------------------------------------
function chachaEncrypt(
  key: Buffer,
  nonce: Buffer,
  plaintext: Uint8Array
): { ciphertext: Buffer; authTag: Buffer } {
  const cipher = createCipheriv(ALGO, key, nonce, {
    authTagLength: TAG_LEN,
  } as any);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(plaintext)),
    (cipher as any).final(),
  ]);
  return { ciphertext: ct, authTag: (cipher as any).getAuthTag() };
}

function chachaDecrypt(
  key: Buffer,
  nonce: Buffer,
  ciphertext: Buffer,
  authTag: Buffer
): Buffer {
  const decipher = createDecipheriv(ALGO, key, nonce, {
    authTagLength: TAG_LEN,
  } as any);
  (decipher as any).setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    (decipher as any).final(), // throws on auth failure
  ]);
}

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------
function bufToHex(b: Buffer | Uint8Array): string {
  return Buffer.from(b).toString("hex").toUpperCase();
}
function hexToBuf(h: string): Buffer {
  return Buffer.from(h, "hex");
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
export function build(
  zipBuf: Uint8Array,
  origName: string,
  opts: { onLog?: (m: string) => void; passphrase?: string } = {}
): { bytes: Uint8Array; entryCount: number } {
  const onLog = opts.onLog ?? (() => {});
  const passphrase = opts.passphrase ?? "polyglot";

  const { entryCount } = readZipStructure(zipBuf);

  const salt = randomBytes(SALT_LEN);
  const nonce = randomBytes(NONCE_LEN);
  const key = deriveKey(passphrase, salt);
  onLog(`PBKDF2-SHA256 key derivation: ${PBKDF2_ITERS / 1000}K iters, salt=${bufToHex(salt).slice(0, 8)}…`);

  const { ciphertext, authTag } = chachaEncrypt(key, nonce, zipBuf);
  onLog(`ChaCha20-Poly1305 encrypted ${zipBuf.length} B → ${ciphertext.length} B + 16 B tag`);

  const payload = [
    bufToHex(salt),
    bufToHex(nonce),
    bufToHex(authTag),
    bufToHex(ciphertext),
  ].join(":");
  const payloadBytes = utf8(payload);

  const attachName = origName || "archive.zip";
  const { objects, pagesNum, nextNum } = buildCoverPage(2, [
    { text: "ChaCha20-Poly1305 encrypted ZIP archive.", size: 16 },
    { text: "KDF: PBKDF2-SHA256 (600K iter) | Cipher: ChaCha20-Poly1305 [v8.1]" },
    { text: "File: " + attachName + "  (" + entryCount + " file(s) inside)" },
    { text: "Extract: zip2pdf extract --strategy chacha20-poly1305 --passphrase <pass>" },
  ]);

  const cipherstreamNum = nextNum;
  const catalogNum = 1;

  objects[cipherstreamNum] = streamObject(
    cipherstreamNum,
    `/Type /PolyglotChaCha20Poly1305 /KDF /PBKDF2-SHA256 /Iters ${PBKDF2_ITERS} /Cipher /ChaCha20-Poly1305`,
    payloadBytes
  );

  objects[catalogNum] = buildCatalog(
    catalogNum,
    pagesNum,
    ` /Polyglot << /Version 8 /Strategy /chacha20-poly1305 /EncryptedStream ${cipherstreamNum} 0 R >>`
  );

  const bytes = assemblePdf(objects, catalogNum);
  onLog(`assembled ChaCha20-Poly1305 PDF: ${bytes.length} bytes`);
  return { bytes, entryCount };
}

// ---------------------------------------------------------------------------
// Extract
// ---------------------------------------------------------------------------
export function extract(
  buf: Uint8Array,
  opts: { onLog?: (m: string) => void; passphrase?: string } = {}
): { bytes: Uint8Array; entryCount: number } {
  const onLog = opts.onLog ?? (() => {});
  const passphrase = opts.passphrase ?? "polyglot";

  const markerOff = findBytes(buf, MARKER);
  if (markerOff < 0) {
    throw new Error("No /PolyglotChaCha20Poly1305 marker — not a chacha20-poly1305 file.");
  }

  const streamOff = findBytes(buf, STREAM_OPEN, markerOff);
  if (streamOff < 0) throw new Error("Found marker but no stream keyword.");
  const dataStart = streamOff + STREAM_OPEN.length;
  const dataEnd = findBytes(buf, STREAM_CLOSE, dataStart);
  if (dataEnd < 0) throw new Error("No matching endstream.");

  const payload = new TextDecoder("ascii").decode(buf.slice(dataStart, dataEnd));
  const parts = payload.split(":");
  if (parts.length !== 4) {
    throw new Error(`Unexpected payload format: ${parts.length} colon-parts (expected 4).`);
  }

  const [saltHex, nonceHex, tagHex, ctHex] = parts;
  onLog(`ChaCha20-Poly1305 extract: salt=${saltHex.slice(0, 8)}… nonce=${nonceHex.slice(0, 8)}…`);

  const salt = hexToBuf(saltHex);
  const nonce = hexToBuf(nonceHex);
  const authTag = hexToBuf(tagHex);
  const ciphertext = hexToBuf(ctHex);
  const key = deriveKey(passphrase, salt);

  let plaintext: Buffer;
  try {
    plaintext = chachaDecrypt(key, nonce, ciphertext, authTag);
  } catch {
    throw new Error(
      "ChaCha20-Poly1305 authentication failed — wrong passphrase or tampered file."
    );
  }

  const zipBytes = new Uint8Array(plaintext);
  const { entryCount } = readZipStructure(zipBytes);
  onLog(`decrypted ${zipBytes.length} bytes → ${entryCount} entries`);
  return { bytes: zipBytes, entryCount };
}

const _module: StrategyModule = {
  name,
  label,
  isTrueByteLevelPolyglot,
  isExtractable,
  build,
  extract,
};
export default _module;
