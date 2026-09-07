'use strict';
/**
 * lib/marketMaker313.js — ECOS V313 (Phase P201) — Audit Cap Config,
 *                          Diff Audit Last Page, Overlap Strength,
 *                          Cumulative Delta From Baseline
 *
 * Four additive components that extend the V312 observability layer:
 *
 *   1. ConfigurableAuditTrail313   — extends HydratingAuditTrail312 with
 *                                    setAuditCap313(cap) to configure ring capacity
 *                                    (min 10, max 1000); capacity exposed in
 *                                    hydrateAuditLog312() response.
 *                                    POST /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v313/aggregate/db/hydrate/audit/cap
 *
 *   2. PagedDiffBridge313          — extends PagedDiffBridge312 with
 *                                    pagedDiffLastPage313(fromVersion, toVersion, pageSize)
 *                                    that jumps to the last page automatically.
 *                                    GET /api/v1/market/alerts/suppress/config/v313/diff/audit/filter/paged/last?from=&to=&pageSize=
 *
 *   3. StatsMultiRankedBuffer313   — extends StatsMultiRankedBuffer312 with
 *                                    multiSearchOverlapStrength313(tokens[]) returning
 *                                    sharedSnapshots with matchCount per entry.
 *                                    POST /api/v1/market/backtest/sessions/v313/snapshot/search/ranked/multi/overlap/strength
 *
 *   4. DeltaPercentilesTracker313  — extends DeltaPercentilesTracker312 with
 *                                    trendCumulativeDeltaFrom313(source, windowMs, buckets, baselineBucket)
 *                                    where baselineBucket overrides auto-detection.
 *                                    GET /api/v1/contracts/receipts/v313/histogram/rolling/percentiles/trend/delta/cumulative/from?source=&windowMs=&buckets=&baseline=
 *
 * Sacred files untouched (R1). All new identifiers end in `313` (R2).
 * Zero new npm deps (R3). V287..V312 surfaces preserved (R6).
 * lib/ mirrors src/lib/ (R5). package.json bumped to 313.0.0.
 *
 * @version 313.0.0
 */

const V312 = require('./marketMaker312.js');
const V311 = require('./marketMaker311.js');
const V310 = require('./marketMaker310.js');
const V309 = require('./marketMaker309.js');
const V308 = require('./marketMaker308.js');
const V307 = require('./marketMaker307.js');
const V306 = require('./marketMaker306.js');
const V305 = require('./marketMaker305.js');

const MM_VERSION_313 = '313.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// 1) ConfigurableAuditTrail313
//    Extends HydratingAuditTrail312 with setAuditCap313(cap) that validates
//    and updates the ring capacity (min 10, max 1000).
//    Exposes current capacity in hydrateAuditLog312() response as `capacity`.
//    POST /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v313/aggregate/db/hydrate/audit/cap
// ─────────────────────────────────────────────────────────────────────────────

class ConfigurableAuditTrail313 extends V312.HydratingAuditTrail312 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * setAuditCap313(cap) — validates and updates the ring capacity.
   * min: 10, max: 1000.
   *
   * @param {number} cap
   * @returns {{ ok: boolean, cap?: number, error?: string, version: string }}
   */
  setAuditCap313(cap) {
    if (typeof cap !== 'number' || !Number.isFinite(cap) || !Number.isInteger(cap)) {
      return { ok: false, error: 'cap must be an integer', version: MM_VERSION_313 };
    }
    if (cap < 10) {
      return { ok: false, error: 'cap must be >= 10', version: MM_VERSION_313 };
    }
    if (cap > 1000) {
      return { ok: false, error: 'cap must be <= 1000', version: MM_VERSION_313 };
    }

    this._hydrateAuditCap312 = cap;

    // Trim ring if it's now larger than the new cap (FIFO: drop oldest)
    while (this._hydrateAuditRing312.length > this._hydrateAuditCap312) {
      this._hydrateAuditRing312.shift();
    }

    return { ok: true, cap, version: MM_VERSION_313 };
  }

  /**
   * Override hydrateAuditLog312() to also include capacity in the response.
   *
   * @returns {{ ok, entries, count, capacity, version }}
   */
  hydrateAuditLog312() {
    const base = super.hydrateAuditLog312();
    return Object.assign({}, base, {
      capacity: this._hydrateAuditCap312,
      version:  MM_VERSION_313,
    });
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_313 });
  }
}

