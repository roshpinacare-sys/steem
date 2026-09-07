'use strict';
/**
 * src/lib/dispatcherInterlockWiring241.js — ECOS V241 (Phase P137 / Urgent Remediation)
 *
 * Wires dangerousToolInterlock240 into the AgentDispatcher239 dispatch loop.
 * Before every tool execution:
 *   1. enforceToolCall240(tool, args, ctx) — block sacred mutations hard; require
 *      HITL for destructive ops (aborts the current step, pauses the run).
 *   2. On ALLOW: execute tool.run(args).
 *   3. On success: assertNotSilentFailure240(result, tool.verify) — if silentFailure
 *      detected, fail the step (not just log).
 *
 * Also extends toolCatalog237 entry shape with optional `verify` field (spec object
 * for assertNotSilentFailure240); backward-compatible (field is optional).
 *
 * Zero new npm deps (R6). Identifiers end with 241.
 * @version 241.0.0
 */

const { enforceToolCall240, SacredViolationError240 } = require('./dangerousToolInterlock240.js');
const { assertNotSilentFailure240 } = require('./actionVerifier240.js');
const { defaultAuditLog } = require('./auditLog.js');

/**
 * Wrap a tool's run function with pre/post interlock checks.
 *
 * @param {object} tool — catalog entry: { name, run, verify?, destructive? }
 * @param {{ hitlGate?, userId? }} [ctx241]
 * @returns {object} — wrapped tool with same shape
 */
function wrapToolWithInterlock241(tool, ctx241 = {}) {
  if (!tool || typeof tool.run !== 'function') return tool;

  const originalRun241 = tool.run.bind(tool);
  const auditFn241 = (ev) => {
    try { defaultAuditLog.append('AGENT_GUARDRAIL_241', ev); } catch (_) {}
  };

  return Object.assign(Object.create(Object.getPrototypeOf(tool)), tool, {
    run: async ({ args, ctx }) => {
      // ── Pre-execution interlock ────────────────────────────────────────────
      let enforcement241;
      try {
        enforcement241 = enforceToolCall240(tool, args || {}, {
          confidence: ctx && ctx.confidence,
          hitlGate:   ctx241.hitlGate || (ctx && ctx.hitlGate),
          audit:      auditFn241,
          userId:     ctx241.userId   || (ctx && ctx.userId),
        });
      } catch (e241a) {
        // BLOCK — sacred violation; re-throw as-is (SacredViolationError240)
        try { defaultAuditLog.append('AGENT_STEP_BLOCKED_241', { tool: tool.name, reason: e241a.message, userId: ctx241.userId || null }); } catch (_) {}
        throw e241a;
      }

      if (!enforcement241.allowed) {
        // REQUIRE_HITL — pause the step; signal caller to await human approval
        const err241b = new Error(`[V241] tool "${tool.name}" requires HITL approval before execution: ${enforcement241.reasons.join('; ')}`);
        err241b.code = 'HITL_REQUIRED_241';
        err241b.statusCode = 202;
        err241b.hitl = enforcement241.hitl;
        err241b.reasons = enforcement241.reasons;
        try { defaultAuditLog.append('AGENT_STEP_HITL_241', { tool: tool.name, hitl: enforcement241.hitl, userId: ctx241.userId || null }); } catch (_) {}
        throw err241b;
      }

      // ── Execute ────────────────────────────────────────────────────────────
      const result241 = await originalRun241({ args, ctx });

      // ── Post-execution silent-failure check ────────────────────────────────
      if (tool.verify) {
        try {
          assertNotSilentFailure240(result241, tool.verify);
        } catch (e241c) {
          try { defaultAuditLog.append('AGENT_SILENT_FAILURE_241', { tool: tool.name, error: e241c.message, userId: ctx241.userId || null }); } catch (_) {}
          throw e241c; // fail the step — do not silently swallow
        }
      }

      return result241;
    }
  });
}

/**
 * Wrap all tools in a loopTools array with the interlock.
 *
 * @param {Array<object>} loopTools241 — array of { name, run, verify?, destructive? }
 * @param {{ hitlGate?, userId? }} [ctx241]
 * @returns {Array<object>}
 */
function wrapAllToolsWithInterlock241(loopTools241, ctx241 = {}) {
  if (!Array.isArray(loopTools241)) return loopTools241;
  return loopTools241.map(t => wrapToolWithInterlock241(t, ctx241));
}

module.exports = {
  wrapToolWithInterlock241,
  wrapAllToolsWithInterlock241,
};
