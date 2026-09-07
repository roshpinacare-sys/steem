'use strict';
/**
 * keyExpiry425.js — ECOS V425 Feature 4
 * Adds TTL support to auth keys from authKeyRotation424.
 * Auto-removes expired keys, emits audit events on expiry.
 * R1: sacred files untouched. R2: all identifiers end in 425. R3: no new npm deps.
 */

const { createHash, timingSafeEqual } = require('crypto');

const KEY_EXPIRY_VERSION425 = '425.0.0';
const DEFAULT_TTL_MS425 = 24 * 60 * 60 * 1000;   // 24 hours
const MAX_EXPIRY_LOG425 = 1000;
const SWEEP_INTERVAL_MS425 = 60 * 1000;            // 1 minute sweep

const _keyExpiryStore425 = {
  keys: new Map(),    // keyId → { hash, addedAt, expiresAt, active }
  expiryLog: [],
  sweepHandle: null,
  stats: {
    adds: 0,
    removes: 0,
    expired: 0,
    authChecks: 0,
    sweeps: 0,
  },
};

function hashKey425(rawKey) {
  return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * addKeyWithTtl425(rawKey, opts) — add key with optional TTL (ms).
 * Defaults to DEFAULT_TTL_MS425. Pass ttlMs=0 for no expiry.
 */
function addKeyWithTtl425(rawKey, opts = {}, auditLog = null) {
  if (!rawKey || typeof rawKey !== 'string') throw new Error('rawKey must be a non-empty string');
  const keyId = opts.keyId || createHash('sha256').update(rawKey + Date.now()).digest('hex').slice(0, 12);
  const ttlMs = opts.ttlMs !== undefined ? parseInt(opts.ttlMs, 10) : DEFAULT_TTL_MS425;
  const addedAt = new Date().toISOString();
  const expiresAt = ttlMs > 0 ? new Date(Date.now() + ttlMs).toISOString() : null;
  const entry = { hash: hashKey425(rawKey), addedAt, expiresAt, active: true, ttlMs };
  _keyExpiryStore425.keys.set(keyId, entry);
  _keyExpiryStore425.stats.adds++;

  const logEntry = { event: 'key_added425', keyId, expiresAt, ts: new Date().toISOString() };
  _appendExpiryLog425(logEntry);
  if (auditLog && typeof auditLog.log === 'function') {
    auditLog.log('key_expiry425', logEntry);
  }
  return { ok: true, keyId, expiresAt };
}

function _appendExpiryLog425(entry) {
  if (_keyExpiryStore425.expiryLog.length >= MAX_EXPIRY_LOG425) {
    _keyExpiryStore425.expiryLog.shift();
  }
  _keyExpiryStore425.expiryLog.push(entry);
}

/**
 * removeKey425(keyId) — manually remove a key.
 */
function removeKey425(keyId, auditLog = null) {
  if (!_keyExpiryStore425.keys.has(keyId)) return { ok: false, error: 'key not found' };
  _keyExpiryStore425.keys.delete(keyId);
  _keyExpiryStore425.stats.removes++;
  const logEntry = { event: 'key_removed425', keyId, ts: new Date().toISOString() };
  _appendExpiryLog425(logEntry);
  if (auditLog && typeof auditLog.log === 'function') {
    auditLog.log('key_expiry425', logEntry);
  }
  return { ok: true };
}

/**
 * sweepExpiredKeys425() — remove all expired keys; returns { swept, remaining }.
 */
function sweepExpiredKeys425(auditLog = null) {
  const now = Date.now();
  let swept = 0;
  for (const [keyId, entry] of _keyExpiryStore425.keys) {
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now) {
      _keyExpiryStore425.keys.delete(keyId);
      swept++;
      _keyExpiryStore425.stats.expired++;
      const logEntry = { event: 'key_expired425', keyId, expiresAt: entry.expiresAt, ts: new Date().toISOString() };
      _appendExpiryLog425(logEntry);
      if (auditLog && typeof auditLog.log === 'function') {
        auditLog.log('key_expiry425', logEntry);
      }
    }
  }
  _keyExpiryStore425.stats.sweeps++;
  return { swept, remaining: _keyExpiryStore425.keys.size };
}

/**
 * checkKeyWithExpiry425(rawKey) — timing-safe check, auto-rejects expired.
 */
function checkKeyWithExpiry425(rawKey) {
  _keyExpiryStore425.stats.authChecks++;
  if (!rawKey) return { valid: false };
  const now = Date.now();
  const incomingHash = hashKey425(rawKey);
  for (const [keyId, entry] of _keyExpiryStore425.keys) {
    if (!entry.active) continue;
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now) continue;
    try {
      const a = Buffer.from(incomingHash, 'hex');
      const b = Buffer.from(entry.hash, 'hex');
      if (a.length === b.length && timingSafeEqual(a, b)) {
        const ttlRemaining = entry.expiresAt ? Math.max(0, new Date(entry.expiresAt).getTime() - now) : null;
        return { valid: true, keyId, expiresAt: entry.expiresAt, ttlRemainingMs: ttlRemaining };
      }
    } catch (_) {}
  }
  return { valid: false };
}

