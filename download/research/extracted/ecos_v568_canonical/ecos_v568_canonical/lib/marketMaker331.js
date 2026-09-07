'use strict';
/**
 * src/lib/marketMaker331.js — ECOS V331 (Phase P219) — Convergence Acceleration,
 *                              Percentile IQR Spread, Band Width Trend, Transition Entropy
 *
 * Four additive components that extend the V330 analytical layer:
 *
 *   1. AuditCapTrail331 — detectConvergenceAcceleration331()
 *      Computes second-order differences of the smoothed EMA series (differences of
 *      consecutive |step| values). Returns secondOrderSum, secondOrderCount, and
 *      meanSecondOrderStep (null when secondOrderCount = 0). A negative value indicates
 *      accelerating convergence.
 *
 *   2. PageRangeDiffBridge331 — computeAccelerationIQRSpread331()
 *      Calls computeMomentumAccelerationPercentiles330 and returns:
 *      iqrSpread = p75 - p25 (null when either is null),
 *      normalizedIQR = iqrSpread / |p50| (null when p50 null/zero or iqrSpread null).
 *
 *   3. RankedOverlapBuffer331 — trackEntropyBandWidthTrend331(snapshotTokenSets, threshold, windowSize)
 *      Calls forecastEntropyConfidenceBand330, computes bandWidth = upper - lower
 *      (null when either is null). Maintains internal ring buffer _bandWidthHistory331
 *      (max 50). Returns bandWidth, meanBandWidth (null when empty), bandWidthTrend
 *      (second-half mean - first-half mean, null when ring has < 2 entries).
 *
 *   4. NormDeltaPercentilesTracker331 — computeTransitionEntropy331(regime)
 *      Computes Shannon entropy H = -sum(p_i * log2(p_i)) of the transition frequency
 *      distribution. Returns distinctTransitions (count of unique zone-pair types) and
 *      transitionEntropy (null when no transitions exist).
 *
 * Sacred files untouched (R1). All new identifiers end in `331` (R2).
 * Zero new npm deps (R3). V287..V330 surfaces preserved (R6).
 * lib/ mirrors src/lib/. package.json bumped to 331.0.0.
 *
 * @version 331.0.0
 */

const V330 = require('./marketMaker330.js');
const V329 = require('./marketMaker329.js');

const MM_VERSION_331 = '331.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail331
//    Extends AuditCapTrail330 with second-order convergence acceleration.
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail331 extends V330.AuditCapTrail330 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * detectConvergenceAcceleration331()
   *
   * Calls detectSmoothedCvConvergence330() then re-computes the smoothed EMA series
   * to derive second-order differences: the differences of consecutive absolute step
   * values |smoothed[i] - smoothed[i-1]|.
   *
   * Returns:
   *   - secondOrderSum:       sum of all second-order differences (step diffs)
   *   - secondOrderCount:     count of second-order differences (= convergenceSteps - 1)
   *   - meanSecondOrderStep:  secondOrderSum / secondOrderCount (null when = 0)
   *     A negative value indicates accelerating convergence.
   *
   * Returns all fields from detectSmoothedCvConvergence330() plus the three above.
   *
   * @returns {{ ok, streakCount, ..., convergenceSum, convergenceSteps,
   *             meanConvergenceStep, secondOrderSum, secondOrderCount,
   *             meanSecondOrderStep, version }}
   */
  detectConvergenceAcceleration331() {
    const base331 = this.detectSmoothedCvConvergence330();

    const V328module331 = require('./marketMaker328.js');
    const lengths331 = V328module331._collectStreakLengths328(this._maeAlertHistory323);
    const n331 = lengths331.length;

    let secondOrderSum331   = 0;
    let secondOrderCount331 = 0;
    let meanSecondOrderStep331 = null;

    if (n331 >= 3) {
      const smoothed331 = V329._ema329(lengths331, 0.5);
      // First-order absolute steps
      const steps331 = [];
      for (let i331 = 1; i331 < smoothed331.length; i331++) {
        steps331.push(Math.abs(smoothed331[i331] - smoothed331[i331 - 1]));
      }
      // Second-order differences
      for (let i331 = 1; i331 < steps331.length; i331++) {
        secondOrderSum331 += steps331[i331] - steps331[i331 - 1];
        secondOrderCount331++;
      }
      if (secondOrderCount331 > 0) {
        meanSecondOrderStep331 = secondOrderSum331 / secondOrderCount331;
      }
    }

    return Object.assign({}, base331, {
      secondOrderSum:       secondOrderSum331,
      secondOrderCount:     secondOrderCount331,
      meanSecondOrderStep:  meanSecondOrderStep331,
      version:              MM_VERSION_331,
    });
  }

  stats() {
    const base331 = super.stats();
    return Object.assign({}, base331, { version: MM_VERSION_331 });
  }
}

