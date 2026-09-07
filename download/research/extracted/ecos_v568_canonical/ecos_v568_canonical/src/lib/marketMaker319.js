'use strict';
/**
 * src/lib/marketMaker319.js — ECOS V319 (Phase P207) — Forecast Confidence Intervals,
 *                              Outlier Severity Scoring, Semantic Group Expansion,
 *                              Volatility Trend Delta
 *
 * Four additive components that extend the V318 analytical layer:
 *
 *   1. AuditCapTrail319 — auditCapForecastConfidence319(n, alpha)
 *      extends V318 linear regression forecast with residual-based confidence intervals.
 *
 *   2. PageRangeDiffBridge319 — pagedDiffOutlierSeverity319(...)
 *      scores each outlier page by its Z-score distance above the threshold.
 *
 *   3. RankedOverlapBuffer319 — semanticGroupExpansion319(token)
 *      returns all tokens in SEMANTIC_DICT_318 that share a common group label
 *      with the given query token.
 *
 *   4. NormDeltaPercentilesTracker319 — trendNormDeltaVolatilityDelta319(...)
 *      compares volatility index across two time windows and returns the delta.
 *
 * Sacred files untouched (R1). All new identifiers end in `319` (R2).
 * Zero new npm deps (R3). V287..V318 surfaces preserved (R6).
 * lib/ mirrors src/lib/. package.json bumped to 319.0.0.
 *
 * @version 319.0.0
 */

const V318 = require('./marketMaker318.js');

const MM_VERSION_319 = '319.0.0';

function _coercePositiveInt319(value, fallback319) {
  const n319 = Number(value);
  if (!Number.isFinite(n319) || !Number.isInteger(n319) || n319 < 1) return fallback319;
  return n319;
}

function _coercePositiveFloat319(value, fallback319) {
  const f319 = Number(value);
  if (!Number.isFinite(f319) || f319 <= 0) return fallback319;
  return f319;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail319
//    Extends AuditCapTrail318 with forecast confidence intervals.
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail319 extends V318.AuditCapTrail318 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * auditCapForecastConfidence319(n, alpha)
   * Extends auditCapForecast318(n) with a confidence interval around each
   * predicted cap value.
   *
   * The interval half-width is: t_alpha * SE_pred
   *   where SE_pred = s * sqrt(1 + 1/N + (x_new - x_mean)^2 / SS_xx)
   *   and   s = sqrt(SSR / (N - 2))  (residual standard error)
   *
   * For small samples (N < 3), we fall back to a simple ± s bound.
   * t_alpha is approximated from the normal distribution using the
   * rational approximation for common alpha levels.
   *
   * @param {number} [n]     — number of future steps (default 3, max 20)
   * @param {number} [alpha] — significance level, e.g. 0.05 for 95% CI (default 0.05)
   * @returns {{ ok, forecast: Array<{step, predictedCap, lowerCI, upperCI}>,
   *             slope, intercept, residualSE, alpha, version }}
   */
  auditCapForecastConfidence319(n, alpha) {
    const base319 = this.auditCapForecast318(n);
    if (!base319.ok) {
      return Object.assign({}, base319, { version: MM_VERSION_319 });
    }

    const entries319 = this.auditCapHistory314();
    if (!entries319.ok) {
      return Object.assign({}, entries319, { version: MM_VERSION_319 });
    }

    const ys319  = (entries319.entries || []).map(e => (typeof e.cap === 'number' ? e.cap : 0));
    const N319   = ys319.length;
    const xs319  = ys319.map((_, i) => i);
    const sl319  = base319.slope;
    const ic319  = base319.intercept;
    const xMean319 = xs319.reduce((a, b) => a + b, 0) / N319;
    const ssxx319  = xs319.reduce((a, x) => a + (x - xMean319) ** 2, 0);

    // Residual Sum of Squares
    const ssr319 = ys319.reduce((a, y, i) => a + (y - (sl319 * xs319[i] + ic319)) ** 2, 0);
    const df319  = N319 - 2;
    const s319   = df319 > 0 ? Math.sqrt(ssr319 / df319) : 0;

    // t-critical approximation via standard normal quantile (Beasley-Springer-Moro)
    const a319 = typeof alpha === 'number' && alpha > 0 && alpha < 1 ? alpha : 0.05;
    const tCrit319 = _normalQuantile319(1 - a319 / 2);

    const forecast319 = base319.forecast.map((pt319) => {
      const xNew319    = N319 - 1 + pt319.step;
      const sePred319  = ssxx319 > 0
        ? s319 * Math.sqrt(1 + 1 / N319 + (xNew319 - xMean319) ** 2 / ssxx319)
        : s319;
      const halfW319   = tCrit319 * sePred319;
      return {
        step:         pt319.step,
        predictedCap: pt319.predictedCap,
        lowerCI:      pt319.predictedCap - halfW319,
        upperCI:      pt319.predictedCap + halfW319,
      };
    });

    return {
      ok:         true,
      forecast:   forecast319,
      slope:      base319.slope,
      intercept:  base319.intercept,
      residualSE: s319,
      alpha:      a319,
      n:          base319.n,
      version:    MM_VERSION_319,
    };
  }

  stats() {
    const base319 = super.stats();
    return Object.assign({}, base319, { version: MM_VERSION_319 });
  }
}

