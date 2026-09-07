'use strict';
/**
 * src/lib/intentRoutingTelemetry423.js — ECOS V423 (Phase P311) — Intent Routing Telemetry
 *
 * Persists routeIntent422 results and confidence scores to JSONL so routing
 * quality can be analysed over time.
 *
 * Architecture:
 *   routeIntent422 → IntentRoutingTelemetry423
 *       ↓ append each routing decision
 *   {dataDir}/telemetry/intent_routing.jsonl  (WAL-style append-only)
 *
 * All identifiers end in 423 (R2). No new npm deps (R3). Sacred untouched (R1).
 *
 * @version 423.0.0
 */

const fs   = require('fs');
const path = require('path');

const TELEMETRY_VERSION_423 = '423.0.0';
const TELEMETRY_SUBDIR_423  = 'telemetry';
const INTENT_ROUTING_FILE_423 = 'intent_routing.jsonl';
const MAX_TELEMETRY_RECORDS_423 = 100_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _ensureDir423(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _appendLine423(filePath, record) {
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
}

function _readLines423(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split('\n').filter(l => l.trim());
}

// ── IntentRoutingTelemetry423 ─────────────────────────────────────────────────

class IntentRoutingTelemetry423 {
  /**
   * @param {object} opts
   * @param {string} opts.dataDir  — base data directory (telemetry/ will be created inside)
   * @param {function} [opts.audit]  — audit(type, data) hook
   */
  constructor(opts = {}) {
    if (!opts.dataDir) throw new Error('IntentRoutingTelemetry423 requires opts.dataDir (423)');
    this._dataDir       = opts.dataDir;
    this._telemetryDir  = path.join(opts.dataDir, TELEMETRY_SUBDIR_423);
    this._routingFile   = path.join(this._telemetryDir, INTENT_ROUTING_FILE_423);
    this._audit         = typeof opts.audit === 'function' ? opts.audit : null;

    // In-memory replica (capped)
    this._records423 = [];
  }

  _emit423(type, data) {
    if (this._audit) {
      try { this._audit(type, data); } catch (_) {}
    }
  }

  // ── Record a routing decision ─────────────────────────────────────────────

  /**
   * Persist one routeIntent422 result.
   * @param {object} routingResult  — full object returned by routeIntent422
   * @param {string} [sessionId]    — optional session identifier
   * @returns {{ ok: boolean, recordId: string }}
   */
  record423(routingResult, sessionId) {
    _ensureDir423(this._telemetryDir);
    const recordId = `rt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const entry = {
      recordId,
      sessionId: sessionId || null,
      primaryIntent:     routingResult.primaryIntent422 || null,
      primaryConfidence: routingResult.primaryIntentConfidence422 || 0,
      edgeCaseDetected:  routingResult.edgeCaseDetected422 || false,
      richIntentTypes:   routingResult.richIntentTypes422 || [],
      multimodalHint:    routingResult.multimodalHint422 || [],
      baseIntentType:    routingResult.intentType || null,
      baseMatched:       routingResult.matched || false,
      taxonomyVersion:   routingResult.taxonomyVersion422 || null,
      _ts: Date.now(),
    };

    this._records423.push(entry);
    if (this._records423.length > MAX_TELEMETRY_RECORDS_423) this._records423.shift();
    _appendLine423(this._routingFile, entry);
    this._emit423('intent.telemetry.record423', { recordId, primaryIntent: entry.primaryIntent });
    return { ok: true, recordId };
  }

  // ── Startup replay ────────────────────────────────────────────────────────

  /**
   * Load all persisted telemetry records into memory.
   * @returns {{ replayed: number, errors: string[] }}
   */
  loadAll423() {
    const result = { replayed: 0, errors: [] };
    this._records423 = [];
    const lines = _readLines423(this._routingFile);
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        this._records423.push(rec);
        result.replayed++;
      } catch (err) { result.errors.push(`parse: ${err.message}`); }
    }
    if (this._records423.length > MAX_TELEMETRY_RECORDS_423) {
      this._records423 = this._records423.slice(-MAX_TELEMETRY_RECORDS_423);
    }
    this._emit423('intent.telemetry.load423', result);
    return result;
  }

  // ── Query ─────────────────────────────────────────────────────────────────

  /**
   * Get recent telemetry records (most recent first).
   * @param {number} [limit=50]
   * @returns {Array}
   */
  getRecent423(limit = 50) {
    return this._records423.slice(-limit).reverse();
  }

  /**
   * Aggregate confidence score statistics for a given intent type.
   * @param {string} intentType
   * @returns {{ intentType, count, avgConfidence, minConfidence, maxConfidence }}
   */
  aggregateByIntent423(intentType) {
    const relevant = this._records423.filter(r => r.primaryIntent === intentType);
    if (!relevant.length) return { intentType, count: 0, avgConfidence: 0, minConfidence: 0, maxConfidence: 0 };
    const scores = relevant.map(r => r.primaryConfidence || 0);
    const sum = scores.reduce((a, b) => a + b, 0);
    return {
      intentType,
      count:         relevant.length,
      avgConfidence: Math.round((sum / relevant.length) * 100) / 100,
      minConfidence: Math.min(...scores),
      maxConfidence: Math.max(...scores),
      edgeCaseRate:  Math.round((relevant.filter(r => r.edgeCaseDetected).length / relevant.length) * 100) / 100,
    };
  }

  /**
   * Full summary across all recorded intents.
   * @returns {{ totalRecords, intentBreakdown, edgeCaseTotal, topIntent }}
   */
  summary423() {
    const intentCounts = {};
    let edgeCaseTotal = 0;
    for (const r of this._records423) {
      const k = r.primaryIntent || 'unknown';
      intentCounts[k] = (intentCounts[k] || 0) + 1;
      if (r.edgeCaseDetected) edgeCaseTotal++;
    }
    const topEntry = Object.entries(intentCounts).sort((a, b) => b[1] - a[1])[0];
    return {
      totalRecords:    this._records423.length,
      intentBreakdown: intentCounts,
      edgeCaseTotal,
      topIntent:       topEntry ? topEntry[0] : null,
      version:         TELEMETRY_VERSION_423,
    };
  }

  // ── Compaction ─────────────────────────────────────────────────────────────

  /**
   * Compact JSONL — keeps only the most recent maxKeep records.
   * @param {number} [maxKeep=10000]
   * @returns {{ ok: boolean, recordsKept: number, bytesWritten: number }}
   */
  compact423(maxKeep = 10_000) {
    _ensureDir423(this._telemetryDir);
    const keep  = this._records423.slice(-maxKeep);
    const lines = keep.map(r => JSON.stringify(r) + '\n').join('');
    const tmp   = this._routingFile + '.tmp';
    fs.writeFileSync(tmp, lines, 'utf8');
    fs.renameSync(tmp, this._routingFile);
    const bytes = Buffer.byteLength(lines, 'utf8');
    this._emit423('intent.telemetry.compact423', { recordsKept: keep.length, bytesWritten: bytes });
    return { ok: true, recordsKept: keep.length, bytesWritten: bytes };
  }

  stats423() {
    return {
      totalRecords: this._records423.length,
      dataDir:      this._dataDir,
      routingFile:  this._routingFile,
      version:      TELEMETRY_VERSION_423,
    };
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  IntentRoutingTelemetry423,
  TELEMETRY_VERSION_423,
};

// ── Test exports ───────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'test') {
  module.exports._test423 = {
    _ensureDir423,
    _readLines423,
  };
}