let _defaultAuditCapTrail331 = null;
function defaultAuditCapTrail331(opts) {
  if (!_defaultAuditCapTrail331 || opts) {
    _defaultAuditCapTrail331 = new AuditCapTrail331(opts || {});
  }
  return _defaultAuditCapTrail331;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge331
//    Extends PageRangeDiffBridge330 with IQR spread of acceleration percentiles.
// ─────────────────────────────────────────────────────────────────────────────

class PageRangeDiffBridge331 extends V330.PageRangeDiffBridge330 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * computeAccelerationIQRSpread331()
   *
   * Calls computeMomentumAccelerationPercentiles330() and derives:
   *   - iqrSpread = p75 - p25 (null when either p25 or p75 is null)
   *   - normalizedIQR = iqrSpread / |p50| (null when p50 null/zero or iqrSpread null)
   *
   * @returns {{ ok, count, p25, p50, p75, iqrSpread, normalizedIQR, version }}
   */
  computeAccelerationIQRSpread331() {
    const base331 = this.computeMomentumAccelerationPercentiles330();

    let iqrSpread331    = null;
    let normalizedIQR331 = null;

    if (base331.p25 !== null && base331.p75 !== null) {
      iqrSpread331 = base331.p75 - base331.p25;
      if (base331.p50 !== null && base331.p50 !== 0 && iqrSpread331 !== null) {
        normalizedIQR331 = iqrSpread331 / Math.abs(base331.p50);
      }
    }

    return Object.assign({}, base331, {
      iqrSpread:     iqrSpread331,
      normalizedIQR: normalizedIQR331,
      version:       MM_VERSION_331,
    });
  }

  stats() {
    const base331 = super.stats();
    return Object.assign({}, base331, { version: MM_VERSION_331 });
  }
}

