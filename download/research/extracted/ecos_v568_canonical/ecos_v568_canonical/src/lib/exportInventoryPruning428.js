'use strict';
/**
 * src/lib/exportInventoryPruning428.js — ECOS V428
 *
 * Feature 5: Export Inventory Pruning
 * Auto-prune inventory and files older than configurable retention window (e.g. 30d).
 * Exposes DELETE endpoint. Emits audit events.
 *
 * Functions:
 *   configureExportPruning428(opts)            — set retentionMs, autoDeleteFiles, dataDir
 *   pruneExportInventory428(deps)              — prune records + optionally delete files; emit audit
 *   scheduleAutoPrune428(intervalMs)           — start background auto-prune worker
 *   stopAutoPrune428()                         — stop background worker
 *   getPruningStatus428()                      — stats + config
 *   getPruningLog428(limit)                    — event log
 *   wireExportInventoryPruning428(app, opts, auditLog) — registers HTTP endpoints
 *
 * Endpoints: EINVPRUNE01–EINVPRUNE05 (5 endpoints)
 *
 * @version 428.0.0
 * R1: Sacred untouched. R2: All identifiers end in 428. R3: No new npm deps.
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXPORT_PRUNING_VERSION428 = '428.0.0';
const DEFAULT_RETENTION_MS428 = 30 * 24 * 60 * 60 * 1000; // 30 days

const _pruningState428 = {
  retentionMs:      DEFAULT_RETENTION_MS428,
  autoDeleteFiles:  false,
  dataDir:          null,
  worker:           null,
  log:              [],
  stats: {
    totalPruneRuns:    0,
    totalRecordsPruned: 0,
    totalFilesPruned:   0,
    totalBytesFreed:    0,
  },
};

// ─── helpers ────────────────────────────────────────────────────────────────

function _pruneLog428(event, data) {
  const entry = { ts: new Date().toISOString(), event, ...data };
  _pruningState428.log.push(entry);
  if (_pruningState428.log.length > 300) _pruningState428.log.shift();
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Configure export inventory pruning.
 * @param {object} opts - { retentionMs, autoDeleteFiles, dataDir }
 */
function configureExportPruning428(opts) {
  const o = opts || {};
  if (o.retentionMs !== undefined) {
    if (typeof o.retentionMs !== 'number' || o.retentionMs < 0) {
      throw new Error('exportInventoryPruning428: retentionMs must be a non-negative number');
    }
    _pruningState428.retentionMs = o.retentionMs;
  }
  if (o.autoDeleteFiles !== undefined) _pruningState428.autoDeleteFiles = Boolean(o.autoDeleteFiles);
  if (o.dataDir !== undefined) _pruningState428.dataDir = o.dataDir;

  _pruneLog428('configured428', {
    retentionMs: _pruningState428.retentionMs,
    autoDeleteFiles: _pruningState428.autoDeleteFiles,
  });
  return {
    ok: true,
    retentionMs: _pruningState428.retentionMs,
    autoDeleteFiles: _pruningState428.autoDeleteFiles,
    dataDir: _pruningState428.dataDir,
  };
}

/**
 * Prune export inventory: remove records older than retentionMs.
 * Optionally delete the actual export files from disk.
 * Emits audit events via deps.auditLog.
 *
 * @param {object} deps - { inventoryStore?, auditLog?, exportDir? }
 *   inventoryStore: object with getInventory427, _inventoryState427 (from exportInventory427)
 * @returns {{ ok, pruneId428, recordsPruned, filesPruned, bytesFreed, auditEvents }}
 */
function pruneExportInventory428(deps) {
  const d = deps || {};
  const pruneId428 = 'prune428_' + crypto.randomBytes(8).toString('hex');
  const prunedAt = new Date().toISOString();
  const cutoffTs = Date.now() - _pruningState428.retentionMs;

  const auditEvents = [];
  let recordsPruned = 0;
  let filesPruned   = 0;
  let bytesFreed    = 0;

  // Get inventory records from injected store or internal state
  let allRecords = [];
  try {
    if (d.inventoryStore && typeof d.inventoryStore.getInventory427 === 'function') {
      allRecords = d.inventoryStore.getInventory427({});
    } else if (d.inventoryState && Array.isArray(d.inventoryState.records)) {
      allRecords = d.inventoryState.records.slice();
    }
  } catch (e) {
    _pruneLog428('inventory_read_error428', { pruneId428, error: e.message });
  }

  const toKeep   = [];
  const toPrune  = [];

  for (const record of allRecords) {
    const recordTs = new Date(record.recordedAt || record.createdAt || 0).getTime();
    if (recordTs < cutoffTs) {
      toPrune.push(record);
    } else {
      toKeep.push(record);
    }
  }

  // Prune records from inventory store
  for (const record of toPrune) {
    recordsPruned++;
    bytesFreed += record.bytes || 0;

    // Optionally delete file from disk
    if (_pruningState428.autoDeleteFiles) {
      const exportDir = d.exportDir || (_pruningState428.dataDir ? path.join(_pruningState428.dataDir, 'audit_exports') : null);
      if (exportDir && record.filename) {
        const filePath = path.join(exportDir, record.filename);
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            filesPruned++;
            _pruneLog428('file_deleted428', { pruneId428, filename: record.filename });
          }
        } catch (e) {
          _pruneLog428('file_delete_error428', { pruneId428, filename: record.filename, error: e.message });
        }
      }
    }

    auditEvents.push({
      type: 'export_record_pruned428',
      pruneId428,
      inventoryId: record.inventoryId427 || record.inventoryId,
      filename: record.filename,
      bytes: record.bytes,
      recordedAt: record.recordedAt,
      prunedAt,
    });
  }

  // Update inventory store if possible
  if (d.inventoryStore && d.inventoryStore._inventoryState427) {
    d.inventoryStore._inventoryState427.records = toKeep;
  } else if (d.inventoryState && Array.isArray(d.inventoryState.records)) {
    d.inventoryState.records = toKeep;
  }

  // Emit audit events
  const auditLog = d.auditLog;
  if (auditLog && typeof auditLog.append === 'function') {
    for (const ev of auditEvents) {
      try { auditLog.append(ev); } catch (_) {}
    }
  }

  _pruningState428.stats.totalPruneRuns++;
  _pruningState428.stats.totalRecordsPruned += recordsPruned;
  _pruningState428.stats.totalFilesPruned   += filesPruned;
  _pruningState428.stats.totalBytesFreed    += bytesFreed;

  _pruneLog428('prune_complete428', { pruneId428, recordsPruned, filesPruned, bytesFreed });

  return {
    ok: true,
    pruneId428,
    prunedAt,
    retentionMs: _pruningState428.retentionMs,
    cutoffTs: new Date(cutoffTs).toISOString(),
    recordsPruned,
    filesPruned,
    bytesFreed,
    auditEvents,
  };
}

