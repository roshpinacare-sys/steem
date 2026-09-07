'use strict';
  /**
   * ECOS Execution Journal — V104 — Phase 3
   * ─────────────────────────────────────────────────────────────────────────────
   * Append-only execution log for agent task chains and DAG runs.
   * Supports: checkpointing, resumable execution, failure tracking, step audit.
   *
   * Journal entry schema:
   *   { id, runId, stepId, agentId, type, status, payload, error, ts }
   *
   * Run lifecycle:
   *   PENDING → RUNNING → CHECKPOINT → COMPLETED | FAILED | CANCELLED
   *
   * Entry types:
   *   run_start     — new run initiated
   *   step_start    — individual step begins
   *   step_complete — step completes successfully
   *   step_fail     — step fails (captured error)
   *   checkpoint    — run state snapshot for resume
   *   run_complete  — run finished
   *   run_fail      — run failed terminally
   *   run_cancel    — run cancelled by caller
   */

  const crypto = require('node:crypto');

  const RUN_STATUS = Object.freeze({
    PENDING:    'PENDING',
    RUNNING:    'RUNNING',
    CHECKPOINT: 'CHECKPOINT',
    COMPLETED:  'COMPLETED',
    FAILED:     'FAILED',
    CANCELLED:  'CANCELLED',
  });

  const ENTRY_TYPES = Object.freeze({
    RUN_START:     'run_start',
    STEP_START:    'step_start',
    STEP_COMPLETE: 'step_complete',
    STEP_FAIL:     'step_fail',
    CHECKPOINT:    'checkpoint',
    RUN_COMPLETE:  'run_complete',
    RUN_FAIL:      'run_fail',
    RUN_CANCEL:    'run_cancel',
  });

  class ExecutionJournal {
    constructor(opts = {}) {
      this._maxEntries = opts.maxEntries || 50_000;
      this._entries    = [];       // append-only flat log
      this._runs       = new Map(); // runId → run metadata
      this._log        = { info: () => {}, warn: () => {}, error: () => {} };
    }

    setLogger(l) { if (l && typeof l.info === 'function') this._log = l; }

    // ── Run lifecycle ────────────────────────────────────────────────────────────

    startRun({ agentId, planId, description, meta = {} }) {
      const runId = 'run::' + crypto.randomBytes(8).toString('hex');
      const entry = this._append({ runId, stepId: null, agentId, type: ENTRY_TYPES.RUN_START, status: RUN_STATUS.RUNNING, payload: { planId, description, ...meta } });
      this._runs.set(runId, { runId, agentId, planId, status: RUN_STATUS.RUNNING, startedAt: entry.ts, checkpoints: [] });
      this._log.info({ component: 'journal', runId, agentId }, '[Journal] run started');
      return runId;
    }

    startStep(runId, { stepId, name, input, meta = {} }) {
      const sid = stepId || 'step::' + crypto.randomBytes(6).toString('hex');
      this._assertRun(runId);
      this._append({ runId, stepId: sid, agentId: this._runs.get(runId)?.agentId, type: ENTRY_TYPES.STEP_START, status: RUN_STATUS.RUNNING, payload: { name, input, ...meta } });
      return sid;
    }

    completeStep(runId, stepId, output, meta = {}) {
      this._assertRun(runId);
      this._append({ runId, stepId, agentId: this._runs.get(runId)?.agentId, type: ENTRY_TYPES.STEP_COMPLETE, status: RUN_STATUS.COMPLETED, payload: { output, ...meta } });
    }

    failStep(runId, stepId, error, meta = {}) {
      this._assertRun(runId);
      this._append({ runId, stepId, agentId: this._runs.get(runId)?.agentId, type: ENTRY_TYPES.STEP_FAIL, status: RUN_STATUS.FAILED, payload: meta, error: error?.message || String(error) });
    }

    /**
     * Save a checkpoint snapshot for resumable execution.
     * @param {string} runId
     * @param {object} state — arbitrary serializable run state
     * @returns {string} checkpointId
     */
    checkpoint(runId, state) {
      this._assertRun(runId);
      const cpId = 'cp::' + crypto.randomBytes(6).toString('hex');
      const run  = this._runs.get(runId);
      run.status  = RUN_STATUS.CHECKPOINT;
      const entry = this._append({ runId, stepId: cpId, agentId: run.agentId, type: ENTRY_TYPES.CHECKPOINT, status: RUN_STATUS.CHECKPOINT, payload: { state } });
      run.checkpoints.push({ id: cpId, ts: entry.ts, state });
      this._log.info({ component: 'journal', runId, cpId }, '[Journal] checkpoint saved');
      return cpId;
    }

    completeRun(runId, result, meta = {}) {
      this._setRunStatus(runId, RUN_STATUS.COMPLETED, ENTRY_TYPES.RUN_COMPLETE, { result, ...meta });
      this._log.info({ component: 'journal', runId }, '[Journal] run completed');
    }

    failRun(runId, error, meta = {}) {
      this._setRunStatus(runId, RUN_STATUS.FAILED, ENTRY_TYPES.RUN_FAIL, { error: error?.message || String(error), ...meta });
      this._log.error({ component: 'journal', runId, error: error?.message }, '[Journal] run failed');
    }

    cancelRun(runId, reason) {
      this._setRunStatus(runId, RUN_STATUS.CANCELLED, ENTRY_TYPES.RUN_CANCEL, { reason });
    }

    // ── Queries ──────────────────────────────────────────────────────────────────

    getRun(runId) { return this._runs.get(runId) || null; }

    getRunEntries(runId) { return this._entries.filter(e => e.runId === runId); }

    listRuns({ status, agentId, limit = 50 } = {}) {
      let runs = Array.from(this._runs.values());
      if (status)  runs = runs.filter(r => r.status  === status);
      if (agentId) runs = runs.filter(r => r.agentId === agentId);
      return runs.slice(-limit);
    }

    getLastCheckpoint(runId) {
      const run = this._runs.get(runId);
      if (!run || run.checkpoints.length === 0) return null;
      return run.checkpoints[run.checkpoints.length - 1];
    }

    entriesCount() { return this._entries.length; }
    runsCount()    { return this._runs.size; }

    // ── Internals ────────────────────────────────────────────────────────────────

    _append(partial) {
      const entry = { id: 'je::' + crypto.randomBytes(6).toString('hex'), ts: new Date().toISOString(), ...partial };
      this._entries.push(entry);
      if (this._entries.length > this._maxEntries) this._entries.shift();
      return entry;
    }

    _assertRun(runId) {
      if (!this._runs.has(runId)) throw new Error(`Run not found: ${runId}`);
    }

    _setRunStatus(runId, status, type, payload) {
      const run = this._runs.get(runId);
      if (run) run.status = status;
      this._append({ runId, stepId: null, agentId: run?.agentId, type, status, payload });
    }
  }

  const defaultJournal = new ExecutionJournal();
  module.exports = { ExecutionJournal, defaultJournal, RUN_STATUS, ENTRY_TYPES };
  