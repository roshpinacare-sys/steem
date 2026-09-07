'use strict';
/**
 * lib/fleetHealthCompositeEngine349.js — ECOS V349 (Phase P237)
 * Fleet Health Composite Engine
 *
 * Extends V348 Correlation Timeline Engine with four cross-domain synthesis tools:
 *
 *   V348 → correlation timelines, forecast accuracy, suppression effectiveness,
 *           channel health trends
 *   V349 → anomaly impact scoring, suppression coverage gap detection,
 *           multi-horizon forecast comparison, fleet health composite score
 *
 * Four concrete tools:
 *
 *   1. scoreAnomalyImpact349        — cross-references V348 correlation timelines
 *      with V347 channel health reports to compute per-anomaly-type business
 *      impact: which anomaly types correlate with the most channel degradation.
 *
 *   2. detectSuppressionGaps349     — identifies time windows in the V348 timeline
 *      where `emerging` anomaly types have no active suppression rules, flagging
 *      potential unprotected periods.
 *
 *   3. compareForecastHorizons349   — takes multiple V348 accuracy reports (with
 *      different forecastPeriods) and determines which forecast horizon delivers
 *      best MAE and directional accuracy for each SLA.
 *
 *   4. buildFleetHealthComposite349 — combines V348 timeline, channelHealthTrend,
 *      and suppressionEffectiveness into a single fleet-wide composite health
 *      score (0-100) with contributing factor breakdown.
 *
 * Pure / dependency-free (R3). All new public identifiers end with `349` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). Additive only (R6).
 *
 * @version 349.0.0
 */

const crypto = require('crypto');

const FLEET_HEALTH_COMPOSITE_ENGINE_VERSION_349 = '349.0.0';

/* ─── internal helpers ────────────────────────────────────────────────────── */

