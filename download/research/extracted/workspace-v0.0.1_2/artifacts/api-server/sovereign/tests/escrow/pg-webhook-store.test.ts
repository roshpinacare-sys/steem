import "../_flush.mjs";
/**
 * tests/escrow/pg-webhook-store.test.ts — PgWebhookStore: PostgreSQL-backed WebhookStore.
 * Coverage: init idempotent · put (insert + update) · get · list · delete ·
 * tenant isolation · active flag round-trip · events JSON round-trip · fail-closed.
 */
import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { PgWebhookStore } from "../../lib/escrow/pg-webhook-store.ts";
import type { WebhookRegistration } from "../../lib/escrow/webhook.ts";

function makeStore() {
  const pool = new InMemoryPool();
  return { pool, store: new PgWebhookStore(pool) };
}

function makeReg(overrides: Partial<WebhookRegistration> = {}): WebhookRegistration {
  return {
    id: "wh-001",
    tenantId: "t1",
    url: "https://example.com/hook",
    events: ["settlement.released", "settlement.disputed"],
    secret: "super-secret-key-long-enough-32x",
    createdAt: "2025-01-01T00:00:00.000Z",
    active: true,
    ...overrides,
  };
}

// ─── init ─────────────────────────────────────────────────────────────────────

test("pg-webhook-store: init is idempotent (no error on second call)", async () => {
  const { store } = makeStore();
  await store.init();
  await store.init(); // should not throw
  assert(true, "double init OK");
});

// ─── put + get (insert) ───────────────────────────────────────────────────────

test("pg-webhook-store: put inserts and get retrieves registration", async () => {
  const { store } = makeStore();
  const reg = makeReg();
  await store.put(reg);
  const found = await store.get("t1", "wh-001");
  assert(found !== null, "registration found");
  eq(found!.id, "wh-001");
  eq(found!.tenantId, "t1");
  eq(found!.url, "https://example.com/hook");
  eq(JSON.stringify(found!.events), JSON.stringify(["settlement.released", "settlement.disputed"]));
  eq(found!.secret, "super-secret-key-long-enough-32x");
  eq(found!.active, true);
});

// ─── put (update) ─────────────────────────────────────────────────────────────

test("pg-webhook-store: put with same id updates registration", async () => {
  const { store } = makeStore();
  const reg = makeReg();
  await store.put(reg);
  const updated = { ...reg, url: "https://new.example.com/hook", active: false };
  await store.put(updated);
  const found = await store.get("t1", "wh-001");
  eq(found!.url, "https://new.example.com/hook");
  eq(found!.active, false);
});

// ─── active flag ──────────────────────────────────────────────────────────────

test("pg-webhook-store: active=false round-trips correctly", async () => {
  const { store } = makeStore();
  const reg = makeReg({ id: "wh-inactive", active: false });
  await store.put(reg);
  const found = await store.get("t1", "wh-inactive");
  eq(found!.active, false);
});

// ─── events JSON ─────────────────────────────────────────────────────────────

test("pg-webhook-store: events array round-trips via JSON correctly", async () => {
  const { store } = makeStore();
  const events = ["settlement.funded", "settlement.released", "settlement.reversed"];
  const reg = makeReg({ id: "wh-events", events });
  await store.put(reg);
  const found = await store.get("t1", "wh-events");
  eq(JSON.stringify(found!.events), JSON.stringify(events));
});

// ─── get — not found / cross-tenant ──────────────────────────────────────────

test("pg-webhook-store: get returns null for missing id", async () => {
  const { store } = makeStore();
  const result = await store.get("t1", "does-not-exist");
  eq(result, null);
});

test("pg-webhook-store: get returns null for cross-tenant access", async () => {
  const { store } = makeStore();
  await store.put(makeReg({ tenantId: "t1", id: "wh-t1" }));
  const result = await store.get("t2", "wh-t1"); // wrong tenant
  eq(result, null);
});

// ─── list ─────────────────────────────────────────────────────────────────────

test("pg-webhook-store: list returns all registrations for tenant", async () => {
  const { store } = makeStore();
  await store.put(makeReg({ id: "wh-a", tenantId: "t1" }));
  await store.put(makeReg({ id: "wh-b", tenantId: "t1" }));
  await store.put(makeReg({ id: "wh-c", tenantId: "t2" })); // different tenant
  const list = await store.list("t1");
  eq(list.length, 2);
  const ids = list.map((r) => r.id).sort();
  eq(JSON.stringify(ids), JSON.stringify(["wh-a", "wh-b"]));
});

test("pg-webhook-store: list returns empty array when no registrations", async () => {
  const { store } = makeStore();
  const list = await store.list("t-nobody");
  eq(list.length, 0);
});

// ─── delete ───────────────────────────────────────────────────────────────────

test("pg-webhook-store: delete removes registration and returns true", async () => {
  const { store } = makeStore();
  await store.put(makeReg());
  const result = await store.delete("t1", "wh-001");
  eq(result, true);
  const found = await store.get("t1", "wh-001");
  eq(found, null);
});

test("pg-webhook-store: delete returns false for missing id", async () => {
  const { store } = makeStore();
  const result = await store.delete("t1", "does-not-exist");
  eq(result, false);
});

test("pg-webhook-store: delete is tenant-isolated (cross-tenant delete fails)", async () => {
  const { store } = makeStore();
  await store.put(makeReg({ tenantId: "t1", id: "wh-001" }));
  const result = await store.delete("t2", "wh-001"); // wrong tenant
  eq(result, false);
  const still = await store.get("t1", "wh-001");
  assert(still !== null, "registration still exists for t1");
});

// ─── multiple tenants isolated ────────────────────────────────────────────────

test("pg-webhook-store: tenant isolation — list only returns own tenant's registrations", async () => {
  const { store } = makeStore();
  await store.put(makeReg({ id: "wh-t1-1", tenantId: "t1" }));
  await store.put(makeReg({ id: "wh-t1-2", tenantId: "t1" }));
  await store.put(makeReg({ id: "wh-t2-1", tenantId: "t2" }));
  const t1List = await store.list("t1");
  const t2List = await store.list("t2");
  eq(t1List.length, 2);
  eq(t2List.length, 1);
  eq(t2List[0].id, "wh-t2-1");
});

// ─── restart survival (core value of PgWebhookStore) ──────────────────────────

test("pg-webhook-store: data survives 'restart' (new instance, same pool)", async () => {
  const pool = new InMemoryPool();
  const store1 = new PgWebhookStore(pool);
  await store1.put(makeReg({ id: "wh-restart", tenantId: "t-restart" }));

  const store2 = new PgWebhookStore(pool);
  const found = await store2.get("t-restart", "wh-restart");
  assert(found !== null, "data visible to new store instance after simulated restart");
  eq(found!.url, "https://example.com/hook");
});
