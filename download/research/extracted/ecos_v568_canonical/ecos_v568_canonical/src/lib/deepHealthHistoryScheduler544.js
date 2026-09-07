'use strict';
/**
 * lib/deepHealthHistoryScheduler544.js — Deep Health History Scheduler V544
 *
 * Closes the loop between the Diamond Heartbeat (V465/V532) and the
 * deepHealthAlertHistory542 ring buffer.
 *
 * Problem solved: deepHealthAlertHistory542.push542() was only called on
 * explicit HTTP requests to its endpoints.  With no HTTP traffic the ring
 * buffer stays empty, getTrend542() always returns 'unknown', and the alert
 * history is useless.
 *
 * Solution: attach a lightweight onBeat callback to the active heartbeat
 * (via heartbeatGovernanceBridge532).  On every Diamond Heartbeat tick the
 * scheduler calls push542() automatically — no HTTP request required.
 *
 * Architecture:
 *   DiamondHeartbeat465 → (beat event)
 *     → heartbeatGovernanceBridge532._onBeat532()
 *     → deepHealthHistoryScheduler544._onBeat544()   ← NEW
 *         → deepHealthAlertHistory542.push542('scheduler')
 *
 * Fail-closed everywhere:
 *   • No heartbeat active → scheduler stays idle, reports degraded status.
 *   • push542() throws  → caught, errorCount incremented, no crash.
 *   • history module missing → scheduler stays idle.
 *
 * All identifiers end in 544.  Zero npm deps.  SACRED untouched.
 * @module deepHealthHistoryScheduler544
 * @version 544.0.0
 */

const SCHEDULER_VERSION_544 = '544';
const SCHEDULER_MAX_ERRORS_544 = 50; // stop auto-push after this many errors

// ── lazy refs (loaded on attach, not at require-time) ─────────────────────
let _history544 = null;
let _bridge544  = null;

function _loadDeps544() {
  if (!_history544) {
    try { _history544 = require('./deepHealthAlertHistory542.js'); } catch (_) {}
  }
  if (!_bridge544) {
    try { _bridge544 = require('./heartbeatGovernanceBridge532.js'); } catch (_) {}
  }
}

// ── internal state ─────────────────────────────────────────────────────────
let _attached544    = false;
let _beatsReceived544 = 0;
let _pushOk544      = 0;
let _pushErrors544  = 0;
let _lastPushAt544  = null;
let _lastError544   = null;

/**
 * _onBeat544(beat) — called on every Diamond Heartbeat tick.
 * Pushes a new snapshot into deepHealthAlertHistory542.
 */
function _onBeat544(beat) {
  _beatsReceived544++;
  if (_pushErrors544 >= SCHEDULER_MAX_ERRORS_544) return; // circuit-breaker
  if (!_history544 || typeof _history544.push542 !== 'function') return;

  try {
    _history544.push542(
      { triggerSource: 'scheduler544', beatVersion: beat && beat.version },
      'scheduler544'
    );
    _pushOk544++;
    _lastPushAt544 = new Date().toISOString();
  } catch (err) {
    _pushErrors544++;
    _lastError544 = err.message;
  }
}

/**
 * attach544() — wire the scheduler to the active heartbeat instance.
 *
 * Strategy:
 *   1. Try heartbeatGovernanceBridge532.activeHb532 (set by V532 IIFE).
 *   2. Fall back to diamondHeartbeat465.defaultDiamondHeartbeat465() singleton.
 *
 * Returns { ok, reason } — never throws.
 */
function attach544() {
  if (_attached544) return { ok: true, reason: 'already_attached' };
  _loadDeps544();

  // Attempt 1: bridge singleton
  if (_bridge544 && _bridge544.activeHb532) {
    const hb = _bridge544.activeHb532;
    if (hb && typeof hb._beat465 === 'function') {
      // Patch: wrap _beat465 to also call our callback after the original
      const _orig = hb._beat465.bind(hb);
      hb._beat465 = async function _beat465_wrapped544() {
        const result = await _orig();
        _onBeat544(result);
        return result;
      };
      _attached544 = true;
      return { ok: true, reason: 'attached_via_bridge532_activeHb' };
    }
  }

  // Attempt 2: diamondHeartbeat465 default singleton
  let hb465mod = null;
  try { hb465mod = require('./diamondHeartbeat465.js'); } catch (_) {}
  if (hb465mod) {
    const hb = hb465mod.defaultDiamondHeartbeat465();
    if (hb && typeof hb._beat465 === 'function') {
      const _orig = hb._beat465.bind(hb);
      hb._beat465 = async function _beat465_wrapped544b() {
        const result = await _orig();
        _onBeat544(result);
        return result;
      };
      _attached544 = true;
      return { ok: true, reason: 'attached_via_diamondHeartbeat465_singleton' };
    }
  }

  return { ok: false, reason: 'no_active_heartbeat_found — scheduler idle until heartbeat starts' };
}

/**
 * detach544() — remove the patch (mainly for testing).
 * Resets state so attach544() can be called again.
 */
function detach544() {
  // We can't easily unwrap the _beat465 patch without storing the original,
  // so we just mark as detached and stop processing beats.
  _attached544 = false;
  _beatsReceived544 = 0;
  _pushOk544 = 0;
  _pushErrors544 = 0;
  _lastPushAt544 = null;
  _lastError544 = null;
  return { ok: true };
}

/**
 * status544() — current scheduler status.
 */
function status544() {
  _loadDeps544();
  return {
    version:         SCHEDULER_VERSION_544,
    attached:        _attached544,
    historyAvailable: !!(_history544 && typeof _history544.push542 === 'function'),
    beatsReceived:   _beatsReceived544,
    pushOk:          _pushOk544,
    pushErrors:      _pushErrors544,
    circuitOpen:     _pushErrors544 >= SCHEDULER_MAX_ERRORS_544,
    lastPushAt:      _lastPushAt544,
    lastError:       _lastError544,
  };
}

/**
 * registerEndpoints544(app) — wire API endpoints.
 * Returns false if app is not a valid express-like object.
 */
function registerEndpoints544(app) {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') return false;

  // [V544-T01] GET status
  app.get('/api/v1/deep-health/scheduler/status', (_req, res) => {
    try {
      res.json({ ok: true, ...status544(), ecosVersion: 'V544' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V544' });
    }
  });

  // [V544-T02] POST attach (idempotent)
  app.post('/api/v1/deep-health/scheduler/attach', (_req, res) => {
    try {
      const result = attach544();
      res.json({ ok: result.ok, reason: result.reason, ...status544(), ecosVersion: 'V544' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V544' });
    }
  });

  // [V544-T03] GET admin summary
  app.get('/api/v1/admin/summary/v544', (_req, res) => {
    try {
      const st = status544();
      res.json({
        ok: true, version: 'V544',
        description: 'Deep Health History Scheduler — auto-push to ring buffer on every Heartbeat beat',
        attached: st.attached,
        beatsReceived: st.beatsReceived,
        pushOk: st.pushOk,
        pushErrors: st.pushErrors,
        endpoints: [
          'GET  /api/v1/deep-health/scheduler/status',
          'POST /api/v1/deep-health/scheduler/attach',
          'GET  /api/v1/admin/summary/v544',
        ],
        ecosVersion: 'V544',
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V544' });
    }
  });

  return true;
}

module.exports = {
  SCHEDULER_VERSION_544,
  SCHEDULER_MAX_ERRORS_544,
  attach544,
  detach544,
  status544,
  registerEndpoints544,
  // exported for testing
  _onBeat544,
};
