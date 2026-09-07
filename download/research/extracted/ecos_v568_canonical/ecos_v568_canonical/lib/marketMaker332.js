'use strict';
  /**
   * src/lib/marketMaker332.js — ECOS V332 (Phase P220) — Acceleration Skewness,
   *                              Acceleration Outlier Score, Band Width Dispersion,
   *                              Transition Entropy Efficiency
   *
   * Four additive components that extend the V331 analytical layer:
   *
   *   1. AuditCapTrail332 — detectAccelerationSkewness332()
   *      Recomputes the second-order differences array from the smoothed EMA series
   *      and applies Pearson's second skewness coefficient:
   *        skewness = 3 * (mean - median) / stdDev
   *      Returns secondOrderMean, secondOrderMedian, secondOrderStdDev, and
   *      accelerationSkewness (null when fewer than 3 second-order diffs exist).
   *
   *   2. PageRangeDiffBridge332 — computeAccelerationOutlierScore332()
   *      Calls computeAccelerationIQRSpread331 and applies Tukey's 1.5*IQR fence rule.
   *      Returns outlierCount (acceleration values outside [p25-1.5*IQR, p75+1.5*IQR]),
   *      outlierRate = outlierCount / total (null when total = 0), and
   *      fenceWidth = 1.5 * iqrSpread (null when iqrSpread is null).
   *
   *   3. RankedOverlapBuffer332 — measureBandWidthDispersion332(snapshotTokenSets, threshold, windowSize)
   *      Calls trackEntropyBandWidthTrend331 and computes the standard deviation of the
   *      _bandWidthHistory331 ring. Returns bandWidthStdDev (null when < 2 entries) and
   *      bandWidthCv = stdDev / |meanBandWidth| (null when mean null/zero or stdDev null).
   *
   *   4. NormDeltaPercentilesTracker332 — computeEntropyEfficiency332(regime)
   *      Calls computeTransitionEntropy331 and computes maximum possible entropy:
   *        maxPossibleEntropy = log2(distinctTransitions)
   *      Returns maxPossibleEntropy (null when 0 distinct transitions) and
   *      entropyEfficiency = transitionEntropy / maxPossibleEntropy
   *      (null when either is null or maxPossibleEntropy = 0).
   *
   * Sacred files untouched (R1). All new identifiers end in `332` (R2).
   * Zero new npm deps (R3). V287..V331 surfaces preserved (R6).
   * lib/ mirrors src/lib/. package.json bumped to 332.0.0.
   *
   * @version 332.0.0
   */

  const V331 = require('./marketMaker331.js');
  const V330 = require('./marketMaker330.js');
  const V329 = require('./marketMaker329.js');

  const MM_VERSION_332 = '332.0.0';

  // ─────────────────────────────────────────────────────────────────────────────
  // 1) AuditCapTrail332
  //    Extends AuditCapTrail331 with Pearson skewness of second-order differences.
  // ─────────────────────────────────────────────────────────────────────────────

  class AuditCapTrail332 extends V331.AuditCapTrail331 {
    constructor(opts = {}) {
      super(opts);
    }

    /**
     * detectAccelerationSkewness332()
     *
     * Calls detectConvergenceAcceleration331() then recomputes the second-order
     * differences array and derives Pearson's second skewness coefficient:
     *   skewness = 3 * (mean - median) / stdDev
     *
     * Returns:
     *   - secondOrderMean:     arithmetic mean of second-order diffs (null when empty)
     *   - secondOrderMedian:   median of second-order diffs (null when empty)
     *   - secondOrderStdDev:   sample standard deviation (null when fewer than 2 diffs)
     *   - accelerationSkewness: 3*(mean-median)/stdDev (null when fewer than 3 diffs
     *                           or stdDev = 0)
     *
     * Returns all fields from detectConvergenceAcceleration331() plus the four above.
     *
     * @returns {{ ok, streakCount, ..., secondOrderCount, meanSecondOrderStep,
     *             secondOrderMean, secondOrderMedian, secondOrderStdDev,
     *             accelerationSkewness, version }}
     */
    detectAccelerationSkewness332() {
      const base332 = this.detectConvergenceAcceleration331();

      const V328module332 = require('./marketMaker328.js');
      const lengths332    = V328module332._collectStreakLengths328(this._maeAlertHistory323);
      const n332          = lengths332.length;

      let secondOrderMean332      = null;
      let secondOrderMedian332    = null;
      let secondOrderStdDev332    = null;
      let accelerationSkewness332 = null;

      if (n332 >= 3) {
        const smoothed332 = V329._ema329(lengths332, 0.5);
        // First-order absolute steps
        const steps332 = [];
        for (let i332 = 1; i332 < smoothed332.length; i332++) {
          steps332.push(Math.abs(smoothed332[i332] - smoothed332[i332 - 1]));
        }
        // Second-order diffs
        const diffs332 = [];
        for (let i332 = 1; i332 < steps332.length; i332++) {
          diffs332.push(steps332[i332] - steps332[i332 - 1]);
        }

        if (diffs332.length >= 1) {
          // Mean
          const sum332 = diffs332.reduce((s332, v332) => s332 + v332, 0);
          secondOrderMean332 = sum332 / diffs332.length;

          // Median
          const sorted332 = diffs332.slice().sort((a332, b332) => a332 - b332);
          const mid332 = Math.floor(sorted332.length / 2);
          secondOrderMedian332 = sorted332.length % 2 === 0
            ? (sorted332[mid332 - 1] + sorted332[mid332]) / 2
            : sorted332[mid332];

          // Sample standard deviation
          if (diffs332.length >= 2) {
            const variance332 = diffs332.reduce((s332, v332) => s332 + (v332 - secondOrderMean332) ** 2, 0) / (diffs332.length - 1);
            secondOrderStdDev332 = Math.sqrt(variance332);

            // Pearson's 2nd skewness (needs >= 3 diffs and stdDev != 0)
            if (diffs332.length >= 3 && secondOrderStdDev332 !== 0) {
              accelerationSkewness332 = 3 * (secondOrderMean332 - secondOrderMedian332) / secondOrderStdDev332;
            }
          }
        }
      }

      return Object.assign({}, base332, {
        secondOrderMean:       secondOrderMean332,
        secondOrderMedian:     secondOrderMedian332,
        secondOrderStdDev:     secondOrderStdDev332,
        accelerationSkewness:  accelerationSkewness332,
        version:               MM_VERSION_332,
      });
    }

    stats() {
      const base332 = super.stats();
      return Object.assign({}, base332, { version: MM_VERSION_332 });
    }
  }

  let _defaultAuditCapTrail332 = null;
  function defaultAuditCapTrail332(opts) {
    if (!_defaultAuditCapTrail332 || opts) {
      _defaultAuditCapTrail332 = new AuditCapTrail332(opts || {});
    }
    return _defaultAuditCapTrail332;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2) PageRangeDiffBridge332
  //    Extends PageRangeDiffBridge331 with Tukey outlier scoring.
  // ─────────────────────────────────────────────────────────────────────────────

  class PageRangeDiffBridge332 extends V331.PageRangeDiffBridge331 {
    constructor(opts = {}) {
      super(opts);
    }

    /**
     * computeAccelerationOutlierScore332()
     *
     * Calls computeAccelerationIQRSpread331() and applies Tukey's 1.5*IQR fence rule
     * to the set of consecutive acceleration values derived from _momentumHistory328.
     *
     * Fence: lower = p25 - 1.5*iqrSpread, upper = p75 + 1.5*iqrSpread.
     * Outliers are values strictly outside [lower, upper].
     *
     * Returns:
     *   - fenceWidth:   1.5 * iqrSpread (null when iqrSpread is null)
     *   - outlierCount: count of acceleration values outside the fence (0 when fences null)
     *   - outlierRate:  outlierCount / total accelerations (null when total = 0)
     *
     * @returns {{ ok, count, p25, p50, p75, iqrSpread, normalizedIQR,
     *             fenceWidth, outlierCount, outlierRate, version }}
     */
    computeAccelerationOutlierScore332() {
      const base332 = this.computeAccelerationIQRSpread331();

      let fenceWidth332   = null;
      let outlierCount332 = 0;
      let outlierRate332  = null;

      // Derive the same acceleration array used by V330
      const hist332 = this._momentumHistory328 || [];
      const total332 = Math.max(0, hist332.length - 1); // number of consecutive diffs

      if (base332.iqrSpread !== null) {
        fenceWidth332 = 1.5 * base332.iqrSpread;
      }

      if (total332 > 0) {
        // Compute accelerations (consecutive diffs of _momentumHistory328)
        const accels332 = [];
        for (let i332 = 1; i332 < hist332.length; i332++) {
          accels332.push(hist332[i332] - hist332[i332 - 1]);
        }

        if (fenceWidth332 !== null && base332.p25 !== null && base332.p75 !== null) {
          const lowerFence332 = base332.p25 - fenceWidth332;
          const upperFence332 = base332.p75 + fenceWidth332;
          for (const a332 of accels332) {
            if (a332 < lowerFence332 || a332 > upperFence332) {
              outlierCount332++;
            }
          }
        }

        outlierRate332 = outlierCount332 / total332;
      }

      return Object.assign({}, base332, {
        fenceWidth:   fenceWidth332,
        outlierCount: outlierCount332,
        outlierRate:  outlierRate332,
        version:      MM_VERSION_332,
      });
    }

    stats() {
      const base332 = super.stats();
      return Object.assign({}, base332, { version: MM_VERSION_332 });
    }
  }

  let _defaultPageRangeDiffBridge332 = null;
  function defaultPageRangeDiffBridge332(opts) {
    if (!_defaultPageRangeDiffBridge332 || opts) {
      _defaultPageRangeDiffBridge332 = new PageRangeDiffBridge332(opts || {});
    }
    return _defaultPageRangeDiffBridge332;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3) RankedOverlapBuffer332
  //    Extends RankedOverlapBuffer331 with band-width standard deviation and CV.
  // ─────────────────────────────────────────────────────────────────────────────

  class RankedOverlapBuffer332 extends V331.RankedOverlapBuffer331 {
    constructor(opts = {}) {
      super(opts);
    }

    /**
     * measureBandWidthDispersion332(snapshotTokenSets, threshold, windowSize)
     *
     * Calls trackEntropyBandWidthTrend331 and computes the sample standard deviation
     * of the _bandWidthHistory331 ring buffer.
     *
     * Returns:
     *   - bandWidthStdDev: sample stdDev of ring entries (null when fewer than 2 entries)
     *   - bandWidthCv:     bandWidthStdDev / |meanBandWidth|
     *                      (null when meanBandWidth null/zero or bandWidthStdDev null)
     *
     * Returns all fields from trackEntropyBandWidthTrend331 plus the two above.
     *
     * @param {string[][]} snapshotTokenSets
     * @param {number}     [threshold]
     * @param {number}     [windowSize]
     * @returns {{ ok, ..., bandWidth, meanBandWidth, bandWidthTrend,
     *             bandWidthStdDev, bandWidthCv, version }}
     */
    measureBandWidthDispersion332(snapshotTokenSets332, threshold332, windowSize332) {
      const base332 = this.trackEntropyBandWidthTrend331(snapshotTokenSets332, threshold332, windowSize332);

      const ring332    = this._bandWidthHistory331;
      const ringLen332 = ring332.length;

      let bandWidthStdDev332 = null;
      let bandWidthCv332     = null;

      if (ringLen332 >= 2) {
        const mean332 = ring332.reduce((s332, v332) => s332 + v332, 0) / ringLen332;
        const variance332 = ring332.reduce((s332, v332) => s332 + (v332 - mean332) ** 2, 0) / (ringLen332 - 1);
        bandWidthStdDev332 = Math.sqrt(variance332);

        const meanForCv332 = base332.meanBandWidth;
        if (meanForCv332 !== null && meanForCv332 !== 0) {
          bandWidthCv332 = bandWidthStdDev332 / Math.abs(meanForCv332);
        }
      }

      return Object.assign({}, base332, {
        bandWidthStdDev: bandWidthStdDev332,
        bandWidthCv:     bandWidthCv332,
        version:         MM_VERSION_332,
      });
    }

    stats() {
      const base332 = typeof super.stats === 'function' ? super.stats() : {};
      return Object.assign({}, base332, { version: MM_VERSION_332 });
    }
  }

  let _defaultRankedOverlapBuffer332 = null;
  function defaultRankedOverlapBuffer332(opts) {
    if (!_defaultRankedOverlapBuffer332 || opts) {
      _defaultRankedOverlapBuffer332 = new RankedOverlapBuffer332(opts || {});
    }
    return _defaultRankedOverlapBuffer332;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4) NormDeltaPercentilesTracker332
  //    Extends NormDeltaPercentilesTracker331 with entropy efficiency ratio.
  // ─────────────────────────────────────────────────────────────────────────────

  class NormDeltaPercentilesTracker332 extends V331.NormDeltaPercentilesTracker331 {
    constructor(opts = {}) {
      super(opts);
    }

    /**
     * computeEntropyEfficiency332(regime)
     *
     * Calls computeTransitionEntropy331(regime) and derives the efficiency ratio:
     *   maxPossibleEntropy = log2(distinctTransitions)   — theoretical maximum for a
     *                        uniform distribution over exactly that many transition types.
     *   entropyEfficiency  = transitionEntropy / maxPossibleEntropy
     *
     * Returns:
     *   - maxPossibleEntropy: log2(distinctTransitions) (null when distinctTransitions = 0)
     *   - entropyEfficiency:  ratio in [0,1] (null when either component is null
     *                         or maxPossibleEntropy = 0)
     *
     * Returns ok:false when regime is invalid (forwarded from V331).
     *
     * @param {string} regime
     * @returns {{ ok, regime, count, transitionCount, distinctTransitions,
     *             transitionEntropy, maxPossibleEntropy, entropyEfficiency, version }}
     */
    computeEntropyEfficiency332(regime332) {
      const base332 = this.computeTransitionEntropy331(regime332);

      if (!base332.ok) {
        return Object.assign({}, base332, {
          maxPossibleEntropy: null,
          entropyEfficiency:  null,
          version:            MM_VERSION_332,
        });
      }

      let maxPossibleEntropy332 = null;
      let entropyEfficiency332  = null;

      if (base332.distinctTransitions > 0) {
        maxPossibleEntropy332 = Math.log2(base332.distinctTransitions);

        if (base332.transitionEntropy !== null && maxPossibleEntropy332 > 0) {
          entropyEfficiency332 = base332.transitionEntropy / maxPossibleEntropy332;
        }
      }

      return Object.assign({}, base332, {
        maxPossibleEntropy: maxPossibleEntropy332,
        entropyEfficiency:  entropyEfficiency332,
        version:            MM_VERSION_332,
      });
    }

    stats() {
      const base332 = super.stats();
      return Object.assign({}, base332, { version: MM_VERSION_332 });
    }
  }

  let _defaultNormDeltaPercentilesTracker332 = null;
  function defaultNormDeltaPercentilesTracker332(opts) {
    if (!_defaultNormDeltaPercentilesTracker332 || opts) {
      _defaultNormDeltaPercentilesTracker332 = new NormDeltaPercentilesTracker332(opts || {});
    }
    return _defaultNormDeltaPercentilesTracker332;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Endpoint registration helper
  // ─────────────────────────────────────────────────────────────────────────────

  function registerV332Endpoints(app) {
    const trail332   = defaultAuditCapTrail332();
    const bridge332  = defaultPageRangeDiffBridge332();
    const buffer332  = defaultRankedOverlapBuffer332();
    const tracker332 = defaultNormDeltaPercentilesTracker332();

    // 1. GET acceleration skewness
    app.get(
      '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v332/aggregate/db/hydrate/audit/cap/forecast/mae/alert/streak/volatility/trend/smoothed/cv/convergence/acceleration/skewness',
      (req332, res332) => {
        try {
          res332.json(trail332.detectAccelerationSkewness332());
        } catch (e332) {
          res332.status(500).json({ ok: false, error: e332.message, version: MM_VERSION_332 });
        }
      }
    );

    // 2. GET acceleration outlier score
    app.get(
      '/api/v1/market/alerts/suppress/config/v332/diff/audit/filter/paged/range/outliers/severity/burst/recovery/momentum/acceleration/iqr/outlier/score',
      (req332, res332) => {
        try {
          res332.json(bridge332.computeAccelerationOutlierScore332());
        } catch (e332) {
          res332.status(500).json({ ok: false, error: e332.message, version: MM_VERSION_332 });
        }
      }
    );

    // 3. POST band width dispersion
    app.post(
      '/api/v1/market/backtest/sessions/v332/snapshot/search/ranked/semantic/clusters/entropy/stability/window/forecast/confidence/band/width/dispersion',
      (req332, res332) => {
        try {
          const snapshotTokenSets332 = req332.body ? req332.body.snapshotTokenSets : undefined;
          const threshold332         = req332.body ? req332.body.threshold         : undefined;
          const windowSize332        = req332.body ? req332.body.windowSize        : undefined;
          res332.json(buffer332.measureBandWidthDispersion332(snapshotTokenSets332, threshold332, windowSize332));
        } catch (e332) {
          res332.status(500).json({ ok: false, error: e332.message, version: MM_VERSION_332 });
        }
      }
    );

    // 4. GET entropy efficiency
    app.get(
      '/api/v1/contracts/receipts/v332/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime/sojourn/spread/rank/zone/transition/entropy/efficiency',
      (req332, res332) => {
        try {
          const regime332 = req332.query.regime || '';
          res332.json(tracker332.computeEntropyEfficiency332(regime332));
        } catch (e332) {
          res332.status(500).json({ ok: false, error: e332.message, version: MM_VERSION_332 });
        }
      }
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Exports
  // ─────────────────────────────────────────────────────────────────────────────

  module.exports = {
    MM_VERSION_332,
    AuditCapTrail332,
    defaultAuditCapTrail332,
    PageRangeDiffBridge332,
    defaultPageRangeDiffBridge332,
    RankedOverlapBuffer332,
    defaultRankedOverlapBuffer332,
    NormDeltaPercentilesTracker332,
    defaultNormDeltaPercentilesTracker332,
    registerV332Endpoints,
  };
  