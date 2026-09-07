'use strict';
/**
 * lib/marketMaker312.js — ECOS V312 (Phase P200) — Hydration Audit Trail,
 *                          Diff Audit Page Meta, Token Overlap Analysis,
 *                          Cumulative Delta
 *
 * Four additive components that extend the V311 observability layer:
 *
 *   1. HydratingAuditTrail312     — extends HydratingAggregateLoader311 with
 *                                   hydrateAuditLog312() returning an ordered
 *                                   list of hydration events (bounded ring, max 100).
 *                                   GET /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v312/aggregate/db/hydrate/audit
 *
 *   2. PagedDiffBridge312         — extends PagedDiffBridge311 with
 *                                   pagedDiffWithMeta312(fromVersion, toVersion, page, pageSize)
 *                                   returning also totalPages and hasNextPage.
 *                                   GET /api/v1/market/alerts/suppress/config/v312/diff/audit/filter/paged/meta?from=&to=&page=&pageSize=
 *
 *   3. StatsMultiRankedBuffer312  — extends StatsMultiRankedBuffer311 with
 *                                   multiSearchOverlap312(tokens[]) returning
 *                                   { sharedSnapshots: [{ index, tokens[] }] }.
 *                                   POST /api/v1/market/backtest/sessions/v312/snapshot/search/ranked/multi/overlap
 *
 *   4. DeltaPercentilesTracker312 — extends DeltaPercentilesTracker311 with
 *                                   trendCumulativeDelta312(source, windowMs, buckets)
 *                                   returning a cumulativeDeltas array.
 *                                   GET /api/v1/contracts/receipts/v312/histogram/rolling/percentiles/trend/delta/cumulative?source=&windowMs=&buckets=
 *
 * Sacred files untouched (R1). All new identifiers end in `312` (R2).
 * Zero new npm deps (R3). V287..V311 surfaces preserved (R6).
 * lib/ mirrors src/lib/ (R5). package.json bumped to 312.0.0.
 *
 * @version 312.0.0
 */

const V311 = require('./marketMaker311.js');
const V310 = require('./marketMaker310.js');
const V309 = require('./marketMaker309.js');
const V308 = require('./marketMaker308.js');
const V307 = require('./marketMaker307.js');
const V306 = require('./marketMaker306.js');
const V305 = require('./marketMaker305.js');

const MM_VERSION_312 = '312.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// 1) HydratingAuditTrail312
//    Extends HydratingAggregateLoader311 with hydrateAuditLog312() that returns
//    an ordered list of hydration events (bounded ring, max 100 entries).
//    Each entry: { hydratedAt, aggregate, version }
// ─────────────────────────────────────────────────────────────────────────────

class HydratingAuditTrail312 extends V311.HydratingAggregateLoader311 {
  constructor(opts = {}) {
    super(opts);
    this._hydrateAuditRing312 = [];  // bounded ring, max 100 entries
    this._hydrateAuditCap312  = 100;
  }

  /**
   * Override hydrateFromDb311 to additionally record each hydration attempt
   * in the audit ring, then delegate to the parent.
   *
   * @param {object} pool — pg Pool (or compatible)
   * @returns {Promise<{ ok, hydrated, aggregate, version }>}
   */
  async hydrateFromDb311(pool) {
    const result = await super.hydrateFromDb311(pool);

    // Record the event regardless of success/failure
    const entry = {
      hydratedAt: new Date().toISOString(),
      aggregate:  result.ok ? result.aggregate : null,
      ok:         result.ok,
      version:    MM_VERSION_312,
    };

    // Maintain bounded ring (FIFO, max 100)
    this._hydrateAuditRing312.push(entry);
    if (this._hydrateAuditRing312.length > this._hydrateAuditCap312) {
      this._hydrateAuditRing312.shift();
    }

    return result;
  }

  /**
   * hydrateAuditLog312() — returns an ordered list of hydration events.
   * Oldest first (index 0 = earliest).
   *
   * @returns {{ ok, entries: [{ hydratedAt, aggregate, version }], count, version }}
   */
  hydrateAuditLog312() {
    return {
      ok:      true,
      entries: this._hydrateAuditRing312.slice(),
      count:   this._hydrateAuditRing312.length,
      version: MM_VERSION_312,
    };
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_312 });
  }
}

