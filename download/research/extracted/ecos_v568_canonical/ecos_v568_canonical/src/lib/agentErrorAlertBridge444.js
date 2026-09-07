'use strict';
/**
 * src/lib/agentErrorAlertBridge444.js — ECOS V444
 *
 * Agent Error Alert Bridge
 * Connects agentBus ERROR channel → alertEscalation425 + adminWsHub + auditLog.
 * When agents report errors at an elevated rate, this bridge automatically triggers
 * the existing alert escalation system so operators are paged before agent
 * failures cascade into user-visible downtime.
 *
 * R1: sacred files untouched. R2: all identifiers end in 444. R3: no new npm deps.
 *
 * @version 444.0.0
 */

const AGENT_ERROR_ALERT_BRIDGE_VERSION444 = '444.0.0';

const _state444 = {
  enabled: true,
  thresholdCount: 3,
  windowMs: 5 * 60 * 1000, // 5 minutes
  errorWindow: [],         // timestamps of observed errors
  escalationsTriggered: 0,
  lastEscalationTs: null,
  lastErrorTs: null,
  totalErrorsObserved: 0,
  subscribed: false,
  busAgentId: 'agentErrorBridge444',
  history: [],
  maxHistory: 100,
};

function _nowIso444() {
  return new Date().toISOString();
}

function _nowMs444() {
  return Date.now();
}

function _pruneWindow444(now) {
  const cutoff = now - _state444.windowMs;
  _state444.errorWindow = _state444.errorWindow.filter(function(t) { return t >= cutoff; });
}

function _pushHistory444(entry) {
  _state444.history.push(entry);
  if (_state444.history.length > _state444.maxHistory) _state444.history.shift();
}

/**
 * onAgentError444(msg, opts)
 * Called for every message on the agentBus ERROR channel.
 */
function onAgentError444(msg, opts) {
  if (!_state444.enabled) return;

  const now = _nowMs444();
  _state444.totalErrorsObserved++;
  _state444.lastErrorTs = _nowIso444();

  _pruneWindow444(now);
  _state444.errorWindow.push(now);

  const windowCount = _state444.errorWindow.length;

  if (windowCount >= _state444.thresholdCount) {
    _triggerEscalation444(windowCount, msg, opts);
  }
}

function _triggerEscalation444(windowCount, msg, opts) {
  // Avoid spam: clear window after triggering so we don't fire continuously
  _state444.errorWindow = [];
  _state444.escalationsTriggered++;
  _state444.lastEscalationTs = _nowIso444();

  const alertData = {
    source: 'agentErrorAlertBridge444',
    windowCount: windowCount,
    thresholdCount: _state444.thresholdCount,
    windowMs: _state444.windowMs,
    lastErrorPayload: msg && msg.payload ? msg.payload : null,
    agentId: msg && msg.from ? msg.from : null,
    ts: _state444.lastEscalationTs,
    ecosVersion: 'V444',
  };

  _pushHistory444({ ts: _state444.lastEscalationTs, type: 'escalation', data: alertData });

  // 1. Trigger alert escalation 425
  try {
    const alertMod = require('./alertEscalation425.js');
    if (alertMod && typeof alertMod.recordAlert425 === 'function') {
      alertMod.recordAlert425('agent_error', alertData, opts && opts.auditLog);
    }
  } catch (_) {}

  // 2. Broadcast to admin WS hub
  const hub = opts && opts.adminWsHub;
  if (hub && typeof hub.broadcast === 'function') {
    try {
      hub.broadcast('agent.error.escalation', alertData);
    } catch (_) {}
  }

  // 3. Append to audit log
  const al = opts && opts.auditLog;
  if (al && typeof al.append === 'function') {
    try {
      al.append('AGENT_ERROR_ESCALATION', alertData);
    } catch (_) {}
  }
}

/**
 * subscribeToAgentBus444(opts)
 * @param {object} [opts]
 * @param {object} [opts.bus] — AgentBus instance with .subscribe(channel, agentId, handler)
 * @returns {{ok:boolean, subscribed:boolean, error?:string}}
 */
function subscribeToAgentBus444(opts) {
  if (_state444.subscribed) {
    return { ok: true, subscribed: true, note: 'already_subscribed' };
  }

  const bus = opts && opts.bus;
  if (!bus || typeof bus.subscribe !== 'function') {
    return { ok: false, subscribed: false, error: 'bus instance with subscribe() required' };
  }

  try {
    bus.subscribe('error', _state444.busAgentId, function(msg) {
      onAgentError444(msg, opts);
    });
    _state444.subscribed = true;
    return { ok: true, subscribed: true };
  } catch (e) {
    return { ok: false, subscribed: false, error: e.message };
  }
}

