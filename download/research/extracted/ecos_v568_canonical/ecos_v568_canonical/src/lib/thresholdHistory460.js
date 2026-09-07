'use strict';
/**
 * lib/thresholdHistory460.js — ECOS V460
 *
 * Threshold History Reader
 * מחזיר את היסטוריית שינויי ה-threshold מ-_state440 של safetyAutoArm440.
 * תומך בפילטור לפי event type ו-limit.
 *
 * מחבר: autoArmThresholdConfig459 (V459) → observability layer (V460)
 *
 * @version 460.0.0
 */

const THRESHOLD_HISTORY_VERSION460 = '460.0.0';

/**
 * getThresholdHistory460(opts)
 * @param {object}  opts
 * @param {object}  opts.safetyAutoArm — מופע עם _state440.history
 * @param {string}  [opts.eventType]   — פילטר אופציונלי לפי event string
 * @param {number}  [opts.limit]       — מקסימום רשומות (ברירת מחדל: 50, מקסימום: 200)
 * @returns {{ ok:boolean, history:Array, total:number, filtered:number, version:string }}
 */
function getThresholdHistory460(opts) {
  const { safetyAutoArm, eventType, limit } = opts || {};

  if (!safetyAutoArm || !safetyAutoArm._state440) {
    return {
      ok:       false,
      error:    'safetyAutoArm._state440 not available',
      history:  [],
      total:    0,
      filtered: 0,
      version:  THRESHOLD_HISTORY_VERSION460,
    };
  }

  const rawHistory = safetyAutoArm._state440.history;
  if (!Array.isArray(rawHistory)) {
    return {
      ok:       true,
      history:  [],
      total:    0,
      filtered: 0,
      version:  THRESHOLD_HISTORY_VERSION460,
    };
  }

  const total = rawHistory.length;

  // Filter by eventType if provided
  const filtered = eventType
    ? rawHistory.filter(e => e && e.event === eventType)
    : rawHistory.slice();

  // Apply limit (default 50, max 200)
  const maxLimit = 200;
  const resolvedLimit = Math.min(
    Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 50),
    maxLimit
  );

  // Return most recent entries first
  const sliced = filtered.slice(-resolvedLimit).reverse();

  return {
    ok:       true,
    history:  sliced,
    total,
    filtered: filtered.length,
    limit:    resolvedLimit,
    version:  THRESHOLD_HISTORY_VERSION460,
  };
}

module.exports = {
  getThresholdHistory460,
  THRESHOLD_HISTORY_VERSION460,
};
