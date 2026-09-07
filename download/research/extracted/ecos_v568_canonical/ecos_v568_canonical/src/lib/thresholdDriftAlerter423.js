'use strict';
/**
 * src/lib/thresholdDriftAlerter423.js — ECOS V423 (Phase P311) — Threshold Drift Alerting
 *
 * Emits audit events when global or topic thresholds drift beyond a configurable
 * band from a stored baseline. Integrates with AdaptiveThresholdEngine417 and the
 * audit subsystem.
 *
 * Usage:
 *   const alerter = new ThresholdDriftAlerter423({ baseline, audit, bandFraction: 0.15 });
 *   alerter.check423('__global__', engine._globalThresholds);
 *   alerter.check423('math', engine._topicThresholds.math);
 *
 * All identifiers end in 423 (R2). No new npm deps (R3). Sacred untouched (R1).
 *
 * @version 423.0.0
 */

const DRIFT_ALERTER_VERSION_423  = '423.0.0';
const DEFAULT_BAND_FRACTION_423  = 0.15; // 15% drift from baseline triggers alert

// ── ThresholdDriftAlerter423 ──────────────────────────────────────────────────

class ThresholdDriftAlerter423 {
  /**
   * @param {object} opts
   * @param {object} [opts.baseline]       — map of key → thresholds object used as reference
   * @param {number} [opts.bandFraction]   — fractional drift that triggers an alert (default 0.15)
   * @param {function} [opts.audit]        — audit(type, data) hook
   * @param {function} [opts.onAlert]      — optional callback(alertPayload) on drift detection
   */
  constructor(opts = {}) {
    this._baseline423     = opts.baseline || {};
    this._bandFraction423 = (typeof opts.bandFraction === 'number' && opts.bandFraction > 0)
      ? opts.bandFraction
      : DEFAULT_BAND_FRACTION_423;
    this._audit423        = typeof opts.audit === 'function' ? opts.audit : null;
    this._onAlert423      = typeof opts.onAlert === 'function' ? opts.onAlert : null;

    this._alertHistory423 = [];
    this._checkCount423   = 0;
  }

  _emit423(type, data) {
    if (this._audit423) {
      try { this._audit423(type, data); } catch (_) {}
    }
  }

  // ── Baseline management ───────────────────────────────────────────────────

  /**
   * Set (or overwrite) the baseline for a specific key.
   * @param {string} key          — '__global__' or a topic name
   * @param {object} thresholds   — threshold object to use as reference
   */
  setBaseline423(key, thresholds) {
    this._baseline423[key] = Object.assign({}, thresholds);
  }

  getBaseline423(key) {
    return this._baseline423[key] || null;
  }

  // ── Drift check ───────────────────────────────────────────────────────────

  /**
   * Compare current thresholds against baseline for the given key.
   * Emits an audit event and calls onAlert if any field drifted beyond band.
   *
   * @param {string} key          — '__global__' or topic name
   * @param {object} current      — current threshold values
   * @returns {{ drifted: boolean, driftDetails: Array, key }}
   */
  check423(key, current) {
    if (!key) throw new Error('ThresholdDriftAlerter423.check423 requires key (423)');
    if (!current || typeof current !== 'object') {
      return { drifted: false, driftDetails: [], key };
    }

    this._checkCount423++;
    const baseline = this._baseline423[key];
    if (!baseline) {
      // No baseline set: auto-set current as baseline and return no-drift
      this._baseline423[key] = Object.assign({}, current);
      return { drifted: false, driftDetails: [], key, baselineSet: true };
    }

    const driftDetails = [];
    for (const field of Object.keys(baseline)) {
      const base = baseline[field];
      const curr = current[field];
      if (typeof base !== 'number' || typeof curr !== 'number') continue;
      if (base === 0) continue; // avoid division by zero
      const relDrift = Math.abs(curr - base) / Math.abs(base);
      if (relDrift > this._bandFraction423) {
        driftDetails.push({
          field,
          baselineValue: base,
          currentValue:  curr,
          relDrift:      Math.round(relDrift * 10000) / 10000,
          band:          this._bandFraction423,
        });
      }
    }

    const drifted = driftDetails.length > 0;

    if (drifted) {
      const alertPayload = {
        key,
        driftDetails,
        bandFraction: this._bandFraction423,
        _ts:          Date.now(),
        version:      DRIFT_ALERTER_VERSION_423,
      };
      this._alertHistory423.push(alertPayload);
      if (this._alertHistory423.length > 1000) this._alertHistory423.shift();
      this._emit423('learning.thresholdDrift423', alertPayload);
      if (this._onAlert423) {
        try { this._onAlert423(alertPayload); } catch (_) {}
      }
    }

    return { drifted, driftDetails, key };
  }

  /**
   * Run check423 for all keys present in both baseline and the supplied map.
   * @param {object} currentMap  — { key: thresholds } (e.g. { '__global__': {...}, math: {...} })
   * @returns {Array<{ drifted, driftDetails, key }>}
   */
  checkAll423(currentMap) {
    if (!currentMap || typeof currentMap !== 'object') return [];
    const results = [];
    const allKeys = new Set([...Object.keys(this._baseline423), ...Object.keys(currentMap)]);
    for (const key of allKeys) {
      if (currentMap[key]) {
        results.push(this.check423(key, currentMap[key]));
      }
    }
    return results;
  }

  // ── History / Stats ────────────────────────────────────────────────────────

  getAlertHistory423(limit = 20) {
    return this._alertHistory423.slice(-limit).reverse();
  }

  getStatus423() {
    return {
      version:         DRIFT_ALERTER_VERSION_423,
      checkCount:      this._checkCount423,
      alertCount:      this._alertHistory423.length,
      bandFraction:    this._bandFraction423,
      baselineKeys:    Object.keys(this._baseline423),
    };
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  ThresholdDriftAlerter423,
  DRIFT_ALERTER_VERSION_423,
  DEFAULT_BAND_FRACTION_423,
};
