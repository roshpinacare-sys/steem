/**
 * Sovereign TOTP — RFC 6238 / RFC 4226, node:crypto only. Zero external deps.
 * Replaces otplib. Implements HOTP counter-based OTP, and TOTP (time-based).
 *
 * Algorithm: HMAC-SHA1(secret, counter_as_8_bytes) → 31-bit truncation → 6-digit code.
 * Window: ±1 step (30s) to account for clock drift.
 */
import { createHmac, randomBytes } from "node:crypto";

const STEP_SEC  = 30;
const DIGITS    = 6;
const WINDOW    = 1;   // allow ±1 step
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * O(1) decode lookup — replaces BASE32_CHARS.indexOf(c) (O(32) scan per char)
 * with a pre-built Map. Each TOTP decode is a per-character scan of the
 * encoded secret; for a typical 32-char secret this eliminates 32 × O(32)
 * linear scans in favour of 32 × O(1) Map lookups. Matches the LADDER_RANK
 * pattern from contextual-risk.ts. Unknown chars map to undefined → -1
 * (fail-closed: same throw semantics as before).
 */
const BASE32_DECODE_MAP: ReadonlyMap<string, number> = new Map(
  Array.from(BASE32_CHARS, (c, i) => [c, i] as [string, number]),
);

// ─── Base32 ───────────────────────────────────────────────────────────────────

export function generateSecret(bytes = 20): string {
  const raw = randomBytes(bytes);
  let out = "";
  let bits = 0, val = 0;
  for (const b of raw) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_CHARS[(val >> bits) & 0x1f];
    }
  }
  if (bits > 0) out += BASE32_CHARS[(val << (5 - bits)) & 0x1f];
  return out;
}

function base32Decode(s: string): Buffer {
  const str = s.toUpperCase().replace(/=+$/, "");
  const bytes: number[] = [];
  let bits = 0, val = 0;
  for (const c of str) {
    const idx = BASE32_DECODE_MAP.get(c) ?? -1;
    if (idx === -1) throw new Error(`Invalid base32 char: ${c}`);
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((val >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

// ─── HOTP (RFC 4226) ─────────────────────────────────────────────────────────

// Efficiency: takes the already-decoded key so callers that probe multiple
// counters for the same secret (verifyTotp's ±WINDOW loop) decode the base32
// secret once instead of re-running base32Decode (and its per-char
// BASE32_DECODE_MAP lookup) on every window step.
function hotp(key: Buffer, counter: bigint): string {
  const msg = Buffer.alloc(8);
  // write counter as big-endian 8 bytes
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  const mac = createHmac("sha1", key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, "0");
}

// ─── TOTP (RFC 6238) ─────────────────────────────────────────────────────────

function counter(atMs = Date.now()): bigint {
  return BigInt(Math.floor(atMs / 1000 / STEP_SEC));
}

/** Generate current TOTP code for a secret. */
export function generateTotp(secret: string, atMs = Date.now()): string {
  return hotp(base32Decode(secret), counter(atMs));
}

/**
 * Verify a TOTP code. Accepts ±WINDOW steps to handle clock drift.
 * Returns true if valid, false otherwise.
 */
export function verifyTotp(secret: string, code: string, atMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const key = base32Decode(secret); // decode once, reused for every window step
  const c = counter(atMs);
  for (let i = -WINDOW; i <= WINDOW; i++) {
    if (hotp(key, c + BigInt(i)) === code) return true;
  }
  return false;
}

/** Build an otpauth:// URI for QR code generation. */
export function totpUri(secret: string, account: string, issuer = "TFA"): string {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(account)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SEC}`;
}
