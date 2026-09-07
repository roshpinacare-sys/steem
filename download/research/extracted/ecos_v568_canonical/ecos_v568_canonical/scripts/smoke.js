#!/usr/bin/env node
/**
 * ECOS B2B Core - Offline Smoke Test
 * ----------------------------------
 * Runs WITHOUT npm install. Exercises every public surface of:
 *   - vendor/nanoid
 *   - src/lib/fiatLedger.js
 *   - src/lib/auditLog.js
 *   - src/lib/hitlGate.js
 *
 * Exit code 0 = all checks passed. Non-zero = a check failed.
 *
 * Usage: node scripts/smoke.js
 */

'use strict';

const assert = require('node:assert/strict');

function section(name) {
  process.stdout.write(`\n▸ ${name}\n`);
}
function ok(msg) {
  process.stdout.write(`  ✓ ${msg}\n`);
}

let failed = 0;
function test(name, fn) {
  try { fn(); ok(name); }
  catch (e) {
    failed++;
    process.stdout.write(`  ✗ ${name}\n      ${e.message}\n`);
  }
}

// -------- nanoid --------
section('vendor/nanoid');
const { nanoid, customAlphabet } = require('../vendor/nanoid');
test('default size = 21', () => assert.equal(nanoid().length, 21));
test('custom size works', () => assert.equal(nanoid(8).length, 8));
test('uniqueness across 1000 calls', () => {
  const s = new Set();
  for (let i = 0; i < 1000; i++) s.add(nanoid());
  assert.equal(s.size, 1000);
});
test('customAlphabet honours alphabet', () => {
  const gen = customAlphabet('abc', 16);
  const v = gen();
  assert.equal(v.length, 16);
  assert.ok(/^[abc]+$/.test(v), `unexpected chars: ${v}`);
});

// -------- fiatLedger --------
section('src/lib/fiatLedger');
const {
  FiatLedger, SYSTEM_ACCOUNTS, USD_SCALE,
  usdToMicrocents, microcentsToUsdString,
} = require('../src/lib/fiatLedger');

test('USD_SCALE = 10000n', () => assert.equal(USD_SCALE, 10000n));

test('usdToMicrocents("1.00") = 10000n', () =>
  assert.equal(usdToMicrocents('1.00'), 10000n));

test('usdToMicrocents("0.0001") = 1n (microcent)', () =>
  assert.equal(usdToMicrocents('0.0001'), 1n));

test('usdToMicrocents("123.4567") = 1234567n', () =>
  assert.equal(usdToMicrocents('123.4567'), 1234567n));

test('round-trip USD string preserved', () =>
  assert.equal(microcentsToUsdString(usdToMicrocents('99.9999')), '99.9999'));

test('rejects malformed decimal', () => {
  assert.throws(() => usdToMicrocents('1.2.3'));
  assert.throws(() => usdToMicrocents('abc'));
});

test('credit increases balance', () => {
  const L = new FiatLedger();
  L.credit('acme', usdToMicrocents('500.00'));
  assert.equal(L.balance('acme'), 5_000_000n);
  assert.equal(L.balanceUsd('acme'), '500.0000');
});

test('debit rejects overdraft', () => {
  const L = new FiatLedger();
  L.credit('acme', usdToMicrocents('1.00'));
  assert.throws(() => L.debit('acme', usdToMicrocents('5.00')), /insufficient/);
});

test('transfer is atomic + balanced', () => {
  const L = new FiatLedger();
  L.credit('a', usdToMicrocents('10.00'));
  L.transfer('a', 'b', usdToMicrocents('3.00'));
  assert.equal(L.balanceUsd('a'), '7.0000');
  assert.equal(L.balanceUsd('b'), '3.0000');
});

