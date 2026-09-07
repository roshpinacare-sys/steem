'use strict';
/**
 * lib/marketMaker318.js — ECOS V318 (Phase P206) — Audit Cap Forecasting,
 *                          Page Range Outlier Detection, Semantic Overlap Match,
 *                          Norm Delta Volatility Index
 *
 * Four additive components that extend the V317 observability layer:
 *
 *   1. AuditCapTrail318 — auditCapForecast318(n)
 *      predicts future cap values using simple linear regression on the last N entries.
 *
 *   2. PageRangeDiffBridge318 — pagedDiffPageRangeOutliers318(...)
 *      identifies pages with entry counts significantly above the mean (> 2 std devs).
 *
 *   3. RankedOverlapBuffer318 — multiSearchOverlapSemantic318(tokens, n)
 *      supports basic semantic grouping via a predefined local synonym dictionary.
 *
 *   4. NormDeltaPercentilesTracker318 — trendNormDeltaVolatility318(...)
 *      calculates the standard deviation of normalised deltas across buckets.
 *
 * Sacred files untouched (R1). All new identifiers end in `318` (R2).
 * Zero new npm deps (R3). V287..V317 surfaces preserved (R6).
 * lib/ mirrors src/lib/. package.json bumped to 318.0.0.
 *
 * @version 318.0.0
 */

const V317 = require('./marketMaker317.js');
const V316 = require('./marketMaker316.js');

const MM_VERSION_318 = '318.0.0';

function _coercePositiveInt318(value, fallback318) {
  const n318 = Number(value);
  if (!Number.isFinite(n318) || !Number.isInteger(n318) || n318 < 1) return fallback318;
  return n318;
}

// ─────────────────────────────────────────────────────────────────────────────
// Semantic synonym dictionary (local, no external deps)
// ─────────────────────────────────────────────────────────────────────────────

const SEMANTIC_DICT_318 = {
  apple:  ['fruit', 'produce'],
  banana: ['fruit', 'produce'],
  cherry: ['fruit', 'produce'],
  orange: ['fruit', 'produce', 'citrus'],
  lemon:  ['fruit', 'produce', 'citrus'],
  dog:    ['animal', 'pet', 'canine'],
  cat:    ['animal', 'pet', 'feline'],
  car:    ['vehicle', 'transport', 'auto'],
  truck:  ['vehicle', 'transport'],
  bike:   ['vehicle', 'transport', 'cycle'],
  run:    ['move', 'execute', 'operate'],
  walk:   ['move', 'travel'],
  buy:    ['purchase', 'acquire', 'trade'],
  sell:   ['trade', 'exchange', 'dispose'],
  big:    ['large', 'huge', 'great'],
  small:  ['tiny', 'little', 'minor'],
  fast:   ['quick', 'rapid', 'swift'],
  slow:   ['gradual', 'steady'],
  good:   ['great', 'positive', 'excellent'],
  bad:    ['poor', 'negative', 'terrible'],
};

/**
 * Expand a token to include all known synonyms from SEMANTIC_DICT_318.
 * Returns the token itself plus any matching synonyms (de-duplicated).
 * @param {string} token
 * @returns {string[]}
 */
