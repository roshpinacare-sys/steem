'use strict';
/**
 * src/lib/sybilGuard268.js — Sybil Guard V268 (PROGRAM 04: Sybil Defense Network)
 *
 * Builds on sybilGuard264 with:
 *   - Passport-style composite humanity score (multiple signals)
 *   - Behavioral velocity detection (actions-per-window)
 *   - Device fingerprint clustering (without storing PII)
 *   - Execution-time sybil scoring (lightweight, synchronous)
 *   - Graduated responses: ALLOW / WARN / THROTTLE / BLOCK
 *   - Self-report amnesty (15% retention as in V264, now tracked properly)
 *   - Non-linear reward multipliers with compound diminishing returns
 *
 * Zero new npm deps. Identifiers end with 268.
 */
'use strict';

const crypto = require('node:crypto');

const EPOCH_MS_268            = 7 * 24 * 3600_000;
const CIRCULAR_MIN_268        = 3;
const AMNESTY_RETENTION_268   = 0.15;
const VELOCITY_WINDOW_MS_268  = 60_000;   // 1-minute velocity window
const VELOCITY_MAX_268        = 60;        // max 60 actions per minute
const DIMINISHING_CAP_268     = 5;
const CLUSTER_HASH_BITS_268   = 16;       // bits for device fingerprint clustering

// Humanity signal weights (0–100 composite score)
const SIGNAL_WEIGHTS_268 = Object.freeze({
  has_tip_history:       10,
  has_mission_complete:  20,
  has_peer_attestation:  15,
  passed_velocity:       15,
  no_circular_tips:      15,
  has_x402_payment:      10,
  self_reported:        -50,  // amnesty reduces, not eliminates, score
  flag_cluster:         -30,
  flag_velocity:        -40,
  flag_circular:        -60,
});

class SybilGuard268 {
  constructor(opts = {}) {
    this._logger       = opts.logger        || console;
    this._auditLog     = opts.auditLog      || null;
    this._sybilBase    = opts.sybilResistance || null;

    this._tipGraph268       = new Map();   // userId → Set<userId>
    this._eventCounts268    = new Map();   // `${userId}:${eventType}` → count
    this._epochStart268     = Date.now();
    this._amnestyList268    = new Set();
    this._flagged268        = new Map();   // userId → { reason, ts, score, verdict }
    this._signals268        = new Map();   // userId → signal map
    this._velocityLog268    = new Map();   // userId → timestamps[]
    this._clusterMap268     = new Map();   // clusterHash → Set<userId>
    this._userCluster268    = new Map();   // userId → clusterHash
    this._stats268          = { evaluated: 0, blocked: 0, throttled: 0, amnesties: 0 };
  
    this._perf268 = { latencies: [] };
    this._logAdapter268 = opts.logAdapter || null;
  }

  // ── Epoch management ──────────────────────────────────────────────────────

  _maybeRollEpoch268() {
    if (Date.now() - this._epochStart268 >= EPOCH_MS_268) {
      this._tipGraph268.clear();
      this._eventCounts268.clear();
      this._epochStart268 = Date.now();
    }
  }

  // ── Signal tracking ───────────────────────────────────────────────────────

  recordSignal268(userId, signal, value = true) {
    if (!this._signals268.has(userId)) this._signals268.set(userId, {});
    this._signals268.get(userId)[signal] = value;
  }

  recordTipEdge268(fromUserId, toUserId) {
    this._maybeRollEpoch268();
    if (!this._tipGraph268.has(fromUserId)) this._tipGraph268.set(fromUserId, new Set());
    this._tipGraph268.get(fromUserId).add(toUserId);
    const rings = this._detectCircularRing268(fromUserId);
    if (rings.rings.length > 0) {
      for (const ring of rings.rings) {
        for (const uid of ring) this._flag268(uid, 'circular_tip_ring', { ring });
      }
    }
    return rings;
  }

  recordVelocity268(userId) {
    const now = Date.now();
    if (!this._velocityLog268.has(userId)) this._velocityLog268.set(userId, []);
    const times = this._velocityLog268.get(userId);
    times.push(now);
    // Keep only last window
    const cutoff = now - VELOCITY_WINDOW_MS_268;
    const trimmed = times.filter(t => t >= cutoff);
    this._velocityLog268.set(userId, trimmed);

    if (trimmed.length > VELOCITY_MAX_268) {
      this._flag268(userId, 'velocity_exceeded', { actionsPerMin: trimmed.length });
      return { exceeded: true, count: trimmed.length };
    }
    return { exceeded: false, count: trimmed.length };
  }

  recordDeviceCluster268(userId, fingerprintInput) {
    const hash = crypto.createHash('sha256').update(String(fingerprintInput)).digest('hex').slice(0, CLUSTER_HASH_BITS_268);
    const existing = this._userCluster268.get(userId);
    if (existing && existing !== hash) {
      // User changed fingerprint cluster — suspicious
      this._flag268(userId, 'cluster_change', { oldCluster: existing, newCluster: hash });
    }
    this._userCluster268.set(userId, hash);
    if (!this._clusterMap268.has(hash)) this._clusterMap268.set(hash, new Set());
    this._clusterMap268.get(hash).add(userId);

    // Flag cluster if too many users share same fingerprint
    if (this._clusterMap268.get(hash).size > 10) {
      for (const uid of this._clusterMap268.get(hash)) {
        this._flag268(uid, 'cluster_collusion', { clusterSize: this._clusterMap268.get(hash).size });
      }
    }
  }