let _defaultHydratingAuditTrail312 = null;
function defaultHydratingAuditTrail312(opts) {
  if (!_defaultHydratingAuditTrail312 || opts) {
    _defaultHydratingAuditTrail312 = new HydratingAuditTrail312(opts || {});
  }
  return _defaultHydratingAuditTrail312;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PagedDiffBridge312
//    Extends PagedDiffBridge311 with pagedDiffWithMeta312(fromVersion, toVersion,
//    page, pageSize) that wraps pagedDiffAudit311 and additionally returns
//    totalPages and hasNextPage.
// ─────────────────────────────────────────────────────────────────────────────

class PagedDiffBridge312 extends V311.PagedDiffBridge311 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * pagedDiffWithMeta312(fromVersion, toVersion, page, pageSize) — wraps
   * pagedDiffAudit311 and adds totalPages and hasNextPage to the response.
   *
   * @param {number} fromVersion
   * @param {number} toVersion
   * @param {number} page        — 1-based (default 1)
   * @param {number} pageSize    — entries per page (default 20, max 200)
   * @returns {{ ok, fromVersion, toVersion, page, pageSize, totalCount,
   *             totalPages, hasNextPage, entries, version }}
   */
  pagedDiffWithMeta312(fromVersion, toVersion, page, pageSize) {
    const base = this.pagedDiffAudit311(fromVersion, toVersion, page, pageSize);
    if (!base.ok) {
      return Object.assign({}, base, { version: MM_VERSION_312 });
    }

    const totalPages  = base.pageSize > 0
      ? Math.ceil(base.totalCount / base.pageSize)
      : 0;
    const hasNextPage = base.page < totalPages;

    return {
      ok:          true,
      fromVersion: base.fromVersion,
      toVersion:   base.toVersion,
      page:        base.page,
      pageSize:    base.pageSize,
      totalCount:  base.totalCount,
      totalPages,
      hasNextPage,
      entries:     base.entries,
      version:     MM_VERSION_312,
    };
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_312 });
  }
}

let _defaultPagedDiffBridge312 = null;
function defaultPagedDiffBridge312(opts) {
  if (!_defaultPagedDiffBridge312 || opts) {
    _defaultPagedDiffBridge312 = new PagedDiffBridge312(opts || {});
  }
  return _defaultPagedDiffBridge312;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) StatsMultiRankedBuffer312
//    Extends StatsMultiRankedBuffer311 with multiSearchOverlap312(tokens[])
//    that returns { sharedSnapshots: [{ index, tokens[] }] } listing each
//    snapshot that matched more than one token, with the list of matching tokens.
// ─────────────────────────────────────────────────────────────────────────────

class StatsMultiRankedBuffer312 extends V311.StatsMultiRankedBuffer311 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * multiSearchOverlap312(tokens) — finds snapshots that matched more than one
   * token in the current buffer.
   *
   * @param {string[]} tokens
   * @returns {{ ok, sharedSnapshots: [{ index, tokens: string[] }], version }}
   */
  multiSearchOverlap312(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return {
        ok:      false,
        reason:  'tokens must be a non-empty array',
        version: MM_VERSION_312,
      };
    }

    const safeTokens = tokens.slice(0, 50).map(String);

    // Build a map: snapshot index → list of tokens that matched it
    const snapTokenMap = new Map(); // index → Set<token>

    for (const token of safeTokens) {
      const r = this.rankedSearch309(token);
      if (!r.ok) continue;

      for (const snap of r.results) {
        // Use the snapshot's position in _snapshotHistory306 as its index
        const ring = Array.isArray(this._snapshotHistory306)
          ? this._snapshotHistory306
          : [];

        for (let i = 0; i < ring.length; i++) {
          const ringSnap = ring[i];
          if (ringSnap === snap.snapshot ||
              (ringSnap && snap.snapshot &&
               ringSnap.savedAt === snap.snapshot.savedAt)) {
            if (!snapTokenMap.has(i)) {
              snapTokenMap.set(i, new Set());
            }
            snapTokenMap.get(i).add(token);
            break;
          }
        }
      }
    }

    // Collect snapshots matched by more than one token
    const sharedSnapshots = [];
    for (const [index, tokenSet] of snapTokenMap.entries()) {
      if (tokenSet.size > 1) {
        sharedSnapshots.push({
          index,
          tokens: Array.from(tokenSet),
        });
      }
    }

    // Sort by index ascending
    sharedSnapshots.sort((a, b) => a.index - b.index);

    return {
      ok:              true,
      sharedSnapshots,
      version:         MM_VERSION_312,
    };
  }

  stats() {
    const base = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base, { version: MM_VERSION_312 });
  }
}

let _defaultStatsMultiRankedBuffer312 = null;
function defaultStatsMultiRankedBuffer312(opts) {
  if (!_defaultStatsMultiRankedBuffer312 || opts) {
    _defaultStatsMultiRankedBuffer312 = new StatsMultiRankedBuffer312(opts || {});
  }
  return _defaultStatsMultiRankedBuffer312;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) DeltaPercentilesTracker312
//    Extends DeltaPercentilesTracker311 with trendCumulativeDelta312(source,
//    windowMs, buckets) that also returns a cumulativeDeltas array where each
//    entry shows the total p99 change from the first non-null bucket to that bucket.
// ─────────────────────────────────────────────────────────────────────────────

