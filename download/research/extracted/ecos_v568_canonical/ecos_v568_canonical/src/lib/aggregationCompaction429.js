'use strict';
/**
 * src/lib/aggregationCompaction429.js — ECOS V429
 *
 * Feature 1: Aggregation Persistence Compaction Scheduling
 * Auto-compact the aggregation JSONL on a configurable interval.
 *
 * Functions:
 *   configureAggregationCompaction429(opts)    — set intervalMs, enabled
 *   startAggregationCompaction429(deps)        — start background worker
 *   stopAggregationCompaction429()             — stop background worker
 *   getAggregationCompactionStatus429()        — worker status, lastRun, stats
 *   wireAggregationCompaction429(app, opts, auditLog) — registers HTTP endpoints
 *
 * Endpoints: AGGCOMP01–AGGCOMP04 (4 endpoints)
 *
 * @version 429.0.0
 * R1: Sacred untouched. R2: All identifiers end in 429. R3: No new npm deps.
 */

const crypto = require('crypto');

const AGGREGATION_COMPACTION_VERSION429 = '429.0.0';
const DEFAULT_COMPACTION_INTERVAL_MS429 = 3600000; // 1 hour

const _aggCompState429 = {
  enabled:      false,
  intervalMs:   DEFAULT_COMPACTION_INTERVAL_MS429,
  worker:       null,
  lastRunAt:    null,
  log:          [],
  stats: {
    totalRuns:  0,
    totalErrors: 0,
  },
};

function _aggCompLog429(event, data) {
  const entry = { ts: new Date().toISOString(), event, ...data };
  _aggCompState429.log.push(entry);
  if (_aggCompState429.log.length > 200) _aggCompState429.log.shift();
}

function configureAggregationCompaction429(opts) {
  const o = opts || {};
  if (o.enabled !== undefined) _aggCompState429.enabled = Boolean(o.enabled);
  if (o.intervalMs !== undefined) {
    if (typeof o.intervalMs !== 'number' || o.intervalMs < 1000) {
      throw new Error('aggregationCompaction429: intervalMs must be >= 1000');
    }
    _aggCompState429.intervalMs = o.intervalMs;
  }
  _aggCompLog429('configured429', { enabled: _aggCompState429.enabled, intervalMs: _aggCompState429.intervalMs });
  return { ok: true, enabled: _aggCompState429.enabled, intervalMs: _aggCompState429.intervalMs };
}

function startAggregationCompaction429(deps) {
  if (_aggCompState429.worker) return { ok: false, reason: 'worker already running' };
  
  const d = deps || {};
  const compactFn = d.compactAggregationPersistence428;
  if (typeof compactFn !== 'function') {
    throw new Error('aggregationCompaction429: compactAggregationPersistence428 dependency required');
  }

  _aggCompState429.worker = setInterval(() => {
    try {
      const result = compactFn();
      _aggCompState429.lastRunAt = new Date().toISOString();
      _aggCompState429.stats.totalRuns++;
      _aggCompLog429('compact_run429', { result });
      
      if (d.auditLog && typeof d.auditLog.append === 'function') {
        d.auditLog.append({ type: 'aggregation_auto_compact429', result });
      }
    } catch (e) {
      _aggCompState429.stats.totalErrors++;
      _aggCompLog429('compact_error429', { error: e.message });
    }
  }, _aggCompState429.intervalMs);

  _aggCompState429.enabled = true;
  _aggCompLog429('worker_started429', { intervalMs: _aggCompState429.intervalMs });
  return { ok: true, started: true };
}

function stopAggregationCompaction429() {
  if (!_aggCompState429.worker) return { ok: true, stopped: false, reason: 'no worker running' };
  clearInterval(_aggCompState429.worker);
  _aggCompState429.worker = null;
  _aggCompState429.enabled = false;
  _aggCompLog429('worker_stopped429', {});
  return { ok: true, stopped: true };
}

function getAggregationCompactionStatus429() {
  return {
    version: AGGREGATION_COMPACTION_VERSION429,
    enabled: _aggCompState429.enabled,
    intervalMs: _aggCompState429.intervalMs,
    workerRunning: !!_aggCompState429.worker,
    lastRunAt: _aggCompState429.lastRunAt,
    stats: { ..._aggCompState429.stats },
  };
}

function wireAggregationCompaction429(app, opts, auditLog) {
  const o = opts || {};
  if (o.intervalMs) configureAggregationCompaction429({ intervalMs: o.intervalMs });

  let compactAggregationPersistence428 = null;
  try {
    const p428 = require('./aggregationPersistence428.js');
    if (p428.compactAggregationPersistence428) compactAggregationPersistence428 = p428.compactAggregationPersistence428;
  } catch (_) {}

  const BASE429 = '/api/v1/chat/route/telemetry/dashboard/trend/aggregate/persist/compaction';

  app.post(BASE429 + '/start', (req, res) => {
    try {
      const result = startAggregationCompaction429({ compactAggregationPersistence428, auditLog });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post(BASE429 + '/stop', (req, res) => {
    try {
      const result = stopAggregationCompaction429();
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get(BASE429 + '/status', (req, res) => {
    try {
      res.json(getAggregationCompactionStatus429());
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post(BASE429 + '/configure', (req, res) => {
    try {
      const result = configureAggregationCompaction429(req.body);
      res.json(result);
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });
}

module.exports = {
  AGGREGATION_COMPACTION_VERSION429,
  _aggCompState429,
  configureAggregationCompaction429,
  startAggregationCompaction429,
  stopAggregationCompaction429,
  getAggregationCompactionStatus429,
  wireAggregationCompaction429,
};
