import "../_flush.mjs";
/**
 * tests/escrow/settlement.test.ts — Settlement State-Machine.
 * Coverage: full happy path with partial release, dispute→reverse, tenant isolation,
 * unauthorized access, fail-closed state machine, invalid input, edge cases.
 */
import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { SettlementService, SettlementError } from "../../lib/escrow/index.ts";

async function setup() {
  const stack = buildSovereignStack();
  const ledger = stack.ledger;
  const t = "tenant-settle";
  const payer = await ledger.createAccount(t, "owner-1", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker-1", "asset", "Worker");
  const mint = await ledger.mint(t, payer.id, 1_000_000n, "seed", "test", false);
  assert(mint.ok, "seed mint must pass");
  return { ledger, t, payer, worker, service: new SettlementService(ledger) };
}

// ─── Happy path ───────────────────────────────────────────────────────────────

test("settlement: create→fund→release moves μ¢ payer→escrow→worker", async () => {
  const { ledger, t, payer, worker, service } = await setup();
  const a = await service.create({
    tenantId: t, opportunityId: "opp-1",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 250_000n, settledBy: "owner-1",
  });
  eq(a.state, "created");
  eq(a.releasedAmount, 0n);

  const funded = await service.fund(t, a.id, "owner-1");
  eq(funded.state, "held");
  assert(funded.fundAuditId, "fund records kernel auditId");
  const esc = await ledger.getAccount(t, a.escrowAccountId);
  eq(esc.balance, 250_000n, "escrow holds the funds");

  const released = await service.release(t, a.id, "owner-1");
  eq(released.state, "released");
  eq(released.releasedAmount, 250_000n);
  const w = await ledger.getAccount(t, worker.id);
  eq(w.balance, 250_000n, "worker paid in full");
  const escAfter = await ledger.getAccount(t, a.escrowAccountId);
  eq(escAfter.balance, 0n, "escrow emptied");
});

test("settlement: partialRelease milestone path", async () => {
  const { ledger, t, payer, worker, service } = await setup();
  const a = await service.create({
    tenantId: t, opportunityId: "opp-2",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 300_000n, settledBy: "owner-1",
  });
  await service.fund(t, a.id, "owner-1");

  const p1 = await service.partialRelease(t, a.id, 100_000n, "owner-1");
  eq(p1.state, "partially_released");
  eq(p1.releasedAmount, 100_000n);
  eq((await ledger.getAccount(t, worker.id)).balance, 100_000n);

  const p2 = await service.partialRelease(t, a.id, 100_000n, "owner-1");
  eq(p2.state, "partially_released");
  eq(p2.releasedAmount, 200_000n);

  const p3 = await service.partialRelease(t, a.id, 100_000n, "owner-1");
  eq(p3.state, "released");
  eq(p3.releasedAmount, 300_000n);
  eq((await ledger.getAccount(t, worker.id)).balance, 300_000n);
  eq((await ledger.getAccount(t, a.escrowAccountId)).balance, 0n);
});

test("settlement: partialRelease then release drains remainder", async () => {
  const { ledger, t, payer, worker, service } = await setup();
  const a = await service.create({
    tenantId: t, opportunityId: "opp-3",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 500_000n, settledBy: "owner-1",
  });
  await service.fund(t, a.id, "owner-1");
  await service.partialRelease(t, a.id, 150_000n, "owner-1");

  const rel = await service.release(t, a.id, "owner-1");
  eq(rel.state, "released");
  eq(rel.releasedAmount, 500_000n);
  eq((await ledger.getAccount(t, worker.id)).balance, 500_000n);
});

// ─── Dispute & reverse ────────────────────────────────────────────────────────

test("settlement: dispute freezes active settlement; reverse returns funds to payer", async () => {
  const { ledger, t, payer, worker, service } = await setup();
  const a = await service.create({
    tenantId: t, opportunityId: "opp-4",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 200_000n, settledBy: "owner-1",
  });
  await service.fund(t, a.id, "owner-1");
  await service.partialRelease(t, a.id, 50_000n, "owner-1");

  const d = await service.dispute(t, a.id, "worker-1", "deliverable incomplete");
  eq(d.state, "disputed");
  eq(d.disputedBy, "worker-1");
  eq(d.disputeReason, "deliverable incomplete");

  const beforePayer = (await ledger.getAccount(t, payer.id)).balance;
  const rev = await service.reverse(t, a.id, "owner-1");
  eq(rev.state, "reversed");
  assert(rev.reversalAuditId, "reverse records auditId");
  const afterPayer = (await ledger.getAccount(t, payer.id)).balance;
  eq(afterPayer - beforePayer, 150_000n, "unreleased funds returned to payer");
});

test("settlement: reverse with nothing left to return still marks reversed", async () => {
  const { t, payer, worker, service } = await setup();
  const a = await service.create({
    tenantId: t, opportunityId: "opp-5",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner-1",
  });
  await service.fund(t, a.id, "owner-1");
  await service.release(t, a.id, "owner-1");

  // Manually move to disputed (not realistic, but tests edge case)
  const raw = await service.get(t, a.id);
  (raw as any).state = "disputed";
  await (service as any).store.put(raw);

  const rev = await service.reverse(t, a.id, "owner-1");
  eq(rev.state, "reversed");
  eq(rev.reversalAuditId, undefined, "no transfer needed when nothing remains");
});

// ─── Fail-closed state machine ────────────────────────────────────────────────

test("settlement: illegal transitions rejected (double-release, release-before-fund, etc.)", async () => {
  const { t, payer, worker, service } = await setup();
  const a = await service.create({
    tenantId: t, opportunityId: "opp-6",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner-1",
  });

  let threw = 0;
  // release before fund
  try { await service.release(t, a.id, "owner-1"); } catch (e) { if (e instanceof SettlementError && e.code === "wrong_state") threw++; }
  // partialRelease before fund
  try { await service.partialRelease(t, a.id, 10_000n, "owner-1"); } catch (e) { if (e instanceof SettlementError && e.code === "wrong_state") threw++; }

  await service.fund(t, a.id, "owner-1");
  await service.release(t, a.id, "owner-1");

  // release after release
  try { await service.release(t, a.id, "owner-1"); } catch (e) { if (e instanceof SettlementError && e.code === "wrong_state") threw++; }
  // partialRelease after release
  try { await service.partialRelease(t, a.id, 10_000n, "owner-1"); } catch (e) { if (e instanceof SettlementError && e.code === "wrong_state") threw++; }
  // dispute after release
  try { await service.dispute(t, a.id, "worker-1"); } catch (e) { if (e instanceof SettlementError && e.code === "wrong_state") threw++; }

  eq(threw, 5, "all five illegal transitions rejected");
});

test("settlement: dispute blocks release and partialRelease", async () => {
  const { t, payer, worker, service } = await setup();
  const a = await service.create({
    tenantId: t, opportunityId: "opp-7",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner-1",
  });
  await service.fund(t, a.id, "owner-1");
  await service.dispute(t, a.id, "worker-1");

  let threw = 0;
  try { await service.release(t, a.id, "owner-1"); } catch (e) { if (e instanceof SettlementError && e.code === "wrong_state") threw++; }
  try { await service.partialRelease(t, a.id, 10_000n, "owner-1"); } catch (e) { if (e instanceof SettlementError && e.code === "wrong_state") threw++; }
  eq(threw, 2, "release and partialRelease blocked while disputed");
});

test("settlement: reverse only from disputed", async () => {
  const { t, payer, worker, service } = await setup();
  const a = await service.create({
    tenantId: t, opportunityId: "opp-8",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner-1",
  });
  await service.fund(t, a.id, "owner-1");

  let code = "";
  try { await service.reverse(t, a.id, "owner-1"); } catch (e) { if (e instanceof SettlementError) code = e.code; }
  eq(code, "wrong_state", "reverse from held rejected");
});

// ─── Input validation ───────────────────────────────────────────────────────

test("settlement: invalid inputs rejected at creation", async () => {
  const { t, payer, worker, service } = await setup();
  let bad = 0;
  for (const input of [
    { tenantId: t, opportunityId: "o", payerAccountId: payer.id, workerAccountId: worker.id, totalAmount: 0n, settledBy: "x" },
    { tenantId: t, opportunityId: "o", payerAccountId: payer.id, workerAccountId: payer.id, totalAmount: 1n, settledBy: "x" },
    { tenantId: "", opportunityId: "o", payerAccountId: payer.id, workerAccountId: worker.id, totalAmount: 1n, settledBy: "x" },
    { tenantId: t, opportunityId: "o", payerAccountId: payer.id, workerAccountId: worker.id, totalAmount: 1n, settledBy: "" },
  ]) {
    try { await service.create(input as any); } catch (e) { if (e instanceof SettlementError && e.code === "invalid_input") bad++; }
  }
  eq(bad, 4, "all invalid creation inputs rejected");
});

test("settlement: partialRelease rejects non-positive amount", async () => {
  const { t, payer, worker, service } = await setup();
  const a = await service.create({
    tenantId: t, opportunityId: "opp-9",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner-1",
  });
  await service.fund(t, a.id, "owner-1");

  let bad = 0;
  try { await service.partialRelease(t, a.id, 0n, "owner-1"); } catch (e) { if (e instanceof SettlementError && e.code === "invalid_input") bad++; }
  try { await service.partialRelease(t, a.id, -1n, "owner-1"); } catch (e) { if (e instanceof SettlementError && e.code === "invalid_input") bad++; }
  eq(bad, 2, "zero and negative amounts rejected");
});

test("settlement: partialRelease rejects amount exceeding remaining", async () => {
  const { t, payer, worker, service } = await setup();
  const a = await service.create({
    tenantId: t, opportunityId: "opp-10",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner-1",
  });
  await service.fund(t, a.id, "owner-1");
  await service.partialRelease(t, a.id, 60_000n, "owner-1");

  let code = "";
  try { await service.partialRelease(t, a.id, 50_000n, "owner-1"); } catch (e) { if (e instanceof SettlementError) code = e.code; }
  eq(code, "insufficient_funds");
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

test("settlement: cross-tenant access behaves as not_found", async () => {
  const { t, payer, worker, service } = await setup();
  const a = await service.create({
    tenantId: t, opportunityId: "opp-11",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 50_000n, settledBy: "owner-1",
  });
  eq(await service.get("other-tenant", a.id), null, "cross-tenant get = null");

  let code = "";
  try { await service.fund("other-tenant", a.id, "owner-1"); } catch (e) { if (e instanceof SettlementError) code = e.code; }
  eq(code, "not_found", "cross-tenant fund behaves as not_found");
});

// ─── Authorization ──────────────────────────────────────────────────────────

test("settlement: unauthorized caller denied on fund/release/partialRelease/reverse", async () => {
  const { t, payer, worker, service } = await setup();
  const a = await service.create({
    tenantId: t, opportunityId: "opp-12",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner-1",
  });

  let denied = 0;
  // fund on created (wrong caller)
  try { await service.fund(t, a.id, "mallory"); } catch (e) { if (e instanceof SettlementError && e.code === "unauthorized") denied++; }

  await service.fund(t, a.id, "owner-1");
  try { await service.release(t, a.id, "mallory"); } catch (e) { if (e instanceof SettlementError && e.code === "unauthorized") denied++; }
  try { await service.partialRelease(t, a.id, 10_000n, "mallory"); } catch (e) { if (e instanceof SettlementError && e.code === "unauthorized") denied++; }

  await service.dispute(t, a.id, "worker-1");
  try { await service.reverse(t, a.id, "mallory"); } catch (e) { if (e instanceof SettlementError && e.code === "unauthorized") denied++; }

  eq(denied, 4, "all four unauthorized operations denied");
  eq((await service.get(t, a.id))!.state, "disputed", "state unchanged after denied reverse");
});

test("settlement: anyone may raise a dispute", async () => {
  const { t, payer, worker, service } = await setup();
  const a = await service.create({
    tenantId: t, opportunityId: "opp-13",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner-1",
  });
  await service.fund(t, a.id, "owner-1");

  const d = await service.dispute(t, a.id, "random-third-party", "concern");
  eq(d.state, "disputed");
  eq(d.disputedBy, "random-third-party");
});

test("settlement: empty/missing identity denied (fail-closed)", async () => {
  const { t, payer, worker, service } = await setup();
  const a = await service.create({
    tenantId: t, opportunityId: "opp-14",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner-1",
  });
  await service.fund(t, a.id, "owner-1");

  let code = "";
  try { await service.release(t, a.id, ""); } catch (e) { if (e instanceof SettlementError) code = e.code; }
  eq(code, "unauthorized");
});

// ─── Ledger denial keeps state ────────────────────────────────────────────────

test("settlement: guard denial on fund keeps state created", async () => {
  const { ledger, t, payer, worker, service } = await setup();
  // default policy caps at 100,000,000 μ¢ — exceed it
  const big = await ledger.mint(t, payer.id, 90_000_000n, "more seed", "test", false);
  assert(big.ok, "seed under cap passes");

  const a = await service.create({
    tenantId: t, opportunityId: "opp-15",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 200_000_000n, settledBy: "owner-1",
  });
  let denied = false;
  try { await service.fund(t, a.id, "owner-1"); } catch (e) { if (e instanceof SettlementError && e.code === "ledger_denied") denied = true; }
  assert(denied, "policy cap denies the funding");
  const after = await service.get(t, a.id);
  eq(after!.state, "created", "state unchanged after denial");
});

// ─── List isolation ───────────────────────────────────────────────────────────

test("settlement: list is tenant-isolated", async () => {
  const { ledger, service } = await setup();
  const p1 = await ledger.createAccount("t-a", "p1", "asset", "P");
  const w1 = await ledger.createAccount("t-a", "w1", "asset", "W");
  const p2 = await ledger.createAccount("t-b", "p2", "asset", "P");
  const w2 = await ledger.createAccount("t-b", "w2", "asset", "W");
  await ledger.mint("t-a", p1.id, 100_000n, "s", "x", false);
  await ledger.mint("t-b", p2.id, 100_000n, "s", "x", false);

  const a1 = await service.create({
    tenantId: "t-a", opportunityId: "o",
    payerAccountId: p1.id, workerAccountId: w1.id,
    totalAmount: 10_000n, settledBy: "auth-a",
  });
  const a2 = await service.create({
    tenantId: "t-b", opportunityId: "o",
    payerAccountId: p2.id, workerAccountId: w2.id,
    totalAmount: 20_000n, settledBy: "auth-b",
  });

  const listA = await service.list("t-a");
  const listB = await service.list("t-b");
  eq(listA.length, 1);
  eq(listB.length, 1);
  eq(listA[0].id, a1.id);
  eq(listB[0].id, a2.id);
});

// ─── Audit trail ──────────────────────────────────────────────────────────────

test("settlement: releaseAuditIds accumulate across partial releases", async () => {
  const { t, payer, worker, service } = await setup();
  const a = await service.create({
    tenantId: t, opportunityId: "opp-16",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 300_000n, settledBy: "owner-1",
  });
  await service.fund(t, a.id, "owner-1");

  await service.partialRelease(t, a.id, 100_000n, "owner-1");
  let s = await service.get(t, a.id);
  eq(s!.releaseAuditIds!.length, 1);

  await service.partialRelease(t, a.id, 100_000n, "owner-1");
  s = await service.get(t, a.id);
  eq(s!.releaseAuditIds!.length, 2);

  await service.release(t, a.id, "owner-1");
  s = await service.get(t, a.id);
  eq(s!.releaseAuditIds!.length, 3);
  eq(s!.state, "released");
});
