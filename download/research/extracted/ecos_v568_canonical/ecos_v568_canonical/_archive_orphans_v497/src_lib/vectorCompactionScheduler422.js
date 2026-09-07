'use strict';
/**
 * src/lib/vectorCompactionScheduler422.js — ECOS V422 (Phase P310) — Vector Compaction Scheduler
 *
 * Auto-compacts JSONL files for users whose file grows beyond a configurable
 * line threshold (default 3× live count). Works with PerUserVectorPersistence419.
 *
 * All identifiers end in 422 (R2). No new npm deps (R3). Sacred untouched (R1).
 *
 * @version 422.0.0
 */

const fs   = require('fs');
const path = require('path');

const SCHEDULER_VERSION_422 = '422.0.0';
const DEFAULT_LINE_THRESHOLD_MULTIPLIER_422 = 3.0;
const DEFAULT_CHECK_INTERVAL_MS_422 = 60_000; // 1 minute
const MAX_CHECK_INTERVAL_MS_422 = 3_600_000;   // 1 hour

// ── Helpers ───────────────────────────────────────────────────────────────────

function _countLines422(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split('\n').filter(l => l.trim()).length;
}

// ── VectorCompactionScheduler422 ──────────────────────────────────────────────

class VectorCompactionScheduler422 {
  /**
   * @param {object} opts
   * @param {PerUserVectorPersistence419} opts.vectorStore  — instance to compact
   * @param {number} [opts.lineThresholdMultiplier]  — default 3.0
   * @param {function} [opts.audit]  — audit(type, data) hook
   * @param {function} [opts.logger] — logger with info/warn/error
   */
  constructor(opts = {}) {
    if (!opts.vectorStore) throw new Error('VectorCompactionScheduler422 requires opts.vectorStore (422)');
    this._store422    = opts.vectorStore;
    this._multiplier422 = opts.lineThresholdMultiplier || DEFAULT_LINE_THRESHOLD_MULTIPLIER_422;
    this._audit422    = typeof opts.audit === 'function' ? opts.audit : null;
    this._logger422   = opts.logger || null;

    this._timer422    = null;
    this._intervalMs422 = null;
    this._lastRun422  = 0;
    this._compactions422 = 0;
    this._errors422   = 0;
  }

  _emit422(type, data) {
    if (this._audit422) {
      try { this._audit422(type, data); } catch (_) {}
    }
  }

  _log422(level, msg, meta) {
    if (this._logger422 && typeof this._logger422[level] === 'function') {
      try { this._logger422[level](meta || {}, msg); } catch (_) {}
    }
  }

  /**
   * Check a single user and compact if their JSONL exceeds threshold.
   * @param {string} userId
   * @returns {{ compacted: boolean, userId, beforeLines, afterLines }}
   */
  checkAndCompact422(userId) {
    const filePath = path.join(
      this._store422._vectorsDir,
      `${userId.replace(/[^a-zA-Z0-9_\-\.]/g, '_')}.jsonl`
    );
    const beforeLines = _countLines422(filePath);
    const liveCount = (this._store422.list419(userId).count) || 0;
    const threshold = Math.max(1, Math.ceil(liveCount * this._multiplier422));

    if (beforeLines > threshold) {
      this._store422.compact419(userId);
      const afterLines = _countLines422(filePath);
      this._compactions422++;
      this._emit422('vector.scheduler.compacted422', { userId, beforeLines, afterLines, threshold });
      this._log422('info', `[V422] Auto-compacted ${userId}: ${beforeLines} → ${afterLines} lines (threshold=${threshold})`, { userId, beforeLines, afterLines });
      return { compacted: true, userId, beforeLines, afterLines, threshold };
    }

    return { compacted: false, userId, beforeLines, afterLines: beforeLines, threshold };
  }

  /**
   * Scan all known users and compact where needed.
   * @returns {{ checked: number, compacted: number, details: Array }}
   */
  scanAll422() {
    let checked = 0, compacted = 0;
    const details = [];
    for (const userId of this._store422._store419.keys()) {
      checked++;
      const r = this.checkAndCompact422(userId);
      details.push(r);
      if (r.compacted) compacted++;
    }
    this._lastRun422 = Date.now();
    this._emit422('vector.scheduler.scan422', { checked, compacted });
    return { checked, compacted, details };
  }

  /**
   * Start auto-compaction interval.
   * @param {number} [intervalMs=60000]
   */
  scheduleAutoCompact422(intervalMs = DEFAULT_CHECK_INTERVAL_MS_422) {
    this.stopAutoCompact422();
    const ms = Math.min(Math.max(intervalMs, 1_000), MAX_CHECK_INTERVAL_MS_422);
    this._intervalMs422 = ms;
    this._timer422 = setInterval(() => {
      try { this.scanAll422(); }
      catch (e) { this._errors422++; this._log422('error', `[V422] Auto-compact error: ${e.message}`, { err: e.message }); }
    }, ms);
    this._log422('info', `[V422] Auto-compact scheduled every ${ms}ms`, { intervalMs: ms });
    return { scheduled: true, intervalMs: ms };
  }

  /**
   * Stop auto-compaction interval.
   */
  stopAutoCompact422() {
    if (this._timer422) {
      clearInterval(this._timer422);
      this._timer422 = null;
      this._log422('info', '[V422] Auto-compact stopped', {});
    }
    return { stopped: true };
  }

  /**
   * Get scheduler status.
   */
  getStatus422() {
    return {
      version: SCHEDULER_VERSION_422,
      running: !!this._timer422,
      intervalMs: this._intervalMs422,
      lastRun: this._lastRun422,
      compactionsTotal: this._compactions422,
      errorsTotal: this._errors422,
      lineThresholdMultiplier: this._multiplier422,
    };
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  VectorCompactionScheduler422,
  SCHEDULER_VERSION_422,
  DEFAULT_LINE_THRESHOLD_MULTIPLIER_422,
  DEFAULT_CHECK_INTERVAL_MS_422,
};

// ── Test exports ──────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'test') {
  module.exports._test422 = {
    _countLines422,
  };
}
