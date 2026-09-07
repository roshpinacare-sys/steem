'use strict';
/**
 * lib/deepHealthAlertHistory542.js — ECOS V542 (Phase P430)
 *
 * Alert History Ring Buffer — wraps deepHealthAlertFilter541.buildFilteredAlerts541()
 * and keeps the last N snapshots in memory (ring buffer, no external state).
 *
 * Architecture:
 *   deepHealthAlerts540 ← deepHealthAlertFilter541 ← deepHealthAlertHistory542
 *
 * Features:
 *   - Ring buffer of HISTORY_MAX_542 = 50 snapshots (configurable at runtime via setMax542)
 *   - Each snapshot: { ts, seqNo, alertCount, criticalCount, warningCount, infoCount,
 *                      filters, ok, triggerSource }
 *   - push542(query?) — capture a new snapshot (call at any time / from any endpoint)
 *   - getHistory542(opts) — query snapshots: limit, since, onlyDegraded
 *   - getTrend542() — direction summary: rising / falling / stable / unknown
 *   - registerEndpoints542(app) — wires 3 HTTP endpoints
 *
 * All identifiers end in 542. Zero npm deps. SACRED untouched. Read-only (no money).
 * @module deepHealthAlertHistory542
 * @version 542.0.0
 */

const HISTORY_VERSION_542 = '542.0.0';
const HISTORY_MAX_DEFAULT_542 = 50;
const TREND_WINDOW_542        = 5;   // last N snapshots compared to prior N for trend

// ── Dependency ────────────────────────────────────────────────────────────────
let _filter541 = null;
let _loadError542 = null;
try {
  _filter541 = require('./deepHealthAlertFilter541.js');
} catch (e) {
  _loadError542 = e.message;
}

// ── Ring Buffer State ─────────────────────────────────────────────────────────
let _maxSize542 = HISTORY_MAX_DEFAULT_542;
let _ring542    = [];          // array of snapshot objects, oldest first
let _seq542     = 0;           // monotonic sequence counter

/**
 * Set the max ring buffer capacity (min 5, max 500).
 * Trims oldest entries if shrinking.
 * @param {number} n
 */
function setMax542(n) {
  const clamped = Math.max(5, Math.min(500, Math.floor(Number(n) || HISTORY_MAX_DEFAULT_542)));
  _maxSize542 = clamped;
  if (_ring542.length > _maxSize542) {
    _ring542 = _ring542.slice(_ring542.length - _maxSize542);
  }
}

// ── Core: capture snapshot ────────────────────────────────────────────────────
/**
 * Capture a filtered alert snapshot and push to ring buffer.
 * @param {object} [query={}]          — same query params as buildFilteredAlerts541
 * @param {string} [triggerSource='manual']
 * @returns {object} the snapshot that was pushed
 */
function push542(query, triggerSource) {
  const ts542       = new Date().toISOString();
  const src542      = triggerSource || 'manual';
  const seq542      = ++_seq542;

  let snap542;
  if (!_filter541 || typeof _filter541.buildFilteredAlerts541 !== 'function') {
    snap542 = {
      seqNo:         seq542,
      ts:            ts542,
      ok:            false,
      status:        'degraded',
      alertCount:    0,
      criticalCount: 0,
      warningCount:  0,
      infoCount:     0,
      filters:       query || {},
      triggerSource: src542,
      loadError:     _loadError542 || 'deepHealthAlertFilter541 not loaded',
    };
  } else {
    try {
      const result542 = _filter541.buildFilteredAlerts541(query || {});
      snap542 = {
        seqNo:         seq542,
        ts:            result542.ts || ts542,
        ok:            result542.ok !== false,
        status:        result542.status || 'ok',
        alertCount:    result542.alertCount    || 0,
        criticalCount: result542.criticalCount || 0,
        warningCount:  result542.warningCount  || 0,
        infoCount:     result542.infoCount     || 0,
        filters:       result542.filters       || query || {},
        triggerSource: src542,
        loadError:     result542.loadError     || null,
      };
    } catch (e) {
      snap542 = {
        seqNo:         seq542,
        ts:            ts542,
        ok:            false,
        status:        'error',
        alertCount:    0,
        criticalCount: 0,
        warningCount:  0,
        infoCount:     0,
        filters:       query || {},
        triggerSource: src542,
        loadError:     `buildFilteredAlerts541 threw: ${e.message}`,
      };
    }
  }

  _ring542.push(snap542);
  if (_ring542.length > _maxSize542) {
    _ring542 = _ring542.slice(_ring542.length - _maxSize542);
  }
  return snap542;
}

// ── Query history ─────────────────────────────────────────────────────────────
/**
 * @param {object} [opts]
 * @param {number}  [opts.limit=20]       — max snapshots to return (newest first)
 * @param {string}  [opts.since]          — ISO timestamp; return only snapshots after this
 * @param {boolean} [opts.onlyDegraded]   — filter to ok=false only
 * @returns {object}
 */
