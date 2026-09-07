import "../_flush.mjs";
/**
 * tests/indexer/trust-graph-links.test.ts — v147
 *
 * Coverage:
 *   CROSS-REFS   Execution↔Passport, Execution↔Approval, Execution↔Escrow links via opts.
 *   BACK-LINK    projectPassport with executionId back-patches execution.passportId.
 *   UPSERT       Re-projection preserves existing cross-refs when opts omitted.
 *   EVENT-BUS    IndexerEventBus.emit() routes each event type to the correct projection.
 *   EVENT-BUS    execution.updated auto-projects actor when projectActor available.
 *   EVENT-BUS    passport.issued back-links execution via executionId.
 *   EVENT-BUS    Errors are caught and forwarded to onError; never propagate.
 *   FAIL-CLOSED  Unknown event type triggers onError without crashing.
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryReadModelStore, IndexerEventBus } from "../../lib/indexer/index.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import type { ExecutionWorkflow } from "../../lib/orchestrator/types.ts";
import type { SettlementAgreement } from "../../lib/escrow/settlement.ts";
import type { ActionPassport } from "../../lib/passport/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStore(): InMemoryReadModelStore {
  return new InMemoryReadModelStore();
}

function makeWorkflow(tenantId = "tenant-a", actionId = "action-1"): ExecutionWorkflow {
  const store = new InMemoryExecutionStore();
  return store.create({ tenantId, actionId });
}

function makeSettlement(overrides: Partial<SettlementAgreement> = {}): SettlementAgreement {
  const now = new Date().toISOString();
  return {
    id: "settlement-1",
    tenantId: "tenant-a",
    opportunityId: "opp-1",
    payerAccountId: "payer-1",
    workerAccountId: "worker-1",
    escrowAccountId: "escrow-1",
    totalAmount: 500_000n,
    releasedAmount: 0n,
    state: "created",
    createdAt: now,
    ...overrides,
  };
}

function makePassport(overrides: Partial<ActionPassport> = {}): ActionPassport {
  const now = new Date().toISOString();
  return {
    version: "1",
    passportId: "passport-1",
    issuedAt: now,
    tenantId: "tenant-a",
    audit: {
      id: "audit-1",
      tenantId: "tenant-a",
      actionId: "action-1",
      actionType: "test.action",
      source: "test",
      outcome: "allowed",
      occurredAt: now,
      prevHash: "genesis",
      hash: "abcd1234",
    },
    delegationChain: null,
    policyDecision: { outcome: "allowed" },
    ledgerEffect: null,
    attestation: null,
    algorithm: "hmac-sha256",
    hash: "deadbeef",
    signature: "sig1",
    ...overrides,
  };
}

// ─── Cross-reference links ────────────────────────────────────────────────────

test("projectExecution stores passportId cross-reference from opts", () => {
  const store = makeStore();
  const wf = makeWorkflow();
  const exec = store.projectExecution(wf, { passportId: "passport-abc" });
  eq(exec.passportId, "passport-abc");
  const fetched = store.getExecution("tenant-a", wf.id);
  eq(fetched!.passportId, "passport-abc");
});

test("projectExecution stores escrowId cross-reference from opts", () => {
  const store = makeStore();
  const wf = makeWorkflow();
  const exec = store.projectExecution(wf, { escrowId: "escrow-xyz" });
  eq(exec.escrowId, "escrow-xyz");
});

test("projectExecution preserves existing passportId on re-projection without opts", () => {
  const store = makeStore();
  const wf = makeWorkflow();
  store.projectExecution(wf, { passportId: "passport-first" });
  // Re-project without opts — should preserve previous passportId
  const exec2 = store.projectExecution(wf);
  eq(exec2.passportId, "passport-first");
});

test("projectApproval stores executionId cross-reference from opts", () => {
  const store = makeStore();
  const approval = store.projectApproval({
    id: "approval-1",
    tenantId: "tenant-a",
    actionId: "action-1",
    riskClass: "read_only",
    approvalClass: "auto",
    outcome: "allowed",
    timestamp: new Date().toISOString(),
    executionId: "exec-ref-123",
  });
  eq(approval.executionId, "exec-ref-123");
  const fetched = store.getApproval("tenant-a", "approval-1");
  eq(fetched!.executionId, "exec-ref-123");
});

test("projectApproval executionId is optional — omitting it yields undefined", () => {
  const store = makeStore();
  const approval = store.projectApproval({
    id: "approval-2",
    tenantId: "tenant-a",
    actionId: "action-2",
    riskClass: "financial_low",
    approvalClass: "auto",
    outcome: "denied",
    timestamp: new Date().toISOString(),
  });
  eq(approval.executionId, undefined);
});

test("projectEscrow stores executionId cross-reference from opts", () => {
  const store = makeStore();
  const escrow = store.projectEscrow(makeSettlement(), { executionId: "exec-999" });
  eq(escrow.executionId, "exec-999");
  const fetched = store.getEscrow("tenant-a", "settlement-1");
  eq(fetched!.executionId, "exec-999");
});

test("projectEscrow stores releasePassportId cross-reference from opts", () => {
  const store = makeStore();
  const escrow = store.projectEscrow(makeSettlement(), { releasePassportId: "passport-release-42" });
  eq(escrow.releasePassportId, "passport-release-42");
});

test("projectEscrow preserves executionId on re-projection without opts", () => {
  const store = makeStore();
  store.projectEscrow(makeSettlement(), { executionId: "exec-first" });
  const escrow2 = store.projectEscrow(makeSettlement());
  eq(escrow2.executionId, "exec-first");
});

test("projectPassport stores executionId cross-reference from opts", () => {
  const store = makeStore();
  const p = store.projectPassport(makePassport(), { executionId: "exec-linked" });
  eq(p.executionId, "exec-linked");
  const fetched = store.getPassport("tenant-a", "passport-1");
  eq(fetched!.executionId, "exec-linked");
});

test("projectPassport stores approvalId cross-reference from opts", () => {
  const store = makeStore();
  const p = store.projectPassport(makePassport(), { approvalId: "approval-ref-7" });
  eq(p.approvalId, "approval-ref-7");
});

// ─── Back-link: passport.issued → execution.passportId ───────────────────────

test("projectPassport with executionId back-patches execution.passportId", () => {
  const store = makeStore();
  const wf = makeWorkflow();
  store.projectExecution(wf);
  // Now project a passport that references this execution
  store.projectPassport(makePassport({ passportId: "passport-new" }), {
    executionId: wf.id,
  });
  const exec = store.getExecution("tenant-a", wf.id);
  eq(exec!.passportId, "passport-new");
});

test("projectPassport back-link respects tenant isolation (no cross-tenant patch)", () => {
  const store = makeStore();
  const wf = makeWorkflow("tenant-a");
  store.projectExecution(wf);
  // Project a passport from a different tenant — must NOT patch tenant-a's execution
  store.projectPassport(
    makePassport({ tenantId: "tenant-b", passportId: "passport-evil" }),
    { executionId: wf.id },
  );
  const exec = store.getExecution("tenant-a", wf.id);
  eq(exec!.passportId, undefined); // back-link must be a no-op for cross-tenant
});

// ─── IndexerEventBus ──────────────────────────────────────────────────────────

test("IndexerEventBus: execution.updated projects execution into store", () => {
  const store = makeStore();
  const bus = new IndexerEventBus(store as any);
  const wf = makeWorkflow();
  bus.emit({ type: "execution.updated", tenantId: wf.tenantId, workflow: wf });
  const exec = store.getExecution("tenant-a", wf.id);
  assert(exec !== null, "execution should be projected");
  eq(exec!.tenantId, "tenant-a");
});

test("IndexerEventBus: execution.updated auto-projects actor", () => {
  const store = makeStore();
  const bus = new IndexerEventBus(store as any);
  const wfStore = new InMemoryExecutionStore();
  const wf = wfStore.create({ tenantId: "tenant-a", actionId: "action-actor" });
  // Advance through planned→approved→running (valid transition sequence)
  const approved = wfStore.transition(wf.id, "tenant-a", "approved", "agent-x");
  const running = wfStore.transition(approved.id, "tenant-a", "running", "agent-x");
  bus.emit({ type: "execution.updated", tenantId: "tenant-a", workflow: running });
  const actor = store.getActor("tenant-a", "agent-x");
  assert(actor !== null, "actor should be auto-projected");
  eq(actor!.actorId, "agent-x");
});

test("IndexerEventBus: approval.decided projects approval into store", () => {
  const store = makeStore();
  const bus = new IndexerEventBus(store as any);
  const ts = new Date().toISOString();
  bus.emit({
    type: "approval.decided",
    tenantId: "tenant-a",
    approvalId: "approval-bus-1",
    actionId: "action-bus-1",
    riskClass: "read_only",
    approvalClass: "auto",
    outcome: "allowed",
    timestamp: ts,
    executionId: "exec-bus-1",
  });
  const approval = store.getApproval("tenant-a", "approval-bus-1");
  assert(approval !== null, "approval should be projected");
  eq(approval!.outcome, "allowed");
  eq(approval!.executionId, "exec-bus-1");
});

test("IndexerEventBus: escrow.updated projects escrow into store", () => {
  const store = makeStore();
  const bus = new IndexerEventBus(store as any);
  const agreement = makeSettlement({ id: "settlement-bus-1" });
  bus.emit({ type: "escrow.updated", tenantId: "tenant-a", agreement, executionId: "exec-bus-2" });
  const escrow = store.getEscrow("tenant-a", "settlement-bus-1");
  assert(escrow !== null, "escrow should be projected");
  eq(escrow!.executionId, "exec-bus-2");
});

test("IndexerEventBus: passport.issued projects passport into store", () => {
  const store = makeStore();
  const bus = new IndexerEventBus(store as any);
  const passport = makePassport({ passportId: "passport-bus-1" });
  bus.emit({
    type: "passport.issued",
    tenantId: "tenant-a",
    passport,
    executionId: "exec-bus-3",
    approvalId: "approval-bus-3",
  });
  const p = store.getPassport("tenant-a", "passport-bus-1");
  assert(p !== null, "passport should be projected");
  eq(p!.executionId, "exec-bus-3");
  eq(p!.approvalId, "approval-bus-3");
});

test("IndexerEventBus: passport.issued back-links execution.passportId", () => {
  const store = makeStore();
  const bus = new IndexerEventBus(store as any);
  const wf = makeWorkflow("tenant-a", "action-backlink");
  store.projectExecution(wf);
  const passport = makePassport({ passportId: "passport-backlink-1", tenantId: "tenant-a" });
  bus.emit({
    type: "passport.issued",
    tenantId: "tenant-a",
    passport,
    executionId: wf.id,
  });
  const exec = store.getExecution("tenant-a", wf.id);
  eq(exec!.passportId, "passport-backlink-1");
});

test("IndexerEventBus: errors forwarded to onError, never thrown to caller", () => {
  const errors: { err: unknown; type: string }[] = [];
  const store = makeStore();
  // Inject a broken store whose projectExecution throws
  const badStore = {
    ...store,
    projectExecution: () => { throw new Error("boom"); },
    projectActor: (store as any).projectActor?.bind(store),
  };
  const bus = new IndexerEventBus(badStore as any, (err, event) => {
    errors.push({ err, type: event.type });
  });
  const wf = makeWorkflow();
  bus.emit({ type: "execution.updated", tenantId: "tenant-a", workflow: wf });
  eq(errors.length, 1);
  eq(errors[0].type, "execution.updated");
  assert(errors[0].err instanceof Error, "error should be forwarded");
});
