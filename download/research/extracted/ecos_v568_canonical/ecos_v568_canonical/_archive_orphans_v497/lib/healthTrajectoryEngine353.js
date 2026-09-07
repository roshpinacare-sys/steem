'use strict';
/**
 * lib/healthTrajectoryEngine353.js — ECOS V353 (Phase P241)
 * Health Trajectory Engine
 *
 * Extends V352 Executive Health Scorecard Engine with four longitudinal tools
 * that operate on sequences of V352 outputs, enabling scorecard history tracking,
 * dimension alert detection, remediation priority matrix building, and a
 * comprehensive trajectory report for executive review.
 *
 *   V352 → grade history tracking, forecast accuracy validation, velocity trend
 *           aggregation, comprehensive health scorecard
 *   V353 → scorecard history tracker, dimension alert detector, remediation
 *           priority matrix, health trajectory report
 *
 * Four concrete tools:
 *
 *   1. trackScorecardHistory353        — takes multiple V352 buildHealthScorecard352
 *      outputs over time and builds a longitudinal scorecard history. Tracks
 *      per-dimension trends (stability/momentum/predictability/responsiveness),
 *      composite score trajectory, and whether each dimension is improving,
 *      degrading, or stable over time.
 *
 *   2. detectDimensionAlerts353        — takes a V353 trackScorecardHistory353
 *      output and fires alerts when any dimension drops below configurable
 *      thresholds. Returns a list of active alerts with dimension name, current
 *      value, threshold, and severity (critical/warning/info).
 *
 *   3. buildRemediationMatrix353       — combines V352 scorecard, grade history,
 *      and velocity trend to produce a prioritised remediation matrix. Each row:
 *      dimension, current score, target score, gap, recommended actions, and an
 *      urgency score. Sorted by urgency descending.
 *
 *   4. buildTrajectoryReport353        — aggregates V353 scorecard history,
 *      dimension alerts, and remediation matrix into a single trajectory report
 *      suitable for executive review. Includes a one-page summary, per-dimension
 *      status, top 5 remediation actions, and a forward-looking outlook string.
 *
 * Pure / dependency-free (R3). All new public identifiers end with `353` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). Additive only (R6).
 *
 * @version 353.0.0
 */

const crypto = require('crypto');

const HEALTH_TRAJECTORY_ENGINE_VERSION_353 = '353.0.0';

/* ─── internal helpers ────────────────────────────────────────────────────── */

