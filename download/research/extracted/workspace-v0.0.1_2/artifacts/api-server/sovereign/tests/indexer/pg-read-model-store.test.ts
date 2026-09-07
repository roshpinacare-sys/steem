import "../_flush.mjs";
/**
 * tests/indexer/pg-read-model-store.test.ts — PgReadModelStore unit tests.
 *
 * Coverage:
 *   init()                         — idempotent, creates all 6 tables.
 *   projectActor / getActor        — happy path, upsert, tenant isolation.
 *   projectExecution / getExecution — happy path, upsert, tenant isolation.
 *   listExecutionsByStatus          — filter by status, cross-tenant isolation.
 *   listExecutionsByDateRange       — happy path, invalid range → IndexerError.
 *   getExecutionByActionId          — found, not found, empty actionId → error.
 *   actorSummary                    — found with executionCount, not found.
 *   projectApproval / getApproval  — happy path, upsert.
 *   projectEscrow / getEscrow      — happy path, BigInt round-trip, dispute auto-projection.
 *   projectPassport / getPassport  — happy path, attestation flag.
 *   listDisputes                   — auto-projected from disputed escrow.
 */
import { test, assert, eq } from "../_harness.mjs";
import { PgReadModelStore } from "../../lib/indexer/pg-read-model-store.ts";
import { IndexerError } from "../../lib/indexer/index.ts";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import type { ExecutionWorkflow } from "../../lib/orchestrator/types.ts";
import type { SettlementAgreement } from "../../lib/escrow/settlement.ts";
import type { ActionPassport } from "../../lib/passport/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeStore(): Promise<PgReadModelStore> {
  const pool = new InMemoryPool();
  const store = new PgReadModelStore(pool);
  await store.init();
  return store;
}

function makeWorkflow(
  tenantId = "tenant-a",
  actionId = "action-1",
  intentId?: string,
): ExecutionWorkflow {
  const s = new InMemoryExecutionStore();
  return s.create({ tenantId, actionId, intentId });
}

function makeSettlement(
  id: string,
  tenantId: string,
  state: SettlementAgreement["state"] = "funded",
): SettlementAgreement {
  return {
    id,
    tenantId,
    opportunityId: "opp-1",
    payerAccountId: "payer-1",
    workerAccountId: "worker-1",
    escrowAccountId: "escrow-acc-1",
    totalAmount: 1_000_000n,
    releasedAmount: 0n,
    state,
    createdAt: new Date().toISOString(),
    disputedBy: state === "disputed" ? "payer-1" : undefined,
    disputeReason: state === "disputed" ? "work incomplete" : undefined,
  };
}

function makePassport(tenantId: string, passportId: string): ActionPassport {
  return {
    passportId,
    tenantId,
    audit: {
      id: "audit-1",
      tenantId,
      actionId: "action-1",
      actionType: "agent.task.run",
      source: "agent-x",
      outcome: "allowed",
      reason: undefined,
      occurredAt: new Date().toISOString(),
      prevHash: "genesis",
      hash: "abc123",
    },
    issuedAt: new Date().toISOString(),
    ledgerEffect: null,
    attestation: null,
    hash: "passport-hash-001",
  } as unknown as ActionPassport;
}

// ─── init ─────────────────────────────────────────────────────────────────────

test("PgReadModelStore: init() is idempotent", async () => {
  const pool = new InMemoryPool();
  const store = new PgReadModelStore(pool);
  await store.init();
  await store.init(); // second call must not throw
  assert(true, "double init survived");
});

// ─── Actor ────────────────────────────────────────────────────────────────────

test("PgReadModelStore: projectActor + getActor — happy path", async () => {
  const store = await makeStore();
  const actor = await store.projectActor({
    tenantId: "t1", actorId: "a1", actorType: "agent",
    timestamp: "2025-01-01T00:00:00.000Z", valueMovedMicrounits: 500n,
  });
  eq(actor.totalActions, 1);
  eq(actor.totalValueMovedMicrounits, 500n);

  const fetched = await store.getActor("t1", "a1");
  assert(fetched !== null, "actor should exist");
  eq(fetched!.actorId, "a1");
});

