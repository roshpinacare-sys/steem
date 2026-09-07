'use strict';
/**
 * lib/fleetHealthHistoryEngine350.js — ECOS V350 (Phase P238)
 * Fleet Health History & Readiness Engine
 *
 * Extends V349 Fleet Health Composite Engine with four longitudinal and
 * decision tools:
 *
 *   V349 → anomaly impact scoring, suppression coverage gap detection,
 *           multi-horizon forecast comparison, fleet health composite score
 *   V350 → fleet health history tracking, impact-to-gap correlation,
 *           horizon stability evaluation, fleet readiness gate
 *
 * Four concrete tools:
 *
 *   1. trackFleetHealthHistory350    — takes multiple V349 buildFleetHealthComposite349
 *      outputs over time and builds a longitudinal health history with trend
 *      analysis, min/max/mean composite score, trend slope, and health trajectory.
 *
 *   2. correlateImpactToGaps350      — cross-references V349 anomaly impact scores
 *      with V349 suppression gap results to prioritise which coverage gaps pose
 *      the highest business risk, producing a remediation priority list.
 *
 *   3. evaluateHorizonStability350   — takes multiple V349 compareForecastHorizons349
 *      outputs over time and determines whether the best horizon for each SLA is
 *      stable or flip-flopping, with consistency score and recommendation.
 *
 *   4. buildFleetReadinessGate350    — combines V349 composite, anomaly impact, and
 *      suppression gaps into a binary readiness decision (READY / UNDER_REVIEW /
 *      BLOCKED) with blocking reasons and a structured remediation plan.
 *
 * Pure / dependency-free (R3). All new public identifiers end with `350` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). Additive only (R6).
 *
 * @version 350.0.0
 */

const crypto = require('crypto');

const FLEET_HEALTH_HISTORY_ENGINE_VERSION_350 = '350.0.0';

/* ─── internal helpers ────────────────────────────────────────────────────── */

