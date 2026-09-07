'use strict';
/**
 * lib/marketMaker317.js — ECOS V317 (Phase P205) — Audit Cap Diffing,
 *                          Page Range Heatmap, Fuzzy Overlap,
 *                          Anomaly Detection
 *
 * Four additive components that extend the V316 observability layer:
 *
 *   1. AuditCapTrail317 — auditCapHistoryDiff317(cursorA, cursorB)
 *      returns a structured diff between two cap history entries.
 *
 *   2. PageRangeDiffBridge317 — pagedDiffPageRangeHeatmap317(...)
 *      returns an array of intensities based on entry counts across a range.
 *
 *   3. RankedOverlapBuffer317 — multiSearchOverlapFuzzy317(tokens[], n)
 *      supports fuzzy token matching (substring) in overlap searches.
 *
 *   4. NormDeltaPercentilesTracker317 — trendNormDeltaAnomalies317(...)
 *      identifies buckets exceeding the 'spike' threshold as anomalies.
 *
 * Sacred files untouched (R1). All new identifiers end in `317` (R2).
 * Zero new npm deps (R3). V287..V316 surfaces preserved (R6).
 * lib/ mirrors src/lib/. package.json bumped to 317.0.0.
 *
 * @version 317.0.0
 */

const V316 = require('./marketMaker316.js');
const V315 = require('./marketMaker315.js');

const MM_VERSION_317 = '317.0.0';

function _coercePositiveInt317(value, fallback317) {
  const n317 = Number(value);
  if (!Number.isFinite(n317) || !Number.isInteger(n317) || n317 < 1) return fallback317;
  return n317;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail317
//    Extends AuditCapTrail316 with cap entry diffing.
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail317 extends V316.AuditCapTrail316 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * auditCapHistoryDiff317(cursorA, cursorB) — returns a diff between two entries.
   *
   * @param {string} cursorA — changedAt of first entry
   * @param {string} cursorB — changedAt of second entry
   * @returns {{ ok, diff: { capDelta, timeDeltaMs, entryA, entryB }, version }}
   */
  auditCapHistoryDiff317(cursorA, cursorB) {
    const base317 = this.auditCapHistory314();
    if (!base317.ok) {
      return Object.assign({}, base317, { version: MM_VERSION_317 });
    }

    const all317 = Array.isArray(base317.entries) ? base317.entries : [];
    const entryA317 = all317.find(e => e.changedAt === cursorA);
    const entryB317 = all317.find(e => e.changedAt === cursorB);

    if (!entryA317 || !entryB317) {
      return { ok: false, error: 'One or both cursors not found', version: MM_VERSION_317 };
    }

    const capDelta317 = (entryB317.cap || 0) - (entryA317.cap || 0);
    const timeDelta317 = new Date(entryB317.changedAt).getTime() - new Date(entryA317.changedAt).getTime();

    return {
      ok: true,
      diff: {
        capDelta:    capDelta317,
        timeDeltaMs: timeDelta317,
        entryA:      entryA317,
        entryB:      entryB317,
      },
      version: MM_VERSION_317,
    };
  }

  stats() {
    const base317 = super.stats();
    return Object.assign({}, base317, { version: MM_VERSION_317 });
  }
}

