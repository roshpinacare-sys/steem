'use strict';
/**
 * lib/aggregatorHistoryDiffPaginator382.js — ECOS V382 (Phase P270)
 *
 * DIRECTION 1: Aggregator history diff pagination.
 *
 * paginateAggregatorHistoryDiff382(diff, opts) provides cursor-based pagination
 * over the steps array of a diffAggregatorHistories381 result, mirroring the
 * V380 cursor-paginator pattern for the new diff surface.
 *
 * Exports:
 *   AGG_DIFF_PAGINATOR_VERSION_382
 *   AGG_DIFF_PAGINATOR_SCHEMA_382
 *   DEFAULT_AGG_DIFF_PAGE_LIMIT_382
 *   encodeAggDiffCursor382(stepIndex, ts)
 *   decodeAggDiffCursor382(token)
 *   paginateAggregatorHistoryDiff382(diff, opts)
 *     — returns { ok, schema, version, totalSteps, cursor, nextCursor,
 *         prevCursor, startIndex, steps, summary }
 *
 * Endpoint: POST /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/page [V382-T01]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 382 (R2).
 * Sacred untouched (R1). V361..V381 preserved (R6).
 *
 * @version 382.0.0
 */

const AHD381 = require('./aggregatorHistoryDiff381.js');

const AGG_DIFF_PAGINATOR_VERSION_382  = '382.0.0';
const AGG_DIFF_PAGINATOR_SCHEMA_382   = 'ecos.integrity.mission.proof.index.eviction.policy.aggregate.history.diff.paginator/v382';
const DEFAULT_AGG_DIFF_PAGE_LIMIT_382 = 20;

/**
 * Encode an opaque cursor token for the diff paginator.
 * @param {number} stepIndex
 * @param {string|null} [ts]
 * @returns {string}
 */
function encodeAggDiffCursor382(stepIndex, ts) {
  return Buffer.from(JSON.stringify({ v: 1, stepIndex: Math.floor(stepIndex), ts: ts || null }), 'utf8').toString('base64');
}

/**
 * Decode a cursor token. Returns null if the token is invalid.
 * @param {string} token
 * @returns {{ stepIndex: number, ts: string|null }|null}
 */
function decodeAggDiffCursor382(token) {
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
 * Cursor-based pagination over the steps array of a diffAggregatorHistories381 result.
 *
 * @param {object|{ historyA: object, historyB: object }} diffOrHistories
 *   — a pre-built diff result from diffAggregatorHistories381(), OR
 *     an object with historyA and historyB to build the diff on-demand.
 * @param {{
 *   cursor?: string,
 *   limit?: number,
 *   includeMatched?: boolean,
 * }} [opts]
 * @returns {{
 *   ok: boolean,
 *   schema: string,
 *   version: string,
 *   totalSteps: number,
 *   divergedSteps: number,
 *   matchedSteps: number,
 *   cursor: string|null,
 *   nextCursor: string|null,
 *   prevCursor: string|null,
 *   startIndex: number,
 *   steps: object[],
 *   summary: object,
 * }}
 */
function paginateAggregatorHistoryDiff382(diffOrHistories, opts) {
  const o     = opts || {};
  const limit = (typeof o.limit === 'number' && o.limit > 0) ? Math.floor(o.limit) : DEFAULT_AGG_DIFF_PAGE_LIMIT_382;

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema: AGG_DIFF_PAGINATOR_SCHEMA_382, version: AGG_DIFF_PAGINATOR_VERSION_382,
    totalSteps: 0, divergedSteps: 0, matchedSteps: 0,
    cursor: null, nextCursor: null, prevCursor: null, startIndex: 0,
    steps: [],
    summary: { cumulativeDeltaDiff: 0, aMoreDegraded: false, bMoreDegraded: false, identical: false },
  });

  // Accept either a pre-built diff or { historyA, historyB }
  let diff = diffOrHistories;
  if (diff && !Array.isArray(diff.steps) && diff.historyA && diff.historyB) {
    diff = AHD381.diffAggregatorHistories381(diff.historyA, diff.historyB, {
      includeMatched: o.includeMatched !== false,
    });
  }

  if (!diff || !diff.ok) {
    return errorResult((diff && diff.error) || 'diff must be a valid diffAggregatorHistories381 result');
  }
  if (!Array.isArray(diff.steps)) {
    return errorResult('diff.steps must be an array');
  }

  const allSteps = diff.steps;
  const total    = allSteps.length;

  // Resolve start index from cursor
  let startIndex  = 0;
  let cursorToken = o.cursor || null;
  if (cursorToken) {
    const decoded = decodeAggDiffCursor382(cursorToken);
    if (decoded !== null) startIndex = Math.min(decoded.stepIndex, total);
    else cursorToken = null;
  }

  const page    = allSteps.slice(startIndex, startIndex + limit);
  const endIdx  = startIndex + page.length;
  const hasMore = endIdx < total;
  const hasPrev = startIndex > 0;

  const nextCursor = hasMore
    ? encodeAggDiffCursor382(endIdx, page.length > 0 ? (page[page.length - 1].fromTsA || null) : null)
    : null;
  const prevCursor = hasPrev
    ? encodeAggDiffCursor382(Math.max(0, startIndex - limit), null)
    : null;

  return {
    ok:           true,
    schema:       AGG_DIFF_PAGINATOR_SCHEMA_382,
    version:      AGG_DIFF_PAGINATOR_VERSION_382,
    totalSteps:   total,
    divergedSteps: diff.divergedSteps,
    matchedSteps:  diff.matchedSteps,
    cursor:       cursorToken,
    nextCursor,
    prevCursor,
    startIndex,
    steps:        page,
    summary:      diff.summary,
  };
}

module.exports = {
  AGG_DIFF_PAGINATOR_VERSION_382,
  AGG_DIFF_PAGINATOR_SCHEMA_382,
  DEFAULT_AGG_DIFF_PAGE_LIMIT_382,
  encodeAggDiffCursor382,
  decodeAggDiffCursor382,
  paginateAggregatorHistoryDiff382,
};
