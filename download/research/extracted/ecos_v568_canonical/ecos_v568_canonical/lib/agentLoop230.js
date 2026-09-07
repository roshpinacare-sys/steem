// ============================================================
// src/lib/agentLoop230.js — Token-Accurate Spend Integration (P124-A)
// V230. Wraps agentLoop227 to replace its rough flat estimator
// with the token-accurate estimateSpend_229() from spendRateTables229.
//
// Changes vs agentLoop227:
//   - _estimateStepCost_230() calls estimateSpend_229(usageHint, provider)
//     when token usage is available, falls back to flat 100n+10n×tools only
//     when estimateSpend_229 returns 0n.
//   - All identifiers end in _230.
//   - Zero new npm deps (R3). Sacred files untouched (R1).
//
// Usage (drop-in replacement for runAgentLoop227):
//   const { runAgentLoop230 } = require('./agentLoop230');
//   const result = await runAgentLoop230({ projectId: 'proj-abc', ...opts });
// ============================================================
'use strict';

const { runAgentLoop225, MAX_AGENT_STEPS_225 } = require('./agentLoop225');
const { estimateSpend_229 } = require('./spendRateTables229');

// ── Spend constants (same as V227) ────────────────────────────────────────────
const HITL_LIMIT_USD_230       = 20;
const HITL_LIMIT_MICRO_230     = BigInt(Math.round(HITL_LIMIT_USD_230 * 10_000)); // μ¢
const BASE_CALL_MICRO_230      = 100n;  // 1¢ flat fallback per LLM call
const PER_TOOL_MICRO_230       = 10n;   // 0.1¢ per tool call within a step

// ── In-process spend ledger ────────────────────────────────────────────────────
const _defaultSpendMap_230 = new Map();

function _getSpend_230(spendMap, projectId) {
  return spendMap.get(String(projectId)) || 0n;
}

function _addSpend_230(spendMap, projectId, delta) {
  const pid = String(projectId);
  const prev = spendMap.get(pid) || 0n;
  const next = prev + delta;
  spendMap.set(pid, next);
  return next;
}

function getProjectSpend_230(projectId, spendMap) {
  const m = spendMap || _defaultSpendMap_230;
  const micro = _getSpend_230(m, projectId);
  return {
    projectId: String(projectId),
    spentMicroCents: micro.toString(),
    spentUsd: (Number(micro) / 10_000).toFixed(4),
    limitUsd: HITL_LIMIT_USD_230,
    hitlRequired: micro >= HITL_LIMIT_MICRO_230,
    ecosVersion: 'V230',
  };
}

function resetProjectSpend_230(projectId, spendMap) {
  (spendMap || _defaultSpendMap_230).delete(String(projectId));
}

// ── Token-accurate cost estimator (P124-A) ─────────────────────────────────────
// Calls estimateSpend_229 when token data is present; falls back to flat
// estimate only when estimateSpend_229 returns 0n (i.e. no inputTokens).
function _estimateStepCost_230(toolCallCount, usageHint) {
  const toolCost_230 = PER_TOOL_MICRO_230 * BigInt(toolCallCount);
  if (usageHint && typeof usageHint.inputTokens === 'number') {
    const tokenCost_230 = estimateSpend_229(usageHint, usageHint.provider || '');
    if (tokenCost_230 > 0n) {
      return tokenCost_230 + toolCost_230;
    }
  }
  // Fallback: flat estimate (same as agentLoop227 built-in)
  return BASE_CALL_MICRO_230 + toolCost_230;
}

