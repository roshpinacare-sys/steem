'use strict';
/**
 * lib/executiveHealthScorecard352.js — ECOS V352 (Phase P240)
 * Executive Health Scorecard Engine
 *
 * Extends V351 Executive Health & Forecast Engine with four meta-analytics tools
 * that operate on sequences of V351 outputs:
 *
 *   V351 → readiness trend tracking, remediation velocity, forecast combining,
 *           executive health summary
 *   V352 → grade history tracking, forecast accuracy validation, velocity trend
 *           aggregation, and a comprehensive health scorecard
 *
 * Four concrete tools:
 *
 *   1. trackGradeHistory352          — takes multiple V351 buildExecutiveSummary351
 *      outputs and builds a grade history timeline (A/B/C/D over periods). Computes
 *      grade distribution, most frequent grade, and a grade improvement score
 *      (positive if moving toward A).
 *
 *   2. validateForecastAccuracy352   — takes paired V351 combineFleetForecasts351
 *      outputs alongside actual composite scores observed later, and measures how
 *      accurate each forecast period was. Returns MAE, bias, and an accuracy
 *      classification (accurate/overestimated/underestimated).
 *
 *   3. aggregateVelocityTrend352     — takes multiple V351
 *      measureRemediationVelocity351 outputs and tracks whether the remediation
 *      team is consistently accelerating, stalling, or oscillating. Returns a
 *      meta-classification and a consistency score.
 *
 *   4. buildHealthScorecard352       — combines V351 trend, velocity, and forecast
 *      alongside a V352 grade history into a comprehensive health scorecard with
 *      dimension scores (stability, momentum, predictability, responsiveness) and
 *      an overall composite scorecard grade.
 *
 * Pure / dependency-free (R3). All new public identifiers end with `352` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). Additive only (R6).
 *
 * @version 352.0.0
 */

const crypto = require('crypto');

const EXECUTIVE_HEALTH_SCORECARD_VERSION_352 = '352.0.0';

/* ─── internal helpers ────────────────────────────────────────────────────── */

