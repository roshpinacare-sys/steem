'use strict';
/**
 * src/lib/adaptiveTtlBounds434.js — ECOS V434
 *
 * Feature 2: Adaptive TTL bounds
 * Learn safe min/max TTL envelopes per workload. Builds on predictiveTtlScaling433.
 *
 * @version 434.0.0
 */

const ADAPTIVE_TTL_BOUNDS_VERSION434 = '434.0.0';

const _boundsState434 = {
  workloads: {},
};

function learnBounds434(workload, samples) {
  const arr = (samples || []).map(Number).filter(n => Number.isFinite(n));
  if (arr.length === 0) return { ok: false, error: 'no samples' };
  arr.sort((a, b) => a - b);
  const p05 = arr[Math.floor(arr.length * 0.05)];
  const p95 = arr[Math.floor(arr.length * 0.95)] ?? arr[arr.length - 1];
  const bounds = { minTtl: Math.max(1000, Math.floor(p05)), maxTtl: Math.max(p95, p05 + 1000) };
  _boundsState434.workloads[workload] = bounds;
  return { ok: true, workload, ...bounds };
}

function clampTtl434(workload, ttl) {
  const b = _boundsState434.workloads[workload];
  if (!b) return ttl;
  return Math.min(b.maxTtl, Math.max(b.minTtl, ttl));
}

function wireAdaptiveTtlBounds434(app, opts, auditLog) {
  const BASE434 = '/api/v1/alerts/webhook/retry/dedup/feedback/scale/bounds';

  app.post(BASE434, (req, res) => {
    const { workload, samples } = req.body || {};
    res.json(learnBounds434(workload, samples));
  });

  app.get(BASE434 + '/status', (req, res) => {
    res.json({ version: ADAPTIVE_TTL_BOUNDS_VERSION434, ..._boundsState434 });
  });
}

module.exports = {
  ADAPTIVE_TTL_BOUNDS_VERSION434,
  learnBounds434,
  clampTtl434,
  wireAdaptiveTtlBounds434,
  _boundsState434,
};