function listKeys425() {
  return [..._keyExpiryStore425.keys.entries()].map(([keyId, entry]) => ({
    keyId,
    addedAt: entry.addedAt,
    expiresAt: entry.expiresAt,
    active: entry.active,
    expired: entry.expiresAt ? new Date(entry.expiresAt).getTime() <= Date.now() : false,
  }));
}

function getKeyExpiryStats425() {
  return {
    version: KEY_EXPIRY_VERSION425,
    activeKeys: _keyExpiryStore425.keys.size,
    stats: { ..._keyExpiryStore425.stats },
    recentLog: _keyExpiryStore425.expiryLog.slice(-20),
  };
}

function startExpirySweep425(auditLog = null) {
  if (_keyExpiryStore425.sweepHandle) return { ok: false, error: 'already running' };
  _keyExpiryStore425.sweepHandle = setInterval(() => {
    try { sweepExpiredKeys425(auditLog); } catch (_) {}
  }, SWEEP_INTERVAL_MS425);
  return { ok: true, intervalMs: SWEEP_INTERVAL_MS425 };
}

function stopExpirySweep425() {
  if (_keyExpiryStore425.sweepHandle) {
    clearInterval(_keyExpiryStore425.sweepHandle);
    _keyExpiryStore425.sweepHandle = null;
    return { ok: true, stopped: true };
  }
  return { ok: true, stopped: false };
}

function wireKeyExpiry425(app, auditLog) {
  startExpirySweep425(auditLog);

  /* POST /api/v1/solvency/tower/auth/keys/ttl */
  app.post('/api/v1/solvency/tower/auth/keys/ttl', (req, res) => {
    const { rawKey, keyId, ttlMs } = req.body || {};
    if (!rawKey) return res.status(400).json({ ok: false, error: 'rawKey required', ecosVersion: 'V425' });
    try {
      const result = addKeyWithTtl425(rawKey, { keyId, ttlMs }, auditLog);
      res.json({ ok: true, ecosVersion: 'V425', ...result });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message, ecosVersion: 'V425' });
    }
  });

  /* DELETE /api/v1/solvency/tower/auth/keys/ttl/:keyId */
  app.delete('/api/v1/solvency/tower/auth/keys/ttl/:keyId', (req, res) => {
    const result = removeKey425(req.params.keyId, auditLog);
    res.json({ ok: true, ecosVersion: 'V425', ...result });
  });

  /* POST /api/v1/solvency/tower/auth/keys/ttl/check */
  app.post('/api/v1/solvency/tower/auth/keys/ttl/check', (req, res) => {
    const { rawKey } = req.body || {};
    const result = checkKeyWithExpiry425(rawKey);
    res.json({ ok: true, ecosVersion: 'V425', ...result });
  });

  /* POST /api/v1/solvency/tower/auth/keys/ttl/sweep */
  app.post('/api/v1/solvency/tower/auth/keys/ttl/sweep', (_req, res) => {
    try {
      const result = sweepExpiredKeys425(auditLog);
      res.json({ ok: true, ecosVersion: 'V425', ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V425' });
    }
  });

  /* GET /api/v1/solvency/tower/auth/keys/ttl/list */
  app.get('/api/v1/solvency/tower/auth/keys/ttl/list', (_req, res) => {
    res.json({ ok: true, ecosVersion: 'V425', keys: listKeys425() });
  });

  /* GET /api/v1/solvency/tower/auth/keys/ttl/stats */
  app.get('/api/v1/solvency/tower/auth/keys/ttl/stats', (_req, res) => {
    res.json({ ok: true, ecosVersion: 'V425', ...getKeyExpiryStats425() });
  });
}

if (process.env.NODE_ENV === 'test') {
  module.exports = {
    addKeyWithTtl425,
    removeKey425,
    sweepExpiredKeys425,
    checkKeyWithExpiry425,
    listKeys425,
    getKeyExpiryStats425,
    startExpirySweep425,
    stopExpirySweep425,
    wireKeyExpiry425,
    KEY_EXPIRY_VERSION425,
    DEFAULT_TTL_MS425,
    _keyExpiryStore425,
  };
} else {
  module.exports = {
    addKeyWithTtl425,
    removeKey425,
    sweepExpiredKeys425,
    checkKeyWithExpiry425,
    listKeys425,
    getKeyExpiryStats425,
    startExpirySweep425,
    stopExpirySweep425,
    wireKeyExpiry425,
    KEY_EXPIRY_VERSION425,
    DEFAULT_TTL_MS425,
  };
}
