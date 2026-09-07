/**
 * ECOS Idempotency Middleware
 * ---------------------------
 * Wraps a Next.js App Router POST handler with strict, persistent
 * idempotency semantics backed by the `idempotency_keys` table.
 *
 * Contract:
 *   Client sends header:    Idempotency-Key: <opaque-string>
 *   Server computes:        key_hash = sha256( route_tag || ':' || key )
 *   Server computes:        request_fingerprint = sha256( canonical(body) )
 *
 *   On first call with (route_tag, key_hash):
 *      - run handler -> { status, body }
 *      - persist (route_tag, key_hash, fingerprint, status, body, expires)
 *      - return the response
 *
 *   On retry with the SAME (route_tag, key_hash) AND same fingerprint:
 *      - skip the handler; return the cached body verbatim with header
 *        `X-Idempotent-Replay: true`
 *
 *   On retry with the SAME key but DIFFERENT fingerprint:
 *      - return 422 with code IDEMPOTENCY_KEY_CONFLICT and DO NOT execute
 *        the handler. This is the crucial safety net against an AI worker
 *        accidentally reusing a key for a different mission.
 *
 *   On missing/blank Idempotency-Key:
 *      - run handler normally; no row is persisted.
 *
 * The wrapper is framework-agnostic-ish: it expects a `Request` (Web
 * standard) and returns a `Response` (Web standard). Next.js's NextResponse
 * extends Response so it interoperates seamlessly.
 *
 * [FIX-V26-IDEM] logger injection:
 *   opts.logger — optional pino logger (or any { error: Function } object).
 *   The 1 console.error('[idempotency] cache write failed') call replaced
 *   with opts.logger.error when logger is provided.
 *   Fallback: console.error (backward-compat — opts.logger is optional).
 */

'use strict';

const crypto = require('node:crypto');
const { getPool } = require('../db/pool');
const { canonicalize } = require('../lib/auditLog');

// 24h is plenty for retry windows. Adjust per route via the wrapper opts.
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

function _sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function _isPositiveInt(n) { return Number.isInteger(n) && n > 0; }

/**
 * Validate the structural shape of an Idempotency-Key header.
 *
 * We reject:
 *   - empty / whitespace-only
 *   - longer than 255 chars
 *   - contains control characters
 * We accept anything else opaquely.
 */
function _validateKey(raw) {
  if (raw === null || raw === undefined) return { ok: false, reason: 'missing' };
  if (typeof raw !== 'string') return { ok: false, reason: 'not_a_string' };
  const k = raw.trim();
  if (!k) return { ok: false, reason: 'empty' };
  if (k.length > 255) return { ok: false, reason: 'too_long' };
  // No control chars (allow printable ASCII + non-control unicode).
  if (/[\x00-\x1f\x7f]/.test(k)) return { ok: false, reason: 'control_chars' };
  return { ok: true, key: k };
}

/**
 * Compute a deterministic fingerprint of the JSON request body. Both sender
 * and receiver agree on canonical (sorted-key) JSON to avoid spurious
 * mismatches from key order or whitespace differences.
 */
function _fingerprintBody(parsed) {
  return _sha256Hex(canonicalize(parsed ?? null));
}

/**
 * Wrap an async (req, ctx) => Response handler with idempotent caching.
 *
 * @param {object} opts
 * @param {string} opts.route     Stable route tag, e.g.
 *                                'POST /api/mission/[missionId]/approvals'
 * @param {number} [opts.ttlSeconds]  Cache TTL (default 24h)
 * @param {boolean} [opts.required]   When true, return 400 if the client
 *                                    didn't send an Idempotency-Key. Use
 *                                    for write routes called by the AI
 *                                    worker.
 * @param {{ error: Function }|null} [opts.logger]
 *                                    Optional pino logger (or compatible).
 *                                    [FIX-V26-IDEM] Cache write failures are
 *                                    routed here when provided; fallback to
 *                                    console.error when absent.
 * @param {(req, ctx)=>Promise<Response>} handler
 * @returns {(req, ctx)=>Promise<Response>}
 */
