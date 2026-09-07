/**
 * tests/checkpointScheduler.test.js — ECOS V125
 * Tests for P16-05: auto-checkpoint schedule
 */

'use strict';

const assert = require('node:assert/strict');
const { CheckpointScheduler } = require('../lib/checkpointScheduler');

function makeMockLib() {
  const calls = [];
  return {
    generateCheckpoint(mmr, agentId) {
      calls.push({ mmr, agentId });
      return {
        root:      'b'.repeat(64),
        leafCount: mmr.leafCount || 0,
        serverId:  agentId,
        signature: 'sig',
        canonical: '{}',
      };
    },
    calls,
  };
}

describe('CheckpointScheduler (P16-05)', () => {
  it('does not fire before interval', async () => {
    const lib = makeMockLib();
    const s = new CheckpointScheduler();
    s.setDeps({ mmr: { leafCount: 10 }, mmrCheckpointLib: lib, agentId: 'srv-1' });
    s._interval = 50;
    await s.tick(10);
    // No checkpoint yet (10 < 50)
    assert.equal(lib.calls.length, 0);
  });

  it('fires when interval is reached', async () => {
    const lib = makeMockLib();
    const s = new CheckpointScheduler();
    s.setDeps({ mmr: { leafCount: 50 }, mmrCheckpointLib: lib, agentId: 'srv-1' });
    s._interval = 50;
    await s.tick(50);
    // Give async fire a tick to run
    await new Promise(r => setTimeout(r, 10));
    assert.equal(lib.calls.length, 1);
  });

  it('does not fire when disabled', async () => {
    const lib = makeMockLib();
    const s = new CheckpointScheduler();
    s.setDeps({ mmr: { leafCount: 100 }, mmrCheckpointLib: lib, agentId: 'srv-1' });
    s._interval = 50;
    s.setEnabled(false);
    await s.tick(100);
    await new Promise(r => setTimeout(r, 10));
    assert.equal(lib.calls.length, 0);
  });

  it('setInterval() updates interval', async () => {
    const s = new CheckpointScheduler();
    await s.setInterval(25);
    assert.equal(s._interval, 25);
  });

  it('setInterval() rejects non-positive values', async () => {
    const s = new CheckpointScheduler();
    await assert.rejects(() => s.setInterval(0), /positive integer/);
  });

  it('stats() reflects current state', () => {
    const s = new CheckpointScheduler();
    s._interval = 75;
    s._enabled  = false;
    const st = s.stats();
    assert.equal(st.interval, 75);
    assert.equal(st.enabled, false);
  });
});
