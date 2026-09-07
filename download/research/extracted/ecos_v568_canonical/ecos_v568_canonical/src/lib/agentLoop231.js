// ============================================================
// src/lib/agentLoop231.js — Persist-Wired AgentLoop (P126-A)
// V232. Wraps agentLoop230 and auto-persists every spend event
// to spendLedgerPersistence231 — no caller code required.
//
// Changes vs agentLoop230:
//   - _addSpend_231() calls appendSpend_231() after every spend update.
//   - All identifiers end in _231.
//   - Zero new npm deps (R3). Sacred files untouched (R1).
//
// Usage (drop-in replacement for runAgentLoop230):
//   const { runAgentLoop231 } = require('./agentLoop231');
//   const result = await runAgentLoop231({ projectId: 'proj-abc', ...opts });
// ============================================================
'use strict';

const { runAgentLoop225, MAX_AGENT_STEPS_225 } = require('./agentLoop225');
const { estimateSpend_229 }    = require('./spendRateTables229');
const { appendSpend_231, initLedger_231 } = require('./spendLedgerPersistence231');

// ── Spend constants (same as V230) ────────────────────────────────────────────
const HITL_LIMIT_USD_231       = 20;
const HITL_LIMIT_MICRO_231     = BigInt(Math.round(HITL_LIMIT_USD_231 * 10_000)); // μ¢
const BASE_CALL_MICRO_231      = 100n;  // 1¢ flat fallback per LLM call
const PER_TOOL_MICRO_231       = 10n;   // 0.1¢ per tool call within a step

// ── In-process spend ledger (own map, separate from V230) ─────────────────────
const _defaultSpendMap_231 = new Map();

function _getSpend_231(spendMap, projectId) {
  return spendMap.get(String(projectId)) || 0n;
}

function _addSpend_231(spendMap, projectId, delta) {
  const pid   = String(projectId);
  const prev  = spendMap.get(pid) || 0n;
  const next  = prev + delta;
  spendMap.set(pid, next);
  // P126-A: auto-persist every spend event
  appendSpend_231(pid, delta, next);
  return next;
}

function getProjectSpend_231(projectId, spendMap) {
  const m    = spendMap || _defaultSpendMap_231;
  const micro = _getSpend_231(m, projectId);
  return {
    projectId:       String(projectId),
    spentMicroCents: micro.toString(),
    spentUsd:        (Number(micro) / 10_000).toFixed(4),
    limitUsd:        HITL_LIMIT_USD_231,
    hitlRequired:    micro >= HITL_LIMIT_MICRO_231,
    ecosVersion:     'V232',
  };
}

function resetProjectSpend_231(projectId, spendMap) {
  (spendMap || _defaultSpendMap_231).delete(String(projectId));
}

// ── Token-accurate cost estimator (same logic as V230) ────────────────────────
function _estimateStepCost_231(toolCallCount, usageHint) {
  const toolCost_231 = PER_TOOL_MICRO_231 * BigInt(toolCallCount);
  if (usageHint && typeof usageHint.inputTokens === 'number') {
    const tokenCost_231 = estimateSpend_229(usageHint, usageHint.provider || '');
    if (tokenCost_231 > 0n) {
      return tokenCost_231 + toolCost_231;
    }
  }
  return BASE_CALL_MICRO_231 + toolCost_231;
}

