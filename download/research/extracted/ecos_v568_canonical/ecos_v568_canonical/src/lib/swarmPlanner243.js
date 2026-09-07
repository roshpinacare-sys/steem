/**
 * src/lib/swarmPlanner243.js — ECOS Swarm Planner with Tool Routing (P139)
 * ──────────────────────────────────────────────────────────────────────────
 * Enhances swarmOrchestrator242 with tool-aware task decomposition.
 * `planSwarm243(goal, opts)` produces a full plan (sub-tasks with tool
 * recommendations and cost estimates) WITHOUT executing any agents.
 *
 * Uses discoverTools237 to semantically match the best tool per sub-task,
 * and annotates each sub-task with { toolName, estimatedCostMicro }.
 *
 * Zero new npm deps. Identifiers end with 243.
 */

'use strict';

const crypto = require('crypto');

// ── Soft-require collaborators ────────────────────────────────────────────────
function _tryRequire243p(p) { try { return require(p); } catch (_) { return null; } }

const _sw242 = _tryRequire243p('./swarmOrchestrator242');
const _dt237 = _tryRequire243p('./discoverTools237');
const _auditLog = _tryRequire243p('./auditLog');

// ── Constants ─────────────────────────────────────────────────────────────────
const PLANNER_MAX_SUBTASKS_243     = 20;
const PLANNER_DEFAULT_COST_243     = 100;  // μ¢ fallback when no tool matched
const PLANNER_MIN_TOOL_SCORE_243   = 0.05; // min cosine score to recommend a tool

// ── Cost table (mirrors toolCatalog237 defaults) ──────────────────────────────
const TOOL_COST_TABLE_243 = {
  web_search:      100,
  web_fetch:        50,
  generate_image: 2000,
};

// ── Plan types ────────────────────────────────────────────────────────────────
/**
 * @typedef {object} PlannedSubTask243
 * @property {string} id
 * @property {string} description
 * @property {string|null} dependsOn       - id of prerequisite sub-task (or null)
 * @property {string|null} toolName        - recommended tool name (null = no match)
 * @property {number}      estimatedCostMicro - cost in μ¢
 * @property {number}      toolScore       - discovery score (0–1)
 */

/**
 * @typedef {object} SwarmPlan243
 * @property {string}            planId
 * @property {string}            goal
 * @property {string}            userId
 * @property {PlannedSubTask243[]} subTasks
 * @property {number}            totalEstimatedCostMicro
 * @property {number}            createdAt
 */

// ── Ring buffer for plans ─────────────────────────────────────────────────────
const PLANNER_MAX_PLANS_243 = 500;
/** @type {Map<string, SwarmPlan243>} */
const _planStore243 = new Map();
const _planOrder243 = [];

function _storePlan243(plan) {
  if (_planStore243.size >= PLANNER_MAX_PLANS_243) {
    const oldest = _planOrder243.shift();
    if (oldest) _planStore243.delete(oldest);
  }
  _planStore243.set(plan.planId, plan);
  _planOrder243.push(plan.planId);
}

// ── Core planner ──────────────────────────────────────────────────────────────

/**
 * Decompose a goal into sub-tasks (uses swarmOrchestrator242's decomposer).
 */
function _decomposeGoal243(goal) {
  if (_sw242 && typeof _sw242.decomposeGoal242 === 'function') {
    return _sw242.decomposeGoal242(goal);
  }
  // Fallback: simple split
  const parts = goal.split(/\bthen\b|\band then\b|;/i).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return [{ id: 'st_0', description: `research: ${goal}`, dependsOn: null }, { id: 'st_1', description: `synthesise: ${goal}`, dependsOn: 'st_0' }];
  return parts.map((p, i) => ({ id: `st_${i}`, description: p, dependsOn: i === 0 ? null : `st_${i - 1}` }));
}

/**
 * Annotate a single sub-task with tool recommendation.
 * @param {{ id: string, description: string, dependsOn: string|null }} subtask
 * @returns {Promise<PlannedSubTask243>}
 */
