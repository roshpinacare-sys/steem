'use strict';
/**
 * src/lib/solvencyFederationDisputeAlert409.js — ECOS V409 (Phase P297) —
 * Federation Dispute Threshold Alerts.
 *
 * Evaluates the V408 dispute aggregator output against a configurable
 * threshold (per-peer dispute count, optional time window) and emits a
 * deterministic, append-only alert list so an operator can react to
 * peers that cross the threshold without re-reading the raw dispute log.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 409 (R2).
 *
 * @version 409.0.0
 */

const DISPUTE_ALERT_VERSION_409 = '409.0.0';

function createSolvencyFederationDisputeAlert409(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const defaultThreshold = Number.isFinite(opts.threshold)
    ? Math.max(1, opts.threshold | 0)
    : 3;
  const maxAlerts = Number.isFinite(opts.maxAlerts)
    ? Math.max(16, opts.maxAlerts | 0)
    : 1024;

  const alerts = []; // { seq, ts, operatorId, count, threshold }
  let nextSeq = 1;
  let totalEvaluations = 0;
  let totalAlerts = 0;

  function evaluate409(aggregator408, { threshold } = {}) {
    if (!aggregator408 || typeof aggregator408.topOffenders408 !== 'function') {
      throw new Error('aggregator408 required');
    }
    const thr = Number.isFinite(threshold) ? Math.max(1, threshold | 0) : defaultThreshold;
    const top = aggregator408.topOffenders408(1024);
    const ts = now();
    const triggered = [];
    for (const t of top) {
      if (t.count >= thr) {
        const rec = {
          seq: nextSeq++,
          ts,
          operatorId: t.operatorId,
          count: t.count,
          threshold: thr,
        };
        alerts.push(rec);
        while (alerts.length > maxAlerts) alerts.shift();
        triggered.push(rec);
        totalAlerts++;
      }
    }
    totalEvaluations++;
    return { ok: true, evaluatedAt: ts, threshold: thr, triggered };
  }

  function list409(limit) {
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : alerts.length;
    return alerts.slice(-n).map((r) => Object.assign({}, r));
  }

  function clear409() {
    const cleared = alerts.length;
    alerts.length = 0;
    return { ok: true, cleared };
  }

  function stats409() {
    return {
      alerts: alerts.length,
      nextSeq,
      totalEvaluations,
      totalAlerts,
      defaultThreshold,
    };
  }

  return { evaluate409, list409, clear409, stats409 };
}

module.exports = {
  DISPUTE_ALERT_VERSION_409,
  createSolvencyFederationDisputeAlert409,
};
