'use strict';
/**
 * lib/thresholdAlert461.js — ECOS V461
 *
 * Threshold Alert Detector
 * בודק אם ה-threshold שונה יותר מדי פעמים בחלון זמן נתון.
 * data source: thresholdHistory460 → safetyAutoArm440
 *
 * מחבר: thresholdHistory460 (V460) → alert-status endpoint (V461)
 *
 * @version 461.0.0
 */

const THRESHOLD_ALERT_VERSION461 = '461.0.0';

/**
 * DEFAULT_WINDOW_MS: 10 minutes
 * DEFAULT_MAX_CHANGES: 3 changes in window = alert
 */
const DEFAULT_WINDOW_MS461   = 10 * 60 * 1000; // 10 minutes
const DEFAULT_MAX_CHANGES461 = 3;

/**
 * getThresholdAlertStatus461(opts)
 *
 * @param {object}   opts
 * @param {Array}    opts.history      — from getThresholdHistory460(...).history (full, unfiltered preferred)
 * @param {number}   [opts.windowMs]  — look-back window in ms (default: 600_000)
 * @param {number}   [opts.maxChanges]— max allowed threshold_configure events in window (default: 3)
 * @param {number}   [opts.nowMs]     — override "now" for testability (default: Date.now())
 * @returns {{ ok:boolean, alert:boolean, count:number, window_ms:number, max_changes:number, version:string }}
 */
function getThresholdAlertStatus461(opts) {
  const {
    history,
    windowMs   = DEFAULT_WINDOW_MS461,
    maxChanges = DEFAULT_MAX_CHANGES461,
    nowMs      = Date.now(),
  } = opts || {};

  if (!Array.isArray(history)) {
    return {
      ok:          false,
      error:       'history must be an array',
      alert:       false,
      count:       0,
      window_ms:   windowMs,
      max_changes: maxChanges,
      version:     THRESHOLD_ALERT_VERSION461,
    };
  }

  const cutoff = nowMs - windowMs;

  // Count threshold_configure events within window
  const recent = history.filter(entry => {
    if (!entry || typeof entry.ts !== 'string') return false;
    const t = Date.parse(entry.ts);
    if (isNaN(t)) return false;
    return t >= cutoff && entry.event === 'threshold_configure459';
  });

  const count = recent.length;
  const alert = count > maxChanges;

  return {
    ok:          true,
    alert,
    count,
    window_ms:   windowMs,
    max_changes: maxChanges,
    recent:      recent.map(e => ({ ts: e.ts, prevArm: e.prevArm, newArm: e.newArm })),
    version:     THRESHOLD_ALERT_VERSION461,
  };
}

module.exports = {
  getThresholdAlertStatus461,
  THRESHOLD_ALERT_VERSION461,
  DEFAULT_WINDOW_MS461,
  DEFAULT_MAX_CHANGES461,
};
