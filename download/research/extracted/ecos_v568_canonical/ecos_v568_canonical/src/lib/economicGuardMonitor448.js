'use strict';
/**
 * src/lib/economicGuardMonitor448.js — ECOS V448
 *
 * Economic Guard Rejection Monitor
 * Connects economicMutationGuard402 → alertEscalation425 + auditLog + adminWsHub.
 * Tracks every V402 guard decision in a rolling window, computes a real health score,
 * and auto-escalates when reserve-invariant rejections occur or when the overall
 * rejection rate spikes.  Previously the safety dashboard (V439) reported V402 as
 * always score=100; V448 gives it an actual signal.  Money-safety first.
 *
 * R1: sacred files untouched.  R2: all identifiers end in 448.  R3: no new npm deps.
 *
 * @version 448.0.0
 */

const ECONOMIC_GUARD_MONITOR_VERSION448 = '448.0.0';

const _state448 = {
  enabled: true,
  windowMs: 5 * 60 * 1000,          // 5-minute rolling window
  rejectionThresholdPct: 30,        // escalate if >=30% rejected in window
  decisions: [],                   // {ts, op, allowed, stage, amountMicro}
  escalationsTriggered: 0,
  lastEscalationTs: null,
  history: [],
  maxHistory: 200,
  reserveInvariantAlerts: 0,
};

function _nowIso448() {
  return new Date().toISOString();
}

function _nowMs448() {
  return Date.now();
}

function _pruneWindow448(now) {
  const cutoff = now - _state448.windowMs;
  _state448.decisions = _state448.decisions.filter(function(e) { return e.ts >= cutoff; });
}

function _pushHistory448(entry) {
  _state448.history.push(entry);
  if (_state448.history.length > _state448.maxHistory) _state448.history.shift();
}

function _computeStats448() {
  const total = _state448.decisions.length;
  if (total === 0) {
    return { total: 0, allowed: 0, rejected: 0, byStage: {}, score: 100 };
  }
  const allowed = _state448.decisions.filter(function(e) { return e.allowed; }).length;
  const rejected = total - allowed;
  const byStage = {};
  for (let i = 0; i < _state448.decisions.length; i++) {
    const d = _state448.decisions[i];
    if (!d.allowed) {
      byStage[d.stage] = (byStage[d.stage] || 0) + 1;
    }
  }
  const rejectRate = rejected / total;
  // Score: 100 at 0% rejections, linear down to 0 at 100% rejections.
  // Reserve-invariant failures are doubly weighted in the score.
  const reserveInvariantCount = byStage['reserve_invariant'] || 0;
  const weightedRejects = rejected + reserveInvariantCount; // count reserve invariant twice
  const score = Math.max(0, Math.min(100, Math.round(100 - (weightedRejects / total) * 100)));
  return { total, allowed, rejected, byStage, rejectRate, score };
}

function _triggerEscalation448(reason, details, opts) {
  _state448.escalationsTriggered++;
  _state448.lastEscalationTs = _nowIso448();

  const alertData = {
    source: 'economicGuardMonitor448',
    reason: reason,
    details: details,
    ts: _state448.lastEscalationTs,
    ecosVersion: 'V448',
  };

  _pushHistory448({ ts: _state448.lastEscalationTs, type: 'escalation', data: alertData });

  // 1. Alert escalation 425
  try {
    const alertMod = require('./alertEscalation425.js');
    if (alertMod && typeof alertMod.recordAlert425 === 'function') {
      alertMod.recordAlert425('economic_guard_rejection', alertData, opts && opts.auditLog);
    }
  } catch (_) {}

  // 2. Broadcast to admin WS hub
  const hub = opts && opts.adminWsHub;
  if (hub && typeof hub.broadcast === 'function') {
    try { hub.broadcast('economic.guard.rejection', alertData); } catch (_) {}
  }

  // 3. Audit log
  const al = opts && opts.auditLog;
  if (al && typeof al.append === 'function') {
    try { al.append('ECONOMIC_GUARD_REJECTION', alertData); } catch (_) {}
  }
}

