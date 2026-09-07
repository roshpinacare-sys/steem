'use strict';
/**
 * src/lib/x402Persistence422.js — ECOS V422 (Phase P310) — x402 Inflow & Pool Persistence
 *
 * Persists X402RewardInflow418 inflow log and pool balances to JSONL so payment
 * history survives server restarts.
 *
 * Architecture:
 *   X402RewardInflow418 → x402Persistence422
 *       ↓ record inflow / pool snapshot
 *   {dataDir}/x402/inflows.jsonl   (WAL-style append-only)
 *   {dataDir}/x402/pool.jsonl      (WAL-style append-only)
 *
 * All identifiers end in 422 (R2). No new npm deps (R3). Sacred untouched (R1).
 *
 * @version 422.0.0
 */

const fs   = require('fs');
const path = require('path');

const X402_PERSISTENCE_VERSION_422 = '422.0.0';
const X402_SUBDIR_422 = 'x402';
const INFLOW_FILE_422 = 'inflows.jsonl';
const POOL_FILE_422   = 'pool.jsonl';
const MAX_INFLOW_RECORDS_422 = 50_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _ensureDir422(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _appendLine422(filePath, record) {
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
}

function _readLines422(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split('\n').filter(l => l.trim());
}

// ── X402Persistence422 ────────────────────────────────────────────────────────

class X402Persistence422 {
  /**
   * @param {object} opts
   * @param {string} opts.dataDir  — base data directory (x402/ will be created inside)
   * @param {function} [opts.audit]  — audit(type, data) hook
   */
  constructor(opts = {}) {
    if (!opts.dataDir) throw new Error('X402Persistence422 requires opts.dataDir (422)');
    this._dataDir  = opts.dataDir;
    this._x402Dir  = path.join(opts.dataDir, X402_SUBDIR_422);
    this._inflowFile = path.join(this._x402Dir, INFLOW_FILE_422);
    this._poolFile   = path.join(this._x402Dir, POOL_FILE_422);
    this._audit    = typeof opts.audit === 'function' ? opts.audit : null;

    // In-memory replica
    this._inflows422 = [];
    this._poolSnapshots422 = [];
  }

  _emit422(type, data) {
    if (this._audit) {
      try { this._audit(type, data); } catch (_) {}
    }
  }

  // ── Public API: inflow persistence ───────────────────────────────────────────

  /**
   * Persist an inflow event to JSONL.
   * @param {object} event  — must contain at least inflowId, queryId, amountMicro, ts
   */
  persistInflow422(event) {
    _ensureDir422(this._x402Dir);
    const record = Object.assign({}, event, { _type: 'inflow', _persistedAt: Date.now() });
    this._inflows422.push(record);
    if (this._inflows422.length > MAX_INFLOW_RECORDS_422) this._inflows422.shift();
    _appendLine422(this._inflowFile, record);
    this._emit422('x402.persistence.inflow422', { inflowId: event.inflowId, queryId: event.queryId });
    return { ok: true, inflowId: event.inflowId };
  }

  /**
   * Persist a pool snapshot to JSONL.
   * @param {object} snapshot  — pool snapshot object (should contain validatorPool, creatorPool, platformPool, totalInflow)
   */
  persistPoolSnapshot422(snapshot) {
    _ensureDir422(this._x402Dir);
    const record = Object.assign({}, snapshot, { _type: 'pool', _persistedAt: Date.now() });
    this._poolSnapshots422.push(record);
    if (this._poolSnapshots422.length > MAX_INFLOW_RECORDS_422) this._poolSnapshots422.shift();
    _appendLine422(this._poolFile, record);
    this._emit422('x402.persistence.pool422', { ts: record._persistedAt });
    return { ok: true, ts: record._persistedAt };
  }

  // ── Startup replay ───────────────────────────────────────────────────────────

  /**
   * Replay both JSONL files into in-memory replicas.
   * @returns {{ inflowsReplayed: number, poolSnapshotsReplayed: number, errors: string[] }}
   */
  loadAll422() {
    const result = { inflowsReplayed: 0, poolSnapshotsReplayed: 0, errors: [] };
    this._inflows422 = [];
    this._poolSnapshots422 = [];

    // Replay inflows
    const inflowLines = _readLines422(this._inflowFile);
    for (const line of inflowLines) {
      try {
        const rec = JSON.parse(line);
        if (rec._type === 'inflow') {
          this._inflows422.push(rec);
          result.inflowsReplayed++;
        }
      } catch (err) { result.errors.push(`inflow parse: ${err.message}`); }
    }
    if (this._inflows422.length > MAX_INFLOW_RECORDS_422) {
      this._inflows422 = this._inflows422.slice(-MAX_INFLOW_RECORDS_422);
    }

    // Replay pool
    const poolLines = _readLines422(this._poolFile);
    for (const line of poolLines) {
      try {
        const rec = JSON.parse(line);
        if (rec._type === 'pool') {
          this._poolSnapshots422.push(rec);
          result.poolSnapshotsReplayed++;
        }
      } catch (err) { result.errors.push(`pool parse: ${err.message}`); }
    }
    if (this._poolSnapshots422.length > MAX_INFLOW_RECORDS_422) {
      this._poolSnapshots422 = this._poolSnapshots422.slice(-MAX_INFLOW_RECORDS_422);
    }

    this._emit422('x402.persistence.load422', result);
    return result;
  }

  // ── Query APIs ───────────────────────────────────────────────────────────────

  /**
   * Get recent inflow events (most recent first).
   * @param {number} [limit=50]
   * @returns {Array}
   */
  getRecentInflows422(limit = 50) {
    return this._inflows422.slice(-limit).reverse();
  }

  /**
   * Get recent pool snapshots (most recent first).
   * @param {number} [limit=50]
   * @returns {Array}
   */
  getPoolSnapshots422(limit = 50) {
    return this._poolSnapshots422.slice(-limit).reverse();
  }

  // ── Compaction ───────────────────────────────────────────────────────────────

  /**
   * Compact the inflows JSONL — keeps only the most recent maxKeep records.
   * @param {number} [maxKeep=5000]
   * @returns {{ ok: boolean, recordsKept: number, bytesWritten: number }}
   */
  compactInflows422(maxKeep = 5000) {
    _ensureDir422(this._x402Dir);
    const keep = this._inflows422.slice(-maxKeep);
    const lines = keep.map(r => JSON.stringify(r) + '\n').join('');
    const tmp = this._inflowFile + '.tmp';
    fs.writeFileSync(tmp, lines, 'utf8');
    fs.renameSync(tmp, this._inflowFile);
    const bytes = Buffer.byteLength(lines, 'utf8');
    this._emit422('x402.persistence.compactInflows422', { recordsKept: keep.length, bytesWritten: bytes });
    return { ok: true, recordsKept: keep.length, bytesWritten: bytes };
  }

  /**
   * Compact the pool JSONL — keeps only the most recent maxKeep records.
   * @param {number} [maxKeep=5000]
   * @returns {{ ok: boolean, recordsKept: number, bytesWritten: number }}
   */
  compactPool422(maxKeep = 5000) {
    _ensureDir422(this._x402Dir);
    const keep = this._poolSnapshots422.slice(-maxKeep);
    const lines = keep.map(r => JSON.stringify(r) + '\n').join('');
    const tmp = this._poolFile + '.tmp';
    fs.writeFileSync(tmp, lines, 'utf8');
    fs.renameSync(tmp, this._poolFile);
    const bytes = Buffer.byteLength(lines, 'utf8');
    this._emit422('x402.persistence.compactPool422', { recordsKept: keep.length, bytesWritten: bytes });
    return { ok: true, recordsKept: keep.length, bytesWritten: bytes };
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  stats422() {
    return {
      totalInflows: this._inflows422.length,
      totalPoolSnapshots: this._poolSnapshots422.length,
      dataDir: this._dataDir,
      inflowFile: this._inflowFile,
      poolFile: this._poolFile,
      version: X402_PERSISTENCE_VERSION_422,
    };
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  X402Persistence422,
  X402_PERSISTENCE_VERSION_422,
};

// ── Test exports ────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'test') {
  module.exports._test422 = {
    _ensureDir422,
    _readLines422,
  };
}
