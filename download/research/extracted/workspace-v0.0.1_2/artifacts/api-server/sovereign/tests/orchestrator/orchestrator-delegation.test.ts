import "../_flush.mjs";
/**
 * tests/orchestrator/orchestrator-delegation.test.ts — Orchestrator + Delegation integration.
 *
 * Coverage:
 *   TfaOrchestrator + requireValidDelegation
 *     • autonomous action with valid chain → allowed
 *     • autonomous action without source → denied
 *     • autonomous action with broken chain → denied
 *     • non-autonomous action passes regardless of identity
 *     • tenant isolation via delegation policy
 *     • audit record written for denied autonomous action
 *
 *   Composition root
 *     • buildSovereignStack wires requireValidDelegation by default
 *     • non-autonomous ledger actions still work
 *     • autonomous ledger action denied without valid delegation
 *     • autonomous ledger action allowed with valid delegation
 */

import { test, assert, eq } from "../_harness.mjs";
import { TfaOrchestrator } from "../../lib/orchestrator/orchestrator.ts";
import { InMemoryIdentityStore } from "../../lib/agent-identity/identity.ts";
import { requireValidDelegation } from "../../lib/agent-identity/delegation.ts";
import { allowAll } from "../../lib/orchestrator/guard.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import type { Action, GuardPolicy } from "../../lib/orchestrator/types.ts";
import type { AgentIdentity } from "../../lib/agent-identity/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _seq = 0;
function makeAction(overrides: Partial<Action> = {}): Action {
  _seq++;
  return {
    id: `action-${_seq}`,
    tenantId: "tenant-1",
    type: "agent.task.run",
    payload: { task: "test" },
    source: "test-agent",
    isFinancial: false,
    isAutonomous: false,
    requestedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeHuman(tenantId: string, id: string): AgentIdentity {
  return { id, tenantId, type: "human", parentId: null, createdAt: new Date().toISOString() };
}
function makeAgent(tenantId: string, id: string, parentId: string): AgentIdentity {
  return { id, tenantId, type: "agent", parentId, createdAt: new Date().toISOString() };
}

// ─── Orchestrator + requireValidDelegation ─────────────────────────────────────

test("Orchestrator + delegation: autonomous with valid chain → allowed", async () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  store.create(makeAgent("t1", "a1", "h1"));
  const orch = new TfaOrchestrator([requireValidDelegation(store), allowAll()]);
  const result = await orch.run(
    makeAction({ tenantId: "t1", source: "a1", isAutonomous: true }),
    async () => "ok",
  );
  assert(result.ok, "autonomous action with valid chain must be allowed");
});

test("Orchestrator + delegation: autonomous without source → denied", async () => {
  const store = new InMemoryIdentityStore();
  const orch = new TfaOrchestrator([requireValidDelegation(store), allowAll()]);
  const result = await orch.run(
    makeAction({ tenantId: "t1", source: "", isAutonomous: true }),
    async () => "ok",
  );
  assert(!result.ok, "autonomous action without source must be denied");
  if (!result.ok) {
    assert(result.reason.includes("missing source identity"), "reason must mention missing source");
  }
});

test("Orchestrator + delegation: autonomous with broken chain → denied", async () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  // a1 does not exist
  const orch = new TfaOrchestrator([requireValidDelegation(store), allowAll()]);
  const result = await orch.run(
    makeAction({ tenantId: "t1", source: "a1", isAutonomous: true }),
    async () => "ok",
  );
  assert(!result.ok, "autonomous action with broken chain must be denied");
  if (!result.ok) {
    assert(result.reason.includes("Invalid or broken delegation chain"), "reason must mention broken chain");
  }
});

test("Orchestrator + delegation: non-autonomous passes without identity", async () => {
  const store = new InMemoryIdentityStore();
  const orch = new TfaOrchestrator([requireValidDelegation(store), allowAll()]);
  const result = await orch.run(
    makeAction({ tenantId: "t1", source: "", isAutonomous: false }),
    async () => "ok",
  );
  assert(result.ok, "non-autonomous action must pass regardless of identity");
});

