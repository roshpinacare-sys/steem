import "../_flush.mjs";
/**
 * tests/ledger/pg-ledger.test.ts — PgLedgerStore full test suite.
 *
 * Uses InMemoryPool so no external Postgres is needed.
 * Every test gets a fresh pool (isolated table state).
 *
 * Coverage:
 *   Lifecycle
 *     • init() creates tables
 *     • init() is idempotent
 *
 *   Account creation
 *     • returns account with zero balance
 *     • each account gets unique id
 *     • rejects empty tenantId
 *     • listAccounts filters by tenant
 *
 *   guardMint
 *     • increases user account balance
 *     • returns transaction with correct fields
 *     • multiple mints accumulate correctly
 *     • rejects zero/negative/number amounts (fail-closed)
 *     • tenant isolation — rejects cross-tenant account
 *     • rejects missing initiatedBy
 *
 *   guardWithdraw
 *     • decreases user account balance
 *     • returns transaction with correct fields
 *     • fail-closed on insufficient funds
 *     • fail-closed on zero balance
 *     • balance unchanged after failed withdraw
 *     • tenant isolation — rejects cross-tenant account
 *
 *   transfer
 *     • moves funds between two accounts in same tenant
 *     • conservation — total balance unchanged
 *     • fail-closed on insufficient funds
 *     • self-transfer is rejected
 *     • cross-tenant is rejected
 *
 *   Double-entry invariant
 *     • reserve balance mirrors total user assets after mints
 *     • balanced after mint then withdraw
 *
 *   Audit trail / getTransactions
 *     • returns all transactions for an account
 *     • tenant isolation
 *
 *   proofOfSolvency
 *     • fresh ledger is solvent
 *     • reports correct account count
 *     • two proofs have same hash when balances unchanged
 *     • hash changes after balance change
 *     • tenant isolation
 */

import { test, assert, eq } from "../_harness.mjs";
import { createHash } from "node:crypto";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { PgLedgerStore, LedgerError } from "../../lib/ledger/pg-ledger.ts";

// ─── Helper: fresh store per test ────────────────────────────────────────────

async function makeStore(): Promise<PgLedgerStore> {
  const pool = new InMemoryPool();
  const store = new PgLedgerStore(pool);
  await store.init();
  return store;
}

async function setupTenant(store: PgLedgerStore, tenantId: string) {
  const alice = await store.createAccount(tenantId, "user-alice", "asset", "Alice Wallet");
  const bob = await store.createAccount(tenantId, "user-bob", "asset", "Bob Wallet");
  return { alice, bob };
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────────

test("init() creates the ledger tables", async () => {
  const pool = new InMemoryPool();
  const store = new PgLedgerStore(pool);
  await store.init();
  const acc = await pool.query("SELECT * FROM ledger_accounts");
  eq(acc.rows.length, 0);
  const tx = await pool.query("SELECT * FROM ledger_transactions");
  eq(tx.rows.length, 0);
  const je = await pool.query("SELECT * FROM journal_entries");
  eq(je.rows.length, 0);
});

test("init() is idempotent (second call does not throw)", async () => {
  const pool = new InMemoryPool();
  const store = new PgLedgerStore(pool);
  await store.init();
  await store.init();
  assert(true, "second init did not throw");
});

// ─── Account creation ─────────────────────────────────────────────────────────

test("createAccount: returns account with zero balance", async () => {
  const store = await makeStore();
  const acc = await store.createAccount("t1", "user-1", "asset", "My Wallet");
  eq(acc.balance, 0n, "initial balance");
  eq(acc.tenantId, "t1");
  eq(acc.ownerId, "user-1");
  eq(acc.type, "asset");
});

test("createAccount: each account gets unique id", async () => {
  const store = await makeStore();
  const a = await store.createAccount("t1", "u1", "asset", "A");
  const b = await store.createAccount("t1", "u2", "asset", "B");
  assert(a.id !== b.id, "unique ids");
});

test("createAccount: rejects empty tenantId", async () => {
  const store = await makeStore();
  let threw = false;
  try { await store.createAccount("", "u1", "asset", "X"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "MISSING_FIELD"); }
  assert(threw, "should throw on empty tenantId");
});

test("listAccounts: only returns accounts for requested tenant", async () => {
  const store = await makeStore();
  await store.createAccount("tenant-A", "u1", "asset", "A1");
  await store.createAccount("tenant-A", "u2", "asset", "A2");
  await store.createAccount("tenant-B", "u3", "asset", "B1");
  const listA = await store.listAccounts("tenant-A");
  const listB = await store.listAccounts("tenant-B");
  eq(listA.length, 2, "tenant-A has 2 accounts");
  eq(listB.length, 1, "tenant-B has 1 account");
  assert(listA.every(a => a.tenantId === "tenant-A"), "all belong to tenant-A");
});

// ─── guardMint ────────────────────────────────────────────────────────────────

test("guardMint: increases user account balance", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  await store.guardMint("t1", alice.id, 5000n, "welcome bonus", "system");
  const acc = await store.getAccount("t1", alice.id);
  eq(acc.balance, 5000n, "alice gets 5000 μ¢");
});