async function _annotateSubTask243(subtask) {
  let toolName = null;
  let estimatedCostMicro = PLANNER_DEFAULT_COST_243;
  let toolScore = 0;

  if (_dt237 && typeof _dt237.discoverTools237 === 'function') {
    try {
      const results = await _dt237.discoverTools237(subtask.description, { limit: 1, minScore: PLANNER_MIN_TOOL_SCORE_243 });
      if (results && results.length > 0) {
        const top = results[0];
        toolName = top.tool.name;
        toolScore = top.score;
        // Use catalog cost if available, else table, else default
        const catalogCost = top.tool.cost;
        estimatedCostMicro = (typeof catalogCost === 'number' && catalogCost > 0)
          ? catalogCost
          : (TOOL_COST_TABLE_243[toolName] || PLANNER_DEFAULT_COST_243);
      }
    } catch (_) {
      // discovery failed — keep defaults
    }
  }

  return {
    id:                  subtask.id || ('st_' + crypto.randomBytes(3).toString('hex')),
    description:         subtask.description,
    dependsOn:           subtask.dependsOn || null,
    toolName,
    estimatedCostMicro,
    toolScore,
  };
}

/**
 * Plan a swarm: decompose goal + annotate each sub-task with tool + cost.
 * Does NOT execute any agents.
 *
 * @param {string} goal
 * @param {object} [opts]
 * @param {string} [opts.userId]
 * @param {number} [opts.maxSubTasks]  - cap on sub-tasks (default 20)
 * @param {boolean} [opts.skipToolDiscovery] - skip tool annotation (testing)
 * @returns {Promise<SwarmPlan243>}
 */
async function planSwarm243(goal, opts) {
  const o = opts || {};
  if (typeof goal !== 'string' || !goal.trim()) {
    throw new Error('SWARM_PLANNER_243: goal must be a non-empty string');
  }
  const maxSubTasks = Math.min(o.maxSubTasks || PLANNER_MAX_SUBTASKS_243, PLANNER_MAX_SUBTASKS_243);
  const userId = String(o.userId || 'anonymous');

  // 1. Decompose
  let rawTasks = _decomposeGoal243(goal.trim());
  if (rawTasks.length > maxSubTasks) rawTasks = rawTasks.slice(0, maxSubTasks);

  // 2. Annotate (tool discovery per sub-task)
  let annotated;
  if (o.skipToolDiscovery) {
    annotated = rawTasks.map(st => ({
      id:                  st.id || ('st_' + crypto.randomBytes(3).toString('hex')),
      description:         st.description,
      dependsOn:           st.dependsOn || null,
      toolName:            null,
      estimatedCostMicro:  PLANNER_DEFAULT_COST_243,
      toolScore:           0,
    }));
  } else {
    annotated = await Promise.all(rawTasks.map(st => _annotateSubTask243(st)));
  }

  // 3. Assemble plan
  const totalCost = annotated.reduce((s, st) => s + st.estimatedCostMicro, 0);
  const planId = 'plan_' + crypto.randomBytes(8).toString('hex');

  /** @type {SwarmPlan243} */
  const plan = {
    planId,
    goal: goal.trim(),
    userId,
    subTasks: annotated,
    totalEstimatedCostMicro: totalCost,
    createdAt: Date.now(),
  };

  _storePlan243(plan);

  if (_auditLog) {
    try {
      const al = _auditLog.defaultAuditLog;
      if (al && typeof al.append === 'function') {
        al.append('SWARM_PLAN_243', { planId, userId, goal: goal.trim(), subTaskCount: annotated.length, totalCostMicro: totalCost });
      }
    } catch (_) {}
  }

  return plan;
}

/**
 * Retrieve a stored plan by id.
 * @param {string} planId
 * @returns {SwarmPlan243|null}
 */
function getPlan243(planId) {
  return _planStore243.get(planId) || null;
}

/**
 * List recent plans (newest first).
 * @param {object} [opts]
 * @param {string} [opts.userId]
 * @param {number} [opts.limit]
 * @returns {SwarmPlan243[]}
 */
function listPlans243(opts) {
  const o = opts || {};
  const limit = Math.max(1, Math.min(o.limit || 50, 500));
  let plans = [..._planStore243.values()].sort((a, b) => b.createdAt - a.createdAt);
  if (o.userId) plans = plans.filter(p => p.userId === o.userId);
  return plans.slice(0, limit);
}

/**
 * Get planner statistics.
 */
function getPlannerStats243() {
  return {
    totalPlans: _planStore243.size,
    maxPlans:   PLANNER_MAX_PLANS_243,
    plannerVersion: 'V243',
  };
}

module.exports = {
  planSwarm243,
  getPlan243,
  listPlans243,
  getPlannerStats243,
  PLANNER_MAX_SUBTASKS_243,
  PLANNER_DEFAULT_COST_243,
  PLANNER_MIN_TOOL_SCORE_243,
  PLANNER_MAX_PLANS_243,
  // expose for testing
  _decomposeGoal243,
  _annotateSubTask243,
  _planStore243,
};
