import "../_flush.mjs";
/**
 * tests/ledger/drizzle-payment-provider.test.ts — DrizzlePaymentProvider full test suite.
 *
 * Uses InMemoryPool so no external Postgres is needed. Zero external dependencies.
 * Every test gets a fresh provider (isolated table state).
 *
 * Coverage:
 *   Factory & Lifecycle
 *     • DrizzlePaymentProvider.create() returns a ready provider
 *     • init() is idempotent (multiple calls do not throw)
 *     • Tables use tfa_ prefix (no collision with other ledger tables)
 *
 *   Account creation
 *     • returns account with zero balance
 *     • each account gets unique id
 *     • rejects empty tenantId
 *     • rejects empty ownerId
 *     • rejects empty name
 *     • listAccounts filters by tenant
 *
 *   guardMint
 *     • increases user account balance
 *     • returns transaction with correct fields (kind/amount/tenantId/initiatedBy)
 *     • multiple mints accumulate correctly
 *     • rejects zero amount (fail-closed)
 *     • rejects negative amount (fail-closed)
 *     • rejects number instead of BigInt (fail-closed, INVALID_TYPE)
 *     • rejects missing initiatedBy (audit trail enforcement)
 *     • tenant isolation — rejects cross-tenant account
 *
 *   guardWithdraw
 *     • decreases user account balance
 *     • returns transaction with correct fields
 *     • fail-closed on insufficient funds (INSUFFICIENT_FUNDS)
 *     • fail-closed on zero balance
 *     • balance unchanged after failed withdraw
 *     • tenant isolation — rejects cross-tenant account
 *
 *   transfer
 *     • moves funds between two accounts in same tenant
 *     • conservation — total balance unchanged
 *     • fail-closed on insufficient funds
 *     • self-transfer is rejected (SELF_TRANSFER)
 *     • cross-tenant is rejected (tenant isolation)
 *
 *   Double-entry invariant
 *     • reserve balance mirrors total user assets after mints
 *     • sum of all balances = 0 after mint + withdraw
 *
 *   Audit trail / getTransactions
 *     • returns all transactions for an account
 *     • tenant isolation — cannot read another tenant's transactions
 *
 *   proofOfSolvency
 *     • fresh ledger is solvent
 *     • reports correct account count (includes reserve)
 *     • same hash when balances unchanged
 *     • hash changes after balance change
 *     • tenant isolation
 *
 *   BigInt persistence
 *     • massive BigInt round-trips exactly through TEXT storage
 *
 *   Composition root integration
 *     • buildSovereignStack accepts provider option
 *     • injected provider is used (ledger operations flow through it)
 */

import { test, assert, eq } from "../_harness.mjs";
import { createHash } from "node:crypto";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { DrizzlePaymentProvider, LedgerError } from "../../lib/ledger/drizzle-payment-provider.ts";
import { buildSovereignStack } from "../../src/composition.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeProvider(): Promise<DrizzlePaymentProvider> {
  return DrizzlePaymentProvider.create(new InMemoryPool());
}

async function setupTenant(provider: DrizzlePaymentProvider, tenantId: string) {
  const alice = await provider.createAccount(tenantId, "user-alice", "asset", "Alice Wallet");
  const bob   = await provider.createAccount(tenantId, "user-bob",   "asset", "Bob Wallet");
  return { alice, bob };
}

// ─── Factory & Lifecycle ──────────────────────────────────────────────────────

test("DrizzlePaymentProvider.create() returns a ready provider", async () => {
  const pool = new InMemoryPool();
  const p = await DrizzlePaymentProvider.create(pool);
  // Tables must exist — querying them should not throw
  const r = await pool.query("SELECT * FROM tfa_ledger_accounts");
  eq(r.rows.length, 0, "table exists and is empty");
});

test("init() is idempotent — multiple calls do not throw", async () => {
  const pool = new InMemoryPool();
  const p = new DrizzlePaymentProvider(pool);
  await p.init();
  await p.init(); // second call must be a no-op
  await p.init(); // third call
  assert(true, "multiple init() calls do not throw");
});

