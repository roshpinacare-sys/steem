'use strict';
  /**
   * bulkKeyImportExport426.js — ECOS V426 Feature 3
   * Import multiple auth keys from JSON array; export key metadata (no hashes)
   * for audit. Supports migration and DR scenarios.
   * R1: sacred files untouched. R2: all identifiers end in 426. R3: no new npm deps.
   */

  const { createHash, timingSafeEqual } = require('crypto');

  const BULK_KEY_VERSION426 = '426.0.0';
  const MAX_BULK_IMPORT426 = 500;
  const MAX_BULK_STORE426 = 2000;
  const MAX_IMPORT_LOG426 = 1000;

  const _bulkKeyStore426 = {
    keys: new Map(),     // keyId → { hash, addedAt, label, source, active }
    importLog: [],
    stats: {
      imported: 0,
      exported: 0,
      deleted: 0,
      authChecks: 0,
      bulkImports: 0,
    },
  };

  function _hashBulkKey426(rawKey) {
    return createHash('sha256').update(rawKey).digest('hex');
  }

  function _appendBulkLog426(entry) {
    if (_bulkKeyStore426.importLog.length >= MAX_IMPORT_LOG426) _bulkKeyStore426.importLog.shift();
    _bulkKeyStore426.importLog.push(entry);
  }

  /**
   * bulkImportKeys426(keyArray, opts) — import array of { rawKey, keyId?, label?, source? }.
   * Returns { imported, skipped, errors }.
   */
  function bulkImportKeys426(keyArray, opts = {}, auditLog = null) {
    if (!Array.isArray(keyArray)) throw new Error('keyArray must be an array');
    if (keyArray.length > MAX_BULK_IMPORT426) throw new Error('Batch too large (max ' + MAX_BULK_IMPORT426 + ')');

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < keyArray.length; i++) {
      const item = keyArray[i];
      if (!item || typeof item.rawKey !== 'string' || !item.rawKey) {
        errors.push({ index: i, error: 'rawKey required' });
        continue;
      }
      if (_bulkKeyStore426.keys.size >= MAX_BULK_STORE426) {
        errors.push({ index: i, error: 'store full' });
        skipped++;
        continue;
      }
      const keyId = item.keyId || createHash('sha256').update(item.rawKey + i + Date.now()).digest('hex').slice(0, 12);
      if (_bulkKeyStore426.keys.has(keyId) && !opts.overwrite) {
        skipped++;
        continue;
      }
      _bulkKeyStore426.keys.set(keyId, {
        hash: _hashBulkKey426(item.rawKey),
        addedAt: new Date().toISOString(),
        label: item.label || null,
        source: item.source || opts.source || 'bulk_import426',
        active: true,
      });
      imported++;
    }

    _bulkKeyStore426.stats.imported += imported;
    _bulkKeyStore426.stats.bulkImports++;

    const logEntry = { event: 'bulk_import426', imported, skipped, errors: errors.length, ts: new Date().toISOString() };
    _appendBulkLog426(logEntry);
    if (auditLog && typeof auditLog.log === 'function') {
      auditLog.log('bulk_key_import426', logEntry);
    }

    return { ok: true, imported, skipped, errors, total: keyArray.length };
  }

  /**
   * exportKeyMetadata426(opts) — export key metadata (NO raw keys or hashes).
   */
  function exportKeyMetadata426(opts = {}, auditLog = null) {
    let entries = [..._bulkKeyStore426.keys.entries()];

    if (opts.source) entries = entries.filter(([, v]) => v.source === opts.source);
    if (opts.label) entries = entries.filter(([, v]) => v.label === opts.label);

    const metadata = entries.map(([keyId, v]) => ({
      keyId,
      label: v.label,
      source: v.source,
      addedAt: v.addedAt,
      active: v.active,
    }));

    _bulkKeyStore426.stats.exported++;
    const logEntry = { event: 'bulk_export426', count: metadata.length, ts: new Date().toISOString() };
    _appendBulkLog426(logEntry);
    if (auditLog && typeof auditLog.log === 'function') {
      auditLog.log('bulk_key_export426', logEntry);
    }

    return { ok: true, count: metadata.length, keys: metadata, version: BULK_KEY_VERSION426 };
  }

  /**
   * checkBulkKey426(rawKey) — timing-safe check against bulk key store.
   */
  function checkBulkKey426(rawKey) {
    _bulkKeyStore426.stats.authChecks++;
    if (!rawKey) return { valid: false };
    const incoming = _hashBulkKey426(rawKey);
    for (const [keyId, entry] of _bulkKeyStore426.keys) {
      if (!entry.active) continue;
      try {
        const a = Buffer.from(incoming, 'hex');
        const b = Buffer.from(entry.hash, 'hex');
        if (a.length === b.length && timingSafeEqual(a, b)) {
          return { valid: true, keyId, label: entry.label, source: entry.source };
        }
      } catch (_) {}
    }
    return { valid: false };
  }

  /**
   * deleteBulkKey426(keyId) — remove a single key from bulk store.
   */
  function deleteBulkKey426(keyId, auditLog = null) {
    if (!_bulkKeyStore426.keys.has(keyId)) return { ok: false, error: 'key not found' };
    _bulkKeyStore426.keys.delete(keyId);
    _bulkKeyStore426.stats.deleted++;
    const logEntry = { event: 'bulk_delete426', keyId, ts: new Date().toISOString() };
    _appendBulkLog426(logEntry);
    if (auditLog && typeof auditLog.log === 'function') {
      auditLog.log('bulk_key_delete426', logEntry);
    }
    return { ok: true };
  }

  function getBulkKeyStats426() {
    return {
      version: BULK_KEY_VERSION426,
      activeKeys: _bulkKeyStore426.keys.size,
      stats: { ..._bulkKeyStore426.stats },
      recentLog: _bulkKeyStore426.importLog.slice(-20),
    };
  }

  function wireBulkKeyImportExport426(app, auditLog = null) {
    /* POST /api/v1/solvency/tower/auth/keys/bulk/import */
    app.post('/api/v1/solvency/tower/auth/keys/bulk/import', (req, res) => {
      try {
        const { keys, source, overwrite } = req.body || {};
        if (!Array.isArray(keys)) {
          return res.status(400).json({ ok: false, error: 'keys array required', ecosVersion: 'V426' });
        }
        const result = bulkImportKeys426(keys, { source, overwrite }, auditLog);
        res.json({ ok: true, ecosVersion: 'V426', ...result });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message, ecosVersion: 'V426' });
      }
    });

    /* GET /api/v1/solvency/tower/auth/keys/bulk/export */
    app.get('/api/v1/solvency/tower/auth/keys/bulk/export', (req, res) => {
      try {
        const result = exportKeyMetadata426(req.query, auditLog);
        res.json({ ok: true, ecosVersion: 'V426', ...result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V426' });
      }
    });

    /* POST /api/v1/solvency/tower/auth/keys/bulk/check */
    app.post('/api/v1/solvency/tower/auth/keys/bulk/check', (req, res) => {
      const { rawKey } = req.body || {};
      const result = checkBulkKey426(rawKey);
      res.json({ ok: true, ecosVersion: 'V426', ...result });
    });

    /* DELETE /api/v1/solvency/tower/auth/keys/bulk/:keyId */
    app.delete('/api/v1/solvency/tower/auth/keys/bulk/:keyId', (req, res) => {
      const result = deleteBulkKey426(req.params.keyId, auditLog);
      res.json({ ok: true, ecosVersion: 'V426', ...result });
    });

    /* GET /api/v1/solvency/tower/auth/keys/bulk/stats */
    app.get('/api/v1/solvency/tower/auth/keys/bulk/stats', (_req, res) => {
      res.json({ ok: true, ecosVersion: 'V426', ...getBulkKeyStats426() });
    });
  }

  if (process.env.NODE_ENV === 'test') {
    module.exports = {
      bulkImportKeys426,
      exportKeyMetadata426,
      checkBulkKey426,
      deleteBulkKey426,
      getBulkKeyStats426,
      wireBulkKeyImportExport426,
      BULK_KEY_VERSION426,
      MAX_BULK_IMPORT426,
      _bulkKeyStore426,
    };
  } else {
    module.exports = {
      bulkImportKeys426,
      exportKeyMetadata426,
      checkBulkKey426,
      deleteBulkKey426,
      getBulkKeyStats426,
      wireBulkKeyImportExport426,
      BULK_KEY_VERSION426,
      MAX_BULK_IMPORT426,
    };
  }
  