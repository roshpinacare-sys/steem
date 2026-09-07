'use strict';
/**
 * src/lib/predictiveTtlScaling433.js — ECOS V433
 *
 * Feature 2: Predictive TTL scaling
 * Scale TTL based on predicted load.
 *
 * @version 433.0.0
 */

const PREDICTIVE_TTL_SCALING_VERSION433 = '433.0.0';

const _scaleState433 = {
  baseTtl: 86400000,
  currentTtl: 86400000,
};

function scaleTtl433(predictedLoad) {
  // load in [0,1]; high load -> longer TTL (less churn), low load -> shorter
  const factor = 0.5 + Number(predictedLoad || 0);
  _scaleState433.currentTtl = Math.floor(_scaleState433.baseTtl * factor);
  return _scaleState433.currentTtl;
}

function wirePredictiveTtlScaling433(app, opts, auditLog) {
  const BASE433 = '/api/v1/alerts/webhook/retry/dedup/feedback/scale';

  app.post(BASE433, (req, res) => {
    const { predictedLoad } = req.body || {};
    res.json({ ok: true, newTtl: scaleTtl433(predictedLoad) });
  });

  app.get(BASE433 + '/status', (req, res) => {
    res.json({ version: PREDICTIVE_TTL_SCALING_VERSION433, ..._scaleState433 });
  });
}

module.exports = {
  PREDICTIVE_TTL_SCALING_VERSION433,
  scaleTtl433,
  wirePredictiveTtlScaling433,
  _scaleState433,
};