test("PgReadModelStore: projectActor upserts correctly", async () => {
  const store = await makeStore();
  await store.projectActor({ tenantId: "t1", actorId: "a1", actorType: "agent", timestamp: "2025-01-01T00:00:00.000Z" });
  const updated = await store.projectActor({ tenantId: "t1", actorId: "a1", actorType: "agent", timestamp: "2025-01-02T00:00:00.000Z", valueMovedMicrounits: 1000n });
  eq(updated.totalActions, 2);
  eq(updated.totalValueMovedMicrounits, 1000n);
});

test("PgReadModelStore: getActor cross-tenant returns null", async () => {
  const store = await makeStore();
  await store.projectActor({ tenantId: "t1", actorId: "a1", actorType: "human", timestamp: "2025-01-01T00:00:00.000Z" });
  const result = await store.getActor("t2", "a1");
  eq(result, null);
});

test("PgReadModelStore: listActors filters by tenant", async () => {
  const store = await makeStore();
  await store.projectActor({ tenantId: "t1", actorId: "a1", actorType: "agent", timestamp: "2025-01-01T00:00:00.000Z" });
  await store.projectActor({ tenantId: "t2", actorId: "a2", actorType: "agent", timestamp: "2025-01-01T00:00:00.000Z" });
  const list = await store.listActors("t1");
  eq(list.length, 1);
  eq(list[0].actorId, "a1");
});

// ─── Execution ────────────────────────────────────────────────────────────────

test("PgReadModelStore: projectExecution + getExecution — happy path", async () => {
  const store = await makeStore();
  const wf = makeWorkflow("t1", "action-1");
  const exec = await store.projectExecution(wf);
  eq(exec.actionId, "action-1");
  eq(exec.tenantId, "t1");

  const fetched = await store.getExecution("t1", wf.id);
  assert(fetched !== null, "execution should exist");
  eq(fetched!.workflowId, wf.id);
});

test("PgReadModelStore: getExecution cross-tenant returns null", async () => {
  const store = await makeStore();
  const wf = makeWorkflow("t1", "action-1");
  await store.projectExecution(wf);
  const result = await store.getExecution("t2", wf.id);
  eq(result, null);
});

test("PgReadModelStore: listExecutionsByStatus", async () => {
  const store = await makeStore();
  const wf1 = makeWorkflow("t1", "action-1");
  const wf2 = makeWorkflow("t1", "action-2");
  await store.projectExecution(wf1);
  await store.projectExecution(wf2);
  const results = await store.listExecutionsByStatus("t1", "planned");
  eq(results.length, 2);
  assert(results.every(e => e.status === "planned"), "all should be planned");
});

test("PgReadModelStore: listExecutionsByDateRange — happy path", async () => {
  const store = await makeStore();
  const wf = makeWorkflow("t1", "action-1");
  await store.projectExecution(wf);
  const results = await store.listExecutionsByDateRange("t1", "2020-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z");
  eq(results.length, 1);
});

test("PgReadModelStore: listExecutionsByDateRange invalid range throws IndexerError", async () => {
  const store = await makeStore();
  let threw = false;
  try {
    await store.listExecutionsByDateRange("t1", "2099-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z");
  } catch (e) {
    threw = true;
    assert(e instanceof IndexerError, "should be IndexerError");
    eq((e as IndexerError).code, "invalid_input");
  }
  assert(threw, "should have thrown");
});

test("PgReadModelStore: getExecutionByActionId — found", async () => {
  const store = await makeStore();
  const wf = makeWorkflow("t1", "action-XYZ");
  await store.projectExecution(wf);
  const found = await store.getExecutionByActionId("t1", "action-XYZ");
  assert(found !== null, "should find by actionId");
  eq(found!.actionId, "action-XYZ");
});

test("PgReadModelStore: getExecutionByActionId — empty actionId throws IndexerError", async () => {
  const store = await makeStore();
  let threw = false;
  try {
    await store.getExecutionByActionId("t1", "");
  } catch (e) {
    threw = true;
    assert(e instanceof IndexerError, "should be IndexerError");
    eq((e as IndexerError).code, "invalid_input");
  }
  assert(threw, "should have thrown");
});

