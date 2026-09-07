'use strict';
/**
 * lib/marketMaker316.js — ECOS V316 (Phase P204) — Cap History Cursor,
 *                          Page Range Summary, Overlap Explainability,
 *                          Norm Delta Classification
 *
 * Four additive components that extend the V315 observability layer:
 *
 *   1. AuditCapTrail316 — auditCapHistoryCursor316(cursor, limit)
 *      returns entries starting after the given cursor (timestamp or index).
 *
 *   2. PageRangeDiffBridge316 — pagedDiffPageRangeSummary316(...)
 *      returns aggregate range stats: nonEmptyPages, emptyPages, max/mean entry count.
 *
 *   3. RankedOverlapBuffer316 — multiSearchOverlapTopExplain316(tokens[], n)
 *      returns top-N entries with an explanation payload (matched tokens, ratio).
 *
 *   4. NormDeltaPercentilesTracker316 — trendNormDeltaClassified316(...)
 *      adds threshold labels (stable, elevated, spike) to each bucket.
 *
 * Sacred files untouched (R1). All new identifiers end in `316` (R2).
 * Zero new npm deps (R3). V287..V315 surfaces preserved (R6).
 * lib/ mirrors src/lib/. package.json bumped to 316.0.0.
 *
 * @version 316.0.0
 */

const V315 = require('./marketMaker315.js');
const V314 = require('./marketMaker314.js');

const MM_VERSION_316 = '316.0.0';

function _coercePositiveInt316(value, fallback316) {
  const n316 = Number(value);
  if (!Number.isFinite(n316) || !Number.isInteger(n316) || n316 < 1) return fallback316;
  return n316;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail316
//    Extends AuditCapTrail315 with cursor-based pagination.
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail316 extends V315.AuditCapTrail315 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * auditCapHistoryCursor316(cursor, limit) — returns entries starting after the
   * given cursor (matching changedAt timestamp).
   *
   * @param {string|number} [cursor] — timestamp to start after
   * @param {number} [limit] — max entries, defaults to 20, max 200
   * @returns {{ ok, entries, nextCursor, hasNextPage, version }}
   */
  auditCapHistoryCursor316(cursor, limit) {
    const base316 = this.auditCapHistory314();
    if (!base316.ok) {
      return Object.assign({}, base316, { version: MM_VERSION_316 });
    }

    const lim316 = Math.min(_coercePositiveInt316(limit, 20), 200);
    const all316 = Array.isArray(base316.entries) ? base316.entries : [];
    
    let startIndex316 = 0;
    if (cursor) {
      const idx316 = all316.findIndex(e => e.changedAt === cursor);
      if (idx316 !== -1) startIndex316 = idx316 + 1;
    }

    const entries316 = all316.slice(startIndex316, startIndex316 + lim316);
    const nextCursor316 = entries316.length > 0 ? entries316[entries316.length - 1].changedAt : null;
    const hasNext316 = (startIndex316 + lim316) < all316.length;

    return {
      ok:          true,
      entries:     entries316,
      nextCursor:  nextCursor316,
      hasNextPage: hasNext316,
      version:     MM_VERSION_316,
    };
  }

  stats() {
    const base316 = super.stats();
    return Object.assign({}, base316, { version: MM_VERSION_316 });
  }
}