function _impactId349(ts) {
  return 'impact_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _gapId349(ts) {
  return 'gap_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _horizonId349(ts) {
  return 'horizon_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _compositeId349(ts) {
  return 'composite_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _hashContent349(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

/**
 * Clamp a value between min and max.
 */
function _clamp349(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute mean of a numeric array. Returns null for empty arrays.
 */
function _mean349(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/* ─── 1. scoreAnomalyImpact349 ───────────────────────────────────────────── */

/**
 * Cross-reference V348 correlation timelines with V347 channel health reports
 * to compute per-anomaly-type business impact. Identifies which anomaly types
 * correlate with the most channel degradation events.
 *
 * @param {object}   timeline       V348 buildCorrelationTimeline348 output
 * @param {object[]} healthReports  Array of V347 buildWebhookChannelHealth347 outputs
 * @param {object}   [opts]
 * @param {string}   [opts.label]
 * @param {number}   [opts.degradationThreshold=0.9]  successRate below this = degraded
 * @returns {{ ok, impactId, generatedAt, impacts, highImpactTypes, lowImpactTypes,
 *             totalAnomalyTypes, totalDegradationEvents, version, summary }}
 */
function scoreAnomalyImpact349(timeline, healthReports, opts) {
  opts = opts || {};
  const label                = typeof opts.label === 'string' ? opts.label : 'fleet';
  const degradationThreshold = typeof opts.degradationThreshold === 'number'
    ? opts.degradationThreshold : 0.9;
  const ts = new Date();
  const id = _impactId349(ts);

  const emptyResult = (reason) => ({
    ok: true, impactId: id, generatedAt: ts.toISOString(),
    impacts: [], highImpactTypes: [], lowImpactTypes: [],
    totalAnomalyTypes: 0, totalDegradationEvents: 0, label,
    version: FLEET_HEALTH_COMPOSITE_ENGINE_VERSION_349,
    summary: `V349 impact: ${reason}`,
  });

  if (!timeline || !Array.isArray(timeline.timeline) || timeline.timeline.length === 0) {
    return emptyResult('no timeline entries provided');
  }
  if (!Array.isArray(healthReports) || healthReports.length === 0) {
    return emptyResult('no channel health reports provided');
  }

  // Count degradation events per snapshot index across all channels
  const degradationBySnapshot = {};
  healthReports.forEach((hr, idx) => {
    const channels = (hr && Array.isArray(hr.channels)) ? hr.channels : [];
    const degraded = channels.filter(c =>
      typeof c.successRate === 'number' && c.successRate < degradationThreshold
    ).length;
    degradationBySnapshot[idx] = degraded;
  });
  const totalDegradationEvents = Object.values(degradationBySnapshot).reduce((s, v) => s + v, 0);

  // For each anomaly type in the timeline, correlate presence with degradation
  const impacts = [];

  for (const entry of timeline.timeline) {
    const type = entry.type;
    const snapshots = Array.isArray(entry.snapshots) ? entry.snapshots : [];

    // For each snapshot where this anomaly was active (score > 0),
    // count co-occurring channel degradations
    let coOccurrenceDegradations = 0;
    let activeSnapshots = 0;

    for (const snap of snapshots) {
      const idx = snap.snapshotIndex;
      const isActive = snap.recurrenceScore > 0;
      if (isActive) {
        activeSnapshots++;
        coOccurrenceDegradations += (degradationBySnapshot[idx] || 0);
      }
    }

    // Impact score: average degradations during active windows,
    // weighted by anomaly severity (currentScore)
    const avgDegradationDuringActive = activeSnapshots > 0
      ? Math.round((coOccurrenceDegradations / activeSnapshots) * 1000) / 1000
      : 0;

    // Normalised impact score 0-100
    const maxPossibleDegradations = healthReports.reduce((max, hr) => {
      const n = (hr && Array.isArray(hr.channels)) ? hr.channels.length : 0;
      return Math.max(max, n);
    }, 1);
    const rawImpact = (avgDegradationDuringActive / maxPossibleDegradations) * 100;
    const scoreWeight = _clamp349(entry.currentScore / 100, 0, 1);
    const impactScore = Math.round(_clamp349(rawImpact * (0.5 + 0.5 * scoreWeight), 0, 100) * 10) / 10;

    const impactLevel = impactScore >= 50 ? 'high' : impactScore >= 20 ? 'medium' : 'low';

    impacts.push({
      type,
      impactScore,
      impactLevel,
      activeSnapshots,
      coOccurrenceDegradations,
      avgDegradationDuringActive,
      currentRecurrenceScore: entry.currentScore,
      state: entry.state,
      details: `Anomaly '${type}': impact=${impactScore} (${impactLevel}), active in ${activeSnapshots}/${snapshots.length} snapshots, avg degradations=${avgDegradationDuringActive}`,
    });
  }

  // Sort by impactScore descending
  impacts.sort((a, b) => b.impactScore - a.impactScore);

  const highImpactTypes = impacts.filter(i => i.impactLevel === 'high').map(i => i.type);
  const lowImpactTypes  = impacts.filter(i => i.impactLevel === 'low').map(i => i.type);

  return {
    ok: true, impactId: id, generatedAt: ts.toISOString(),
    impacts, highImpactTypes, lowImpactTypes,
    totalAnomalyTypes: impacts.length,
    totalDegradationEvents,
    label,
    version: FLEET_HEALTH_COMPOSITE_ENGINE_VERSION_349,
    summary: `V349 impact: ${impacts.length} anomaly types scored — ${highImpactTypes.length} high-impact, totalDegradationEvents=${totalDegradationEvents}`,
  };
}

/* ─── 2. detectSuppressionGaps349 ────────────────────────────────────────── */

/**
 * Identify time windows in the V348 timeline where `emerging` anomaly types
 * have no active suppression rules, flagging potential unprotected periods.
 *
 * @param {object}  timeline   V348 buildCorrelationTimeline348 output
 * @param {object}  registry   V345 suppression registry (buildAlertSuppressionRegistry345 output)
 * @param {object}  [opts]
 * @param {string}  [opts.label]
 * @param {boolean} [opts.includeStable=false]  Also check stable types, not just emerging
 * @returns {{ ok, gapId, generatedAt, gaps, coveredTypes, uncoveredTypes,
 *             gapCount, version, summary }}
 */
function detectSuppressionGaps349(timeline, registry, opts) {
  opts = opts || {};
  const label         = typeof opts.label === 'string' ? opts.label : 'fleet';
  const includeStable = !!opts.includeStable;
  const ts = new Date();
  const id = _gapId349(ts);

  const emptyResult = (reason) => ({
    ok: true, gapId: id, generatedAt: ts.toISOString(),
    gaps: [], coveredTypes: [], uncoveredTypes: [],
    gapCount: 0, label,
    version: FLEET_HEALTH_COMPOSITE_ENGINE_VERSION_349,
    summary: `V349 gaps: ${reason}`,
  });

  if (!timeline || !Array.isArray(timeline.timeline)) {
    return emptyResult('no timeline provided');
  }

  // Extract active suppression rule names/scopes from registry
  const allRules = [];
  if (registry) {
    if (Array.isArray(registry.rules)) {
      allRules.push(...registry.rules);
    } else {
      if (Array.isArray(registry.activeRules))   allRules.push(...registry.activeRules);
      if (Array.isArray(registry.inactiveRules))  allRules.push(...registry.inactiveRules);
    }
  }
  const activeRuleNames = new Set(
    allRules
      .filter(r => r.enabled !== false)
      .map(r => (r.name || r.id || '').toLowerCase())
  );

  // Select which anomaly types to check
  const typesToCheck = timeline.timeline.filter(entry => {
    if (entry.state === 'emerging') return true;
    if (includeStable && (entry.state === 'stable' || entry.state === 'critical')) return true;
    return false;
  });

  const gaps = [];
  const coveredTypes = [];
  const uncoveredTypes = [];

  for (const entry of typesToCheck) {
    const type = entry.type;
    const typeLower = type.toLowerCase();

    // Check whether any active rule covers this anomaly type
    // Match by rule name containing the type, or by type matching rule scope/alertType
    const isCovered = allRules.some(r => {
      if (r.enabled === false) return false;
      const name      = (r.name || '').toLowerCase();
      const scope     = (r.scope || '').toLowerCase();
      const alertType = (r.alertType || r.alert_type || '').toLowerCase();
      return name.includes(typeLower) || typeLower.includes(name) ||
             scope.includes(typeLower) || alertType.includes(typeLower);
    });

    if (isCovered) {
      coveredTypes.push(type);
    } else {
      uncoveredTypes.push(type);

      // Identify the specific snapshot windows where it's unprotected and active
      const unprotectedSnapshots = (entry.snapshots || [])
        .filter(s => s.recurrenceScore > 0)
        .map(s => s.snapshotIndex);

      gaps.push({
        type,
        state: entry.state,
        currentScore: entry.currentScore,
        unprotectedSnapshotCount: unprotectedSnapshots.length,
        unprotectedSnapshots,
        severity: entry.state === 'emerging' ? 'high' : 'medium',
        recommendation: `Add a suppression rule targeting anomaly type '${type}' to prevent alert storms during ${entry.state} periods`,
        details: `Anomaly '${type}' (${entry.state}, score=${entry.currentScore}) has no matching suppression rule across ${unprotectedSnapshots.length} active snapshots`,
      });
    }
  }

  // Sort gaps by severity and currentScore
  gaps.sort((a, b) => {
    const sOrd = { high: 0, medium: 1, low: 2 };
    return (sOrd[a.severity] - sOrd[b.severity]) || (b.currentScore - a.currentScore);
  });

  return {
    ok: true, gapId: id, generatedAt: ts.toISOString(),
    gaps, coveredTypes, uncoveredTypes,
    gapCount: gaps.length,
    checkedCount: typesToCheck.length,
    activeRuleCount: allRules.filter(r => r.enabled !== false).length,
    label,
    version: FLEET_HEALTH_COMPOSITE_ENGINE_VERSION_349,
    summary: `V349 gaps: ${gaps.length} uncovered of ${typesToCheck.length} checked types — ${coveredTypes.length} covered by ${allRules.filter(r => r.enabled !== false).length} active rules`,
  };
}

/* ─── 3. compareForecastHorizons349 ──────────────────────────────────────── */

/**
 * Take multiple V348 accuracy reports (each with a different forecastPeriod)
 * and determine which forecast horizon delivers best MAE and directional
 * accuracy for each SLA.
 *
 * @param {object[]} accuracyReports  Array of V348 trackForecastAccuracy348 outputs,
 *                                    each optionally annotated with { forecastPeriod }
 * @param {object}   [opts]
 * @param {string}   [opts.label]
 * @returns {{ ok, horizonId, generatedAt, perSlaBestHorizon, bestOverallHorizon,
 *             horizonCount, version, summary }}
 */
function compareForecastHorizons349(accuracyReports, opts) {
  opts = opts || {};
  const label = typeof opts.label === 'string' ? opts.label : 'fleet';
  const ts = new Date();
  const id = _horizonId349(ts);

  const emptyResult = (reason) => ({
    ok: true, horizonId: id, generatedAt: ts.toISOString(),
    perSlaBestHorizon: [], bestOverallHorizon: null,
    horizonCount: 0, label,
    version: FLEET_HEALTH_COMPOSITE_ENGINE_VERSION_349,
    summary: `V349 horizons: ${reason}`,
  });

  if (!Array.isArray(accuracyReports) || accuracyReports.length === 0) {
    return emptyResult('no accuracy reports provided');
  }

  // Annotate each report with its horizon label
  const annotated = accuracyReports.map((report, idx) => ({
    report,
    horizon: (report && report.forecastPeriod) ? report.forecastPeriod
      : (report && report.label && report.label !== 'fleet') ? report.label
      : `horizon_${idx + 1}`,
    idx,
  }));

  // Collect all SLA IDs across all reports
  const allSlaIds = new Set();
  for (const { report } of annotated) {
    const perSla = (report && Array.isArray(report.perSlaAccuracy)) ? report.perSlaAccuracy : [];
    for (const s of perSla) {
      allSlaIds.add(s.id || s.name || 'unknown');
    }
  }

  const perSlaBestHorizon = [];
  const overallHorizonScores = {}; // horizon → [qualityScores]

  for (const slaId of allSlaIds) {
    const horizonResults = [];

    for (const { report, horizon } of annotated) {
      const perSla = (report && Array.isArray(report.perSlaAccuracy)) ? report.perSlaAccuracy : [];
      const match  = perSla.find(s => (s.id || s.name) === slaId);
      if (!match) continue;

      horizonResults.push({
        horizon,
        mae:                 match.mae,
        directionalAccuracy: match.directionalAccuracy,
        qualityScore:        match.qualityScore,
        sampleCount:         match.sampleCount,
      });

      if (!overallHorizonScores[horizon]) overallHorizonScores[horizon] = [];
      if (match.qualityScore !== null) overallHorizonScores[horizon].push(match.qualityScore);
    }

    if (horizonResults.length === 0) continue;

    // Best MAE horizon: lowest MAE (closer to 0 = better)
    const validMAE = horizonResults.filter(h => h.mae !== null);
    const bestMAE  = validMAE.length
      ? validMAE.reduce((best, h) => (h.mae < best.mae ? h : best))
      : null;

    // Best DA horizon: highest directional accuracy
    const validDA  = horizonResults.filter(h => h.directionalAccuracy !== null);
    const bestDA   = validDA.length
      ? validDA.reduce((best, h) => (h.directionalAccuracy > best.directionalAccuracy ? h : best))
      : null;

    // Best overall: highest qualityScore
    const validQS  = horizonResults.filter(h => h.qualityScore !== null);
    const bestQS   = validQS.length
      ? validQS.reduce((best, h) => (h.qualityScore > best.qualityScore ? h : best))
      : null;

    perSlaBestHorizon.push({
      slaId,
      horizonResults,
      bestMaeHorizon:        bestMAE  ? { horizon: bestMAE.horizon,  mae: bestMAE.mae }  : null,
      bestDaHorizon:         bestDA   ? { horizon: bestDA.horizon,   directionalAccuracy: bestDA.directionalAccuracy } : null,
      bestOverallHorizon:    bestQS   ? { horizon: bestQS.horizon,   qualityScore: bestQS.qualityScore } : null,
      horizonCount:          horizonResults.length,
      details: `SLA '${slaId}': best MAE=${bestMAE ? bestMAE.horizon : 'n/a'}, best DA=${bestDA ? bestDA.horizon : 'n/a'}, best overall=${bestQS ? bestQS.horizon + ' (score=' + bestQS.qualityScore + ')' : 'n/a'}`,
    });
  }

  // Best overall horizon across all SLAs
  const horizonMeans = Object.entries(overallHorizonScores).map(([horizon, scores]) => ({
    horizon,
    meanQualityScore: Math.round((_mean349(scores) || 0) * 10) / 10,
    slaCount: scores.length,
  }));
  horizonMeans.sort((a, b) => b.meanQualityScore - a.meanQualityScore);
  const bestOverallHorizon = horizonMeans.length ? horizonMeans[0] : null;

  return {
    ok: true, horizonId: id, generatedAt: ts.toISOString(),
    perSlaBestHorizon,
    bestOverallHorizon,
    allHorizonMeans: horizonMeans,
    horizonCount: annotated.length,
    slaCount: perSlaBestHorizon.length,
    label,
    version: FLEET_HEALTH_COMPOSITE_ENGINE_VERSION_349,
    summary: `V349 horizons: ${annotated.length} horizons compared across ${perSlaBestHorizon.length} SLAs — best overall=${bestOverallHorizon ? bestOverallHorizon.horizon + ' (mean score=' + bestOverallHorizon.meanQualityScore + ')' : 'n/a'}`,
  };
}

/* ─── 4. buildFleetHealthComposite349 ────────────────────────────────────── */

/**
 * Combine V348 correlation timeline, channelHealthTrend, and
 * suppressionEffectiveness into a single fleet-wide composite health score
 * (0-100) with contributing factor breakdown.
 *
 * Score composition:
 *   - Anomaly stability factor (35%): based on ratio of stable/resolved vs
 *     emerging/critical anomaly types in the timeline
 *   - Channel reliability factor (35%): based on overallReliability from
 *     channelHealthTrend
 *   - Suppression effectiveness factor (30%): based on overallEffectiveness from
 *     suppressionEffectiveness
 *
 * @param {object}  timeline              V348 buildCorrelationTimeline348 output
 * @param {object}  channelTrend          V348 buildChannelHealthTrend348 output
 * @param {object}  effectiveness         V348 scoreSuppressionEffectiveness348 output
 * @param {object}  [opts]
 * @param {string}  [opts.label]
 * @param {number}  [opts.anomalyWeight=0.35]     Weight for anomaly stability
 * @param {number}  [opts.channelWeight=0.35]     Weight for channel reliability
 * @param {number}  [opts.suppressionWeight=0.30] Weight for suppression effectiveness
 * @returns {{ ok, compositeId, generatedAt, compositeScore, healthGrade,
 *             factors, anomalyFactor, channelFactor, suppressionFactor,
 *             emergingCount, degradingCount, ineffectiveRules,
 *             version, summary }}
 */
function buildFleetHealthComposite349(timeline, channelTrend, effectiveness, opts) {
  opts = opts || {};
  const label             = typeof opts.label === 'string' ? opts.label : 'fleet';
  const anomalyWeight     = typeof opts.anomalyWeight     === 'number' ? opts.anomalyWeight     : 0.35;
  const channelWeight     = typeof opts.channelWeight     === 'number' ? opts.channelWeight     : 0.35;
  const suppressionWeight = typeof opts.suppressionWeight === 'number' ? opts.suppressionWeight : 0.30;
  const ts = new Date();
  const id = _compositeId349(ts);

  // ── Anomaly Stability Factor ────────────────────────────────────────────
  let anomalyFactor = null;
  let emergingCount = 0;
  let anomalyDetail = 'no timeline data';

  if (timeline && Array.isArray(timeline.timeline) && timeline.timeline.length > 0) {
    const total    = timeline.timeline.length;
    emergingCount  = (timeline.emergingTypes  || []).length;
    const critical = timeline.timeline.filter(t => t.state === 'critical').length;
    const stable   = timeline.timeline.filter(t => t.state === 'stable').length;
    const resolved = (timeline.resolvedTypes  || []).length;

    // Score: resolved+stable = 100%, emerging = -penalty, critical = -bigger penalty
    const goodRatio    = (resolved + stable) / total;
    const emergingPen  = (emergingCount / total) * 0.6;
    const criticalPen  = (critical / total) * 0.8;
    anomalyFactor      = _clamp349(Math.round((goodRatio - emergingPen - criticalPen) * 100 * 10) / 10, 0, 100);
    anomalyDetail      = `${total} types: ${stable} stable, ${resolved} resolved, ${emergingCount} emerging, ${critical} critical → score=${anomalyFactor}`;
  }

  // ── Channel Reliability Factor ──────────────────────────────────────────
  let channelFactor = null;
  let degradingCount = 0;
  let channelDetail  = 'no channel trend data';

  if (channelTrend && typeof channelTrend.overallReliability === 'number') {
    degradingCount = channelTrend.degradingCount || 0;
    const impCount = channelTrend.improvingCount || 0;
    // Base: overallReliability * 100, bonus for improving, penalty for degrading
    const base     = channelTrend.overallReliability * 100;
    const bonus    = (impCount  / Math.max(channelTrend.totalChannels || 1, 1)) * 5;
    const penalty  = (degradingCount / Math.max(channelTrend.totalChannels || 1, 1)) * 10;
    channelFactor  = _clamp349(Math.round((base + bonus - penalty) * 10) / 10, 0, 100);
    channelDetail  = `overallReliability=${Math.round(channelTrend.overallReliability * 100)}%, ${impCount} improving, ${degradingCount} degrading → score=${channelFactor}`;
  }

  // ── Suppression Effectiveness Factor ───────────────────────────────────
  let suppressionFactor = null;
  let ineffectiveRules  = 0;
  let suppressionDetail = 'no effectiveness data';

  if (effectiveness && typeof effectiveness.overallEffectiveness === 'number') {
    ineffectiveRules  = effectiveness.ineffectiveCount || 0;
    const unknownPen  = ((effectiveness.unknownCount || 0) / Math.max(effectiveness.totalRules || 1, 1)) * 10;
    const ineffPen    = (ineffectiveRules / Math.max(effectiveness.totalRules || 1, 1)) * 20;
    suppressionFactor = _clamp349(
      Math.round((effectiveness.overallEffectiveness * 100 - unknownPen - ineffPen) * 10) / 10,
      0, 100
    );
    suppressionDetail = `overallEffectiveness=${Math.round(effectiveness.overallEffectiveness * 100)}%, ${ineffectiveRules} ineffective rules → score=${suppressionFactor}`;
  }

  // ── Composite Score ─────────────────────────────────────────────────────
  // Normalise weights
  const totalWeight = anomalyWeight + channelWeight + suppressionWeight;
  const wA = anomalyWeight     / totalWeight;
  const wC = channelWeight     / totalWeight;
  const wS = suppressionWeight / totalWeight;

  let compositeScore = null;
  const availableFactors = [];
  if (anomalyFactor     !== null) availableFactors.push({ value: anomalyFactor,     weight: wA });
  if (channelFactor     !== null) availableFactors.push({ value: channelFactor,     weight: wC });
  if (suppressionFactor !== null) availableFactors.push({ value: suppressionFactor, weight: wS });

  if (availableFactors.length > 0) {
    const sumWeights = availableFactors.reduce((s, f) => s + f.weight, 0);
    const rawScore   = availableFactors.reduce((s, f) => s + f.value * (f.weight / sumWeights), 0);
    compositeScore   = Math.round(_clamp349(rawScore, 0, 100) * 10) / 10;
  }

  const healthGrade = compositeScore === null ? 'unknown'
    : compositeScore >= 90 ? 'excellent'
    : compositeScore >= 75 ? 'good'
    : compositeScore >= 60 ? 'fair'
    : compositeScore >= 40 ? 'poor'
    : 'critical';

  const factors = [
    {
      name:   'anomaly_stability',
      weight: Math.round(wA * 100),
      score:  anomalyFactor,
      detail: anomalyDetail,
    },
    {
      name:   'channel_reliability',
      weight: Math.round(wC * 100),
      score:  channelFactor,
      detail: channelDetail,
    },
    {
      name:   'suppression_effectiveness',
      weight: Math.round(wS * 100),
      score:  suppressionFactor,
      detail: suppressionDetail,
    },
  ];

  return {
    ok: true, compositeId: id, generatedAt: ts.toISOString(),
    compositeScore,
    healthGrade,
    factors,
    anomalyFactor,
    channelFactor,
    suppressionFactor,
    emergingCount,
    degradingCount,
    ineffectiveRules,
    totalFactors: availableFactors.length,
    label,
    version: FLEET_HEALTH_COMPOSITE_ENGINE_VERSION_349,
    summary: `V349 composite: score=${compositeScore !== null ? compositeScore : 'n/a'} (${healthGrade}) — anomaly=${anomalyFactor !== null ? anomalyFactor : 'n/a'}, channel=${channelFactor !== null ? channelFactor : 'n/a'}, suppression=${suppressionFactor !== null ? suppressionFactor : 'n/a'}`,
  };
}

/* ─── exports ─────────────────────────────────────────────────────────────── */

if (typeof module !== 'undefined') {
  module.exports = {
    FLEET_HEALTH_COMPOSITE_ENGINE_VERSION_349,
    scoreAnomalyImpact349,
    detectSuppressionGaps349,
    compareForecastHorizons349,
    buildFleetHealthComposite349,
    _impactId349,
    _gapId349,
    _horizonId349,
    _compositeId349,
    _hashContent349,
    _clamp349,
    _mean349,
  };
}
