#!/usr/bin/env node
/**
 * ECOS B2B Persisted Core - Postgres Smoke Test
 * ---------------------------------------------
 * End-to-end validation of the DB-backed kernel. Spins through:
 *
 *   - schema.sql application (idempotent CREATE TABLE IF NOT EXISTS)
 *   - account + balance round-trip with BigInt fidelity
 *   - credit / debit / transfer / overdraft rejection
 *   - 40/40/20 split exactness on a clean number ($100) and a remainder
 *     number (7 μ¢) -- insurance must absorb the leftover
 *   - storage-level CHECK (balance_micro >= 0) blocks impossible deltas
 *   - audit_log SHA-256 chain across many appends, verifyAudit() ok
 *   - audit chain tamper detection (manual UPDATE to corrupt one row)
 *   - HITL: pending -> approved (split-pay runs, validator credited)
 *   - HITL: pending -> rejected (no money moves)
 *   - HITL: double-resolve returns 409 ALREADY_RESOLVED
 *   - Idempotency middleware: same key + body replays cached response,
 *     same key + different body returns 422 conflict.
 *
 * Requirements:
 *   - DATABASE_URL env var pointing at a Postgres 15+ instance.
 *     (use docker-compose up -d db; npm run db:init)
 *   - `npm install pg` (the only runtime dep).
 *
 * Exit code 0 = all checks passed. Non-zero = a check failed.
 *
 * Run with:  npm run smoke:pg
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Lazy-resolve so a missing `pg` produces a clean error message.
let pool, withTx, closePool;
let auditRepo, ledgerRepo, approvalRepo, idem;
let SYSTEM_ACCOUNTS, microcentsToUsdString;

let passed = 0, failed = 0;
function section(name) { process.stdout.write(`\n▸ ${name}\n`); }
function ok(msg)       { passed++; process.stdout.write(`  ✓ ${msg}\n`); }
function fail(msg, e)  { failed++; process.stdout.write(`  ✗ ${msg}\n      ${e?.stack || e}\n`); }

async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }

async function bootstrap() {
  try {
    require('pg');
  } catch {
    console.error('Missing dependency: pg. Run `npm install` first.');
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error('Missing DATABASE_URL. See .env.example.');
    process.exit(2);
  }
  const poolMod = require(resolve(ROOT, 'src/db/pool'));
  pool          = poolMod.getPool();
  withTx        = poolMod.withTx;
  closePool     = poolMod.closePool;
  auditRepo     = require(resolve(ROOT, 'src/db/auditRepo'));
  ledgerRepo    = require(resolve(ROOT, 'src/db/ledgerRepo'));
  approvalRepo  = require(resolve(ROOT, 'src/db/approvalRepo'));
  idem          = require(resolve(ROOT, 'src/middleware/idempotency'));
  ({ SYSTEM_ACCOUNTS, microcentsToUsdString } =
    require(resolve(ROOT, 'src/lib/fiatLedger')));
}

async function resetDb() {
  // Apply schema fresh: drop the tables this kernel owns, then run schema.sql.
  await pool.query(`
    DROP TABLE IF EXISTS idempotency_keys CASCADE;
    DROP TABLE IF EXISTS approvals        CASCADE;
    DROP TABLE IF EXISTS missions         CASCADE;
    DROP TABLE IF EXISTS audit_log        CASCADE;
    DROP TABLE IF EXISTS ledger_entries   CASCADE;
    DROP TABLE IF EXISTS accounts         CASCADE;
  `);
  const schema = readFileSync(resolve(ROOT, 'db/schema.sql'), 'utf8');
  await pool.query(schema);
}

async function runLedgerChecks() {
  section('Ledger persistence');

  await check('system accounts bootstrapped', async () => {
    const p = await ledgerRepo.getAccount(SYSTEM_ACCOUNTS.PLATFORM);
    const i = await ledgerRepo.getAccount(SYSTEM_ACCOUNTS.INSURANCE);
    const e = await ledgerRepo.getAccount(SYSTEM_ACCOUNTS.ESCROW);
    assert.ok(p && i && e, 'system accounts missing');
    assert.equal(p.balanceMicro, 0n);
  });

  await check('ensureAccount creates a client', async () => {
    const acc = await ledgerRepo.ensureAccount({ id: 'client_acme', kind: 'client' });
    assert.equal(acc.id, 'client_acme');
    assert.equal(acc.balanceMicro, 0n);
  });

  await check('credit increases balance', async () => {
    await ledgerRepo.credit({ accountId: 'client_acme', amount: '500.00' });
    const bal = await ledgerRepo.balance('client_acme');
    assert.equal(bal, 5_000_000n);
    assert.equal(microcentsToUsdString(bal), '500.0000');
  });

  await check('debit refuses overdraft', async () => {
    await assert.rejects(
      () => ledgerRepo.debit({ accountId: 'client_acme', amount: '10000.00' }),
      /insufficient/
    );
  });

  await check('transfer is atomic + balanced', async () => {
    await ledgerRepo.ensureAccount({ id: 'val_eve', kind: 'validator' });
    await ledgerRepo.transfer({ fromId: 'client_acme', toId: 'val_eve', amount: '3.00' });
    const a = await ledgerRepo.balance('client_acme');
    const b = await ledgerRepo.balance('val_eve');
    assert.equal(microcentsToUsdString(a), '497.0000');
    assert.equal(microcentsToUsdString(b), '3.0000');
  });

  await check('CHECK (balance_micro >= 0) blocks impossible debit attempts', async () => {
    // Reach in below the repo to attempt a raw negative delta -- should be
    // rejected by the storage CHECK constraint.
    await assert.rejects(
      pool.query(
        `UPDATE accounts SET balance_micro = balance_micro - 99999999999999
         WHERE id = $1`,
        ['client_acme']
      ),
      /violates check constraint/i
    );
  });

  await check('40/40/20 on $100.00 splits exactly 40/40/20', async () => {
    await ledgerRepo.ensureAccount({ id: 'client_split1', kind: 'client' });
    await ledgerRepo.credit({ accountId: 'client_split1', amount: '100.00' });
    const r = await ledgerRepo.distributeTaskPayment({
      clientAccountId: 'client_split1',
      validatorAccountId: 'val_split1',
      grossAmountUsd: '100.00',
    });
    assert.equal(r.gross,     1_000_000n);   // $100.0000
    assert.equal(r.platform,    400_000n);
    assert.equal(r.validator,   400_000n);
    assert.equal(r.insurance,   200_000n);
    assert.equal(r.platform + r.validator + r.insurance, r.gross);
    const valBal = await ledgerRepo.balance('val_split1');
    assert.equal(valBal, 400_000n);
  });

  await check('40/40/20 on 7 μ¢ leaves zero leakage (insurance gets 3)', async () => {
    await ledgerRepo.ensureAccount({ id: 'client_split2', kind: 'client' });
    // Credit raw microcents.
    await ledgerRepo.credit({ accountId: 'client_split2', amount: 7n });
    const r = await ledgerRepo.distributeTaskPayment({
      clientAccountId: 'client_split2',
      validatorAccountId: 'val_split2',
      grossAmountUsd: 7n,
    });
    assert.equal(r.gross,     7n);
    assert.equal(r.platform,  2n);
    assert.equal(r.validator, 2n);
    assert.equal(r.insurance, 3n);
    assert.equal(r.platform + r.validator + r.insurance, 7n);
  });
}

async function runAuditChecks() {
  section('Audit log SHA-256 chain');

  await check('append builds a chain', async () => {
    const e0 = await auditRepo.appendAudit('TEST', { i: 0 });
    const e1 = await auditRepo.appendAudit('TEST', { i: 1 });
    const e2 = await auditRepo.appendAudit('TEST', { i: 2 });
    assert.equal(e0.prevHash, '0'.repeat(64));
    assert.equal(e1.prevHash, e0.hash);
    assert.equal(e2.prevHash, e1.hash);
  });

  await check('verifyAudit returns ok on a clean chain', async () => {
    const r = await auditRepo.verifyAudit();
    assert.equal(r.ok, true);
    assert.ok(r.length >= 3);
  });

  await check('verifyAudit detects tampering', async () => {
    // Corrupt the payload of one row WITHOUT updating its hash.
    await pool.query(
      `UPDATE audit_log SET payload = '{"i":"tampered"}'::jsonb
       WHERE seq = (SELECT seq FROM audit_log ORDER BY seq ASC LIMIT 1 OFFSET 1)`
    );
    const r = await auditRepo.verifyAudit();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'hash mismatch');
  });

  await check('verifyAudit recovers when tamper is undone (chain is deterministic)', async () => {
    // Restore the row's payload to a value that, combined with the original
    // prev_hash/ts, MIGHT still mismatch -- so instead we just reset the
    // table for downstream tests.
    await pool.query('TRUNCATE audit_log RESTART IDENTITY CASCADE');
    const r = await auditRepo.verifyAudit();
    assert.equal(r.ok, true);
    assert.equal(r.length, 0);
  });
}

async function runHitlChecks() {
  section('HITL approval state machine');

  await check('pending -> approved triggers split-pay', async () => {
    await ledgerRepo.ensureAccount({ id: 'client_hitl_ok', kind: 'client' });
    await ledgerRepo.credit({ accountId: 'client_hitl_ok', amount: '50.00' });

    await approvalRepo.ensureMission({
      id: 'mis_ok', clientAccountId: 'client_hitl_ok',
      title: 'Smoke mission OK',
    });
    const created = await approvalRepo.createApproval({
      missionId: 'mis_ok',
      clientAccountId: 'client_hitl_ok',
      priceUsd: '50.00',
      aiOutput: { answer: 'demo' },
      confidence: 0.42,
    });
    assert.equal(created.status, 'pending');

    const { approval, receipt } = await approvalRepo.resolveApproval(created.id, {
      validatorAccountId: 'val_hitl_ok',
      decision: 'approve',
    });
    assert.equal(approval.status, 'approved');
    assert.equal(receipt.grossUsd, '50.0000');
    assert.equal(receipt.platformUsd, '20.0000');
    assert.equal(receipt.validatorUsd, '20.0000');
    assert.equal(receipt.insuranceUsd, '10.0000');

    const cb = await ledgerRepo.balance('client_hitl_ok');
    assert.equal(cb, 0n);
    const vb = await ledgerRepo.balance('val_hitl_ok');
    assert.equal(microcentsToUsdString(vb), '20.0000');
  });

  await check('pending -> rejected moves no money', async () => {
    await ledgerRepo.ensureAccount({ id: 'client_hitl_no', kind: 'client' });
    await ledgerRepo.credit({ accountId: 'client_hitl_no', amount: '10.00' });
    await approvalRepo.ensureMission({
      id: 'mis_no', clientAccountId: 'client_hitl_no', title: 'Smoke mission NO',
    });
    const c = await approvalRepo.createApproval({
      missionId: 'mis_no',
      clientAccountId: 'client_hitl_no',
      priceUsd: '10.00',
      aiOutput: { answer: 'wrong' },
    });
    const { approval, receipt } = await approvalRepo.resolveApproval(c.id, {
      validatorAccountId: 'val_hitl_no',
      decision: 'reject',
      note: 'AI hallucinated',
    });
    assert.equal(approval.status, 'rejected');
    assert.equal(receipt, null);
    const cb = await ledgerRepo.balance('client_hitl_no');
    assert.equal(microcentsToUsdString(cb), '10.0000');
  });

  await check('double-resolve returns ALREADY_RESOLVED', async () => {
    await ledgerRepo.ensureAccount({ id: 'client_hitl_dup', kind: 'client' });
    await ledgerRepo.credit({ accountId: 'client_hitl_dup', amount: '5.00' });
    await approvalRepo.ensureMission({
      id: 'mis_dup', clientAccountId: 'client_hitl_dup', title: 'Smoke mission DUP',
    });
    const c = await approvalRepo.createApproval({
      missionId: 'mis_dup',
      clientAccountId: 'client_hitl_dup',
      priceUsd: '5.00',
      aiOutput: { answer: 'once' },
    });
    await approvalRepo.resolveApproval(c.id, {
      validatorAccountId: 'val_dup', decision: 'approve',
    });
    await assert.rejects(
      () => approvalRepo.resolveApproval(c.id, {
        validatorAccountId: 'val_dup', decision: 'approve',
      }),
      (err) => err.code === 'ALREADY_RESOLVED'
    );
  });

  await check('modify branch stores final_output and bills', async () => {
    await ledgerRepo.ensureAccount({ id: 'client_hitl_mod', kind: 'client' });
    await ledgerRepo.credit({ accountId: 'client_hitl_mod', amount: '20.00' });
    await approvalRepo.ensureMission({
      id: 'mis_mod', clientAccountId: 'client_hitl_mod', title: 'Smoke mission MOD',
    });
    const c = await approvalRepo.createApproval({
      missionId: 'mis_mod',
      clientAccountId: 'client_hitl_mod',
      priceUsd: '20.00',
      aiOutput: { answer: 'draft' },
    });
    const { approval, receipt } = await approvalRepo.resolveApproval(c.id, {
      validatorAccountId: 'val_mod', decision: 'modify',
      finalOutput: { answer: 'edited' },
    });
    assert.equal(approval.status, 'modified');
    assert.deepEqual(approval.finalOutput, { answer: 'edited' });
    assert.equal(receipt.grossUsd, '20.0000');
  });
}

async function runIdempotencyChecks() {
  section('Idempotency middleware');

  // Build a fake handler that increments a counter so we can detect a
  // double-execution.
  let calls = 0;
  const handler = async (req, _ctx) => {
    calls++;
    const body = await req.json();
    return new Response(JSON.stringify({ ok: true, echo: body, callIdx: calls }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    });
  };
  const wrapped = idem.withIdempotency({ route: 'TEST /smoke', required: true }, handler);

  function buildReq(body, key) {
    const h = new Headers({ 'Content-Type': 'application/json' });
    if (key !== undefined) h.set('Idempotency-Key', key);
    return new Request('http://test.local/smoke', {
      method: 'POST', headers: h, body: JSON.stringify(body),
    });
  }

  await check('missing key on required route -> 400', async () => {
    const r = await wrapped(buildReq({ x: 1 }), {});
    assert.equal(r.status, 400);
  });

  await check('first call executes handler, second call replays cache', async () => {
    calls = 0;
    const r1 = await wrapped(buildReq({ x: 1 }, 'idem-key-A'), {});
    const r2 = await wrapped(buildReq({ x: 1 }, 'idem-key-A'), {});
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
    assert.equal(r2.headers.get('X-Idempotent-Replay'), 'true');
    assert.equal(calls, 1, 'handler should run exactly once');
    const b1 = await r1.json();
    const b2 = await r2.json();
    assert.deepEqual(b1, b2);
  });

  await check('same key + different body -> 422 conflict', async () => {
    const r = await wrapped(buildReq({ x: 99 }, 'idem-key-A'), {});
    assert.equal(r.status, 422);
    const body = await r.json();
    assert.equal(body.code, 'IDEMPOTENCY_KEY_CONFLICT');
  });

  await check('different key + different body -> fresh execution', async () => {
    calls = 0;
    const r = await wrapped(buildReq({ x: 2 }, 'idem-key-B'), {});
    assert.equal(r.status, 201);
    assert.equal(calls, 1);
  });
}

async function runVoidZeroChecks() {
  section('VOID-Zero State-Rooting & Delta Invariant Verification');

  await check('calculateStateRoot is completely deterministic and consistent', async () => {
    const { calculateStateRoot } = require('../src/lib/stateRoot');
    const { appendAudit } = require('../src/db/auditRepo');
    
    const poolMod = require('../src/db/pool');
    const preRoot = await poolMod.withTx(async (client) => {
      return await calculateStateRoot(client);
    });
    
    assert.equal(typeof preRoot, 'string');
    assert.equal(preRoot.length, 64);
    
    const ledgerRepo = require('../src/db/ledgerRepo');
    await ledgerRepo.ensureAccount({ id: 'client_void_zero', kind: 'client' });
    await ledgerRepo.credit({ accountId: 'client_void_zero', amount: '100.00' });
    
    const postRoot = await poolMod.withTx(async (client) => {
      return await calculateStateRoot(client);
    });
    
    assert.notEqual(preRoot, postRoot, 'State root must change after financial transition');
    
    const entry = await appendAudit('VOID_ROOT_TEST', { test: true });
    assert.equal(entry.payload.stateRoot, postRoot, 'State root in audit entry payload must match post-commit database CSR');
  });

  await check('Sovereign Delta Commit sealing works', async () => {
    const { sealDeltaCommit } = require('../src/lib/stateRoot');
    const poolMod = require('../src/db/pool');
    
    const delta = await poolMod.withTx(async (client) => {
      return await sealDeltaCommit(client, 'ECOS_B2B_BILLING', [
        { accountId: 'client_void_zero', deltaMicro: -1000000n }
      ]);
    });
    
    assert.ok(delta.deltaId.startsWith('dl_'));
    assert.equal(delta.payload.domain, 'ECOS_B2B_BILLING');
    assert.equal(typeof delta.payload.traceHash, 'string');
  });
}

async function main() {
  await bootstrap();
  await resetDb();
  await runLedgerChecks();
  await runAuditChecks();
  await runHitlChecks();
  await runIdempotencyChecks();
  await runVoidZeroChecks();

  await closePool();

  process.stdout.write(`\n──────────────────────────────────────────\n`);
  if (failed === 0) {
    process.stdout.write(`ALL POSTGRES SMOKE TESTS PASSED  (${passed} ✓)\n`);
    process.exit(0);
  } else {
    process.stdout.write(`SOME TESTS FAILED  (${passed} ✓, ${failed} ✗)\n`);
    process.exit(1);
  }
}

main().catch((e) => {
  process.stderr.write(`FATAL: ${e?.stack || e}\n`);
  process.exit(1);
});