test("guardMint: returns transaction with correct fields", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  const tx = await store.guardMint("t1", alice.id, 1000n, "test mint", "admin");
  eq(tx.kind, "mint");
  eq(tx.amount, 1000n);
  eq(tx.tenantId, "t1");
  eq(tx.initiatedBy, "admin");
  assert(tx.id.length > 0, "has id");
  assert(tx.createdAt.length > 0, "has timestamp");
});

test("guardMint: multiple mints accumulate correctly", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  await store.guardMint("t1", alice.id, 1000n, "m1", "sys");
  await store.guardMint("t1", alice.id, 2500n, "m2", "sys");
  await store.guardMint("t1", alice.id, 500n,  "m3", "sys");
  const acc = await store.getAccount("t1", alice.id);
  eq(acc.balance, 4000n, "sum of 1000+2500+500");
});

test("guardMint: rejects zero amount (fail-closed)", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  let threw = false;
  try { await store.guardMint("t1", alice.id, 0n, "zero", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "INVALID_AMOUNT"); }
  assert(threw, "zero amount must throw");
});

test("guardMint: rejects negative amount (fail-closed)", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  let threw = false;
  try { await store.guardMint("t1", alice.id, -100n, "neg", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "INVALID_AMOUNT"); }
  assert(threw, "negative amount must throw");
});

test("guardMint: rejects number instead of BigInt (fail-closed)", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  let threw = false;
  try {
    // @ts-ignore intentional type violation to test runtime guard
    await store.guardMint("t1", alice.id, 100, "num", "sys");
  }
  catch (e) { threw = true; eq((e as LedgerError).code, "INVALID_TYPE"); }
  assert(threw, "number amount must throw");
});

test("guardMint: tenant isolation — rejects cross-tenant account", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "tenant-A");
  let threw = false;
  try { await store.guardMint("tenant-B", alice.id, 1000n, "x", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "TENANT_VIOLATION"); }
  assert(threw, "cross-tenant mint must throw");
});

test("guardMint: rejects missing initiatedBy (fail-closed, audit trail)", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  let threw = false;
  try { await store.guardMint("t1", alice.id, 100n, "test", ""); }
  catch (e) { threw = true; eq((e as LedgerError).code, "MISSING_FIELD"); }
  assert(threw, "empty initiatedBy must throw");
});

// ─── guardWithdraw ────────────────────────────────────────────────────────────

test("guardWithdraw: decreases user account balance", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  await store.guardMint("t1", alice.id, 5000n, "seed", "sys");
  await store.guardWithdraw("t1", alice.id, 2000n, "fee", "sys");
  const acc = await store.getAccount("t1", alice.id);
  eq(acc.balance, 3000n, "5000 - 2000 = 3000");
});