/**
 * Standard normal quantile (inverse CDF) — rational approximation.
 * Accurate to ~4 decimal places for p in [0.0001, 0.9999].
 */
function _normalQuantile319(p319) {
  if (p319 <= 0) return -Infinity;
  if (p319 >= 1) return Infinity;
  if (p319 === 0.5) return 0;
  const sign319 = p319 > 0.5 ? 1 : -1;
  const q319 = p319 > 0.5 ? 1 - p319 : p319;
  const t319 = Math.sqrt(-2 * Math.log(q319));
  const c0319 = 2.515517, c1319 = 0.802853, c2319 = 0.010328;
  const d1319 = 1.432788, d2319 = 0.189269, d3319 = 0.001308;
  const num319 = c0319 + c1319 * t319 + c2319 * t319 * t319;
  const den319 = 1 + d1319 * t319 + d2319 * t319 * t319 + d3319 * t319 * t319 * t319;
  return sign319 * (t319 - num319 / den319);
}

let _defaultAuditCapTrail319 = null;
function defaultAuditCapTrail319(opts) {
  if (!_defaultAuditCapTrail319 || opts) {
    _defaultAuditCapTrail319 = new AuditCapTrail319(opts || {});
  }
  return _defaultAuditCapTrail319;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge319
//    Extends PageRangeDiffBridge318 with outlier severity scoring.
// ─────────────────────────────────────────────────────────────────────────────

class PageRangeDiffBridge319 extends V318.PageRangeDiffBridge318 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * pagedDiffOutlierSeverity319(from, to, startPage, endPage, pageSize, stdFactor)
   * Extends pagedDiffPageRangeOutliers318 with a severity score per outlier:
   *   severity = (entryCount - threshold) / stdDev   (Z-score above threshold)
   *
   * @returns {{ ok, scoredOutliers: Array<{page, entryCount, severity}>,
   *             mean, stdDev, threshold, version }}
   */
  pagedDiffOutlierSeverity319(from, to, startPage, endPage, pageSize, stdFactor) {
    const base319 = this.pagedDiffPageRangeOutliers318(from, to, startPage, endPage, pageSize, stdFactor);
    if (!base319.ok) {
      return Object.assign({}, base319, { version: MM_VERSION_319 });
    }

    const scored319 = (base319.outliers || []).map(o319 => {
      const severity319 = base319.stdDev > 0
        ? (o319.entryCount - base319.threshold) / base319.stdDev
        : 0;
      return Object.assign({}, o319, { severity: severity319 });
    });

    // Sort by severity descending
    scored319.sort((a, b) => b.severity - a.severity);

    return Object.assign({}, base319, {
      scoredOutliers: scored319,
      version:        MM_VERSION_319,
    });
  }

  stats() {
    const base319 = super.stats();
    return Object.assign({}, base319, { version: MM_VERSION_319 });
  }
}

