'use strict';
/**
 * src/lib/connectorIsolation241.js — ECOS V241 (Phase P137 / Urgent Remediation Task 3)
 *
 * Connector Context Isolation: per-user runtime separation + scoped, short-lived
 * tokens for each connector call. Prevents cross-tenant secret access.
 *
 * Design (R6: no npm; in-memory only):
 *   - Each connector call gets a unique scope token (scoped to userId + connectorId + ttl).
 *   - Tokens are single-use: consumed on first use, then invalidated.
 *   - Max tokens per user: ISOLATION_MAX_TOKENS_PER_USER_241 = 50.
 *   - Token TTL: ISOLATION_TOKEN_TTL_MS_241 = 5 minutes.
 *   - Cross-tenant check: assertConnectorAccess241 throws if userId doesn't own connector.
 *
 * @version 241.0.0
 */

const { randomBytes } = require('crypto');

const ISOLATION_TOKEN_TTL_MS_241        = 5 * 60 * 1000; // 5 minutes
const ISOLATION_MAX_TOKENS_PER_USER_241 = 50;
const ISOLATION_MAX_TOTAL_TOKENS_241    = 100000;

// Token store: tokenId → { userId, connectorId, expiresAt, used }
const _tokenStore241 = new Map();

// User→connector ownership: userId → Set<connectorId>
const _ownershipMap241 = new Map();

class IsolationError241 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'IsolationError241';
    this.code = code || 'ISOLATION_ERROR';
    this.statusCode = 403;
  }
}

function _generateToken241() {
  return randomBytes(24).toString('hex'); // 48 hex chars, 192 bits
}

function _pruneExpiredTokens241() {
  const now241 = Date.now();
  for (const [tid241, tok241] of _tokenStore241) {
    if (tok241.expiresAt < now241 || tok241.used) _tokenStore241.delete(tid241);
  }
}

function _countUserTokens241(userId241) {
  let count241 = 0;
  for (const tok241 of _tokenStore241.values()) {
    if (tok241.userId === userId241 && !tok241.used && tok241.expiresAt > Date.now()) count241++;
  }
  return count241;
}

/**
 * Register a connector as owned by a user. Called during connector setup.
 * @param {string} userId
 * @param {string} connectorId
 */
function registerConnectorOwner241(userId241, connectorId241) {
  if (!userId241 || !connectorId241) throw new IsolationError241('userId and connectorId required', 'MISSING_PARAM');
  const uid = String(userId241);
  const cid = String(connectorId241);
  if (!_ownershipMap241.has(uid)) _ownershipMap241.set(uid, new Set());
  _ownershipMap241.get(uid).add(cid);
  return { ok: true, userId: uid, connectorId: cid };
}

/**
 * Assert that userId is allowed to access connectorId.
 * Throws IsolationError241 if not registered.
 * Pass `force:true` to register on the fly (onboarding scenario).
 */
function assertConnectorAccess241(userId241, connectorId241, { force = false } = {}) {
  const uid = String(userId241 || '');
  const cid = String(connectorId241 || '');
  if (!uid || !cid) throw new IsolationError241('userId and connectorId required', 'MISSING_PARAM');
  const owned = _ownershipMap241.get(uid);
  if (!owned || !owned.has(cid)) {
    if (force) {
      registerConnectorOwner241(uid, cid);
      return { ok: true, userId: uid, connectorId: cid, registered: true };
    }
    throw new IsolationError241(
      `user "${uid}" does not own connector "${cid}" — cross-tenant access blocked`,
      'CROSS_TENANT'
    );
  }
  return { ok: true, userId: uid, connectorId: cid };
}

/**
 * Issue a scoped, short-lived single-use token for a connector call.
 *
 * @param {string} userId
 * @param {string} connectorId
 * @returns {{ tokenId, expiresAt, userId, connectorId }}
 */
function issueConnectorToken241(userId241, connectorId241) {
  assertConnectorAccess241(userId241, connectorId241);
  _pruneExpiredTokens241();

  const uid = String(userId241);
  if (_tokenStore241.size >= ISOLATION_MAX_TOTAL_TOKENS_241) {
    _pruneExpiredTokens241(); // try harder
    if (_tokenStore241.size >= ISOLATION_MAX_TOTAL_TOKENS_241) {
      throw new IsolationError241('token store at capacity', 'STORE_FULL');
    }
  }
  if (_countUserTokens241(uid) >= ISOLATION_MAX_TOKENS_PER_USER_241) {
    throw new IsolationError241(`user "${uid}" has too many active tokens`, 'TOO_MANY_TOKENS');
  }

  const tokenId241  = _generateToken241();
  const expiresAt241 = Date.now() + ISOLATION_TOKEN_TTL_MS_241;
  _tokenStore241.set(tokenId241, {
    userId:      uid,
    connectorId: String(connectorId241),
    expiresAt:   expiresAt241,
    used:        false,
    issuedAt:    Date.now(),
  });
  return { tokenId: tokenId241, userId: uid, connectorId: String(connectorId241), expiresAt: new Date(expiresAt241).toISOString() };
}

/**
 * Consume (validate + single-use invalidate) a scoped token for a connector call.
 *
 * @param {string} tokenId
 * @param {string} userId  — must match token's userId
 * @param {string} connectorId — must match token's connectorId
 * @returns {{ ok: true, userId, connectorId }}
 */
function consumeConnectorToken241(tokenId241, userId241, connectorId241) {
  if (!tokenId241) throw new IsolationError241('tokenId required', 'MISSING_TOKEN');
  const tok241 = _tokenStore241.get(String(tokenId241));
  if (!tok241) throw new IsolationError241('token not found or already used', 'TOKEN_INVALID');
  if (tok241.used) throw new IsolationError241('token already consumed (single-use)', 'TOKEN_USED');
  if (tok241.expiresAt < Date.now()) { _tokenStore241.delete(String(tokenId241)); throw new IsolationError241('token expired', 'TOKEN_EXPIRED'); }
  if (userId241 != null && tok241.userId !== String(userId241)) throw new IsolationError241('token userId mismatch', 'TOKEN_USER_MISMATCH');
  if (connectorId241 != null && tok241.connectorId !== String(connectorId241)) throw new IsolationError241('token connectorId mismatch', 'TOKEN_CONNECTOR_MISMATCH');

  tok241.used = true;
  return { ok: true, userId: tok241.userId, connectorId: tok241.connectorId };
}

/** List active (non-expired, non-used) tokens for a user (admin/debug). */
function listUserTokens241(userId241) {
  _pruneExpiredTokens241();
  const now241 = Date.now();
  const result241 = [];
  for (const [tid241, tok241] of _tokenStore241) {
    if (tok241.userId === String(userId241) && !tok241.used && tok241.expiresAt > now241) {
      result241.push({ tokenId: tid241, connectorId: tok241.connectorId, expiresAt: new Date(tok241.expiresAt).toISOString() });
    }
  }
  return result241;
}

/** Clear all stores (test helper). */
function _clearIsolation241() { _tokenStore241.clear(); _ownershipMap241.clear(); }

module.exports = {
  ISOLATION_TOKEN_TTL_MS_241,
  ISOLATION_MAX_TOKENS_PER_USER_241,
  ISOLATION_MAX_TOTAL_TOKENS_241,
  IsolationError241,
  registerConnectorOwner241,
  assertConnectorAccess241,
  issueConnectorToken241,
  consumeConnectorToken241,
  listUserTokens241,
  _clearIsolation241,
  _tokenStore241,
  _ownershipMap241,
};
