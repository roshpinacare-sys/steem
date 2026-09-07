'use strict';
/**
 * lib/fleetHealthHeatmapEngine356.js — ECOS V356 (Phase P244)
 * Fleet Health Heatmap & Cascade Detection Engine
 *
 * Extends V355 Multi-Fleet Aggregator Engine with four advanced analytical tools
 * that operate on sequences of V355 outputs:
 *
 *   V355 → multi-fleet briefing aggregator, SLA trend scorer,
 *           comparison timeline builder, forecast/actuals reconciler
 *   V356 → fleet health heatmap builder, SLA breach cascade detector,
 *           timeline annotation engine, calibration improvement recommender
 *
 * Four concrete tools:
 *
 *   1. buildFleetHealthHeatmap356     — takes multiple V355
 *      aggregateFleetBriefings355 outputs over time and builds a 2D heatmap
 *      matrix (fleets × time periods) of health indices. Returns per-cell
 *      values (healthIndex, compositeRating), row summaries (fleet average),
 *      column summaries (period average), and a hotspot detector.
 *
 *   2. detectSLABreachCascade356      — takes multiple V355
 *      buildSLATrendScore355 outputs ordered chronologically and detects
 *      when at_risk or chronically_breached targets are increasing across
 *      periods (a "cascade" pattern). Returns cascade events with onset
 *      period, affected targets, cascade severity, and a cascade risk score.
 *
 *   3. annotateComparisonTimeline356  — takes a V355
 *      buildComparisonTimeline355 output and an array of external annotation
 *      events, correlates them with inflection points and urgency events,
 *      and produces an annotated timeline with co-occurrence scores.
 *
 *   4. recommendCalibrationImprovement356 — takes multiple V355
 *      reconcileForecastActuals355 outputs over time and identifies
 *      systematic calibration drift patterns. Returns drift classification,
 *      a correction factor recommendation, and a confidence rating.
 *
 * Pure / dependency-free (R3). All new public identifiers end with `356` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). Additive only (R6).
 *
 * @version 356.0.0
 */

const crypto = require('crypto');

const FLEET_HEALTH_HEATMAP_VERSION_356 = '356.0.0';

/* ─── internal helpers ────────────────────────────────────────────────────── */

