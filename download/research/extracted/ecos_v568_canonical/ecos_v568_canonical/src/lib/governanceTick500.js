'use strict';
/**
 * src/lib/governanceTick500.js — ECOS V500 (Phase P379) — Learning Governance Tick
 *
 * THE MISSING BEAT. The system already has heartbeats (diamondHeartbeat454/465) — schedulers —
 * but they do NOT run the unified governance cycle (V499) and do NOT feed the learning engine
 * (V462). So the sovereign operator's "heartbeat" never actually exercised the full economy+code
 * loop or improved over time. This is NOT a third heartbeat (no timer, no competing class) — it
 * is the ACTION a beat should perform, which was absent: run one unified governance cycle
 * (propose-only) AND remember it so the operator learns trends across beats.
 *
 *   governanceTick500(signals, ctx) →
 *     1. cycle  = runGovernanceCycle499(signals, …)   (economy + code, propose-only, audited)
 *     2. ingest the cycle's cognition into the V462 engine (rolling memory)
 *     3. trends = analyzeTrends462()                   (foresight across beats)
 *     4. record a compact tick to the audit log
 *   Any scheduler (the existing heartbeats included) can call this each beat. Bounded by
 *   inheritance: never authorized, never auto-executes destructive actions.
 *
 * Reuses V499 + V462 (no new heartbeat). Pure JS, no new deps (R3/R6).
 * Read-only over sacred. Version-suffixed (…500).
 *
 * @version 500.0.0
 */

const TICK_VERSION_500 = '500.0.0';
let _GC500 = null, _CE500 = null;
try { _GC500 = require('./diamondGovernanceCycle499.js'); } catch (_) {}
try { _CE500 = require('./diamondCognitionEngine462.js'); } catch (_) {}

class TickError500 extends Error {
  constructor(msg, code) { super(msg); this.name = 'TickError500'; this.code = code || 'TICK_ERROR'; this.statusCode = 400; }
}

/**
 * Run one learning governance beat.
 * @param {object} signals  pillar signals for the cycle
 * @param {{ orchestrator, guard?, breaker?, reserveStatus?, audit?, executors?, codeHealthOpts?,
 *           engine?, recordHistory?:bool }} ctx   (engine: a DiamondCognitionEngine462; defaults to singleton)
 */
function governanceTick500(signals = {}, ctx = {}) {
  if (!_GC500 || typeof _GC500.runGovernanceCycle499 !== 'function') throw new TickError500('diamondGovernanceCycle499 required', 'NO_CYCLE');
  if (!ctx.orchestrator) throw new TickError500('orchestrator (V437) required', 'NO_ORCHESTRATOR');
  const audit = typeof ctx.audit === 'function' ? ctx.audit : null;

  // 1: one unified governance cycle — ALWAYS propose-only on a heartbeat (never auto-execute)
  const cycle = _GC500.runGovernanceCycle499(signals, Object.assign({}, ctx, { authorized: false, dryRun: true }));

  // 2: feed the cognition into the learning engine (rolling memory across beats)
  let ingested = null, trends = null;
  if (_CE500 && ctx.recordHistory !== false) {
    try {
      const engine = ctx.engine || (_CE500.defaultCognitionEngine462 ? _CE500.defaultCognitionEngine462({ audit }) : null);
      if (engine && typeof engine.ingestCognition462 === 'function') {
        const cog = {
          healthScore: cycle.cognition.healthScore,
          posture: cycle.cognition.posture,
          at: new Date().toISOString(),
          concerns: cycle.cognition.concerns || [],
          metrics: {
            solvencySurplus: (function () { try { const s = (cycle.cognition.concerns || []).length; return ctx.solvencySurplus != null ? ctx.solvencySurplus : null; } catch (_) { return null; } })(),
            dissatisfaction: ctx.dissatisfaction != null ? ctx.dissatisfaction : null,
          },
        };
        ingested = engine.ingestCognition462(cog);
        // 3: foresight across accumulated beats
        try { trends = engine.analyzeTrends462(); } catch (_) { trends = null; }
      }
    } catch (_) { ingested = null; }
  }

  // 4: compact audit record of the beat
  if (audit) { try { audit('diamond.governance_tick', { posture: cycle.cognition.posture, health: cycle.cognition.healthScore, actions: cycle.decisions.actionCount, mode: cycle.action.mode, trajectory: trends && trends.ready ? trends.trajectory : 'n/a' }); } catch (_) {} }

  return {
    version: TICK_VERSION_500,
    at: new Date().toISOString(),
    posture: cycle.cognition.posture,
    healthScore: cycle.cognition.healthScore,
    summary: cycle.summary,
    decisions: cycle.decisions.actionCount,
    mode: cycle.action.mode,                 // always 'propose' on a tick
    ingested: !!ingested,
    historyLength: ingested ? ingested.historyLength : null,
    trends: trends && trends.ready ? { trajectory: trends.trajectory, foresight: trends.foresight, earlyWarnings: trends.earlyWarnings } : null,
    cycle,
  };
}

module.exports = {
  TICK_VERSION_500, TickError500, governanceTick500,
};
