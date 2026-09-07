'use strict';
/**
 * lib/deepHealthAlertAggregator545.js — ECOS V545 (Phase P433)
 *
 * Alert History Aggregator — reads from deepHealthAlertHistory542.getHistory542()
 * and folds snapshots into hourly buckets (in-process, no I/O).
 *
 * Architecture:
 *   deepHealthAlerts540 ← deepHealthAlertFilter541
 *     ← deepHealthAlertHistory542 (ring buffer, auto-filled by scheduler544)
 *       ← deepHealthAlertAggregator545 (tip — this module)
 *
 * API:
 *   aggregate545(opts?)       — fold snapshots → hourly buckets + per-bucket stats
 *   getTop545(n?)             — top-N worst hours (by avgCritical desc)
 *   getBucketByHour545(hKey)  — single bucket by ISO hour key (e.g. '2026-06-05T14')
 *   getInfo545()              — module metadata + endpoint list
 *   registerEndpoints545(app) — 3 endpoints (V545-T01/T02/T03)
 *
 * All identifiers end in 545. Zero npm deps. SACRED untouched. Read-only (no money).
 * @module deepHealthAlertAggregator545
 * @version 545.0.0
 */

const AGGREGATOR_VERSION_545 = '545.0.0';
const AGGREGATOR_BUCKET_545  = 'hour';
const AGGREGATOR_TOP_N_545   = 5;
const AGGREGATOR_MAX_SNAPSHOTS_545 = 500;

// ── Dependency (lazy, fail-closed) ────────────────────────────────────────
let _hist545    = null;
let _loadErr545 = null;
try {
  _hist545 = require('./deepHealthAlertHistory542.js');
} catch (e) {
  _loadErr545 = e.message;
}

// ── Bucket helpers ────────────────────────────────────────────────────────

/**
 * Extract hour key from ISO timestamp: '2026-06-05T14:32:00Z' → '2026-06-05T14'
 */
function _hourKey545(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'unknown';
  return d.toISOString().slice(0, 13); // 'YYYY-MM-DDTHH'
}

/**
 * Fold an array of snapshots into hour-keyed buckets.
 * Each bucket: { hourKey, count, alertSum, criticalSum, warningSum, infoSum,
 *                avgAlert, avgCritical, avgWarning, avgInfo, degradedCount }
 */
