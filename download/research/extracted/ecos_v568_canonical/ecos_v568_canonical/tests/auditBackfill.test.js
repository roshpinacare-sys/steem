/**
 * tests/auditBackfill.test.js — ECOS V125
 * Tests for P16-04: pre-V123 audit_log backfill into MMR
 */

'use strict';

const assert = require('node:assert/strict');
const { AuditBackfill } = require('../lib/auditBackfill');

// Mock DB pool
function makePool(rows = []) {
  const insertedLog = [];
  const backfilled = new Set();
  return {
    _rows: rows,
    async query(sql, params) {
      // V528: model the product query honestly. The real SELECT is
      //   SELECT ... FROM audit_log LEFT JOIN audit_backfill_log ... WHERE bl IS NULL
      // i.e. return only rows NOT yet backfilled. The INSERT records a backfilled id.
      // The previous mock matched audit_backfill_log first (catching the SELECT's JOIN) OR
      // ignored idempotency (returning the same rows every batch). Both were mock bugs; the
      // product code is correct.
      const isInsert = /INSERT\s+INTO\s+audit_backfill_log/i.test(sql);
      if (isInsert) {
        insertedLog.push({ sql, params });
        if (params && params[0] != null) backfilled.add(String(params[0]));
        return { rows: [] };
      }
      if (sql.includes('audit_log')) {
        const limit = params ? params[0] : rows.length;
        const remaining = rows.filter(r => !backfilled.has(String(r.id)));
        return { rows: remaining.slice(0, limit) };
      }
      return { rows: [] };
    },
    insertedLog,
  };
}

// Mock MMR
function makeMockMMR() {
  const leaves = [];
  return {
    leaves,
    append(hash) { leaves.push(hash); return leaves.length - 1; },
  };
}

describe('AuditBackfill (P16-04)', () => {
  it('returns reason when pool not set', async () => {
    const b = new AuditBackfill();
    const r = await b.run();
    assert.ok(r.reason);
    assert.equal(r.done, false);
  });

  it('processes zero rows when pool is empty', async () => {
    const b = new AuditBackfill();
    b.setDeps({ pool: makePool([]), mmr: makeMockMMR() });
    const r = await b.run();
    assert.equal(r.processed, 0);
    assert.equal(r.done, true);
  });

  it('backfills audit rows into MMR', async () => {
    const rows = [
      { id: 1, type: 'CLIENT_DEPOSIT', ts: '2026-01-01T00:00:00Z' },
      { id: 2, type: 'TASK_CREATED',   ts: '2026-01-02T00:00:00Z' },
    ];
    const mmr  = makeMockMMR();
    const pool = makePool(rows);
    const b    = new AuditBackfill();
    b.setDeps({ pool, mmr });
    const r = await b.run({ batchSize: 100 });
    assert.equal(r.processed, 2);
    assert.equal(mmr.leaves.length, 2);
  });

  it('does not double-insert (idempotent on re-run)', async () => {
    const rows = [{ id: 1, type: 'X', ts: '2026-01-01T00:00:00Z' }];
    const mmr  = makeMockMMR();
    const pool = makePool(rows);
    const b    = new AuditBackfill();
    b.setDeps({ pool, mmr });
    await b.run();
    // Second run finds no new rows (mock returns empty after first batch)
    pool._rows = [];
    const r2 = await b.run();
    assert.equal(r2.processed, 0);
  });

  it('stats() returns running flag', () => {
    const b = new AuditBackfill();
    assert.equal(b.stats().running, false);
  });
});
