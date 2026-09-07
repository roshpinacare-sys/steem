'use strict';
/**
 * Tests for ReplayEngine.replayAuditLogPaginated() — V109 P5-05
 * Also covers saveCheckpointToDB() and loadCheckpointsFromDB().
 */

import { describe, it, expect, beforeEach } from 'vitest';

const { ReplayEngine } = await import('../lib/replayEngine.js');
const { AuditLog }     = await import('../lib/auditLog.js');
const { ExecutionJournal } = await import('../lib/executionJournal.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAuditLog() {
  return new AuditLog();
}

function seedLedgerEntries(al, count) {
  for (let i = 0; i < count; i++) {
    al.append('LEDGER_CREDIT', {
      accountId:   `client_${i % 3}`,
      amountMicro: String(1000000 + i * 1000),
    });
  }
  return al;
}

function makeEngine(al, journal = null) {
  return new ReplayEngine({ auditLog: al, journal: journal || new ExecutionJournal() });
}

// ── replayAuditLogPaginated ───────────────────────────────────────────────────

describe('replayAuditLogPaginated — basic paging', () => {
  let al;
  let engine;

  beforeEach(() => {
    al     = seedLedgerEntries(makeAuditLog(), 25);
    engine = makeEngine(al);
  });

  it('returns first page with correct cursor values', () => {
    const result = engine.replayAuditLogPaginated({ cursor: 0, pageSize: 10 });
    expect(result.ok).toBe(true);
    expect(result.cursor).toBe(0);
    expect(result.nextCursor).toBe(10);
    expect(result.hasMore).toBe(true);
    expect(result.auditEntries).toBe(10);
  });

  it('returns second page correctly', () => {
    const p1 = engine.replayAuditLogPaginated({ cursor: 0,  pageSize: 10 });
    const p2 = engine.replayAuditLogPaginated({ cursor: p1.nextCursor, pageSize: 10 });
    expect(p2.ok).toBe(true);
    expect(p2.cursor).toBe(10);
    expect(p2.nextCursor).toBe(20);
    expect(p2.hasMore).toBe(true);
    expect(p2.auditEntries).toBe(10);
  });

  it('returns last partial page with hasMore=false', () => {
    const p3 = engine.replayAuditLogPaginated({ cursor: 20, pageSize: 10 });
    expect(p3.ok).toBe(true);
    expect(p3.cursor).toBe(20);
    expect(p3.hasMore).toBe(false);
    expect(p3.auditEntries).toBe(5);
  });

  it('returns sentinel when cursor >= total entries', () => {
    const result = engine.replayAuditLogPaginated({ cursor: 100, pageSize: 10 });
    expect(result.ok).toBe(true);
    expect(result.hasMore).toBe(false);
    expect(result.auditEntries).toBe(0);
    expect(result.eventsApplied).toBe(0);
  });

  it('each page has a non-empty replayProof', () => {
    const p = engine.replayAuditLogPaginated({ cursor: 0, pageSize: 5 });
    expect(typeof p.replayProof).toBe('string');
    expect(p.replayProof).toHaveLength(64);
  });

  it('different pages produce different proofs', () => {
    const p1 = engine.replayAuditLogPaginated({ cursor: 0,  pageSize: 5 });
    const p2 = engine.replayAuditLogPaginated({ cursor: 5,  pageSize: 5 });
    expect(p1.replayProof).not.toBe(p2.replayProof);
  });

  it('includeBalances=true adds balances map', () => {
    const p = engine.replayAuditLogPaginated({ cursor: 0, pageSize: 5, includeBalances: true });
    expect(p.balances).toBeDefined();
    expect(typeof p.balances).toBe('object');
  });

  it('includeBalances=false (default) omits balances', () => {
    const p = engine.replayAuditLogPaginated({ cursor: 0, pageSize: 5 });
    expect(p.balances).toBeUndefined();
  });

  it('pageSize is capped at 1000', () => {
    const p = engine.replayAuditLogPaginated({ cursor: 0, pageSize: 99999 });
    expect(p.auditEntries).toBeLessThanOrEqual(1000);
  });

  it('returns error when auditLog not configured', () => {
    const bare = new ReplayEngine({});
    const r = bare.replayAuditLogPaginated({ cursor: 0, pageSize: 10 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/auditLog not configured/);
  });
});

describe('replayAuditLogPaginated — full traversal', () => {
  it('consuming all pages covers all ledger entries', () => {
    const al     = seedLedgerEntries(makeAuditLog(), 47);
    const engine = makeEngine(al);

    let totalAuditEntries   = 0;
    let totalEventsApplied  = 0;
    let cursor              = 0;
    let iterations          = 0;

    while (true) {
      const page = engine.replayAuditLogPaginated({ cursor, pageSize: 10 });
      expect(page.ok).toBe(true);
      totalAuditEntries  += page.auditEntries;
      totalEventsApplied += page.eventsApplied;
      cursor = page.nextCursor;
      iterations++;
      if (!page.hasMore) break;
      if (iterations > 100) throw new Error('Infinite loop guard triggered');
    }

    expect(totalAuditEntries).toBe(47);
    expect(totalEventsApplied).toBe(47); // all are LEDGER_CREDIT
  });
});

describe('replayAuditLogPaginated — non-ledger entries', () => {
  it('non-ledger audit entries are skipped but counted in auditEntries', () => {
    const al = makeAuditLog();
    al.append('VALIDATOR_LOGIN', { validatorId: 'v1' });
    al.append('LEDGER_CREDIT',   { accountId: 'c1', amountMicro: '5000000' });
    al.append('SYSTEM_HEALTH',   { status: 'ok' });

    const engine = makeEngine(al);
    const page   = engine.replayAuditLogPaginated({ cursor: 0, pageSize: 10 });
    expect(page.ok).toBe(true);
    expect(page.auditEntries).toBe(3);
    expect(page.eventsApplied).toBe(1);  // only LEDGER_CREDIT maps to a ledger event
  });
});

// ── saveCheckpointToDB / loadCheckpointsFromDB ────────────────────────────────

describe('saveCheckpointToDB', () => {
  it('rejects when pool is null', async () => {
    const engine = makeEngine(makeAuditLog());
    await expect(engine.saveCheckpointToDB(null, { ok: true, finalStateHash: 'a', replayProof: 'b' }))
      .rejects.toThrow('pg.Pool required');
  });

  it('rejects when replayResult.ok is false', async () => {
    const engine = makeEngine(makeAuditLog());
    const fakePool = {};
    await expect(engine.saveCheckpointToDB(fakePool, { ok: false }))
      .rejects.toThrow('cannot save failed replay');
  });

  it('rejects when replayResult is missing required fields', async () => {
    const engine = makeEngine(makeAuditLog());
    const fakePool = {};
    await expect(engine.saveCheckpointToDB(fakePool, { ok: true }))
      .rejects.toThrow();
  });

  it('calls pool.query with correct table name and returns id + label', async () => {
    const engine = makeEngine(makeAuditLog());
    let capturedQuery = null;
    const fakePool = {
      query: async (sql, params) => { capturedQuery = { sql, params }; return {}; },
    };
    const result = await engine.saveCheckpointToDB(fakePool, {
      ok:             true,
      fromIndex:      0,
      toIndex:        99,
      eventsApplied:  42,
      finalStateHash: 'abc123def456'.padEnd(64, '0'),
      replayProof:    'proof000'.padEnd(64, '0'),
    }, 'test-label');

    expect(result.ok).toBe(true);
    expect(result.id).toMatch(/^ckpt::/);
    expect(result.label).toBe('test-label');
    expect(capturedQuery.sql).toContain('replay_checkpoints');
    expect(capturedQuery.params[1]).toBe('test-label');
    expect(capturedQuery.params[2]).toBe(0);   // fromIndex
    expect(capturedQuery.params[3]).toBe(99);  // toIndex
    expect(capturedQuery.params[4]).toBe(42);  // eventsApplied
  });

  it('auto-generates label when none provided', async () => {
    const engine = makeEngine(makeAuditLog());
    const fakePool = { query: async () => ({}) };
    const result = await engine.saveCheckpointToDB(fakePool, {
      ok: true, fromIndex: 0, toIndex: 0, eventsApplied: 0,
      finalStateHash: 'a'.repeat(64), replayProof: 'b'.repeat(64),
    });
    expect(result.label).toMatch(/^auto-/);
  });
});

describe('loadCheckpointsFromDB', () => {
  it('rejects when pool is null', async () => {
    const engine = makeEngine(makeAuditLog());
    await expect(engine.loadCheckpointsFromDB(null)).rejects.toThrow('pg.Pool required');
  });

  it('queries replay_checkpoints ordered by created_at DESC', async () => {
    const engine = makeEngine(makeAuditLog());
    let capturedQuery = null;
    const mockRows = [{ id: 'ckpt::abc', label: 'test', from_index: 0, to_index: 10 }];
    const fakePool = {
      query: async (sql, params) => { capturedQuery = { sql, params }; return { rows: mockRows }; },
    };
    const rows = await engine.loadCheckpointsFromDB(fakePool, { limit: 5 });
    expect(rows).toHaveLength(1);
    expect(capturedQuery.sql).toContain('replay_checkpoints');
    expect(capturedQuery.sql).toContain('ORDER BY created_at DESC');
    expect(capturedQuery.params[0]).toBe(5);
  });

  it('caps limit at 100', async () => {
    const engine = makeEngine(makeAuditLog());
    let capturedLimit = null;
    const fakePool = {
      query: async (sql, params) => { capturedLimit = params[0]; return { rows: [] }; },
    };
    await engine.loadCheckpointsFromDB(fakePool, { limit: 9999 });
    expect(capturedLimit).toBe(100);
  });
});
