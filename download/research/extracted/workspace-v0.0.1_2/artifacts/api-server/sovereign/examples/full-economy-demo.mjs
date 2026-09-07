/**
 * examples/full-economy-demo.mjs — full economy flow demo.
 *
 * Runs the complete TFA coordination-economy loop end-to-end:
 *   1. Identity — register human + agent identities (delegation chain)
 *   2. Ledger — create accounts, mint μ¢
 *   3. Recommendation — analyze strengths, match collaborators
 *   4. Escrow — open agreement via CollaborationEscrowBridge
 *   5. Fund — payer→escrow via LedgerOrchestrator
 *   6. Release — escrow→worker (completeCollaboration)
 *   7. Passport — signed proof of the completion action
 *   8. Third-party verification — verify passport with only the public key
 *
 * Run: node examples/full-economy-demo.mjs
 */

import { buildSovereignStack, defaultPolicies, bridgeForTenant } from "../src/composition.ts";
import { InMemoryLedger } from "../lib/ledger/in-memory-ledger.ts";
import { generateAuditKeyPair } from "../lib/orchestrator/signer.ts";
import { verifyPassport } from "../scripts/verify-passport.mjs";

const TENANT = "demo-tenant";
const ok = (m) => { console.log("  ✓", m); };
const info = (m) => { console.log("\n[", m, "]"); };

