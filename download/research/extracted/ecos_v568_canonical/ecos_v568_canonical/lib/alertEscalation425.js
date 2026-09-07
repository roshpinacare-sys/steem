'use strict';
/**
 * alertEscalation425.js — ECOS V425 Feature 3
 * Escalates vector metrics alerts when they fire >N times within M minutes.
 * Supports operator webhook escalation. Emits audit events on escalation.
 * R1: sacred files untouched. R2: all identifiers end in 425. R3: no new npm deps.
 */

const { createHash } = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const ALERT_ESCALATION_VERSION425 = '425.0.0';
const DEFAULT_THRESHOLD_COUNT425 = 3;
const DEFAULT_WINDOW_MS425 = 5 * 60 * 1000;   // 5 minutes
const MAX_ESCALATION_LOG425 = 500;

const _escalationState425 = {
  alertWindow: [],          // recent alert timestamps
  escalations: [],          // escalation log
  config: {
    thresholdCount: DEFAULT_THRESHOLD_COUNT425,
    windowMs: DEFAULT_WINDOW_MS425,
    webhookUrl: null,
    enabled: true,
  },
  stats: {
    alertsReceived: 0,
    escalationsTriggered: 0,
    webhookSuccess: 0,
    webhookFailure: 0,
  },
};

function configureEscalation425(opts = {}) {
  if (opts.thresholdCount !== undefined) _escalationState425.config.thresholdCount = parseInt(opts.thresholdCount, 10);
  if (opts.windowMs !== undefined) _escalationState425.config.windowMs = parseInt(opts.windowMs, 10);
  if (opts.webhookUrl !== undefined) _escalationState425.config.webhookUrl = opts.webhookUrl;
  if (opts.enabled !== undefined) _escalationState425.config.enabled = Boolean(opts.enabled);
  return { ok: true, config: { ..._escalationState425.config } };
}

function _pruneWindow425(now) {
  const cutoff = now - _escalationState425.config.windowMs;
  _escalationState425.alertWindow = _escalationState425.alertWindow.filter(t => t >= cutoff);
}

function _buildEscalationId425(alertType) {
  return createHash('sha256')
    .update(alertType + Date.now())
    .digest('hex')
    .slice(0, 16);
}

function _sendWebhook425(payload, webhookUrl) {
  try {
    const body = JSON.stringify(payload);
    const parsed = new URL(webhookUrl);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      _escalationState425.stats.webhookSuccess++;
    });
    req.on('error', () => { _escalationState425.stats.webhookFailure++; });
    req.setTimeout(5000, () => { req.destroy(); _escalationState425.stats.webhookFailure++; });
    req.write(body);
    req.end();
  } catch (_) {
    _escalationState425.stats.webhookFailure++;
  }
}

/**
 * recordAlert425(alertType, alertData, auditLog) — records an alert and checks
 * if escalation threshold has been reached. Returns { escalated, escalationId? }.
 */
function recordAlert425(alertType = 'vector_metrics', alertData = {}, auditLog = null) {
  if (!_escalationState425.config.enabled) return { escalated: false };
  _escalationState425.stats.alertsReceived++;
  const now = Date.now();
  _pruneWindow425(now);
  _escalationState425.alertWindow.push(now);

  const windowCount = _escalationState425.alertWindow.length;
  if (windowCount < _escalationState425.config.thresholdCount) {
    return { escalated: false, windowCount };
  }

  const escalationId = _buildEscalationId425(alertType);
  const escalation = {
    escalationId,
    alertType,
    windowCount,
    thresholdCount: _escalationState425.config.thresholdCount,
    windowMs: _escalationState425.config.windowMs,
    alertData,
    ts: new Date().toISOString(),
    ecosVersion: 'V425',
  };

  if (_escalationState425.escalations.length >= MAX_ESCALATION_LOG425) {
    _escalationState425.escalations.shift();
  }
  _escalationState425.escalations.push(escalation);
  _escalationState425.stats.escalationsTriggered++;

  // Clear window to avoid repeated escalation spam
  _escalationState425.alertWindow = [];

  if (auditLog && typeof auditLog.log === 'function') {
    auditLog.log('alert.escalation425', escalation);
  }

  if (_escalationState425.config.webhookUrl) {
    _sendWebhook425(escalation, _escalationState425.config.webhookUrl);
  }

  return { escalated: true, escalationId };
}

function getEscalationStatus425() {
  return {
    config: { ..._escalationState425.config, webhookUrl: _escalationState425.config.webhookUrl ? '[REDACTED]' : null },
    stats: { ..._escalationState425.stats },
    windowCount: _escalationState425.alertWindow.length,
    recentEscalations: _escalationState425.escalations.slice(-10),
  };
}

function getEscalationLog425(limit = 50) {
  return _escalationState425.escalations.slice(-Math.abs(limit));
}

function wireAlertEscalation425(app, auditLog, vectorMetricsAlerter424Instance) {
  /* POST /api/v1/alerts/escalation/config */
  app.post('/api/v1/alerts/escalation/config', (req, res) => {
    try {
      const result = configureEscalation425(req.body || {});
      res.json({ ok: true, ecosVersion: 'V425', ...result });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message, ecosVersion: 'V425' });
    }
  });

  /* GET /api/v1/alerts/escalation/config */
  app.get('/api/v1/alerts/escalation/config', (_req, res) => {
    const cfg = { ..._escalationState425.config };
    cfg.webhookUrl = cfg.webhookUrl ? '[REDACTED]' : null;
    res.json({ ok: true, ecosVersion: 'V425', config: cfg });
  });

  /* POST /api/v1/alerts/escalation/record */
  app.post('/api/v1/alerts/escalation/record', (req, res) => {
    try {
      const b = req.body || {};
      const result = recordAlert425(b.alertType || 'vector_metrics', b.alertData || {}, auditLog);
      res.json({ ok: true, ecosVersion: 'V425', ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V425' });
    }
  });

  /* GET /api/v1/alerts/escalation/status */
  app.get('/api/v1/alerts/escalation/status', (_req, res) => {
    res.json({ ok: true, ecosVersion: 'V425', ...getEscalationStatus425() });
  });

  /* GET /api/v1/alerts/escalation/log */
  app.get('/api/v1/alerts/escalation/log', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 50;
    const entries = getEscalationLog425(limit);
    res.json({ ok: true, ecosVersion: 'V425', count: entries.length, entries });
  });

  /* GET /api/v1/admin/summary/v425 */
  app.get('/api/v1/admin/summary/v425', (_req, res) => {
    res.json({
      ok: true,
      ecosVersion: 'V425',
      features: [
        'dashboardPersistence425 — dashboard render history JSONL WAL + time-range queries',
        'auditLedgerExport425 — distribution audit export as CSV / NDJSON',
        'alertEscalation425 — vector metrics alert escalation with webhook',
        'keyExpiry425 — auth key TTL with auto-removal and audit events',
        'rollupDiffApi425 — rollup bucket diff showing intent share drift and latency change',
      ],
      version: ALERT_ESCALATION_VERSION425,
    });
  });
}

if (process.env.NODE_ENV === 'test') {
  module.exports = {
    configureEscalation425,
    recordAlert425,
    getEscalationStatus425,
    getEscalationLog425,
    wireAlertEscalation425,
    ALERT_ESCALATION_VERSION425,
    _escalationState425,
  };
} else {
  module.exports = {
    configureEscalation425,
    recordAlert425,
    getEscalationStatus425,
    getEscalationLog425,
    wireAlertEscalation425,
    ALERT_ESCALATION_VERSION425,
  };
}
