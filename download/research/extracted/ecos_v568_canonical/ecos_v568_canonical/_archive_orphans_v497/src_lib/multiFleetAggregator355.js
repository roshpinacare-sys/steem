'use strict';
/**
 * lib/multiFleetAggregator355.js — ECOS V355 (Phase P243)
 * Multi-Fleet Aggregator Engine
 *
 * Extends V354 Trajectory Comparison Engine with four advanced analytical tools
 * that operate on sequences of V354 outputs, enabling multi-fleet executive
 * briefing aggregation, SLA trend scoring, comparison timeline building, and
 * forecast vs actuals reconciliation.
 *
 *   V354 → trajectory diff, fleet SLA monitor, trend forecast extender,
 *           executive briefing builder
 *   V355 → multi-fleet briefing aggregator, SLA trend scorer,
 *           comparison timeline builder, forecast/actuals reconciler
 *
 * Four concrete tools:
 *
 *   1. aggregateFleetBriefings355     — takes multiple V354
 *      buildExecutiveBriefing354 outputs (one per fleet or tenant) and rolls
 *      them up into a combined executive summary. Returns a fleet-count-weighted
 *      composite rating, top risks across all fleets, worst SLA breach across
 *      fleets, combined forward outlook (average expected score per period), and
 *      an overall multi-fleet health index.
 *
 *   2. buildSLATrendScore355          — takes multiple V354
 *      monitorFleetSLA354 outputs over time and scores how consistently each
 *      SLA target has been met. Returns per-target compliance rate (fraction of
 *      periods compliant), a stability class
 *      (always_compliant/mostly_compliant/at_risk/chronically_breached), and a
 *      portfolio SLA health score (0–100).
 *
 *   3. buildComparisonTimeline355     — takes multiple V354
 *      compareTrajectoryReports354 outputs ordered chronologically and builds a
 *      timeline of improvement index movement, direction changes, and urgency
 *      escalation/de-escalation events. Returns a change log with annotated
 *      inflection points.
 *
 *   4. reconcileForecastActuals355    — takes paired V354
 *      extendTrendForecast354 outputs alongside the actual composite scores
 *      observed in the forecasted periods. Returns per-period accuracy
 *      (expected vs actual delta), a mean absolute error, and a forecast
 *      calibration rating
 *      (well_calibrated/optimistic_bias/pessimistic_bias/uncalibrated).
 *
 * Pure / dependency-free (R3). All new public identifiers end with `355` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). Additive only (R6).
 *
 * @version 355.0.0
 */

const crypto = require('crypto');

const MULTI_FLEET_AGGREGATOR_VERSION_355 = '355.0.0';

/* ─── internal helpers ────────────────────────────────────────────────────── */

