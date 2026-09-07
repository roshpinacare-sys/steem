'use strict';
/**
 * src/lib/adaptiveTtl430.js — ECOS V430
 *
 * Feature 2: Adaptive TTL
 * Adjust dedup TTL based on queue pressure.
 *
 * @version 430.0.0
 */

const ADAPTIVE_TTL_VERSION430 = '430.0.0';

const _adaptiveTtlState430 = {
  enabled: false,
  baseTtlMs: 86400000,
  pressureThreshold: 1000,
  stats: {
    adjustments: 0,
  },
};

function computeAdaptiveTtl430(queueSize) {
  if (!_adaptiveTtlState430.enabled) return _adaptiveTtlState430.baseTtlMs;
  
  let multiplier = 1;
  if (queueSize > _adaptiveTtlState430.pressureThreshold) {
    multiplier = 0.5; // Reduce TTL under pressure to free memory
    _adaptiveTtlState430.stats.adjustments++;
  }
  
  return _adaptiveTtlState430.baseTtlMs * multiplier;
}

function wireAdaptiveTtl430(app, opts, auditLog) {
  const BASE430 = '/api/v1/alerts/webhook/retry/dedup/adaptive';

  app.post(BASE430 + '/configure', (req, res) => {
    const o = req.body || {};
    if (o.enabled !== undefined) _adaptiveTtlState430.enabled = !!o.enabled;
    if (o.baseTtlMs) _adaptiveTtlState430.baseTtlMs = o.baseTtlMs;
    res.json({ ok: true, config: _adaptiveTtlState430 });
  });

  app.get(BASE430 + '/status', (req, res) => {
    res.json({ version: ADAPTIVE_TTL_VERSION430, ..._adaptiveTtlState430 });
  });
}

module.exports = {
  ADAPTIVE_TTL_VERSION430,
  computeAdaptiveTtl430,
  wireAdaptiveTtl430,
};
