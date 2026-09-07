'use strict';
/**
 * lib/fleetTrendClusterEngine358.js — ECOS V358 (Phase P246)
 * Fleet Trend Cluster & Cascade Wave Engine
 *
 * Extends V357 Heatmap Trend & Cascade Propagation Engine with four
 * advanced meta-analytical tools that operate on sequences of V357 outputs:
 *
 *   V357 → multi-period heatmap trend analyzer, cascade propagation predictor,
 *           annotation impact scorer, calibration drift forecaster
 *   V358 → fleet trend cluster analyzer, cascade wave detector,
 *           impact attribution matrix builder, calibration convergence tracker
 *
 * Four concrete tools:
 *
 *   1. clusterFleetTrends358      — takes multiple V357 analyzeHeatmapTrends357
 *      outputs and groups fleets into clusters by shared trajectory pattern.
 *      Returns cluster assignments, inter-cluster correlation scores, and
 *      a cluster stability index.
 *
 *   2. detectCascadeWaves358      — takes multiple V357 predictCascadePropagation357
 *      outputs (one per reporting interval) and identifies recurring wave patterns.
 *      Returns wave count, period length estimate, and a damping classification.
 *
 *   3. buildImpactAttributionMatrix358 — takes multiple V357
 *      scoreAnnotationImpact357 outputs over time and computes a longitudinal
 *      event-type attribution matrix. Returns stability score per event type
 *      and a most-changed-event-type identifier.
 *
 *   4. trackCalibrationConvergence358 — takes multiple V357
 *      forecastCalibrationDrift357 outputs over time and tracks whether the
 *      estimatedPeriodsToStable is itself converging or diverging. Returns
 *      a meta-convergence classification and a forecast for how many
 *      meta-periods until the calibration system stabilises.
 *
 * Pure / dependency-free (R3). All new public identifiers end with `358` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). Additive only (R6).
 *
 * @version 358.0.0
 */

const crypto = require('crypto');

const FLEET_TREND_CLUSTER_VERSION_358 = '358.0.0';

/* ─── internal helpers ────────────────────────────────────────────────────── */

