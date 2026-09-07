'use strict';
/**
 * lib/alertHistoryDiffPaginator386.js — ECOS V386 (Phase P274)
 *
 * DIRECTION 4: Alert history diff pagination.
 *
 * paginateAlertHistoryDiff386(diff, opts) provides cursor-based pagination
 * over the `steps` array of a diffAutoHealRateAlertHistories385 result,
 * mirroring the V384 paginateChainReportDiff384 pattern for the
 * alert-history-diff surface.
 *
 * Exports:
 *   ALERT_HISTORY_DIFF_PAGINATOR_VERSION_386
 *   ALERT_HISTORY_DIFF_PAGINATOR_SCHEMA_386
 *   DEFAULT_ALERT_DIFF_PAGE_LIMIT_386
 *   encodeAlertDiffCursor386(stepIndex, ts)
 *   decodeAlertDiffCursor386(token)
 *   paginateAlertHistoryDiff386(diff, opts)
 *     — returns { ok, schema, version, totalSteps, onlyInA, onlyInB, inBoth,
 *         cursor, nextCursor, prevCursor, startIndex, steps, summary }
 *
 * Endpoint: POST /api/v1/integrity/auto-heal/quota/reset/rate/alert/history/diff/page [V386-T04]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 386 (R2).
 * Sacred untouched (R1). V361..V385 preserved (R6).
 *
 * @version 386.0.0
 */

const AHD385 = require('./autoHealRateAlertHistoryDiff385.js');

const ALERT_HISTORY_DIFF_PAGINATOR_VERSION_386 = '386.0.0';
const ALERT_HISTORY_DIFF_PAGINATOR_SCHEMA_386  =
  'ecos.integrity.cross_chain.auto_heal.quota.reset.rate.alert.history.diff.paginator/v386';
const DEFAULT_ALERT_DIFF_PAGE_LIMIT_386 = 20;

/**
 * Encode an opaque cursor token for the alert history diff paginator.
 * @param {number} stepIndex
 * @param {string|null} [ts]
 * @returns {string}
 */
function encodeAlertDiffCursor386(stepIndex, ts) {
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
function decodeAlertDiffCursor386(token) {
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
 * diffAutoHealRateAlertHistories385 result.
 *
 * @param {object|{ histA: object, histB: object }} diffOrHistories
 *   — a pre-built diff result from diffAutoHealRateAlertHistories385(), OR
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
function paginateAlertHistoryDiff386(diffOrHistories, opts) {
  const o = opts || {};
  const limit = (typeof o.limit === 'number' && o.limit > 0)
    ? Math.floor(o.limit)
    : DEFAULT_ALERT_DIFF_PAGE_LIMIT_386;

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:      ALERT_HISTORY_DIFF_PAGINATOR_SCHEMA_386,
    version:     ALERT_HISTORY_DIFF_PAGINATOR_VERSION_386,
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
    diff = AHD385.diffAutoHealRateAlertHistories385(diff.histA, diff.histB, {
      includeInBoth: o.includeInBoth !== false,
    });
  }

  if (!diff || !diff.ok) {
    return errorResult((diff && diff.error) || 'diff must be a valid diffAutoHealRateAlertHistories385 result');
  }

  if (!Array.isArray(diff.steps)) {
    return errorResult('diff.steps must be an array');
  }

  // Decode incoming cursor
  const incomingCursor = o.cursor || null;
  let startIndex = 0;

  if (incomingCursor) {
    const decoded = decodeAlertDiffCursor386(incomingCursor);
    if (!decoded) {
      return errorResult('cursor token is not a valid V386 alert diff cursor');
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

  const nextCursor    = hasNext ? encodeAlertDiffCursor386(endIndex, ts) : null;
  const prevCursor    = hasPrev ? encodeAlertDiffCursor386(Math.max(0, startIndex - limit), ts) : null;
  const currentCursor = encodeAlertDiffCursor386(startIndex, ts);

  return {
    ok:          true,
    schema:      ALERT_HISTORY_DIFF_PAGINATOR_SCHEMA_386,
    version:     ALERT_HISTORY_DIFF_PAGINATOR_VERSION_386,
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
  ALERT_HISTORY_DIFF_PAGINATOR_VERSION_386,
  ALERT_HISTORY_DIFF_PAGINATOR_SCHEMA_386,
  DEFAULT_ALERT_DIFF_PAGE_LIMIT_386,
  encodeAlertDiffCursor386,
  decodeAlertDiffCursor386,
  paginateAlertHistoryDiff386,
};
