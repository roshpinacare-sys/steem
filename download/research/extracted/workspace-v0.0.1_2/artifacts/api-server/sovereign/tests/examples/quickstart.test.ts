import "../_flush.mjs";
/**
 * tests/examples/quickstart.test.ts
 *
 * Coverage for examples/quickstart.mjs:
 *   • Happy path: full quickstart flow returns expected objects
 *   • Edge case: track record rises from 50 to >50 after settlement
 *   • Edge case: passport is valid and cryptographically verifiable
 *   • Edge case: tampered passport → verifyPassport fails (hash mismatch)
 *   • Failure case: wrong public key → verifyPassport signature fails
 *   • Failure case: verifyPassport with missing fields → shape fail
 *   • Tenant isolation: track record for wrong tenant is neutral (50)
 *   • Balance invariant: alice has 700_000 μ¢, bob has 300_000 μ¢ after release
 */

import { test, assert, eq } from "../_harness.mjs";
import { runQuickstart } from "../../examples/quickstart.mjs";
import { verifyPassport } from "../../scripts/verify-passport.mjs";
import { buildSovereignStack, bridgeForTenant } from "../../src/composition.ts";
import { generateAuditKeyPair } from "../../lib/orchestrator/signer.ts";
import { computeTrackRecord } from "../../lib/track-record/index.ts";

const TENANT = "acme-corp";

// ═══════════════════════════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════════════════════════

test("quickstart: happy path completes without error", async () => {
  const result = await runQuickstart();
  assert(result !== undefined, "quickstart must return a result object");
});

test("quickstart result contains alice and worker accounts", async () => {
  const { aliceAccount, workerAccount } = await runQuickstart();
  assert(typeof aliceAccount.id === "string" && aliceAccount.id.length > 0, "aliceAccount.id must be present");
  assert(typeof workerAccount.id === "string" && workerAccount.id.length > 0, "workerAccount.id must be present");
});

test("quickstart result contains an escrow agreement id", async () => {
  const { escrowId } = await runQuickstart();
  assert(typeof escrowId === "string" && escrowId.length > 0, "escrowId must be a non-empty string");
});

test("quickstart result contains a valid passport", async () => {
  const { passport } = await runQuickstart();
  eq(passport.version, "1", "passport version must be 1");
  assert(typeof passport.passportId === "string" && passport.passportId.length > 0, "passportId must be present");
  eq(passport.audit.actionType, "potential.collaboration.complete", "actionType must be potential.collaboration.complete");
  eq(passport.policyDecision.outcome, "allowed", "outcome must be allowed");
});

test("quickstart result contains successful verification report", async () => {
  const { report } = await runQuickstart();
  eq(report.ok, true, "verification report must be ok");
  assert(report.checks.length > 0, "checks array must not be empty");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Track record — the core value proposition
// ═══════════════════════════════════════════════════════════════════════════════

test("track record rises from neutral 50 after settlement", async () => {
  const { before, after } = await runQuickstart();
  eq(before.score, 50, "baseline score must be neutral (50)");
  assert(after.score > 50, `after score must rise above 50, got ${after.score}`);
  assert(after.settledAsFunder >= 1, "after must count at least one settlement as funder");
});

test("track record explanation mentions settled escrow", async () => {
  const { after } = await runQuickstart();
  assert(after.explanation.some((e: string) => e.includes("settled")), "explanation must mention settlement");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Balance invariants
// ═══════════════════════════════════════════════════════════════════════════════

test("balance invariant: alice has 700000 μ¢ after spending 300000 of 1000000", async () => {
  const { stack, aliceAccount } = await runQuickstart();
  const alice = await stack.ledger.getAccount(TENANT, aliceAccount.id);
  eq(alice.balance, 700_000n, "alice balance must be exactly 700000 μ¢");
});

test("balance invariant: bob received exactly 300000 μ¢", async () => {
  const { stack, workerAccount } = await runQuickstart();
  const bob = await stack.ledger.getAccount(TENANT, workerAccount.id);
  eq(bob.balance, 300_000n, "bob balance must be exactly 300000 μ¢");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases — passport verification
// ═══════════════════════════════════════════════════════════════════════════════

test("edge: tampered passport tenantId → verifyPassport fails", async () => {
  const { passport } = await runQuickstart();
  const tampered = JSON.parse(JSON.stringify(passport));
  tampered.tenantId = "evil-tenant";
  const report = verifyPassport(tampered, { publicKey: null as any });
  eq(report.ok, false, "tampered passport must fail verification");
  const hashCheck = report.checks.find((c) => c.name === "passport.hash");
  assert(hashCheck?.status === "fail", "tampered passport must fail hash check");
});

test("edge: wrong public key → signature verification fails", async () => {
  const { passport } = await runQuickstart();
  const wrongKp = generateAuditKeyPair();
  const report = verifyPassport(passport, { publicKey: wrongKp.publicKey });
  eq(report.ok, false, "wrong public key must fail verification");
  const sigCheck = report.checks.find((c) => c.name === "passport.signature.ed25519");
  assert(sigCheck?.status === "fail", "signature check must fail with wrong key");
});

test("edge: verifyPassport with null input fails shape check", () => {
  const report = verifyPassport(null, { publicKey: "abc" });
  eq(report.ok, false, "null passport must fail");
  eq(report.checks[0].name, "shape", "first check must be shape");
  eq(report.checks[0].status, "fail", "shape must fail");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Failure cases
// ═══════════════════════════════════════════════════════════════════════════════

test("failure: double-complete on already-released escrow → ok=false", async () => {
  const { stack, escrowId } = await runQuickstart();
  const bridge = bridgeForTenant(stack, TENANT);
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId,
    initiatedBy: "human:alice",
  });
  eq(result.ok, false, "double-complete must fail");
  assert(
    result.reason.toLowerCase().includes("wrong_state") ||
    result.reason.toLowerCase().includes("requires 'funded'"),
    "reason must mention wrong state: " + result.reason,
  );
});

test("failure: track record for wrong tenant is neutral (50)", async () => {
  const { stack } = await runQuickstart();
  const wrong = await computeTrackRecord(stack.orchestrator.audit, stack.escrowStore, "wrong-tenant", "human:alice");
  eq(wrong.score, 50, "track record for wrong tenant must be neutral");
  eq(wrong.settledAsFunder, 0, "no settlements leaked across tenants");
});

test("failure: verifyPassport with empty object fails version check", () => {
  const report = verifyPassport({}, { publicKey: "abc" });
  eq(report.ok, false, "empty object must fail");
  const versionCheck = report.checks.find((c) => c.name === "shape.version");
  assert(versionCheck?.status === "fail", "version check must fail");
});