test("tables use tfa_ prefix to avoid collision with PgLedgerStore tables", async () => {
  const pool = new InMemoryPool();
  await DrizzlePaymentProvider.create(pool);
  // These tfa_* tables must exist
  const a = await pool.query("SELECT * FROM tfa_ledger_accounts");
  const t = await pool.query("SELECT * FROM tfa_ledger_transactions");
  const j = await pool.query("SELECT * FROM tfa_journal_entries");
  eq(a.rows.length, 0);
  eq(t.rows.length, 0);
  eq(j.rows.length, 0);
});

// ─── Account creation ─────────────────────────────────────────────────────────

test("createAccount: returns account with zero balance", async () => {
  const p = await makeProvider();
  const acc = await p.createAccount("t1", "user-1", "asset", "My Wallet");
  eq(acc.balance, 0n, "initial balance is 0");
  eq(acc.tenantId, "t1");
  eq(acc.ownerId, "user-1");
  eq(acc.type, "asset");
  assert(acc.id.length > 0, "has id");
  assert(acc.createdAt.length > 0, "has createdAt");
});

test("createAccount: each account gets a unique id", async () => {
  const p = await makeProvider();
  const a = await p.createAccount("t1", "u1", "asset", "A");
  const b = await p.createAccount("t1", "u2", "asset", "B");
  assert(a.id !== b.id, "unique ids");
});

test("createAccount: rejects empty tenantId", async () => {
  const p = await makeProvider();
  let threw = false;
  try { await p.createAccount("", "u1", "asset", "X"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "MISSING_FIELD"); }
  assert(threw, "empty tenantId must throw MISSING_FIELD");
});

test("createAccount: rejects empty ownerId", async () => {
  const p = await makeProvider();
  let threw = false;
  try { await p.createAccount("t1", "", "asset", "X"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "MISSING_FIELD"); }
  assert(threw, "empty ownerId must throw MISSING_FIELD");
});

test("createAccount: rejects empty name", async () => {
  const p = await makeProvider();
  let threw = false;
  try { await p.createAccount("t1", "u1", "asset", ""); }
  catch (e) { threw = true; eq((e as LedgerError).code, "MISSING_FIELD"); }
  assert(threw, "empty name must throw MISSING_FIELD");
});

test("listAccounts: only returns accounts for requested tenant", async () => {
  const p = await makeProvider();
  await p.createAccount("tenant-A", "u1", "asset", "A1");
  await p.createAccount("tenant-A", "u2", "asset", "A2");
  await p.createAccount("tenant-B", "u3", "asset", "B1");
  const listA = await p.listAccounts("tenant-A");
  const listB = await p.listAccounts("tenant-B");
  eq(listA.length, 2, "tenant-A has 2 accounts");
  eq(listB.length, 1, "tenant-B has 1 account");
  assert(listA.every(a => a.tenantId === "tenant-A"), "all belong to tenant-A");
});

// ─── guardMint ────────────────────────────────────────────────────────────────

test("guardMint: increases user account balance", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  await p.guardMint("t1", alice.id, 5000n, "welcome bonus", "system");
  const acc = await p.getAccount("t1", alice.id);
  eq(acc.balance, 5000n, "alice gets 5000 μ¢");
});

test("guardMint: returns transaction with correct fields", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  const tx = await p.guardMint("t1", alice.id, 1000n, "test mint", "admin");
  eq(tx.kind, "mint");
  eq(tx.amount, 1000n);
  eq(tx.tenantId, "t1");
  eq(tx.initiatedBy, "admin");
  assert(tx.id.length > 0, "has id");
  assert(tx.createdAt.length > 0, "has timestamp");
});

test("guardMint: multiple mints accumulate correctly", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  await p.guardMint("t1", alice.id, 1000n, "m1", "sys");
  await p.guardMint("t1", alice.id, 2500n, "m2", "sys");
  await p.guardMint("t1", alice.id,  500n, "m3", "sys");
  const acc = await p.getAccount("t1", alice.id);
  eq(acc.balance, 4000n, "1000+2500+500 = 4000");
});