function _scorecardHistoryId353(ts) {
  return 'schist_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _alertsId353(ts) {
  return 'dimlerts_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _matrixId353(ts) {
  return 'remmatrix_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _reportId353(ts) {
  return 'trajrpt_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _hashContent353(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

/**
 * Clamp a value between min and max.
 */
function _clamp353(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute mean of a numeric array. Returns null for empty arrays.
 */
function _mean353(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * Compute linear regression slope of a numeric array.
 * Returns 0 for arrays with fewer than 2 elements.
 */
function _slope353(arr) {
  if (!arr || arr.length < 2) return 0;
  const n = arr.length;
  const xMean = (n - 1) / 2;
  const yMean = _mean353(arr);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (arr[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Classify a slope as improving/degrading/stable given a threshold. */
function _classifySlope353(slope, threshold) {
  if (slope > threshold) return 'improving';
  if (slope < -threshold) return 'degrading';
  return 'stable';
}

/* ─── 1. trackScorecardHistory353 ────────────────────────────────────────── */

/**
 * trackScorecardHistory353(scorecards, opts)
 *
 * Takes multiple V352 `buildHealthScorecard352` outputs over time and builds a
 * longitudinal scorecard history. Tracks per-dimension trends (stability/momentum/
 * predictability/responsiveness), composite score trajectory, and whether each
 * dimension is improving, degrading, or stable over time.
 *
 * @param {Array}  scorecards - Array of V352 buildHealthScorecard352 outputs
 * @param {Object} opts
 * @param {number} opts.slopeThreshold - Minimum slope to consider trending (default 0.5)
 * @returns {Object} Scorecard history result
 */
function trackScorecardHistory353(scorecards, opts = {}) {
  const ts = new Date();
  const historyId = _scorecardHistoryId353(ts);
  const slopeThreshold = opts.slopeThreshold != null ? opts.slopeThreshold : 0.5;

  if (!scorecards || scorecards.length === 0) {
    return {
      ok: true,
      historyId,
      snapshotCount: 0,
      compositeScoreTimeline: [],
      dimensionTimelines: {
        stability: [],
        momentum: [],
        predictability: [],
        responsiveness: []
      },
      dimensionTrends: {
        stability: 'insufficient_data',
        momentum: 'insufficient_data',
        predictability: 'insufficient_data',
        responsiveness: 'insufficient_data'
      },
      compositeTrend: 'insufficient_data',
      latestCompositeScore: null,
      latestScorecardGrade: 'N/A',
      version: HEALTH_TRAJECTORY_ENGINE_VERSION_353,
      summary: 'No scorecard inputs provided — insufficient data for history tracking.'
    };
  }

  const dimensions = ['stability', 'momentum', 'predictability', 'responsiveness'];
  const dimensionTimelines = { stability: [], momentum: [], predictability: [], responsiveness: [] };
  const compositeScoreTimeline = [];

  for (let i = 0; i < scorecards.length; i++) {
    const sc = scorecards[i] || {};
    const dims = sc.dimensionScores || {};
    const composite = typeof sc.compositeScore === 'number' ? sc.compositeScore : null;
    const grade = sc.scorecardGrade || 'N/A';

    compositeScoreTimeline.push({
      period: i + 1,
      scorecardId: sc.scorecardId || null,
      compositeScore: composite,
      scorecardGrade: grade
    });

    for (const dim of dimensions) {
      const val = typeof dims[dim] === 'number' ? dims[dim] : null;
      dimensionTimelines[dim].push({ period: i + 1, value: val });
    }
  }

  // Compute trends for each dimension
  const dimensionTrends = {};
  for (const dim of dimensions) {
    const values = dimensionTimelines[dim]
      .map(p => p.value)
      .filter(v => v !== null);
    if (values.length < 2) {
      dimensionTrends[dim] = 'insufficient_data';
    } else {
      dimensionTrends[dim] = _classifySlope353(_slope353(values), slopeThreshold);
    }
  }

  // Composite trend
  const compositeValues = compositeScoreTimeline
    .map(p => p.compositeScore)
    .filter(v => v !== null);
  const compositeTrend = compositeValues.length < 2
    ? 'insufficient_data'
    : _classifySlope353(_slope353(compositeValues), slopeThreshold);

  const latest = compositeScoreTimeline[compositeScoreTimeline.length - 1];
  const latestCompositeScore = latest.compositeScore;
  const latestScorecardGrade = latest.scorecardGrade;

  const summary =
    `Scorecard history over ${scorecards.length} snapshot(s): ` +
    `latest composite=${latestCompositeScore !== null ? latestCompositeScore : 'N/A'}, ` +
    `grade=${latestScorecardGrade}, composite trend=${compositeTrend}.`;

  return {
    ok: true,
    historyId,
    snapshotCount: scorecards.length,
    compositeScoreTimeline,
    dimensionTimelines,
    dimensionTrends,
    compositeTrend,
    latestCompositeScore,
    latestScorecardGrade,
    version: HEALTH_TRAJECTORY_ENGINE_VERSION_353,
    summary
  };
}

/* ─── 2. detectDimensionAlerts353 ────────────────────────────────────────── */

/**
 * detectDimensionAlerts353(scorecardHistory, opts)
 *
 * Takes a V353 `trackScorecardHistory353` output and fires alerts when any
 * dimension drops below configurable thresholds. Returns a list of active alerts
 * with dimension name, current value, threshold, and severity (critical/warning/info).
 *
 * @param {Object} scorecardHistory - V353 trackScorecardHistory353 output
 * @param {Object} opts
 * @param {Object} opts.thresholds       - Per-dimension threshold config
 *   @param {number} opts.thresholds.stability.critical    (default 30)
 *   @param {number} opts.thresholds.stability.warning     (default 50)
 *   @param {number} opts.thresholds.momentum.critical     (default 30)
 *   @param {number} opts.thresholds.momentum.warning      (default 50)
 *   @param {number} opts.thresholds.predictability.critical (default 30)
 *   @param {number} opts.thresholds.predictability.warning  (default 50)
 *   @param {number} opts.thresholds.responsiveness.critical (default 30)
 *   @param {number} opts.thresholds.responsiveness.warning  (default 50)
 * @param {number} opts.compositeThresholdCritical - Composite score ≤ this → critical (default 40)
 * @param {number} opts.compositeThresholdWarning  - Composite score ≤ this → warning (default 60)
 * @returns {Object} Dimension alerts result
 */
function detectDimensionAlerts353(scorecardHistory, opts = {}) {
  const ts = new Date();
  const alertsId = _alertsId353(ts);

  const DEFAULT_THRESHOLDS = {
    stability:      { critical: 30, warning: 50 },
    momentum:       { critical: 30, warning: 50 },
    predictability: { critical: 30, warning: 50 },
    responsiveness: { critical: 30, warning: 50 }
  };

  const thresholds = opts.thresholds || DEFAULT_THRESHOLDS;
  const compositeThresholdCritical = opts.compositeThresholdCritical != null
    ? opts.compositeThresholdCritical : 40;
  const compositeThresholdWarning = opts.compositeThresholdWarning != null
    ? opts.compositeThresholdWarning : 60;

  if (!scorecardHistory || !scorecardHistory.ok) {
    return {
      ok: true,
      alertsId,
      activeAlerts: [],
      alertCount: 0,
      hasCritical: false,
      hasWarning: false,
      version: HEALTH_TRAJECTORY_ENGINE_VERSION_353,
      summary: 'No valid scorecard history provided — no alerts generated.'
    };
  }

  const activeAlerts = [];
  const dimensions = ['stability', 'momentum', 'predictability', 'responsiveness'];

  // Get the latest dimension values from the timeline
  for (const dim of dimensions) {
    const timeline = (scorecardHistory.dimensionTimelines || {})[dim] || [];
    if (timeline.length === 0) continue;

    const latest = timeline[timeline.length - 1];
    const currentValue = latest.value;
    if (currentValue === null || currentValue === undefined) continue;

    const dimThresholds = (thresholds[dim]) || DEFAULT_THRESHOLDS[dim];
    const criticalThreshold = dimThresholds.critical != null ? dimThresholds.critical : 30;
    const warningThreshold = dimThresholds.warning != null ? dimThresholds.warning : 50;

    let severity = null;
    if (currentValue <= criticalThreshold) {
      severity = 'critical';
    } else if (currentValue <= warningThreshold) {
      severity = 'warning';
    }

    if (severity) {
      const threshold = severity === 'critical' ? criticalThreshold : warningThreshold;
      activeAlerts.push({
        dimension: dim,
        currentValue,
        threshold,
        severity,
        trend: (scorecardHistory.dimensionTrends || {})[dim] || 'unknown',
        message: `${dim} score (${currentValue}) is ${severity === 'critical' ? 'critically' : ''} below threshold (${threshold}).`.trim()
      });
    }
  }

  // Composite score alert
  const compositeScore = scorecardHistory.latestCompositeScore;
  if (typeof compositeScore === 'number') {
    let compositeSeverity = null;
    let compositeThreshold = null;
    if (compositeScore <= compositeThresholdCritical) {
      compositeSeverity = 'critical';
      compositeThreshold = compositeThresholdCritical;
    } else if (compositeScore <= compositeThresholdWarning) {
      compositeSeverity = 'warning';
      compositeThreshold = compositeThresholdWarning;
    }
    if (compositeSeverity) {
      activeAlerts.push({
        dimension: 'composite',
        currentValue: compositeScore,
        threshold: compositeThreshold,
        severity: compositeSeverity,
        trend: scorecardHistory.compositeTrend || 'unknown',
        message: `Composite score (${compositeScore}) is below ${compositeSeverity} threshold (${compositeThreshold}).`
      });
    }
  }

  // Sort: critical first, then warning, then info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  activeAlerts.sort((a, b) => {
    const aOrder = severityOrder[a.severity] != null ? severityOrder[a.severity] : 99;
    const bOrder = severityOrder[b.severity] != null ? severityOrder[b.severity] : 99;
    return aOrder - bOrder;
  });

  const hasCritical = activeAlerts.some(a => a.severity === 'critical');
  const hasWarning = activeAlerts.some(a => a.severity === 'warning');

  const summary = activeAlerts.length === 0
    ? 'No dimension alerts detected — all scores within acceptable thresholds.'
    : `${activeAlerts.length} alert(s) detected: ` +
      `${activeAlerts.filter(a => a.severity === 'critical').length} critical, ` +
      `${activeAlerts.filter(a => a.severity === 'warning').length} warning.`;

  return {
    ok: true,
    alertsId,
    activeAlerts,
    alertCount: activeAlerts.length,
    hasCritical,
    hasWarning,
    version: HEALTH_TRAJECTORY_ENGINE_VERSION_353,
    summary
  };
}

/* ─── 3. buildRemediationMatrix353 ───────────────────────────────────────── */

/**
 * buildRemediationMatrix353(scorecard, gradeHistory, velocityTrend, opts)
 *
 * Combines V352 scorecard, grade history, and velocity trend to produce a
 * prioritised remediation matrix. Each row: dimension, current score, target
 * score, gap, recommended actions, and an urgency score. Sorted by urgency
 * descending.
 *
 * @param {Object} scorecard     - V352 buildHealthScorecard352 output
 * @param {Object} gradeHistory  - V352 trackGradeHistory352 output
 * @param {Object} velocityTrend - V352 aggregateVelocityTrend352 output
 * @param {Object} opts
 * @param {number} opts.targetScore   - Target dimension score (default 80)
 * @param {number} opts.urgencyWeight - How much gap amplifies urgency vs trend (default 0.7)
 * @returns {Object} Remediation matrix result
 */
function buildRemediationMatrix353(scorecard, gradeHistory, velocityTrend, opts = {}) {
  const ts = new Date();
  const matrixId = _matrixId353(ts);
  const targetScore = opts.targetScore != null ? opts.targetScore : 80;
  const urgencyWeight = opts.urgencyWeight != null ? opts.urgencyWeight : 0.7;

  const hasAnyInput = scorecard || gradeHistory || velocityTrend;
  if (!hasAnyInput) {
    return {
      ok: true,
      matrixId,
      matrixRows: [],
      topPriority: null,
      overallUrgency: 'none',
      version: HEALTH_TRAJECTORY_ENGINE_VERSION_353,
      summary: 'No inputs provided — empty remediation matrix.'
    };
  }

  const dimensions = ['stability', 'momentum', 'predictability', 'responsiveness'];
  const matrixRows = [];

  // Derive degrading dimensions from velocity/grade context
  const gradeTrend = gradeHistory ? gradeHistory.trendDirection : 'stable';
  const velocityMeta = velocityTrend ? velocityTrend.metaClassification : 'insufficient_data';

  const RECOMMENDED_ACTIONS = {
    stability: [
      'Review fleet readiness gate blocking reasons and address top blocker.',
      'Increase snapshot cadence to detect early readiness drops.',
      'Align remediation sprints with readiness degradation windows.'
    ],
    momentum: [
      'Investigate root cause of grade decline over recent periods.',
      'Set grade improvement targets per sprint with measurable KPIs.',
      'Escalate persistent D-grade items to executive review.'
    ],
    predictability: [
      'Improve forecast input quality — validate horizon stability sources.',
      'Tighten confidence band by reducing high-variance inputs.',
      'Cross-check V351 combineFleetForecasts inputs for stale data.'
    ],
    responsiveness: [
      'Accelerate high-risk gap resolution — assign dedicated owner.',
      'Track netDelta weekly to prevent stalling velocity.',
      'Automate gap detection to surface new risks earlier.'
    ]
  };

  for (const dim of dimensions) {
    const dimScores = scorecard ? (scorecard.dimensionScores || {}) : {};
    const currentScore = typeof dimScores[dim] === 'number' ? dimScores[dim] : null;
    const gap = currentScore !== null ? Math.max(0, targetScore - currentScore) : null;

    // Urgency score: gap contribution + trend penalty
    let urgencyScore = 0;
    if (gap !== null) {
      urgencyScore += gap * urgencyWeight;
    }

    // Trend penalty: degrading adds urgency
    const dimTrend = scorecard
      ? _inferDimTrend353(dim, gradeTrend, velocityMeta)
      : 'stable';

    if (dimTrend === 'degrading') {
      urgencyScore += 20;
    } else if (dimTrend === 'stable' && gap !== null && gap > 20) {
      urgencyScore += 5;
    }

    urgencyScore = Math.round(_clamp353(urgencyScore, 0, 100));

    matrixRows.push({
      dimension: dim,
      currentScore,
      targetScore,
      gap,
      trend: dimTrend,
      urgencyScore,
      recommendedActions: RECOMMENDED_ACTIONS[dim] || []
    });
  }

  // Sort by urgency descending
  matrixRows.sort((a, b) => b.urgencyScore - a.urgencyScore);

  const topPriority = matrixRows.length > 0 ? matrixRows[0].dimension : null;

  // Overall urgency classification
  const maxUrgency = matrixRows.length > 0 ? matrixRows[0].urgencyScore : 0;
  let overallUrgency;
  if (maxUrgency >= 60) {
    overallUrgency = 'critical';
  } else if (maxUrgency >= 30) {
    overallUrgency = 'elevated';
  } else if (maxUrgency > 0) {
    overallUrgency = 'low';
  } else {
    overallUrgency = 'none';
  }

  const summary =
    `Remediation matrix: ${matrixRows.length} dimension(s), top priority=${topPriority || 'none'}, ` +
    `overall urgency=${overallUrgency}, max urgency score=${maxUrgency}.`;

  return {
    ok: true,
    matrixId,
    matrixRows,
    topPriority,
    overallUrgency,
    version: HEALTH_TRAJECTORY_ENGINE_VERSION_353,
    summary
  };
}

/**
 * Infer the dimension-level trend based on grade and velocity meta context.
 * Internal helper for buildRemediationMatrix353.
 */
function _inferDimTrend353(dim, gradeTrend, velocityMeta) {
  if (dim === 'momentum') {
    // Momentum is directly tied to grade history
    if (gradeTrend === 'improving') return 'improving';
    if (gradeTrend === 'degrading') return 'degrading';
    return 'stable';
  }
  if (dim === 'responsiveness') {
    // Responsiveness tracks velocity
    if (velocityMeta === 'consistently_accelerating') return 'improving';
    if (velocityMeta === 'consistently_stalling') return 'degrading';
    return 'stable';
  }
  // stability and predictability: use grade trend as proxy
  if (gradeTrend === 'improving') return 'improving';
  if (gradeTrend === 'degrading') return 'degrading';
  return 'stable';
}

/* ─── 4. buildTrajectoryReport353 ────────────────────────────────────────── */

/**
 * buildTrajectoryReport353(scorecardHistory, alerts, matrix, opts)
 *
 * Aggregates V353 scorecard history, dimension alerts, and remediation matrix
 * into a single trajectory report suitable for executive review. Includes a
 * one-page summary, per-dimension status, top 5 remediation actions, and a
 * forward-looking outlook string.
 *
 * @param {Object} scorecardHistory - V353 trackScorecardHistory353 output
 * @param {Object} alerts           - V353 detectDimensionAlerts353 output
 * @param {Object} matrix           - V353 buildRemediationMatrix353 output
 * @param {Object} opts
 * @param {number} opts.topActionsLimit - Max remediation actions to include (default 5)
 * @returns {Object} Trajectory report result
 */
function buildTrajectoryReport353(scorecardHistory, alerts, matrix, opts = {}) {
  const ts = new Date();
  const reportId = _reportId353(ts);
  const topActionsLimit = opts.topActionsLimit != null ? opts.topActionsLimit : 5;

  const hasAnyInput = scorecardHistory || alerts || matrix;
  if (!hasAnyInput) {
    return {
      ok: true,
      reportId,
      generatedAt: ts.toISOString(),
      executiveSummary: 'No inputs provided — trajectory report unavailable.',
      dimensionStatuses: [],
      topRemediationActions: [],
      activeAlertCount: 0,
      hasCriticalAlerts: false,
      compositeScoreTrend: 'insufficient_data',
      latestCompositeScore: null,
      latestScorecardGrade: 'N/A',
      overallUrgency: 'none',
      outlook: 'insufficient_data',
      version: HEALTH_TRAJECTORY_ENGINE_VERSION_353,
      summary: 'Empty trajectory report — no inputs provided.'
    };
  }

  // ── Per-dimension status ───────────────────────────────────────────────────
  const dimensionStatuses = [];
  const dimensions = ['stability', 'momentum', 'predictability', 'responsiveness'];

  for (const dim of dimensions) {
    const timeline = scorecardHistory
      ? ((scorecardHistory.dimensionTimelines || {})[dim] || [])
      : [];
    const latest = timeline.length > 0 ? timeline[timeline.length - 1] : null;
    const currentValue = latest ? latest.value : null;
    const trend = scorecardHistory
      ? ((scorecardHistory.dimensionTrends || {})[dim] || 'unknown')
      : 'unknown';

    // Find matching alert
    const alert = alerts
      ? (alerts.activeAlerts || []).find(a => a.dimension === dim)
      : null;
    const alertSeverity = alert ? alert.severity : null;

    // Find matrix row
    const matrixRow = matrix
      ? (matrix.matrixRows || []).find(r => r.dimension === dim)
      : null;
    const urgencyScore = matrixRow ? matrixRow.urgencyScore : 0;

    dimensionStatuses.push({
      dimension: dim,
      currentValue,
      trend,
      alertSeverity,
      urgencyScore
    });
  }

  // ── Top remediation actions ────────────────────────────────────────────────
  const topRemediationActions = [];
  if (matrix && matrix.matrixRows) {
    for (const row of matrix.matrixRows) {
      for (const action of row.recommendedActions || []) {
        if (topRemediationActions.length >= topActionsLimit) break;
        topRemediationActions.push({
          dimension: row.dimension,
          urgencyScore: row.urgencyScore,
          action
        });
      }
      if (topRemediationActions.length >= topActionsLimit) break;
    }
  }

  // ── Composite metrics ─────────────────────────────────────────────────────
  const latestCompositeScore = scorecardHistory
    ? scorecardHistory.latestCompositeScore
    : null;
  const latestScorecardGrade = scorecardHistory
    ? (scorecardHistory.latestScorecardGrade || 'N/A')
    : 'N/A';
  const compositeScoreTrend = scorecardHistory
    ? (scorecardHistory.compositeTrend || 'insufficient_data')
    : 'insufficient_data';

  const activeAlertCount = alerts ? (alerts.alertCount || 0) : 0;
  const hasCriticalAlerts = alerts ? (alerts.hasCritical || false) : false;
  const overallUrgency = matrix ? (matrix.overallUrgency || 'none') : 'none';

  // ── Outlook ───────────────────────────────────────────────────────────────
  let outlook;
  if (hasCriticalAlerts && overallUrgency === 'critical') {
    outlook = 'at_risk — immediate executive intervention required to prevent further degradation.';
  } else if (hasCriticalAlerts || overallUrgency === 'critical') {
    outlook = 'under_review — significant gaps require prioritised remediation before next review.';
  } else if (compositeScoreTrend === 'improving' && activeAlertCount === 0) {
    outlook = 'positive — fleet health trajectory is improving across all dimensions.';
  } else if (compositeScoreTrend === 'degrading') {
    outlook = 'cautionary — composite score is declining; monitor closely and act on remediation matrix.';
  } else {
    outlook = 'stable — fleet health is steady; maintain current remediation cadence.';
  }

  // ── Executive summary ─────────────────────────────────────────────────────
  const snapshotCount = scorecardHistory ? (scorecardHistory.snapshotCount || 0) : 0;
  const executiveSummary =
    `Health trajectory over ${snapshotCount} scorecard snapshot(s). ` +
    `Latest composite score: ${latestCompositeScore !== null ? latestCompositeScore : 'N/A'} ` +
    `(grade ${latestScorecardGrade}), trend: ${compositeScoreTrend}. ` +
    `Active alerts: ${activeAlertCount}${hasCriticalAlerts ? ' (CRITICAL)' : ''}. ` +
    `Overall urgency: ${overallUrgency}. ` +
    `Outlook: ${outlook}`;

  const summary =
    `Trajectory report generated: grade=${latestScorecardGrade}, ` +
    `composite trend=${compositeScoreTrend}, alerts=${activeAlertCount}, ` +
    `urgency=${overallUrgency}, top action=${topRemediationActions[0] ? topRemediationActions[0].action : 'none'}.`;

  return {
    ok: true,
    reportId,
    generatedAt: ts.toISOString(),
    executiveSummary,
    dimensionStatuses,
    topRemediationActions,
    activeAlertCount,
    hasCriticalAlerts,
    compositeScoreTrend,
    latestCompositeScore,
    latestScorecardGrade,
    overallUrgency,
    outlook,
    version: HEALTH_TRAJECTORY_ENGINE_VERSION_353,
    summary
  };
}

/* ─── exports ─────────────────────────────────────────────────────────────── */

module.exports = {
  HEALTH_TRAJECTORY_ENGINE_VERSION_353,
  trackScorecardHistory353,
  detectDimensionAlerts353,
  buildRemediationMatrix353,
  buildTrajectoryReport353,
  // ID generators (exported for testing)
  _scorecardHistoryId353,
  _alertsId353,
  _matrixId353,
  _reportId353,
  // Internal helpers (exported for testing)
  _hashContent353,
  _clamp353,
  _mean353,
  _slope353
};