/**
 * unsubscribeFromAgentBus444(opts)
 * @param {object} [opts]
 * @param {object} [opts.bus] — AgentBus instance
 * @returns {{ok:boolean, subscribed:boolean}}
 */
function unsubscribeFromAgentBus444(opts) {
  const bus = opts && opts.bus;
  if (bus && typeof bus.unsubscribe === 'function') {
    try {
      bus.unsubscribe('error', _state444.busAgentId);
    } catch (_) {}
  }
  _state444.subscribed = false;
  return { ok: true, subscribed: false };
}

/**
 * getBridgeStatus444()
 * @returns {{ok:boolean, version:string, state:object, history:object[]}}
 */
function getBridgeStatus444() {
  return {
    ok: true,
    version: AGENT_ERROR_ALERT_BRIDGE_VERSION444,
    state: {
      enabled: _state444.enabled,
      thresholdCount: _state444.thresholdCount,
      windowMs: _state444.windowMs,
      totalErrorsObserved: _state444.totalErrorsObserved,
      escalationsTriggered: _state444.escalationsTriggered,
      lastEscalationTs: _state444.lastEscalationTs,
      lastErrorTs: _state444.lastErrorTs,
      subscribed: _state444.subscribed,
      windowCount: _state444.errorWindow.length,
    },
    history: _state444.history.slice(-20),
  };
}

/**
 * configureBridge444(opts)
 * @param {object} [opts]
 * @returns {{ok:boolean, config:object}}
 */
function configureBridge444(opts) {
  opts = opts || {};
  if (opts.enabled !== undefined) _state444.enabled = Boolean(opts.enabled);
  if (opts.thresholdCount !== undefined) _state444.thresholdCount = parseInt(opts.thresholdCount, 10);
  if (opts.windowMs !== undefined) _state444.windowMs = parseInt(opts.windowMs, 10);
  return {
    ok: true,
    config: {
      enabled: _state444.enabled,
      thresholdCount: _state444.thresholdCount,
      windowMs: _state444.windowMs,
    },
  };
}

/**
 * resetBridge444()
 * @returns {{ok:boolean}}
 */
function resetBridge444() {
  _state444.errorWindow = [];
  _state444.escalationsTriggered = 0;
  _state444.totalErrorsObserved = 0;
  _state444.lastEscalationTs = null;
  _state444.lastErrorTs = null;
  _state444.history = [];
  return { ok: true };
}

/**
 * wireAgentErrorAlertBridge444(app, opts)
 * @param {object} app — Express-like app
 * @param {object} [opts] — passed through to bridge functions
 */
function wireAgentErrorAlertBridge444(app, opts) {
  if (!app || typeof app.get !== 'function') return;

  // V444-T01 GET /api/v1/admin/agent-error-bridge/status
  app.get('/api/v1/admin/agent-error-bridge/status', function(_req, res) {
    res.json(Object.assign({ ecosVersion: 'V444' }, getBridgeStatus444()));
  });

  // V444-T02 POST /api/v1/admin/agent-error-bridge/reset
  app.post('/api/v1/admin/agent-error-bridge/reset', function(_req, res) {
    res.json(Object.assign({ ok: true, ecosVersion: 'V444' }, resetBridge444()));
  });

  // V444-T03 POST /api/v1/admin/agent-error-bridge/configure
  app.post('/api/v1/admin/agent-error-bridge/configure', function(req, res) {
    const result = configureBridge444(req.body || {});
    res.json(Object.assign({ ok: true, ecosVersion: 'V444' }, result));
  });

  // V444-T04 GET /api/v1/admin/summary/v444
  app.get('/api/v1/admin/summary/v444', function(_req, res) {
    res.json({
      ok: true,
      ecosVersion: 'V444',
      feature: 'agent-error-alert-bridge — connects agentBus ERROR channel → alertEscalation425 + adminWsHub + auditLog',
      version: AGENT_ERROR_ALERT_BRIDGE_VERSION444,
      status: getBridgeStatus444(),
    });
  });
}

module.exports = {
  AGENT_ERROR_ALERT_BRIDGE_VERSION444,
  subscribeToAgentBus444,
  unsubscribeFromAgentBus444,
  getBridgeStatus444,
  configureBridge444,
  resetBridge444,
  wireAgentErrorAlertBridge444,
  onAgentError444,
  _state444,
};
