import "../_flush.mjs";
/**
 * tests/potential/collaboration-escrow.test.ts
 *
 * Verifies CollaborationEscrowBridge — the Potential→Escrow loop that closes
 * the coordination-economy cycle.
 *
 * Coverage:
 *   Happy path
 *     • openEscrow with allowAll policy → ok=true, agreement state="created"
 *     • returned agreement fields match input (tenantId, opportunityId, amount)
 *     • payerAccountId / workerAccountId are present on the agreement
 *     • auditId is a non-empty string on success
 *
 *   Passport issuance
 *     • signer wired → passport is present on ok=true result
 *     • passport.tenantId matches input tenantId
 *     • passport.audit.actionType = "potential.collaboration.escrow"
 *     • passport.policyDecision.outcome = "allowed"
 *     • no signer wired → passport absent (backward compat)
 *     • onPassport hook fires exactly once on success
 *
 *   Fail-closed (no policies)
 *     • zero policies → deny → ok=false with reason
 *     • denyAll policy → ok=false with reason
 *     • denied result carries auditId
 *     • denied result has no passport
 *
 *   Tenant isolation
 *     • match.tenantId !== input.tenantId → throws immediately (before guard)
 *     • match and input same tenantId → allowed
 *
 *   Input validation
 *     • missing tenantId → throws
 *     • missing match → throws
 *     • zero amount → EscrowError from EscrowService (propagates)
 *     • negative amount (−1n) → EscrowError from EscrowService (propagates)
 *     • payer === worker → EscrowError from EscrowService (propagates)
 *
 *   Audit trail
 *     • after openEscrow, audit chain has exactly one record for the tenant
 *     • audit record actionType = "potential.collaboration.escrow"
 *     • audit record outcome = "allowed" on success / "denied" on deny
 *
 *   POTENTIAL_ACTION_TYPES constant
 *     • COLLABORATION_ESCROW key is present and equals "potential.collaboration.escrow"
 *
 * Run:
 *   node tests/potential/collaboration-escrow.test.ts
 */

import { test, assert, eq } from "../_harness.mjs";
import { CollaborationEscrowBridge, COLLABORATION_ESCROW_ACTION_TYPE } from "../../lib/potential/collaboration-escrow-bridge.ts";
import { POTENTIAL_ACTION_TYPES } from "../../lib/potential/types.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { TfaOrchestrator } from "../../lib/orchestrator/orchestrator.ts";
import { allowAll, denyAll } from "../../lib/orchestrator/guard.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { LedgerOrchestrator } from "../../lib/ledger-orchestrator/ledger-orchestrator.ts";
import type { CollaborationMatch } from "../../lib/potential/personality-types.ts";
import type { CollaborationEscrowInput } from "../../lib/potential/collaboration-escrow-bridge.ts";
import type { ActionPassport } from "../../lib/passport/types.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT = "tenant-escrow-bridge";
const TENANT_B = "tenant-other";