  // ── Evaluate ──────────────────────────────────────────────────────────────

  /**
   * Evaluate a user's sybil risk. Returns { verdict, score, signals }.
   * Verdicts: ALLOW / WARN / THROTTLE / BLOCK
   */
  evaluate268(userId) {
    const _t0 = Date.now();
    this._stats268.evaluated++;
    const flags = this._flagged268.get(userId) || [];
    const signals = this._signals268.get(userId) || {};

    let score = 50; // start at midpoint

    for (const [signal, weight] of Object.entries(SIGNAL_WEIGHTS_268)) {
      if (signals[signal]) score += weight;
    }

    // Add flag penalties
    const flagArray = Array.isArray(flags) ? flags : [flags];
    for (const flag of flagArray) {
      if (flag?.reason === 'circular_tip_ring') score -= 60;
      if (flag?.reason === 'velocity_exceeded')  score -= 40;
      if (flag?.reason === 'cluster_collusion')  score -= 30;
    }

    if (this._amnestyList268.has(userId)) score -= 50;

    score = Math.max(0, Math.min(100, score));

    let verdict;
    if (score < 20)      { verdict = 'BLOCK';    this._stats268.blocked++; }
    else if (score < 40) { verdict = 'THROTTLE'; this._stats268.throttled++; }
    else if (score < 60) { verdict = 'WARN'; }
    else                  { verdict = 'ALLOW'; }

    this._recordLatency268(_t0);
    return { userId, verdict, score, signals, flagCount: flagArray.filter(f => f).length };
  }

  // Backward compat alias for V264 callers
  evaluate264(userId) { return this.evaluate268(userId); }

  // ── Self-report amnesty ───────────────────────────────────────────────────

  selfReport268(userId, evidence = {}) {
    this._amnestyList268.add(userId);
    this._stats268.amnesties++;
    this._flag268(userId, 'self_reported', { evidence, amnesty: true });
    this._log268('SELF_REPORT', { userId, evidence });
    return {
      ok: true,
      userId,
      retentionPct: AMNESTY_RETENTION_268 * 100,
      message: `Self-report accepted. You retain ${AMNESTY_RETENTION_268 * 100}% of current allocation. Amnesty recorded.`,
    };
  }

  // ── Reward multiplier ─────────────────────────────────────────────────────

  getRewardMultiplier268(userId, eventType) {
    this._maybeRollEpoch268();
    const key = `${userId}:${eventType}`;
    const count = this._eventCounts268.get(key) || 0;
    const newCount = count + 1;
    this._eventCounts268.set(key, newCount);
    if (newCount > DIMINISHING_CAP_268) {
      const excess = newCount - DIMINISHING_CAP_268 + 1;  // excess=1 → 1/2=0.5, excess=2 → 1/3, ...
      return Math.max(0.1, 1.0 / (1.0 + excess));
    }
    return 1.0;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  getStats268() {
    return {
      version: '268',
      ...this._stats268,
      flaggedUsers: this._flagged268.size,
      amnestyCount: this._amnestyList268.size,
      tipGraphSize: this._tipGraph268.size,
      clusterCount: this._clusterMap268.size,
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _flag268(userId, reason, data = {}) {
    if (!this._flagged268.has(userId)) this._flagged268.set(userId, []);
    this._flagged268.get(userId).push({ reason, data, ts: new Date().toISOString() });
    this._log268('FLAG', { userId, reason, ...data });
    if (this._auditLog?.append) { try { this._auditLog.append({ event: 'sybilGuard268.flag', userId, reason, ...data }); } catch (_) {} }
  }

  _detectCircularRing268(startId) {
    const graph = this._tipGraph268;
    const visited = new Set(), path = [], rings = [];
    const dfs = (node) => {
      if (visited.has(node)) {
        const idx = path.indexOf(node);
        if (idx !== -1 && path.length - idx >= CIRCULAR_MIN_268) rings.push(path.slice(idx));
        return;
      }
      visited.add(node); path.push(node);
      for (const n of (graph.get(node) || [])) dfs(n);
      path.pop();
    };
    dfs(startId);
    return { rings };
  }

  _log268(event, data) {
    const entry = { event, ...data, ts: new Date().toISOString(), _v: '268' };
    if (this._auditLog?.append) { try { this._auditLog.append(entry); } catch (_) {} }
  }

  // ── V268: Performance Telemetry ─────────────────────────────────────────────
  getPerf268() { return _calcPercentiles268(this._perf268.latencies); }

  _recordLatency268(t0) {
    const ms = Date.now() - t0;
    this._perf268.latencies.push(ms);
    if (this._perf268.latencies.length > 1000) this._perf268.latencies.shift();
  }

  // ── V268: Health Check ────────────────────────────────────────────────────
  checkSybilHealth268() {
    return {
      ok: true,
      module: 'sybilGuard268 humanity score',
      version: '268',
      perf: this.getPerf268(),
      logAdapter: this._logAdapter268 ? { type: 'external', ok: true } : { type: 'none' },
    };
  }

}

const defaultSybilGuard268 = new SybilGuard268();


// ── V268 Performance Telemetry helper ────────────────────────────────────────
function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

module.exports = {
  SybilGuard268,
  defaultSybilGuard268,
  AMNESTY_RETENTION_268,
  SIGNAL_WEIGHTS_268,
  VELOCITY_MAX_268,
};
