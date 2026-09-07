import "../_flush.mjs";
/**
 * tests/escrow/dispute-freeze.test.ts — v88: Dispute Freeze.
 *
 * Invariants under test:
 *   1. Either party (funder or other identity) can freeze a funded escrow (funded→disputed).
 *   2. No money moves on dispute — balances unchanged.
 *   3. Only the funder can unfreeze (disputed→funded); others denied.
 *   4. Release and refund are blocked while disputed (wrong_state).
 *   5. After undispute, funder can release or refund normally.
 *   6. Disputing a non-funded escrow fails with wrong_state.
 *   7. Undisputing a non-disputed escrow fails with wrong_state.
 *   8. Empty initiatedBy is rejected for both dispute and undispute.
 *   9. disputedBy and disputeReason are persisted on the agreement.
 *  10. Dispute by funder themselves is allowed (self-freeze for safety).
 *  11. PgEscrowStore round-trips disputed_by and dispute_reason correctly.
 */
import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { EscrowService, InMemoryEscrowStore, EscrowError } from "../../lib/escrow/index.ts";
import { PgEscrowStore } from "../../lib/escrow/pg-escrow-store.ts";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";

// ─── shared setup ─────────────────────────────────────────────────────────────

async function setup() {
  const stack = buildSovereignStack();
  const ledger = stack.ledger;
  const t = "tenant-dispute";
  const payer = await ledger.createAccount(t, "funder-id", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker-id", "asset", "Worker");
  const mint = await ledger.mint(t, payer.id, 1_000_000n, "seed", "funder-id", false);
  assert(mint.ok, "seed mint must pass");
  const escrow = new EscrowService(ledger);
  const a = await escrow.create({ tenantId: t, opportunityId: "opp-dispute", payerAccountId: payer.id, workerAccountId: worker.id, amount: 200_000n });
  const funded = await escrow.fund(t, a.id, "funder-id");
  eq(funded.state, "funded");
  return { ledger, t, payer, worker, escrow, a: funded };
}

// ─── 1. Funder can dispute ────────────────────────────────────────────────────

test("dispute: funder can freeze a funded escrow (funded→disputed)", async () => {
  const { t, escrow, a } = await setup();
  const disputed = await escrow.dispute(t, a.id, "funder-id", "suspected fraud");
  eq(disputed.state, "disputed");
  eq(disputed.disputedBy, "funder-id");
  eq(disputed.disputeReason, "suspected fraud");
});

// ─── 2. No money moves on dispute ────────────────────────────────────────────

test("dispute: no money moves — escrow account balance unchanged", async () => {
  const { ledger, t, payer, escrow, a } = await setup();
  const payerBefore = (await ledger.getAccount(t, payer.id)).balance;
  const escrowBefore = (await ledger.getAccount(t, a.escrowAccountId)).balance;
  await escrow.dispute(t, a.id, "worker-id", "work not delivered");
  const payerAfter = (await ledger.getAccount(t, payer.id)).balance;
  const escrowAfter = (await ledger.getAccount(t, a.escrowAccountId)).balance;
  eq(payerAfter, payerBefore, "payer balance unchanged");
  eq(escrowAfter, escrowBefore, "escrow balance unchanged — money frozen in place");
});

// ─── 3. Worker (non-funder) can also dispute ─────────────────────────────────

test("dispute: worker (non-funder) can also freeze the escrow", async () => {
  const { t, escrow, a } = await setup();
  const disputed = await escrow.dispute(t, a.id, "worker-id", "work rejected unfairly");
  eq(disputed.state, "disputed");
  eq(disputed.disputedBy, "worker-id");
});

// ─── 4. Release blocked while disputed ───────────────────────────────────────

test("dispute: release blocked in disputed state (wrong_state)", async () => {
  const { t, escrow, a } = await setup();
  await escrow.dispute(t, a.id, "funder-id");
  let code = "";
  try { await escrow.release(t, a.id, "funder-id"); } catch (e) { if (e instanceof EscrowError) code = e.code; }
  eq(code, "wrong_state", "release must fail with wrong_state when disputed");
});

// ─── 5. Refund blocked while disputed ────────────────────────────────────────

test("dispute: refund blocked in disputed state (wrong_state)", async () => {
  const { t, escrow, a } = await setup();
  await escrow.dispute(t, a.id, "funder-id");
  let code = "";
  try { await escrow.refund(t, a.id, "funder-id"); } catch (e) { if (e instanceof EscrowError) code = e.code; }
  eq(code, "wrong_state", "refund must fail with wrong_state when disputed");
});

// ─── 6. Only funder can undispute ────────────────────────────────────────────

test("undispute: non-funder cannot unfreeze (unauthorized)", async () => {
  const { t, escrow, a } = await setup();
  await escrow.dispute(t, a.id, "worker-id");
  let code = "";
  try { await escrow.undispute(t, a.id, "worker-id"); } catch (e) { if (e instanceof EscrowError) code = e.code; }
  eq(code, "unauthorized", "worker cannot undispute");
  eq((await escrow.get(t, a.id))!.state, "disputed", "state unchanged after denied undispute");
});

// ─── 7. Funder can undispute → back to funded ────────────────────────────────

test("undispute: funder restores escrow to funded (disputed→funded)", async () => {
  const { t, escrow, a } = await setup();
  await escrow.dispute(t, a.id, "worker-id", "disputed by worker");
  const restored = await escrow.undispute(t, a.id, "funder-id");
  eq(restored.state, "funded");
  eq(restored.disputedBy, undefined, "disputedBy cleared after undispute");
  eq(restored.disputeReason, undefined, "disputeReason cleared after undispute");
});

// ─── 8. After undispute, funder can release ───────────────────────────────────

test("undispute: funder can release after undispute (full happy path)", async () => {
  const { ledger, t, worker, escrow, a } = await setup();
  await escrow.dispute(t, a.id, "worker-id");
  await escrow.undispute(t, a.id, "funder-id");
  const released = await escrow.release(t, a.id, "funder-id");
  eq(released.state, "released");
  eq((await ledger.getAccount(t, worker.id)).balance, 200_000n, "worker paid after dispute resolved");
});

// ─── 9. After undispute, funder can refund ────────────────────────────────────

test("undispute: funder can refund after undispute", async () => {
  const { ledger, t, payer, escrow, a } = await setup();
  const payerBefore = (await ledger.getAccount(t, payer.id)).balance;
  await escrow.dispute(t, a.id, "funder-id");
  await escrow.undispute(t, a.id, "funder-id");
  const refunded = await escrow.refund(t, a.id, "funder-id");
  eq(refunded.state, "refunded");
  const payerAfter = (await ledger.getAccount(t, payer.id)).balance;
  eq(payerAfter - payerBefore, 200_000n, "payer refunded in full after dispute resolved");
});

// ─── 10. Cannot dispute non-funded escrow ────────────────────────────────────

test("dispute: cannot dispute an escrow that is not funded (wrong_state)", async () => {
  const stack = buildSovereignStack();
  const ledger = stack.ledger;
  const t = "tenant-dispute-pre";
  const payer = await ledger.createAccount(t, "p", "asset", "P");
  const worker = await ledger.createAccount(t, "w", "asset", "W");
  await ledger.mint(t, payer.id, 100_000n, "seed", "p", false);
  const escrow = new EscrowService(ledger);
  const a = await escrow.create({ tenantId: t, opportunityId: "o", payerAccountId: payer.id, workerAccountId: worker.id, amount: 50_000n });
  let code = "";
  try { await escrow.dispute(t, a.id, "p"); } catch (e) { if (e instanceof EscrowError) code = e.code; }
  eq(code, "wrong_state", "cannot dispute an unfunded escrow");
});

// ─── 11. Cannot undispute non-disputed escrow ────────────────────────────────

test("undispute: cannot undispute a funded (non-disputed) escrow (wrong_state)", async () => {
  const { t, escrow, a } = await setup();
  let code = "";
  try { await escrow.undispute(t, a.id, "funder-id"); } catch (e) { if (e instanceof EscrowError) code = e.code; }
  eq(code, "wrong_state", "cannot undispute a funded escrow");
});

// ─── 12. Empty initiatedBy rejected ──────────────────────────────────────────

test("dispute/undispute: empty initiatedBy → invalid_input", async () => {
  const { t, escrow, a } = await setup();
  let disputeCode = "";
  try { await escrow.dispute(t, a.id, ""); } catch (e) { if (e instanceof EscrowError) disputeCode = e.code; }
  eq(disputeCode, "invalid_input", "empty initiatedBy rejected for dispute");

  await escrow.dispute(t, a.id, "funder-id");
  let undisputeCode = "";
  try { await escrow.undispute(t, a.id, ""); } catch (e) { if (e instanceof EscrowError) undisputeCode = e.code; }
  eq(undisputeCode, "invalid_input", "empty initiatedBy rejected for undispute");
});

// ─── 13. PgEscrowStore round-trips disputed_by and dispute_reason ─────────────

test("PgEscrowStore: disputed_by and dispute_reason round-trip via put/get", async () => {
  const stack = buildSovereignStack();
  const ledger = stack.ledger;
  const t = "tenant-pg-dispute";
  const payer = await ledger.createAccount(t, "pg-funder", "asset", "P");
  const worker = await ledger.createAccount(t, "pg-worker", "asset", "W");
  await ledger.mint(t, payer.id, 500_000n, "seed", "pg-funder", false);

  const pool = new InMemoryPool();
  const pgStore = new PgEscrowStore(pool);
  await pgStore.init();

  const escrow = new EscrowService(ledger, pgStore);
  const a = await escrow.create({ tenantId: t, opportunityId: "pg-opp", payerAccountId: payer.id, workerAccountId: worker.id, amount: 100_000n });
  await escrow.fund(t, a.id, "pg-funder");
  const disputed = await escrow.dispute(t, a.id, "pg-worker", "deliverable missing");

  eq(disputed.state, "disputed");
  eq(disputed.disputedBy, "pg-worker");
  eq(disputed.disputeReason, "deliverable missing");

  // Verify persistence via direct store read
  const loaded = await pgStore.get(t, a.id);
  assert(loaded !== null, "agreement must persist");
  eq(loaded!.state, "disputed");
  eq(loaded!.disputedBy, "pg-worker");
  eq(loaded!.disputeReason, "deliverable missing");

  // Undispute and verify cleared
  const restored = await escrow.undispute(t, a.id, "pg-funder");
  eq(restored.state, "funded");
  const loadedRestored = await pgStore.get(t, a.id);
  eq(loadedRestored!.state, "funded");
  eq(loadedRestored!.disputedBy, undefined, "disputedBy cleared in store after undispute");
});

// ─── 14. Tenant isolation: dispute on wrong tenant = not_found ────────────────

test("dispute: cross-tenant dispute attempt → not_found (tenant isolation)", async () => {
  const { t, escrow, a } = await setup();
  let code = "";
  try { await escrow.dispute("other-tenant", a.id, "attacker"); } catch (e) { if (e instanceof EscrowError) code = e.code; }
  eq(code, "not_found", "cross-tenant dispute attempt fails with not_found");
  eq((await escrow.get(t, a.id))!.state, "funded", "original escrow unaffected");
});