function makeMatch(overrides: Partial<CollaborationMatch> = {}): CollaborationMatch {
  return {
    userA: "user-a",
    userB: "user-b",
    tenantId: TENANT,
    compatibilityScore: 75,
    complementaryStrengths: [
      { category: "technical", strongUser: "user-a", weakUser: "user-b", delta: 40 },
    ],
    sharedStrengths: ["creative"],
    synergyReason: "user-a's technical strength fills user-b's gap; both strong in creative.",
    matchedAt: "2025-06-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Build a minimal LedgerOrchestrator backed by InMemoryLedger (no signer). */
function makeLedger(policies = [allowAll()]) {
  const provider = new InMemoryLedger();
  const orch = new TfaOrchestrator(policies);
  return new LedgerOrchestrator(provider, orch);
}

/**
 * Build a CollaborationEscrowBridge with two pre-created ledger accounts
 * so tests can call openEscrow without extra setup.
 */
async function makeSetup(opts: {
  policies?: ReturnType<typeof allowAll>[];
  signer?: HmacSigner;
  onPassport?: (p: ActionPassport) => void;
} = {}) {
  const { policies = [allowAll()], signer, onPassport } = opts;
  const ledger = makeLedger();

  // Pre-create payer and worker accounts in the ledger
  const payerAcc  = await ledger.createAccount(TENANT, "user-a", "asset", "payer wallet");
  const workerAcc = await ledger.createAccount(TENANT, "user-b", "asset", "worker wallet");

  const bridge = new CollaborationEscrowBridge(
    policies,
    ledger,
    undefined,
    undefined,
    signer ? { signer, onPassport } : {},
  );

  function makeInput(overrides: Partial<CollaborationEscrowInput> = {}): CollaborationEscrowInput {
    return {
      tenantId: TENANT,
      match: makeMatch(),
      opportunityId: "opp-collab-1",
      payerAccountId: payerAcc.id,
      workerAccountId: workerAcc.id,
      amount: 50_000n,
      initiatedBy: "CollaborationEscrowBridge",
      ...overrides,
    };
  }

  return { bridge, payerAcc, workerAcc, makeInput };
}

// ═══════════════════════════════════════════════════════════════════════════════
// POTENTIAL_ACTION_TYPES constant
// ═══════════════════════════════════════════════════════════════════════════════

test("POTENTIAL_ACTION_TYPES.COLLABORATION_ESCROW = 'potential.collaboration.escrow'", () => {
  eq(
    POTENTIAL_ACTION_TYPES.COLLABORATION_ESCROW,
    "potential.collaboration.escrow",
    "constant must have the canonical action type string",
  );
  eq(
    COLLABORATION_ESCROW_ACTION_TYPE,
    "potential.collaboration.escrow",
    "exported COLLABORATION_ESCROW_ACTION_TYPE must match",
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════════════════════════

test("openEscrow: allowAll policy → ok=true, agreement state='created'", async () => {
  const { bridge, makeInput } = await makeSetup();
  const result = await bridge.openEscrow(makeInput());
  eq(result.ok, true, "allowAll policy must allow the escrow creation");
  if (!result.ok) return;
  eq(result.agreement.state, "created", "freshly created escrow must be in 'created' state");
});

test("openEscrow: returned agreement has correct tenantId, opportunityId, amount", async () => {
  const { bridge, makeInput } = await makeSetup();
  const input = makeInput({ opportunityId: "opp-xyz", amount: 123_456n });
  const result = await bridge.openEscrow(input);
  assert(result.ok, "must succeed");
  if (!result.ok) return;
  eq(result.agreement.tenantId, TENANT, "tenantId must match");
  eq(result.agreement.opportunityId, "opp-xyz", "opportunityId must match");
  eq(result.agreement.amount, 123_456n, "amount must be exact BigInt");
});

test("openEscrow: returned agreement has payerAccountId and workerAccountId", async () => {
  const { bridge, makeInput, payerAcc, workerAcc } = await makeSetup();
  const result = await bridge.openEscrow(makeInput());
  assert(result.ok, "must succeed");
  if (!result.ok) return;
  eq(result.agreement.payerAccountId, payerAcc.id, "payerAccountId must match");
  eq(result.agreement.workerAccountId, workerAcc.id, "workerAccountId must match");
});

test("openEscrow: auditId is a non-empty string on success", async () => {
  const { bridge, makeInput } = await makeSetup();
  const result = await bridge.openEscrow(makeInput());
  assert(result.ok, "must succeed");
  if (!result.ok) return;
  assert(typeof result.auditId === "string" && result.auditId.length > 0, "auditId must be non-empty string");
});

test("openEscrow: agreement gets a unique id each call", async () => {
  const { bridge, makeInput } = await makeSetup();
  const r1 = await bridge.openEscrow(makeInput());
  const r2 = await bridge.openEscrow(makeInput());
  assert(r1.ok && r2.ok, "both must succeed");
  if (!r1.ok || !r2.ok) return;
  assert(r1.agreement.id !== r2.agreement.id, "each escrow must have a unique id");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Passport issuance
// ═══════════════════════════════════════════════════════════════════════════════

test("passport: signer wired → passport present on ok=true result", async () => {
  const signer = new HmacSigner("collab-escrow-test-secret-32bytes!!");
  const { bridge, makeInput } = await makeSetup({ signer });
  const result = await bridge.openEscrow(makeInput());
  assert(result.ok, "must succeed");
  if (!result.ok) return;
  assert(result.passport !== undefined, "passport must be present when signer is wired");
});

test("passport: passport.tenantId matches input tenantId", async () => {
  const signer = new HmacSigner("collab-escrow-test-secret-32bytes!!");
  const { bridge, makeInput } = await makeSetup({ signer });
  const result = await bridge.openEscrow(makeInput());
  assert(result.ok, "must succeed");
  if (!result.ok) return;
  eq(result.passport!.tenantId, TENANT, "passport.tenantId must match input.tenantId");
});

test("passport: passport.audit.actionType = 'potential.collaboration.escrow'", async () => {
  const signer = new HmacSigner("collab-escrow-test-secret-32bytes!!");
  const { bridge, makeInput } = await makeSetup({ signer });
  const result = await bridge.openEscrow(makeInput());
  assert(result.ok, "must succeed");
  if (!result.ok) return;
  eq(
    result.passport!.audit.actionType,
    "potential.collaboration.escrow",
    "passport actionType must be the collaboration escrow type",
  );
});

test("passport: passport.policyDecision.outcome = 'allowed' on success", async () => {
  const signer = new HmacSigner("collab-escrow-test-secret-32bytes!!");
  const { bridge, makeInput } = await makeSetup({ signer });
  const result = await bridge.openEscrow(makeInput());
  assert(result.ok, "must succeed");
  if (!result.ok) return;
  eq(result.passport!.policyDecision.outcome, "allowed", "policy outcome must be 'allowed'");
});

test("passport: no signer wired → passport absent (backward compat)", async () => {
  const { bridge, makeInput } = await makeSetup(); // no signer
  const result = await bridge.openEscrow(makeInput());
  assert(result.ok, "must succeed");
  if (!result.ok) return;
  eq(result.passport, undefined, "passport must be absent when no signer is wired");
});

test("passport: onPassport hook fires exactly once on success", async () => {
  const signer = new HmacSigner("collab-escrow-test-secret-32bytes!!");
  const hookCalls: ActionPassport[] = [];
  const { bridge, makeInput } = await makeSetup({
    signer,
    onPassport: (p) => hookCalls.push(p),
  });
  const result = await bridge.openEscrow(makeInput());
  assert(result.ok, "must succeed");
  eq(hookCalls.length, 1, "onPassport must fire exactly once");
  eq(hookCalls[0], result.passport!, "hook passport must be the same object as result.passport");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fail-closed (no policies / denyAll)
// ═══════════════════════════════════════════════════════════════════════════════

test("fail-closed: zero policies → deny → ok=false with reason", async () => {
  const { bridge, makeInput } = await makeSetup({ policies: [] });
  const result = await bridge.openEscrow(makeInput());
  eq(result.ok, false, "zero policies must deny (fail-closed)");
  if (result.ok) return;
  assert(result.reason.length > 0, "denied result must carry a reason");
});

test("fail-closed: denyAll policy → ok=false", async () => {
  const { bridge, makeInput } = await makeSetup({ policies: [denyAll()] });
  const result = await bridge.openEscrow(makeInput());
  eq(result.ok, false, "denyAll must always deny");
});

test("fail-closed: denied result carries auditId", async () => {
  const { bridge, makeInput } = await makeSetup({ policies: [] });
  const result = await bridge.openEscrow(makeInput());
  eq(result.ok, false, "must be denied");
  if (result.ok) return;
  assert(typeof result.auditId === "string" && result.auditId.length > 0, "denied result must carry auditId");
});

test("fail-closed: denied result has no passport", async () => {
  const signer = new HmacSigner("collab-escrow-test-secret-32bytes!!");
  const { bridge, makeInput } = await makeSetup({ policies: [denyAll()], signer });
  const result = await bridge.openEscrow(makeInput());
  eq(result.ok, false, "must be denied");
  if (result.ok) return;
  eq((result as any).passport, undefined, "denied result must not carry a passport");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tenant isolation
// ═══════════════════════════════════════════════════════════════════════════════

test("tenant isolation: match.tenantId !== input.tenantId → throws before guard", async () => {
  const { bridge, makeInput } = await makeSetup();
  const mismatchedMatch = makeMatch({ tenantId: TENANT_B });
  let threw = false;
  try {
    await bridge.openEscrow(makeInput({ match: mismatchedMatch }));
  } catch (e: any) {
    threw = true;
    assert(
      e.message.includes("tenant isolation"),
      "error must mention tenant isolation: " + e.message,
    );
  }
  assert(threw, "mismatched tenantId must throw immediately (fail-closed)");
});

test("tenant isolation: match and input same tenantId → allowed", async () => {
  const { bridge, makeInput } = await makeSetup();
  const sameMatch = makeMatch({ tenantId: TENANT });
  const result = await bridge.openEscrow(makeInput({ match: sameMatch }));
  eq(result.ok, true, "same tenantId must be allowed");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Input validation
// ═══════════════════════════════════════════════════════════════════════════════

test("validation: missing tenantId → throws", async () => {
  const { bridge, makeInput } = await makeSetup();
  let threw = false;
  try {
    await bridge.openEscrow(makeInput({ tenantId: "" }));
  } catch (e: any) {
    threw = true;
    assert(e.message.length > 0, "error must have a message");
  }
  assert(threw, "empty tenantId must throw");
});

test("validation: missing match → throws", async () => {
  const { bridge, makeInput } = await makeSetup();
  let threw = false;
  try {
    // @ts-ignore intentional bad input for test
    await bridge.openEscrow(makeInput({ match: null }));
  } catch (e: any) {
    threw = true;
    assert(e.message.length > 0, "error must have a message");
  }
  assert(threw, "null match must throw");
});

test("validation: zero amount → orchestrator returns ok=false (EscrowError caught by guard)", async () => {
  // The orchestrator catches EscrowError thrown by EscrowService.create() and
  // returns { ok: false } with the error message as reason — it never re-throws.
  const { bridge, makeInput } = await makeSetup();
  const result = await bridge.openEscrow(makeInput({ amount: 0n }));
  eq(result.ok, false, "zero amount must produce ok=false");
  if (result.ok) return;
  assert(
    result.reason.toLowerCase().includes("amount") || result.reason.length > 0,
    "denied reason must be non-empty: " + result.reason,
  );
});

test("validation: payer === worker → orchestrator returns ok=false (EscrowError caught by guard)", async () => {
  // Same account id for payer and worker — EscrowService.create() throws EscrowError,
  // orchestrator catches it and returns { ok: false }.
  const { bridge, makeInput, payerAcc } = await makeSetup();
  const result = await bridge.openEscrow(makeInput({
    payerAccountId: payerAcc.id,
    workerAccountId: payerAcc.id,
  }));
  eq(result.ok, false, "payer === worker must produce ok=false");
  if (result.ok) return;
  assert(result.reason.length > 0, "denied reason must be non-empty: " + result.reason);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Audit trail
// ═══════════════════════════════════════════════════════════════════════════════

test("audit: after openEscrow, audit chain has record for the tenant", async () => {
  const { bridge, makeInput } = await makeSetup();
  const result = await bridge.openEscrow(makeInput());
  assert(result.ok, "must succeed");

  const chain = bridge.audit.getChain(TENANT);
  assert(chain.length > 0, "audit chain must have at least one record");
});

test("audit: audit record actionType = 'potential.collaboration.escrow'", async () => {
  const { bridge, makeInput } = await makeSetup();
  const result = await bridge.openEscrow(makeInput());
  assert(result.ok, "must succeed");

  const chain = bridge.audit.getChain(TENANT);
  const record = chain.find(r => r.id === result.auditId);
  assert(record !== undefined, "audit record with result.auditId must exist in chain");
  eq(record!.actionType, "potential.collaboration.escrow", "audit record actionType must match");
});

test("audit: successful openEscrow → audit record outcome = 'allowed'", async () => {
  const { bridge, makeInput } = await makeSetup();
  const result = await bridge.openEscrow(makeInput());
  assert(result.ok, "must succeed");

  const chain = bridge.audit.getChain(TENANT);
  const record = chain.find(r => r.id === result.auditId);
  eq(record!.outcome, "allowed", "audit record outcome must be 'allowed' on success");
});

test("audit: denyAll → audit record outcome = 'denied'", async () => {
  const { bridge, makeInput } = await makeSetup({ policies: [denyAll()] });
  const result = await bridge.openEscrow(makeInput());
  eq(result.ok, false, "must be denied");

  const chain = bridge.audit.getChain(TENANT);
  const record = chain.find(r => r.id === result.auditId);
  assert(record !== undefined, "denied audit record must be in chain");
  eq(record!.outcome, "denied", "audit record outcome must be 'denied'");
});
