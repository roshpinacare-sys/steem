'use strict';
/**
 * Tests for lib/replayEngine.js — V106
 */

import { describe, it, expect, beforeEach } from 'vitest';

const { ReplayEngine, auditEntryToLedgerEvent } = await import('../lib/replayEngine.js');
const { AuditLog } = await import('../lib/auditLog.js');
const { ExecutionJournal } = await import('../lib/executionJournal.js');
const { LEDGER_EVENT } = await import('../lib/deterministicReducers.js');

// ── auditEntryToLedgerEvent ───────────────────────────────────────────────────

describe('auditEntryToLedgerEvent', () => {
  it('maps LEDGER_CREDIT to CREDIT event', () => {
    const entry = {
      type: 'LEDGER_CREDIT',
      payload: { accountId: 'client_a', amountMicro: '5000' },
    };
    const ev = auditEntryToLedgerEvent(entry);
    expect(ev.type).toBe(LEDGER_EVENT.CREDIT);
    expect(ev.accountId).toBe('client_a');
    expect(ev.amountMicro).toBe(5000n);
  });

  it('maps LEDGER_DEBIT to DEBIT event', () => {
    const entry = {
      type: 'LEDGER_DEBIT',
      payload: { accountId: 'client_a', amountMicro: '500' },
    };
    const ev = auditEntryToLedgerEvent(entry);
    expect(ev.type).toBe(LEDGER_EVENT.DEBIT);
    expect(ev.amountMicro).toBe(500n);
  });

  it('maps TASK_AUTO_FLOW with splits', () => {
    const entry = {
      type: 'TASK_AUTO_FLOW',
      payload: {
        splits: [
          { accountId: 'sys::platform',       amountMicro: '4000' },
          { accountId: 'sys::insurance_pool', amountMicro: '6000' },
        ],
      },
    };
    const ev = auditEntryToLedgerEvent(entry);
    expect(ev.type).toBe(LEDGER_EVENT.AUTO_FLOW);
    expect(ev.splits).toHaveLength(2);
    expect(ev.splits[0].amountMicro).toBe(4000n);
  });

  it('returns null for non-ledger audit types', () => {
    const ev = auditEntryToLedgerEvent({ type: 'VALIDATOR_LOGIN', payload: {} });
    expect(ev).toBeNull();
  });

  it('returns null for null input', () => {
    expect(auditEntryToLedgerEvent(null)).toBeNull();
    expect(auditEntryToLedgerEvent(undefined)).toBeNull();
  });
});

// ── ReplayEngine.replayAuditLog ───────────────────────────────────────────────

describe('ReplayEngine.replayAuditLog', () => {
  it('returns error when auditLog not configured', () => {
    const engine = new ReplayEngine({});
    const result = engine.replayAuditLog();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/auditLog/);
  });

  it('replays an empty audit log', () => {
    const auditLog = new AuditLog();
    const engine   = new ReplayEngine({ auditLog });
    const result   = engine.replayAuditLog();
    expect(result.ok).toBe(true);
    expect(result.eventsApplied).toBe(0);
    expect(result.balances).toEqual({});
  });

  it('replays ledger credit entries and accumulates balances', () => {
    const auditLog = new AuditLog();
    auditLog.append('LEDGER_CREDIT', { accountId: 'client_a', amountMicro: '10000' });
    auditLog.append('LEDGER_CREDIT', { accountId: 'client_a', amountMicro: '5000' });
    auditLog.append('NON_LEDGER_EVENT', { foo: 'bar' });

    const engine = new ReplayEngine({ auditLog });
    const result = engine.replayAuditLog();

    expect(result.ok).toBe(true);
    expect(result.eventsApplied).toBe(2);  // only ledger events
    expect(result.balances['client_a']).toBe('15000');
  });

  it('includes replayProof in result', () => {
    const auditLog = new AuditLog();
    auditLog.append('LEDGER_CREDIT', { accountId: 'a', amountMicro: '100' });
    const engine = new ReplayEngine({ auditLog });
    const result = engine.replayAuditLog();
    expect(result.replayProof).toBeTruthy();
    expect(result.replayProof).toHaveLength(64);
  });

  it('detects divergence when expectedStateHash does not match', () => {
    const auditLog = new AuditLog();
    auditLog.append('LEDGER_CREDIT', { accountId: 'client_a', amountMicro: '1000' });

    const engine = new ReplayEngine({ auditLog });
    const result = engine.replayAuditLog({ expectedStateHash: '0'.repeat(64) });

    expect(result.ok).toBe(true);  // replay itself succeeded
    expect(result.verification.ok).toBe(false);
    expect(result.divergence).toBeTruthy();
    expect(result.divergence.detected).toBe(true);
  });

  it('confirms no divergence when expectedStateHash matches', () => {
    const auditLog = new AuditLog();
    auditLog.append('LEDGER_CREDIT', { accountId: 'client_a', amountMicro: '1000' });

    const engine  = new ReplayEngine({ auditLog });
    const initial = engine.replayAuditLog();
    const correct = initial.finalStateHash;

    const result  = engine.replayAuditLog({ expectedStateHash: correct });
    expect(result.verification.ok).toBe(true);
    expect(result.divergence).toBeUndefined();
  });

  it('slices by fromIndex and toIndex', () => {
    const auditLog = new AuditLog();
    for (let i = 0; i < 5; i++) {
      auditLog.append('LEDGER_CREDIT', { accountId: 'client_a', amountMicro: '1000' });
    }
    const engine = new ReplayEngine({ auditLog });
    const result = engine.replayAuditLog({ fromIndex: 1, toIndex: 2 });
    expect(result.fromIndex).toBe(1);
    expect(result.toIndex).toBe(2);
    expect(result.auditEntries).toBe(2);
  });
});

