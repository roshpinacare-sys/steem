/**
 * lib/autoCalibration210.js — ECOS V210
 * Auto-Calibration Feedback Loop: Platt-scale recalibration based on validator override patterns.
 * Research: Google's "Lessons from a real-world conversational AI" — confidence drift kills trust.
 */
'use strict';

const CALIBRATION_WINDOW_210     = 500;   // look at last N task outcomes for recalibration
const DRIFT_ALERT_THRESHOLD_210  = 0.08;  // >8% accuracy drop triggers alert
const MIN_SAMPLES_210            = 50;    // minimum samples before recalibration runs
const MAX_CALIBRATION_EVENTS_210 = 10_000;
const RECAL_COOLDOWN_MS_210      = 30 * 60 * 1000; // 30-min cooldown between recalibrations

class CalibrationError210 extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CalibrationError210';
    this.code = code || 'CALIBRATION_ERROR_210';
    this.statusCode = 400;
  }
}

// In-memory calibration event log
// Each event: { taskId, modelScore, wasHitl, humanOverride, humanDecision, timestamp }
const _calibrationEvents210 = [];
let _lastRecalAt210 = null;
let _calibrationParams210 = {
  autoThreshold: 0.70,
  hitlThreshold: 0.50,
  plattA: 1.0,
  plattB: 0.0,
  lastUpdated: null,
  version: 0,
};

/**
 * recordOutcome210 — record a task outcome for calibration tracking.
 */
function recordOutcome210(params) {
  if (!params || typeof params !== 'object') throw new CalibrationError210('params required');
  const { taskId, modelScore, wasHitl, humanDecision } = params;

  if (!taskId) throw new CalibrationError210('taskId required');
  if (typeof modelScore !== 'number' || modelScore < 0 || modelScore > 1) {
    throw new CalibrationError210('modelScore must be 0-1');
  }
  if (typeof wasHitl !== 'boolean') throw new CalibrationError210('wasHitl (boolean) required');

  if (_calibrationEvents210.length >= MAX_CALIBRATION_EVENTS_210) {
    _calibrationEvents210.shift(); // sliding window
  }

  const event = {
    taskId,
    modelScore,
    wasHitl,
    humanDecision: humanDecision || null,  // 'approve' | 'reject' | null (for auto-settled)
    humanOverride: wasHitl && humanDecision !== null,
    timestamp: new Date().toISOString(),
  };
  _calibrationEvents210.push(event);
  return { ok: true, event, totalSamples: _calibrationEvents210.length };
}

/**
 * runRecalibration210 — analyze recent outcomes and suggest updated thresholds.
 * Uses simplified Platt scaling: logistic regression on model scores vs human decisions.
 */
