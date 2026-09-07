'use strict';
/**
 * lib/identityGateMiddleware394.js — ECOS V394 (Phase P282) — Identity Gate Middleware
 *
 * Direction 3 (V394): Express middleware factory that reads { actorId, claim, signature }
 * from req.body (or optionally req.headers / req.query via opts.source) and calls the
 * appropriate V393 enforcer before passing to the route handler.
 * Reduces boilerplate in wiring new identity-protected endpoints.
 *
 * Exports:
 *   createIdentityGateMiddleware394(opts)
 *     — returns an Express middleware function: (req, res, next) => void
 *
 * Pure JS, Node built-ins only (R3). All identifiers end with 394 (R2).
 * Sacred files untouched (R1). V361–V393 preserved (R6).
 *
 * @version 394.0.0
 */

const IDENTITY_GATE_MIDDLEWARE_VERSION_394  = '394.0.0';
const IDENTITY_GATE_MIDDLEWARE_SCHEMA_394   = 'ecos.sovereign.identity.gate.middleware/v394';
const IDENTITY_GATE_MIDDLEWARE_EVENT_394    = 'identity_gate_middleware_event_type_394';
const IDENTITY_GATE_MIDDLEWARE_DENY_EVENT_394 = 'identity_gate_middleware_deny_event_type_394';

class IdentityGateMiddlewareError394 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'IdentityGateMiddlewareError394';
    this.code = code || 'MIDDLEWARE_ERROR';
    this.statusCode = 400;
  }
}

/**
 * Create an Express middleware that enforces identity before a route handler.
 *
 * @param {object} opts
 * @param {object}   opts.enforcer          — identityCallsiteEnforcer393 instance
 * @param {string}   opts.action            — 'credit_transfer' | 'reward_issuance'
 * @param {function} [opts.audit]           — (type, payload) => void
 * @param {object}   [opts.logger]
 * @param {string}   [opts.source]          — where to read identity fields: 'body' (default) | 'header' | 'query'
 * @param {object}   [opts.fieldMap]        — override field names; default { actorId:'actorId', claim:'claim', signature:'signature', rawPubkey:'rawPubkey' }
 * @param {boolean}  [opts.attachToReq]     — if true, attach enforcement result as req._identityResult394 (default: true)
 * @returns {function} Express middleware
 */
function createIdentityGateMiddleware394(opts = {}) {
  if (!opts.enforcer ||
      typeof opts.enforcer.enforceTransfer393  !== 'function' ||
      typeof opts.enforcer.enforceReward393    !== 'function') {
    throw new IdentityGateMiddlewareError394(
      'identityGateMiddleware394: opts.enforcer must expose enforceTransfer393 and enforceReward393',
      'BAD_CONFIG'
    );
  }

  const SUPPORTED = ['credit_transfer', 'reward_issuance'];
  if (!opts.action || !SUPPORTED.includes(opts.action)) {
    throw new IdentityGateMiddlewareError394(
      `identityGateMiddleware394: opts.action must be one of ${SUPPORTED.join(', ')}`,
      'BAD_CONFIG'
    );
  }

  const enforcer    = opts.enforcer;
  const action      = opts.action;
  const audit       = typeof opts.audit === 'function' ? opts.audit : null;
  const source      = opts.source || 'body';
  const attachToReq = opts.attachToReq !== false;

  const fieldMap = Object.assign(
    { actorId: 'actorId', claim: 'claim', signature: 'signature', rawPubkey: 'rawPubkey' },
    opts.fieldMap || {}
  );

  if (!['body', 'header', 'query'].includes(source)) {
    throw new IdentityGateMiddlewareError394(
      "identityGateMiddleware394: opts.source must be 'body', 'header', or 'query'",
      'BAD_CONFIG'
    );
  }

  /**
   * The middleware function.
   */
  function identityGateMiddleware394(req, res, next) {
    let container;
    if (source === 'body')   container = req.body   || {};
    if (source === 'header') container = req.headers || {};
    if (source === 'query')  container = req.query  || {};

    const actorId   = container[fieldMap.actorId]   || null;
    const claim     = container[fieldMap.claim]     || null;
    const signature = container[fieldMap.signature] || null;
    const rawPubkey = container[fieldMap.rawPubkey] || undefined;

    // parse claim if it's a JSON string (common in headers/query)
    let parsedClaim = claim;
    if (typeof claim === 'string') {
      try { parsedClaim = JSON.parse(claim); } catch (_) { parsedClaim = claim; }
    }

    try {
      let result;
      if (action === 'credit_transfer') {
        result = enforcer.enforceTransfer393(actorId, parsedClaim, signature, rawPubkey);
      } else {
        result = enforcer.enforceReward393(actorId, parsedClaim, signature, rawPubkey);
      }

      if (attachToReq) {
        req._identityResult394 = result;
      }

      if (audit) {
        try {
          audit(IDENTITY_GATE_MIDDLEWARE_EVENT_394, {
            action, actorId, source, bypassed: !!(result && result.bypassed),
            ts: new Date().toISOString(),
          });
        } catch (_) {}
      }

      next();
    } catch (e) {
      if (audit) {
        try {
          audit(IDENTITY_GATE_MIDDLEWARE_DENY_EVENT_394, {
            action, actorId, source, code: e.code || 'ERROR',
            ts: new Date().toISOString(),
          });
        } catch (_) {}
      }

      const status = e.statusCode || 403;
      // If res.json available (express-like), use it; else fallback
      if (res && typeof res.status === 'function') {
        return res.status(status).json({
          ok: false,
          error: e.message,
          code:  e.code || 'IDENTITY_GATE_DENIED',
          ecosVersion: 'V394',
        });
      }
      // raw http.ServerResponse fallback
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message, code: e.code, ecosVersion: 'V394' }));
    }
  }

  // attach metadata for introspection
  identityGateMiddleware394.IDENTITY_GATE_MIDDLEWARE_VERSION_394 = IDENTITY_GATE_MIDDLEWARE_VERSION_394;
  identityGateMiddleware394.action = action;
  identityGateMiddleware394.source = source;

  return identityGateMiddleware394;
}

module.exports = {
  createIdentityGateMiddleware394,
  IDENTITY_GATE_MIDDLEWARE_VERSION_394,
  IDENTITY_GATE_MIDDLEWARE_SCHEMA_394,
  IDENTITY_GATE_MIDDLEWARE_EVENT_394,
  IDENTITY_GATE_MIDDLEWARE_DENY_EVENT_394,
  IdentityGateMiddlewareError394,
};
