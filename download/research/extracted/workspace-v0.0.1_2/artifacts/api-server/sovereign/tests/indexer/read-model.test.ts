import "../_flush.mjs";
/**
 * tests/indexer/read-model.test.ts — v137 first sub-step: Trust-Graph read-model.
 *
 * Coverage:
 *   ACTOR        projectActor upserts, increments totals, tenant isolation.
 *   EXECUTION    projectExecution from workflow, evidence count, actor derivation.
 *   APPROVAL     projectApproval stores decision, get/list tenant-isolated.
 *   ESCROW       projectEscrow from agreement, dispute auto-derived when state=disputed/reversed.
 *   PASSPORT     projectPassport from ActionPassport, ledgerEffectId extraction.
 *   DISPUTE      get/list tenant-isolated; derived from escrow projection.
 *   INVALID      missing tenantId / actorId / id throws IndexerError.
 *   EDGE         empty lists, non-existent get returns null, cross-tenant returns null.
 */
import { test, assert, eq } from "../_harness.mjs";
import {
  InMemoryReadModelStore,
  IndexerError,
} from "../../lib/indexer/in-memory-store.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import type { ExecutionWorkflow } from "../../lib/orchestrator/types.ts";
import type { SettlementAgreement } from "../../lib/escrow/settlement.ts";
import type { ActionPassport } from "../../lib/passport/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStore(): InMemoryReadModelStore {
  return new InMemoryReadModelStore();
}

function makeWorkflow(tenantId = "tenant-a"): ExecutionWorkflow {
  const store = new InMemoryExecutionStore();
  return store.create({ tenantId, actionId: "action-1" });
}

function makeWorkflowWithEvidence(tenantId = "tenant-a"): ExecutionWorkflow {
  const store = new InMemoryExecutionStore();
  return store.create({
    tenantId,
    actionId: "action-2",
    intentId: "intent-99",
    executionRef: "ref-abc",
    approvalId: "approval-77",
    evidenceRefs: ["ev-1", "ev-2"],
  });
}