// ── Main loop ─────────────────────────────────────────────────────────────────
async function runAgentLoop231(opts) {
  const o = opts || {};
  const projectId_231 = String(o.projectId || '_default_231');
  const spendMap_231  = (o.spendMap_231 instanceof Map) ? o.spendMap_231
                      : (o.spendMap_230 instanceof Map) ? o.spendMap_230  // accept v230 map
                      : (o.spendMap_227 instanceof Map) ? o.spendMap_227  // accept v227 map
                      : _defaultSpendMap_231;

  // Ensure ledger is initialized (graceful no-op if already done)
  initLedger_231();

  // Pre-check: already over limit?
  if (_getSpend_231(spendMap_231, projectId_231) >= HITL_LIMIT_MICRO_231) {
    return {
      ok:       false,
      code:     'HITL_REQUIRED_231',
      error:    `Project "${projectId_231}" has exceeded the $${HITL_LIMIT_USD_231} autonomous spend cap. A human operator must review and reset the spend counter before further agent execution.`,
      spentUsd: (Number(_getSpend_231(spendMap_231, projectId_231)) / 10_000).toFixed(4),
      limitUsd: HITL_LIMIT_USD_231,
      steps:    0,
      trace:    [],
      ecosVersion: 'V232',
    };
  }

  const innerGateway_231 = o.gateway;
  if (!innerGateway_231 || typeof innerGateway_231.chat !== 'function') {
    return {
      ok:    false,
      code:  'AGENT_LOOP_231_BAD_OPTS',
      error: 'gateway with .chat required',
      steps: 0,
      trace: [],
      ecosVersion: 'V232',
    };
  }

  let hitlTripped_231    = false;
  let hitlStepSpend_231  = 0n;

  const wrappedGateway_231 = {
    chat: async (args) => {
      if (_getSpend_231(spendMap_231, projectId_231) >= HITL_LIMIT_MICRO_231) {
        hitlTripped_231 = true;
        return { ok: false, error: `HITL_REQUIRED_231: spend cap reached for project "${projectId_231}"` };
      }

      const r = await innerGateway_231.chat(args);

      // Build usageHint from real token counts
      const rawUsage_231 = r.raw && r.raw.usage;
      const usageHint_231 = rawUsage_231
        ? {
            inputTokens:  rawUsage_231.input_tokens  || 0,
            outputTokens: rawUsage_231.output_tokens || 0,
            provider: args.model || args.provider || '',
          }
        : (r.usage
          ? {
              inputTokens:  r.usage.input_tokens  || r.usage.inputTokens  || 0,
              outputTokens: r.usage.output_tokens || r.usage.outputTokens || 0,
              provider: args.model || args.provider || '',
            }
          : null);

      const toolCount_231 = Array.isArray(r.toolCalls) ? r.toolCalls.length : 0;
      const cost_231      = _estimateStepCost_231(toolCount_231, usageHint_231);
      // _addSpend_231 auto-persists via appendSpend_231 (P126-A)
      const newTotal_231  = _addSpend_231(spendMap_231, projectId_231, cost_231);
      hitlStepSpend_231  += cost_231;

      // Annotate response with spend metadata
      if (r && typeof r === 'object') {
        r._spend231 = {
          stepCostMicro: cost_231.toString(),
          totalMicro:    newTotal_231.toString(),
          tokenAccurate: !!(usageHint_231 && usageHint_231.inputTokens),
          persisted:     true,
        };
      }

      if (newTotal_231 >= HITL_LIMIT_MICRO_231 && r.ok !== false) {
        hitlTripped_231 = true;
      }
      return r;
    },
  };

  const fwd_231 = Object.assign({}, o, {
    gateway:     wrappedGateway_231,
    projectId:   undefined,
    spendMap_231: undefined,
    spendMap_230: undefined,
    spendMap_227: undefined,
  });

  const result_231 = await runAgentLoop225(fwd_231);

  const finalSpend_231        = _getSpend_231(spendMap_231, projectId_231);
  result_231.ecosVersion      = 'V232';
  result_231.projectId        = projectId_231;
  result_231.spentThisRunUsd  = (Number(hitlStepSpend_231) / 10_000).toFixed(4);
  result_231.totalSpentUsd    = (Number(finalSpend_231) / 10_000).toFixed(4);
  result_231.limitUsd         = HITL_LIMIT_USD_231;
  result_231.hitlRequired     = finalSpend_231 >= HITL_LIMIT_MICRO_231;
  result_231.spendEstimator   = 'token-accurate-v231-persisted';

  if (hitlTripped_231 && result_231.ok) {
    result_231.warning = `HITL_WARNING_231: cumulative spend for project "${projectId_231}" has reached/exceeded $${HITL_LIMIT_USD_231}. Human review required before next run.`;
  }

  return result_231;
}

module.exports = {
  runAgentLoop231,
  getProjectSpend_231,
  resetProjectSpend_231,
  HITL_LIMIT_USD_231,
  HITL_LIMIT_MICRO_231,
  _defaultSpendMap_231,
};
