import "../_flush.mjs";
/**
 * tests/orchestrator/execution-workflow.test.ts — v133.
 * First sub-step of Durable ExecutionWorkflow: state machine + run-log + lease + replay + startup validator.
 *
 * Coverage:
 *   CREATE       valid workflow created with "planned" status and genesis log entry.
 *   FAIL-CLOSED  missing tenantId / actionId rejected.
 *   TRANSITION   all valid transitions succeed; terminal states reject further transitions.
 *   INVALID      invalid transition throws ExecutionError with correct code.
 *   TENANT       get/transition/list are strictly tenant-isolated.
 *   LOG          run-log is append-only, hash-linked, and tamper-evident.
 *   REPLAY       replay invokes handler for every log entry in order.
 *   LEASE        claim/release/concurrent-deny and expiration work correctly.
 *   STARTUP      validateAllExecutionChains returns true for valid store, false for tampered log.
 *   EDGE         rejected / failed are terminal; no transitions out.
 */
import { test, assert, eq } from "../_harness.mjs";
import {
  InMemoryExecutionStore,
  ExecutionError,
  VALID_TRANSITIONS,
  VALID_TRANSITION_SET,
  TERMINAL_STATUSES,
  verifyRunLog,
  validateAllExecutionChains,
} from "../../lib/orchestrator/execution-workflow.ts";
import type { ExecutionStatus, ExecutionWorkflow } from "../../lib/orchestrator/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStore(): InMemoryExecutionStore {
  return new InMemoryExecutionStore();
}

function makeWorkflow(store: InMemoryExecutionStore, tenantId = "tenant-a"): ExecutionWorkflow {
  return store.create({ tenantId, actionId: "action-1" });
}

// ─── CREATE ───────────────────────────────────────────────────────────────────

test("create produces a workflow in planned status with a genesis log entry", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);

  assert(wf.id.length > 0, "id is non-empty");
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

test("create with optional fields stores them correctly", () => {
  const store = makeStore();
  const wf = store.create({
    tenantId: "tenant-b",
    actionId: "action-2",
    intentId: "intent-99",
    executionRef: "ref-abc",
    approvalId: "approval-77",
    evidenceRefs: ["ev-1", "ev-2"],
  });

  eq(wf.intentId, "intent-99");
  eq(wf.executionRef, "ref-abc");
  eq(wf.approvalId, "approval-77");
  assert(wf.evidenceRefs !== undefined, "evidenceRefs present");
  eq(wf.evidenceRefs!.length, 2);
  eq(wf.evidenceRefs![0], "ev-1");
});

// ─── FAIL-CLOSED: missing required fields ─────────────────────────────────────

test("create without tenantId throws", () => {
  const store = makeStore();
  try {
    store.create({ tenantId: "", actionId: "a1" });
    throw new Error("should have thrown");
  } catch (e: any) {
    assert(e instanceof ExecutionError, "throws ExecutionError");
    eq(e.code, "missing_tenant");
  }
});

test("create without actionId throws", () => {
  const store = makeStore();
  try {
    store.create({ tenantId: "t1", actionId: "" });
    throw new Error("should have thrown");
  } catch (e: any) {
    assert(e instanceof ExecutionError, "throws ExecutionError");
    eq(e.code, "missing_action_id");
  }
});

// ─── TRANSITION: happy path full flow ─────────────────────────────────────────

test("full happy path: planned → approved → running → evidence_collected → settled → proved", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);

  const t1 = store.transition(wf.id, "tenant-a", "approved", "operator-1", "approved by policy");
  eq(t1.status, "approved");
  eq(t1.runLog.length, 2);
  eq(t1.runLog[1].fromStatus, "planned");
  eq(t1.runLog[1].toStatus, "approved");
  eq(t1.runLog[1].actor, "operator-1");

  const t2 = store.transition(wf.id, "tenant-a", "running", "worker-1");
  eq(t2.status, "running");
  eq(t2.runLog.length, 3);

  const t3 = store.transition(wf.id, "tenant-a", "evidence_collected", "worker-1", "evidence gathered");
  eq(t3.status, "evidence_collected");

  const t4 = store.transition(wf.id, "tenant-a", "settled", "operator-2");
  eq(t4.status, "settled");

  const t5 = store.transition(wf.id, "tenant-a", "proved", "system");
  eq(t5.status, "proved");
  eq(t5.runLog.length, 6);
});