// ── Main loop ─────────────────────────────────────────────────────────────────
async function runAgentLoop230(opts) {
  const o = opts || {};
  const projectId_230 = String(o.projectId || '_default_230');
  const spendMap_230  = (o.spendMap_230 instanceof Map) ? o.spendMap_230
                      : (o.spendMap_227 instanceof Map) ? o.spendMap_227  // accept v227 map
                      : _defaultSpendMap_230;

  // Pre-check: already over limit?
  if (_getSpend_230(spendMap_230, projectId_230) >= HITL_LIMIT_MICRO_230) {
    return {
      ok: false,
      code: 'HITL_REQUIRED_230',
      error: `Project "${projectId_230}" has exceeded the $${HITL_LIMIT_USD_230} autonomous spend cap. A human operator must review and reset the spend counter before further agent execution.`,
      spentUsd: (Number(_getSpend_230(spendMap_230, projectId_230)) / 10_000).toFixed(4),
      limitUsd: HITL_LIMIT_USD_230,
      steps: 0,
      trace: [],
      ecosVersion: 'V230',
    };
  }

  const innerGateway_230 = o.gateway;
  if (!innerGateway_230 || typeof innerGateway_230.chat !== 'function') {
    return { ok: false, code: 'AGENT_LOOP_230_BAD_OPTS', error: 'gateway with .chat required', steps: 0, trace: [], ecosVersion: 'V230' };
  }

  let hitlTripped_230 = false;
  let hitlStepSpend_230 = 0n;

  const wrappedGateway_230 = {
    chat: async (args) => {
      // spend check before each LLM call
      if (_getSpend_230(spendMap_230, projectId_230) >= HITL_LIMIT_MICRO_230) {
        hitlTripped_230 = true;
        return { ok: false, error: `HITL_REQUIRED_230: spend cap reached for project "${projectId_230}"` };
      }
      const r = await innerGateway_230.chat(args);
      // Build usageHint from real token counts (P124-A: use actual tokens)
      const rawUsage_230 = r.raw && r.raw.usage;
      const usageHint_230 = rawUsage_230
        ? {
            inputTokens:  rawUsage_230.input_tokens  || 0,
            outputTokens: rawUsage_230.output_tokens || 0,
            provider: args.model || args.provider || '',
          }
        : (r.usage
          ? {
              inputTokens:  r.usage.input_tokens  || r.usage.inputTokens  || 0,
              outputTokens: r.usage.output_tokens || r.usage.outputTokens || 0,
              provider: args.model || args.provider || '',
            }
          : null);

      const toolCount_230 = Array.isArray(r.toolCalls) ? r.toolCalls.length : 0;
      const cost_230 = _estimateStepCost_230(toolCount_230, usageHint_230);
      const newTotal_230 = _addSpend_230(spendMap_230, projectId_230, cost_230);
      hitlStepSpend_230 += cost_230;

      // Annotate response with spend metadata for observability
      if (r && typeof r === 'object') {
        r._spend230 = {
          stepCostMicro: cost_230.toString(),
          totalMicro: newTotal_230.toString(),
          tokenAccurate: !!(usageHint_230 && usageHint_230.inputTokens),
        };
      }

      if (newTotal_230 >= HITL_LIMIT_MICRO_230 && r.ok !== false) {
        hitlTripped_230 = true;
      }
      return r;
    },
  };

  const fwd_230 = Object.assign({}, o, {
    gateway: wrappedGateway_230,
    projectId: undefined,
    spendMap_230: undefined,
    spendMap_227: undefined,
  });

  const result_230 = await runAgentLoop225(fwd_230);

  const finalSpend_230 = _getSpend_230(spendMap_230, projectId_230);
  result_230.ecosVersion     = 'V230';
  result_230.projectId       = projectId_230;
  result_230.spentThisRunUsd = (Number(hitlStepSpend_230) / 10_000).toFixed(4);
  result_230.totalSpentUsd   = (Number(finalSpend_230) / 10_000).toFixed(4);
  result_230.limitUsd        = HITL_LIMIT_USD_230;
  result_230.hitlRequired    = finalSpend_230 >= HITL_LIMIT_MICRO_230;
  result_230.spendEstimator  = 'token-accurate-v230';

  if (hitlTripped_230 && result_230.ok) {
    result_230.warning = `HITL_WARNING_230: cumulative spend for project "${projectId_230}" has reached/exceeded $${HITL_LIMIT_USD_230}. Human review required before next run.`;
  }

  return result_230;
}

module.exports = {
  runAgentLoop230,
  getProjectSpend_230,
  resetProjectSpend_230,
  HITL_LIMIT_USD_230,
  HITL_LIMIT_MICRO_230,
  _defaultSpendMap_230,
};