function _heatmapId356(ts) {
  return 'flthmap_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _cascadeId356(ts) {
  return 'slacasc_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _annotationId356(ts) {
  return 'tmlanno_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _calibRecId356(ts) {
  return 'calbrc_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _hashContent356(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function _clamp356(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function _mean356(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function _slope356(arr) {
  if (!arr || arr.length < 2) return 0;
  const n = arr.length;
  const xMean = (n - 1) / 2;
  const yMean = _mean356(arr);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (arr[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/* ─── 1. buildFleetHealthHeatmap356 ─────────────────────────────────────── */

/**
 * buildFleetHealthHeatmap356(briefings, opts)
 *
 * Takes multiple V355 `aggregateFleetBriefings355` outputs over time and builds
 * a 2D heatmap matrix (fleets × time periods) of health indices. Returns per-cell
 * values (healthIndex, compositeRating), row summaries (fleet average over time),
 * column summaries (period average across fleets), and a hotspot detector that
 * flags cells where healthIndex drops below a configurable threshold.
 *
 * @param {Array}  briefings  - Array of V355 aggregateFleetBriefings355 outputs, each
 *                              containing a fleetBreakdown array (or we synthesize from
 *                              ratingDistribution + healthIndex). Each element should have:
 *                              { aggregatorId, healthIndex, compositeRating, ratingDistribution,
 *                                fleetBreakdown (optional): [{ fleetId, healthIndex, compositeRating }] }
 * @param {Object} opts
 * @param {number} opts.hotspotThreshold  - healthIndex below which a cell is flagged (default 50)
 * @param {Array}  opts.fleetIds          - Optional list of fleet IDs to track (inferred if absent)
 * @returns {Object} Heatmap result
 */
function buildFleetHealthHeatmap356(briefings, opts = {}) {
  const ts = new Date();
  const heatmapId = _heatmapId356(ts);
  const hotspotThreshold = opts.hotspotThreshold != null ? opts.hotspotThreshold : 50;

  if (!briefings || briefings.length === 0) {
    return {
      ok: true,
      heatmapId,
      generatedAt: ts.toISOString(),
      periodCount: 0,
      fleetCount: 0,
      heatmapMatrix: [],
      rowSummaries: [],
      columnSummaries: [],
      hotspots: [],
      version: FLEET_HEALTH_HEATMAP_VERSION_356,
      summary: 'No briefings provided — heatmap unavailable.'
    };
  }

  const validBriefings = briefings.filter(b => b && b.ok);
  const periodCount = validBriefings.length;

  if (periodCount === 0) {
    return {
      ok: true,
      heatmapId,
      generatedAt: ts.toISOString(),
      periodCount: 0,
      fleetCount: 0,
      heatmapMatrix: [],
      rowSummaries: [],
      columnSummaries: [],
      hotspots: [],
      version: FLEET_HEALTH_HEATMAP_VERSION_356,
      summary: 'No valid briefings found — heatmap unavailable.'
    };
  }

  // ── Collect fleet IDs from fleetBreakdown or infer synthetic IDs ─────────
  const allFleetIds = new Set();
  if (opts.fleetIds && Array.isArray(opts.fleetIds)) {
    for (const id of opts.fleetIds) allFleetIds.add(id);
  }
  for (const b of validBriefings) {
    if (b.fleetBreakdown && Array.isArray(b.fleetBreakdown)) {
      for (const f of b.fleetBreakdown) {
        allFleetIds.add(f.fleetId || 'unknown');
      }
    }
  }
  // If no fleetBreakdown available, synthesise a single "aggregate" fleet row
  const useSynthetic = allFleetIds.size === 0;
  if (useSynthetic) allFleetIds.add('aggregate');

  const fleetIds = Array.from(allFleetIds);
  const fleetCount = fleetIds.length;

  // ── Build heatmap matrix [period][fleetIdx] ───────────────────────────────
  const heatmapMatrix = validBriefings.map((b, periodIdx) => {
    const periodLabel = b.aggregatorId || `period_${periodIdx + 1}`;
    const cells = fleetIds.map(fleetId => {
      let healthIndex = null;
      let compositeRating = null;
      if (useSynthetic) {
        healthIndex = b.healthIndex != null ? b.healthIndex : null;
        compositeRating = b.compositeRating || null;
      } else {
        const fleet = (b.fleetBreakdown || []).find(f => (f.fleetId || 'unknown') === fleetId);
        if (fleet) {
          healthIndex = fleet.healthIndex != null ? fleet.healthIndex : null;
          compositeRating = fleet.compositeRating || null;
        }
      }
      return { fleetId, healthIndex, compositeRating };
    });
    return {
      period: periodIdx + 1,
      periodLabel,
      cells
    };
  });

  // ── Row summaries: average healthIndex per fleet over all periods ─────────
  const rowSummaries = fleetIds.map((fleetId, fleetIdx) => {
    const indices = heatmapMatrix
      .map(row => row.cells[fleetIdx].healthIndex)
      .filter(v => v !== null);
    const avgHealth = indices.length > 0
      ? Math.round(_mean356(indices) * 10) / 10
      : null;
    return { fleetId, avgHealthIndex: avgHealth, periodsCovered: indices.length };
  });

  // ── Column summaries: average healthIndex per period across fleets ────────
  const columnSummaries = heatmapMatrix.map(row => {
    const indices = row.cells.map(c => c.healthIndex).filter(v => v !== null);
    const avgHealth = indices.length > 0
      ? Math.round(_mean356(indices) * 10) / 10
      : null;
    return { period: row.period, periodLabel: row.periodLabel, avgHealthIndex: avgHealth, fleetsCovered: indices.length };
  });

  // ── Hotspot detection ─────────────────────────────────────────────────────
  const hotspots = [];
  for (const row of heatmapMatrix) {
    for (const cell of row.cells) {
      if (cell.healthIndex !== null && cell.healthIndex < hotspotThreshold) {
        hotspots.push({
          period: row.period,
          periodLabel: row.periodLabel,
          fleetId: cell.fleetId,
          healthIndex: cell.healthIndex,
          compositeRating: cell.compositeRating,
          severity: cell.healthIndex < hotspotThreshold * 0.5 ? 'critical' : 'warning'
        });
      }
    }
  }

  const summary =
    `Fleet health heatmap: ${periodCount} period(s), ${fleetCount} fleet(s), ` +
    `${hotspots.length} hotspot(s) below threshold=${hotspotThreshold}.`;

  return {
    ok: true,
    heatmapId,
    generatedAt: ts.toISOString(),
    periodCount,
    fleetCount,
    heatmapMatrix,
    rowSummaries,
    columnSummaries,
    hotspots,
    version: FLEET_HEALTH_HEATMAP_VERSION_356,
    summary
  };
}

/* ─── 2. detectSLABreachCascade356 ──────────────────────────────────────── */

/**
 * detectSLABreachCascade356(slaTrends, opts)
 *
 * Takes multiple V355 `buildSLATrendScore355` outputs ordered chronologically
 * and detects when at_risk or chronically_breached targets are increasing
 * across periods (a "cascade" pattern). Returns cascade events with onset
 * period, affected targets, cascade severity (contained/spreading/critical),
 * and a cascade risk score (0–100).
 *
 * @param {Array}  slaTrends  - Array of V355 buildSLATrendScore355 outputs
 * @param {Object} opts
 * @param {number} opts.spreadingThreshold  - Min at_risk/breached count increase to classify as spreading (default 1)
 * @param {number} opts.criticalThreshold   - Min at_risk/breached count for critical severity (default 3)
 * @returns {Object} Cascade detection result
 */
function detectSLABreachCascade356(slaTrends, opts = {}) {
  const ts = new Date();
  const cascadeId = _cascadeId356(ts);
  const spreadingThreshold = opts.spreadingThreshold != null ? opts.spreadingThreshold : 1;
  const criticalThreshold  = opts.criticalThreshold  != null ? opts.criticalThreshold  : 3;

  if (!slaTrends || slaTrends.length === 0) {
    return {
      ok: true,
      cascadeId,
      periodCount: 0,
      cascadeEvents: [],
      cascadeRiskScore: 0,
      overallCascadeStatus: 'no_data',
      version: FLEET_HEALTH_HEATMAP_VERSION_356,
      summary: 'No SLA trends provided — cascade detection unavailable.'
    };
  }

  const validTrends = slaTrends.filter(s => s && s.ok);
  const periodCount = validTrends.length;

  if (periodCount === 0) {
    return {
      ok: true,
      cascadeId,
      periodCount: 0,
      cascadeEvents: [],
      cascadeRiskScore: 0,
      overallCascadeStatus: 'no_data',
      version: FLEET_HEALTH_HEATMAP_VERSION_356,
      summary: 'No valid SLA trends found — cascade detection unavailable.'
    };
  }

  // ── Count at_risk + chronically_breached targets per period ──────────────
  const atRiskCounts = validTrends.map(t => {
    const scores = t.perTargetScores || [];
    return scores.filter(s =>
      s.stabilityClass === 'at_risk' || s.stabilityClass === 'chronically_breached'
    ).length;
  });

  // ── Detect cascade events ─────────────────────────────────────────────────
  const cascadeEvents = [];
  for (let i = 1; i < periodCount; i++) {
    const prev = atRiskCounts[i - 1];
    const curr = atRiskCounts[i];
    const delta = curr - prev;

    if (delta >= spreadingThreshold) {
      // Collect affected targets
      const prevTrend = validTrends[i - 1];
      const currTrend = validTrends[i];
      const prevAtRisk = new Set(
        (prevTrend.perTargetScores || [])
          .filter(s => s.stabilityClass === 'at_risk' || s.stabilityClass === 'chronically_breached')
          .map(s => s.id)
      );
      const newlyAffected = (currTrend.perTargetScores || [])
        .filter(s =>
          (s.stabilityClass === 'at_risk' || s.stabilityClass === 'chronically_breached') &&
          !prevAtRisk.has(s.id)
        )
        .map(s => ({ id: s.id, metric: s.metric, stabilityClass: s.stabilityClass }));

      const severity =
        curr >= criticalThreshold ? 'critical' :
        delta >= spreadingThreshold ? 'spreading' :
        'contained';

      cascadeEvents.push({
        period: i + 1,
        onsetPeriod: i + 1,
        previousAtRiskCount: prev,
        currentAtRiskCount: curr,
        delta,
        affectedTargets: newlyAffected,
        severity,
        type: 'sla_cascade'
      });
    }
  }

  // ── Cascade risk score (0–100) ────────────────────────────────────────────
  const maxAtRisk = Math.max(...atRiskCounts, 0);
  const totalTargets = validTrends.reduce((max, t) =>
    Math.max(max, (t.perTargetScores || []).length), 0);

  const cascadeRiskScore = totalTargets > 0
    ? Math.round(_clamp356((maxAtRisk / totalTargets) * 100, 0, 100))
    : 0;

  // ── Overall cascade status ────────────────────────────────────────────────
  let overallCascadeStatus;
  if (cascadeEvents.length === 0) {
    overallCascadeStatus = atRiskCounts[atRiskCounts.length - 1] > 0 ? 'stable_risk' : 'no_cascade';
  } else {
    const worstSeverity = cascadeEvents.reduce((worst, e) => {
      const rank = { critical: 2, spreading: 1, contained: 0 };
      return (rank[e.severity] ?? -1) > (rank[worst] ?? -1) ? e.severity : worst;
    }, 'contained');
    overallCascadeStatus = worstSeverity;
  }

  const summary =
    `SLA breach cascade: ${periodCount} period(s), ${cascadeEvents.length} cascade event(s), ` +
    `riskScore=${cascadeRiskScore}, status=${overallCascadeStatus}.`;

  return {
    ok: true,
    cascadeId,
    periodCount,
    cascadeEvents,
    cascadeRiskScore,
    overallCascadeStatus,
    version: FLEET_HEALTH_HEATMAP_VERSION_356,
    summary
  };
}

/* ─── 3. annotateComparisonTimeline356 ───────────────────────────────────── */

/**
 * annotateComparisonTimeline356(timeline, events, opts)
 *
 * Takes a V355 `buildComparisonTimeline355` output and an array of external
 * annotation events (e.g. deployment dates, incident tickets, config changes),
 * correlates them with inflection points and urgency events in the timeline,
 * and produces an annotated timeline with co-occurrence scores and likely causal
 * relationships (temporal proximity within configurable window).
 *
 * @param {Object} timeline  - V355 buildComparisonTimeline355 output
 * @param {Array}  events    - Array of { period, type, label, description? } annotation events
 * @param {Object} opts
 * @param {number} opts.correlationWindow - Period window for co-occurrence (default 1)
 * @returns {Object} Annotated timeline result
 */
function annotateComparisonTimeline356(timeline, events, opts = {}) {
  const ts = new Date();
  const annotationId = _annotationId356(ts);
  const correlationWindow = opts.correlationWindow != null ? opts.correlationWindow : 1;

  if (!timeline || !timeline.ok) {
    return {
      ok: true,
      annotationId,
      eventCount: 0,
      annotatedInflectionPoints: [],
      annotatedUrgencyEvents: [],
      correlatedPairs: [],
      version: FLEET_HEALTH_HEATMAP_VERSION_356,
      summary: 'No valid timeline provided — annotation unavailable.'
    };
  }

  const externalEvents = Array.isArray(events) ? events.filter(e => e && e.period != null) : [];
  const eventCount = externalEvents.length;

  // ── Annotate inflection points ────────────────────────────────────────────
  const annotatedInflectionPoints = (timeline.inflectionPoints || []).map(ip => {
    const nearby = externalEvents.filter(e =>
      Math.abs(e.period - ip.period) <= correlationWindow
    );
    const coOccurrenceScore = nearby.length > 0
      ? Math.round(_clamp356(nearby.reduce((s, e) =>
          s + (1 / (Math.abs(e.period - ip.period) + 1)), 0) * 100, 0, 100))
      : 0;
    return {
      ...ip,
      nearbyEvents: nearby.map(e => ({ period: e.period, type: e.type, label: e.label })),
      coOccurrenceScore,
      likelyCausal: coOccurrenceScore >= 50
    };
  });

  // ── Annotate urgency events ───────────────────────────────────────────────
  const annotatedUrgencyEvents = (timeline.urgencyEventLog || []).map(ue => {
    const nearby = externalEvents.filter(e =>
      Math.abs(e.period - ue.period) <= correlationWindow
    );
    const coOccurrenceScore = nearby.length > 0
      ? Math.round(_clamp356(nearby.reduce((s, e) =>
          s + (1 / (Math.abs(e.period - ue.period) + 1)), 0) * 100, 0, 100))
      : 0;
    return {
      ...ue,
      nearbyEvents: nearby.map(e => ({ period: e.period, type: e.type, label: e.label })),
      coOccurrenceScore,
      likelyCausal: coOccurrenceScore >= 50
    };
  });

  // ── Build correlated pairs (external event → timeline signal) ────────────
  const correlatedPairs = [];
  for (const extEvent of externalEvents) {
    const matchedInflections = annotatedInflectionPoints.filter(ip =>
      Math.abs(ip.period - extEvent.period) <= correlationWindow
    );
    const matchedUrgency = annotatedUrgencyEvents.filter(ue =>
      Math.abs(ue.period - extEvent.period) <= correlationWindow
    );
    if (matchedInflections.length > 0 || matchedUrgency.length > 0) {
      correlatedPairs.push({
        externalEvent: { period: extEvent.period, type: extEvent.type, label: extEvent.label },
        matchedInflections: matchedInflections.map(ip => ({ period: ip.period, type: ip.type, swing: ip.swing })),
        matchedUrgencyEvents: matchedUrgency.map(ue => ({ period: ue.period, type: ue.type })),
        correlationStrength: matchedInflections.length + matchedUrgency.length
      });
    }
  }

  const likelyCausalCount =
    annotatedInflectionPoints.filter(ip => ip.likelyCausal).length +
    annotatedUrgencyEvents.filter(ue => ue.likelyCausal).length;

  const summary =
    `Timeline annotation: ${eventCount} external event(s), ` +
    `${annotatedInflectionPoints.length} inflection point(s) annotated, ` +
    `${annotatedUrgencyEvents.length} urgency event(s) annotated, ` +
    `${likelyCausalCount} likely causal correlation(s).`;

  return {
    ok: true,
    annotationId,
    eventCount,
    annotatedInflectionPoints,
    annotatedUrgencyEvents,
    correlatedPairs,
    version: FLEET_HEALTH_HEATMAP_VERSION_356,
    summary
  };
}

/* ─── 4. recommendCalibrationImprovement356 ─────────────────────────────── */

/**
 * recommendCalibrationImprovement356(reconciliations, opts)
 *
 * Takes multiple V355 `reconcileForecastActuals355` outputs over time and
 * identifies systematic calibration drift patterns (consistently optimistic,
 * oscillating, recently improved, etc.). Returns drift classification, a
 * correction factor recommendation, and a confidence rating for the recommendation.
 *
 * @param {Array}  reconciliations - Array of V355 reconcileForecastActuals355 outputs
 * @param {Object} opts
 * @param {number} opts.minPeriodsForConfidence - Min reconciliation periods for high_confidence (default 3)
 * @param {number} opts.recentWindow            - Number of most recent periods for "recently improved" check (default 2)
 * @returns {Object} Calibration improvement recommendation
 */
function recommendCalibrationImprovement356(reconciliations, opts = {}) {
  const ts = new Date();
  const calibRecId = _calibRecId356(ts);
  const minPeriodsForConfidence = opts.minPeriodsForConfidence != null ? opts.minPeriodsForConfidence : 3;
  const recentWindow = opts.recentWindow != null ? opts.recentWindow : 2;

  if (!reconciliations || reconciliations.length === 0) {
    return {
      ok: true,
      calibRecId,
      periodCount: 0,
      driftPattern: 'insufficient_data',
      correctionFactor: null,
      correctionDirection: null,
      confidence: 'none',
      recommendation: null,
      version: FLEET_HEALTH_HEATMAP_VERSION_356,
      summary: 'No reconciliations provided — calibration recommendation unavailable.'
    };
  }

  const validRecs = reconciliations.filter(r => r && r.ok && r.pairCount > 0);
  const periodCount = validRecs.length;

  if (periodCount === 0) {
    return {
      ok: true,
      calibRecId,
      periodCount: 0,
      driftPattern: 'insufficient_data',
      correctionFactor: null,
      correctionDirection: null,
      confidence: 'none',
      recommendation: null,
      version: FLEET_HEALTH_HEATMAP_VERSION_356,
      summary: 'No valid reconciliation periods found — calibration recommendation unavailable.'
    };
  }

  // ── Extract bias series over time ────────────────────────────────────────
  const biasHistory = validRecs.map(r => r.bias != null ? r.bias : 0);
  const maeHistory  = validRecs.map(r => r.mae  != null ? r.mae  : 0);
  const ratingHistory = validRecs.map(r => r.calibrationRating || 'uncalibrated');

  // ── Drift classification ─────────────────────────────────────────────────
  const avgBias = _mean356(biasHistory);
  const biasSlope = _slope356(biasHistory);

  // Check "recently improved": if last recentWindow periods are well_calibrated
  const recentRatings = ratingHistory.slice(-recentWindow);
  const recentlyImproved = recentRatings.every(r => r === 'well_calibrated') &&
    ratingHistory.length > recentWindow &&
    ratingHistory.slice(0, -recentWindow).some(r => r !== 'well_calibrated');

  // Detect oscillation: bias alternates sign
  let oscillationCount = 0;
  for (let i = 1; i < biasHistory.length; i++) {
    if (biasHistory[i] * biasHistory[i - 1] < 0) oscillationCount++;
  }
  const isOscillating = periodCount >= 3 && oscillationCount >= Math.floor(periodCount * 0.4);

  let driftPattern;
  if (recentlyImproved) {
    driftPattern = 'recently_improved';
  } else if (isOscillating) {
    driftPattern = 'oscillating';
  } else if (avgBias != null && avgBias > 5) {
    driftPattern = 'consistently_optimistic';
  } else if (avgBias != null && avgBias < -5) {
    driftPattern = 'consistently_pessimistic';
  } else if (biasSlope > 1) {
    driftPattern = 'drift_worsening_optimistic';
  } else if (biasSlope < -1) {
    driftPattern = 'drift_worsening_pessimistic';
  } else {
    driftPattern = 'stable';
  }

  // ── Correction factor recommendation ─────────────────────────────────────
  let correctionFactor = null;
  let correctionDirection = null;
  let recommendation = null;

  if (driftPattern === 'consistently_optimistic') {
    correctionFactor = Math.round(Math.abs(avgBias) * 10) / 10;
    correctionDirection = 'decrease';
    recommendation = `Apply a -${correctionFactor} point bias correction to future forecasts to counteract systematic over-estimation.`;
  } else if (driftPattern === 'consistently_pessimistic') {
    correctionFactor = Math.round(Math.abs(avgBias) * 10) / 10;
    correctionDirection = 'increase';
    recommendation = `Apply a +${correctionFactor} point bias correction to future forecasts to counteract systematic under-estimation.`;
  } else if (driftPattern === 'drift_worsening_optimistic') {
    correctionFactor = Math.round(Math.abs(biasSlope) * 10) / 10;
    correctionDirection = 'decrease';
    recommendation = `Forecasts are increasingly optimistic (slope=${correctionFactor}). Review model assumptions for upward drift.`;
  } else if (driftPattern === 'drift_worsening_pessimistic') {
    correctionFactor = Math.round(Math.abs(biasSlope) * 10) / 10;
    correctionDirection = 'increase';
    recommendation = `Forecasts are increasingly pessimistic (slope=${correctionFactor}). Review model assumptions for downward drift.`;
  } else if (driftPattern === 'oscillating') {
    correctionFactor = Math.round(_mean356(maeHistory) * 10) / 10;
    correctionDirection = 'none';
    recommendation = `Forecasts oscillate between over- and under-estimation (MAE avg=${correctionFactor}). Consider widening confidence bands or using ensemble averaging.`;
  } else if (driftPattern === 'recently_improved') {
    correctionFactor = 0;
    correctionDirection = 'none';
    recommendation = 'Calibration has recently improved. No correction needed — continue monitoring.';
  } else {
    correctionFactor = 0;
    correctionDirection = 'none';
    recommendation = 'Calibration is stable. No correction currently required.';
  }

  // ── Confidence rating ─────────────────────────────────────────────────────
  let confidence;
  if (periodCount >= minPeriodsForConfidence && driftPattern !== 'oscillating') {
    confidence = 'high';
  } else if (periodCount >= 2) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  const summary =
    `Calibration improvement: ${periodCount} period(s), driftPattern=${driftPattern}, ` +
    `correctionFactor=${correctionFactor}, direction=${correctionDirection}, confidence=${confidence}.`;

  return {
    ok: true,
    calibRecId,
    periodCount,
    driftPattern,
    correctionFactor,
    correctionDirection,
    confidence,
    recommendation,
    version: FLEET_HEALTH_HEATMAP_VERSION_356,
    summary
  };
}

/* ─── exports ─────────────────────────────────────────────────────────────── */

module.exports = {
  FLEET_HEALTH_HEATMAP_VERSION_356,
  buildFleetHealthHeatmap356,
  detectSLABreachCascade356,
  annotateComparisonTimeline356,
  recommendCalibrationImprovement356,
  // ID generators (exported for testing)
  _heatmapId356,
  _cascadeId356,
  _annotationId356,
  _calibRecId356,
  // Internal helpers (exported for testing)
  _hashContent356,
  _clamp356,
  _mean356,
  _slope356
};
