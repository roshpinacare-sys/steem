'use strict';
/**
 * lib/ttlSweepHistoryDiffPaginator388.js — ECOS V388 (Phase P276)
 *
 * DIRECTION 3: Sweep history projection paginator.
 *
 * paginateTtlSweepHistoryDiff388(diff, opts) provides cursor-based pagination
 * over the `steps` array of a diffTtlSweepHistories387 result, mirroring
 * paginateAlertHistoryDiff386 for the sweep-history-diff surface.
 * Opaque base64 cursor tokens; nextCursor/prevCursor bidirectional traversal;
 * accepts pre-built diff or { histA, histB } pair.
 *
 * Exports:
 *   TTL_SWEEP_HISTORY_DIFF_PAGINATOR_VERSION_388
 *   TTL_SWEEP_HISTORY_DIFF_PAGINATOR_SCHEMA_388
 *   DEFAULT_SWEEP_DIFF_PAGE_LIMIT_388
 *   encodeSweepDiffCursor388(stepIndex, ts)
 *   decodeSweepDiffCursor388(token)
 *   paginateTtlSweepHistoryDiff388(diff, opts)
 *     — returns { ok, schema, version, totalSteps, onlyInA, onlyInB, inBoth,
 *         cursor, nextCursor, prevCursor, startIndex, pageSize, steps, summary }
 *
 * Endpoint: POST /api/v1/missions/proof-index/snapshot/compare/cursor-registry/ttl/sweep/history/diff/page [V388-T03]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 388 (R2).
 * Sacred untouched (R1). V361..V387 preserved (R6).
 *
 * @version 388.0.0
 */

const TSD387 = require('./ttlSweepHistoryDiff387.js');

const TTL_SWEEP_HISTORY_DIFF_PAGINATOR_VERSION_388 = '388.0.0';
const TTL_SWEEP_HISTORY_DIFF_PAGINATOR_SCHEMA_388  =
  'ecos.integrity.mission.proof.index.comparator.history.cursor.registry.ttl.sweep.history.diff.paginator/v388';
const DEFAULT_SWEEP_DIFF_PAGE_LIMIT_388 = 20;

/**
 * Encode an opaque cursor token for the sweep history diff paginator.
 * @param {number} stepIndex
 * @param {string|null} [ts]
 * @returns {string}
 */
function encodeSweepDiffCursor388(stepIndex, ts) {
  return Buffer.from(
    JSON.stringify({ v: 1, stepIndex: Math.floor(stepIndex), ts: ts || null }),
    'utf8'
  ).toString('base64');
}

/**
 * Decode a cursor token. Returns null if the token is invalid.
 * @param {string} token
 * @returns {{ stepIndex: number, ts: string|null }|null}
 */
function decodeSweepDiffCursor388(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const obj = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    if (obj && typeof obj.stepIndex === 'number' && obj.stepIndex >= 0) {
      return { stepIndex: obj.stepIndex, ts: obj.ts || null };
    }
  } catch (_) {}
  return null;
}

/**
 * Cursor-based pagination over the steps array of a
 * diffTtlSweepHistories387 result.
 *
 * @param {object|{ histA: object, histB: object }} diffOrHistories
 *   — a pre-built diff result from diffTtlSweepHistories387(), OR
 *     an object with histA and histB to build the diff on-demand.
 * @param {{
 *   cursor?: string,
 *   limit?: number,
 *   includeInBoth?: boolean,
 * }} [opts]
 * @returns {{
 *   ok: boolean,
 *   schema: string,
 *   version: string,
 *   totalSteps: number,
 *   onlyInA: number,
 *   onlyInB: number,
 *   inBoth: number,
 *   cursor: string|null,
 *   nextCursor: string|null,
 *   prevCursor: string|null,
 *   startIndex: number,
 *   pageSize: number,
 *   steps: Array<object>,
 *   summary: object,
 * }}
 */
function paginateTtlSweepHistoryDiff388(diffOrHistories, opts) {
  const o = opts || {};
  const limit = (typeof o.limit === 'number' && o.limit > 0)
    ? Math.floor(o.limit)
    : DEFAULT_SWEEP_DIFF_PAGE_LIMIT_388;

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:      TTL_SWEEP_HISTORY_DIFF_PAGINATOR_SCHEMA_388,
    version:     TTL_SWEEP_HISTORY_DIFF_PAGINATOR_VERSION_388,
    totalSteps:  0,
    onlyInA: 0, onlyInB: 0, inBoth: 0,
    cursor: null, nextCursor: null, prevCursor: null,
    startIndex: 0, pageSize: 0, steps: [], summary: {},
  });

  if (!diffOrHistories) {
    return errorResult('diff or { histA, histB } is required');
  }

  // Resolve diff: accept pre-built or { histA, histB }
  let diff = diffOrHistories;
  if (!Array.isArray(diff.steps) && diff.histA && diff.histB) {
    diff = TSD387.diffTtlSweepHistories387(diff.histA, diff.histB, {
      includeInBoth: o.includeInBoth !== false,
    });
  }

  if (!diff || !diff.ok) {
    return errorResult((diff && diff.error) || 'diff must be a valid diffTtlSweepHistories387 result');
  }

  if (!Array.isArray(diff.steps)) {
    return errorResult('diff.steps must be an array');
  }

  // Decode incoming cursor
  const incomingCursor = o.cursor || null;
  let startIndex = 0;

  if (incomingCursor) {
    const decoded = decodeSweepDiffCursor388(incomingCursor);
    if (!decoded) {
      return errorResult('cursor token is not a valid V388 sweep diff cursor');
    }
    startIndex = decoded.stepIndex;
  }

  const allSteps   = diff.steps;
  const totalSteps = allSteps.length;

  // Slice the page
  const page     = allSteps.slice(startIndex, startIndex + limit);
  const endIndex = startIndex + page.length;
  const hasNext  = endIndex < allSteps.length;
  const hasPrev  = startIndex > 0;
  const ts       = new Date().toISOString();

  const nextCursor    = hasNext ? encodeSweepDiffCursor388(endIndex, ts) : null;
  const prevCursor    = hasPrev ? encodeSweepDiffCursor388(Math.max(0, startIndex - limit), ts) : null;
  const currentCursor = encodeSweepDiffCursor388(startIndex, ts);

  return {
    ok:          true,
    schema:      TTL_SWEEP_HISTORY_DIFF_PAGINATOR_SCHEMA_388,
    version:     TTL_SWEEP_HISTORY_DIFF_PAGINATOR_VERSION_388,
    totalSteps,
    onlyInA:     diff.onlyInA != null ? diff.onlyInA : 0,
    onlyInB:     diff.onlyInB != null ? diff.onlyInB : 0,
    inBoth:      diff.inBoth  != null ? diff.inBoth  : 0,
    cursor:      currentCursor,
    nextCursor,
    prevCursor,
    startIndex,
    pageSize:    page.length,
    steps:       page,
    summary:     diff.summary || {},
  };
}

module.exports = {
  TTL_SWEEP_HISTORY_DIFF_PAGINATOR_VERSION_388,
  TTL_SWEEP_HISTORY_DIFF_PAGINATOR_SCHEMA_388,
  DEFAULT_SWEEP_DIFF_PAGE_LIMIT_388,
  encodeSweepDiffCursor388,
  decodeSweepDiffCursor388,
  paginateTtlSweepHistoryDiff388,
};
