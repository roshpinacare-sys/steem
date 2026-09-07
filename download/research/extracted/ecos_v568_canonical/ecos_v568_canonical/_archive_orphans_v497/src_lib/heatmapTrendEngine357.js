'use strict';
/**
 * lib/heatmapTrendEngine357.js — ECOS V357 (Phase P245)
 * Heatmap Trend & Cascade Propagation Engine
 *
 * Extends V356 Fleet Health Heatmap & Cascade Detection Engine with four
 * advanced meta-analytical tools that operate on sequences of V356 outputs:
 *
 *   V356 → fleet health heatmap builder, SLA breach cascade detector,
 *           timeline annotation engine, calibration improvement recommender
 *   V357 → multi-period heatmap trend analyzer, cascade propagation predictor,
 *           annotation impact scorer, calibration drift forecaster
 *
 * Four concrete tools:
 *
 *   1. analyzeHeatmapTrends357      — takes multiple V356
 *      buildFleetHealthHeatmap356 outputs over time and identifies persistent
 *      hotspot patterns, improving fleets, and deteriorating fleets. Returns
 *      per-fleet trend classification and a portfolio heatmap health trajectory.
 *
 *   2. predictCascadePropagation357 — takes multiple V356
 *      detectSLABreachCascade356 outputs and extrapolates how many additional
 *      targets may become affected in the next N periods using cascade velocity.
 *      Returns a propagation forecast with confidence bounds.
 *
 *   3. scoreAnnotationImpact357     — takes multiple V356
 *      annotateComparisonTimeline356 outputs and aggregates which external event
 *      types are most frequently co-occurring with negative vs positive inflection
 *      points. Returns an event-type impact table with positive/negative scores.
 *
 *   4. forecastCalibrationDrift357  — takes multiple V356
 *      recommendCalibrationImprovement356 outputs over time and forecasts whether
 *      the current correction factor is converging toward zero (improving) or
 *      diverging (worsening). Returns a convergence prediction with estimated
 *      periods-to-stable count.
 *
 * Pure / dependency-free (R3). All new public identifiers end with `357` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). Additive only (R6).
 *
 * @version 357.0.0
 */

const crypto = require('crypto');

const HEATMAP_TREND_VERSION_357 = '357.0.0';

/* ─── internal helpers ────────────────────────────────────────────────────── */

