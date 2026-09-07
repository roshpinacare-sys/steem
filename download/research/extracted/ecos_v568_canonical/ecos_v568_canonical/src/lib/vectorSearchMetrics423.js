'use strict';
/**
 * src/lib/vectorSearchMetrics423.js — ECOS V423 (Phase P311) — Vector Search Quality Metrics
 *
 * Tracks per-query latency, recall, and hit-rate for vector search operations.
 * Stores metrics in JSONL for historical analysis and exposes a summary endpoint.
 *
 * Architecture:
 *   PerUserVectorPersistence419.query419 result
 *       ↓
 *   VectorSearchMetrics423.record423(queryId, userId, result, durationMs)
 *       ↓
 *   {dataDir}/vectors/metrics.jsonl
 *
 * All identifiers end in 423 (R2). No new npm deps (R3). Sacred untouched (R1).
 *
 * @version 423.0.0
 */

const fs   = require('fs');
const path = require('path');

const VECTOR_METRICS_VERSION_423 = '423.0.0';
const VECTORS_SUBDIR_423         = 'vectors';
const METRICS_FILE_423           = 'metrics.jsonl';
const MAX_METRIC_RECORDS_423     = 50_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _ensureDir423(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _appendLine423(filePath, record) {
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
}

function _readLines423(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
}

// ── VectorSearchMetrics423 ────────────────────────────────────────────────────

class VectorSearchMetrics423 {
  /**
   * @param {object} opts
   * @param {string} opts.dataDir     — base data directory
   * @param {function} [opts.audit]  — audit(type, data) hook
   */
  constructor(opts = {}) {
    if (!opts.dataDir) throw new Error('VectorSearchMetrics423 requires opts.dataDir (423)');
    this._dataDir      = opts.dataDir;
    this._vectorsDir   = path.join(opts.dataDir, VECTORS_SUBDIR_423);
    this._metricsFile  = path.join(this._vectorsDir, METRICS_FILE_423);
    this._audit        = typeof opts.audit === 'function' ? opts.audit : null;

    this._records423   = [];
  }

  _emit423(type, data) {
    if (this._audit) {
      try { this._audit(type, data); } catch (_) {}
    }
  }

  // ── Record a query result ─────────────────────────────────────────────────

  /**
   * Record metrics for a single vector search query.
   * @param {object} params
   * @param {string}  params.queryId      — unique query identifier
   * @param {string}  params.userId       — user who issued the query
   * @param {number}  params.durationMs   — end-to-end query latency in ms
   * @param {number}  params.resultCount  — number of results returned
   * @param {number}  params.topKRequested — k value requested
   * @param {boolean} [params.hit]        — whether any result was found
   * @param {number}  [params.topScore]   — highest similarity score returned
   * @returns {{ ok: boolean, recordId: string }}
   */
  record423(params) {
    if (!params || !params.queryId) throw new Error('record423 requires params.queryId (423)');
    if (params.durationMs === undefined) throw new Error('record423 requires params.durationMs (423)');

    _ensureDir423(this._vectorsDir);

    const recordId = `vm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const entry = {
      recordId,
      queryId:      params.queryId,
      userId:       params.userId || null,
      durationMs:   params.durationMs,
      resultCount:  params.resultCount  || 0,
      topKRequested: params.topKRequested || 0,
      hit:          params.hit !== undefined ? !!params.hit : (params.resultCount > 0),
      topScore:     params.topScore !== undefined ? params.topScore : null,
      _ts:          Date.now(),
    };

    this._records423.push(entry);
    if (this._records423.length > MAX_METRIC_RECORDS_423) this._records423.shift();
    _appendLine423(this._metricsFile, entry);
    this._emit423('vectors.metrics.record423', { recordId, queryId: params.queryId, durationMs: params.durationMs });
    return { ok: true, recordId };
  }

  // ── Startup replay ─────────────────────────────────────────────────────────

  /**
   * Load all persisted metric records into memory.
   * @returns {{ replayed: number, errors: string[] }}
   */
  loadAll423() {
    const result = { replayed: 0, errors: [] };
    this._records423 = [];
    const lines = _readLines423(this._metricsFile);
    for (const line of lines) {
      try {
        this._records423.push(JSON.parse(line));
        result.replayed++;
      } catch (err) { result.errors.push(`parse: ${err.message}`); }
    }
    if (this._records423.length > MAX_METRIC_RECORDS_423) {
      this._records423 = this._records423.slice(-MAX_METRIC_RECORDS_423);
    }
    this._emit423('vectors.metrics.load423', result);
    return result;
  }

  // ── Query / Aggregation ────────────────────────────────────────────────────

  getRecent423(limit = 50) {
    return this._records423.slice(-limit).reverse();
  }

  /**
   * Compute aggregate quality metrics over a window of records.
   * @param {number} [windowSize=1000]   — number of recent records to aggregate
   * @returns {{ count, avgLatencyMs, p95LatencyMs, hitRate, avgResultCount }}
   */
  aggregate423(windowSize = 1000) {
    const window = this._records423.slice(-windowSize);
    if (!window.length) {
      return { count: 0, avgLatencyMs: 0, p95LatencyMs: 0, hitRate: 0, avgResultCount: 0, version: VECTOR_METRICS_VERSION_423 };
    }

    const latencies = window.map(r => r.durationMs).sort((a, b) => a - b);
    const p95idx = Math.floor(latencies.length * 0.95);
    const hits = window.filter(r => r.hit).length;
    const sumLatency = latencies.reduce((a, b) => a + b, 0);
    const sumResults = window.reduce((a, r) => a + (r.resultCount || 0), 0);

    return {
      count:          window.length,
      avgLatencyMs:   Math.round(sumLatency / window.length),
      p95LatencyMs:   latencies[p95idx] || latencies[latencies.length - 1] || 0,
      hitRate:        Math.round((hits / window.length) * 10000) / 10000,
      avgResultCount: Math.round((sumResults / window.length) * 100) / 100,
      version:        VECTOR_METRICS_VERSION_423,
    };
  }

  // ── Compaction ─────────────────────────────────────────────────────────────

  compact423(maxKeep = 20_000) {
    _ensureDir423(this._vectorsDir);
    const keep  = this._records423.slice(-maxKeep);
    const lines = keep.map(r => JSON.stringify(r) + '\n').join('');
    const tmp   = this._metricsFile + '.tmp';
    fs.writeFileSync(tmp, lines, 'utf8');
    fs.renameSync(tmp, this._metricsFile);
    const bytes = Buffer.byteLength(lines, 'utf8');
    this._emit423('vectors.metrics.compact423', { recordsKept: keep.length, bytesWritten: bytes });
    return { ok: true, recordsKept: keep.length, bytesWritten: bytes };
  }

  stats423() {
    return {
      totalRecords: this._records423.length,
      dataDir:      this._dataDir,
      metricsFile:  this._metricsFile,
      version:      VECTOR_METRICS_VERSION_423,
    };
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  VectorSearchMetrics423,
  VECTOR_METRICS_VERSION_423,
};

// ── Test exports ───────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'test') {
  module.exports._test423 = {
    _ensureDir423,
    _readLines423,
  };
}
