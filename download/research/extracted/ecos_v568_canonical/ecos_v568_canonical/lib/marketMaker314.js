'use strict';
/**
 * lib/marketMaker314.js — ECOS V314 (Phase P202) — Audit Cap History,
 *                          Diff Audit Page Range, Overlap Strength Ranking,
 *                          Baseline Delta Normalised
 *
 * Four additive components that extend the V313 observability layer:
 *
 *   1. AuditCapTrail314          — extends ConfigurableAuditTrail313 with
 *                                   auditCapHistory314() returning an ordered
 *                                   list of cap-change events (bounded ring, max 50).
 *                                   GET /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v314/aggregate/db/hydrate/audit/cap/history
 *
 *   2. PageRangeDiffBridge314    — extends PagedDiffBridge313 with
 *                                   pagedDiffPageRange314(fromVersion, toVersion, startPage, endPage, pageSize)
 *                                   returning concatenated entries from startPage..endPage inclusive.
 *                                   GET /api/v1/market/alerts/suppress/config/v314/diff/audit/filter/paged/range?from=&to=&startPage=&endPage=&pageSize=
 *
 *   3. RankedOverlapBuffer314    — extends StatsMultiRankedBuffer313 with
 *                                   multiSearchOverlapRanked314(tokens[]) returning
 *                                   sharedSnapshots sorted by matchCount descending.
 *                                   POST /api/v1/market/backtest/sessions/v314/snapshot/search/ranked/multi/overlap/ranked
 *
 *   4. NormDeltaPercentilesTracker314 — extends DeltaPercentilesTracker313 with
 *                                   trendCumulativeDeltaNorm314(source, windowMs, buckets, baselineBucket)
 *                                   returning normDelta = cumulativeP99Delta / referenceP99 per bucket.
 *                                   GET /api/v1/contracts/receipts/v314/histogram/rolling/percentiles/trend/delta/cumulative/norm?source=&windowMs=&buckets=&baseline=
 *
 * Sacred files untouched (R1). All new identifiers end in `314` (R2).
 * Zero new npm deps (R3). V287..V313 surfaces preserved (R6).
 * lib/ mirrors src/lib/ (R5). package.json bumped to 314.0.0.
 *
 * @version 314.0.0
 */

const V313 = require('./marketMaker313.js');
const V312 = require('./marketMaker312.js');
const V311 = require('./marketMaker311.js');
const V310 = require('./marketMaker310.js');
const V309 = require('./marketMaker309.js');
const V308 = require('./marketMaker308.js');
const V307 = require('./marketMaker307.js');
const V306 = require('./marketMaker306.js');
const V305 = require('./marketMaker305.js');

const MM_VERSION_314 = '314.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail314
//    Extends ConfigurableAuditTrail313 with auditCapHistory314() that returns
//    an ordered list of cap-change events (bounded ring, max 50 entries).
//    Each entry: { changedAt, cap, previousCap }
//    GET /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v314/aggregate/db/hydrate/audit/cap/history
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail314 extends V313.ConfigurableAuditTrail313 {
  constructor(opts = {}) {
    super(opts);
    this._capHistoryRing314 = [];  // bounded ring, max 50 entries
    this._capHistoryCap314  = 50;
  }

  /**
   * Override setAuditCap313 to record cap-change events in the history ring.
   *
   * @param {number} cap
   * @returns {{ ok: boolean, cap?: number, error?: string, version: string }}
   */
  setAuditCap313(cap) {
    const previousCap = this._hydrateAuditCap312;
    const result = super.setAuditCap313(cap);

    if (result.ok) {
      const entry = {
        changedAt:   new Date().toISOString(),
        cap:         result.cap,
        previousCap: previousCap,
      };
      this._capHistoryRing314.push(entry);
      // FIFO trim to max 50
      while (this._capHistoryRing314.length > this._capHistoryCap314) {
        this._capHistoryRing314.shift();
      }
    }

    return Object.assign({}, result, { version: MM_VERSION_314 });
  }

  /**
   * auditCapHistory314() — returns an ordered list of cap-change events.
   * Each entry: { changedAt, cap, previousCap }
   * Bounded ring, max 50 entries.
   *
   * @returns {{ ok: boolean, entries: Array, count: number, version: string }}
   */
  auditCapHistory314() {
    return {
      ok:      true,
      entries: this._capHistoryRing314.slice(),
      count:   this._capHistoryRing314.length,
      version: MM_VERSION_314,
    };
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_314 });
  }
}