function _fold545(snapshots) {
  const map = {};
  for (const snap of snapshots) {
    const k = _hourKey545(snap.ts || new Date().toISOString());
    if (!map[k]) {
      map[k] = {
        hourKey: k, count: 0,
        alertSum: 0, criticalSum: 0, warningSum: 0, infoSum: 0,
        degradedCount: 0,
      };
    }
    const b = map[k];
    b.count++;
    b.alertSum    += (snap.alertCount    || 0);
    b.criticalSum += (snap.criticalCount || 0);
    b.warningSum  += (snap.warningCount  || 0);
    b.infoSum     += (snap.infoCount     || 0);
    if (!snap.ok || snap.status === 'degraded' || snap.status === 'unhealthy') {
      b.degradedCount++;
    }
  }
  // compute averages (2 decimal places)
  for (const b of Object.values(map)) {
    b.avgAlert    = b.count ? parseFloat((b.alertSum    / b.count).toFixed(2)) : 0;
    b.avgCritical = b.count ? parseFloat((b.criticalSum / b.count).toFixed(2)) : 0;
    b.avgWarning  = b.count ? parseFloat((b.warningSum  / b.count).toFixed(2)) : 0;
    b.avgInfo     = b.count ? parseFloat((b.infoSum     / b.count).toFixed(2)) : 0;
  }
  return map;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Aggregate ring-buffer snapshots into hourly buckets.
 * @param {{limit?:number, since?:string, onlyDegraded?:boolean}} [opts={}]
 */
function aggregate545(opts) {
  opts = opts || {};
  if (_loadErr545 || !_hist545) {
    return {
      ok: false,
      error: _loadErr545 || 'deepHealthAlertHistory542 unavailable',
      buckets: [], bucketCount: 0, snapshotCount: 0,
      granularity: AGGREGATOR_BUCKET_545, version: AGGREGATOR_VERSION_545,
    };
  }

  let snapshots = [];
  try {
    const h = _hist545.getHistory542({
      limit: opts.limit || AGGREGATOR_MAX_SNAPSHOTS_545,
      since: opts.since,
      onlyDegraded: opts.onlyDegraded,
    });
    // getHistory542 returns { ok, snapshots:[], ... }
    snapshots = Array.isArray(h) ? h : (h.snapshots || []);
  } catch (e) {
    return {
      ok: false, error: e.message,
      buckets: [], bucketCount: 0, snapshotCount: 0,
      granularity: AGGREGATOR_BUCKET_545, version: AGGREGATOR_VERSION_545,
    };
  }

  const map = _fold545(snapshots);
  const buckets = Object.values(map).sort((a, b) => (a.hourKey < b.hourKey ? -1 : 1));
  return {
    ok: true, buckets, bucketCount: buckets.length, snapshotCount: snapshots.length,
    granularity: AGGREGATOR_BUCKET_545, version: AGGREGATOR_VERSION_545,
  };
}

/**
 * Top-N worst hours by avgCritical descending (tie-break: avgAlert).
 * @param {number} [n=5]  clamped to [1, 50]
 */
function getTop545(n) {
  const limit545 = Math.max(1, Math.min(50, Math.floor(
    (n !== null && n !== undefined && !isNaN(+n)) ? +n : AGGREGATOR_TOP_N_545
  )));
  const agg = aggregate545();
  if (!agg.ok) {
    return { ok: false, error: agg.error, topN: [], n: limit545, version: AGGREGATOR_VERSION_545 };
  }
  const topN = agg.buckets
    .sort((a, b) => b.avgCritical - a.avgCritical || b.avgAlert - a.avgAlert)
    .slice(0, limit545);
  return {
    ok: true, topN, n: limit545,
    totalBuckets: agg.bucketCount, version: AGGREGATOR_VERSION_545,
  };
}

/**
 * Get a single bucket by ISO hour key (e.g. '2026-06-05T14').
 * @param {string} hourKey
 */
function getBucketByHour545(hourKey) {
  if (!hourKey || typeof hourKey !== 'string') {
    return {
      ok: false,
      error: 'hourKey required (format: YYYY-MM-DDTHH)',
      bucket: null, version: AGGREGATOR_VERSION_545,
    };
  }
  const agg = aggregate545();
  if (!agg.ok) {
    return { ok: false, error: agg.error, bucket: null, version: AGGREGATOR_VERSION_545 };
  }
  const bucket = agg.buckets.find(b => b.hourKey === hourKey) || null;
  return { ok: true, bucket, hourKey, version: AGGREGATOR_VERSION_545 };
}

/** Module metadata. */
function getInfo545() {
  return {
    module:      'deepHealthAlertAggregator545',
    version:     AGGREGATOR_VERSION_545,
    description: 'Hourly bucket aggregator over deepHealthAlertHistory542 ring buffer.',
    granularity: AGGREGATOR_BUCKET_545,
    defaultTopN: AGGREGATOR_TOP_N_545,
    dep:         'deepHealthAlertHistory542',
    prevStack:   'scheduler544 → history542 ← filter541 ← alerts540 ← status539',
    endpoints: [
      'V545-T01 GET /api/v1/deep-health/aggregate/v545',
      'V545-T02 GET /api/v1/deep-health/top/v545',
      'V545-T03 GET /api/v1/admin/summary/v545',
    ],
  };
}

/**
 * Register 3 endpoints on an Express-like app.
 * Returns false if app is null/missing (fail-closed).
 */
function registerEndpoints545(app) {
  if (!app || typeof app.get !== 'function') return false;

  // V545-T01 — all hourly buckets
  app.get('/api/v1/deep-health/aggregate/v545', (req545, res545) => {
    try {
      const opts = {
        limit:        req545.query.limit        ? parseInt(req545.query.limit, 10) : undefined,
        since:        req545.query.since        || undefined,
        onlyDegraded: req545.query.onlyDegraded === 'true',
      };
      res545.json({ ...aggregate545(opts), ecosVersion: 'V545' });
    } catch (e) {
      res545.status(500).json({ ok: false, error: e.message, version: AGGREGATOR_VERSION_545 });
    }
  });

  // V545-T02 — top-N worst hours
  app.get('/api/v1/deep-health/top/v545', (req545, res545) => {
    try {
      const n = req545.query.n ? parseInt(req545.query.n, 10) : AGGREGATOR_TOP_N_545;
      res545.json({ ...getTop545(n), ecosVersion: 'V545' });
    } catch (e) {
      res545.status(500).json({ ok: false, error: e.message, version: AGGREGATOR_VERSION_545 });
    }
  });

  // V545-T03 — admin summary
  app.get('/api/v1/admin/summary/v545', (_req545, res545) => {
    try {
      const agg = aggregate545();
      res545.json({
        ok: true, version: 'V545',
        description: 'Hourly bucket aggregator — folds deepHealthAlertHistory542 ring buffer ' +
                     'into per-hour stats (avgAlert, avgCritical, degradedCount). ' +
                     'Top-N worst hours for rapid triage.',
        bucketCount:   agg.bucketCount,
        snapshotCount: agg.snapshotCount,
        info:          getInfo545(),
        endpoints: [
          'GET /api/v1/deep-health/aggregate/v545',
          'GET /api/v1/deep-health/top/v545',
          'GET /api/v1/admin/summary/v545',
        ],
        ecosVersion: 'V545',
      });
    } catch (e) {
      res545.status(500).json({ ok: false, error: e.message });
    }
  });

  return true;
}

module.exports = {
  AGGREGATOR_VERSION_545,
  AGGREGATOR_BUCKET_545,
  AGGREGATOR_TOP_N_545,
  aggregate545,
  getTop545,
  getBucketByHour545,
  getInfo545,
  registerEndpoints545,
};
