'use strict';
/**
 * src/lib/heartbeatGovernanceState501.js — ECOS V501 (Phase P380) — Governance-Backed Heartbeat State
 *
 * THE FIX THAT MAKES THE HEARTBEAT REAL. The system has a heartbeat scheduler (diamondHeartbeat465)
 * wired into the server — but its state provider tried to call methods that don't exist
 * (solvency.health(), proofOfSolvency.surplus()), silently fell through, and fed the learning
 * engine a CONSTANT healthScore=70 on every beat. So the heartbeat "learned" from a flat line.
 *
 * This supplies the missing real state provider, backed by the unified governance cycle (V499):
 * each beat now reflects ACTUAL economy + code health (posture, real healthScore, proposal count),
 * so the cognition engine (V462) finally learns from a true signal. CONNECTION > ADDITION — it
 * reuses the existing heartbeat465 class and V499 cycle; no new scheduler.
 *
 *   governanceSystemState501(ctx) → an async getSystemState() compatible with diamondHeartbeat465,
 *                                   returning real { healthScore, solvencySurplus, dissatisfaction,
 *                                   posture, proposals } from one propose-only governance cycle.
 *
 * Reuses diamondGovernanceCycle499 (no reinvention). Pure JS, no new deps (R3/R6).
 * Read-only over sacred. Version-suffixed (…501).
 *
 * @version 501.0.0
 */

const HB_STATE_VERSION_501 = '501.0.0';
let _GC501 = null;
try { _GC501 = require('./diamondGovernanceCycle499.js'); } catch (_) {}

class HbStateError501 extends Error {
  constructor(msg, code) { super(msg); this.name = 'HbStateError501'; this.code = code || 'HB_STATE_ERROR'; this.statusCode = 400; }
}

/**
 * Build an async getSystemState() backed by the unified governance cycle.
 * @param {{ orchestrator, guard?, breaker?, reserveStatus?, audit?, codeHealthOpts?, signals?,
 *           solvencySurplus?, dissatisfaction? }} ctx
 *   signals may be an object or a function returning the live pillar signals.
 * @returns {() => Promise<{healthScore, solvencySurplus, dissatisfaction, posture, proposals}>}
 */
function governanceSystemState501(ctx = {}) {
  if (!_GC501 || typeof _GC501.runGovernanceCycle499 !== 'function') throw new HbStateError501('diamondGovernanceCycle499 required', 'NO_CYCLE');
  if (!ctx.orchestrator) throw new HbStateError501('orchestrator (V437) required', 'NO_ORCHESTRATOR');
  return async function getSystemState() {
    let signals = {};
    try { signals = (typeof ctx.signals === 'function') ? (ctx.signals() || {}) : (ctx.signals || {}); } catch (_) { signals = {}; }
    // one propose-only governance cycle — economy + code; never executes from a heartbeat
    const cycle = _GC501.runGovernanceCycle499(signals, Object.assign({}, ctx, { authorized: false, dryRun: true }));
    const c = cycle && cycle.cognition ? cycle.cognition : { healthScore: null, posture: 'unknown' };
    return {
      version: HB_STATE_VERSION_501,
      healthScore: (typeof c.healthScore === 'number') ? c.healthScore : null,
      solvencySurplus: ctx.solvencySurplus != null ? ctx.solvencySurplus : null,
      dissatisfaction: ctx.dissatisfaction != null ? ctx.dissatisfaction : null,
      posture: c.posture,
      proposals: cycle && cycle.decisions ? cycle.decisions.actionCount : 0,
    };
  };
}

module.exports = {
  HB_STATE_VERSION_501, HbStateError501, governanceSystemState501,
};
