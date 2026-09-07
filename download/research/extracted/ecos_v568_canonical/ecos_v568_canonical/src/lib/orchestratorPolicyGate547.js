'use strict';
/**
 * src/lib/orchestratorPolicyGate547.js — ECOS V547
 *
 * Priority C: מחבר deepHealthPolicy546 ל-Orchestrator V437.
 *
 * לפני כל ביצוע תוכנית (executePlan437) — שאל את deepHealthPolicy546:
 *   MANUAL     → block לחלוטין (fail-closed). מחזיר { blocked:true, decision:'MANUAL' }.
 *   SUPERVISED → מריץ עם ctx.requiresOversight=true + flag בתוצאה.
 *   AUTO       → מריץ ללא הגבלה (pass-through).
 *
 * API:
 *   gatePlan547(plan, ctx)  — entry point; policy-gated replace for executePlan437.
 *   getPolicyStatus547()    — מצב ה-gate הנוכחי (decision + score + trend).
 *   probeCapability547(cap) — בדוק אם capability ספציפי יעבור כרגע.
 *
 * Zero deps. All identifiers end in 547.
 * @version 547.0.0
 */

const path = require('path');

const GATE_VERSION_547 = '547.0.0';

// ── safe module loaders ────────────────────────────────────────────────────

function _libDir547() {
  const d = __dirname;
  if (d.includes('/src/lib') || d.includes('src' + path.sep + 'lib')) {
    return path.resolve(d, '..', '..', 'lib');
  }
  return d;
}

let _orch437_547   = null;
let _policy546_547 = null;
let _loadErr547    = {};

function _loadDeps547() {
  const dir = _libDir547();
  if (!_orch437_547) {
    try { _orch437_547   = require(path.join(dir, 'moduleOrchestrator437.js')); }
    catch (e) { _loadErr547.orch = e.message; }
  }
  if (!_policy546_547) {
    try { _policy546_547 = require(path.join(dir, 'deepHealthPolicy546.js')); }
    catch (e) { _loadErr547.policy = e.message; }
  }
}

// ── policy read (fail-closed: no policy module = MANUAL) ──────────────────

function _readPolicy547() {
  _loadDeps547();
  if (!_policy546_547 || typeof _policy546_547.getPolicy546 !== 'function') {
    return {
      ok: false,
      decision: 'MANUAL',
      score: 0,
      trend: 'unknown',
      reasoning: _loadErr547.policy || 'deepHealthPolicy546 unavailable → fail-closed to MANUAL',
    };
  }
  try {
    return _policy546_547.getPolicy546();
  } catch (e) {
    return { ok: false, decision: 'MANUAL', score: 0, trend: 'unknown', reasoning: `policy error: ${e.message}` };
  }
}

// ── gate stats (in-memory, session-scoped) ─────────────────────────────────

const _stats547 = { total: 0, auto: 0, supervised: 0, blocked: 0, errors: 0 };

// ── main gate ─────────────────────────────────────────────────────────────

/**
 * Policy-gated plan execution. Wraps executePlan437.
 *
 * @param {object} plan  — from planFromIntent437()
 * @param {object} ctx   — execution context (passed to executePlan437)
 * @returns {{ ok:boolean, gateDecision:string, blocked?:boolean, result?:object, ... }}
 */
function gatePlan547(plan, ctx) {
  _loadDeps547();
  _stats547.total++;

  const policy547 = _readPolicy547();
  const decision547 = policy547.decision || 'MANUAL';

  // ── MANUAL → block (fail-closed) ────────────────────────────────────────
  if (decision547 === 'MANUAL') {
    _stats547.blocked++;
    return {
      ok:           false,
      version:      GATE_VERSION_547,
      blocked:      true,
      gateDecision: 'MANUAL',
      reason:       `Orchestrator blocked by policy gate: decision=MANUAL. ${policy547.reasoning || ''}`.trim(),
      policy: {
        decision: decision547,
        score:    policy547.score,
        trend:    policy547.trend,
      },
    };
  }

  // ── SUPERVISED or AUTO → execute ────────────────────────────────────────
  if (!_orch437_547 || typeof _orch437_547.executePlan437 !== 'function') {
    _stats547.errors++;
    return {
      ok:           false,
      version:      GATE_VERSION_547,
      blocked:      true,
      gateDecision: decision547,
      reason:       _loadErr547.orch || 'executePlan437 unavailable',
    };
  }

  const enrichedCtx547 = Object.assign({}, ctx, {
    policyDecision547:    decision547,
    requiresOversight547: decision547 === 'SUPERVISED',
    policyScore547:       policy547.score,
    policyTrend547:       policy547.trend,
  });

  try {
    const result547 = _orch437_547.executePlan437(plan, enrichedCtx547);
    if (decision547 === 'SUPERVISED') { _stats547.supervised++; }
    else                               { _stats547.auto++;       }

    return {
      ok:                true,
      version:           GATE_VERSION_547,
      blocked:           false,
      gateDecision:      decision547,
      requiresOversight: decision547 === 'SUPERVISED',
      policy: {
        decision: decision547,
        score:    policy547.score,
        trend:    policy547.trend,
      },
      result: result547,
    };
  } catch (e) {
    _stats547.errors++;
    return {
      ok:           false,
      version:      GATE_VERSION_547,
      blocked:      false,
      gateDecision: decision547,
      reason:       `executePlan437 threw: ${e.message}`,
    };
  }
}

/**
 * Current gate status (no side-effects).
 */
function getPolicyStatus547() {
  const p = _readPolicy547();
  return {
    ok:           true,
    version:      GATE_VERSION_547,
    gateOpen:     p.decision !== 'MANUAL',
    decision:     p.decision,
    score:        p.score,
    trend:        p.trend,
    reasoning:    p.reasoning,
    stats:        Object.assign({}, _stats547),
    orchAvailable: !!((_loadDeps547() || true) && _orch437_547 && typeof _orch437_547.executePlan437 === 'function'),
    generatedAt:  new Date().toISOString(),
  };
}

/**
 * Check if a given capability would be gated right now.
 * Returns { allowed:boolean, decision:string, reason:string }.
 */
function probeCapability547(capabilityId) {
  if (!capabilityId || typeof capabilityId !== 'string') {
    return { allowed: false, decision: 'MANUAL', reason: 'invalid capabilityId → fail-closed' };
  }
  const p = _readPolicy547();
  return {
    allowed:    p.decision !== 'MANUAL',
    decision:   p.decision,
    capability: capabilityId,
    score:      p.score,
    trend:      p.trend,
    reason:     p.decision === 'MANUAL'
      ? `blocked: ${p.reasoning || 'policy=MANUAL'}`
      : `allowed (${p.decision}): score=${(p.score||0).toFixed(3)}, trend=${p.trend}`,
  };
}

module.exports = {
  GATE_VERSION_547,
  gatePlan547,
  getPolicyStatus547,
  probeCapability547,
};