function _clusterEngineId358(ts) {
  return 'fltclust_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _waveDetectorId358(ts) {
  return 'cscwave_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _attrMatrixId358(ts) {
  return 'impattr_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _calibTrackerId358(ts) {
  return 'calconv_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _hashContent358(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function _clamp358(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function _mean358(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function _slope358(arr) {
  if (!arr || arr.length < 2) return 0;
  const n = arr.length;
  const xMean = (n - 1) / 2;
  const yMean = _mean358(arr);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (arr[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Pearson correlation coefficient between two equal-length arrays.
 * Returns 0 if insufficient data or zero variance.
 */
function _pearsonCorr358(arrA, arrB) {
  if (!arrA || !arrB || arrA.length !== arrB.length || arrA.length < 2) return 0;
  const n = arrA.length;
  const meanA = _mean358(arrA);
  const meanB = _mean358(arrB);
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = arrA[i] - meanA;
    const db = arrB[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const denom = Math.sqrt(denA * denB);
  return denom === 0 ? 0 : num / denom;
}

/* ─── 1. clusterFleetTrends358 ───────────────────────────────────────────── */

/**
 * clusterFleetTrends358(trendAnalyses, opts)
 *
 * Takes multiple V357 `analyzeHeatmapTrends357` outputs and groups fleets into
 * clusters by shared trajectory pattern (all deteriorating together, all
 * improving together, etc.). Returns cluster assignments, inter-cluster
 * correlation scores, and a cluster stability index.
 *
 * Clustering is performed by trendClass label. Fleets sharing the same
 * trendClass across the majority of provided analyses are placed in the same
 * cluster. A correlation score (0–1) is computed for each cluster based on
 * the similarity of hotspotSlope values within the group. Stability index
 * is the fraction of fleets whose trendClass remains constant across all
 * provided analyses.
 *
 * @param {Array}  trendAnalyses - Array of V357 analyzeHeatmapTrends357 outputs
 * @param {Object} opts
 * @param {number} opts.correlationThreshold - Min Pearson |r| to merge two fleets
 *                                             into the same cluster (default 0.6)
 * @param {number} opts.majorityFraction     - Min fraction of periods a fleet must
 *                                             share a trendClass to assign that class
 *                                             (default 0.6)
 * @returns {Object} Fleet trend cluster result
 */
function clusterFleetTrends358(trendAnalyses, opts = {}) {
  const ts = new Date();
  const clusterId = _clusterEngineId358(ts);
  const correlationThreshold = opts.correlationThreshold != null ? opts.correlationThreshold : 0.6;
  const majorityFraction     = opts.majorityFraction     != null ? opts.majorityFraction     : 0.6;

  if (!trendAnalyses || trendAnalyses.length === 0) {
    return {
      ok: true,
      clusterId,
      generatedAt: ts.toISOString(),
      analysisCount: 0,
      totalFleets: 0,
      clusters: [],
      interClusterCorrelations: [],
      clusterStabilityIndex: null,
      dominantPattern: 'insufficient_data',
      version: FLEET_TREND_CLUSTER_VERSION_358,
      summary: 'No trend analyses provided — cluster analysis unavailable.'
    };
  }

  const validAnalyses = trendAnalyses.filter(a => a && a.ok);
  const analysisCount = validAnalyses.length;

  if (analysisCount === 0) {
    return {
      ok: true,
      clusterId,
      generatedAt: ts.toISOString(),
      analysisCount: 0,
      totalFleets: 0,
      clusters: [],
      interClusterCorrelations: [],
      clusterStabilityIndex: null,
      dominantPattern: 'insufficient_data',
      version: FLEET_TREND_CLUSTER_VERSION_358,
      summary: 'No valid trend analyses found — cluster analysis unavailable.'
    };
  }

  // ── Collect all fleet IDs and their trendClass + hotspotSlope per period ──
  const allFleetIds = new Set();
  for (const analysis of validAnalyses) {
    for (const ft of (analysis.fleetTrends || [])) {
      allFleetIds.add(ft.fleetId);
    }
  }

  const totalFleets = allFleetIds.size;

  if (totalFleets === 0) {
    return {
      ok: true,
      clusterId,
      generatedAt: ts.toISOString(),
      analysisCount,
      totalFleets: 0,
      clusters: [],
      interClusterCorrelations: [],
      clusterStabilityIndex: null,
      dominantPattern: 'insufficient_data',
      version: FLEET_TREND_CLUSTER_VERSION_358,
      summary: `${analysisCount} analysis/es found but no fleet data — cluster analysis unavailable.`
    };
  }

  // ── Build per-fleet feature vectors ───────────────────────────────────────
  // For each fleet: trendClass per period, hotspotSlope per period
  const fleetFeatures = {};
  for (const fleetId of allFleetIds) {
    const trendClassPerPeriod = [];
    const hotspotSlopePerPeriod = [];
    for (const analysis of validAnalyses) {
      const ft = (analysis.fleetTrends || []).find(f => f.fleetId === fleetId);
      trendClassPerPeriod.push(ft ? ft.trendClass : 'unknown');
      hotspotSlopePerPeriod.push(ft ? (ft.hotspotSlope != null ? ft.hotspotSlope : 0) : 0);
    }
    fleetFeatures[fleetId] = { trendClassPerPeriod, hotspotSlopePerPeriod };
  }

  // ── Assign dominant trendClass per fleet ──────────────────────────────────
  const TREND_CLASSES = ['improving', 'deteriorating', 'persistently_at_risk', 'stable', 'insufficient_data'];
  const fleetDominantClass = {};
  const fleetClassStable = {}; // true if same class in all periods

  for (const [fleetId, features] of Object.entries(fleetFeatures)) {
    const classes = features.trendClassPerPeriod;
    const classCounts = {};
    for (const c of classes) {
      classCounts[c] = (classCounts[c] || 0) + 1;
    }
    let dominantClass = 'unknown';
    let maxCount = 0;
    for (const [cls, count] of Object.entries(classCounts)) {
      if (count > maxCount) { maxCount = count; dominantClass = cls; }
    }
    const fraction = analysisCount > 0 ? maxCount / analysisCount : 0;
    fleetDominantClass[fleetId] = fraction >= majorityFraction ? dominantClass : 'mixed';
    fleetClassStable[fleetId] = (new Set(classes)).size === 1;
  }

  // ── Build clusters by dominant trendClass ─────────────────────────────────
  const clusterMap = {}; // { trendClass: [fleetId, ...] }
  for (const [fleetId, cls] of Object.entries(fleetDominantClass)) {
    if (!clusterMap[cls]) clusterMap[cls] = [];
    clusterMap[cls].push(fleetId);
  }

  // ── For each cluster, compute intra-cluster correlation ───────────────────
  const clusters = Object.entries(clusterMap).map(([trendClass, fleetIds]) => {
    // Intra-cluster correlation: average pairwise Pearson of hotspotSlope vectors
    let totalCorr = 0;
    let pairCount = 0;
    for (let i = 0; i < fleetIds.length; i++) {
      for (let j = i + 1; j < fleetIds.length; j++) {
        const corrVal = _pearsonCorr358(
          fleetFeatures[fleetIds[i]].hotspotSlopePerPeriod,
          fleetFeatures[fleetIds[j]].hotspotSlopePerPeriod
        );
        totalCorr += corrVal;
        pairCount++;
      }
    }
    const intraClusterCorrelation = pairCount > 0
      ? Math.round((totalCorr / pairCount) * 1000) / 1000
      : (fleetIds.length === 1 ? 1.0 : null);

    // Average hotspotSlope across all fleets in cluster (aggregated across periods)
    const allSlopes = fleetIds.flatMap(fid => fleetFeatures[fid].hotspotSlopePerPeriod);
    const avgHotspotSlope = allSlopes.length > 0
      ? Math.round(_mean358(allSlopes) * 100) / 100
      : 0;

    return {
      trendClass,
      fleetIds: [...fleetIds].sort(),
      fleetCount: fleetIds.length,
      intraClusterCorrelation,
      avgHotspotSlope
    };
  }).sort((a, b) => b.fleetCount - a.fleetCount);

  // ── Inter-cluster correlation matrix ──────────────────────────────────────
  const interClusterCorrelations = [];
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      // Centroid (mean hotspotSlope per period) for each cluster
      const centroidA = validAnalyses.map((_, pIdx) => {
        const slopes = clusters[i].fleetIds.map(fid => fleetFeatures[fid].hotspotSlopePerPeriod[pIdx] || 0);
        return _mean358(slopes) || 0;
      });
      const centroidB = validAnalyses.map((_, pIdx) => {
        const slopes = clusters[j].fleetIds.map(fid => fleetFeatures[fid].hotspotSlopePerPeriod[pIdx] || 0);
        return _mean358(slopes) || 0;
      });
      const corr = _pearsonCorr358(centroidA, centroidB);
      interClusterCorrelations.push({
        clusterA: clusters[i].trendClass,
        clusterB: clusters[j].trendClass,
        correlation: Math.round(corr * 1000) / 1000
      });
    }
  }

  // ── Cluster stability index ────────────────────────────────────────────────
  // Fraction of fleets with a stable (unchanging) trendClass across all periods
  const stableFleetCount = Object.values(fleetClassStable).filter(Boolean).length;
  const clusterStabilityIndex = totalFleets > 0
    ? Math.round((stableFleetCount / totalFleets) * 1000) / 1000
    : null;

  // ── Dominant pattern ──────────────────────────────────────────────────────
  const largestCluster = clusters[0];
  const dominantPattern = largestCluster
    ? largestCluster.trendClass
    : 'insufficient_data';

  const summary =
    `Fleet cluster analysis: ${analysisCount} analysis/es, ${totalFleets} fleet(s), ` +
    `${clusters.length} cluster(s). Dominant pattern: ${dominantPattern}. ` +
    `Stability index: ${clusterStabilityIndex != null ? clusterStabilityIndex : 'n/a'}.`;

  return {
    ok: true,
    clusterId,
    generatedAt: ts.toISOString(),
    analysisCount,
    totalFleets,
    clusters,
    interClusterCorrelations,
    clusterStabilityIndex,
    dominantPattern,
    version: FLEET_TREND_CLUSTER_VERSION_358,
    summary
  };
}

/* ─── 2. detectCascadeWaves358 ───────────────────────────────────────────── */

/**
 * detectCascadeWaves358(propagations, opts)
 *
 * Takes multiple V357 `predictCascadePropagation357` outputs (one per reporting
 * interval) and identifies recurring wave patterns — periods where convergence
 * status oscillates between converging/diverging. Returns wave count, period
 * length estimate, and a damping classification (dampening/amplifying/neutral).
 *
 * A "wave" is defined as a transition in convergenceStatus between
 * 'converging' and 'diverging' (or vice versa). The wave period is estimated
 * as the average number of intervals between successive convergence-status flips.
 * Damping is classified by comparing cascadeVelocity magnitude at the start
 * vs end of the sequence: dampening if magnitude decreasing, amplifying if
 * increasing, neutral otherwise.
 *
 * @param {Array}  propagations - Array of V357 predictCascadePropagation357 outputs (chronological)
 * @param {Object} opts
 * @param {number} opts.oscillationWindow - Min consecutive status-flip count to declare a wave (default 2)
 * @returns {Object} Cascade wave detection result
 */
function detectCascadeWaves358(propagations, opts = {}) {
  const ts = new Date();
  const waveId = _waveDetectorId358(ts);
  const oscillationWindow = opts.oscillationWindow != null ? opts.oscillationWindow : 2;

  if (!propagations || propagations.length === 0) {
    return {
      ok: true,
      waveId,
      generatedAt: ts.toISOString(),
      observedIntervals: 0,
      waveCount: 0,
      estimatedWavePeriod: null,
      dampingClassification: 'no_data',
      convergenceStatusSeries: [],
      velocitySeries: [],
      waveSegments: [],
      version: FLEET_TREND_CLUSTER_VERSION_358,
      summary: 'No propagation data provided — cascade wave detection unavailable.'
    };
  }

  const validProps = propagations.filter(p => p && p.ok);
  const observedIntervals = validProps.length;

  if (observedIntervals === 0) {
    return {
      ok: true,
      waveId,
      generatedAt: ts.toISOString(),
      observedIntervals: 0,
      waveCount: 0,
      estimatedWavePeriod: null,
      dampingClassification: 'no_data',
      convergenceStatusSeries: [],
      velocitySeries: [],
      waveSegments: [],
      version: FLEET_TREND_CLUSTER_VERSION_358,
      summary: 'No valid propagation intervals found — cascade wave detection unavailable.'
    };
  }

  // ── Extract convergenceStatus and cascadeVelocity series ─────────────────
  const convergenceStatusSeries = validProps.map(p => p.convergenceStatus || 'unknown');
  const velocitySeries = validProps.map(p =>
    p.cascadeVelocity != null ? p.cascadeVelocity : 0
  );

  // ── Detect oscillations (flips between converging ↔ diverging) ────────────
  // Only count converging/diverging flips; 'stable' is neutral and does not flip
  const activeStatuses = ['converging', 'diverging'];
  const flipIndices = [];
  let lastActiveStatus = null;

  for (let i = 0; i < convergenceStatusSeries.length; i++) {
    const status = convergenceStatusSeries[i];
    if (!activeStatuses.includes(status)) continue;
    if (lastActiveStatus !== null && status !== lastActiveStatus) {
      flipIndices.push(i);
    }
    lastActiveStatus = status;
  }

  const waveCount = Math.floor(flipIndices.length / oscillationWindow);

  // ── Estimate wave period ───────────────────────────────────────────────────
  let estimatedWavePeriod = null;
  if (flipIndices.length >= 2) {
    const gaps = [];
    for (let i = 1; i < flipIndices.length; i++) {
      gaps.push(flipIndices[i] - flipIndices[i - 1]);
    }
    estimatedWavePeriod = Math.round(_mean358(gaps) * 10) / 10;
  }

  // ── Build wave segments ───────────────────────────────────────────────────
  const waveSegments = [];
  for (let w = 0; w < waveCount; w++) {
    const startIdx = w === 0 ? 0 : flipIndices[w * oscillationWindow - 1];
    const endIdx = flipIndices[w * oscillationWindow + oscillationWindow - 1] || (observedIntervals - 1);
    const segmentStatuses = convergenceStatusSeries.slice(startIdx, endIdx + 1);
    const segmentVelocities = velocitySeries.slice(startIdx, endIdx + 1);
    const peakVelocity = segmentVelocities.reduce((max, v) => Math.abs(v) > Math.abs(max) ? v : max, 0);

    waveSegments.push({
      waveIndex: w + 1,
      startInterval: startIdx,
      endInterval: endIdx,
      length: endIdx - startIdx + 1,
      statusTransitions: segmentStatuses,
      peakCascadeVelocity: Math.round(peakVelocity * 100) / 100
    });
  }

  // ── Damping classification ─────────────────────────────────────────────────
  // Compare magnitude of velocity at start vs end of sequence
  let dampingClassification;
  if (observedIntervals < 2) {
    dampingClassification = 'insufficient_data';
  } else {
    const firstHalf = velocitySeries.slice(0, Math.ceil(observedIntervals / 2));
    const secondHalf = velocitySeries.slice(Math.floor(observedIntervals / 2));
    const firstMag = _mean358(firstHalf.map(v => Math.abs(v))) || 0;
    const secondMag = _mean358(secondHalf.map(v => Math.abs(v))) || 0;
    const magSlope = secondMag - firstMag;

    if (Math.abs(magSlope) < 0.5) {
      dampingClassification = 'neutral';
    } else if (magSlope < 0) {
      dampingClassification = 'dampening';
    } else {
      dampingClassification = 'amplifying';
    }
  }

  const summary =
    `Cascade wave detection: ${observedIntervals} interval(s), ` +
    `${flipIndices.length} status flip(s), ${waveCount} wave(s) detected. ` +
    `Estimated period: ${estimatedWavePeriod != null ? estimatedWavePeriod : 'n/a'} intervals. ` +
    `Damping: ${dampingClassification}.`;

  return {
    ok: true,
    waveId,
    generatedAt: ts.toISOString(),
    observedIntervals,
    waveCount,
    estimatedWavePeriod,
    dampingClassification,
    convergenceStatusSeries,
    velocitySeries,
    waveSegments,
    version: FLEET_TREND_CLUSTER_VERSION_358,
    summary
  };
}

/* ─── 3. buildImpactAttributionMatrix358 ─────────────────────────────────── */

/**
 * buildImpactAttributionMatrix358(impacts, opts)
 *
 * Takes multiple V357 `scoreAnnotationImpact357` outputs over time and computes
 * a longitudinal event-type attribution matrix. Shows whether each event type's
 * positive/negative impact has been consistent or shifting over time. Returns
 * stability score per event type and a most-changed-event-type identifier.
 *
 * Stability score (0–1): 1 = the event type's dominantImpact direction never
 * changed across the provided periods; lower values indicate flip-flopping.
 * Most-changed-event-type: the type with the highest variance in
 * positiveImpactScore across periods.
 *
 * @param {Array}  impacts - Array of V357 scoreAnnotationImpact357 outputs (chronological)
 * @param {Object} opts
 * @param {number} opts.minOccurrences - Min total occurrences across periods for
 *                                       an event type to appear in the matrix (default 1)
 * @returns {Object} Impact attribution matrix result
 */
function buildImpactAttributionMatrix358(impacts, opts = {}) {
  const ts = new Date();
  const matrixId = _attrMatrixId358(ts);
  const minOccurrences = opts.minOccurrences != null ? opts.minOccurrences : 1;

  if (!impacts || impacts.length === 0) {
    return {
      ok: true,
      matrixId,
      generatedAt: ts.toISOString(),
      periodCount: 0,
      attributionMatrix: [],
      mostChangedEventType: null,
      mostStableEventType: null,
      version: FLEET_TREND_CLUSTER_VERSION_358,
      summary: 'No impact data provided — attribution matrix unavailable.'
    };
  }

  const validImpacts = impacts.filter(i => i && i.ok);
  const periodCount = validImpacts.length;

  if (periodCount === 0) {
    return {
      ok: true,
      matrixId,
      generatedAt: ts.toISOString(),
      periodCount: 0,
      attributionMatrix: [],
      mostChangedEventType: null,
      mostStableEventType: null,
      version: FLEET_TREND_CLUSTER_VERSION_358,
      summary: 'No valid impact periods found — attribution matrix unavailable.'
    };
  }

  // ── Collect all event types across all periods ────────────────────────────
  const allEventTypes = new Set();
  for (const impact of validImpacts) {
    for (const entry of (impact.eventTypeImpactTable || [])) {
      if (entry.type) allEventTypes.add(entry.type);
    }
  }

  // ── Build per-type longitudinal data ──────────────────────────────────────
  const typeRows = [];
  for (const eventType of allEventTypes) {
    // Collect positiveImpactScore, negativeImpactScore, occurrences per period
    const positiveScorePerPeriod = [];
    const negativeScorePerPeriod = [];
    const occurrencesPerPeriod = [];
    const dominantImpactPerPeriod = [];
    let totalOccurrences = 0;

    for (const impact of validImpacts) {
      const entry = (impact.eventTypeImpactTable || []).find(e => e.type === eventType);
      if (entry) {
        positiveScorePerPeriod.push(entry.positiveImpactScore);
        negativeScorePerPeriod.push(entry.negativeImpactScore);
        occurrencesPerPeriod.push(entry.occurrences);
        dominantImpactPerPeriod.push(entry.dominantImpact);
        totalOccurrences += entry.occurrences;
      } else {
        positiveScorePerPeriod.push(null);
        negativeScorePerPeriod.push(null);
        occurrencesPerPeriod.push(0);
        dominantImpactPerPeriod.push(null);
      }
    }

    if (totalOccurrences < minOccurrences) continue;

    // ── Stability score: fraction of non-null periods with consistent dominantImpact
    const nonNullDominants = dominantImpactPerPeriod.filter(d => d !== null);
    const uniqueDominants = new Set(nonNullDominants);
    const stabilityScore = nonNullDominants.length > 0
      ? Math.round((1 - (uniqueDominants.size - 1) / Math.max(nonNullDominants.length, 1)) * 1000) / 1000
      : null;

    // ── Variance in positiveImpactScore across periods (for most-changed detection)
    const validPosScores = positiveScorePerPeriod.filter(s => s !== null);
    let posScoreVariance = 0;
    if (validPosScores.length >= 2) {
      const mean = _mean358(validPosScores);
      posScoreVariance = validPosScores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / validPosScores.length;
    }

    // ── Trend of positiveImpactScore across periods
    const posScoreSlope = _slope358(validPosScores);

    // ── Current dominant impact (from most recent period with data)
    const lastNonNull = [...dominantImpactPerPeriod].reverse().find(d => d !== null);
    const currentDominantImpact = lastNonNull || null;

    typeRows.push({
      eventType,
      totalOccurrences,
      positiveScorePerPeriod,
      negativeScorePerPeriod,
      occurrencesPerPeriod,
      dominantImpactPerPeriod,
      currentDominantImpact,
      posScoreSlope: Math.round(posScoreSlope * 100) / 100,
      posScoreVariance: Math.round(posScoreVariance * 100) / 100,
      stabilityScore
    });
  }

  // Sort by totalOccurrences descending
  typeRows.sort((a, b) => b.totalOccurrences - a.totalOccurrences);

  // ── Most-changed and most-stable event types ───────────────────────────────
  const rowsWithVariance = typeRows.filter(r => r.posScoreVariance != null);
  let mostChangedEventType = null;
  let mostStableEventType = null;

  if (rowsWithVariance.length > 0) {
    mostChangedEventType = rowsWithVariance
      .sort((a, b) => b.posScoreVariance - a.posScoreVariance)[0].eventType;
    // Re-sort for stable
    mostStableEventType = rowsWithVariance
      .filter(r => r.stabilityScore != null)
      .sort((a, b) => b.stabilityScore - a.stabilityScore)[0]?.eventType || null;
    // Restore sort
    typeRows.sort((a, b) => b.totalOccurrences - a.totalOccurrences);
  }

  const summary =
    `Impact attribution matrix: ${periodCount} period(s), ` +
    `${typeRows.length} event type(s) tracked. ` +
    `Most changed: ${mostChangedEventType || 'none'}. ` +
    `Most stable: ${mostStableEventType || 'none'}.`;

  return {
    ok: true,
    matrixId,
    generatedAt: ts.toISOString(),
    periodCount,
    attributionMatrix: typeRows,
    mostChangedEventType,
    mostStableEventType,
    version: FLEET_TREND_CLUSTER_VERSION_358,
    summary
  };
}

/* ─── 4. trackCalibrationConvergence358 ─────────────────────────────────── */

/**
 * trackCalibrationConvergence358(driftForecasts, opts)
 *
 * Takes multiple V357 `forecastCalibrationDrift357` outputs over time and tracks
 * whether the estimatedPeriodsToStable is itself converging (improving) or
 * diverging (worsening). Returns a meta-convergence classification and a
 * forecast for how many meta-periods until the calibration system stabilises.
 *
 * Meta-convergence = the trend of estimatedPeriodsToStable over time:
 *   - meta_converging    → estimatedPeriodsToStable decreasing over time
 *   - meta_diverging     → estimatedPeriodsToStable increasing over time
 *   - meta_stable        → estimatedPeriodsToStable not changing significantly
 *   - already_stable     → all provided periods already show stable convergenceStatus
 *   - insufficient_data  → fewer than 2 valid periods
 *
 * @param {Array}  driftForecasts - Array of V357 forecastCalibrationDrift357 outputs (chronological)
 * @param {Object} opts
 * @param {number} opts.metaSlopeThreshold - Min absolute slope of estimatedPeriodsToStable
 *                                           to classify as meta_converging/diverging (default 0.5)
 * @param {number} opts.metaForecastPeriods - Number of meta-periods to forecast ahead (default 5)
 * @returns {Object} Calibration convergence tracking result
 */
function trackCalibrationConvergence358(driftForecasts, opts = {}) {
  const ts = new Date();
  const trackerId = _calibTrackerId358(ts);
  const metaSlopeThreshold  = opts.metaSlopeThreshold  != null ? opts.metaSlopeThreshold  : 0.5;
  const metaForecastPeriods = opts.metaForecastPeriods != null ? opts.metaForecastPeriods : 5;

  if (!driftForecasts || driftForecasts.length === 0) {
    return {
      ok: true,
      trackerId,
      generatedAt: ts.toISOString(),
      observedMetaPeriods: 0,
      estimatedPeriodsToStableSeries: [],
      metaConvergenceSlope: null,
      metaConvergenceStatus: 'insufficient_data',
      estimatedMetaPeriodsToStable: null,
      metaForecast: [],
      confidence: 'none',
      version: FLEET_TREND_CLUSTER_VERSION_358,
      summary: 'No drift forecast data provided — calibration convergence tracking unavailable.'
    };
  }

  const validForecasts = driftForecasts.filter(f => f && f.ok);
  const observedMetaPeriods = validForecasts.length;

  if (observedMetaPeriods === 0) {
    return {
      ok: true,
      trackerId,
      generatedAt: ts.toISOString(),
      observedMetaPeriods: 0,
      estimatedPeriodsToStableSeries: [],
      metaConvergenceSlope: null,
      metaConvergenceStatus: 'insufficient_data',
      estimatedMetaPeriodsToStable: null,
      metaForecast: [],
      confidence: 'none',
      version: FLEET_TREND_CLUSTER_VERSION_358,
      summary: 'No valid drift forecasts found — calibration convergence tracking unavailable.'
    };
  }

  // ── Extract estimatedPeriodsToStable series ───────────────────────────────
  // Treat null (unknown convergence) as a high sentinel value for divergence tracking
  const UNKNOWN_SENTINEL = 999;
  const estimatedPeriodsToStableSeries = validForecasts.map(f => {
    if (f.convergenceStatus === 'stable') return 0;
    if (f.estimatedPeriodsToStable != null) return f.estimatedPeriodsToStable;
    return UNKNOWN_SENTINEL;
  });

  // ── Check if already stable in all periods ────────────────────────────────
  const allStable = validForecasts.every(f => f.convergenceStatus === 'stable');
  if (allStable) {
    return {
      ok: true,
      trackerId,
      generatedAt: ts.toISOString(),
      observedMetaPeriods,
      estimatedPeriodsToStableSeries: estimatedPeriodsToStableSeries,
      metaConvergenceSlope: 0,
      metaConvergenceStatus: 'already_stable',
      estimatedMetaPeriodsToStable: 0,
      metaForecast: [],
      confidence: observedMetaPeriods >= 4 ? 'high' : observedMetaPeriods >= 2 ? 'medium' : 'low',
      version: FLEET_TREND_CLUSTER_VERSION_358,
      summary: `Calibration convergence tracker: all ${observedMetaPeriods} period(s) already stable.`
    };
  }

  if (observedMetaPeriods < 2) {
    return {
      ok: true,
      trackerId,
      generatedAt: ts.toISOString(),
      observedMetaPeriods,
      estimatedPeriodsToStableSeries,
      metaConvergenceSlope: null,
      metaConvergenceStatus: 'insufficient_data',
      estimatedMetaPeriodsToStable: null,
      metaForecast: [],
      confidence: 'none',
      version: FLEET_TREND_CLUSTER_VERSION_358,
      summary: 'Only 1 valid drift forecast — need ≥2 for meta-convergence analysis.'
    };
  }

  // ── Use only non-sentinel values for slope computation ───────────────────
  const realSeries = estimatedPeriodsToStableSeries.filter(v => v !== UNKNOWN_SENTINEL);
  const rawMetaSlope = realSeries.length >= 2 ? _slope358(realSeries) : _slope358(estimatedPeriodsToStableSeries);
  const metaConvergenceSlope = Math.round(rawMetaSlope * 100) / 100;

  // ── Meta convergence status ───────────────────────────────────────────────
  // Negative slope = estimatedPeriodsToStable decreasing = meta_converging (good)
  // Positive slope = increasing = meta_diverging (bad)
  let metaConvergenceStatus;
  if (rawMetaSlope <= -metaSlopeThreshold) {
    metaConvergenceStatus = 'meta_converging';
  } else if (rawMetaSlope >= metaSlopeThreshold) {
    metaConvergenceStatus = 'meta_diverging';
  } else {
    metaConvergenceStatus = 'meta_stable';
  }

  // ── Estimate meta-periods until stable ────────────────────────────────────
  let estimatedMetaPeriodsToStable = null;
  const lastValue = estimatedPeriodsToStableSeries[estimatedPeriodsToStableSeries.length - 1];
  if (metaConvergenceStatus === 'meta_converging' && rawMetaSlope !== 0 && lastValue !== UNKNOWN_SENTINEL) {
    estimatedMetaPeriodsToStable = Math.max(0, Math.ceil(lastValue / Math.abs(rawMetaSlope)));
  } else if (metaConvergenceStatus === 'already_stable') {
    estimatedMetaPeriodsToStable = 0;
  }

  // ── Meta forecast ─────────────────────────────────────────────────────────
  const metaForecast = [];
  const baseValue = lastValue !== UNKNOWN_SENTINEL ? lastValue : (realSeries[realSeries.length - 1] || 0);
  for (let i = 1; i <= metaForecastPeriods; i++) {
    const forecasted = Math.max(0, baseValue + rawMetaSlope * i);
    const forecastedRounded = Math.round(forecasted * 10) / 10;
    let forecastStatus;
    if (forecastedRounded === 0) {
      forecastStatus = 'stable';
    } else if (forecastedRounded <= 2) {
      forecastStatus = 'near_stable';
    } else if (rawMetaSlope < 0) {
      forecastStatus = 'improving';
    } else {
      forecastStatus = 'worsening';
    }
    metaForecast.push({
      metaPeriod: observedMetaPeriods + i,
      forecastedPeriodsToStable: forecastedRounded,
      forecastStatus
    });
    if (forecastedRounded === 0) break;
  }

  // ── Confidence ────────────────────────────────────────────────────────────
  let confidence;
  if (observedMetaPeriods >= 4) {
    confidence = 'high';
  } else if (observedMetaPeriods >= 2) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  const summary =
    `Calibration convergence tracker: ${observedMetaPeriods} meta-period(s), ` +
    `meta-slope=${metaConvergenceSlope}, status=${metaConvergenceStatus}, ` +
    `estimatedMetaPeriodsToStable=${estimatedMetaPeriodsToStable != null ? estimatedMetaPeriodsToStable : 'unknown'}, ` +
    `confidence=${confidence}.`;

  return {
    ok: true,
    trackerId,
    generatedAt: ts.toISOString(),
    observedMetaPeriods,
    estimatedPeriodsToStableSeries,
    metaConvergenceSlope,
    metaConvergenceStatus,
    estimatedMetaPeriodsToStable,
    metaForecast,
    confidence,
    version: FLEET_TREND_CLUSTER_VERSION_358,
    summary
  };
}

/* ─── exports ─────────────────────────────────────────────────────────────── */

module.exports = {
  FLEET_TREND_CLUSTER_VERSION_358,
  clusterFleetTrends358,
  detectCascadeWaves358,
  buildImpactAttributionMatrix358,
  trackCalibrationConvergence358,
  // ID generators (exported for testing)
  _clusterEngineId358,
  _waveDetectorId358,
  _attrMatrixId358,
  _calibTrackerId358,
  // Internal helpers (exported for testing)
  _hashContent358,
  _clamp358,
  _mean358,
  _slope358,
  _pearsonCorr358
};
