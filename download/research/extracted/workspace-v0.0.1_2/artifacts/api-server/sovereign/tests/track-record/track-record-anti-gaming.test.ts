import "../_flush.mjs";
/**
 * tests/track-record/track-record-anti-gaming.test.ts
 *
 * Anti-gaming tests for the Verified Track Record — selfDealing detection.
 *
 * Context (v118):
 *   computeTrackRecord() now accepts optional { accountOwnerResolver, identityStore }.
 *   When the funder and worker's account owner share the same delegation-chain root,
 *   the settlement is flagged as selfDealing and does NOT raise the trust score.
 *
 * Tests:
 *   Direct self-dealing
 *     • funder owns the worker account → selfDealing=1, score not boosted
 *     • different identities → no selfDealing, score boosted normally
 *     • resolver returns null (account unknown) → not flagged as selfDealing (fail-closed)
 *     • farm (5× self-dealing releases) → selfDealing=5, score ≈ 50 (no boost)
 *
 *   Delegation-chain self-dealing
 *     • human (alice) → agent (bob): bob funds, alice's account receives → same root → selfDealing
 *     • alice funds, charlie (different human) works → NOT selfDealing
 *
 *   TrackRecord shape
 *     • selfDealing field present in result (backward-compat check)
 *     • explanation does NOT mention self-dealing settlements (they're invisible to scorer)
 *
 *   Refunds / denials not affected
 *     • refund involving self-dealing account still counted in refunded (not in selfDealing)
 *     • denial still counted regardless of self-dealing status
 */

import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { EscrowService } from "../../lib/escrow/index.ts";
import { computeTrackRecord } from "../../lib/track-record/track-record.ts";
import { buildDelegationChain } from "../../lib/agent-identity/delegation.ts";
import { InMemoryIdentityStore } from "../../lib/agent-identity/index.ts";
import type { AccountOwnerResolver } from "../../lib/track-record/track-record.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates an escrow and fully settles it (fund → release).
 * Returns { escrowId, workerAccountId }.
 */
async function settleEscrow(
  stack: any,
  tenantId: string,
  funderIdentity: string,
  workerIdentity: string,
  amount = 100_000n,
): Promise<{ escrowId: string; payerAccountId: string; workerAccountId: string }> {
  const payer  = await stack.ledger.createAccount(tenantId, funderIdentity, "asset", `P-${funderIdentity}`);
  const worker = await stack.ledger.createAccount(tenantId, workerIdentity,  "asset", `W-${workerIdentity}`);
  await stack.ledger.mint(tenantId, payer.id, amount * 3n, "seed", funderIdentity, false);
  const svc = new EscrowService(stack.ledger, stack.escrowStore);
  const a = await svc.create({
    tenantId,
    opportunityId: "opp-ag",
    payerAccountId:  payer.id,
    workerAccountId: worker.id,
    amount,
  });
  await svc.fund(tenantId, a.id, funderIdentity);
  await svc.release(tenantId, a.id, funderIdentity);
  return { escrowId: a.id, payerAccountId: payer.id, workerAccountId: worker.id };
}

/** Build an AccountOwnerResolver backed by the ledger in the stack. */
function makeResolver(stack: any): AccountOwnerResolver {
  return async (tenantId: string, accountId: string) => {
    try {
      const acct = await stack.ledger.getAccount(tenantId, accountId);
      return acct?.ownerId ?? null;
    } catch { return null; }
  };
}

// ─── Direct self-dealing: same owner ─────────────────────────────────────────

test("direct self-dealing: funder = worker account owner → selfDealing=1, score not boosted", async () => {
  const stack = buildSovereignStack();
  const t = "ag-t1";

  // Alice is both funder identity and owner of the "worker" account
  const alice_payer  = await stack.ledger.createAccount(t, "alice", "asset", "A-Payer");
  const alice_worker = await stack.ledger.createAccount(t, "alice", "asset", "A-Worker"); // same ownerId!
  await stack.ledger.mint(t, alice_payer.id, 500_000n, "seed", "alice", false);
  const svc = new EscrowService(stack.ledger, stack.escrowStore);
  const escrow = await svc.create({
    tenantId: t, opportunityId: "o", amount: 100_000n,
    payerAccountId: alice_payer.id, workerAccountId: alice_worker.id,
  });
  await svc.fund(t, escrow.id, "alice");
  await svc.release(t, escrow.id, "alice");

  const opts = { accountOwnerResolver: makeResolver(stack) };
  const r = await computeTrackRecord(
    (stack as any).orchestrator.audit,
    (stack as any).escrowStore,
    t, "alice", opts,
  );

  eq(r.selfDealing, 1, "one self-dealing settlement detected");
  eq(r.settledAsFunder, 0, "self-dealing NOT counted as settledAsFunder");
  eq(r.settledAsWorker, 0, "self-dealing NOT counted as settledAsWorker");
  eq(r.score, 50, "self-dealing does not boost score above neutral");
});

