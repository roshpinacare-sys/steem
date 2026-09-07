'use strict';
  /**
   * anomalyAlertIntegration427.js — ECOS V427 Feature 4
   * When scanAllBuckets426 finds anomalies, automatically enqueues a webhook
   * alert via webhookRetryQueue426 and escalates via alertEscalation425.
   * R1: sacred files untouched. R2: all identifiers end in 427. R3: no new npm deps.
   */

  const { createHash } = require('crypto');

  const ANOMALY_ALERT_VERSION427 = '427.0.0';
  const MAX_INTEGRATION_LOG427 = 500;

  const _integrationState427 = {
    config: {
      enabled: true,
      alertWebhookUrl: null,
      autoEscalate: true,
      minSeverity: 'medium',   // 'medium' | 'high'
      alertOnEmpty: false,
    },
    log: [],
    stats: {
      scansTriggered: 0,
      alertsEnqueued: 0,
      escalationsTriggered: 0,
      anomaliesFound: 0,
      version: ANOMALY_ALERT_VERSION427,
    },
  };

  function _appendIntegrationLog427(entry) {
    if (_integrationState427.log.length >= MAX_INTEGRATION_LOG427) _integrationState427.log.shift();
    _integrationState427.log.push(entry);
  }

  /**
   * configureAnomalyAlertIntegration427(opts) — configure the integration settings.
   */
  function configureAnomalyAlertIntegration427(opts = {}) {
    if (opts.enabled !== undefined) _integrationState427.config.enabled = Boolean(opts.enabled);
    if (opts.alertWebhookUrl !== undefined) _integrationState427.config.alertWebhookUrl = opts.alertWebhookUrl;
    if (opts.autoEscalate !== undefined) _integrationState427.config.autoEscalate = Boolean(opts.autoEscalate);
    if (opts.minSeverity !== undefined) {
      if (!['medium', 'high'].includes(opts.minSeverity)) throw new Error('minSeverity must be medium or high');
      _integrationState427.config.minSeverity = opts.minSeverity;
    }
    if (opts.alertOnEmpty !== undefined) _integrationState427.config.alertOnEmpty = Boolean(opts.alertOnEmpty);
    return { ok: true, config: { ..._integrationState427.config } };
  }

  /**
   * scanAndAlert427(scanAllBucketsResult, deps) — process scan result and trigger alerts.
   * deps: { enqueueWebhookRetry426, recordAlert425, auditLog }
   */
  function scanAndAlert427(scanResult, deps = {}, auditLog = null) {
    if (!_integrationState427.config.enabled) {
      return { ok: true, skipped: true, reason: 'integration disabled' };
    }
    if (!scanResult) throw new Error('scanResult required');

    _integrationState427.stats.scansTriggered++;

    const totalAnomalies = scanResult.totalAnomalies || 0;
    const detections = scanResult.detections || [];

    // Filter by minSeverity
    const minSev = _integrationState427.config.minSeverity;
    const filteredDetections = detections.filter(d =>
      (d.anomalies || []).some(a =>
        minSev === 'high' ? a.severity === 'high' : true
      )
    );

    const alertId427 = createHash('sha256')
      .update('anomaly_alert427' + Date.now())
      .digest('hex').slice(0, 16);

    let alertsEnqueued = 0;
    let escalated = false;

    if (filteredDetections.length > 0 || (totalAnomalies === 0 && _integrationState427.config.alertOnEmpty)) {
      _integrationState427.stats.anomaliesFound += totalAnomalies;

      const alertPayload = {
        alertId427,
        source: 'anomaly_alert_integration427',
        ecosVersion: 'V427',
        ts: new Date().toISOString(),
        totalAnomalies,
        filteredDetectionCount: filteredDetections.length,
        granularity: scanResult.granularity || 'daily',
        topAnomalies: filteredDetections.slice(0, 5).map(d => ({
          label: d.label,
          anomalyCount: d.anomalyCount,
          highSeverityCount: (d.anomalies || []).filter(a => a.severity === 'high').length,
        })),
      };

      // Enqueue webhook retry if configured
      if (deps.enqueueWebhookRetry426 && _integrationState427.config.alertWebhookUrl) {
        try {
          deps.enqueueWebhookRetry426(
            _integrationState427.config.alertWebhookUrl,
            alertPayload,
            { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 30000 },
            auditLog
          );
          alertsEnqueued++;
          _integrationState427.stats.alertsEnqueued++;
        } catch (e) {
          _appendIntegrationLog427({ event: 'enqueue_failed427', error: e.message, ts: new Date().toISOString() });
        }
      }

      // Auto-escalate via alertEscalation425 if configured
      if (_integrationState427.config.autoEscalate && deps.recordAlert425) {
        try {
          const escResult = deps.recordAlert425('anomaly_integration427', alertPayload, auditLog);
          escalated = !!(escResult && escResult.escalated);
          if (escalated) _integrationState427.stats.escalationsTriggered++;
        } catch (e) {
          _appendIntegrationLog427({ event: 'escalation_failed427', error: e.message, ts: new Date().toISOString() });
        }
      }

      if (auditLog && typeof auditLog.log === 'function') {
        auditLog.log('anomaly_alert_triggered427', {
          alertId427,
          totalAnomalies,
          alertsEnqueued,
          escalated,
        });
      }
    }

    const logEntry = {
      event: 'scan_and_alert427',
      alertId427,
      totalAnomalies,
      filteredDetections: filteredDetections.length,
      alertsEnqueued,
      escalated,
      ts: new Date().toISOString(),
    };
    _appendIntegrationLog427(logEntry);

    return {
      ok: true,
      alertId427,
      version: ANOMALY_ALERT_VERSION427,
      totalAnomalies,
      filteredDetections: filteredDetections.length,
      alertsEnqueued,
      escalated,
      skipped: false,
    };
  }

  function getIntegrationStatus427() {
    return {
      version: ANOMALY_ALERT_VERSION427,
      config: { ..._integrationState427.config },
      stats: { ..._integrationState427.stats },
    };
  }

  function getIntegrationLog427(limit = 50) {
    return _integrationState427.log.slice(-Math.min(limit, MAX_INTEGRATION_LOG427));
  }

  function wireAnomalyAlertIntegration427(app, deps = {}, auditLog = null) {
    // deps: { scanAllBuckets426, enqueueWebhookRetry426, recordAlert425, rollupStore }

    /* POST /api/v1/chat/route/telemetry/rollup/anomalies/integrate/scan */
    app.post('/api/v1/chat/route/telemetry/rollup/anomalies/integrate/scan', (req, res) => {
      try {
        const { granularity = 'daily' } = req.body || {};
        let scanResult;
        if (deps.scanAllBuckets426 && deps.rollupStore) {
          scanResult = deps.scanAllBuckets426(deps.rollupStore, granularity, auditLog);
        } else {
          scanResult = { ok: true, totalAnomalies: 0, detections: [], granularity };
        }
        const alertResult = scanAndAlert427(scanResult, deps, auditLog);
        res.json({ ok: true, ecosVersion: 'V427', scan: scanResult, alert: alertResult });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V427' });
      }
    });

    /* POST /api/v1/chat/route/telemetry/rollup/anomalies/integrate/configure */
    app.post('/api/v1/chat/route/telemetry/rollup/anomalies/integrate/configure', (req, res) => {
      try {
        const result = configureAnomalyAlertIntegration427(req.body || {});
        res.json({ ok: true, ecosVersion: 'V427', ...result });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message, ecosVersion: 'V427' });
      }
    });

    /* GET /api/v1/chat/route/telemetry/rollup/anomalies/integrate/status */
    app.get('/api/v1/chat/route/telemetry/rollup/anomalies/integrate/status', (_req, res) => {
      res.json({ ok: true, ecosVersion: 'V427', ...getIntegrationStatus427() });
    });

    /* GET /api/v1/chat/route/telemetry/rollup/anomalies/integrate/log */
    app.get('/api/v1/chat/route/telemetry/rollup/anomalies/integrate/log', (req, res) => {
      const limit = parseInt(req.query.limit, 10) || 50;
      const log = getIntegrationLog427(limit);
      res.json({ ok: true, ecosVersion: 'V427', count: log.length, log });
    });
  }

  if (process.env.NODE_ENV === 'test') {
    module.exports = {
      configureAnomalyAlertIntegration427,
      scanAndAlert427,
      getIntegrationStatus427,
      getIntegrationLog427,
      wireAnomalyAlertIntegration427,
      ANOMALY_ALERT_VERSION427,
      _integrationState427,
    };
  } else {
    module.exports = {
      configureAnomalyAlertIntegration427,
      scanAndAlert427,
      getIntegrationStatus427,
      getIntegrationLog427,
      wireAnomalyAlertIntegration427,
      ANOMALY_ALERT_VERSION427,
    };
  }
  