function _expandSemantic318(token) {
  const t318 = String(token).toLowerCase();
  const synonyms318 = SEMANTIC_DICT_318[t318] || [];
  // Also check if token appears as a value in the dictionary
  const reverse318 = Object.entries(SEMANTIC_DICT_318)
    .filter(([, vals]) => vals.includes(t318))
    .map(([key]) => key);
  return Array.from(new Set([t318, ...synonyms318, ...reverse318]));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail318
//    Extends AuditCapTrail317 with linear regression cap forecasting.
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail318 extends V317.AuditCapTrail317 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * auditCapForecast318(n) — predicts the next N cap values using simple
   * linear regression on the full cap history.
   *
   * The forecast extrapolates from the sequence of (index, cap) pairs using
   * least-squares linear regression: cap = slope * index + intercept.
   *
   * @param {number} [n] — number of future steps to predict (default 3, max 20)
   * @returns {{ ok, forecast: Array<{step, predictedCap}>, slope, intercept, version }}
   */
  auditCapForecast318(n) {
    const base318 = this.auditCapHistory314();
    if (!base318.ok) {
      return Object.assign({}, base318, { version: MM_VERSION_318 });
    }

    const entries318 = Array.isArray(base318.entries) ? base318.entries : [];
    if (entries318.length < 2) {
      return {
        ok:        false,
        error:     'Insufficient history for forecasting (need at least 2 entries)',
        version:   MM_VERSION_318,
      };
    }

    const steps318 = Math.min(_coercePositiveInt318(n, 3), 20);

    // Build (x, y) pairs: x = array index (0-based), y = cap value
    const xs318 = entries318.map((_, i) => i);
    const ys318 = entries318.map(e => (typeof e.cap === 'number' ? e.cap : 0));

    const count318 = xs318.length;
    const sumX318  = xs318.reduce((a, b) => a + b, 0);
    const sumY318  = ys318.reduce((a, b) => a + b, 0);
    const sumXY318 = xs318.reduce((a, x, i) => a + x * ys318[i], 0);
    const sumXX318 = xs318.reduce((a, x) => a + x * x, 0);

    const denom318 = count318 * sumXX318 - sumX318 * sumX318;
    const slope318 = denom318 !== 0
      ? (count318 * sumXY318 - sumX318 * sumY318) / denom318
      : 0;
    const intercept318 = (sumY318 - slope318 * sumX318) / count318;

    const forecast318 = [];
    for (let s318 = 1; s318 <= steps318; s318++) {
      const xNext318 = count318 - 1 + s318;
      forecast318.push({
        step:         s318,
        predictedCap: slope318 * xNext318 + intercept318,
      });
    }

    return {
      ok:        true,
      forecast:  forecast318,
      slope:     slope318,
      intercept: intercept318,
      n:         steps318,
      version:   MM_VERSION_318,
    };
  }

  stats() {
    const base318 = super.stats();
    return Object.assign({}, base318, { version: MM_VERSION_318 });
  }
}

let _defaultAuditCapTrail318 = null;
function defaultAuditCapTrail318(opts) {
  if (!_defaultAuditCapTrail318 || opts) {
    _defaultAuditCapTrail318 = new AuditCapTrail318(opts || {});
  }
  return _defaultAuditCapTrail318;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge318
//    Extends PageRangeDiffBridge317 with outlier page detection.
// ─────────────────────────────────────────────────────────────────────────────

class PageRangeDiffBridge318 extends V317.PageRangeDiffBridge317 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * pagedDiffPageRangeOutliers318(from, to, startPage, endPage, pageSize, stdFactor)
   * identifies pages with entry counts > mean + stdFactor * stdDev.
   *
   * @param {number} [stdFactor] — multiplier for std dev threshold (default 2.0)
   * @returns {{ ok, outliers: Array<{page, entryCount}>, mean, stdDev, threshold, version }}
   */
  pagedDiffPageRangeOutliers318(from, to, startPage, endPage, pageSize, stdFactor) {
    const base318 = this.pagedDiffPageRangeStats315(from, to, startPage, endPage, pageSize);
    if (!base318.ok) {
      return Object.assign({}, base318, { version: MM_VERSION_318 });
    }

    const perPage318 = Array.isArray(base318.perPage) ? base318.perPage : [];
    const counts318  = perPage318.map(p => p.entryCount);
    const factor318  = typeof stdFactor === 'number' && isFinite(stdFactor) && stdFactor >= 0
      ? stdFactor : 2.0;

    let mean318 = 0;
    let stdDev318 = 0;

    if (counts318.length > 0) {
      mean318 = counts318.reduce((a, b) => a + b, 0) / counts318.length;
      const variance318 = counts318.reduce((a, c) => a + (c - mean318) ** 2, 0) / counts318.length;
      stdDev318 = Math.sqrt(variance318);
    }

    const threshold318 = mean318 + factor318 * stdDev318;
    const outliers318 = perPage318.filter(p => p.entryCount > threshold318);

    return Object.assign({}, base318, {
      outliers:  outliers318,
      mean:      mean318,
      stdDev:    stdDev318,
      threshold: threshold318,
      version:   MM_VERSION_318,
    });
  }

  stats() {
    const base318 = super.stats();
    return Object.assign({}, base318, { version: MM_VERSION_318 });
  }
}