test("guardWithdraw: returns transaction with correct fields", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  await store.guardMint("t1", alice.id, 1000n, "seed", "sys");
  const tx = await store.guardWithdraw("t1", alice.id, 400n, "charge", "billing");
  eq(tx.kind, "withdraw");
  eq(tx.amount, 400n);
  eq(tx.initiatedBy, "billing");
});

test("guardWithdraw: fail-closed on insufficient funds", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  await store.guardMint("t1", alice.id, 500n, "seed", "sys");
  let threw = false;
  try { await store.guardWithdraw("t1", alice.id, 501n, "over", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "INSUFFICIENT_FUNDS"); }
  assert(threw, "overdraft must throw");
});

test("guardWithdraw: fail-closed on zero balance", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  let threw = false;
  try { await store.guardWithdraw("t1", alice.id, 1n, "any", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "INSUFFICIENT_FUNDS"); }
  assert(threw, "zero balance withdraw must throw");
});

test("guardWithdraw: balance unchanged after failed withdraw", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  await store.guardMint("t1", alice.id, 100n, "seed", "sys");
  try { await store.guardWithdraw("t1", alice.id, 200n, "over", "sys"); } catch {}
  const acc = await store.getAccount("t1", alice.id);
  eq(acc.balance, 100n, "balance unchanged after failed withdraw");
});

test("guardWithdraw: tenant isolation — rejects cross-tenant account", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "tenant-A");
  await store.guardMint("tenant-A", alice.id, 1000n, "seed", "sys");
  let threw = false;
  try { await store.guardWithdraw("tenant-B", alice.id, 100n, "x", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "TENANT_VIOLATION"); }
  assert(threw, "cross-tenant withdraw must throw");
});

// ─── transfer ─────────────────────────────────────────────────────────────────

test("transfer: moves funds between two accounts in same tenant", async () => {
  const store = await makeStore();
  const { alice, bob } = await setupTenant(store, "t1");
  await store.guardMint("t1", alice.id, 10000n, "seed", "sys");
  await store.transfer("t1", alice.id, bob.id, 3000n, "payment", "user-alice");
  const a = await store.getAccount("t1", alice.id);
  const b = await store.getAccount("t1", bob.id);
  eq(a.balance, 7000n, "alice: 10000-3000");
  eq(b.balance, 3000n, "bob: +3000");
});

test("transfer: conservation — total balance unchanged", async () => {
  const store = await makeStore();
  const { alice, bob } = await setupTenant(store, "t1");
  await store.guardMint("t1", alice.id, 8000n, "seed", "sys");
  await store.guardMint("t1", bob.id,   2000n, "seed", "sys");
  const before = (await store.getAccount("t1", alice.id)).balance +
                 (await store.getAccount("t1", bob.id)).balance;
  await store.transfer("t1", alice.id, bob.id, 1500n, "tx", "alice");
  const after = (await store.getAccount("t1", alice.id)).balance +
                (await store.getAccount("t1", bob.id)).balance;
  eq(before, after, "total balance conserved during transfer");
});

test("transfer: fail-closed on insufficient funds", async () => {
  const store = await makeStore();
  const { alice, bob } = await setupTenant(store, "t1");
  await store.guardMint("t1", alice.id, 100n, "seed", "sys");
  let threw = false;
  try { await store.transfer("t1", alice.id, bob.id, 101n, "over", "alice"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "INSUFFICIENT_FUNDS"); }
  assert(threw, "overdraft transfer must throw");
});

test("transfer: self-transfer is rejected", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  await store.guardMint("t1", alice.id, 1000n, "seed", "sys");
  let threw = false;
  try { await store.transfer("t1", alice.id, alice.id, 100n, "self", "alice"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "SELF_TRANSFER"); }
  assert(threw, "self-transfer must throw");
});