function makeSettlementAgreement(
  overrides: Partial<SettlementAgreement> = {},
): SettlementAgreement {
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
    settledBy: "authority-1",
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

// ─── Actor ────────────────────────────────────────────────────────────────────

test("projectActor creates a new actor on first sight", () => {
  const store = makeStore();
  const actor = store.projectActor({
    tenantId: "tenant-a",
    actorId: "actor-1",
    actorType: "agent",
    timestamp: "2026-06-13T00:00:00.000Z",
    valueMovedMicrounits: 100_000n,
  });

  eq(actor.tenantId, "tenant-a");
  eq(actor.actorId, "actor-1");
  eq(actor.actorType, "agent");
  eq(actor.totalActions, 1);
  eq(actor.totalValueMovedMicrounits, 100_000n);
  eq(actor.firstSeenAt, "2026-06-13T00:00:00.000Z");
  eq(actor.lastActiveAt, "2026-06-13T00:00:00.000Z");
});

test("projectActor upserts and increments on repeated sight", () => {
  const store = makeStore();
  store.projectActor({
    tenantId: "tenant-a",
    actorId: "actor-1",
    actorType: "agent",
    timestamp: "2026-06-13T00:00:00.000Z",
    valueMovedMicrounits: 100_000n,
  });
  const actor2 = store.projectActor({
    tenantId: "tenant-a",
    actorId: "actor-1",
    actorType: "agent",
    timestamp: "2026-06-13T01:00:00.000Z",
    valueMovedMicrounits: 50_000n,
  });

  eq(actor2.totalActions, 2);
  eq(actor2.totalValueMovedMicrounits, 150_000n);
  eq(actor2.lastActiveAt, "2026-06-13T01:00:00.000Z");
});

test("actorType is preserved on upsert", () => {
  const store = makeStore();
  store.projectActor({ tenantId: "t", actorId: "a", actorType: "human", timestamp: "2026-01-01T00:00:00.000Z" });
  const a2 = store.projectActor({ tenantId: "t", actorId: "a", actorType: "system", timestamp: "2026-01-02T00:00:00.000Z" });
  eq(a2.actorType, "human"); // original type preserved
});

test("getActor returns null for unknown actor", () => {
  const store = makeStore();
  eq(store.getActor("tenant-a", "nobody"), null);
});

test("getActor returns null on cross-tenant", () => {
  const store = makeStore();
  store.projectActor({ tenantId: "tenant-a", actorId: "actor-1", actorType: "agent", timestamp: "2026-01-01T00:00:00.000Z" });
  eq(store.getActor("tenant-b", "actor-1"), null);
});

test("listActors is tenant-isolated", () => {
  const store = makeStore();
  store.projectActor({ tenantId: "tenant-a", actorId: "a1", actorType: "agent", timestamp: "2026-01-01T00:00:00.000Z" });
  store.projectActor({ tenantId: "tenant-b", actorId: "a2", actorType: "human", timestamp: "2026-01-01T00:00:00.000Z" });
  const list = store.listActors("tenant-a");
  eq(list.length, 1);
  eq(list[0].actorId, "a1");
});

// ─── Execution ──────────────────────────────────────────────────────────────

test("projectExecution from workflow stores correct fields", () => {
  const store = makeStore();
  const wf = makeWorkflowWithEvidence("tenant-a");
  const exec = store.projectExecution(wf);

  eq(exec.tenantId, "tenant-a");
  eq(exec.workflowId, wf.id);
  eq(exec.actionId, "action-2");
  eq(exec.intentId, "intent-99");
  eq(exec.status, "planned");
  eq(exec.evidenceCount, 2);
  eq(exec.approvalId, "approval-77");
  eq(exec.actor, "system"); // genesis log actor
});

test("getExecution returns null for unknown workflow", () => {
  const store = makeStore();
  eq(store.getExecution("tenant-a", "no-such-id"), null);
});

test("getExecution returns null on cross-tenant", () => {
  const store = makeStore();
  const wf = makeWorkflow("tenant-a");
  store.projectExecution(wf);
  eq(store.getExecution("tenant-b", wf.id), null);
});

test("listExecutions is tenant-isolated and sorted newest-first", () => {
  const store = makeStore();
  const wf1 = makeWorkflow("tenant-a");
  const wf2 = makeWorkflow("tenant-a");
  store.projectExecution(wf1);
  store.projectExecution(wf2);
  store.projectExecution(makeWorkflow("tenant-b"));

  const list = store.listExecutions("tenant-a");
  eq(list.length, 2);
  // wf2 created after wf1, so it should be first when sorted by updatedAt desc
  eq(list[0].workflowId, wf2.id);
});

// ─── Approval ─────────────────────────────────────────────────────────────────

test("projectApproval stores decision fields", () => {
  const store = makeStore();
  const a = store.projectApproval({
    id: "approval-1",
    tenantId: "tenant-a",
    actionId: "action-1",
    riskClass: "value_moving",
    approvalClass: "threshold_escrow",
    decisionTrace: "trace-sig-1",
    outcome: "allowed",
    timestamp: "2026-06-13T00:00:00.000Z",
  });

  eq(a.id, "approval-1");
  eq(a.riskClass, "value_moving");
  eq(a.approvalClass, "threshold_escrow");
  eq(a.outcome, "allowed");
  eq(a.decisionTrace, "trace-sig-1");
});

test("getApproval returns null on cross-tenant", () => {
  const store = makeStore();
  store.projectApproval({
    id: "approval-1",
    tenantId: "tenant-a",
    actionId: "action-1",
    riskClass: "read_only",
    approvalClass: "auto",
    outcome: "allowed",
    timestamp: "2026-06-13T00:00:00.000Z",
  });
  eq(store.getApproval("tenant-b", "approval-1"), null);
});

// ─── Escrow ───────────────────────────────────────────────────────────────────

test("projectEscrow from agreement stores correct fields", () => {
  const store = makeStore();
  const agreement = makeSettlementAgreement({
    totalAmount: 1_000_000n,
    releasedAmount: 250_000n,
    state: "held",
  });
  const esc = store.projectEscrow(agreement);

  eq(esc.tenantId, "tenant-a");
  eq(esc.agreementId, "settlement-1");
  eq(esc.totalAmountMicrounits, 1_000_000n);
  eq(esc.releasedAmountMicrounits, 250_000n);
  eq(esc.state, "held");
});

test("projectEscrow with disputed state creates a Dispute entity", () => {
  const store = makeStore();
  const agreement = makeSettlementAgreement({
    state: "disputed",
    disputedBy: "worker-1",
    disputeReason: "quality mismatch",
  });
  store.projectEscrow(agreement);

  const d = store.getDispute("tenant-a", "settlement-1:dispute");
  assert(d !== null, "dispute should exist");
  eq(d!.escrowId, "settlement-1");
  eq(d!.raisedBy, "worker-1");
  eq(d!.reason, "quality mismatch");
  eq(d!.state, "disputed");
});

test("projectEscrow with reversed state creates a resolved Dispute", () => {
  const store = makeStore();
  const agreement = makeSettlementAgreement({
    state: "reversed",
    disputedBy: "payer-1",
    disputeReason: "fraud",
  });
  store.projectEscrow(agreement);

  const d = store.getDispute("tenant-a", "settlement-1:dispute");
  assert(d !== null, "dispute should exist");
  eq(d!.state, "reversed");
  assert(d!.resolvedAt !== undefined, "resolvedAt should be set");
});

test("listEscrows is tenant-isolated", () => {
  const store = makeStore();
  store.projectEscrow(makeSettlementAgreement({ tenantId: "tenant-a", id: "e1" }));
  store.projectEscrow(makeSettlementAgreement({ tenantId: "tenant-b", id: "e2" }));
  eq(store.listEscrows("tenant-a").length, 1);
  eq(store.listEscrows("tenant-a")[0].agreementId, "e1");
});

// ─── Passport ─────────────────────────────────────────────────────────────────

test("projectPassport from ActionPassport extracts fields", () => {
  const store = makeStore();
  const p = makePassport({
    ledgerEffect: {
      transactionId: "tx-1",
      tenantId: "tenant-a",
      kind: "transfer",
      debitAccountId: "a",
      creditAccountId: "b",
      amount: "100000",
      memo: "test",
      initiatedBy: "user-1",
      createdAt: "2026-06-13T00:00:00.000Z",
    },
    attestation: {
      workerId: "worker-1",
      statement: "done",
      attestedAt: "2026-06-13T00:00:00.000Z",
      signature: "sig",
      algorithm: "hmac-sha256",
    },
  });
  const rp = store.projectPassport(p);

  eq(rp.passportId, "passport-1");
  eq(rp.auditId, "audit-1");
  eq(rp.outcome, "allowed");
  eq(rp.ledgerEffectId, "tx-1");
  eq(rp.attestationPresent, true);
  eq(rp.hash, "deadbeef");
});

test("projectPassport with null ledgerEffect and attestation", () => {
  const store = makeStore();
  const rp = store.projectPassport(makePassport());
  eq(rp.ledgerEffectId, undefined);
  eq(rp.attestationPresent, false);
});

test("getPassport returns null on cross-tenant", () => {
  const store = makeStore();
  store.projectPassport(makePassport({ tenantId: "tenant-a" }));
  eq(store.getPassport("tenant-b", "passport-1"), null);
});

// ─── Dispute ──────────────────────────────────────────────────────────────────

test("listDisputes is tenant-isolated", () => {
  const store = makeStore();
  store.projectEscrow(makeSettlementAgreement({ tenantId: "tenant-a", id: "e1", state: "disputed", disputedBy: "x" }));
  store.projectEscrow(makeSettlementAgreement({ tenantId: "tenant-b", id: "e2", state: "disputed", disputedBy: "y" }));
  eq(store.listDisputes("tenant-a").length, 1);
  eq(store.listDisputes("tenant-a")[0].escrowId, "e1");
});

// ─── Invalid input (fail-closed) ────────────────────────────────────────────────

test("projectActor throws IndexerError on empty tenantId", () => {
  const store = makeStore();
  try {
    store.projectActor({ tenantId: "", actorId: "a", actorType: "agent", timestamp: "2026-01-01T00:00:00.000Z" });
    assert(false, "should have thrown");
  } catch (e) {
    assert(e instanceof IndexerError, "expected IndexerError");
    eq((e as IndexerError).code, "invalid_input");
  }
});

test("projectActor throws IndexerError on empty actorId", () => {
  const store = makeStore();
  try {
    store.projectActor({ tenantId: "t", actorId: "", actorType: "agent", timestamp: "2026-01-01T00:00:00.000Z" });
    assert(false, "should have thrown");
  } catch (e) {
    assert(e instanceof IndexerError, "expected IndexerError");
    eq((e as IndexerError).code, "invalid_input");
  }
});

test("projectApproval throws IndexerError on empty tenantId", () => {
  const store = makeStore();
  try {
    store.projectApproval({ id: "a1", tenantId: "", actionId: "x", riskClass: "read_only", approvalClass: "auto", outcome: "allowed", timestamp: "2026-01-01T00:00:00.000Z" });
    assert(false, "should have thrown");
  } catch (e) {
    assert(e instanceof IndexerError, "expected IndexerError");
    eq((e as IndexerError).code, "invalid_input");
  }
});

test("projectApproval throws IndexerError on empty id", () => {
  const store = makeStore();
  try {
    store.projectApproval({ id: "", tenantId: "t", actionId: "x", riskClass: "read_only", approvalClass: "auto", outcome: "allowed", timestamp: "2026-01-01T00:00:00.000Z" });
    assert(false, "should have thrown");
  } catch (e) {
    assert(e instanceof IndexerError, "expected IndexerError");
    eq((e as IndexerError).code, "invalid_input");
  }
});

test("projectEscrow throws IndexerError on empty tenantId", () => {
  const store = makeStore();
  try {
    store.projectEscrow(makeSettlementAgreement({ tenantId: "" }));
    assert(false, "should have thrown");
  } catch (e) {
    assert(e instanceof IndexerError, "expected IndexerError");
    eq((e as IndexerError).code, "invalid_input");
  }
});

test("projectPassport throws IndexerError on empty tenantId", () => {
  const store = makeStore();
  try {
    store.projectPassport(makePassport({ tenantId: "" }));
    assert(false, "should have thrown");
  } catch (e) {
    assert(e instanceof IndexerError, "expected IndexerError");
    eq((e as IndexerError).code, "invalid_input");
  }
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

test("listActors returns empty array when no actors", () => {
  const store = makeStore();
  eq(store.listActors("tenant-a").length, 0);
});

test("listExecutions returns empty array when no executions", () => {
  const store = makeStore();
  eq(store.listExecutions("tenant-a").length, 0);
});

test("listEscrows returns empty array when no escrows", () => {
  const store = makeStore();
  eq(store.listEscrows("tenant-a").length, 0);
});

test("listPassports returns empty array when no passports", () => {
  const store = makeStore();
  eq(store.listPassports("tenant-a").length, 0);
});

test("listDisputes returns empty array when no disputes", () => {
  const store = makeStore();
  eq(store.listDisputes("tenant-a").length, 0);
});

test("getExecution returns null after projecting then querying wrong tenant", () => {
  const store = makeStore();
  const wf = makeWorkflow("tenant-a");
  store.projectExecution(wf);
  eq(store.getExecution("tenant-b", wf.id), null);
});

test("escrow without disputedBy uses unknown for dispute raisedBy", () => {
  const store = makeStore();
  store.projectEscrow(makeSettlementAgreement({ state: "disputed" }));
  const d = store.getDispute("tenant-a", "settlement-1:dispute");
  eq(d!.raisedBy, "unknown");
});
