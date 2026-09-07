/**
 * examples/quickstart.mjs — TFA quickstart in <60 seconds, zero dependencies.
 *
 * The five-step journey every new organization runs first:
 *   1. Register — create tenant with human root + delegated agent.
 *   2. Define policy — spending cap as data (governance without code changes).
 *   3. Agent operates — agent opens an escrow, human funds it, work is released.
 *   4. Passport verified — cryptographic proof of the action, third-party verifiable.
 *   5. Track record rises — trust score climbs from neutral (50) as provable history grows.
 *
 * Run: node examples/quickstart.mjs
 */

import { buildSovereignStack, defaultPolicies, bridgeForTenant } from "../src/composition.ts";
import { InMemoryLedger } from "../lib/ledger/in-memory-ledger.ts";
import { generateAuditKeyPair } from "../lib/orchestrator/signer.ts";
import { verifyPassport } from "../scripts/verify-passport.mjs";
import { computeTrackRecord } from "../lib/track-record/index.ts";

const TENANT = "acme-corp";
const ok = (m) => { console.log("  ✓", m); };
const info = (m) => { console.log("\n[", m, "]"); };

export async function runQuickstart() {
  console.log("\n=== TFA Quickstart — 5 Steps to Verified Trust ===\n");

  // ── 1. Register — build stack with asymmetric signing (third-party verifiable) ──
  info("1. Register organization");
  const kp = generateAuditKeyPair();
  // Custom policy: tighter cap for the demo (still data, not code)
  const policies = defaultPolicies("2000000"); // 20.00 USD in μ¢
  const stack = buildSovereignStack(policies, {
    signerKind: "ed25519",
    ed25519KeyPair: kp,
    provider: new InMemoryLedger(),
  });
  ok("sovereign stack built (Ed25519 signer)");

  // Human root + delegated agent (canonical identity chain)
  const aliceId = "human:alice";
  const bobId = "agent:bob";
  stack.identities.create({ id: aliceId, tenantId: TENANT, type: "human", parentId: null, createdAt: new Date().toISOString() });
  stack.identities.create({ id: bobId, tenantId: TENANT, type: "agent", parentId: aliceId, createdAt: new Date().toISOString() });
  ok(`identity chain: ${aliceId} → ${bobId}`);

  // ── 2. Define policy — already compiled into the stack; show the active rules ──
  info("2. Define policy");
  ok(`active policies: ${stack.policies.length}`);
  const capPolicy = stack.policies.find((p) => p.name === "tx-spending-cap");
  ok(capPolicy ? "spending-cap policy loaded" : "spending-cap missing");

  // ── 3. Agent operates — ledger + escrow under policy + delegation ──
  info("3. Agent operates");
  const aliceAccount = await stack.ledger.createAccount(TENANT, aliceId, "asset", "Alice Wallet");
  ok(`account created: ${aliceAccount.id}`);

  const mintResult = await stack.ledger.mint(TENANT, aliceAccount.id, 1_000_000n, "seed", aliceId, false);
  if (!mintResult.ok) throw new Error("mint failed: " + mintResult.reason);
  ok(`minted 1,000,000 μ¢ to alice (${mintResult.value.id})`);

  // Baseline track record before any escrow activity
  const bridge = bridgeForTenant(stack, TENANT);
  const before = await computeTrackRecord(stack.orchestrator.audit, stack.escrowStore, TENANT, aliceId);
  ok(`track record baseline: score=${before.score} (neutral = no history)`);

  // Agent (bob) opens the work agreement; bridge funds and releases
  const workerAccount = await stack.ledger.createAccount(TENANT, bobId, "asset", "Bob Wallet");
  const openResult = await bridge.openEscrow({
    tenantId: TENANT,
    match: { tenantId: TENANT, userA: aliceId, userB: bobId, compatibilityScore: 0.95 },
    opportunityId: "opp:quickstart-1",
    payerAccountId: aliceAccount.id,
    workerAccountId: workerAccount.id,
    amount: 300_000n,
    initiatedBy: aliceId,
  });
  if (!openResult.ok) throw new Error("openEscrow failed: " + openResult.reason);
  const escrowId = openResult.agreement.id;
  ok(`escrow opened: ${escrowId} (state: ${openResult.agreement.state})`);

  // Bridge completes: funds if needed, releases, and issues a signed passport
  const completeResult = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId,
    initiatedBy: aliceId,
  });
  if (!completeResult.ok) throw new Error("completeCollaboration failed: " + completeResult.reason);
  ok(`escrow completed: ${completeResult.agreement.state}`);
  if (!completeResult.passport) throw new Error("passport missing after completion");
  const passport = completeResult.passport;
  ok(`passport issued: ${passport.passportId}`);

  // ── 4. Passport verified — signed proof of the completion action ──
  info("4. Passport verified");
  const report = verifyPassport(passport, { publicKey: stack.publicKey });
  if (!report.ok) throw new Error("passport verification FAILED");
  ok("passport cryptographically verified (zero trust, public key only)");

  // ── 5. Track record rises — trust score climbs with every settled escrow ──
  info("5. Track record rises");
  const after = await computeTrackRecord(stack.orchestrator.audit, stack.escrowStore, TENANT, aliceId);
  ok(`track record after: score=${after.score} (${after.explanation.join("; ")})`);

  if (after.score <= before.score) throw new Error(`expected track record to rise: ${before.score} → ${after.score}`);
  ok(`trust rose: ${before.score} → ${after.score} (+${after.score - before.score})`);

  // Final balances
  const aliceFinal = await stack.ledger.getAccount(TENANT, aliceAccount.id);
  const bobFinal = await stack.ledger.getAccount(TENANT, workerAccount.id);
  ok(`alice balance: ${aliceFinal.balance} μ¢`);
  ok(`bob balance: ${bobFinal.balance} μ¢`);

  console.log("\n✅ Quickstart complete — verified trust in 5 steps.\n");
  return {
    stack,
    aliceAccount,
    workerAccount,
    escrowId,
    passport,
    report,
    before,
    after,
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}` ||
               import.meta.url.endsWith(process.argv[1]);
if (isMain) {
  runQuickstart().catch((e) => {
    console.error("\n✗ Quickstart failed:", e.message);
    process.exitCode = 1;
  });
}