let _defaultPageRangeDiffBridge331 = null;
function defaultPageRangeDiffBridge331(opts) {
  if (!_defaultPageRangeDiffBridge331 || opts) {
    _defaultPageRangeDiffBridge331 = new PageRangeDiffBridge331(opts || {});
  }
  return _defaultPageRangeDiffBridge331;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer331
//    Extends RankedOverlapBuffer330 with band-width trend tracking.
// ─────────────────────────────────────────────────────────────────────────────

const _BAND_WIDTH_MAX_331 = 50;

class RankedOverlapBuffer331 extends V330.RankedOverlapBuffer330 {
  constructor(opts = {}) {
    super(opts);
    this._bandWidthHistory331 = [];
  }

  /**
   * trackEntropyBandWidthTrend331(snapshotTokenSets, threshold, windowSize)
   *
   * Calls forecastEntropyConfidenceBand330 and extracts bandWidth = upper - lower
   * (null when either is null). Appends bandWidth to _bandWidthHistory331 (max 50
   * entries, oldest dropped).
   *
   * Returns:
   *   - bandWidth:      current band width (null when band not available)
   *   - meanBandWidth:  arithmetic mean of all entries in the ring (null when empty)
   *   - bandWidthTrend: mean of second half of ring minus mean of first half
   *                     (null when ring has fewer than 2 entries)
   *
   * Returns all fields from forecastEntropyConfidenceBand330 plus the three above.
   *
   * @param {string[][]} snapshotTokenSets
   * @param {number}     [threshold]
   * @param {number}     [windowSize]
   * @returns {{ ok, ..., confidenceBand, bandWidth, meanBandWidth, bandWidthTrend, version }}
   */
  trackEntropyBandWidthTrend331(snapshotTokenSets, threshold, windowSize) {
    const base331 = this.forecastEntropyConfidenceBand330(snapshotTokenSets, threshold, windowSize);

    let bandWidth331 = null;
    if (
      base331.confidenceBand &&
      base331.confidenceBand.lower !== null &&
      base331.confidenceBand.upper !== null
    ) {
      bandWidth331 = base331.confidenceBand.upper - base331.confidenceBand.lower;
    }

    // Append to ring buffer (only finite values)
    if (bandWidth331 !== null) {
      this._bandWidthHistory331.push(bandWidth331);
      if (this._bandWidthHistory331.length > _BAND_WIDTH_MAX_331) {
        this._bandWidthHistory331.shift();
      }
    }

    const ring331 = this._bandWidthHistory331;
    const ringLen331 = ring331.length;

    let meanBandWidth331   = null;
    let bandWidthTrend331  = null;

    if (ringLen331 >= 1) {
      meanBandWidth331 = ring331.reduce((s331, v331) => s331 + v331, 0) / ringLen331;
    }

    if (ringLen331 >= 2) {
      const mid331      = Math.floor(ringLen331 / 2);
      const firstHalf331  = ring331.slice(0, mid331);
      const secondHalf331 = ring331.slice(mid331);
      const meanFirst331  = firstHalf331.reduce((s331, v331) => s331 + v331, 0) / firstHalf331.length;
      const meanSecond331 = secondHalf331.reduce((s331, v331) => s331 + v331, 0) / secondHalf331.length;
      bandWidthTrend331 = meanSecond331 - meanFirst331;
    }

    return Object.assign({}, base331, {
      bandWidth:      bandWidth331,
      meanBandWidth:  meanBandWidth331,
      bandWidthTrend: bandWidthTrend331,
      version:        MM_VERSION_331,
    });
  }

  stats() {
    const base331 = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base331, { version: MM_VERSION_331 });
  }
}

let _defaultRankedOverlapBuffer331 = null;
function defaultRankedOverlapBuffer331(opts) {
  if (!_defaultRankedOverlapBuffer331 || opts) {
    _defaultRankedOverlapBuffer331 = new RankedOverlapBuffer331(opts || {});
  }
  return _defaultRankedOverlapBuffer331;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker331
//    Extends NormDeltaPercentilesTracker330 with transition Shannon entropy.
// ─────────────────────────────────────────────────────────────────────────────

class NormDeltaPercentilesTracker331 extends V330.NormDeltaPercentilesTracker330 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * computeTransitionEntropy331(regime)
   *
   * Builds the transition frequency distribution from _spreadRankHistory328[regime]
   * (same zone logic as V330) and computes Shannon entropy:
   *   H = -sum(p_i * log2(p_i))
   * where p_i = count_i / totalTransitions.
   *
   * Returns:
   *   - distinctTransitions:  count of unique zone-pair types observed (0 when none)
   *   - transitionEntropy:    Shannon entropy H (null when no transitions exist)
   *
   * Returns ok:false when regime is invalid.
   *
   * @param {string} regime
   * @returns {{ ok, regime, count, transitionCount, distinctTransitions,
   *             transitionEntropy, version }}
   */
  computeTransitionEntropy331(regime331) {
    if (!regime331 || typeof regime331 !== 'string') {
      return { ok: false, error: 'regime must be a non-empty string', version: MM_VERSION_331 };
    }

    const history331 = this._spreadRankHistory328[regime331];
    const count331   = (history331 && history331.length) ? history331.length : 0;

    if (count331 < 2) {
      return {
        ok:                   true,
        regime:               regime331,
        count:                count331,
        transitionCount:      0,
        distinctTransitions:  0,
        transitionEntropy:    null,
        version:              MM_VERSION_331,
      };
    }

    // Build transition frequency map using same zone logic as V330
    const V330module331 = require('./marketMaker330.js');
    const transitionFreq331 = {};
    let transitionCount331 = 0;

    for (let i331 = 1; i331 < count331; i331++) {
      const fromZone331 = V330module331._getZone330(history331[i331 - 1]);
      const toZone331   = V330module331._getZone330(history331[i331]);
      if (fromZone331 !== toZone331) {
        transitionCount331++;
        const key331 = fromZone331 + '\u2192' + toZone331;
        transitionFreq331[key331] = (transitionFreq331[key331] || 0) + 1;
      }
    }

    const distinctTransitions331 = Object.keys(transitionFreq331).length;

    let transitionEntropy331 = null;
    if (transitionCount331 > 0) {
      transitionEntropy331 = 0;
      for (const key331 of Object.keys(transitionFreq331)) {
        const p331 = transitionFreq331[key331] / transitionCount331;
        if (p331 > 0) {
          transitionEntropy331 -= p331 * Math.log2(p331);
        }
      }
    }

    return {
      ok:                   true,
      regime:               regime331,
      count:                count331,
      transitionCount:      transitionCount331,
      distinctTransitions:  distinctTransitions331,
      transitionEntropy:    transitionEntropy331,
      version:              MM_VERSION_331,
    };
  }

  stats() {
    const base331 = super.stats();
    return Object.assign({}, base331, { version: MM_VERSION_331 });
  }
}

