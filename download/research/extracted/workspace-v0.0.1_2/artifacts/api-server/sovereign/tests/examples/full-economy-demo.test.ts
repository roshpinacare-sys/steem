import "../_flush.mjs";
/**
 * tests/examples/full-economy-demo.test.ts
 *
 * Coverage for examples/full-economy-demo.mjs:
 *   • Happy path: full flow returns expected objects (stack, accounts, match, escrow, passport)
 *   • Edge case: tampered passport → verifyPassport fails (hash mismatch)
 *   • Edge case: wrong public key → verifyPassport signature fails
 *   • Failure case: double-complete on already-released escrow → bridge denies
 *   • Failure case: verifyPassport with missing required fields → shape fail
 *   • Tenant isolation: audit chain for wrong tenant is empty
 *   • Balance invariant: bob received exactly 500_000 μ¢, alice has 500_000 μ¢ left
 */

import { test, assert, eq } from "../_harness.mjs";
import { runDemo } from "../../examples/full-economy-demo.mjs";
import { verifyPassport } from "../../scripts/verify-passport.mjs";
import { buildSovereignStack, defaultPolicies, bridgeForTenant } from "../../src/composition.ts";
import { generateAuditKeyPair } from "../../lib/orchestrator/signer.ts";

const TENANT = "demo-tenant";

// ═══════════════════════════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════════════════════════

test("full economy demo: happy path completes without error", async () => {
  const result = await runDemo();
  assert(result !== undefined, "demo must return a result object");
});

test("demo result contains alice and bob accounts", async () => {
  const { aliceAccount, bobAccount } = await runDemo();
  assert(typeof aliceAccount.id === "string" && aliceAccount.id.length > 0, "aliceAccount.id must be present");
  assert(typeof bobAccount.id === "string" && bobAccount.id.length > 0, "bobAccount.id must be present");
});

test("demo result contains a collaboration match", async () => {
  const { match } = await runDemo();
  eq(match.userA, "alice", "match.userA must be alice");
  eq(match.userB, "bob", "match.userB must be bob");
  assert(match.compatibilityScore > 0, "compatibilityScore must be positive");
});

test("demo result contains an escrow agreement id", async () => {
  const { escrowId } = await runDemo();
  assert(typeof escrowId === "string" && escrowId.length > 0, "escrowId must be a non-empty string");
});

test("demo result contains a valid passport", async () => {
  const { passport } = await runDemo();
  eq(passport.version, "1", "passport version must be 1");
  assert(typeof passport.passportId === "string" && passport.passportId.length > 0, "passportId must be present");
  eq(passport.audit.actionType, "potential.collaboration.complete", "actionType must be potential.collaboration.complete");
  eq(passport.policyDecision.outcome, "allowed", "outcome must be allowed");
});

test("demo result contains successful verification report", async () => {
  const { report } = await runDemo();
  eq(report.ok, true, "verification report must be ok");
  assert(report.checks.length > 0, "checks array must not be empty");
});

test("audit chain has records for the tenant", async () => {
  const { chain } = await runDemo();
  assert(chain.length >= 1, "audit chain must have at least one record");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Balance invariants
// ═══════════════════════════════════════════════════════════════════════════════

test("balance invariant: bob received exactly 500000 μ¢", async () => {
  const { stack, bobAccount } = await runDemo();
  const bob = await stack.ledger.getAccount(TENANT, bobAccount.id);
  eq(bob.balance, 500_000n, "bob balance must be exactly 500000 μ¢");
});

test("balance invariant: alice has 500000 μ¢ after funding and release", async () => {
  const { stack, aliceAccount } = await runDemo();
  const alice = await stack.ledger.getAccount(TENANT, aliceAccount.id);
  eq(alice.balance, 500_000n, "alice balance must be exactly 500000 μ¢ after spending 500000 of 1000000");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases — passport verification
// ═══════════════════════════════════════════════════════════════════════════════

test("edge: tampered passport tenantId → verifyPassport fails", async () => {
  const { passport } = await runDemo();
  const tampered = JSON.parse(JSON.stringify(passport));
  tampered.tenantId = "evil-tenant";
  const report = verifyPassport(tampered, { publicKey: null as any });
  eq(report.ok, false, "tampered passport must fail verification");
  const hashCheck = report.checks.find(c => c.name === "passport.hash");
  assert(hashCheck?.status === "fail", "tampered passport must fail hash check");
});

test("edge: wrong public key → signature verification fails", async () => {
  const { passport } = await runDemo();
  const wrongKp = generateAuditKeyPair();
  const report = verifyPassport(passport, { publicKey: wrongKp.publicKey });
  eq(report.ok, false, "wrong public key must fail verification");
  const sigCheck = report.checks.find(c => c.name === "passport.signature.ed25519");
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
  const { stack, escrowId } = await runDemo();
  const bridge = bridgeForTenant(stack, TENANT);
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId,
    initiatedBy: "alice",
  });
  eq(result.ok, false, "double-complete must fail");
  assert(
    result.reason.toLowerCase().includes("wrong_state") ||
    result.reason.toLowerCase().includes("requires 'funded'"),
    "reason must mention wrong state: " + result.reason,
  );
});

test("failure: audit chain for wrong tenant is empty", async () => {
  const { stack } = await runDemo();
  const wrongChain = stack.collaborationEscrowBridge.audit.getChain("nonexistent-tenant");
  eq(wrongChain.length, 0, "audit chain for wrong tenant must be empty");
});

test("failure: verifyPassport with empty object fails version check", () => {
  const report = verifyPassport({}, { publicKey: "abc" });
  eq(report.ok, false, "empty object must fail");
  const versionCheck = report.checks.find(c => c.name === "shape.version");
  assert(versionCheck?.status === "fail", "version check must fail");
});
