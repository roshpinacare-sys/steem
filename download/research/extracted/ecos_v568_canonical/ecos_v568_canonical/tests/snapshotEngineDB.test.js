'use strict';
/**
 * Tests for V108-P5-04: SnapshotEngine DB persistence
 * SnapshotEngine.exportToDB() and loadFromDB() with mock pg.Pool
 */

import { describe, it, expect, beforeEach } from 'vitest';

const { SnapshotEngine, SNAPSHOT_VERSION } = await import('../lib/snapshotEngine.js');
const { FiatLedger, usdToMicrocents } = await import('../lib/fiatLedger.js');
const { AuditLog } = await import('../lib/auditLog.js');

// ── Test fixtures ─────────────────────────────────────────────────────────────

function makeEngine() {
  const ledger   = new FiatLedger();
  const auditLog = new AuditLog();
  ledger.ensureAccount('client_test');
  ledger.credit('client_test', usdToMicrocents('10.00'));
  auditLog.append('TEST_EVENT', { test: true });
  return new SnapshotEngine({ ledger, auditLog });
}

// Mock pg.Pool that records all queries
function makeMockPool(opts = {}) {
  const queries = [];
  const rows    = opts.rows || [];
  return {
    _queries: queries,
    query: (sql, params) => {
      queries.push({ sql, params });
      if (opts.error) return Promise.reject(new Error(opts.error));
      return Promise.resolve({ rows: rows.slice() });
    },
  };
}

// ── exportToDB ────────────────────────────────────────────────────────────────

describe('SnapshotEngine.exportToDB', () => {
  it('returns snapshot with dbId when pool.query succeeds', async () => {
    const engine = makeEngine();
    const pool   = makeMockPool();

    const result = await engine.exportToDB(pool, { label: 'test-export', savedBy: 'ci' });

    expect(result.dbId).toMatch(/^snap_/);
    expect(result.integrityHash).toBeTruthy();
    expect(result.label).toBe('test-export');
  });

  it('issues exactly one INSERT query', async () => {
    const engine = makeEngine();
    const pool   = makeMockPool();

    await engine.exportToDB(pool);

    expect(pool._queries).toHaveLength(1);
    expect(pool._queries[0].sql).toContain('INSERT INTO snapshots');
  });

  it('includes integrity_hash, version, account_count in query params', async () => {
    const engine = makeEngine();
    const pool   = makeMockPool();

    const result = await engine.exportToDB(pool);
    const params = pool._queries[0].params;

    // param[3] = integrity_hash (char(64) hex)
    expect(params[3]).toHaveLength(64);
    expect(params[3]).toBe(result.integrityHash);

    // param[4] = version (integer = 1)
    expect(params[4]).toBe(SNAPSHOT_VERSION);

    // param[5] = account_count (at least 1 from ledger fixture)
    expect(params[5]).toBeGreaterThanOrEqual(1);
  });

  it('sets savedBy param in query', async () => {
    const engine = makeEngine();
    const pool   = makeMockPool();

    await engine.exportToDB(pool, { savedBy: 'cron' });
    const params = pool._queries[0].params;

    // savedBy is param[10]
    expect(params[10]).toBe('cron');
  });

  it('throws TypeError if pool is null', async () => {
    const engine = makeEngine();
    await expect(engine.exportToDB(null)).rejects.toThrow('pool is required');
  });

  it('throws when pool.query rejects', async () => {
    const engine = makeEngine();
    const pool   = makeMockPool({ error: 'DB connection refused' });

    await expect(engine.exportToDB(pool)).rejects.toThrow('DB connection refused');
  });

  it('snapshot body stored as valid JSON with integrity hash', async () => {
    const engine = makeEngine();
    const pool   = makeMockPool();

    await engine.exportToDB(pool);
    const params = pool._queries[0].params;
    const body   = JSON.parse(params[8]); // param[8] = body JSONB

    // Verify the stored body round-trips through verify()
    const verification = engine.verify(body);
    expect(verification.ok).toBe(true);
  });
});

// ── loadFromDB ────────────────────────────────────────────────────────────────

describe('SnapshotEngine.loadFromDB', () => {
  async function makeValidSnapshotRow() {
    const engine   = makeEngine();
    const snapshot = await engine.export({ label: 'test-load' });
    return {
      id:             'snap_test001',
      label:          'test-load',
      exported_at:    snapshot.exportedAt,
      integrity_hash: snapshot.integrityHash,
      body:           snapshot,       // pg returns JSONB already parsed
    };
  }

  it('returns ok: true and applies state on valid snapshot row', async () => {
    const row    = await makeValidSnapshotRow();
    const engine = makeEngine();
    const pool   = makeMockPool({ rows: [row] });

    const result = await engine.loadFromDB(pool);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.dbId).toBe('snap_test001');
  });

  it('returns ok: false when no rows returned', async () => {
    const engine = makeEngine();
    const pool   = makeMockPool({ rows: [] });

    const result = await engine.loadFromDB(pool);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('No snapshot found');
  });

  it('dryRun: true verifies but does not apply', async () => {
    const row    = await makeValidSnapshotRow();
    const engine = makeEngine();
    const pool   = makeMockPool({ rows: [row] });

    const result = await engine.loadFromDB(pool, { dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('dryRun');
  });

  it('returns ok: false for tampered snapshot body', async () => {
    const row    = await makeValidSnapshotRow();
    // Tamper with the body
    row.body.meta.accountCount = 999;

    const engine = makeEngine();
    const pool   = makeMockPool({ rows: [row] });

    const result = await engine.loadFromDB(pool);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('integrityHash mismatch');
  });

  it('issues SELECT query with ORDER BY exported_at DESC LIMIT', async () => {
    const engine = makeEngine();
    const pool   = makeMockPool({ rows: [] });

    await engine.loadFromDB(pool);

    expect(pool._queries[0].sql).toContain('ORDER BY exported_at DESC LIMIT');
  });

  it('adds AND label = $N when opts.label is provided', async () => {
    const engine = makeEngine();
    const pool   = makeMockPool({ rows: [] });

    await engine.loadFromDB(pool, { label: 'my-label' });

    expect(pool._queries[0].sql).toContain('label');
    expect(pool._queries[0].params).toContain('my-label');
  });

  it('adds AND id = $N when opts.id is provided', async () => {
    const engine = makeEngine();
    const pool   = makeMockPool({ rows: [] });

    await engine.loadFromDB(pool, { id: 'snap_xyz' });

    expect(pool._queries[0].params).toContain('snap_xyz');
  });

  it('throws TypeError if pool is null', async () => {
    const engine = makeEngine();
    await expect(engine.loadFromDB(null)).rejects.toThrow('pool is required');
  });

  it('throws when pool.query rejects', async () => {
    const engine = makeEngine();
    const pool   = makeMockPool({ error: 'read replica timeout' });

    await expect(engine.loadFromDB(pool)).rejects.toThrow('read replica timeout');
  });
});
