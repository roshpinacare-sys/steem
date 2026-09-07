import "../_flush.mjs";
/**
 * tests/potential/collaboration-escrow-complete.test.ts
 *
 * Verifies CollaborationEscrowBridge.completeCollaboration — the other side of
 * the coordination-economy loop: fund (if needed) then release through the bridge.
 *
 * Coverage:
 *   Happy path
 *     • completeCollaboration from "created" → funds then releases → state "released"
 *     • completeCollaboration from "funded" → skips fund, releases → state "released"
 *     • returned agreement has correct tenantId, amount, workerAccountId
 *     • auditId is present on success
 *
 *   Passport issuance
 *     • signer wired → passport present on ok=true result
 *     • passport.tenantId matches input tenantId
 *     • passport.audit.actionType = "potential.collaboration.complete"
 *     • no signer wired → passport absent (backward compat)
 *
 *   Fail-closed
 *     • zero policies → deny → ok=false with reason
 *     • denyAll policy → ok=false
 *     • already released escrow → wrong_state → ok=false
 *     • denied result carries auditId
 *     • denied result has no passport
 *
 *   Tenant isolation / validation
 *     • escrow from different tenant → throws immediately
 *     • missing tenantId → throws
 *     • missing escrowId → throws
 *     • unknown escrowId → throws
 *
 *   Audit trail
 *     • after completeCollaboration, audit chain has record for the tenant
 *     • audit record actionType = "potential.collaboration.complete"
 *     • audit record outcome = "allowed" on success / "denied" on deny
 *
 *   Constants
 *     • POTENTIAL_ACTION_TYPES.COLLABORATION_COMPLETE = "potential.collaboration.complete"
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  CollaborationEscrowBridge,
  COLLABORATION_ESCROW_ACTION_TYPE,
  COLLABORATION_COMPLETE_ACTION_TYPE,
} from "../../lib/potential/collaboration-escrow-bridge.ts";
import { POTENTIAL_ACTION_TYPES } from "../../lib/potential/types.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { TfaOrchestrator } from "../../lib/orchestrator/orchestrator.ts";
import { allowAll, denyAll } from "../../lib/orchestrator/guard.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { LedgerOrchestrator } from "../../lib/ledger-orchestrator/ledger-orchestrator.ts";
import type { ActionPassport } from "../../lib/passport/types.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT = "tenant-escrow-complete";
const OTHER_TENANT = "tenant-other";

function makeLedger(policies = [allowAll()]) {
  const provider = new InMemoryLedger();
  const orch = new TfaOrchestrator(policies);
  return new LedgerOrchestrator(provider, orch);
}

async function makeSetup(opts: {
  policies?: ReturnType<typeof allowAll>[];
  signer?: HmacSigner;
  onPassport?: (p: ActionPassport) => void;
} = {}) {
  const { policies = [allowAll()], signer, onPassport } = opts;
  const ledger = makeLedger();

  const payerAcc = await ledger.createAccount(TENANT, "user-a", "asset", "payer wallet");
  const workerAcc = await ledger.createAccount(TENANT, "user-b", "asset", "worker wallet");

  // Seed payer so fund can succeed
  const provider = (ledger as any).provider as InMemoryLedger;
  await provider.guardMint(TENANT, payerAcc.id, 100_000n, "seed", "test");

  const bridge = new CollaborationEscrowBridge(
    policies,
    ledger,
    undefined,
    undefined,
    signer ? { signer, onPassport } : {},
  );

  // Create an escrow agreement in "created" state via the bridge's internal escrow service
  const agreement = await bridge["escrow"].create({
    tenantId: TENANT,
    opportunityId: "opp-complete-1",
    payerAccountId: payerAcc.id,
    workerAccountId: workerAcc.id,
    amount: 50_000n,
  });

  return { bridge, payerAcc, workerAcc, agreement };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

test("POTENTIAL_ACTION_TYPES.COLLABORATION_COMPLETE = 'potential.collaboration.complete'", () => {
  eq(
    POTENTIAL_ACTION_TYPES.COLLABORATION_COMPLETE,
    "potential.collaboration.complete",
    "constant must have the canonical action type string",
  );
  eq(
    COLLABORATION_COMPLETE_ACTION_TYPE,
    "potential.collaboration.complete",
    "exported COLLABORATION_COMPLETE_ACTION_TYPE must match",
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════════════════════════

test("completeCollaboration: created→funded→released in one call", async () => {
  const { bridge, agreement } = await makeSetup();
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId: agreement.id,
    initiatedBy: "test",
  });
  eq(result.ok, true, "allowAll policy must allow completion");
  if (!result.ok) return;
  eq(result.agreement.state, "released", "final state must be released");
  eq(result.agreement.amount, 50_000n, "amount must be unchanged");
});

test("completeCollaboration: already funded → skips fund, releases directly", async () => {
  const { bridge, agreement } = await makeSetup();
  // Pre-fund the escrow
  await bridge["escrow"].fund(TENANT, agreement.id, "test");

  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId: agreement.id,
    initiatedBy: "test",
  });
  eq(result.ok, true, "must succeed on pre-funded escrow");
  if (!result.ok) return;
  eq(result.agreement.state, "released", "final state must be released");
});

test("completeCollaboration: returned agreement has correct tenantId and workerAccountId", async () => {
  const { bridge, agreement, workerAcc } = await makeSetup();
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId: agreement.id,
    initiatedBy: "test",
  });
  assert(result.ok, "must succeed");
  if (!result.ok) return;
  eq(result.agreement.tenantId, TENANT, "tenantId must match");
  eq(result.agreement.workerAccountId, workerAcc.id, "workerAccountId must match");
});

test("completeCollaboration: auditId is present on success", async () => {
  const { bridge, agreement } = await makeSetup();
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId: agreement.id,
    initiatedBy: "test",
  });
  assert(result.ok, "must succeed");
  if (!result.ok) return;
  assert(typeof result.auditId === "string" && result.auditId.length > 0, "auditId must be non-empty string");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Passport issuance
// ═══════════════════════════════════════════════════════════════════════════════

test("passport: signer wired → passport present on ok=true", async () => {
  const signer = new HmacSigner("collab-complete-test-secret-32b!!");
  const { bridge, agreement } = await makeSetup({ signer });
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId: agreement.id,
    initiatedBy: "test",
  });
  assert(result.ok, "must succeed");
  if (!result.ok) return;
  assert(result.passport !== undefined, "passport must be present when signer is wired");
});

test("passport: passport.tenantId matches input tenantId", async () => {
  const signer = new HmacSigner("collab-complete-test-secret-32b!!");
  const { bridge, agreement } = await makeSetup({ signer });
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId: agreement.id,
    initiatedBy: "test",
  });
  assert(result.ok, "must succeed");
  if (!result.ok) return;
  eq(result.passport!.tenantId, TENANT, "passport.tenantId must match");
});

test("passport: passport.audit.actionType = 'potential.collaboration.complete'", async () => {
  const signer = new HmacSigner("collab-complete-test-secret-32b!!");
  const { bridge, agreement } = await makeSetup({ signer });
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId: agreement.id,
    initiatedBy: "test",
  });
  assert(result.ok, "must succeed");
  if (!result.ok) return;
  eq(result.passport!.audit.actionType, "potential.collaboration.complete", "actionType must match");
});

test("passport: no signer wired → passport absent", async () => {
  const { bridge, agreement } = await makeSetup(); // no signer
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId: agreement.id,
    initiatedBy: "test",
  });
  assert(result.ok, "must succeed");
  if (!result.ok) return;
  eq(result.passport, undefined, "passport must be absent without signer");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fail-closed
// ═══════════════════════════════════════════════════════════════════════════════

test("fail-closed: zero policies → deny → ok=false", async () => {
  const { bridge, agreement } = await makeSetup({ policies: [] });
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId: agreement.id,
    initiatedBy: "test",
  });
  eq(result.ok, false, "zero policies must deny");
  if (result.ok) return;
  assert(result.reason.length > 0, "denied result must carry reason");
});

test("fail-closed: denyAll policy → ok=false", async () => {
  const { bridge, agreement } = await makeSetup({ policies: [denyAll()] });
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId: agreement.id,
    initiatedBy: "test",
  });
  eq(result.ok, false, "denyAll must always deny");
});

test("fail-closed: already released → wrong_state → ok=false", async () => {
  const { bridge, agreement } = await makeSetup();
  // First completion succeeds
  await bridge.completeCollaboration({ tenantId: TENANT, escrowId: agreement.id, initiatedBy: "test" });
  // Second completion must fail
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId: agreement.id,
    initiatedBy: "test",
  });
  eq(result.ok, false, "double-complete must fail");
  if (result.ok) return;
  assert(
    result.reason.toLowerCase().includes("wrong_state") ||
      result.reason.toLowerCase().includes("requires 'funded'"),
    "reason must mention wrong state or funded requirement: " + result.reason,
  );
});

test("fail-closed: denied result carries auditId", async () => {
  const { bridge, agreement } = await makeSetup({ policies: [] });
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId: agreement.id,
    initiatedBy: "test",
  });
  eq(result.ok, false, "must be denied");
  if (result.ok) return;
  assert(typeof result.auditId === "string" && result.auditId.length > 0, "denied result must carry auditId");
});

test("fail-closed: denied result has no passport", async () => {
  const signer = new HmacSigner("collab-complete-test-secret-32b!!");
  const { bridge, agreement } = await makeSetup({ policies: [denyAll()], signer });
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId: agreement.id,
    initiatedBy: "test",
  });
  eq(result.ok, false, "must be denied");
  if (result.ok) return;
  eq((result as any).passport, undefined, "denied result must not carry passport");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tenant isolation / validation
// ═══════════════════════════════════════════════════════════════════════════════

test("tenant isolation: escrow from different tenant → throws (fail-closed via not-found)", async () => {
  const { bridge, agreement } = await makeSetup();
  let threw = false;
  try {
    await bridge.completeCollaboration({
      tenantId: OTHER_TENANT,
      escrowId: agreement.id,
      initiatedBy: "test",
    });
  } catch (e: any) {
    threw = true;
    assert(
      e.message.includes("not found") || e.message.includes("tenant isolation"),
      "error must mention not found or tenant isolation: " + e.message,
    );
  }
  assert(threw, "mismatched tenant must throw immediately (fail-closed)");
});

test("validation: missing tenantId → throws", async () => {
  const { bridge, agreement } = await makeSetup();
  let threw = false;
  try {
    // @ts-ignore intentional bad input
    await bridge.completeCollaboration({ tenantId: "", escrowId: agreement.id, initiatedBy: "test" });
  } catch (e: any) {
    threw = true;
    assert(e.message.includes("tenantId"), "error must mention tenantId");
  }
  assert(threw, "empty tenantId must throw");
});

test("validation: missing escrowId → throws", async () => {
  const { bridge } = await makeSetup();
  let threw = false;
  try {
    // @ts-ignore intentional bad input
    await bridge.completeCollaboration({ tenantId: TENANT, escrowId: "", initiatedBy: "test" });
  } catch (e: any) {
    threw = true;
    assert(e.message.includes("escrowId"), "error must mention escrowId");
  }
  assert(threw, "empty escrowId must throw");
});

test("validation: unknown escrowId → throws", async () => {
  const { bridge } = await makeSetup();
  let threw = false;
  try {
    await bridge.completeCollaboration({
      tenantId: TENANT,
      escrowId: "no-such-escrow",
      initiatedBy: "test",
    });
  } catch (e: any) {
    threw = true;
    assert(e.message.includes("not found"), "error must mention not found: " + e.message);
  }
  assert(threw, "unknown escrow must throw");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Audit trail
// ═══════════════════════════════════════════════════════════════════════════════

test("audit: after completeCollaboration, audit chain has record for tenant", async () => {
  const { bridge, agreement } = await makeSetup();
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId: agreement.id,
    initiatedBy: "test",
  });
  assert(result.ok, "must succeed");

  const chain = bridge.audit.getChain(TENANT);
  assert(chain.length > 0, "audit chain must have at least one record");
});

test("audit: record actionType = 'potential.collaboration.complete'", async () => {
  const { bridge, agreement } = await makeSetup();
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId: agreement.id,
    initiatedBy: "test",
  });
  assert(result.ok, "must succeed");

  const chain = bridge.audit.getChain(TENANT);
  const record = chain.find(r => r.id === result.auditId);
  assert(record !== undefined, "audit record with result.auditId must exist");
  eq(record!.actionType, "potential.collaboration.complete", "audit actionType must match");
});

test("audit: successful completion → audit record outcome = 'allowed'", async () => {
  const { bridge, agreement } = await makeSetup();
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId: agreement.id,
    initiatedBy: "test",
  });
  assert(result.ok, "must succeed");

  const chain = bridge.audit.getChain(TENANT);
  const record = chain.find(r => r.id === result.auditId);
  eq(record!.outcome, "allowed", "outcome must be allowed");
});

test("audit: denyAll → audit record outcome = 'denied'", async () => {
  const { bridge, agreement } = await makeSetup({ policies: [denyAll()] });
  const result = await bridge.completeCollaboration({
    tenantId: TENANT,
    escrowId: agreement.id,
    initiatedBy: "test",
  });
  eq(result.ok, false, "must be denied");

  const chain = bridge.audit.getChain(TENANT);
  const record = chain.find(r => r.id === result.auditId);
  assert(record !== undefined, "denied audit record must be in chain");
  eq(record!.outcome, "denied", "outcome must be denied");
});