let _defaultAuditCapTrail317 = null;
function defaultAuditCapTrail317(opts) {
  if (!_defaultAuditCapTrail317 || opts) {
    _defaultAuditCapTrail317 = new AuditCapTrail317(opts || {});
  }
  return _defaultAuditCapTrail317;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge317
//    Extends PageRangeDiffBridge316 with range heatmap.
// ─────────────────────────────────────────────────────────────────────────────

class PageRangeDiffBridge317 extends V316.PageRangeDiffBridge316 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * pagedDiffPageRangeHeatmap317(from, to, startPage, endPage, pageSize)
   * returns intensities (0.0 to 1.0) based on entry counts.
   *
   * @returns {{ ok, heatmap: number[], version }}
   */
  pagedDiffPageRangeHeatmap317(from, to, startPage, endPage, pageSize) {
    const base317 = this.pagedDiffPageRangeStats315(from, to, startPage, endPage, pageSize);
    if (!base317.ok) {
      return Object.assign({}, base317, { version: MM_VERSION_317 });
    }

    const perPage317 = Array.isArray(base317.perPage) ? base317.perPage : [];
    const counts317  = perPage317.map(p => p.entryCount);
    const max317     = counts317.length > 0 ? Math.max(...counts317) : 0;
    
    const heatmap317 = counts317.map(c => max317 > 0 ? c / max317 : 0);

    return Object.assign({}, base317, {
      heatmap: heatmap317,
      version: MM_VERSION_317,
    });
  }

  stats() {
    const base317 = super.stats();
    return Object.assign({}, base317, { version: MM_VERSION_317 });
  }
}

let _defaultPageRangeDiffBridge317 = null;
function defaultPageRangeDiffBridge317(opts) {
  if (!_defaultPageRangeDiffBridge317 || opts) {
    _defaultPageRangeDiffBridge317 = new PageRangeDiffBridge317(opts || {});
  }
  return _defaultPageRangeDiffBridge317;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer317
//    Extends RankedOverlapBuffer316 with fuzzy token matching.
// ─────────────────────────────────────────────────────────────────────────────

class RankedOverlapBuffer317 extends V316.RankedOverlapBuffer316 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * multiSearchOverlapFuzzy317(tokens, n) — supports substring matching.
   *
   * @param {string[]} tokens
   * @param {number} [n]
   * @returns {{ ok, sharedSnapshots, version }}
   */
  multiSearchOverlapFuzzy317(tokens, n) {
    const reqTokens317 = Array.isArray(tokens) ? tokens.map(t => String(t).toLowerCase()) : [];
    if (reqTokens317.length === 0) {
      return { ok: false, error: 'No tokens provided', version: MM_VERSION_317 };
    }

    // Manual fuzzy overlap logic using V308 snapshots
    const snaps317 = Array.isArray(this._snapshots308) ? this._snapshots308 : [];
    const results317 = snaps317.map((snap317, index317) => {
      const snapTokens317 = (Array.isArray(snap317.tokens) ? snap317.tokens : []).map(t => String(t).toLowerCase());
      const matched317 = reqTokens317.filter(rt317 => snapTokens317.some(st317 => st317.includes(rt317)));
      
      return {
        index:      index317,
        tokens:     snap317.tokens,
        matchCount: matched317.length,
        matched:    matched317,
      };
    }).filter(r => r.matchCount > 0);

    results317.sort((a, b) => b.matchCount - a.matchCount || a.index - b.index);
    
    const limit317 = _coercePositiveInt317(n, 10);
    const top317 = results317.slice(0, limit317);

    return {
      ok:              true,
      sharedSnapshots: top317,
      n:               limit317,
      totalCount:      results317.length,
      version:         MM_VERSION_317,
    };
  }

  stats() {
    const base317 = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base317, { version: MM_VERSION_317 });
  }
}

let _defaultRankedOverlapBuffer317 = null;
function defaultRankedOverlapBuffer317(opts) {
  if (!_defaultRankedOverlapBuffer317 || opts) {
    _defaultRankedOverlapBuffer317 = new RankedOverlapBuffer317(opts || {});
  }
  return _defaultRankedOverlapBuffer317;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker317
//    Extends NormDeltaPercentilesTracker316 with anomaly detection.
// ─────────────────────────────────────────────────────────────────────────────

class NormDeltaPercentilesTracker317 extends V316.NormDeltaPercentilesTracker316 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * trendNormDeltaAnomalies317(source, windowMs, buckets, baseline, thresholds)
   * returns buckets identified as 'spike' as anomalies.
   *
   * @returns {{ ok, anomalies: object[], version }}
   */
  trendNormDeltaAnomalies317(source, windowMs, buckets, baseline, thresholds) {
    const base317 = this.trendNormDeltaClassified316(source, windowMs, buckets, baseline, thresholds);
    if (!base317.ok) {
      return Object.assign({}, base317, { version: MM_VERSION_317 });
    }

    const anomalies317 = (base317.cumulativeDeltas || []).filter(entry317 => entry317.classification === 'spike');

    return Object.assign({}, base317, {
      anomalies: anomalies317,
      version:   MM_VERSION_317,
    });
  }

  stats() {
    const base317 = super.stats();
    return Object.assign({}, base317, { version: MM_VERSION_317 });
  }
}