export async function runDemo() {
  console.log("\n=== TFA — Full Economy Demo ===\n");

  // ── 1. Build sovereign stack with Ed25519 (asymmetric, third-party verifiable)
  info("setup");
  const kp = generateAuditKeyPair();
  const stack = buildSovereignStack(defaultPolicies(), { signerKind: "ed25519", ed25519KeyPair: kp, provider: new InMemoryLedger() });
  ok("stack built (Ed25519 signer)");
  ok(`publicKey available: ${stack.publicKey ? "yes" : "no"}`);

  // ── 2. Identity — human roots + agents
  const aliceHuman = { id: "human:alice", tenantId: TENANT, type: "human", parentId: null, createdAt: new Date().toISOString() };
  const bobHuman = { id: "human:bob", tenantId: TENANT, type: "human", parentId: null, createdAt: new Date().toISOString() };
  stack.identities.create(aliceHuman);
  stack.identities.create(bobHuman);
  ok("identities registered (alice + bob)");

  // ── 3. Ledger — accounts + seed money
  const aliceAccount = await stack.ledger.createAccount(TENANT, aliceHuman.id, "asset", "Alice Wallet");
  const bobAccount = await stack.ledger.createAccount(TENANT, bobHuman.id, "asset", "Bob Wallet");
  ok(`accounts created: ${aliceAccount.id}, ${bobAccount.id}`);

  const mintResult = await stack.ledger.mint(TENANT, aliceAccount.id, 1_000_000n, "seed", aliceHuman.id, false);
  if (!mintResult.ok) throw new Error("mint failed: " + mintResult.reason);
  ok(`minted 1,000,000 μ¢ to alice (${mintResult.value.id})`);

  // ── 4. Recommendation — analyze strengths + match collaborators
  info("recommendation");
  const aliceProfile = await stack.potential.analyze({
    userId: "alice",
    tenantId: TENANT,
    knowledgeSignals: [
      { userId: "alice", tenantId: TENANT, nodeType: "skill", category: "technical", weight: 0.9 },
      { userId: "alice", tenantId: TENANT, nodeType: "project", category: "leadership", weight: 0.4 },
    ],
    analyticsSignals: [
      { userId: "alice", tenantId: TENANT, eventType: "task.completed", category: "technical", value: 0.85 },
    ],
  });
  if (!aliceProfile.ok) throw new Error("analyze failed: " + aliceProfile.reason);
  ok(`alice profile: ${aliceProfile.result.strengths.length} strengths`);

  const bobProfile = await stack.potential.analyze({
    userId: "bob",
    tenantId: TENANT,
    knowledgeSignals: [
      { userId: "bob", tenantId: TENANT, nodeType: "skill", category: "leadership", weight: 0.95 },
      { userId: "bob", tenantId: TENANT, nodeType: "achievement", category: "technical", weight: 0.5 },
    ],
    analyticsSignals: [
      { userId: "bob", tenantId: TENANT, eventType: "workflow.run", category: "leadership", value: 0.9 },
    ],
  });
  if (!bobProfile.ok) throw new Error("analyze failed: " + bobProfile.reason);
  ok(`bob profile: ${bobProfile.result.strengths.length} strengths`);

  const matches = stack.collaborationMatcher.match({
    tenantId: TENANT,
    userId: "alice",
    userProfile: aliceProfile.result,
    candidates: [
      { userId: "bob", profile: bobProfile.result },
    ],
  });
  if (matches.length === 0) throw new Error("no collaboration match found");
  const match = matches[0];
  ok(`collaboration match: ${match.userA} ↔ ${match.userB} (score ${match.compatibilityScore})`);

  // ── 5. Escrow — open agreement via bridge
  info("escrow");
  const bridge = bridgeForTenant(stack, TENANT);
  const openResult = await bridge.openEscrow({
    tenantId: TENANT,
    match,
    opportunityId: "opp:collab-1",
    payerAccountId: aliceAccount.id,
    workerAccountId: bobAccount.id,
    amount: 500_000n,
    initiatedBy: aliceHuman.id,
  });
  if (!openResult.ok) throw new Error("openEscrow failed: " + openResult.reason);
  const escrowId = openResult.agreement.id;
  ok(`escrow opened: ${escrowId} (state: ${openResult.agreement.state})`);
  if (openResult.passport) {
    ok(`openEscrow passport: ${openResult.passport.passportId}`);
  }

  // ── 6. Fund — payer→escrow
  const funded = await stack.escrow.fund(TENANT, escrowId, aliceHuman.id);
  ok(`escrow funded: ${funded.state}`);

  // ── 7. Release — complete collaboration (fund if needed → release)
  info("release");
  const completeResult = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId,
    initiatedBy: aliceHuman.id,
  });
  if (!completeResult.ok) throw new Error("completeCollaboration failed: " + completeResult.reason);
  ok(`escrow released: ${completeResult.agreement.state}`);
  if (!completeResult.passport) throw new Error("passport missing after completion");
  const passport = completeResult.passport;
  ok(`passport issued: ${passport.passportId}`);
  ok(`passport actionType: ${passport.audit.actionType}`);
  ok(`passport outcome: ${passport.policyDecision.outcome}`);

  // ── 8. Third-party verification — zero trust, public key only
  info("third-party verification");
  const report = verifyPassport(passport, { publicKey: stack.publicKey });
  for (const c of report.checks) {
    const icon = c.status === "pass" ? "✓" : c.status === "skipped" ? "~" : "✗";
    console.log(`    ${icon} [${c.status.padEnd(7)}] ${c.name}${c.message ? ": " + c.message : ""}`);
  }
  if (!report.ok) throw new Error("passport verification FAILED");
  ok("passport cryptographically verified (zero trust, public key only)");

  // ── 9. Audit chain verification
  info("audit chain");
  const chain = bridge.audit.getChain(TENANT);
  ok(`audit chain length: ${chain.length}`);
  const completeAudit = chain.find(r => r.id === completeResult.auditId);
  if (!completeAudit) throw new Error("completion audit record not found");
  ok(`audit record found: ${completeAudit.actionType} → ${completeAudit.outcome}`);

  // ── 10. Ledger balances
  const aliceFinal = await stack.ledger.getAccount(TENANT, aliceAccount.id);
  const bobFinal = await stack.ledger.getAccount(TENANT, bobAccount.id);
  ok(`alice balance: ${aliceFinal.balance} μ¢`);
  ok(`bob balance: ${bobFinal.balance} μ¢`);
  if (bobFinal.balance !== 500_000n) throw new Error(`bob expected 500000 μ¢, got ${bobFinal.balance}`);

  console.log("\n✅ Full economy demo complete.\n");
  return {
    stack,
    aliceAccount,
    bobAccount,
    match,
    escrowId,
    passport,
    report,
    chain,
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}` ||
               import.meta.url.endsWith(process.argv[1]);
if (isMain) {
  runDemo().catch((e) => {
    console.error("\n✗ Demo failed:", e.message);
    process.exitCode = 1;
  });
}
