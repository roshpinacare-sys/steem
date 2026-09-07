'use strict';
/**
 * src/lib/marketMaker320.js — ECOS V320 (Phase P208) — Multi-step Confidence Bands,
 *                              Compound Severity Index, Semantic Similarity Matrix,
 *                              Volatility Regime Classifier
 *
 * Four additive components that extend the V319 analytical layer:
 *
 *   1. AuditCapTrail320 — auditCapForecastWidening320(n, alpha)
 *      extends V319 confidence intervals with horizon-widening bands (variance grows
 *      proportional to the forecast step).
 *
 *   2. PageRangeDiffBridge320 — pagedDiffCompoundSeverity320(...)
 *      aggregates per-outlier severity scores (from V319) into a single composite index:
 *      sum, max, and entropy of severity values.
 *
 *   3. RankedOverlapBuffer320 — semanticSimilarityMatrix320(tokens)
 *      builds a pairwise Jaccard similarity matrix over a provided token list using
 *      shared group labels derived from SEMANTIC_DICT_318.
 *
 *   4. NormDeltaPercentilesTracker320 — trendNormDeltaRegimeClassifier320(...)
 *      uses the V319 volatility delta to classify the market regime as
 *      "stable", "increasing", or "decreasing" with configurable thresholds.
 *
 * Sacred files untouched (R1). All new identifiers end in `320` (R2).
 * Zero new npm deps (R3). V287..V319 surfaces preserved (R6).
 * lib/ mirrors src/lib/. package.json bumped to 320.0.0.
 *
 * @version 320.0.0
 */

const V319 = require('./marketMaker319.js');
const V318 = require('./marketMaker318.js');

const MM_VERSION_320 = '320.0.0';

function _coercePositiveInt320(value, fallback320) {
  const n320 = Number(value);
  if (!Number.isFinite(n320) || !Number.isInteger(n320) || n320 < 1) return fallback320;
  return n320;
}

function _coercePositiveFloat320(value, fallback320) {
  const f320 = Number(value);
  if (!Number.isFinite(f320) || f320 <= 0) return fallback320;
  return f320;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail320
//    Extends AuditCapTrail319 with horizon-widening forecast confidence bands.
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail320 extends V319.AuditCapTrail319 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * auditCapForecastWidening320(n, alpha)
   * Extends V319 confidence intervals so that bands widen with the forecast
   * horizon. The prediction variance at step s is:
   *
   *   Var_pred(s) = s² * s_step² + base_var
   *
   * where:
   *   base_var  = s² * (1 + 1/N + (x_new − x_mean)² / SS_xx)
   *   s_step²   = slope-scaled residual variance per unit step (s² / N)
   *
   * In practice this adds a per-step widening factor proportional to
   * step * residualSE / sqrt(N), giving increasingly conservative intervals
   * for further-out predictions.
   *
   * @param {number} [n]     — forecast steps (default 3, max 20)
   * @param {number} [alpha] — significance level (default 0.05 → 95% CI)
   * @returns {{ ok, forecast: Array<{step, predictedCap, lowerCI, upperCI, halfWidth}>,
   *             slope, intercept, residualSE, alpha, version }}
   */
  auditCapForecastWidening320(n, alpha) {
    const base320 = this.auditCapForecastConfidence319(n, alpha);
    if (!base320.ok) {
      return Object.assign({}, base320, { version: MM_VERSION_320 });
    }

    const entries320 = this.auditCapHistory314();
    if (!entries320.ok) {
      return Object.assign({}, entries320, { version: MM_VERSION_320 });
    }

    const N320      = (entries320.entries || []).length;
    const s320      = base320.residualSE;
    const a320      = base320.alpha;
    const tCrit320  = V319._normalQuantile319(1 - a320 / 2);

    // Per-step widening increment (residualSE / sqrt(N) per step)
    const stepInc320 = N320 > 0 ? s320 / Math.sqrt(N320) : 0;

    const forecast320 = base320.forecast.map(pt320 => {
      // Base half-width from V319
      const baseHW320 = (pt320.upperCI - pt320.predictedCap);
      // Additional widening: tCrit * stepInc * step
      const wideExtra320 = tCrit320 * stepInc320 * pt320.step;
      const halfW320 = baseHW320 + wideExtra320;
      return {
        step:         pt320.step,
        predictedCap: pt320.predictedCap,
        lowerCI:      pt320.predictedCap - halfW320,
        upperCI:      pt320.predictedCap + halfW320,
        halfWidth:    halfW320,
      };
    });

    return {
      ok:         true,
      forecast:   forecast320,
      slope:      base320.slope,
      intercept:  base320.intercept,
      residualSE: s320,
      alpha:      a320,
      n:          base320.n,
      version:    MM_VERSION_320,
    };
  }

  stats() {
    const base320 = super.stats();
    return Object.assign({}, base320, { version: MM_VERSION_320 });
  }
}