// ── ReplayEngine.replayJournalRun ─────────────────────────────────────────────

describe('ReplayEngine.replayJournalRun', () => {
  it('returns error when journal not configured', () => {
    const engine = new ReplayEngine({});
    const result = engine.replayJournalRun('run::abc');
    expect(result.ok).toBe(false);
  });

  it('returns error for unknown runId', () => {
    const journal = new ExecutionJournal();
    const engine  = new ReplayEngine({ journal });
    const result  = engine.replayJournalRun('run::unknown');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/No journal entries/);
  });

  it('replays a complete run', () => {
    const journal = new ExecutionJournal();
    const runId   = journal.startRun({ agentId: 'agent_1', description: 'test' });
    const stepId  = journal.startStep(runId, { name: 'step1', input: {} });
    journal.completeStep(runId, stepId, { result: 'ok' });
    journal.completeRun(runId, { done: true });

    const engine = new ReplayEngine({ journal });
    const result = engine.replayJournalRun(runId);

    expect(result.ok).toBe(true);
    expect(result.runId).toBe(runId);
    expect(result.completedSteps).toBe(1);
    expect(result.failedSteps).toBe(0);
    expect(result.replayProof).toHaveLength(64);
    expect(result.timeline.length).toBeGreaterThan(0);
  });
});

// ── ReplayEngine.lookupProvenance ─────────────────────────────────────────────

describe('ReplayEngine.lookupProvenance', () => {
  it('returns error when auditLog not configured', () => {
    const engine = new ReplayEngine({});
    const result = engine.lookupProvenance('abc');
    expect(result.ok).toBe(false);
  });

  it('returns error for unknown hash', () => {
    const auditLog = new AuditLog();
    const engine   = new ReplayEngine({ auditLog });
    const result   = engine.lookupProvenance('0'.repeat(64));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/No audit entry/);
  });

  it('finds an entry by its hash', () => {
    const auditLog = new AuditLog();
    const entry    = auditLog.append('TEST_EVENT', { x: 1 });

    const engine = new ReplayEngine({ auditLog });
    const result = engine.lookupProvenance(entry.hash);

    expect(result.ok).toBe(true);
    expect(result.target.hash).toBe(entry.hash);
    expect(result.target.type).toBe('TEST_EVENT');
  });

  it('returns inferenceProvenance from payload if present', () => {
    const auditLog = new AuditLog();
    const proof    = { traceId: 'trace_1', bindingHash: 'a'.repeat(64), inputHash: 'b'.repeat(64), model: 'gpt-4', ts: new Date().toISOString() };
    const entry    = auditLog.append('TASK_AUTO_FLOW', { inferenceProvenance: proof });

    const engine = new ReplayEngine({ auditLog });
    const result = engine.lookupProvenance(entry.hash);

    expect(result.inferenceProvenance).toBeTruthy();
    expect(result.inferenceProvenance.traceId).toBe('trace_1');
  });

  it('builds ancestor chain', () => {
    const auditLog = new AuditLog();
    const e1 = auditLog.append('EVENT_1', { a: 1 });
    const e2 = auditLog.append('EVENT_2', { b: 2 });
    const e3 = auditLog.append('EVENT_3', { c: 3 });

    const engine = new ReplayEngine({ auditLog });
    const result = engine.lookupProvenance(e3.hash, { depth: 3 });

    expect(result.ok).toBe(true);
    expect(result.ancestorChain.length).toBe(2);  // e2 and e1
    expect(result.ancestorChain[0].hash).toBe(e2.hash);
  });
});