// ─── TRANSITION: rejection path ───────────────────────────────────────────────

test("planned → rejected is valid and terminal", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);

  const t1 = store.transition(wf.id, "tenant-a", "rejected", "operator-1", "policy denied");
  eq(t1.status, "rejected");

  try {
    store.transition(wf.id, "tenant-a", "approved", "operator-2");
    throw new Error("should have thrown");
  } catch (e: any) {
    assert(e instanceof ExecutionError);
    eq(e.code, "invalid_transition");
  }
});

// ─── TRANSITION: failure path ─────────────────────────────────────────────────

test("running → failed is valid and terminal", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);

  store.transition(wf.id, "tenant-a", "approved", "op");
  store.transition(wf.id, "tenant-a", "running", "worker");

  const t = store.transition(wf.id, "tenant-a", "failed", "worker", "executor crashed");
  eq(t.status, "failed");
  eq(t.runLog[t.runLog.length - 1].reason, "executor crashed");

  try {
    store.transition(wf.id, "tenant-a", "evidence_collected", "worker");
    throw new Error("should have thrown");
  } catch (e: any) {
    eq(e.code, "invalid_transition");
  }
});

// ─── INVALID transitions ────────────────────────────────────────────────────────

test("invalid transition throws ExecutionError", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);

  try {
    store.transition(wf.id, "tenant-a", "settled", "hacker");
    throw new Error("should have thrown");
  } catch (e: any) {
    assert(e instanceof ExecutionError);
    eq(e.code, "invalid_transition");
    assert(e.message.includes("planned") && e.message.includes("settled"), "message mentions both states");
  }
});

test("transition to same state is invalid", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);

  try {
    store.transition(wf.id, "tenant-a", "planned", "op");
    throw new Error("should have thrown");
  } catch (e: any) {
    eq(e.code, "invalid_transition");
  }
});

// ─── TERMINAL states ──────────────────────────────────────────────────────────

test("all terminal statuses reject any transition", () => {
  const terminalPaths: { path: ExecutionStatus[]; failAt: ExecutionStatus }[] = [
    { path: ["approved", "running", "evidence_collected", "settled", "proved"], failAt: "proved" },
    { path: ["approved", "running", "failed"], failAt: "failed" },
    { path: ["rejected"], failAt: "rejected" },
  ];

  for (const { path, failAt } of terminalPaths) {
    const store = makeStore();
    const wf = makeWorkflow(store);

    for (const s of path) {
      store.transition(wf.id, "tenant-a", s, "test");
    }

    // Try every possible next state
    const allStates: ExecutionStatus[] = [
      "planned", "approved", "running", "evidence_collected",
      "settled", "proved", "failed", "rejected",
    ];
    for (const next of allStates) {
      try {
        store.transition(wf.id, "tenant-a", next, "test");
        // If we reach here, it must be because the state was already terminal
        // and we tried to transition from it. Only valid if next === failAt
        // (which would be a no-op transition, but those are also invalid).
        throw new Error(`should have thrown for transition from ${failAt} to ${next}`);
      } catch (e: any) {
        assert(e instanceof ExecutionError, `terminal ${failAt} → ${next} throws ExecutionError`);
        eq(e.code, "invalid_transition");
      }
    }
  }
});

// ─── TENANT isolation ─────────────────────────────────────────────────────────

test("get returns null for wrong tenant", () => {
  const store = makeStore();
  const wf = makeWorkflow(store, "tenant-a");

  const got = store.get(wf.id, "tenant-b");
  eq(got, null);
});

