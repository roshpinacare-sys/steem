/**
 * Sovereign password hashing — node:crypto scrypt. Zero external deps.
 * Replaces bcrypt. Deterministic, no native build required.
 * Format: "scrypt$N$r$p$<salt_hex>$<hash_hex>"
 */
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

// Params are read lazily at call time so SCRYPT_N env override works in tests.
const getN = () => parseInt(process.env.SCRYPT_N ?? "", 10) || 131072;
const r = 8;
const p = 1;
const KEYLEN = 64;

// ─── Hash ────────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const N = getN();
  const salt = randomBytes(32).toString("hex");
  const hash = (await scryptAsync(password, salt, KEYLEN, { N, r, p })) as Buffer;
  return `scrypt$${N}$${r}$${p}$${salt}$${hash.toString("hex")}`;
}

// ─── Verify ──────────────────────────────────────────────────────────────────

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split("$");
  // format: scrypt $ N $ r $ p $ salt $ hash
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, sN, sr, sp, salt, storedHex] = parts;
  const params = {
    N: parseInt(sN, 10),
    r: parseInt(sr, 10),
    p: parseInt(sp, 10),
  };
  if (isNaN(params.N) || isNaN(params.r) || isNaN(params.p)) return false;

  try {
    const hash = (await scryptAsync(password, salt, KEYLEN, params)) as Buffer;
    const stored = Buffer.from(storedHex, "hex");
    if (hash.length !== stored.length) return false;
    return timingSafeEqual(hash, stored);
  } catch {
    return false;
  }
}