test("no selfDealing: different identity owners → score boosts normally", async () => {
  const stack = buildSovereignStack();
  const t = "ag-t2";

  const { workerAccountId } = await settleEscrow(stack, t, "alice", "bob");

  const opts = { accountOwnerResolver: makeResolver(stack) };
  const r = await computeTrackRecord(
    (stack as any).orchestrator.audit,
    (stack as any).escrowStore,
    t, "alice", opts,
  );

  eq(r.selfDealing, 0, "no self-dealing when funder ≠ worker owner");
  assert(r.settledAsFunder >= 1, "legitimate settlement counted for funder");
  assert(r.score > 50, "score rises above neutral for legitimate settlement");
});

test("resolver returns null (unknown account) → not flagged as selfDealing (fail-closed)", async () => {
  const stack = buildSovereignStack();
  const t = "ag-t3";

  const alice_payer  = await stack.ledger.createAccount(t, "alice", "asset", "P");
  const alice_worker = await stack.ledger.createAccount(t, "alice", "asset", "W");
  await stack.ledger.mint(t, alice_payer.id, 500_000n, "seed", "alice", false);
  const svc = new EscrowService(stack.ledger, stack.escrowStore);
  const e = await svc.create({ tenantId: t, opportunityId: "o", amount: 100_000n, payerAccountId: alice_payer.id, workerAccountId: alice_worker.id });
  await svc.fund(t, e.id, "alice");
  await svc.release(t, e.id, "alice");

  // Resolver always returns null (simulates broken lookup)
  const nullResolver: AccountOwnerResolver = async () => null;
  const r = await computeTrackRecord(
    (stack as any).orchestrator.audit,
    (stack as any).escrowStore,
    t, "alice", { accountOwnerResolver: nullResolver },
  );

  eq(r.selfDealing, 0, "cannot flag self-dealing without account owner info (fail-closed)");
});

test("farm: 5× self-dealing releases → selfDealing=5, score ≈ 50", async () => {
  const stack = buildSovereignStack();
  const t = "ag-farm";
  const payer  = await stack.ledger.createAccount(t, "farmer", "asset", "FPayer");
  const worker = await stack.ledger.createAccount(t, "farmer", "asset", "FWorker"); // same owner
  await stack.ledger.mint(t, payer.id, 5_000_000n, "seed", "farmer", false);
  const svc = new EscrowService(stack.ledger, stack.escrowStore);

  for (let i = 0; i < 5; i++) {
    const e = await svc.create({ tenantId: t, opportunityId: `o${i}`, amount: 100_000n, payerAccountId: payer.id, workerAccountId: worker.id });
    await svc.fund(t, e.id, "farmer");
    await svc.release(t, e.id, "farmer");
  }

  const opts = { accountOwnerResolver: makeResolver(stack) };
  const r = await computeTrackRecord(
    (stack as any).orchestrator.audit,
    (stack as any).escrowStore,
    t, "farmer", opts,
  );

  eq(r.selfDealing, 5, "all 5 self-dealing settlements detected");
  eq(r.settledAsFunder, 0, "none counted toward funder score");
  eq(r.settledAsWorker, 0, "none counted toward worker score");
  eq(r.score, 50, "farm score stays at neutral — anti-gaming works");
});

// ─── Delegation-chain self-dealing ───────────────────────────────────────────

test("delegation self-dealing: agent funded by parent human → same root → selfDealing", async () => {
  const stack = buildSovereignStack();
  const t = "ag-del1";

  // Identity hierarchy: alice (human) → bob (agent)
  const idStore = new InMemoryIdentityStore();
  const alice = idStore.create({ id: "alice", tenantId: t, type: "human", parentId: null, createdAt: new Date().toISOString() });
  const bob   = idStore.create({ id: "bob",   tenantId: t, type: "agent", parentId: "alice", createdAt: new Date().toISOString() });

  // Bob funds, Alice's account receives payment
  const bob_payer   = await stack.ledger.createAccount(t, "bob",   "asset", "B-Payer");
  const alice_worker = await stack.ledger.createAccount(t, "alice", "asset", "A-Worker");
  await stack.ledger.mint(t, bob_payer.id, 500_000n, "seed", "bob", false);

  const svc = new EscrowService(stack.ledger, stack.escrowStore);
  const e = await svc.create({ tenantId: t, opportunityId: "o", amount: 100_000n, payerAccountId: bob_payer.id, workerAccountId: alice_worker.id });
  await svc.fund(t, e.id, "bob");
  await svc.release(t, e.id, "bob");

  // Bob (fundedBy) → root = alice; alice_worker.ownerId = alice → root = alice → SAME ROOT
  const r = await computeTrackRecord(
    (stack as any).orchestrator.audit,
    (stack as any).escrowStore,
    t, "bob",
    { accountOwnerResolver: makeResolver(stack), identityStore: idStore },
  );

  eq(r.selfDealing, 1, "delegation self-dealing: bob & alice share root → detected");
  eq(r.score, 50, "score not boosted for delegation self-dealing");
});

