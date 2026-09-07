import "../_flush.mjs";
/**
 * tests/escrow/escrow.test.ts — Sovereign Escrow: the coordination-economy primitive.
 * Coverage: full happy path (create→fund→release with real μ¢ movement through the chokepoint),
 * refund path, fail-closed state machine (double-release, release-before-fund), input validation,
 * tenant isolation, guard denial keeps state, and audit trail recorded.
 */
import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { EscrowService, EscrowError } from "../../lib/escrow/index.ts";

async function setup() {
  const stack = buildSovereignStack();
  const ledger = stack.ledger;
  const t = "tenant-escrow";
  const payer = await ledger.createAccount(t, "owner-1", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker-1", "asset", "Worker");
  // seed the payer through the chokepoint
  const mint = await ledger.mint(t, payer.id, 1_000_000n, "seed", "test", false);
  assert(mint.ok, "seed mint must pass");
  return { ledger, t, payer, worker, escrow: new EscrowService(ledger) };
}

test("escrow happy path: create→fund→release moves μ¢ payer→escrow→worker via chokepoint", async () => {
  const { ledger, t, payer, worker, escrow } = await setup();
  const a = await escrow.create({ tenantId: t, opportunityId: "opp-1", payerAccountId: payer.id, workerAccountId: worker.id, amount: 250_000n });
  eq(a.state, "created");
  const funded = await escrow.fund(t, a.id, "owner-1");
  eq(funded.state, "funded");
  assert(funded.fundAuditId, "fund records kernel auditId");
  const esc = await ledger.getAccount(t, a.escrowAccountId);
  eq(esc.balance, 250_000n, "escrow holds the funds in-flight");
  const released = await escrow.release(t, a.id, "owner-1");
  eq(released.state, "released");
  const w = await ledger.getAccount(t, worker.id);
  eq(w.balance, 250_000n, "worker paid on completion");
  const escAfter = await ledger.getAccount(t, a.escrowAccountId);
  eq(escAfter.balance, 0n, "escrow emptied");
});

test("escrow refund path: funded→refunded returns μ¢ to payer", async () => {
  const { ledger, t, payer, worker, escrow } = await setup();
  const a = await escrow.create({ tenantId: t, opportunityId: "opp-2", payerAccountId: payer.id, workerAccountId: worker.id, amount: 100_000n });
  await escrow.fund(t, a.id, "owner-1");
  const before = (await ledger.getAccount(t, payer.id)).balance;
  const refunded = await escrow.refund(t, a.id, "owner-1");
  eq(refunded.state, "refunded");
  const after = (await ledger.getAccount(t, payer.id)).balance;
  eq(after - before, 100_000n, "payer refunded in full");
});

test("fail-closed: release before fund / double release / refund after release all rejected", async () => {
  const { t, payer, worker, escrow } = await setup();
  const a = await escrow.create({ tenantId: t, opportunityId: "opp-3", payerAccountId: payer.id, workerAccountId: worker.id, amount: 50_000n });
  let threw = 0;
  try { await escrow.release(t, a.id, "x"); } catch (e) { if (e instanceof EscrowError && e.code === "wrong_state") threw++; }
  await escrow.fund(t, a.id, "owner-1");
  await escrow.release(t, a.id, "owner-1");
  try { await escrow.release(t, a.id, "x"); } catch (e) { if (e instanceof EscrowError && e.code === "wrong_state") threw++; }
  try { await escrow.refund(t, a.id, "x"); } catch (e) { if (e instanceof EscrowError && e.code === "wrong_state") threw++; }
  eq(threw, 3, "all three illegal transitions rejected");
});

test("input validation: zero amount, same accounts, missing fields → invalid_input", async () => {
  const { t, payer, worker, escrow } = await setup();
  let bad = 0;
  for (const input of [
    { tenantId: t, opportunityId: "o", payerAccountId: payer.id, workerAccountId: worker.id, amount: 0n },
    { tenantId: t, opportunityId: "o", payerAccountId: payer.id, workerAccountId: payer.id, amount: 1n },
    { tenantId: "", opportunityId: "o", payerAccountId: payer.id, workerAccountId: worker.id, amount: 1n },
  ]) {
    try { await escrow.create(input as any); } catch (e) { if (e instanceof EscrowError && e.code === "invalid_input") bad++; }
  }
  eq(bad, 3, "all invalid inputs rejected");
});

test("tenant isolation: agreement invisible from another tenant (not_found)", async () => {
  const { t, payer, worker, escrow } = await setup();
  const a = await escrow.create({ tenantId: t, opportunityId: "opp-4", payerAccountId: payer.id, workerAccountId: worker.id, amount: 10_000n });
  eq(await escrow.get("other-tenant", a.id), null, "cross-tenant get = null");
  let code = "";
  try { await escrow.fund("other-tenant", a.id, "x"); } catch (e) { if (e instanceof EscrowError) code = e.code; }
  eq(code, "not_found", "cross-tenant fund behaves as not_found (fail-closed)");
});

test("guard denial keeps state: over-cap funding denied by policy, escrow stays 'created'", async () => {
  const { ledger, t, payer, worker, escrow } = await setup();
  // default policy caps a single transfer at 100,000,000 μ¢ (1,000 USD) — exceed it
  const big = await ledger.mint(t, payer.id, 90_000_000n, "more seed", "test", false);
  assert(big.ok, "seed under cap passes");
  const a = await escrow.create({ tenantId: t, opportunityId: "opp-5", payerAccountId: payer.id, workerAccountId: worker.id, amount: 200_000_000n });
  let denied = false;
  try { await escrow.fund(t, a.id, "owner-1"); } catch (e) { if (e instanceof EscrowError && e.code === "ledger_denied") denied = true; }
  assert(denied, "policy cap denies the funding");
  const after = await escrow.get(t, a.id);
  eq(after!.state, "created", "state unchanged after denial — no partial effects");
});