test("transition rejects wrong tenant", () => {
  const store = makeStore();
  const wf = makeWorkflow(store, "tenant-a");

  try {
    store.transition(wf.id, "tenant-b", "approved", "op");
    throw new Error("should have thrown");
  } catch (e: any) {
    eq(e.code, "tenant_mismatch");
  }
});

test("list is tenant-isolated", () => {
  const store = makeStore();
  store.create({ tenantId: "tenant-a", actionId: "a1" });
  store.create({ tenantId: "tenant-a", actionId: "a2" });
  store.create({ tenantId: "tenant-b", actionId: "a3" });

  const aList = store.list("tenant-a");
  eq(aList.length, 2);
  assert(aList.every((w) => w.tenantId === "tenant-a"));

  const bList = store.list("tenant-b");
  eq(bList.length, 1);
  eq(bList[0].tenantId, "tenant-b");

  const cList = store.list("tenant-c");
  eq(cList.length, 0);
});

// ─── LIST ordering (efficiency: reverse() replaces redundant sort) ────────────

test("list returns newest-first by createdAt", () => {
  const store = makeStore();
  const w1 = store.create({ tenantId: "t1", actionId: "a1" });
  const w2 = store.create({ tenantId: "t1", actionId: "a2" });
  const w3 = store.create({ tenantId: "t1", actionId: "a3" });

  const list = store.list("t1");
  eq(list.length, 3);
  eq(list[0].id, w3.id, "third created should be first (newest)");
  eq(list[1].id, w2.id, "second created should be second");
  eq(list[2].id, w1.id, "first created should be last (oldest)");
});

test("list ordering is stable for same-createdAt (insertion order tie-break)", () => {
  const store = makeStore();
  // Two workflows created in rapid succession may share the same ms.
  // Map insertion order is the tie-breaker; reverse() preserves it.
  const w1 = store.create({ tenantId: "t1", actionId: "a1" });
  const w2 = store.create({ tenantId: "t1", actionId: "a2" });

  const list = store.list("t1");
  eq(list.length, 2);
  // Both created in same ms? Not guaranteed, but if they are,
  // reverse preserves insertion order (w2 before w1 in newest-first).
  // If different ms, createdAt order wins.
  const w1Index = list.findIndex(w => w.id === w1.id);
  const w2Index = list.findIndex(w => w.id === w2.id);
  assert(w2Index < w1Index, "w2 (created second) should appear before w1 in newest-first list");
});

// ─── RUN-LOG integrity ──────────────────────────────────────────────────────────

test("verifyRunLog returns true for a valid workflow", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);
  store.transition(wf.id, "tenant-a", "approved", "op");
  store.transition(wf.id, "tenant-a", "running", "worker");

  assert(verifyRunLog(wf.runLog), "genesis log is valid");
  const fetched = store.get(wf.id, "tenant-a")!;
  assert(verifyRunLog(fetched.runLog), "fetched log is valid");
});

test("verifyRunLog returns false for empty log", () => {
  eq(verifyRunLog([]), false);
});

test("verifyRunLog detects tampered hash", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);

  // Tamper the hash of the genesis entry
  const tampered = [...wf.runLog];
  tampered[0] = { ...tampered[0], hash: "0000000000000000000000000000000000000000000000000000000000000000" };
  eq(verifyRunLog(tampered), false);
});

test("verifyRunLog detects tampered prevHash link", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);
  store.transition(wf.id, "tenant-a", "approved", "op");

  const fetched = store.get(wf.id, "tenant-a")!;
  const tampered = [...fetched.runLog];
  tampered[1] = { ...tampered[1], prevHash: "bogus" };
  eq(verifyRunLog(tampered), false);
});

test("store.verifyChain returns false for wrong tenant", () => {
  const store = makeStore();
  const wf = makeWorkflow(store, "tenant-a");
  eq(store.verifyChain(wf.id, "tenant-b"), false);
});

// ─── REPLAY ─────────────────────────────────────────────────────────────────────