test('40/40/20 split on $100.00 = 40/40/20 exactly', () => {
  const L = new FiatLedger();
  L.credit('client', usdToMicrocents('100.00'));
  const r = L.distributeTaskPayment({
    clientAccountId: 'client',
    validatorAccountId: 'val_alice',
    grossAmountUsd: '100.00',
  });
  assert.equal(r.platform,  400000n);  // $40.0000
  assert.equal(r.validator, 400000n);  // $40.0000
  assert.equal(r.insurance, 200000n);  // $20.0000
  assert.equal(r.platform + r.validator + r.insurance, r.gross);
  assert.equal(L.balanceUsd('client'),  '0.0000');
  assert.equal(L.balanceUsd('val_alice'), '40.0000');
  assert.equal(L.balanceUsd(SYSTEM_ACCOUNTS.PLATFORM),  '40.0000');
  assert.equal(L.balanceUsd(SYSTEM_ACCOUNTS.INSURANCE), '20.0000');
  assert.equal(L.balanceUsd(SYSTEM_ACCOUNTS.ESCROW),    '0.0000');
});

test('40/40/20 split on odd amount has zero leakage', () => {
  const L = new FiatLedger();
  // 7 microcents → 40% = 2 (floor), 40% = 2 (floor), insurance = 3
  L.credit('client', 7n);
  const r = L.distributeTaskPayment({
    clientAccountId: 'client',
    validatorAccountId: 'val_alice',
    grossAmountUsd: 7n,
  });
  assert.equal(r.platform,  2n);
  assert.equal(r.validator, 2n);
  assert.equal(r.insurance, 3n);
  assert.equal(r.platform + r.validator + r.insurance, 7n);
});

// -------- auditLog --------
section('src/lib/auditLog');
const { AuditLog, NULL_HASH } = require('../src/lib/auditLog');

test('first entry chains from NULL_HASH', () => {
  const log = new AuditLog();
  const e = log.append('TEST', { hello: 'world' });
  assert.equal(e.prevHash, NULL_HASH);
  assert.equal(e.index, 0);
  assert.equal(e.hash.length, 64);
});

test('chain links sequential entries', () => {
  const log = new AuditLog();
  const a = log.append('A', { n: 1 });
  const b = log.append('B', { n: 2 });
  assert.equal(b.prevHash, a.hash);
});

test('verify() detects tampering', () => {
  const log = new AuditLog();
  log.append('A', { n: 1 });
  log.append('B', { n: 2 });
  log.append('C', { n: 3 });
  assert.equal(log.verify().ok, true);

  // Tamper with entry 1's payload via internal access.
  const internal = log._entries;
  internal[1] = { ...internal[1], payload: { n: 999 } };
  const v = log.verify();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 1);
});

test('canonical JSON is key-order independent', () => {
  const log1 = new AuditLog();
  const log2 = new AuditLog();
  const e1 = log1.append('X', { a: 1, b: 2 });
  const e2 = log2.append('X', { b: 2, a: 1 });
  // Hashes will differ only by timestamp; the *payload preimage portion*
  // should be identical, so canonicalize the same dict to confirm.
  const { canonicalize } = require('../src/lib/auditLog');
  assert.equal(canonicalize(e1.payload), canonicalize(e2.payload));
});

// -------- hitlGate --------
section('src/lib/hitlGate');
const { HitlGate, STATUS, DECISION } = require('../src/lib/hitlGate');