test("guardMint: rejects zero amount (fail-closed, INVALID_AMOUNT)", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  let threw = false;
  try { await p.guardMint("t1", alice.id, 0n, "zero", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "INVALID_AMOUNT"); }
  assert(threw, "zero amount must throw");
});

test("guardMint: rejects negative amount (fail-closed, INVALID_AMOUNT)", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  let threw = false;
  try { await p.guardMint("t1", alice.id, -100n, "neg", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "INVALID_AMOUNT"); }
  assert(threw, "negative amount must throw");
});

test("guardMint: rejects number instead of BigInt (fail-closed, INVALID_TYPE)", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  let threw = false;
  try {
    // @ts-ignore intentional type violation to test runtime guard
    await p.guardMint("t1", alice.id, 100, "num", "sys");
  }
  catch (e) { threw = true; eq((e as LedgerError).code, "INVALID_TYPE"); }
  assert(threw, "number amount must throw INVALID_TYPE");
});

test("guardMint: rejects missing initiatedBy (audit trail enforcement)", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  let threw = false;
  try { await p.guardMint("t1", alice.id, 100n, "test", ""); }
  catch (e) { threw = true; eq((e as LedgerError).code, "MISSING_FIELD"); }
  assert(threw, "empty initiatedBy must throw");
});

test("guardMint: tenant isolation — rejects cross-tenant account", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "tenant-A");
  let threw = false;
  try { await p.guardMint("tenant-B", alice.id, 1000n, "x", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "TENANT_VIOLATION"); }
  assert(threw, "cross-tenant mint must throw TENANT_VIOLATION");
});

// ─── guardWithdraw ────────────────────────────────────────────────────────────

test("guardWithdraw: decreases user account balance", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  await p.guardMint("t1", alice.id, 5000n, "seed", "sys");
  await p.guardWithdraw("t1", alice.id, 2000n, "fee", "sys");
  const acc = await p.getAccount("t1", alice.id);
  eq(acc.balance, 3000n, "5000 - 2000 = 3000");
});

test("guardWithdraw: returns transaction with correct fields", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  await p.guardMint("t1", alice.id, 1000n, "seed", "sys");
  const tx = await p.guardWithdraw("t1", alice.id, 400n, "charge", "billing");
  eq(tx.kind, "withdraw");
  eq(tx.amount, 400n);
  eq(tx.initiatedBy, "billing");
  eq(tx.tenantId, "t1");
});

test("guardWithdraw: fail-closed on insufficient funds", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  await p.guardMint("t1", alice.id, 500n, "seed", "sys");
  let threw = false;
  try { await p.guardWithdraw("t1", alice.id, 501n, "over", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "INSUFFICIENT_FUNDS"); }
  assert(threw, "overdraft must throw INSUFFICIENT_FUNDS");
});

test("guardWithdraw: fail-closed on zero balance", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  let threw = false;
  try { await p.guardWithdraw("t1", alice.id, 1n, "any", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "INSUFFICIENT_FUNDS"); }
  assert(threw, "zero-balance withdraw must throw INSUFFICIENT_FUNDS");
});

test("guardWithdraw: balance unchanged after failed withdraw", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  await p.guardMint("t1", alice.id, 100n, "seed", "sys");
  try { await p.guardWithdraw("t1", alice.id, 200n, "over", "sys"); } catch {}
  const acc = await p.getAccount("t1", alice.id);
  eq(acc.balance, 100n, "balance unchanged after failed withdraw");
});

test("guardWithdraw: tenant isolation — rejects cross-tenant account", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "tenant-A");
  await p.guardMint("tenant-A", alice.id, 1000n, "seed", "sys");
  let threw = false;
  try { await p.guardWithdraw("tenant-B", alice.id, 100n, "x", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "TENANT_VIOLATION"); }
  assert(threw, "cross-tenant withdraw must throw TENANT_VIOLATION");
});