function getHistory542(opts) {
  const o542       = opts || {};
  const limit542   = Math.max(1, Math.min(_maxSize542, Math.floor(Number(o542.limit) || 20)));
  const since542   = o542.since || null;
  const degraded542 = Boolean(o542.onlyDegraded);

  let items542 = [..._ring542].reverse();   // newest first

  if (since542) {
    try {
      const sinceMs = new Date(since542).getTime();
      items542 = items542.filter(s => new Date(s.ts).getTime() > sinceMs);
    } catch (_) { /* invalid date — ignore filter */ }
  }
  if (degraded542) {
    items542 = items542.filter(s => !s.ok);
  }

  const sliced542 = items542.slice(0, limit542);

  return {
    ok:           true,
    version:      HISTORY_VERSION_542,
    total:        _ring542.length,
    maxSize:      _maxSize542,
    returned:     sliced542.length,
    newestSeqNo:  _ring542.length ? _ring542[_ring542.length - 1].seqNo : null,
    oldestSeqNo:  _ring542.length ? _ring542[0].seqNo : null,
    filters:      { limit: limit542, since: since542, onlyDegraded: degraded542 },
    snapshots:    sliced542,
    ts:           new Date().toISOString(),
  };
}

// ── Trend analysis ────────────────────────────────────────────────────────────
/**
 * Compare avg(criticalCount) of last TREND_WINDOW vs prior TREND_WINDOW.
 * @returns {{ direction: 'rising'|'falling'|'stable'|'unknown', delta: number, ... }}
 */
function getTrend542() {
  if (_ring542.length < 2) {
    return { direction: 'unknown', delta: 0, windowSize: TREND_WINDOW_542,
             reason: 'insufficient data', version: HISTORY_VERSION_542 };
  }

  const recent542 = _ring542.slice(-TREND_WINDOW_542);
  const prior542  = _ring542.slice(
    Math.max(0, _ring542.length - TREND_WINDOW_542 * 2),
    Math.max(0, _ring542.length - TREND_WINDOW_542)
  );

  const avg542 = arr => arr.length
    ? arr.reduce((s, x) => s + (x.criticalCount || 0), 0) / arr.length
    : 0;

  const recentAvg542 = avg542(recent542);
  const priorAvg542  = prior542.length ? avg542(prior542) : recentAvg542;
  const delta542     = recentAvg542 - priorAvg542;

  let direction542;
  if (prior542.length === 0)     direction542 = 'unknown';
  else if (delta542 > 0.1)       direction542 = 'rising';
  else if (delta542 < -0.1)      direction542 = 'falling';
  else                            direction542 = 'stable';

  return {
    direction:  direction542,
    delta:      Math.round(delta542 * 100) / 100,
    recentAvg:  Math.round(recentAvg542 * 100) / 100,
    priorAvg:   Math.round(priorAvg542  * 100) / 100,
    windowSize: TREND_WINDOW_542,
    recentN:    recent542.length,
    priorN:     prior542.length,
    version:    HISTORY_VERSION_542,
  };
}

// ── Metadata ──────────────────────────────────────────────────────────────────
function getInfo542() {
  return {
    version:       HISTORY_VERSION_542,
    maxSize:       _maxSize542,
    currentSize:   _ring542.length,
    nextSeqNo:     _seq542 + 1,
    filterLoaded:  !!_filter541,
    loadError:     _loadError542,
    endpoints: [
      'V542-T01 GET /api/v1/deep-health/alert-history/v542',
      'V542-T02 GET /api/v1/deep-health/alert-history/trend/v542',
      'V542-T03 GET /api/v1/admin/summary/v542',
    ],
  };
}

// ── HTTP endpoints ────────────────────────────────────────────────────────────
function registerEndpoints542(app) {
  if (!app || typeof app.get !== 'function') return;

  // V542-T01: history query (also triggers a fresh snapshot first)
  app.get('/api/v1/deep-health/alert-history/v542', (req542, res542) => {
    try {
      // capture fresh snapshot for this request
      push542(req542.query, 'http-request');

      const limit542      = req542.query.limit;
      const since542      = req542.query.since;
      const onlyDegraded  = req542.query.onlyDegraded === 'true' || req542.query.onlyDegraded === '1';

      const result542 = getHistory542({ limit: limit542, since: since542, onlyDegraded });
      res542.json(result542);
    } catch (e) {
      res542.status(500).json({ ok: false, error: e.message, version: HISTORY_VERSION_542 });
    }
  });

  // V542-T02: trend summary
  app.get('/api/v1/deep-health/alert-history/trend/v542', (req542, res542) => {
    try {
      push542({}, 'trend-request');
      res542.json({ ok: true, trend: getTrend542(), version: HISTORY_VERSION_542 });
    } catch (e) {
      res542.status(500).json({ ok: false, error: e.message, version: HISTORY_VERSION_542 });
    }
  });

  // V542-T03: admin summary
  app.get('/api/v1/admin/summary/v542', (req542, res542) => {
    try {
      res542.json({
        ok:      true,
        version: HISTORY_VERSION_542,
        phase:   'P430',
        feature: 'deep-health-alert-history',
        description: 'Ring buffer (N=50) of deepHealthAlertFilter541 snapshots. ' +
                     'GET alert-history for trends over time. Read-only, in-memory.',
        info:    getInfo542(),
        trend:   getTrend542(),
        ts:      new Date().toISOString(),
      });
    } catch (e) {
      res542.status(500).json({ ok: false, error: e.message });
    }
  });
}

module.exports = {
  HISTORY_VERSION_542,
  HISTORY_MAX_DEFAULT_542,
  TREND_WINDOW_542,
  // API
  setMax542,
  push542,
  getHistory542,
  getTrend542,
  getInfo542,
  registerEndpoints542,
};
