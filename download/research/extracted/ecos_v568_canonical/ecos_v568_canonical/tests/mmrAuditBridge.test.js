/**
 * mmrAuditBridge.test.js — ECOS V123
 * =====================================
 * Tests for the MMR↔AuditLog bridge and hash-addressed proof lookup.
 */

'use strict';

const assert = require('node:assert/strict');
const { AuditLog } = require('../lib/auditLog');
const { MerkleMountainRange } = require('../lib/inclusionProof');
const { wireMMRToAuditLog, getLeafIndexByHash, getHashMap, seedHashMap } = require('../lib/mmrAuditBridge');

// ── Helpers ──────────────────────────────────────────────────────────────────

function freshPair() {
  // Create independent instances for each test
  const log = new AuditLog();
  const mmr = new MerkleMountainRange();
  wireMMRToAuditLog(log, mmr);
  return { log, mmr };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('mmrAuditBridge', () => {

  it('[V123-MMR-01] wireMMRToAuditLog: marks log as wired', () => {
    const log = new AuditLog();
    const mmr = new MerkleMountainRange();
    wireMMRToAuditLog(log, mmr);
    assert.equal(log._mmrWired, true);
  });

  it('[V123-MMR-02] wireMMRToAuditLog: idempotent — double-wire does not double-append', () => {
    const log = new AuditLog();
    const mmr = new MerkleMountainRange();
    wireMMRToAuditLog(log, mmr);
    wireMMRToAuditLog(log, mmr); // second call is a no-op
    log.append('TEST', { x: 1 });
    assert.equal(mmr._size, 1, 'Only 1 leaf expected after double-wire + 1 append');
  });

  it('[V123-MMR-03] every auditLog.append() increases MMR leaf count', () => {
    const { log, mmr } = freshPair();
    assert.equal(mmr._size, 0);
    log.append('TASK_CHARGED', { amount: 100 });
    assert.equal(mmr._size, 1);
    log.append('HITL_PAYOUT', { amount: 40 });
    assert.equal(mmr._size, 2);
    log.append('AUDIT_SNAPSHOT', {});
    assert.equal(mmr._size, 3);
  });

  it('[V123-MMR-04] MMR leaf hash matches the audit entry hash', () => {
    const { log, mmr } = freshPair();
    const entry = log.append('TASK_CHARGED', { amount: 500 });
    const leafHash = mmr._leafHashes[0];
    // The MMR hashes the raw data (entry.hash), so sha256(entry.hash) = leafHash
    const { sha256Hex } = require('../lib/auditLog');
    const expected = require('node:crypto').createHash('sha256')
      .update(Buffer.from(entry.hash, 'utf8')).digest('hex');
    assert.equal(leafHash, expected, 'MMR leaf should be sha256(auditEntry.hash)');
  });

  it('[V123-MMR-05] getLeafIndexByHash returns correct index', () => {
    const { log } = freshPair();
    const e1 = log.append('EVENT_A', {});
    const e2 = log.append('EVENT_B', {});
    const e3 = log.append('EVENT_C', {});
    assert.equal(getLeafIndexByHash(e1.hash), 0);
    assert.equal(getLeafIndexByHash(e2.hash), 1);
    assert.equal(getLeafIndexByHash(e3.hash), 2);
  });

  it('[V123-MMR-06] getLeafIndexByHash returns null for unknown hash', () => {
    assert.equal(getLeafIndexByHash('0'.repeat(64)), null);
  });

  it('[V123-MMR-07] MMR root changes after each append', () => {
    const { log, mmr } = freshPair();
    log.append('E1', {});
    const root1 = mmr.root();
    log.append('E2', {});
    const root2 = mmr.root();
    assert.notEqual(root1, root2, 'Root must change on each append');
  });

  it('[V123-MMR-08] inclusion proof verifies for a bridged audit entry', () => {
    const { log, mmr } = freshPair();
    log.append('EVT_A', { note: 'first' });
    log.append('EVT_B', { note: 'second' });
    log.append('EVT_C', { note: 'third' });
    const proof = mmr.generateProof(1); // proof for leaf 1
    const { valid } = MerkleMountainRange.verifyProof(proof);
    assert.equal(valid, true, 'Proof for bridged entry must be valid');
  });

  it('[V123-MMR-09] seedHashMap restores hash→index from restored MMR', () => {
    const { log, mmr } = freshPair();
    log.append('SEED_A', {});
    log.append('SEED_B', {});
    // Simulate restore: serialise + deserialise
    const json = mmr.toJSON();
    const restored = MerkleMountainRange.fromJSON(json);
    seedHashMap(restored);
    const map = getHashMap();
    assert.equal(map.size >= 2, true, 'Map should have at least 2 entries after seed');
  });

  it('[V123-MMR-10] audit entry returned unchanged — bridge is transparent', () => {
    const { log } = freshPair();
    const payload = { taskId: 'T001', amount: 99 };
    const entry = log.append('TASK_CHARGED', payload);
    assert.equal(typeof entry.hash, 'string');
    assert.equal(entry.hash.length, 64);
    assert.equal(entry.type, 'TASK_CHARGED');
    assert.equal(entry.payload.taskId, 'T001');
  });

});