/**
 * trackDecision448(decision, opts)
 * Record a V402 decision and evaluate whether to escalate.
 * @param {{allowed:boolean, stage:string, op:string, userId:string, amountMicro:string|bigint}} decision
 * @param {object} [opts]
 * @param {object} [opts.auditLog]
 * @param {object} [opts.adminWsHub]
 */
function trackDecision448(decision, opts) {
  if (!_state448.enabled || !decision) return;
  const now = _nowMs448();
  _pruneWindow448(now);

  const entry = {
    ts: now,
    op: decision.op || 'unknown',
    allowed: !!decision.allowed,
    stage: decision.stage || 'unknown',
    userId: decision.userId || null,
    amountMicro: decision.amountMicro != null ? String(decision.amountMicro) : null,
  };
  _state448.decisions.push(entry);

  const stats = _computeStats448();

  // Immediate escalation for reserve invariant rejection — this means the system
  // is approaching insolvency and operators must know NOW.
  if (!decision.allowed && decision.stage === 'reserve_invariant') {
    _state448.reserveInvariantAlerts++;
    _triggerEscalation448('reserve_invariant_rejection', {
      userId: entry.userId,
      amountMicro: entry.amountMicro,
      op: entry.op,
      stats: stats,
    }, opts);
    return;
  }

  // Threshold escalation: if rejection rate is high and we have enough samples
  const minSamples = 5;
  if (stats.total >= minSamples && stats.rejectRate * 100 >= _state448.rejectionThresholdPct) {
    _triggerEscalation448('high_rejection_rate', {
      rejectRate: Math.round(stats.rejectRate * 100),
      threshold: _state448.rejectionThresholdPct,
      stats: stats,
    }, opts);
    // Clear window to avoid continuous spam
    _state448.decisions = [];
  }
}

/**
 * wrapGuardMint402(params, opts)
 * Calls the real V402 guardMint402 and tracks the decision automatically.
 * @returns {object} decision from V402
 */
function wrapGuardMint402(params, opts) {
  const G402 = require('./economicMutationGuard402.js');
  const decision = G402.guardMint402(params);
  trackDecision448(decision, opts);
  return decision;
}

/**
 * wrapGuardWithdraw402(params, opts)
 * Calls the real V402 guardWithdraw402 and tracks the decision automatically.
 * @returns {object} decision from V402
 */
function wrapGuardWithdraw402(params, opts) {
  const G402 = require('./economicMutationGuard402.js');
  const decision = G402.guardWithdraw402(params);
  trackDecision448(decision, opts);
  return decision;
}

function getHealthStatus448() {
  const stats = _computeStats448();
  return {
    version: ECONOMIC_GUARD_MONITOR_VERSION448,
    enabled: _state448.enabled,
    stats: stats,
    escalationsTriggered: _state448.escalationsTriggered,
    lastEscalationTs: _state448.lastEscalationTs,
    reserveInvariantAlerts: _state448.reserveInvariantAlerts,
    windowMs: _state448.windowMs,
    rejectionThresholdPct: _state448.rejectionThresholdPct,
    generatedAt: _nowIso448(),
  };
}

function configureEscalation448(opts) {
  opts = opts || {};
  if (opts.enabled !== undefined) _state448.enabled = !!opts.enabled;
  if (opts.windowMs !== undefined) _state448.windowMs = Math.max(1000, parseInt(opts.windowMs, 10));
  if (opts.rejectionThresholdPct !== undefined) {
    _state448.rejectionThresholdPct = Math.max(0, Math.min(100, parseInt(opts.rejectionThresholdPct, 10)));
  }
  return { ok: true, config: { enabled: _state448.enabled, windowMs: _state448.windowMs, rejectionThresholdPct: _state448.rejectionThresholdPct } };
}

function resetHistory448() {
  _state448.decisions = [];
  _state448.history = [];
  _state448.escalationsTriggered = 0;
  _state448.lastEscalationTs = null;
  _state448.reserveInvariantAlerts = 0;
  return { ok: true };
}