let _defaultAuditCapTrail314 = null;
function defaultAuditCapTrail314(opts) {
  if (!_defaultAuditCapTrail314 || opts) {
    _defaultAuditCapTrail314 = new AuditCapTrail314(opts || {});
  }
  return _defaultAuditCapTrail314;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge314
//    Extends PagedDiffBridge313 with pagedDiffPageRange314(fromVersion, toVersion,
//    startPage, endPage, pageSize) that fetches pages from startPage to endPage
//    inclusive and concatenates all entries.
// ─────────────────────────────────────────────────────────────────────────────

class PageRangeDiffBridge314 extends V313.PagedDiffBridge313 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * pagedDiffPageRange314(fromVersion, toVersion, startPage, endPage, pageSize) —
   * returns concatenated entries from startPage to endPage inclusive.
   * startPage and endPage are 1-based. If endPage < startPage, returns empty.
   * pageSize defaults to 20, max 200.
   *
   * @param {number} fromVersion
   * @param {number} toVersion
   * @param {number} startPage  — 1-based start page (inclusive)
   * @param {number} endPage    — 1-based end page (inclusive)
   * @param {number} [pageSize] — entries per page (default 20, max 200)
   * @returns {{ ok, fromVersion, toVersion, startPage, endPage, pageSize,
   *             totalCount, totalPages, entries, version }}
   */
  pagedDiffPageRange314(fromVersion, toVersion, startPage, endPage, pageSize) {
    const ps = Math.min(pageSize || 20, 200);
    const sp = Math.max(startPage || 1, 1);
    const ep = endPage || sp;

    // Probe to get metadata
    const probe = this.pagedDiffWithMeta312(fromVersion, toVersion, 1, ps);
    if (!probe.ok) {
      return Object.assign({}, probe, { version: MM_VERSION_314 });
    }

    const { totalCount, totalPages } = probe;

    // If range is inverted or empty
    if (ep < sp) {
      return {
        ok:          true,
        fromVersion,
        toVersion,
        startPage:   sp,
        endPage:     ep,
        pageSize:    ps,
        totalCount,
        totalPages,
        entries:     [],
        version:     MM_VERSION_314,
      };
    }

    // Collect entries across all pages in range
    const allEntries = [];
    const clampedEnd = Math.min(ep, totalPages > 0 ? totalPages : 1);

    for (let page = sp; page <= clampedEnd; page++) {
      // page 1 already fetched in probe
      const result = (page === 1)
        ? probe
        : this.pagedDiffWithMeta312(fromVersion, toVersion, page, ps);
      if (result.ok && Array.isArray(result.entries)) {
        allEntries.push(...result.entries);
      }
    }

    return {
      ok:          true,
      fromVersion,
      toVersion,
      startPage:   sp,
      endPage:     clampedEnd,
      pageSize:    ps,
      totalCount,
      totalPages,
      entries:     allEntries,
      version:     MM_VERSION_314,
    };
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_314 });
  }
}

let _defaultPageRangeDiffBridge314 = null;
function defaultPageRangeDiffBridge314(opts) {
  if (!_defaultPageRangeDiffBridge314 || opts) {
    _defaultPageRangeDiffBridge314 = new PageRangeDiffBridge314(opts || {});
  }
  return _defaultPageRangeDiffBridge314;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer314
//    Extends StatsMultiRankedBuffer313 with multiSearchOverlapRanked314(tokens[])
//    that returns sharedSnapshots sorted by matchCount descending (highest first).
// ─────────────────────────────────────────────────────────────────────────────

class RankedOverlapBuffer314 extends V313.StatsMultiRankedBuffer313 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * multiSearchOverlapRanked314(tokens) — like multiSearchOverlapStrength313 but
   * returns sharedSnapshots sorted by matchCount descending (highest overlap first).
   *
   * @param {string[]} tokens
   * @returns {{ ok, sharedSnapshots: [{ index, tokens: string[], matchCount: number }], version }}
   */
  multiSearchOverlapRanked314(tokens) {
    const base = this.multiSearchOverlapStrength313(tokens);
    if (!base.ok) {
      return Object.assign({}, base, { version: MM_VERSION_314 });
    }

    // Sort by matchCount descending (stable sort: ties preserve original order)
    const sharedSnapshots = base.sharedSnapshots.slice().sort((a, b) => b.matchCount - a.matchCount);

    return {
      ok:              true,
      sharedSnapshots,
      version:         MM_VERSION_314,
    };
  }

  stats() {
    const base = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base, { version: MM_VERSION_314 });
  }
}

