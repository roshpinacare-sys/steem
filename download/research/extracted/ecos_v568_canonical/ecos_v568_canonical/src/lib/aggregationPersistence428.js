'use strict';
/**
 * src/lib/aggregationPersistence428.js — ECOS V428
 *
 * Feature 1: Aggregation Persistence
 * Persists rolling trend aggregation summaries to JSONL so they survive restarts.
 * Loads on startup. Configurable max-summary count.
 *
 * Functions:
 *   configureAggregationPersistence428(opts)   — set dataDir, maxSummaries
 *   persistAggregationSummary428(summary)      — append summary to JSONL + in-memory
 *   loadAggregationSummaries428(dataDir)       — replay JSONL into memory on startup
 *   getPersistedSummaries428(opts)             — list summaries with optional filters
 *   compactAggregationPersistence428()         — deduplicate JSONL by summaryId427; keep newest
 *   getAggregationPersistenceStatus428()       — file stats, in-memory count, config
 *   wireAggregationPersistence428(app, opts, auditLog) — registers HTTP endpoints
 *
 * Endpoints: AGGP01–AGGP05 (5 endpoints)
 *
 * @version 428.0.0
 * R1: Sacred untouched. R2: All identifiers end in 428. R3: No new npm deps.
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const AGGREGATION_PERSISTENCE_VERSION428 = '428.0.0';
const DEFAULT_MAX_SUMMARIES428 = 1000;
const AGGP_FILE428 = 'aggregation_summaries428.jsonl';

const _aggPersistState428 = {
  dataDir:       null,
  file:          null,
  summaries:     [],   // in-memory mirror
  maxSummaries:  DEFAULT_MAX_SUMMARIES428,
  log:           [],
  stats: {
    persisted:   0,
    loaded:      0,
    compacted:   0,
    loadErrors:  0,
  },
};

// ─── helpers ────────────────────────────────────────────────────────────────

function _aggPersistLog428(event, data) {
  const entry = { ts: new Date().toISOString(), event, ...data };
  _aggPersistState428.log.push(entry);
  if (_aggPersistState428.log.length > 200) _aggPersistState428.log.shift();
}

function _ensureAggPersistDir428() {
  if (!_aggPersistState428.dataDir) throw new Error('aggregationPersistence428: dataDir not configured');
  if (!fs.existsSync(_aggPersistState428.dataDir)) {
    fs.mkdirSync(_aggPersistState428.dataDir, { recursive: true });
  }
}

function _aggPersistFilePath428() {
  if (!_aggPersistState428.dataDir) return null;
  return path.join(_aggPersistState428.dataDir, AGGP_FILE428);
}

function _appendAggPersistLine428(obj) {
  const filePath = _aggPersistFilePath428();
  if (!filePath) return;
  _ensureAggPersistDir428();
  fs.appendFileSync(filePath, JSON.stringify(obj) + '\n', 'utf8');
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Configure aggregation persistence.
 * @param {object} opts - { dataDir, maxSummaries }
 */
function configureAggregationPersistence428(opts) {
  const o = opts || {};
  if (o.dataDir !== undefined) _aggPersistState428.dataDir = o.dataDir;
  if (o.maxSummaries !== undefined) {
    if (typeof o.maxSummaries !== 'number' || o.maxSummaries < 1) {
      throw new Error('aggregationPersistence428: maxSummaries must be a positive number');
    }
    _aggPersistState428.maxSummaries = o.maxSummaries;
  }
  const filePath = _aggPersistFilePath428();
  _aggPersistLog428('configured428', { dataDir: _aggPersistState428.dataDir, maxSummaries: _aggPersistState428.maxSummaries });
  return {
    ok: true,
    dataDir: _aggPersistState428.dataDir,
    maxSummaries: _aggPersistState428.maxSummaries,
    file: filePath,
  };
}

/**
 * Persist a single aggregation summary to JSONL and in-memory store.
 * @param {object} summary - must have summaryId427 (or summaryId428) field
 */