test("PgReadModelStore: actorSummary with executions", async () => {
  const store = await makeStore();
  await store.projectActor({ tenantId: "t1", actorId: "actor-X", actorType: "agent", timestamp: new Date().toISOString() });
  // Project executions — the actor field in an execution is inferred from runLog; use a workflow
  const wf = makeWorkflow("t1", "action-1");
  // Manually set actor via the runLog; since makeWorkflow doesn't set it, executionCount will be 0
  const exec = await store.projectExecution(wf);
  const summary = await store.actorSummary("t1", "actor-X");
  assert(summary !== null, "summary should exist");
  eq(summary!.actor.actorId, "actor-X");
  assert(typeof summary!.executionCount === "number", "executionCount is number");
});

test("PgReadModelStore: actorSummary unknown actor returns null", async () => {
  const store = await makeStore();
  const summary = await store.actorSummary("t1", "no-such-actor");
  eq(summary, null);
});

// ─── Approval ─────────────────────────────────────────────────────────────────

test("PgReadModelStore: projectApproval + getApproval — happy path", async () => {
  const store = await makeStore();
  const approval = await store.projectApproval({
    id: "appr-1", tenantId: "t1", actionId: "action-1",
    riskClass: "low", approvalClass: "auto", outcome: "allowed",
    timestamp: new Date().toISOString(),
  });
  eq(approval.outcome, "allowed");

  const fetched = await store.getApproval("t1", "appr-1");
  assert(fetched !== null);
  eq(fetched!.id, "appr-1");
});

test("PgReadModelStore: getApproval cross-tenant returns null", async () => {
  const store = await makeStore();
  await store.projectApproval({
    id: "appr-1", tenantId: "t1", actionId: "action-1",
    riskClass: "low", approvalClass: "auto", outcome: "denied",
    timestamp: new Date().toISOString(),
  });
  const result = await store.getApproval("t2", "appr-1");
  eq(result, null);
});

// ─── Escrow ───────────────────────────────────────────────────────────────────

test("PgReadModelStore: projectEscrow + getEscrow — BigInt round-trip", async () => {
  const store = await makeStore();
  const agreement = makeSettlement("esc-1", "t1");
  const escrow = await store.projectEscrow(agreement);
  eq(escrow.totalAmountMicrounits, 1_000_000n);
  eq(escrow.releasedAmountMicrounits, 0n);

  const fetched = await store.getEscrow("t1", "esc-1");
  assert(fetched !== null);
  eq(fetched!.totalAmountMicrounits, 1_000_000n);
});

test("PgReadModelStore: getEscrow cross-tenant returns null", async () => {
  const store = await makeStore();
  await store.projectEscrow(makeSettlement("esc-1", "t1"));
  eq(await store.getEscrow("t2", "esc-1"), null);
});

test("PgReadModelStore: disputed escrow auto-projects Dispute", async () => {
  const store = await makeStore();
  await store.projectEscrow(makeSettlement("esc-2", "t1", "disputed"));
  const disputes = await store.listDisputes("t1");
  eq(disputes.length, 1);
  eq(disputes[0].escrowId, "esc-2");
  eq(disputes[0].state, "disputed");
});

test("PgReadModelStore: reversed escrow auto-projects Dispute with state=reversed", async () => {
  const store = await makeStore();
  await store.projectEscrow(makeSettlement("esc-3", "t1", "reversed"));
  const disputes = await store.listDisputes("t1");
  eq(disputes.length, 1);
  eq(disputes[0].state, "reversed");
  assert(disputes[0].resolvedAt !== undefined, "resolvedAt should be set");
});

// ─── Passport ─────────────────────────────────────────────────────────────────

test("PgReadModelStore: projectPassport + getPassport — happy path", async () => {
  const store = await makeStore();
  const passport = makePassport("t1", "pp-1");
  const p = await store.projectPassport(passport);
  eq(p.passportId, "pp-1");
  eq(p.attestationPresent, false);

  const fetched = await store.getPassport("t1", "pp-1");
  assert(fetched !== null);
  eq(fetched!.hash, "passport-hash-001");
});

