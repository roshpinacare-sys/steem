'use strict';
/**
 * src/lib/agentControlAuditBridge446.js — ECOS V446
 *
 * Agent Control Command Audit Bridge
 * Connects agentBus CONTROL channel → auditLog + adminWsHub + alertEscalation425.
 * Every pause/resume/cancel command is recorded in auditLog and broadcast to
 * adminWsHub.  If too many cancel commands arrive in a short window, the
 * existing alert-escalation system is triggered so operators are notified
 * before a runaway cancellation cascade becomes user-visible downtime.
 *
 * R1: sacred files untouched.  R2: all identifiers end in 446.
 * R3: no new npm deps.  R4: never holds keys.
 *
 * @version 446.0.0
 */

const AGENT_CONTROL_AUDIT_BRIDGE_VERSION446 = '446.0.0';

const _state446 = {
  enabled: true,
  cancelBurstThreshold: 3,    // alerts after this many cancels in windowMs
  windowMs: 60 * 1000,        // 1 minute sliding window
  controlWindow: [],            // {ts, command, from} entries
  cancelsInWindow: 0,
  alertsTriggered: 0,
  totalControlsObserved: 0,
  totalCancelsObserved: 0,
  lastControlTs: null,
  lastAlertTs: null,
  subscribed: false,
  busAgentId: 'agentControlAuditBridge446',
  history: [],
  maxHistory: 100,
};

function _nowIso446() {
  return new Date().toISOString();
}

function _nowMs446() {
  return Date.now();
}

function _pruneWindow446(now) {
  const cutoff = now - _state446.windowMs;
  const before = _state446.controlWindow.length;
  _state446.controlWindow = _state446.controlWindow.filter(function(e) { return e.ts >= cutoff; });
  const removed = before - _state446.controlWindow.length;
  _state446.cancelsInWindow = _state446.controlWindow.filter(function(e) { return e.command === 'cancel'; }).length;
  return removed;
}

function _pushHistory446(entry) {
  _state446.history.push(entry);
  if (_state446.history.length > _state446.maxHistory) _state446.history.shift();
}

function _classifyControl446(msg) {
  if (!msg || typeof msg !== 'object') return { command: 'unknown', from: 'unknown' };
  const payload = msg.payload || {};
  const raw = (payload.command || payload.action || payload.type || 'unknown').toString().toLowerCase();
  const command = ['pause', 'resume', 'cancel'].includes(raw) ? raw : 'unknown';
  return {
    command,
    from: msg.from || 'unknown',
    target: payload.target || payload.agentId || null,
    reason: payload.reason || null,
  };
}

function _recordControl446(classification, opts) {
  const nowIso = _nowIso446();
  const entry = {
    ts: nowIso,
    command: classification.command,
    from: classification.from,
    target: classification.target,
    reason: classification.reason,
  };

  _state446.totalControlsObserved++;
  if (classification.command === 'cancel') {
    _state446.totalCancelsObserved++;
  }
  _state446.lastControlTs = nowIso;

  const now = _nowMs446();
  _pruneWindow446(now);
  _state446.controlWindow.push({ ts: now, command: classification.command, from: classification.from });
  if (classification.command === 'cancel') {
    _state446.cancelsInWindow++;
  }

  _pushHistory446({ ts: nowIso, type: 'control', data: entry });

  // 1. Audit log
  const al = opts && opts.auditLog;
  if (al && typeof al.append === 'function') {
    try {
      al.append('AGENT_CONTROL_COMMAND', entry);
    } catch (_) {}
  }

  // 2. Broadcast to admin WS hub
  const hub = opts && opts.adminWsHub;
  if (hub && typeof hub.broadcast === 'function') {
    try {
      hub.broadcast('agent.control.command', entry);
    } catch (_) {}
  }

  // 3. Burst detection for cancel commands
  if (classification.command === 'cancel' && _state446.cancelsInWindow >= _state446.cancelBurstThreshold) {
    _triggerCancelBurstAlert446(entry, opts);
    // Clear window after alert to avoid spam
    _state446.controlWindow = [];
    _state446.cancelsInWindow = 0;
  }
}

function _triggerCancelBurstAlert446(entry, opts) {
  _state446.alertsTriggered++;
  _state446.lastAlertTs = _nowIso446();

  const alertData = {
    source: 'agentControlAuditBridge446',
    alertType: 'cancel_burst',
    cancelCount: _state446.cancelsInWindow,
    threshold: _state446.cancelBurstThreshold,
    windowMs: _state446.windowMs,
    lastCancel: entry,
    ts: _state446.lastAlertTs,
    ecosVersion: 'V446',
  };

  _pushHistory446({ ts: _state446.lastAlertTs, type: 'alert', data: alertData });

  // 1. Trigger alert escalation 425
  try {
    const alertMod = require('./alertEscalation425.js');
    if (alertMod && typeof alertMod.recordAlert425 === 'function') {
      alertMod.recordAlert425('agent_control_cancel_burst', alertData, opts && opts.auditLog);
    }
  } catch (_) {}

  // 2. Broadcast to admin WS hub
  const hub = opts && opts.adminWsHub;
  if (hub && typeof hub.broadcast === 'function') {
    try {
      hub.broadcast('agent.control.cancel_burst', alertData);
    } catch (_) {}
  }

  // 3. Audit log
  const al = opts && opts.auditLog;
  if (al && typeof al.append === 'function') {
    try {
      al.append('AGENT_CONTROL_CANCEL_BURST', alertData);
    } catch (_) {}
  }
}

/**
 * onAgentControl446(msg, opts)
 * Called for every message on the agentBus CONTROL channel.
 */
