/**
 * ECOS Validator JWT Auth Middleware — V63
 * ─────────────────────────────────────────────────────────────────────────────
 * מגן על endpoints ולידטור-בלבד מגישה לא מאומתת.
 *
 * ══ Endpoints מוגנים ══════════════════════════════════════════════════════════
 *   GET  /api/v1/approvals
 *   POST /api/v1/approvals/:id/resolve
 *   GET  /api/v1/validator/:id/earnings
 *   POST /api/v1/payout
 *
 * ══ Env vars ══════════════════════════════════════════════════════════════════
 *   VALIDATOR_JWT_SECRET    — HS256 signing secret. חובה בproduction.
 *                             אם לא מוגדר → DEV_PASSTHROUGH + אזהרת startup.
 *                             יצירה: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
 *
 * ══ Token format ═══════════════════════════════════════════════════════════════
 *   Standard JWT, HS256.
 *   Required claims:
 *     sub  — validatorAccountId (e.g. "validator::alice")
 *     exp  — expiry (unix timestamp)
 *   Optional claims:
 *     iss  — issuer string (ignored in verification, logged)
 *     role — must be "validator" if present
 *
 * ══ Token extraction order ════════════════════════════════════════════════════
 *   1. Authorization: Bearer <jwt>     ← primary (API clients, CLI)
 *   2. Cookie: ecos_validator_jwt=<jwt> ← [V63] fallback (browser via HttpOnly cookie)
 *
 *   Priority: Bearer header wins if both are present.
 *   Cookie fallback enables browser-initiated requests (credentials: 'include')
 *   without requiring the browser to read the token from JS.
 *
 * ══ Cookie name ══════════════════════════════════════════════════════════════
 *   ecos_validator_jwt
 *   Set by: apps/web/src/app/api/auth/validator/login/route.js (V62)
 *   Flags:  HttpOnly; SameSite=Lax; Path=/; Max-Age=28800
 *
 * ══ Client usage ═══════════════════════════════════════════════════════════════
 *   API clients:  Authorization: Bearer <jwt>
 *   Browser:      fetch(..., { credentials: 'include' }) — cookie sent automatically
 *
 * ══ No external dependencies ══════════════════════════════════════════════════
 *   Pure Node.js crypto (HMAC-SHA256). No jsonwebtoken package needed.
 *   Conforms to RFC 7515/7519 for standard JWT. Does NOT support RS256/ES256.
 *
 * ══ Timing safety ═════════════════════════════════════════════════════════════
 *   Signature comparison uses crypto.timingSafeEqual — no timing oracle.
 *   Keys and tokens are never logged.
 */

'use strict';

const crypto = require('node:crypto');

// ── Cookie name constant ──────────────────────────────────────────────────────
const COOKIE_NAME = 'ecos_validator_jwt';

// ── Secret ────────────────────────────────────────────────────────────────────
const CONFIGURED_SECRET = process.env.VALIDATOR_JWT_SECRET
  ? process.env.VALIDATOR_JWT_SECRET.trim()
  : null;

