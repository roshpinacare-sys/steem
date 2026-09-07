'use strict';
/**
 * lib/autoHealRateAlertHistoryDiff385.js — ECOS V385 (Phase P273)
 *
 * DIRECTION 4: Alert history diff.
 *
 * diffAutoHealRateAlertHistories385(histA, histB, opts) is a pure function
 * that compares two getAutoHealRateAlertHistory384 outputs and reports which
 * alert events appear in one but not the other (by alertedAt + isOverused),
 * giving operators a side-by-side audit-trail comparison across two
 * audit-log snapshots.
 *
 * Exports:
 *   RATE_ALERT_HISTORY_DIFF_VERSION_385
 *   RATE_ALERT_HISTORY_DIFF_SCHEMA_385
 *   diffAutoHealRateAlertHistories385(histA, histB, opts)
 *     — returns { ok, schema, version, totalA, totalB,
 *         onlyInA, onlyInB, inBoth, steps, summary }
 *
 * Endpoint: POST /api/v1/integrity/auto-heal/quota/reset/rate/alert/history/diff [V385-T04]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 385 (R2).
 * Sacred untouched (R1). V361..V384 preserved (R6).
 *
 * @version 385.0.0
 */

const RATE_ALERT_HISTORY_DIFF_VERSION_385 = '385.0.0';
const RATE_ALERT_HISTORY_DIFF_SCHEMA_385  =
  'ecos.integrity.cross_chain.auto_heal.quota.reset.rate.alert.history.diff/v385';

/**
 * Build a stable identity key for an alert entry based on alertedAt + isOverused.
 * @param {{ alertedAt?: string, isOverused?: boolean }} entry
 * @returns {string}
 */
function _alertKey385(entry) {
  return (entry.alertedAt || '') + '|' + String(!!entry.isOverused);
}

/**
 * Compare two getAutoHealRateAlertHistory384 outputs and produce a
 * side-by-side diff.
 *
 * @param {{
 *   ok: boolean,
 *   alerts: Array<{
 *     alertedAt: string,
 *     isOverused: boolean,
 *     resetsPerHour: number,
 *     resetsInWindow: number,
 *     windowHours: number,
 *     threshold: number,
 *     forced: boolean,
 *   }>,
 *   totalAlerts: number,
 *   summary: object,
 * }} histA
 * @param {{
 *   ok: boolean,
 *   alerts: Array<object>,
 *   totalAlerts: number,
 *   summary: object,
 * }} histB
 * @param {{
 *   includeInBoth?: boolean,  — whether to include shared events in steps (default true)
 * }} [opts]
 * @returns {{
 *   ok: boolean,
 *   schema: string,
 *   version: string,
 *   diffedAt: string,
 *   totalA: number,
 *   totalB: number,
 *   onlyInA: number,
 *   onlyInB: number,
 *   inBoth: number,
 *   steps: Array<{
 *     key: string,
 *     side: 'A'|'B'|'both',
 *     alertedAt: string,
 *     isOverused: boolean,
 *     entryA?: object,
 *     entryB?: object,
 *   }>,
 *   summary: {
 *     identical: boolean,
 *     aDominates: boolean,
 *     bDominates: boolean,
 *     overusedOnlyInA: number,
 *     overusedOnlyInB: number,
 *     forcedOnlyInA: number,
 *     forcedOnlyInB: number,
 *   },
 * }}
 */
function diffAutoHealRateAlertHistories385(histA, histB, opts) {
  const o = opts || {};
  const includeInBoth = o.includeInBoth !== false;

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:   RATE_ALERT_HISTORY_DIFF_SCHEMA_385,
    version:  RATE_ALERT_HISTORY_DIFF_VERSION_385,
    diffedAt: new Date().toISOString(),
    totalA: 0, totalB: 0,
    onlyInA: 0, onlyInB: 0, inBoth: 0,
    steps: [],
    summary: {
      identical: false, aDominates: false, bDominates: false,
      overusedOnlyInA: 0, overusedOnlyInB: 0,
      forcedOnlyInA:   0, forcedOnlyInB:   0,
    },
  });

  if (!histA || histA.ok === false) {
    return errorResult('histA must be a valid getAutoHealRateAlertHistory384() result');
  }
  if (!histB || histB.ok === false) {
    return errorResult('histB must be a valid getAutoHealRateAlertHistory384() result');
  }
  if (!Array.isArray(histA.alerts)) {
    return errorResult('histA.alerts must be an array');
  }
  if (!Array.isArray(histB.alerts)) {
    return errorResult('histB.alerts must be an array');
  }

  const diffedAt = new Date().toISOString();

  // Build lookup maps keyed by alertedAt|isOverused
  const mapA = new Map();
  for (const entry of histA.alerts) {
    const key = _alertKey385(entry);
    if (!mapA.has(key)) mapA.set(key, entry);
  }

  const mapB = new Map();
  for (const entry of histB.alerts) {
    const key = _alertKey385(entry);
    if (!mapB.has(key)) mapB.set(key, entry);
  }

  const steps = [];
  let onlyInA = 0;
  let onlyInB = 0;
  let inBoth  = 0;

  // Collect all unique keys
  const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

  for (const key of allKeys) {
    const inA = mapA.has(key);
    const inB = mapB.has(key);

    const parts = key.split('|');
    const alertedAt  = parts[0] || null;
    const isOverused = parts[1] === 'true';

    if (inA && inB) {
      inBoth++;
      if (includeInBoth) {
        steps.push({
          key, side: 'both',
          alertedAt, isOverused,
          entryA: mapA.get(key),
          entryB: mapB.get(key),
        });
      }
    } else if (inA) {
      onlyInA++;
      steps.push({
        key, side: 'A',
        alertedAt, isOverused,
        entryA: mapA.get(key),
      });
    } else {
      onlyInB++;
      steps.push({
        key, side: 'B',
        alertedAt, isOverused,
        entryB: mapB.get(key),
      });
    }
  }

  // Sort steps by alertedAt ascending
  steps.sort((a, b) => {
    if (!a.alertedAt) return -1;
    if (!b.alertedAt) return  1;
    return a.alertedAt < b.alertedAt ? -1 : a.alertedAt > b.alertedAt ? 1 : 0;
  });

  const totalA = histA.alerts.length;
  const totalB = histB.alerts.length;

  // Summary metrics
  const overusedOnlyInA = steps.filter(s => s.side === 'A' && s.isOverused).length;
  const overusedOnlyInB = steps.filter(s => s.side === 'B' && s.isOverused).length;
  const forcedOnlyInA   = steps.filter(s => s.side === 'A' && s.entryA && s.entryA.forced).length;
  const forcedOnlyInB   = steps.filter(s => s.side === 'B' && s.entryB && s.entryB.forced).length;
  const identical       = onlyInA === 0 && onlyInB === 0;
  const aDominates      = onlyInA > onlyInB;
  const bDominates      = onlyInB > onlyInA;

  return {
    ok:      true,
    schema:  RATE_ALERT_HISTORY_DIFF_SCHEMA_385,
    version: RATE_ALERT_HISTORY_DIFF_VERSION_385,
    diffedAt,
    totalA,
    totalB,
    onlyInA,
    onlyInB,
    inBoth,
    steps,
    summary: {
      identical,
      aDominates,
      bDominates,
      overusedOnlyInA,
      overusedOnlyInB,
      forcedOnlyInA,
      forcedOnlyInB,
    },
  };
}

module.exports = {
  RATE_ALERT_HISTORY_DIFF_VERSION_385,
  RATE_ALERT_HISTORY_DIFF_SCHEMA_385,
  diffAutoHealRateAlertHistories385,
};
