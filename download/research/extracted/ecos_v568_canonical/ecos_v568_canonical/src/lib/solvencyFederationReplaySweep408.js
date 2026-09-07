'use strict';
/**
 * src/lib/solvencyFederationReplaySweep408.js — ECOS V408 (Phase P296) —
 * Federation Replay Guard Sweep.
 *
 * Periodic sweep of the V407 replay-guard rejection buffer into bucketed
 * counters per peer and per reason so an operator can observe replay/stale
 * pressure over time without scanning the raw rejection list.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 408 (R2).
 *
 * @version 408.0.0
 */

const REPLAY_SWEEP_VERSION_408 = '408.0.0';

function createSolvencyFederationReplaySweep408(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const bucketMs = Number.isFinite(opts.bucketMs) ? Math.max(1000, opts.bucketMs | 0) : 60_000;
  const maxBuckets = Number.isFinite(opts.maxBuckets) ? Math.max(8, opts.maxBuckets | 0) : 240;

  // bucketStart -> { perPeer:{opId:n}, perReason:{reason:n}, total }
  const buckets = new Map();
  // Track which rejection records have already been counted (content-keyed).
  const seenKeys = new Set();
  let seenKeysOrder = [];
  const MAX_KEYS = 4096;
  let totalSwept = 0;
  let lastSweptAt = 0;

  function _bucketKey(ts) { return Math.floor(ts / bucketMs) * bucketMs; }
  function _recKey(r) { return r.ts + '|' + r.operatorId + '|' + r.envelopeHash + '|' + r.reason; }

  function sweep408(replayGuard407) {
    if (!replayGuard407 || typeof replayGuard407.recentRejections407 !== 'function') {
      throw new Error('replayGuard407 required');
    }
    const recent = replayGuard407.recentRejections407();
    let added = 0;
    for (const r of recent) {
      if (!r || typeof r.ts !== 'number') continue;
      const k = _recKey(r);
      if (seenKeys.has(k)) continue;
      seenKeys.add(k);
      seenKeysOrder.push(k);
      if (seenKeysOrder.length > MAX_KEYS) {
        const drop = seenKeysOrder.shift();
        seenKeys.delete(drop);
      }
      const bk = _bucketKey(r.ts);
      let b = buckets.get(bk);
      if (!b) { b = { bucketStart: bk, perPeer: {}, perReason: {}, total: 0 }; buckets.set(bk, b); }
      b.perPeer[r.operatorId] = (b.perPeer[r.operatorId] || 0) + 1;
      b.perReason[r.reason]   = (b.perReason[r.reason]   || 0) + 1;
      b.total++;
      added++;
    }
    if (buckets.size > maxBuckets) {
      const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
      while (keys.length > maxBuckets) buckets.delete(keys.shift());
    }
    totalSwept += added;
    lastSweptAt = now();
    return { ok: true, sweptAt: lastSweptAt, added, buckets: buckets.size, totalSwept };
  }

  function listBuckets408(limit) {
    const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : keys.length;
    return keys.slice(-n).map(k => {
      const b = buckets.get(k);
      return {
        bucketStart: b.bucketStart,
        total: b.total,
        perPeer: Object.assign({}, b.perPeer),
        perReason: Object.assign({}, b.perReason),
      };
    });
  }

  function stats408() {
    return { buckets: buckets.size, bucketMs, maxBuckets, totalSwept, lastSweptAt };
  }

  return { sweep408, listBuckets408, stats408 };
}

module.exports = {
  REPLAY_SWEEP_VERSION_408,
  createSolvencyFederationReplaySweep408,
};
