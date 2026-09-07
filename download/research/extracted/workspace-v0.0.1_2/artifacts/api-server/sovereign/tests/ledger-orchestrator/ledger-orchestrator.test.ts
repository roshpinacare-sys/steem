import "../_flush.mjs";
/**
 * tests/ledger-orchestrator/ledger-orchestrator.test.ts
 *
 * Phase 4 full test suite — LedgerOrchestrator: shared-success economy.
 *
 * Coverage:
 *   • mint: happy path, fail-closed (no policies), guard deny, invalid amount
 *   • withdraw: happy path, insufficient funds, fail-closed, autonomous flag
 *   • transfer: happy path, insufficient funds, fail-closed
 *   • proofOfSolvency: always allowed (non-financial), audited
 *   • Audit chain: every financial op writes a record; verifyChain = true
 *   • Hash-link: prevHash of record[i] = hash of record[i-1]
 *   • Tenant isolation: T1 ops do not appear in T2 audit chain
 *   • Audit store access via orchestrator.audit.getChain()
 *   • Sequential ops: mint → withdraw → solvency → chain length check
 *   • Autonomous mint: fail-closed without policy covering autonomous
 *   • Pass-through: createAccount / listAccounts work without guard
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { TfaOrchestrator } from "../../lib/orchestrator/orchestrator.ts";
import {
  allowAll,
  denyAll,
  allowTypes,
  denyAutonomous,
} from "../../lib/orchestrator/guard.ts";
import { LedgerOrchestrator } from "../../lib/ledger-orchestrator/ledger-orchestrator.ts";
import { LEDGER_ACTION_TYPES } from "../../lib/ledger-orchestrator/types.ts";

// ─── Factories ────────────────────────────────────────────────────────────────

/** A ledger orchestrator that allows all financial ops. */
function makeAllowAll() {
  const provider = new InMemoryLedger();
  const orchestrator = new TfaOrchestrator([allowAll()]);
  return new LedgerOrchestrator(provider, orchestrator);
}

/** A ledger orchestrator with no policies — financial ops fail-closed. */
function makeNoPolicies() {
  const provider = new InMemoryLedger();
  const orchestrator = new TfaOrchestrator([]);
  return new LedgerOrchestrator(provider, orchestrator);
}

/** A ledger orchestrator that denies everything. */
function makeDenyAll() {
  const provider = new InMemoryLedger();
  const orchestrator = new TfaOrchestrator([denyAll("blocked")]);
  return new LedgerOrchestrator(provider, orchestrator);
}

/**
 * Setup: create an asset account for a user, then mint some starting balance.
 * Returns the account + the LedgerOrchestrator used.
 */