let _defaultAuditCapTrail320 = null;
function defaultAuditCapTrail320(opts) {
  if (!_defaultAuditCapTrail320 || opts) {
    _defaultAuditCapTrail320 = new AuditCapTrail320(opts || {});
  }
  return _defaultAuditCapTrail320;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge320
//    Extends PageRangeDiffBridge319 with a compound severity index.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shannon entropy of a normalised probability distribution.
 * Input: array of non-negative numbers (magnitudes).
 */
function _severityEntropy320(values320) {
  const total320 = values320.reduce((a, b) => a + Math.abs(b), 0);
  if (total320 === 0) return 0;
  return values320.reduce((acc320, v320) => {
    const p320 = Math.abs(v320) / total320;
    return acc320 - (p320 > 0 ? p320 * Math.log2(p320) : 0);
  }, 0);
}

class PageRangeDiffBridge320 extends V319.PageRangeDiffBridge319 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * pagedDiffCompoundSeverity320(from, to, startPage, endPage, pageSize, stdFactor)
   * Extends pagedDiffOutlierSeverity319 with a compound severity index object
   * containing sum, max, and entropy of all outlier severity values.
   *
   * @returns {{ ok, scoredOutliers, compoundSeverity: {sum, max, entropy, count},
   *             mean, stdDev, threshold, version }}
   */
  pagedDiffCompoundSeverity320(from, to, startPage, endPage, pageSize, stdFactor) {
    const base320 = this.pagedDiffOutlierSeverity319(from, to, startPage, endPage, pageSize, stdFactor);
    if (!base320.ok) {
      return Object.assign({}, base320, { version: MM_VERSION_320 });
    }

    const severities320 = (base320.scoredOutliers || []).map(o => o.severity);

    const compound320 = {
      sum:     severities320.reduce((a, b) => a + b, 0),
      max:     severities320.length > 0 ? Math.max(...severities320) : 0,
      entropy: _severityEntropy320(severities320),
      count:   severities320.length,
    };

    return Object.assign({}, base320, {
      compoundSeverity: compound320,
      version:          MM_VERSION_320,
    });
  }

  stats() {
    const base320 = super.stats();
    return Object.assign({}, base320, { version: MM_VERSION_320 });
  }
}

