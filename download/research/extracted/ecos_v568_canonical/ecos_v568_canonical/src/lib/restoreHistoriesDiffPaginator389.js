'use strict';
/**
 * lib/restoreHistoriesDiffPaginator389.js — ECOS V389 (Phase P277)
 *
 * DIRECTION 1: Restore histories diff paginator.
 *
 * paginateRestoreHistoriesDiff389(diff, opts) provides cursor-based pagination
 * over the `steps` array of a diffRestoreHistories388 result, mirroring
 * paginateTtlSweepHistoryDiff388 for the restore-histories-diff surface.
 * Opaque base64 cursor tokens; nextCursor/prevCursor bidirectional traversal;
 * accepts pre-built diff or { histA, histB } pair.
 *
 * Exports:
 *   RESTORE_HISTORIES_DIFF_PAGINATOR_VERSION_389
 *   RESTORE_HISTORIES_DIFF_PAGINATOR_SCHEMA_389
 *   DEFAULT_RESTORE_DIFF_PAGE_LIMIT_389
 *   encodeRestoreDiffCursor389(stepIndex, ts)
 *   decodeRestoreDiffCursor389(token)
 *   paginateRestoreHistoriesDiff389(diff, opts)
 *     — returns { ok, schema, version, totalSteps, onlyInA, onlyInB, inBoth,
 *         cursor, nextCursor, prevCursor, startIndex, pageSize, steps, summary }
 *
 * Endpoint: POST /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/session/restore/history/diff/page [V389-T01]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 389 (R2).
 * Sacred untouched (R1). V361..V388 preserved (R6).
 *
 * @version 389.0.0
 */

const RHD388 = require('./restoreHistoriesDiff388.js');

const RESTORE_HISTORIES_DIFF_PAGINATOR_VERSION_389 = '389.0.0';
const RESTORE_HISTORIES_DIFF_PAGINATOR_SCHEMA_389  =
  'ecos.integrity.mission.proof.index.eviction.policy.aggregate.history.diff.session.restore.history.diff.paginator/v389';
const DEFAULT_RESTORE_DIFF_PAGE_LIMIT_389 = 20;

/**
 * Encode an opaque cursor token for the restore histories diff paginator.
 * @param {number} stepIndex
 * @param {string|null} [ts]
 * @returns {string}
 */
function encodeRestoreDiffCursor389(stepIndex, ts) {
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
function decodeRestoreDiffCursor389(token) {
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
 * diffRestoreHistories388 result.
 *
 * @param {object|{ histA: object, histB: object }} diffOrHistories
 *   — a pre-built diff result from diffRestoreHistories388(), OR
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
function paginateRestoreHistoriesDiff389(diffOrHistories, opts) {
  const o = opts || {};
  const limit = (typeof o.limit === 'number' && o.limit > 0)
    ? Math.floor(o.limit)
    : DEFAULT_RESTORE_DIFF_PAGE_LIMIT_389;

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:      RESTORE_HISTORIES_DIFF_PAGINATOR_SCHEMA_389,
    version:     RESTORE_HISTORIES_DIFF_PAGINATOR_VERSION_389,
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
    diff = RHD388.diffRestoreHistories388(diff.histA, diff.histB, {
      includeInBoth: o.includeInBoth !== false,
    });
  }

  if (!diff || !diff.ok) {
    return errorResult((diff && diff.error) || 'diff must be a valid diffRestoreHistories388 result');
  }

  if (!Array.isArray(diff.steps)) {
    return errorResult('diff.steps must be an array');
  }

  // Decode incoming cursor
  const incomingCursor = o.cursor || null;
  let startIndex = 0;

  if (incomingCursor) {
    const decoded = decodeRestoreDiffCursor389(incomingCursor);
    if (!decoded) {
      return errorResult('cursor token is not a valid V389 restore diff cursor');
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

  const nextCursor    = hasNext ? encodeRestoreDiffCursor389(endIndex, ts) : null;
  const prevCursor    = hasPrev ? encodeRestoreDiffCursor389(Math.max(0, startIndex - limit), ts) : null;
  const currentCursor = encodeRestoreDiffCursor389(startIndex, ts);

  return {
    ok:          true,
    schema:      RESTORE_HISTORIES_DIFF_PAGINATOR_SCHEMA_389,
    version:     RESTORE_HISTORIES_DIFF_PAGINATOR_VERSION_389,
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
  RESTORE_HISTORIES_DIFF_PAGINATOR_VERSION_389,
  RESTORE_HISTORIES_DIFF_PAGINATOR_SCHEMA_389,
  DEFAULT_RESTORE_DIFF_PAGE_LIMIT_389,
  encodeRestoreDiffCursor389,
  decodeRestoreDiffCursor389,
  paginateRestoreHistoriesDiff389,
};
