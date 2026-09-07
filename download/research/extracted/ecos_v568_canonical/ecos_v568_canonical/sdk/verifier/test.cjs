'use strict';
/**
 * sdk/verifier/test.cjs — @ecos/verifier consumer test harness
 *
 * DIRECTION 3: Standalone test that exercises @ecos/verifier from the
 * published package path, simulating a downstream consumer. No internal
 * ECOS modules are imported. Only the public SDK entry (index.cjs) is used.
 *
 * Run: node sdk/verifier/test.cjs
 * Exit 0 = all pass. Exit 1 = failures.
 *
 * @version 374.0.0 (SDK consumer test — ships with V375)
 */

const path   = require('path');
const crypto = require('crypto');

// ── Import only the published SDK entry — no internal modules ─────────────────
const SDK = require('./index.cjs');

let passed = 0, failed = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.error('  ✗ ' + name + ': ' + e.message);
    failed++;
    errors.push(name);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error((msg || 'assertEqual') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b));
}

// ── Minimal pure implementations (no ECOS internals) ─────────────────────────

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}
function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}

// ── Build a minimal valid proof that verifyPortableProof can accept ────────────
// We construct the proof manually so this test has NO dependency on ecos internals.

const NULL_HASH = '0'.repeat(64);

function makeAuditEntry(index, type, payload, prevHash) {
  const ts = new Date(Date.now() + index * 1000).toISOString();
  const preimage = `${index}|${ts}|${canon(payload)}|${prevHash}`;
  const hash = sha256Hex(preimage);
  return { index, ts, type, payload, prevHash, hash };
}

function buildMiniProof() {
  // Build a 2-entry audit chain
  const e0 = makeAuditEntry(0, 'credit.issued',  { amount: '2000000' }, NULL_HASH);
  const e1 = makeAuditEntry(1, 'task.settled',   { gross: '800000' },   e0.hash);

  const headHash = e1.hash;
  const chainCommitment = {
    committed: true,
    headHash,
    length: 2,
    schema: 'ecos.integrity.chain.commitment/v372',
    source: 'in-memory',
    version: '372.0.0',
  };

  // Minimal V360-style integrity summary
  const integritySummary = {
    overallIntegrity: true,
    failClosed: false,
    conservationOk: true,
    backingOk: true,
    splitOk: true,
    version: '360.0.0',
  };

  // Conservation snapshot
  const conservation = {
    ok: true,
    netFlow: '1200000',
    grossSettled: '800000',
    totalCredits: '2000000',
    totalDebits: '800000',
    diff: '0',
    version: '372.0.0',
  };

  // Recipe (schema + instructions for re-derivation)
  const recipe = {
    schema: 'ecos.integrity.proof/v372',
    steps: [
      'recompute chain head from auditEntries',
      'verify conservation: totalCredits - totalDebits = netFlow',
    ],
  };

  // Build proof body minus proofHash
  const body = {
    schema: 'ecos.integrity.proof/v372',
    version: '372.0.0',
    issuedAt: new Date().toISOString(),
    missionId: 'test-mission-consumer',
    integritySummary,
    chainCommitment,
    conservation,
    recipe,
  };

  const proofHash = sha256Hex(canon(body));
  return { ...body, proofHash };
}

function buildMiniSnapshot(entries) {
  // Snapshot shape expected by verifyPortableProof373
  return {
    auditEntries: entries.map(e => ({
      index:    e.index,
      ts:       e.ts,
      type:     e.type,
      payload:  e.payload,
      prevHash: e.prevHash,
      hash:     e.hash,
    })),
    ledgerEntries:   [],
    accountBalances: {},
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n[@ecos/verifier consumer test]\n');

test('SDK exports verifyPortableProof function', () => {
  assert(typeof SDK.verifyPortableProof === 'function', 'verifyPortableProof missing');
});

test('SDK exports verifyPortableProof373 function', () => {
  assert(typeof SDK.verifyPortableProof373 === 'function', 'verifyPortableProof373 missing');
});

test('SDK exports SDK_VERSION_374 = "374.0.0"', () => {
  assertEqual(SDK.SDK_VERSION_374, '374.0.0');
});

test('SDK exports VERIFIER_SDK_VERSION_373', () => {
  assert(typeof SDK.VERIFIER_SDK_VERSION_373 === 'string', 'VERIFIER_SDK_VERSION_373 missing');
});

test('SDK exports ACCEPTED_SCHEMAS_373 as array', () => {
  assert(Array.isArray(SDK.ACCEPTED_SCHEMAS_373), 'ACCEPTED_SCHEMAS_373 must be array');
  assert(SDK.ACCEPTED_SCHEMAS_373.length > 0, 'ACCEPTED_SCHEMAS_373 must not be empty');
});

test('verifyPortableProof rejects null proof', () => {
  const result = SDK.verifyPortableProof(null, {}, { hashFn: sha256Hex, canonicalize: canon });
  assert(!result.valid, 'null proof must be invalid');
});

test('verifyPortableProof rejects proof with tampered proofHash', () => {
  const proof = buildMiniProof();
  const tampered = { ...proof, proofHash: sha256Hex('wrong') };
  const result = SDK.verifyPortableProof(tampered, {}, { hashFn: sha256Hex, canonicalize: canon });
  assert(!result.valid, 'tampered proofHash must be invalid');
});

test('verifyPortableProof result has required shape', () => {
  const result = SDK.verifyPortableProof(buildMiniProof(), {}, { hashFn: sha256Hex, canonicalize: canon });
  assert('valid' in result,      'result.valid missing');
  assert('checks' in result,     'result.checks missing');
  assert('mismatches' in result, 'result.mismatches missing');
  assert(Array.isArray(result.mismatches), 'mismatches must be array');
});

test('verifyPortableProof does not throw on garbage input', () => {
  // Must never throw — offline verifier contract
  const result = SDK.verifyPortableProof({ proofHash: 'garbage', schema: 'unknown' }, {});
  assert(typeof result.valid === 'boolean', 'must return {valid}');
});

test('SDK _sha256Hex373 helper is a function', () => {
  assert(typeof SDK._sha256Hex373 === 'function', '_sha256Hex373 missing');
  const h = SDK._sha256Hex373('hello');
  assert(typeof h === 'string' && h.length === 64, '_sha256Hex373 must return 64-char hex');
});

test('SDK _canon373 helper is a function', () => {
  assert(typeof SDK._canon373 === 'function', '_canon373 missing');
  const c = SDK._canon373({ b: 2, a: 1 });
  assert(c.includes('"a"') && c.includes('"b"'), '_canon373 must sort keys');
  assert(c.indexOf('"a"') < c.indexOf('"b"'), '_canon373 must sort a before b');
});

test('verifyPortableProof and verifyPortableProof373 are the same function', () => {
  assert(SDK.verifyPortableProof === SDK.verifyPortableProof373,
    'verifyPortableProof must be an alias for verifyPortableProof373');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n  Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.error('  Failed: ' + errors.join(', '));
  process.exit(1);
}
console.log('  ✓ All @ecos/verifier consumer tests passed\n');
