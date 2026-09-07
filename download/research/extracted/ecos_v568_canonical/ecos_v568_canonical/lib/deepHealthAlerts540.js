'use strict';
/**
 * lib/deepHealthAlerts540.js — ECOS V540
 *
 * Structured Alert Export — builds on deepHealthStatus539
 * מה שV539 מחזיר כ-actionItems[] (strings), V540 מחזיר כ-alerts[] מובנים:
 *   { id, severity, category, message, fix_url, ts }
 *
 * מיועד לצריכה על-ידי מערכות monitoring חיצוניות (Datadog, PagerDuty, dashboards).
 *
 * Usage:
 *   const da = require('./lib/deepHealthAlerts540.js');
 *   da.buildAlerts540()                // [{ id, severity, category, message, fix_url }]
 *   da.registerEndpoints540(app)       // GET /api/v1/deep-health/alerts/v540
 *
 * All identifiers end in 540. Zero npm deps. Sacred untouched.
 * @module deepHealthAlerts540
 * @version 540.0.0
 */

const DEEP_HEALTH_ALERTS_VERSION_540 = '540.0.0';

// severity levels (constants end in 540 via the module name)
const SEVERITY_CRITICAL_540 = 'critical';
const SEVERITY_WARNING_540  = 'warning';
const SEVERITY_INFO_540     = 'info';

// category taxonomy
const CATEGORY_BRIDGE_540      = 'bridge';
const CATEGORY_HEARTBEAT_540   = 'heartbeat';
const CATEGORY_GOVERNANCE_540  = 'governance';
const CATEGORY_MODULE_540      = 'module';
const CATEGORY_UNKNOWN_540     = 'unknown';

// base docs URL (relative — consumers can prefix their own host)
const DOCS_BASE_URL_540 = '/docs/ecos/ops';

// ── load dep (fail-soft) ──────────────────────────────────────────────────

let _dh539 = null;
let _loadError540 = null;

try {
  _dh539 = require('./deepHealthStatus539.js');
} catch (e) {
  _loadError540 = e.message;
}

// ── helpers ───────────────────────────────────────────────────────────────

/**
 * _classifyItem540(message)
 * Derive severity + category from a plain-text actionItem string.
 * @param {string} message
 * @returns {{ severity: string, category: string, fix_url: string }}
 */
function _classifyItem540(message) {
  const m = (message || '').toLowerCase();

  // Heartbeat not running (object exists) → warning — check BEFORE generic heartbeat/bridge
  if (m.includes('heartbeat') && m.includes('hbrunning=false')) {
    return {
      severity: SEVERITY_WARNING_540,
      category: CATEGORY_HEARTBEAT_540,
      fix_url:  DOCS_BASE_URL_540 + '/heartbeat-start',
    };
  }

  // Heartbeat null/down → critical (activehb identifier, no activebridg in message)
  if (m.includes('activehb') || (m.includes('heartbeat') && (m.includes('null') || m.includes('down')) && !m.includes('activebridg'))) {
    return {
      severity: SEVERITY_CRITICAL_540,
      category: CATEGORY_HEARTBEAT_540,
      fix_url:  DOCS_BASE_URL_540 + '/heartbeat-init',
    };
  }

  // Bridge issues → critical (activeBridge or bridge532 without heartbeat being the subject)
  if (m.includes('activebridg') || m.includes('bridge532')) {
    return {
      severity: SEVERITY_CRITICAL_540,
      category: CATEGORY_BRIDGE_540,
      fix_url:  DOCS_BASE_URL_540 + '/bridge-init',
    };
  }

  // Governance dep missing → warning
  if (m.includes('governance dep') || m.includes('critical deps')) {
    return {
      severity: SEVERITY_WARNING_540,
      category: CATEGORY_GOVERNANCE_540,
      fix_url:  DOCS_BASE_URL_540 + '/governance-deps',
    };
  }

  // Module not loaded → info
  if (m.includes('not loaded') || m.includes('module not')) {
    return {
      severity: SEVERITY_INFO_540,
      category: CATEGORY_MODULE_540,
      fix_url:  DOCS_BASE_URL_540 + '/module-loading',
    };
  }

  // Snapshot-related → info
  if (m.includes('snapshot')) {
    return {
      severity: SEVERITY_INFO_540,
      category: CATEGORY_GOVERNANCE_540,
      fix_url:  DOCS_BASE_URL_540 + '/snapshot',
    };
  }

  return {
    severity: SEVERITY_INFO_540,
    category: CATEGORY_UNKNOWN_540,
    fix_url:  DOCS_BASE_URL_540 + '/general',
  };
}

/**
 * _alertId540(index, category)
 * Deterministic alert id for deduplication by monitoring systems.
 */
function _alertId540(index, category) {
  return `ecos-540-${category}-${String(index).padStart(3, '0')}`;
}

// ── public API ────────────────────────────────────────────────────────────

