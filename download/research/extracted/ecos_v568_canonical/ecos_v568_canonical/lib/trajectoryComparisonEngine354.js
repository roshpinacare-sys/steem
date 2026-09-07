'use strict';
/**
 * lib/trajectoryComparisonEngine354.js — ECOS V354 (Phase P242)
 * Trajectory Comparison Engine
 *
 * Extends V353 Health Trajectory Engine with four advanced analytical tools
 * that operate on sequences of V353 outputs, enabling trajectory report
 * comparison, fleet SLA monitoring, trend forecast extension, and
 * executive briefing aggregation.
 *
 *   V353 → scorecard history tracker, dimension alert detector, remediation
 *           priority matrix, health trajectory report
 *   V354 → trajectory comparison engine, fleet SLA monitor,
 *           trend forecast extender, executive briefing builder
 *
 * Four concrete tools:
 *
 *   1. compareTrajectoryReports354     — takes two V353 buildTrajectoryReport353
 *      outputs (baseline + current) and produces a structured diff. Returns
 *      per-dimension score deltas, alert delta (new/resolved alerts), urgency
 *      direction (escalating/de-escalating/unchanged), and an overall
 *      improvement index.
 *
 *   2. monitorFleetSLA354              — takes a V353 trajectory report and a
 *      set of SLA targets (e.g. compositeScore ≥ 70, no critical alerts for
 *      7+ days). Returns SLA compliance status per target, breach reasons,
 *      time-in-breach counters, and a worst-SLA-first sorted breach list.
 *
 *   3. extendTrendForecast354          — takes a V353 trackScorecardHistory353
 *      output and extends the composite score trend N periods forward using
 *      linear extrapolation with a configurable confidence band. Returns
 *      expected/optimistic/pessimistic per future period and a
 *      forecastReliability rating (high/medium/low/insufficient_data).
 *
 *   4. buildExecutiveBriefing354       — aggregates V353 trajectory report,
 *      V354 SLA monitor, and V354 forecast extender into a single page-length
 *      executive briefing. Contains: current health status, key risks, SLA
 *      compliance summary, 3-period forward outlook, and up to 3 top
 *      recommended actions.
 *
 * Pure / dependency-free (R3). All new public identifiers end with `354` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). Additive only (R6).
 *
 * @version 354.0.0
 */

const crypto = require('crypto');

const TRAJECTORY_COMPARISON_ENGINE_VERSION_354 = '354.0.0';

/* ─── internal helpers ────────────────────────────────────────────────────── */

