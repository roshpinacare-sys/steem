/**
 * semanticDriftMonitor.js — ECOS V121
 * =====================================
 * Semantic reliability monitoring — tracks confidence signal trends over time
 * to detect deterioration BEFORE it manifests as bad outputs.
 *
 * Core insight (from VOID Semantic Reliability Layer):
 *
 *   structural_fracture → behavioral_failure
 *   t₁                    t₂
 *   Δt = t₂ - t₁ > 0  ← intervention window
 *
 * This monitor watches per-domain confidence readings and fires alerts when
 * it detects downward acceleration (d²wLR/dα² < 0), which predicts failure
 * before it arrives.
 *
 * Domain profiles:
 *   BRITTLE   (Legal/Finance)  — fast fracture, small Δt, needs tight monitoring
 *   METASTABLE (Code/Logic)    — stable until critical threshold, then rapid collapse
 *   DUCTILE   (Narrative/Chat) — slow drift, early detection possible
 *
 * [V121-P12-02] Initial implementation
 */

'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const DOMAIN_PROFILES = {
  LEGAL:    { type: 'brittle',    window: 5,  alertThreshold: 0.08, minSamples: 3 },
  FINANCE:  { type: 'brittle',    window: 5,  alertThreshold: 0.08, minSamples: 3 },
  CODE:     { type: 'metastable', window: 8,  alertThreshold: 0.12, minSamples: 4 },
  MEDICAL:  { type: 'brittle',    window: 5,  alertThreshold: 0.07, minSamples: 3 },
  NARRATIVE:{ type: 'ductile',    window: 12, alertThreshold: 0.05, minSamples: 6 },
  GENERAL:  { type: 'ductile',    window: 10, alertThreshold: 0.06, minSamples: 5 },
};

const ALERT_LEVELS = {
  NONE:     'NONE',
  WARN:     'WARN',        // drift detected, monitoring closely
  ALERT:    'ALERT',       // acceleration detected, recommend VALIDATOR_IDLE
  CRITICAL: 'CRITICAL',   // rapid collapse predicted, force HITL
};

// ── Ring buffer per domain ────────────────────────────────────────────────────

class ConfidenceRingBuffer {
  constructor(maxSize) {
    this._buf = new Array(maxSize).fill(null);
    this._size = maxSize;
    this._head = 0;
    this._count = 0;
  }

  push(score, timestamp = Date.now()) {
    this._buf[this._head] = { score, timestamp };
    this._head = (this._head + 1) % this._size;
    if (this._count < this._size) this._count++;
  }

  toArray() {
    if (this._count === 0) return [];
    const result = [];
    const start = this._count < this._size
      ? 0
      : this._head;
    for (let i = 0; i < this._count; i++) {
      result.push(this._buf[(start + i) % this._size]);
    }
    return result;
  }

  get length() { return this._count; }
}

// ── Monitor class ─────────────────────────────────────────────────────────────

