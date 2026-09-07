'use strict';
/**
 * src/lib/marketMaker323.js — ECOS V323 (Phase P211) — MAE Alert History,
 *                              Burst Cooldown, Cluster Migration Graph,
 *                              Regime Sojourn Time
 *
 * Four additive components that extend the V322 analytical layer:
 *
 *   1. AuditCapTrail323 — auditCapForecastMAEAlertHistory323(threshold, maxEntries, maxHistory)
 *      Extends the V322 MAE alert tracker to maintain a timestamped history ring of
 *      all alert events so callers can review when the forecast model degraded.
 *
 *   2. PageRangeDiffBridge323 — pagedDiffSeverityBurstCooldown323(...)
 *      Extends burst detection (V322) with a configurable cooldown period during which
 *      subsequent burst signals are suppressed to reduce alert fatigue.
 *
 *   3. RankedOverlapBuffer323 — buildClusterMigrationGraph323(snapshotTokenSets, threshold)
 *      Extends cluster stability (V322) to produce a directed graph of token migrations
 *      across multiple consecutive snapshots (not just two).
 *
 *   4. NormDeltaPercentilesTracker323 — trendNormDeltaRegimeSojournTime323(...)
 *      Extends the transition matrix (V322) to also record average sojourn time
 *      (number of consecutive calls) spent in each regime before transitioning.
 *
 * Sacred files untouched (R1). All new identifiers end in `323` (R2).
 * Zero new npm deps (R3). V287..V322 surfaces preserved (R6).
 * lib/ mirrors src/lib/. package.json bumped to 323.0.0.
 *
 * @version 323.0.0
 */

const V322 = require('./marketMaker322.js');

const MM_VERSION_323 = '323.0.0';

function _coercePositiveInt323(value, fallback323) {
  const n323 = Number(value);
  if (!Number.isFinite(n323) || !Number.isInteger(n323) || n323 < 1) return fallback323;
  return n323;
}

function _coercePositiveFloat323(value, fallback323) {
  const f323 = Number(value);
  if (!Number.isFinite(f323) || f323 <= 0) return fallback323;
  return f323;
}

