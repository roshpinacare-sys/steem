'use strict';
/**
 * Tests for ReplayEngine.verifyReplayChain() (V110 — P8-03)
 */

import { describe, it, expect, beforeEach } from 'vitest';

const { ReplayEngine } = await import('../lib/replayEngine.js');

// ── Minimal AuditLog stub ─────────────────────────────────────────────────────
function makeAuditLog(entries = []) {
  return { entries: () => entries };
}

// ── verifyReplayChain — empty audit log ───────────────────────────────────────

describe('ReplayEngine.verifyReplayChain — empty audit log', () => {
  it('returns ok:true with pagesVerified=1 for empty log', () => {
    const re  = new ReplayEngine({ auditLog: makeAuditLog([]) });
    const res = re.verifyReplayChain();

    expect(res.ok).toBe(true);
    expect(res.chainIntact).toBe(true);
    expect(res.pagesVerified).toBe(1);
    expect(res.totalEventsApplied).toBe(0);
    expect(res.totalAuditEntries).toBe(0);
    expect(res.brokenAt).toBeNull();
    expect(res.finalStateHash).toBeTruthy();
  });
});

// ── verifyReplayChain — no auditLog configured ────────────────────────────────

describe('ReplayEngine.verifyReplayChain — no auditLog', () => {
  it('returns ok:false with error message when auditLog not configured', () => {
    const re  = new ReplayEngine({});
    const res = re.verifyReplayChain();

    expect(res.ok).toBe(false);
    expect(res.chainIntact).toBe(false);
    expect(res.error).toContain('auditLog');
    expect(res.pagesVerified).toBe(0);
  });
});

// ── verifyReplayChain — single page (small log) ───────────────────────────────

describe('ReplayEngine.verifyReplayChain — single page log', () => {
  it('verifies a small non-ledger audit log in one page', () => {
    // Non-ledger entries (TASK_RECEIVED, etc.) are not mapped to ledger events
    // but they still appear in the audit log and should not cause divergence
    const entries = Array.from({ length: 10 }, (_, i) => ({
      index:    i,
      type:     'TASK_RECEIVED',
      payload:  { taskId: `task-${i}` },
      hash:     'a'.repeat(64),
      prevHash: i === 0 ? '0'.repeat(64) : 'a'.repeat(64),
      ts:       new Date().toISOString(),
    }));

    const re  = new ReplayEngine({ auditLog: makeAuditLog(entries) });
    const res = re.verifyReplayChain({ pageSize: 100 });

    expect(res.ok).toBe(true);
    expect(res.chainIntact).toBe(true);
    expect(res.pagesVerified).toBe(1);
    expect(res.totalAuditEntries).toBe(10);
    expect(res.totalEventsApplied).toBe(0); // no ledger events
    expect(res.brokenAt).toBeNull();
    expect(res.finalStateHash).toBeTruthy();
  });

  it('includes replayProof in proofSample for each page', () => {
    const re  = new ReplayEngine({ auditLog: makeAuditLog([]) });
    const res = re.verifyReplayChain();

    expect(Array.isArray(res.proofSample)).toBe(true);
    expect(res.proofSample.length).toBeGreaterThan(0);
    expect(res.proofSample[0]).toHaveProperty('replayProof');
    expect(res.proofSample[0]).toHaveProperty('finalStateHash');
    expect(res.proofSample[0]).toHaveProperty('cursor');
  });
});

// ── verifyReplayChain — multi-page verification ───────────────────────────────