let _defaultPageRangeDiffBridge320 = null;
function defaultPageRangeDiffBridge320(opts) {
  if (!_defaultPageRangeDiffBridge320 || opts) {
    _defaultPageRangeDiffBridge320 = new PageRangeDiffBridge320(opts || {});
  }
  return _defaultPageRangeDiffBridge320;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer320
//    Extends RankedOverlapBuffer319 with a pairwise semantic similarity matrix.
// ─────────────────────────────────────────────────────────────────────────────

class RankedOverlapBuffer320 extends V319.RankedOverlapBuffer319 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * semanticSimilarityMatrix320(tokens)
   * Builds a pairwise Jaccard similarity matrix over the provided token list.
   * For each pair (A, B):
   *   jaccard = |expand(A) ∩ expand(B)| / |expand(A) ∪ expand(B)|
   *
   * @param {string[]} tokens
   * @returns {{ ok, tokens, matrix: Array<{tokenA, tokenB, jaccard}>, version }}
   */
  semanticSimilarityMatrix320(tokens) {
    const reqTokens320 = Array.isArray(tokens)
      ? tokens.map(t => String(t).toLowerCase().trim()).filter(Boolean)
      : [];

    if (reqTokens320.length < 2) {
      return {
        ok:      false,
        error:   'Need at least 2 tokens to build a similarity matrix',
        version: MM_VERSION_320,
      };
    }

    const expand320 = V318._expandSemantic318;

    // Pre-compute expansion sets
    const expansions320 = {};
    reqTokens320.forEach(t320 => {
      expansions320[t320] = new Set(expand320(t320));
    });

    const matrix320 = [];
    for (let i320 = 0; i320 < reqTokens320.length; i320++) {
      for (let j320 = i320 + 1; j320 < reqTokens320.length; j320++) {
        const tA320 = reqTokens320[i320];
        const tB320 = reqTokens320[j320];
        const setA320 = expansions320[tA320];
        const setB320 = expansions320[tB320];

        const intersection320 = [...setA320].filter(v => setB320.has(v)).length;
        const union320 = new Set([...setA320, ...setB320]).size;
        const jaccard320 = union320 > 0 ? intersection320 / union320 : 0;

        matrix320.push({ tokenA: tA320, tokenB: tB320, jaccard: jaccard320 });
      }
    }

    // Sort by jaccard descending
    matrix320.sort((a, b) => b.jaccard - a.jaccard);

    return {
      ok:      true,
      tokens:  reqTokens320,
      matrix:  matrix320,
      version: MM_VERSION_320,
    };
  }

  stats() {
    const base320 = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base320, { version: MM_VERSION_320 });
  }
}

let _defaultRankedOverlapBuffer320 = null;
function defaultRankedOverlapBuffer320(opts) {
  if (!_defaultRankedOverlapBuffer320 || opts) {
    _defaultRankedOverlapBuffer320 = new RankedOverlapBuffer320(opts || {});
  }
  return _defaultRankedOverlapBuffer320;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker320
//    Extends NormDeltaPercentilesTracker319 with a volatility regime classifier.
// ─────────────────────────────────────────────────────────────────────────────

const REGIME_INCREASING_320 = 'increasing';
const REGIME_DECREASING_320 = 'decreasing';
const REGIME_STABLE_320     = 'stable';

class NormDeltaPercentilesTracker320 extends V319.NormDeltaPercentilesTracker319 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * trendNormDeltaRegimeClassifier320(source, windowMs, buckets, baseline,
   *                                    thresholds, compareWindowMs,
   *                                    regimeThresholds)
   *
   * Calls trendNormDeltaVolatilityDelta319 to get the volatility delta, then
   * classifies the regime:
   *   - volatilityDelta > regimeThresholds.increasing → "increasing"
   *   - volatilityDelta < -regimeThresholds.decreasing → "decreasing"
   *   - otherwise → "stable"
   *
   * @param {object} [regimeThresholds] — { increasing: number, decreasing: number }
   *   defaults to { increasing: 0.05, decreasing: 0.05 }
   * @returns {{ ok, regime, volatilityDelta, volatilityIndex,
   *             compareVolatilityIndex, version }}
   */
  trendNormDeltaRegimeClassifier320(source, windowMs, buckets, baseline, thresholds, compareWindowMs, regimeThresholds) {
    const base320 = this.trendNormDeltaVolatilityDelta319(source, windowMs, buckets, baseline, thresholds, compareWindowMs);
    if (!base320.ok) {
      return Object.assign({}, base320, { version: MM_VERSION_320 });
    }

    const rt320 = (regimeThresholds && typeof regimeThresholds === 'object') ? regimeThresholds : {};
    const incThresh320 = _coercePositiveFloat320(rt320.increasing, 0.05);
    const decThresh320 = _coercePositiveFloat320(rt320.decreasing, 0.05);

    let regime320 = REGIME_STABLE_320;
    const delta320 = base320.volatilityDelta;

    if (delta320 !== null) {
      if (delta320 > incThresh320) {
        regime320 = REGIME_INCREASING_320;
      } else if (delta320 < -decThresh320) {
        regime320 = REGIME_DECREASING_320;
      }
    }

    return Object.assign({}, base320, {
      regime:  regime320,
      version: MM_VERSION_320,
    });
  }

  stats() {
    const base320 = super.stats();
    return Object.assign({}, base320, { version: MM_VERSION_320 });
  }
}

