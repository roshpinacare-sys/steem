'use strict';
/**
 * lib/deepHealthStatus539.js — ECOS V539
 *
 * Deep Health — משלב aggregatedHeartbeatStatus538 + governanceDiagnose533
 * לייצר תמונת-אמת אחת: מה down, למה, ומה לתקן.
 *
 * כשה-heartbeat או ה-bridge down, המשתמש מקבל:
 *   • status (ok/degraded/unhealthy)
 *   • phase breakdown מ-V538
 *   • diagnostic מ-V533 (deps חסרים, snapshotWillSucceed)
 *   • actionItems — רשימת פעולות מומלצות מפורשת
 *
 * Usage:
 *   const dh = require('./lib/deepHealthStatus539.js');
 *   dh.buildDeepHealth539()         // snapshot מלא
 *   dh.registerEndpoints539(app)    // wire GET /api/v1/deep-health/v539
 *
 * All identifiers end in 539. Zero npm deps. Sacred untouched.
 * @module deepHealthStatus539
 * @version 539.0.0
 */

const DEEP_HEALTH_VERSION_539 = '539.0.0';

// ── load deps (fail-soft) ─────────────────────────────────────────────────

let _agg538 = null;
let _diag533 = null;

try { _agg538  = require('./aggregatedHeartbeatStatus538.js'); } catch (_) {}
try { _diag533 = require('./governanceDiagnose533.js');        } catch (_) {}

// ── helpers ───────────────────────────────────────────────────────────────

/**
 * _buildActionItems539(aggResult, diagResult)
 * מייצר רשימת פעולות מומלצות מפורשת מתוך שני המקורות.
 * @returns {string[]}
 */
function _buildActionItems539(aggResult, diagResult) {
  const items = [];

  if (!aggResult) {
    items.push('V538 aggregate module not loaded — check lib/aggregatedHeartbeatStatus538.js');
    return items;
  }

  // bridge issues
  if (!aggResult.bridgeLive) {
    items.push(
      'heartbeatGovernanceBridge532: activeBridge532 is null — ' +
      'ensure V532 IIFE ran and set activeBridge532 on startup.'
    );
  }

  // heartbeat issues
  if (!aggResult.hbLive) {
    items.push(
      'heartbeat (activeHb532) is null — ' +
      'Bridge532 must be initialised before heartbeat can start.'
    );
  }
  if (aggResult.hbLive && !aggResult.hbRunning) {
    items.push(
      'Heartbeat object exists but hbRunning=false — ' +
      'call hb.start() or check that the V532 bridge wiring completed.'
    );
  }

  // governance diagnostic issues
  if (diagResult) {
    if (!diagResult.criticalDepsOk) {
      for (const dep of (diagResult.deps || [])) {
        if (dep.status !== 'ok') {
          items.push(
            `Governance dep "${dep.name}" ${dep.status} — ` +
            `missing fns: ${(dep.missingFns || []).join(', ') || '(none listed)'}.`
          );
        }
      }
    }
    if (!diagResult.snapshotWillSucceed) {
      items.push(
        'Governance snapshots will fail (snapshotWillSucceed=false) — ' +
        'resolve critical deps above to restore snapshot capability.'
      );
    }
  } else {
    items.push(
      'governanceDiagnose533 not loaded — ' +
      'check lib/governanceDiagnose533.js for import errors.'
    );
  }

  if (items.length === 0) {
    items.push('All checks passed — no action required.');
  }

  return items;
}

// ── public API ────────────────────────────────────────────────────────────

/**
 * buildDeepHealth539(diagOpts)
 * @param {object} [diagOpts] — passed to diagnoseBridgeOpts533 (optional)
 * @returns {object} merged deep health snapshot
 */
function buildDeepHealth539(diagOpts) {
  // layer 1: aggregate heartbeat status
  let aggResult = null;
  let aggError  = null;
  if (_agg538 && typeof _agg538.buildAggregatedStatus538 === 'function') {
    try { aggResult = _agg538.buildAggregatedStatus538(); }
    catch (e) { aggError = e.message; }
  } else {
    aggError = 'aggregatedHeartbeatStatus538 not loaded';
  }

  // layer 2: governance diagnostic
  let diagResult = null;
  let diagError  = null;
  if (_diag533 && typeof _diag533.diagnoseBridgeOpts533 === 'function') {
    try { diagResult = _diag533.diagnoseBridgeOpts533(diagOpts || {}); }
    catch (e) { diagError = e.message; }
  } else {
    diagError = 'governanceDiagnose533 not loaded';
  }

  // derive overall status
  const aggOk  = aggResult  ? aggResult.ok   : false;
  const diagOk = diagResult ? diagResult.allOk : false;
  const overallOk = aggOk && diagOk;
  const status = overallOk
    ? 'ok'
    : (aggResult && aggResult.level === 'degraded') ? 'degraded' : 'unhealthy';

  // action items
  const actionItems = _buildActionItems539(aggResult, diagResult);

  return {
    ok:             overallOk,
    status,
    version:        DEEP_HEALTH_VERSION_539,
    ts:             new Date().toISOString(),
    // layer 1
    aggregate: {
      loaded: aggResult !== null,
      error:  aggError,
      data:   aggResult,
    },
    // layer 2
    diagnostic: {
      loaded: diagResult !== null,
      error:  diagError,
      data:   diagResult,
    },
    // synthesised guidance
    actionItems,
    summary: overallOk
      ? 'All systems healthy.'
      : `Issues detected — see actionItems (${actionItems.length} item${actionItems.length !== 1 ? 's' : ''}).`,
  };
}

/**
 * registerEndpoints539(app) — wire HTTP endpoint
 */
function registerEndpoints539(app) {
  if (!app || typeof app.get !== 'function') return false;

  // [V539-T01] GET /api/v1/deep-health/v539
  app.get('/api/v1/deep-health/v539', (_req, res) => {
    try {
      res.json(buildDeepHealth539());
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, version: DEEP_HEALTH_VERSION_539 });
    }
  });

  return true;
}

// ── module.exports ────────────────────────────────────────────────────────

module.exports = {
  DEEP_HEALTH_VERSION_539,
  buildDeepHealth539,
  registerEndpoints539,
};