test("delegation NOT self-dealing: funder and worker belong to different humans", async () => {
  const stack = buildSovereignStack();
  const t = "ag-del2";

  const idStore = new InMemoryIdentityStore();
  // Two separate identity trees
  idStore.create({ id: "alice", tenantId: t, type: "human", parentId: null, createdAt: new Date().toISOString() });
  idStore.create({ id: "charlie", tenantId: t, type: "human", parentId: null, createdAt: new Date().toISOString() });

  const { workerAccountId } = await settleEscrow(stack, t, "alice", "charlie");

  // alice (root: alice) funds, charlie's account (root: charlie) receives → different roots
  const r = await computeTrackRecord(
    (stack as any).orchestrator.audit,
    (stack as any).escrowStore,
    t, "alice",
    { accountOwnerResolver: makeResolver(stack), identityStore: idStore },
  );

  eq(r.selfDealing, 0, "different roots → not self-dealing");
  assert(r.settledAsFunder >= 1, "legitimate settlement counted");
  assert(r.score > 50, "score boosts for genuine work");
});

// ─── Backward compatibility: opts omitted ────────────────────────────────────

test("backward compat: no opts → works as before, selfDealing=0", async () => {
  const stack = buildSovereignStack();
  const t = "ag-bc";
  const { workerAccountId } = await settleEscrow(stack, t, "alice", "bob");

  // No opts → resolver not provided → selfDealing detection skipped
  const r = await computeTrackRecord(
    (stack as any).orchestrator.audit,
    (stack as any).escrowStore,
    t, "alice",
    // No opts — tests backward compat
  );

  eq(r.selfDealing, 0, "no opts: selfDealing defaults to 0");
  assert(r.settledAsFunder >= 1, "legitimate settlement still counted without opts");
  assert(r.score > 50, "score boosts normally without opts");
});

// ─── selfDealing field in shape ───────────────────────────────────────────────

test("TrackRecord shape: selfDealing field always present (even when 0)", async () => {
  const stack = buildSovereignStack();
  const r = await computeTrackRecord(
    (stack as any).orchestrator.audit,
    (stack as any).escrowStore,
    "shape-tenant", "nobody-id",
  );
  assert("selfDealing" in r, "selfDealing field present in result");
  eq(typeof r.selfDealing, "number", "selfDealing is a number");
  eq(r.selfDealing, 0, "no history → selfDealing=0");
});

// ─── Refunds and denials not affected ─────────────────────────────────────────

test("refund involving self-dealing parties still counted in refunded", async () => {
  const stack = buildSovereignStack();
  const t = "ag-refund";
  const payer  = await stack.ledger.createAccount(t, "alice", "asset", "P");
  const worker = await stack.ledger.createAccount(t, "alice", "asset", "W"); // same owner
  await stack.ledger.mint(t, payer.id, 500_000n, "seed", "alice", false);
  const svc = new EscrowService(stack.ledger, stack.escrowStore);
  const e = await svc.create({ tenantId: t, opportunityId: "o", amount: 100_000n, payerAccountId: payer.id, workerAccountId: worker.id });
  await svc.fund(t, e.id, "alice");
  await svc.refund(t, e.id, "alice");

  const opts = { accountOwnerResolver: makeResolver(stack) };
  const r = await computeTrackRecord(
    (stack as any).orchestrator.audit,
    (stack as any).escrowStore,
    t, "alice", opts,
  );

  // Refund: alice is fundedBy and payerAccountId owner → refunded++
  assert(r.refunded >= 1, "refund still counted even in self-dealing context");
  eq(r.selfDealing, 0, "refund is NOT a self-dealing settlement (only released matters)");
});

test("denial counting unaffected by anti-gaming opts", async () => {
  const stack = buildSovereignStack();
  const t = "ag-denial";
  const acct = await stack.ledger.createAccount(t, "badactor", "asset", "X");
  await stack.ledger.mint(t, acct.id, 999_999_999_999n, "huge", "badactor", false).catch(() => {});

  const opts = { accountOwnerResolver: makeResolver(stack) };
  const r = await computeTrackRecord(
    (stack as any).orchestrator.audit,
    (stack as any).escrowStore,
    t, "badactor", opts,
  );

  assert(r.denied >= 1, "denial still counted when opts provided");
  assert(r.score < 50, "score still penalised for denials");
  eq(r.selfDealing, 0, "denial does not affect selfDealing counter");
});