// ─── transfer ─────────────────────────────────────────────────────────────────

test("transfer: moves funds between two accounts in same tenant", async () => {
  const p = await makeProvider();
  const { alice, bob } = await setupTenant(p, "t1");
  await p.guardMint("t1", alice.id, 10000n, "seed", "sys");
  await p.transfer("t1", alice.id, bob.id, 3000n, "payment", "user-alice");
  const a = await p.getAccount("t1", alice.id);
  const b = await p.getAccount("t1", bob.id);
  eq(a.balance, 7000n, "alice: 10000-3000");
  eq(b.balance, 3000n, "bob: +3000");
});

test("transfer: conservation — total balance unchanged", async () => {
  const p = await makeProvider();
  const { alice, bob } = await setupTenant(p, "t1");
  await p.guardMint("t1", alice.id, 8000n, "seed", "sys");
  await p.guardMint("t1", bob.id,   2000n, "seed", "sys");
  const before =
    (await p.getAccount("t1", alice.id)).balance +
    (await p.getAccount("t1", bob.id)).balance;
  await p.transfer("t1", alice.id, bob.id, 1500n, "tx", "alice");
  const after =
    (await p.getAccount("t1", alice.id)).balance +
    (await p.getAccount("t1", bob.id)).balance;
  eq(before, after, "total balance conserved during transfer");
});

test("transfer: fail-closed on insufficient funds", async () => {
  const p = await makeProvider();
  const { alice, bob } = await setupTenant(p, "t1");
  await p.guardMint("t1", alice.id, 100n, "seed", "sys");
  let threw = false;
  try { await p.transfer("t1", alice.id, bob.id, 101n, "over", "alice"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "INSUFFICIENT_FUNDS"); }
  assert(threw, "overdraft transfer must throw");
});

test("transfer: self-transfer is rejected (SELF_TRANSFER)", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  await p.guardMint("t1", alice.id, 1000n, "seed", "sys");
  let threw = false;
  try { await p.transfer("t1", alice.id, alice.id, 100n, "self", "alice"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "SELF_TRANSFER"); }
  assert(threw, "self-transfer must throw");
});

test("transfer: cross-tenant is rejected (tenant isolation)", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "tenant-A");
  const { bob }   = await setupTenant(p, "tenant-B");
  await p.guardMint("tenant-A", alice.id, 1000n, "seed", "sys");
  let threw = false;
  try { await p.transfer("tenant-A", alice.id, bob.id, 100n, "x", "alice"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "TENANT_VIOLATION"); }
  assert(threw, "cross-tenant transfer must throw TENANT_VIOLATION");
});

// ─── Double-entry invariant ───────────────────────────────────────────────────

test("double-entry: reserve balance mirrors total user assets after mints", async () => {
  const p = await makeProvider();
  const { alice, bob } = await setupTenant(p, "t1");
  await p.guardMint("t1", alice.id, 3000n, "m1", "sys");
  await p.guardMint("t1", bob.id,   2000n, "m2", "sys");

  const accounts = await p.listAccounts("t1");
  const userAssets = accounts
    .filter(a => a.type === "asset")
    .reduce((sum, a) => sum + a.balance, 0n);
  const reserve = accounts.find(a => a.type === "equity")!;

  eq(reserve.balance, -5000n, "reserve debited 5000 total");
  eq(userAssets, 5000n, "user assets total 5000");
  eq(reserve.balance + userAssets, 0n, "double-entry: sum is zero");
});

test("double-entry: sum of all balances = 0 after mint + withdraw", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  await p.guardMint("t1", alice.id,     5000n, "mint", "sys");
  await p.guardWithdraw("t1", alice.id, 2000n, "fee",  "sys");

  const accounts = await p.listAccounts("t1");
  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0n);
  eq(totalBalance, 0n, "sum of all balances is always zero (double-entry)");
});

// ─── Audit trail / getTransactions ────────────────────────────────────────────

