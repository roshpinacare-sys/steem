'use strict';
/**
 * src/lib/deepHealthAlertFilter541.js — ECOS V541 (Phase P429)
 *
 * Alert Severity + Category Query-Param Filtering
 * בנוי על-גבי deepHealthAlerts540.buildAlerts540() — read-only, 0 state חדש.
 *
 * Query params (כולם אופציונאליים, ניתן לשלב):
 *   ?severity=critical|warning|info      (מסנן לפי severity אחת)
 *   ?category=bridge|heartbeat|governance|module|unknown
 *   ?limit=N                              (מגביל כמות alerts בתגובה, max 500)
 *
 * endpoints:
 *   V541-T01  GET /api/v1/deep-health/alerts/v541          (עם filtering)
 *   V541-T02  GET /api/v1/deep-health/alert-filter/schema  (schema של params)
 *   V541-T03  GET /api/v1/admin/summary/v541
 *
 * כל מזהה מסתיים ב-541. אפס תלויות npm. SACRED לא נגע.
 * @module deepHealthAlertFilter541
 * @version 541.0.0
 */

const ALERT_FILTER_VERSION_541 = '541.0.0';

const VALID_SEVERITIES_541 = new Set(['critical', 'warning', 'info']);
const VALID_CATEGORIES_541 = new Set(['bridge', 'heartbeat', 'governance', 'module', 'unknown']);
const FILTER_LIMIT_MAX_541  = 500;
const FILTER_LIMIT_DEFAULT_541 = 500;

// ── load dep (fail-soft) ──────────────────────────────────────────────────
let _da540 = null;
let _loadError541 = null;
try {
  _da540 = require('./deepHealthAlerts540.js');
} catch (e) {
  _loadError541 = e.message;
}

// ── core filter logic ─────────────────────────────────────────────────────

/**
 * _parseFilterParams541(query)
 * Parses + validates query params. Returns { severity, category, limit, errors[] }.
 * fail-closed: unknown param value → include in errors, ignore filter.
 */
function _parseFilterParams541(query) {
  const q = query || {};
  const errors541 = [];

  // severity
  let severity541 = null;
  if (q.severity !== undefined) {
    const sv = String(q.severity).toLowerCase().trim();
    if (VALID_SEVERITIES_541.has(sv)) {
      severity541 = sv;
    } else {
      errors541.push(`unknown severity "${q.severity}" — valid: critical|warning|info`);
    }
  }

  // category
  let category541 = null;
  if (q.category !== undefined) {
    const cv = String(q.category).toLowerCase().trim();
    if (VALID_CATEGORIES_541.has(cv)) {
      category541 = cv;
    } else {
      errors541.push(`unknown category "${q.category}" — valid: bridge|heartbeat|governance|module|unknown`);
    }
  }

  // limit
  let limit541 = FILTER_LIMIT_DEFAULT_541;
  if (q.limit !== undefined) {
    const lv = parseInt(q.limit, 10);
    if (!Number.isFinite(lv) || lv < 1) {
      errors541.push(`invalid limit "${q.limit}" — must be integer >= 1`);
    } else {
      limit541 = Math.min(lv, FILTER_LIMIT_MAX_541);
    }
  }

  return { severity: severity541, category: category541, limit: limit541, errors: errors541 };
}

/**
 * filterAlerts541(alerts, params)
 * Applies parsed filter params to an alerts array.
 * @param {Array} alerts
 * @param {{ severity: string|null, category: string|null, limit: number }} params
 * @returns {Array}
 */
function filterAlerts541(alerts, params) {
  if (!Array.isArray(alerts)) return [];
  let result = alerts;
  if (params.severity) result = result.filter(a => a.severity === params.severity);
  if (params.category) result = result.filter(a => a.category === params.category);
  return result.slice(0, params.limit);
}

/**
 * buildFilteredAlerts541(query)
 * Full pipeline: build → parse params → filter → return enriched response.
 */