let _defaultNormDeltaPercentilesTracker317 = null;
function defaultNormDeltaPercentilesTracker317(opts) {
  if (!_defaultNormDeltaPercentilesTracker317 || opts) {
    _defaultNormDeltaPercentilesTracker317 = new NormDeltaPercentilesTracker317(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker317;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

function registerV317Endpoints(app) {
  const trail317   = defaultAuditCapTrail317();
  const bridge317  = defaultPageRangeDiffBridge317();
  const buffer317  = defaultRankedOverlapBuffer317();
  const tracker317 = defaultNormDeltaPercentilesTracker317();

  // 1. GET audit cap history diff
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v317/aggregate/db/hydrate/audit/cap/history/diff',
    (req, res) => {
      try {
        const cursorA317 = req.query.cursorA;
        const cursorB317 = req.query.cursorB;
        res.json(trail317.auditCapHistoryDiff317(cursorA317, cursorB317));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_317 });
      }
    }
  );

  // 2. GET diff audit page range heatmap
  app.get(
    '/api/v1/market/alerts/suppress/config/v317/diff/audit/filter/paged/range/heatmap',
    (req, res) => {
      try {
        const from317      = Number(req.query.from);
        const to317        = Number(req.query.to);
        const startPage317 = req.query.startPage ? Number(req.query.startPage) : 1;
        const endPage317   = req.query.endPage   ? Number(req.query.endPage)   : startPage317;
        const pageSize317  = req.query.pageSize  ? Number(req.query.pageSize)  : 20;
        res.json(bridge317.pagedDiffPageRangeHeatmap317(from317, to317, startPage317, endPage317, pageSize317));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_317 });
      }
    }
  );

  // 3. POST token overlap fuzzy
  app.post(
    '/api/v1/market/backtest/sessions/v317/snapshot/search/ranked/multi/overlap/fuzzy',
    (req, res) => {
      try {
        const tokens317 = req.body ? req.body.tokens : undefined;
        const n317      = req.query.n ? Number(req.query.n) : undefined;
        res.json(buffer317.multiSearchOverlapFuzzy317(tokens317, n317));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_317 });
      }
    }
  );

  // 4. GET cumulative delta anomalies
  app.get(
    '/api/v1/contracts/receipts/v317/histogram/rolling/percentiles/trend/delta/cumulative/norm/anomalies',
    (req, res) => {
      try {
        const source317   = req.query.source   || '';
        const windowMs317 = req.query.windowMs ? Number(req.query.windowMs) : 60000;
        const buckets317  = req.query.buckets  ? Number(req.query.buckets)  : 5;
        const baseline317 = req.query.baseline !== undefined ? Number(req.query.baseline) : 0;
        const elevated317 = req.query.elevated ? Number(req.query.elevated) : 1.5;
        const spike317    = req.query.spike    ? Number(req.query.spike)    : 3.0;
        res.json(tracker317.trendNormDeltaAnomalies317(source317, windowMs317, buckets317, baseline317, { elevated: elevated317, spike: spike317 }));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_317 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_317,
  _coercePositiveInt317,
  AuditCapTrail317,
  defaultAuditCapTrail317,
  PageRangeDiffBridge317,
  defaultPageRangeDiffBridge317,
  RankedOverlapBuffer317,
  defaultRankedOverlapBuffer317,
  NormDeltaPercentilesTracker317,
  defaultNormDeltaPercentilesTracker317,
  registerV317Endpoints,
};