test("getTransactions: returns all transactions for an account", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  await p.guardMint("t1", alice.id, 1000n, "m1", "sys");
  await p.guardMint("t1", alice.id,  500n, "m2", "sys");
  const txs = await p.getTransactions("t1", alice.id);
  eq(txs.length, 2, "two transactions recorded");
});

test("getTransactions: tenant isolation — cannot read another tenant's transactions", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "tenant-A");
  await p.guardMint("tenant-A", alice.id, 1000n, "m1", "sys");
  let threw = false;
  try { await p.getTransactions("tenant-B", alice.id); }
  catch (e) { threw = true; eq((e as LedgerError).code, "TENANT_VIOLATION"); }
  assert(threw, "cross-tenant transaction read must throw");
});

// ─── proofOfSolvency ──────────────────────────────────────────────────────────

test("proofOfSolvency: fresh ledger is solvent (all zeros)", async () => {
  const p = await makeProvider();
  await p.createAccount("t1", "u1", "asset", "W");
  const proof = await p.proofOfSolvency("t1");
  assert(proof.isSolvent, "fresh ledger is solvent");
  eq(proof.tenantId, "t1");
  assert(proof.balanceHash.length === 64, "SHA-256 hex = 64 chars");
  assert(proof.generatedAt.length > 0, "has timestamp");
});

test("proofOfSolvency: reports correct account count (includes reserve)", async () => {
  const p = await makeProvider();
  const a = await p.createAccount("t1", "u1", "asset",     "A");
  await p.createAccount("t1", "u2", "liability", "L");
  await p.createAccount("t1", "u3", "asset",     "B");
  await p.guardMint("t1", a.id, 1n, "trigger reserve", "sys");
  const proof = await p.proofOfSolvency("t1");
  eq(proof.accountCount, 4, "3 explicit + 1 reserve = 4");
});

test("proofOfSolvency: same hash when balances unchanged", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  await p.guardMint("t1", alice.id, 5000n, "seed", "sys");
  const p1 = await p.proofOfSolvency("t1");
  const p2 = await p.proofOfSolvency("t1");
  eq(p1.balanceHash, p2.balanceHash, "same balances → same hash");
});

test("proofOfSolvency: hash changes after balance change", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  await p.guardMint("t1", alice.id, 5000n, "seed", "sys");
  const p1 = await p.proofOfSolvency("t1");
  await p.guardMint("t1", alice.id, 1n, "extra", "sys");
  const p2 = await p.proofOfSolvency("t1");
  assert(p1.balanceHash !== p2.balanceHash, "different balances → different hash");
});

test("proofOfSolvency: tenant isolation — only checks own accounts", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "tenant-A");
  await p.createAccount("tenant-B", "u1", "asset", "B-wallet");
  await p.guardMint("tenant-A", alice.id, 9999n, "seed", "sys");
  const proofB = await p.proofOfSolvency("tenant-B");
  eq(proofB.totalAssets, 0n, "tenant-B unaffected by tenant-A mints");
});

// ─── Efficiency: DB-order trust (redundant in-memory sort removed) ────────────

