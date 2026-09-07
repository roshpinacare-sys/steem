import "../_flush.mjs";
/**
 * tests/track-record/worker-identity.test.ts — v125: the semantic-drift fix (deep-audit report).
 * Before: settledAsWorker compared workerAccountId === identityId — an account id vs an actor id,
 * which NEVER matched, so workers' track records were silently always empty. Now the worker
 * account is resolved to its owning identity first. This test proves a worker who DELIVERS
 * accrues a real, score-raising track record.
 */
import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { EscrowService } from "../../lib/escrow/index.ts";
import { computeTrackRecord } from "../../lib/track-record/index.ts";

test("worker who delivers accrues track record under their IDENTITY (not account id)", async () => {
  const stack = buildSovereignStack();
  const t = "drift";
  // payer owned by "alice", worker account owned by "bob"
  const payer = await stack.ledger.createAccount(t, "alice", "asset", "P");
  const worker = await stack.ledger.createAccount(t, "bob", "asset", "W");
  await stack.ledger.mint(t, payer.id, 1_000_000n, "seed", "alice", false);
  const escrow = new EscrowService(stack.ledger, stack.escrowStore);
  const a = await escrow.create({ tenantId: t, opportunityId: "o", payerAccountId: payer.id, workerAccountId: worker.id, amount: 300_000n });
  await escrow.fund(t, a.id, "alice");
  await escrow.release(t, a.id, "alice");

  const resolver = async (tid: string, accId: string) => {
    const acct = await stack.ledger.getAccount(tid, accId);
    return acct?.ownerId ?? null;
  };
  // Query by the worker's IDENTITY "bob" — not the account id
  const rec = await computeTrackRecord((stack as any).orchestrator.audit, stack.escrowStore, t, "bob", { accountOwnerResolver: resolver } as any);
  eq(rec.settledAsWorker, 1, "worker identity credited for the delivery");
  assert(rec.score > 50, "delivering raised the worker's score");
});

test("without resolver, comparison falls back to raw account id (no crash)", async () => {
  const stack = buildSovereignStack();
  const t = "drift2";
  const rec = await computeTrackRecord((stack as any).orchestrator.audit, stack.escrowStore, t, "nobody");
  eq(rec.settledAsWorker, 0);
  eq(rec.score, 50);
});
