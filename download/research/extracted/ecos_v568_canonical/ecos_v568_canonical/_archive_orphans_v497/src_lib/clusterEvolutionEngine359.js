'use strict';
/**
 * lib/clusterEvolutionEngine359.js — ECOS V359 (Phase P247)
 * Cluster Evolution & Wave Amplitude Engine
 *
 * Extends V358 Fleet Trend Cluster & Cascade Wave Engine with four
 * advanced meta-analytical tools that operate on sequences of V358 outputs:
 *
 *   V358 → fleet trend cluster analyzer, cascade wave detector,
 *           impact attribution matrix builder, calibration convergence tracker
 *   V359 → cluster evolution tracker, wave amplitude analyzer,
 *           attribution drift detector, meta-convergence stabilizer
 *
 * Four concrete tools:
 *
 *   1. trackClusterEvolution359    — takes multiple V358 clusterFleetTrends358
 *      outputs over time and tracks how cluster membership changes. Returns
 *      a cluster migration matrix, cluster churn rate, and a dominant trajectory
 *      (are fleets generally moving toward improving or deteriorating clusters).
 *
 *   2. analyzeWaveAmplitude359     — takes multiple V358 detectCascadeWaves358
 *      outputs over time and measures whether wave amplitude (peak velocity per
 *      wave) is growing or shrinking. Returns amplitude trend (growing/shrinking/
 *      stable), peak-to-peak ratio series, and a wave energy classification
 *      (high/medium/low based on mean amplitude).
 *
 *   3. detectAttributionDrift359   — takes multiple V358 buildImpactAttributionMatrix358
 *      outputs over time and identifies whether the most impactful event types
 *      are shifting. Returns a type emergence score, a type fade score, and a
 *      structural change classification (stable/evolving/disrupted).
 *
 *   4. assessMetaConvergenceStability359 — takes multiple V358
 *      trackCalibrationConvergence358 outputs over time and assesses whether the
 *      meta-convergence process is itself stable, oscillating, or trending toward
 *      permanent divergence. Returns a meta-stability classification and an
 *      estimated periods-to-meta-stable count.
 *
 * Pure / dependency-free (R3). All new public identifiers end with `359` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). Additive only (R6).
 *
 * @version 359.0.0
 */

const crypto = require('crypto');

const CLUSTER_EVOLUTION_VERSION_359 = '359.0.0';

/* ─── internal helpers ────────────────────────────────────────────────────── */

