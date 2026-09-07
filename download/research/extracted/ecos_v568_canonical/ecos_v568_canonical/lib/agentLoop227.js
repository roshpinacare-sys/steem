// ============================================================
// src/lib/agentLoop227.js — Spend-Capped Agent Loop (P121-C)
// V227. Wraps agentLoop225 with a $20 USD human-in-the-loop
// (HITL) spend cap enforced per-project before each LLM call.
//
// Spend estimation:
//   - Per gateway.chat call: 1¢ (100 μ¢) base + 0.1¢ per tool call.
//   - Real costs from provider responses are used if the gateway
//     returns a `usage` field (tokens × rate table).
//   - Over-limit → loop aborts with { ok: false, code: 'HITL_REQUIRED_227' }.
//
// Usage:
//   const { runAgentLoop227 } = require('./agentLoop227');
//   const result = await runAgentLoop227({ projectId: 'proj-abc', ...opts });
//
// R1: sacred untouched. R2: identifiers end in _227. R3: zero new npm deps.
// ============================================================
'use strict';

const { runAgentLoop225, MAX_AGENT_STEPS_225 } = require('./agentLoop225');

// ── Spend constants ────────────────────────────────────────────────────────────
const HITL_LIMIT_USD_227       = 20;
const HITL_LIMIT_MICRO_227     = BigInt(Math.round(HITL_LIMIT_USD_227 * 10_000)); // μ¢
const BASE_CALL_MICRO_227      = 100n;  // 1¢ base per LLM call
const PER_TOOL_MICRO_227       = 10n;   // 0.1¢ per tool call within a step

// ── In-process spend ledger (projectId → BigInt μ¢) ──────────────────────────
// External integrators can inject their own spend map via opts.spendMap_227.
const _defaultSpendMap_227 = new Map();

function _getSpend_227(spendMap, projectId) {
  return spendMap.get(String(projectId)) || 0n;
}

function _addSpend_227(spendMap, projectId, delta) {
  const pid = String(projectId);
  const prev = spendMap.get(pid) || 0n;
  const next = prev + delta;
  spendMap.set(pid, next);
  return next;
}

function getProjectSpend_227(projectId, spendMap) {
  const m = spendMap || _defaultSpendMap_227;
  const micro = _getSpend_227(m, projectId);
  return {
    projectId: String(projectId),
    spentMicroCents: micro.toString(),
    spentUsd: (Number(micro) / 10_000).toFixed(4),
    limitUsd: HITL_LIMIT_USD_227,
    hitlRequired: micro >= HITL_LIMIT_MICRO_227,
  };
}

function resetProjectSpend_227(projectId, spendMap) {
  (spendMap || _defaultSpendMap_227).delete(String(projectId));
}

// ── Cost estimator ─────────────────────────────────────────────────────────────
function _estimateStepCost_227(toolCallCount, usageHint) {
  // usageHint: optional { inputTokens, outputTokens, provider } from gateway response
  if (usageHint && usageHint.inputTokens) {
    // Anthropic claude-3-5-sonnet: ~$3/Mtok in + $15/Mtok out → roughly 0.03μ¢/tok in + 0.15μ¢/tok out
    const inMicro  = BigInt(Math.ceil(usageHint.inputTokens  * 0.03));
    const outMicro = BigInt(Math.ceil((usageHint.outputTokens || 0) * 0.15));
    return inMicro + outMicro + PER_TOOL_MICRO_227 * BigInt(toolCallCount);
  }
  return BASE_CALL_MICRO_227 + PER_TOOL_MICRO_227 * BigInt(toolCallCount);
}

