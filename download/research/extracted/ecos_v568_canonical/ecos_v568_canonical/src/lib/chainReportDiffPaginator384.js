'use strict';
/**
 * lib/chainReportDiffPaginator384.js — ECOS V384 (Phase P272)
 *
 * DIRECTION 2: Chain report diff pagination.
 *
 * paginateChainReportDiff384(diff, opts) provides cursor-based pagination over
 * the `steps` array of a diffKeyRotationChainReports383 result, mirroring the
 * V382 aggregator diff paginator pattern for the chain-report-diff surface.
 *
 * Exports:
 *   CHAIN_REPORT_DIFF_PAGINATOR_VERSION_384
 *   CHAIN_REPORT_DIFF_PAGINATOR_SCHEMA_384
 *   DEFAULT_CHAIN_DIFF_PAGE_LIMIT_384
 *   encodeChainDiffCursor384(stepIndex, ts)
 *   decodeChainDiffCursor384(token)
 *   paginateChainReportDiff384(diff, opts)
 *     — returns { ok, schema, version, totalSteps, changedSteps,
 *         cursor, nextCursor, prevCursor, startIndex, steps, summary }
 *
 * Endpoint: POST /api/v1/missions/proof-index/snapshot/key-rotation/manifest/chain/report/diff/page [V384-T02]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 384 (R2).
 * Sacred untouched (R1). V361..V383 preserved (R6).
 *
 * @version 384.0.0
 */

const CRD383 = require('./keyRotationChainReportDiff383.js');

const CHAIN_REPORT_DIFF_PAGINATOR_VERSION_384 = '384.0.0';
const CHAIN_REPORT_DIFF_PAGINATOR_SCHEMA_384  = 'ecos.integrity.mission.proof.index.snapshot.signing.key.rotation.chain.report.diff.paginator/v384';
const DEFAULT_CHAIN_DIFF_PAGE_LIMIT_384       = 20;

/**
 * Encode an opaque cursor token for the chain report diff paginator.
 * @param {number} stepIndex
 * @param {string|null} [ts]
 * @returns {string}
 */
function encodeChainDiffCursor384(stepIndex, ts) {
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
function decodeChainDiffCursor384(token) {
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
 * diffKeyRotationChainReports383 result.
 *
 * @param {object|{ reportA: object, reportB: object }} diffOrReports
 *   — a pre-built diff result from diffKeyRotationChainReports383(), OR
 *     an object with reportA and reportB to build the diff on-demand.
 * @param {{
 *   cursor?: string,
 *   limit?: number,
 *   includeUnchanged?: boolean,
 * }} [opts]
 * @returns {{
 *   ok: boolean,
 *   schema: string,
 *   version: string,
 *   totalSteps: number,
 *   changedSteps: number,
 *   unchangedSteps: number,
 *   cursor: string|null,
 *   nextCursor: string|null,
 *   prevCursor: string|null,
 *   startIndex: number,
 *   steps: Array<object>,
 *   summary: object,
 * }}
 */
function paginateChainReportDiff384(diffOrReports, opts) {
  const o = opts || {};
  const limit = (typeof o.limit === 'number' && o.limit > 0)
    ? Math.floor(o.limit)
    : DEFAULT_CHAIN_DIFF_PAGE_LIMIT_384;

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema: CHAIN_REPORT_DIFF_PAGINATOR_SCHEMA_384,
    version: CHAIN_REPORT_DIFF_PAGINATOR_VERSION_384,
    totalSteps: 0, changedSteps: 0, unchangedSteps: 0,
    cursor: null, nextCursor: null, prevCursor: null,
    startIndex: 0, steps: [], summary: {},
  });

  if (!diffOrReports) {
    return errorResult('diff or { reportA, reportB } is required');
  }

  // Resolve diff: accept pre-built or { reportA, reportB }
  let diff = diffOrReports;
  if (!Array.isArray(diff.steps) && diff.reportA && diff.reportB) {
    diff = CRD383.diffKeyRotationChainReports383(diff.reportA, diff.reportB, {
      includeUnchanged: o.includeUnchanged !== false,
    });
  }

  if (!diff || !diff.ok) {
    return errorResult((diff && diff.error) || 'diff must be a valid diffKeyRotationChainReports383 result');
  }

  if (!Array.isArray(diff.steps)) {
    return errorResult('diff.steps must be an array');
  }

  // Decode incoming cursor
  const incomingCursor = o.cursor || null;
  let startIndex = 0;

  if (incomingCursor) {
    const decoded = decodeChainDiffCursor384(incomingCursor);
    if (!decoded) {
      return errorResult('cursor token is not a valid V384 chain diff cursor');
    }
    startIndex = decoded.stepIndex;
  }

  const allSteps  = diff.steps;
  const totalSteps = diff.totalSteps != null ? diff.totalSteps : allSteps.length;

  // Slice the page
  const page       = allSteps.slice(startIndex, startIndex + limit);
  const endIndex   = startIndex + page.length;
  const hasNext    = endIndex < allSteps.length;
  const hasPrev    = startIndex > 0;
  const ts         = new Date().toISOString();

  const nextCursor = hasNext ? encodeChainDiffCursor384(endIndex, ts) : null;
  const prevCursor = hasPrev
    ? encodeChainDiffCursor384(Math.max(0, startIndex - limit), ts)
    : null;
  const currentCursor = encodeChainDiffCursor384(startIndex, ts);

  return {
    ok:            true,
    schema:        CHAIN_REPORT_DIFF_PAGINATOR_SCHEMA_384,
    version:       CHAIN_REPORT_DIFF_PAGINATOR_VERSION_384,
    totalSteps,
    changedSteps:  diff.changedSteps   != null ? diff.changedSteps   : 0,
    unchangedSteps: diff.unchangedSteps != null ? diff.unchangedSteps : 0,
    firstChangeStep: diff.firstChangeStep != null ? diff.firstChangeStep : null,
    cursor:        currentCursor,
    nextCursor,
    prevCursor,
    startIndex,
    pageSize:      page.length,
    steps:         page,
    summary:       diff.summary || {},
    narrative:     diff.narrative || '',
  };
}

module.exports = {
  CHAIN_REPORT_DIFF_PAGINATOR_VERSION_384,
  CHAIN_REPORT_DIFF_PAGINATOR_SCHEMA_384,
  DEFAULT_CHAIN_DIFF_PAGE_LIMIT_384,
  encodeChainDiffCursor384,
  decodeChainDiffCursor384,
  paginateChainReportDiff384,
};
