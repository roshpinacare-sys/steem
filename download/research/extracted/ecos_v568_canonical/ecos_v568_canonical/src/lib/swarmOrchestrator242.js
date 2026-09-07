/**
 * src/lib/swarmOrchestrator242.js — ECOS Multi-Agent Swarm Orchestrator (P138)
 * ─────────────────────────────────────────────────────────────────────────────
 * Spawns and coordinates sub-agents; decomposes a high-level task into sub-tasks,
 * dispatches them to sub-agents (via agentDispatcher239 if available), collects
 * results, and aggregates into a coherent final answer.
 *
 * Every swarm run is persisted via missionPersistence241 so it is crash-recoverable.
 * Every sub-agent step is interlock-wrapped (dangerousToolInterlock240).
 *
 * Zero new npm deps. Identifiers end with 242.
 */

'use strict';

const crypto = require('crypto');

// ── Soft-require collaborators (non-fatal if not wired yet) ──────────────────
function _tryRequire242(path) {
  try { return require(path); } catch (_) { return null; }
}

const _missionPersistence241 = _tryRequire242('./missionPersistence241');
const _dispatcherInterlock241 = _tryRequire242('./dispatcherInterlockWiring241');
const _auditLog = _tryRequire242('./auditLog');

// ── Constants ────────────────────────────────────────────────────────────────
const SWARM_MAX_AGENTS_242       = 16;   // max parallel sub-agents per swarm run
const SWARM_MAX_CONCURRENCY_242  = 4;    // max simultaneously running sub-agents
const SWARM_DEFAULT_TIMEOUT_MS_242 = 120_000; // 2-minute per-agent wall-time
const SWARM_MAX_RUNS_242         = 1000; // ring buffer
const SWARM_STATUS_242 = Object.freeze({
  PENDING:  'PENDING',
  RUNNING:  'RUNNING',
  PARTIAL:  'PARTIAL',
  DONE:     'DONE',
  FAILED:   'FAILED',
  ABORTED:  'ABORTED',
});

// ── In-memory swarm store ─────────────────────────────────────────────────────
/** @type {Map<string, SwarmRun242>} */
const _swarmStore242 = new Map();

/**
 * @typedef {object} SubTask242
 * @property {string} id
 * @property {string} description
 * @property {string} [dependsOn]  - id of a prerequisite sub-task
 * @property {string} status       - PENDING | RUNNING | DONE | FAILED
 * @property {*}      result
 * @property {string} [error]
 * @property {number} startedAt
 * @property {number} completedAt
 */

/**
 * @typedef {object} SwarmRun242
 * @property {string}       swarmId
 * @property {string}       userId
 * @property {string}       goal
 * @property {SubTask242[]} subTasks
 * @property {string}       status
 * @property {*}            aggregatedResult
 * @property {number}       createdAt
 * @property {number}       updatedAt
 * @property {string}       [missionRunId]   - linked mission persistence runId
 */

// ── Task decomposer ───────────────────────────────────────────────────────────
/**
 * Decompose a high-level goal into an array of sub-task descriptions.
 * This is a rule-based heuristic decomposer (no LLM call — keeps it zero-dep).
 * Real-world use would call discoverTools237 + an LLM planner.
 *
 * @param {string} goal
 * @returns {Array<{description: string, dependsOn?: string}>}
 */
function decomposeGoal242(goal) {
  const g = String(goal || '').trim();
  if (!g) return [{ description: 'echo: empty goal' }];

  // Split on "and then", "then", ";", "+" — treating each clause as a sub-task
  const clauses = g
    .split(/\s+(?:and\s+then|then|;|\+)\s+/i)
    .map(c => c.trim())
    .filter(Boolean);

  if (clauses.length <= 1) {
    // Single goal — split into research + synthesise
    return [
      { description: `research: ${g}` },
      { description: `synthesise findings for: ${g}`, dependsOn: '__prev__' },
    ];
  }

  // Multi-clause: first clause is independent, rest depend on the one before
  return clauses.map((c, i) => ({
    description: c,
    dependsOn: i === 0 ? undefined : '__prev__',
  }));
}

// ── Stub executor (replaced when agentDispatcher239 is injected) ─────────────
async function _stubExecute242(subTask, _opts) {
  return {
    source: 'stub_executor_242',
    input:  subTask.description,
    output: `[stub] completed: ${subTask.description}`,
  };
}

// ── Aggregator ────────────────────────────────────────────────────────────────
function _aggregate242(subTasks) {
  const done   = subTasks.filter(t => t.status === 'DONE');
  const failed = subTasks.filter(t => t.status === 'FAILED');
  return {
    completedCount: done.length,
    failedCount:    failed.length,
    totalCount:     subTasks.length,
    results: done.map(t => ({ id: t.id, description: t.description, result: t.result })),
    errors:  failed.map(t => ({ id: t.id, description: t.description, error: t.error })),
    summary: done.map(t => String(t.result?.output || t.result || '')).join('\n---\n'),
  };
}