function withIdempotency(opts, handler) {
  if (!opts || !opts.route) {
    throw new TypeError('withIdempotency: opts.route is required');
  }
  if (typeof handler !== 'function') {
    throw new TypeError('withIdempotency: handler must be a function');
  }
  const route    = opts.route;
  const ttl      = _isPositiveInt(opts.ttlSeconds) ? opts.ttlSeconds : DEFAULT_TTL_SECONDS;
  const required = !!opts.required;
  // [FIX-V26-IDEM] optional logger — fallback to console.error
  const log      = (opts.logger && typeof opts.logger.error === 'function') ? opts.logger : null;

  return async function idempotentHandler(req, ctx) {
    const headerVal = req.headers?.get
      ? req.headers.get('idempotency-key')
      : (req.headers && req.headers['idempotency-key']);

    const keyCheck = _validateKey(headerVal);
    if (!keyCheck.ok) {
      if (required) {
        return _json(400, {
          error: 'idempotency_key_required',
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          reason: keyCheck.reason,
        });
      }
      // Not required -- run the handler with no caching.
      return handler(req, ctx);
    }

    // Read body ONCE; pass a re-readable copy to the handler.
    let bodyText = '';
    try { bodyText = await req.text(); }
    catch { bodyText = ''; }

    let parsedBody = null;
    if (bodyText) {
      try { parsedBody = JSON.parse(bodyText); }
      catch {
        return _json(400, { error: 'invalid_json', code: 'BAD_REQUEST' });
      }
    }

    const keyHash     = _sha256Hex(route + ':' + keyCheck.key);
    const fingerprint = _fingerprintBody(parsedBody);

    // 1) Look for an existing cached response.
    const pool = getPool();
    const existing = await pool.query(
      `SELECT request_fingerprint, status_code, response_body, expires_at
       FROM idempotency_keys
       WHERE route = $1 AND key_hash = $2
       LIMIT 1`,
      [route, keyHash]
    );

    if (existing.rowCount) {
      const row = existing.rows[0];
      const expired = row.expires_at instanceof Date
        ? row.expires_at.getTime() < Date.now()
        : new Date(row.expires_at).getTime() < Date.now();

      if (!expired) {
        if (row.request_fingerprint !== fingerprint) {
          return _json(422, {
            error: 'idempotency_key_conflict',
            code: 'IDEMPOTENCY_KEY_CONFLICT',
            message: 'This Idempotency-Key was used with a different request body.',
          });
        }
        // Replay cached response.
        const headers = { 'X-Idempotent-Replay': 'true' };
        return _json(row.status_code, row.response_body, headers);
      }
      // Expired -- delete so the INSERT below can succeed cleanly.
      await pool.query(
        `DELETE FROM idempotency_keys WHERE route = $1 AND key_hash = $2`,
        [route, keyHash]
      );
    }

    // 2) Reconstruct the request with the buffered body so the handler can
    //    still read it. We hand a synthetic object that exposes .json() /
    //    .text() / .headers.get the way Next.js handlers expect.
    const synthetic = _wrapRequestWithBody(req, bodyText, parsedBody);

    let res;
    try {
      res = await handler(synthetic, ctx);
    } catch (err) {
      // Don't cache server errors; let the caller retry without conflict.
      throw err;
    }

    // Materialize the Response so we can both cache it and return it.
    let status = res.status;
    let bodyOut = null;
    let bodyForCache = null;
    try {
      const t = await res.clone().text();
      bodyForCache = t ? JSON.parse(t) : null;
      bodyOut = t;
    } catch {
      // Non-JSON response -- still return it but skip caching.
      return res;
    }

    // Cache only 2xx by default. 4xx errors are not cached so the client
    // can correct their request and retry with the same key.
    if (status >= 200 && status < 300 && bodyForCache !== null) {
      try {
        await pool.query(
          `INSERT INTO idempotency_keys
              (route, key_hash, request_fingerprint, status_code, response_body, expires_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, now() + ($6 || ' seconds')::interval)
           ON CONFLICT (route, key_hash) DO NOTHING`,
          [route, keyHash, fingerprint, status, JSON.stringify(bodyForCache), String(ttl)]
        );
      } catch (err) {
        // Cache write failure must not affect the response we already computed.
        // [FIX-V26-IDEM] was: console.error('[idempotency] cache write failed:', err.message)
        if (log) {
          log.error({ component: 'idempotency', route, err: err.message }, 'cache write failed');
        } else {
          // eslint-disable-next-line no-console
          console.error('[idempotency] cache write failed:', err.message);
        }
      }
    }

    // Re-emit the body fresh (we already consumed the clone).
    return new Response(bodyOut, {
      status,
      headers: res.headers,
    });
  };
}

function _wrapRequestWithBody(originalReq, bodyText, parsedBody) {
  const headers = originalReq.headers;
  return {
    method:  originalReq.method,
    url:     originalReq.url,
    headers,
    text:    async () => bodyText,
    json:    async () => parsedBody,
    arrayBuffer: async () => new TextEncoder().encode(bodyText).buffer,
    // Preserve common Next/Edge fields that some handlers read.
    nextUrl: originalReq.nextUrl,
    cookies: originalReq.cookies,
  };
}

function _json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

/**
 * Maintenance: purge expired rows. Call from a daily cron.
 */
async function purgeExpired() {
  const { rowCount } = await getPool().query(
    `DELETE FROM idempotency_keys WHERE expires_at < now()`
  );
  return rowCount;
}

module.exports = { withIdempotency, purgeExpired };
