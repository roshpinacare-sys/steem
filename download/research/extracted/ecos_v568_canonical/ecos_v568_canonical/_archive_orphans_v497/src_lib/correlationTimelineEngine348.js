'use strict';
/**
 * lib/correlationTimelineEngine348.js — ECOS V348 (Phase P236)
 * Correlation Timeline Engine
 *
 * Extends V347 Anomaly Trend Correlator with four longitudinal analysis tools:
 *
 *   V347 → anomaly trend correlation, SLA forecasting, suppression overlap detection,
 *           webhook channel health monitoring
 *   V348 → correlation trend timeline, forecast accuracy tracking, suppression
 *           effectiveness scoring, channel health trend analysis
 *
 * Four concrete tools:
 *
 *   1. buildCorrelationTimeline348  — takes multiple V347 correlation outputs
 *      over time and builds a timeline showing how recurrence scores evolved
 *      for each anomaly type. Useful for spotting emerging structural issues
 *      before they become critical.
 *
 *   2. trackForecastAccuracy348     — compares V347 SLA forecasts against
 *      actual V346 compliance reports. Returns per-SLA accuracy metrics
 *      (MAE, directional accuracy) and an aggregate forecast quality score.
 *
 *   3. scoreSuppressionEffectiveness348 — cross-references V345 suppression
 *      rules against V346 suppression audit logs to compute per-rule
 *      effectiveness: what % of relevant events were correctly suppressed vs
 *      leaked.
 *
 *   4. buildChannelHealthTrend348   — takes multiple V347 channel health
 *      snapshots over time and computes per-channel health trajectory
 *      (improving/degrading), rolling success rate, and a channel reliability
 *      score.
 *
 * Pure / dependency-free (R3). All new public identifiers end with `348` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). Additive only (R6).
 *
 * @version 348.0.0
 */

const crypto = require('crypto');

const CORRELATION_TIMELINE_ENGINE_VERSION_348 = '348.0.0';

/* ─── internal helpers ────────────────────────────────────────────────────── */

