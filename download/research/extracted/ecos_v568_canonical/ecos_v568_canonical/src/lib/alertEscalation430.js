'use strict';
/**
 * src/lib/alertEscalation430.js — ECOS V430
 *
 * Feature 4: Alert escalation
 * Escalate alerts if not acknowledged.
 *
 * @version 430.0.0
 */

const ALERT_ESCALATION_VERSION430 = '430.0.0';

const _escalationState430 = {
  pending: new Map(),
  escalationIntervalMs: 300000, // 5 mins
  stats: {
    totalEscalations: 0,
  },
};

function trackForEscalation430(alertId, data) {
  _escalationState430.pending.set(alertId, {
    ts: Date.now(),
    data,
    escalated: false,
  });
}

function acknowledgeAlert430(alertId) {
  return _escalationState430.pending.delete(alertId);
}

function wireAlertEscalation430(app, opts, auditLog) {
  const BASE430 = '/api/v1/chat/route/telemetry/rollup/anomalies/correlate/alerting/escalate';

  app.post(BASE430 + '/ack', (req, res) => {
    const { alertId } = req.body;
    const ok = acknowledgeAlert430(alertId);
    res.json({ ok, alertId });
  });

  app.get(BASE430 + '/pending', (req, res) => {
    res.json({ count: _escalationState430.pending.size });
  });
}

module.exports = {
  ALERT_ESCALATION_VERSION430,
  trackForEscalation430,
  acknowledgeAlert430,
  wireAlertEscalation430,
};