function _aggregatorId355(ts) {
  return 'mfltagg_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _slaTrendId355(ts) {
  return 'slatrnd_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _timelineId355(ts) {
  return 'cmptln_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _reconcileId355(ts) {
  return 'fcstrcn_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _hashContent355(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function _clamp355(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function _mean355(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function _slope355(arr) {
  if (!arr || arr.length < 2) return 0;
  const n = arr.length;
  const xMean = (n - 1) / 2;
  const yMean = _mean355(arr);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (arr[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/* ─── 1. aggregateFleetBriefings355 ─────────────────────────────────────── */

/**
 * aggregateFleetBriefings355(briefings, opts)
 *
 * Takes multiple V354 `buildExecutiveBriefing354` outputs (one per fleet or
 * tenant) and rolls them up into a combined executive summary. Returns a
 * fleet-count-weighted composite rating, top risks across all fleets, worst
 * SLA breach across fleets, combined forward outlook (average expected score
 * per period), and an overall multi-fleet health index.
 *
 * @param {Array}  briefings  - Array of V354 buildExecutiveBriefing354 outputs
 * @param {Object} opts
 * @param {number} opts.maxRisks    - Max top risks to surface (default 5)
 * @param {number} opts.maxActions  - Max top actions to surface (default 3)
 * @returns {Object} Multi-fleet aggregation result
 */
function aggregateFleetBriefings355(briefings, opts = {}) {
  const ts = new Date();
  const aggregatorId = _aggregatorId355(ts);
  const maxRisks   = opts.maxRisks   != null ? opts.maxRisks   : 5;
  const maxActions = opts.maxActions != null ? opts.maxActions : 3;

  if (!briefings || briefings.length === 0) {
    return {
      ok: true,
      aggregatorId,
      generatedAt: ts.toISOString(),
      fleetCount: 0,
      compositeRating: 'N/A',
      healthIndex: null,
      ratingDistribution: {},
      topRisksAcrossFleets: [],
      worstSLABreach: null,
      combinedForwardOutlook: [],
      topRecommendedActions: [],
      version: MULTI_FLEET_AGGREGATOR_VERSION_355,
      summary: 'No briefings provided — multi-fleet aggregation unavailable.'
    };
  }

  const validBriefings = briefings.filter(b => b && b.ok);
  const fleetCount = validBriefings.length;

  // ── Rating distribution ───────────────────────────────────────────────────
  const RATING_RANK = { HEALTHY: 3, STABLE: 2, UNDER_REVIEW: 1, AT_RISK: 0, 'N/A': -1 };
  const RATING_SCORE = { HEALTHY: 100, STABLE: 75, UNDER_REVIEW: 45, AT_RISK: 15, 'N/A': 50 };

  const ratingDistribution = { HEALTHY: 0, STABLE: 0, UNDER_REVIEW: 0, AT_RISK: 0 };
  let totalHealthScore = 0;

  for (const b of validBriefings) {
    const rating = b.overallRating || 'N/A';
    if (ratingDistribution[rating] !== undefined) {
      ratingDistribution[rating]++;
    }
    totalHealthScore += RATING_SCORE[rating] != null ? RATING_SCORE[rating] : 50;
  }

  const healthIndex = fleetCount > 0
    ? Math.round(totalHealthScore / fleetCount)
    : null;

  // ── Composite rating (weighted by worst fleet) ────────────────────────────
  let minRating = 'HEALTHY';
  for (const b of validBriefings) {
    const rating = b.overallRating || 'N/A';
    if (RATING_RANK[rating] != null && RATING_RANK[rating] < (RATING_RANK[minRating] ?? 99)) {
      minRating = rating;
    }
  }
  const compositeRating = fleetCount > 0 ? minRating : 'N/A';

  // ── Top risks across all fleets ───────────────────────────────────────────
  const allRisks = [];
  for (const b of validBriefings) {
    if (b.keyRisks && Array.isArray(b.keyRisks)) {
      for (const risk of b.keyRisks) {
        allRisks.push({ ...risk, fleet: b.briefingId || 'unknown' });
      }
    }
  }
  const riskOrder = { critical: 0, warning: 1, info: 2 };
  allRisks.sort((a, b) => (riskOrder[a.severity] ?? 99) - (riskOrder[b.severity] ?? 99));
  const topRisksAcrossFleets = allRisks.slice(0, maxRisks);

  // ── Worst SLA breach across fleets ───────────────────────────────────────
  let worstSLABreach = null;
  for (const b of validBriefings) {
    if (b.slaComplianceSummary && typeof b.slaComplianceSummary === 'string') {
      const breachMatch = b.slaComplianceSummary.match(/(\d+) breach/);
      const breachCount = breachMatch ? parseInt(breachMatch[1], 10) : 0;
      if (breachCount > 0) {
        if (!worstSLABreach || breachCount > worstSLABreach.breachCount) {
          worstSLABreach = {
            fleet: b.briefingId || 'unknown',
            breachCount,
            summary: b.slaComplianceSummary
          };
        }
      }
    }
  }

  // ── Combined forward outlook (average expected score per period) ─────────
  const periodMap = {};
  for (const b of validBriefings) {
    if (b.forwardOutlook && Array.isArray(b.forwardOutlook)) {
      for (const p of b.forwardOutlook) {
        const key = `period_${p.period}`;
        if (!periodMap[key]) {
          periodMap[key] = { period: p.period, expectedScores: [], optimisticScores: [], pessimisticScores: [] };
        }
        if (p.expected   != null) periodMap[key].expectedScores.push(p.expected);
        if (p.optimistic != null) periodMap[key].optimisticScores.push(p.optimistic);
        if (p.pessimistic != null) periodMap[key].pessimisticScores.push(p.pessimistic);
      }
    }
  }
  const combinedForwardOutlook = Object.values(periodMap)
    .sort((a, b) => a.period - b.period)
    .map(p => ({
      period:      p.period,
      avgExpected:    p.expectedScores.length    > 0 ? Math.round(_mean355(p.expectedScores)    * 10) / 10 : null,
      avgOptimistic:  p.optimisticScores.length  > 0 ? Math.round(_mean355(p.optimisticScores)  * 10) / 10 : null,
      avgPessimistic: p.pessimisticScores.length > 0 ? Math.round(_mean355(p.pessimisticScores) * 10) / 10 : null,
      fleetCount: p.expectedScores.length
    }));

  // ── Top recommended actions (from all fleets, de-duped by action text) ───
  const seenActions = new Set();
  const allActions = [];
  for (const b of validBriefings) {
    if (b.topRecommendedActions && Array.isArray(b.topRecommendedActions)) {
      for (const a of b.topRecommendedActions) {
        const key = `${a.dimension}:${a.action}`;
        if (!seenActions.has(key)) {
          seenActions.add(key);
          allActions.push({ ...a, fleet: b.briefingId || 'unknown' });
        }
      }
    }
  }
  allActions.sort((a, b) => (b.urgencyScore || 0) - (a.urgencyScore || 0));
  const topRecommendedActions = allActions.slice(0, maxActions);

  const summary =
    `Multi-fleet aggregation: ${fleetCount} fleet(s), compositeRating=${compositeRating}, ` +
    `healthIndex=${healthIndex}, topRisks=${topRisksAcrossFleets.length}, ` +
    `worstBreach=${worstSLABreach ? worstSLABreach.breachCount + ' breach(es)' : 'none'}.`;

  return {
    ok: true,
    aggregatorId,
    generatedAt: ts.toISOString(),
    fleetCount,
    compositeRating,
    healthIndex,
    ratingDistribution,
    topRisksAcrossFleets,
    worstSLABreach,
    combinedForwardOutlook,
    topRecommendedActions,
    version: MULTI_FLEET_AGGREGATOR_VERSION_355,
    summary
  };
}

/* ─── 2. buildSLATrendScore355 ───────────────────────────────────────────── */

/**
 * buildSLATrendScore355(slaHistory, opts)
 *
 * Takes multiple V354 `monitorFleetSLA354` outputs over time and scores how
 * consistently each SLA target has been met. Returns per-target compliance
 * rate (fraction of periods compliant), a stability class
 * (always_compliant/mostly_compliant/at_risk/chronically_breached), and a
 * portfolio SLA health score (0–100).
 *
 * @param {Array}  slaHistory - Array of V354 monitorFleetSLA354 outputs (ordered by time)
 * @param {Object} opts
 * @param {number} opts.alwaysThreshold     - Compliance rate for always_compliant (default 1.0)
 * @param {number} opts.mostlyThreshold     - Compliance rate for mostly_compliant (default 0.8)
 * @param {number} opts.atRiskThreshold     - Compliance rate for at_risk (default 0.5)
 * @returns {Object} SLA trend score result
 */
function buildSLATrendScore355(slaHistory, opts = {}) {
  const ts = new Date();
  const slaTrendId = _slaTrendId355(ts);
  const alwaysThreshold  = opts.alwaysThreshold  != null ? opts.alwaysThreshold  : 1.0;
  const mostlyThreshold  = opts.mostlyThreshold  != null ? opts.mostlyThreshold  : 0.8;
  const atRiskThreshold  = opts.atRiskThreshold  != null ? opts.atRiskThreshold  : 0.5;

  if (!slaHistory || slaHistory.length === 0) {
    return {
      ok: true,
      slaTrendId,
      periodCount: 0,
      perTargetScores: [],
      portfolioSLAHealthScore: null,
      overallStabilityClass: 'insufficient_data',
      version: MULTI_FLEET_AGGREGATOR_VERSION_355,
      summary: 'No SLA history provided — trend score unavailable.'
    };
  }

  const validPeriods = slaHistory.filter(s => s && s.ok);
  const periodCount  = validPeriods.length;

  if (periodCount === 0) {
    return {
      ok: true,
      slaTrendId,
      periodCount: 0,
      perTargetScores: [],
      portfolioSLAHealthScore: null,
      overallStabilityClass: 'insufficient_data',
      version: MULTI_FLEET_AGGREGATOR_VERSION_355,
      summary: 'No valid SLA periods found — trend score unavailable.'
    };
  }

  // Collect all unique SLA target IDs across periods
  const targetMap = {};
  for (const period of validPeriods) {
    for (const result of (period.slaResults || [])) {
      const id = result.id || result.metric;
      if (!targetMap[id]) {
        targetMap[id] = { id, compliantCount: 0, totalCount: 0, metric: result.metric };
      }
      targetMap[id].totalCount++;
      if (result.status === 'compliant') {
        targetMap[id].compliantCount++;
      }
    }
  }

  const perTargetScores = Object.values(targetMap).map(t => {
    const complianceRate = t.totalCount > 0 ? t.compliantCount / t.totalCount : 0;
    let stabilityClass;
    if (complianceRate >= alwaysThreshold) {
      stabilityClass = 'always_compliant';
    } else if (complianceRate >= mostlyThreshold) {
      stabilityClass = 'mostly_compliant';
    } else if (complianceRate >= atRiskThreshold) {
      stabilityClass = 'at_risk';
    } else {
      stabilityClass = 'chronically_breached';
    }
    return {
      id: t.id,
      metric: t.metric,
      compliantPeriods: t.compliantCount,
      totalPeriods: t.totalCount,
      complianceRate: Math.round(complianceRate * 1000) / 1000,
      stabilityClass
    };
  });

  // Portfolio SLA health score: average of per-target compliance rates × 100
  const rates = perTargetScores.map(t => t.complianceRate);
  const portfolioSLAHealthScore = rates.length > 0
    ? Math.round(_mean355(rates) * 100)
    : null;

  // Overall stability class: worst across all targets
  const CLASS_ORDER = { always_compliant: 3, mostly_compliant: 2, at_risk: 1, chronically_breached: 0 };
  let worstClass = 'always_compliant';
  for (const t of perTargetScores) {
    if ((CLASS_ORDER[t.stabilityClass] ?? -1) < (CLASS_ORDER[worstClass] ?? 99)) {
      worstClass = t.stabilityClass;
    }
  }
  const overallStabilityClass = perTargetScores.length > 0 ? worstClass : 'insufficient_data';

  const summary =
    `SLA trend score: ${periodCount} period(s), ${perTargetScores.length} target(s), ` +
    `portfolioHealth=${portfolioSLAHealthScore}, overallClass=${overallStabilityClass}.`;

  return {
    ok: true,
    slaTrendId,
    periodCount,
    perTargetScores,
    portfolioSLAHealthScore,
    overallStabilityClass,
    version: MULTI_FLEET_AGGREGATOR_VERSION_355,
    summary
  };
}

/* ─── 3. buildComparisonTimeline355 ─────────────────────────────────────── */

/**
 * buildComparisonTimeline355(comparisons, opts)
 *
 * Takes multiple V354 `compareTrajectoryReports354` outputs ordered
 * chronologically and builds a timeline of improvement index movement,
 * direction changes, and urgency escalation/de-escalation events. Returns
 * a change log with annotated inflection points.
 *
 * @param {Array}  comparisons - Array of V354 compareTrajectoryReports354 outputs
 * @param {Object} opts
 * @param {number} opts.inflectionThreshold - Min improvement index change to flag inflection (default 10)
 * @returns {Object} Comparison timeline result
 */
function buildComparisonTimeline355(comparisons, opts = {}) {
  const ts = new Date();
  const timelineId = _timelineId355(ts);
  const inflectionThreshold = opts.inflectionThreshold != null ? opts.inflectionThreshold : 10;

  if (!comparisons || comparisons.length === 0) {
    return {
      ok: true,
      timelineId,
      periodCount: 0,
      improvementIndexTimeline: [],
      directionChangeLog: [],
      urgencyEventLog: [],
      inflectionPoints: [],
      overallTrend: 'insufficient_data',
      version: MULTI_FLEET_AGGREGATOR_VERSION_355,
      summary: 'No comparisons provided — timeline unavailable.'
    };
  }

  const validComparisons = comparisons.filter(c => c && c.ok);
  const periodCount = validComparisons.length;

  if (periodCount === 0) {
    return {
      ok: true,
      timelineId,
      periodCount: 0,
      improvementIndexTimeline: [],
      directionChangeLog: [],
      urgencyEventLog: [],
      inflectionPoints: [],
      overallTrend: 'insufficient_data',
      version: MULTI_FLEET_AGGREGATOR_VERSION_355,
      summary: 'No valid comparisons found — timeline unavailable.'
    };
  }

  // ── Improvement index timeline ────────────────────────────────────────────
  const improvementIndexTimeline = validComparisons.map((c, i) => ({
    period: i + 1,
    comparisonId: c.comparisonId || null,
    improvementIndex: c.improvementIndex != null ? c.improvementIndex : null,
    overallDirection: c.overallDirection || 'unknown'
  }));

  // ── Direction change log ──────────────────────────────────────────────────
  const directionChangeLog = [];
  for (let i = 1; i < improvementIndexTimeline.length; i++) {
    const prev = improvementIndexTimeline[i - 1];
    const curr = improvementIndexTimeline[i];
    if (curr.overallDirection !== prev.overallDirection) {
      directionChangeLog.push({
        period: curr.period,
        from: prev.overallDirection,
        to: curr.overallDirection,
        type: 'direction_change'
      });
    }
  }

  // ── Urgency event log ─────────────────────────────────────────────────────
  const urgencyEventLog = [];
  for (let i = 0; i < validComparisons.length; i++) {
    const c = validComparisons[i];
    if (c.urgencyDirection && c.urgencyDirection !== 'unchanged') {
      urgencyEventLog.push({
        period: i + 1,
        urgencyDirection: c.urgencyDirection,
        type: c.urgencyDirection === 'escalating' ? 'urgency_escalation' : 'urgency_de-escalation'
      });
    }
  }

  // ── Inflection points (large improvement index swings) ───────────────────
  const inflectionPoints = [];
  const indices = improvementIndexTimeline
    .map(p => p.improvementIndex)
    .filter(v => v !== null);

  for (let i = 1; i < improvementIndexTimeline.length; i++) {
    const prev = improvementIndexTimeline[i - 1];
    const curr = improvementIndexTimeline[i];
    if (prev.improvementIndex !== null && curr.improvementIndex !== null) {
      const swing = curr.improvementIndex - prev.improvementIndex;
      if (Math.abs(swing) >= inflectionThreshold) {
        inflectionPoints.push({
          period: curr.period,
          swing,
          type: swing > 0 ? 'positive_inflection' : 'negative_inflection',
          from: prev.improvementIndex,
          to: curr.improvementIndex
        });
      }
    }
  }

  // ── Overall trend from improvement index slope ────────────────────────────
  let overallTrend;
  if (indices.length < 2) {
    overallTrend = 'insufficient_data';
  } else {
    const slope = _slope355(indices);
    overallTrend = slope > 0.5 ? 'improving' : slope < -0.5 ? 'degrading' : 'stable';
  }

  const summary =
    `Comparison timeline: ${periodCount} period(s), ${directionChangeLog.length} direction change(s), ` +
    `${urgencyEventLog.length} urgency event(s), ${inflectionPoints.length} inflection point(s), ` +
    `overallTrend=${overallTrend}.`;

  return {
    ok: true,
    timelineId,
    periodCount,
    improvementIndexTimeline,
    directionChangeLog,
    urgencyEventLog,
    inflectionPoints,
    overallTrend,
    version: MULTI_FLEET_AGGREGATOR_VERSION_355,
    summary
  };
}

/* ─── 4. reconcileForecastActuals355 ─────────────────────────────────────── */

/**
 * reconcileForecastActuals355(forecasts, actuals, opts)
 *
 * Takes paired V354 `extendTrendForecast354` outputs alongside the actual
 * composite scores observed in the forecasted periods. Returns per-period
 * accuracy (expected vs actual delta), a mean absolute error, and a forecast
 * calibration rating (well_calibrated/optimistic_bias/pessimistic_bias/
 * uncalibrated).
 *
 * @param {Array}  forecasts - Array of V354 extendTrendForecast354 outputs
 * @param {Array}  actuals   - Array of { period, actualScore } objects
 * @param {Object} opts
 * @param {number} opts.accuracyThreshold - Max MAE for well_calibrated (default 10)
 * @param {number} opts.biasThreshold     - Max |bias| for well_calibrated (default 5)
 * @returns {Object} Forecast reconciliation result
 */
function reconcileForecastActuals355(forecasts, actuals, opts = {}) {
  const ts = new Date();
  const reconcileId = _reconcileId355(ts);
  const accuracyThreshold = opts.accuracyThreshold != null ? opts.accuracyThreshold : 10;
  const biasThreshold     = opts.biasThreshold     != null ? opts.biasThreshold     : 5;

  const noInput = (!forecasts || forecasts.length === 0) && (!actuals || actuals.length === 0);
  if (noInput) {
    return {
      ok: true,
      reconcileId,
      pairCount: 0,
      periodAccuracies: [],
      mae: null,
      bias: null,
      calibrationRating: 'insufficient_data',
      version: MULTI_FLEET_AGGREGATOR_VERSION_355,
      summary: 'No forecasts or actuals provided — reconciliation unavailable.'
    };
  }

  const validForecasts = (forecasts || []).filter(f => f && f.ok);
  const actualsMap = {};
  for (const a of (actuals || [])) {
    if (a && a.period != null) {
      actualsMap[a.period] = a.actualScore;
    }
  }

  // Build pairs: match each forecasted period with its actual
  const periodAccuracies = [];
  for (const forecast of validForecasts) {
    for (const fp of (forecast.forecastedPeriods || [])) {
      const period = fp.period;
      if (actualsMap[period] !== undefined) {
        const expected   = fp.expected;
        const actual     = actualsMap[period];
        const delta      = expected - actual;
        const absError   = Math.abs(delta);
        const withinBand =
          fp.pessimistic != null && fp.optimistic != null
            ? actual >= fp.pessimistic && actual <= fp.optimistic
            : null;
        periodAccuracies.push({
          period,
          expected,
          actual,
          delta,
          absError,
          withinConfidenceBand: withinBand,
          forecastId: forecast.forecastId || null
        });
      }
    }
  }

  const pairCount = periodAccuracies.length;

  if (pairCount === 0) {
    return {
      ok: true,
      reconcileId,
      pairCount: 0,
      periodAccuracies: [],
      mae: null,
      bias: null,
      calibrationRating: 'insufficient_data',
      version: MULTI_FLEET_AGGREGATOR_VERSION_355,
      summary: 'No matched forecast/actual pairs found — reconciliation unavailable.'
    };
  }

  const mae  = Math.round(_mean355(periodAccuracies.map(p => p.absError)) * 100) / 100;
  const bias = Math.round(_mean355(periodAccuracies.map(p => p.delta))    * 100) / 100;

  // Calibration rating
  let calibrationRating;
  if (mae <= accuracyThreshold && Math.abs(bias) <= biasThreshold) {
    calibrationRating = 'well_calibrated';
  } else if (bias > biasThreshold) {
    calibrationRating = 'optimistic_bias';
  } else if (bias < -biasThreshold) {
    calibrationRating = 'pessimistic_bias';
  } else {
    calibrationRating = 'uncalibrated';
  }

  const summary =
    `Forecast reconciliation: ${pairCount} pair(s), MAE=${mae}, bias=${bias}, ` +
    `calibration=${calibrationRating}.`;

  return {
    ok: true,
    reconcileId,
    pairCount,
    periodAccuracies,
    mae,
    bias,
    calibrationRating,
    version: MULTI_FLEET_AGGREGATOR_VERSION_355,
    summary
  };
}

/* ─── exports ─────────────────────────────────────────────────────────────── */

module.exports = {
  MULTI_FLEET_AGGREGATOR_VERSION_355,
  aggregateFleetBriefings355,
  buildSLATrendScore355,
  buildComparisonTimeline355,
  reconcileForecastActuals355,
  // ID generators (exported for testing)
  _aggregatorId355,
  _slaTrendId355,
  _timelineId355,
  _reconcileId355,
  // Internal helpers (exported for testing)
  _hashContent355,
  _clamp355,
  _mean355,
  _slope355
};
