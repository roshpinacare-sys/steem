import "../_flush.mjs";
/**
 * tests/orchestrator/pg-execution-store.test.ts — PgExecutionStore full test suite.
 *
 * Uses InMemoryPool so no external Postgres is needed.
 * Every test gets a fresh store (isolated table state).
 *
 * Coverage:
 *   Lifecycle
 *     • init() creates both tables
 *     • init() is idempotent
 *
 *   create — happy path
 *     • workflow created with planned status + genesis log entry
 *     • optional fields stored and round-tripped via get()
 *
 *   create — fail-closed
 *     • missing tenantId throws ExecutionError missing_tenant
 *     • missing actionId throws ExecutionError missing_action_id
 *
 *   get — tenant isolation
 *     • returns null for wrong tenant
 *     • returns null for non-existent id
 *
 *   list — tenant isolation
 *     • returns only workflows for the given tenant
 *     • empty for unknown tenant
 *
 *   transition — happy path
 *     • full planned→approved→running→evidence_collected→settled→proved path
 *     • run-log grows correctly and prevHash chain verifies intact
 *
 *   transition — fail-closed
 *     • invalid transition throws ExecutionError invalid_transition
 *     • workflow not found throws ExecutionError workflow_not_found
 *     • terminal status (failed) rejects further transitions
 *     • terminal status (rejected) rejects further transitions
 *
 *   verifyChain
 *     • returns true for intact chain
 *     • returns false for non-existent workflow
 *     • returns false for wrong tenant
 *
 *   replay
 *     • invokes handler for every log entry in order
 *     • throws workflow_not_found for missing workflow
 *     • throws tenant_mismatch for cross-tenant access
 *
 *   lease / releaseLease
 *     • lease grants a fresh workflow
 *     • lease denied while active
 *     • lease allowed after expiration
 *     • releaseLease frees workflow
 *     • releaseLease denied for wrong worker while active
 *     • lease throws for empty workerId
 *     • lease throws for zero duration
 *     • lease returns false for wrong tenant
 *
 *   Multi-tenant
 *     • two tenants have independent workflows
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { PgExecutionStore } from "../../lib/orchestrator/pg-execution-store.ts";
import { ExecutionError } from "../../lib/orchestrator/execution-workflow.ts";
import type { ExecutionLogEntry, ExecutionStatus } from "../../lib/orchestrator/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeStore(): Promise<PgExecutionStore> {
  const pool = new InMemoryPool();
  const store = new PgExecutionStore(pool);
  await store.init();
  return store;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

test("init() creates both execution tables", async () => {
  const pool = new InMemoryPool();
  const store = new PgExecutionStore(pool);
  await store.init();
  const wf = await store.create({ tenantId: "t1", actionId: "a1" });
  assert(wf.id.length > 0, "workflow created after init");
});

test("init() is idempotent", async () => {
  const pool = new InMemoryPool();
  const store = new PgExecutionStore(pool);
  await store.init();
  await store.init();
  const wf = await store.create({ tenantId: "t1", actionId: "a1" });
  assert(wf.id.length > 0, "still works after double init");
});

// ─── CREATE ───────────────────────────────────────────────────────────────────

test("create produces a planned workflow with genesis log entry", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });

  assert(wf.id.length > 0, "id non-empty");
  eq(wf.status, "planned");
  eq(wf.tenantId, "tenant-a");
  eq(wf.actionId, "action-1");
  eq(wf.runLog.length, 1);
  eq(wf.runLog[0].toStatus, "planned");
  eq(wf.runLog[0].fromStatus, null);
  eq(wf.runLog[0].prevHash, "genesis");
  eq(wf.leaseExpiresAt, null);
  eq(wf.claimedBy, null);
});

test("create persists and get retrieves the same workflow", async () => {
  const store = await makeStore();
  const created = await store.create({ tenantId: "tenant-a", actionId: "action-1" });

  const fetched = await store.get(created.id, "tenant-a");
  assert(fetched !== null, "workflow found");
  eq(fetched!.id, created.id);
  eq(fetched!.status, "planned");
  eq(fetched!.runLog.length, 1);
  eq(fetched!.runLog[0].prevHash, "genesis");
});

test("create stores optional fields correctly", async () => {
  const store = await makeStore();
  const wf = await store.create({
    tenantId: "tenant-b",
    actionId: "action-2",
    intentId: "intent-99",
    executionRef: "ref-abc",
    approvalId: "approval-77",
    evidenceRefs: ["ev-1", "ev-2"],
    retryOfWorkflowId: "prev-workflow-id",
  });

  const fetched = (await store.get(wf.id, "tenant-b"))!;
  eq(fetched.intentId, "intent-99");
  eq(fetched.executionRef, "ref-abc");
  eq(fetched.approvalId, "approval-77");
  assert(fetched.evidenceRefs !== undefined, "evidenceRefs present");
  eq(fetched.evidenceRefs!.length, 2);
  eq(fetched.evidenceRefs![0], "ev-1");
  eq(fetched.retryOfWorkflowId, "prev-workflow-id");
});

// ─── CREATE — fail-closed ─────────────────────────────────────────────────────

test("create without tenantId throws missing_tenant", async () => {
  const store = await makeStore();
  try {
    await store.create({ tenantId: "", actionId: "a1" });
    throw new Error("should have thrown");
  } catch (e: any) {
    assert(e instanceof ExecutionError, "ExecutionError");
    eq(e.code, "missing_tenant");
  }
});

test("create without actionId throws missing_action_id", async () => {
  const store = await makeStore();
  try {
    await store.create({ tenantId: "t1", actionId: "" });
    throw new Error("should have thrown");
  } catch (e: any) {
    assert(e instanceof ExecutionError, "ExecutionError");
    eq(e.code, "missing_action_id");
  }
});

// ─── GET — tenant isolation ───────────────────────────────────────────────────

test("get returns null for wrong tenant", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });

  const result = await store.get(wf.id, "tenant-b");
  eq(result, null);
});

test("get returns null for non-existent id", async () => {
  const store = await makeStore();
  eq(await store.get("nonexistent", "tenant-a"), null);
});

// ─── LIST — tenant isolation ──────────────────────────────────────────────────

test("list returns only workflows for the given tenant", async () => {
  const store = await makeStore();
  await store.create({ tenantId: "tenant-a", actionId: "a1" });
  await store.create({ tenantId: "tenant-a", actionId: "a2" });
  await store.create({ tenantId: "tenant-b", actionId: "a3" });

  const aList = await store.list("tenant-a");
  eq(aList.length, 2);
  assert(aList.every((w) => w.tenantId === "tenant-a"), "all tenant-a");

  const bList = await store.list("tenant-b");
  eq(bList.length, 1);

  eq((await store.list("tenant-c")).length, 0);
});

// ─── TRANSITION — happy path ──────────────────────────────────────────────────

test("full planned→approved→running→evidence_collected→settled→proved path", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });

  const t1 = await store.transition(wf.id, "tenant-a", "approved", "op-1", "approved");
  eq(t1.status, "approved");
  eq(t1.runLog.length, 2);
  eq(t1.runLog[1].fromStatus, "planned");
  eq(t1.runLog[1].toStatus, "approved");
  eq(t1.runLog[1].actor, "op-1");

  await store.transition(wf.id, "tenant-a", "running", "worker-1");
  await store.transition(wf.id, "tenant-a", "evidence_collected", "worker-1", "done");
  await store.transition(wf.id, "tenant-a", "settled", "op-2");
  const final = await store.transition(wf.id, "tenant-a", "proved", "system");

  eq(final.status, "proved");
  eq(final.runLog.length, 6);

  const fetched = (await store.get(wf.id, "tenant-a"))!;
  eq(fetched.status, "proved");
  eq(fetched.runLog.length, 6);
});

test("run-log prevHash chain is intact after transitions", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });
  await store.transition(wf.id, "tenant-a", "approved", "op");
  await store.transition(wf.id, "tenant-a", "running", "worker");

  assert(await store.verifyChain(wf.id, "tenant-a"), "chain intact");
});

// ─── TRANSITION — fail-closed ─────────────────────────────────────────────────

test("invalid transition throws invalid_transition", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });

  try {
    await store.transition(wf.id, "tenant-a", "settled", "hacker");
    throw new Error("should have thrown");
  } catch (e: any) {
    assert(e instanceof ExecutionError, "ExecutionError");
    eq(e.code, "invalid_transition");
  }
});

test("transition on missing workflow throws workflow_not_found", async () => {
  const store = await makeStore();
  try {
    await store.transition("nonexistent", "tenant-a", "approved", "op");
    throw new Error("should have thrown");
  } catch (e: any) {
    assert(e instanceof ExecutionError, "ExecutionError");
    eq(e.code, "workflow_not_found");
  }
});

test("terminal status (failed) rejects further transitions", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });
  await store.transition(wf.id, "tenant-a", "approved", "op");
  await store.transition(wf.id, "tenant-a", "running", "worker");
  await store.transition(wf.id, "tenant-a", "failed", "worker", "crash");

  try {
    await store.transition(wf.id, "tenant-a", "evidence_collected", "worker");
    throw new Error("should have thrown");
  } catch (e: any) {
    eq(e.code, "invalid_transition");
  }
});

test("terminal status (rejected) rejects further transitions", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });
  await store.transition(wf.id, "tenant-a", "rejected", "op");

  try {
    await store.transition(wf.id, "tenant-a", "approved", "op");
    throw new Error("should have thrown");
  } catch (e: any) {
    eq(e.code, "invalid_transition");
  }
});

// ─── verifyChain ──────────────────────────────────────────────────────────────

test("verifyChain returns true for intact chain", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });
  await store.transition(wf.id, "tenant-a", "approved", "op");
  assert(await store.verifyChain(wf.id, "tenant-a"), "intact");
});

test("verifyChain returns false for non-existent workflow", async () => {
  const store = await makeStore();
  eq(await store.verifyChain("nonexistent", "tenant-a"), false);
});

test("verifyChain returns false for wrong tenant", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });
  eq(await store.verifyChain(wf.id, "tenant-b"), false);
});

// ─── replay ───────────────────────────────────────────────────────────────────

test("replay invokes handler for every log entry in order", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });
  await store.transition(wf.id, "tenant-a", "approved", "op");
  await store.transition(wf.id, "tenant-a", "running", "worker");

  const entries: string[] = [];
  const count = await store.replay("tenant-a", wf.id, (entry, i) => {
    entries.push(`${i}:${entry.toStatus}`);
  });

  eq(count, 3);
  eq(entries[0], "0:planned");
  eq(entries[1], "1:approved");
  eq(entries[2], "2:running");
});

test("replay throws workflow_not_found for missing workflow", async () => {
  const store = await makeStore();
  try {
    await store.replay("tenant-a", "nonexistent", () => {});
    throw new Error("should have thrown");
  } catch (e: any) {
    assert(e instanceof ExecutionError, "ExecutionError");
    eq(e.code, "workflow_not_found");
  }
});

test("replay throws tenant_mismatch for cross-tenant access", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });
  try {
    await store.replay("tenant-b", wf.id, () => {});
    throw new Error("should have thrown");
  } catch (e: any) {
    assert(e instanceof ExecutionError, "ExecutionError");
    eq(e.code, "tenant_mismatch");
  }
});

// ─── efficiency/single-pass-replay ────────────────────────────────────────────
// replay() used to call logResult.rows.map(rowToLogEntry) — building a full
// intermediate array — then iterate it by index. The two passes are merged into
// one loop that calls rowToLogEntry inline and uses `count` as the running index.
// These tests pin that the index sequence is still 0-based monotonic, that
// rowToLogEntry conversion still happens (fields are typed, not raw DB rows),
// and that a single-entry workflow calls the handler exactly once at index 0.

test("efficiency/single-pass-replay — index is 0-based monotonic across multiple transitions", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-multi" });
  await store.transition(wf.id, "tenant-a", "approved", "op");
  await store.transition(wf.id, "tenant-a", "running", "worker");
  await store.transition(wf.id, "tenant-a", "evidence_collected", "worker");

  const indices: number[] = [];
  const count = await store.replay("tenant-a", wf.id, (_entry, i) => {
    indices.push(i);
  });

  eq(count, 4); // genesis + 3 transitions
  eq(indices[0], 0, "first index must be 0 (0-based), not 1");
  for (let i = 1; i < indices.length; i++) {
    eq(indices[i], indices[i - 1] + 1, `index must increment by 1 at step ${i}`);
  }
});

test("efficiency/single-pass-replay — single-entry workflow calls handler exactly once at index 0", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-single" });

  let callCount = 0;
  let receivedIndex = -1;
  const count = await store.replay("tenant-a", wf.id, (_entry, i) => {
    callCount++;
    receivedIndex = i;
  });

  eq(count, 1);
  eq(callCount, 1, "handler must be called exactly once for a single-entry log");
  eq(receivedIndex, 0, "single-entry index must be 0, not 1");
});

test("efficiency/single-pass-replay — regression: handler receives converted entry (not raw row)", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-types" });
  await store.transition(wf.id, "tenant-a", "approved", "approver");

  // rowToLogEntry must have run — if it didn't, fromStatus/toStatus would be
  // the raw DB column names (from_status/to_status), not the camelCase fields.
  const entries: Array<{ fromStatus: string | null; toStatus: string }> = [];
  await store.replay("tenant-a", wf.id, (entry, _i) => {
    // Access camelCase properties — proof that rowToLogEntry was called in the loop
    entries.push({ fromStatus: entry.fromStatus, toStatus: entry.toStatus });
  });

  eq(entries.length, 2); // genesis entry + "approved" transition
  // Genesis entry: fromStatus is null (no prior state), toStatus is "planned".
  // If rowToLogEntry wasn't called, we'd see raw snake_case column names crash
  // on property access — the null check here is the proof that conversion ran.
  eq(entries[0].fromStatus, null, "genesis fromStatus is null — rowToLogEntry must have run (not raw row)");
  eq(entries[0].toStatus, "planned");
  eq(entries[1].fromStatus, "planned");
  eq(entries[1].toStatus, "approved");
});

test("lease grants an unclaimed workflow", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });

  const granted = await store.lease(wf.id, "tenant-a", "worker-1", 5000);
  assert(granted, "lease granted");

  const fetched = (await store.get(wf.id, "tenant-a"))!;
  eq(fetched.claimedBy, "worker-1");
  assert(fetched.leaseExpiresAt !== null && fetched.leaseExpiresAt > Date.now(), "expires in future");
});

test("lease denied while another worker holds active lease", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });

  assert(await store.lease(wf.id, "tenant-a", "worker-1", 60_000));
  const ok2 = await store.lease(wf.id, "tenant-a", "worker-2", 60_000);
  eq(ok2, false);
});

test("lease allowed after expiration", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });

  assert(await store.lease(wf.id, "tenant-a", "worker-1", 1));
  const start = Date.now();
  while (Date.now() - start < 50) { /* spin */ }

  const ok2 = await store.lease(wf.id, "tenant-a", "worker-2", 60_000);
  assert(ok2, "lease granted after expiry");
  const fetched = (await store.get(wf.id, "tenant-a"))!;
  eq(fetched.claimedBy, "worker-2");
});

