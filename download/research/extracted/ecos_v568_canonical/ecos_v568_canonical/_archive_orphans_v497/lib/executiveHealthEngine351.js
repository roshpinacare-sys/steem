'use strict';
/**
 * lib/executiveHealthEngine351.js — ECOS V351 (Phase P239)
 * Executive Health & Forecast Engine
 *
 * Extends V350 Fleet Health History & Readiness Engine with four aggregation and
 * forecasting tools:
 *
 *   V350 → fleet health history tracking, impact-to-gap correlation,
 *           horizon stability evaluation, fleet readiness gate
 *   V351 → readiness trend tracking, remediation velocity monitoring,
 *           composite forecast combining, executive health summary
 *
 * Four concrete tools:
 *
 *   1. trackReadinessTrend351        — takes multiple V350 buildFleetReadinessGate350
 *      outputs over time and tracks how often the fleet is READY vs UNDER_REVIEW
 *      vs BLOCKED. Computes a readiness rate (% READY snapshots), average blocking
 *      reason count, and a trend toward or away from READY state.
 *
 *   2. measureRemediationVelocity351 — takes paired V350 correlateImpactToGaps350
 *      outputs over time and measures whether high-risk gaps are being resolved.
 *      Returns resolved count, new count, net delta, and a velocity classification
 *      (accelerating/steady/stalling).
 *
 *   3. combineFleetForecasts351      — combines V350 fleet health history trend with
 *      V350 horizon stability to produce a forward-looking fleet health forecast band
 *      (optimistic/expected/pessimistic score for the next N periods).
 *
 *   4. buildExecutiveSummary351      — aggregates all four V350 outputs into a single
 *      executive-level summary with a top-3 action items list, overall fleet grade,
 *      and a one-line status string suitable for dashboards.
 *
 * Pure / dependency-free (R3). All new public identifiers end with `351` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). Additive only (R6).
 *
 * @version 351.0.0
 */

const crypto = require('crypto');

const EXECUTIVE_HEALTH_ENGINE_VERSION_351 = '351.0.0';

/* ─── internal helpers ────────────────────────────────────────────────────── */

