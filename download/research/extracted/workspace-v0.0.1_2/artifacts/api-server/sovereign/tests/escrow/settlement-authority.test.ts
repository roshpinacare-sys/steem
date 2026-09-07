import "../_flush.mjs";
/**
 * tests/escrow/settlement-authority.test.ts — V84 KEYSTONE: completion is an AGREEMENT.
 * Only the funding authority may release (their release = signed completion) or refund.
 * Anyone else — including the worker who would profit — is denied, state unchanged.
 * This answers the billion-dollar question: "who decides an action completed?" → the payer,
 * cryptographically on the record; disputes never move money silently.
 */
import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { EscrowService, EscrowError } from "../../lib/escrow/index.ts";

async function setup() {
  const stack = buildSovereignStack();
  const t = "keystone";
  const payer = await stack.ledger.createAccount(t, "alice", "asset", "P");
  const worker = await stack.ledger.createAccount(t, "bob", "asset", "W");
  const m = await stack.ledger.mint(t, payer.id, 1_000_000n, "seed", "alice", false);
  assert(m.ok, "seed");
  const escrow = new EscrowService(stack.ledger);
  const a = await escrow.create({ tenantId: t, opportunityId: "o", payerAccountId: payer.id, workerAccountId: worker.id, amount: 100_000n });
  await escrow.fund(t, a.id, "alice");
  return { stack, t, escrow, a, worker };
}

test("KEYSTONE: funder's release succeeds — their call IS the completion agreement", async () => {
  const { t, escrow, a, stack, worker } = await setup();
  const rel = await escrow.release(t, a.id, "alice");
  eq(rel.state, "released");
  eq((await stack.ledger.getAccount(t, worker.id)).balance, 100_000n, "worker paid");
});

test("KEYSTONE: worker cannot release to themselves — unauthorized, state unchanged", async () => {
  const { t, escrow, a } = await setup();
  let code = "";
  try { await escrow.release(t, a.id, "bob"); } catch (e) { if (e instanceof EscrowError) code = e.code; }
  eq(code, "unauthorized");
  eq((await escrow.get(t, a.id))!.state, "funded", "money did not move");
});

test("KEYSTONE: third party cannot release or refund", async () => {
  const { t, escrow, a } = await setup();
  let denied = 0;
  try { await escrow.release(t, a.id, "mallory"); } catch (e) { if (e instanceof EscrowError && e.code === "unauthorized") denied++; }
  try { await escrow.refund(t, a.id, "mallory"); } catch (e) { if (e instanceof EscrowError && e.code === "unauthorized") denied++; }
  eq(denied, 2);
  eq((await escrow.get(t, a.id))!.state, "funded");
});

test("KEYSTONE: funder can refund their own escrow; worker cannot", async () => {
  const { t, escrow, a } = await setup();
  let code = "";
  try { await escrow.refund(t, a.id, "bob"); } catch (e) { if (e instanceof EscrowError) code = e.code; }
  eq(code, "unauthorized");
  const r = await escrow.refund(t, a.id, "alice");
  eq(r.state, "refunded");
});

test("KEYSTONE: empty/missing identity is denied (fail-closed)", async () => {
  const { t, escrow, a } = await setup();
  let code = "";
  try { await escrow.release(t, a.id, ""); } catch (e) { if (e instanceof EscrowError) code = e.code; }
  eq(code, "unauthorized");
});