function onAgentControl446(msg, opts) {
  if (!_state446.enabled) return;
  const classification = _classifyControl446(msg);
  _recordControl446(classification, opts);
}

/**
 * subscribeToAgentBus446(opts)
 * @param {object} [opts]
 * @param {object} [opts.bus] — AgentBus instance with .subscribe(channel, agentId, handler)
 * @returns {{ok:boolean, subscribed:boolean, error?:string}}
 */
function subscribeToAgentBus446(opts) {
  if (_state446.subscribed) {
    return { ok: true, subscribed: true, note: 'already_subscribed' };
  }
  const bus = opts && opts.bus;
  if (!bus || typeof bus.subscribe !== 'function') {
    return { ok: false, subscribed: false, error: 'bus instance with subscribe() required' };
  }
  try {
    bus.subscribe('control', _state446.busAgentId, function(msg) {
      onAgentControl446(msg, opts);
    });
    _state446.subscribed = true;
    return { ok: true, subscribed: true };
  } catch (e) {
    return { ok: false, subscribed: false, error: e.message };
  }
}

/**
 * unsubscribeFromAgentBus446(opts)
 * @param {object} [opts]
 * @param {object} [opts.bus] — AgentBus instance
 * @returns {{ok:boolean, subscribed:boolean}}
 */
function unsubscribeFromAgentBus446(opts) {
  const bus = opts && opts.bus;
  if (bus && typeof bus.unsubscribeAll === 'function') {
    try {
      bus.unsubscribeAll(_state446.busAgentId, 'control');
    } catch (_) {}
  }
  _state446.subscribed = false;
  return { ok: true, subscribed: false };
}

/**
 * getControlStatus446()
 * @returns {{ok:boolean, version:string, state:object, history:object[]}}
 */
function getControlStatus446() {
  const now = _nowMs446();
  _pruneWindow446(now);
  return {
    ok: true,
    version: AGENT_CONTROL_AUDIT_BRIDGE_VERSION446,
    state: {
      enabled: _state446.enabled,
      cancelBurstThreshold: _state446.cancelBurstThreshold,
      windowMs: _state446.windowMs,
      totalControlsObserved: _state446.totalControlsObserved,
      totalCancelsObserved: _state446.totalCancelsObserved,
      alertsTriggered: _state446.alertsTriggered,
      lastControlTs: _state446.lastControlTs,
      lastAlertTs: _state446.lastAlertTs,
      subscribed: _state446.subscribed,
      windowSize: _state446.controlWindow.length,
      cancelsInWindow: _state446.cancelsInWindow,
    },
    history: _state446.history.slice(-20),
  };
}

/**
 * configureControlBridge446(opts)
 * @param {object} [opts]
 * @returns {{ok:boolean, config:object}}
 */
function configureControlBridge446(opts) {
  opts = opts || {};
  if (opts.enabled !== undefined) _state446.enabled = Boolean(opts.enabled);
  if (opts.cancelBurstThreshold !== undefined) _state446.cancelBurstThreshold = parseInt(opts.cancelBurstThreshold, 10);
  if (opts.windowMs !== undefined) _state446.windowMs = parseInt(opts.windowMs, 10);
  return {
    ok: true,
    config: {
      enabled: _state446.enabled,
      cancelBurstThreshold: _state446.cancelBurstThreshold,
      windowMs: _state446.windowMs,
    },
  };
}

/**
 * resetControlBridge446()
 * @returns {{ok:boolean}}
 */
function resetControlBridge446() {
  _state446.controlWindow = [];
  _state446.cancelsInWindow = 0;
  _state446.alertsTriggered = 0;
  _state446.totalControlsObserved = 0;
  _state446.totalCancelsObserved = 0;
  _state446.lastControlTs = null;
  _state446.lastAlertTs = null;
  _state446.history = [];
  return { ok: true };
}

/**
 * wireAgentControlAuditBridge446(app, opts)
 * @param {object} app — Express-like app
 * @param {object} [opts] — passed through to bridge functions
 */
function wireAgentControlAuditBridge446(app, opts) {
  if (!app || typeof app.get !== 'function') return;

  // V446-T01 GET /api/v1/admin/agent-control/status
  app.get('/api/v1/admin/agent-control/status', function(_req, res) {
    res.json(Object.assign({ ecosVersion: 'V446' }, getControlStatus446()));
  });

  // V446-T02 POST /api/v1/admin/agent-control/reset
  app.post('/api/v1/admin/agent-control/reset', function(_req, res) {
    res.json(Object.assign({ ok: true, ecosVersion: 'V446' }, resetControlBridge446()));
  });

  // V446-T03 POST /api/v1/admin/agent-control/configure
  app.post('/api/v1/admin/agent-control/configure', function(req, res) {
    const result = configureControlBridge446(req.body || {});
    res.json(Object.assign({ ok: true, ecosVersion: 'V446' }, result));
  });

  // V446-T04 GET /api/v1/admin/summary/v446
  app.get('/api/v1/admin/summary/v446', function(_req, res) {
    res.json({
      ok: true,
      ecosVersion: 'V446',
      feature: 'agent-control-command-audit-bridge — connects agentBus CONTROL channel → auditLog + adminWsHub + alertEscalation425',
      version: AGENT_CONTROL_AUDIT_BRIDGE_VERSION446,
      status: getControlStatus446(),
    });
  });
}

module.exports = {
  AGENT_CONTROL_AUDIT_BRIDGE_VERSION446,
  subscribeToAgentBus446,
  unsubscribeFromAgentBus446,
  getControlStatus446,
  configureControlBridge446,
  resetControlBridge446,
  wireAgentControlAuditBridge446,
  onAgentControl446,
  _state446,
};