function _timelineId348(ts) {
  return 'timeline_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _accuracyId348(ts) {
  return 'accuracy_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _effectivenessId348(ts) {
  return 'effectiveness_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _channelTrendId348(ts) {
  return 'channel_trend_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _hashContent348(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

/**
 * Compute mean absolute error between two arrays of numbers.
 * @returns {number} MAE rounded to 3 decimal places
 */
function _computeMAE348(predicted, actual) {
  if (!predicted.length || predicted.length !== actual.length) return null;
  const sum = predicted.reduce((s, p, i) => s + Math.abs(p - actual[i]), 0);
  return Math.round((sum / predicted.length) * 1000) / 1000;
}

/**
 * Directional accuracy: what fraction of forecast direction changes match actuals.
 */
function _directionalAccuracy348(predicted, actual) {
  if (predicted.length < 2 || actual.length < 2) return null;
  let correct = 0;
  const n = Math.min(predicted.length, actual.length) - 1;
  for (let i = 0; i < n; i++) {
    const predDir = Math.sign(predicted[i + 1] - predicted[i]);
    const actDir  = Math.sign(actual[i + 1] - actual[i]);
    if (predDir === actDir) correct++;
  }
  return Math.round((correct / n) * 1000) / 1000;
}

/**
 * Simple linear regression over values array — returns { slope, intercept }.
 */
function _linearRegression348(values) {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values.length ? values[0] : 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX  += i;
    sumY  += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/* ─── 1. buildCorrelationTimeline348 ─────────────────────────────────────── */

/**
 * Build a longitudinal timeline from multiple V347 correlation outputs over time.
 * For each anomaly type seen across the snapshots, tracks how recurrenceScore
 * evolved — enabling early identification of emerging structural regressions.
 *
 * @param {object[]} correlationResults  Array of V347 correlateAnomalyTrends347 outputs
 * @param {object}   [opts]
 * @param {string}   [opts.label]
 * @param {number}   [opts.emergingThreshold=20]  Recurrence score rise per step to flag as emerging
 * @returns {{ ok, timelineId, generatedAt, timeline, anomalyTypes, emergingTypes,
 *             stableTypes, resolvedTypes, totalSnapshots, version, summary }}
 */
function buildCorrelationTimeline348(correlationResults, opts) {
  opts = opts || {};
  const label              = typeof opts.label === 'string' ? opts.label : 'fleet';
  const emergingThreshold  = typeof opts.emergingThreshold === 'number' ? opts.emergingThreshold : 20;
  const ts = new Date();
  const id = _timelineId348(ts);

  if (!Array.isArray(correlationResults) || correlationResults.length === 0) {
    return {
      ok: true, timelineId: id, generatedAt: ts.toISOString(),
      timeline: [], anomalyTypes: [], emergingTypes: [], stableTypes: [], resolvedTypes: [],
      totalSnapshots: 0, label,
      version: CORRELATION_TIMELINE_ENGINE_VERSION_348,
      summary: 'V348 timeline: no correlation results provided',
    };
  }

  // Collect all anomaly types across all snapshots
  const allTypes = new Set();
  for (const cr of correlationResults) {
    const correlations = (cr && Array.isArray(cr.correlations)) ? cr.correlations : [];
    for (const c of correlations) {
      if (c.type) allTypes.add(c.type);
    }
  }

  // Build per-type timeline entries
  const timeline = [];

  for (const type of allTypes) {
    const snapshots = correlationResults.map((cr, idx) => {
      const correlations = (cr && Array.isArray(cr.correlations)) ? cr.correlations : [];
      const match = correlations.find(c => c.type === type);
      return {
        snapshotIndex: idx,
        generatedAt:  (cr && cr.generatedAt) ? cr.generatedAt : null,
        recurrenceScore:   match ? match.recurrenceScore : 0,
        occurrenceCount:   match ? match.occurrenceCount : 0,
        classification:    match ? match.classification : 'absent',
        isRecurring:       match ? !!match.isRecurring : false,
      };
    });

    const scores = snapshots.map(s => s.recurrenceScore);
    const { slope } = _linearRegression348(scores);
    const maxScore   = Math.max(...scores);
    const lastScore  = scores[scores.length - 1];
    const firstScore = scores[0];

    // Trend: rate of score change per snapshot
    const scoreDelta = lastScore - firstScore;
    let trend;
    if (slope > emergingThreshold / correlationResults.length) trend = 'emerging';
    else if (slope < -(emergingThreshold / correlationResults.length)) trend = 'resolving';
    else trend = 'stable';

    // Classify current state
    let state;
    if (lastScore === 0)          state = 'resolved';
    else if (trend === 'emerging') state = 'emerging';
    else if (lastScore >= 80)     state = 'critical';
    else                           state = 'stable';

    timeline.push({
      type,
      snapshots,
      currentScore:  lastScore,
      peakScore:     maxScore,
      scoreDelta:    Math.round(scoreDelta * 10) / 10,
      slope:         Math.round(slope * 1000) / 1000,
      trend,
      state,
      details: `Anomaly type '${type}': score ${firstScore}→${lastScore} over ${correlationResults.length} snapshots, trend=${trend}`,
    });
  }

  // Sort: emerging first, then by currentScore desc
  const stateOrder = { emerging: 0, critical: 1, stable: 2, resolved: 3 };
  timeline.sort((a, b) =>
    (stateOrder[a.state] - stateOrder[b.state]) || (b.currentScore - a.currentScore)
  );

  const emergingTypes  = timeline.filter(t => t.state === 'emerging').map(t => t.type);
  const stableTypes    = timeline.filter(t => t.state === 'stable' || t.state === 'critical').map(t => t.type);
  const resolvedTypes  = timeline.filter(t => t.state === 'resolved').map(t => t.type);
  const anomalyTypes   = timeline.map(t => t.type);

  return {
    ok: true, timelineId: id, generatedAt: ts.toISOString(),
    timeline, anomalyTypes, emergingTypes, stableTypes, resolvedTypes,
    totalSnapshots: correlationResults.length, label,
    version: CORRELATION_TIMELINE_ENGINE_VERSION_348,
    summary: `V348 timeline: ${anomalyTypes.length} anomaly types tracked over ${correlationResults.length} snapshots — ${emergingTypes.length} emerging, ${stableTypes.length} stable/critical, ${resolvedTypes.length} resolved`,
  };
}

/* ─── 2. trackForecastAccuracy348 ────────────────────────────────────────── */

/**
 * Compare V347 SLA forecasts against actual V346 compliance reports to compute
 * per-SLA accuracy metrics (MAE, directional accuracy) and an aggregate quality score.
 *
 * @param {object[]} forecasts      Array of V347 forecastSlaCompliance347 outputs
 * @param {object[]} actualResults  Array of V346 trackSlaCompliance346 outputs (in same order as forecasts)
 * @param {object}   [opts]
 * @param {string}   [opts.label]
 * @returns {{ ok, accuracyId, generatedAt, perSlaAccuracy, overallMAE,
 *             overallDirectionalAccuracy, qualityScore, qualityGrade,
 *             version, summary }}
 */
function trackForecastAccuracy348(forecasts, actualResults, opts) {
  opts = opts || {};
  const label = typeof opts.label === 'string' ? opts.label : 'fleet';
  const ts = new Date();
  const id = _accuracyId348(ts);

  if (!Array.isArray(forecasts) || forecasts.length === 0 ||
      !Array.isArray(actualResults) || actualResults.length === 0) {
    return {
      ok: true, accuracyId: id, generatedAt: ts.toISOString(),
      perSlaAccuracy: [], overallMAE: null, overallDirectionalAccuracy: null,
      qualityScore: null, qualityGrade: 'insufficient_data', label,
      version: CORRELATION_TIMELINE_ENGINE_VERSION_348,
      summary: 'V348 accuracy: no forecasts or actual results provided',
    };
  }

  const n = Math.min(forecasts.length, actualResults.length);

  // Collect per-SLA predicted compliance and actual compliance pairs
  const slaPairs = {};  // slaId → { predicted: [], actual: [] }

  for (let i = 0; i < n; i++) {
    const forecast = forecasts[i];
    const actual   = actualResults[i];
    const fItems   = (forecast && Array.isArray(forecast.forecasts)) ? forecast.forecasts : [];
    const aItems   = (actual   && Array.isArray(actual.compliance))  ? actual.compliance  : [];

    for (const fi of fItems) {
      const sid = fi.id || fi.name || 'unknown';
      if (!slaPairs[sid]) slaPairs[sid] = { id: sid, name: fi.name || sid, predicted: [], actual: [] };
      // Use projectedCompliance * 100 as the predicted score
      slaPairs[sid].predicted.push(typeof fi.projectedCompliance === 'number' ? fi.projectedCompliance * 100 : null);
    }

    for (const ai of aItems) {
      const sid = ai.id || ai.name || 'unknown';
      if (!slaPairs[sid]) slaPairs[sid] = { id: sid, name: ai.name || sid, predicted: [], actual: [] };
      // Use complianceRate * 100 as the actual score, or fallback to passRate
      const rate = typeof ai.complianceRate === 'number' ? ai.complianceRate
        : typeof ai.passRate === 'number' ? ai.passRate : null;
      slaPairs[sid].actual.push(rate !== null ? rate * 100 : null);
    }
  }

  // Compute per-SLA accuracy
  const perSlaAccuracy = [];
  const allMAEs = [];
  const allDAs  = [];

  for (const [, pair] of Object.entries(slaPairs)) {
    const predicted = pair.predicted.filter(v => v !== null);
    const actual    = pair.actual.filter(v => v !== null);
    const minLen    = Math.min(predicted.length, actual.length);

    if (minLen === 0) {
      perSlaAccuracy.push({
        id: pair.id, name: pair.name,
        mae: null, directionalAccuracy: null, qualityScore: null,
        sampleCount: 0,
        details: `SLA '${pair.name}': insufficient paired data`,
      });
      continue;
    }

    const pSlice = predicted.slice(0, minLen);
    const aSlice = actual.slice(0, minLen);

    const mae = _computeMAE348(pSlice, aSlice);
    const da  = _directionalAccuracy348(pSlice, aSlice);

    // Quality score: 0-100, inverse of MAE (capped at 50) plus directional accuracy
    const maeScore = mae !== null ? Math.max(0, 100 - mae * 2) : null;
    const daScore  = da  !== null ? da * 100 : null;
    const qs = (maeScore !== null && daScore !== null) ? Math.round((maeScore + daScore) / 2)
      : (maeScore !== null ? maeScore : daScore);

    if (mae !== null) allMAEs.push(mae);
    if (da  !== null) allDAs.push(da);

    perSlaAccuracy.push({
      id: pair.id, name: pair.name,
      mae, directionalAccuracy: da,
      qualityScore: qs !== null ? Math.round(qs) : null,
      sampleCount: minLen,
      details: `SLA '${pair.name}': MAE=${mae}, directional accuracy=${da !== null ? Math.round(da * 100) + '%' : 'n/a'} over ${minLen} samples`,
    });
  }

  const overallMAE = allMAEs.length
    ? Math.round((allMAEs.reduce((s, v) => s + v, 0) / allMAEs.length) * 1000) / 1000
    : null;
  const overallDA = allDAs.length
    ? Math.round((allDAs.reduce((s, v) => s + v, 0) / allDAs.length) * 1000) / 1000
    : null;

  const maeScore  = overallMAE !== null ? Math.max(0, 100 - overallMAE * 2) : null;
  const daScore   = overallDA  !== null ? overallDA * 100 : null;
  const qualityScore = (maeScore !== null && daScore !== null) ? Math.round((maeScore + daScore) / 2)
    : (maeScore !== null ? Math.round(maeScore) : daScore !== null ? Math.round(daScore) : null);

  const qualityGrade = qualityScore === null ? 'insufficient_data'
    : qualityScore >= 85 ? 'excellent'
    : qualityScore >= 70 ? 'good'
    : qualityScore >= 50 ? 'fair'
    : 'poor';

  return {
    ok: true, accuracyId: id, generatedAt: ts.toISOString(),
    perSlaAccuracy, overallMAE, overallDirectionalAccuracy: overallDA,
    qualityScore, qualityGrade, label,
    totalForecasts: n, totalSlas: perSlaAccuracy.length,
    version: CORRELATION_TIMELINE_ENGINE_VERSION_348,
    summary: `V348 accuracy: quality=${qualityScore !== null ? qualityScore : 'n/a'} (${qualityGrade}), MAE=${overallMAE}, DA=${overallDA !== null ? Math.round(overallDA * 100) + '%' : 'n/a'} across ${perSlaAccuracy.length} SLAs`,
  };
}

/* ─── 3. scoreSuppressionEffectiveness348 ────────────────────────────────── */

/**
 * Cross-reference V345 suppression rules against V346 suppression audit logs
 * to compute per-rule effectiveness: what % of relevant events were correctly
 * suppressed vs leaked.
 *
 * @param {object}   registry    V345 suppression registry (buildAlertSuppressionRegistry345 output)
 * @param {object[]} auditLogs   V346 suppression audit log entries (objects with: ruleId/ruleName, suppressed, leaked)
 * @param {object}   [opts]
 * @param {boolean}  [opts.includeInactive=false]  Include inactive rules
 * @param {number}   [opts.effectivenessThreshold=0.8]  Below this = ineffective
 * @returns {{ ok, effectivenessId, generatedAt, rules, effectiveCount,
 *             ineffectiveCount, unknownCount, overallEffectiveness,
 *             version, summary }}
 */
function scoreSuppressionEffectiveness348(registry, auditLogs, opts) {
  opts = opts || {};
  const includeInactive        = !!opts.includeInactive;
  const effectivenessThreshold = typeof opts.effectivenessThreshold === 'number'
    ? opts.effectivenessThreshold : 0.8;
  const ts = new Date();
  const id = _effectivenessId348(ts);

  const allRules = (registry && Array.isArray(registry.rules)) ? registry.rules
    : (registry && Array.isArray(registry.activeRules)) ? [
        ...(registry.activeRules || []),
        ...(registry.inactiveRules || []),
      ]
    : [];

  const rules = includeInactive ? allRules : allRules.filter(r => r.enabled !== false);

  if (rules.length === 0) {
    return {
      ok: true, effectivenessId: id, generatedAt: ts.toISOString(),
      rules: [], effectiveCount: 0, ineffectiveCount: 0, unknownCount: 0,
      overallEffectiveness: null,
      version: CORRELATION_TIMELINE_ENGINE_VERSION_348,
      summary: 'V348 effectiveness: no rules in registry',
    };
  }

  const logs = Array.isArray(auditLogs) ? auditLogs : [];

  // Index logs by ruleName/ruleId
  const logsByRule = {};
  for (const entry of logs) {
    const key = entry.ruleName || entry.ruleId || entry.rule || 'unknown';
    if (!logsByRule[key]) logsByRule[key] = [];
    logsByRule[key].push(entry);
  }

  let effectiveCount = 0, ineffectiveCount = 0, unknownCount = 0;
  const scoredRules = [];

  for (const rule of rules) {
    const ruleName = rule.name || rule.id || 'unnamed';
    const entries  = logsByRule[ruleName] || logsByRule[rule.id] || [];

    if (entries.length === 0) {
      unknownCount++;
      scoredRules.push({
        name: ruleName, scope: rule.scope || 'global',
        suppressedCount: 0, leakedCount: 0, totalEvents: 0,
        effectivenessRate: null, status: 'unknown',
        details: `Rule '${ruleName}': no audit log entries found`,
      });
      continue;
    }

    const suppressedCount = entries.reduce((s, e) => s + (typeof e.suppressed === 'number' ? e.suppressed : e.suppressed ? 1 : 0), 0);
    const leakedCount     = entries.reduce((s, e) => s + (typeof e.leaked    === 'number' ? e.leaked    : e.leaked    ? 1 : 0), 0);
    const totalEvents     = suppressedCount + leakedCount;

    if (totalEvents === 0) {
      unknownCount++;
      scoredRules.push({
        name: ruleName, scope: rule.scope || 'global',
        suppressedCount: 0, leakedCount: 0, totalEvents: 0,
        effectivenessRate: null, status: 'unknown',
        details: `Rule '${ruleName}': zero events in audit logs`,
      });
      continue;
    }

    const effectivenessRate = Math.round((suppressedCount / totalEvents) * 1000) / 1000;
    const isEffective = effectivenessRate >= effectivenessThreshold;
    if (isEffective) effectiveCount++; else ineffectiveCount++;

    scoredRules.push({
      name: ruleName, scope: rule.scope || 'global',
      suppressedCount, leakedCount, totalEvents,
      effectivenessRate, status: isEffective ? 'effective' : 'ineffective',
      details: `Rule '${ruleName}': ${Math.round(effectivenessRate * 100)}% suppression rate (${suppressedCount}/${totalEvents} events) — ${isEffective ? 'effective' : 'ineffective'}`,
    });
  }

  // Sort: ineffective first, then by effectivenessRate asc
  scoredRules.sort((a, b) => {
    const order = { ineffective: 0, unknown: 1, effective: 2 };
    return (order[a.status] - order[b.status]) ||
      ((a.effectivenessRate || 0) - (b.effectivenessRate || 0));
  });

  const knownRates = scoredRules.filter(r => r.effectivenessRate !== null).map(r => r.effectivenessRate);
  const overallEffectiveness = knownRates.length
    ? Math.round((knownRates.reduce((s, v) => s + v, 0) / knownRates.length) * 1000) / 1000
    : null;

  return {
    ok: true, effectivenessId: id, generatedAt: ts.toISOString(),
    rules: scoredRules, effectiveCount, ineffectiveCount, unknownCount,
    totalRules: scoredRules.length, overallEffectiveness,
    version: CORRELATION_TIMELINE_ENGINE_VERSION_348,
    summary: `V348 effectiveness: ${effectiveCount} effective, ${ineffectiveCount} ineffective, ${unknownCount} unknown of ${scoredRules.length} rules — overall=${overallEffectiveness !== null ? Math.round(overallEffectiveness * 100) + '%' : 'n/a'}`,
  };
}

/* ─── 4. buildChannelHealthTrend348 ──────────────────────────────────────── */

/**
 * Compute per-channel health trajectory from multiple V347 channel health snapshots
 * over time. Returns per-channel trend (improving/degrading/stable), rolling
 * success rate, and a reliability score.
 *
 * @param {object[]} healthReports  Array of V347 buildWebhookChannelHealth347 outputs
 * @param {object}   [opts]
 * @param {string}   [opts.label]
 * @param {number}   [opts.reliabilityThreshold=0.9]  Below this = unreliable
 * @returns {{ ok, channelTrendId, generatedAt, channels, reliableCount,
 *             unreliableCount, improvingCount, degradingCount,
 *             overallReliability, version, summary }}
 */
function buildChannelHealthTrend348(healthReports, opts) {
  opts = opts || {};
  const label                = typeof opts.label === 'string' ? opts.label : 'fleet';
  const reliabilityThreshold = typeof opts.reliabilityThreshold === 'number'
    ? opts.reliabilityThreshold : 0.9;
  const ts = new Date();
  const id = _channelTrendId348(ts);

  if (!Array.isArray(healthReports) || healthReports.length === 0) {
    return {
      ok: true, channelTrendId: id, generatedAt: ts.toISOString(),
      channels: [], reliableCount: 0, unreliableCount: 0,
      improvingCount: 0, degradingCount: 0, totalChannels: 0,
      overallReliability: null, label,
      version: CORRELATION_TIMELINE_ENGINE_VERSION_348,
      summary: 'V348 channel-trend: no health reports provided',
    };
  }

  // Collect all channel IDs across all snapshots
  const allChannels = new Set();
  for (const hr of healthReports) {
    const channels = (hr && Array.isArray(hr.channels)) ? hr.channels : [];
    for (const ch of channels) {
      if (ch.channelId) allChannels.add(ch.channelId);
    }
  }

  const channels = [];
  let reliableCount = 0, unreliableCount = 0;
  let improvingCount = 0, degradingCount = 0;

  for (const channelId of allChannels) {
    const snapshots = healthReports.map((hr, idx) => {
      const chs = (hr && Array.isArray(hr.channels)) ? hr.channels : [];
      const match = chs.find(c => c.channelId === channelId);
      return {
        snapshotIndex:  idx,
        generatedAt:    (hr && hr.generatedAt) ? hr.generatedAt : null,
        successRate:    match ? match.successRate : null,
        status:         match ? match.status : 'absent',
        total:          match ? match.total : 0,
        successful:     match ? match.successful : 0,
      };
    });

    const rates = snapshots.map(s => s.successRate).filter(r => r !== null);

    // Rolling success rate (weighted toward recent)
    const rollingRate = rates.length
      ? Math.round((rates.reduce((s, v) => s + v, 0) / rates.length) * 1000) / 1000
      : null;

    // Slope via linear regression
    let slope = 0;
    if (rates.length >= 2) {
      const reg = _linearRegression348(rates);
      slope = reg.slope;
    }

    const trend = slope > 0.01 ? 'improving' : slope < -0.01 ? 'degrading' : 'stable';

    // Reliability score: rolling success rate, penalised for volatility
    const rateStdDev = rates.length >= 2
      ? Math.sqrt(rates.reduce((s, v) => s + Math.pow(v - rollingRate, 2), 0) / rates.length)
      : 0;
    const reliabilityScore = rollingRate !== null
      ? Math.max(0, Math.round((rollingRate - rateStdDev) * 1000) / 1000)
      : null;

    const isReliable = reliabilityScore !== null && reliabilityScore >= reliabilityThreshold;
    if (isReliable) reliableCount++; else unreliableCount++;
    if (trend === 'improving') improvingCount++;
    if (trend === 'degrading') degradingCount++;

    const lastRate    = rates.length ? rates[rates.length - 1] : null;
    const firstRate   = rates.length ? rates[0] : null;

    channels.push({
      channelId,
      snapshots,
      currentSuccessRate: lastRate,
      baselineSuccessRate: firstRate,
      rollingSuccessRate: rollingRate,
      reliabilityScore,
      isReliable,
      trend,
      slope: Math.round(slope * 10000) / 10000,
      sampleCount: rates.length,
      details: `Channel '${channelId}': rate ${firstRate !== null ? Math.round(firstRate * 100) + '%' : 'n/a'}→${lastRate !== null ? Math.round(lastRate * 100) + '%' : 'n/a'} over ${healthReports.length} snapshots, trend=${trend}, reliable=${isReliable}`,
    });
  }

  // Sort: unreliable + degrading first, then by reliabilityScore asc
  channels.sort((a, b) => {
    const aRisk = !a.isReliable ? 0 : 1;
    const bRisk = !b.isReliable ? 0 : 1;
    return aRisk - bRisk || (a.reliabilityScore || 0) - (b.reliabilityScore || 0);
  });

  const knownScores = channels.filter(c => c.reliabilityScore !== null).map(c => c.reliabilityScore);
  const overallReliability = knownScores.length
    ? Math.round((knownScores.reduce((s, v) => s + v, 0) / knownScores.length) * 1000) / 1000
    : null;

  return {
    ok: true, channelTrendId: id, generatedAt: ts.toISOString(),
    channels, reliableCount, unreliableCount, improvingCount, degradingCount,
    totalChannels: channels.length, overallReliability, label,
    version: CORRELATION_TIMELINE_ENGINE_VERSION_348,
    summary: `V348 channel-trend: ${channels.length} channels — ${reliableCount} reliable, ${unreliableCount} unreliable, ${improvingCount} improving, ${degradingCount} degrading`,
  };
}

/* ─── exports ─────────────────────────────────────────────────────────────── */

if (typeof module !== 'undefined') {
  module.exports = {
    CORRELATION_TIMELINE_ENGINE_VERSION_348,
    buildCorrelationTimeline348,
    trackForecastAccuracy348,
    scoreSuppressionEffectiveness348,
    buildChannelHealthTrend348,
    _timelineId348,
    _accuracyId348,
    _effectivenessId348,
    _channelTrendId348,
    _hashContent348,
    _linearRegression348,
    _computeMAE348,
    _directionalAccuracy348,
  };
}