test("releaseLease frees the workflow", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });

  await store.lease(wf.id, "tenant-a", "worker-1", 60_000);
  const released = await store.releaseLease(wf.id, "tenant-a", "worker-1");
  assert(released, "released");

  const fetched = (await store.get(wf.id, "tenant-a"))!;
  eq(fetched.claimedBy, null);
  eq(fetched.leaseExpiresAt, null);
});

test("releaseLease denied for wrong worker while lease is active", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });

  await store.lease(wf.id, "tenant-a", "worker-1", 60_000);
  const result = await store.releaseLease(wf.id, "tenant-a", "worker-2");
  eq(result, false);
});

test("lease throws for empty workerId", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });
  try {
    await store.lease(wf.id, "tenant-a", "", 5000);
    throw new Error("should have thrown");
  } catch (e: any) {
    eq(e.code, "lease_denied");
  }
});

test("lease throws for zero duration", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });
  try {
    await store.lease(wf.id, "tenant-a", "worker-1", 0);
    throw new Error("should have thrown");
  } catch (e: any) {
    eq(e.code, "lease_denied");
  }
});

test("lease returns false for wrong tenant", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });
  const result = await store.lease(wf.id, "tenant-b", "worker-1", 60_000);
  eq(result, false);
});

// ─── Multi-tenant ─────────────────────────────────────────────────────────────