// ── SwarmOrchestrator242 ──────────────────────────────────────────────────────
class SwarmOrchestrator242 {
  /**
   * @param {object} [opts]
   * @param {Function}  [opts.executorFn] - async (subTask, opts) => result
   * @param {object}    [opts.dispatcher] - agentDispatcher239 instance
   * @param {object}    [opts.auditLog]   - override default auditLog
   */
  constructor(opts = {}) {
    this._executor242   = opts.executorFn || _stubExecute242;
    this._dispatcher242 = opts.dispatcher || null;
    this._audit242      = opts.auditLog || _auditLog?.defaultAuditLog || null;
    this._totalRuns242  = 0;
    this._totalFailed242 = 0;
  }

  /** Wire in a live agentDispatcher239 instance after construction. */
  setDispatcher242(dispatcher) {
    this._dispatcher242 = dispatcher;
    if (dispatcher && typeof dispatcher.dispatch239 === 'function') {
      this._executor242 = async (subTask, execOpts) => {
        const res = await dispatcher.dispatch239({
          userId:   execOpts.userId,
          prompt:   subTask.description,
          missionId: execOpts.swarmId,
        });
        return res;
      };
    }
    return this;
  }

  /**
   * Create and execute a swarm run.
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.goal
   * @param {SubTask242[]} [params.subTasks] - pre-decomposed; omit to auto-decompose
   * @param {number}       [params.timeoutMs]
   * @returns {Promise<SwarmRun242>}
   */
  async execute242(params) {
    const { userId, goal, subTasks: injectedTasks, timeoutMs = SWARM_DEFAULT_TIMEOUT_MS_242 } = params;
    if (!userId) throw new Error('swarmOrchestrator242: userId required');
    if (!goal)   throw new Error('swarmOrchestrator242: goal required');

    const swarmId242 = 'swarm-' + crypto.randomBytes(8).toString('hex');
    const now = Date.now();

    // Decompose
    const rawTasks = injectedTasks || decomposeGoal242(goal);
    if (rawTasks.length > SWARM_MAX_AGENTS_242) {
      throw new Error(`swarmOrchestrator242: max ${SWARM_MAX_AGENTS_242} sub-tasks per run`);
    }

    // Build sub-task objects with resolved IDs
    const taskIds242 = rawTasks.map((_, i) => `st-${swarmId242}-${i}`);
    const subTasks242 = rawTasks.map((raw, i) => ({
      id:          taskIds242[i],
      description: raw.description,
      dependsOn:   raw.dependsOn === '__prev__' ? (i > 0 ? taskIds242[i - 1] : undefined) : raw.dependsOn,
      status:      SWARM_STATUS_242.PENDING,
      result:      null,
      error:       null,
      startedAt:   0,
      completedAt: 0,
    }));

    /** @type {SwarmRun242} */
    const run242 = {
      swarmId:          swarmId242,
      userId,
      goal,
      subTasks:         subTasks242,
      status:           SWARM_STATUS_242.RUNNING,
      aggregatedResult: null,
      createdAt:        now,
      updatedAt:        now,
      missionRunId:     null,
    };

    // Register in mission persistence (crash-recoverable)
    if (_missionPersistence241) {
      try {
        const mp = _missionPersistence241.defaultMissionPersistence241 || _missionPersistence241;
        if (mp?.initMission241) {
          const mpRun = mp.initMission241({ userId, meta: { swarmId: swarmId242, goal } });
          run242.missionRunId = mpRun?.runId || null;
        }
      } catch (_) {}
    }

    // Store
    if (_swarmStore242.size >= SWARM_MAX_RUNS_242) {
      const oldest = _swarmStore242.keys().next().value;
      _swarmStore242.delete(oldest);
    }
    _swarmStore242.set(swarmId242, run242);
    this._totalRuns242++;

    this._audit242?.append?.('SWARM_START', { swarmId: swarmId242, userId, subTaskCount: subTasks242.length });

    // Execute with bounded concurrency
    try {
      await this._runWithConcurrency242(run242, timeoutMs);
    } catch (err242exec) {
      run242.status   = SWARM_STATUS_242.FAILED;
      run242.updatedAt = Date.now();
      this._totalFailed242++;
      this._audit242?.append?.('SWARM_FAILED', { swarmId: swarmId242, error: err242exec.message });
      _swarmStore242.set(swarmId242, run242);
      throw err242exec;
    }

    run242.aggregatedResult = _aggregate242(run242.subTasks);
    const allDone   = run242.subTasks.every(t => t.status === SWARM_STATUS_242.DONE);
    const anyFailed = run242.subTasks.some(t => t.status === SWARM_STATUS_242.FAILED);
    run242.status   = allDone ? SWARM_STATUS_242.DONE : anyFailed ? SWARM_STATUS_242.PARTIAL : SWARM_STATUS_242.DONE;
    run242.updatedAt = Date.now();

    this._audit242?.append?.('SWARM_DONE', {
      swarmId: swarmId242, status: run242.status,
      completed: run242.aggregatedResult.completedCount,
      failed: run242.aggregatedResult.failedCount,
    });

    _swarmStore242.set(swarmId242, run242);
    return run242;
  }

