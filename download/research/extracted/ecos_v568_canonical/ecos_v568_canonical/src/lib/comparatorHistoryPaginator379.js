'use strict';
  /**
   * lib/comparatorHistoryPaginator379.js — ECOS V379 (Phase P267)
   *
   * DIRECTION 3: Comparator history pagination.
   *
   * `paginateComparatorHistory379(history, opts)` supports `limit`/`offset`
   * over the steps array returned by `buildComparatorHistory378`, enabling
   * operators to page through long multi-restart histories without loading
   * all diffs at once.
   *
   * Exports:
   *   PAGINATOR_VERSION_379           — '379.0.0'
   *   PAGINATOR_SCHEMA_379            — schema tag
   *   paginateComparatorHistory379(history, opts)
   *     — pure; returns { ok, schema, version, totalSteps, offset, limit,
   *         hasMore, steps, cumulativeTotals }
   *
   * Endpoint: POST /api/v1/missions/proof-index/snapshot/compare/history/page [V379-T03]
   *
   * Pure (R3 — no new npm deps). All new identifiers end with 379 (R2).
   * Sacred untouched (R1). V361..V378 preserved (R6).
   *
   * @version 379.0.0
   */

  const HIST = require('./comparatorHistory378.js');

  const PAGINATOR_VERSION_379 = '379.0.0';
  const PAGINATOR_SCHEMA_379  = 'ecos.integrity.mission.proof.index.comparator.history.page/v379';

  const DEFAULT_PAGE_LIMIT_379 = 20;

  /**
   * Paginate the steps array from a buildComparatorHistory378 result.
   *
   * @param {object} history  — result of buildComparatorHistory378, OR
   *                            an array of snapshots (will call buildComparatorHistory378 internally)
   * @param {{
   *   offset?: number,
   *   limit?: number,
   * }} [opts]
   * @returns {{
   *   ok: boolean,
   *   schema: string,
   *   version: string,
   *   totalSteps: number,
   *   offset: number,
   *   limit: number,
   *   hasMore: boolean,
   *   steps: object[],
   *   cumulativeTotals: object,
   * }}
   */
  function paginateComparatorHistory379(history, opts) {
    const o      = opts || {};
    const offset = (typeof o.offset === 'number' && o.offset >= 0) ? Math.floor(o.offset) : 0;
    const limit  = (typeof o.limit  === 'number' && o.limit  >  0) ? Math.floor(o.limit)  : DEFAULT_PAGE_LIMIT_379;

    // Accept either a pre-built history object or an array of snapshots
    let h = history;
    if (Array.isArray(history)) {
      h = HIST.buildComparatorHistory378(history, o);
      if (!h.ok) {
        return {
          ok:               false,
          error:            h.error || 'buildComparatorHistory378 failed',
          schema:           PAGINATOR_SCHEMA_379,
          version:          PAGINATOR_VERSION_379,
          totalSteps:       0,
          offset,
          limit,
          hasMore:          false,
          steps:            [],
          cumulativeTotals: { totalAdded: 0, totalRemoved: 0, totalChanged: 0, identicalSteps: 0 },
        };
      }
    }

    if (!h || !Array.isArray(h.steps)) {
      return {
        ok:               false,
        error:            'history must be a buildComparatorHistory378 result or an array of snapshots',
        schema:           PAGINATOR_SCHEMA_379,
        version:          PAGINATOR_VERSION_379,
        totalSteps:       0,
        offset,
        limit,
        hasMore:          false,
        steps:            [],
        cumulativeTotals: { totalAdded: 0, totalRemoved: 0, totalChanged: 0, identicalSteps: 0 },
      };
    }

    const allSteps   = h.steps;
    const totalSteps = allSteps.length;
    const page       = allSteps.slice(offset, offset + limit);
    const hasMore    = offset + limit < totalSteps;

    // Compute cumulative totals for the page slice only
    let totalAdded = 0, totalRemoved = 0, totalChanged = 0, identicalSteps = 0;
    for (const step of page) {
      totalAdded   += (step.added   || []).length;
      totalRemoved += (step.removed || []).length;
      totalChanged += (step.changed || []).length;
      if (step.identical) identicalSteps++;
    }

    return {
      ok:          true,
      schema:      PAGINATOR_SCHEMA_379,
      version:     PAGINATOR_VERSION_379,
      totalSteps,
      offset,
      limit,
      hasMore,
      steps:       page,
      cumulativeTotals: {
        totalAdded,
        totalRemoved,
        totalChanged,
        identicalSteps,
        // Also expose overall from original history
        overallTotalAdded:   (h.cumulativeTotals && h.cumulativeTotals.totalAdded)   || 0,
        overallTotalRemoved: (h.cumulativeTotals && h.cumulativeTotals.totalRemoved) || 0,
        overallTotalChanged: (h.cumulativeTotals && h.cumulativeTotals.totalChanged) || 0,
      },
    };
  }

  module.exports = {
    PAGINATOR_VERSION_379,
    PAGINATOR_SCHEMA_379,
    DEFAULT_PAGE_LIMIT_379,
    paginateComparatorHistory379,
  };
  