function _historyId350(ts) {
  return 'history_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _correlationId350(ts) {
  return 'igcorr_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _stabilityId350(ts) {
  return 'stability_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _readinessId350(ts) {
  return 'readiness_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _hashContent350(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

/**
 * Clamp a value between min and max.
 */
function _clamp350(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute mean of a numeric array. Returns null for empty arrays.
 */
function _mean350(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * Compute linear regression slope for a numeric array.
 * Returns slope (positive = rising, negative = falling, 0 = flat).
 */
function _slope350(arr) {
  if (!arr || arr.length < 2) return 0;
  const n = arr.length;
  const xs = arr.map((_, i) => i);
  const meanX = (n - 1) / 2;
  const meanY = _mean350(arr);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (arr[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/* ─── 1. trackFleetHealthHistory350 ─────────────────────────────────────── */

/**
 * Tracks longitudinal fleet health from multiple V349 composite reports.
 *
 * @param {Array}  compositeReports  — ordered array of V349 buildFleetHealthComposite349 outputs
 * @param {Object} [opts]
 * @param {number} [opts.slopeThreshold=0.5]   — slope above which trend is improving/degrading
 * @param {number} [opts.stableWindow=3]        — min snapshots to confirm stable trend
 * @returns {{ ok, historyId, snapshots, minScore, maxScore, meanScore, trendSlope,
 *             trajectory, factorTrends, version, summary }}
 */
function trackFleetHealthHistory350(compositeReports, opts) {
  const slopeThreshold = (opts && opts.slopeThreshold != null) ? opts.slopeThreshold : 0.5;

  try {
    const reports = Array.isArray(compositeReports) ? compositeReports : [];
    const historyId = _historyId350(new Date());

    if (reports.length === 0) {
      return {
        ok: true, historyId,
        snapshots: [], minScore: null, maxScore: null, meanScore: null,
        trendSlope: 0, trajectory: 'insufficient_data',
        factorTrends: {}, version: FLEET_HEALTH_HISTORY_ENGINE_VERSION_350,
        summary: 'No composite reports provided.',
      };
    }

    // Build snapshot series
    const snapshots = reports.map((r, idx) => ({
      index: idx,
      compositeScore: (r && r.compositeScore != null) ? r.compositeScore : null,
      healthGrade: (r && r.healthGrade) ? r.healthGrade : null,
      factors: (r && r.factors) ? r.factors : {},
      generatedAt: (r && r.generatedAt) ? r.generatedAt : null,
    }));

    const scores = snapshots.map(s => s.compositeScore).filter(s => s != null);
    const minScore = scores.length ? Math.min(...scores) : null;
    const maxScore = scores.length ? Math.max(...scores) : null;
    const meanScore = _mean350(scores);
    const trendSlope = _slope350(scores);

    // Trajectory classification
    let trajectory;
    if (scores.length < 2) {
      trajectory = 'insufficient_data';
    } else if (trendSlope > slopeThreshold) {
      trajectory = 'improving';
    } else if (trendSlope < -slopeThreshold) {
      trajectory = 'degrading';
    } else {
      trajectory = 'stable';
    }

    // Per-factor trends
    const factorNames = new Set();
    snapshots.forEach(s => { if (s.factors) Object.keys(s.factors).forEach(k => factorNames.add(k)); });
    const factorTrends = {};
    for (const fname of factorNames) {
      const fscores = snapshots.map(s => (s.factors && s.factors[fname] != null) ? s.factors[fname] : null).filter(v => v != null);
      const fslope = _slope350(fscores);
      let ftrend;
      if (fscores.length < 2) ftrend = 'insufficient_data';
      else if (fslope > slopeThreshold) ftrend = 'improving';
      else if (fslope < -slopeThreshold) ftrend = 'degrading';
      else ftrend = 'stable';
      factorTrends[fname] = { mean: _mean350(fscores), slope: parseFloat(fslope.toFixed(4)), trend: ftrend };
    }

    const summary = `Fleet health history: ${scores.length} snapshots, mean=${meanScore != null ? meanScore.toFixed(1) : 'n/a'}, ` +
      `slope=${trendSlope.toFixed(3)}, trajectory=${trajectory}.`;

    return {
      ok: true, historyId,
      snapshots, minScore, maxScore,
      meanScore: meanScore != null ? parseFloat(meanScore.toFixed(2)) : null,
      trendSlope: parseFloat(trendSlope.toFixed(4)),
      trajectory, factorTrends,
      version: FLEET_HEALTH_HISTORY_ENGINE_VERSION_350,
      summary,
    };
  } catch (err) {
    return {
      ok: false, error: err.message,
      version: FLEET_HEALTH_HISTORY_ENGINE_VERSION_350,
      summary: 'trackFleetHealthHistory350 failed: ' + err.message,
    };
  }
}

/* ─── 2. correlateImpactToGaps350 ────────────────────────────────────────── */

/**
 * Cross-references V349 anomaly impact report with V349 suppression gap report
 * to produce a prioritised remediation list (highest risk first).
 *
 * Risk score = impactScore × gapSeverityWeight
 * gapSeverityWeight: high=1.0, medium=0.6, low=0.3, unknown=0.5
 *
 * @param {Object} impactReport  — V349 scoreAnomalyImpact349 output
 * @param {Object} gapReport     — V349 detectSuppressionGaps349 output
 * @param {Object} [opts]
 * @param {number} [opts.riskThreshold=30]  — minimum riskScore to include in highRisk
 * @returns {{ ok, correlationId, remediationList, highRiskCount, totalTypes, version, summary }}
 */
function correlateImpactToGaps350(impactReport, gapReport, opts) {
  const riskThreshold = (opts && opts.riskThreshold != null) ? opts.riskThreshold : 30;

  try {
    const correlationId = _correlationId350(new Date());

    const impacts = (impactReport && Array.isArray(impactReport.impacts)) ? impactReport.impacts : [];
    const gaps    = (gapReport    && Array.isArray(gapReport.gaps))       ? gapReport.gaps       : [];

    if (impacts.length === 0 && gaps.length === 0) {
      return {
        ok: true, correlationId,
        remediationList: [], highRiskCount: 0, totalTypes: 0,
        version: FLEET_HEALTH_HISTORY_ENGINE_VERSION_350,
        summary: 'No impacts or gaps to correlate.',
      };
    }

    const severityWeight = { high: 1.0, medium: 0.6, low: 0.3 };

    // Build map: anomalyType → impact entry
    const impactMap = {};
    for (const imp of impacts) {
      if (imp && imp.type) impactMap[imp.type] = imp;
    }

    // Build map: anomalyType → gap entry
    const gapMap = {};
    for (const gap of gaps) {
      if (gap && gap.type) gapMap[gap.type] = gap;
    }

    const allTypes = new Set([...Object.keys(impactMap), ...Object.keys(gapMap)]);
    const remediationList = [];

    for (const type of allTypes) {
      const imp = impactMap[type];
      const gap = gapMap[type];
      const impactScore   = (imp && imp.impactScore   != null) ? imp.impactScore   : 0;
      const impactLevel   = (imp && imp.impactLevel)           ? imp.impactLevel   : 'unknown';
      const gapSeverity   = (gap && gap.severity)              ? gap.severity      : null;
      const hasGap        = !!gap;
      const weight        = gapSeverity ? (severityWeight[gapSeverity] || 0.5) : 0;
      const riskScore     = parseFloat(_clamp350(impactScore * weight, 0, 100).toFixed(2));
      const recommendation = gap ? gap.recommendation : null;

      remediationList.push({
        type, impactScore, impactLevel, hasGap,
        gapSeverity: gapSeverity || null,
        riskScore, recommendation,
        priority: riskScore >= riskThreshold ? 'high' : riskScore >= 15 ? 'medium' : 'low',
      });
    }

    // Sort by riskScore descending
    remediationList.sort((a, b) => b.riskScore - a.riskScore);

    const highRiskCount = remediationList.filter(r => r.priority === 'high').length;

    const summary = `Correlated ${allTypes.size} anomaly types; ${highRiskCount} high-risk gap(s) requiring immediate remediation.`;

    return {
      ok: true, correlationId,
      remediationList, highRiskCount,
      totalTypes: allTypes.size,
      version: FLEET_HEALTH_HISTORY_ENGINE_VERSION_350,
      summary,
    };
  } catch (err) {
    return {
      ok: false, error: err.message,
      version: FLEET_HEALTH_HISTORY_ENGINE_VERSION_350,
      summary: 'correlateImpactToGaps350 failed: ' + err.message,
    };
  }
}

/* ─── 3. evaluateHorizonStability350 ─────────────────────────────────────── */

/**
 * Evaluates whether the best forecast horizon per SLA is stable or
 * flip-flopping across multiple V349 compareForecastHorizons349 outputs.
 *
 * Consistency score per SLA = fraction of snapshots where the best horizon
 * matches the plurality best horizon.
 * Overall consistency = mean of per-SLA consistency scores.
 *
 * @param {Array}  horizonComparisons  — ordered array of V349 compareForecastHorizons349 outputs
 * @param {Object} [opts]
 * @param {number} [opts.consistencyThreshold=0.7]  — ≥ this → stable
 * @returns {{ ok, stabilityId, perSlaStability, overallConsistency,
 *             stableCount, unstableCount, version, summary }}
 */
function evaluateHorizonStability350(horizonComparisons, opts) {
  const consistencyThreshold = (opts && opts.consistencyThreshold != null) ? opts.consistencyThreshold : 0.7;

  try {
    const stabilityId = _stabilityId350(new Date());
    const comparisons = Array.isArray(horizonComparisons) ? horizonComparisons : [];

    if (comparisons.length === 0) {
      return {
        ok: true, stabilityId,
        perSlaStability: {}, overallConsistency: null,
        stableCount: 0, unstableCount: 0,
        version: FLEET_HEALTH_HISTORY_ENGINE_VERSION_350,
        summary: 'No horizon comparison reports provided.',
      };
    }

    // Gather per-SLA best horizon votes across all snapshots
    const slaVotes = {}; // slaKey → array of bestHorizon strings

    for (const comp of comparisons) {
      if (!comp || !comp.perSlaBestHorizon) continue;
      for (const [sla, horizonData] of Object.entries(comp.perSlaBestHorizon)) {
        if (!slaVotes[sla]) slaVotes[sla] = [];
        const bestH = horizonData && horizonData.bestOverallHorizon
          ? horizonData.bestOverallHorizon
          : (horizonData && horizonData.bestQualityHorizon ? horizonData.bestQualityHorizon : null);
        if (bestH != null) slaVotes[sla].push(String(bestH));
      }
    }

    const perSlaStability = {};
    let stableCount = 0, unstableCount = 0;

    for (const [sla, votes] of Object.entries(slaVotes)) {
      if (votes.length === 0) {
        perSlaStability[sla] = { consistencyScore: null, pluralityHorizon: null, stable: false, recommendation: 'Insufficient data.' };
        unstableCount++;
        continue;
      }

      // Find plurality winner
      const freq = {};
      for (const v of votes) freq[v] = (freq[v] || 0) + 1;
      const pluralityHorizon = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
      const consistencyScore = parseFloat((freq[pluralityHorizon] / votes.length).toFixed(4));
      const stable = consistencyScore >= consistencyThreshold;
      const recommendation = stable
        ? `Use horizon ${pluralityHorizon} for SLA "${sla}" — consistent across ${votes.length} snapshot(s).`
        : `Horizon selection for SLA "${sla}" is unstable (consistency=${(consistencyScore * 100).toFixed(1)}%); consider averaging forecasts.`;

      perSlaStability[sla] = { consistencyScore, pluralityHorizon, stable, recommendation };
      if (stable) stableCount++; else unstableCount++;
    }

    const allScores = Object.values(perSlaStability).map(s => s.consistencyScore).filter(s => s != null);
    const overallConsistency = allScores.length ? parseFloat(_mean350(allScores).toFixed(4)) : null;

    const summary = `Horizon stability: ${stableCount} stable, ${unstableCount} unstable SLA(s); ` +
      `overall consistency=${overallConsistency != null ? (overallConsistency * 100).toFixed(1) + '%' : 'n/a'}.`;

    return {
      ok: true, stabilityId,
      perSlaStability, overallConsistency,
      stableCount, unstableCount,
      version: FLEET_HEALTH_HISTORY_ENGINE_VERSION_350,
      summary,
    };
  } catch (err) {
    return {
      ok: false, error: err.message,
      version: FLEET_HEALTH_HISTORY_ENGINE_VERSION_350,
      summary: 'evaluateHorizonStability350 failed: ' + err.message,
    };
  }
}

/* ─── 4. buildFleetReadinessGate350 ─────────────────────────────────────── */

/**
 * Combines V349 composite score, anomaly impact report, and suppression gap
 * report into a binary readiness decision with remediation plan.
 *
 * Decision rules (checked in order):
 *   BLOCKED     — compositeScore < blockedThreshold (default 40) OR
 *                  any HIGH impact + HIGH gap present
 *   UNDER_REVIEW — compositeScore < underReviewThreshold (default 75) OR
 *                  any HIGH gap OR any HIGH impact
 *   READY        — otherwise
 *
 * @param {Object} composite    — V349 buildFleetHealthComposite349 output
 * @param {Object} impactReport — V349 scoreAnomalyImpact349 output
 * @param {Object} gapReport    — V349 detectSuppressionGaps349 output
 * @param {Object} [opts]
 * @param {number} [opts.blockedThreshold=40]      — composite score below which: BLOCKED
 * @param {number} [opts.underReviewThreshold=75]  — composite score below which: UNDER_REVIEW
 * @returns {{ ok, readinessId, decision, compositeScore, healthGrade, blockingReasons,
 *             remediationPlan, highImpactCount, highGapCount, version, summary }}
 */
function buildFleetReadinessGate350(composite, impactReport, gapReport, opts) {
  const blockedThreshold    = (opts && opts.blockedThreshold    != null) ? opts.blockedThreshold    : 40;
  const underReviewThreshold = (opts && opts.underReviewThreshold != null) ? opts.underReviewThreshold : 75;

  try {
    const readinessId = _readinessId350(new Date());

    const compositeScore = (composite && composite.compositeScore != null) ? composite.compositeScore : null;
    const healthGrade    = (composite && composite.healthGrade)            ? composite.healthGrade    : null;

    const impacts     = (impactReport && Array.isArray(impactReport.impacts)) ? impactReport.impacts : [];
    const gaps        = (gapReport    && Array.isArray(gapReport.gaps))       ? gapReport.gaps       : [];

    const highImpacts = impacts.filter(i => i && i.impactLevel === 'high');
    const highGaps    = gaps.filter(g => g && g.severity === 'high');
    const highImpactCount = highImpacts.length;
    const highGapCount    = highGaps.length;

    const blockingReasons = [];
    const remediationPlan = [];

    // Score-based blocking
    if (compositeScore != null && compositeScore < blockedThreshold) {
      blockingReasons.push(`Composite health score ${compositeScore.toFixed(1)} below BLOCKED threshold (${blockedThreshold}).`);
      remediationPlan.push({
        priority: 'critical',
        action: 'Investigate root causes driving composite score below ' + blockedThreshold + '.',
        affectedFactors: composite && composite.factors ? Object.keys(composite.factors) : [],
      });
    }

    // High-impact + high-gap pairs → BLOCKED
    const highImpactTypes = new Set(highImpacts.map(i => i.type));
    const highGapTypes    = new Set(highGaps.map(g => g.type));
    const criticalOverlap = [...highImpactTypes].filter(t => highGapTypes.has(t));
    if (criticalOverlap.length > 0) {
      blockingReasons.push(`${criticalOverlap.length} anomaly type(s) have both HIGH impact and HIGH suppression gap: ${criticalOverlap.join(', ')}.`);
      for (const type of criticalOverlap) {
        const gap = gaps.find(g => g && g.type === type);
        remediationPlan.push({
          priority: 'critical',
          action: `Immediately add suppression rule for anomaly type "${type}".`,
          recommendation: gap ? gap.recommendation : null,
        });
      }
    }

    // Under-review reasons
    if (compositeScore != null && compositeScore >= blockedThreshold && compositeScore < underReviewThreshold) {
      blockingReasons.push(`Composite health score ${compositeScore.toFixed(1)} below READY threshold (${underReviewThreshold}).`);
      remediationPlan.push({
        priority: 'high',
        action: `Improve composite score from ${compositeScore.toFixed(1)} to ≥${underReviewThreshold} before marking fleet READY.`,
        affectedFactors: composite && composite.factors ? Object.keys(composite.factors) : [],
      });
    }

    // Uncritical high gaps (not in criticalOverlap)
    for (const gap of highGaps) {
      if (!criticalOverlap.includes(gap.type)) {
        blockingReasons.push(`High-severity suppression gap for anomaly type "${gap.type}" (${gap.unprotectedSnapshots || 0} unprotected snapshots).`);
        remediationPlan.push({
          priority: 'high',
          action: `Add suppression rule for "${gap.type}".`,
          recommendation: gap.recommendation || null,
        });
      }
    }

    // High impacts without gaps
    for (const imp of highImpacts) {
      if (!criticalOverlap.includes(imp.type)) {
        remediationPlan.push({
          priority: 'medium',
          action: `Monitor anomaly type "${imp.type}" (high impact, score=${imp.impactScore.toFixed(1)}) — no active suppression gap but elevated risk.`,
        });
      }
    }

    // Final decision
    let decision;
    const isBlocked = blockingReasons.some(r =>
      r.includes('below BLOCKED threshold') || r.includes('both HIGH impact and HIGH suppression gap')
    );
    const isUnderReview = blockingReasons.length > 0;

    if (isBlocked) {
      decision = 'BLOCKED';
    } else if (isUnderReview) {
      decision = 'UNDER_REVIEW';
    } else {
      decision = 'READY';
    }

    const summary = `Fleet readiness: ${decision}. ` +
      `Score=${compositeScore != null ? compositeScore.toFixed(1) : 'n/a'} (${healthGrade || 'n/a'}), ` +
      `${highImpactCount} high-impact type(s), ${highGapCount} high-severity gap(s). ` +
      `${blockingReasons.length} blocking reason(s).`;

    return {
      ok: true, readinessId,
      decision, compositeScore, healthGrade,
      blockingReasons, remediationPlan,
      highImpactCount, highGapCount,
      version: FLEET_HEALTH_HISTORY_ENGINE_VERSION_350,
      summary,
    };
  } catch (err) {
    return {
      ok: false, error: err.message,
      version: FLEET_HEALTH_HISTORY_ENGINE_VERSION_350,
      summary: 'buildFleetReadinessGate350 failed: ' + err.message,
    };
  }
}

/* ─── exports ─────────────────────────────────────────────────────────────── */

module.exports = {
  FLEET_HEALTH_HISTORY_ENGINE_VERSION_350,

  trackFleetHealthHistory350,
  correlateImpactToGaps350,
  evaluateHorizonStability350,
  buildFleetReadinessGate350,

  // Exported for testing
  _historyId350,
  _correlationId350,
  _stabilityId350,
  _readinessId350,
  _hashContent350,
  _clamp350,
  _mean350,
  _slope350,
};