let _defaultPageRangeDiffBridge318 = null;
function defaultPageRangeDiffBridge318(opts) {
  if (!_defaultPageRangeDiffBridge318 || opts) {
    _defaultPageRangeDiffBridge318 = new PageRangeDiffBridge318(opts || {});
  }
  return _defaultPageRangeDiffBridge318;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer318
//    Extends RankedOverlapBuffer317 with semantic token expansion.
// ─────────────────────────────────────────────────────────────────────────────

class RankedOverlapBuffer318 extends V317.RankedOverlapBuffer317 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * multiSearchOverlapSemantic318(tokens, n) — expands each query token with
   * its synonyms from the built-in dictionary before performing substring overlap.
   *
   * @param {string[]} tokens
   * @param {number} [n]
   * @returns {{ ok, sharedSnapshots, expandedTokens, n, totalCount, version }}
   */
  multiSearchOverlapSemantic318(tokens, n) {
    const reqTokens318 = Array.isArray(tokens) ? tokens.map(t => String(t).toLowerCase()) : [];
    if (reqTokens318.length === 0) {
      return { ok: false, error: 'No tokens provided', version: MM_VERSION_318 };
    }

    // Expand each requested token with its semantic synonyms
    const expandedSet318 = new Set();
    reqTokens318.forEach(t318 => {
      _expandSemantic318(t318).forEach(e318 => expandedSet318.add(e318));
    });
    const expandedTokens318 = Array.from(expandedSet318);

    // Perform fuzzy (substring) overlap using expanded token set
    const snaps318 = Array.isArray(this._snapshots308) ? this._snapshots308 : [];
    const results318 = snaps318.map((snap318, index318) => {
      const snapTokens318 = (Array.isArray(snap318.tokens) ? snap318.tokens : [])
        .map(t => String(t).toLowerCase());
      const matched318 = expandedTokens318.filter(et318 =>
        snapTokens318.some(st318 => st318.includes(et318))
      );
      return {
        index:      index318,
        tokens:     snap318.tokens,
        matchCount: matched318.length,
        matched:    matched318,
      };
    }).filter(r => r.matchCount > 0);

    results318.sort((a, b) => b.matchCount - a.matchCount || a.index - b.index);

    const limit318 = _coercePositiveInt318(n, 10);
    const top318   = results318.slice(0, limit318);

    return {
      ok:              true,
      sharedSnapshots: top318,
      expandedTokens:  expandedTokens318,
      n:               limit318,
      totalCount:      results318.length,
      version:         MM_VERSION_318,
    };
  }

  stats() {
    const base318 = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base318, { version: MM_VERSION_318 });
  }
}

let _defaultRankedOverlapBuffer318 = null;
function defaultRankedOverlapBuffer318(opts) {
  if (!_defaultRankedOverlapBuffer318 || opts) {
    _defaultRankedOverlapBuffer318 = new RankedOverlapBuffer318(opts || {});
  }
  return _defaultRankedOverlapBuffer318;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker318
//    Extends NormDeltaPercentilesTracker317 with volatility index.
// ─────────────────────────────────────────────────────────────────────────────

class NormDeltaPercentilesTracker318 extends V317.NormDeltaPercentilesTracker317 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * trendNormDeltaVolatility318(source, windowMs, buckets, baseline, thresholds)
   * returns the V317 anomalies response plus a volatility index (std deviation
   * of finite normDelta values).
   *
   * @returns {{ ok, volatilityIndex: number|null, version }}
   */
  trendNormDeltaVolatility318(source, windowMs, buckets, baseline, thresholds) {
    const base318 = this.trendNormDeltaAnomalies317(source, windowMs, buckets, baseline, thresholds);
    if (!base318.ok) {
      return Object.assign({}, base318, { version: MM_VERSION_318 });
    }

    const deltas318 = (base318.cumulativeDeltas || [])
      .map(e318 => (e318 && typeof e318.normDelta === 'number' && isFinite(e318.normDelta))
        ? e318.normDelta : null)
      .filter(v318 => v318 !== null);

    let volatility318 = null;
    if (deltas318.length > 0) {
      const mean318 = deltas318.reduce((a, b) => a + b, 0) / deltas318.length;
      const variance318 = deltas318.reduce((a, d) => a + (d - mean318) ** 2, 0) / deltas318.length;
      volatility318 = Math.sqrt(variance318);
    }

    return Object.assign({}, base318, {
      volatilityIndex: volatility318,
      version:         MM_VERSION_318,
    });
  }

  stats() {
    const base318 = super.stats();
    return Object.assign({}, base318, { version: MM_VERSION_318 });
  }
}