let _defaultRankedOverlapBuffer314 = null;
function defaultRankedOverlapBuffer314(opts) {
  if (!_defaultRankedOverlapBuffer314 || opts) {
    _defaultRankedOverlapBuffer314 = new RankedOverlapBuffer314(opts || {});
  }
  return _defaultRankedOverlapBuffer314;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker314
//    Extends DeltaPercentilesTracker313 with trendCumulativeDeltaNorm314(source,
//    windowMs, buckets, baselineBucket) that additionally returns each
//    cumulativeP99Delta as a normalised fraction of the baseline p99.
//    normDelta = cumulativeP99Delta / referenceP99; null when reference is 0 or null.
// ─────────────────────────────────────────────────────────────────────────────

class NormDeltaPercentilesTracker314 extends V313.DeltaPercentilesTracker313 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * trendCumulativeDeltaNorm314(source, windowMs, buckets, baselineBucket) —
   * like trendCumulativeDeltaFrom313 but additionally returns `normDelta` per
   * cumulativeDeltas entry:
   *   normDelta = cumulativeP99Delta / referenceP99
   * null when referenceP99 is 0 or null (to avoid division by zero).
   *
   * @param {string} source
   * @param {number} windowMs
   * @param {number} buckets
   * @param {number} baselineBucket — 0-based index into the trend array
   * @returns {{ ok, ...(all trendCumulativeDeltaFrom313 fields), cumulativeDeltas, version }}
   */
  trendCumulativeDeltaNorm314(source, windowMs, buckets, baselineBucket) {
    const base = this.trendCumulativeDeltaFrom313(source, windowMs, buckets, baselineBucket);
    if (!base.ok) {
      return Object.assign({}, base, { version: MM_VERSION_314 });
    }

    // Determine referenceP99 from the baseline bucket
    const trend       = base.trend;
    let referenceP99  = null;

    const bb = typeof baselineBucket === 'number' &&
               Number.isInteger(baselineBucket) &&
               baselineBucket >= 0 &&
               baselineBucket < trend.length
      ? baselineBucket
      : null;

    if (bb !== null) {
      const refBucket = trend[bb];
      if (refBucket && refBucket.p99 !== null && refBucket.p99 !== undefined) {
        referenceP99 = refBucket.p99;
      }
    }

    // Build normalised cumulativeDeltas
    const cumulativeDeltas = base.cumulativeDeltas.map(entry => {
      let normDelta = null;
      if (
        referenceP99 !== null &&
        referenceP99 !== 0 &&
        entry.cumulativeP99Delta !== null
      ) {
        normDelta = entry.cumulativeP99Delta / referenceP99;
      }
      return Object.assign({}, entry, { normDelta });
    });

    return Object.assign({}, base, {
      cumulativeDeltas,
      version: MM_VERSION_314,
    });
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_314 });
  }
}

let _defaultNormDeltaPercentilesTracker314 = null;
function defaultNormDeltaPercentilesTracker314(opts) {
  if (!_defaultNormDeltaPercentilesTracker314 || opts) {
    _defaultNormDeltaPercentilesTracker314 = new NormDeltaPercentilesTracker314(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker314;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * registerV314Endpoints(app) — attaches the four V314 routes to an Express app.
 *
 * All V287..V313 routes are preserved by their respective modules.
 */
function registerV314Endpoints(app) {
  const trail314   = defaultAuditCapTrail314();
  const bridge314  = defaultPageRangeDiffBridge314();
  const buffer314  = defaultRankedOverlapBuffer314();
  const tracker314 = defaultNormDeltaPercentilesTracker314();

  // 1. GET audit cap history
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v314/aggregate/db/hydrate/audit/cap/history',
    (req, res) => {
      try {
        res.json(trail314.auditCapHistory314());
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_314 });
      }
    }
  );

  // 2. GET diff audit page range
  app.get(
    '/api/v1/market/alerts/suppress/config/v314/diff/audit/filter/paged/range',
    (req, res) => {
      try {
        const from      = Number(req.query.from);
        const to        = Number(req.query.to);
        const startPage = req.query.startPage ? Number(req.query.startPage) : 1;
        const endPage   = req.query.endPage   ? Number(req.query.endPage)   : startPage;
        const pageSize  = req.query.pageSize  ? Number(req.query.pageSize)  : 20;
        res.json(bridge314.pagedDiffPageRange314(from, to, startPage, endPage, pageSize));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_314 });
      }
    }
  );

  // 3. POST token overlap ranked
  app.post(
    '/api/v1/market/backtest/sessions/v314/snapshot/search/ranked/multi/overlap/ranked',
    (req, res) => {
      try {
        const { tokens } = req.body || {};
        res.json(buffer314.multiSearchOverlapRanked314(tokens));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_314 });
      }
    }
  );

  // 4. GET cumulative delta normalised
  app.get(
    '/api/v1/contracts/receipts/v314/histogram/rolling/percentiles/trend/delta/cumulative/norm',
    (req, res) => {
      try {
        const source         = req.query.source   || '';
        const windowMs       = req.query.windowMs ? Number(req.query.windowMs) : 60000;
        const bkts           = req.query.buckets  ? Number(req.query.buckets)  : 5;
        const baselineBucket = req.query.baseline !== undefined ? Number(req.query.baseline) : 0;
        res.json(tracker314.trendCumulativeDeltaNorm314(source, windowMs, bkts, baselineBucket));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_314 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_314,
  // 1. Audit cap history
  AuditCapTrail314,
  defaultAuditCapTrail314,
  // 2. Diff audit page range
  PageRangeDiffBridge314,
  defaultPageRangeDiffBridge314,
  // 3. Token overlap ranked
  RankedOverlapBuffer314,
  defaultRankedOverlapBuffer314,
  // 4. Cumulative delta normalised
  NormDeltaPercentilesTracker314,
  defaultNormDeltaPercentilesTracker314,
  // Endpoint registration
  registerV314Endpoints,
};
