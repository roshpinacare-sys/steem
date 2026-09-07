/**
 * tests/mmrCompaction.test.js — ECOS V125
 * Tests for P16-03: MMR compaction
 */

'use strict';

const assert = require('node:assert/strict');
const { MmrCompactor } = require('../lib/mmrCompaction');

// Minimal mock MMR
function makeMockMMR(leafCount) {
  return {
    leafCount,
    root: 'a'.repeat(64),
    baggedRoot() { return this.root; },
    pruneOldestLeaves(n) { this.leafCount -= n; return n; },
  };
}

describe('MmrCompactor (P16-03)', () => {
  it('does not compact if below threshold', async () => {
    const c = new MmrCompactor({ threshold: 100 });
    const mmr = makeMockMMR(50);
    const result = await c.maybeCompact(mmr);
    assert.equal(result.compacted, false);
  });

  it('compacts when at or above threshold', async () => {
    const c = new MmrCompactor({ threshold: 100, archiveCount: 80 });
    const mmr = makeMockMMR(100);
    const result = await c.maybeCompact(mmr);
    assert.equal(result.compacted, true);
    assert.equal(result.leavesArchived, 80);
  });

  it('reports rootBefore and rootAfter', async () => {
    const c = new MmrCompactor({ threshold: 10, archiveCount: 5 });
    const mmr = makeMockMMR(10);
    const result = await c.maybeCompact(mmr);
    assert.ok(result.rootBefore);
    assert.ok(result.rootAfter);
  });

  it('hysteresis: does not compact twice without new leaves', async () => {
    const c = new MmrCompactor({ threshold: 10, archiveCount: 5 });
    const mmr = makeMockMMR(10);
    await c.maybeCompact(mmr);           // first compaction
    const r2 = await c.maybeCompact(mmr); // immediately after — same leaf count
    assert.equal(r2.compacted, false);
  });

  it('stats() returns threshold and archiveCount', () => {
    const c = new MmrCompactor({ threshold: 200, archiveCount: 150 });
    const s = c.stats();
    assert.equal(s.threshold, 200);
    assert.equal(s.archiveCount, 150);
  });
});