test("transfer: cross-tenant is rejected (tenant isolation)", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "tenant-A");
  const { bob }   = await setupTenant(store, "tenant-B");
  await store.guardMint("tenant-A", alice.id, 1000n, "seed", "sys");
  let threw = false;
  try { await store.transfer("tenant-A", alice.id, bob.id, 100n, "x", "alice"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "TENANT_VIOLATION"); }
  assert(threw, "cross-tenant transfer must throw");
});

// ─── Double-entry invariant ───────────────────────────────────────────────────

test("double-entry: reserve balance mirrors total user assets after mints", async () => {
  const store = await makeStore();
  const { alice, bob } = await setupTenant(store, "t1");
  await store.guardMint("t1", alice.id, 3000n, "m1", "sys");
  await store.guardMint("t1", bob.id,   2000n, "m2", "sys");

  const accounts = await store.listAccounts("t1");
  const userAssets = accounts
    .filter(a => a.type === "asset")
    .reduce((sum, a) => sum + a.balance, 0n);
  const reserve = accounts.find(a => a.type === "equity")!;

  eq(reserve.balance, -5000n, "reserve debited 5000 total");
  eq(userAssets, 5000n, "user assets total 5000");
  eq(reserve.balance + userAssets, 0n, "double-entry balanced");
});

test("double-entry: balanced after mint then withdraw", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  await store.guardMint("t1", alice.id,     5000n, "mint", "sys");
  await store.guardWithdraw("t1", alice.id, 2000n, "fee",  "sys");

  const accounts = await store.listAccounts("t1");
  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0n);
  eq(totalBalance, 0n, "sum of all balances is always zero (double-entry)");
});

// ─── Audit trail / getTransactions ────────────────────────────────────────────

test("getTransactions: returns all transactions for an account", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  await store.guardMint("t1", alice.id, 1000n, "m1", "sys");
  await store.guardMint("t1", alice.id, 500n,  "m2", "sys");
  const txs = await store.getTransactions("t1", alice.id);
  eq(txs.length, 2, "two transactions recorded");
});

test("getTransactions: tenant isolation — can't read another tenant's transactions", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "tenant-A");
  await store.guardMint("tenant-A", alice.id, 1000n, "m1", "sys");
  let threw = false;
  try { await store.getTransactions("tenant-B", alice.id); }
  catch (e) { threw = true; eq((e as LedgerError).code, "TENANT_VIOLATION"); }
  assert(threw, "cross-tenant transaction read must throw");
});

// ─── proofOfSolvency ──────────────────────────────────────────────────────────

test("proofOfSolvency: fresh ledger is solvent (all zeros)", async () => {
  const store = await makeStore();
  await store.createAccount("t1", "u1", "asset", "W");
  const proof = await store.proofOfSolvency("t1");
  assert(proof.isSolvent, "fresh ledger is solvent");
  eq(proof.tenantId, "t1");
  assert(proof.balanceHash.length === 64, "SHA-256 hex = 64 chars");
  assert(proof.generatedAt.length > 0, "has timestamp");
});

test("proofOfSolvency: reports correct account count", async () => {
  const store = await makeStore();
  const a = await store.createAccount("t1", "u1", "asset",     "A");
  await store.createAccount("t1", "u2", "liability", "L");
  await store.createAccount("t1", "u3", "asset",     "B");
  await store.guardMint("t1", a.id, 1n, "trigger reserve", "sys");
  const proof = await store.proofOfSolvency("t1");
  eq(proof.accountCount, 4, "3 explicit + 1 reserve = 4");
});

test("proofOfSolvency: two proofs have same hash when balances unchanged", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  await store.guardMint("t1", alice.id, 5000n, "seed", "sys");
  const p1 = await store.proofOfSolvency("t1");
  const p2 = await store.proofOfSolvency("t1");
  eq(p1.balanceHash, p2.balanceHash, "same balances → same hash");
});

test("proofOfSolvency: hash changes after balance change", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  await store.guardMint("t1", alice.id, 5000n, "seed", "sys");
  const p1 = await store.proofOfSolvency("t1");
  await store.guardMint("t1", alice.id, 1n, "extra", "sys");
  const p2 = await store.proofOfSolvency("t1");
  assert(p1.balanceHash !== p2.balanceHash, "different balances → different hash");
});

