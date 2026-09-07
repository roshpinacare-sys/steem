'use strict';
/**
 * lib/ttlSweepHistoryDiff387.js — ECOS V387 (Phase P275)
 *
 * DIRECTION 3: Sweep history diff.
 *
 * diffTtlSweepHistories387(histA, histB, opts) is a pure function that
 * compares two getTtlSweepHistory386 outputs side-by-side (keyed by sweptAt),
 * reporting which sweep events appear in one but not the other; summary:
 * identical, aDominates, bDominates, evictedOnlyInA, evictedOnlyInB.
 * Mirrors diffAutoHealRateAlertHistories385 for the sweep-history surface.
 *
 * Exports:
 *   TTL_SWEEP_HISTORY_DIFF_VERSION_387
 *   TTL_SWEEP_HISTORY_DIFF_SCHEMA_387
 *   diffTtlSweepHistories387(histA, histB, opts)
 *     — returns { ok, schema, version, diffedAt, totalA, totalB,
 *         onlyInA, onlyInB, inBoth, steps, summary }
 *
 * Endpoint: POST /api/v1/missions/proof-index/snapshot/compare/cursor-registry/ttl/sweep/history/diff [V387-T03]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 387 (R2).
 * Sacred untouched (R1). V361..V386 preserved (R6).
 *
 * @version 387.0.0
 */

const TTL_SWEEP_HISTORY_DIFF_VERSION_387 = '387.0.0';
const TTL_SWEEP_HISTORY_DIFF_SCHEMA_387  =
  'ecos.integrity.mission.proof.index.comparator.history.cursor.registry.ttl.sweep.history.diff/v387';

/**
 * Build a stable identity key for a sweep entry based on sweptAt.
 * @param {{ sweptAt?: string }} entry
 * @returns {string}
 */
function _sweepKey387(entry) {
  return (entry.sweptAt || '');
}

/**
 * Compare two getTtlSweepHistory386 outputs and produce a side-by-side diff.
 *
 * @param {{
 *   ok: boolean,
 *   sweeps: Array<{
 *     sweptAt: string,
 *     evicted: number,
 *     remaining: number,
 *     recordedAt: string|null,
 *     hash: string|null,
 *   }>,
 *   totalSweeps: number,
 *   summary: object,
 * }} histA
 * @param {{
 *   ok: boolean,
 *   sweeps: Array<object>,
 *   totalSweeps: number,
 *   summary: object,
 * }} histB
 * @param {{
 *   includeInBoth?: boolean,  — whether to include shared events in steps output (default true)
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
 *     sweptAt: string|null,
 *     entryA?: object,
 *     entryB?: object,
 *   }>,
 *   summary: {
 *     identical: boolean,
 *     aDominates: boolean,
 *     bDominates: boolean,
 *     evictedOnlyInA: number,
 *     evictedOnlyInB: number,
 *   },
 * }}
 */
function diffTtlSweepHistories387(histA, histB, opts) {
  const o = opts || {};
  const includeInBoth = o.includeInBoth !== false;

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:   TTL_SWEEP_HISTORY_DIFF_SCHEMA_387,
    version:  TTL_SWEEP_HISTORY_DIFF_VERSION_387,
    diffedAt: new Date().toISOString(),
    totalA: 0, totalB: 0, onlyInA: 0, onlyInB: 0, inBoth: 0,
    steps:   [],
    summary: {
      identical: false, aDominates: false, bDominates: false,
      evictedOnlyInA: 0, evictedOnlyInB: 0,
    },
  });

  if (!histA || !histA.ok) {
    return errorResult('histA must be a valid getTtlSweepHistory386 result');
  }
  if (!histB || !histB.ok) {
    return errorResult('histB must be a valid getTtlSweepHistory386 result');
  }
  if (!Array.isArray(histA.sweeps)) {
    return errorResult('histA.sweeps must be an array');
  }
  if (!Array.isArray(histB.sweeps)) {
    return errorResult('histB.sweeps must be an array');
  }

  const diffedAt = new Date().toISOString();

  // Index by key
  const mapA = new Map();
  for (const e of histA.sweeps) {
    const k = _sweepKey387(e);
    mapA.set(k, e);
  }

  const mapB = new Map();
  for (const e of histB.sweeps) {
    const k = _sweepKey387(e);
    mapB.set(k, e);
  }

  // Union of all keys in order (A first, then B-only)
  const allKeys = [];
  const seenKeys = new Set();

  for (const e of histA.sweeps) {
    const k = _sweepKey387(e);
    if (!seenKeys.has(k)) { allKeys.push(k); seenKeys.add(k); }
  }
  for (const e of histB.sweeps) {
    const k = _sweepKey387(e);
    if (!seenKeys.has(k)) { allKeys.push(k); seenKeys.add(k); }
  }

  const steps = [];
  let onlyInA = 0;
  let onlyInB = 0;
  let inBoth  = 0;
  let evictedOnlyInA = 0;
  let evictedOnlyInB = 0;

  for (const key of allKeys) {
    const inA = mapA.has(key);
    const inB = mapB.has(key);
    const entryA = inA ? mapA.get(key) : undefined;
    const entryB = inB ? mapB.get(key) : undefined;

    let side;
    if (inA && inB) {
      side = 'both';
      inBoth++;
    } else if (inA) {
      side = 'A';
      onlyInA++;
      evictedOnlyInA += typeof entryA.evicted === 'number' ? entryA.evicted : 0;
    } else {
      side = 'B';
      onlyInB++;
      evictedOnlyInB += typeof entryB.evicted === 'number' ? entryB.evicted : 0;
    }

    if (side === 'both' && !includeInBoth) continue;

    const step = {
      key,
      side,
      sweptAt: key || null,
    };
    if (entryA !== undefined) step.entryA = entryA;
    if (entryB !== undefined) step.entryB = entryB;

    steps.push(step);
  }

  const totalA = histA.sweeps.length;
  const totalB = histB.sweeps.length;

  const identical  = onlyInA === 0 && onlyInB === 0;
  const aDominates = onlyInA > onlyInB;
  const bDominates = onlyInB > onlyInA;

  return {
    ok:       true,
    schema:   TTL_SWEEP_HISTORY_DIFF_SCHEMA_387,
    version:  TTL_SWEEP_HISTORY_DIFF_VERSION_387,
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
      evictedOnlyInA,
      evictedOnlyInB,
    },
  };
}

module.exports = {
  TTL_SWEEP_HISTORY_DIFF_VERSION_387,
  TTL_SWEEP_HISTORY_DIFF_SCHEMA_387,
  diffTtlSweepHistories387,
};