test("Orchestrator + delegation: tenant isolation", async () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  store.create(makeAgent("t1", "a1", "h1"));
  const orch = new TfaOrchestrator([requireValidDelegation(store), allowAll()]);
  const result = await orch.run(
    makeAction({ tenantId: "t2", source: "a1", isAutonomous: true }),
    async () => "ok",
  );
  assert(!result.ok, "autonomous action across tenants must be denied");
  if (!result.ok) {
    assert(result.reason.includes("Invalid or broken delegation chain"), "reason must mention broken chain");
  }
});

test("Orchestrator + delegation: denied autonomous action writes audit record", async () => {
  const store = new InMemoryIdentityStore();
  const orch = new TfaOrchestrator([requireValidDelegation(store), allowAll()]);
  const result = await orch.run(
    makeAction({ tenantId: "t1", source: "ghost", isAutonomous: true }),
    async () => "ok",
  );
  assert(!result.ok);
  const rec = orch.audit.getRecord(result.auditId);
  assert(rec !== null, "audit record must exist");
  eq(rec!.outcome, "denied");
  assert(rec!.reason && rec!.reason.includes("Invalid or broken delegation chain"));
});

// ─── Composition root ─────────────────────────────────────────────────────────

test("Composition root: buildSovereignStack wires requireValidDelegation by default", async () => {
  const stack = buildSovereignStack();
  const orch = (stack.ledger as any).orchestrator;
  assert(orch !== null && orch !== undefined, "ledger must have orchestrator");

  // Autonomous action without identities → denied
  const action: Action = {
    id: `auto-action-${++_seq}`,
    tenantId: "compose-deleg-tenant",
    type: "ledger.mint",
    payload: { toAccountId: "acc-1", amount: "1000" },
    source: "unknown-agent",
    isFinancial: true,
    isAutonomous: true,
    requestedAt: new Date().toISOString(),
  };

  const result = await orch.run(action, async () => ({ minted: true }));
  assert(!result.ok, "autonomous action without valid delegation must be denied by composition root");
  if (!result.ok) {
    assert(result.reason.includes("Invalid or broken delegation chain"), "reason must mention broken chain");
  }
});

test("Composition root: non-autonomous ledger action still works", async () => {
  const stack = buildSovereignStack();
  const tenantId = "compose-nonauto-tenant";
  const acct = await stack.ledger.createAccount(tenantId, "owner-1", "asset", "main");
  // Non-autonomous mint (isAutonomous=false)
  const result = await stack.ledger.mint(tenantId, acct.id, 500n, "test", "api", false);
  assert(result.ok, "non-autonomous ledger action must be allowed");
});

test("Composition root: autonomous ledger action allowed with valid delegation", async () => {
  const stack = buildSovereignStack();
  const tenantId = "compose-valid-tenant";
  stack.identities.create(makeHuman(tenantId, "h1"));
  stack.identities.create(makeAgent(tenantId, "a1", "h1"));
  const acct = await stack.ledger.createAccount(tenantId, "owner-1", "asset", "main");

  const result = await stack.ledger.mint(tenantId, acct.id, 500n, "test", "a1", true);
  assert(result.ok, "autonomous ledger action with valid delegation must be allowed");
});

test("Composition root: autonomous ledger action denied with invalid delegation", async () => {
  const stack = buildSovereignStack();
  const tenantId = "compose-invalid-tenant";
  const acct = await stack.ledger.createAccount(tenantId, "owner-1", "asset", "main");
  // No identities created
  const result = await stack.ledger.mint(tenantId, acct.id, 500n, "test", "ghost", true);
  assert(!result.ok, "autonomous ledger action without valid delegation must be denied");
  if (!result.ok) {
    assert(result.reason.includes("Invalid or broken delegation chain"), "reason must mention broken chain");
  }
});
