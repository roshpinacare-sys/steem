'use strict';
  /**
   * bulkKeyTtl427.js — ECOS V427 Feature 3
   * Extends bulkKeyImportExport426 with optional per-key TTL. Auto-expires
   * bulk keys and emits audit events (reuses sweepExpiredKeys425 pattern).
   * R1: sacred files untouched. R2: all identifiers end in 427. R3: no new npm deps.
   */

  const { createHash, timingSafeEqual } = require('crypto');

  const BULK_KEY_TTL_VERSION427 = '427.0.0';
  const MAX_TTL_STORE427 = 2000;
  const MAX_TTL_LOG427 = 1000;
  const DEFAULT_TTL_MS427 = 0;  // 0 = no expiry

  const _bulkKeyTtlStore427 = {
    keys: new Map(),   // keyId → { hash, addedAt, expiresAt, ttlMs, label, source, active }
    log: [],
    stats: {
      imported: 0,
      expired: 0,
      swept: 0,
      authChecks: 0,
      sweepRuns: 0,
      sweepHandle: null,
    },
  };

  function _appendTtlLog427(entry) {
    if (_bulkKeyTtlStore427.log.length >= MAX_TTL_LOG427) _bulkKeyTtlStore427.log.shift();
    _bulkKeyTtlStore427.log.push(entry);
  }

  function _hashTtlKey427(rawKey) {
    return createHash('sha256').update(rawKey).digest('hex');
  }

  /**
   * configureBulkKeyTtl427(opts) — configure default TTL for bulk key imports.
   */
  function configureBulkKeyTtl427(opts = {}) {
    // stored as module-level config for default TTL
    if (opts.defaultTtlMs !== undefined) {
      const ttl = parseInt(opts.defaultTtlMs, 10);
      if (isNaN(ttl) || ttl < 0) throw new Error('defaultTtlMs must be >= 0');
      _bulkKeyTtlStore427._defaultTtlMs = ttl;
    }
    return { ok: true, defaultTtlMs: _bulkKeyTtlStore427._defaultTtlMs || DEFAULT_TTL_MS427 };
  }
  _bulkKeyTtlStore427._defaultTtlMs = DEFAULT_TTL_MS427;

  /**
   * bulkImportKeysWithTtl427(keyArray, opts) — import keys with optional per-key TTL.
   * Each item: { rawKey, keyId?, label?, source?, ttlMs? }
   */
  function bulkImportKeysWithTtl427(keyArray, opts = {}, auditLog = null) {
    if (!Array.isArray(keyArray)) throw new Error('keyArray must be an array');
    if (keyArray.length > 500) throw new Error('Batch too large (max 500)');

    let imported = 0;
    let skipped = 0;
    const errors = [];

    const defaultTtl = opts.defaultTtlMs !== undefined
      ? parseInt(opts.defaultTtlMs, 10)
      : (_bulkKeyTtlStore427._defaultTtlMs || DEFAULT_TTL_MS427);

    for (let i = 0; i < keyArray.length; i++) {
      const item = keyArray[i];
      if (!item || typeof item.rawKey !== 'string' || !item.rawKey) {
        errors.push({ index: i, error: 'rawKey required' });
        continue;
      }
      if (_bulkKeyTtlStore427.keys.size >= MAX_TTL_STORE427) {
        errors.push({ index: i, error: 'store full' });
        skipped++;
        continue;
      }

      const keyId = item.keyId ||
        createHash('sha256').update(item.rawKey + i + Date.now()).digest('hex').slice(0, 12);

      if (_bulkKeyTtlStore427.keys.has(keyId) && !opts.overwrite) {
        skipped++;
        continue;
      }

      const ttlMs = item.ttlMs !== undefined ? parseInt(item.ttlMs, 10) : defaultTtl;
      const addedAt = new Date().toISOString();
      const expiresAt = (ttlMs > 0)
        ? new Date(Date.now() + ttlMs).toISOString()
        : null;

      _bulkKeyTtlStore427.keys.set(keyId, {
        hash: _hashTtlKey427(item.rawKey),
        addedAt,
        expiresAt,
        ttlMs: ttlMs || 0,
        label: item.label || null,
        source: item.source || opts.source || 'bulk_ttl_import427',
        active: true,
      });
      imported++;
    }

    _bulkKeyTtlStore427.stats.imported += imported;

    const logEntry = {
      event: 'bulk_ttl_import427',
      imported, skipped,
      errors: errors.length,
      ts: new Date().toISOString(),
    };
    _appendTtlLog427(logEntry);
    if (auditLog && typeof auditLog.log === 'function') {
      auditLog.log('bulk_key_ttl_import427', logEntry);
    }

    return { ok: true, imported, skipped, errors, total: keyArray.length };
  }

  /**
   * sweepExpiredBulkKeys427() — remove expired keys and emit audit events.
   */
  function sweepExpiredBulkKeys427(auditLog = null) {
    _bulkKeyTtlStore427.stats.sweepRuns++;
    const now = Date.now();
    const expiredIds = [];

    for (const [keyId, entry] of _bulkKeyTtlStore427.keys) {
      if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now) {
        _bulkKeyTtlStore427.keys.delete(keyId);
        expiredIds.push(keyId);
        _bulkKeyTtlStore427.stats.expired++;
      }
    }

    _bulkKeyTtlStore427.stats.swept += expiredIds.length;

    if (expiredIds.length > 0) {
      const logEntry = {
        event: 'bulk_ttl_sweep427',
        expiredCount: expiredIds.length,
        expiredIds: expiredIds.slice(0, 20),
        ts: new Date().toISOString(),
      };
      _appendTtlLog427(logEntry);
      if (auditLog && typeof auditLog.log === 'function') {
        auditLog.log('bulk_key_ttl_expired427', logEntry);
      }
    }

    return { ok: true, expiredCount: expiredIds.length, swept: expiredIds };
  }

  /**
   * checkBulkKeyWithTtl427(rawKey) — timing-safe check; rejects expired keys.
   */
  function checkBulkKeyWithTtl427(rawKey) {
    _bulkKeyTtlStore427.stats.authChecks++;
    if (!rawKey) return { valid: false };
    const now = Date.now();
    const incoming = _hashTtlKey427(rawKey);

    for (const [keyId, entry] of _bulkKeyTtlStore427.keys) {
      if (!entry.active) continue;
      if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now) continue; // expired
      try {
        const a = Buffer.from(incoming, 'hex');
        const b = Buffer.from(entry.hash, 'hex');
        if (a.length === b.length && timingSafeEqual(a, b)) {
          return {
            valid: true,
            keyId,
            label: entry.label,
            source: entry.source,
            expiresAt: entry.expiresAt,
            ttlMs: entry.ttlMs,
          };
        }
      } catch (_) {}
    }
    return { valid: false };
  }

  function getBulkKeyTtlStatus427() {
    const now = Date.now();
    let activeCount = 0;
    let expiredCount = 0;
    let noExpiryCount = 0;
    for (const [, entry] of _bulkKeyTtlStore427.keys) {
      if (!entry.expiresAt) noExpiryCount++;
      else if (new Date(entry.expiresAt).getTime() <= now) expiredCount++;
      else activeCount++;
    }
    return {
      version: BULK_KEY_TTL_VERSION427,
      totalKeys: _bulkKeyTtlStore427.keys.size,
      activeCount,
      pendingExpiryCount: activeCount,
      noExpiryCount,
      alreadyExpiredCount: expiredCount,
      defaultTtlMs: _bulkKeyTtlStore427._defaultTtlMs,
      stats: { ..._bulkKeyTtlStore427.stats, sweepHandle: undefined },
    };
  }

  function getBulkKeyTtlLog427(limit = 50) {
    return _bulkKeyTtlStore427.log.slice(-Math.min(limit, MAX_TTL_LOG427));
  }

  function startTtlSweepWorker427(intervalMs = 60000, auditLog = null) {
    if (_bulkKeyTtlStore427.stats.sweepHandle) return { ok: false, error: 'already running' };
    _bulkKeyTtlStore427.stats.sweepHandle = setInterval(() => {
      sweepExpiredBulkKeys427(auditLog);
    }, intervalMs);
    return { ok: true, intervalMs };
  }

  function stopTtlSweepWorker427() {
    if (_bulkKeyTtlStore427.stats.sweepHandle) {
      clearInterval(_bulkKeyTtlStore427.stats.sweepHandle);
      _bulkKeyTtlStore427.stats.sweepHandle = null;
      return { ok: true, stopped: true };
    }
    return { ok: true, stopped: false };
  }

  function wireBulkKeyTtl427(app, auditLog = null) {
    /* POST /api/v1/solvency/tower/auth/keys/bulk/ttl/configure */
    app.post('/api/v1/solvency/tower/auth/keys/bulk/ttl/configure', (req, res) => {
      try {
        const result = configureBulkKeyTtl427(req.body || {});
        res.json({ ok: true, ecosVersion: 'V427', ...result });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message, ecosVersion: 'V427' });
      }
    });

    /* POST /api/v1/solvency/tower/auth/keys/bulk/ttl/sweep */
    app.post('/api/v1/solvency/tower/auth/keys/bulk/ttl/sweep', (_req, res) => {
      try {
        const result = sweepExpiredBulkKeys427(auditLog);
        res.json({ ok: true, ecosVersion: 'V427', ...result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V427' });
      }
    });

    /* GET /api/v1/solvency/tower/auth/keys/bulk/ttl/status */
    app.get('/api/v1/solvency/tower/auth/keys/bulk/ttl/status', (_req, res) => {
      res.json({ ok: true, ecosVersion: 'V427', ...getBulkKeyTtlStatus427() });
    });

    /* POST /api/v1/solvency/tower/auth/keys/bulk/ttl/import */
    app.post('/api/v1/solvency/tower/auth/keys/bulk/ttl/import', (req, res) => {
      try {
        const { keys, source, overwrite, defaultTtlMs } = req.body || {};
        if (!Array.isArray(keys)) {
          return res.status(400).json({ ok: false, error: 'keys array required', ecosVersion: 'V427' });
        }
        const result = bulkImportKeysWithTtl427(keys, { source, overwrite, defaultTtlMs }, auditLog);
        res.json({ ok: true, ecosVersion: 'V427', ...result });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message, ecosVersion: 'V427' });
      }
    });

    /* GET /api/v1/solvency/tower/auth/keys/bulk/ttl/log */
    app.get('/api/v1/solvency/tower/auth/keys/bulk/ttl/log', (req, res) => {
      const limit = parseInt(req.query.limit, 10) || 50;
      const log = getBulkKeyTtlLog427(limit);
      res.json({ ok: true, ecosVersion: 'V427', count: log.length, log });
    });
  }

  if (process.env.NODE_ENV === 'test') {
    module.exports = {
      configureBulkKeyTtl427,
      bulkImportKeysWithTtl427,
      sweepExpiredBulkKeys427,
      checkBulkKeyWithTtl427,
      getBulkKeyTtlStatus427,
      getBulkKeyTtlLog427,
      startTtlSweepWorker427,
      stopTtlSweepWorker427,
      wireBulkKeyTtl427,
      BULK_KEY_TTL_VERSION427,
      DEFAULT_TTL_MS427,
      _bulkKeyTtlStore427,
    };
  } else {
    module.exports = {
      configureBulkKeyTtl427,
      bulkImportKeysWithTtl427,
      sweepExpiredBulkKeys427,
      checkBulkKeyWithTtl427,
      getBulkKeyTtlStatus427,
      getBulkKeyTtlLog427,
      startTtlSweepWorker427,
      stopTtlSweepWorker427,
      wireBulkKeyTtl427,
      BULK_KEY_TTL_VERSION427,
      DEFAULT_TTL_MS427,
    };
  }
  