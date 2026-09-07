'use strict';
/**
 * vectorMetricsAlerter424.js — ECOS V424 Feature 3
 * Emit audit events when p95 latency or hit-rate degrades beyond configurable thresholds.
 * Integrates with ThresholdDriftAlerter423.
 * R1: sacred. R2: identifiers end in 424. R3: no new npm deps.
 */

const _vectorAlerts424 = [];
const _vectorAlertConfig424 = {
  p95LatencyMaxMs: 500,
  hitRateMin: 0.7,
  checkIntervalMs: 60000,
  enabled: true,
};
const _vectorAlertStats424 = {
  checksRun: 0,
  alertsFired: 0,
  lastCheck: null,
};

const MAX_ALERTS424 = 5000;

function computeVectorAlertStatus424(metrics) {
  const alerts = [];
  if (!metrics) return alerts;

  if (metrics.p95LatencyMs !== undefined &&
      metrics.p95LatencyMs > _vectorAlertConfig424.p95LatencyMaxMs) {
    alerts.push({
      type: 'p95_latency_degraded',
      value: metrics.p95LatencyMs,
      threshold: _vectorAlertConfig424.p95LatencyMaxMs,
      severity: 'warn',
    });
  }
  if (metrics.hitRate !== undefined &&
      metrics.hitRate < _vectorAlertConfig424.hitRateMin) {
    alerts.push({
      type: 'hit_rate_degraded',
      value: metrics.hitRate,
      threshold: _vectorAlertConfig424.hitRateMin,
      severity: 'warn',
    });
  }
  return alerts;
}

function checkVectorMetrics424(metrics, auditLog = null, driftAlerter423 = null) {
  _vectorAlertStats424.checksRun++;
  _vectorAlertStats424.lastCheck = new Date().toISOString();
  const issues = computeVectorAlertStatus424(metrics);

  for (const issue of issues) {
    const entry = {
      ts: Date.now(),
      iso: _vectorAlertStats424.lastCheck,
      ...issue,
      metrics: { ...metrics },
    };
    if (_vectorAlerts424.length >= MAX_ALERTS424) _vectorAlerts424.shift();
    _vectorAlerts424.push(entry);
    _vectorAlertStats424.alertsFired++;

    if (auditLog && typeof auditLog.log === 'function') {
      auditLog.log('vector_metrics_alert424', entry);
    }
    if (driftAlerter423 && typeof driftAlerter423.check === 'function') {
      try {
        driftAlerter423.check(`vector_${issue.type}`, issue.value, issue.threshold);
      } catch (_) { /* no-op */ }
    }
  }
  return { ok: true, alertsEmitted: issues.length, issues };
}

function configureVectorAlerter424(config = {}) {
  if (config.p95LatencyMaxMs !== undefined) _vectorAlertConfig424.p95LatencyMaxMs = config.p95LatencyMaxMs;
  if (config.hitRateMin !== undefined) _vectorAlertConfig424.hitRateMin = config.hitRateMin;
  if (config.enabled !== undefined) _vectorAlertConfig424.enabled = config.enabled;
  return { ok: true, config: { ..._vectorAlertConfig424 } };
}

function getVectorAlerts424(limit = 50) {
  return {
    alerts: _vectorAlerts424.slice(-Math.min(limit, MAX_ALERTS424)),
    stats: { ..._vectorAlertStats424 },
    config: { ..._vectorAlertConfig424 },
    total: _vectorAlerts424.length,
  };
}

function wireVectorMetricsAlerter424(app, auditLog, vectorMetrics423, driftAlerter423) {
  /* POST /api/v1/vectors/metrics/alert/check */
  app.post('/api/v1/vectors/metrics/alert/check', (req, res) => {
    const { metrics } = req.body || {};
    if (!metrics) return res.status(400).json({ ok: false, error: 'metrics required' });
    const result = checkVectorMetrics424(metrics, auditLog, driftAlerter423);
    res.json(result);
  });

  /* GET /api/v1/vectors/metrics/alerts */
  app.get('/api/v1/vectors/metrics/alerts', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    res.json({ ok: true, ...getVectorAlerts424(limit) });
  });

  /* POST /api/v1/vectors/metrics/alert/config */
  app.post('/api/v1/vectors/metrics/alert/config', (req, res) => {
    const result = configureVectorAlerter424(req.body || {});
    res.json(result);
  });

  /* GET /api/v1/vectors/metrics/alert/config */
  app.get('/api/v1/vectors/metrics/alert/config', (req, res) => {
    res.json({ ok: true, config: { ..._vectorAlertConfig424 } });
  });

  /* GET /api/v1/admin/summary/v424 — admin summary endpoint */
  app.get('/api/v1/admin/summary/v424', (req, res) => {
    res.json({
      ok: true,
      version: '424.0.0',
      features: [
        'telemetryReplayDashboard424',
        'distributionAuditLedger424',
        'vectorMetricsAlerter424',
        'authKeyRotation424',
        'crossSessionTelemetryRollup424',
      ],
      vectorAlerts: _vectorAlertStats424,
    });
  });
}

if (process.env.NODE_ENV === 'test') {
  module.exports = {
    computeVectorAlertStatus424,
    checkVectorMetrics424,
    configureVectorAlerter424,
    getVectorAlerts424,
    wireVectorMetricsAlerter424,
    _vectorAlerts424,
    _vectorAlertConfig424,
    _vectorAlertStats424,
  };
} else {
  module.exports = {
    computeVectorAlertStatus424,
    checkVectorMetrics424,
    configureVectorAlerter424,
    getVectorAlerts424,
    wireVectorMetricsAlerter424,
  };
}