let _defaultAuditCapTrail316 = null;
function defaultAuditCapTrail316(opts) {
  if (!_defaultAuditCapTrail316 || opts) {
    _defaultAuditCapTrail316 = new AuditCapTrail316(opts || {});
  }
  return _defaultAuditCapTrail316;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge316
//    Extends PageRangeDiffBridge315 with range-level summary stats.
// ─────────────────────────────────────────────────────────────────────────────

class PageRangeDiffBridge316 extends V315.PageRangeDiffBridge315 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * pagedDiffPageRangeSummary316(from, to, startPage, endPage, pageSize)
   * returns V315 stats plus aggregate summary.
   *
   * @returns {{ ok, ..., summary: { nonEmptyPages, emptyPages, maxPageEntryCount, meanPageEntryCount }, version }}
   */
  pagedDiffPageRangeSummary316(from, to, startPage, endPage, pageSize) {
    const base316 = this.pagedDiffPageRangeStats315(from, to, startPage, endPage, pageSize);
    if (!base316.ok) {
      return Object.assign({}, base316, { version: MM_VERSION_316 });
    }

    const perPage316 = Array.isArray(base316.perPage) ? base316.perPage : [];
    const counts316 = perPage316.map(p => p.entryCount);
    
    const nonEmpty316 = counts316.filter(c => c > 0).length;
    const empty316    = counts316.length - nonEmpty316;
    const max316      = counts316.length > 0 ? Math.max(...counts316) : 0;
    const mean316     = counts316.length > 0 ? counts316.reduce((a, b) => a + b, 0) / counts316.length : 0;

    return Object.assign({}, base316, {
      summary: {
        nonEmptyPages:      nonEmpty316,
        emptyPages:         empty316,
        maxPageEntryCount:  max316,
        meanPageEntryCount: mean316,
      },
      version: MM_VERSION_316,
    });
  }

  stats() {
    const base316 = super.stats();
    return Object.assign({}, base316, { version: MM_VERSION_316 });
  }
}

let _defaultPageRangeDiffBridge316 = null;
function defaultPageRangeDiffBridge316(opts) {
  if (!_defaultPageRangeDiffBridge316 || opts) {
    _defaultPageRangeDiffBridge316 = new PageRangeDiffBridge316(opts || {});
  }
  return _defaultPageRangeDiffBridge316;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer316
//    Extends RankedOverlapBuffer315 with match explainability.
// ─────────────────────────────────────────────────────────────────────────────

class RankedOverlapBuffer316 extends V315.RankedOverlapBuffer315 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * multiSearchOverlapTopExplain316(tokens, n) — returns top-N entries with
   * an explanation of which tokens matched and the match ratio.
   *
   * @param {string[]} tokens
   * @param {number} [n]
   * @returns {{ ok, sharedSnapshots, version }}
   */
  multiSearchOverlapTopExplain316(tokens, n) {
    const base316 = this.multiSearchOverlapTopN315(tokens, n);
    if (!base316.ok) {
      return Object.assign({}, base316, { version: MM_VERSION_316 });
    }

    const reqTokens316 = Array.isArray(tokens) ? tokens.map(String) : [];
    const totalReq316  = reqTokens316.length;

    const explained316 = base316.sharedSnapshots.map(snap316 => {
      const snapTokens316 = Array.isArray(snap316.tokens) ? snap316.tokens : [];
      const matched316    = reqTokens316.filter(t => snapTokens316.includes(t));
      
      return Object.assign({}, snap316, {
        explanation: {
          matchedTokens: matched316,
          matchRatio:    totalReq316 > 0 ? matched316.length / totalReq316 : 0,
        }
      });
    });

    return Object.assign({}, base316, {
      sharedSnapshots: explained316,
      version:         MM_VERSION_316,
    });
  }

  stats() {
    const base316 = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base316, { version: MM_VERSION_316 });
  }
}

let _defaultRankedOverlapBuffer316 = null;
function defaultRankedOverlapBuffer316(opts) {
  if (!_defaultRankedOverlapBuffer316 || opts) {
    _defaultRankedOverlapBuffer316 = new RankedOverlapBuffer316(opts || {});
  }
  return _defaultRankedOverlapBuffer316;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker316
//    Extends NormDeltaPercentilesTracker315 with threshold classification.
// ─────────────────────────────────────────────────────────────────────────────

class NormDeltaPercentilesTracker316 extends V315.NormDeltaPercentilesTracker315 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * trendNormDeltaClassified316(source, windowMs, buckets, baseline, thresholds)
   * returns V315 stats plus classification labels per bucket.
   *
   * @param {object} [thresholds] — { elevated: number, spike: number }
   * @returns {{ ok, cumulativeDeltas, version }}
   */
  trendNormDeltaClassified316(source, windowMs, buckets, baseline, thresholds) {
    const base316 = this.trendNormDeltaStats315(source, windowMs, buckets, baseline);
    if (!base316.ok) {
      return Object.assign({}, base316, { version: MM_VERSION_316 });
    }

    const thres316 = thresholds || { elevated: 1.5, spike: 3.0 };
    const classified316 = (base316.cumulativeDeltas || []).map(entry316 => {
      if (!entry316 || entry316.normDelta === null || entry316.normDelta === undefined) {
        return Object.assign({}, entry316, { classification: 'unknown' });
      }
      
      let label316 = 'stable';
      if (entry316.normDelta >= thres316.spike) label316 = 'spike';
      else if (entry316.normDelta >= thres316.elevated) label316 = 'elevated';
      
      return Object.assign({}, entry316, { classification: label316 });
    });

    return Object.assign({}, base316, {
      cumulativeDeltas: classified316,
      thresholdsUsed:   thres316,
      version:          MM_VERSION_316,
    });
  }

  stats() {
    const base316 = super.stats();
    return Object.assign({}, base316, { version: MM_VERSION_316 });
  }
}

