'use strict';
/**
 * src/lib/correlationAlerting429.js — ECOS V429
 *
 * Feature 4: Correlation Threshold Alerting
 * Auto-enqueue webhook alerts when correlation score exceeds threshold.
 *
 * Functions:
 *   configureCorrelationAlerting429(opts)      — set threshold, enabled, webhookUrl
 *   checkAndAlertCorrelation429(result, deps)  — check score and trigger alert
 *   getCorrelationAlertingStatus429()          — config + stats
 *   wireCorrelationAlerting429(app, opts, auditLog) — registers HTTP endpoints
 *
 * Endpoints: CORRALERT01–CORRALERT04 (4 endpoints)
 *
 * @version 429.0.0
 * R1: Sacred untouched. R2: All identifiers end in 429. R3: No new npm deps.
 */

const crypto = require('crypto');

const CORRELATION_ALERTING_VERSION429 = '429.0.0';
const DEFAULT_CORRELATION_THRESHOLD429 = 0.8;

const _corrAlertState429 = {
  enabled:      false,
  threshold:    DEFAULT_CORRELATION_THRESHOLD429,
  webhookUrl:   null,
  log:          [],
  stats: {
    totalChecks:  0,
    totalAlerts:  0,
    totalErrors:  0,
  },
};

function _corrAlertLog429(event, data) {
  const entry = { ts: new Date().toISOString(), event, ...data };
  _corrAlertState429.log.push(entry);
  if (_corrAlertState429.log.length > 200) _corrAlertState429.log.shift();
}

function configureCorrelationAlerting429(opts) {
  const o = opts || {};
  if (o.enabled !== undefined) _corrAlertState429.enabled = Boolean(o.enabled);
  if (o.threshold !== undefined) {
    if (typeof o.threshold !== 'number' || o.threshold < 0 || o.threshold > 1) {
      throw new Error('correlationAlerting429: threshold must be between 0 and 1');
    }
    _corrAlertState429.threshold = o.threshold;
  }
  if (o.webhookUrl !== undefined) _corrAlertState429.webhookUrl = o.webhookUrl;
  
  _corrAlertLog429('configured429', { 
    enabled: _corrAlertState429.enabled, 
    threshold: _corrAlertState429.threshold,
    webhookUrl: _corrAlertState429.webhookUrl 
  });
  return { ok: true, config: { ..._corrAlertState429 } };
}

function checkAndAlertCorrelation429(result, deps) {
  if (!result || typeof result.score !== 'number') return { ok: false, reason: 'invalid result' };
  
  _corrAlertState429.stats.totalChecks++;
  
  if (!_corrAlertState429.enabled) return { ok: true, alerted: false, reason: 'disabled' };
  if (result.score < _corrAlertState429.threshold) return { ok: true, alerted: false, reason: 'below threshold' };

  const d = deps || {};
  const alertId429 = 'calert429_' + crypto.randomBytes(8).toString('hex');
  const alertedAt = new Date().toISOString();

  let enqueued = false;
  if (_corrAlertState429.webhookUrl && typeof d.enqueueWebhookRetry426 === 'function') {
    try {
      d.enqueueWebhookRetry426(_corrAlertState429.webhookUrl, {
        type: 'high_correlation_alert429',
        alertId429,
        correlationId: result.correlationId428,
        score: result.score,
        ts: alertedAt,
      });
      enqueued = true;
    } catch (e) {
      _corrAlertState429.stats.totalErrors++;
      _corrAlertLog429('alert_enqueue_error429', { error: e.message });
    }
  }

  _corrAlertState429.stats.totalAlerts++;
  _corrAlertLog429('alert_triggered429', { alertId429, correlationId: result.correlationId428, score: result.score });

  if (d.auditLog && typeof d.auditLog.append === 'function') {
    d.auditLog.append({ type: 'correlation_alert429', alertId429, correlationId: result.correlationId428, score: result.score });
  }

  return { ok: true, alerted: true, alertId429, enqueued };
}

function getCorrelationAlertingStatus429() {
  return {
    version: CORRELATION_ALERTING_VERSION429,
    config: {
      enabled: _corrAlertState429.enabled,
      threshold: _corrAlertState429.threshold,
      webhookUrl: _corrAlertState429.webhookUrl,
    },
    stats: { ..._corrAlertState429.stats },
  };
}

function wireCorrelationAlerting429(app, opts, auditLog) {
  const o = opts || {};
  configureCorrelationAlerting429(o);

  let enqueueWebhookRetry426 = null;
  try {
    const w426 = require('./webhookRetryQueue426.js');
    if (w426.enqueueWebhookRetry426) enqueueWebhookRetry426 = w426.enqueueWebhookRetry426;
  } catch (_) {}

  const BASE429 = '/api/v1/chat/route/telemetry/rollup/anomalies/correlate/alerting';

  app.get(BASE429 + '/status', (req, res) => {
    try {
      res.json(getCorrelationAlertingStatus429());
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post(BASE429 + '/configure', (req, res) => {
    try {
      const result = configureCorrelationAlerting429(req.body);
      res.json(result);
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  // Manual trigger for testing
  app.post(BASE429 + '/test', (req, res) => {
    try {
      const result = checkAndAlertCorrelation429(req.body, { enqueueWebhookRetry426, auditLog });
      res.json(result);
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });
}

module.exports = {
  CORRELATION_ALERTING_VERSION429,
  configureCorrelationAlerting429,
  checkAndAlertCorrelation429,
  getCorrelationAlertingStatus429,
  wireCorrelationAlerting429,
};
