'use strict';
/**
 * src/lib/rehearsalRegressionAlerts435.js — ECOS V435
 * Feature 3: Rehearsal regression alerts — alert when scheduled dry-runs degrade.
 * @version 435.0.0
 */
const REHEARSAL_REGRESSION_ALERTS_VERSION435 = '435.0.0';
const _alertState435 = { baseline: null, alerts: [] };

function setBaseline435(durationMs) {
  _alertState435.baseline = Number(durationMs) || 0;
  return { ok: true, baseline: _alertState435.baseline };
}

function checkRegression435(currentDurationMs) {
  const cur = Number(currentDurationMs) || 0;
  const base = _alertState435.baseline;
  if (!base) return { ok: false, error: 'no baseline' };
  const delta = cur - base;
  const ratio = base ? delta / base : 0;
  const regressed = ratio > 0.25;
  const result = { current: cur, baseline: base, delta, ratio, regressed, at: new Date().toISOString() };
  if (regressed) _alertState435.alerts.push(result);
  return { ok: true, ...result };
}

function wireRehearsalRegressionAlerts435(app) {
  const BASE = '/api/v1/solvency/tower/auth/keys/bulk/rotate/rollback/dryrun/rehearse/regression';
  app.post(BASE + '/baseline', (req, res) => res.json(setBaseline435(req.body && req.body.durationMs)));
  app.post(BASE + '/check', (req, res) => res.json(checkRegression435(req.body && req.body.currentDurationMs)));
  app.get(BASE + '/status', (req, res) => res.json({ version: REHEARSAL_REGRESSION_ALERTS_VERSION435, ..._alertState435 }));
}

module.exports = { REHEARSAL_REGRESSION_ALERTS_VERSION435, setBaseline435, checkRegression435, wireRehearsalRegressionAlerts435, _alertState435 };
