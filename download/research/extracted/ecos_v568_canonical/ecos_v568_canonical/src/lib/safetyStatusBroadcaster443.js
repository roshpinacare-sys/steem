'use strict';
/**
 * src/lib/safetyStatusBroadcaster443.js — ECOS V443
 *
 * Safety Status Live Broadcaster
 * Connects unifiedSafetyDashboard439 → adminWsHub + auditLog.
 * Periodically polls the unified safety dashboard; when the overall status
 * changes (healthy / degraded / critical) broadcasts a `safety.status` event
 * to all connected admin WS clients and appends a structured entry to the
 * audit log so the change is permanently traceable.
 *
 * R1: sacred files untouched. R2: all identifiers end in 443. R3: no new npm deps.
 *
 * @version 443.0.0
 */

const SAFETY_STATUS_BROADCASTER_VERSION443 = '443.0.0';

const _state443 = {
  lastStatus: null,
  lastScore: null,
  lastCheckTs: null,
  changeCount: 0,
  broadcastCount: 0,
  auditCount: 0,
  intervalMs: 30_000,
  intervalHandle: null,
  history: [],
  maxHistory: 100,
};

function _nowIso443() {
  return new Date().toISOString();
}

function _pushHistory443(entry) {
  _state443.history.push(entry);
  if (_state443.history.length > _state443.maxHistory) _state443.history.shift();
}

/**
 * checkAndBroadcast443(opts)
 * @param {object} [opts]
 * @param {object} [opts.adminWsHub] — instance with .broadcast(type, data)
 * @param {object} [opts.auditLog]   — instance with .append(type, payload)
 * @param {object} [opts.dashboardInput] — forwarded to computeUnifiedSafetyDashboard439
 * @returns {{ok:boolean, changed:boolean, previousStatus:string|null, currentStatus:string, score:number, broadcast:boolean, audited:boolean}}
 */
function checkAndBroadcast443(opts) {
  opts = opts || {};

  let dashboard;
  try {
    const dashboardMod = require('./unifiedSafetyDashboard439.js');
    dashboard = dashboardMod.computeUnifiedSafetyDashboard439(opts.dashboardInput || {});
  } catch (e) {
    return { ok: false, changed: false, previousStatus: _state443.lastStatus, currentStatus: 'unknown', score: 0, broadcast: false, audited: false, error: e.message };
  }

  const score = typeof dashboard.overallScore === 'number' ? dashboard.overallScore : 50;
  const status = dashboard.status || 'unknown';
  const previousStatus = _state443.lastStatus;
  const changed = previousStatus !== status;

  _state443.lastStatus = status;
  _state443.lastScore = score;
  _state443.lastCheckTs = _nowIso443();

  let broadcast = false;
  let audited = false;

  if (changed) {
    _state443.changeCount++;
    _pushHistory443({ ts: _state443.lastCheckTs, from: previousStatus, to: status, score });

    // Broadcast to admin WS hub
    const hub = opts.adminWsHub;
    if (hub && typeof hub.broadcast === 'function') {
      try {
        hub.broadcast('safety.status', {
          ts: _state443.lastCheckTs,
          previousStatus: previousStatus,
          currentStatus: status,
          score: score,
          ecosVersion: 'V443',
        });
        broadcast = true;
        _state443.broadcastCount++;
      } catch (_) {}
    }

    // Append to audit log
    const al = opts.auditLog;
    if (al && typeof al.append === 'function') {
      try {
        al.append('SAFETY_STATUS_CHANGE', {
          ts: _state443.lastCheckTs,
          previousStatus: previousStatus,
          currentStatus: status,
          score: score,
          source: 'safetyStatusBroadcaster443',
        });
        audited = true;
        _state443.auditCount++;
      } catch (_) {}
    }
  }

  return {
    ok: true,
    changed,
    previousStatus,
    currentStatus: status,
    score,
    broadcast,
    audited,
  };
}

/**
 * getBroadcasterStatus443()
 * @returns {{ok:boolean, version:string, state:object, history:object[]}}
 */
function getBroadcasterStatus443() {
  return {
    ok: true,
    version: SAFETY_STATUS_BROADCASTER_VERSION443,
    state: {
      lastStatus: _state443.lastStatus,
      lastScore: _state443.lastScore,
      lastCheckTs: _state443.lastCheckTs,
      changeCount: _state443.changeCount,
      broadcastCount: _state443.broadcastCount,
      auditCount: _state443.auditCount,
      intervalMs: _state443.intervalMs,
    },
    history: _state443.history.slice(-20),
  };
}

/**
 * startPolling443(opts)
 * @param {object} [opts] — passed through to checkAndBroadcast443
 * @returns {{ok:boolean, intervalMs:number}}
 */
function startPolling443(opts) {
  if (_state443.intervalHandle) {
    return { ok: true, intervalMs: _state443.intervalMs, note: 'already_running' };
  }
  // Run an immediate check
  checkAndBroadcast443(opts);
  _state443.intervalHandle = setInterval(function() {
    checkAndBroadcast443(opts);
  }, _state443.intervalMs);
  if (_state443.intervalHandle.unref) _state443.intervalHandle.unref();
  return { ok: true, intervalMs: _state443.intervalMs };
}

/**
 * stopPolling443()
 * @returns {{ok:boolean}}
 */
function stopPolling443() {
  if (_state443.intervalHandle) {
    clearInterval(_state443.intervalHandle);
    _state443.intervalHandle = null;
  }
  return { ok: true };
}

/**
 * wireSafetyStatusBroadcaster443(app, opts)
 * @param {object} app — Express-like app
 * @param {object} [opts] — passed through to checkAndBroadcast443
 */
function wireSafetyStatusBroadcaster443(app, opts) {
  if (!app || typeof app.get !== 'function') return;

  // V443-T01 GET /api/v1/admin/safety/broadcast/status
  app.get('/api/v1/admin/safety/broadcast/status', function(_req, res) {
    res.json(Object.assign({ ecosVersion: 'V443' }, getBroadcasterStatus443()));
  });

  // V443-T02 POST /api/v1/admin/safety/broadcast/trigger
  app.post('/api/v1/admin/safety/broadcast/trigger', function(_req, res) {
    const result = checkAndBroadcast443(opts);
    res.json(Object.assign({ ok: true, ecosVersion: 'V443' }, result));
  });

  // V443-T03 GET /api/v1/admin/summary/v443
  app.get('/api/v1/admin/summary/v443', function(_req, res) {
    res.json({
      ok: true,
      ecosVersion: 'V443',
      feature: 'safety-status-broadcaster',
      description: 'Connects unifiedSafetyDashboard439 → adminWsHub + auditLog for real-time operator safety awareness.',
      version: SAFETY_STATUS_BROADCASTER_VERSION443,
      status: getBroadcasterStatus443(),
    });
  });
}

module.exports = {
  SAFETY_STATUS_BROADCASTER_VERSION443,
  checkAndBroadcast443,
  getBroadcasterStatus443,
  startPolling443,
  stopPolling443,
  wireSafetyStatusBroadcaster443,
  _state443,
};
