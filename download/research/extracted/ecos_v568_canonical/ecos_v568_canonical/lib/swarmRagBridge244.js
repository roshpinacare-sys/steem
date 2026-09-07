/**
 * src/lib/swarmRagBridge244.js — ECOS Swarm-RAG Execution Bridge (P140)
 * ────────────────────────────────────────────────────────────────────────
 * Wires the RAG pipeline (ragPipeline243) into the swarm executor
 * (swarmOrchestrator242) so each sub-task prompt is context-enriched
 * before dispatch.
 *
 * Two entry points:
 *
 *   executeSwarmWithRag244(params)
 *     Full async swarm run with RAG augmentation.
 *     Before each sub-task is dispatched, `augmentPrompt243` prepends
 *     retrieved context to the sub-task description.
 *     Params mirror `execute242` plus:
 *       - ragEnabled    {boolean} default true
 *       - ragTopK       {number}  topK for retrieval (default RAG_DEFAULT_TOPK_243)
 *       - ragMetaFilter {object}  optional meta filter
 *       - ragPipeline   {RagPipeline243} optional override (default: defaultRagPipeline243)
 *
 *   executePlanWithRag244(planId, params)
 *     Lift a stored SwarmPlan243 into a swarm run with RAG augmentation.
 *     Converts PlannedSubTask243 items → SubTask242-style objects, then
 *     delegates to executeSwarmWithRag244.
 *
 * Plan → Execute pipeline:
 *   POST /api/v1/swarm/execute-plan/:planId  [V244-T03]
 *   POST /api/v1/swarm/execute              (extended: rag: true body flag)
 *
 * Zero new npm deps. Identifiers end with 244.
 * R1: sacred files untouched. R2: identifiers _244. R3: zero npm deps.
 * Mirror rule: this file is mirrored to lib/swarmRagBridge244.js.
 */

'use strict';

// ── Soft-require collaborators ────────────────────────────────────────────────
function _req244(p) { try { return require(p); } catch (_) { return null; } }

const _sw242Mod  = _req244('./swarmOrchestrator242');
const _rag243Mod = _req244('./ragPipeline243');
const _pl243Mod  = _req244('./swarmPlanner243');
const _auditLog  = _req244('./auditLog');

// ── Constants ─────────────────────────────────────────────────────────────────
const BRIDGE_VERSION_244        = 'V244';
const BRIDGE_DEFAULT_TOPK_244   = 5;
const BRIDGE_MAX_CONTEXT_LEN_244 = 2000;  // chars of context prepended per sub-task