function buildFilteredAlerts541(query) {
  // If dep missing — return degraded response
  if (!_da540 || typeof _da540.buildAlerts540 !== 'function') {
    return {
      ok:            false,
      status:        'degraded',
      alertCount:    0,
      criticalCount: 0,
      warningCount:  0,
      infoCount:     0,
      alerts:        [],
      filters:       {},
      filterErrors:  [],
      version:       ALERT_FILTER_VERSION_541,
      ts:            new Date().toISOString(),
      loadError:     _loadError541 || 'deepHealthAlerts540 not loaded',
    };
  }

  const params541 = _parseFilterParams541(query);

  // Build full alert set from V540
  let base;
  try {
    base = _da540.buildAlerts540();
  } catch (e) {
    return {
      ok:            false,
      status:        'error',
      alertCount:    0,
      criticalCount: 0,
      warningCount:  0,
      infoCount:     0,
      alerts:        [],
      filters:       params541,
      filterErrors:  [`buildAlerts540 threw: ${e.message}`],
      version:       ALERT_FILTER_VERSION_541,
      ts:            new Date().toISOString(),
      loadError:     null,
    };
  }

  const filtered = filterAlerts541(base.alerts || [], params541);

  return {
    ok:            base.ok,
    status:        base.status,
    alertCount:    filtered.length,
    totalAlerts:   (base.alerts || []).length,
    criticalCount: filtered.filter(a => a.severity === 'critical').length,
    warningCount:  filtered.filter(a => a.severity === 'warning').length,
    infoCount:     filtered.filter(a => a.severity === 'info').length,
    alerts:        filtered,
    filters: {
      severity: params541.severity,
      category: params541.category,
      limit:    params541.limit,
    },
    filterErrors:  params541.errors,
    version:       ALERT_FILTER_VERSION_541,
    ts:            new Date().toISOString(),
    loadError:     null,
  };
}

// ── schema (for tooling / docs) ───────────────────────────────────────────
const FILTER_SCHEMA_541 = {
  version:    ALERT_FILTER_VERSION_541,
  endpoint:   'GET /api/v1/deep-health/alerts/v541',
  queryParams: [
    {
      name:    'severity',
      type:    'string',
      values:  [...VALID_SEVERITIES_541],
      default: null,
      desc:    'Filter to alerts of this severity only.',
    },
    {
      name:    'category',
      type:    'string',
      values:  [...VALID_CATEGORIES_541],
      default: null,
      desc:    'Filter to alerts of this category only.',
    },
    {
      name:    'limit',
      type:    'integer',
      min:     1,
      max:     FILTER_LIMIT_MAX_541,
      default: FILTER_LIMIT_DEFAULT_541,
      desc:    'Cap the number of alerts returned.',
    },
  ],
  examples: [
    '/api/v1/deep-health/alerts/v541?severity=critical',
    '/api/v1/deep-health/alerts/v541?category=bridge',
    '/api/v1/deep-health/alerts/v541?severity=warning&category=heartbeat&limit=10',
    '/api/v1/deep-health/alerts/v541?limit=5',
  ],
};

// ── HTTP wiring ───────────────────────────────────────────────────────────

function registerEndpoints541(app) {
  if (!app || typeof app.get !== 'function') return false;

  // [V541-T01] filtered alerts
  app.get('/api/v1/deep-health/alerts/v541', (req541, res541) => {
    try {
      res541.json(buildFilteredAlerts541(req541.query));
    } catch (e) {
      res541.status(500).json({ ok: false, error: e.message, version: ALERT_FILTER_VERSION_541 });
    }
  });

  // [V541-T02] schema / docs
  app.get('/api/v1/deep-health/alert-filter/schema', (req541s, res541s) => {
    try {
      res541s.json({ ok: true, schema: FILTER_SCHEMA_541 });
    } catch (e) {
      res541s.status(500).json({ ok: false, error: e.message, version: ALERT_FILTER_VERSION_541 });
    }
  });

  // [V541-T03] admin summary
  app.get('/api/v1/admin/summary/v541', (req541a, res541a) => {
    res541a.json({
      ok:       true,
      version:  ALERT_FILTER_VERSION_541,
      phase:    'P429',
      feature:  'alert-severity-category-filter',
      desc:     'Read-only query-param filter on deepHealthAlerts540. Params: ?severity=critical|warning|info &category=bridge|heartbeat|governance|module|unknown &limit=N',
      connects: ['deepHealthAlerts540', 'deepHealthStatus539'],
      endpoints: [
        'V541-T01 GET /api/v1/deep-health/alerts/v541',
        'V541-T02 GET /api/v1/deep-health/alert-filter/schema',
        'V541-T03 GET /api/v1/admin/summary/v541',
      ],
      schema:   FILTER_SCHEMA_541,
      ecosVersion: 'V541',
    });
  });

  return true;
}

module.exports = {
  ALERT_FILTER_VERSION_541,
  VALID_SEVERITIES_541,
  VALID_CATEGORIES_541,
  FILTER_SCHEMA_541,
  FILTER_LIMIT_MAX_541,
  _parseFilterParams541,
  filterAlerts541,
  buildFilteredAlerts541,
  registerEndpoints541,
};