/**
 * buildAlerts540(diagOpts)
 * Calls buildDeepHealth539 and enriches its actionItems[] into structured alerts[].
 *
 * @param {object} [diagOpts]
 * @returns {{
 *   ok: boolean,
 *   status: string,
 *   alertCount: number,
 *   criticalCount: number,
 *   warningCount: number,
 *   infoCount: number,
 *   alerts: Array<{
 *     id: string,
 *     severity: string,
 *     category: string,
 *     message: string,
 *     fix_url: string,
 *     ts: string
 *   }>,
 *   version: string,
 *   ts: string,
 *   loadError: string|null
 * }}
 */
function buildAlerts540(diagOpts) {
  const ts540 = new Date().toISOString();

  // If dep not available, return safe stub
  if (!_dh539 || typeof _dh539.buildDeepHealth539 !== 'function') {
    return {
      ok:            false,
      status:        'degraded',
      alertCount:    1,
      criticalCount: 0,
      warningCount:  0,
      infoCount:     1,
      alerts: [{
        id:       _alertId540(0, CATEGORY_MODULE_540),
        severity: SEVERITY_INFO_540,
        category: CATEGORY_MODULE_540,
        message:  'deepHealthStatus539 module not loaded — cannot produce alerts. ' +
                  (_loadError540 || 'unknown error'),
        fix_url:  DOCS_BASE_URL_540 + '/module-loading',
        ts:       ts540,
      }],
      version:   DEEP_HEALTH_ALERTS_VERSION_540,
      ts:        ts540,
      loadError: _loadError540,
    };
  }

  // Get deep health snapshot
  let snapshot;
  try {
    snapshot = _dh539.buildDeepHealth539(diagOpts || {});
  } catch (e) {
    return {
      ok:            false,
      status:        'unhealthy',
      alertCount:    1,
      criticalCount: 1,
      warningCount:  0,
      infoCount:     0,
      alerts: [{
        id:       _alertId540(0, CATEGORY_UNKNOWN_540),
        severity: SEVERITY_CRITICAL_540,
        category: CATEGORY_UNKNOWN_540,
        message:  'buildDeepHealth539 threw: ' + e.message,
        fix_url:  DOCS_BASE_URL_540 + '/general',
        ts:       ts540,
      }],
      version:   DEEP_HEALTH_ALERTS_VERSION_540,
      ts:        ts540,
      loadError: null,
    };
  }

  const actionItems = Array.isArray(snapshot.actionItems) ? snapshot.actionItems : [];

  // Enrich each string item into a structured alert
  const alerts540 = actionItems.map((msg, i) => {
    const classification = _classifyItem540(msg);
    return {
      id:       _alertId540(i, classification.category),
      severity: classification.severity,
      category: classification.category,
      message:  msg,
      fix_url:  classification.fix_url,
      ts:       ts540,
    };
  });

  const criticalCount = alerts540.filter(a => a.severity === SEVERITY_CRITICAL_540).length;
  const warningCount  = alerts540.filter(a => a.severity === SEVERITY_WARNING_540).length;
  const infoCount     = alerts540.filter(a => a.severity === SEVERITY_INFO_540).length;

  return {
    ok:            snapshot.ok,
    status:        snapshot.status,
    alertCount:    alerts540.length,
    criticalCount,
    warningCount,
    infoCount,
    alerts:        alerts540,
    version:       DEEP_HEALTH_ALERTS_VERSION_540,
    ts:            ts540,
    loadError:     null,
  };
}

/**
 * registerEndpoints540(app) — wire HTTP endpoints
 */
function registerEndpoints540(app) {
  if (!app || typeof app.get !== 'function') return false;

  // [V540-T01] GET /api/v1/deep-health/alerts/v540
  app.get('/api/v1/deep-health/alerts/v540', (_req, res) => {
    try {
      res.json(buildAlerts540());
    } catch (e) {
      res.status(500).json({
        ok: false, error: e.message, version: DEEP_HEALTH_ALERTS_VERSION_540,
      });
    }
  });

  // [V540-T02] GET /api/v1/admin/summary/v540
  app.get('/api/v1/admin/summary/v540', (_req, res) => {
    res.json({
      version:   DEEP_HEALTH_ALERTS_VERSION_540,
      status:    'ok',
      endpoints: [
        'V540-T01 GET /api/v1/deep-health/alerts/v540',
        'V540-T02 GET /api/v1/admin/summary/v540',
      ],
      module:   'deepHealthAlerts540',
      connects: ['deepHealthStatus539', 'aggregatedHeartbeatStatus538', 'governanceDiagnose533'],
    });
  });

  return true;
}

module.exports = {
  DEEP_HEALTH_ALERTS_VERSION_540,
  SEVERITY_CRITICAL_540,
  SEVERITY_WARNING_540,
  SEVERITY_INFO_540,
  CATEGORY_BRIDGE_540,
  CATEGORY_HEARTBEAT_540,
  CATEGORY_GOVERNANCE_540,
  CATEGORY_MODULE_540,
  buildAlerts540,
  registerEndpoints540,
  // exposed for testing
  _classifyItem540,
};