async function setupWithBalance(
  lo: LedgerOrchestrator,
  tenantId: string,
  userId: string,
  startingBalance: bigint,
) {
  const acc = await lo.createAccount(tenantId, userId, "asset", `${userId} Wallet`);
  const mintResult = await lo.mint(
    tenantId,
    acc.id,
    startingBalance,
    "Initial credit",
    "system",
  );
  assert(mintResult.ok, `setup mint failed: ${!mintResult.ok ? (mintResult as any).reason : ""}`);
  return acc;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. MINT
// ═══════════════════════════════════════════════════════════════════════════════

test("mint: happy path — returns transaction with correct amount", async () => {
  const lo = makeAllowAll();
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  const result = await lo.mint("t1", acc.id, 10_000n, "bonus", "system");
  assert(result.ok, "should succeed");
  if (result.ok) {
    eq(result.value.kind, "mint");
    eq(result.value.amount, 10_000n);
    eq(result.value.tenantId, "t1");
    assert(result.auditId.length > 0, "auditId must be non-empty");
  }
});

test("mint: updates account balance", async () => {
  const lo = makeAllowAll();
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  await lo.mint("t1", acc.id, 5_000n, "credit", "system");
  const updated = await lo.getAccount("t1", acc.id);
  eq(updated.balance, 5_000n);
});

test("mint: fail-closed — no policies → DENY", async () => {
  const lo = makeNoPolicies();
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  const result = await lo.mint("t1", acc.id, 1_000n, "attempt", "agent");
  assert(!result.ok, "should be denied without policies");
  assert(result.auditId.length > 0, "denied op must still produce audit record");
  // Ledger must NOT have been mutated
  const bal = await lo.getAccount("t1", acc.id);
  eq(bal.balance, 0n, "balance must be unchanged after denied mint");
});

test("mint: guard deny returns auditId and reason", async () => {
  const lo = makeDenyAll();
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  const result = await lo.mint("t1", acc.id, 1_000n, "attempt", "agent");
  assert(!result.ok);
  if (!result.ok) {
    assert(result.reason.length > 0, "deny must carry a reason");
    assert(result.auditId.length > 0);
  }
});

test("mint: invalid amount (0n) → executor error → ok=false", async () => {
  const lo = makeAllowAll();
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  const result = await lo.mint("t1", acc.id, 0n, "zero", "system");
  // LedgerError thrown by provider → orchestrator catches → error audit
  assert(!result.ok, "should fail on 0 amount");
  if (!result.ok) {
    assert(result.auditId.length > 0, "error audit must have auditId");
  }
});

test("mint: autonomous flag + allowAll policy → allowed", async () => {
  const lo = makeAllowAll();
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  const result = await lo.mint("t1", acc.id, 500n, "agent reward", "agent-007", true);
  assert(result.ok, "autonomous + allowAll should pass");
});

test("mint: autonomous flag + denyAutonomous policy → denied", async () => {
  const provider = new InMemoryLedger();
  const orch = new TfaOrchestrator([denyAutonomous()]);
  const lo = new LedgerOrchestrator(provider, orch);
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  const result = await lo.mint("t1", acc.id, 500n, "agent reward", "agent-007", true);
  assert(!result.ok, "autonomous mint must be denied by denyAutonomous");
  const bal = await lo.getAccount("t1", acc.id);
  eq(bal.balance, 0n, "balance unchanged after denied autonomous mint");
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. WITHDRAW
// ═══════════════════════════════════════════════════════════════════════════════

test("withdraw: happy path — deducts balance", async () => {
  const lo = makeAllowAll();
  const acc = await setupWithBalance(lo, "t1", "alice", 20_000n);
  const result = await lo.withdraw("t1", acc.id, 5_000n, "fee", "system");
  assert(result.ok, "withdraw should succeed");
  if (result.ok) {
    eq(result.value.kind, "withdraw");
    eq(result.value.amount, 5_000n);
  }
  const updated = await lo.getAccount("t1", acc.id);
  eq(updated.balance, 15_000n);
});

test("withdraw: insufficient funds → executor error → ok=false, no mutation", async () => {
  const lo = makeAllowAll();
  const acc = await setupWithBalance(lo, "t1", "alice", 100n);
  const result = await lo.withdraw("t1", acc.id, 999_999n, "overdraft", "system");
  assert(!result.ok, "should fail on overdraft");
  if (!result.ok) {
    assert(result.reason.length > 0);
    assert(result.auditId.length > 0);
  }
  const bal = await lo.getAccount("t1", acc.id);
  eq(bal.balance, 100n, "balance unchanged after failed withdraw");
});

test("withdraw: fail-closed — no policies → DENY", async () => {
  const lo = makeNoPolicies();
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  const result = await lo.withdraw("t1", acc.id, 1n, "attempt", "agent");
  assert(!result.ok, "no-policy withdraw must be denied");
  assert(result.auditId.length > 0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. TRANSFER
// ═══════════════════════════════════════════════════════════════════════════════

test("transfer: happy path — moves balance between accounts", async () => {
  const lo = makeAllowAll();
  const alice = await setupWithBalance(lo, "t1", "alice", 10_000n);
  const bob = await lo.createAccount("t1", "bob", "asset", "Bob");
  const result = await lo.transfer("t1", alice.id, bob.id, 3_000n, "tip", "alice");
  assert(result.ok, "transfer should succeed");
  if (result.ok) eq(result.value.kind, "transfer");
  const aliceBal = await lo.getAccount("t1", alice.id);
  const bobBal   = await lo.getAccount("t1", bob.id);
  eq(aliceBal.balance, 7_000n);
  eq(bobBal.balance,   3_000n);
});

test("transfer: insufficient funds → error, no mutation", async () => {
  const lo = makeAllowAll();
  const alice = await setupWithBalance(lo, "t1", "alice", 50n);
  const bob = await lo.createAccount("t1", "bob", "asset", "Bob");
  const result = await lo.transfer("t1", alice.id, bob.id, 9_999n, "too much", "alice");
  assert(!result.ok);
  const aliceBal = await lo.getAccount("t1", alice.id);
  eq(aliceBal.balance, 50n, "balance unchanged after failed transfer");
});

test("transfer: fail-closed — no policies → DENY", async () => {
  const lo = makeNoPolicies();
  const a = await lo.createAccount("t1", "a", "asset", "A");
  const b = await lo.createAccount("t1", "b", "asset", "B");
  const result = await lo.transfer("t1", a.id, b.id, 1n, "attempt", "a");
  assert(!result.ok);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. PROOF OF SOLVENCY (non-financial)
// ═══════════════════════════════════════════════════════════════════════════════

test("proofOfSolvency: always allowed — no policies needed", async () => {
  const lo = makeNoPolicies();
  await lo.createAccount("t1", "alice", "asset", "Alice");
  const result = await lo.proofOfSolvency("t1", "auditor");
  assert(result.ok, "solvency check must succeed even without financial policies");
  if (result.ok) {
    assert(result.value.isSolvent, "empty ledger is solvent");
    assert(result.auditId.length > 0, "solvency check is audited");
  }
});

test("proofOfSolvency: solvent after mint", async () => {
  const lo = makeAllowAll();
  const acc = await setupWithBalance(lo, "t1", "alice", 5_000n);
  const result = await lo.proofOfSolvency("t1", "auditor");
  assert(result.ok);
  if (result.ok) assert(result.value.isSolvent);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. AUDIT CHAIN
// ═══════════════════════════════════════════════════════════════════════════════

test("audit chain: mint writes exactly one record", async () => {
  const lo = makeAllowAll();
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  await lo.mint("t1", acc.id, 1_000n, "credit", "system");
  const chain = lo.orchestrator.audit.getChain("t1");
  eq(chain.length, 1);
  eq(chain[0].actionType, LEDGER_ACTION_TYPES.MINT);
  eq(chain[0].outcome, "allowed");
});

test("audit chain: denied op also writes a record", async () => {
  const lo = makeNoPolicies();
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  await lo.mint("t1", acc.id, 1_000n, "attempt", "agent");
  const chain = lo.orchestrator.audit.getChain("t1");
  eq(chain.length, 1);
  eq(chain[0].outcome, "denied");
});

test("audit chain: sequential ops produce ordered chain", async () => {
  const lo = makeAllowAll();
  const acc = await setupWithBalance(lo, "t1", "alice", 50_000n);
  await lo.withdraw("t1", acc.id, 1_000n, "fee-1", "system");
  await lo.withdraw("t1", acc.id, 2_000n, "fee-2", "system");
  await lo.proofOfSolvency("t1", "auditor");
  const chain = lo.orchestrator.audit.getChain("t1");
  // mint (setup) + withdraw×2 + solvency = 4 records
  eq(chain.length, 4);
  eq(chain[0].actionType, LEDGER_ACTION_TYPES.MINT);
  eq(chain[1].actionType, LEDGER_ACTION_TYPES.WITHDRAW);
  eq(chain[2].actionType, LEDGER_ACTION_TYPES.WITHDRAW);
  eq(chain[3].actionType, LEDGER_ACTION_TYPES.SOLVENCY_CHECK);
});

test("audit chain: verifyChain returns true after multiple ops", async () => {
  const lo = makeAllowAll();
  const acc = await setupWithBalance(lo, "t1", "alice", 10_000n);
  const bob = await lo.createAccount("t1", "bob", "asset", "Bob");
  await lo.transfer("t1", acc.id, bob.id, 3_000n, "tip", "alice");
  await lo.proofOfSolvency("t1", "auditor");
  const intact = lo.orchestrator.audit.verifyChain("t1");
  assert(intact, "chain must be intact after legitimate ops");
});

test("audit chain: prevHash links correctly", async () => {
  const lo = makeAllowAll();
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  await lo.mint("t1", acc.id, 1_000n, "a", "system");
  await lo.mint("t1", acc.id, 2_000n, "b", "system");
  const chain = lo.orchestrator.audit.getChain("t1");
  eq(chain.length, 2);
  eq(chain[0].prevHash, "genesis", "first record prevHash = genesis");
  eq(chain[1].prevHash, chain[0].hash, "second record prevHash = first record hash");
});

test("audit chain: auditId in result matches record in chain", async () => {
  const lo = makeAllowAll();
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  const result = await lo.mint("t1", acc.id, 1_000n, "check", "system");
  assert(result.ok);
  if (result.ok) {
    const record = lo.orchestrator.audit.getRecord(result.auditId);
    assert(record !== null, "getRecord must find the audit entry");
    eq(record!.id, result.auditId);
    eq(record!.actionType, LEDGER_ACTION_TYPES.MINT);
    eq(record!.outcome, "allowed");
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. TENANT ISOLATION
// ═══════════════════════════════════════════════════════════════════════════════

test("tenant isolation: T1 audit chain does not contain T2 ops", async () => {
  const lo = makeAllowAll();
  const a1 = await lo.createAccount("tenant-1", "alice", "asset", "Alice");
  const a2 = await lo.createAccount("tenant-2", "bob",   "asset", "Bob");
  await lo.mint("tenant-1", a1.id, 1_000n, "t1 credit", "system");
  await lo.mint("tenant-2", a2.id, 2_000n, "t2 credit", "system");
  const chain1 = lo.orchestrator.audit.getChain("tenant-1");
  const chain2 = lo.orchestrator.audit.getChain("tenant-2");
  eq(chain1.length, 1);
  eq(chain2.length, 1);
  eq(chain1[0].tenantId, "tenant-1");
  eq(chain2[0].tenantId, "tenant-2");
});

test("tenant isolation: T1 balance unaffected by T2 ops", async () => {
  const lo = makeAllowAll();
  const a1 = await lo.createAccount("tenant-1", "alice", "asset", "Alice");
  const a2 = await lo.createAccount("tenant-2", "carol", "asset", "Carol");
  await lo.mint("tenant-1", a1.id, 9_000n, "t1", "system");
  await lo.mint("tenant-2", a2.id, 1_000n, "t2", "system");
  const bal1 = await lo.getAccount("tenant-1", a1.id);
  eq(bal1.balance, 9_000n, "T1 balance must be unaffected by T2 mint");
});

test("tenant isolation: listAccounts scoped per tenant", async () => {
  const lo = makeAllowAll();
  await lo.createAccount("t1", "u1", "asset", "U1");
  await lo.createAccount("t1", "u2", "asset", "U2");
  await lo.createAccount("t2", "u3", "asset", "U3");
  const t1Accounts = await lo.listAccounts("t1");
  const t2Accounts = await lo.listAccounts("t2");
  eq(t1Accounts.length, 2);
  eq(t2Accounts.length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. PASS-THROUGH (account management)
// ═══════════════════════════════════════════════════════════════════════════════

test("createAccount: works without guard policies (no-op for guard)", async () => {
  const lo = makeNoPolicies();
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  eq(acc.ownerId, "alice");
  eq(acc.balance, 0n);
});

test("getTransactions: returns ledger transactions for account", async () => {
  const lo = makeAllowAll();
  const acc = await setupWithBalance(lo, "t1", "alice", 5_000n);
  const txs = await lo.getTransactions("t1", acc.id);
  assert(txs.length > 0, "should have at least one transaction after mint");
  assert(txs.every(tx => tx.tenantId === "t1"), "all transactions belong to t1");
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. POLICY SCOPED TO LEDGER TYPES
// ═══════════════════════════════════════════════════════════════════════════════

test("allowTypes policy: allows only mint, denies withdraw", async () => {
  const provider = new InMemoryLedger();
  const mintOnlyPolicy = allowTypes([LEDGER_ACTION_TYPES.MINT]);
  const orch = new TfaOrchestrator([mintOnlyPolicy]);  const lo = new LedgerOrchestrator(provider, orch);

  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  const mintResult = await lo.mint("t1", acc.id, 1_000n, "ok", "system");
  assert(mintResult.ok, "mint should be allowed");

  // withdraw has a different type — not in allowTypes list → denied
  const withdrawResult = await lo.withdraw("t1", acc.id, 100n, "not ok", "system");
  assert(!withdrawResult.ok, "withdraw should be denied by allowTypes");
  // Balance unchanged
  const bal = await lo.getAccount("t1", acc.id);
  eq(bal.balance, 1_000n, "balance unchanged after denied withdraw");
});