function _clusterEvolutionId359(ts) {
  return 'clsevo_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _waveAmplitudeId359(ts) {
  return 'wvamp_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _attrDriftId359(ts) {
  return 'attdrift_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _metaStabilityId359(ts) {
  return 'metastab_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _hashContent359(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function _clamp359(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function _mean359(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function _slope359(arr) {
  if (!arr || arr.length < 2) return 0;
  const n = arr.length;
  const xMean = (n - 1) / 2;
  const yMean = _mean359(arr);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (arr[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function _pearsonCorr359(arrA, arrB) {
  if (!arrA || !arrB || arrA.length !== arrB.length || arrA.length < 2) return 0;
  const n = arrA.length;
  const meanA = _mean359(arrA);
  const meanB = _mean359(arrB);
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

/* ─── 1. trackClusterEvolution359 ───────────────────────────────────────── */

/**
 * trackClusterEvolution359(clusterResults, opts)
 *
 * Takes multiple V358 `clusterFleetTrends358` outputs over time and tracks how
 * cluster membership changes period-over-period. Returns a cluster migration
 * matrix (how many fleets moved from cluster A to cluster B between consecutive
 * periods), a cluster churn rate (fraction of fleets that changed cluster
 * assignment between any two consecutive periods), and a dominant trajectory
 * (are fleets generally moving toward improving or deteriorating clusters).
 *
 * @param {Array}  clusterResults - Array of V358 clusterFleetTrends358 outputs (chronological)
 * @param {Object} opts
 * @param {number} opts.churnThreshold - Min fraction of fleet moves to classify
 *                                       as high_churn vs low_churn (default 0.3)
 * @returns {Object} Cluster evolution result
 */
function trackClusterEvolution359(clusterResults, opts = {}) {
  const ts = new Date();
  const evolutionId = _clusterEvolutionId359(ts);
  const churnThreshold = opts.churnThreshold != null ? opts.churnThreshold : 0.3;

  if (!clusterResults || clusterResults.length === 0) {
    return {
      ok: true,
      evolutionId,
      generatedAt: ts.toISOString(),
      periodCount: 0,
      totalFleets: 0,
      migrationMatrix: [],
      clusterChurnRate: null,
      churnClassification: 'no_data',
      dominantTrajectory: 'insufficient_data',
      trajectoryConfidence: 'none',
      version: CLUSTER_EVOLUTION_VERSION_359,
      summary: 'No cluster results provided — evolution tracking unavailable.'
    };
  }

  const validResults = clusterResults.filter(r => r && r.ok);
  const periodCount = validResults.length;

  if (periodCount < 2) {
    return {
      ok: true,
      evolutionId,
      generatedAt: ts.toISOString(),
      periodCount,
      totalFleets: periodCount === 1 ? (validResults[0].totalFleets || 0) : 0,
      migrationMatrix: [],
      clusterChurnRate: null,
      churnClassification: 'insufficient_data',
      dominantTrajectory: 'insufficient_data',
      trajectoryConfidence: 'none',
      version: CLUSTER_EVOLUTION_VERSION_359,
      summary: `Only ${periodCount} valid cluster result(s) — need ≥2 for evolution tracking.`
    };
  }

  // ── Build per-fleet cluster assignment per period ─────────────────────────
  const allFleetIds = new Set();
  for (const result of validResults) {
    for (const cluster of (result.clusters || [])) {
      for (const fleetId of (cluster.fleetIds || [])) {
        allFleetIds.add(fleetId);
      }
    }
  }

  const totalFleets = allFleetIds.size;

  // fleetAssignments[fleetId] = [clusterClass in period 0, period 1, ...]
  const fleetAssignments = {};
  for (const fleetId of allFleetIds) {
    fleetAssignments[fleetId] = validResults.map(result => {
      for (const cluster of (result.clusters || [])) {
        if ((cluster.fleetIds || []).includes(fleetId)) return cluster.trendClass;
      }
      return null; // fleet not present in this period
    });
  }

  // ── Build migration matrix across consecutive period pairs ────────────────
  // migrationMatrix: [{ fromPeriod, toPeriod, fromClass, toClass, fleetCount }]
  const migrationCounts = {}; // key: `${fromClass}->${toClass}`
  let totalMovingFleets = 0;
  let totalComparedFleets = 0;

  for (let p = 0; p < periodCount - 1; p++) {
    for (const fleetId of allFleetIds) {
      const fromClass = fleetAssignments[fleetId][p];
      const toClass   = fleetAssignments[fleetId][p + 1];
      if (fromClass === null || toClass === null) continue;
      totalComparedFleets++;
      const key = `${fromClass}->${toClass}`;
      migrationCounts[key] = (migrationCounts[key] || 0) + 1;
      if (fromClass !== toClass) totalMovingFleets++;
    }
  }

  // Flatten into array sorted by fleetCount desc
  const migrationMatrix = Object.entries(migrationCounts)
    .map(([key, fleetCount]) => {
      const [fromClass, toClass] = key.split('->');
      return { fromClass, toClass, fleetCount };
    })
    .sort((a, b) => b.fleetCount - a.fleetCount);

  // ── Cluster churn rate ────────────────────────────────────────────────────
  const clusterChurnRate = totalComparedFleets > 0
    ? Math.round((totalMovingFleets / totalComparedFleets) * 1000) / 1000
    : null;

  const churnClassification = clusterChurnRate === null
    ? 'no_data'
    : clusterChurnRate >= churnThreshold
      ? 'high_churn'
      : 'low_churn';

  // ── Dominant trajectory ───────────────────────────────────────────────────
  // Positive = fleets moving toward 'improving'; negative = toward 'deteriorating'
  const POSITIVE_CLASSES = new Set(['improving', 'stable']);
  const NEGATIVE_CLASSES = new Set(['deteriorating', 'persistently_at_risk']);

  let positiveMovements = 0;
  let negativeMovements = 0;

  for (const { fromClass, toClass, fleetCount } of migrationMatrix) {
    if (fromClass === toClass) continue;
    const toPositive = POSITIVE_CLASSES.has(toClass);
    const toNegative = NEGATIVE_CLASSES.has(toClass);
    if (toPositive) positiveMovements += fleetCount;
    if (toNegative) negativeMovements += fleetCount;
  }

  let dominantTrajectory;
  let trajectoryConfidence;
  const totalDirectional = positiveMovements + negativeMovements;

  if (totalDirectional === 0) {
    dominantTrajectory = 'stable';
    trajectoryConfidence = periodCount >= 4 ? 'high' : 'medium';
  } else if (positiveMovements > negativeMovements * 1.5) {
    dominantTrajectory = 'improving';
    trajectoryConfidence = periodCount >= 4 ? 'high' : 'medium';
  } else if (negativeMovements > positiveMovements * 1.5) {
    dominantTrajectory = 'deteriorating';
    trajectoryConfidence = periodCount >= 4 ? 'high' : 'medium';
  } else {
    dominantTrajectory = 'mixed';
    trajectoryConfidence = 'low';
  }

  const summary =
    `Cluster evolution: ${periodCount} period(s), ${totalFleets} fleet(s). ` +
    `Churn rate: ${clusterChurnRate != null ? clusterChurnRate : 'n/a'} (${churnClassification}). ` +
    `Dominant trajectory: ${dominantTrajectory} (confidence: ${trajectoryConfidence}).`;

  return {
    ok: true,
    evolutionId,
    generatedAt: ts.toISOString(),
    periodCount,
    totalFleets,
    migrationMatrix,
    clusterChurnRate,
    churnClassification,
    dominantTrajectory,
    trajectoryConfidence,
    version: CLUSTER_EVOLUTION_VERSION_359,
    summary
  };
}

/* ─── 2. analyzeWaveAmplitude359 ─────────────────────────────────────────── */

/**
 * analyzeWaveAmplitude359(waveResults, opts)
 *
 * Takes multiple V358 `detectCascadeWaves358` outputs over time and measures
 * whether wave amplitude (peak velocity per wave) is growing or shrinking.
 * Returns amplitude trend (growing/shrinking/stable), peak-to-peak ratio
 * series (each entry is the ratio of consecutive peak velocities), and a wave
 * energy classification (high/medium/low based on mean amplitude).
 *
 * @param {Array}  waveResults - Array of V358 detectCascadeWaves358 outputs (chronological)
 * @param {Object} opts
 * @param {number} opts.amplitudeSlopeThreshold - Min absolute slope to classify
 *                                                as growing/shrinking (default 0.5)
 * @param {number} opts.highEnergyThreshold     - Mean amplitude above which
 *                                                classification is 'high' (default 5.0)
 * @param {number} opts.lowEnergyThreshold      - Mean amplitude below which
 *                                                classification is 'low' (default 1.0)
 * @returns {Object} Wave amplitude analysis result
 */
function analyzeWaveAmplitude359(waveResults, opts = {}) {
  const ts = new Date();
  const amplitudeId = _waveAmplitudeId359(ts);
  const amplitudeSlopeThreshold = opts.amplitudeSlopeThreshold != null ? opts.amplitudeSlopeThreshold : 0.5;
  const highEnergyThreshold     = opts.highEnergyThreshold     != null ? opts.highEnergyThreshold     : 5.0;
  const lowEnergyThreshold      = opts.lowEnergyThreshold      != null ? opts.lowEnergyThreshold      : 1.0;

  if (!waveResults || waveResults.length === 0) {
    return {
      ok: true,
      amplitudeId,
      generatedAt: ts.toISOString(),
      periodCount: 0,
      peakAmplitudeSeries: [],
      peakToPeakRatioSeries: [],
      amplitudeSlope: null,
      amplitudeTrend: 'no_data',
      meanAmplitude: null,
      waveEnergyClassification: 'no_data',
      version: CLUSTER_EVOLUTION_VERSION_359,
      summary: 'No wave results provided — amplitude analysis unavailable.'
    };
  }

  const validResults = waveResults.filter(r => r && r.ok);
  const periodCount = validResults.length;

  if (periodCount === 0) {
    return {
      ok: true,
      amplitudeId,
      generatedAt: ts.toISOString(),
      periodCount: 0,
      peakAmplitudeSeries: [],
      peakToPeakRatioSeries: [],
      amplitudeSlope: null,
      amplitudeTrend: 'no_data',
      meanAmplitude: null,
      waveEnergyClassification: 'no_data',
      version: CLUSTER_EVOLUTION_VERSION_359,
      summary: 'No valid wave results found — amplitude analysis unavailable.'
    };
  }

  // ── Extract peak amplitude per period ─────────────────────────────────────
  // Peak amplitude = max |peakCascadeVelocity| across all waveSegments in the period
  const peakAmplitudeSeries = validResults.map(result => {
    const segments = result.waveSegments || [];
    if (segments.length === 0) return 0;
    return Math.max(...segments.map(s => Math.abs(s.peakCascadeVelocity || 0)));
  });

  // ── Peak-to-peak ratio series ──────────────────────────────────────────────
  // ratio[i] = peakAmplitude[i+1] / peakAmplitude[i]; null if denominator is 0
  const peakToPeakRatioSeries = [];
  for (let i = 0; i < peakAmplitudeSeries.length - 1; i++) {
    const prev = peakAmplitudeSeries[i];
    const curr = peakAmplitudeSeries[i + 1];
    if (prev === 0) {
      peakToPeakRatioSeries.push(null);
    } else {
      peakToPeakRatioSeries.push(Math.round((curr / prev) * 1000) / 1000);
    }
  }

  // ── Amplitude trend ───────────────────────────────────────────────────────
  let amplitudeSlope = null;
  let amplitudeTrend;

  if (periodCount < 2) {
    amplitudeTrend = 'insufficient_data';
  } else {
    const rawSlope = _slope359(peakAmplitudeSeries);
    amplitudeSlope = Math.round(rawSlope * 100) / 100;
    if (Math.abs(rawSlope) < amplitudeSlopeThreshold) {
      amplitudeTrend = 'stable';
    } else if (rawSlope > 0) {
      amplitudeTrend = 'growing';
    } else {
      amplitudeTrend = 'shrinking';
    }
  }

  // ── Wave energy classification ────────────────────────────────────────────
  const meanAmplitude = _mean359(peakAmplitudeSeries);
  let waveEnergyClassification;

  if (meanAmplitude === null) {
    waveEnergyClassification = 'no_data';
  } else if (meanAmplitude >= highEnergyThreshold) {
    waveEnergyClassification = 'high';
  } else if (meanAmplitude <= lowEnergyThreshold) {
    waveEnergyClassification = 'low';
  } else {
    waveEnergyClassification = 'medium';
  }

  const meanAmplitudeRounded = meanAmplitude != null ? Math.round(meanAmplitude * 100) / 100 : null;

  const summary =
    `Wave amplitude analysis: ${periodCount} period(s). ` +
    `Amplitude trend: ${amplitudeTrend} (slope: ${amplitudeSlope != null ? amplitudeSlope : 'n/a'}). ` +
    `Mean amplitude: ${meanAmplitudeRounded != null ? meanAmplitudeRounded : 'n/a'}. ` +
    `Energy: ${waveEnergyClassification}.`;

  return {
    ok: true,
    amplitudeId,
    generatedAt: ts.toISOString(),
    periodCount,
    peakAmplitudeSeries,
    peakToPeakRatioSeries,
    amplitudeSlope,
    amplitudeTrend,
    meanAmplitude: meanAmplitudeRounded,
    waveEnergyClassification,
    version: CLUSTER_EVOLUTION_VERSION_359,
    summary
  };
}

/* ─── 3. detectAttributionDrift359 ──────────────────────────────────────── */

/**
 * detectAttributionDrift359(matrixResults, opts)
 *
 * Takes multiple V358 `buildImpactAttributionMatrix358` outputs over time and
 * identifies whether the most impactful event types are shifting — new types
 * emerging, old types fading. Returns a type emergence score, a type fade score,
 * and a structural change classification (stable/evolving/disrupted).
 *
 * Emergence score: fraction of event types in the most recent period that were
 *   absent from the first period (entirely new entrants).
 * Fade score: fraction of event types from the first period absent from the most
 *   recent period (completely dropped out).
 * Structural change classification:
 *   - 'stable'    → emergence + fade < stableThreshold
 *   - 'evolving'  → emergence + fade in [stableThreshold, disruptedThreshold)
 *   - 'disrupted' → emergence + fade >= disruptedThreshold
 *
 * @param {Array}  matrixResults - Array of V358 buildImpactAttributionMatrix358 outputs (chronological)
 * @param {Object} opts
 * @param {number} opts.stableThreshold    - Max combined emergence+fade for 'stable' (default 0.2)
 * @param {number} opts.disruptedThreshold - Min combined emergence+fade for 'disrupted' (default 0.5)
 * @returns {Object} Attribution drift result
 */
function detectAttributionDrift359(matrixResults, opts = {}) {
  const ts = new Date();
  const driftId = _attrDriftId359(ts);
  const stableThreshold    = opts.stableThreshold    != null ? opts.stableThreshold    : 0.2;
  const disruptedThreshold = opts.disruptedThreshold != null ? opts.disruptedThreshold : 0.5;

  if (!matrixResults || matrixResults.length === 0) {
    return {
      ok: true,
      driftId,
      generatedAt: ts.toISOString(),
      periodCount: 0,
      typeEmergenceScore: null,
      typeFadeScore: null,
      emergingTypes: [],
      fadingTypes: [],
      persistentTypes: [],
      structuralChangeClassification: 'no_data',
      version: CLUSTER_EVOLUTION_VERSION_359,
      summary: 'No matrix results provided — attribution drift detection unavailable.'
    };
  }

  const validResults = matrixResults.filter(r => r && r.ok);
  const periodCount = validResults.length;

  if (periodCount < 2) {
    return {
      ok: true,
      driftId,
      generatedAt: ts.toISOString(),
      periodCount,
      typeEmergenceScore: null,
      typeFadeScore: null,
      emergingTypes: [],
      fadingTypes: [],
      persistentTypes: [],
      structuralChangeClassification: 'insufficient_data',
      version: CLUSTER_EVOLUTION_VERSION_359,
      summary: `Only ${periodCount} valid matrix result(s) — need ≥2 for drift detection.`
    };
  }

  // ── Collect event types in first and last period ──────────────────────────
  const firstTypes = new Set(
    (validResults[0].attributionMatrix || []).map(r => r.eventType)
  );
  const lastTypes = new Set(
    (validResults[periodCount - 1].attributionMatrix || []).map(r => r.eventType)
  );

  const emergingTypes = [...lastTypes].filter(t => !firstTypes.has(t));
  const fadingTypes   = [...firstTypes].filter(t => !lastTypes.has(t));
  const persistentTypes = [...firstTypes].filter(t => lastTypes.has(t));

  // ── Emergence and fade scores ─────────────────────────────────────────────
  const totalLastTypes  = lastTypes.size;
  const totalFirstTypes = firstTypes.size;

  const typeEmergenceScore = totalLastTypes > 0
    ? Math.round((emergingTypes.length / totalLastTypes) * 1000) / 1000
    : 0;

  const typeFadeScore = totalFirstTypes > 0
    ? Math.round((fadingTypes.length / totalFirstTypes) * 1000) / 1000
    : 0;

  // ── Structural change classification ──────────────────────────────────────
  const combinedScore = typeEmergenceScore + typeFadeScore;
  let structuralChangeClassification;

  if (combinedScore < stableThreshold) {
    structuralChangeClassification = 'stable';
  } else if (combinedScore < disruptedThreshold) {
    structuralChangeClassification = 'evolving';
  } else {
    structuralChangeClassification = 'disrupted';
  }

  const summary =
    `Attribution drift: ${periodCount} period(s). ` +
    `Emergence score: ${typeEmergenceScore}, fade score: ${typeFadeScore}. ` +
    `${emergingTypes.length} emerging type(s), ${fadingTypes.length} fading type(s). ` +
    `Classification: ${structuralChangeClassification}.`;

  return {
    ok: true,
    driftId,
    generatedAt: ts.toISOString(),
    periodCount,
    typeEmergenceScore,
    typeFadeScore,
    emergingTypes: emergingTypes.sort(),
    fadingTypes: fadingTypes.sort(),
    persistentTypes: persistentTypes.sort(),
    structuralChangeClassification,
    version: CLUSTER_EVOLUTION_VERSION_359,
    summary
  };
}

/* ─── 4. assessMetaConvergenceStability359 ───────────────────────────────── */

/**
 * assessMetaConvergenceStability359(trackerResults, opts)
 *
 * Takes multiple V358 `trackCalibrationConvergence358` outputs over time and
 * assesses whether the meta-convergence process is itself stable (meta_converging
 * in most periods), oscillating (alternating meta_converging/meta_diverging), or
 * trending toward permanent divergence. Returns a meta-stability classification
 * and an estimated periods-to-meta-stable count.
 *
 * Meta-stability classification:
 *   - 'stable'             → all observed meta-statuses are meta_converging or already_stable
 *   - 'oscillating'        → alternates between meta_converging and meta_diverging
 *   - 'permanently_diverging' → majority of periods are meta_diverging
 *   - 'insufficient_data'  → fewer than 2 valid periods
 *
 * @param {Array}  trackerResults - Array of V358 trackCalibrationConvergence358 outputs (chronological)
 * @param {Object} opts
 * @param {number} opts.oscillationThreshold - Min flip fraction to classify as oscillating (default 0.3)
 * @param {number} opts.divergenceThreshold  - Min diverging fraction to classify as permanently_diverging (default 0.5)
 * @returns {Object} Meta-convergence stability assessment result
 */
function assessMetaConvergenceStability359(trackerResults, opts = {}) {
  const ts = new Date();
  const stabilityId = _metaStabilityId359(ts);
  const oscillationThreshold = opts.oscillationThreshold != null ? opts.oscillationThreshold : 0.3;
  const divergenceThreshold  = opts.divergenceThreshold  != null ? opts.divergenceThreshold  : 0.5;

  if (!trackerResults || trackerResults.length === 0) {
    return {
      ok: true,
      stabilityId,
      generatedAt: ts.toISOString(),
      periodCount: 0,
      metaStatusSeries: [],
      convergingFraction: null,
      divergingFraction: null,
      flipCount: 0,
      flipFraction: null,
      metaStabilityClassification: 'no_data',
      estimatedPeriodsToMetaStable: null,
      version: CLUSTER_EVOLUTION_VERSION_359,
      summary: 'No tracker results provided — meta-convergence stability assessment unavailable.'
    };
  }

  const validResults = trackerResults.filter(r => r && r.ok);
  const periodCount = validResults.length;

  if (periodCount < 2) {
    return {
      ok: true,
      stabilityId,
      generatedAt: ts.toISOString(),
      periodCount,
      metaStatusSeries: periodCount === 1 ? [validResults[0].metaConvergenceStatus] : [],
      convergingFraction: null,
      divergingFraction: null,
      flipCount: 0,
      flipFraction: null,
      metaStabilityClassification: 'insufficient_data',
      estimatedPeriodsToMetaStable: null,
      version: CLUSTER_EVOLUTION_VERSION_359,
      summary: `Only ${periodCount} valid tracker result(s) — need ≥2 for stability assessment.`
    };
  }

  // ── Extract meta-status series ────────────────────────────────────────────
  const metaStatusSeries = validResults.map(r => r.metaConvergenceStatus || 'unknown');

  // ── Count converging / diverging fractions ────────────────────────────────
  const CONVERGING = new Set(['meta_converging', 'already_stable', 'meta_stable']);
  const DIVERGING  = new Set(['meta_diverging']);

  let convergingCount = 0;
  let divergingCount  = 0;
  for (const status of metaStatusSeries) {
    if (CONVERGING.has(status)) convergingCount++;
    if (DIVERGING.has(status))  divergingCount++;
  }

  const convergingFraction = Math.round((convergingCount / periodCount) * 1000) / 1000;
  const divergingFraction  = Math.round((divergingCount  / periodCount) * 1000) / 1000;

  // ── Count flips (transitions between converging ↔ diverging) ─────────────
  let flipCount = 0;
  let lastActiveStatus = null;
  for (const status of metaStatusSeries) {
    const isConverging = CONVERGING.has(status);
    const isDiverging  = DIVERGING.has(status);
    if (!isConverging && !isDiverging) continue;
    const bucket = isConverging ? 'converging' : 'diverging';
    if (lastActiveStatus !== null && bucket !== lastActiveStatus) flipCount++;
    lastActiveStatus = bucket;
  }

  const flipFraction = Math.round((flipCount / Math.max(periodCount - 1, 1)) * 1000) / 1000;

  // ── Meta-stability classification ─────────────────────────────────────────
  let metaStabilityClassification;

  if (divergingFraction >= divergenceThreshold) {
    metaStabilityClassification = 'permanently_diverging';
  } else if (flipFraction >= oscillationThreshold) {
    metaStabilityClassification = 'oscillating';
  } else if (convergingFraction >= 1 - oscillationThreshold) {
    metaStabilityClassification = 'stable';
  } else {
    metaStabilityClassification = 'mixed';
  }

  // ── Estimated periods to meta-stable ──────────────────────────────────────
  // Pull estimatedMetaPeriodsToStable from the most recent period with a real value
  let estimatedPeriodsToMetaStable = null;
  for (let i = validResults.length - 1; i >= 0; i--) {
    const val = validResults[i].estimatedMetaPeriodsToStable;
    if (val != null) {
      estimatedPeriodsToMetaStable = val;
      break;
    }
  }

  const summary =
    `Meta-convergence stability: ${periodCount} period(s). ` +
    `Converging: ${convergingFraction}, diverging: ${divergingFraction}. ` +
    `Flips: ${flipCount} (${flipFraction} flip/period). ` +
    `Classification: ${metaStabilityClassification}. ` +
    `Est. periods to meta-stable: ${estimatedPeriodsToMetaStable != null ? estimatedPeriodsToMetaStable : 'unknown'}.`;

  return {
    ok: true,
    stabilityId,
    generatedAt: ts.toISOString(),
    periodCount,
    metaStatusSeries,
    convergingFraction,
    divergingFraction,
    flipCount,
    flipFraction,
    metaStabilityClassification,
    estimatedPeriodsToMetaStable,
    version: CLUSTER_EVOLUTION_VERSION_359,
    summary
  };
}

/* ─── exports ─────────────────────────────────────────────────────────────── */

module.exports = {
  CLUSTER_EVOLUTION_VERSION_359,
  trackClusterEvolution359,
  analyzeWaveAmplitude359,
  detectAttributionDrift359,
  assessMetaConvergenceStability359,
  // ID generators (exported for testing)
  _clusterEvolutionId359,
  _waveAmplitudeId359,
  _attrDriftId359,
  _metaStabilityId359,
  // Internal helpers (exported for testing)
  _hashContent359,
  _clamp359,
  _mean359,
  _slope359,
  _pearsonCorr359
};