function _coerceNonNegativeInt323(value, fallback323) {
  const n323 = Number(value);
  if (!Number.isFinite(n323) || !Number.isInteger(n323) || n323 < 0) return fallback323;
  return n323;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail323
//    Extends AuditCapTrail322 with MAE alert history tracking.
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail323 extends V322.AuditCapTrail322 {
  constructor(opts = {}) {
    super(opts);
    // Bounded ring of MAE alert history entries
    this._maeAlertHistory323 = [];
    this._maeAlertHistoryMax323 = _coercePositiveInt323(opts.maxHistory, 100);
  }

  /**
   * auditCapForecastMAEAlertHistory323(threshold, maxEntries, maxHistory)
   *
   * Delegates to auditCapForecastMAEAlert322 and, if the result is ok, appends
   * an entry to the internal bounded ring: { timestamp, mae, threshold, alert }.
   * Returns the alert result plus a `alertHistory` array and `historyCount`.
   *
   * @param {number}  threshold   — MAE value above which alert is true
   * @param {number}  [maxEntries] — rolling window for MAE computation (default: all)
   * @param {number}  [maxHistory] — max history entries to retain (default: 100)
   * @returns {{ ok, mae, entries, count, alert, threshold, alertMessage,
   *             alertHistory, historyCount, version }}
   */
  auditCapForecastMAEAlertHistory323(threshold, maxEntries, maxHistory) {
    const histMax323 = _coercePositiveInt323(maxHistory, this._maeAlertHistoryMax323);
    const base323 = this.auditCapForecastMAEAlert322(threshold, maxEntries);

    if (base323.ok) {
      const entry323 = {
        timestamp:  new Date().toISOString(),
        mae:        base323.mae,
        threshold:  base323.threshold,
        alert:      base323.alert,
      };
      this._maeAlertHistory323.push(entry323);
      // Trim ring to histMax323
      while (this._maeAlertHistory323.length > histMax323) {
        this._maeAlertHistory323.shift();
      }
    }

    return Object.assign({}, base323, {
      alertHistory:  this._maeAlertHistory323.slice(),
      historyCount:  this._maeAlertHistory323.length,
      version:       MM_VERSION_323,
    });
  }

  /**
   * clearMAEAlertHistory323()
   * Clear the alert history ring.
   */
  clearMAEAlertHistory323() {
    this._maeAlertHistory323 = [];
    return { ok: true, version: MM_VERSION_323 };
  }

  stats() {
    const base323 = super.stats();
    return Object.assign({}, base323, { version: MM_VERSION_323 });
  }
}

let _defaultAuditCapTrail323 = null;
function defaultAuditCapTrail323(opts) {
  if (!_defaultAuditCapTrail323 || opts) {
    _defaultAuditCapTrail323 = new AuditCapTrail323(opts || {});
  }
  return _defaultAuditCapTrail323;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge323
//    Extends PageRangeDiffBridge322 with burst cooldown suppression.
// ─────────────────────────────────────────────────────────────────────────────

class PageRangeDiffBridge323 extends V322.PageRangeDiffBridge322 {
  constructor(opts = {}) {
    super(opts);
    // Cooldown state
    this._lastBurstAt323    = null;  // ISO timestamp string of last confirmed burst
    this._burstCooldownMs323 = _coerceNonNegativeInt323(opts.burstCooldownMs, 0);
  }

  /**
   * pagedDiffSeverityBurstCooldown323(from, to, startPage, endPage, pageSize,
   *   stdFactor, compareFrom, compareTo, compareStartPage, compareEndPage,
   *   trendThreshold, burstWindowSize, burstThresholdFactor, burstCooldownMs)
   *
   * Delegates to pagedDiffSeverityBurstDetect322, then suppresses the burst signal
   * if we are within the configurable cooldown period since the last confirmed burst.
   * - When a real (non-suppressed) burst fires, records the timestamp.
   * - When within cooldown, `burst` is forced false and `cooldown` is `true`.
   *
   * @param {number} [burstCooldownMs] — ms to suppress subsequent bursts (default: 0)
   * @returns {{ ok, ...(burst result), cooldown, cooldownRemainingMs, version }}
   */
  pagedDiffSeverityBurstCooldown323(
    from, to, startPage, endPage, pageSize, stdFactor,
    compareFrom, compareTo, compareStartPage, compareEndPage,
    trendThreshold, burstWindowSize, burstThresholdFactor, burstCooldownMs
  ) {
    const cooldownMs323 = _coerceNonNegativeInt323(burstCooldownMs, this._burstCooldownMs323);

    const base323 = this.pagedDiffSeverityBurstDetect322(
      from, to, startPage, endPage, pageSize, stdFactor,
      compareFrom, compareTo, compareStartPage, compareEndPage,
      trendThreshold, burstWindowSize, burstThresholdFactor
    );

    const now323 = Date.now();
    let burst323             = base323.burst;
    let cooldownActive323    = false;
    let cooldownRemaining323 = 0;

    if (cooldownMs323 > 0 && this._lastBurstAt323 !== null) {
      const elapsed323 = now323 - this._lastBurstAt323;
      if (elapsed323 < cooldownMs323) {
        // Still in cooldown — suppress burst
        cooldownActive323    = true;
        cooldownRemaining323 = cooldownMs323 - elapsed323;
        burst323             = false;
      }
    }

    // Record the timestamp only when a real (non-suppressed) burst fires
    if (base323.burst && !cooldownActive323) {
      this._lastBurstAt323 = now323;
    }

    return Object.assign({}, base323, {
      burst:               burst323,
      cooldown:            cooldownActive323,
      cooldownRemainingMs: cooldownRemaining323,
      version:             MM_VERSION_323,
    });
  }

  /**
   * resetBurstCooldown323()
   * Clear the cooldown state (last burst timestamp).
   */
  resetBurstCooldown323() {
    this._lastBurstAt323 = null;
    return { ok: true, version: MM_VERSION_323 };
  }

  stats() {
    const base323 = super.stats();
    return Object.assign({}, base323, { version: MM_VERSION_323 });
  }
}

let _defaultPageRangeDiffBridge323 = null;
function defaultPageRangeDiffBridge323(opts) {
  if (!_defaultPageRangeDiffBridge323 || opts) {
    _defaultPageRangeDiffBridge323 = new PageRangeDiffBridge323(opts || {});
  }
  return _defaultPageRangeDiffBridge323;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer323
//    Extends RankedOverlapBuffer322 with a cluster migration graph.
// ─────────────────────────────────────────────────────────────────────────────

class RankedOverlapBuffer323 extends V322.RankedOverlapBuffer322 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * buildClusterMigrationGraph323(snapshotTokenSets, threshold)
   *
   * Takes an ordered array of token sets (snapshots) and builds a directed
   * weighted graph of token migrations across consecutive snapshot pairs:
   *
   * - `nodes`: unique token list observed across all snapshots.
   * - `edges`: array of { from, to, token, fromSnapshot, toSnapshot } objects
   *   representing tokens that moved clusters between consecutive snapshots.
   * - `edgeCounts`: { 'clusterA→clusterB': count } aggregate migration counts.
   * - `snapshotCount`: number of snapshots processed.
   * - `pairCount`: number of consecutive pairs analysed.
   *
   * @param {string[][]} snapshotTokenSets — ordered array of token arrays (≥ 2 snapshots)
   * @param {number}     [threshold]       — Jaccard threshold forwarded to cluster discovery (default 0.1)
   * @returns {{ ok, nodes, edges, edgeCounts, snapshotCount, pairCount, version }}
   */
  buildClusterMigrationGraph323(snapshotTokenSets, threshold) {
    if (!Array.isArray(snapshotTokenSets) || snapshotTokenSets.length < 2) {
      return {
        ok:    false,
        error: 'snapshotTokenSets must be an array of at least 2 token sets',
        version: MM_VERSION_323,
      };
    }

    const nodes323    = new Set();
    const edges323    = [];
    const edgeCounts323 = {};

    for (let i323 = 0; i323 < snapshotTokenSets.length - 1; i323++) {
      const tokensA323 = snapshotTokenSets[i323];
      const tokensB323 = snapshotTokenSets[i323 + 1];

      // Collect all tokens as nodes
      (tokensA323 || []).forEach(t => nodes323.add(t));
      (tokensB323 || []).forEach(t => nodes323.add(t));

      // Run stability check between consecutive pair
      const stability323 = this.semanticClusterStability322(tokensA323, tokensB323, threshold);
      if (!stability323.ok) {
        // Skip pairs that fail cluster discovery (e.g., fewer than 2 tokens) — non-fatal
        continue;
      }

      // Record each moved token as a directed edge
      stability323.moved.forEach(move323 => {
        const edgeKey323 = `cluster${move323.fromCluster}→cluster${move323.toCluster}`;
        edges323.push({
          token:        move323.token,
          fromCluster:  move323.fromCluster,
          toCluster:    move323.toCluster,
          fromSnapshot: i323,
          toSnapshot:   i323 + 1,
        });
        edgeCounts323[edgeKey323] = (edgeCounts323[edgeKey323] || 0) + 1;
      });
    }

    return {
      ok:            true,
      nodes:         Array.from(nodes323),
      edges:         edges323,
      edgeCounts:    edgeCounts323,
      snapshotCount: snapshotTokenSets.length,
      pairCount:     snapshotTokenSets.length - 1,
      version:       MM_VERSION_323,
    };
  }

  stats() {
    const base323 = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base323, { version: MM_VERSION_323 });
  }
}

let _defaultRankedOverlapBuffer323 = null;
function defaultRankedOverlapBuffer323(opts) {
  if (!_defaultRankedOverlapBuffer323 || opts) {
    _defaultRankedOverlapBuffer323 = new RankedOverlapBuffer323(opts || {});
  }
  return _defaultRankedOverlapBuffer323;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker323
//    Extends NormDeltaPercentilesTracker322 with regime sojourn time tracking.
// ─────────────────────────────────────────────────────────────────────────────

class NormDeltaPercentilesTracker323 extends V322.NormDeltaPercentilesTracker322 {
  constructor(opts = {}) {
    super(opts);
    // Sojourn time tracking: { regime: { totalDuration, transitionCount } }
    this._sojournStats323      = {};
    this._currentSojourn323    = 0;   // consecutive calls in current regime
    this._lastSojournRegime323 = null;
  }

  /**
   * trendNormDeltaRegimeSojournTime323(source, windowMs, buckets, baseline,
   *   thresholds, compareWindowMs, regimeThresholds)
   *
   * Delegates to trendNormDeltaRegimeTransitionMatrix322, then maintains per-regime
   * sojourn time statistics. On each same-regime call, the current sojourn
   * counter increments. On a regime transition, the sojourn duration is recorded.
   *
   * Returns the transition matrix result plus:
   *  - `sojournStats`: { [regime]: { totalDuration, transitionCount, avgSojourn } }
   *  - `currentSojourn`: current consecutive calls in the current regime.
   *
   * @returns {{ ok, regime, regimeDuration, transitionMatrix, totalTransitions,
   *             sojournStats, currentSojourn, version }}
   */
  trendNormDeltaRegimeSojournTime323(
    source, windowMs, buckets, baseline, thresholds, compareWindowMs, regimeThresholds
  ) {
    const base323 = this.trendNormDeltaRegimeTransitionMatrix322(
      source, windowMs, buckets, baseline, thresholds, compareWindowMs, regimeThresholds
    );
    if (!base323.ok) {
      return Object.assign({}, base323, { version: MM_VERSION_323 });
    }

    const currentRegime323 = base323.regime;

    if (this._lastSojournRegime323 === null) {
      // First call
      this._currentSojourn323    = 1;
      this._lastSojournRegime323 = currentRegime323;
    } else if (this._lastSojournRegime323 === currentRegime323) {
      // Same regime — increment sojourn
      this._currentSojourn323++;
    } else {
      // Regime changed — record completed sojourn for previous regime
      const prevRegime323 = this._lastSojournRegime323;
      if (!this._sojournStats323[prevRegime323]) {
        this._sojournStats323[prevRegime323] = { totalDuration: 0, transitionCount: 0 };
      }
      this._sojournStats323[prevRegime323].totalDuration    += this._currentSojourn323;
      this._sojournStats323[prevRegime323].transitionCount  += 1;
      // Start fresh sojourn for new regime
      this._currentSojourn323    = 1;
      this._lastSojournRegime323 = currentRegime323;
    }

    // Compute avgSojourn for each regime in stats
    const sojournView323 = {};
    Object.keys(this._sojournStats323).forEach(regime323 => {
      const s323 = this._sojournStats323[regime323];
      sojournView323[regime323] = {
        totalDuration:    s323.totalDuration,
        transitionCount:  s323.transitionCount,
        avgSojourn:       s323.transitionCount > 0
          ? s323.totalDuration / s323.transitionCount
          : null,
      };
    });

    return Object.assign({}, base323, {
      sojournStats:    sojournView323,
      currentSojourn:  this._currentSojourn323,
      version:         MM_VERSION_323,
    });
  }

  /**
   * resetSojournStats323()
   * Reset sojourn time stats and current sojourn counter.
   */
  resetSojournStats323() {
    this._sojournStats323      = {};
    this._currentSojourn323    = 0;
    this._lastSojournRegime323 = null;
    return { ok: true, version: MM_VERSION_323 };
  }

  stats() {
    const base323 = super.stats();
    return Object.assign({}, base323, { version: MM_VERSION_323 });
  }
}

let _defaultNormDeltaPercentilesTracker323 = null;
function defaultNormDeltaPercentilesTracker323(opts) {
  if (!_defaultNormDeltaPercentilesTracker323 || opts) {
    _defaultNormDeltaPercentilesTracker323 = new NormDeltaPercentilesTracker323(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker323;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

function registerV323Endpoints(app) {
  const trail323   = defaultAuditCapTrail323();
  const bridge323  = defaultPageRangeDiffBridge323();
  const buffer323  = defaultRankedOverlapBuffer323();
  const tracker323 = defaultNormDeltaPercentilesTracker323();

  // 1. GET MAE alert history
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v323/aggregate/db/hydrate/audit/cap/forecast/mae/alert/history',
    (req, res) => {
      try {
        const threshold323  = req.query.threshold  ? Number(req.query.threshold)  : Infinity;
        const maxEntries323 = req.query.maxEntries ? Number(req.query.maxEntries) : undefined;
        const maxHistory323 = req.query.maxHistory ? Number(req.query.maxHistory) : undefined;
        res.json(trail323.auditCapForecastMAEAlertHistory323(threshold323, maxEntries323, maxHistory323));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_323 });
      }
    }
  );

  // 2. GET severity burst with cooldown
  app.get(
    '/api/v1/market/alerts/suppress/config/v323/diff/audit/filter/paged/range/outliers/severity/burst/cooldown',
    (req, res) => {
      try {
        const from323        = Number(req.query.from);
        const to323          = Number(req.query.to);
        const startPage323   = req.query.startPage   ? Number(req.query.startPage)   : 1;
        const endPage323     = req.query.endPage     ? Number(req.query.endPage)     : startPage323;
        const pageSize323    = req.query.pageSize    ? Number(req.query.pageSize)    : 20;
        const stdFactor323   = req.query.stdFactor   ? Number(req.query.stdFactor)   : 2.0;
        const cFrom323       = req.query.compareFrom  !== undefined ? Number(req.query.compareFrom)  : from323;
        const cTo323         = req.query.compareTo    !== undefined ? Number(req.query.compareTo)    : to323;
        const cStart323      = req.query.compareStartPage !== undefined ? Number(req.query.compareStartPage) : startPage323;
        const cEnd323        = req.query.compareEndPage   !== undefined ? Number(req.query.compareEndPage)   : endPage323;
        const thresh323      = req.query.trendThreshold ? Number(req.query.trendThreshold) : 0.01;
        const winSize323     = req.query.burstWindowSize      ? Number(req.query.burstWindowSize)      : 5;
        const burstFactor323 = req.query.burstThresholdFactor ? Number(req.query.burstThresholdFactor) : 2.0;
        const cooldownMs323  = req.query.burstCooldownMs      ? Number(req.query.burstCooldownMs)      : 0;
        res.json(bridge323.pagedDiffSeverityBurstCooldown323(
          from323, to323, startPage323, endPage323, pageSize323, stdFactor323,
          cFrom323, cTo323, cStart323, cEnd323, thresh323, winSize323, burstFactor323, cooldownMs323
        ));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_323 });
      }
    }
  );

  // 3. POST cluster migration graph
  app.post(
    '/api/v1/market/backtest/sessions/v323/snapshot/search/ranked/semantic/clusters/migration/graph',
    (req, res) => {
      try {
        const snapshotTokenSets323 = req.body ? req.body.snapshotTokenSets : undefined;
        const threshold323         = req.body ? req.body.threshold         : undefined;
        res.json(buffer323.buildClusterMigrationGraph323(snapshotTokenSets323, threshold323));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_323 });
      }
    }
  );

  // 4. GET regime sojourn time
  app.get(
    '/api/v1/contracts/receipts/v323/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime/sojourn',
    (req, res) => {
      try {
        const source323   = req.query.source   || '';
        const windowMs323 = req.query.windowMs ? Number(req.query.windowMs) : 60000;
        const buckets323  = req.query.buckets  ? Number(req.query.buckets)  : 5;
        const baseline323 = req.query.baseline !== undefined ? Number(req.query.baseline) : 0;
        const elevated323 = req.query.elevated ? Number(req.query.elevated) : 1.5;
        const spike323    = req.query.spike    ? Number(req.query.spike)    : 3.0;
        const cmpWMs323   = req.query.compareWindowMs ? Number(req.query.compareWindowMs) : undefined;
        const incThr323   = req.query.increasing ? Number(req.query.increasing) : 0.05;
        const decThr323   = req.query.decreasing ? Number(req.query.decreasing) : 0.05;
        res.json(tracker323.trendNormDeltaRegimeSojournTime323(
          source323, windowMs323, buckets323, baseline323,
          { elevated: elevated323, spike: spike323 },
          cmpWMs323,
          { increasing: incThr323, decreasing: decThr323 }
        ));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_323 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_323,
  _coercePositiveInt323,
  _coercePositiveFloat323,
  _coerceNonNegativeInt323,
  AuditCapTrail323,
  defaultAuditCapTrail323,
  PageRangeDiffBridge323,
  defaultPageRangeDiffBridge323,
  RankedOverlapBuffer323,
  defaultRankedOverlapBuffer323,
  NormDeltaPercentilesTracker323,
  defaultNormDeltaPercentilesTracker323,
  registerV323Endpoints,
};
