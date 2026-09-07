'use strict';
/**
 * src/lib/agentResultHealthBridge445.js — ECOS V445
 *
 * Agent Fleet Health Success Monitor
 * Connects agentBus RESULT channel → alertEscalation425 + adminWsHub + auditLog.
 * Tracks per-agent and fleet-wide success ratios over a sliding window.
 * When the fleet success ratio drops below a configurable threshold,
 * automatically triggers the alert escalation system so operators are
 * notified before degraded agent performance becomes user-visible downtime.
 *
 * Complements V444 (agentBus ERROR monitoring) to provide a complete
 * agent fleet health picture.
 *
 * R1: sacred files untouched. R2: all identifiers end in 445. R3: no new npm deps.
 *
 * @version 445.0.0
 */

const AGENT_RESULT_HEALTH_BRIDGE_VERSION445 = '445.0.0';

const _state445 = {
  enabled: true,
  successThresholdPct: 70,   // fleet success % must stay above this
  windowMs: 5 * 60 * 1000,   // 5 minutes
  resultWindow: [],           // {ts, agentId, ok} entries
  degradationsTriggered: 0,
  lastDegradationTs: null,
  lastResultTs: null,
  totalResultsObserved: 0,
  totalSuccesses: 0,
  totalFailures: 0,
  subscribed: false,
  busAgentId: 'agentResultHealthBridge445',
  history: [],
  maxHistory: 100,
};

function _nowIso445() {
  return new Date().toISOString();
}

function _nowMs445() {
  return Date.now();
}

function _pruneWindow445(now) {
  const cutoff = now - _state445.windowMs;
  _state445.resultWindow = _state445.resultWindow.filter(function(e) { return e.ts >= cutoff; });
}

function _pushHistory445(entry) {
  _state445.history.push(entry);
  if (_state445.history.length > _state445.maxHistory) _state445.history.shift();
}

function _classifyResult445(msg) {
  // ok=true  → success
  // ok=false or payload.error present → failure
  // timeout flag → failure
  if (!msg || typeof msg !== 'object') return { ok: false, reason: 'no_message' };
  const payload = msg.payload || {};
  if (payload.timeout === true) return { ok: false, reason: 'timeout' };
  if (payload.error || payload.err) return { ok: false, reason: 'error' };
  if (payload.ok === false) return { ok: false, reason: 'explicit_fail' };
  return { ok: true, reason: 'success' };
}

function _computeFleetRatio445() {
  const total = _state445.resultWindow.length;
  if (total === 0) return { total: 0, successes: 0, failures: 0, ratio: 100 };
  const successes = _state445.resultWindow.filter(function(e) { return e.ok; }).length;
  const failures = total - successes;
  const ratio = Math.round((successes / total) * 100);
  return { total, successes, failures, ratio };
}

/**
 * onAgentResult445(msg, opts)
 * Called for every message on the agentBus RESULT channel.
 */
function onAgentResult445(msg, opts) {
  if (!_state445.enabled) return;

  const classification = _classifyResult445(msg);
  const now = _nowMs445();

  _state445.totalResultsObserved++;
  if (classification.ok) {
    _state445.totalSuccesses++;
  } else {
    _state445.totalFailures++;
  }
  _state445.lastResultTs = _nowIso445();

  _pruneWindow445(now);
  _state445.resultWindow.push({
    ts: now,
    agentId: msg && msg.from ? msg.from : 'unknown',
    ok: classification.ok,
    reason: classification.reason,
  });

  const fleet = _computeFleetRatio445();

  const minSamplesForTrigger = 3;
  if (fleet.total >= minSamplesForTrigger && fleet.ratio < _state445.successThresholdPct) {
    // Only trigger if we have enough samples and the ratio is below the threshold.
    _triggerDegradationAlert445(fleet, msg, opts);
  }
}

function _triggerDegradationAlert445(fleet, msg, opts) {
  // Avoid spam: clear window after triggering so we don't fire continuously
  _state445.resultWindow = [];
  _state445.degradationsTriggered++;
  _state445.lastDegradationTs = _nowIso445();

  const alertData = {
    source: 'agentResultHealthBridge445',
    fleetSuccessRatio: fleet.ratio,
    fleetSuccesses: fleet.successes,
    fleetFailures: fleet.failures,
    fleetTotal: fleet.total,
    successThresholdPct: _state445.successThresholdPct,
    lastResultPayload: msg && msg.payload ? msg.payload : null,
    agentId: msg && msg.from ? msg.from : null,
    ts: _state445.lastDegradationTs,
    ecosVersion: 'V445',
  };

  _pushHistory445({ ts: _state445.lastDegradationTs, type: 'degradation', data: alertData });

  // 1. Trigger alert escalation 425
  try {
    const alertMod = require('./alertEscalation425.js');
    if (alertMod && typeof alertMod.recordAlert425 === 'function') {
      alertMod.recordAlert425('agent_health_degradation', alertData, opts && opts.auditLog);
    }
  } catch (_) {}

  // 2. Broadcast to admin WS hub
  const hub = opts && opts.adminWsHub;
  if (hub && typeof hub.broadcast === 'function') {
    try {
      hub.broadcast('agent.health.degradation', alertData);
    } catch (_) {}
  }

  // 3. Append to audit log
  const al = opts && opts.auditLog;
  if (al && typeof al.append === 'function') {
    try {
      al.append('AGENT_HEALTH_DEGRADATION', alertData);
    } catch (_) {}
  }
}