function _gradeHistoryId352(ts) {
  return 'grdhist_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _forecastAccuracyId352(ts) {
  return 'fcstacc_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _velocityTrendId352(ts) {
  return 'veltrend_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _scorecardId352(ts) {
  return 'scorecard_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _hashContent352(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

/**
 * Clamp a value between min and max.
 */
function _clamp352(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute mean of a numeric array. Returns null for empty arrays.
 */
function _mean352(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * Compute linear regression slope of a numeric array.
 * Returns 0 for arrays with fewer than 2 elements.
 */
function _slope352(arr) {
  if (!arr || arr.length < 2) return 0;
  const n = arr.length;
  const xMean = (n - 1) / 2;
  const yMean = _mean352(arr);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (arr[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Map grade letter to numeric value for calculations. */
const GRADE_VALUES_352 = { A: 4, B: 3, C: 2, D: 1, 'N/A': 0 };

/** Map numeric value back to grade letter. */
function _valueToGrade352(v) {
  if (v >= 3.5) return 'A';
  if (v >= 2.5) return 'B';
  if (v >= 1.5) return 'C';
  if (v >= 0.5) return 'D';
  return 'N/A';
}

/* ─── 1. trackGradeHistory352 ─────────────────────────────────────────────── */

/**
 * trackGradeHistory352(summaries, opts)
 *
 * Takes multiple V351 `buildExecutiveSummary351` outputs over time and builds a
 * grade history timeline. Computes grade distribution, most frequent grade, and
 * a grade improvement score (positive if moving toward A).
 *
 * @param {Array}  summaries - Array of V351 buildExecutiveSummary351 outputs
 * @param {Object} opts
 * @param {number} opts.slopeThreshold - Minimum slope magnitude to consider trending (default 0.05)
 * @returns {Object} Grade history result
 */
function trackGradeHistory352(summaries, opts = {}) {
  const ts = new Date();
  const historyId = _gradeHistoryId352(ts);
  const slopeThreshold = opts.slopeThreshold != null ? opts.slopeThreshold : 0.05;

  if (!summaries || summaries.length === 0) {
    return {
      ok: true,
      historyId,
      snapshotCount: 0,
      gradeTimeline: [],
      gradeDistribution: { A: 0, B: 0, C: 0, D: 0, 'N/A': 0 },
      mostFrequentGrade: 'N/A',
      gradeImprovementScore: 0,
      trendDirection: 'insufficient_data',
      version: EXECUTIVE_HEALTH_SCORECARD_VERSION_352,
      summary: 'No summary inputs provided — insufficient data for grade history.'
    };
  }

  const distribution = { A: 0, B: 0, C: 0, D: 0, 'N/A': 0 };
  const gradeTimeline = [];
  const numericValues = [];

  for (let i = 0; i < summaries.length; i++) {
    const s = summaries[i] || {};
    const grade = (s.overallGrade && distribution[s.overallGrade] !== undefined)
      ? s.overallGrade
      : 'N/A';
    distribution[grade]++;
    gradeTimeline.push({ period: i + 1, grade, summaryId: s.summaryId || null });
    numericValues.push(GRADE_VALUES_352[grade]);
  }

  // Most frequent grade
  let mostFrequentGrade = 'N/A';
  let maxCount = 0;
  for (const [g, count] of Object.entries(distribution)) {
    if (count > maxCount) { maxCount = count; mostFrequentGrade = g; }
  }

  // Grade improvement score: slope × 25 clamped to [-100, 100]
  const slope = _slope352(numericValues);
  const gradeImprovementScore = _clamp352(Math.round(slope * 25 * 100) / 100, -100, 100);

  // Trend direction
  let trendDirection;
  if (summaries.length < 2) {
    trendDirection = 'insufficient_data';
  } else if (slope > slopeThreshold) {
    trendDirection = 'improving';
  } else if (slope < -slopeThreshold) {
    trendDirection = 'degrading';
  } else {
    trendDirection = 'stable';
  }

  const latestGrade = gradeTimeline[gradeTimeline.length - 1].grade;
  const summary =
    `Grade history over ${summaries.length} snapshot(s): most frequent=${mostFrequentGrade}, ` +
    `latest=${latestGrade}, trend=${trendDirection}, improvement score=${gradeImprovementScore}.`;

  return {
    ok: true,
    historyId,
    snapshotCount: summaries.length,
    gradeTimeline,
    gradeDistribution: distribution,
    mostFrequentGrade,
    gradeImprovementScore,
    trendDirection,
    version: EXECUTIVE_HEALTH_SCORECARD_VERSION_352,
    summary
  };
}

/* ─── 2. validateForecastAccuracy352 ─────────────────────────────────────── */

/**
 * validateForecastAccuracy352(forecasts, actuals, opts)
 *
 * Takes paired V351 `combineFleetForecasts351` outputs alongside actual composite
 * scores observed later. Measures how accurate each forecast period was.
 * Returns MAE, bias, and an accuracy classification.
 *
 * @param {Array}  forecasts - Array of V351 combineFleetForecasts351 outputs
 * @param {Array}  actuals   - Parallel array of observed actual composite scores (numbers)
 * @param {Object} opts
 * @param {number} opts.accuracyThreshold - MAE below which forecast is "accurate" (default 10)
 * @param {number} opts.biasThreshold     - Absolute bias below which considered unbiased (default 5)
 * @returns {Object} Forecast accuracy result
 */
function validateForecastAccuracy352(forecasts, actuals, opts = {}) {
  const ts = new Date();
  const accuracyId = _forecastAccuracyId352(ts);
  const accuracyThreshold = opts.accuracyThreshold != null ? opts.accuracyThreshold : 10;
  const biasThreshold = opts.biasThreshold != null ? opts.biasThreshold : 5;

  if (!forecasts || forecasts.length === 0 || !actuals || actuals.length === 0) {
    return {
      ok: true,
      accuracyId,
      pairCount: 0,
      mae: null,
      bias: null,
      accuracyClass: 'insufficient_data',
      periodAccuracies: [],
      version: EXECUTIVE_HEALTH_SCORECARD_VERSION_352,
      summary: 'No paired forecast/actual inputs — insufficient data for accuracy validation.'
    };
  }

  const pairCount = Math.min(forecasts.length, actuals.length);
  const periodAccuracies = [];
  const errors = [];
  const biases = [];

  for (let i = 0; i < pairCount; i++) {
    const f = forecasts[i] || {};
    const actual = typeof actuals[i] === 'number' ? actuals[i] : null;

    // Use the meanScore from the forecast as the primary prediction
    const predicted = typeof f.meanScore === 'number' ? f.meanScore : null;

    if (predicted === null || actual === null) {
      periodAccuracies.push({
        period: i + 1,
        forecastId: f.forecastId || null,
        predicted: null,
        actual: null,
        error: null,
        biasSign: null
      });
      continue;
    }

    const error = Math.abs(predicted - actual);
    const rawBias = predicted - actual; // positive = overestimated
    errors.push(error);
    biases.push(rawBias);

    periodAccuracies.push({
      period: i + 1,
      forecastId: f.forecastId || null,
      predicted: Math.round(predicted * 100) / 100,
      actual: Math.round(actual * 100) / 100,
      error: Math.round(error * 100) / 100,
      biasSign: rawBias > 0 ? 'overestimated' : rawBias < 0 ? 'underestimated' : 'accurate'
    });
  }

  const mae = errors.length > 0 ? Math.round(_mean352(errors) * 100) / 100 : null;
  const bias = biases.length > 0 ? Math.round(_mean352(biases) * 100) / 100 : null;

  let accuracyClass;
  if (mae === null) {
    accuracyClass = 'insufficient_data';
  } else if (mae <= accuracyThreshold && Math.abs(bias) <= biasThreshold) {
    accuracyClass = 'accurate';
  } else if (bias > biasThreshold) {
    accuracyClass = 'overestimated';
  } else if (bias < -biasThreshold) {
    accuracyClass = 'underestimated';
  } else {
    accuracyClass = 'inaccurate';
  }

  const summary =
    `Forecast accuracy over ${pairCount} pair(s): MAE=${mae !== null ? mae : 'N/A'}, ` +
    `bias=${bias !== null ? bias : 'N/A'}, classification=${accuracyClass}.`;

  return {
    ok: true,
    accuracyId,
    pairCount,
    mae,
    bias,
    accuracyClass,
    periodAccuracies,
    version: EXECUTIVE_HEALTH_SCORECARD_VERSION_352,
    summary
  };
}

/* ─── 3. aggregateVelocityTrend352 ────────────────────────────────────────── */

/**
 * aggregateVelocityTrend352(velocityHistory, opts)
 *
 * Takes multiple V351 `measureRemediationVelocity351` outputs and tracks whether
 * the remediation team is consistently accelerating, stalling, or oscillating.
 * Returns a meta-classification and a consistency score.
 *
 * @param {Array}  velocityHistory - Array of V351 measureRemediationVelocity351 outputs
 * @param {Object} opts
 * @param {number} opts.consistencyThreshold - Fraction to be classified as consistent (default 0.7)
 * @returns {Object} Velocity trend aggregation result
 */
function aggregateVelocityTrend352(velocityHistory, opts = {}) {
  const ts = new Date();
  const velocityTrendId = _velocityTrendId352(ts);
  const consistencyThreshold = opts.consistencyThreshold != null ? opts.consistencyThreshold : 0.7;

  if (!velocityHistory || velocityHistory.length === 0) {
    return {
      ok: true,
      velocityTrendId,
      snapshotCount: 0,
      classCounts: { accelerating: 0, steady: 0, stalling: 0, insufficient_data: 0 },
      dominantClass: 'insufficient_data',
      consistencyScore: 0,
      metaClassification: 'insufficient_data',
      netDeltaTimeline: [],
      version: EXECUTIVE_HEALTH_SCORECARD_VERSION_352,
      summary: 'No velocity history provided — insufficient data for trend aggregation.'
    };
  }

  const classCounts = { accelerating: 0, steady: 0, stalling: 0, insufficient_data: 0 };
  const netDeltaTimeline = [];

  for (let i = 0; i < velocityHistory.length; i++) {
    const v = velocityHistory[i] || {};
    const vc = v.velocityClass && classCounts[v.velocityClass] !== undefined
      ? v.velocityClass
      : 'insufficient_data';
    classCounts[vc]++;
    netDeltaTimeline.push({
      period: i + 1,
      velocityId: v.velocityId || null,
      velocityClass: vc,
      netDelta: typeof v.netDelta === 'number' ? v.netDelta : null
    });
  }

  // Dominant class (excluding insufficient_data if possible)
  const actionableClasses = ['accelerating', 'steady', 'stalling'];
  let dominantClass = 'insufficient_data';
  let maxCount = 0;
  for (const cls of actionableClasses) {
    if (classCounts[cls] > maxCount) { maxCount = classCounts[cls]; dominantClass = cls; }
  }
  if (maxCount === 0) dominantClass = 'insufficient_data';

  // Consistency score: fraction matching dominant class
  const total = velocityHistory.length;
  const consistencyScore = maxCount > 0
    ? Math.round((maxCount / total) * 1000) / 1000
    : 0;

  // Meta-classification
  let metaClassification;
  if (velocityHistory.length < 2) {
    metaClassification = 'insufficient_data';
  } else if (consistencyScore >= consistencyThreshold && dominantClass === 'accelerating') {
    metaClassification = 'consistently_accelerating';
  } else if (consistencyScore >= consistencyThreshold && dominantClass === 'stalling') {
    metaClassification = 'consistently_stalling';
  } else if (consistencyScore >= consistencyThreshold && dominantClass === 'steady') {
    metaClassification = 'consistently_steady';
  } else {
    metaClassification = 'oscillating';
  }

  const summary =
    `Velocity trend over ${velocityHistory.length} snapshot(s): dominant=${dominantClass}, ` +
    `consistency=${consistencyScore}, meta-classification=${metaClassification}.`;

  return {
    ok: true,
    velocityTrendId,
    snapshotCount: velocityHistory.length,
    classCounts,
    dominantClass,
    consistencyScore,
    metaClassification,
    netDeltaTimeline,
    version: EXECUTIVE_HEALTH_SCORECARD_VERSION_352,
    summary
  };
}

/* ─── 4. buildHealthScorecard352 ──────────────────────────────────────────── */

/**
 * buildHealthScorecard352(trend, velocity, forecast, gradeHistory, opts)
 *
 * Combines V351 trend (trackReadinessTrend351), velocity (measureRemediationVelocity351),
 * and forecast (combineFleetForecasts351) alongside a V352 grade history into a
 * comprehensive health scorecard. Returns dimension scores for stability, momentum,
 * predictability, and responsiveness, plus an overall composite scorecard grade.
 *
 * Dimension scoring (each 0–100):
 *   stability       = readinessRate × 100 (from trend), or 50 if unavailable
 *   momentum        = based on gradeImprovementScore mapped to 0–100
 *   predictability  = based on forecastId overallConsistency × 100, or 50 if unavailable
 *   responsiveness  = based on velocityClass / netDelta context
 *
 * Composite grade: A ≥ 80, B ≥ 60, C ≥ 40, D < 40, N/A if no data.
 *
 * @param {Object} trend        - V351 trackReadinessTrend351 output
 * @param {Object} velocity     - V351 measureRemediationVelocity351 output
 * @param {Object} forecast     - V351 combineFleetForecasts351 output
 * @param {Object} gradeHistory - V352 trackGradeHistory352 output
 * @param {Object} opts
 * @param {number} opts.gradeAThreshold  - Composite score ≥ this → A (default 80)
 * @param {number} opts.gradeBThreshold  - Composite score ≥ this → B (default 60)
 * @param {number} opts.gradeCThreshold  - Composite score ≥ this → C (default 40)
 * @returns {Object} Comprehensive health scorecard
 */
function buildHealthScorecard352(trend, velocity, forecast, gradeHistory, opts = {}) {
  const ts = new Date();
  const scorecardId = _scorecardId352(ts);
  const gradeAThreshold = opts.gradeAThreshold != null ? opts.gradeAThreshold : 80;
  const gradeBThreshold = opts.gradeBThreshold != null ? opts.gradeBThreshold : 60;
  const gradeCThreshold = opts.gradeCThreshold != null ? opts.gradeCThreshold : 40;

  const hasAnyInput = trend || velocity || forecast || gradeHistory;
  if (!hasAnyInput) {
    return {
      ok: true,
      scorecardId,
      dimensionScores: { stability: null, momentum: null, predictability: null, responsiveness: null },
      compositeScore: null,
      scorecardGrade: 'N/A',
      insights: [],
      version: EXECUTIVE_HEALTH_SCORECARD_VERSION_352,
      summary: 'No inputs provided — N/A scorecard.'
    };
  }

  // ── Stability dimension (0–100) ──────────────────────────────────────────
  // Based on readiness rate from trend output
  let stability;
  if (trend && typeof trend.readinessRate === 'number') {
    stability = _clamp352(Math.round(trend.readinessRate * 100), 0, 100);
  } else if (trend && trend.trendDirection === 'improving') {
    stability = 65;
  } else if (trend && trend.trendDirection === 'degrading') {
    stability = 35;
  } else {
    stability = 50;
  }

  // ── Momentum dimension (0–100) ───────────────────────────────────────────
  // Based on grade improvement score from gradeHistory (-100..100 → 0..100)
  let momentum;
  if (gradeHistory && typeof gradeHistory.gradeImprovementScore === 'number') {
    // Map [-100, 100] → [0, 100]
    momentum = _clamp352(Math.round((gradeHistory.gradeImprovementScore + 100) / 2), 0, 100);
  } else if (gradeHistory && gradeHistory.trendDirection === 'improving') {
    momentum = 70;
  } else if (gradeHistory && gradeHistory.trendDirection === 'degrading') {
    momentum = 30;
  } else {
    momentum = 50;
  }

  // ── Predictability dimension (0–100) ─────────────────────────────────────
  // Based on overallConsistency from forecast output
  let predictability;
  if (forecast && typeof forecast.overallConsistency === 'number') {
    predictability = _clamp352(Math.round(forecast.overallConsistency * 100), 0, 100);
  } else if (forecast && typeof forecast.meanScore === 'number') {
    predictability = _clamp352(Math.round(forecast.meanScore), 0, 100);
  } else {
    predictability = 50;
  }

  // ── Responsiveness dimension (0–100) ─────────────────────────────────────
  // Based on velocity class and net delta
  let responsiveness;
  if (velocity && velocity.velocityClass === 'accelerating') {
    const netBonus = typeof velocity.netDelta === 'number'
      ? _clamp352(velocity.netDelta * 5, 0, 25)
      : 0;
    responsiveness = _clamp352(75 + netBonus, 0, 100);
  } else if (velocity && velocity.velocityClass === 'steady') {
    responsiveness = 55;
  } else if (velocity && velocity.velocityClass === 'stalling') {
    const netPenalty = typeof velocity.netDelta === 'number'
      ? _clamp352(Math.abs(velocity.netDelta) * 5, 0, 20)
      : 0;
    responsiveness = _clamp352(35 - netPenalty, 0, 100);
  } else {
    responsiveness = 50;
  }

  // ── Composite score ───────────────────────────────────────────────────────
  const compositeScore = Math.round(
    (stability * 0.30 + momentum * 0.25 + predictability * 0.20 + responsiveness * 0.25)
  );

  // ── Scorecard grade ───────────────────────────────────────────────────────
  let scorecardGrade;
  if (compositeScore >= gradeAThreshold) {
    scorecardGrade = 'A';
  } else if (compositeScore >= gradeBThreshold) {
    scorecardGrade = 'B';
  } else if (compositeScore >= gradeCThreshold) {
    scorecardGrade = 'C';
  } else {
    scorecardGrade = 'D';
  }

  // ── Insights ──────────────────────────────────────────────────────────────
  const insights = [];

  if (stability < 50) {
    insights.push('Fleet readiness is below target — review blocking reasons and remediation plan.');
  }
  if (momentum < 40) {
    insights.push('Grade trajectory is declining — executive intervention recommended.');
  }
  if (predictability < 40) {
    insights.push('Forecast consistency is low — horizon instability detected.');
  }
  if (responsiveness < 40) {
    insights.push('Remediation velocity is stalling — prioritise high-risk gap resolution.');
  }
  if (insights.length === 0) {
    if (compositeScore >= gradeAThreshold) {
      insights.push('All health dimensions are performing well — maintain current cadence.');
    } else {
      insights.push('Health scorecard is satisfactory — monitor for emerging risks.');
    }
  }

  const summary =
    `Health scorecard grade=${scorecardGrade} (composite=${compositeScore}): ` +
    `stability=${stability}, momentum=${momentum}, ` +
    `predictability=${predictability}, responsiveness=${responsiveness}.`;

  return {
    ok: true,
    scorecardId,
    dimensionScores: { stability, momentum, predictability, responsiveness },
    compositeScore,
    scorecardGrade,
    insights,
    version: EXECUTIVE_HEALTH_SCORECARD_VERSION_352,
    summary
  };
}

/* ─── exports ─────────────────────────────────────────────────────────────── */

module.exports = {
  EXECUTIVE_HEALTH_SCORECARD_VERSION_352,
  trackGradeHistory352,
  validateForecastAccuracy352,
  aggregateVelocityTrend352,
  buildHealthScorecard352,
  // ID generators (exported for testing)
  _gradeHistoryId352,
  _forecastAccuracyId352,
  _velocityTrendId352,
  _scorecardId352,
  // Internal helpers (exported for testing)
  _hashContent352,
  _clamp352,
  _mean352,
  _slope352
};
