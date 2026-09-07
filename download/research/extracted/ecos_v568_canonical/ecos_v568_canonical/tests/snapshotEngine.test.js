'use strict';
/**
 * Tests for lib/snapshotEngine.js — V106
 */

import { describe, it, expect, beforeEach } from 'vitest';

const { SnapshotEngine, SNAPSHOT_VERSION } = await import('../lib/snapshotEngine.js');
const { FiatLedger } = await import('../lib/fiatLedger.js');
const { AuditLog } = await import('../lib/auditLog.js');

function buildDeps() {
  const ledger   = new FiatLedger();
  const auditLog = new AuditLog();
  ledger.ensureAccount('client_a');
  ledger.credit('client_a', 1_000_000n);
  auditLog.append('TEST_EVENT', { foo: 'bar' });
  return { ledger, auditLog };
}

describe('SnapshotEngine.export', () => {
  it('exports a versioned snapshot with integrityHash', async () => {
    const { ledger, auditLog } = buildDeps();
    const engine = new SnapshotEngine({ ledger, auditLog });
    const snap = await engine.export({ label: 'test-snap' });

    expect(snap.version).toBe(SNAPSHOT_VERSION);
    expect(snap.label).toBe('test-snap');
    expect(snap.integrityHash).toBeTruthy();
    expect(snap.integrityHash).toHaveLength(64);
    expect(snap.accounts.length).toBeGreaterThan(0);
  });

  it('includes account balances in snapshot', async () => {
    const { ledger, auditLog } = buildDeps();
    const engine = new SnapshotEngine({ ledger, auditLog });
    const snap = await engine.export();

    const acc = snap.accounts.find(a => a.id === 'client_a');
    expect(acc).toBeTruthy();
    expect(acc.microcents).toBe('1000000');
  });

  it('includes audit tail in snapshot', async () => {
    const { ledger, auditLog } = buildDeps();
    const engine = new SnapshotEngine({ ledger, auditLog });
    const snap = await engine.export();

    expect(snap.auditTail.length).toBeGreaterThan(0);
    expect(snap.auditTail[0]).toHaveProperty('hash');
    expect(snap.auditTail[0]).toHaveProperty('type');
  });

  it('includes meta with counts', async () => {
    const { ledger, auditLog } = buildDeps();
    const engine = new SnapshotEngine({ ledger, auditLog });
    const snap = await engine.export();

    expect(snap.meta).toHaveProperty('accountCount');
    expect(snap.meta).toHaveProperty('auditEntries');
  });
});

describe('SnapshotEngine.verify', () => {
  it('returns ok for a valid snapshot', async () => {
    const { ledger, auditLog } = buildDeps();
    const engine = new SnapshotEngine({ ledger, auditLog });
    const snap = await engine.export();
    const result = engine.verify(snap);
    expect(result.ok).toBe(true);
  });

  it('rejects tampered snapshot', async () => {
    const { ledger, auditLog } = buildDeps();
    const engine = new SnapshotEngine({ ledger, auditLog });
    const snap = await engine.export();

    // Tamper with a balance
    const tampered = JSON.parse(JSON.stringify(snap));
    tampered.accounts[0].microcents = '9999999999';

    const result = engine.verify(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/mismatch/);
  });

  it('rejects snapshot with missing integrityHash', () => {
    const engine = new SnapshotEngine({});
    const result = engine.verify({ version: SNAPSHOT_VERSION, accounts: [] });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/integrityHash/);
  });

  it('rejects unsupported version', () => {
    const engine = new SnapshotEngine({});
    const result = engine.verify({ version: 999, integrityHash: 'abc' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/version/);
  });

  it('rejects non-object input', () => {
    const engine = new SnapshotEngine({});
    expect(engine.verify(null).ok).toBe(false);
    expect(engine.verify('string').ok).toBe(false);
  });
});

describe('SnapshotEngine.restore', () => {
  it('restores account balances from snapshot', async () => {
    const { ledger, auditLog } = buildDeps();
    const engine = new SnapshotEngine({ ledger, auditLog });
    const snap = await engine.export();

    // Create a fresh ledger and restore into it
    const freshLedger   = new FiatLedger();
    const freshAuditLog = new AuditLog();
    const freshEngine   = new SnapshotEngine({ ledger: freshLedger, auditLog: freshAuditLog });

    const result = await freshEngine.restore(snap);
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(true);
    expect(freshLedger.balance('client_a')).toBe(1_000_000n);
  });

  it('rejects tampered snapshot on restore', async () => {
    const { ledger, auditLog } = buildDeps();
    const engine = new SnapshotEngine({ ledger, auditLog });
    const snap = await engine.export();

    const tampered = JSON.parse(JSON.stringify(snap));
    tampered.meta.accountCount = 9999;

    const result = await engine.restore(tampered);
    expect(result.ok).toBe(false);
    expect(result.applied).toBe(false);
  });

  it('dryRun=true: verifies but does not apply', async () => {
    const { ledger, auditLog } = buildDeps();
    const engine = new SnapshotEngine({ ledger, auditLog });
    const snap = await engine.export();

    const freshLedger   = new FiatLedger();
    const freshEngine   = new SnapshotEngine({ ledger: freshLedger, auditLog: new AuditLog() });
    const result = await freshEngine.restore(snap, { dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(false);
    // Balance should not have been applied
    expect(freshLedger.balance('client_a')).toBe(0n);
  });
});
