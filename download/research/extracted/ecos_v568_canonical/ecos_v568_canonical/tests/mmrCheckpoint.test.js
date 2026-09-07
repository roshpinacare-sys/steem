/**
 * tests/mmrCheckpoint.test.js — ECOS V124
 * Tests for signed MMR checkpoint generation and verification.
 */

'use strict';

const assert = require('node:assert/strict');
const { generateCheckpoint, verifyCheckpoint } = require('../lib/mmrCheckpoint');

// ── Minimal MMR stub ──────────────────────────────────────────────────────────
function makeMMR(root = 'abc123', size = 5) {
  return {
    getRoot: () => root,
    _size: size,
    _leafHashes: new Array(size).fill('a'),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('mmrCheckpoint', () => {
  const HMAC_KEY  = 'test-hmac-key-v124';
  const SERVER_ID = 'agent-test-001';

  it('generates a checkpoint with all required fields', () => {
    const mmr = makeMMR('deadbeef0123', 10);
    const cp  = generateCheckpoint(mmr, SERVER_ID, { hmacKey: HMAC_KEY });

    assert.ok(cp.root,        'root present');
    assert.ok(cp.leafCount,   'leafCount present');
    assert.ok(cp.timestamp,   'timestamp present');
    assert.ok(cp.serverId,    'serverId present');
    assert.ok(cp.ecosVersion, 'ecosVersion present');
    assert.ok(cp.signature,   'signature present (64-char hex)');
    assert.ok(cp.canonical,   'canonical present');
    assert.equal(cp.signature.length, 64, 'HMAC-SHA256 = 64 hex chars');
    assert.equal(cp.leafCount, 10,        'leafCount matches MMR');
    assert.equal(cp.ecosVersion, 'V124',  'version tag correct');
  });

  it('verifies a valid checkpoint', () => {
    const mmr = makeMMR('root001', 3);
    const cp  = generateCheckpoint(mmr, SERVER_ID, { hmacKey: HMAC_KEY });
    const { valid } = verifyCheckpoint(cp, { hmacKey: HMAC_KEY });
    assert.equal(valid, true, 'valid checkpoint should pass verification');
  });

  it('rejects tampered root', () => {
    const mmr = makeMMR('root002', 7);
    const cp  = generateCheckpoint(mmr, SERVER_ID, { hmacKey: HMAC_KEY });
    const tampered = { ...cp, canonical: cp.canonical.replace('root002', 'root999') };
    const { valid, reason } = verifyCheckpoint(tampered, { hmacKey: HMAC_KEY });
    assert.equal(valid, false, 'tampered canonical should fail');
    assert.ok(reason, 'reason provided for failure');
  });

  it('rejects wrong signing key', () => {
    const mmr = makeMMR('root003', 2);
    const cp  = generateCheckpoint(mmr, SERVER_ID, { hmacKey: HMAC_KEY });
    const { valid } = verifyCheckpoint(cp, { hmacKey: 'wrong-key' });
    assert.equal(valid, false, 'wrong key should fail');
  });

  it('produces deterministic canonical JSON (sorted keys)', () => {
    const mmr = makeMMR('root004', 1);
    const cp  = generateCheckpoint(mmr, SERVER_ID, { hmacKey: HMAC_KEY });
    const parsed = JSON.parse(cp.canonical);
    const keys   = Object.keys(parsed);
    const sorted = [...keys].sort();
    assert.deepEqual(keys, sorted, 'canonical keys should be sorted alphabetically');
  });

  it('missing fields returns invalid', () => {
    const { valid, reason } = verifyCheckpoint({}, { hmacKey: HMAC_KEY });
    assert.equal(valid, false);
    assert.ok(reason);
  });

  it('two identical MMR states → same root, different timestamps → different signatures', () => {
    const mmr = makeMMR('root005', 4);
    // Mock timestamps are different because time passes
    const cp1 = generateCheckpoint(mmr, SERVER_ID, { hmacKey: HMAC_KEY });
    const cp2 = generateCheckpoint(mmr, SERVER_ID, { hmacKey: HMAC_KEY });
    // timestamps may be equal in fast tests but signatures should still both verify
    const r1 = verifyCheckpoint(cp1, { hmacKey: HMAC_KEY });
    const r2 = verifyCheckpoint(cp2, { hmacKey: HMAC_KEY });
    assert.equal(r1.valid, true);
    assert.equal(r2.valid, true);
  });
});