let _defaultPageRangeDiffBridge319 = null;
function defaultPageRangeDiffBridge319(opts) {
  if (!_defaultPageRangeDiffBridge319 || opts) {
    _defaultPageRangeDiffBridge319 = new PageRangeDiffBridge319(opts || {});
  }
  return _defaultPageRangeDiffBridge319;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer319
//    Extends RankedOverlapBuffer318 with semantic group expansion.
// ─────────────────────────────────────────────────────────────────────────────

class RankedOverlapBuffer319 extends V318.RankedOverlapBuffer318 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * semanticGroupExpansion319(token)
   * Returns all tokens in SEMANTIC_DICT_318 that share at least one common
   * group label with the given query token.
   *
   * A "group label" is any value (synonym) that appears in both the query
   * token's expansion and the candidate token's expansion.
   *
   * @param {string} token
   * @returns {{ ok, token, groupLabels, groupPeers: Array<{token, sharedLabels}>, version }}
   */
  semanticGroupExpansion319(token) {
    if (typeof token !== 'string' || token.trim() === '') {
      return { ok: false, error: 'Token must be a non-empty string', version: MM_VERSION_319 };
    }

    const dict319  = V318.SEMANTIC_DICT_318;
    const expand319 = V318._expandSemantic318;
    const t319     = token.toLowerCase().trim();
    const myExp319 = new Set(expand319(t319));

    const peers319 = [];
    const allTokens319 = Object.keys(dict319);

    for (const candidate319 of allTokens319) {
      if (candidate319 === t319) continue;
      const candExp319 = expand319(candidate319);
      const shared319  = candExp319.filter(v => myExp319.has(v));
      if (shared319.length > 0) {
        peers319.push({ token: candidate319, sharedLabels: shared319 });
      }
    }

    // Sort by number of shared labels descending
    peers319.sort((a, b) => b.sharedLabels.length - a.sharedLabels.length);

    // Collect group labels (intersection of this token's expansion and all peers)
    const groupLabels319 = Array.from(myExp319).filter(lbl319 =>
      peers319.some(p => p.sharedLabels.includes(lbl319))
    );

    return {
      ok:          true,
      token:       t319,
      groupLabels: groupLabels319,
      groupPeers:  peers319,
      version:     MM_VERSION_319,
    };
  }

  stats() {
    const base319 = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base319, { version: MM_VERSION_319 });
  }
}

let _defaultRankedOverlapBuffer319 = null;
function defaultRankedOverlapBuffer319(opts) {
  if (!_defaultRankedOverlapBuffer319 || opts) {
    _defaultRankedOverlapBuffer319 = new RankedOverlapBuffer319(opts || {});
  }
  return _defaultRankedOverlapBuffer319;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker319
//    Extends NormDeltaPercentilesTracker318 with volatility trend delta.
// ─────────────────────────────────────────────────────────────────────────────

class NormDeltaPercentilesTracker319 extends V318.NormDeltaPercentilesTracker318 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * trendNormDeltaVolatilityDelta319(source, windowMs, buckets, baseline,
   *                                   thresholds, compareWindowMs)
   *
   * Computes volatilityIndex for two windows:
   *   window1: windowMs (primary)
   *   window2: compareWindowMs (comparison, default windowMs * 2)
   *
   * Returns both indices and the delta (window1 - window2).
   * A positive delta means volatility is increasing relative to the longer window.
   *
   * @param {number} [compareWindowMs] — second window size in ms (default 2× windowMs)
   * @returns {{ ok, volatilityIndex, compareVolatilityIndex, volatilityDelta, version }}
   */
  trendNormDeltaVolatilityDelta319(source, windowMs, buckets, baseline, thresholds, compareWindowMs) {
    const wMs319 = _coercePositiveFloat319(windowMs, 60000);
    const cWMs319 = _coercePositiveFloat319(compareWindowMs, wMs319 * 2);

    const r1319 = this.trendNormDeltaVolatility318(source, wMs319, buckets, baseline, thresholds);
    if (!r1319.ok) {
      return Object.assign({}, r1319, { version: MM_VERSION_319 });
    }

    const r2319 = this.trendNormDeltaVolatility318(source, cWMs319, buckets, baseline, thresholds);
    if (!r2319.ok) {
      return Object.assign({}, r2319, { version: MM_VERSION_319 });
    }

    const vi1319   = r1319.volatilityIndex;
    const vi2319   = r2319.volatilityIndex;
    const delta319 = (vi1319 !== null && vi2319 !== null)
      ? vi1319 - vi2319
      : null;

    return Object.assign({}, r1319, {
      volatilityIndex:        vi1319,
      compareWindowMs:        cWMs319,
      compareVolatilityIndex: vi2319,
      volatilityDelta:        delta319,
      version:                MM_VERSION_319,
    });
  }

  stats() {
    const base319 = super.stats();
    return Object.assign({}, base319, { version: MM_VERSION_319 });
  }
}

