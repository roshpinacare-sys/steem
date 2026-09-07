'use strict';
/**
 * src/lib/solvencyFacadeAuth423.js — ECOS V423 (Phase P311) — Solvency Facade Auth Gate
 *
 * Adds a lightweight API-key gate to solvency-tower diagnostic endpoints
 * so they are not publicly exposed.  Works as an Express middleware factory
 * that wraps the existing wireSolvencyFacade422 routes.
 *
 * Usage:
 *   const { buildAuthMiddleware423, wireSolvencyFacadeAuth423 } = require('./solvencyFacadeAuth423.js');
 *
 *   // Option A: standalone middleware for any route
 *   app.use('/api/v1/solvency/', buildAuthMiddleware423({ keys: ['secret-key'] }));
 *   wireSolvencyFacade422({ app });
 *
 *   // Option B: all-in-one convenience wrapper (adds auth + mounts facade)
 *   wireSolvencyFacadeAuth423({ app, logger, solvency, apiKeys: ['secret-key'] });
 *
 * All identifiers end in 423 (R2). No new npm deps (R3). Sacred untouched (R1).
 *
 * @version 423.0.0
 */

const crypto = require('crypto');

const FACADE_AUTH_VERSION_423   = '423.0.0';
const AUTH_HEADER_423           = 'x-ecos-api-key';
const AUTH_QUERY_PARAM_423      = 'apiKey';

// ── Key hashing (constant-time comparison) ─────────────────────────────────────

function _hashKey423(k) {
  return crypto.createHash('sha256').update(String(k)).digest('hex');
}

function _constantEqual423(a, b) {
  // Constant-time compare using crypto.timingSafeEqual
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ── buildAuthMiddleware423 ────────────────────────────────────────────────────

/**
 * Build an Express middleware that checks incoming requests for a valid API key.
 *
 * The key is read from header `x-ecos-api-key` or query param `apiKey`.
 * Keys are compared by SHA-256 hash in constant time.
 *
 * @param {object} opts
 * @param {string[]} opts.keys     — array of valid plaintext API keys
 * @param {function} [opts.audit]  — audit(type, data) hook
 * @returns {function} Express middleware
 */
function buildAuthMiddleware423(opts = {}) {
  if (!Array.isArray(opts.keys) || opts.keys.length === 0) {
    throw new Error('buildAuthMiddleware423 requires opts.keys (non-empty array) (423)');
  }
  const hashedKeys423 = opts.keys.map(k => _hashKey423(k));
  const audit423 = typeof opts.audit === 'function' ? opts.audit : null;

  return function _ecosAuthMiddleware423(req, res, next) {
    const presented = (req.headers && req.headers[AUTH_HEADER_423]) ||
                      (req.query  && req.query[AUTH_QUERY_PARAM_423]) ||
                      '';
    const presentedHash = _hashKey423(presented);

    const valid = hashedKeys423.some(h => _constantEqual423(presentedHash, h));
    if (valid) {
      if (audit423) try { audit423('solvency.auth.ok423', { path: req.path }); } catch (_) {}
      return next();
    }

    if (audit423) try { audit423('solvency.auth.denied423', { path: req.path }); } catch (_) {}
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized: valid x-ecos-api-key required',
      ecosVersion: 'V423',
    });
  };
}

// ── wireSolvencyFacadeAuth423 ─────────────────────────────────────────────────

/**
 * Convenience wrapper: adds auth middleware then wires the V422 solvency facade.
 *
 * @param {object} ctx
 * @param {object}   ctx.app      — Express app
 * @param {string[]} ctx.apiKeys  — plaintext API keys
 * @param {object}   [ctx.solvency] — solvencyFederationReexports421 module
 * @param {object}   [ctx.logger]
 * @param {function} [ctx.audit]
 * @returns {{ wired: boolean, authEnabled: boolean, endpoints: number }}
 */
function wireSolvencyFacadeAuth423(ctx) {
  const app     = ctx && ctx.app;
  const logger  = (ctx && ctx.logger) || console;
  const apiKeys = (ctx && ctx.apiKeys) || [];

  if (!app || typeof app.use !== 'function') {
    try { logger.warn({}, '[V423] no express app — solvencyFacadeAuth423 skipped'); } catch (_) {}
    return { wired: false, authEnabled: false, endpoints: 0 };
  }

  let authEnabled = false;

  // Add auth gate on solvency-tower prefix
  if (Array.isArray(apiKeys) && apiKeys.length > 0) {
    const mw = buildAuthMiddleware423({ keys: apiKeys, audit: ctx && ctx.audit });
    app.use('/api/v1/solvency/', mw);
    authEnabled = true;
    try { logger.info({}, '[V423] Solvency facade auth gate enabled'); } catch (_) {}
  } else {
    try { logger.warn({}, '[V423] No apiKeys supplied — solvency facade will be unprotected'); } catch (_) {}
  }

  // Mount underlying V422 facade
  let facadeResult = {};
  try {
    const { wireSolvencyFacade422 } = require('./solvencyTowerFacade422.js');
    facadeResult = wireSolvencyFacade422({
      app,
      logger,
      solvency: ctx && ctx.solvency,
    });
  } catch (e) {
    try { logger.warn({ err: e.message }, '[V423] solvencyTowerFacade422 not wired'); } catch (_) {}
  }

  // Auth summary endpoint
  app.get('/api/v1/solvency/tower/auth/status', (_req, res) => { // V423-AUTH-STATUS
    res.json({
      ok:          true,
      ecosVersion: 'V423',
      authEnabled,
      version:     FACADE_AUTH_VERSION_423,
    });
  });

  const totalEndpoints = (facadeResult.endpoints || 0) + 1; // +1 for auth status
  try { logger.info({}, `[V423] Solvency facade auth wired: ${totalEndpoints} endpoints, auth=${authEnabled}`); } catch (_) {}

  return { wired: true, authEnabled, endpoints: totalEndpoints };
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  FACADE_AUTH_VERSION_423,
  buildAuthMiddleware423,
  wireSolvencyFacadeAuth423,
  AUTH_HEADER_423,
  AUTH_QUERY_PARAM_423,
};
