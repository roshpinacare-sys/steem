import "../_flush.mjs";
/**
 * tests/agent-identity/identity.test.ts — InMemoryIdentityStore full test suite.
 *
 * Coverage:
 *   • create human root
 *   • create agent with human parent
 *   • create sub-agent with agent parent
 *   • create sub-agent with sub-agent parent (chain)
 *   • duplicate id → IdentityError
 *   • human with parent → IdentityError
 *   • agent without parent → IdentityError
 *   • agent parent not found → IdentityError
 *   • agent parent not human → IdentityError
 *   • sub-agent without parent → IdentityError
 *   • sub-agent parent not found → IdentityError
 *   • parent wrong tenant → IdentityError
 *   • getById returns correct identity
 *   • getById returns null for unknown id
 *   • getByTenant returns only identities for that tenant
 *   • tenant isolation: cross-tenant lookups via getByTenant
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryIdentityStore } from "../../lib/agent-identity/identity.ts";
import { IdentityError } from "../../lib/agent-identity/types.ts";

function makeHuman(tenantId: string, id: string) {
  return {
    id,
    tenantId,
    type: "human" as const,
    parentId: null,
    createdAt: new Date().toISOString(),
  };
}

function makeAgent(tenantId: string, id: string, parentId: string) {
  return {
    id,
    tenantId,
    type: "agent" as const,
    parentId,
    createdAt: new Date().toISOString(),
  };
}

function makeSubAgent(tenantId: string, id: string, parentId: string) {
  return {
    id,
    tenantId,
    type: "sub-agent" as const,
    parentId,
    createdAt: new Date().toISOString(),
  };
}

test("create human root", () => {
  const store = new InMemoryIdentityStore();
  const h = makeHuman("t1", "h1");
  const out = store.create(h);
  eq(out.id, "h1");
  eq(out.type, "human");
});

test("create agent with human parent", () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  const a = store.create(makeAgent("t1", "a1", "h1"));
  eq(a.type, "agent");
});

test("create sub-agent with agent parent", () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  store.create(makeAgent("t1", "a1", "h1"));
  const s = store.create(makeSubAgent("t1", "s1", "a1"));
  eq(s.type, "sub-agent");
});

test("create sub-agent with sub-agent parent (chain)", () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  store.create(makeAgent("t1", "a1", "h1"));
  store.create(makeSubAgent("t1", "s1", "a1"));
  const s2 = store.create(makeSubAgent("t1", "s2", "s1"));
  eq(s2.type, "sub-agent");
});

test("duplicate id throws IdentityError", () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  try {
    store.create(makeHuman("t1", "h1"));
    assert(false, "expected throw");
  } catch (e) {
    assert(e instanceof IdentityError);
    eq((e as IdentityError).code, "duplicate_id");
  }
});

test("human with parent throws IdentityError", () => {
  const store = new InMemoryIdentityStore();
  try {
    store.create({ ...makeHuman("t1", "h1"), parentId: "x" });
    assert(false, "expected throw");
  } catch (e) {
    assert(e instanceof IdentityError);
    eq((e as IdentityError).code, "human_with_parent");
  }
});

test("agent without parent throws IdentityError", () => {
  const store = new InMemoryIdentityStore();
  try {
    store.create({ ...makeAgent("t1", "a1", ""), parentId: null });
    assert(false, "expected throw");
  } catch (e) {
    assert(e instanceof IdentityError);
    eq((e as IdentityError).code, "agent_without_human_parent");
  }
});

test("agent parent not found throws IdentityError", () => {
  const store = new InMemoryIdentityStore();
  try {
    store.create(makeAgent("t1", "a1", "missing"));
    assert(false, "expected throw");
  } catch (e) {
    assert(e instanceof IdentityError);
    eq((e as IdentityError).code, "parent_not_found");
  }
});

test("agent parent not human throws IdentityError", () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  store.create(makeAgent("t1", "a1", "h1"));
  try {
    store.create(makeAgent("t1", "a2", "a1"));
    assert(false, "expected throw");
  } catch (e) {
    assert(e instanceof IdentityError);
    eq((e as IdentityError).code, "parent_not_found");
  }
});

test("sub-agent without parent throws IdentityError", () => {
  const store = new InMemoryIdentityStore();
  try {
    store.create({ ...makeSubAgent("t1", "s1", ""), parentId: null });
    assert(false, "expected throw");
  } catch (e) {
    assert(e instanceof IdentityError);
    eq((e as IdentityError).code, "subagent_without_parent");
  }
});

test("sub-agent parent not found throws IdentityError", () => {
  const store = new InMemoryIdentityStore();
  try {
    store.create(makeSubAgent("t1", "s1", "missing"));
    assert(false, "expected throw");
  } catch (e) {
    assert(e instanceof IdentityError);
    eq((e as IdentityError).code, "parent_not_found");
  }
});

test("parent wrong tenant throws IdentityError", () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  try {
    store.create(makeAgent("t2", "a1", "h1"));
    assert(false, "expected throw");
  } catch (e) {
    assert(e instanceof IdentityError);
    eq((e as IdentityError).code, "parent_wrong_tenant");
  }
});

test("getById returns correct identity", () => {
  const store = new InMemoryIdentityStore();
  const h = makeHuman("t1", "h1");
  store.create(h);
  const got = store.getById("h1");
  assert(got !== null);
  eq(got!.id, "h1");
});

test("getById returns null for unknown id", () => {
  const store = new InMemoryIdentityStore();
  eq(store.getById("nope"), null);
});

test("getByTenant returns only identities for that tenant", () => {
  const store = new InMemoryIdentityStore();
  store.create(makeHuman("t1", "h1"));
  store.create(makeHuman("t2", "h2"));
  store.create(makeAgent("t1", "a1", "h1"));
  const t1 = store.getByTenant("t1");
  const t2 = store.getByTenant("t2");
  eq(t1.length, 2);
  eq(t2.length, 1);
  eq(t1.map((x) => x.id).sort().join(","), "a1,h1");
  eq(t2[0].id, "h2");
});