// ── Stats ─────────────────────────────────────────────────────────────────────
const _bridgeStats244 = {
  executeWithRagCalls: 0,
  executePlanCalls:    0,
  totalSubTasksAugmented: 0,
  totalSubTasksSkipped:   0,
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Prepend RAG context to a description string.
 * Truncates context to BRIDGE_MAX_CONTEXT_LEN_244 characters.
 * @param {string} description
 * @param {string} contextBlock
 * @returns {string}
 */
function _augmentDescription244(description, contextBlock) {
  const trimmed = contextBlock.slice(0, BRIDGE_MAX_CONTEXT_LEN_244);
  return `[RAG_CONTEXT]\n${trimmed}\n[/RAG_CONTEXT]\n\n${description}`;
}

/**
 * Augment an array of sub-task objects in-place using the RAG pipeline.
 * @param {object[]} subTasks   - each must have a .description string
 * @param {object}   ragPipeline
 * @param {number}   topK
 * @param {object}   [metaFilter]
 * @returns {{ augmented: number, skipped: number }}
 */
function _augmentSubTasks244(subTasks, ragPipeline, topK, metaFilter) {
  let augmented = 0;
  let skipped   = 0;
  for (const st of subTasks) {
    try {
      const { prompt } = ragPipeline.augmentPrompt243(
        st.description, topK, metaFilter
      );
      if (prompt && prompt.includes('[CONTEXT]')) {
        // Extract the CONTEXT block only
        const ctxMatch = prompt.match(/\[CONTEXT\]\n([\s\S]*?)\n\n\[QUERY\]/);
        const ctx = ctxMatch ? ctxMatch[1] : '';
        if (ctx && ctx !== '(no relevant context found)') {
          st.description = _augmentDescription244(st.description, ctx);
          augmented++;
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
    } catch (_) {
      skipped++;
    }
  }
  return { augmented, skipped };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Execute a swarm with optional RAG augmentation.
 *
 * @param {object} params
 * @param {string}  params.userId
 * @param {string}  params.goal
 * @param {object[]} [params.subTasks]     - pre-decomposed sub-tasks (optional)
 * @param {boolean} [params.ragEnabled]    - default true
 * @param {number}  [params.ragTopK]       - topK for RAG retrieval
 * @param {object}  [params.ragMetaFilter] - optional meta filter
 * @param {object}  [params.ragPipeline]   - override RagPipeline243 instance
 * @param {number}  [params.timeoutMs]
 * @returns {Promise<{ ok: boolean, swarmId?: string, error?: string, ragStats?: object }>}
 */
async function executeSwarmWithRag244(params) {
  const p = params || {};
  _bridgeStats244.executeWithRagCalls++;

  if (!p.userId) return { ok: false, error: 'BRIDGE_244: userId required', code: 'BRIDGE_MISSING_USERID_244' };
  if (!p.goal)   return { ok: false, error: 'BRIDGE_244: goal required',   code: 'BRIDGE_MISSING_GOAL_244' };

  if (!_sw242Mod) {
    return { ok: false, error: 'BRIDGE_244: swarmOrchestrator242 not available', code: 'BRIDGE_DEP_MISSING_244' };
  }

  const ragEnabled   = p.ragEnabled !== false; // default true
  const topK         = Math.max(1, p.ragTopK || BRIDGE_DEFAULT_TOPK_244);
  const metaFilter   = p.ragMetaFilter || null;
  const ragPipeline  = p.ragPipeline   || (_rag243Mod && _rag243Mod.defaultRagPipeline243);
  const orchestrator = _sw242Mod.defaultSwarmOrchestrator242;

  // Build sub-task list (decompose if not provided)
  let subTasks = Array.isArray(p.subTasks) ? p.subTasks.map(st => ({ ...st })) : null;
  if (!subTasks) {
    // Decompose via swarmOrchestrator242's decomposer
    const raw = _sw242Mod.decomposeGoal242(p.goal);
    subTasks = raw.map(r => ({ description: r.description, dependsOn: r.dependsOn }));
  }

  // RAG augmentation step
  let ragAugStats244 = { augmented: 0, skipped: 0, ragEnabled: false };
  if (ragEnabled && ragPipeline && typeof ragPipeline.augmentPrompt243 === 'function') {
    const { augmented, skipped } = _augmentSubTasks244(subTasks, ragPipeline, topK, metaFilter);
    ragAugStats244 = { augmented, skipped, ragEnabled: true, topK };
    _bridgeStats244.totalSubTasksAugmented += augmented;
    _bridgeStats244.totalSubTasksSkipped   += skipped;
  }

  // Emit audit event
  if (_auditLog) {
    try {
      const al = _auditLog.defaultAuditLog;
      if (al && typeof al.append === 'function') {
        al.append('SWARM_RAG_EXECUTE_244', {
          userId: p.userId, goal: p.goal,
          ragEnabled, augmented: ragAugStats244.augmented,
          subTaskCount: subTasks.length,
        });
      }
    } catch (_) {}
  }

  // Execute via swarmOrchestrator242
  let run;
  try {
    run = await orchestrator.execute242({
      userId:   p.userId,
      goal:     p.goal,
      subTasks, // pass RAG-augmented sub-tasks
      timeoutMs: p.timeoutMs,
    });
  } catch (e) {
    return { ok: false, error: e.message, code: 'BRIDGE_EXECUTE_FAILED_244', ecosVersion: BRIDGE_VERSION_244 };
  }

  return {
    ok: true,
    swarmId: run.swarmId,
    status:  run.status,
    goal:    run.goal,
    subTaskCount: run.subTasks ? run.subTasks.length : 0,
    ragAugStats: ragAugStats244,
    ecosVersion: BRIDGE_VERSION_244,
  };
}

/**
 * Execute a stored SwarmPlan243 via the swarm orchestrator,
 * with optional RAG augmentation on each planned sub-task.
 *
 * @param {string} planId
 * @param {object} params
 * @param {string}  params.userId
 * @param {boolean} [params.ragEnabled]    default true
 * @param {number}  [params.ragTopK]
 * @param {object}  [params.ragMetaFilter]
 * @param {object}  [params.ragPipeline]
 * @param {number}  [params.timeoutMs]
 * @returns {Promise<object>}
 */
async function executePlanWithRag244(planId, params) {
  _bridgeStats244.executePlanCalls++;
  const p = params || {};

  if (!planId) return { ok: false, error: 'BRIDGE_244: planId required', code: 'BRIDGE_MISSING_PLANID_244' };
  if (!p.userId) return { ok: false, error: 'BRIDGE_244: userId required', code: 'BRIDGE_MISSING_USERID_244' };

  if (!_pl243Mod) {
    return { ok: false, error: 'BRIDGE_244: swarmPlanner243 not available', code: 'BRIDGE_DEP_MISSING_244' };
  }

  const plan = _pl243Mod.getPlan243(planId);
  if (!plan) {
    return {
      ok: false,
      error: `BRIDGE_244: plan "${planId}" not found`,
      code: 'BRIDGE_PLAN_NOT_FOUND_244',
      ecosVersion: BRIDGE_VERSION_244,
    };
  }

  // Convert PlannedSubTask243 → simple sub-task objects
  const subTasks = (plan.subTasks || []).map(st => ({
    description: st.description,
    dependsOn:   st.dependsOn || null,
    // Preserve tool recommendation as metadata
    _toolName244:        st.toolName || null,
    _estimatedCost244:   st.estimatedCostMicro || 0,
  }));

  const result = await executeSwarmWithRag244({
    ...p,
    goal:     plan.goal,
    subTasks,
  });

  return {
    ...result,
    planId,
    planGoal:    plan.goal,
    totalEstimatedCostMicro: plan.totalEstimatedCostMicro,
    ecosVersion: BRIDGE_VERSION_244,
  };
}

/**
 * Return bridge statistics.
 * @returns {object}
 */
function getBridgeStats244() {
  return { ..._bridgeStats244, version: BRIDGE_VERSION_244 };
}

module.exports = {
  executeSwarmWithRag244,
  executePlanWithRag244,
  getBridgeStats244,
  BRIDGE_VERSION_244,
  BRIDGE_DEFAULT_TOPK_244,
  BRIDGE_MAX_CONTEXT_LEN_244,
  // expose for testing
  _augmentDescription244,
  _augmentSubTasks244,
  _bridgeStats244,
};
