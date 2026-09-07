import "../_flush.mjs";
/**
 * tests/identity/pg-identity-store.test.ts
 *
 * Tests for PgIdentityStore (lib/agent-identity/pg-identity-store.ts):
 *
 *  Functional parity with InMemoryIdentityStore:
 *   • human with parent → IdentityError(human_with_parent)
 *   • agent without parentId → IdentityError(agent_without_human_parent)
 *   • agent parent not found → IdentityError(parent_not_found)
 *   • agent parent is not human → IdentityError(parent_not_found)
 *   • agent parent wrong tenant → IdentityError(parent_wrong_tenant)
 *   • sub-agent without parentId → IdentityError(subagent_without_parent)
 *   • sub-agent parent not found → IdentityError(parent_not_found)
 *   • sub-agent parent wrong tenant → IdentityError(parent_wrong_tenant)
 *   • duplicate id → IdentityError(duplicate_id)
 *   • happy path: human → agent → sub-agent (full chain)
 *   • getById returns null for unknown
 *   • getByTenant returns only identities for that tenant
 *   • metadata round-trip
 *
 *  Restart / persistence:
 *   • After restart (new PgIdentityStore + init() on same pool), previously
 *     created identities are available (delegation chain survives).
 *   • requireValidDelegation passes after restart for a previously-valid chain.
 *
 *  Write-through:
 *   • After init() on a fresh pool, pg table is empty — cacheSize = 0.
 *   • After create() + a brief wait, pg table has the row (write-through).
 *   • After init() on same pool, cacheSize matches inserted count.
 *
 *  Observability:
 *   • cacheSize reflects number of identities loaded/created.
 *   • pgWriteErrors = 0 on normal operation.
 *
 *  Tenant isolation:
 *   • getByTenant filters correctly.
 *   • Cross-tenant agent parent → parent_wrong_tenant.
 *
 * Zero external dependencies — InMemoryPool only.
 */

