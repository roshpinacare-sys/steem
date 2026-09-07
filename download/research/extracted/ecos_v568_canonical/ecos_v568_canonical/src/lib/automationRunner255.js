'use strict';
/**
 * src/lib/automationRunner255.js — ECOS V255 (Phase P151)
 *
 * Executes an automation recipe from automationCatalog254, step by step:
 *   1. Load recipe from catalog.
 *   2. For each step: resolve tool via toolCatalog237.getRunner237(name).
 *   3. Before each step: call enforceToolCall240 → if require_hitl → pause
 *      (record to missionPersistence241 with status='hitl_paused'); if block → abort.
 *   4. Execute the tool fn.
 *   5. If step.verify defined → assertNotSilentFailure240(result, step.verify).
 *   6. Persist every step via appendMissionStep241.
 *   7. Stream progress via optional onProgress(event) callback.
 *
 * Pure + dependency-free (R6); version-suffixed (…255).
 *
 * @version 255.0.0
 */

const { appendMissionStep241, resumeMission241 } = require('./missionPersistence241.js');
const { classifyToolCall240 }                    = require('./dangerousToolInterlock240.js');
const { assertNotSilentFailure240 }              = require('./actionVerifier240.js');

// ── Constants ────────────────────────────────────────────────────────────────
const RUN_STATUSES_255 = Object.freeze({
  PENDING:      'pending',
  RUNNING:      'running',
  HITL_PAUSED:  'hitl_paused',
  COMPLETED:    'completed',
  ABORTED:      'aborted',
  FAILED:       'failed',
});

class AutomationRunError255 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'AutomationRunError255';
    this.code = code || 'RUN_ERROR';
    this.statusCode = 400;
  }
}

/**
 * Generate a unique run ID (no external deps — nanoid-free for R6 purity).
 */
