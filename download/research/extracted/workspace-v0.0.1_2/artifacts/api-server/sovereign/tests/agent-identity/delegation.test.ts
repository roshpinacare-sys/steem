import "../_flush.mjs";
/**
 * tests/agent-identity/delegation.test.ts — Delegation chain validation & policy.
 *
 * Coverage:
 *   • valid chain human→agent→sub-agent
 *   • valid chain human→agent
 *   • valid chain human alone
 *   • loop detection (sub-agent → itself)
 *   • loop detection (agent → sub-agent → agent)
 *   • missing parent in chain
 *   • root not human
 *   • tenant mismatch in chain
 *   • empty source id
 *   • policy: non-autonomous action passes regardless
 *   • policy: autonomous action with valid chain allowed
 *   • policy: autonomous action without identity denied
 *   • policy: autonomous action with broken chain denied
 *   • policy: autonomous action with root not human denied
 *   • tenant isolation via policy evaluation
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryIdentityStore } from "../../lib/agent-identity/identity.ts";
import {
  buildDelegationChain,
  requireValidDelegation,
} from "../../lib/agent-identity/delegation.ts";
import type { AgentIdentity } from "../../lib/agent-identity/types.ts";
import type { Action, ActionContext } from "../../lib/orchestrator/types.ts";

function makeHuman(tenantId: string, id: string): AgentIdentity {
  return { id, tenantId, type: "human", parentId: null, createdAt: new Date().toISOString() };
}
function makeAgent(tenantId: string, id: string, parentId: string): AgentIdentity {
  return { id, tenantId, type: "agent", parentId, createdAt: new Date().toISOString() };
}
function makeSubAgent(tenantId: string, id: string, parentId: string): AgentIdentity {
  return { id, tenantId, type: "sub-agent", parentId, createdAt: new Date().toISOString() };
}

function ctx(action: Action, tenantId?: string): ActionContext {
  return {
    action,
    tenantId: tenantId ?? action.tenantId,
    timestamp: new Date().toISOString(),
  };
}

test("valid chain human→agent→sub-agent", () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  store.create(makeAgent("t1", "a1", "h1"));
  store.create(makeSubAgent("t1", "s1", "a1"));
  const chain = buildDelegationChain(store, "s1", "t1");
  assert(chain !== null);
  eq(chain.length, 3);
  eq(chain[0].id, "s1");
  eq(chain[1].id, "a1");
  eq(chain[2].id, "h1");
});

test("valid chain human→agent", () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  store.create(makeAgent("t1", "a1", "h1"));
  const chain = buildDelegationChain(store, "a1", "t1");
  assert(chain !== null);
  eq(chain.length, 2);
});

test("valid chain human alone", () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  const chain = buildDelegationChain(store, "h1", "t1");
  assert(chain !== null);
  eq(chain.length, 1);
});

test("loop detection — self-reference", () => {
  // manually inject a cyclic identity (bypassing store.create validation)
  const store = new InMemoryIdentityStore();
  (store as any).store.set("x", { id: "x", tenantId: "t1", type: "sub-agent", parentId: "x", createdAt: new Date().toISOString() });
  const chain = buildDelegationChain(store, "x", "t1");
  eq(chain, null);
});

test("loop detection — agent→sub-agent→agent", () => {
  const store = new InMemoryIdentityStore();
  (store as any).create({ id: "h1", tenantId: "t1", type: "human", parentId: null, createdAt: new Date().toISOString() });
  (store as any).create({ id: "a1", tenantId: "t1", type: "agent", parentId: "h1", createdAt: new Date().toISOString() });
  (store as any).create({ id: "s1", tenantId: "t1", type: "sub-agent", parentId: "a1", createdAt: new Date().toISOString() });
  // now mutate a1 to point to s1 creating a loop
  (store as any).store.set("a1", { id: "a1", tenantId: "t1", type: "agent", parentId: "s1", createdAt: new Date().toISOString() });
  const chain = buildDelegationChain(store, "s1", "t1");
  eq(chain, null);
});

test("missing parent in chain returns null", () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  store.create(makeAgent("t1", "a1", "h1"));
  // remove h1 after creation (simulate corruption)
  (store as any).store.delete("h1");
  const chain = buildDelegationChain(store, "a1", "t1");
  eq(chain, null);
});

test("root not human returns null", () => {
  const store = new InMemoryIdentityStore();
  (store as any).store.set("a1", { id: "a1", tenantId: "t1", type: "agent", parentId: null, createdAt: new Date().toISOString() });
  const chain = buildDelegationChain(store, "a1", "t1");
  eq(chain, null);
});

test("tenant mismatch in chain returns null", () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  (store as any).store.set("a1", { id: "a1", tenantId: "t2", type: "agent", parentId: "h1", createdAt: new Date().toISOString() });
  const chain = buildDelegationChain(store, "a1", "t2");
  eq(chain, null);
});

test("policy: non-autonomous action passes regardless", () => {
  const store = new InMemoryIdentityStore();
  const policy = requireValidDelegation(store);
  const action: Action = {
    id: "act1", tenantId: "t1", type: "test", payload: {}, source: "",
    isFinancial: false, isAutonomous: false, requestedAt: new Date().toISOString(),
  };
  const d = policy.evaluate(ctx(action));
  eq(d.allow, true);
});

test("policy: autonomous action with valid chain allowed", () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  store.create(makeAgent("t1", "a1", "h1"));
  const policy = requireValidDelegation(store);
  const action: Action = {
    id: "act1", tenantId: "t1", type: "test", payload: {}, source: "a1",
    isFinancial: false, isAutonomous: true, requestedAt: new Date().toISOString(),
  };
  const d = policy.evaluate(ctx(action));
  eq(d.allow, true);
});

test("policy: autonomous action without identity denied", () => {
  const store = new InMemoryIdentityStore();
  const policy = requireValidDelegation(store);
  const action: Action = {
    id: "act1", tenantId: "t1", type: "test", payload: {}, source: "",
    isFinancial: false, isAutonomous: true, requestedAt: new Date().toISOString(),
  };
  const d = policy.evaluate(ctx(action));
  eq(d.allow, false);
});

test("policy: autonomous action with broken chain denied", () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  // a1 does not exist
  const policy = requireValidDelegation(store);
  const action: Action = {
    id: "act1", tenantId: "t1", type: "test", payload: {}, source: "a1",
    isFinancial: false, isAutonomous: true, requestedAt: new Date().toISOString(),
  };
  const d = policy.evaluate(ctx(action));
  eq(d.allow, false);
});

test("policy: autonomous action with root not human denied", () => {
  const store = new InMemoryIdentityStore();
  (store as any).store.set("a1", { id: "a1", tenantId: "t1", type: "agent", parentId: null, createdAt: new Date().toISOString() });
  const policy = requireValidDelegation(store);
  const action: Action = {
    id: "act1", tenantId: "t1", type: "test", payload: {}, source: "a1",
    isFinancial: false, isAutonomous: true, requestedAt: new Date().toISOString(),
  };
  const d = policy.evaluate(ctx(action));
  eq(d.allow, false);
});

test("policy: tenant isolation via evaluation", () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  store.create(makeAgent("t1", "a1", "h1"));
  const policy = requireValidDelegation(store);
  // Action from tenant t2 claims identity a1 (which belongs to t1)
  const action: Action = {
    id: "act1", tenantId: "t2", type: "test", payload: {}, source: "a1",
    isFinancial: false, isAutonomous: true, requestedAt: new Date().toISOString(),
  };
  const d = policy.evaluate(ctx(action, "t2"));
  eq(d.allow, false);
});
