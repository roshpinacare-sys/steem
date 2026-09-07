/**
 * ECOS API-Key / JWT Auth Middleware — V86
 * ------------------------------------
 * מגן על POST /api/v1/deposit מגישה לא מאומתת.
 *
 * הגדרה:
 *   ECOS_DEPOSIT_API_KEY=<secret>   — API key, מגדיר ב-.env (production חובה)
 *   JWT_SECRET=<secret>             — JWT signing secret (default: 'ecos-dev-secret')
 *
 * Header מקובל (אחד מהם):
 *   1. X-API-Key: <raw-key>                 — Raw API key comparison (timing-safe)
 *   2. Authorization: Bearer <jwt-token>    — JWT HS256 verification (JWT_SECRET)
 *
 * סדר בדיקה:
 *   1. X-API-Key header (unchanged raw-key path)
 *   2. Authorization: Bearer <jwt> — verified as JWT
 *   3. אם אף אחד לא קיים / שניהם שגויים → 401 { error: 'unauthorized' }
 *
 * מצבים:
 *   ECOS_DEPOSIT_API_KEY לא מוגדר → DEV_PASSTHROUGH + אזהרה בלוג.
 *     ⚠️  לא לעשות לפני demo עם לקוח.
 *   ECOS_DEPOSIT_API_KEY מוגדר   → key שגוי / JWT שגוי / חסר → 401.
 *
 * עקרון:
 *   השוואת key ב-timingSafeEqual כדי למנוע timing attacks.
 *   המפתח לא נרשם בלוג בשום מצב.
 *
 * שימוש ב-server:
 *   const { checkDepositAuth } = require('./middleware/apiKeyAuth');
 *
 *   const authResult = checkDepositAuth(req, logger);
 *   if (!authResult.ok) return json(res, authResult.status, { error: authResult.error });
 */

'use strict';

const crypto = require('node:crypto');

// ── מפתח API מוגדר ב-env ─────────────────────────────────────────────────────
const CONFIGURED_KEY = process.env.ECOS_DEPOSIT_API_KEY
  ? process.env.ECOS_DEPOSIT_API_KEY.trim()
  : null;

// ── JWT secret — [FIX-BUG-E] no insecure hardcoded default ─────────────────
// In production, validateConfig() enforces JWT_SECRET >= 32 chars (not the dev value).
// In development/test the 'ecos-dev-secret' fallback is intentional for local use only.
const _jwtEnv = process.env.JWT_SECRET || '';
const JWT_SECRET = _jwtEnv || (process.env.NODE_ENV === 'production' ? '' : 'ecos-dev-secret');

// ── אזהרה חד-פעמית ב-startup ────────────────────────────────────────────────
// מופעלת כשהמודול נטען לראשונה ב-ecos-api-server.js
let _startupWarned = false;
function warnIfUnconfigured(log) {
  if (_startupWarned) return;
  _startupWarned = true;
  if (!CONFIGURED_KEY) {
    const msg = [
      '[apiKeyAuth] ⚠️  ECOS_DEPOSIT_API_KEY is not set.',
      'POST /api/v1/deposit is UNAUTHENTICATED (DEV_PASSTHROUGH mode).',
      'Set ECOS_DEPOSIT_API_KEY in .env before any client-facing demo.',
    ].join(' ');
    if (log && typeof log.warn === 'function') {
      log.warn({ component: 'auth' }, msg);
    } else {
      console.warn(msg);
    }
  }
}

/**
 * בדוק auth על request נכנס.
 *
 * @param {http.IncomingMessage} req  — Node.js IncomingMessage
 * @param {object} [log]              — pino logger (אופציונלי)
 * @returns {{ ok: true } | { ok: false, status: number, error: string, code: string }}
 */
function checkDepositAuth(req, log) {
  // אם לא הוגדר key — DEV_PASSTHROUGH
  if (!CONFIGURED_KEY) {
    if (log && typeof log.warn === 'function') {
      log.warn({ component: 'auth', path: '/deposit' },
        'DEV_PASSTHROUGH: deposit auth skipped (ECOS_DEPOSIT_API_KEY not set)');
    }
    return { ok: true };
  }

  const headers = req.headers || {};

  // ── Path 1: X-API-Key header (raw key, timing-safe comparison) ───────────
  const apiKeyHeader = (headers['x-api-key'] || '').trim();
  if (apiKeyHeader) {
    if (_timingSafeEqual(apiKeyHeader, CONFIGURED_KEY)) {
      return { ok: true };
    }
    if (log && typeof log.warn === 'function') {
      log.warn({ component: 'auth', path: '/deposit' }, 'Invalid API key on /deposit (X-API-Key)');
    }
    return {
      ok: false,
      status: 401,
      error: 'unauthorized',
      code: 'INVALID_AUTH',
    };
  }

  // ── Path 2: Authorization: Bearer <jwt> ───────────────────────────────────
  const authHeader = headers['authorization'] || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const jwtResult = _verifyJwt(token, JWT_SECRET);
      if (jwtResult.valid) {
        return { ok: true };
      }
      if (log && typeof log.warn === 'function') {
        log.warn({ component: 'auth', path: '/deposit', reason: jwtResult.reason },
          'Invalid JWT Bearer token on /deposit');
      }
      return {
        ok: false,
        status: 401,
        error: 'unauthorized',
        code: 'INVALID_JWT',
      };
    }
  }

  // ── Neither present ───────────────────────────────────────────────────────
  return {
    ok: false,
    status: 401,
    error: 'unauthorized',
    code: 'MISSING_AUTH',
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Verify a HS256 JWT using Node.js crypto only.
 * Pattern mirrors validatorAuth.js _verifyJwt().
 *
 * @param {string} token
 * @param {string} secret
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

  // Decode header
  let header;
  try {
    header = JSON.parse(_b64urlDecode(headerB64).toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed JWT header' };
  }
  if (header.alg !== 'HS256') {
    return { valid: false, reason: `unsupported algorithm: ${header.alg}` };
  }

  // Verify signature (canonical base64url comparison, timing-safe)
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSigB64 = crypto
    .createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(signingInput)
    .digest('base64url');

  if (sigB64.length !== expectedSigB64.length ||
      !crypto.timingSafeEqual(Buffer.from(sigB64), Buffer.from(expectedSigB64))) {
    return { valid: false, reason: 'invalid signature' };
  }

  // Decode payload
  let payload;
  try {
    payload = JSON.parse(_b64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed JWT payload' };
  }

  // Check exp
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number') {
    return { valid: false, reason: 'missing exp claim' };
  }
  if (payload.exp < nowSec) {
    return { valid: false, reason: 'token expired' };
  }

  return { valid: true, payload };
}

/**
 * Base64url decode a string (JWT component).
 * @param {string} b64url
 * @returns {Buffer}
 */
function _b64urlDecode(b64url) {
  const padded = b64url + '==='.slice((b64url.length + 3) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Timing-safe comparison of two strings.
 */
function _timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    const dummy = Buffer.alloc(bufB.length);
    crypto.timingSafeEqual(dummy, bufB);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { checkDepositAuth, warnIfUnconfigured, _verifyJwt };
