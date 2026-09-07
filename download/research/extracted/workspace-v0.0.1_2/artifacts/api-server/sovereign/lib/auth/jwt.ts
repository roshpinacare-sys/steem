/**
 * Sovereign JWT — HMAC-SHA256 using node:crypto only. Zero external deps.
 * Replaces jose. Implements HS256 sign/verify with standard header/payload/signature.
 * RFC 7519 compliant for the fields we use (iss, sub, exp, iat, jti, tenantId).
 */
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;          // subject (userId)
  iss?: string;         // issuer
  iat?: number;         // issued-at (seconds)
  exp?: number;         // expiry (seconds)
  jti?: string;         // jwt id (for revocation)
  tenantId?: string;    // tenant isolation
  roles?: string[];
  scopes?: string[];
  [key: string]: unknown;
}

export interface JwtOptions {
  secret: string;       // raw secret (≥32 chars recommended)
  expiresInSec?: number;
  issuer?: string;
}

export type VerifyReason = "expired" | "invalid_signature" | "malformed" | "missing_secret";

export type VerifyResult =
  | { ok: true; payload: JwtPayload }
  | { ok: false; reason: VerifyReason };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}
function b64urlRaw(buf: Buffer): string {
  return buf.toString("base64url");
}
function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Pre-computed base64url-encoded JWT header for HS256.
 * `{ alg: "HS256", typ: "JWT" }` is invariant across every token this module
 * issues, so computing JSON.stringify + base64url once at module load instead
 * of on every signJwt() call eliminates two allocations per sign operation.
 */
const JWT_HEADER_B64 = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));

// ─── Sign ─────────────────────────────────────────────────────────────────────

/**
 * Sign a JWT with HMAC-SHA256.
 * Mutates payload to set iat, exp, jti if not already set.
 */
export function signJwt(payload: JwtPayload, opts: JwtOptions): string {
  if (!opts.secret) throw new Error("JWT secret is required");

  const now = Math.floor(Date.now() / 1000);
  const p: JwtPayload = {
    iss: opts.issuer ?? "tfa",
    iat: now,
    jti: randomBytes(8).toString("hex"),
    ...payload,
  };
  if (opts.expiresInSec && !p.exp) {
    p.exp = now + opts.expiresInSec;
  }

  const header = JWT_HEADER_B64;
  const body   = b64url(JSON.stringify(p));
  const sig    = b64urlRaw(
    createHmac("sha256", opts.secret).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${sig}`;
}

// ─── Verify ───────────────────────────────────────────────────────────────────

/**
 * Verify a JWT. Returns { ok: true, payload } or { ok: false, reason }.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyJwt(token: string, secret: string): VerifyResult {
  if (!secret) return { ok: false, reason: "missing_secret" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  const [header, body, sig] = parts;
  const expected = b64urlRaw(
    createHmac("sha256", secret).update(`${header}.${body}`).digest()
  );

  // timing-safe compare
  try {
    const a = Buffer.from(sig, "base64url");
    const b = Buffer.from(expected, "base64url");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "invalid_signature" };
    }
  } catch {
    return { ok: false, reason: "invalid_signature" };
  }

  let payload: JwtPayload;
  try {
    payload = JSON.parse(b64urlDecode(body)) as JwtPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && payload.exp < now) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload };
}

// ─── Decode (no verify — for inspection only) ─────────────────────────────────
export function decodeJwt(token: string): JwtPayload | null {
  try {
    const [, body] = token.split(".");
    return JSON.parse(b64urlDecode(body)) as JwtPayload;
  } catch {
    return null;
  }
}