let _defaultNormDeltaPercentilesTracker316 = null;
function defaultNormDeltaPercentilesTracker316(opts) {
  if (!_defaultNormDeltaPercentilesTracker316 || opts) {
    _defaultNormDeltaPercentilesTracker316 = new NormDeltaPercentilesTracker316(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker316;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

function registerV316Endpoints(app) {
  const trail316   = defaultAuditCapTrail316();
  const bridge316  = defaultPageRangeDiffBridge316();
  const buffer316  = defaultRankedOverlapBuffer316();
  const tracker316 = defaultNormDeltaPercentilesTracker316();

  // 1. GET audit cap history cursor
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v316/aggregate/db/hydrate/audit/cap/history/cursor',
    (req, res) => {
      try {
        const cursor316 = req.query.cursor;
        const limit316  = req.query.limit ? Number(req.query.limit) : 20;
        res.json(trail316.auditCapHistoryCursor316(cursor316, limit316));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_316 });
      }
    }
  );

  // 2. GET diff audit page range summary
  app.get(
    '/api/v1/market/alerts/suppress/config/v316/diff/audit/filter/paged/range/summary',
    (req, res) => {
      try {
        const from316      = Number(req.query.from);
        const to316        = Number(req.query.to);
        const startPage316 = req.query.startPage ? Number(req.query.startPage) : 1;
        const endPage316   = req.query.endPage   ? Number(req.query.endPage)   : startPage316;
        const pageSize316  = req.query.pageSize  ? Number(req.query.pageSize)  : 20;
        res.json(bridge316.pagedDiffPageRangeSummary316(from316, to316, startPage316, endPage316, pageSize316));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_316 });
      }
    }
  );

  // 3. POST token overlap top-explain
  app.post(
    '/api/v1/market/backtest/sessions/v316/snapshot/search/ranked/multi/overlap/explain',
    (req, res) => {
      try {
        const tokens316 = req.body ? req.body.tokens : undefined;
        const n316      = req.query.n ? Number(req.query.n) : undefined;
        res.json(buffer316.multiSearchOverlapTopExplain316(tokens316, n316));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_316 });
      }
    }
  );

  // 4. GET cumulative delta classified
  app.get(
    '/api/v1/contracts/receipts/v316/histogram/rolling/percentiles/trend/delta/cumulative/norm/classified',
    (req, res) => {
      try {
        const source316   = req.query.source   || '';
        const windowMs316 = req.query.windowMs ? Number(req.query.windowMs) : 60000;
        const buckets316  = req.query.buckets  ? Number(req.query.buckets)  : 5;
        const baseline316 = req.query.baseline !== undefined ? Number(req.query.baseline) : 0;
        const elevated316 = req.query.elevated ? Number(req.query.elevated) : 1.5;
        const spike316    = req.query.spike    ? Number(req.query.spike)    : 3.0;
        res.json(tracker316.trendNormDeltaClassified316(source316, windowMs316, buckets316, baseline316, { elevated: elevated316, spike: spike316 }));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_316 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_316,
  _coercePositiveInt316,
  AuditCapTrail316,
  defaultAuditCapTrail316,
  PageRangeDiffBridge316,
  defaultPageRangeDiffBridge316,
  RankedOverlapBuffer316,
  defaultRankedOverlapBuffer316,
  NormDeltaPercentilesTracker316,
  defaultNormDeltaPercentilesTracker316,
  registerV316Endpoints,
};
