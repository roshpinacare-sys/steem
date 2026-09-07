'use strict';
/**
 * src/lib/dashboardAlertOverlays434.js — ECOS V434
 *
 * Feature 4: Dashboard alert overlays
 * Live alert annotations on analytics dashboard. Builds on analyticsDashboard433.
 *
 * @version 434.0.0
 */

const DASHBOARD_ALERT_OVERLAYS_VERSION434 = '434.0.0';

const _overlayState434 = {
  overlays: [],
};

function addOverlay434(overlay) {
  const o = {
    id: overlay && overlay.id ? overlay.id : 'ov_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    widgetId: overlay && overlay.widgetId,
    severity: (overlay && overlay.severity) || 'info',
    message: (overlay && overlay.message) || '',
    at: new Date().toISOString(),
  };
  _overlayState434.overlays.push(o);
  return { ok: true, overlay: o };
}

function clearOverlays434() {
  const n = _overlayState434.overlays.length;
  _overlayState434.overlays = [];
  return { ok: true, cleared: n };
}

function buildDashboardWithOverlays434() {
  let base = { ok: true, widgets: [] };
  try {
    const d433 = require('./analyticsDashboard433.js');
    base = d433.buildDashboard433();
  } catch (_) {}
  const widgetsAnnotated = (base.widgets || []).map(w => ({
    ...w,
    overlays: _overlayState434.overlays.filter(o => o.widgetId === w.id),
  }));
  return {
    ok: true,
    version: DASHBOARD_ALERT_OVERLAYS_VERSION434,
    generatedAt: new Date().toISOString(),
    widgets: widgetsAnnotated,
    overlayCount: _overlayState434.overlays.length,
  };
}

function wireDashboardAlertOverlays434(app, opts, auditLog) {
  const BASE434 = '/api/v1/chat/route/telemetry/rollup/anomalies/correlate/alerting/escalate/analytics/dashboard/overlays';

  app.post(BASE434, (req, res) => res.json(addOverlay434(req.body || {})));
  app.delete(BASE434, (req, res) => res.json(clearOverlays434()));
  app.get(BASE434, (req, res) => res.json(buildDashboardWithOverlays434()));
}

module.exports = {
  DASHBOARD_ALERT_OVERLAYS_VERSION434,
  addOverlay434,
  clearOverlays434,
  buildDashboardWithOverlays434,
  wireDashboardAlertOverlays434,
  _overlayState434,
};