test("two tenants have fully independent workflows", async () => {
  const store = await makeStore();
  const wA = await store.create({ tenantId: "ta", actionId: "a1" });
  const wB = await store.create({ tenantId: "tb", actionId: "a2" });

  await store.transition(wA.id, "ta", "approved", "op");
  await store.transition(wB.id, "tb", "rejected", "op");

  const fA = (await store.get(wA.id, "ta"))!;
  const fB = (await store.get(wB.id, "tb"))!;

  eq(fA.status, "approved");
  eq(fB.status, "rejected");
  eq(await store.get(wA.id, "tb"), null);
  eq(await store.get(wB.id, "ta"), null);

  assert(await store.verifyChain(wA.id, "ta"), "chain A intact");
  assert(await store.verifyChain(wB.id, "tb"), "chain B intact");
});

// ─── Efficiency: DB-order trust (redundant in-memory sort removed) ────────────

async function referenceLogFromDb(
  pool: InMemoryPool,
  workflowId: string,
  tenantId: string,
): Promise<ExecutionLogEntry[]> {
  const result = await pool.query(
    `SELECT timestamp, from_status, to_status, actor, reason, hash, prev_hash
       FROM execution_log_entries
      WHERE workflow_id = $1 AND tenant_id = $2
      ORDER BY seq ASC`,
    [workflowId, tenantId],
  );
  return result.rows.map((r: any) => ({
    timestamp: r.timestamp,
    fromStatus: r.from_status as ExecutionStatus | null,
    toStatus: r.to_status as ExecutionStatus,
    actor: r.actor,
    reason: r.reason ?? undefined,
    hash: r.hash,
    prevHash: r.prev_hash,
  }));
}