let _defaultConfigurableAuditTrail313 = null;
function defaultConfigurableAuditTrail313(opts) {
  if (!_defaultConfigurableAuditTrail313 || opts) {
    _defaultConfigurableAuditTrail313 = new ConfigurableAuditTrail313(opts || {});
  }
  return _defaultConfigurableAuditTrail313;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PagedDiffBridge313
//    Extends PagedDiffBridge312 with pagedDiffLastPage313(fromVersion, toVersion,
//    pageSize) that calls pagedDiffWithMeta312 with page = totalPages
//    (or page 1 if totalPages is 0).
// ─────────────────────────────────────────────────────────────────────────────

class PagedDiffBridge313 extends V312.PagedDiffBridge312 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * pagedDiffLastPage313(fromVersion, toVersion, pageSize) — jumps to the last
   * page of a diff audit query. If totalPages is 0, falls back to page 1.
   *
   * @param {number} fromVersion
   * @param {number} toVersion
   * @param {number} pageSize   — entries per page (default 20, max 200)
   * @returns {{ ok, fromVersion, toVersion, page, pageSize, totalCount,
   *             totalPages, hasNextPage, entries, version }}
   */
  pagedDiffLastPage313(fromVersion, toVersion, pageSize) {
    const ps = pageSize || 20;

    // First call to discover totalPages (page 1, cheap when there's data)
    const probe = this.pagedDiffWithMeta312(fromVersion, toVersion, 1, ps);
    if (!probe.ok) {
      return Object.assign({}, probe, { version: MM_VERSION_313 });
    }

    const lastPage = probe.totalPages > 0 ? probe.totalPages : 1;

    // If last page == 1 we already have the result
    if (lastPage === 1) {
      return Object.assign({}, probe, { version: MM_VERSION_313 });
    }

    const result = this.pagedDiffWithMeta312(fromVersion, toVersion, lastPage, ps);
    return Object.assign({}, result, { version: MM_VERSION_313 });
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_313 });
  }
}

let _defaultPagedDiffBridge313 = null;
function defaultPagedDiffBridge313(opts) {
  if (!_defaultPagedDiffBridge313 || opts) {
    _defaultPagedDiffBridge313 = new PagedDiffBridge313(opts || {});
  }
  return _defaultPagedDiffBridge313;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) StatsMultiRankedBuffer313
//    Extends StatsMultiRankedBuffer312 with multiSearchOverlapStrength313(tokens[])
//    that returns the same structure as multiSearchOverlap312 plus a matchCount
//    field per shared snapshot entry.
// ─────────────────────────────────────────────────────────────────────────────

class StatsMultiRankedBuffer313 extends V312.StatsMultiRankedBuffer312 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * multiSearchOverlapStrength313(tokens) — like multiSearchOverlap312 but adds
   * a `matchCount` field to each shared snapshot entry indicating how many tokens
   * matched that snapshot.
   *
   * @param {string[]} tokens
   * @returns {{ ok, sharedSnapshots: [{ index, tokens: string[], matchCount: number }], version }}
   */
  multiSearchOverlapStrength313(tokens) {
    const base = this.multiSearchOverlap312(tokens);
    if (!base.ok) {
      return Object.assign({}, base, { version: MM_VERSION_313 });
    }

    const sharedSnapshots = base.sharedSnapshots.map(entry => ({
      index:      entry.index,
      tokens:     entry.tokens,
      matchCount: entry.tokens.length,
    }));

    return {
      ok:              true,
      sharedSnapshots,
      version:         MM_VERSION_313,
    };
  }

  stats() {
    const base = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base, { version: MM_VERSION_313 });
  }
}

let _defaultStatsMultiRankedBuffer313 = null;
function defaultStatsMultiRankedBuffer313(opts) {
  if (!_defaultStatsMultiRankedBuffer313 || opts) {
    _defaultStatsMultiRankedBuffer313 = new StatsMultiRankedBuffer313(opts || {});
  }
  return _defaultStatsMultiRankedBuffer313;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) DeltaPercentilesTracker313
//    Extends DeltaPercentilesTracker312 with trendCumulativeDeltaFrom313(source,
//    windowMs, buckets, baselineBucket) where baselineBucket (0-based index)
//    overrides the automatic first-non-null detection.
// ─────────────────────────────────────────────────────────────────────────────

