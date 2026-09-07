'use strict';
/**
 * src/lib/ttlBoundsDriftDetection435.js — ECOS V435
 * Feature 2: TTL bounds drift detection — detect workload shifts and trigger re-learn.
 * @version 435.0.0
 */
const TTL_BOUNDS_DRIFT_DETECTION_VERSION435 = '435.0.0';
const _driftState435 = { detections: [] };

function detectDrift435(workload, newSamples) {
  let bounds;
  try {
    const b434 = require('./adaptiveTtlBounds434.js');
    bounds = b434._boundsState434.workloads[workload];
  } catch (_) {}
  if (!bounds) return { ok: false, error: 'no bounds for workload' };
  const arr = (newSamples || []).map(Number).filter(Number.isFinite);
  if (arr.length === 0) return { ok: false, error: 'no samples' };
  const outOfRange = arr.filter(v => v < bounds.minTtl || v > bounds.maxTtl).length;
  const ratio = outOfRange / arr.length;
  const drifted = ratio > 0.2;
  const det = { workload, ratio, drifted, at: new Date().toISOString() };
  _driftState435.detections.push(det);
  if (drifted) {
    try {
      const b434 = require('./adaptiveTtlBounds434.js');
      b434.learnBounds434(workload, arr);
      det.relearned = true;
    } catch (_) {}
  }
  return { ok: true, ...det };
}

function wireTtlBoundsDriftDetection435(app) {
  const BASE = '/api/v1/alerts/webhook/retry/dedup/feedback/scale/bounds/drift';
  app.post(BASE, (req, res) => {
    const { workload, samples } = req.body || {};
    res.json(detectDrift435(workload, samples));
  });
  app.get(BASE + '/status', (req, res) => res.json({ version: TTL_BOUNDS_DRIFT_DETECTION_VERSION435, ..._driftState435 }));
}

module.exports = { TTL_BOUNDS_DRIFT_DETECTION_VERSION435, detectDrift435, wireTtlBoundsDriftDetection435, _driftState435 };