test("get: runLog order matches DB-ordered reference (happy path)", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });
  await store.transition(wf.id, "tenant-a", "approved", "op");
  await store.transition(wf.id, "tenant-a", "running", "worker");
  await store.transition(wf.id, "tenant-a", "evidence_collected", "worker", "done");
  await store.transition(wf.id, "tenant-a", "settled", "op-2");

  const fetched = (await store.get(wf.id, "tenant-a"))!;
  const ref = await referenceLogFromDb(store["pool" as any] as InMemoryPool, wf.id, "tenant-a");

  eq(fetched.runLog.length, ref.length);
  for (let i = 0; i < ref.length; i++) {
    eq(fetched.runLog[i].hash, ref[i].hash, `log entry ${i} hash must match DB-ordered reference`);
  }
});

test("list: runLog order matches DB-ordered reference for multiple workflows (edge case)", async () => {
  const store = await makeStore();
  const wf1 = await store.create({ tenantId: "tenant-a", actionId: "a1" });
  const wf2 = await store.create({ tenantId: "tenant-a", actionId: "a2" });

  await store.transition(wf1.id, "tenant-a", "approved", "op");
  await store.transition(wf1.id, "tenant-a", "running", "worker");
  await store.transition(wf2.id, "tenant-a", "approved", "op");

  const list = await store.list("tenant-a");
  eq(list.length, 2);

  for (const wf of list) {
    const ref = await referenceLogFromDb(store["pool" as any] as InMemoryPool, wf.id, "tenant-a");
    eq(wf.runLog.length, ref.length);
    for (let i = 0; i < ref.length; i++) {
      eq(wf.runLog[i].hash, ref[i].hash, `workflow ${wf.id} log entry ${i} hash must match DB-ordered reference`);
    }
  }
});

test("get: DB-ordered reference for wrong tenant is empty (fail-closed)", async () => {
  const store = await makeStore();
  const wf = await store.create({ tenantId: "tenant-a", actionId: "action-1" });
  await store.transition(wf.id, "tenant-a", "approved", "op");

  const ref = await referenceLogFromDb(store["pool" as any] as InMemoryPool, wf.id, "tenant-b");
  eq(ref.length, 0, "wrong tenant must have no log entries in DB");
  eq(await store.get(wf.id, "tenant-b"), null, "get must return null for wrong tenant");
});