test("proofOfSolvency: tenant isolation — only checks own accounts", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "tenant-A");
  await store.createAccount("tenant-B", "u1", "asset", "B-wallet");
  await store.guardMint("tenant-A", alice.id, 9999n, "seed", "sys");
  const proofB = await store.proofOfSolvency("tenant-B");
  eq(proofB.totalAssets, 0n, "tenant-B unaffected by tenant-A mints");
});

// ─── Efficiency: DB-order trust (redundant in-memory sort removed) ────────────

async function referenceHashPg(pool: InMemoryPool, tenantId: string): Promise<string> {
  const result = await pool.query(
    "SELECT id, type, balance_text FROM ledger_accounts WHERE tenant_id = $1 ORDER BY id ASC",
    [tenantId],
  );
  const lines = result.rows.map((r: any) => `${r.id}:${r.type}:${r.balance_text}`);
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

test("proofOfSolvency: hash matches DB-ordered reference (happy path)", async () => {
  const store = await makeStore();
  const { alice, bob } = await setupTenant(store, "t1");
  await store.guardMint("t1", alice.id, 5000n, "seed", "sys");
  await store.guardMint("t1", bob.id,   3000n, "seed", "sys");
  const proof = await store.proofOfSolvency("t1");
  const ref = await referenceHashPg(store["pool" as any] as InMemoryPool, "t1");
  eq(proof.balanceHash, ref, "hash must match DB-ordered rows without extra in-memory sort");
});

test("proofOfSolvency: many accounts hash matches DB-ordered reference (edge case)", async () => {
  const store = await makeStore();
  for (let i = 0; i < 10; i++) {
    const acc = await store.createAccount("t1", `u${i}`, i % 2 === 0 ? "asset" : "liability", `A${i}`);
    if (i % 3 === 0) await store.guardMint("t1", acc.id, BigInt(i + 1) * 100n, "m", "sys");
  }
  const proof = await store.proofOfSolvency("t1");
  const ref = await referenceHashPg(store["pool" as any] as InMemoryPool, "t1");
  eq(proof.balanceHash, ref, "hash must match DB-ordered rows for large account sets");
});

test("proofOfSolvency: cross-tenant reference hash excludes foreign accounts (fail-closed)", async () => {
  const store = await makeStore();
  await store.createAccount("tenant-A", "u1", "asset", "A1");
  await store.createAccount("tenant-A", "u2", "liability", "A2");
  await store.createAccount("tenant-B", "u1", "asset", "B1");
  await store.createAccount("tenant-B", "u2", "liability", "B2");
  const proofA = await store.proofOfSolvency("tenant-A");
  const refA = await referenceHashPg(store["pool" as any] as InMemoryPool, "tenant-A");
  eq(proofA.balanceHash, refA, "tenant-A hash must match only tenant-A DB rows");
  const proofB = await store.proofOfSolvency("tenant-B");
  const refB = await referenceHashPg(store["pool" as any] as InMemoryPool, "tenant-B");
  eq(proofB.balanceHash, refB, "tenant-B hash must match only tenant-B DB rows");
  assert(proofA.balanceHash !== proofB.balanceHash, "different tenants must have different hashes");
});

// ─── BigInt persistence round-trip ────────────────────────────────────────────

test("BigInt amounts are persisted and read back accurately", async () => {
  const store = await makeStore();
  const { alice } = await setupTenant(store, "t1");
  const big = 12345678901234567890n;
  await store.guardMint("t1", alice.id, big, "big mint", "sys");
  const acc = await store.getAccount("t1", alice.id);
  eq(acc.balance, big, "massive BigInt round-trips exactly");
  const txs = await store.getTransactions("t1", alice.id);
  eq(txs[0].amount, big, "transaction amount round-trips exactly");
});