// ── Main loop ─────────────────────────────────────────────────────────────────
async function runAgentLoop227(opts) {
  const o = opts || {};
  const projectId_227 = String(o.projectId || '_default_227');
  const spendMap_227  = (o.spendMap_227 instanceof Map) ? o.spendMap_227 : _defaultSpendMap_227;

  // Pre-check: already over limit?
  if (_getSpend_227(spendMap_227, projectId_227) >= HITL_LIMIT_MICRO_227) {
    return {
      ok: false,
      code: 'HITL_REQUIRED_227',
      error: `Project "${projectId_227}" has exceeded the $${HITL_LIMIT_USD_227} autonomous spend cap. A human operator must review and reset the spend counter before further agent execution.`,
      spentUsd: (Number(_getSpend_227(spendMap_227, projectId_227)) / 10_000).toFixed(4),
      limitUsd: HITL_LIMIT_USD_227,
      steps: 0,
      trace: [],
      ecosVersion: 'V227',
    };
  }

  // Wrap tools to intercept tool runs for cost accounting
  const tools_227 = Array.isArray(o.tools) ? o.tools : [];
  let stepToolCalls_227 = 0;

  // Wrap gateway.chat to intercept + track spend after each step
  const innerGateway_227 = o.gateway;
  if (!innerGateway_227 || typeof innerGateway_227.chat !== 'function') {
    return { ok: false, code: 'AGENT_LOOP_227_BAD_OPTS', error: 'gateway with .chat required', steps: 0, trace: [], ecosVersion: 'V227' };
  }

  let hitlTripped_227 = false;
  let hitlStepSpend_227 = 0n;

  const wrappedGateway_227 = {
    chat: async (args) => {
      // spend check before each LLM call
      if (_getSpend_227(spendMap_227, projectId_227) >= HITL_LIMIT_MICRO_227) {
        hitlTripped_227 = true;
        return { ok: false, error: `HITL_REQUIRED_227: spend cap reached for project "${projectId_227}"` };
      }
      const r = await innerGateway_227.chat(args);
      // Account for this call
      const toolCount = Array.isArray(r.toolCalls) ? r.toolCalls.length : 0;
      const usageHint = r.raw && r.raw.usage ? { inputTokens: r.raw.usage.input_tokens, outputTokens: r.raw.usage.output_tokens, provider: args.provider } : null;
      const cost_227 = _estimateStepCost_227(toolCount, usageHint);
      const newTotal_227 = _addSpend_227(spendMap_227, projectId_227, cost_227);
      hitlStepSpend_227 += cost_227;
      if (newTotal_227 >= HITL_LIMIT_MICRO_227 && r.ok !== false) {
        // Flag for next iteration; current response still delivered
        hitlTripped_227 = true;
      }
      return r;
    },
  };

  // Build forwarded opts (strip projectId / spendMap so agentLoop225 doesn't choke)
  const fwd_227 = Object.assign({}, o, {
    gateway: wrappedGateway_227,
    projectId: undefined,
    spendMap_227: undefined,
  });

  const result_227 = await runAgentLoop225(fwd_227);

  // Annotate result with spend info
  const finalSpend_227 = _getSpend_227(spendMap_227, projectId_227);
  result_227.ecosVersion     = 'V227';
  result_227.projectId       = projectId_227;
  result_227.spentThisRunUsd = (Number(hitlStepSpend_227) / 10_000).toFixed(4);
  result_227.totalSpentUsd   = (Number(finalSpend_227) / 10_000).toFixed(4);
  result_227.limitUsd        = HITL_LIMIT_USD_227;
  result_227.hitlRequired    = finalSpend_227 >= HITL_LIMIT_MICRO_227;

  // If HITL tripped mid-run, mark as needing review
  if (hitlTripped_227 && result_227.ok) {
    result_227.warning = `HITL_WARNING_227: cumulative spend for project "${projectId_227}" has reached/exceeded $${HITL_LIMIT_USD_227}. Human review required before next run.`;
  }

  return result_227;
}

module.exports = {
  runAgentLoop227,
  getProjectSpend_227,
  resetProjectSpend_227,
  HITL_LIMIT_USD_227,
  HITL_LIMIT_MICRO_227,
  _defaultSpendMap_227,
};
