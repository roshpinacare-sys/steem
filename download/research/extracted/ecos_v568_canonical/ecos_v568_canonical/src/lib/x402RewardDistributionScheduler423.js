'use strict';
/**
 * src/lib/x402RewardDistributionScheduler423.js — ECOS V423 (Phase P311) — x402 Reward Distribution Scheduler
 *
 * Auto-triggers validator/creator pool distributions on configurable intervals
 * (e.g. daily) with audit hooks. Integrates with X402Persistence422 for
 * pool balance reads and with the audit subsystem for full traceability.
 *
 * Architecture:
 *   X402Persistence422 (pool snapshots)
 *       ↓
 *   X402RewardDistributionScheduler423
 *       ↓ distribute() → audit hook + distribution record
 *   {dataDir}/x402/distributions.jsonl  (WAL-style)
 *
 * All identifiers end in 423 (R2). No new npm deps (R3). Sacred untouched (R1).
 *
 * @version 423.0.0
 */

const fs   = require('fs');
const path = require('path');

const DISTRIBUTION_SCHEDULER_VERSION_423 = '423.0.0';
const DISTRIBUTION_FILE_423     = 'distributions.jsonl';
const X402_SUBDIR_423           = 'x402';
const DEFAULT_INTERVAL_MS_423   = 86_400_000; // 24 hours
const MAX_DIST_RECORDS_423      = 10_000;
const MIN_INTERVAL_MS_423       = 60_000;    // 1 minute (test-friendly)

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

// ── X402RewardDistributionScheduler423 ───────────────────────────────────────

class X402RewardDistributionScheduler423 {
  /**
   * @param {object} opts
   * @param {object} opts.x402Persistence     — X402Persistence422 instance
   * @param {string} opts.dataDir             — base data directory
   * @param {function} [opts.audit]           — audit(type, data) hook
   * @param {function} [opts.distributeFn]    — async/sync fn({ validatorPool, creatorPool, platformPool, distributionId })
   *                                            called on each trigger. If omitted, a no-op stub is used.
   */
  constructor(opts = {}) {
    if (!opts.x402Persistence) throw new Error('X402RewardDistributionScheduler423 requires opts.x402Persistence (423)');
    if (!opts.dataDir) throw new Error('X402RewardDistributionScheduler423 requires opts.dataDir (423)');

    this._x402p423       = opts.x402Persistence;
    this._dataDir        = opts.dataDir;
    this._x402Dir423     = path.join(opts.dataDir, X402_SUBDIR_423);
    this._distFile423    = path.join(this._x402Dir423, DISTRIBUTION_FILE_423);
    this._audit423       = typeof opts.audit === 'function' ? opts.audit : null;
    this._distributeFn423 = typeof opts.distributeFn === 'function'
      ? opts.distributeFn
      : (_d) => ({ distributed: true, stub: true });

    this._timer423       = null;
    this._intervalMs423  = null;
    this._lastRun423     = 0;
    this._runCount423    = 0;
    this._errorCount423  = 0;
    this._distributions423 = [];
  }

  _emit423(type, data) {
    if (this._audit423) {
      try { this._audit423(type, data); } catch (_) {}
    }
  }

  // ── Core distribution trigger ─────────────────────────────────────────────

  /**
   * Execute one distribution cycle — reads latest pool snapshot, calls distributeFn,
   * persists the distribution record with audit hooks.
   * @returns {{ ok: boolean, distributionId: string, pools: object, fnResult: any }}
   */
  triggerDistribution423() {
    const distributionId = `dist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const snapshots = this._x402p423.getPoolSnapshots422(1);
    const latestPool = snapshots[0] || { validatorPool: '0', creatorPool: '0', platformPool: '0', totalInflow: '0' };

    const pools = {
      validatorPool: latestPool.validatorPool || '0',
      creatorPool:   latestPool.creatorPool   || '0',
      platformPool:  latestPool.platformPool  || '0',
      totalInflow:   latestPool.totalInflow   || '0',
    };

    let fnResult = null;
    let error = null;
    try {
      fnResult = this._distributeFn423({ distributionId, ...pools, ts: Date.now() });
    } catch (e) {
      error = e.message;
      this._errorCount423++;
    }

    const record = {
      distributionId,
      pools,
      fnResult,
      error,
      _ts: Date.now(),
      _schedulerVersion: DISTRIBUTION_SCHEDULER_VERSION_423,
    };

    _ensureDir423(this._x402Dir423);
    this._distributions423.push(record);
    if (this._distributions423.length > MAX_DIST_RECORDS_423) this._distributions423.shift();
    _appendLine423(this._distFile423, record);

    this._emit423('x402.distribution.triggered423', { distributionId, error: error || null, pools });
    this._runCount423++;
    this._lastRun423 = Date.now();

    return { ok: !error, distributionId, pools, fnResult, error: error || undefined };
  }

  // ── Scheduling ────────────────────────────────────────────────────────────

  /**
   * Start auto-distribution on the given interval.
   * @param {number} [intervalMs=86400000]  — default 24h
   * @returns {{ scheduled: boolean, intervalMs: number }}
   */
  schedule423(intervalMs = DEFAULT_INTERVAL_MS_423) {
    this.stop423();
    const ms = Math.max(intervalMs, MIN_INTERVAL_MS_423);
    this._intervalMs423 = ms;
    this._timer423 = setInterval(() => {
      try { this.triggerDistribution423(); }
      catch (e) { this._errorCount423++; }
    }, ms);
    this._emit423('x402.distribution.scheduled423', { intervalMs: ms });
    return { scheduled: true, intervalMs: ms };
  }

  /**
   * Stop the auto-distribution timer.
   * @returns {{ stopped: boolean }}
   */
  stop423() {
    if (this._timer423) {
      clearInterval(this._timer423);
      this._timer423 = null;
    }
    return { stopped: true };
  }

  // ── Replay / Query ────────────────────────────────────────────────────────

  /**
   * Load historical distribution records from JSONL.
   * @returns {{ replayed: number, errors: string[] }}
   */
  loadAll423() {
    const result = { replayed: 0, errors: [] };
    this._distributions423 = [];
    const lines = _readLines423(this._distFile423);
    for (const line of lines) {
      try {
        this._distributions423.push(JSON.parse(line));
        result.replayed++;
      } catch (err) { result.errors.push(`parse: ${err.message}`); }
    }
    if (this._distributions423.length > MAX_DIST_RECORDS_423) {
      this._distributions423 = this._distributions423.slice(-MAX_DIST_RECORDS_423);
    }
    this._emit423('x402.distribution.load423', result);
    return result;
  }

  getRecentDistributions423(limit = 20) {
    return this._distributions423.slice(-limit).reverse();
  }

  // ── Status / Stats ─────────────────────────────────────────────────────────

  getStatus423() {
    return {
      version:       DISTRIBUTION_SCHEDULER_VERSION_423,
      running:       !!this._timer423,
      intervalMs:    this._intervalMs423,
      lastRun:       this._lastRun423,
      runCount:      this._runCount423,
      errorCount:    this._errorCount423,
      recordsInMem:  this._distributions423.length,
    };
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  X402RewardDistributionScheduler423,
  DISTRIBUTION_SCHEDULER_VERSION_423,
};

// ── Test exports ───────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'test') {
  module.exports._test423 = {
    _ensureDir423,
    _readLines423,
    MIN_INTERVAL_MS_423,
  };
}