class DeltaPercentilesTracker312 extends V311.DeltaPercentilesTracker311 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * trendCumulativeDelta312(source, windowMs, buckets) — computes trendDelta311
   * and additionally returns a cumulativeDeltas array.
   *
   * cumulativeDeltas[i].cumulativeP99Delta = total p99 change from the first
   * non-null bucket to bucket i. null when the reference or the current bucket
   * has a null p99.
   *
   * @param {string} source
   * @param {number} windowMs
   * @param {number} buckets
   * @returns {{ ok, ...(all trendDelta311 fields), cumulativeDeltas, version }}
   */
  trendCumulativeDelta312(source, windowMs, buckets) {
    const base = this.trendDelta311(source, windowMs, buckets);
    if (!base.ok) {
      return Object.assign({}, base, { version: MM_VERSION_312 });
    }

    const trend = base.trend;

    // Find the first bucket with a non-null p99 as the reference baseline
    let referenceP99    = null;
    let referenceFound  = false;

    for (const bucket of trend) {
      if (bucket.p99 !== null && bucket.p99 !== undefined) {
        referenceP99   = bucket.p99;
        referenceFound = true;
        break;
      }
    }

    // Build cumulativeDeltas — one entry per bucket
    const cumulativeDeltas = trend.map((bucket) => {
      const p99 = bucket.p99;

      let cumulativeP99Delta = null;
      if (referenceFound && p99 !== null && p99 !== undefined) {
        cumulativeP99Delta = p99 - referenceP99;
      }

      return {
        bucketIndex:        bucket.bucketIndex,
        p99:                p99 !== undefined ? p99 : null,
        cumulativeP99Delta,
      };
    });

    return {
      ok:               true,
      source:           base.source,
      windowMs:         base.windowMs,
      buckets:          base.buckets,
      trend:            base.trend,
      globalP50:        base.globalP50,
      globalP95:        base.globalP95,
      globalP99:        base.globalP99,
      peakBucketIndex:  base.peakBucketIndex,
      deltas:           base.deltas,
      cumulativeDeltas,
      version:          MM_VERSION_312,
    };
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_312 });
  }
}

let _defaultDeltaPercentilesTracker312 = null;
function defaultDeltaPercentilesTracker312(opts) {
  if (!_defaultDeltaPercentilesTracker312 || opts) {
    _defaultDeltaPercentilesTracker312 = new DeltaPercentilesTracker312(opts || {});
  }
  return _defaultDeltaPercentilesTracker312;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * registerV312Endpoints(app) — attaches the four V312 routes to an Express app.
 *
 * All V287..V311 routes are preserved by their respective modules.
 */
function registerV312Endpoints(app) {
  const loader312  = defaultHydratingAuditTrail312();
  const bridge312  = defaultPagedDiffBridge312();
  const buffer312  = defaultStatsMultiRankedBuffer312();
  const tracker312 = defaultDeltaPercentilesTracker312();

  // 1. GET hydration audit log
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v312/aggregate/db/hydrate/audit',
    (req, res) => {
      try {
        res.json(loader312.hydrateAuditLog312());
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_312 });
      }
    }
  );

  // 2. GET paged diff audit with totalPages / hasNextPage
  app.get(
    '/api/v1/market/alerts/suppress/config/v312/diff/audit/filter/paged/meta',
    (req, res) => {
      try {
        const from     = Number(req.query.from);
        const to       = Number(req.query.to);
        const page     = req.query.page     ? Number(req.query.page)     : 1;
        const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;
        res.json(bridge312.pagedDiffWithMeta312(from, to, page, pageSize));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_312 });
      }
    }
  );

  // 3. POST token overlap analysis
  app.post(
    '/api/v1/market/backtest/sessions/v312/snapshot/search/ranked/multi/overlap',
    (req, res) => {
      try {
        const { tokens } = req.body || {};
        res.json(buffer312.multiSearchOverlap312(tokens));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_312 });
      }
    }
  );

  // 4. GET cumulative delta
  app.get(
    '/api/v1/contracts/receipts/v312/histogram/rolling/percentiles/trend/delta/cumulative',
    (req, res) => {
      try {
        const source   = req.query.source   || '';
        const windowMs = req.query.windowMs ? Number(req.query.windowMs) : 60000;
        const bkts     = req.query.buckets  ? Number(req.query.buckets)  : 5;
        res.json(tracker312.trendCumulativeDelta312(source, windowMs, bkts));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_312 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_312,
  // 1. Hydration audit trail
  HydratingAuditTrail312,
  defaultHydratingAuditTrail312,
  // 2. Paged diff audit with meta
  PagedDiffBridge312,
  defaultPagedDiffBridge312,
  // 3. Token overlap analysis
  StatsMultiRankedBuffer312,
  defaultStatsMultiRankedBuffer312,
  // 4. Cumulative trend delta
  DeltaPercentilesTracker312,
  defaultDeltaPercentilesTracker312,
  // Endpoint registration
  registerV312Endpoints,
};
