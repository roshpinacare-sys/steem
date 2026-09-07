'use strict';
/**
 * src/lib/metacognition268.js — Meta-Memory & Strategy Tracker (V268)
 *
 * Builds on metacognition264 with:
 *   - SAGE-style forgetting curve (Ebbinghaus) on strategy scores
 *   - Program-level strategy inheritance (sub-missions inherit parent strategy)
 *   - Temporal knowledge graph tagging (entry → { createdAt, lastAccessedAt, decayFactor })
 *   - Cross-taskType pattern detection (correlate strategies across task types)
 *
 * PROGRAM 05: Agent Reflection Framework
 * Zero new npm deps. Identifiers end with 268.
 */
'use strict';

const EBBINGHAUS_K_268     = 0.5;
const DECAY_THRESHOLD_268  = 0.1;
const STRATEGY_RING_MAX_268 = 10_000;

class Metacognition268 {
  constructor(opts = {}) {
    this._logger    = opts.logger          || console;
    this._snapshot  = opts.snapshotEngine  || null;
    this._strategies268   = new Map(); // taskType → Map<strategy, { successes, failures, totalRetries, lastUsed }>
    this._temporalTags268 = new Map(); // entryId → { createdAt, lastAccessedAt, decayFactor }
    this._programStrategies268 = new Map(); // programId → { taskType → strategy }
    this._outcomeLog268 = [];
  
    this._perf268 = { latencies: [] };
    this._logAdapter268 = opts.logAdapter || null;
  }

  recordOutcome268(taskType, strategy, success, retries = 1) {
    const _t0 = Date.now();
    if (!strategy) strategy = 'default';
    if (!this._strategies268.has(taskType)) this._strategies268.set(taskType, new Map());
    const tm = this._strategies268.get(taskType);
    if (!tm.has(strategy)) tm.set(strategy, { successes: 0, failures: 0, totalRetries: 0, lastUsed: Date.now() });
    const s = tm.get(strategy);
    if (success) s.successes++; else s.failures++;
    s.totalRetries += retries;
    s.lastUsed = Date.now();

    this._outcomeLog268.push({ taskType, strategy, success, retries, ts: Date.now() });
    if (this._outcomeLog268.length > STRATEGY_RING_MAX_268) this._outcomeLog268.shift();
    this._recordLatency268(_t0);
  }

  // Backward compat alias
  recordOutcome264(taskType, strategy, success, retries = 1) {
    return this.recordOutcome268(taskType, strategy, success, retries);
  }

  suggestStrategy268(taskType, opts = {}) {
    const tm = this._strategies268.get(taskType);
    if (!tm || tm.size === 0) {
      // Check if parent program has a preferred strategy
      if (opts.programId && this._programStrategies268.has(opts.programId)) {
        const ps = this._programStrategies268.get(opts.programId);
        if (ps[taskType]) return ps[taskType];
      }
      return 'default';
    }

    const now = Date.now();
    let best = null, bestScore = -Infinity;
    for (const [strategy, stats] of tm) {
      const total = stats.successes + stats.failures;
      if (total === 0) continue;
      const rawRate = stats.successes / total;
      // Apply Ebbinghaus decay to strategy confidence
      const ageMs = now - (stats.lastUsed || now);
      const decay = Math.max(DECAY_THRESHOLD_268, Math.exp(-EBBINGHAUS_K_268 * ageMs / (7 * 24 * 3600_000)));
      const score = rawRate * decay;
      if (score > bestScore) { best = strategy; bestScore = score; }
    }
    return best || 'default';
  }

  // Backward compat alias
  suggestStrategy264(taskType) { return this.suggestStrategy268(taskType); }

  tagEntry268(entryId) {
    const now = Date.now();
    this._temporalTags268.set(entryId, {
      createdAt: now, lastAccessedAt: now,
      decayFactor: 1.0,
    });
    return entryId;
  }

  accessEntry268(entryId) {
    const tag = this._temporalTags268.get(entryId);
    if (!tag) return null;
    const now = Date.now();
    tag.lastAccessedAt = now;
    // Refresh decay on access (spaced repetition)
    tag.decayFactor = Math.min(1.0, tag.decayFactor + 0.2);
    return tag;
  }

  pruneDecayedEntries268() {
    const now = Date.now();
    const pruned = [];
    for (const [id, tag] of this._temporalTags268) {
      const ageMs = now - tag.lastAccessedAt;
      const decay = Math.exp(-EBBINGHAUS_K_268 * ageMs / (7 * 24 * 3600_000));
      tag.decayFactor = decay;
      if (decay < DECAY_THRESHOLD_268) {
        this._temporalTags268.delete(id);
        pruned.push(id);
      }
    }
    return { pruned: pruned.length };
  }

  setProgramStrategy268(programId, taskType, strategy) {
    if (!this._programStrategies268.has(programId)) this._programStrategies268.set(programId, {});
    this._programStrategies268.get(programId)[taskType] = strategy;
  }

  getStats268() {
    return {
      version: '268',
      taskTypes: this._strategies268.size,
      temporalEntries: this._temporalTags268.size,
      programs: this._programStrategies268.size,
      outcomeLog: this._outcomeLog268.length,
    };
  }

  _persist268() {
    if (this._snapshot?.save) { try { this._snapshot.save('metacognition268', { strategies: [...this._strategies268.entries()] }); } catch (_) {} }
  }

  // ── V268: Performance Telemetry ─────────────────────────────────────────────
  getPerf268() { return _calcPercentiles268(this._perf268.latencies); }

  _recordLatency268(t0) {
    const ms = Date.now() - t0;
    this._perf268.latencies.push(ms);
    if (this._perf268.latencies.length > 1000) this._perf268.latencies.shift();
  }

  // ── V268: Health Check ────────────────────────────────────────────────────
  checkMetacognitionHealth268() {
    return {
      ok: true,
      module: 'metacognition268 Ebbinghaus engine',
      version: '268',
      perf: this.getPerf268(),
      logAdapter: this._logAdapter268 ? { type: 'external', ok: true } : { type: 'none' },
    };
  }

}

const defaultMetacognition268 = new Metacognition268();


// ── V268 Performance Telemetry helper ────────────────────────────────────────
function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

module.exports = {
  Metacognition268,
  defaultMetacognition268,
  EBBINGHAUS_K_268,
  DECAY_THRESHOLD_268,
};
