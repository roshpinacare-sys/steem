'use strict';
/**
 * lib/marketMaker315.js — ECOS V315 (Phase P203) — Audit Cap Pagination,
 *                          Diff Page Range Stats, Overlap Top-N,
 *                          Normalised Delta Statistics
 *
 * Four additive components that extend the V314 observability layer:
 *
 *   1. AuditCapTrail315 — auditCapHistoryPaged315(page, pageSize)
 *      returns paginated cap-history entries with totalCount, totalPages, hasNextPage.
 *
 *   2. PageRangeDiffBridge315 — pagedDiffPageRangeStats315(fromVersion, toVersion,
 *      startPage, endPage, pageSize) returns the V314 range result plus perPage
 *      [{ page, entryCount }] breakdown.
 *
 *   3. RankedOverlapBuffer315 — multiSearchOverlapTopN315(tokens[], n)
 *      returns only the top-N ranked overlap entries, with n defaulting to 10 and
 *      clamped to a minimum of 1.
 *
 *   4. NormDeltaPercentilesTracker315 — trendNormDeltaStats315(source, windowMs,
 *      buckets, baselineBucket) returns V314 normalised cumulative deltas plus
 *      global stats across non-null normDelta values.
 *
 * Sacred files untouched (R1). All new identifiers end in `315` (R2).
 * Zero new npm deps (R3). V287..V314 surfaces preserved (R6).
 * lib/ mirrors src/lib/. package.json bumped to 315.0.0.
 *
 * @version 315.0.0
 */

const V314 = require('./marketMaker314.js');
const V313 = require('./marketMaker313.js');

const MM_VERSION_315 = '315.0.0';

function _coercePositiveInt315(value, fallback315) {
  const n315 = Number(value);
  if (!Number.isFinite(n315) || !Number.isInteger(n315) || n315 < 1) return fallback315;
  return n315;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail315
//    Extends AuditCapTrail314 with paginated cap-history access.
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail315 extends V314.AuditCapTrail314 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * auditCapHistoryPaged315(page, pageSize) — returns a paginated slice of the
   * V314 cap-history ring.
   *
   * @param {number} [page] — 1-based page number, defaults to 1
   * @param {number} [pageSize] — entries per page, defaults to 20, max 200
   * @returns {{ ok, page, pageSize, entries, count, totalCount, totalPages, hasNextPage, version }}
   */
  auditCapHistoryPaged315(page, pageSize) {
    const base315 = this.auditCapHistory314();
    if (!base315.ok) {
      return Object.assign({}, base315, { version: MM_VERSION_315 });
    }

    const p315  = _coercePositiveInt315(page, 1);
    const ps315 = Math.min(_coercePositiveInt315(pageSize, 20), 200);
    const entries315 = Array.isArray(base315.entries) ? base315.entries.slice() : [];
    const totalCount315 = entries315.length;
    const totalPages315 = totalCount315 === 0 ? 0 : Math.ceil(totalCount315 / ps315);
    const start315 = (p315 - 1) * ps315;
    const pageEntries315 = entries315.slice(start315, start315 + ps315);

    return {
      ok:          true,
      page:        p315,
      pageSize:    ps315,
      entries:     pageEntries315,
      count:       pageEntries315.length,
      totalCount:  totalCount315,
      totalPages:  totalPages315,
      hasNextPage: p315 < totalPages315,
      version:     MM_VERSION_315,
    };
  }

  stats() {
    const base315 = super.stats();
    return Object.assign({}, base315, { version: MM_VERSION_315 });
  }
}