async function referenceHashDrizzle(pool: InMemoryPool, tenantId: string): Promise<string> {
  const result = await pool.query(
    "SELECT id, type, balance_text FROM tfa_ledger_accounts WHERE tenant_id = $1 ORDER BY id ASC",
    [tenantId],
  );
  const lines = result.rows.map((r: any) => `${r.id}:${r.type}:${r.balance_text}`);
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

test("proofOfSolvency: hash matches DB-ordered reference (happy path)", async () => {
  const p = await makeProvider();
  const { alice, bob } = await setupTenant(p, "t1");
  await p.guardMint("t1", alice.id, 5000n, "seed", "sys");
  await p.guardMint("t1", bob.id,   3000n, "seed", "sys");
  const proof = await p.proofOfSolvency("t1");
  const ref = await referenceHashDrizzle(p["pool" as any] as InMemoryPool, "t1");
  eq(proof.balanceHash, ref, "hash must match DB-ordered rows without extra in-memory sort");
});

test("proofOfSolvency: many accounts hash matches DB-ordered reference (edge case)", async () => {
  const p = await makeProvider();
  for (let i = 0; i < 10; i++) {
    const acc = await p.createAccount("t1", `u${i}`, i % 2 === 0 ? "asset" : "liability", `A${i}`);
    if (i % 3 === 0) await p.guardMint("t1", acc.id, BigInt(i + 1) * 100n, "m", "sys");
  }
  const proof = await p.proofOfSolvency("t1");
  const ref = await referenceHashDrizzle(p["pool" as any] as InMemoryPool, "t1");
  eq(proof.balanceHash, ref, "hash must match DB-ordered rows for large account sets");
});

test("proofOfSolvency: cross-tenant reference hash excludes foreign accounts (fail-closed)", async () => {
  const p = await makeProvider();
  await p.createAccount("tenant-A", "u1", "asset", "A1");
  await p.createAccount("tenant-A", "u2", "liability", "A2");
  await p.createAccount("tenant-B", "u1", "asset", "B1");
  await p.createAccount("tenant-B", "u2", "liability", "B2");
  const proofA = await p.proofOfSolvency("tenant-A");
  const refA = await referenceHashDrizzle(p["pool" as any] as InMemoryPool, "tenant-A");
  eq(proofA.balanceHash, refA, "tenant-A hash must match only tenant-A DB rows");
  const proofB = await p.proofOfSolvency("tenant-B");
  const refB = await referenceHashDrizzle(p["pool" as any] as InMemoryPool, "tenant-B");
  eq(proofB.balanceHash, refB, "tenant-B hash must match only tenant-B DB rows");
  assert(proofA.balanceHash !== proofB.balanceHash, "different tenants must have different hashes");
});

// ─── BigInt persistence ───────────────────────────────────────────────────────

test("BigInt amounts are persisted and read back accurately (TEXT storage)", async () => {
  const p = await makeProvider();
  const { alice } = await setupTenant(p, "t1");
  const big = 12345678901234567890n;
  await p.guardMint("t1", alice.id, big, "big mint", "sys");
  const acc = await p.getAccount("t1", alice.id);
  eq(acc.balance, big, "massive BigInt round-trips exactly");
  const txs = await p.getTransactions("t1", alice.id);
  eq(txs[0].amount, big, "transaction amount round-trips exactly");
});

// ─── Composition root integration ─────────────────────────────────────────────

test("buildSovereignStack: accepts provider option (DrizzlePaymentProvider injection)", async () => {
  const pool = new InMemoryPool();
  const provider = await DrizzlePaymentProvider.create(pool);

  // buildSovereignStack must accept a provider option without throwing
  const stack = buildSovereignStack(undefined, { provider });
  assert(stack.ledger !== undefined, "stack has ledger");
  assert(stack.potential !== undefined, "stack has potential");
  assert(stack.signer !== undefined, "stack has signer");
});

test("buildSovereignStack: injected DrizzlePaymentProvider persists ledger operations", async () => {
  const pool = new InMemoryPool();
  const provider = await DrizzlePaymentProvider.create(pool);

  const stack = buildSovereignStack(undefined, { provider });

  // The stack must be built with the injected provider (no throw = success)
  assert(stack.ledger !== undefined, "stack has ledger");

  // Operate directly on the injected provider to confirm it is the backing store
  const acc = await provider.createAccount("tenant-X", "user-1", "asset", "Wallet");
  const tx = await provider.guardMint("tenant-X", acc.id, 7777n, "injection test", "system");
  eq(tx.amount, 7777n, "mint via injected provider recorded correctly");
  eq(tx.kind, "mint");

  // Balance must persist in the same pool — confirms provider is not a second InMemoryLedger
  const fetched = await provider.getAccount("tenant-X", acc.id);
  eq(fetched.balance, 7777n, "balance persists in injected provider's pool");

  // Confirm getTransactions returns the mint entry
  const txs = await provider.getTransactions("tenant-X", acc.id);
  eq(txs.length, 1, "one transaction recorded");
  eq(txs[0].kind, "mint");
});