function _comparisonId354(ts) {
  return 'trajcmp_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _slaMonitorId354(ts) {
  return 'slamon_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _forecastId354(ts) {
  return 'trndfcst_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _briefingId354(ts) {
  return 'execbrief_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _hashContent354(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function _clamp354(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function _mean354(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function _slope354(arr) {
  if (!arr || arr.length < 2) return 0;
  const n = arr.length;
  const xMean = (n - 1) / 2;
  const yMean = _mean354(arr);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (arr[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/* ─── 1. compareTrajectoryReports354 ─────────────────────────────────────── */

/**
 * compareTrajectoryReports354(baseline, current, opts)
 *
 * Takes two V353 `buildTrajectoryReport353` outputs and produces a structured
 * diff. Returns per-dimension score deltas, alert delta (new/resolved alerts),
 * urgency direction (escalating/de-escalating/unchanged), and an overall
 * improvement index.
 *
 * @param {Object} baseline - V353 buildTrajectoryReport353 baseline output
 * @param {Object} current  - V353 buildTrajectoryReport353 current output
 * @param {Object} opts
 * @param {number} opts.improvementThreshold - Min composite delta for "improved" (default 5)
 * @returns {Object} Comparison result
 */
function compareTrajectoryReports354(baseline, current, opts = {}) {
  const ts = new Date();
  const comparisonId = _comparisonId354(ts);
  const improvementThreshold = opts.improvementThreshold != null ? opts.improvementThreshold : 5;

  if (!baseline && !current) {
    return {
      ok: true,
      comparisonId,
      dimensionDeltas: {},
      alertDelta: { newAlerts: 0, resolvedAlerts: 0, netDelta: 0 },
      urgencyDirection: 'unchanged',
      compositeScoreDelta: null,
      improvementIndex: 0,
      overallDirection: 'insufficient_data',
      version: TRAJECTORY_COMPARISON_ENGINE_VERSION_354,
      summary: 'No inputs provided — comparison unavailable.'
    };
  }

  const DIMENSIONS = ['stability', 'momentum', 'predictability', 'responsiveness'];

  // ── per-dimension deltas ──────────────────────────────────────────────────
  const dimensionDeltas = {};
  const baseStatuses = (baseline && baseline.dimensionStatuses) || [];
  const currStatuses  = (current  && current.dimensionStatuses)  || [];

  for (const dim of DIMENSIONS) {
    const baseEntry = baseStatuses.find(d => d.dimension === dim);
    const currEntry  = currStatuses.find(d => d.dimension === dim);
    const baseVal = baseEntry ? baseEntry.currentValue : null;
    const currVal  = currEntry  ? currEntry.currentValue  : null;
    const delta = (baseVal !== null && currVal !== null) ? currVal - baseVal : null;
    const direction =
      delta === null        ? 'unknown'   :
      delta >  improvementThreshold ? 'improved'   :
      delta < -improvementThreshold ? 'degraded'   : 'unchanged';

    dimensionDeltas[dim] = { baseValue: baseVal, currentValue: currVal, delta, direction };
  }

  // ── alert delta ───────────────────────────────────────────────────────────
  const baseAlertCount = (baseline && baseline.activeAlertCount) || 0;
  const currAlertCount  = (current  && current.activeAlertCount)  || 0;
  const alertNetDelta   = currAlertCount - baseAlertCount;
  const newAlerts       = Math.max(0,  alertNetDelta);
  const resolvedAlerts  = Math.max(0, -alertNetDelta);

  const alertDelta = { newAlerts, resolvedAlerts, netDelta: alertNetDelta };

  // ── urgency direction ─────────────────────────────────────────────────────
  const baseUrgency = (baseline && baseline.overallUrgency) || 'none';
  const currUrgency  = (current  && current.overallUrgency)  || 'none';
  const urgencyRank  = { none: 0, low: 1, elevated: 2, critical: 3 };
  const baseRank     = urgencyRank[baseUrgency] != null ? urgencyRank[baseUrgency] : 0;
  const currRank     = urgencyRank[currUrgency]  != null ? urgencyRank[currUrgency]  : 0;

  let urgencyDirection;
  if (currRank > baseRank)      urgencyDirection = 'escalating';
  else if (currRank < baseRank) urgencyDirection = 'de-escalating';
  else                          urgencyDirection = 'unchanged';

  // ── composite score delta ─────────────────────────────────────────────────
  const baseComposite = (baseline && baseline.latestCompositeScore != null)
    ? baseline.latestCompositeScore : null;
  const currComposite  = (current  && current.latestCompositeScore  != null)
    ? current.latestCompositeScore  : null;
  const compositeScoreDelta = (baseComposite !== null && currComposite !== null)
    ? currComposite - baseComposite : null;

  // ── improvement index ─────────────────────────────────────────────────────
  // Composite: composite delta contribution (clamped) + alert reduction + urgency drop
  let improvementIndex = 0;
  if (compositeScoreDelta !== null) {
    improvementIndex += _clamp354(compositeScoreDelta, -50, 50);
  }
  improvementIndex -= alertNetDelta * 5;       // each new alert subtracts 5
  improvementIndex += (baseRank - currRank) * 10; // urgency drop adds 10 per rank
  improvementIndex = Math.round(_clamp354(improvementIndex, -100, 100));

  // ── overall direction ─────────────────────────────────────────────────────
  let overallDirection;
  if (compositeScoreDelta === null && alertNetDelta === 0) {
    overallDirection = 'insufficient_data';
  } else if (improvementIndex >= improvementThreshold) {
    overallDirection = 'improved';
  } else if (improvementIndex <= -improvementThreshold) {
    overallDirection = 'degraded';
  } else {
    overallDirection = 'unchanged';
  }

  const summary =
    `Trajectory comparison: composite delta=${compositeScoreDelta !== null ? compositeScoreDelta : 'N/A'}, ` +
    `alert delta=${alertNetDelta > 0 ? '+' : ''}${alertNetDelta}, ` +
    `urgency=${urgencyDirection}, improvement index=${improvementIndex}, ` +
    `overall=${overallDirection}.`;

  return {
    ok: true,
    comparisonId,
    dimensionDeltas,
    alertDelta,
    urgencyDirection,
    compositeScoreDelta,
    improvementIndex,
    overallDirection,
    version: TRAJECTORY_COMPARISON_ENGINE_VERSION_354,
    summary
  };
}

/* ─── 2. monitorFleetSLA354 ──────────────────────────────────────────────── */

/**
 * monitorFleetSLA354(trajectoryReport, slaConfig, opts)
 *
 * Takes a V353 trajectory report and a set of SLA targets. Returns SLA
 * compliance status per target, breach reasons, time-in-breach counters, and
 * a worst-SLA-first sorted breach list.
 *
 * SLA target shape:
 *   { id, metric, operator, threshold, maxBreachPeriods? }
 *   metric:   'compositeScore' | 'alertCount' | 'urgency' | 'grade'
 *   operator: 'gte' | 'lte' | 'eq' | 'neq' | 'lt' | 'gt'
 *
 * @param {Object}   trajectoryReport - V353 buildTrajectoryReport353 output
 * @param {Array}    slaConfig        - Array of SLA target objects
 * @param {Object}   opts
 * @param {boolean}  opts.strict      - Treat missing metric as breach (default false)
 * @returns {Object} SLA monitor result
 */
function monitorFleetSLA354(trajectoryReport, slaConfig, opts = {}) {
  const ts = new Date();
  const monitorId = _slaMonitorId354(ts);
  const strict = opts.strict === true;

  if (!trajectoryReport && (!slaConfig || slaConfig.length === 0)) {
    return {
      ok: true,
      monitorId,
      slaResults: [],
      totalTargets: 0,
      compliantCount: 0,
      breachCount: 0,
      overallCompliance: 'no_targets',
      worstBreaches: [],
      version: TRAJECTORY_COMPARISON_ENGINE_VERSION_354,
      summary: 'No trajectory report or SLA targets provided.'
    };
  }

  const report = trajectoryReport || {};
  const targets = Array.isArray(slaConfig) ? slaConfig : [];

  // Extract observable metrics from the report
  const observedMetrics = {
    compositeScore: report.latestCompositeScore != null ? report.latestCompositeScore : null,
    alertCount:     typeof report.activeAlertCount === 'number' ? report.activeAlertCount : null,
    urgency:        report.overallUrgency || null,
    grade:          report.latestScorecardGrade || null,
  };

  const URGENCY_RANK = { none: 0, low: 1, elevated: 2, critical: 3 };

  function _evaluate(operator, observed, threshold) {
    if (observed === null || observed === undefined) return null; // unknown
    // Numeric comparison
    if (typeof observed === 'number') {
      switch (operator) {
        case 'gte': return observed >= threshold;
        case 'lte': return observed <= threshold;
        case 'gt':  return observed >  threshold;
        case 'lt':  return observed <  threshold;
        case 'eq':  return observed === threshold;
        case 'neq': return observed !== threshold;
        default:    return null;
      }
    }
    // Urgency rank comparison
    if (observed === 'none' || observed === 'low' || observed === 'elevated' || observed === 'critical') {
      const obsRank   = URGENCY_RANK[observed]   != null ? URGENCY_RANK[observed]   : -1;
      const thrRank   = URGENCY_RANK[threshold]  != null ? URGENCY_RANK[threshold]  : -1;
      switch (operator) {
        case 'gte': return obsRank >= thrRank;
        case 'lte': return obsRank <= thrRank;
        case 'gt':  return obsRank >  thrRank;
        case 'lt':  return obsRank <  thrRank;
        case 'eq':  return observed === threshold;
        case 'neq': return observed !== threshold;
        default:    return null;
      }
    }
    // String equality
    switch (operator) {
      case 'eq':  return observed === threshold;
      case 'neq': return observed !== threshold;
      default:    return null;
    }
  }

  const slaResults = [];

  for (const target of targets) {
    const { id, metric, operator, threshold, maxBreachPeriods } = target;
    const observed = observedMetrics[metric] != null ? observedMetrics[metric] : null;
    const evalResult = _evaluate(operator, observed, threshold);

    let status, breachReason;
    if (evalResult === null) {
      status = strict ? 'breach' : 'unknown';
      breachReason = strict ? `Metric '${metric}' is unavailable (strict mode).` : null;
    } else if (evalResult === true) {
      status = 'compliant';
      breachReason = null;
    } else {
      status = 'breach';
      breachReason =
        `SLA '${id || metric}' requires ${metric} ${operator} ${threshold}; ` +
        `observed: ${observed}.`;
    }

    const timeInBreach = status === 'breach' ? 1 : 0; // single snapshot = 1 period if in breach
    const maxBreach    = maxBreachPeriods != null ? maxBreachPeriods : Infinity;
    const breachSeverity =
      status !== 'breach'      ? 'none'     :
      timeInBreach >= maxBreach ? 'critical' : 'warning';

    slaResults.push({
      id:          id || metric,
      metric,
      operator,
      threshold,
      observedValue: observed,
      status,
      breachReason,
      timeInBreach,
      maxBreachPeriods: maxBreachPeriods != null ? maxBreachPeriods : null,
      breachSeverity
    });
  }

  const compliantCount = slaResults.filter(r => r.status === 'compliant').length;
  const breachCount    = slaResults.filter(r => r.status === 'breach').length;

  let overallCompliance;
  if (targets.length === 0) {
    overallCompliance = 'no_targets';
  } else if (breachCount === 0) {
    overallCompliance = 'fully_compliant';
  } else if (compliantCount === 0) {
    overallCompliance = 'fully_breached';
  } else {
    overallCompliance = 'partially_compliant';
  }

  // Worst breaches: critical first, then warning; sort by timeInBreach desc
  const worstBreaches = slaResults
    .filter(r => r.status === 'breach')
    .sort((a, b) => {
      const sevOrder = { critical: 0, warning: 1, none: 2 };
      const sA = sevOrder[a.breachSeverity] != null ? sevOrder[a.breachSeverity] : 99;
      const sB = sevOrder[b.breachSeverity] != null ? sevOrder[b.breachSeverity] : 99;
      if (sA !== sB) return sA - sB;
      return b.timeInBreach - a.timeInBreach;
    });

  const summary =
    `SLA monitor: ${targets.length} target(s), ${compliantCount} compliant, ` +
    `${breachCount} breach(es), overall=${overallCompliance}.`;

  return {
    ok: true,
    monitorId,
    slaResults,
    totalTargets: targets.length,
    compliantCount,
    breachCount,
    overallCompliance,
    worstBreaches,
    version: TRAJECTORY_COMPARISON_ENGINE_VERSION_354,
    summary
  };
}

/* ─── 3. extendTrendForecast354 ──────────────────────────────────────────── */

/**
 * extendTrendForecast354(scorecardHistory, opts)
 *
 * Takes a V353 `trackScorecardHistory353` output and extends the composite
 * score trend N periods forward using linear extrapolation with a configurable
 * confidence band. Returns expected/optimistic/pessimistic per future period
 * and a forecastReliability rating.
 *
 * @param {Object} scorecardHistory - V353 trackScorecardHistory353 output
 * @param {Object} opts
 * @param {number} opts.forecastPeriods  - Number of periods to forecast (default 3)
 * @param {number} opts.confidenceBand   - ±points for opt/pess band (default 10)
 * @param {number} opts.minHistoryPeriods - Min snapshots for reliable forecast (default 3)
 * @returns {Object} Trend forecast result
 */
function extendTrendForecast354(scorecardHistory, opts = {}) {
  const ts = new Date();
  const forecastId = _forecastId354(ts);
  const forecastPeriods   = opts.forecastPeriods   != null ? opts.forecastPeriods   : 3;
  const confidenceBand    = opts.confidenceBand    != null ? opts.confidenceBand    : 10;
  const minHistoryPeriods = opts.minHistoryPeriods != null ? opts.minHistoryPeriods : 3;

  if (!scorecardHistory || !scorecardHistory.ok) {
    return {
      ok: true,
      forecastId,
      forecastedPeriods: [],
      forecastReliability: 'insufficient_data',
      slope: null,
      lastObservedScore: null,
      lastObservedPeriod: null,
      version: TRAJECTORY_COMPARISON_ENGINE_VERSION_354,
      summary: 'No valid scorecard history provided — forecast unavailable.'
    };
  }

  const timeline = (scorecardHistory.compositeScoreTimeline || [])
    .filter(p => p.compositeScore !== null && p.compositeScore !== undefined);

  if (timeline.length < 2) {
    return {
      ok: true,
      forecastId,
      forecastedPeriods: [],
      forecastReliability: 'insufficient_data',
      slope: null,
      lastObservedScore: timeline.length === 1 ? timeline[0].compositeScore : null,
      lastObservedPeriod: timeline.length === 1 ? timeline[0].period : null,
      version: TRAJECTORY_COMPARISON_ENGINE_VERSION_354,
      summary: 'Insufficient history (< 2 data points) — cannot extrapolate trend.'
    };
  }

  const values     = timeline.map(p => p.compositeScore);
  const slope      = _slope354(values);
  const lastEntry  = timeline[timeline.length - 1];
  const lastScore  = lastEntry.compositeScore;
  const lastPeriod = lastEntry.period;

  // Forecast reliability
  let forecastReliability;
  if (timeline.length >= minHistoryPeriods * 2) {
    forecastReliability = 'high';
  } else if (timeline.length >= minHistoryPeriods) {
    forecastReliability = 'medium';
  } else {
    forecastReliability = 'low';
  }

  // Build forecasted periods
  const forecastedPeriods = [];
  for (let i = 1; i <= forecastPeriods; i++) {
    const expected     = Math.round(_clamp354(lastScore + slope * i, 0, 100) * 10) / 10;
    const optimistic   = Math.round(_clamp354(expected + confidenceBand, 0, 100) * 10) / 10;
    const pessimistic  = Math.round(_clamp354(expected - confidenceBand, 0, 100) * 10) / 10;
    forecastedPeriods.push({
      period: lastPeriod + i,
      expected,
      optimistic,
      pessimistic
    });
  }

  const nextExpected = forecastedPeriods.length > 0 ? forecastedPeriods[0].expected : null;

  const summary =
    `Trend forecast: ${timeline.length} historical period(s), slope=${slope.toFixed(3)}, ` +
    `last score=${lastScore}, next expected=${nextExpected}, ` +
    `reliability=${forecastReliability}.`;

  return {
    ok: true,
    forecastId,
    forecastedPeriods,
    forecastReliability,
    slope,
    lastObservedScore: lastScore,
    lastObservedPeriod: lastPeriod,
    version: TRAJECTORY_COMPARISON_ENGINE_VERSION_354,
    summary
  };
}

/* ─── 4. buildExecutiveBriefing354 ──────────────────────────────────────── */

/**
 * buildExecutiveBriefing354(report, sla, forecast, opts)
 *
 * Aggregates V353 trajectory report, V354 SLA monitor, and V354 forecast
 * extender into a single page-length executive briefing. Contains: current
 * health status, key risks, SLA compliance summary, 3-period forward outlook,
 * and up to 3 top recommended actions.
 *
 * @param {Object} report   - V353 buildTrajectoryReport353 output
 * @param {Object} sla      - V354 monitorFleetSLA354 output
 * @param {Object} forecast - V354 extendTrendForecast354 output
 * @param {Object} opts
 * @param {number} opts.maxActions - Max recommended actions to include (default 3)
 * @returns {Object} Executive briefing result
 */
function buildExecutiveBriefing354(report, sla, forecast, opts = {}) {
  const ts = new Date();
  const briefingId = _briefingId354(ts);
  const maxActions = opts.maxActions != null ? opts.maxActions : 3;

  const hasAnyInput = report || sla || forecast;
  if (!hasAnyInput) {
    return {
      ok: true,
      briefingId,
      generatedAt: ts.toISOString(),
      currentHealthStatus: 'unknown',
      keyRisks: [],
      slaComplianceSummary: 'No SLA data available.',
      forwardOutlook: [],
      topRecommendedActions: [],
      overallRating: 'N/A',
      version: TRAJECTORY_COMPARISON_ENGINE_VERSION_354,
      summary: 'No inputs provided — executive briefing unavailable.'
    };
  }

  // ── Current health status ─────────────────────────────────────────────────
  const latestScore  = report ? report.latestCompositeScore  : null;
  const latestGrade  = report ? (report.latestScorecardGrade || 'N/A') : 'N/A';
  const trend        = report ? (report.compositeScoreTrend  || 'unknown') : 'unknown';
  const urgency      = report ? (report.overallUrgency       || 'none')    : 'none';
  const alertCount   = report ? (report.activeAlertCount     || 0)         : 0;
  const hasCritical  = report ? (report.hasCriticalAlerts    || false)     : false;
  const outlook      = report ? (report.outlook              || 'unknown') : 'unknown';

  const currentHealthStatus =
    latestScore !== null
      ? `Grade ${latestGrade} (score ${latestScore}), trend: ${trend}, urgency: ${urgency}`
      : `Grade ${latestGrade}, trend: ${trend}, urgency: ${urgency}`;

  // ── Key risks ─────────────────────────────────────────────────────────────
  const keyRisks = [];

  if (hasCritical) {
    keyRisks.push({ risk: 'CRITICAL alerts active', severity: 'critical', source: 'alerts' });
  }
  if (urgency === 'critical') {
    keyRisks.push({ risk: 'Overall urgency is CRITICAL — immediate remediation required', severity: 'critical', source: 'urgency' });
  }
  if (trend === 'degrading') {
    keyRisks.push({ risk: 'Composite score is on a degrading trend', severity: 'warning', source: 'trend' });
  }
  if (sla && sla.breachCount > 0) {
    keyRisks.push({ risk: `${sla.breachCount} SLA target(s) in breach`, severity: sla.worstBreaches[0] && sla.worstBreaches[0].breachSeverity === 'critical' ? 'critical' : 'warning', source: 'sla' });
  }
  if (forecast && forecast.forecastReliability === 'insufficient_data') {
    keyRisks.push({ risk: 'Insufficient history for reliable forecast', severity: 'info', source: 'forecast' });
  }

  // Sort: critical first
  const riskOrder = { critical: 0, warning: 1, info: 2 };
  keyRisks.sort((a, b) => (riskOrder[a.severity] ?? 99) - (riskOrder[b.severity] ?? 99));

  // ── SLA compliance summary ────────────────────────────────────────────────
  let slaComplianceSummary;
  if (!sla) {
    slaComplianceSummary = 'No SLA data available.';
  } else if (sla.totalTargets === 0) {
    slaComplianceSummary = 'No SLA targets configured.';
  } else {
    slaComplianceSummary =
      `${sla.compliantCount}/${sla.totalTargets} SLA target(s) compliant ` +
      `(${sla.breachCount} breach${sla.breachCount !== 1 ? 'es' : ''}). ` +
      `Overall: ${sla.overallCompliance}.`;
  }

  // ── Forward outlook (up to 3 forecasted periods) ─────────────────────────
  const forwardOutlook = forecast && forecast.forecastedPeriods
    ? forecast.forecastedPeriods.slice(0, 3).map(p => ({
        period: p.period,
        expected: p.expected,
        optimistic: p.optimistic,
        pessimistic: p.pessimistic
      }))
    : [];

  // ── Top recommended actions ───────────────────────────────────────────────
  const topRecommendedActions = [];
  if (report && report.topRemediationActions) {
    for (const a of report.topRemediationActions) {
      if (topRecommendedActions.length >= maxActions) break;
      topRecommendedActions.push({
        dimension: a.dimension,
        urgencyScore: a.urgencyScore,
        action: a.action
      });
    }
  }

  // ── Overall rating ────────────────────────────────────────────────────────
  let overallRating;
  if (hasCritical || urgency === 'critical') {
    overallRating = 'AT_RISK';
  } else if (alertCount > 0 || urgency === 'elevated' || trend === 'degrading') {
    overallRating = 'UNDER_REVIEW';
  } else if (trend === 'improving' && alertCount === 0) {
    overallRating = 'HEALTHY';
  } else {
    overallRating = 'STABLE';
  }

  const firstForecast = forwardOutlook.length > 0 ? forwardOutlook[0].expected : null;
  const briefingSummary =
    `Executive briefing: status=${overallRating}, grade=${latestGrade}, ` +
    `trend=${trend}, ${alertCount} alert(s), ` +
    `SLA=${sla ? sla.overallCompliance : 'N/A'}, ` +
    `next period forecast=${firstForecast !== null ? firstForecast : 'N/A'}.`;

  return {
    ok: true,
    briefingId,
    generatedAt: ts.toISOString(),
    currentHealthStatus,
    keyRisks,
    slaComplianceSummary,
    forwardOutlook,
    topRecommendedActions,
    overallRating,
    outlook,
    version: TRAJECTORY_COMPARISON_ENGINE_VERSION_354,
    summary: briefingSummary
  };
}

/* ─── exports ─────────────────────────────────────────────────────────────── */

module.exports = {
  TRAJECTORY_COMPARISON_ENGINE_VERSION_354,
  compareTrajectoryReports354,
  monitorFleetSLA354,
  extendTrendForecast354,
  buildExecutiveBriefing354,
  // ID generators (exported for testing)
  _comparisonId354,
  _slaMonitorId354,
  _forecastId354,
  _briefingId354,
  // Internal helpers (exported for testing)
  _hashContent354,
  _clamp354,
  _mean354,
  _slope354
};