/**
 * subscribeToAgentBus445(opts)
 * @param {object} [opts]
 * @param {object} [opts.bus] — AgentBus instance with .subscribe(channel, agentId, handler)
 * @returns {{ok:boolean, subscribed:boolean, error?:string}}
 */
function subscribeToAgentBus445(opts) {
  if (_state445.subscribed) {
    return { ok: true, subscribed: true, note: 'already_subscribed' };
  }

  const bus = opts && opts.bus;
  if (!bus || typeof bus.subscribe !== 'function') {
    return { ok: false, subscribed: false, error: 'bus instance with subscribe() required' };
  }

  try {
    bus.subscribe('result', _state445.busAgentId, function(msg) {
      onAgentResult445(msg, opts);
    });
    _state445.subscribed = true;
    return { ok: true, subscribed: true };
  } catch (e) {
    return { ok: false, subscribed: false, error: e.message };
  }
}

/**
 * unsubscribeFromAgentBus445(opts)
 * @param {object} [opts]
 * @param {object} [opts.bus] — AgentBus instance
 * @returns {{ok:boolean, subscribed:boolean}}
 */
function unsubscribeFromAgentBus445(opts) {
  const bus = opts && opts.bus;
  if (bus && typeof bus.unsubscribe === 'function') {
    try {
      bus.unsubscribe('result', _state445.busAgentId);
    } catch (_) {}
  }
  _state445.subscribed = false;
  return { ok: true, subscribed: false };
}

/**
 * getHealthStatus445()
 * @returns {{ok:boolean, version:string, state:object, history:object[], fleetRatio:object}}
 */
function getHealthStatus445() {
  const fleet = _computeFleetRatio445();
  return {
    ok: true,
    version: AGENT_RESULT_HEALTH_BRIDGE_VERSION445,
    state: {
      enabled: _state445.enabled,
      successThresholdPct: _state445.successThresholdPct,
      windowMs: _state445.windowMs,
      totalResultsObserved: _state445.totalResultsObserved,
      totalSuccesses: _state445.totalSuccesses,
      totalFailures: _state445.totalFailures,
      degradationsTriggered: _state445.degradationsTriggered,
      lastDegradationTs: _state445.lastDegradationTs,
      lastResultTs: _state445.lastResultTs,
      subscribed: _state445.subscribed,
      windowSize: _state445.resultWindow.length,
    },
    fleetRatio: fleet,
    history: _state445.history.slice(-20),
  };
}

/**
 * configureHealthBridge445(opts)
 * @param {object} [opts]
 * @returns {{ok:boolean, config:object}}
 */
function configureHealthBridge445(opts) {
  opts = opts || {};
  if (opts.enabled !== undefined) _state445.enabled = Boolean(opts.enabled);
  if (opts.successThresholdPct !== undefined) _state445.successThresholdPct = parseInt(opts.successThresholdPct, 10);
  if (opts.windowMs !== undefined) _state445.windowMs = parseInt(opts.windowMs, 10);
  return {
    ok: true,
    config: {
      enabled: _state445.enabled,
      successThresholdPct: _state445.successThresholdPct,
      windowMs: _state445.windowMs,
    },
  };
}

/**
 * resetHealthBridge445()
 * @returns {{ok:boolean}}
 */
function resetHealthBridge445() {
  _state445.resultWindow = [];
  _state445.degradationsTriggered = 0;
  _state445.totalResultsObserved = 0;
  _state445.totalSuccesses = 0;
  _state445.totalFailures = 0;
  _state445.lastDegradationTs = null;
  _state445.lastResultTs = null;
  _state445.history = [];
  return { ok: true };
}

/**
 * wireAgentResultHealthBridge445(app, opts)
 * @param {object} app — Express-like app
 * @param {object} [opts] — passed through to bridge functions
 */
function wireAgentResultHealthBridge445(app, opts) {
  if (!app || typeof app.get !== 'function') return;

  // V445-T01 GET /api/v1/admin/agent-health/fleet-status
  app.get('/api/v1/admin/agent-health/fleet-status', function(_req, res) {
    res.json(Object.assign({ ecosVersion: 'V445' }, getHealthStatus445()));
  });

  // V445-T02 POST /api/v1/admin/agent-health/reset
  app.post('/api/v1/admin/agent-health/reset', function(_req, res) {
    res.json(Object.assign({ ok: true, ecosVersion: 'V445' }, resetHealthBridge445()));
  });

  // V445-T03 POST /api/v1/admin/agent-health/configure
  app.post('/api/v1/admin/agent-health/configure', function(req, res) {
    const result = configureHealthBridge445(req.body || {});
    res.json(Object.assign({ ok: true, ecosVersion: 'V445' }, result));
  });

  // V445-T04 GET /api/v1/admin/summary/v445
  app.get('/api/v1/admin/summary/v445', function(_req, res) {
    res.json({
      ok: true,
      ecosVersion: 'V445',
      feature: 'agent-fleet-health-success-monitor — connects agentBus RESULT channel → alertEscalation425 + adminWsHub + auditLog',
      version: AGENT_RESULT_HEALTH_BRIDGE_VERSION445,
      status: getHealthStatus445(),
    });
  });
}

module.exports = {
  AGENT_RESULT_HEALTH_BRIDGE_VERSION445,
  subscribeToAgentBus445,
  unsubscribeFromAgentBus445,
  getHealthStatus445,
  configureHealthBridge445,
  resetHealthBridge445,
  wireAgentResultHealthBridge445,
  onAgentResult445,
  _state445,
};
