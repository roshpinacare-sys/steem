/**
   * ECOS Execution Journal Tests — V104
   * 10 tests: startRun, startStep, completeStep, failStep, checkpoint, completeRun, failRun
   */
  import { describe, it, expect } from 'vitest';
  import { createRequire } from 'module';
  const require = createRequire(import.meta.url);

  describe('ExecutionJournal — V104', () => {
    const { ExecutionJournal, RUN_STATUS, ENTRY_TYPES } = require('../lib/executionJournal');

    it('startRun() returns a runId', () => {
      const j = new ExecutionJournal();
      const id = j.startRun({ agentId: 'a1', planId: 'p1', description: 'test run' });
      expect(id).toMatch(/^run::/);
    });

    it('getRun() returns run metadata', () => {
      const j = new ExecutionJournal();
      const id = j.startRun({ agentId: 'a1' });
      const run = j.getRun(id);
      expect(run.status).toBe(RUN_STATUS.RUNNING);
      expect(run.agentId).toBe('a1');
    });

    it('startStep() + completeStep() records steps', () => {
      const j = new ExecutionJournal();
      const runId = j.startRun({ agentId: 'a2' });
      const sid   = j.startStep(runId, { name: 'fetch-data', input: { url: 'x' } });
      expect(sid).toBeDefined();
      j.completeStep(runId, sid, { data: 'ok' });
      const entries = j.getRunEntries(runId);
      const stepComplete = entries.find(e => e.type === ENTRY_TYPES.STEP_COMPLETE);
      expect(stepComplete).toBeDefined();
      expect(stepComplete.payload.output).toEqual({ data: 'ok' });
    });

    it('failStep() records error', () => {
      const j      = new ExecutionJournal();
      const runId  = j.startRun({ agentId: 'a3' });
      const sid    = j.startStep(runId, { name: 'bad-step', input: {} });
      j.failStep(runId, sid, new Error('timeout'), { retryable: true });
      const entries = j.getRunEntries(runId);
      const fail = entries.find(e => e.type === ENTRY_TYPES.STEP_FAIL);
      expect(fail).toBeDefined();
      expect(fail.error).toBe('timeout');
    });

    it('checkpoint() saves state + returns checkpointId', () => {
      const j     = new ExecutionJournal();
      const runId = j.startRun({ agentId: 'a4' });
      const cpId  = j.checkpoint(runId, { wave: 1, done: ['s1', 's2'] });
      expect(cpId).toMatch(/^cp::/);
      expect(j.getRun(runId).status).toBe(RUN_STATUS.CHECKPOINT);
      const last = j.getLastCheckpoint(runId);
      expect(last.id).toBe(cpId);
      expect(last.state.wave).toBe(1);
    });

    it('completeRun() sets status COMPLETED', () => {
      const j     = new ExecutionJournal();
      const runId = j.startRun({ agentId: 'a5' });
      j.completeRun(runId, { answer: 42 });
      expect(j.getRun(runId).status).toBe(RUN_STATUS.COMPLETED);
    });

    it('failRun() sets status FAILED', () => {
      const j     = new ExecutionJournal();
      const runId = j.startRun({ agentId: 'a6' });
      j.failRun(runId, new Error('crash'));
      expect(j.getRun(runId).status).toBe(RUN_STATUS.FAILED);
    });

    it('cancelRun() sets status CANCELLED', () => {
      const j     = new ExecutionJournal();
      const runId = j.startRun({ agentId: 'a7' });
      j.cancelRun(runId, 'user request');
      expect(j.getRun(runId).status).toBe(RUN_STATUS.CANCELLED);
    });

    it('listRuns() filters by status', () => {
      const j = new ExecutionJournal();
      const r1 = j.startRun({ agentId: 'x' });
      const r2 = j.startRun({ agentId: 'x' });
      j.completeRun(r1, {});
      const running = j.listRuns({ status: RUN_STATUS.RUNNING });
      expect(running.some(r => r.runId === r2)).toBe(true);
      expect(running.some(r => r.runId === r1)).toBe(false);
    });

    it('runsCount() + entriesCount() reflect activity', () => {
      const j = new ExecutionJournal();
      j.startRun({ agentId: 'cnt' });
      expect(j.runsCount()).toBe(1);
      expect(j.entriesCount()).toBeGreaterThan(0);
    });
  });
  