let _defaultNormDeltaPercentilesTracker318 = null;
function defaultNormDeltaPercentilesTracker318(opts) {
  if (!_defaultNormDeltaPercentilesTracker318 || opts) {
    _defaultNormDeltaPercentilesTracker318 = new NormDeltaPercentilesTracker318(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker318;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

function registerV318Endpoints(app) {
  const trail318   = defaultAuditCapTrail318();
  const bridge318  = defaultPageRangeDiffBridge318();
  const buffer318  = defaultRankedOverlapBuffer318();
  const tracker318 = defaultNormDeltaPercentilesTracker318();

  // 1. GET audit cap forecast
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v318/aggregate/db/hydrate/audit/cap/forecast',
    (req, res) => {
      try {
        const n318 = req.query.n ? Number(req.query.n) : undefined;
        res.json(trail318.auditCapForecast318(n318));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_318 });
      }
    }
  );

  // 2. GET diff audit page range outliers
  app.get(
    '/api/v1/market/alerts/suppress/config/v318/diff/audit/filter/paged/range/outliers',
    (req, res) => {
      try {
        const from318      = Number(req.query.from);
        const to318        = Number(req.query.to);
        const startPage318 = req.query.startPage ? Number(req.query.startPage) : 1;
        const endPage318   = req.query.endPage   ? Number(req.query.endPage)   : startPage318;
        const pageSize318  = req.query.pageSize  ? Number(req.query.pageSize)  : 20;
        const stdFactor318 = req.query.stdFactor ? Number(req.query.stdFactor) : 2.0;
        res.json(bridge318.pagedDiffPageRangeOutliers318(from318, to318, startPage318, endPage318, pageSize318, stdFactor318));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_318 });
      }
    }
  );

  // 3. POST token overlap semantic
  app.post(
    '/api/v1/market/backtest/sessions/v318/snapshot/search/ranked/multi/overlap/semantic',
    (req, res) => {
      try {
        const tokens318 = req.body ? req.body.tokens : undefined;
        const n318      = req.query.n ? Number(req.query.n) : undefined;
        res.json(buffer318.multiSearchOverlapSemantic318(tokens318, n318));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_318 });
      }
    }
  );

  // 4. GET cumulative delta volatility
  app.get(
    '/api/v1/contracts/receipts/v318/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility',
    (req, res) => {
      try {
        const source318   = req.query.source   || '';
        const windowMs318 = req.query.windowMs ? Number(req.query.windowMs) : 60000;
        const buckets318  = req.query.buckets  ? Number(req.query.buckets)  : 5;
        const baseline318 = req.query.baseline !== undefined ? Number(req.query.baseline) : 0;
        const elevated318 = req.query.elevated ? Number(req.query.elevated) : 1.5;
        const spike318    = req.query.spike    ? Number(req.query.spike)    : 3.0;
        res.json(tracker318.trendNormDeltaVolatility318(source318, windowMs318, buckets318, baseline318, { elevated: elevated318, spike: spike318 }));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_318 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_318,
  _coercePositiveInt318,
  SEMANTIC_DICT_318,
  _expandSemantic318,
  AuditCapTrail318,
  defaultAuditCapTrail318,
  PageRangeDiffBridge318,
  defaultPageRangeDiffBridge318,
  RankedOverlapBuffer318,
  defaultRankedOverlapBuffer318,
  NormDeltaPercentilesTracker318,
  defaultNormDeltaPercentilesTracker318,
  registerV318Endpoints,
};