class SemanticDriftMonitor {
  constructor(options = {}) {
    this._buffers = new Map();   // domain → ConfidenceRingBuffer
    this._alerts  = new Map();   // domain → last alert
    this._options = {
      pruneIntervalMs: 3_600_000,  // 1 hour
      ...options,
    };
    this._lastPrune = Date.now();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Record a confidence reading for a domain.
   * Call this every time a task completes (after confidenceGate evaluation).
   *
   * @param {string} domain   — e.g. 'LEGAL', 'CODE', 'FINANCE', 'GENERAL'
   * @param {number} score    — confidence score 0–1
   * @returns {DriftReport}
   */
  record(domain, score) {
    this._maybePrune();
    const profile = DOMAIN_PROFILES[domain.toUpperCase()] || DOMAIN_PROFILES.GENERAL;

    if (!this._buffers.has(domain)) {
      this._buffers.set(domain, new ConfidenceRingBuffer(profile.window * 2));
    }

    this._buffers.get(domain).push(score);
    return this.analyse(domain);
  }

  /**
   * Analyse the current trend for a domain without recording.
   * @param {string} domain
   * @returns {DriftReport}
   */
  analyse(domain) {
    const profile = DOMAIN_PROFILES[domain.toUpperCase()] || DOMAIN_PROFILES.GENERAL;
    const buf = this._buffers.get(domain);

    if (!buf || buf.length < profile.minSamples) {
      return this._report(domain, ALERT_LEVELS.NONE, 0, 0, []);
    }

    const readings = buf.toArray().map(r => r.score);
    const { velocity, acceleration } = this._computeDerivatives(readings, profile.window);

    let alertLevel = ALERT_LEVELS.NONE;

    // Downward acceleration = structural fracture signal
    if (acceleration < -profile.alertThreshold) {
      alertLevel = ALERT_LEVELS.CRITICAL;
    } else if (acceleration < -(profile.alertThreshold * 0.4)  /* V522: was 0.6 */) {
      alertLevel = ALERT_LEVELS.ALERT;
    } else if (velocity < -0.015) {  // V522: lowered (was -0.03) so gradual downward drift surfaces as WARN
      alertLevel = ALERT_LEVELS.WARN;
    }

    // Metastable domains: also trigger on sudden velocity spike downward
    if (profile.type === 'metastable' && velocity < -0.10) {
      alertLevel = ALERT_LEVELS.CRITICAL;
    }

    const report = this._report(domain, alertLevel, velocity, acceleration, readings.slice(-profile.window));
    this._alerts.set(domain, report);
    return report;
  }

  /**
   * Get the latest alert for a domain (or NONE if no history).
   */
  getAlert(domain) {
    return this._alerts.get(domain) || this._report(domain, ALERT_LEVELS.NONE, 0, 0, []);
  }

  /**
   * Get a summary of all monitored domains.
   */
  summary() {
    const result = {};
    for (const domain of this._buffers.keys()) {
      result[domain] = this.analyse(domain);
    }
    return result;
  }

  /**
   * Reset a domain's history (e.g. after a model upgrade or calibration).
   */
  reset(domain) {
    this._buffers.delete(domain);
    this._alerts.delete(domain);
  }

  resetAll() {
    this._buffers.clear();
    this._alerts.clear();
  }

  // ── Internal computation ──────────────────────────────────────────────────

  _computeDerivatives(readings, window) {
    const recent = readings.slice(-window);
    if (recent.length < 2) return { velocity: 0, acceleration: 0 };

    // Simple finite differences on a sliding window
    const n = recent.length;
    const half = Math.floor(n / 2);

    // Velocity: mean slope over full window
    let sumDelta = 0;
    for (let i = 1; i < n; i++) {
      sumDelta += recent[i] - recent[i - 1];
    }
    const velocity = sumDelta / (n - 1);

    // Acceleration: compare first-half slope vs second-half slope
    const firstHalf = recent.slice(0, half);
    const secondHalf = recent.slice(half);

    const v1 = firstHalf.length > 1
      ? (firstHalf[firstHalf.length - 1] - firstHalf[0]) / (firstHalf.length - 1)
      : 0;
    const v2 = secondHalf.length > 1
      ? (secondHalf[secondHalf.length - 1] - secondHalf[0]) / (secondHalf.length - 1)
      : 0;

    const acceleration = v2 - v1;

    return { velocity, acceleration };
  }

  _report(domain, alertLevel, velocity, acceleration, recentReadings) {
    const profile = DOMAIN_PROFILES[domain.toUpperCase()] || DOMAIN_PROFILES.GENERAL;
    const recommendation = alertLevel === ALERT_LEVELS.CRITICAL
      ? 'force_hitl'
      : alertLevel === ALERT_LEVELS.ALERT
        ? 'validator_idle_alert'
        : alertLevel === ALERT_LEVELS.WARN
          ? 'increase_monitoring'
          : 'nominal';

    return {
      domain,
      domainType: profile.type,
      alertLevel,
      recommendation,
      velocity: Math.round(velocity * 10000) / 10000,
      acceleration: Math.round(acceleration * 10000) / 10000,
      recentReadings,
      timestamp: new Date().toISOString(),
    };
  }

  _maybePrune() {
    const now = Date.now();
    if (now - this._lastPrune < this._options.pruneIntervalMs) return;
    // Only prune domains with no recent activity (> 2 hours old last entry)
    for (const [domain, buf] of this._buffers.entries()) {
      const arr = buf.toArray();
      if (arr.length === 0) {
        this._buffers.delete(domain);
        continue;
      }
      const last = arr[arr.length - 1];
      if (now - last.timestamp > 7_200_000) {
        this._buffers.delete(domain);
        this._alerts.delete(domain);
      }
    }
    this._lastPrune = now;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const defaultDriftMonitor = new SemanticDriftMonitor();

// ── Express middleware factory ────────────────────────────────────────────────

/**
 * Middleware that records confidence scores from the confidenceGate result
 * and attaches drift analysis to the response (or fires alerts).
 *
 * Expects req.confidenceResult = { score, domain } to be set upstream.
 */
function middleware(monitor = defaultDriftMonitor) {
  return function semanticDriftMiddleware(req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      // After response is sent, record the confidence score
      const score = body?.confidenceScore ?? body?.score ?? null;
      const domain = req.body?.domain ?? req.confidenceResult?.domain ?? 'GENERAL';

      if (typeof score === 'number') {
        const report = monitor.record(domain, score);
        if (report.alertLevel !== ALERT_LEVELS.NONE) {
          // Attach drift alert to response if not critical (critical = already handled)
          if (body && typeof body === 'object') {
            body._driftAlert = {
              level: report.alertLevel,
              recommendation: report.recommendation,
              domain: report.domain,
            };
          }
        }
      }

      return originalJson(body);
    };
    next();
  };
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  SemanticDriftMonitor,
  defaultDriftMonitor,
  middleware,
  DOMAIN_PROFILES,
  ALERT_LEVELS,
};