test("replay invokes handler for every log entry in order", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);
  store.transition(wf.id, "tenant-a", "approved", "op");
  store.transition(wf.id, "tenant-a", "running", "worker");

  const entries: string[] = [];
  const count = store.replay("tenant-a", wf.id, (entry, index) => {
    entries.push(`${index}:${entry.toStatus}`);
  });

  eq(count, 3);
  eq(entries[0], "0:planned");
  eq(entries[1], "1:approved");
  eq(entries[2], "2:running");
});

test("replay throws for wrong tenant", () => {
  const store = makeStore();
  const wf = makeWorkflow(store, "tenant-a");

  try {
    store.replay("tenant-b", wf.id, () => {});
    throw new Error("should have thrown");
  } catch (e: any) {
    eq(e.code, "tenant_mismatch");
  }
});

// ─── LEASE ──────────────────────────────────────────────────────────────────────

test("lease claims an unclaimed workflow", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);

  const ok = store.lease(wf.id, "tenant-a", "worker-1", 5000);
  assert(ok, "lease granted");

  const fetched = store.get(wf.id, "tenant-a")!;
  eq(fetched.claimedBy, "worker-1");
  assert(fetched.leaseExpiresAt !== null && fetched.leaseExpiresAt > Date.now(), "lease expires in the future");
});

test("lease denied when another worker holds an active lease", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);

  assert(store.lease(wf.id, "tenant-a", "worker-1", 60_000));
  const ok2 = store.lease(wf.id, "tenant-a", "worker-2", 60_000);
  eq(ok2, false);
});

test("lease allowed after expiration", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);

  assert(store.lease(wf.id, "tenant-a", "worker-1", 1));
  // Wait for lease to expire
  const start = Date.now();
  while (Date.now() - start < 50) {
    // busy-wait for the 1ms lease to expire
  }

  const ok2 = store.lease(wf.id, "tenant-a", "worker-2", 60_000);
  assert(ok2, "lease granted after expiration");

  const fetched = store.get(wf.id, "tenant-a")!;
  eq(fetched.claimedBy, "worker-2");
});

test("releaseLease frees the workflow", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);

  store.lease(wf.id, "tenant-a", "worker-1", 60_000);
  const ok = store.releaseLease(wf.id, "tenant-a", "worker-1");
  assert(ok, "release succeeded");

  const fetched = store.get(wf.id, "tenant-a")!;
  eq(fetched.claimedBy, null);
  eq(fetched.leaseExpiresAt, null);
});

test("releaseLease denied for wrong worker while lease is active", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);

  store.lease(wf.id, "tenant-a", "worker-1", 60_000);
  const ok = store.releaseLease(wf.id, "tenant-a", "worker-2");
  eq(ok, false);
});

test("lease requires positive duration", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);

  try {
    store.lease(wf.id, "tenant-a", "worker-1", 0);
    throw new Error("should have thrown");
  } catch (e: any) {
    eq(e.code, "lease_denied");
  }
});

test("lease denied for wrong tenant", () => {
  const store = makeStore();
  const wf = makeWorkflow(store, "tenant-a");
  const ok = store.lease(wf.id, "tenant-b", "worker-1", 60_000);
  eq(ok, false);
});

// ─── STARTUP VALIDATOR ──────────────────────────────────────────────────────────

test("validateAllExecutionChains returns true for a valid store", () => {
  const store = makeStore();
  makeWorkflow(store, "tenant-a");
  makeWorkflow(store, "tenant-a");
  assert(validateAllExecutionChains(store), "all chains valid");
});

test("validateAllExecutionChains returns false for tampered log", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);
  store.transition(wf.id, "tenant-a", "approved", "op");

  // Directly tamper the internal store
  const internal = (store as any)["store"] as Map<string, any>;
  const raw = internal.get(wf.id);
  raw.runLog[0] = { ...raw.runLog[0], hash: "tampered" };

  eq(validateAllExecutionChains(store), false);
});

test("validateAllExecutionChains returns false when cached status diverges from log tail", () => {
  const store = makeStore();
  const wf = makeWorkflow(store);

  const internal = (store as any)["store"] as Map<string, any>;
  const raw = internal.get(wf.id);
  raw.status = "proved"; // diverge from log tail which is "planned"

  eq(validateAllExecutionChains(store), false);
});

