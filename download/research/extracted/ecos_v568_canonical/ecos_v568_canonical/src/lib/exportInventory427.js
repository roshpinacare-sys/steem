'use strict';
  /**
   * exportInventory427.js — ECOS V427 Feature 5
   * Maintains a metadata index (JSONL) of all past scheduled exports
   * (filename, bytes, checksum, entryCount, format); exposes GET endpoint
   * for audit trail.
   * R1: sacred files untouched. R2: all identifiers end in 427. R3: no new npm deps.
   */

  const fs = require('fs');
  const path = require('path');
  const { createHash } = require('crypto');

  const EXPORT_INVENTORY_VERSION427 = '427.0.0';
  const MAX_INVENTORY_MEMORY427 = 2000;
  const MAX_INVENTORY_LOG427 = 500;

  const _inventoryState427 = {
    dataDir: null,
    inMemory: [],    // metadata records
    log: [],
    stats: {
      entriesAdded: 0,
      compactsRun: 0,
      version: EXPORT_INVENTORY_VERSION427,
    },
  };

  function _inventoryFile427() {
    if (!_inventoryState427.dataDir) return null;
    const dir = path.join(_inventoryState427.dataDir, 'audit_exports');
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (_) { return null; }
    return path.join(dir, 'export_inventory427.jsonl');
  }

  function _appendInvLog427(entry) {
    if (_inventoryState427.log.length >= MAX_INVENTORY_LOG427) _inventoryState427.log.shift();
    _inventoryState427.log.push(entry);
  }

  /**
   * configureExportInventory427(opts) — set dataDir for inventory persistence.
   */
  function configureExportInventory427(opts = {}) {
    if (opts.dataDir !== undefined) _inventoryState427.dataDir = opts.dataDir;
    return { ok: true, dataDir: _inventoryState427.dataDir };
  }

  /**
   * recordExport427(exportRecord) — add an export record to the inventory.
   * exportRecord: { filename, filePath?, bytes, checksum, entryCount, format, ts? }
   */
  function recordExport427(exportRecord, auditLog = null) {
    if (!exportRecord || !exportRecord.filename) throw new Error('exportRecord.filename required');

    const inventoryId427 = createHash('sha256')
      .update(exportRecord.filename + Date.now())
      .digest('hex').slice(0, 16);

    const record = {
      inventoryId427,
      filename: exportRecord.filename,
      bytes: exportRecord.bytes || 0,
      checksum: exportRecord.checksum || null,
      entryCount: exportRecord.entryCount || 0,
      format: exportRecord.format || 'unknown',
      exportedAt: exportRecord.ts || new Date().toISOString(),
      recordedAt427: new Date().toISOString(),
    };

    // In-memory
    _inventoryState427.inMemory.push(record);
    if (_inventoryState427.inMemory.length > MAX_INVENTORY_MEMORY427) {
      _inventoryState427.inMemory.shift();
    }
    _inventoryState427.stats.entriesAdded++;

    // Persist to JSONL
    const file = _inventoryFile427();
    if (file) {
      try { fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8'); } catch (_) {}
    }

    _appendInvLog427({ event: 'export_recorded427', inventoryId427, filename: record.filename, ts: record.recordedAt427 });

    if (auditLog && typeof auditLog.log === 'function') {
      auditLog.log('export_inventory_recorded427', { inventoryId427, filename: record.filename });
    }

    return { ok: true, inventoryId427, filename: record.filename };
  }

  /**
   * loadInventory427(dataDir?) — load inventory from JSONL on startup.
   */
  function loadInventory427(dataDir = null, auditLog = null) {
    if (dataDir) _inventoryState427.dataDir = dataDir;
    const file = _inventoryFile427();
    if (!file) return { ok: false, reason: 'no dataDir configured' };
    if (!fs.existsSync(file)) return { ok: true, loaded: 0, reason: 'no file yet' };

    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
      _inventoryState427.inMemory = [];
      let loaded = 0;
      for (const line of lines) {
        try {
          const r = JSON.parse(line);
          if (r && r.inventoryId427) {
            _inventoryState427.inMemory.push(r);
            loaded++;
          }
        } catch (_) {}
      }
      if (auditLog && typeof auditLog.log === 'function') {
        auditLog.log('export_inventory_loaded427', { loaded });
      }
      return { ok: true, loaded };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * getInventory427(opts) — list all past exports with optional filters.
   */
  function getInventory427(opts = {}) {
    let entries = [..._inventoryState427.inMemory];
    if (opts.format) entries = entries.filter(e => e.format === opts.format);
    if (opts.fromTs) {
      const from = new Date(opts.fromTs).getTime();
      entries = entries.filter(e => new Date(e.exportedAt).getTime() >= from);
    }
    if (opts.toTs) {
      const to = new Date(opts.toTs).getTime();
      entries = entries.filter(e => new Date(e.exportedAt).getTime() <= to);
    }
    const limit = parseInt(opts.limit, 10) || 100;
    return entries.slice(-limit);
  }

  /**
   * getExportByFilename427(filename) — look up a single export by filename.
   */
  function getExportByFilename427(filename) {
    if (!filename) return null;
    return _inventoryState427.inMemory.find(e => e.filename === filename) || null;
  }

  /**
   * compactInventory427() — atomically rewrite JSONL deduplicating by inventoryId427.
   */
  function compactInventory427(auditLog = null) {
    const file = _inventoryFile427();
    if (!file || !fs.existsSync(file)) return { ok: false, reason: 'no file to compact' };

    _inventoryState427.stats.compactsRun++;

    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
      const seen = new Map();
      for (const line of lines) {
        try {
          const r = JSON.parse(line);
          if (r && r.inventoryId427) seen.set(r.inventoryId427, r);
        } catch (_) {}
      }
      const unique = [...seen.values()];
      const content = unique.map(r => JSON.stringify(r)).join('\n') + (unique.length ? '\n' : '');
      const tmp = file + '.tmp427';
      fs.writeFileSync(tmp, content, 'utf8');
      fs.renameSync(tmp, file);

      const removed = lines.length - unique.length;
      _appendInvLog427({ event: 'inventory_compacted427', retained: unique.length, removed, ts: new Date().toISOString() });
      if (auditLog && typeof auditLog.log === 'function') {
        auditLog.log('export_inventory_compacted427', { retained: unique.length, removed });
      }
      return { ok: true, retained: unique.length, removed };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function getInventoryStats427() {
    const entries = _inventoryState427.inMemory;
    const totalBytes = entries.reduce((s, e) => s + (e.bytes || 0), 0);
    const totalEntries = entries.reduce((s, e) => s + (e.entryCount || 0), 0);
    const byFormat = {};
    for (const e of entries) {
      byFormat[e.format] = (byFormat[e.format] || 0) + 1;
    }
    return {
      version: EXPORT_INVENTORY_VERSION427,
      totalExports: entries.length,
      totalBytes,
      totalEntries,
      byFormat,
      stats: { ..._inventoryState427.stats },
      recentLog: _inventoryState427.log.slice(-10),
    };
  }

  function wireExportInventory427(app, opts = {}, auditLog = null) {
    if (opts.dataDir) configureExportInventory427({ dataDir: opts.dataDir });

    /* GET /api/v1/x402/distribute/audit/export/inventory */
    app.get('/api/v1/x402/distribute/audit/export/inventory', (req, res) => {
      try {
        const entries = getInventory427(req.query);
        res.json({ ok: true, ecosVersion: 'V427', count: entries.length, exports: entries });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V427' });
      }
    });

    /* POST /api/v1/x402/distribute/audit/export/inventory/compact */
    app.post('/api/v1/x402/distribute/audit/export/inventory/compact', (_req, res) => {
      try {
        const result = compactInventory427(auditLog);
        res.json({ ok: true, ecosVersion: 'V427', ...result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V427' });
      }
    });

    /* GET /api/v1/x402/distribute/audit/export/inventory/stats */
    app.get('/api/v1/x402/distribute/audit/export/inventory/stats', (_req, res) => {
      res.json({ ok: true, ecosVersion: 'V427', ...getInventoryStats427() });
    });

    /* GET /api/v1/x402/distribute/audit/export/inventory/:filename */
    app.get('/api/v1/x402/distribute/audit/export/inventory/:filename', (req, res) => {
      const record = getExportByFilename427(req.params.filename);
      if (!record) {
        return res.status(404).json({ ok: false, error: 'not found', ecosVersion: 'V427' });
      }
      res.json({ ok: true, ecosVersion: 'V427', ...record });
    });
  }

  if (process.env.NODE_ENV === 'test') {
    module.exports = {
      configureExportInventory427,
      recordExport427,
      loadInventory427,
      getInventory427,
      getExportByFilename427,
      compactInventory427,
      getInventoryStats427,
      wireExportInventory427,
      EXPORT_INVENTORY_VERSION427,
      _inventoryState427,
    };
  } else {
    module.exports = {
      configureExportInventory427,
      recordExport427,
      loadInventory427,
      getInventory427,
      getExportByFilename427,
      compactInventory427,
      getInventoryStats427,
      wireExportInventory427,
      EXPORT_INVENTORY_VERSION427,
    };
  }
  