function _heatmapTrendId357(ts) {
  return 'hmtrnd_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _cascadePropId357(ts) {
  return 'cscdprop_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _annoImpactId357(ts) {
  return 'annoimp_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _calibDriftId357(ts) {
  return 'cabdrift_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _hashContent357(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function _clamp357(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function _mean357(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function _slope357(arr) {
  if (!arr || arr.length < 2) return 0;
  const n = arr.length;
  const xMean = (n - 1) / 2;
  const yMean = _mean357(arr);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (arr[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/* ─── 1. analyzeHeatmapTrends357 ─────────────────────────────────────────── */

/**
 * analyzeHeatmapTrends357(heatmaps, opts)
 *
 * Takes multiple V356 `buildFleetHealthHeatmap356` outputs over time and
 * identifies persistent hotspot patterns (fleets consistently below threshold),
 * improving fleets (hotspot count decreasing), and deteriorating fleets
 * (hotspot count increasing). Returns trend classification per fleet and a
 * portfolio heatmap health trajectory.
 *
 * @param {Array}  heatmaps  - Array of V356 buildFleetHealthHeatmap356 outputs
 * @param {Object} opts
 * @param {number} opts.persistenceThreshold - Min fraction of periods a fleet must be a hotspot
 *                                             to be classified as persistent (default 0.5)
 * @param {number} opts.trendSlopeThreshold  - Min absolute slope for improving/deteriorating (default 0.5)
 * @returns {Object} Heatmap trend analysis result
 */
function analyzeHeatmapTrends357(heatmaps, opts = {}) {
  const ts = new Date();
  const trendId = _heatmapTrendId357(ts);
  const persistenceThreshold = opts.persistenceThreshold != null ? opts.persistenceThreshold : 0.5;
  const trendSlopeThreshold  = opts.trendSlopeThreshold  != null ? opts.trendSlopeThreshold  : 0.5;

  if (!heatmaps || heatmaps.length === 0) {
    return {
      ok: true,
      trendId,
      generatedAt: ts.toISOString(),
      heatmapCount: 0,
      fleetTrends: [],
      persistentHotspotFleets: [],
      improvingFleets: [],
      deterioratingFleets: [],
      portfolioTrajectory: 'insufficient_data',
      version: HEATMAP_TREND_VERSION_357,
      summary: 'No heatmaps provided — trend analysis unavailable.'
    };
  }

  const validHeatmaps = heatmaps.filter(h => h && h.ok);
  const heatmapCount = validHeatmaps.length;

  if (heatmapCount === 0) {
    return {
      ok: true,
      trendId,
      generatedAt: ts.toISOString(),
      heatmapCount: 0,
      fleetTrends: [],
      persistentHotspotFleets: [],
      improvingFleets: [],
      deterioratingFleets: [],
      portfolioTrajectory: 'insufficient_data',
      version: HEATMAP_TREND_VERSION_357,
      summary: 'No valid heatmaps found — trend analysis unavailable.'
    };
  }

  // ── Collect all fleet IDs across all heatmaps ─────────────────────────────
  const allFleetIds = new Set();
  for (const h of validHeatmaps) {
    for (const row of (h.rowSummaries || [])) {
      allFleetIds.add(row.fleetId);
    }
  }

  // ── Per-fleet: track hotspot count per heatmap period ────────────────────
  const fleetTrends = Array.from(allFleetIds).map(fleetId => {
    // hotspot count per period for this fleet
    const hotspotCounts = validHeatmaps.map(h => {
      return (h.hotspots || []).filter(hs => hs.fleetId === fleetId).length;
    });

    // healthIndex series per period from rowSummaries
    const healthSeries = validHeatmaps.map(h => {
      const row = (h.rowSummaries || []).find(r => r.fleetId === fleetId);
      return row ? row.avgHealthIndex : null;
    }).filter(v => v !== null);

    const totalHotspotsAcross = hotspotCounts.reduce((s, c) => s + c, 0);
    const periodsAsHotspot    = hotspotCounts.filter(c => c > 0).length;
    const persistenceFraction = heatmapCount > 0 ? periodsAsHotspot / heatmapCount : 0;

    const hotspotSlope  = _slope357(hotspotCounts);   // + = more hotspots over time (bad)
    const healthSlope   = _slope357(healthSeries);     // + = health improving (good)

    // Trend classification based on hotspot slope
    let trendClass;
    if (heatmapCount < 2) {
      trendClass = 'insufficient_data';
    } else if (hotspotSlope <= -trendSlopeThreshold) {
      trendClass = 'improving';
    } else if (hotspotSlope >= trendSlopeThreshold) {
      trendClass = 'deteriorating';
    } else if (persistenceFraction >= persistenceThreshold) {
      trendClass = 'persistently_at_risk';
    } else {
      trendClass = 'stable';
    }

    const avgHealthIndex = healthSeries.length > 0
      ? Math.round(_mean357(healthSeries) * 10) / 10
      : null;

    return {
      fleetId,
      heatmapCount,
      periodsAsHotspot,
      persistenceFraction: Math.round(persistenceFraction * 100) / 100,
      hotspotCounts,
      avgHealthIndex,
      healthSlope: Math.round(healthSlope * 100) / 100,
      hotspotSlope: Math.round(hotspotSlope * 100) / 100,
      trendClass
    };
  });

  // ── Derived lists ─────────────────────────────────────────────────────────
  const persistentHotspotFleets = fleetTrends
    .filter(f => f.trendClass === 'persistently_at_risk')
    .map(f => f.fleetId);
  const improvingFleets = fleetTrends
    .filter(f => f.trendClass === 'improving')
    .map(f => f.fleetId);
  const deterioratingFleets = fleetTrends
    .filter(f => f.trendClass === 'deteriorating')
    .map(f => f.fleetId);

  // ── Portfolio trajectory ───────────────────────────────────────────────────
  // Based on weighted average health slope across all fleets
  const allHealthSeries = validHeatmaps.map(h => {
    const indices = (h.columnSummaries || []).map(c => c.avgHealthIndex).filter(v => v !== null);
    return _mean357(indices);
  }).filter(v => v !== null);

  let portfolioTrajectory;
  if (heatmapCount < 2 || allHealthSeries.length < 2) {
    portfolioTrajectory = 'insufficient_data';
  } else {
    const portfolioSlope = _slope357(allHealthSeries);
    if (portfolioSlope >= trendSlopeThreshold) {
      portfolioTrajectory = 'improving';
    } else if (portfolioSlope <= -trendSlopeThreshold) {
      portfolioTrajectory = 'deteriorating';
    } else {
      portfolioTrajectory = 'stable';
    }
  }

  const summary =
    `Heatmap trend analysis: ${heatmapCount} heatmap(s), ${allFleetIds.size} fleet(s), ` +
    `${deterioratingFleets.length} deteriorating, ${improvingFleets.length} improving, ` +
    `${persistentHotspotFleets.length} persistently at risk. Portfolio: ${portfolioTrajectory}.`;

  return {
    ok: true,
    trendId,
    generatedAt: ts.toISOString(),
    heatmapCount,
    fleetTrends,
    persistentHotspotFleets,
    improvingFleets,
    deterioratingFleets,
    portfolioTrajectory,
    version: HEATMAP_TREND_VERSION_357,
    summary
  };
}

/* ─── 2. predictCascadePropagation357 ───────────────────────────────────── */

/**
 * predictCascadePropagation357(cascades, opts)
 *
 * Takes multiple V356 `detectSLABreachCascade356` outputs ordered chronologically
 * and uses cascade velocity (rate of new at_risk targets per period) to extrapolate
 * how many additional targets may become affected in the next N periods. Returns a
 * propagation forecast with confidence bounds.
 *
 * @param {Array}  cascades  - Array of V356 detectSLABreachCascade356 outputs (chronological)
 * @param {Object} opts
 * @param {number} opts.forecastPeriods     - Number of future periods to forecast (default 3)
 * @param {number} opts.confidenceBandWidth - Half-width of confidence band as fraction of forecast (default 0.2)
 * @returns {Object} Cascade propagation forecast result
 */
function predictCascadePropagation357(cascades, opts = {}) {
  const ts = new Date();
  const propId = _cascadePropId357(ts);
  const forecastPeriods     = opts.forecastPeriods     != null ? opts.forecastPeriods     : 3;
  const confidenceBandWidth = opts.confidenceBandWidth != null ? opts.confidenceBandWidth : 0.2;

  if (!cascades || cascades.length === 0) {
    return {
      ok: true,
      propagationId: propId,
      generatedAt: ts.toISOString(),
      observedPeriods: 0,
      forecastPeriods: 0,
      cascadeVelocity: null,
      propagationForecast: [],
      convergenceStatus: 'no_data',
      confidence: 'none',
      version: HEATMAP_TREND_VERSION_357,
      summary: 'No cascade data provided — propagation forecast unavailable.'
    };
  }

  const validCascades = cascades.filter(c => c && c.ok);
  const observedPeriods = validCascades.length;

  if (observedPeriods === 0) {
    return {
      ok: true,
      propagationId: propId,
      generatedAt: ts.toISOString(),
      observedPeriods: 0,
      forecastPeriods: 0,
      cascadeVelocity: null,
      propagationForecast: [],
      convergenceStatus: 'no_data',
      confidence: 'none',
      version: HEATMAP_TREND_VERSION_357,
      summary: 'No valid cascade periods found — propagation forecast unavailable.'
    };
  }

  // ── Extract at-risk count per period from cascade risk scores ─────────────
  // Use cascadeRiskScore as a proxy if perTargetScores not directly available
  const riskScores = validCascades.map(c => c.cascadeRiskScore != null ? c.cascadeRiskScore : 0);

  // ── Cascade velocity: slope of risk score over observed periods ───────────
  const rawVelocity = _slope357(riskScores);
  const cascadeVelocity = Math.round(rawVelocity * 100) / 100;

  // ── Latest observed risk score as baseline for forecast ──────────────────
  const lastRiskScore = riskScores[riskScores.length - 1];

  // ── Build propagation forecast ────────────────────────────────────────────
  const propagationForecast = [];
  for (let i = 1; i <= forecastPeriods; i++) {
    const forecastedScore = _clamp357(lastRiskScore + cascadeVelocity * i, 0, 100);
    const bandHalf = forecastedScore * confidenceBandWidth;
    const lowerBound = Math.round(_clamp357(forecastedScore - bandHalf, 0, 100) * 10) / 10;
    const upperBound = Math.round(_clamp357(forecastedScore + bandHalf, 0, 100) * 10) / 10;
    const expectedScore = Math.round(forecastedScore * 10) / 10;

    // Status based on forecast score
    let status;
    if (expectedScore >= 75) {
      status = 'critical';
    } else if (expectedScore >= 40) {
      status = 'spreading';
    } else if (expectedScore > 0) {
      status = 'contained';
    } else {
      status = 'no_cascade';
    }

    propagationForecast.push({
      forecastPeriod: observedPeriods + i,
      expectedCascadeRiskScore: expectedScore,
      lowerBound,
      upperBound,
      status
    });
  }

  // ── Convergence status ────────────────────────────────────────────────────
  let convergenceStatus;
  if (cascadeVelocity < -1) {
    convergenceStatus = 'converging';
  } else if (cascadeVelocity > 1) {
    convergenceStatus = 'diverging';
  } else {
    convergenceStatus = 'stable';
  }

  // ── Confidence ────────────────────────────────────────────────────────────
  let confidence;
  if (observedPeriods >= 4) {
    confidence = 'high';
  } else if (observedPeriods >= 2) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  const finalForecastScore = propagationForecast.length > 0
    ? propagationForecast[propagationForecast.length - 1].expectedCascadeRiskScore
    : null;

  const summary =
    `Cascade propagation: ${observedPeriods} observed period(s), velocity=${cascadeVelocity}, ` +
    `${forecastPeriods} forecast period(s), convergence=${convergenceStatus}, ` +
    `final forecast score=${finalForecastScore}, confidence=${confidence}.`;

  return {
    ok: true,
    propagationId: propId,
    generatedAt: ts.toISOString(),
    observedPeriods,
    forecastPeriods,
    cascadeVelocity,
    propagationForecast,
    convergenceStatus,
    confidence,
    version: HEATMAP_TREND_VERSION_357,
    summary
  };
}

/* ─── 3. scoreAnnotationImpact357 ────────────────────────────────────────── */

/**
 * scoreAnnotationImpact357(annotations, opts)
 *
 * Takes multiple V356 `annotateComparisonTimeline356` outputs and aggregates
 * which external event types are most frequently co-occurring with negative
 * inflection points vs positive inflection points. Returns an event-type impact
 * table with positive/negative impact scores (0–100 each).
 *
 * @param {Array}  annotations - Array of V356 annotateComparisonTimeline356 outputs
 * @param {Object} opts
 * @param {number} opts.minCoOccurrenceScore - Minimum coOccurrenceScore to count as a match (default 30)
 * @returns {Object} Annotation impact scoring result
 */
function scoreAnnotationImpact357(annotations, opts = {}) {
  const ts = new Date();
  const impactId = _annoImpactId357(ts);
  const minCoOccurrenceScore = opts.minCoOccurrenceScore != null ? opts.minCoOccurrenceScore : 30;

  if (!annotations || annotations.length === 0) {
    return {
      ok: true,
      impactId,
      generatedAt: ts.toISOString(),
      annotationCount: 0,
      eventTypeImpactTable: [],
      mostImpactfulNegativeType: null,
      mostImpactfulPositiveType: null,
      version: HEATMAP_TREND_VERSION_357,
      summary: 'No annotations provided — impact scoring unavailable.'
    };
  }

  const validAnnotations = annotations.filter(a => a && a.ok);
  const annotationCount = validAnnotations.length;

  if (annotationCount === 0) {
    return {
      ok: true,
      impactId,
      generatedAt: ts.toISOString(),
      annotationCount: 0,
      eventTypeImpactTable: [],
      mostImpactfulNegativeType: null,
      mostImpactfulPositiveType: null,
      version: HEATMAP_TREND_VERSION_357,
      summary: 'No valid annotations found — impact scoring unavailable.'
    };
  }

  // ── Aggregate per event type: positive and negative co-occurrence counts ──
  // Inflection point swing > 0 → improvement; swing < 0 → degradation
  // Urgency events type 'escalation' → negative; 'de-escalation' → positive
  const typeStats = {}; // { [type]: { posCount, negCount, totalScore, occurrences } }

  function ensureType(type) {
    if (!typeStats[type]) {
      typeStats[type] = { posCount: 0, negCount: 0, totalScore: 0, occurrences: 0 };
    }
  }

  for (const anno of validAnnotations) {
    // Process annotated inflection points
    for (const ip of (anno.annotatedInflectionPoints || [])) {
      if (ip.coOccurrenceScore < minCoOccurrenceScore) continue;
      for (const ev of (ip.nearbyEvents || [])) {
        const type = ev.type || 'unknown';
        ensureType(type);
        typeStats[type].occurrences++;
        typeStats[type].totalScore += ip.coOccurrenceScore;
        if ((ip.swing != null && ip.swing > 0) || ip.type === 'improvement') {
          typeStats[type].posCount++;
        } else {
          typeStats[type].negCount++;
        }
      }
    }

    // Process annotated urgency events
    for (const ue of (anno.annotatedUrgencyEvents || [])) {
      if (ue.coOccurrenceScore < minCoOccurrenceScore) continue;
      for (const ev of (ue.nearbyEvents || [])) {
        const type = ev.type || 'unknown';
        ensureType(type);
        typeStats[type].occurrences++;
        typeStats[type].totalScore += ue.coOccurrenceScore;
        // urgency type 'escalation' → negative, 'de_escalation'/'deescalation' → positive
        if (ue.type === 'escalation' || ue.type === 'urgency_increase') {
          typeStats[type].negCount++;
        } else {
          typeStats[type].posCount++;
        }
      }
    }
  }

  // ── Build impact table ────────────────────────────────────────────────────
  const eventTypeImpactTable = Object.entries(typeStats).map(([type, stats]) => {
    const total = stats.posCount + stats.negCount;
    const positiveImpactScore = total > 0
      ? Math.round(_clamp357((stats.posCount / total) * 100, 0, 100))
      : 0;
    const negativeImpactScore = total > 0
      ? Math.round(_clamp357((stats.negCount / total) * 100, 0, 100))
      : 0;
    const avgCoOccurrenceScore = stats.occurrences > 0
      ? Math.round(stats.totalScore / stats.occurrences)
      : 0;
    return {
      type,
      occurrences: stats.occurrences,
      positiveImpactScore,
      negativeImpactScore,
      avgCoOccurrenceScore,
      dominantImpact: positiveImpactScore >= negativeImpactScore ? 'positive' : 'negative'
    };
  }).sort((a, b) => b.occurrences - a.occurrences);

  const mostImpactfulNegativeType = eventTypeImpactTable
    .filter(e => e.dominantImpact === 'negative')
    .sort((a, b) => b.negativeImpactScore - a.negativeImpactScore)[0]?.type || null;
  const mostImpactfulPositiveType = eventTypeImpactTable
    .filter(e => e.dominantImpact === 'positive')
    .sort((a, b) => b.positiveImpactScore - a.positiveImpactScore)[0]?.type || null;

  const summary =
    `Annotation impact: ${annotationCount} annotation set(s), ` +
    `${eventTypeImpactTable.length} distinct event type(s). ` +
    `Most impactful negative: ${mostImpactfulNegativeType || 'none'}. ` +
    `Most impactful positive: ${mostImpactfulPositiveType || 'none'}.`;

  return {
    ok: true,
    impactId,
    generatedAt: ts.toISOString(),
    annotationCount,
    eventTypeImpactTable,
    mostImpactfulNegativeType,
    mostImpactfulPositiveType,
    version: HEATMAP_TREND_VERSION_357,
    summary
  };
}

/* ─── 4. forecastCalibrationDrift357 ─────────────────────────────────────── */

/**
 * forecastCalibrationDrift357(improvements, opts)
 *
 * Takes multiple V356 `recommendCalibrationImprovement356` outputs over time and
 * forecasts whether the current correction factor is converging toward zero
 * (improving calibration) or diverging (worsening). Returns a convergence
 * prediction with an estimated periods-to-stable count.
 *
 * @param {Array}  improvements - Array of V356 recommendCalibrationImprovement356 outputs
 * @param {Object} opts
 * @param {number} opts.stableThreshold    - CorrectionFactor below which calibration is stable (default 2)
 * @param {number} opts.maxForecastPeriods - Maximum forecast periods to extrapolate (default 10)
 * @returns {Object} Calibration drift forecast result
 */
function forecastCalibrationDrift357(improvements, opts = {}) {
  const ts = new Date();
  const driftId = _calibDriftId357(ts);
  const stableThreshold    = opts.stableThreshold    != null ? opts.stableThreshold    : 2;
  const maxForecastPeriods = opts.maxForecastPeriods != null ? opts.maxForecastPeriods : 10;

  if (!improvements || improvements.length === 0) {
    return {
      ok: true,
      driftForecastId: driftId,
      generatedAt: ts.toISOString(),
      observedPeriods: 0,
      correctionFactorSeries: [],
      correctionFactorSlope: null,
      convergenceStatus: 'no_data',
      estimatedPeriodsToStable: null,
      driftForecast: [],
      confidence: 'none',
      version: HEATMAP_TREND_VERSION_357,
      summary: 'No calibration improvement data provided — drift forecast unavailable.'
    };
  }

  const validImprovements = improvements.filter(r => r && r.ok && r.periodCount > 0);
  const observedPeriods = validImprovements.length;

  if (observedPeriods === 0) {
    return {
      ok: true,
      driftForecastId: driftId,
      generatedAt: ts.toISOString(),
      observedPeriods: 0,
      correctionFactorSeries: [],
      correctionFactorSlope: null,
      convergenceStatus: 'no_data',
      estimatedPeriodsToStable: null,
      driftForecast: [],
      confidence: 'none',
      version: HEATMAP_TREND_VERSION_357,
      summary: 'No valid calibration improvement periods found — drift forecast unavailable.'
    };
  }

  // ── Extract correction factor series ──────────────────────────────────────
  // Signed correction factor: positive if correctionDirection === 'increase', negative if 'decrease'
  const correctionFactorSeries = validImprovements.map(r => {
    const factor = r.correctionFactor != null ? r.correctionFactor : 0;
    if (r.correctionDirection === 'decrease') return -factor;
    if (r.correctionDirection === 'increase') return  factor;
    return 0;
  });

  const rawSlope = _slope357(correctionFactorSeries);
  const correctionFactorSlope = Math.round(rawSlope * 100) / 100;
  const lastFactor = correctionFactorSeries[correctionFactorSeries.length - 1];

  // ── Convergence status ────────────────────────────────────────────────────
  // Converging = slope and factor have opposite signs (factor moving toward 0)
  // Diverging  = slope and factor have same sign (factor moving away from 0)
  let convergenceStatus;
  const absLast = Math.abs(lastFactor);
  if (absLast <= stableThreshold) {
    convergenceStatus = 'stable';
  } else if (rawSlope === 0 || observedPeriods < 2) {
    convergenceStatus = 'unknown';
  } else {
    // If lastFactor > 0 and slope < 0 → converging (factor trending toward 0)
    // If lastFactor < 0 and slope > 0 → converging
    // If lastFactor > 0 and slope > 0 → diverging
    // If lastFactor < 0 and slope < 0 → diverging
    const sameSign = (lastFactor >= 0 && rawSlope >= 0) || (lastFactor < 0 && rawSlope < 0);
    convergenceStatus = sameSign ? 'diverging' : 'converging';
  }

  // ── Estimate periods to stable ────────────────────────────────────────────
  let estimatedPeriodsToStable = null;
  if (convergenceStatus === 'stable') {
    estimatedPeriodsToStable = 0;
  } else if (convergenceStatus === 'converging' && Math.abs(rawSlope) > 0) {
    // How many more periods until |lastFactor + slope * k| <= stableThreshold?
    // Solve: |lastFactor + slope * k| = stableThreshold → k = (stableThreshold - |lastFactor|) / slope sign
    const periodsNeeded = Math.ceil((absLast - stableThreshold) / Math.abs(rawSlope));
    estimatedPeriodsToStable = Math.max(0, Math.min(periodsNeeded, maxForecastPeriods * 2));
  }

  // ── Build drift forecast ──────────────────────────────────────────────────
  const driftForecast = [];
  for (let i = 1; i <= maxForecastPeriods; i++) {
    const forecastedFactor = lastFactor + rawSlope * i;
    const absForecasted = Math.abs(forecastedFactor);
    let forecastStatus;
    if (absForecasted <= stableThreshold) {
      forecastStatus = 'stable';
    } else if (forecastedFactor > 0) {
      forecastStatus = 'optimistic_drift';
    } else {
      forecastStatus = 'pessimistic_drift';
    }
    driftForecast.push({
      forecastPeriod: observedPeriods + i,
      expectedCorrectionFactor: Math.round(forecastedFactor * 100) / 100,
      forecastStatus
    });
    // Stop early if already stable
    if (forecastStatus === 'stable' && i >= 2) break;
  }

  // ── Confidence ────────────────────────────────────────────────────────────
  let confidence;
  if (observedPeriods >= 4) {
    confidence = 'high';
  } else if (observedPeriods >= 2) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  const summary =
    `Calibration drift forecast: ${observedPeriods} observed period(s), ` +
    `slope=${correctionFactorSlope}, convergence=${convergenceStatus}, ` +
    `estimatedPeriodsToStable=${estimatedPeriodsToStable ?? 'unknown'}, ` +
    `confidence=${confidence}.`;

  return {
    ok: true,
    driftForecastId: driftId,
    generatedAt: ts.toISOString(),
    observedPeriods,
    correctionFactorSeries,
    correctionFactorSlope,
    convergenceStatus,
    estimatedPeriodsToStable,
    driftForecast,
    confidence,
    version: HEATMAP_TREND_VERSION_357,
    summary
  };
}

/* ─── exports ─────────────────────────────────────────────────────────────── */

module.exports = {
  HEATMAP_TREND_VERSION_357,
  analyzeHeatmapTrends357,
  predictCascadePropagation357,
  scoreAnnotationImpact357,
  forecastCalibrationDrift357,
  // ID generators (exported for testing)
  _heatmapTrendId357,
  _cascadePropId357,
  _annoImpactId357,
  _calibDriftId357,
  // Internal helpers (exported for testing)
  _hashContent357,
  _clamp357,
  _mean357,
  _slope357
};
