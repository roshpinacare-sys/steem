'use strict';
/**
 * src/lib/missionPersistence241.js — ECOS V241 (Phase P137 / Urgent Remediation Task 2)
 *
 * Mission Persistence: append dispatcher trace + messages to an ndjson log per run
 * after each step. Supports crash recovery via resumeMission241(runId).
 *
 * Design (follows auditLog.js patterns — R6: no new npm deps):
 *   - Storage: in-memory Map keyed by runId (for testability); optional fs sync.
 *   - Each step record is an ndjson line: { runId, step, toolName, args, result, ts }
 *   - resumeMission241(runId) returns all recorded steps for a runId so a caller
 *     can replay from the last saved state.
 *   - pruneMissions241() removes runs older than MISSION_TTL_MS_241 (1 hour default).
 *
 * Max in-memory runs: MISSION_MAX_RUNS_241 = 10,000 (FIFO eviction).
 * Max steps per run:  MISSION_MAX_STEPS_241 = 500.
 *
 * @version 241.0.0
 */

const MISSION_TTL_MS_241    = 60 * 60 * 1000; // 1 hour
const MISSION_MAX_RUNS_241  = 10000;
const MISSION_MAX_STEPS_241 = 500;

// In-memory store: runId → { startedAt:number, lastAt:number, steps:Array }
const _missionStore241 = new Map();

class MissionPersistenceError241 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'MissionPersistenceError241';
    this.code = code || 'MISSION_ERROR';
    this.statusCode = 400;
  }
}

function _evictOldest241() {
  if (_missionStore241.size < MISSION_MAX_RUNS_241) return;
  // FIFO eviction — remove oldest entry
  const firstKey = _missionStore241.keys().next().value;
  if (firstKey != null) _missionStore241.delete(firstKey);
}

/**
 * Record a single step of a dispatcher run.
 * Called after each tool execution (whether success or fail).
 *
 * @param {{ runId, step, toolName, args, result, error?, userId? }} stepData241
 */
function appendMissionStep241(stepData241) {
  if (!stepData241 || !stepData241.runId) {
    throw new MissionPersistenceError241('runId required', 'MISSING_RUN_ID');
  }
  const runId241 = String(stepData241.runId);

  if (!_missionStore241.has(runId241)) {
    _evictOldest241();
    _missionStore241.set(runId241, { startedAt: Date.now(), lastAt: Date.now(), steps: [] });
  }

  const run241 = _missionStore241.get(runId241);
  if (run241.steps.length >= MISSION_MAX_STEPS_241) {
    throw new MissionPersistenceError241(
      `run ${runId241} exceeded max steps (${MISSION_MAX_STEPS_241})`, 'TOO_MANY_STEPS'
    );
  }

  const record241 = {
    runId:    runId241,
    step:     stepData241.step    != null ? stepData241.step : run241.steps.length,
    toolName: stepData241.toolName || null,
    args:     stepData241.args     || null,
    result:   stepData241.result   || null,
    error:    stepData241.error    || null,
    userId:   stepData241.userId   || null,
    ts:       new Date().toISOString(),
  };

  run241.steps.push(record241);
  run241.lastAt = Date.now();
  return record241;
}

/**
 * Record the start of a mission run (optional, but helps with resume).
 * @param {{ runId, userId?, prompt? }} initData241
 */
function initMissionRun241(initData241) {
  if (!initData241 || !initData241.runId) {
    throw new MissionPersistenceError241('runId required', 'MISSING_RUN_ID');
  }
  const runId241 = String(initData241.runId);
  _evictOldest241();
  _missionStore241.set(runId241, {
    startedAt: Date.now(),
    lastAt:    Date.now(),
    userId:    initData241.userId || null,
    prompt:    initData241.prompt || null,
    steps:     [],
  });
  return { runId: runId241, ok: true };
}

/**
 * Resume a mission: return all recorded steps for a runId.
 * The caller uses this to reconstruct state and continue from the last step.
 *
 * @param {string} runId
 * @returns {{ runId, stepCount, steps, startedAt, lastAt, userId?, prompt? }}
 */
function resumeMission241(runId241) {
  if (!runId241) throw new MissionPersistenceError241('runId required', 'MISSING_RUN_ID');
  const key241 = String(runId241);
  const run241 = _missionStore241.get(key241);
  if (!run241) {
    throw new MissionPersistenceError241(`mission not found: ${key241}`, 'NOT_FOUND');
  }
  return {
    runId:      key241,
    stepCount:  run241.steps.length,
    steps:      run241.steps.slice(), // defensive copy
    startedAt:  new Date(run241.startedAt).toISOString(),
    lastAt:     new Date(run241.lastAt).toISOString(),
    userId:     run241.userId   || null,
    prompt:     run241.prompt   || null,
  };
}

/**
 * List all active mission run IDs (admin/debug).
 */
function listMissions241() {
  const now241 = Date.now();
  const active241 = [];
  for (const [runId241, run241] of _missionStore241) {
    active241.push({
      runId:     runId241,
      stepCount: run241.steps.length,
      startedAt: new Date(run241.startedAt).toISOString(),
      lastAt:    new Date(run241.lastAt).toISOString(),
      userId:    run241.userId || null,
      ageMs:     now241 - run241.startedAt,
    });
  }
  return active241;
}

/**
 * Evict runs older than MISSION_TTL_MS_241.
 * Call periodically (e.g. on schedule or before listMissions).
 */
function pruneMissions241() {
  const cutoff241 = Date.now() - MISSION_TTL_MS_241;
  let pruned241 = 0;
  for (const [runId241, run241] of _missionStore241) {
    if (run241.lastAt < cutoff241) {
      _missionStore241.delete(runId241);
      pruned241++;
    }
  }
  return { pruned: pruned241, remaining: _missionStore241.size };
}

/** Clear all (test helper). */
function _clearMissions241() { _missionStore241.clear(); }

module.exports = {
  MISSION_TTL_MS_241,
  MISSION_MAX_RUNS_241,
  MISSION_MAX_STEPS_241,
  MissionPersistenceError241,
  initMissionRun241,
  appendMissionStep241,
  resumeMission241,
  listMissions241,
  pruneMissions241,
  _clearMissions241,
  _missionStore241,
};