describe('ReplayEngine.verifyReplayChain — multi-page', () => {
  it('paginates through a 250-entry log with pageSize=100', () => {
    const entries = Array.from({ length: 250 }, (_, i) => ({
      index:    i,
      type:     'TASK_RECEIVED',
      payload:  { taskId: `t${i}` },
      hash:     'b'.repeat(64),
      prevHash: 'b'.repeat(64),
      ts:       new Date().toISOString(),
    }));

    const re  = new ReplayEngine({ auditLog: makeAuditLog(entries) });
    const res = re.verifyReplayChain({ pageSize: 100 });

    expect(res.ok).toBe(true);
    expect(res.chainIntact).toBe(true);
    // 250 entries / 100 per page = 3 pages (100, 100, 50)
    expect(res.pagesVerified).toBe(3);
    expect(res.totalAuditEntries).toBe(250);
  });

  it('respects custom pageSize', () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({
      index: i, type: 'INFO', payload: {}, hash: 'c'.repeat(64), prevHash: 'c'.repeat(64),
      ts: new Date().toISOString(),
    }));

    const re  = new ReplayEngine({ auditLog: makeAuditLog(entries) });
    const res = re.verifyReplayChain({ pageSize: 20 });

    // 60 / 20 = 3 pages
    expect(res.pagesVerified).toBe(3);
    expect(res.totalAuditEntries).toBe(60);
  });

  it('caps proofSample at 10 entries for large logs', () => {
    // 1500 entries → 6 pages at pageSize=250 → proofSample = all 6 (≤10)
    // Use 1100 entries → 11 pages at pageSize=100 → proofSample capped at 10
    const entries = Array.from({ length: 1100 }, (_, i) => ({
      index: i, type: 'PING', payload: {}, hash: 'd'.repeat(64), prevHash: 'd'.repeat(64),
      ts: new Date().toISOString(),
    }));

    const re  = new ReplayEngine({ auditLog: makeAuditLog(entries) });
    const res = re.verifyReplayChain({ pageSize: 100 });

    expect(res.pagesVerified).toBe(11);
    expect(res.proofSample.length).toBeLessThanOrEqual(10);
  });
});

// ── verifyReplayChain — with ledger events ────────────────────────────────────

describe('ReplayEngine.verifyReplayChain — ledger events', () => {
  it('accumulates eventsApplied across pages', () => {
    // LEDGER_CREDIT entries are mapped to ledger events by auditEntryToLedgerEvent
    const entries = Array.from({ length: 30 }, (_, i) => ({
      index:   i,
      type:    'LEDGER_CREDIT',
      payload: { accountId: `acc-${i % 5}`, amountMicro: '1000000' },
      hash:    'e'.repeat(64),
      prevHash: 'e'.repeat(64),
      ts:       new Date().toISOString(),
    }));

    const re  = new ReplayEngine({ auditLog: makeAuditLog(entries) });
    const res = re.verifyReplayChain({ pageSize: 10 });

    expect(res.ok).toBe(true);
    expect(res.pagesVerified).toBe(3);
    expect(res.totalEventsApplied).toBe(30); // all 30 entries map to ledger events
  });
});

// ── verifyReplayChain — response shape ───────────────────────────────────────

describe('ReplayEngine.verifyReplayChain — response shape', () => {
  it('always returns all required fields', () => {
    const re  = new ReplayEngine({ auditLog: makeAuditLog([]) });
    const res = re.verifyReplayChain();

    expect(res).toHaveProperty('ok');
    expect(res).toHaveProperty('chainIntact');
    expect(res).toHaveProperty('pagesVerified');
    expect(res).toHaveProperty('totalEventsApplied');
    expect(res).toHaveProperty('totalAuditEntries');
    expect(res).toHaveProperty('finalStateHash');
    expect(res).toHaveProperty('proofSample');
    expect(res).toHaveProperty('brokenAt');
  });

  it('proofSample entries have expected structure', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      index: i, type: 'INFO', payload: {}, hash: 'f'.repeat(64), prevHash: 'f'.repeat(64),
      ts: new Date().toISOString(),
    }));

    const re  = new ReplayEngine({ auditLog: makeAuditLog(entries) });
    const res = re.verifyReplayChain();

    for (const p of res.proofSample) {
      expect(p).toHaveProperty('cursor');
      expect(p).toHaveProperty('nextCursor');
      expect(p).toHaveProperty('replayProof');
      expect(p).toHaveProperty('finalStateHash');
      expect(p).toHaveProperty('eventsApplied');
    }
  });

  it('finalStateHash is a 64-char hex string', () => {
    const re  = new ReplayEngine({ auditLog: makeAuditLog([]) });
    const res = re.verifyReplayChain();

    expect(res.finalStateHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