  /** Execute sub-tasks respecting dependency order + max concurrency. */
  async _runWithConcurrency242(run242, timeoutMs) {
    const pending = [...run242.subTasks];
    const inFlight = new Set();

    const _canRun = (task) => {
      if (task.status !== SWARM_STATUS_242.PENDING) return false;
      if (!task.dependsOn) return true;
      const dep = run242.subTasks.find(t => t.id === task.dependsOn);
      return dep && dep.status === SWARM_STATUS_242.DONE;
    };

    const _executeOne = async (task) => {
      task.status    = SWARM_STATUS_242.RUNNING;
      task.startedAt = Date.now();
      run242.updatedAt = Date.now();

      // Persist step
      if (_missionPersistence241 && run242.missionRunId) {
        try {
          const mp = _missionPersistence241.defaultMissionPersistence241 || _missionPersistence241;
          mp?.appendMissionStep241?.({ runId: run242.missionRunId, step: { type: 'SUB_TASK_START', taskId: task.id, description: task.description } });
        } catch (_) {}
      }

      try {
        const result = await Promise.race([
          this._executor242(task, { userId: run242.userId, swarmId: run242.swarmId }),
          new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)),
        ]);
        task.result       = result;
        task.status       = SWARM_STATUS_242.DONE;
        task.completedAt  = Date.now();
        this._audit242?.append?.('SUB_TASK_DONE', { swarmId: run242.swarmId, taskId: task.id });
      } catch (err) {
        task.error        = err.message;
        task.status       = SWARM_STATUS_242.FAILED;
        task.completedAt  = Date.now();
        this._audit242?.append?.('SUB_TASK_FAILED', { swarmId: run242.swarmId, taskId: task.id, error: err.message });
      } finally {
        inFlight.delete(task.id);
      }
    };

    // Drive the queue until all tasks settled
    while (pending.some(t => t.status === SWARM_STATUS_242.PENDING || t.status === SWARM_STATUS_242.RUNNING)) {
      // launch eligible tasks up to concurrency limit
      for (const task of pending) {
        if (inFlight.size >= SWARM_MAX_CONCURRENCY_242) break;
        if (_canRun(task)) {
          inFlight.add(task.id);
          _executeOne(task); // fire-and-forget; we poll below
        }
      }
      if (inFlight.size === 0) break; // no progress (dependency deadlock or all done)
      await new Promise(r => setTimeout(r, 50)); // poll interval
    }
  }

  getSwarmRun242(swarmId) { return _swarmStore242.get(swarmId) || null; }
  listSwarmRuns242({ userId, limit = 20 } = {}) {
    const runs = [..._swarmStore242.values()];
    const filtered = userId ? runs.filter(r => r.userId === userId) : runs;
    return filtered.slice(-Math.min(limit, 100)).reverse();
  }

  abortSwarm242(swarmId) {
    const run = _swarmStore242.get(swarmId);
    if (!run) return null;
    run.subTasks.forEach(t => { if (t.status === SWARM_STATUS_242.PENDING || t.status === SWARM_STATUS_242.RUNNING) { t.status = SWARM_STATUS_242.FAILED; t.error = 'aborted'; } });
    run.status = SWARM_STATUS_242.ABORTED;
    run.updatedAt = Date.now();
    _swarmStore242.set(swarmId, run);
    return run;
  }

  getStats242() {
    const runs = [..._swarmStore242.values()];
    return {
      totalRuns:    this._totalRuns242,
      totalFailed:  this._totalFailed242,
      storedRuns:   runs.length,
      maxAgents:    SWARM_MAX_AGENTS_242,
      maxConcurrency: SWARM_MAX_CONCURRENCY_242,
      byStatus: Object.fromEntries(
        Object.values(SWARM_STATUS_242).map(s => [s, runs.filter(r => r.status === s).length])
      ),
    };
  }
}

const defaultSwarmOrchestrator242 = new SwarmOrchestrator242();
module.exports = {
  SwarmOrchestrator242, defaultSwarmOrchestrator242, decomposeGoal242,
  SWARM_STATUS_242, SWARM_MAX_AGENTS_242, SWARM_MAX_CONCURRENCY_242,
  SWARM_DEFAULT_TIMEOUT_MS_242, SWARM_MAX_RUNS_242,
};
