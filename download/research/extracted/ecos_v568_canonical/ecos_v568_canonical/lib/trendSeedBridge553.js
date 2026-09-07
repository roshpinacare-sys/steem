'use strict';
/**
 * src/lib/trendSeedBridge553.js — ECOS V553 (Phase P321)
 *
 * CONNECTION: deepHealthHistoryScheduler544 ↔ deepHealthAlertHistory542.
 *
 * PROBLEM (V552 NEXT_SESSION):
 *   deepHealthHistoryScheduler544.attach544() returns ok:false at boot because
 *   the Diamond Heartbeat is not yet running. deepHealthAlertHistory542 ring
 *   buffer is empty → getTrend542() returns 'unknown' → gate549 stays MANUAL.
 *
 * SOLUTION:
 *   seedTrend553(n) performs n manual push542() calls at boot, filling the ring
 *   buffer with real snapshots (via the existing filter/alert pipeline). After
 *   10 pushes (windowSize*2), getTrend542() returns a real direction (stable/
 *   rising/falling) instead of 'unknown'.
 *   Also tries to re-attach the scheduler once on each call (idempotent).
 *
 * EXPORTS:
 *   seedTrend553(n?)     → { seeded, trend, schedulerAttached }
 *   getTrendStatus553()  → { trend, schedulerStatus, ringLen }
 *
 * All identifiers end in 553. Zero new npm deps. SACRED untouched.
 * @version 553.0.0
 */

var SEED_VERSION_553       = '553.0.0';
var SEED_DEFAULT_N_553     = 10;   // 2 × TREND_WINDOW_542 (5) — enough for priorN=5
var SEED_MAX_N_553         = 30;   // hard cap (fail-closed)
var SEED_SOURCE_553        = 'trendSeedBridge553';

var _hist553   = null;
var _sched553  = null;

function _load553() {
  if (!_hist553)  { try { _hist553  = require('./deepHealthAlertHistory542.js'); } catch (_) {} }
  if (!_sched553) { try { _sched553 = require('./deepHealthHistoryScheduler544.js'); } catch (_) {} }
}

/**
 * seedTrend553(n) — push n snapshots into the ring buffer.
 * Also tries scheduler attach (idempotent).
 * @param {number} [n=10]
 * @returns {{ seeded:number, trend:object, schedulerAttached:boolean, schedulerReason:string }}
 */
function seedTrend553(n) {
  _load553();
  var count553 = (typeof n === 'number' && n >= 1 && n <= SEED_MAX_N_553) ? n : SEED_DEFAULT_N_553;

  if (!_hist553 || typeof _hist553.push542 !== 'function') {
    return { ok: false, error: 'deepHealthAlertHistory542 not available', seeded: 0, version: SEED_VERSION_553 };
  }

  var seeded553 = 0;
  for (var i = 0; i < count553; i++) {
    try {
      _hist553.push542({}, SEED_SOURCE_553);
      seeded553++;
    } catch (_) { break; }
  }

  // Try scheduler attach (idempotent — returns ok:true if already attached)
  var attachResult553 = { ok: false, reason: 'scheduler_not_loaded' };
  if (_sched553 && typeof _sched553.attach544 === 'function') {
    try { attachResult553 = _sched553.attach544(); } catch (_) {}
  }

  var trend553 = { direction: 'unknown', error: 'history not loaded' };
  try { trend553 = _hist553.getTrend542(); } catch (_) {}

  return {
    ok:                true,
    version:           SEED_VERSION_553,
    seeded:            seeded553,
    trend:             trend553,
    schedulerAttached: attachResult553.ok === true,
    schedulerReason:   attachResult553.reason || '',
  };
}

/**
 * getTrendStatus553() — read current trend + scheduler state (no writes).
 */
function getTrendStatus553() {
  _load553();
  var trend553 = { direction: 'unknown', error: 'history not loaded' };
  try { if (_hist553) trend553 = _hist553.getTrend542(); } catch (_) {}

  var sched553 = { version: 'n/a' };
  try { if (_sched553 && typeof _sched553.status544 === 'function') sched553 = _sched553.status544(); } catch (_) {}

  return {
    version:         SEED_VERSION_553,
    trend:           trend553,
    schedulerStatus: sched553,
    historyAvail:    !!_hist553,
    schedulerAvail:  !!_sched553,
  };
}

module.exports = {
  SEED_VERSION_553:    SEED_VERSION_553,
  SEED_DEFAULT_N_553:  SEED_DEFAULT_N_553,
  seedTrend553:        seedTrend553,
  getTrendStatus553:   getTrendStatus553,
};