function _readinessTrendId351(ts) {
  return 'rdtrend_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _velocityId351(ts) {
  return 'velocity_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _forecastId351(ts) {
  return 'forecast_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _summaryId351(ts) {
  return 'execsummary_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _hashContent351(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

/**
 * Clamp a value between min and max.
 */
function _clamp351(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute mean of a numeric array. Returns null for empty arrays.
 */
function _mean351(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * Compute linear regression slope for a numeric array.
 * Returns slope (positive = rising, negative = falling, 0 = flat).
 */
function _slope351(arr) {
  if (!arr || arr.length < 2) return 0;
  const n = arr.length;
  const meanX = (n - 1) / 2;
  const meanY = _mean351(arr);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (arr[i] - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/* ─── 1. trackReadinessTrend351 ──────────────────────────────────────────── */

/**
 * Tracks readiness trend across multiple V350 buildFleetReadinessGate350 outputs.
 *
 * @param {Array}  readinessReports  — ordered array of V350 buildFleetReadinessGate350 outputs
 * @param {Object} [opts]
 * @param {number} [opts.slopeThreshold=0.05]  — slope threshold for trend classification
 * @returns {{ ok, trendId, snapshotCount, readyCount, underReviewCount, blockedCount,
 *             readinessRate, avgBlockingReasonCount, trendSlope, trendDirection,
 *             snapshots, version, summary }}
 */
function trackReadinessTrend351(readinessReports, opts) {
  const slopeThreshold = (opts && opts.slopeThreshold != null) ? opts.slopeThreshold : 0.05;

  try {
    const trendId = _readinessTrendId351(new Date());
    const reports = Array.isArray(readinessReports) ? readinessReports : [];

    if (reports.length === 0) {
      return {
        ok: true, trendId,
        snapshotCount: 0, readyCount: 0, underReviewCount: 0, blockedCount: 0,
        readinessRate: null, avgBlockingReasonCount: null,
        trendSlope: 0, trendDirection: 'insufficient_data',
        snapshots: [],
        version: EXECUTIVE_HEALTH_ENGINE_VERSION_351,
        summary: 'No readiness reports provided.',
      };
    }

    const snapshots = reports.map((r, idx) => {
      const decision = (r && r.decision) ? r.decision : 'UNKNOWN';
      const blockingCount = (r && Array.isArray(r.blockingReasons)) ? r.blockingReasons.length : 0;
      return {
        index: idx,
        decision,
        isReady: decision === 'READY',
        compositeScore: (r && r.compositeScore != null) ? r.compositeScore : null,
        blockingReasonCount: blockingCount,
      };
    });

    const readyCount       = snapshots.filter(s => s.decision === 'READY').length;
    const underReviewCount = snapshots.filter(s => s.decision === 'UNDER_REVIEW').length;
    const blockedCount     = snapshots.filter(s => s.decision === 'BLOCKED').length;
    const readinessRate    = parseFloat((readyCount / reports.length).toFixed(4));

    const blockingCounts = snapshots.map(s => s.blockingReasonCount);
    const avgBlockingReasonCount = parseFloat((_mean351(blockingCounts) || 0).toFixed(2));

    // Trend: use binary ready (1) / not-ready (0) signal
    const readySignal = snapshots.map(s => s.isReady ? 1 : 0);
    const trendSlope  = parseFloat(_slope351(readySignal).toFixed(4));

    let trendDirection;
    if (reports.length < 2) {
      trendDirection = 'insufficient_data';
    } else if (trendSlope > slopeThreshold) {
      trendDirection = 'improving';
    } else if (trendSlope < -slopeThreshold) {
      trendDirection = 'degrading';
    } else {
      trendDirection = 'stable';
    }

    const summary = `Readiness trend: ${readyCount}/${reports.length} READY ` +
      `(rate=${(readinessRate * 100).toFixed(1)}%), ` +
      `${underReviewCount} UNDER_REVIEW, ${blockedCount} BLOCKED. ` +
      `Trend: ${trendDirection} (slope=${trendSlope.toFixed(3)}).`;

    return {
      ok: true, trendId,
      snapshotCount: reports.length,
      readyCount, underReviewCount, blockedCount,
      readinessRate,
      avgBlockingReasonCount,
      trendSlope, trendDirection,
      snapshots,
      version: EXECUTIVE_HEALTH_ENGINE_VERSION_351,
      summary,
    };
  } catch (err) {
    return {
      ok: false, error: err.message,
      version: EXECUTIVE_HEALTH_ENGINE_VERSION_351,
      summary: 'trackReadinessTrend351 failed: ' + err.message,
    };
  }
}

/* ─── 2. measureRemediationVelocity351 ───────────────────────────────────── */

/**
 * Measures whether high-risk gaps are being resolved by comparing sequential
 * V350 correlateImpactToGaps350 outputs.
 *
 * Velocity logic (using high-priority items):
 *   resolved = types present in earlier snapshot(s) but absent in the latest
 *   new      = types absent in earlier snapshot(s) but present in the latest
 *   netDelta = resolved - new  (positive = net improvement)
 *
 * Velocity classification:
 *   accelerating — netDelta > 0 and resolvedCount > newCount
 *   stalling     — netDelta < 0 (more new gaps than resolved)
 *   steady       — netDelta == 0
 *
 * @param {Array}  remediationHistory  — ordered array of V350 correlateImpactToGaps350 outputs
 * @param {Object} [opts]
 * @param {string} [opts.priorityFilter='high']  — which priority tier to track ('high'|'medium'|'low')
 * @returns {{ ok, velocityId, resolvedCount, newCount, netDelta, velocityClass,
 *             resolvedTypes, newTypes, baselineHighRiskCount, latestHighRiskCount,
 *             version, summary }}
 */
function measureRemediationVelocity351(remediationHistory, opts) {
  const priorityFilter = (opts && opts.priorityFilter) ? opts.priorityFilter : 'high';

  try {
    const velocityId = _velocityId351(new Date());
    const history = Array.isArray(remediationHistory) ? remediationHistory : [];

    if (history.length === 0) {
      return {
        ok: true, velocityId,
        resolvedCount: 0, newCount: 0, netDelta: 0, velocityClass: 'insufficient_data',
        resolvedTypes: [], newTypes: [],
        baselineHighRiskCount: null, latestHighRiskCount: null,
        version: EXECUTIVE_HEALTH_ENGINE_VERSION_351,
        summary: 'No remediation history provided.',
      };
    }

    if (history.length === 1) {
      const report = history[0];
      const items  = (report && Array.isArray(report.remediationList)) ? report.remediationList : [];
      const high   = items.filter(i => i && i.priority === priorityFilter);
      return {
        ok: true, velocityId,
        resolvedCount: 0, newCount: 0, netDelta: 0, velocityClass: 'insufficient_data',
        resolvedTypes: [], newTypes: [],
        baselineHighRiskCount: high.length, latestHighRiskCount: high.length,
        version: EXECUTIVE_HEALTH_ENGINE_VERSION_351,
        summary: 'Only one snapshot; cannot compute velocity.',
      };
    }

    // Extract high-priority type sets per snapshot
    const typeSets = history.map(report => {
      const items = (report && Array.isArray(report.remediationList)) ? report.remediationList : [];
      return new Set(items.filter(i => i && i.priority === priorityFilter).map(i => i.type));
    });

    const baseline = typeSets[0];
    const latest   = typeSets[typeSets.length - 1];

    // Resolved: in baseline but not in latest
    const resolvedTypes = [...baseline].filter(t => !latest.has(t));
    // New: in latest but not in baseline
    const newTypes      = [...latest].filter(t => !baseline.has(t));

    const resolvedCount = resolvedTypes.length;
    const newCount      = newTypes.length;
    const netDelta      = resolvedCount - newCount;

    let velocityClass;
    if (resolvedCount === 0 && newCount === 0) {
      velocityClass = 'steady';
    } else if (netDelta > 0) {
      velocityClass = 'accelerating';
    } else if (netDelta < 0) {
      velocityClass = 'stalling';
    } else {
      velocityClass = 'steady';
    }

    const baselineHighRiskCount = baseline.size;
    const latestHighRiskCount   = latest.size;

    const summary = `Remediation velocity (${priorityFilter}-priority): ` +
      `${resolvedCount} resolved, ${newCount} new, net delta=${netDelta >= 0 ? '+' : ''}${netDelta}. ` +
      `Classification: ${velocityClass}. ` +
      `Baseline=${baselineHighRiskCount}, latest=${latestHighRiskCount} ${priorityFilter}-risk type(s).`;

    return {
      ok: true, velocityId,
      resolvedCount, newCount, netDelta, velocityClass,
      resolvedTypes, newTypes,
      baselineHighRiskCount, latestHighRiskCount,
      version: EXECUTIVE_HEALTH_ENGINE_VERSION_351,
      summary,
    };
  } catch (err) {
    return {
      ok: false, error: err.message,
      version: EXECUTIVE_HEALTH_ENGINE_VERSION_351,
      summary: 'measureRemediationVelocity351 failed: ' + err.message,
    };
  }
}

/* ─── 3. combineFleetForecasts351 ────────────────────────────────────────── */

/**
 * Combines V350 fleet health history trend with V350 horizon stability to produce
 * a forward-looking fleet health forecast band for the next N periods.
 *
 * Forecast model:
 *   expected[t]    = clamp(meanScore + trendSlope × (snapshotCount + t), 0, 100)
 *   optimistic[t]  = clamp(expected[t] + confidenceBand, 0, 100)
 *   pessimistic[t] = clamp(expected[t] - confidenceBand, 0, 100)
 *
 * confidenceBand is wider when horizon stability is lower (more uncertainty).
 *
 * @param {Object} historyReport    — V350 trackFleetHealthHistory350 output
 * @param {Object} stabilityReport  — V350 evaluateHorizonStability350 output
 * @param {Object} [opts]
 * @param {number} [opts.horizons=5]           — number of future periods to forecast
 * @param {number} [opts.baseConfidence=5]     — base confidence band half-width (score points)
 * @param {number} [opts.stabilityPenalty=10]  — extra band width when overall stability is low
 * @returns {{ ok, forecastId, forecastBand, horizons, meanScore, trendSlope,
 *             overallConsistency, confidenceBand, version, summary }}
 */
function combineFleetForecasts351(historyReport, stabilityReport, opts) {
  const horizons         = (opts && opts.horizons         != null) ? opts.horizons         : 5;
  const baseConfidence   = (opts && opts.baseConfidence   != null) ? opts.baseConfidence   : 5;
  const stabilityPenalty = (opts && opts.stabilityPenalty != null) ? opts.stabilityPenalty : 10;

  try {
    const forecastId = _forecastId351(new Date());

    const meanScore         = (historyReport  && historyReport.meanScore    != null) ? historyReport.meanScore    : null;
    const trendSlope        = (historyReport  && historyReport.trendSlope   != null) ? historyReport.trendSlope   : 0;
    const snapshotCount     = (historyReport  && Array.isArray(historyReport.snapshots)) ? historyReport.snapshots.length : 0;
    const overallConsistency = (stabilityReport && stabilityReport.overallConsistency != null) ? stabilityReport.overallConsistency : null;

    if (meanScore === null) {
      return {
        ok: true, forecastId,
        forecastBand: [], horizons, meanScore: null, trendSlope, overallConsistency,
        confidenceBand: null,
        version: EXECUTIVE_HEALTH_ENGINE_VERSION_351,
        summary: 'Insufficient history data to generate forecast.',
      };
    }

    // Confidence band: wider when stability is unknown or low
    const stabilityFactor = overallConsistency != null ? (1 - overallConsistency) : 0.5;
    const confidenceBand  = parseFloat((baseConfidence + stabilityFactor * stabilityPenalty).toFixed(2));

    const forecastBand = [];
    for (let t = 1; t <= Math.max(1, Math.floor(horizons)); t++) {
      const expected    = parseFloat(_clamp351(meanScore + trendSlope * (snapshotCount + t), 0, 100).toFixed(2));
      const optimistic  = parseFloat(_clamp351(expected + confidenceBand, 0, 100).toFixed(2));
      const pessimistic = parseFloat(_clamp351(expected - confidenceBand, 0, 100).toFixed(2));
      forecastBand.push({ period: t, expected, optimistic, pessimistic });
    }

    const firstForecast = forecastBand[0];
    const summary = `Fleet forecast (next ${forecastBand.length} period(s)): ` +
      `expected=${firstForecast ? firstForecast.expected.toFixed(1) : 'n/a'} ` +
      `[${firstForecast ? firstForecast.pessimistic.toFixed(1) : '?'}–` +
      `${firstForecast ? firstForecast.optimistic.toFixed(1) : '?'}], ` +
      `confidence band ±${confidenceBand.toFixed(1)} pts ` +
      `(stability=${overallConsistency != null ? (overallConsistency * 100).toFixed(1) + '%' : 'n/a'}).`;

    return {
      ok: true, forecastId,
      forecastBand, horizons: forecastBand.length,
      meanScore, trendSlope, overallConsistency, confidenceBand,
      version: EXECUTIVE_HEALTH_ENGINE_VERSION_351,
      summary,
    };
  } catch (err) {
    return {
      ok: false, error: err.message,
      version: EXECUTIVE_HEALTH_ENGINE_VERSION_351,
      summary: 'combineFleetForecasts351 failed: ' + err.message,
    };
  }
}

/* ─── 4. buildExecutiveSummary351 ────────────────────────────────────────── */

/**
 * Aggregates all four V350 outputs into a single executive-level summary.
 *
 * Overall fleet grade is derived from:
 *   - Readiness decision (READY/UNDER_REVIEW/BLOCKED)
 *   - Composite score (from history meanScore)
 *   - Remediation velocity
 *
 * Grade mapping:
 *   READY   + meanScore ≥ 75 → A
 *   READY   + meanScore < 75 → B
 *   UNDER_REVIEW              → C
 *   BLOCKED                   → D
 *   insufficient data         → N/A
 *
 * Top-3 action items are derived from the highest-priority blockingReasons,
 * remediationPlan, and correlation list.
 *
 * @param {Object} historyReport    — V350 trackFleetHealthHistory350 output
 * @param {Object} readinessReport  — V350 buildFleetReadinessGate350 output
 * @param {Object} correlationReport — V350 correlateImpactToGaps350 output
 * @param {Object} stabilityReport  — V350 evaluateHorizonStability350 output
 * @param {Object} [opts]
 * @returns {{ ok, summaryId, overallGrade, statusLine, topActionItems,
 *             keyMetrics, version, summary }}
 */
function buildExecutiveSummary351(historyReport, readinessReport, correlationReport, stabilityReport, opts) {
  try {
    const summaryId = _summaryId351(new Date());

    // Extract key signals
    const meanScore          = (historyReport  && historyReport.meanScore  != null) ? historyReport.meanScore  : null;
    const trajectory         = (historyReport  && historyReport.trajectory)          ? historyReport.trajectory  : 'unknown';
    const trendSlope         = (historyReport  && historyReport.trendSlope != null)  ? historyReport.trendSlope  : 0;
    const decision           = (readinessReport && readinessReport.decision)          ? readinessReport.decision  : null;
    const blockingReasons    = (readinessReport && Array.isArray(readinessReport.blockingReasons)) ? readinessReport.blockingReasons : [];
    const remediationPlan    = (readinessReport && Array.isArray(readinessReport.remediationPlan))  ? readinessReport.remediationPlan  : [];
    const highRiskCount      = (correlationReport && correlationReport.highRiskCount != null) ? correlationReport.highRiskCount : 0;
    const remediationList    = (correlationReport && Array.isArray(correlationReport.remediationList)) ? correlationReport.remediationList : [];
    const overallConsistency = (stabilityReport && stabilityReport.overallConsistency != null) ? stabilityReport.overallConsistency : null;
    const stableCount        = (stabilityReport && stabilityReport.stableCount  != null) ? stabilityReport.stableCount  : 0;
    const unstableCount      = (stabilityReport && stabilityReport.unstableCount != null) ? stabilityReport.unstableCount : 0;

    // Derive overall grade
    let overallGrade;
    if (decision === null && meanScore === null) {
      overallGrade = 'N/A';
    } else if (decision === 'READY' && meanScore != null && meanScore >= 75) {
      overallGrade = 'A';
    } else if (decision === 'READY') {
      overallGrade = 'B';
    } else if (decision === 'UNDER_REVIEW') {
      overallGrade = 'C';
    } else if (decision === 'BLOCKED') {
      overallGrade = 'D';
    } else {
      overallGrade = 'C'; // default to under-review tier if decision unknown but data present
    }

    // Build status line
    const scoreStr    = meanScore != null ? meanScore.toFixed(1) : 'n/a';
    const decisionStr = decision  || 'UNKNOWN';
    const stabilityStr = overallConsistency != null ? (overallConsistency * 100).toFixed(0) + '%' : 'n/a';
    const statusLine  = `Grade ${overallGrade} | ${decisionStr} | Score ${scoreStr} | ` +
      `Trend ${trajectory} | ${highRiskCount} high-risk gap(s) | ` +
      `Horizon stability ${stabilityStr}`;

    // Build top-3 action items
    const actionCandidates = [];

    // Critical blocking reasons first
    for (const reason of blockingReasons) {
      actionCandidates.push({ priority: 'critical', text: reason });
    }

    // High-priority remediation plan items
    for (const item of remediationPlan) {
      if (item && item.priority === 'critical') {
        actionCandidates.push({ priority: 'critical', text: item.action });
      }
    }
    for (const item of remediationPlan) {
      if (item && item.priority === 'high') {
        actionCandidates.push({ priority: 'high', text: item.action });
      }
    }

    // High-risk remediation list types
    for (const item of remediationList) {
      if (item && item.priority === 'high') {
        actionCandidates.push({
          priority: 'high',
          text: item.recommendation || `Address high-risk gap for anomaly type "${item.type}" (riskScore=${item.riskScore}).`,
        });
      }
    }

    // Horizon instability warnings
    if (unstableCount > 0) {
      actionCandidates.push({
        priority: 'medium',
        text: `${unstableCount} SLA horizon(s) are unstable — consider ensemble forecasting.`,
      });
    }

    // Trajectory warning
    if (trajectory === 'degrading') {
      actionCandidates.push({
        priority: 'high',
        text: `Fleet health is degrading (slope=${trendSlope.toFixed(3)}) — investigate root causes.`,
      });
    }

    // Deduplicate by text and take top 3
    const seen = new Set();
    const topActionItems = [];
    for (const c of actionCandidates) {
      if (!seen.has(c.text) && topActionItems.length < 3) {
        seen.add(c.text);
        topActionItems.push({ priority: c.priority, action: c.text });
      }
    }

    if (topActionItems.length === 0) {
      topActionItems.push({ priority: 'low', action: 'Fleet is in good health — continue monitoring.' });
    }

    // Key metrics
    const keyMetrics = {
      meanCompositeScore:    meanScore,
      healthTrajectory:      trajectory,
      readinessDecision:     decision,
      highRiskGapCount:      highRiskCount,
      horizonStability:      overallConsistency,
      stableHorizons:        stableCount,
      unstableHorizons:      unstableCount,
      blockingReasonCount:   blockingReasons.length,
    };

    const summary = `Executive summary (Grade ${overallGrade}): ${statusLine}. ` +
      `Top action: ${topActionItems[0] ? topActionItems[0].action : 'none'}.`;

    return {
      ok: true, summaryId,
      overallGrade, statusLine, topActionItems,
      keyMetrics,
      version: EXECUTIVE_HEALTH_ENGINE_VERSION_351,
      summary,
    };
  } catch (err) {
    return {
      ok: false, error: err.message,
      version: EXECUTIVE_HEALTH_ENGINE_VERSION_351,
      summary: 'buildExecutiveSummary351 failed: ' + err.message,
    };
  }
}

/* ─── exports ─────────────────────────────────────────────────────────────── */

module.exports = {
  EXECUTIVE_HEALTH_ENGINE_VERSION_351,

  trackReadinessTrend351,
  measureRemediationVelocity351,
  combineFleetForecasts351,
  buildExecutiveSummary351,

  // Exported for testing
  _readinessTrendId351,
  _velocityId351,
  _forecastId351,
  _summaryId351,
  _hashContent351,
  _clamp351,
  _mean351,
  _slope351,
};
