'use strict';
/**
 * lib/restoreHistoriesDiff388.js — ECOS V388 (Phase P276)
 *
 * DIRECTION 1: Restore history diff.
 *
 * diffRestoreHistories388(histA, histB, opts) is a pure function that compares
 * two getRestoreHistory387 outputs side-by-side (keyed by restoredAt), reporting
 * which restore events appear in one but not the other; summary: identical,
 * aDominates, bDominates, restoredOnlyInA, restoredOnlyInB.
 * Mirrors diffTtlSweepHistories387 for the restore-history surface.
 *
 * Exports:
 *   RESTORE_HISTORIES_DIFF_VERSION_388
 *   RESTORE_HISTORIES_DIFF_SCHEMA_388
 *   diffRestoreHistories388(histA, histB, opts)
 *     — returns { ok, schema, version, diffedAt, totalA, totalB,
 *         onlyInA, onlyInB, inBoth, steps, summary }
 *
 * Endpoint: POST /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/session/restore/history/diff [V388-T01]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 388 (R2).
 * Sacred untouched (R1). V361..V387 preserved (R6).
 *
 * @version 388.0.0
 */

const RESTORE_HISTORIES_DIFF_VERSION_388 = '388.0.0';
const RESTORE_HISTORIES_DIFF_SCHEMA_388  =
  'ecos.integrity.mission.proof.index.eviction.policy.aggregate.history.diff.session.restore.history.diff/v388';

/**
 * Build a stable identity key for a restore entry based on restoredAt.
 * @param {{ restoredAt?: string }} entry
 * @returns {string}
 */
function _restoreKey388(entry) {
  return (entry.restoredAt || '');
}

/**
 * Compare two getRestoreHistory387 outputs and produce a side-by-side diff.
 *
 * @param {{
 *   ok: boolean,
 *   restores: Array<{
 *     restoredAt: string,
 *     totalSessions: number,
 *     restored: number,
 *     skipped: number,
 *     failed: number,
 *     recordedAt: string|null,
 *     hash: string|null,
 *   }>,
 *   totalRestores: number,
 *   summary: object,
 * }} histA
 * @param {{
 *   ok: boolean,
 *   restores: Array<object>,
 *   totalRestores: number,
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
 *     restoredAt: string|null,
 *     entryA?: object,
 *     entryB?: object,
 *   }>,
 *   summary: {
 *     identical: boolean,
 *     aDominates: boolean,
 *     bDominates: boolean,
 *     restoredOnlyInA: number,
 *     restoredOnlyInB: number,
 *   },
 * }}
 */
function diffRestoreHistories388(histA, histB, opts) {
  const o = opts || {};
  const includeInBoth = o.includeInBoth !== false;

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:   RESTORE_HISTORIES_DIFF_SCHEMA_388,
    version:  RESTORE_HISTORIES_DIFF_VERSION_388,
    diffedAt: new Date().toISOString(),
    totalA: 0, totalB: 0, onlyInA: 0, onlyInB: 0, inBoth: 0,
    steps:   [],
    summary: {
      identical: false, aDominates: false, bDominates: false,
      restoredOnlyInA: 0, restoredOnlyInB: 0,
    },
  });

  if (!histA || !histA.ok) {
    return errorResult('histA must be a valid getRestoreHistory387 result');
  }
  if (!histB || !histB.ok) {
    return errorResult('histB must be a valid getRestoreHistory387 result');
  }
  if (!Array.isArray(histA.restores)) {
    return errorResult('histA.restores must be an array');
  }
  if (!Array.isArray(histB.restores)) {
    return errorResult('histB.restores must be an array');
  }

  const diffedAt = new Date().toISOString();

  // Index by key
  const mapA = new Map();
  for (const e of histA.restores) {
    const k = _restoreKey388(e);
    mapA.set(k, e);
  }

  const mapB = new Map();
  for (const e of histB.restores) {
    const k = _restoreKey388(e);
    mapB.set(k, e);
  }

  // Union of all keys in order (A first, then B-only)
  const allKeys  = [];
  const seenKeys = new Set();

  for (const e of histA.restores) {
    const k = _restoreKey388(e);
    if (!seenKeys.has(k)) { allKeys.push(k); seenKeys.add(k); }
  }
  for (const e of histB.restores) {
    const k = _restoreKey388(e);
    if (!seenKeys.has(k)) { allKeys.push(k); seenKeys.add(k); }
  }

  const steps = [];
  let onlyInA = 0;
  let onlyInB = 0;
  let inBoth  = 0;
  let restoredOnlyInA = 0;
  let restoredOnlyInB = 0;

  for (const key of allKeys) {
    const inA    = mapA.has(key);
    const inB    = mapB.has(key);
    const entryA = inA ? mapA.get(key) : undefined;
    const entryB = inB ? mapB.get(key) : undefined;

    let side;
    if (inA && inB) {
      side = 'both';
      inBoth++;
    } else if (inA) {
      side = 'A';
      onlyInA++;
      restoredOnlyInA += typeof entryA.restored === 'number' ? entryA.restored : 0;
    } else {
      side = 'B';
      onlyInB++;
      restoredOnlyInB += typeof entryB.restored === 'number' ? entryB.restored : 0;
    }

    if (side === 'both' && !includeInBoth) continue;

    const step = {
      key,
      side,
      restoredAt: key || null,
    };
    if (entryA !== undefined) step.entryA = entryA;
    if (entryB !== undefined) step.entryB = entryB;

    steps.push(step);
  }

  const totalA = histA.restores.length;
  const totalB = histB.restores.length;

  const identical  = onlyInA === 0 && onlyInB === 0;
  const aDominates = onlyInA > onlyInB;
  const bDominates = onlyInB > onlyInA;

  return {
    ok:       true,
    schema:   RESTORE_HISTORIES_DIFF_SCHEMA_388,
    version:  RESTORE_HISTORIES_DIFF_VERSION_388,
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
      restoredOnlyInA,
      restoredOnlyInB,
    },
  };
}

module.exports = {
  RESTORE_HISTORIES_DIFF_VERSION_388,
  RESTORE_HISTORIES_DIFF_SCHEMA_388,
  diffRestoreHistories388,
};