import { test, eq, assert } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { PgIdentityStore } from "../../lib/agent-identity/pg-identity-store.ts";
import { IdentityError } from "../../lib/agent-identity/types.ts";
import { requireValidDelegation } from "../../lib/agent-identity/delegation.ts";
import type { AgentIdentity } from "../../lib/agent-identity/types.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function human(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    id: makeId(),
    tenantId: "pg-id-t1",
    type: "human",
    parentId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function agent(parentId: string, overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    id: makeId(),
    tenantId: "pg-id-t1",
    type: "agent",
    parentId,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function subagent(parentId: string, overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    id: makeId(),
    tenantId: "pg-id-t1",
    type: "sub-agent",
    parentId,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Create fresh pool + PgIdentityStore, init it, return both. */
async function freshStore() {
  const pool = new InMemoryPool();
  const store = new PgIdentityStore(pool);
  await store.init();
  return { pool, store };
}

// ─── Init ─────────────────────────────────────────────────────────────────────

test("PG IDENTITY: init() on empty pool → cacheSize = 0, no error", async () => {
  const { store } = await freshStore();
  eq(store.cacheSize, 0);
  eq(store.pgWriteErrors, 0);
});

// ─── Validation errors (parity with InMemoryIdentityStore) ────────────────────

test("PG IDENTITY: human with parentId → IdentityError(human_with_parent)", async () => {
  const { store } = await freshStore();
  const h = human({ parentId: "some-parent" });
  let threw: IdentityError | null = null;
  try { store.create(h); } catch (e) { threw = e as IdentityError; }
  assert(threw instanceof IdentityError, "threw IdentityError");
  eq(threw!.code, "human_with_parent");
});

test("PG IDENTITY: agent without parentId → IdentityError(agent_without_human_parent)", async () => {
  const { store } = await freshStore();
  const a: AgentIdentity = { id: makeId(), tenantId: "pg-id-t1", type: "agent", parentId: null, createdAt: new Date().toISOString() };
  let threw: IdentityError | null = null;
  try { store.create(a); } catch (e) { threw = e as IdentityError; }
  assert(threw instanceof IdentityError);
  eq(threw!.code, "agent_without_human_parent");
});

test("PG IDENTITY: agent parent not found → IdentityError(parent_not_found)", async () => {
  const { store } = await freshStore();
  const a = agent("no-such-id");
  let threw: IdentityError | null = null;
  try { store.create(a); } catch (e) { threw = e as IdentityError; }
  assert(threw instanceof IdentityError);
  eq(threw!.code, "parent_not_found");
});

test("PG IDENTITY: agent whose parent is also agent → IdentityError(parent_not_found)", async () => {
  const { store } = await freshStore();
  const h = human(); store.create(h);
  const a1 = agent(h.id); store.create(a1);
  // An agent whose parent is another agent — violates "agent parent must be human"
  const a2 = agent(a1.id);
  let threw: IdentityError | null = null;
  try { store.create(a2); } catch (e) { threw = e as IdentityError; }
  assert(threw instanceof IdentityError);
  eq(threw!.code, "parent_not_found", "agent parent must be human");
});

test("PG IDENTITY: agent parent wrong tenant → IdentityError(parent_wrong_tenant)", async () => {
  const { store } = await freshStore();
  const h = human({ tenantId: "pg-id-other" }); store.create(h);
  const a = agent(h.id, { tenantId: "pg-id-t1" });
  let threw: IdentityError | null = null;
  try { store.create(a); } catch (e) { threw = e as IdentityError; }
  assert(threw instanceof IdentityError);
  eq(threw!.code, "parent_wrong_tenant");
});

test("PG IDENTITY: sub-agent without parentId → IdentityError(subagent_without_parent)", async () => {
  const { store } = await freshStore();
  const sa: AgentIdentity = { id: makeId(), tenantId: "pg-id-t1", type: "sub-agent", parentId: null, createdAt: new Date().toISOString() };
  let threw: IdentityError | null = null;
  try { store.create(sa); } catch (e) { threw = e as IdentityError; }
  assert(threw instanceof IdentityError);
  eq(threw!.code, "subagent_without_parent");
});

test("PG IDENTITY: sub-agent parent not found → IdentityError(parent_not_found)", async () => {
  const { store } = await freshStore();
  const sa = subagent("no-such-id");
  let threw: IdentityError | null = null;
  try { store.create(sa); } catch (e) { threw = e as IdentityError; }
  assert(threw instanceof IdentityError);
  eq(threw!.code, "parent_not_found");
});

test("PG IDENTITY: sub-agent parent wrong tenant → IdentityError(parent_wrong_tenant)", async () => {
  const { store } = await freshStore();
  const h = human({ tenantId: "pg-id-other2" }); store.create(h);
  const a = agent(h.id, { tenantId: "pg-id-other2" }); store.create(a);
  const sa = subagent(a.id, { tenantId: "pg-id-t1" });
  let threw: IdentityError | null = null;
  try { store.create(sa); } catch (e) { threw = e as IdentityError; }
  assert(threw instanceof IdentityError);
  eq(threw!.code, "parent_wrong_tenant");
});

test("PG IDENTITY: duplicate id → IdentityError(duplicate_id)", async () => {
  const { store } = await freshStore();
  const h = human(); store.create(h);
  let threw: IdentityError | null = null;
  try { store.create(h); } catch (e) { threw = e as IdentityError; }
  assert(threw instanceof IdentityError);
  eq(threw!.code, "duplicate_id");
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test("PG IDENTITY: full chain human → agent → sub-agent created and retrievable", async () => {
  const { store } = await freshStore();
  const h = human(); store.create(h);
  const a = agent(h.id); store.create(a);
  const sa = subagent(a.id); store.create(sa);

  eq(store.getById(h.id)?.type, "human");
  eq(store.getById(a.id)?.type, "agent");
  eq(store.getById(sa.id)?.type, "sub-agent");
  eq(store.getById("no-such-id"), null);

  eq(store.cacheSize, 3);
});

test("PG IDENTITY: getByTenant returns only same-tenant identities", async () => {
  const { store } = await freshStore();
  const h1 = human({ tenantId: "pg-id-A" }); store.create(h1);
  const h2 = human({ tenantId: "pg-id-B" }); store.create(h2);
  const a1 = agent(h1.id, { tenantId: "pg-id-A" }); store.create(a1);

  const tenantA = store.getByTenant("pg-id-A");
  eq(tenantA.length, 2);
  assert(tenantA.every((i) => i.tenantId === "pg-id-A"), "all from tenant A");

  const tenantB = store.getByTenant("pg-id-B");
  eq(tenantB.length, 1);
  eq(tenantB[0].id, h2.id);
});

test("PG IDENTITY: metadata round-trips correctly", async () => {
  const { store } = await freshStore();
  const meta = { role: "auditor", level: 3 };
  const h = human({ metadata: meta }); store.create(h);
  const retrieved = store.getById(h.id);
  assert(retrieved !== null);
  eq(retrieved!.metadata?.role, "auditor");
  eq(retrieved!.metadata?.level, 3);
});

test("PG IDENTITY: publicKey round-trips", async () => {
  const { store } = await freshStore();
  const h = human({ publicKey: "ed25519-test-pubkey-abc123" }); store.create(h);
  const retrieved = store.getById(h.id);
  eq(retrieved?.publicKey, "ed25519-test-pubkey-abc123");
});

// ─── Write-through to pg ──────────────────────────────────────────────────────

test("PG IDENTITY: write-through — row appears in pg table after async settle", async () => {
  const pool = new InMemoryPool();
  const store = new PgIdentityStore(pool);
  await store.init();

  const h = human({ id: "wt-human-1" });
  store.create(h);

  // Give the async write-through a tick to land
  await new Promise((r) => setTimeout(r, 10));

  const result = await pool.query<{ id: string }>(
    "SELECT id FROM agent_identities WHERE id = $1",
    ["wt-human-1"],
  );
  eq(result.rowCount, 1, "row written to pg");
  eq(result.rows[0].id, "wt-human-1");
});

test("PG IDENTITY: write-errors counter = 0 on normal operation", async () => {
  const { store } = await freshStore();
  const h = human(); store.create(h);
  await new Promise((r) => setTimeout(r, 10));
  eq(store.pgWriteErrors, 0);
});

// ─── Restart / persistence ────────────────────────────────────────────────────

test("PG IDENTITY: restart — delegation chain survives (human+agent preloaded from pg)", async () => {
  const pool = new InMemoryPool();

  // Session 1: create human + agent
  const store1 = new PgIdentityStore(pool);
  await store1.init();
  const h = human({ id: "restart-human-1" });
  const a = agent(h.id, { id: "restart-agent-1" });
  store1.create(h);
  store1.create(a);
  await new Promise((r) => setTimeout(r, 20)); // wait for write-through

  // Session 2: new store on same pool — simulates server restart
  const store2 = new PgIdentityStore(pool);
  await store2.init();

  eq(store2.cacheSize, 2, "both identities preloaded from pg");
  eq(store2.getById("restart-human-1")?.type, "human");
  eq(store2.getById("restart-agent-1")?.type, "agent");

  // Delegation chain intact — can create new sub-agent
  const sa = subagent(a.id, { id: "restart-subagent-1", tenantId: "pg-id-t1" });
  const created = store2.create(sa);
  eq(created.type, "sub-agent");
  eq(store2.cacheSize, 3);
});

test("PG IDENTITY: restart — requireValidDelegation passes for pre-restart chain", async () => {
  const pool = new InMemoryPool();

  const store1 = new PgIdentityStore(pool);
  await store1.init();
  const h = human({ id: "rvd-human-1" });
  const a = agent(h.id, { id: "rvd-agent-1" });
  store1.create(h);
  store1.create(a);
  await new Promise((r) => setTimeout(r, 20));

  // Restart
  const store2 = new PgIdentityStore(pool);
  await store2.init();

  const guard = requireValidDelegation(store2);
  const ctx = {
    tenantId: "pg-id-t1",
    timestamp: new Date().toISOString(),
    action: {
      id: "test-action-1",
      tenantId: "pg-id-t1",
      type: "ledger.mint",
      payload: {},
      source: "rvd-agent-1",
      isFinancial: true,
      isAutonomous: true,
      requestedAt: new Date().toISOString(),
    },
  };
  const result = guard.evaluate(ctx as any);
  eq((result as any).allow, true, "requireValidDelegation allows after restart");
});

test("PG IDENTITY: restart — duplicate create() after reload → IdentityError(duplicate_id)", async () => {
  const pool = new InMemoryPool();
  const store1 = new PgIdentityStore(pool);
  await store1.init();
  const h = human({ id: "dup-restart-human" });
  store1.create(h);
  await new Promise((r) => setTimeout(r, 20));

  // Restart
  const store2 = new PgIdentityStore(pool);
  await store2.init();

  let threw: IdentityError | null = null;
  try { store2.create(h); } catch (e) { threw = e as IdentityError; }
  assert(threw instanceof IdentityError);
  eq(threw!.code, "duplicate_id", "duplicate after restart is caught via cache");
});

test("PG IDENTITY: init() is idempotent (double-call does not throw or duplicate)", async () => {
  const pool = new InMemoryPool();
  const store = new PgIdentityStore(pool);
  await store.init();
  const h = human({ id: "idem-human-1" });
  store.create(h);
  await new Promise((r) => setTimeout(r, 20));
  // Call init() again (simulates hot-reload or accidental double-call)
  await store.init();
  // Cache should still have the identity
  assert(store.getById("idem-human-1") !== null, "identity survives double init");
});