function persistAggregationSummary428(summary) {
  if (!summary || typeof summary !== 'object') {
    throw new Error('aggregationPersistence428: summary must be an object');
  }
  const id = summary.summaryId427 || summary.summaryId428 || summary.summaryId;
  if (!id) throw new Error('aggregationPersistence428: summary must have a summaryId field');

  const record = {
    ...summary,
    persistedAt428: new Date().toISOString(),
    persistenceId428: crypto.randomBytes(8).toString('hex'),
  };

  // Append to JSONL if configured
  if (_aggPersistState428.dataDir) {
    try {
      _appendAggPersistLine428(record);
    } catch (e) {
      _aggPersistLog428('persist_error428', { error: e.message });
    }
  }

  // In-memory ring
  _aggPersistState428.summaries.push(record);
  if (_aggPersistState428.summaries.length > _aggPersistState428.maxSummaries) {
    _aggPersistState428.summaries.shift();
  }

  _aggPersistState428.stats.persisted++;
  _aggPersistLog428('persisted428', { id, persistenceId428: record.persistenceId428 });

  return { ok: true, persistenceId428: record.persistenceId428, id };
}

/**
 * Load aggregation summaries from JSONL on startup.
 * @param {string} [dataDir] - override dataDir
 */
function loadAggregationSummaries428(dataDir) {
  // When called with no argument AND state has no dataDir, return error
  const dir = (dataDir !== undefined && dataDir !== null) ? dataDir : _aggPersistState428.dataDir;
  if (!dir) return { ok: false, reason: 'no dataDir configured', loaded: 0 };

  const filePath = path.join(dir, AGGP_FILE428);
  if (!fs.existsSync(filePath)) return { ok: true, loaded: 0, reason: 'no file yet' };

  let loaded = 0;
  let errors = 0;
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  _aggPersistState428.summaries = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      _aggPersistState428.summaries.push(obj);
      loaded++;
    } catch (_) {
      errors++;
      _aggPersistState428.stats.loadErrors++;
    }
  }

  // Trim to maxSummaries (keep newest)
  if (_aggPersistState428.summaries.length > _aggPersistState428.maxSummaries) {
    _aggPersistState428.summaries = _aggPersistState428.summaries.slice(-_aggPersistState428.maxSummaries);
  }

  _aggPersistState428.stats.loaded += loaded;
  _aggPersistLog428('loaded428', { loaded, errors, filePath });
  return { ok: true, loaded, errors };
}

/**
 * Get persisted summaries with optional filters.
 * @param {object} opts - { fromTs, toTs, limit }
 */
function getPersistedSummaries428(opts) {
  const o = opts || {};
  let results = _aggPersistState428.summaries.slice();

  if (o.fromTs) {
    const from = new Date(o.fromTs).getTime();
    results = results.filter(s => {
      const ts = new Date(s.persistedAt428 || s.computedAt || 0).getTime();
      return ts >= from;
    });
  }
  if (o.toTs) {
    const to = new Date(o.toTs).getTime();
    results = results.filter(s => {
      const ts = new Date(s.persistedAt428 || s.computedAt || 0).getTime();
      return ts <= to;
    });
  }
  if (o.limit) results = results.slice(-o.limit);

  return results;
}

/**
 * Compact the JSONL file: deduplicate by summaryId (last write wins), keep only maxSummaries newest.
 */
function compactAggregationPersistence428() {
  if (!_aggPersistState428.dataDir) return { ok: false, reason: 'no dataDir configured' };

  const filePath = _aggPersistFilePath428();
  if (!fs.existsSync(filePath)) return { ok: true, retained: 0, reason: 'no file' };

  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const map = new Map();
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const id = obj.summaryId427 || obj.summaryId428 || obj.summaryId || obj.persistenceId428;
      if (id) map.set(id, obj);
    } catch (_) {}
  }

  let records = Array.from(map.values());
  if (records.length > _aggPersistState428.maxSummaries) {
    records = records.slice(-_aggPersistState428.maxSummaries);
  }

  const newContent = records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
  fs.writeFileSync(filePath, newContent, 'utf8');

  _aggPersistState428.summaries = records;
  _aggPersistState428.stats.compacted++;
  _aggPersistLog428('compacted428', { retained: records.length });

  return { ok: true, retained: records.length };
}