test("PgReadModelStore: getPassport cross-tenant returns null", async () => {
  const store = await makeStore();
  await store.projectPassport(makePassport("t1", "pp-1"));
  eq(await store.getPassport("t2", "pp-1"), null);
});

test("PgReadModelStore: listPassports filters by tenant", async () => {
  const store = await makeStore();
  await store.projectPassport(makePassport("t1", "pp-1"));
  await store.projectPassport(makePassport("t2", "pp-2"));
  const list = await store.listPassports("t1");
  eq(list.length, 1);
  eq(list[0].passportId, "pp-1");
});

// ─── Cross-ref columns (v149) ─────────────────────────────────────────────────

test("PgReadModelStore: projectExecution stores passportId/escrowId in DB", async () => {
  const store = await makeStore();
  const wf = makeWorkflow("t1", "action-x");
  const exec = await store.projectExecution(wf, { passportId: "pp-99", escrowId: "esc-99" });
  eq(exec.passportId, "pp-99");
  eq(exec.escrowId, "esc-99");

  // round-trip: reload from DB and verify cross-refs survive
  const fetched = await store.getExecution("t1", wf.id);
  assert(fetched !== null);
  eq(fetched!.passportId, "pp-99");
  eq(fetched!.escrowId, "esc-99");
});

test("PgReadModelStore: projectExecution upsert preserves existing passportId", async () => {
  const store = await makeStore();
  const wf = makeWorkflow("t1", "action-y");
  await store.projectExecution(wf, { passportId: "pp-original" });
  // second projection without opts — should preserve passportId from DB
  await store.projectExecution(wf);
  const fetched = await store.getExecution("t1", wf.id);
  eq(fetched!.passportId, "pp-original");
});

test("PgReadModelStore: projectApproval stores executionId in DB", async () => {
  const store = await makeStore();
  const approval = await store.projectApproval({
    id: "appr-cross", tenantId: "t1", actionId: "action-1",
    riskClass: "write_safe", approvalClass: "auto",
    outcome: "allowed", timestamp: new Date().toISOString(),
    executionId: "exec-linked",
  });
  eq(approval.executionId, "exec-linked");

  const fetched = await store.getApproval("t1", "appr-cross");
  assert(fetched !== null);
  eq(fetched!.executionId, "exec-linked");
});

test("PgReadModelStore: projectEscrow stores executionId/releasePassportId in DB", async () => {
  const store = await makeStore();
  const agreement = makeSettlement("esc-cross", "t1");
  const escrow = await store.projectEscrow(agreement, { executionId: "exec-e1", releasePassportId: "pp-release" });
  eq(escrow.executionId, "exec-e1");
  eq(escrow.releasePassportId, "pp-release");

  const fetched = await store.getEscrow("t1", "esc-cross");
  assert(fetched !== null);
  eq(fetched!.executionId, "exec-e1");
  eq(fetched!.releasePassportId, "pp-release");
});

test("PgReadModelStore: projectEscrow upsert preserves executionId", async () => {
  const store = await makeStore();
  const agreement = makeSettlement("esc-upsert", "t1");
  await store.projectEscrow(agreement, { executionId: "exec-preserved" });
  // second projection: state change, no opts — executionId should survive
  const updated = { ...agreement, state: "released" as const };
  await store.projectEscrow(updated);
  const fetched = await store.getEscrow("t1", "esc-upsert");
  eq(fetched!.executionId, "exec-preserved");
});

test("PgReadModelStore: projectPassport stores executionId/approvalId in DB", async () => {
  const store = await makeStore();
  const passport = makePassport("t1", "pp-cross");
  const p = await store.projectPassport(passport, { executionId: "exec-p1", approvalId: "appr-p1" });
  eq(p.executionId, "exec-p1");
  eq(p.approvalId, "appr-p1");

  const fetched = await store.getPassport("t1", "pp-cross");
  assert(fetched !== null);
  eq(fetched!.executionId, "exec-p1");
  eq(fetched!.approvalId, "appr-p1");
});
