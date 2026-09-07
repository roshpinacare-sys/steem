'use strict';
/**
 * src/lib/solvencyFederationDisputeAggregator408.js — ECOS V408 (Phase P296) —
 * Federation Dispute Aggregator.
 *
 * Aggregates the V407 dispute log into per-peer counters and time-window
 * "top offenders" rankings so an operator can answer "which peers are
 * diverging from us most often" without scanning the full log.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 408 (R2).
 *
 * @version 408.0.0
 */

const DISPUTE_AGGREGATOR_VERSION_408 = '408.0.0';

function createSolvencyFederationDisputeAggregator408(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();

  let lastAggregatedAt = 0;
  let lastTotal = 0;
  let lastPerPeer = {};
  let lastWindow = null;

  function aggregate408(disputeLog407, { windowMs } = {}) {
    if (!disputeLog407 || typeof disputeLog407.listDisputes407 !== 'function') {
      throw new Error('disputeLog407 required');
    }
    const all = disputeLog407.listDisputes407();
    const tsNow = now();
    const cutoff = Number.isFinite(windowMs) && windowMs > 0 ? tsNow - (windowMs | 0) : 0;
    const perPeer = {};
    let total = 0;
    for (const d of all) {
      if (!d || (cutoff > 0 && d.ts < cutoff)) continue;
      perPeer[d.operatorId] = (perPeer[d.operatorId] || 0) + 1;
      total++;
    }
    lastAggregatedAt = tsNow;
    lastTotal = total;
    lastPerPeer = perPeer;
    lastWindow = Number.isFinite(windowMs) ? windowMs : null;
    return { ok: true, aggregatedAt: tsNow, total, perPeer, windowMs: lastWindow };
  }

  function topOffenders408(limit) {
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : 10;
    const arr = Object.keys(lastPerPeer).map(opId => ({ operatorId: opId, count: lastPerPeer[opId] }));
    arr.sort((a, b) => b.count - a.count || (a.operatorId < b.operatorId ? -1 : 1));
    return arr.slice(0, n);
  }

  function stats408() {
    return {
      lastAggregatedAt,
      lastTotal,
      trackedPeers: Object.keys(lastPerPeer).length,
      lastWindowMs: lastWindow,
    };
  }

  return { aggregate408, topOffenders408, stats408 };
}

module.exports = {
  DISPUTE_AGGREGATOR_VERSION_408,
  createSolvencyFederationDisputeAggregator408,
};
