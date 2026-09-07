'use strict';
/**
 * src/lib/healthDrivenEscalation437.js — ECOS V437
 *
 * Feature: Health-Driven Auto-Escalation
 * Connects region health scoring (V435), TTL drift detection (V435),
 * rehearsal regression alerts (V435) with multi-channel escalation (V431).
 * When any monitored subsystem reports critical status, auto-escalates via
 * multiChannelEscalation431 so humans are paged immediately.
 *
 * R1: sacred files untouched. R2: all identifiers end in 437. R3: no new npm deps.
 *
 * @version 437.0.0
 */

const HEALTH_DRIVEN_ESCALATION_VERSION437 = '437.0.0';

const _escalationLog437 = [];
const MAX_LOG437 = 200;

/**
 * evaluateHealthEscalation437({ regions, driftWorkloads, alertCount }, threshold)
 * → { ok, escalated, reasons, details }
 */
function evaluateHealthEscalation437(input, threshold) {
  const reasons = [];
  const details = {};
  let escalated = false;

  // 1. Region health check
  const regions = (input && input.regions) || [];
  if (regions.length) {
    let ranked = [];
    try {
      const r435 = require('./regionHealthScoring435.js');
      ranked = (r435.rankRegions435(regions).ranked) || [];
    } catch (_) {}
    const best = ranked.length ? ranked[0].score : 0;
    details.bestRegionScore = best;
    const th = Number.isFinite(Number(threshold)) ? Number(threshold) : 50;
    if (best < th) {
      reasons.push('region_health_critical');
      escalated = true;
    }
  }

  // 2. TTL drift check — look at recent detections for any drifted workload
  const driftWorkloads = (input && input.driftWorkloads) || [];
  if (driftWorkloads.length) {
    let driftedCount = 0;
    try {
      const d435 = require('./ttlBoundsDriftDetection435.js');
      const detections = (d435._driftState435 && d435._driftState435.detections) || [];
      const recent = detections.slice(-50);
      for (const w of driftWorkloads) {
        if (recent.some(d => d.workload === w && d.drifted)) driftedCount++;
      }
    } catch (_) {}
    details.driftedWorkloads = driftedCount;
    if (driftedCount > 0) {
      reasons.push('ttl_drift_detected');
      escalated = true;
    }
  }

  // 3. Rehearsal regression alerts check
  const alertCount = (input && input.alertCount) || 0;
  let actualAlertCount = alertCount;
  try {
    const a435 = require('./rehearsalRegressionAlerts435.js');
    actualAlertCount = (a435._alertState435 && a435._alertState435.alerts.length) || 0;
  } catch (_) {}
  details.openRegressionAlerts = actualAlertCount;
  if (actualAlertCount > 0) {
    reasons.push('regression_alerts_open');
    escalated = true;
  }

  // 4. Escalate if any reason
  if (escalated) {
    let escResult = { ok: false };
    try {
      const m431 = require('./multiChannelEscalation431.js');
      escResult = m431.triggerMultiChannelEscalation431({
        type: 'health_driven_escalation',
        reasons,
        details,
        at: new Date().toISOString(),
      });
    } catch (_) {}
    details.escalation = escResult;
  }

  const entry = {
    at: new Date().toISOString(),
    escalated,
    reasons,
    details,
  };
  _escalationLog437.push(entry);
  if (_escalationLog437.length > MAX_LOG437) _escalationLog437.shift();

  return { ok: true, escalated, reasons, details };
}

function wireHealthDrivenEscalation437(app) {
  if (!app) return;

  // V437-T01 POST /api/v1/health/escalate/check
  app.post('/api/v1/health/escalate/check', (req, res) => {
    try {
      const body = req.body || {};
      const result = evaluateHealthEscalation437(body, body.threshold);
      res.status(result.escalated ? 201 : 200).json({ ok: true, ecosVersion: 'V437', ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V437' });
    }
  });

  // V437-T02 GET /api/v1/admin/summary/v437
  app.get('/api/v1/admin/summary/v437', (_req, res) => {
    res.json({
      ok: true,
      ecosVersion: 'V437',
      version: HEALTH_DRIVEN_ESCALATION_VERSION437,
      feature: 'health-driven-auto-escalation',
      connects: [
        'regionHealthScoring435',
        'ttlBoundsDriftDetection435',
        'rehearsalRegressionAlerts435',
        'multiChannelEscalation431',
      ],
      logSize: _escalationLog437.length,
      lastEntries: _escalationLog437.slice(-5),
    });
  });
}

module.exports = {
  HEALTH_DRIVEN_ESCALATION_VERSION437,
  evaluateHealthEscalation437,
  wireHealthDrivenEscalation437,
  _escalationLog437,
};
