'use strict';
  /**
   * lib/comparatorHistoryCursor380.js — ECOS V380 (Phase P268)
   *
   * DIRECTION 3: Paginator cursor.
   *
   * cursorPaginateComparatorHistory380(history, opts) supports opaque cursor
   * tokens instead of numeric offsets, enabling stable pagination even when
   * the underlying steps array changes between calls.
   *
   * Cursor format: base64-encoded JSON { stepIndex, ts }
   *
   * Exports:
   *   CURSOR_VERSION_380
   *   CURSOR_SCHEMA_380
   *   DEFAULT_CURSOR_PAGE_LIMIT_380
   *   encodeCursor380(stepIndex, ts)   — build an opaque cursor
   *   decodeCursor380(token)           — parse a cursor; null on invalid
   *   cursorPaginateComparatorHistory380(history, opts)
   *     — returns { ok, schema, version, totalSteps, nextCursor, prevCursor,
   *         steps, cumulativeTotals }
   *
   * Endpoint: POST /api/v1/missions/proof-index/snapshot/compare/history/cursor [V380-T03]
   *
   * Pure (R3 no new npm deps). All new identifiers end with 380 (R2).
   * Sacred untouched (R1). V361..V379 preserved (R6).
   *
   * @version 380.0.0
   */

  const HIST = require('./comparatorHistory378.js');

  const CURSOR_VERSION_380        = '380.0.0';
  const CURSOR_SCHEMA_380         = 'ecos.integrity.mission.proof.index.comparator.history.cursor/v380';
  const DEFAULT_CURSOR_PAGE_LIMIT_380 = 20;

  /**
   * Encode a cursor token from a step index and optional timestamp.
   * @param {number} stepIndex
   * @param {string|null} [ts]
   * @returns {string}
   */
  function encodeCursor380(stepIndex, ts) {
    return Buffer.from(JSON.stringify({ v: 1, stepIndex: Math.floor(stepIndex), ts: ts || null }), 'utf8').toString('base64');
  }

  /**
   * Decode a cursor token. Returns null if the token is invalid.
   * @param {string} token
   * @returns {{ stepIndex: number, ts: string|null }|null}
   */
  function decodeCursor380(token) {
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
   * Cursor-paginate the steps array of a comparator history.
   *
   * @param {object|object[]} history
   *   — result of buildComparatorHistory378, OR an array of raw snapshots.
   * @param {{
   *   cursor?: string,
   *   limit?: number,
   * }} [opts]
   * @returns {{
   *   ok: boolean,
   *   schema: string,
   *   version: string,
   *   totalSteps: number,
   *   cursor: string|null,        // cursor used (start of this page)
   *   nextCursor: string|null,    // cursor for next page; null if last page
   *   prevCursor: string|null,    // cursor for previous page; null if first page
   *   steps: object[],
   *   cumulativeTotals: object,
   * }}
   */
  function cursorPaginateComparatorHistory380(history, opts) {
    const o     = opts || {};
    const limit = (typeof o.limit === 'number' && o.limit > 0) ? Math.floor(o.limit) : DEFAULT_CURSOR_PAGE_LIMIT_380;

    // Accept array of snaps or pre-built history
    let h = history;
    if (Array.isArray(history)) {
      h = HIST.buildComparatorHistory378(history, o);
      if (!h.ok) {
        return {
          ok: false, error: h.error || 'buildComparatorHistory378 failed',
          schema: CURSOR_SCHEMA_380, version: CURSOR_VERSION_380,
          totalSteps: 0, cursor: null, nextCursor: null, prevCursor: null,
          steps: [], cumulativeTotals: { totalAdded: 0, totalRemoved: 0, totalChanged: 0, identicalSteps: 0 },
        };
      }
    }

    if (!h || !Array.isArray(h.steps)) {
      return {
        ok: false, error: 'history must have a steps array or be an array of snapshots',
        schema: CURSOR_SCHEMA_380, version: CURSOR_VERSION_380,
        totalSteps: 0, cursor: null, nextCursor: null, prevCursor: null,
        steps: [], cumulativeTotals: { totalAdded: 0, totalRemoved: 0, totalChanged: 0, identicalSteps: 0 },
      };
    }

    const allSteps = h.steps;
    const total    = allSteps.length;

    // Resolve start index from cursor
    let startIndex = 0;
    let cursorToken = o.cursor || null;
    if (cursorToken) {
      const decoded = decodeCursor380(cursorToken);
      if (decoded !== null) startIndex = Math.min(decoded.stepIndex, total);
      else cursorToken = null; // invalid cursor — reset to start
    }

    const page    = allSteps.slice(startIndex, startIndex + limit);
    const endIdx  = startIndex + page.length;
    const hasMore = endIdx < total;
    const hasPrev = startIndex > 0;

    const nextCursor = hasMore ? encodeCursor380(endIdx, page.length > 0 ? page[page.length - 1].toTs : null) : null;
    const prevCursor = hasPrev
      ? encodeCursor380(Math.max(0, startIndex - limit), null)
      : null;

    let totalAdded = 0, totalRemoved = 0, totalChanged = 0, identicalSteps = 0;
    for (const step of page) {
      totalAdded   += (step.added   || []).length;
      totalRemoved += (step.removed || []).length;
      totalChanged += (step.changed || []).length;
      if (step.identical) identicalSteps++;
    }

    return {
      ok:         true,
      schema:     CURSOR_SCHEMA_380,
      version:    CURSOR_VERSION_380,
      totalSteps: total,
      cursor:     cursorToken,
      nextCursor,
      prevCursor,
      startIndex,
      steps:      page,
      cumulativeTotals: {
        totalAdded, totalRemoved, totalChanged, identicalSteps,
        overallTotalAdded:   (h.cumulativeTotals && h.cumulativeTotals.totalAdded)   || 0,
        overallTotalRemoved: (h.cumulativeTotals && h.cumulativeTotals.totalRemoved) || 0,
        overallTotalChanged: (h.cumulativeTotals && h.cumulativeTotals.totalChanged) || 0,
      },
    };
  }

  module.exports = {
    CURSOR_VERSION_380,
    CURSOR_SCHEMA_380,
    DEFAULT_CURSOR_PAGE_LIMIT_380,
    encodeCursor380,
    decodeCursor380,
    cursorPaginateComparatorHistory380,
  };
  