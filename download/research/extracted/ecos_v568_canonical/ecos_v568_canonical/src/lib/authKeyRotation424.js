'use strict';
/**
 * authKeyRotation424.js — ECOS V424 Feature 4
 * Graceful key rotation for solvencyFacadeAuth423.
 * Accepts multiple API keys, emits audit event on key-change.
 * R1: sacred. R2: identifiers end in 424. R3: no new npm deps.
 */

const { createHash, timingSafeEqual } = require('crypto');

const _keyStore424 = {
  keys: new Map(),   // keyId → { hash, addedAt, active }
  rotationLog: [],
  stats: { adds: 0, removes: 0, rotations: 0, authChecks: 0 },
};

const MAX_ROTATION_LOG424 = 1000;

function hashKey424(rawKey) {
  return createHash('sha256').update(rawKey).digest('hex');
}

function addAuthKey424(rawKey, keyId = null, auditLog = null) {
  if (!rawKey || typeof rawKey !== 'string') throw new Error('rawKey must be a non-empty string');
  const id = keyId || createHash('sha256').update(rawKey + Date.now()).digest('hex').slice(0, 12);
  const hash = hashKey424(rawKey);
  const entry = { hash, addedAt: new Date().toISOString(), active: true };
  _keyStore424.keys.set(id, entry);
  _keyStore424.stats.adds++;

  const logEntry = { event: 'key_added424', keyId: id, ts: new Date().toISOString() };
  if (_keyStore424.rotationLog.length >= MAX_ROTATION_LOG424) _keyStore424.rotationLog.shift();
  _keyStore424.rotationLog.push(logEntry);

  if (auditLog && typeof auditLog.log === 'function') {
    auditLog.log('auth_key_rotation424', logEntry);
  }
  return { ok: true, keyId: id };
}

function removeAuthKey424(keyId, auditLog = null) {
  if (!_keyStore424.keys.has(keyId)) return { ok: false, error: 'key not found' };
  _keyStore424.keys.delete(keyId);
  _keyStore424.stats.removes++;

  const logEntry = { event: 'key_removed424', keyId, ts: new Date().toISOString() };
  if (_keyStore424.rotationLog.length >= MAX_ROTATION_LOG424) _keyStore424.rotationLog.shift();
  _keyStore424.rotationLog.push(logEntry);

  if (auditLog && typeof auditLog.log === 'function') {
    auditLog.log('auth_key_rotation424', logEntry);
  }
  return { ok: true };
}

function rotateAuthKey424(oldKeyId, newRawKey, auditLog = null) {
  const removeResult = removeAuthKey424(oldKeyId, null);
  if (!removeResult.ok) return { ok: false, error: `remove failed: ${removeResult.error}` };
  const addResult = addAuthKey424(newRawKey, null, null);
  _keyStore424.stats.rotations++;

  const logEntry = {
    event: 'key_rotated424',
    oldKeyId,
    newKeyId: addResult.keyId,
    ts: new Date().toISOString(),
  };
  if (_keyStore424.rotationLog.length >= MAX_ROTATION_LOG424) _keyStore424.rotationLog.shift();
  _keyStore424.rotationLog.push(logEntry);

  if (auditLog && typeof auditLog.log === 'function') {
    auditLog.log('auth_key_rotation424', logEntry);
  }
  return { ok: true, newKeyId: addResult.keyId };
}

function checkAuthKey424(rawKey) {
  _keyStore424.stats.authChecks++;
  if (!rawKey) return { valid: false };
  const incomingHash = hashKey424(rawKey);
  for (const [keyId, entry] of _keyStore424.keys) {
    if (!entry.active) continue;
    try {
      const a = Buffer.from(incomingHash, 'hex');
      const b = Buffer.from(entry.hash, 'hex');
      if (a.length === b.length && timingSafeEqual(a, b)) {
        return { valid: true, keyId };
      }
    } catch (_) { /* length mismatch, skip */ }
  }
  return { valid: false };
}

function getKeyRotationStatus424() {
  return {
    activeKeys: _keyStore424.keys.size,
    stats: { ..._keyStore424.stats },
    recentLog: _keyStore424.rotationLog.slice(-20),
  };
}

function wireAuthKeyRotation424(app, auditLog) {
  /* POST /api/v1/solvency/tower/auth/keys */
  app.post('/api/v1/solvency/tower/auth/keys', (req, res) => {
    const { rawKey, keyId } = req.body || {};
    if (!rawKey) return res.status(400).json({ ok: false, error: 'rawKey required' });
    try {
      const result = addAuthKey424(rawKey, keyId, auditLog);
      res.json(result);
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  /* DELETE /api/v1/solvency/tower/auth/keys/:keyId */
  app.delete('/api/v1/solvency/tower/auth/keys/:keyId', (req, res) => {
    const result = removeAuthKey424(req.params.keyId, auditLog);
    res.json(result);
  });

  /* POST /api/v1/solvency/tower/auth/rotate */
  app.post('/api/v1/solvency/tower/auth/rotate', (req, res) => {
    const { oldKeyId, newRawKey } = req.body || {};
    if (!oldKeyId || !newRawKey) {
      return res.status(400).json({ ok: false, error: 'oldKeyId and newRawKey required' });
    }
    const result = rotateAuthKey424(oldKeyId, newRawKey, auditLog);
    res.json(result);
  });

  /* POST /api/v1/solvency/tower/auth/check */
  app.post('/api/v1/solvency/tower/auth/check', (req, res) => {
    const { rawKey } = req.body || {};
    const result = checkAuthKey424(rawKey);
    res.json({ ok: true, ...result });
  });

  /* GET /api/v1/solvency/tower/auth/rotation/status */
  app.get('/api/v1/solvency/tower/auth/rotation/status', (req, res) => {
    res.json({ ok: true, ...getKeyRotationStatus424() });
  });
}

if (process.env.NODE_ENV === 'test') {
  module.exports = {
    addAuthKey424,
    removeAuthKey424,
    rotateAuthKey424,
    checkAuthKey424,
    getKeyRotationStatus424,
    wireAuthKeyRotation424,
    _keyStore424,
  };
} else {
  module.exports = {
    addAuthKey424,
    removeAuthKey424,
    rotateAuthKey424,
    checkAuthKey424,
    getKeyRotationStatus424,
    wireAuthKeyRotation424,
  };
}
