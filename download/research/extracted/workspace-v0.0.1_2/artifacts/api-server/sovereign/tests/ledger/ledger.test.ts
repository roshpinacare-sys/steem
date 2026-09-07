import "../_flush.mjs";
/**
 * tests/ledger/ledger.test.ts — Sovereign Ledger full test suite.
 *
 * Coverage:
 *   • Account creation + tenant isolation
 *   • guardMint: happy path, positive BigInt, invalid input, cross-tenant
 *   • guardWithdraw: happy path, insufficient funds (fail-closed), cross-tenant
 *   • transfer: happy path, self-transfer, insufficient funds, cross-tenant
 *   • Double-entry invariant: sum of all balances across accounts after any op
 *   • proofOfSolvency: solvent/insolvent detection, hash uniqueness
 *   • BigInt only: reject number/string amounts
 *   • Audit trail: getTransactions returns correct entries
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryLedger, LedgerError } from "../../lib/ledger/in-memory-ledger.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function newLedger() {
  return new InMemoryLedger();
}

async function setupTenant(ledger: InMemoryLedger, tenantId: string) {
  const alice = await ledger.createAccount(tenantId, "user-alice", "asset", "Alice Wallet");
  const bob   = await ledger.createAccount(tenantId, "user-bob",   "asset", "Bob Wallet");
  return { alice, bob };
}

// ─── Account creation ─────────────────────────────────────────────────────────

test("createAccount: returns account with zero balance", async () => {
  const ledger = await newLedger();
  const acc = await ledger.createAccount("t1", "user-1", "asset", "My Wallet");
  eq(acc.balance, 0n, "initial balance");
  eq(acc.tenantId, "t1");
  eq(acc.ownerId, "user-1");
  eq(acc.type, "asset");
});

test("createAccount: each account gets unique id", async () => {
  const ledger = await newLedger();
  const a = await ledger.createAccount("t1", "u1", "asset", "A");
  const b = await ledger.createAccount("t1", "u2", "asset", "B");
  assert(a.id !== b.id, "unique ids");
});

test("createAccount: rejects empty tenantId", async () => {
  const ledger = await newLedger();
  let threw = false;
  try { await ledger.createAccount("", "u1", "asset", "X"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "MISSING_FIELD"); }
  assert(threw, "should throw on empty tenantId");
});

test("listAccounts: only returns accounts for requested tenant", async () => {
  const ledger = await newLedger();
  await ledger.createAccount("tenant-A", "u1", "asset", "A1");
  await ledger.createAccount("tenant-A", "u2", "asset", "A2");
  await ledger.createAccount("tenant-B", "u3", "asset", "B1");
  const listA = await ledger.listAccounts("tenant-A");
  const listB = await ledger.listAccounts("tenant-B");
  eq(listA.length, 2, "tenant-A has 2 accounts");
  eq(listB.length, 1, "tenant-B has 1 account");
  assert(listA.every(a => a.tenantId === "tenant-A"), "all belong to tenant-A");
});

// ─── guardMint ────────────────────────────────────────────────────────────────

test("guardMint: increases user account balance", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "t1");
  await ledger.guardMint("t1", alice.id, 5000n, "welcome bonus", "system");
  const acc = await ledger.getAccount("t1", alice.id);
  eq(acc.balance, 5000n, "alice gets 5000 μ¢");
});

test("guardMint: returns transaction with correct fields", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "t1");
  const tx = await ledger.guardMint("t1", alice.id, 1000n, "test mint", "admin");
  eq(tx.kind, "mint");
  eq(tx.amount, 1000n);
  eq(tx.tenantId, "t1");
  eq(tx.initiatedBy, "admin");
  assert(tx.id.length > 0, "has id");
  assert(tx.createdAt.length > 0, "has timestamp");
});

test("guardMint: multiple mints accumulate correctly", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "t1");
  await ledger.guardMint("t1", alice.id, 1000n, "m1", "sys");
  await ledger.guardMint("t1", alice.id, 2500n, "m2", "sys");
  await ledger.guardMint("t1", alice.id, 500n,  "m3", "sys");
  const acc = await ledger.getAccount("t1", alice.id);
  eq(acc.balance, 4000n, "sum of 1000+2500+500");
});

test("guardMint: rejects zero amount (fail-closed)", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "t1");
  let threw = false;
  try { await ledger.guardMint("t1", alice.id, 0n, "zero", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "INVALID_AMOUNT"); }
  assert(threw, "zero amount must throw");
});

test("guardMint: rejects negative amount (fail-closed)", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "t1");
  let threw = false;
  try { await ledger.guardMint("t1", alice.id, -100n, "neg", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "INVALID_AMOUNT"); }
  assert(threw, "negative amount must throw");
});

test("guardMint: rejects number instead of BigInt (fail-closed)", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "t1");
  let threw = false;
  try {
    // @ts-ignore intentional type violation to test runtime guard
    await ledger.guardMint("t1", alice.id, 100, "num", "sys");
  }
  catch (e) { threw = true; eq((e as LedgerError).code, "INVALID_TYPE"); }
  assert(threw, "number amount must throw");
});

test("guardMint: tenant isolation — rejects cross-tenant account", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "tenant-A");
  let threw = false;
  try { await ledger.guardMint("tenant-B", alice.id, 1000n, "x", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "TENANT_VIOLATION"); }
  assert(threw, "cross-tenant mint must throw");
});

test("guardMint: rejects missing initiatedBy (fail-closed, audit trail)", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "t1");
  let threw = false;
  try { await ledger.guardMint("t1", alice.id, 100n, "test", ""); }
  catch (e) { threw = true; eq((e as LedgerError).code, "MISSING_FIELD"); }
  assert(threw, "empty initiatedBy must throw");
});

// ─── guardWithdraw ────────────────────────────────────────────────────────────

test("guardWithdraw: decreases user account balance", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "t1");
  await ledger.guardMint("t1", alice.id, 5000n, "seed", "sys");
  await ledger.guardWithdraw("t1", alice.id, 2000n, "fee", "sys");
  const acc = await ledger.getAccount("t1", alice.id);
  eq(acc.balance, 3000n, "5000 - 2000 = 3000");
});

test("guardWithdraw: returns transaction with correct fields", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "t1");
  await ledger.guardMint("t1", alice.id, 1000n, "seed", "sys");
  const tx = await ledger.guardWithdraw("t1", alice.id, 400n, "charge", "billing");
  eq(tx.kind, "withdraw");
  eq(tx.amount, 400n);
  eq(tx.initiatedBy, "billing");
});

test("guardWithdraw: fail-closed on insufficient funds", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "t1");
  await ledger.guardMint("t1", alice.id, 500n, "seed", "sys");
  let threw = false;
  try { await ledger.guardWithdraw("t1", alice.id, 501n, "over", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "INSUFFICIENT_FUNDS"); }
  assert(threw, "overdraft must throw");
});

test("guardWithdraw: fail-closed on zero balance", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "t1");
  let threw = false;
  try { await ledger.guardWithdraw("t1", alice.id, 1n, "any", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "INSUFFICIENT_FUNDS"); }
  assert(threw, "zero balance withdraw must throw");
});

test("guardWithdraw: balance unchanged after failed withdraw", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "t1");
  await ledger.guardMint("t1", alice.id, 100n, "seed", "sys");
  try { await ledger.guardWithdraw("t1", alice.id, 200n, "over", "sys"); } catch {}
  const acc = await ledger.getAccount("t1", alice.id);
  eq(acc.balance, 100n, "balance unchanged after failed withdraw");
});

test("guardWithdraw: tenant isolation — rejects cross-tenant account", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "tenant-A");
  await ledger.guardMint("tenant-A", alice.id, 1000n, "seed", "sys");
  let threw = false;
  try { await ledger.guardWithdraw("tenant-B", alice.id, 100n, "x", "sys"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "TENANT_VIOLATION"); }
  assert(threw, "cross-tenant withdraw must throw");
});

// ─── transfer ─────────────────────────────────────────────────────────────────

test("transfer: moves funds between two accounts in same tenant", async () => {
  const ledger = await newLedger();
  const { alice, bob } = await setupTenant(ledger, "t1");
  await ledger.guardMint("t1", alice.id, 10000n, "seed", "sys");
  await ledger.transfer("t1", alice.id, bob.id, 3000n, "payment", "user-alice");
  const a = await ledger.getAccount("t1", alice.id);
  const b = await ledger.getAccount("t1", bob.id);
  eq(a.balance, 7000n, "alice: 10000-3000");
  eq(b.balance, 3000n, "bob: +3000");
});

test("transfer: conservation — total balance unchanged", async () => {
  const ledger = await newLedger();
  const { alice, bob } = await setupTenant(ledger, "t1");
  await ledger.guardMint("t1", alice.id, 8000n, "seed", "sys");
  await ledger.guardMint("t1", bob.id,   2000n, "seed", "sys");
  const before = (await ledger.getAccount("t1", alice.id)).balance +
                 (await ledger.getAccount("t1", bob.id)).balance;
  await ledger.transfer("t1", alice.id, bob.id, 1500n, "tx", "alice");
  const after = (await ledger.getAccount("t1", alice.id)).balance +
                (await ledger.getAccount("t1", bob.id)).balance;
  eq(before, after, "total balance conserved during transfer");
});

test("transfer: fail-closed on insufficient funds", async () => {
  const ledger = await newLedger();
  const { alice, bob } = await setupTenant(ledger, "t1");
  await ledger.guardMint("t1", alice.id, 100n, "seed", "sys");
  let threw = false;
  try { await ledger.transfer("t1", alice.id, bob.id, 101n, "over", "alice"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "INSUFFICIENT_FUNDS"); }
  assert(threw, "overdraft transfer must throw");
});

test("transfer: self-transfer is rejected", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "t1");
  await ledger.guardMint("t1", alice.id, 1000n, "seed", "sys");
  let threw = false;
  try { await ledger.transfer("t1", alice.id, alice.id, 100n, "self", "alice"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "SELF_TRANSFER"); }
  assert(threw, "self-transfer must throw");
});

test("transfer: cross-tenant is rejected (tenant isolation)", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "tenant-A");
  const { bob }   = await setupTenant(ledger, "tenant-B");
  await ledger.guardMint("tenant-A", alice.id, 1000n, "seed", "sys");
  let threw = false;
  try { await ledger.transfer("tenant-A", alice.id, bob.id, 100n, "x", "alice"); }
  catch (e) { threw = true; eq((e as LedgerError).code, "TENANT_VIOLATION"); }
  assert(threw, "cross-tenant transfer must throw");
});

// ─── Double-entry invariant ───────────────────────────────────────────────────

test("double-entry: reserve balance mirrors total user assets after mints", async () => {
  const ledger = await newLedger();
  const { alice, bob } = await setupTenant(ledger, "t1");
  await ledger.guardMint("t1", alice.id, 3000n, "m1", "sys");
  await ledger.guardMint("t1", bob.id,   2000n, "m2", "sys");

  const accounts = await ledger.listAccounts("t1");
  const userAssets = accounts
    .filter(a => a.type === "asset")
    .reduce((sum, a) => sum + a.balance, 0n);
  const reserve = accounts.find(a => a.type === "equity")!;

  // Reserve should be exactly negative of what was minted (it gave away that much)
  eq(reserve.balance, -5000n, "reserve debited 5000 total");
  eq(userAssets, 5000n, "user assets total 5000");
  // Conservation: reserve + assets = 0 (perfectly balanced)
  eq(reserve.balance + userAssets, 0n, "double-entry balanced");
});

test("double-entry: balanced after mint then withdraw", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "t1");
  await ledger.guardMint("t1", alice.id,     5000n, "mint", "sys");
  await ledger.guardWithdraw("t1", alice.id, 2000n, "fee",  "sys");

  const accounts = await ledger.listAccounts("t1");
  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0n);
  eq(totalBalance, 0n, "sum of all balances is always zero (double-entry)");
});

// ─── Audit trail / getTransactions ────────────────────────────────────────────

test("getTransactions: returns all transactions for an account", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "t1");
  await ledger.guardMint("t1", alice.id, 1000n, "m1", "sys");
  await ledger.guardMint("t1", alice.id, 500n,  "m2", "sys");
  const txs = await ledger.getTransactions("t1", alice.id);
  eq(txs.length, 2, "two transactions recorded");
});

test("getTransactions: tenant isolation — can't read another tenant's transactions", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "tenant-A");
  await ledger.guardMint("tenant-A", alice.id, 1000n, "m1", "sys");
  let threw = false;
  try { await ledger.getTransactions("tenant-B", alice.id); }
  catch (e) { threw = true; eq((e as LedgerError).code, "TENANT_VIOLATION"); }
  assert(threw, "cross-tenant transaction read must throw");
});

// ─── proofOfSolvency ──────────────────────────────────────────────────────────

test("proofOfSolvency: fresh ledger is solvent (all zeros)", async () => {
  const ledger = await newLedger();
  await ledger.createAccount("t1", "u1", "asset", "W");
  const proof = await ledger.proofOfSolvency("t1");
  assert(proof.isSolvent, "fresh ledger is solvent");
  eq(proof.tenantId, "t1");
  assert(proof.balanceHash.length === 64, "SHA-256 hex = 64 chars");
  assert(proof.generatedAt.length > 0, "has timestamp");
});

test("proofOfSolvency: reports correct account count", async () => {
  const ledger = await newLedger();
  const a = await ledger.createAccount("t1", "u1", "asset",     "A");
  await ledger.createAccount("t1", "u2", "liability", "L");
  await ledger.createAccount("t1", "u3", "asset",     "B");
  // Reserve is created lazily on first guardMint — trigger it now
  await ledger.guardMint("t1", a.id, 1n, "trigger reserve", "sys");
  const proof = await ledger.proofOfSolvency("t1");
  // 3 explicit + 1 reserve (equity) = 4
  eq(proof.accountCount, 4, "3 explicit + 1 reserve = 4");
});

test("proofOfSolvency: two proofs have same hash when balances unchanged", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "t1");
  await ledger.guardMint("t1", alice.id, 5000n, "seed", "sys");
  const p1 = await ledger.proofOfSolvency("t1");
  const p2 = await ledger.proofOfSolvency("t1");
  eq(p1.balanceHash, p2.balanceHash, "same balances → same hash");
});

test("proofOfSolvency: hash changes after balance change", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "t1");
  await ledger.guardMint("t1", alice.id, 5000n, "seed", "sys");
  const p1 = await ledger.proofOfSolvency("t1");
  await ledger.guardMint("t1", alice.id, 1n, "extra", "sys");
  const p2 = await ledger.proofOfSolvency("t1");
  assert(p1.balanceHash !== p2.balanceHash, "different balances → different hash");
});

test("proofOfSolvency: tenant isolation — only checks own accounts", async () => {
  const ledger = await newLedger();
  const { alice } = await setupTenant(ledger, "tenant-A");
  await ledger.createAccount("tenant-B", "u1", "asset", "B-wallet");
  await ledger.guardMint("tenant-A", alice.id, 9999n, "seed", "sys");
  const proofB = await ledger.proofOfSolvency("tenant-B");
  // tenant-B has no asset balances (just created empty wallet)
  eq(proofB.totalAssets, 0n, "tenant-B unaffected by tenant-A mints");
});

test("proofOfSolvency: many mixed-type accounts deterministic hash and totals", async () => {
  const ledger = await newLedger();
  // Create 10 accounts with varied types to stress the single-pass path
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = await ledger.createAccount("t1", `u${i}`, "asset", `A${i}`);
    ids.push(a.id);
    await ledger.guardMint("t1", a.id, BigInt(1000 * (i + 1)), "seed", "sys");
  }
  for (let i = 5; i < 10; i++) {
    const l = await ledger.createAccount("t1", `u${i}`, "liability", `L${i}`);
    ids.push(l.id);
    await ledger.guardMint("t1", l.id, BigInt(200 * (i - 4)), "seed", "sys");
  }

  const p1 = await ledger.proofOfSolvency("t1");
  const p2 = await ledger.proofOfSolvency("t1");

  // Deterministic hash
  eq(p1.balanceHash, p2.balanceHash, "same balances → same hash");
  eq(p1.accountCount, 11, "10 explicit + 1 reserve (equity) created lazily on first guardMint");

  // Totals must be correct (single-pass regression guard)
  const expectedAssets = BigInt(1000 + 2000 + 3000 + 4000 + 5000);
  const expectedLiabilities = BigInt(200 + 400 + 600 + 800 + 1000);
  eq(p1.totalAssets, expectedAssets, "totalAssets correct");
  eq(p1.totalLiabilities, expectedLiabilities, "totalLiabilities correct");
  eq(p1.netEquity, expectedAssets - expectedLiabilities, "netEquity correct");
  assert(p1.isSolvent, "solvent with assets > liabilities");
});