let _defaultAuditCapTrail315 = null;
function defaultAuditCapTrail315(opts) {
  if (!_defaultAuditCapTrail315 || opts) {
    _defaultAuditCapTrail315 = new AuditCapTrail315(opts || {});
  }
  return _defaultAuditCapTrail315;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge315
//    Extends PageRangeDiffBridge314 with per-page entry-count stats.
// ─────────────────────────────────────────────────────────────────────────────

class PageRangeDiffBridge315 extends V314.PageRangeDiffBridge314 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * pagedDiffPageRangeStats315(fromVersion, toVersion, startPage, endPage, pageSize)
   * returns the V314 page-range response plus a perPage array with entry counts.
   *
   * @returns {{ ok, fromVersion, toVersion, startPage, endPage, pageSize, totalCount, totalPages, entries, perPage, version }}
   */
  pagedDiffPageRangeStats315(fromVersion, toVersion, startPage, endPage, pageSize) {
    const ps315 = Math.min(_coercePositiveInt315(pageSize, 20), 200);
    const sp315 = _coercePositiveInt315(startPage, 1);
    const ep315 = endPage === undefined || endPage === null ? sp315 : Number(endPage);

    const base315 = this.pagedDiffPageRange314(fromVersion, toVersion, sp315, ep315, ps315);
    if (!base315.ok) {
      return Object.assign({}, base315, { perPage: [], version: MM_VERSION_315 });
    }

    const perPage315 = [];
    if (base315.endPage >= base315.startPage) {
      for (let page315 = base315.startPage; page315 <= base315.endPage; page315++) {
        const result315 = this.pagedDiffWithMeta312(fromVersion, toVersion, page315, base315.pageSize);
        const entryCount315 = result315 && result315.ok && Array.isArray(result315.entries)
          ? result315.entries.length
          : 0;
        perPage315.push({ page: page315, entryCount: entryCount315 });
      }
    }

    return Object.assign({}, base315, {
      perPage: perPage315,
      version: MM_VERSION_315,
    });
  }

  stats() {
    const base315 = super.stats();
    return Object.assign({}, base315, { version: MM_VERSION_315 });
  }
}

let _defaultPageRangeDiffBridge315 = null;
function defaultPageRangeDiffBridge315(opts) {
  if (!_defaultPageRangeDiffBridge315 || opts) {
    _defaultPageRangeDiffBridge315 = new PageRangeDiffBridge315(opts || {});
  }
  return _defaultPageRangeDiffBridge315;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer315
//    Extends RankedOverlapBuffer314 with top-N slicing.
// ─────────────────────────────────────────────────────────────────────────────

class RankedOverlapBuffer315 extends V314.RankedOverlapBuffer314 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * multiSearchOverlapTopN315(tokens, n) — returns only the first N ranked overlap
   * results. n defaults to 10 and is clamped to a minimum of 1.
   *
   * @param {string[]} tokens
   * @param {number} [n]
   * @returns {{ ok, sharedSnapshots, n, totalCount, version }}
   */
  multiSearchOverlapTopN315(tokens, n) {
    const base315 = this.multiSearchOverlapRanked314(tokens);
    if (!base315.ok) {
      return Object.assign({}, base315, { version: MM_VERSION_315 });
    }

    const limit315 = _coercePositiveInt315(n, 10);
    const ranked315 = Array.isArray(base315.sharedSnapshots) ? base315.sharedSnapshots.slice() : [];
    const top315 = ranked315.slice(0, limit315);

    return {
      ok:              true,
      sharedSnapshots: top315,
      n:               limit315,
      totalCount:      ranked315.length,
      version:         MM_VERSION_315,
    };
  }

  stats() {
    const base315 = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base315, { version: MM_VERSION_315 });
  }
}

let _defaultRankedOverlapBuffer315 = null;
function defaultRankedOverlapBuffer315(opts) {
  if (!_defaultRankedOverlapBuffer315 || opts) {
    _defaultRankedOverlapBuffer315 = new RankedOverlapBuffer315(opts || {});
  }
  return _defaultRankedOverlapBuffer315;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker315
//    Extends NormDeltaPercentilesTracker314 with global normDelta statistics.
// ─────────────────────────────────────────────────────────────────────────────

class NormDeltaPercentilesTracker315 extends V314.NormDeltaPercentilesTracker314 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * trendNormDeltaStats315(source, windowMs, buckets, baselineBucket) — returns
   * V314 normalised trend output and stats across all non-null normDelta values.
   *
   * @returns {{ ok, cumulativeDeltas, normDeltaStats: { minNorm, maxNorm, meanNorm, rangeNorm }, version }}
   */
  trendNormDeltaStats315(source, windowMs, buckets, baselineBucket) {
    const base315 = this.trendCumulativeDeltaNorm314(source, windowMs, buckets, baselineBucket);
    if (!base315.ok) {
      return Object.assign({}, base315, { version: MM_VERSION_315 });
    }

    const values315 = (Array.isArray(base315.cumulativeDeltas) ? base315.cumulativeDeltas : [])
      .map(entry315 => entry315 ? entry315.normDelta : null)
      .filter(value315 => value315 !== null && value315 !== undefined && Number.isFinite(value315));

    let minNorm315 = null;
    let maxNorm315 = null;
    let meanNorm315 = null;
    let rangeNorm315 = null;

    if (values315.length > 0) {
      minNorm315 = Math.min(...values315);
      maxNorm315 = Math.max(...values315);
      meanNorm315 = values315.reduce((sum315, value315) => sum315 + value315, 0) / values315.length;
      rangeNorm315 = maxNorm315 - minNorm315;
    }

    return Object.assign({}, base315, {
      normDeltaStats: {
        minNorm:   minNorm315,
        maxNorm:   maxNorm315,
        meanNorm:  meanNorm315,
        rangeNorm: rangeNorm315,
      },
      version: MM_VERSION_315,
    });
  }

  stats() {
    const base315 = super.stats();
    return Object.assign({}, base315, { version: MM_VERSION_315 });
  }
}