function wireEconomicGuardMonitor448(app) {
  if (!app) return;

  // V448-T01 GET /api/v1/admin/guard-monitor/status
  app.get('/api/v1/admin/guard-monitor/status', function(req, res) {
    res.json({ ok: true, ...getHealthStatus448() });
  });

  // V448-T02 POST /api/v1/admin/guard-monitor/configure
  app.post('/api/v1/admin/guard-monitor/configure', function(req, res) {
    try {
      const out = configureEscalation448(req.body || {});
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  // V448-T03 POST /api/v1/admin/guard-monitor/reset
  app.post('/api/v1/admin/guard-monitor/reset', function(req, res) {
    res.json(resetHistory448());
  });

  // V448-T04 POST /api/v1/guard/mint/monitored
  // Wrapper around V402 guardMint402 that automatically tracks the decision.
  app.post('/api/v1/guard/mint/monitored', function(req, res) {
    try {
      const b = req.body || {};
      if (!b.userId || b.amountMicro == null) {
        return res.status(400).json({ ok: false, error: 'userId and amountMicro required', code: 'BAD_ARGS', ecosVersion: 'V448' });
      }
      const P401 = require('./userProtection401.js');
      const breaker = P401.defaultCircuitBreaker401();
      let reserveStatus = b.reserveStatus || null;
      if (!reserveStatus) {
        try {
          const reserve = require('./creditReserve268.js').defaultCreditReserve268;
          if (reserve && reserve.getStatus) reserveStatus = reserve.getStatus();
        } catch (_) {}
      }
      const decision = wrapGuardMint402({
        breaker: breaker,
        userId: b.userId,
        amountMicro: b.amountMicro,
        reserveStatus: reserveStatus,
        hitlApproved: !!b.hitlApproved,
      });
      const { commit, ...rest } = decision;
      res.status(decision.allowed ? 200 : 409).json({ ok: decision.allowed, decision: rest, ecosVersion: 'V448' });
    } catch (e) {
      res.status((e && e.statusCode) || 500).json({ ok: false, error: e.message, code: e.code || 'ERROR', ecosVersion: 'V448' });
    }
  });

  // V448-T05 POST /api/v1/guard/withdraw/monitored
  app.post('/api/v1/guard/withdraw/monitored', function(req, res) {
    try {
      const b = req.body || {};
      if (!b.userId || b.amountMicro == null) {
        return res.status(400).json({ ok: false, error: 'userId and amountMicro required', code: 'BAD_ARGS', ecosVersion: 'V448' });
      }
      const P401 = require('./userProtection401.js');
      const breaker = P401.defaultCircuitBreaker401();
      const decision = wrapGuardWithdraw402({
        breaker: breaker,
        userId: b.userId,
        amountMicro: b.amountMicro,
        hitlApproved: !!b.hitlApproved,
      });
      const { commit, ...rest } = decision;
      res.status(decision.allowed ? 200 : 409).json({ ok: decision.allowed, decision: rest, ecosVersion: 'V448' });
    } catch (e) {
      res.status((e && e.statusCode) || 500).json({ ok: false, error: e.message, code: e.code || 'ERROR', ecosVersion: 'V448' });
    }
  });

  // V448-T06 GET /api/v1/admin/summary/v448
  app.get('/api/v1/admin/summary/v448', function(req, res) {
    res.json({
      ok: true, version: 'V448', feature: 'economic-guard-rejection-monitor',
      connects: ['economicMutationGuard402', 'alertEscalation425', 'auditLog', 'adminWsHub'],
      value: 'V402 rejections become visible: real health score for safety dashboard + auto-escalation on reserve-invariant blocks',
      endpoints: ['V448-T01 GET /api/v1/admin/guard-monitor/status',
                  'V448-T02 POST /api/v1/admin/guard-monitor/configure',
                  'V448-T03 POST /api/v1/admin/guard-monitor/reset',
                  'V448-T04 POST /api/v1/guard/mint/monitored',
                  'V448-T05 POST /api/v1/guard/withdraw/monitored',
                  'V448-T06 GET /api/v1/admin/summary/v448'],
      ecosVersion: 'V448',
    });
  });
}

module.exports = {
  ECONOMIC_GUARD_MONITOR_VERSION448,
  trackDecision448,
  wrapGuardMint402,
  wrapGuardWithdraw402,
  getHealthStatus448,
  configureEscalation448,
  resetHistory448,
  wireEconomicGuardMonitor448,
};