/**
 * Get persistence status.
 */
function getAggregationPersistenceStatus428() {
  const filePath = _aggPersistFilePath428();
  let fileExists = false;
  let fileBytes = 0;
  if (filePath && fs.existsSync(filePath)) {
    fileExists = true;
    fileBytes = fs.statSync(filePath).size;
  }
  return {
    version: AGGREGATION_PERSISTENCE_VERSION428,
    dataDir: _aggPersistState428.dataDir,
    file: filePath,
    fileExists,
    fileBytes,
    inMemoryCount: _aggPersistState428.summaries.length,
    maxSummaries: _aggPersistState428.maxSummaries,
    stats: { ..._aggPersistState428.stats },
  };
}

// ─── wire ────────────────────────────────────────────────────────────────────

/**
 * Wire HTTP endpoints for aggregation persistence.
 * AGGP01 GET  /api/v1/chat/route/telemetry/dashboard/trend/aggregate/persist
 * AGGP02 POST /api/v1/chat/route/telemetry/dashboard/trend/aggregate/persist
 * AGGP03 POST /api/v1/chat/route/telemetry/dashboard/trend/aggregate/persist/load
 * AGGP04 POST /api/v1/chat/route/telemetry/dashboard/trend/aggregate/persist/compact
 * AGGP05 GET  /api/v1/chat/route/telemetry/dashboard/trend/aggregate/persist/status
 */
function wireAggregationPersistence428(app, opts, auditLog) {
  const o = opts || {};
  if (o.dataDir) configureAggregationPersistence428({ dataDir: o.dataDir });
  if (o.maxSummaries) configureAggregationPersistence428({ maxSummaries: o.maxSummaries });

  const BASE428 = '/api/v1/chat/route/telemetry/dashboard/trend/aggregate/persist';

  // AGGP01 — list persisted summaries
  app.get(BASE428, (req, res) => {
    try {
      const { fromTs, toTs, limit } = req.query;
      const results = getPersistedSummaries428({
        fromTs: fromTs || null,
        toTs: toTs || null,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      res.json({ ok: true, count: results.length, summaries: results });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // AGGP02 — persist a summary
  app.post(BASE428, (req, res) => {
    try {
      const body = req.body || {};
      const result = persistAggregationSummary428(body);
      if (auditLog && typeof auditLog.append === 'function') {
        try { auditLog.append({ type: 'aggregation_persist428', ...result }); } catch (_) {}
      }
      res.json(result);
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  // AGGP03 — load from JSONL
  app.post(BASE428 + '/load', (req, res) => {
    try {
      const body = req.body || {};
      const result = loadAggregationSummaries428(body.dataDir);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // AGGP04 — compact JSONL
  app.post(BASE428 + '/compact', (req, res) => {
    try {
      const result = compactAggregationPersistence428();
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // AGGP05 — status
  app.get(BASE428 + '/status', (req, res) => {
    try {
      res.json(getAggregationPersistenceStatus428());
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

// ─── exports ─────────────────────────────────────────────────────────────────

module.exports = {
  AGGREGATION_PERSISTENCE_VERSION428,
  DEFAULT_MAX_SUMMARIES428,
  _aggPersistState428,
  configureAggregationPersistence428,
  persistAggregationSummary428,
  loadAggregationSummaries428,
  getPersistedSummaries428,
  compactAggregationPersistence428,
  getAggregationPersistenceStatus428,
  wireAggregationPersistence428,
};