test('create → approve full lifecycle', () => {
  const ledger = new FiatLedger();
  const audit  = new AuditLog();
  let broadcasts = 0;
  const gate = new HitlGate({
    ledger, auditLog: audit,
    broadcast: () => { broadcasts++; },
  });

  ledger.credit('client_acme', usdToMicrocents('250.00'));

  const a = gate.createApproval({
    missionId: 'm_001',
    clientAccountId: 'client_acme',
    priceUsd: '50.00',
    aiOutput: { kind: 'summary', text: 'lorem ipsum' },
    confidence: 0.72,
  });
  assert.equal(a.status, STATUS.PENDING);

  const res = gate.resolveApproval(a.id, {
    validatorAccountId: 'val_bob',
    decision: DECISION.APPROVE,
  });
  assert.equal(res.approval.status, STATUS.APPROVED);
  assert.equal(ledger.balanceUsd('val_bob'),    '20.0000'); // 40% of $50
  assert.equal(ledger.balanceUsd(SYSTEM_ACCOUNTS.PLATFORM),  '20.0000');
  assert.equal(ledger.balanceUsd(SYSTEM_ACCOUNTS.INSURANCE), '10.0000');
  assert.equal(ledger.balanceUsd('client_acme'), '200.0000');
  assert.ok(broadcasts >= 2, 'broadcast fired for create + resolve');
  assert.equal(audit.verify().ok, true);
});

test('modify requires finalOutput', () => {
  const gate = new HitlGate({ ledger: new FiatLedger(), auditLog: new AuditLog() });
  const a = gate.createApproval({
    missionId: 'm_002',
    clientAccountId: 'c',
    priceUsd: '1.00',
    aiOutput: {},
  });
  gate.ledger.credit('c', usdToMicrocents('1.00'));
  assert.throws(
    () => gate.resolveApproval(a.id, {
      validatorAccountId: 'v', decision: DECISION.MODIFY,
    }),
    /finalOutput required/,
  );
});

test('reject does NOT bill the client', () => {
  const ledger = new FiatLedger();
  const gate = new HitlGate({ ledger, auditLog: new AuditLog() });
  ledger.credit('c', usdToMicrocents('10.00'));
  const a = gate.createApproval({
    missionId: 'm_003', clientAccountId: 'c',
    priceUsd: '10.00', aiOutput: {},
  });
  gate.resolveApproval(a.id, {
    validatorAccountId: 'v',
    decision: DECISION.REJECT,
  });
  assert.equal(ledger.balanceUsd('c'), '10.0000', 'client balance unchanged');
  assert.equal(ledger.balanceUsd('v'),  '0.0000', 'validator not paid');
});

test('double-resolve rejected', () => {
  const ledger = new FiatLedger();
  const gate = new HitlGate({ ledger, auditLog: new AuditLog() });
  ledger.credit('c', usdToMicrocents('5.00'));
  const a = gate.createApproval({
    missionId: 'm_004', clientAccountId: 'c',
    priceUsd: '5.00', aiOutput: {},
  });
  gate.resolveApproval(a.id, {
    validatorAccountId: 'v', decision: DECISION.APPROVE,
  });
  assert.throws(
    () => gate.resolveApproval(a.id, {
      validatorAccountId: 'v2', decision: DECISION.APPROVE,
    }),
    /already/,
  );
});

test('list by mission filters by status', () => {
  const ledger = new FiatLedger();
  const gate = new HitlGate({ ledger, auditLog: new AuditLog() });
  ledger.credit('c', usdToMicrocents('100.00'));
  for (let i = 0; i < 3; i++) {
    gate.createApproval({
      missionId: 'm_list', clientAccountId: 'c',
      priceUsd: '1.00', aiOutput: { i },
    });
  }
  const all = gate.listApprovalsForMission('m_list');
  assert.equal(all.length, 3);
  const pending = gate.listApprovalsForMission('m_list', { status: STATUS.PENDING });
  assert.equal(pending.length, 3);
  gate.resolveApproval(all[0].id, {
    validatorAccountId: 'v', decision: DECISION.APPROVE,
  });
  assert.equal(
    gate.listApprovalsForMission('m_list', { status: STATUS.APPROVED }).length, 1,
  );
});

// -------- summary --------
process.stdout.write('\n');
if (failed === 0) {
  process.stdout.write('ALL SMOKE TESTS PASSED\n');
  process.exit(0);
} else {
  process.stdout.write(`${failed} CHECK(S) FAILED\n`);
  process.exit(1);
}
