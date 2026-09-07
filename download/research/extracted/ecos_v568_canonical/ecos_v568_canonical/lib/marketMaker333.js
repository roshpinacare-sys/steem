'use strict';
  /**
   * src/lib/marketMaker333.js — ECOS V333 (Phase P221) — Acceleration Kurtosis,
   *                              Outlier Modified Z-Score, Band Width Autocorrelation,
   *                              Entropy Redundancy
   *
   * Four additive components that extend the V332 analytical layer:
   *
   *   1. AuditCapTrail333 — detectAccelerationKurtosis333()
   *      Recomputes the second-order differences array and applies the
   *      Pearson population kurtosis coefficient (4th standardized moment):
   *        kurtosis = mean((xi - mean)^4) / stdDev^4
   *      Returns fourthMoment (null when < 2 diffs), accelerationKurtosis
   *      (null when fewer than 4 second-order diffs or population stdDev = 0).
   *      Returns all V332 fields plus the two above.
   *
   *   2. PageRangeDiffBridge333 — computeOutlierZScore333()
   *      Calls computeAccelerationOutlierScore332 and applies the modified
   *      Z-score test using median absolute deviation (MAD):
   *        MAD = median(|xi - median(x)|)
   *        modifiedZ_i = 0.6745 * |xi - median| / MAD
   *      Returns medianAcceleration, mad, maxModifiedZScore, and outlierZCount
   *      (count of values with modifiedZ > 3.5). All null/zero when insufficient data.
   *
   *   3. RankedOverlapBuffer333 — measureBandWidthAutocorrelation333(snapshotTokenSets, threshold, windowSize)
   *      Calls measureBandWidthDispersion332 and computes the lag-1 Pearson
   *      autocorrelation of the _bandWidthHistory331 ring:
   *        autocorr = cov(ring[0..n-2], ring[1..n-1]) / (stdDev_a * stdDev_b)
   *      Returns bandWidthAutocorr (null when < 2 ring entries or variance = 0).
   *
   *   4. NormDeltaPercentilesTracker333 — computeEntropyRedundancy333(regime)
   *      Calls computeEntropyEfficiency332(regime) and derives Shannon redundancy:
   *        entropyRedundancy = 1 - entropyEfficiency
   *      Returns entropyRedundancy (null when entropyEfficiency is null).
   *      Returns ok:false when regime is invalid.
   *
   * Sacred files untouched (R1). All new identifiers end in `333` (R2).
   * Zero new npm deps (R3). V287..V332 surfaces preserved (R6).
   * lib/ mirrors src/lib/. package.json bumped to 333.0.0.
   *
   * @version 333.0.0
   */

  const V332 = require('./marketMaker332.js');
  const V331 = require('./marketMaker331.js');
  const V330 = require('./marketMaker330.js');
  const V329 = require('./marketMaker329.js');

  const MM_VERSION_333 = '333.0.0';

  // ─────────────────────────────────────────────────────────────────────────────
  // 1) AuditCapTrail333
  //    Extends AuditCapTrail332 with Pearson population kurtosis of second-order diffs.
  // ─────────────────────────────────────────────────────────────────────────────

  class AuditCapTrail333 extends V332.AuditCapTrail332 {
    constructor(opts = {}) {
      super(opts);
    }

    /**
     * detectAccelerationKurtosis333()
     *
     * Calls detectAccelerationSkewness332() then recomputes the second-order
     * differences array and derives Pearson population kurtosis (4th standardized moment):
     *   kurtosis = mean((xi - mean)^4) / (populationStdDev^4)
     *
     * Returns:
     *   - fourthMoment:          mean of (xi - mean)^4 (null when fewer than 2 diffs)
     *   - accelerationKurtosis:  fourthMoment / populationStdDev^4
     *                            (null when fewer than 4 diffs or populationStdDev = 0)
     *
     * Returns all fields from detectAccelerationSkewness332() plus the two above.
     *
     * @returns {{ ok, streakCount, ..., secondOrderMean, secondOrderMedian,
     *             secondOrderStdDev, accelerationSkewness,
     *             fourthMoment, accelerationKurtosis, version }}
     */
    detectAccelerationKurtosis333() {
      const base333 = this.detectAccelerationSkewness332();

      const V328module333 = require('./marketMaker328.js');
      const lengths333    = V328module333._collectStreakLengths328(this._maeAlertHistory323);
      const n333          = lengths333.length;

      let fourthMoment333        = null;
      let accelerationKurtosis333 = null;

      if (n333 >= 4) {
        const smoothed333 = V329._ema329(lengths333, 0.5);
        // First-order absolute steps
        const steps333 = [];
        for (let i333 = 1; i333 < smoothed333.length; i333++) {
          steps333.push(Math.abs(smoothed333[i333] - smoothed333[i333 - 1]));
        }
        // Second-order diffs
        const diffs333 = [];
        for (let i333 = 1; i333 < steps333.length; i333++) {
          diffs333.push(steps333[i333] - steps333[i333 - 1]);
        }

        if (diffs333.length >= 2) {
          const mean333 = diffs333.reduce((s333, v333) => s333 + v333, 0) / diffs333.length;

          // Population variance and 4th moment
          let sumSq333   = 0;
          let sumFourth333 = 0;
          for (const v333 of diffs333) {
            const dev333 = v333 - mean333;
            sumSq333    += dev333 * dev333;
            sumFourth333 += dev333 * dev333 * dev333 * dev333;
          }
          const popVariance333  = sumSq333 / diffs333.length;
          const popStdDev333    = Math.sqrt(popVariance333);
          fourthMoment333 = sumFourth333 / diffs333.length;

          if (diffs333.length >= 4 && popStdDev333 !== 0) {
            accelerationKurtosis333 = fourthMoment333 / (popStdDev333 * popStdDev333 * popStdDev333 * popStdDev333);
          }
        }
      }

      return Object.assign({}, base333, {
        fourthMoment:          fourthMoment333,
        accelerationKurtosis:  accelerationKurtosis333,
        version:               MM_VERSION_333,
      });
    }

    stats() {
      const base333 = super.stats();
      return Object.assign({}, base333, { version: MM_VERSION_333 });
    }
  }

  let _defaultAuditCapTrail333 = null;
  function defaultAuditCapTrail333(opts) {
    if (!_defaultAuditCapTrail333 || opts) {
      _defaultAuditCapTrail333 = new AuditCapTrail333(opts || {});
    }
    return _defaultAuditCapTrail333;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2) PageRangeDiffBridge333
  //    Extends PageRangeDiffBridge332 with modified Z-score outlier detection.
  // ─────────────────────────────────────────────────────────────────────────────

  class PageRangeDiffBridge333 extends V332.PageRangeDiffBridge332 {
    constructor(opts = {}) {
      super(opts);
    }

    /**
     * computeOutlierZScore333()
     *
     * Calls computeAccelerationOutlierScore332() and applies the modified Z-score
     * test using Median Absolute Deviation (MAD) to acceleration values derived
     * from _momentumHistory328.
     *
     * MAD = median(|xi - median(x)|)
     * modifiedZ_i = 0.6745 * |xi - median(x)| / MAD
     *
     * Values with modifiedZ > 3.5 are flagged as outliers.
     *
     * Returns:
     *   - medianAcceleration: median of acceleration values (null when none)
     *   - mad:                Median Absolute Deviation (null when < 1 value, 0 when MAD = 0)
     *   - maxModifiedZScore:  maximum modified Z-score across all values (null when mad = 0 or no values)
     *   - outlierZCount:      count of values with modifiedZ > 3.5 (0 when no values or mad = 0)
     *
     * @returns {{ ok, ..., fenceWidth, outlierCount, outlierRate,
     *             medianAcceleration, mad, maxModifiedZScore, outlierZCount, version }}
     */
    computeOutlierZScore333() {
      const base333 = this.computeAccelerationOutlierScore332();

      const hist333   = this._momentumHistory328 || [];
      const total333  = hist333.length - 1;

      let medianAcceleration333 = null;
      let mad333                = null;
      let maxModifiedZScore333  = null;
      let outlierZCount333      = 0;

      if (total333 > 0) {
        // Compute acceleration array
        const accels333 = [];
        for (let i333 = 1; i333 < hist333.length; i333++) {
          accels333.push(hist333[i333] - hist333[i333 - 1]);
        }

        // Median helper
        function _median333(arr333) {
          const sorted333 = arr333.slice().sort((a333, b333) => a333 - b333);
          const mid333    = Math.floor(sorted333.length / 2);
          return sorted333.length % 2 === 0
            ? (sorted333[mid333 - 1] + sorted333[mid333]) / 2
            : sorted333[mid333];
        }

        medianAcceleration333 = _median333(accels333);

        // MAD
        const absDevs333 = accels333.map(v333 => Math.abs(v333 - medianAcceleration333));
        mad333 = _median333(absDevs333);

        if (mad333 !== 0) {
          let maxZ333 = 0;
          for (const v333 of accels333) {
            const z333 = 0.6745 * Math.abs(v333 - medianAcceleration333) / mad333;
            if (z333 > maxZ333) maxZ333 = z333;
            if (z333 > 3.5) outlierZCount333++;
          }
          maxModifiedZScore333 = maxZ333;
        }
      }

      return Object.assign({}, base333, {
        medianAcceleration: medianAcceleration333,
        mad:                mad333,
        maxModifiedZScore:  maxModifiedZScore333,
        outlierZCount:      outlierZCount333,
        version:            MM_VERSION_333,
      });
    }

    stats() {
      const base333 = super.stats();
      return Object.assign({}, base333, { version: MM_VERSION_333 });
    }
  }

  let _defaultPageRangeDiffBridge333 = null;
  function defaultPageRangeDiffBridge333(opts) {
    if (!_defaultPageRangeDiffBridge333 || opts) {
      _defaultPageRangeDiffBridge333 = new PageRangeDiffBridge333(opts || {});
    }
    return _defaultPageRangeDiffBridge333;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3) RankedOverlapBuffer333
  //    Extends RankedOverlapBuffer332 with lag-1 Pearson autocorrelation.
  // ─────────────────────────────────────────────────────────────────────────────

  class RankedOverlapBuffer333 extends V332.RankedOverlapBuffer332 {
    constructor(opts = {}) {
      super(opts);
    }

    /**
     * measureBandWidthAutocorrelation333(snapshotTokenSets, threshold, windowSize)
     *
     * Calls measureBandWidthDispersion332 and computes the lag-1 Pearson autocorrelation
     * of the _bandWidthHistory331 ring buffer.
     *
     * Let a = ring[0..n-2], b = ring[1..n-1].
     * autocorr = cov(a,b) / (stdDev(a) * stdDev(b))
     * Uses population standard deviation for each half-shifted series.
     *
     * Returns:
     *   - bandWidthAutocorr: lag-1 autocorrelation (null when < 2 ring entries or
     *                        stdDev of either shifted series = 0)
     *
     * Returns all fields from measureBandWidthDispersion332 plus the one above.
     *
     * @param {string[][]} snapshotTokenSets
     * @param {number}     [threshold]
     * @param {number}     [windowSize]
     * @returns {{ ok, ..., bandWidthStdDev, bandWidthCv, bandWidthAutocorr, version }}
     */
    measureBandWidthAutocorrelation333(snapshotTokenSets333, threshold333, windowSize333) {
      const base333 = this.measureBandWidthDispersion332(snapshotTokenSets333, threshold333, windowSize333);

      const ring333    = this._bandWidthHistory331;
      const ringLen333 = ring333.length;

      let bandWidthAutocorr333 = null;

      if (ringLen333 >= 2) {
        const a333 = ring333.slice(0, ringLen333 - 1);
        const b333 = ring333.slice(1);
        const n333 = a333.length;

        const meanA333 = a333.reduce((s333, v333) => s333 + v333, 0) / n333;
        const meanB333 = b333.reduce((s333, v333) => s333 + v333, 0) / n333;

        let cov333 = 0;
        let varA333 = 0;
        let varB333 = 0;
        for (let i333 = 0; i333 < n333; i333++) {
          const da333 = a333[i333] - meanA333;
          const db333 = b333[i333] - meanB333;
          cov333  += da333 * db333;
          varA333 += da333 * da333;
          varB333 += db333 * db333;
        }
        cov333  /= n333;
        varA333 /= n333;
        varB333 /= n333;

        const stdA333 = Math.sqrt(varA333);
        const stdB333 = Math.sqrt(varB333);

        if (stdA333 !== 0 && stdB333 !== 0) {
          bandWidthAutocorr333 = cov333 / (stdA333 * stdB333);
        }
      }

      return Object.assign({}, base333, {
        bandWidthAutocorr: bandWidthAutocorr333,
        version:           MM_VERSION_333,
      });
    }

    stats() {
      const base333 = typeof super.stats === 'function' ? super.stats() : {};
      return Object.assign({}, base333, { version: MM_VERSION_333 });
    }
  }

  let _defaultRankedOverlapBuffer333 = null;
  function defaultRankedOverlapBuffer333(opts) {
    if (!_defaultRankedOverlapBuffer333 || opts) {
      _defaultRankedOverlapBuffer333 = new RankedOverlapBuffer333(opts || {});
    }
    return _defaultRankedOverlapBuffer333;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4) NormDeltaPercentilesTracker333
  //    Extends NormDeltaPercentilesTracker332 with Shannon entropy redundancy.
  // ─────────────────────────────────────────────────────────────────────────────

  class NormDeltaPercentilesTracker333 extends V332.NormDeltaPercentilesTracker332 {
    constructor(opts = {}) {
      super(opts);
    }

    /**
     * computeEntropyRedundancy333(regime)
     *
     * Calls computeEntropyEfficiency332(regime) and derives Shannon redundancy:
     *   entropyRedundancy = 1 - entropyEfficiency
     *
     * Returns:
     *   - entropyRedundancy: 1 - entropyEfficiency (null when entropyEfficiency is null)
     *
     * Returns all fields from computeEntropyEfficiency332 plus the one above.
     * Returns ok:false when regime is invalid.
     *
     * @param {string} regime
     * @returns {{ ok, ..., maxPossibleEntropy, entropyEfficiency, entropyRedundancy, version }}
     */
    computeEntropyRedundancy333(regime333) {
      const base333 = this.computeEntropyEfficiency332(regime333);

      if (!base333.ok) {
        return Object.assign({}, base333, {
          entropyRedundancy: null,
          version:           MM_VERSION_333,
        });
      }

      const efficiency333 = base333.entropyEfficiency;
      const redundancy333 = efficiency333 !== null ? 1 - efficiency333 : null;

      return Object.assign({}, base333, {
        entropyRedundancy: redundancy333,
        version:           MM_VERSION_333,
      });
    }

    stats() {
      const base333 = super.stats();
      return Object.assign({}, base333, { version: MM_VERSION_333 });
    }
  }

  let _defaultNormDeltaPercentilesTracker333 = null;
  function defaultNormDeltaPercentilesTracker333(opts) {
    if (!_defaultNormDeltaPercentilesTracker333 || opts) {
      _defaultNormDeltaPercentilesTracker333 = new NormDeltaPercentilesTracker333(opts || {});
    }
    return _defaultNormDeltaPercentilesTracker333;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // V333 Endpoint Registration
  // ─────────────────────────────────────────────────────────────────────────────

  function registerV333Endpoints(app333) {
    const trail333  = defaultAuditCapTrail333();
    const bridge333 = defaultPageRangeDiffBridge333();
    const buf333    = defaultRankedOverlapBuffer333();
    const norm333   = defaultNormDeltaPercentilesTracker333();

    // 1. Acceleration Kurtosis
    app333.get(
      '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v333/aggregate/db/hydrate/audit/cap/forecast/mae/alert/streak/volatility/trend/smoothed/cv/convergence/acceleration/skewness/kurtosis',
      (req333, res333) => {
        try {
          res333.json(trail333.detectAccelerationKurtosis333());
        } catch (e333) {
          res333.status(500).json({ ok: false, error: e333.message });
        }
      }
    );

    // 2. Outlier Modified Z-Score
    app333.get(
      '/api/v1/market/alerts/suppress/config/v333/diff/audit/filter/paged/range/outliers/severity/burst/recovery/momentum/acceleration/iqr/outlier/zscore',
      (req333, res333) => {
        try {
          res333.json(bridge333.computeOutlierZScore333());
        } catch (e333) {
          res333.status(500).json({ ok: false, error: e333.message });
        }
      }
    );

    // 3. Band Width Autocorrelation
    app333.post(
      '/api/v1/market/backtest/sessions/v333/snapshot/search/ranked/semantic/clusters/entropy/stability/window/forecast/confidence/band/width/autocorrelation',
      (req333, res333) => {
        try {
          const { snapshotTokenSets, threshold, windowSize } = req333.body || {};
          res333.json(buf333.measureBandWidthAutocorrelation333(snapshotTokenSets || [], threshold, windowSize));
        } catch (e333) {
          res333.status(500).json({ ok: false, error: e333.message });
        }
      }
    );

    // 4. Entropy Redundancy
    app333.get(
      '/api/v1/contracts/receipts/v333/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime/sojourn/spread/rank/zone/transition/entropy/efficiency/redundancy',
      (req333, res333) => {
        try {
          const regime333 = req333.query.regime || 'normal';
          res333.json(norm333.computeEntropyRedundancy333(regime333));
        } catch (e333) {
          res333.status(500).json({ ok: false, error: e333.message });
        }
      }
    );
  }

  module.exports = {
    MM_VERSION_333,
    AuditCapTrail333,
    defaultAuditCapTrail333,
    PageRangeDiffBridge333,
    defaultPageRangeDiffBridge333,
    RankedOverlapBuffer333,
    defaultRankedOverlapBuffer333,
    NormDeltaPercentilesTracker333,
    defaultNormDeltaPercentilesTracker333,
    registerV333Endpoints,
  };
  