let _defaultNormDeltaPercentilesTracker315 = null;
function defaultNormDeltaPercentilesTracker315(opts) {
  if (!_defaultNormDeltaPercentilesTracker315 || opts) {
    _defaultNormDeltaPercentilesTracker315 = new NormDeltaPercentilesTracker315(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker315;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

function registerV315Endpoints(app) {
  const trail315   = defaultAuditCapTrail315();
  const bridge315  = defaultPageRangeDiffBridge315();
  const buffer315  = defaultRankedOverlapBuffer315();
  const tracker315 = defaultNormDeltaPercentilesTracker315();

  // 1. GET audit cap history paged
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v315/aggregate/db/hydrate/audit/cap/history/paged',
    (req, res) => {
      try {
        const page315     = req.query.page     ? Number(req.query.page)     : 1;
        const pageSize315 = req.query.pageSize ? Number(req.query.pageSize) : 20;
        res.json(trail315.auditCapHistoryPaged315(page315, pageSize315));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_315 });
      }
    }
  );

  // 2. GET diff audit page range stats
  app.get(
    '/api/v1/market/alerts/suppress/config/v315/diff/audit/filter/paged/range/stats',
    (req, res) => {
      try {
        const from315      = Number(req.query.from);
        const to315        = Number(req.query.to);
        const startPage315 = req.query.startPage ? Number(req.query.startPage) : 1;
        const endPage315   = req.query.endPage   ? Number(req.query.endPage)   : startPage315;
        const pageSize315  = req.query.pageSize  ? Number(req.query.pageSize)  : 20;
        res.json(bridge315.pagedDiffPageRangeStats315(from315, to315, startPage315, endPage315, pageSize315));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_315 });
      }
    }
  );

  // 3. POST token overlap top-N
  app.post(
    '/api/v1/market/backtest/sessions/v315/snapshot/search/ranked/multi/overlap/top',
    (req, res) => {
      try {
        const tokens315 = req.body ? req.body.tokens : undefined;
        const n315 = req.query.n ? Number(req.query.n) : undefined;
        res.json(buffer315.multiSearchOverlapTopN315(tokens315, n315));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_315 });
      }
    }
  );

  // 4. GET cumulative delta normalised stats
  app.get(
    '/api/v1/contracts/receipts/v315/histogram/rolling/percentiles/trend/delta/cumulative/norm/stats',
    (req, res) => {
      try {
        const source315         = req.query.source   || '';
        const windowMs315       = req.query.windowMs ? Number(req.query.windowMs) : 60000;
        const buckets315        = req.query.buckets  ? Number(req.query.buckets)  : 5;
        const baselineBucket315 = req.query.baseline !== undefined ? Number(req.query.baseline) : 0;
        res.json(tracker315.trendNormDeltaStats315(source315, windowMs315, buckets315, baselineBucket315));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_315 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_315,
  _coercePositiveInt315,
  // 1. Audit cap history pagination
  AuditCapTrail315,
  defaultAuditCapTrail315,
  // 2. Diff audit page range stats
  PageRangeDiffBridge315,
  defaultPageRangeDiffBridge315,
  // 3. Token overlap top-N
  RankedOverlapBuffer315,
  defaultRankedOverlapBuffer315,
  // 4. Cumulative delta normalised stats
  NormDeltaPercentilesTracker315,
  defaultNormDeltaPercentilesTracker315,
  // Endpoint registration
  registerV315Endpoints,
};