let _defaultNormDeltaPercentilesTracker320 = null;
function defaultNormDeltaPercentilesTracker320(opts) {
  if (!_defaultNormDeltaPercentilesTracker320 || opts) {
    _defaultNormDeltaPercentilesTracker320 = new NormDeltaPercentilesTracker320(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker320;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

function registerV320Endpoints(app) {
  const trail320   = defaultAuditCapTrail320();
  const bridge320  = defaultPageRangeDiffBridge320();
  const buffer320  = defaultRankedOverlapBuffer320();
  const tracker320 = defaultNormDeltaPercentilesTracker320();

  // 1. GET widening forecast confidence bands
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v320/aggregate/db/hydrate/audit/cap/forecast/confidence/widening',
    (req, res) => {
      try {
        const n320     = req.query.n     ? Number(req.query.n)     : undefined;
        const alpha320 = req.query.alpha ? Number(req.query.alpha) : undefined;
        res.json(trail320.auditCapForecastWidening320(n320, alpha320));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_320 });
      }
    }
  );

  // 2. GET compound outlier severity index
  app.get(
    '/api/v1/market/alerts/suppress/config/v320/diff/audit/filter/paged/range/outliers/severity/compound',
    (req, res) => {
      try {
        const from320      = Number(req.query.from);
        const to320        = Number(req.query.to);
        const startPage320 = req.query.startPage ? Number(req.query.startPage) : 1;
        const endPage320   = req.query.endPage   ? Number(req.query.endPage)   : startPage320;
        const pageSize320  = req.query.pageSize  ? Number(req.query.pageSize)  : 20;
        const stdFactor320 = req.query.stdFactor ? Number(req.query.stdFactor) : 2.0;
        res.json(bridge320.pagedDiffCompoundSeverity320(from320, to320, startPage320, endPage320, pageSize320, stdFactor320));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_320 });
      }
    }
  );

  // 3. POST semantic similarity matrix
  app.post(
    '/api/v1/market/backtest/sessions/v320/snapshot/search/ranked/semantic/similarity/matrix',
    (req, res) => {
      try {
        const tokens320 = req.body ? req.body.tokens : undefined;
        res.json(buffer320.semanticSimilarityMatrix320(tokens320));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_320 });
      }
    }
  );

  // 4. GET volatility regime classification
  app.get(
    '/api/v1/contracts/receipts/v320/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime',
    (req, res) => {
      try {
        const source320     = req.query.source   || '';
        const windowMs320   = req.query.windowMs ? Number(req.query.windowMs) : 60000;
        const buckets320    = req.query.buckets  ? Number(req.query.buckets)  : 5;
        const baseline320   = req.query.baseline !== undefined ? Number(req.query.baseline) : 0;
        const elevated320   = req.query.elevated ? Number(req.query.elevated) : 1.5;
        const spike320      = req.query.spike    ? Number(req.query.spike)    : 3.0;
        const cmpWMs320     = req.query.compareWindowMs ? Number(req.query.compareWindowMs) : undefined;
        const incThr320     = req.query.increasing ? Number(req.query.increasing) : 0.05;
        const decThr320     = req.query.decreasing ? Number(req.query.decreasing) : 0.05;
        res.json(tracker320.trendNormDeltaRegimeClassifier320(
          source320, windowMs320, buckets320, baseline320,
          { elevated: elevated320, spike: spike320 },
          cmpWMs320,
          { increasing: incThr320, decreasing: decThr320 }
        ));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_320 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_320,
  REGIME_INCREASING_320,
  REGIME_DECREASING_320,
  REGIME_STABLE_320,
  _coercePositiveInt320,
  _coercePositiveFloat320,
  _severityEntropy320,
  AuditCapTrail320,
  defaultAuditCapTrail320,
  PageRangeDiffBridge320,
  defaultPageRangeDiffBridge320,
  RankedOverlapBuffer320,
  defaultRankedOverlapBuffer320,
  NormDeltaPercentilesTracker320,
  defaultNormDeltaPercentilesTracker320,
  registerV320Endpoints,
};