class DeltaPercentilesTracker313 extends V312.DeltaPercentilesTracker312 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * trendCumulativeDeltaFrom313(source, windowMs, buckets, baselineBucket) —
   * like trendCumulativeDelta312 but uses `baselineBucket` (0-based index) as
   * the reference baseline instead of auto-detecting the first non-null bucket.
   *
   * If baselineBucket is out of range or its p99 is null, behaves as if no
   * reference was found (all cumulativeP99Delta values are null).
   *
   * @param {string} source
   * @param {number} windowMs
   * @param {number} buckets
   * @param {number} baselineBucket — 0-based index into the trend array
   * @returns {{ ok, ...(all trendCumulativeDelta312 fields), cumulativeDeltas, version }}
   */
  trendCumulativeDeltaFrom313(source, windowMs, buckets, baselineBucket) {
    // Get the base result from V312 (auto-detected baseline)
    const base = this.trendCumulativeDelta312(source, windowMs, buckets);
    if (!base.ok) {
      return Object.assign({}, base, { version: MM_VERSION_313 });
    }

    const trend = base.trend;

    // Determine the baseline p99 using the explicit baselineBucket index
    let referenceP99   = null;
    let referenceFound = false;

    if (
      typeof baselineBucket === 'number' &&
      Number.isInteger(baselineBucket) &&
      baselineBucket >= 0 &&
      baselineBucket < trend.length
    ) {
      const refBucket = trend[baselineBucket];
      if (refBucket && refBucket.p99 !== null && refBucket.p99 !== undefined) {
        referenceP99   = refBucket.p99;
        referenceFound = true;
      }
    }

    // Rebuild cumulativeDeltas using the explicit baseline
    const cumulativeDeltas = trend.map((bucket) => {
      const p99 = bucket.p99 !== undefined ? bucket.p99 : null;

      let cumulativeP99Delta = null;
      if (referenceFound && p99 !== null) {
        cumulativeP99Delta = p99 - referenceP99;
      }

      return {
        bucketIndex:       bucket.bucketIndex,
        p99,
        cumulativeP99Delta,
      };
    });

    return {
      ok:              true,
      source:          base.source,
      windowMs:        base.windowMs,
      buckets:         base.buckets,
      trend:           base.trend,
      globalP50:       base.globalP50,
      globalP95:       base.globalP95,
      globalP99:       base.globalP99,
      peakBucketIndex: base.peakBucketIndex,
      deltas:          base.deltas,
      cumulativeDeltas,
      baselineBucket:  typeof baselineBucket === 'number' ? baselineBucket : null,
      version:         MM_VERSION_313,
    };
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_313 });
  }
}

let _defaultDeltaPercentilesTracker313 = null;
function defaultDeltaPercentilesTracker313(opts) {
  if (!_defaultDeltaPercentilesTracker313 || opts) {
    _defaultDeltaPercentilesTracker313 = new DeltaPercentilesTracker313(opts || {});
  }
  return _defaultDeltaPercentilesTracker313;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * registerV313Endpoints(app) — attaches the four V313 routes to an Express app.
 *
 * All V287..V312 routes are preserved by their respective modules.
 */
function registerV313Endpoints(app) {
  const loader313  = defaultConfigurableAuditTrail313();
  const bridge313  = defaultPagedDiffBridge313();
  const buffer313  = defaultStatsMultiRankedBuffer313();
  const tracker313 = defaultDeltaPercentilesTracker313();

  // 1. POST set audit cap
  app.post(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v313/aggregate/db/hydrate/audit/cap',
    (req, res) => {
      try {
        const { cap } = req.body || {};
        res.json(loader313.setAuditCap313(cap));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_313 });
      }
    }
  );

  // 2. GET diff audit last page
  app.get(
    '/api/v1/market/alerts/suppress/config/v313/diff/audit/filter/paged/last',
    (req, res) => {
      try {
        const from     = Number(req.query.from);
        const to       = Number(req.query.to);
        const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;
        res.json(bridge313.pagedDiffLastPage313(from, to, pageSize));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_313 });
      }
    }
  );

  // 3. POST token overlap strength
  app.post(
    '/api/v1/market/backtest/sessions/v313/snapshot/search/ranked/multi/overlap/strength',
    (req, res) => {
      try {
        const { tokens } = req.body || {};
        res.json(buffer313.multiSearchOverlapStrength313(tokens));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_313 });
      }
    }
  );

  // 4. GET cumulative delta from explicit baseline
  app.get(
    '/api/v1/contracts/receipts/v313/histogram/rolling/percentiles/trend/delta/cumulative/from',
    (req, res) => {
      try {
        const source         = req.query.source   || '';
        const windowMs       = req.query.windowMs ? Number(req.query.windowMs) : 60000;
        const bkts           = req.query.buckets  ? Number(req.query.buckets)  : 5;
        const baselineBucket = req.query.baseline !== undefined ? Number(req.query.baseline) : 0;
        res.json(tracker313.trendCumulativeDeltaFrom313(source, windowMs, bkts, baselineBucket));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_313 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_313,
  // 1. Configurable audit cap
  ConfigurableAuditTrail313,
  defaultConfigurableAuditTrail313,
  // 2. Paged diff last page
  PagedDiffBridge313,
  defaultPagedDiffBridge313,
  // 3. Token overlap strength
  StatsMultiRankedBuffer313,
  defaultStatsMultiRankedBuffer313,
  // 4. Cumulative delta from explicit baseline
  DeltaPercentilesTracker313,
  defaultDeltaPercentilesTracker313,
  // Endpoint registration
  registerV313Endpoints,
};
