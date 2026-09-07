import "../_flush.mjs";
/**
 * tests/ledger-orchestrator/solvency-invariant.test.ts
 *
 * Solvency invariant — automatic proofOfSolvency after every successful
 * mint / withdraw / transfer.  Failure = loud error + audit record.
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { TfaOrchestrator } from "../../lib/orchestrator/orchestrator.ts";
import { allowAll } from "../../lib/orchestrator/guard.ts";
import { LedgerOrchestrator } from "../../lib/ledger-orchestrator/ledger-orchestrator.ts";

class ToggleSolvencyLedger extends InMemoryLedger {
  forceInsolvent = false;
  async proofOfSolvency(tenantId: string) {
    const proof = await super.proofOfSolvency(tenantId);
    if (this.forceInsolvent) {
      return {
        ...proof,
        isSolvent: false,
        netEquity: -1n,
        totalAssets: 0n,
        totalLiabilities: 1n,
      };
    }
    return proof;
  }
}

function makeAllowAll(provider: InMemoryLedger) {
  const orchestrator = new TfaOrchestrator([allowAll()]);
  return new LedgerOrchestrator(provider, orchestrator);
}

// ─── Happy path ───────────────────────────────────────────────────────────────

test("solvency invariant: mint passes when solvent", async () => {
  const provider = new ToggleSolvencyLedger();
  const lo = makeAllowAll(provider);
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  const result = await lo.mint("t1", acc.id, 1_000n, "test", "system");
  assert(result.ok, "mint should succeed when solvent");
  if (result.ok) eq(result.value.kind, "mint");
});

test("solvency invariant: withdraw passes when solvent", async () => {
  const provider = new ToggleSolvencyLedger();
  const lo = makeAllowAll(provider);
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  await lo.mint("t1", acc.id, 5_000n, "setup", "system");
  const result = await lo.withdraw("t1", acc.id, 2_000n, "test", "system");
  assert(result.ok, "withdraw should succeed when solvent");
  if (result.ok) eq(result.value.kind, "withdraw");
});

test("solvency invariant: transfer passes when solvent", async () => {
  const provider = new ToggleSolvencyLedger();
  const lo = makeAllowAll(provider);
  const alice = await lo.createAccount("t1", "alice", "asset", "Alice");
  const bob = await lo.createAccount("t1", "bob", "asset", "Bob");
  await lo.mint("t1", alice.id, 5_000n, "setup", "system");
  const result = await lo.transfer("t1", alice.id, bob.id, 2_000n, "test", "alice");
  assert(result.ok, "transfer should succeed when solvent");
  if (result.ok) eq(result.value.kind, "transfer");
});

// ─── Failure path ─────────────────────────────────────────────────────────────

test("solvency invariant: mint throws when insolvent", async () => {
  const provider = new ToggleSolvencyLedger();
  const lo = makeAllowAll(provider);
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  provider.forceInsolvent = true;
  let threw = false;
  try {
    await lo.mint("t1", acc.id, 1_000n, "test", "system");
  } catch (e) {
    threw = true;
    assert(
      (e as Error).message.includes("Solvency invariant violated"),
      "error must mention solvency violation",
    );
  }
  assert(threw, "must throw when insolvent");
  const chain = lo.orchestrator.audit.getChain("t1");
  const errors = chain.filter(
    (r) =>
      r.outcome === "error" && r.actionType === "ledger.invariant.solvency",
  );
  eq(errors.length, 1, "must write exactly one solvency error audit record");
  assert(errors[0].reason.includes("ledger.mint"));
});

test("solvency invariant: withdraw throws when insolvent", async () => {
  const provider = new ToggleSolvencyLedger();
  const lo = makeAllowAll(provider);
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  await lo.mint("t1", acc.id, 5_000n, "setup", "system");
  provider.forceInsolvent = true;
  let threw = false;
  try {
    await lo.withdraw("t1", acc.id, 1_000n, "test", "system");
  } catch (e) {
    threw = true;
    assert(
      (e as Error).message.includes("Solvency invariant violated"),
      "error must mention solvency violation",
    );
  }
  assert(threw, "must throw when insolvent");
  const chain = lo.orchestrator.audit.getChain("t1");
  const errors = chain.filter(
    (r) =>
      r.outcome === "error" && r.actionType === "ledger.invariant.solvency",
  );
  eq(errors.length, 1, "must write exactly one solvency error audit record");
  assert(errors[0].reason.includes("ledger.withdraw"));
});

test("solvency invariant: transfer throws when insolvent", async () => {
  const provider = new ToggleSolvencyLedger();
  const lo = makeAllowAll(provider);
  const alice = await lo.createAccount("t1", "alice", "asset", "Alice");
  const bob = await lo.createAccount("t1", "bob", "asset", "Bob");
  await lo.mint("t1", alice.id, 5_000n, "setup", "system");
  provider.forceInsolvent = true;
  let threw = false;
  try {
    await lo.transfer("t1", alice.id, bob.id, 1_000n, "test", "alice");
  } catch (e) {
    threw = true;
    assert(
      (e as Error).message.includes("Solvency invariant violated"),
      "error must mention solvency violation",
    );
  }
  assert(threw, "must throw when insolvent");
  const chain = lo.orchestrator.audit.getChain("t1");
  const errors = chain.filter(
    (r) =>
      r.outcome === "error" && r.actionType === "ledger.invariant.solvency",
  );
  eq(errors.length, 1, "must write exactly one solvency error audit record");
  assert(errors[0].reason.includes("ledger.transfer"));
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

test("solvency invariant: allowed audit record exists before error record", async () => {
  const provider = new ToggleSolvencyLedger();
  const lo = makeAllowAll(provider);
  const acc = await lo.createAccount("t1", "alice", "asset", "Alice");
  provider.forceInsolvent = true;
  try {
    await lo.mint("t1", acc.id, 1_000n, "test", "system");
  } catch {
    /* expected */
  }
  const chain = lo.orchestrator.audit.getChain("t1");
  eq(chain.length, 2, "should have allowed record + error record");
  eq(chain[0].outcome, "allowed");
  eq(chain[1].outcome, "error");
  eq(chain[1].actionType, "ledger.invariant.solvency");
  eq(chain[1].actionId, chain[0].actionId, "error record should reference allowed action");
});

test("solvency invariant: tenant isolation on failure", async () => {
  const p1 = new ToggleSolvencyLedger();
  const p2 = new ToggleSolvencyLedger();
  const lo1 = makeAllowAll(p1);
  const lo2 = makeAllowAll(p2);
  const acc1 = await lo1.createAccount("t1", "alice", "asset", "Alice");
  const acc2 = await lo2.createAccount("t2", "bob", "asset", "Bob");
  p1.forceInsolvent = true;
  try {
    await lo1.mint("t1", acc1.id, 1_000n, "test", "system");
  } catch {
    /* expected */
  }
  // t2 should be unaffected
  const result = await lo2.mint("t2", acc2.id, 1_000n, "test", "system");
  assert(result.ok, "t2 mint should succeed unaffected by t1 failure");
  const chain1 = lo1.orchestrator.audit.getChain("t1");
  const chain2 = lo2.orchestrator.audit.getChain("t2");
  eq(chain1.length, 2); // allowed + error
  eq(chain2.length, 1); // allowed only
  eq(chain2[0].outcome, "allowed");
});