function _runId255() {
  return 'run255-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Run a single automation recipe to completion (or pause/abort).
 *
 * @param {object} opts
 * @param {object}   opts.catalog       - automationCatalog254 instance (has .get(id))
 * @param {object}   opts.toolCatalog   - ToolCatalog237 instance (has .getRunner237(name))
 * @param {string}   opts.automationId  - recipe id to run
 * @param {object}   [opts.ctx]         - contextual data passed into each tool step (userId, workspaceId, etc.)
 * @param {function} [opts.onProgress]  - called with each step progress event
 * @param {object}   [opts.audit]       - audit function(ev) for run events
 * @param {function} [opts.now]         - injectable clock (for testing)
 * @param {object}   [opts.notificationWsHub] - NotificationWsHub instance for HITL push (P154-C)
 *
 * @returns {Promise<{runId, automationId, status, steps:[], startedAt, finishedAt}>}
 */
async function runAutomation255(opts = {}) {
  const { catalog, toolCatalog, automationId, ctx = {}, onProgress, audit = () => {}, now = Date.now, notificationWsHub } = opts;

  if (!catalog || typeof catalog.get !== 'function') throw new AutomationRunError255('catalog required', 'NO_CATALOG');
  if (!toolCatalog || typeof toolCatalog.getRunner237 !== 'function') throw new AutomationRunError255('toolCatalog required', 'NO_TOOL_CATALOG');
  if (!automationId) throw new AutomationRunError255('automationId required', 'NO_ID');

  const recipe = catalog.get(automationId);
  if (!recipe) throw new AutomationRunError255('automation not found: ' + automationId, 'NOT_FOUND');

  const runId    = _runId255();
  const startedAt = new Date(now()).toISOString();
  const stepResults255 = [];

  const _emit255 = (event) => {
    if (typeof onProgress === 'function') { try { onProgress(event); } catch (_) {} }
  };

  _emit255({ type: 'run_start', runId, automationId, stepCount: recipe.steps.length, startedAt });
  audit({ action: 'automation_run_start255', runId, automationId, steps: recipe.steps.length, userId: ctx.userId });

  // ── Step loop ──────────────────────────────────────────────────────────────
  for (let i = 0; i < recipe.steps.length; i++) {
    const step = recipe.steps[i];
    const stepCtx = { runId, step: i, toolName: step.tool, automationId };

    // 1) Interlock check — classify before execution
    let interlock255;
    try {
      interlock255 = classifyToolCall240({ name: step.tool }, step.args || {});
    } catch (_) {
      interlock255 = { decision: 'allow' };
    }

    if (interlock255.decision === 'block') {
      const abortDetail = { ...stepCtx, decision: 'block', reasons: interlock255.reasons };
      appendMissionStep241({ runId, step: i, toolName: step.tool, args: step.args, result: null, error: 'BLOCKED', status: 'aborted' });
      _emit255({ type: 'step_blocked', ...abortDetail });
      audit({ action: 'automation_step_blocked255', ...abortDetail });
      const finishedAt = new Date(now()).toISOString();
      return { runId, automationId, status: RUN_STATUSES_255.ABORTED, steps: stepResults255, startedAt, finishedAt, abortedAtStep: i, abortReason: 'BLOCKED', reasons: interlock255.reasons };
    }

    if (interlock255.decision === 'require_hitl') {
      const pauseDetail = { ...stepCtx, decision: 'require_hitl', reasons: interlock255.reasons };
      appendMissionStep241({ runId, step: i, toolName: step.tool, args: step.args, result: null, status: 'hitl_paused' });
      _emit255({ type: 'step_hitl_paused', ...pauseDetail });
      audit({ action: 'automation_step_hitl_paused255', ...pauseDetail });
      const finishedAt = new Date(now()).toISOString();

      // ── P154-C: push hitl_paused event over WebSocket so dashboard receives it live ──
      if (notificationWsHub && typeof notificationWsHub.push === 'function') {
        const _hitlUserId258 = (ctx && ctx.userId) ? String(ctx.userId) : '__system__';
        try {
          notificationWsHub.push(_hitlUserId258, {
            id:            'hitl_' + runId + '_step' + i,
            type:          'hitl_paused',
            runId,
            automationId,
            pausedAtStep:  i,
            toolName:      step.tool,
            reasons:       interlock255.reasons,
            ts:            finishedAt,
          });
        } catch (_hitlPushErr258) { /* non-fatal — WS push must never break run */ }
      }

      return { runId, automationId, status: RUN_STATUSES_255.HITL_PAUSED, steps: stepResults255, startedAt, finishedAt, pausedAtStep: i, pauseReason: 'HITL_REQUIRED', reasons: interlock255.reasons };
    }

    // 2) Resolve tool runner
    const runner = toolCatalog.getRunner237(step.tool);
    if (!runner) {
      const missingDetail = { ...stepCtx, error: 'TOOL_NOT_FOUND' };
      appendMissionStep241({ runId, step: i, toolName: step.tool, args: step.args, result: null, error: 'TOOL_NOT_FOUND', status: 'failed' });
      _emit255({ type: 'step_failed', ...missingDetail });
      audit({ action: 'automation_step_tool_missing255', ...missingDetail });
      const finishedAt = new Date(now()).toISOString();
      return { runId, automationId, status: RUN_STATUSES_255.FAILED, steps: stepResults255, startedAt, finishedAt, failedAtStep: i, failReason: 'TOOL_NOT_FOUND', toolName: step.tool };
    }

    // 3) Execute
    _emit255({ type: 'step_start', ...stepCtx });
    let result255 = null;
    let stepError255 = null;
    try {
      result255 = await runner(step.args || {}, ctx);
    } catch (err) {
      stepError255 = err && err.message ? err.message : String(err);
    }

    // 4) Post-action verification (if verify spec defined)
    let verifyResult255 = null;
    if (step.verify && !stepError255) {
      try {
        verifyResult255 = assertNotSilentFailure240(result255, step.verify);
        if (verifyResult255.silentFailure) {
          stepError255 = 'silent_failure: tool claimed ok but verify failed (' + verifyResult255.detail + ')';
        }
      } catch (ve) {
        verifyResult255 = { error: ve.message };
      }
    }

    // 5) Persist step
    appendMissionStep241({ runId, step: i, toolName: step.tool, args: step.args, result: result255, error: stepError255, status: stepError255 ? 'failed' : 'ok' });

    const stepSummary = { step: i, tool: step.tool, ok: !stepError255, error: stepError255 || null, verify: verifyResult255 };
    stepResults255.push(stepSummary);

    if (stepError255) {
      _emit255({ type: 'step_failed', ...stepCtx, error: stepError255 });
      audit({ action: 'automation_step_failed255', runId, step: i, toolName: step.tool, error: stepError255 });
      const finishedAt = new Date(now()).toISOString();
      return { runId, automationId, status: RUN_STATUSES_255.FAILED, steps: stepResults255, startedAt, finishedAt, failedAtStep: i, failReason: stepError255 };
    }

    _emit255({ type: 'step_complete', ...stepCtx, result: result255 });
  }

  // ── All steps done ─────────────────────────────────────────────────────────
  const finishedAt = new Date(now()).toISOString();
  audit({ action: 'automation_run_complete255', runId, automationId, steps: stepResults255.length });
  _emit255({ type: 'run_complete', runId, automationId, stepCount: stepResults255.length, finishedAt });
  return { runId, automationId, status: RUN_STATUSES_255.COMPLETED, steps: stepResults255, startedAt, finishedAt };
}

/**
 * triggerIntake255 — fire automations whose trigger matches an external event.
 * For 'schedule' / 'webhook' / 'event' triggers, this is the entry point.
 *
 * @param {object} opts
 * @param {object}   opts.catalog       - automationCatalog254 instance
 * @param {object}   opts.toolCatalog   - ToolCatalog237 instance
 * @param {string}   opts.triggerType   - 'schedule' | 'webhook' | 'event'
 * @param {object}   [opts.ctx]         - context forwarded to each automation
 * @param {function} [opts.onProgress]  - progress callback
 * @param {object}   [opts.audit]       - audit function
 * @returns {Promise<Array>}            - array of run results
 */
async function triggerIntake255(opts = {}) {
  const { catalog, toolCatalog, triggerType, ctx = {}, onProgress, audit = () => {} } = opts;
  if (!catalog) throw new AutomationRunError255('catalog required', 'NO_CATALOG');
  if (!triggerType) throw new AutomationRunError255('triggerType required', 'NO_TRIGGER');

  const matching = catalog.list({ trigger: triggerType });
  const results = [];
  for (const item of matching) {
    try {
      const r = await runAutomation255({ catalog, toolCatalog, automationId: item.id, ctx, onProgress, audit });
      results.push(r);
    } catch (e) {
      results.push({ automationId: item.id, status: 'error', error: e.message });
    }
  }
  return results;
}

module.exports = { runAutomation255, triggerIntake255, AutomationRunError255, RUN_STATUSES_255 };