/**
 * Start a background auto-prune worker.
 * @param {number} intervalMs - interval between prune runs
 * @param {object} [deps]     - passed to pruneExportInventory428
 */
function scheduleAutoPrune428(intervalMs, deps) {
  if (_pruningState428.worker) return { ok: false, reason: 'worker already running' };
  if (typeof intervalMs !== 'number' || intervalMs < 1000) {
    throw new Error('exportInventoryPruning428: intervalMs must be >= 1000');
  }
  _pruningState428.worker = setInterval(() => {
    try { pruneExportInventory428(deps || {}); } catch (_) {}
  }, intervalMs);
  _pruneLog428('worker_started428', { intervalMs });
  return { ok: true, started: true, intervalMs };
}

/**
 * Stop the background auto-prune worker.
 */
function stopAutoPrune428() {
  if (!_pruningState428.worker) return { ok: true, stopped: false, reason: 'no worker running' };
  clearInterval(_pruningState428.worker);
  _pruningState428.worker = null;
  _pruneLog428('worker_stopped428', {});
  return { ok: true, stopped: true };
}

/**
 * Get pruning status.
 */
function getPruningStatus428() {
  return {
    version: EXPORT_PRUNING_VERSION428,
    retentionMs: _pruningState428.retentionMs,
    autoDeleteFiles: _pruningState428.autoDeleteFiles,
    dataDir: _pruningState428.dataDir,
    workerRunning: !!_pruningState428.worker,
    stats: { ..._pruningState428.stats },
  };
}

/**
 * Get pruning event log.
 * @param {number} [limit=50]
 */
function getPruningLog428(limit) {
  const n = (typeof limit === 'number' && limit > 0) ? limit : 50;
  return _pruningState428.log.slice(-n);
}

// ─── wire ────────────────────────────────────────────────────────────────────

/**
 * Wire HTTP endpoints for export inventory pruning.
 * EINVPRUNE01 DELETE /api/v1/x402/distribute/audit/export/inventory/prune
 * EINVPRUNE02 POST   /api/v1/x402/distribute/audit/export/inventory/prune
 * EINVPRUNE03 GET    /api/v1/x402/distribute/audit/export/inventory/prune/status
 * EINVPRUNE04 POST   /api/v1/x402/distribute/audit/export/inventory/prune/configure
 * EINVPRUNE05 GET    /api/v1/x402/distribute/audit/export/inventory/prune/log
 */
function wireExportInventoryPruning428(app, opts, auditLog) {
  const o = opts || {};
  if (o.retentionMs !== undefined || o.autoDeleteFiles !== undefined || o.dataDir !== undefined) {
    configureExportPruning428(o);
  }

  // Try to get inventory store non-fatally
  let inventoryStore = null;
  try {
    inventoryStore = require('./exportInventory427.js');
  } catch (_) {}

  const BASE428 = '/api/v1/x402/distribute/audit/export/inventory/prune';

  // EINVPRUNE01 — DELETE (prune by retention)
  app.delete(BASE428, (req, res) => {
    try {
      const result = pruneExportInventory428({ inventoryStore, auditLog });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // EINVPRUNE02 — POST (explicit prune trigger with optional body overrides)
  app.post(BASE428, (req, res) => {
    try {
      const body = req.body || {};
      // Allow one-shot retentionMs override
      if (body.retentionMs !== undefined) {
        const saved = _pruningState428.retentionMs;
        _pruningState428.retentionMs = body.retentionMs;
        const result = pruneExportInventory428({ inventoryStore, auditLog });
        _pruningState428.retentionMs = saved;
        return res.json(result);
      }
      const result = pruneExportInventory428({ inventoryStore, auditLog });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // EINVPRUNE03 — status
  app.get(BASE428 + '/status', (req, res) => {
    try {
      res.json(getPruningStatus428());
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // EINVPRUNE04 — configure
  app.post(BASE428 + '/configure', (req, res) => {
    try {
      const body = req.body || {};
      const result = configureExportPruning428(body);
      res.json(result);
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  // EINVPRUNE05 — log
  app.get(BASE428 + '/log', (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
      res.json({ ok: true, log: getPruningLog428(limit) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

// ─── exports ─────────────────────────────────────────────────────────────────

module.exports = {
  EXPORT_PRUNING_VERSION428,
  DEFAULT_RETENTION_MS428,
  _pruningState428,
  configureExportPruning428,
  pruneExportInventory428,
  scheduleAutoPrune428,
  stopAutoPrune428,
  getPruningStatus428,
  getPruningLog428,
  wireExportInventoryPruning428,
};