// ── Startup warning (one-shot) ────────────────────────────────────────────────
let _startupWarned = false;
function warnIfUnconfigured(log) {
  if (_startupWarned) return;
  _startupWarned = true;
  if (!CONFIGURED_SECRET) {
    const msg = [
      '[validatorAuth] ⚠️  VALIDATOR_JWT_SECRET is not set.',
      'Validator endpoints are UNAUTHENTICATED (DEV_PASSTHROUGH mode).',
      'Set VALIDATOR_JWT_SECRET in .env before any client-facing demo.',
      'Generate: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    ].join(' ');
    if (log && typeof log.warn === 'function') {
      log.warn({ component: 'validatorAuth' }, msg);
    } else {
      // eslint-disable-next-line no-console
      console.warn(msg);
    }
  }
}

// ── JWT helpers (HS256 only, no external deps) ────────────────────────────────

/**
 * Base64url decode a string (JWT component).
 * @param {string} b64url
 * @returns {Buffer}
 */
function _b64urlDecode(b64url) {
  // pad to multiple-of-4 then convert base64url → base64
  const padded = b64url + '==='.slice((b64url.length + 3) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Verify a HS256 JWT.
 *
 * @param {string} token    Raw JWT string.
 * @param {string} secret   HMAC secret.
 * @returns {{ valid: true, payload: object } | { valid: false, reason: string }}
 */
function _verifyJwt(token, secret) {
  if (typeof token !== 'string') {
    return { valid: false, reason: 'token must be a string' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'malformed JWT: expected 3 parts' };
  }

  const [headerB64, payloadB64, sigB64] = parts;

  // ── Decode header ────────────────────────────────────────────────────────
  let header;
  try {
    header = JSON.parse(_b64urlDecode(headerB64).toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed JWT header' };
  }

  if (header.alg !== 'HS256') {
    return { valid: false, reason: `unsupported algorithm: ${header.alg}` };
  }

  // ── Verify signature (timing-safe, canonical) ────────────────────────────
  // [FIX-V84] Compare canonical base64url strings rather than decoded bytes.
  // A 32-byte HMAC encodes to 43 base64url chars, where the last character only
  // carries 4 meaningful bits — meaning adjacent chars like 'a'/'b' decode to
  // identical byte buffers. Byte-level timingSafeEqual would pass for such a
  // "tampered" signature. Comparing canonical base64url strings eliminates this
  // class of padding-bit collision entirely.
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSigB64 = crypto
    .createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(signingInput)
    .digest('base64url');

  // Constant-time comparison of the canonical base64url string bytes
  if (sigB64.length !== expectedSigB64.length ||
      !crypto.timingSafeEqual(Buffer.from(sigB64), Buffer.from(expectedSigB64))) {
    return { valid: false, reason: 'invalid signature' };
  }

  // ── Decode payload ───────────────────────────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(_b64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed JWT payload' };
  }

  // ── Check exp ────────────────────────────────────────────────────────────
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number') {
    return { valid: false, reason: 'missing exp claim' };
  }
  if (nowSec >= payload.exp) {
    return { valid: false, reason: 'token expired' };
  }

  // ── Check sub ────────────────────────────────────────────────────────────
  if (!payload.sub || typeof payload.sub !== 'string') {
    return { valid: false, reason: 'missing or invalid sub claim' };
  }

  // ── Check role (optional claim) ──────────────────────────────────────────
  if (payload.role !== undefined && payload.role !== 'validator') {
    return { valid: false, reason: `role must be "validator", got "${payload.role}"` };
  }

  return { valid: true, payload };
}

// ── [V63] Cookie parser ───────────────────────────────────────────────────────
/**
 * Extract a named cookie value from the Cookie header.
 * Handles: "a=1; b=val; c=x" → get('b') → 'val'
 *
 * No external deps. Only used for ecos_validator_jwt.
 * Does not URL-decode — JWT characters are all safe (base64url + dots).
 *
 * @param {string} cookieHeader  raw req.headers.cookie string
 * @param {string} name          cookie name to look up
 * @returns {string|null}
 */
function _parseCookieValue(cookieHeader, name) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  // Split on '; ' (semicolon + optional space) and find the matching pair
  const pairs = cookieHeader.split(/;\s*/);
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const k = pair.slice(0, eqIdx).trim();
    if (k === name) {
      return pair.slice(eqIdx + 1).trim() || null;
    }
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check validator JWT auth on an incoming request.
 *
 * Token extraction order (V63):
 *   1. Authorization: Bearer <jwt>       ← primary
 *   2. Cookie: ecos_validator_jwt=<jwt>  ← fallback (browser HttpOnly cookie)
 *
 * Returns { ok: true, validatorId: string } on success.
 * Returns { ok: false, status: number, error: string, code: string } on failure.
 *
 * @param {import('http').IncomingMessage} req
 * @param {object} [log]  pino logger (optional)
 */
function checkValidatorAuth(req, log) {
  const secret = CONFIGURED_SECRET;
  // DEV_PASSTHROUGH when secret not configured
  if (!secret) {
    if (log && typeof log.warn === 'function') {
      log.warn({ component: 'validatorAuth', path: req.url },
        'DEV_PASSTHROUGH: validator auth skipped (VALIDATOR_JWT_SECRET not set)');
    }
    return { ok: true, validatorId: null, passthrough: true };
  }

  // ── 1. Try Authorization: Bearer <jwt> ────────────────────────────────────
  const authHeader = (req.headers && req.headers['authorization']) || '';
  let token = null;

  if (authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim() || null;
  }

  // ── [V63] 2. Cookie fallback: ecos_validator_jwt ──────────────────────────
  if (!token) {
    const cookieHeader = (req.headers && req.headers['cookie']) || '';
    token = _parseCookieValue(cookieHeader, COOKIE_NAME);
    if (token && log && typeof log.debug === 'function') {
      log.debug({ component: 'validatorAuth', path: req.url },
        'JWT extracted from HttpOnly cookie (cookie fallback path)');
    }
  }

  // ── No token found in either location ────────────────────────────────────
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: `Missing authentication. Provide: Authorization: Bearer <jwt> or HttpOnly cookie ${COOKIE_NAME}`,
      code: 'MISSING_AUTH',
    };
  }

  const result = _verifyJwt(token, secret);

  if (!result.valid) {
    if (log && typeof log.warn === 'function') {
      log.warn({ component: 'validatorAuth', reason: result.reason }, 'JWT auth failed');
    }
    return {
      ok: false,
      status: 401,
      error: `Invalid token: ${result.reason}`,
      code: 'INVALID_TOKEN',
    };
  }

  // Validation passed — return extracted validatorId
  return { ok: true, validatorId: result.payload.sub, passthrough: false };
}

/**
 * Issue a HS256 JWT for a validator. Used by the CLI helper and tests.
 * NOT exposed as an HTTP endpoint in this middleware.
 *
 * @param {string} validatorId    e.g. "validator::alice"
 * @param {number} [ttlSeconds]   default 86400 (24h)
 * @param {string} [secret]       override (uses CONFIGURED_SECRET by default)
 * @returns {string}  Signed JWT
 */
function issueValidatorToken(validatorId, ttlSeconds = 86400, secret = CONFIGURED_SECRET) {
  if (!secret) throw new Error('issueValidatorToken: VALIDATOR_JWT_SECRET is not set');
  if (!validatorId || typeof validatorId !== 'string') {
    throw new TypeError('issueValidatorToken: validatorId must be a non-empty string');
  }

  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub:  validatorId,
    role: 'validator',
    iss:  'ecos-api',
    iat:  Math.floor(Date.now() / 1000),
    exp:  Math.floor(Date.now() / 1000) + ttlSeconds,
  })).toString('base64url');

  const sig = crypto
    .createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${sig}`;
}

/**
 * verifyJwt — public wrapper around _verifyJwt for use by ValidatorHub [V97].
 * Accepts (token, secret) and returns { valid, payload } or { valid: false, reason }.
 * @param {string} token
 * @param {string} secret
 * @returns {{ valid: boolean, payload?: object, reason?: string }}
 */
function verifyJwt(token, secret) {
  return _verifyJwt(token, secret);
}

module.exports = { checkValidatorAuth, issueValidatorToken, warnIfUnconfigured, _parseCookieValue, verifyJwt };