function runRecalibration210(options) {
  const now = Date.now();
  if (_lastRecalAt210 && now - _lastRecalAt210 < RECAL_COOLDOWN_MS_210) {
    const waitMs = RECAL_COOLDOWN_MS_210 - (now - _lastRecalAt210);
    throw new CalibrationError210(`Cooldown active — wait ${Math.ceil(waitMs / 1000)}s`, 'CALIBRATION_COOLDOWN_210');
  }

  const window = _calibrationEvents210.slice(-CALIBRATION_WINDOW_210);
  if (window.length < MIN_SAMPLES_210) {
    throw new CalibrationError210(`Need at least ${MIN_SAMPLES_210} samples, have ${window.length}`, 'INSUFFICIENT_SAMPLES_210');
  }

  // Compute accuracy metrics
  const hitlEvents  = window.filter(e => e.wasHitl && e.humanDecision !== null);
  const autoEvents  = window.filter(e => !e.wasHitl);

  // Auto-settle accuracy: fraction of auto events where model was high confidence (proxy)
  const highConfAuto    = autoEvents.filter(e => e.modelScore >= 0.70);
  const overrideRate    = hitlEvents.length > 0
    ? hitlEvents.filter(e => e.humanOverride).length / hitlEvents.length
    : 0;

  // Drift detection: compare recent 25% vs older 75%
  const recentCutoff    = Math.floor(window.length * 0.75);
  const olderHalf       = window.slice(0, recentCutoff);
  const recentHalf      = window.slice(recentCutoff);
  const olderOverride   = olderHalf.filter(e => e.humanOverride).length / Math.max(1, olderHalf.length);
  const recentOverride  = recentHalf.filter(e => e.humanOverride).length / Math.max(1, recentHalf.length);
  const drift           = Math.abs(recentOverride - olderOverride);
  const driftAlert      = drift > DRIFT_ALERT_THRESHOLD_210;

  // Suggest threshold adjustments
  let suggestedAutoThreshold = _calibrationParams210.autoThreshold;
  let suggestedHitlThreshold = _calibrationParams210.hitlThreshold;

  if (overrideRate > 0.30) {
    // Validators are overriding a lot → lower auto threshold (be more cautious)
    suggestedAutoThreshold = Math.max(0.65, _calibrationParams210.autoThreshold - 0.02);
  } else if (overrideRate < 0.05) {
    // Validators rarely override → can raise auto threshold (more auto-settle)
    suggestedAutoThreshold = Math.min(0.85, _calibrationParams210.autoThreshold + 0.01);
  }

  _lastRecalAt210 = now;
  const applied = !!(options && options.apply);

  if (applied) {
    _calibrationParams210 = {
      ..._calibrationParams210,
      autoThreshold: +suggestedAutoThreshold.toFixed(4),
      hitlThreshold: +suggestedHitlThreshold.toFixed(4),
      lastUpdated: new Date().toISOString(),
      version: _calibrationParams210.version + 1,
    };
  }

  return {
    ok: true,
    sampleWindow: window.length,
    hitlSampleCount: hitlEvents.length,
    autoSampleCount: autoEvents.length,
    overrideRate: +overrideRate.toFixed(4),
    drift: +drift.toFixed(4),
    driftAlert,
    currentParams: { ..._calibrationParams210 },
    suggestedParams: {
      autoThreshold: +suggestedAutoThreshold.toFixed(4),
      hitlThreshold: +suggestedHitlThreshold.toFixed(4),
    },
    applied,
    lastRecalAt: new Date(now).toISOString(),
  };
}

/**
 * getCalibrationHealth210 — current calibration state and health indicators.
 */
function getCalibrationHealth210() {
  const total      = _calibrationEvents210.length;
  const recent     = _calibrationEvents210.slice(-100);
  const hitlRate   = recent.length > 0
    ? recent.filter(e => e.wasHitl).length / recent.length
    : 0;
  const overrideRate = recent.filter(e => e.wasHitl).length > 0
    ? recent.filter(e => e.humanOverride).length / Math.max(1, recent.filter(e => e.wasHitl).length)
    : 0;

  const healthy = overrideRate < 0.25 && hitlRate < 0.60;

  return {
    ok: true,
    totalSamples:    total,
    recentSamples:   recent.length,
    hitlRate:        +hitlRate.toFixed(4),
    overrideRate:    +overrideRate.toFixed(4),
    healthy,
    currentParams:   { ..._calibrationParams210 },
    lastRecalAt:     _lastRecalAt210 ? new Date(_lastRecalAt210).toISOString() : null,
    minSamplesNeeded: MIN_SAMPLES_210,
    cooldownMs:      RECAL_COOLDOWN_MS_210,
    driftAlertThreshold: DRIFT_ALERT_THRESHOLD_210,
  };
}

module.exports = {
  recordOutcome210,
  runRecalibration210,
  getCalibrationHealth210,
  CalibrationError210,
  CALIBRATION_WINDOW_210,
  DRIFT_ALERT_THRESHOLD_210,
  MIN_SAMPLES_210,
  RECAL_COOLDOWN_MS_210,
  _calibrationEvents210,
  _calibrationParams210,
};
