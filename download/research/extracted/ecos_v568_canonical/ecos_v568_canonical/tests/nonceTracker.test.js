/**
 * tests/nonceTracker.test.js — ECOS V124
 * Tests for monotonic nonce counter / replay protection.
 */

'use strict';

const assert = require('node:assert/strict');
const { NonceTracker } = require('../lib/nonceTracker');

describe('NonceTracker', () => {
  let nt;

  beforeEach(() => {
    nt = new NonceTracker(); // no DB, in-memory only
  });

  it('starts at nonce 0 for unknown pair', () => {
    assert.equal(nt.current('approval', 'acc-001'), 0n);
  });

  it('auto-issues nonce 1 when no client nonce provided', async () => {
    const r = await nt.consume('approval', 'acc-001', null);
    assert.equal(r.valid, true);
    assert.equal(r.nonce, 1);
  });

  it('accepts client nonce = current + 1 (strict sequential)', async () => {
    await nt.consume('approval', 'acc-002', null); // nonce → 1
    const r = await nt.consume('approval', 'acc-002', 2);
    assert.equal(r.valid, true);
    assert.equal(r.nonce, 2);
  });

  it('rejects replay: client nonce <= current', async () => {
    await nt.consume('approval', 'acc-003', 5); // nonce → 5
    const r = await nt.consume('approval', 'acc-003', 5);
    assert.equal(r.valid, false);
    assert.ok(r.reason.includes('replay'));
    assert.equal(r.nonce, 5);
  });

  it('rejects nonce = 0 when current = 2', async () => {
    await nt.consume('approval', 'acc-004', 2);
    const r = await nt.consume('approval', 'acc-004', 0);
    assert.equal(r.valid, false);
  });

  it('accepts gap (skip) with gap field', async () => {
    await nt.consume('ledger', 'acc-005', 1);
    const r = await nt.consume('ledger', 'acc-005', 5); // skip 2,3,4
    assert.equal(r.valid, true);
    assert.equal(r.nonce, 5);
    assert.equal(r.gap, 3);
  });

  it('tracks separate scopes independently', async () => {
    await nt.consume('approval', 'acc-006', 10);
    // ledger scope for same account starts at 0
    assert.equal(nt.current('ledger', 'acc-006'), 0n);
    const r = await nt.consume('ledger', 'acc-006', 1);
    assert.equal(r.valid, true);
  });

  it('stats() returns trackedPairs count', async () => {
    await nt.consume('approval', 'acc-007', null);
    await nt.consume('ledger',   'acc-007', null);
    const s = nt.stats();
    assert.equal(s.trackedPairs >= 2, true);
  });
});
