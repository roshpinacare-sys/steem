import "../_flush.mjs";
/**
 * tests/composition/approval-wiring.test.ts — v154.
 * Wire PgThresholdApprovalStore into the boot path (MANIFEST "החסר הבא" #1).
 *
 *   FEATURE       a pooled stack reports approvals="pg" and exposes a durable approvalStore.
 *   ROUTE-LOGIC   replay protection survives RESTART through the SAME validation logic the
 *                 settlement route runs (validateAndConsumeApproval over stack.approvalStore):
 *                 a token spent on stack #1 is rejected as "replayed" by a fresh stack #2 over
 *                 the same pool — not just at the unit-store level.
 *   EDGE          no pool → approvals="in-memory", reported honestly.
 *   FAIL-CLOSED   a second use of the same token (same stack) is rejected as replayed.
 */
import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { PgThresholdApprovalStore } from "../../lib/escrow/pg-threshold-approval-store.ts";
import { InMemoryThresholdApprovalStore, generateThresholdApproval, validateAndConsumeApproval, ThresholdApprovalError } from "../../lib/escrow/threshold-approval.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));

// ── FEATURE: pooled stack → durable approval store, reported honestly ──
test("a pooled stack wires a durable PgThresholdApprovalStore and reports approvals=pg", () => {
  const stack = buildSovereignStack(undefined, { pool: new InMemoryPool() } as any);
  eq((stack as any).persistenceReport.approvals, "pg");
  assert((stack as any).approvalStore instanceof PgThresholdApprovalStore, "approvalStore is the Pg store");
});

// ── EDGE: no pool → in-memory, reported honestly ──
test("a pool-less stack uses the in-memory approval store and says so", () => {
  const stack = buildSovereignStack();
  eq((stack as any).persistenceReport.approvals, "in-memory");
  assert((stack as any).approvalStore instanceof InMemoryThresholdApprovalStore, "approvalStore is in-memory");
});

// ── ROUTE-LOGIC + RESTART: a spent token stays spent across a rebuild over the same pool ──
test("replay protection survives restart via the route's own validation logic", async () => {
  const pool = new InMemoryPool();
  const tenant = "tnt-appr";
  const agreementId = "agr-1";
  const amount = 500_000n;

  // Stack #1 (pooled). The settlement route signs with signer.sign("threshold-secret-context").
  // We use signerKind="hmac" explicitly so the signer is deterministic across restarts
  // (Ed25519 is now the default but generates a fresh ephemeral keypair each time).
  const SECRET = "fixed-kernel-secret-across-restart";
  const stack1 = buildSovereignStack(undefined, { pool, auditSecret: SECRET, signerKind: "hmac" } as any);
  await (stack1 as any).approvalStore.init(); // ensure table+preload ready deterministically
  const secret = stack1.signer.sign("threshold-secret-context");
  const approval = generateThresholdApproval(secret, { agreementId, tenantId: tenant, maxAmount: amount, approvedBy: "approver-1" });

  // First use succeeds, second use (same stack) is rejected as replayed.
  validateAndConsumeApproval(secret, approval.token, agreementId, tenant, amount, (stack1 as any).approvalStore);
  let replayedSame = false;
  try { validateAndConsumeApproval(secret, approval.token, agreementId, tenant, amount, (stack1 as any).approvalStore); }
  catch (e) { replayedSame = (e as ThresholdApprovalError).code === "replayed"; }
  assert(replayedSame, "same-stack second use is rejected as replayed");
  await flush(); // let the durable write-through land

  // RESTART: a brand-new stack over the SAME pool must still reject the spent token.
  const stack2 = buildSovereignStack(undefined, { pool, auditSecret: SECRET, signerKind: "hmac" } as any);
  await (stack2 as any).approvalStore.init();
  // Same signer secret across restart (deterministic HMAC over the same kernel secret context).
  const secret2 = stack2.signer.sign("threshold-secret-context");
  eq(secret2, secret, "signer secret is stable across restart (token still verifies)");
  let replayedAfterRestart = false;
  try { validateAndConsumeApproval(secret2, approval.token, agreementId, tenant, amount, (stack2 as any).approvalStore); }
  catch (e) { replayedAfterRestart = (e as ThresholdApprovalError).code === "replayed"; }
  assert(replayedAfterRestart, "after restart the spent approval is STILL rejected (no replay) — the gap is closed");
});