let _defaultNormDeltaPercentilesTracker331 = null;
function defaultNormDeltaPercentilesTracker331(opts) {
  if (!_defaultNormDeltaPercentilesTracker331 || opts) {
    _defaultNormDeltaPercentilesTracker331 = new NormDeltaPercentilesTracker331(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker331;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

function registerV331Endpoints(app) {
  const trail331   = defaultAuditCapTrail331();
  const bridge331  = defaultPageRangeDiffBridge331();
  const buffer331  = defaultRankedOverlapBuffer331();
  const tracker331 = defaultNormDeltaPercentilesTracker331();

  // 1. GET convergence acceleration
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v331/aggregate/db/hydrate/audit/cap/forecast/mae/alert/streak/volatility/trend/smoothed/cv/convergence/acceleration',
    (req, res) => {
      try {
        res.json(trail331.detectConvergenceAcceleration331());
      } catch (e331) {
        res.status(500).json({ ok: false, error: e331.message, version: MM_VERSION_331 });
      }
    }
  );

  // 2. GET acceleration IQR spread
  app.get(
    '/api/v1/market/alerts/suppress/config/v331/diff/audit/filter/paged/range/outliers/severity/burst/recovery/momentum/acceleration/iqr/spread',
    (req, res) => {
      try {
        res.json(bridge331.computeAccelerationIQRSpread331());
      } catch (e331) {
        res.status(500).json({ ok: false, error: e331.message, version: MM_VERSION_331 });
      }
    }
  );

  // 3. POST entropy band width trend
  app.post(
    '/api/v1/market/backtest/sessions/v331/snapshot/search/ranked/semantic/clusters/entropy/stability/window/forecast/confidence/band/width/trend',
    (req, res) => {
      try {
        const snapshotTokenSets331 = req.body ? req.body.snapshotTokenSets : undefined;
        const threshold331         = req.body ? req.body.threshold         : undefined;
        const windowSize331        = req.body ? req.body.windowSize        : undefined;
        res.json(buffer331.trackEntropyBandWidthTrend331(snapshotTokenSets331, threshold331, windowSize331));
      } catch (e331) {
        res.status(500).json({ ok: false, error: e331.message, version: MM_VERSION_331 });
      }
    }
  );

  // 4. GET transition entropy
  app.get(
    '/api/v1/contracts/receipts/v331/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime/sojourn/spread/rank/zone/transition/entropy',
    (req, res) => {
      try {
        const regime331 = req.query.regime || '';
        res.json(tracker331.computeTransitionEntropy331(regime331));
      } catch (e331) {
        res.status(500).json({ ok: false, error: e331.message, version: MM_VERSION_331 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_331,
  AuditCapTrail331,
  defaultAuditCapTrail331,
  PageRangeDiffBridge331,
  defaultPageRangeDiffBridge331,
  RankedOverlapBuffer331,
  defaultRankedOverlapBuffer331,
  NormDeltaPercentilesTracker331,
  defaultNormDeltaPercentilesTracker331,
  registerV331Endpoints,
};