// ─── EDGE: get/verify on non-existent workflow ──────────────────────────────────

test("get returns null for non-existent workflow", () => {
  const store = makeStore();
  eq(store.get("nonexistent", "tenant-a"), null);
});

test("transition throws for non-existent workflow", () => {
  const store = makeStore();
  try {
    store.transition("nonexistent", "tenant-a", "approved", "op");
    throw new Error("should have thrown");
  } catch (e: any) {
    eq(e.code, "workflow_not_found");
  }
});

// ─── VALID_TRANSITIONS coverage ───────────────────────────────────────────────

test("VALID_TRANSITIONS contains the expected graph", () => {
  eq(VALID_TRANSITIONS.planned.join(","), "approved,rejected");
  eq(VALID_TRANSITIONS.approved.join(","), "running,rejected");
  eq(VALID_TRANSITIONS.running.join(","), "evidence_collected,failed");
  eq(VALID_TRANSITIONS.evidence_collected.join(","), "settled,failed");
  eq(VALID_TRANSITIONS.settled.join(","), "proved,failed");
  eq(VALID_TRANSITIONS.proved.length, 0);
  eq(VALID_TRANSITIONS.failed.length, 0);
  eq(VALID_TRANSITIONS.rejected.length, 0);
});

// ─── Multiple workflows do not interfere ──────────────────────────────────────

test("multiple workflows are independent", () => {
  const store = makeStore();
  const w1 = store.create({ tenantId: "t1", actionId: "a1" });
  const w2 = store.create({ tenantId: "t1", actionId: "a2" });

  store.transition(w1.id, "t1", "approved", "op");
  store.transition(w2.id, "t1", "rejected", "op");

  const f1 = store.get(w1.id, "t1")!;
  const f2 = store.get(w2.id, "t1")!;

  eq(f1.status, "approved");
  eq(f2.status, "rejected");
  eq(f1.runLog.length, 2);
  eq(f2.runLog.length, 2);
  assert(f1.runLog[1].hash !== f2.runLog[1].hash, "different hashes");
});

// ─── VALID_TRANSITION_SET (O(1) efficiency/correctness) ───────────────────────
// These tests pin the correctness of the Set-based transition data so it stays
// in sync with VALID_TRANSITIONS if the graph ever changes.

test("VALID_TRANSITION_SET: mirrors VALID_TRANSITIONS exactly (happy path — all forward edges)", () => {
  const states = Object.keys(VALID_TRANSITIONS) as ExecutionStatus[];
  for (const from of states) {
    const arr = VALID_TRANSITIONS[from];
    const set = VALID_TRANSITION_SET[from];
    eq(set.size, arr.length, `Set size for "${from}" must match array length`);
    for (const to of arr) {
      assert(set.has(to), `VALID_TRANSITION_SET["${from}"] must contain "${to}"`);
    }
  }
});

test("VALID_TRANSITION_SET: terminal states have empty Sets (edge case)", () => {
  // proved/failed/rejected have no outgoing transitions; their Sets must be empty.
  const terminals: ExecutionStatus[] = ["proved", "failed", "rejected"];
  for (const s of terminals) {
    eq(VALID_TRANSITION_SET[s].size, 0, `terminal state "${s}" must have empty Set`);
  }
});

test("VALID_TRANSITION_SET: invalid transitions return false (fail-closed)", () => {
  // Backward edges and cross-state jumps must NOT be in the Set.
  const invalid: [ExecutionStatus, ExecutionStatus][] = [
    ["approved", "planned"],      // backward
    ["running", "approved"],      // backward
    ["planned", "settled"],       // skip-ahead
    ["proved", "running"],        // from terminal
  ];
  for (const [from, to] of invalid) {
    assert(!VALID_TRANSITION_SET[from].has(to), `"${from}"→"${to}" must NOT be in Set`);
  }
});