let _defaultNormDeltaPercentilesTracker319 = null;
function defaultNormDeltaPercentilesTracker319(opts) {
  if (!_defaultNormDeltaPercentilesTracker319 || opts) {
    _defaultNormDeltaPercentilesTracker319 = new NormDeltaPercentilesTracker319(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker319;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

function registerV319Endpoints(app) {
  const trail319   = defaultAuditCapTrail319();
  const bridge319  = defaultPageRangeDiffBridge319();
  const buffer319  = defaultRankedOverlapBuffer319();
  const tracker319 = defaultNormDeltaPercentilesTracker319();

  // 1. GET audit cap forecast with confidence intervals
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v319/aggregate/db/hydrate/audit/cap/forecast/confidence',
    (req, res) => {
      try {
        const n319     = req.query.n     ? Number(req.query.n)     : undefined;
        const alpha319 = req.query.alpha ? Number(req.query.alpha) : undefined;
        res.json(trail319.auditCapForecastConfidence319(n319, alpha319));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_319 });
      }
    }
  );

  // 2. GET diff audit page outlier severity
  app.get(
    '/api/v1/market/alerts/suppress/config/v319/diff/audit/filter/paged/range/outliers/severity',
    (req, res) => {
      try {
        const from319      = Number(req.query.from);
        const to319        = Number(req.query.to);
        const startPage319 = req.query.startPage ? Number(req.query.startPage) : 1;
        const endPage319   = req.query.endPage   ? Number(req.query.endPage)   : startPage319;
        const pageSize319  = req.query.pageSize  ? Number(req.query.pageSize)  : 20;
        const stdFactor319 = req.query.stdFactor ? Number(req.query.stdFactor) : 2.0;
        res.json(bridge319.pagedDiffOutlierSeverity319(from319, to319, startPage319, endPage319, pageSize319, stdFactor319));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_319 });
      }
    }
  );

  // 3. GET semantic group expansion for a token
  app.get(
    '/api/v1/market/backtest/sessions/v319/snapshot/search/ranked/semantic/group/expand',
    (req, res) => {
      try {
        const token319 = req.query.token || '';
        res.json(buffer319.semanticGroupExpansion319(token319));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_319 });
      }
    }
  );

  // 4. GET cumulative delta volatility trend delta (two windows)
  app.get(
    '/api/v1/contracts/receipts/v319/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/delta',
    (req, res) => {
      try {
        const source319      = req.query.source   || '';
        const windowMs319    = req.query.windowMs ? Number(req.query.windowMs) : 60000;
        const buckets319     = req.query.buckets  ? Number(req.query.buckets)  : 5;
        const baseline319    = req.query.baseline !== undefined ? Number(req.query.baseline) : 0;
        const elevated319    = req.query.elevated ? Number(req.query.elevated) : 1.5;
        const spike319       = req.query.spike    ? Number(req.query.spike)    : 3.0;
        const cmpWindowMs319 = req.query.compareWindowMs ? Number(req.query.compareWindowMs) : undefined;
        res.json(tracker319.trendNormDeltaVolatilityDelta319(source319, windowMs319, buckets319, baseline319, { elevated: elevated319, spike: spike319 }, cmpWindowMs319));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_319 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_319,
  _coercePositiveInt319,
  _coercePositiveFloat319,
  _normalQuantile319,
  AuditCapTrail319,
  defaultAuditCapTrail319,
  PageRangeDiffBridge319,
  defaultPageRangeDiffBridge319,
  RankedOverlapBuffer319,
  defaultRankedOverlapBuffer319,
  NormDeltaPercentilesTracker319,
  defaultNormDeltaPercentilesTracker319,
  registerV319Endpoints,
};
