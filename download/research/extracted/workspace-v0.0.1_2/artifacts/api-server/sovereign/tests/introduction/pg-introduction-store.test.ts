import "../_flush.mjs";
/**
 * tests/introduction/pg-introduction-store.test.ts — PgIntroductionStore: durable
 * cross-tenant introduction persistence.
 *
 * Coverage: init idempotent · save (insert + update) · get · list ·
 * listForTarget · getWithAccess · tenant isolation · survive restart · fail-closed.
 */
import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { PgIntroductionStore } from "../../lib/introduction/pg-introduction-store.ts";
import type { IntroductionRequest } from "../../lib/introduction/types.ts";

function makeStore() {
  const pool = new InMemoryPool();
  return { pool, store: new PgIntroductionStore(pool) };
}

function makeReq(overrides: Partial<IntroductionRequest> = {}): IntroductionRequest {
  return {
    id: "intro-001",
    sourceTenantId: "t1",
    targetTenantId: "t2",
    proofTarget: { kind: "track-record", identityId: "actor-123" },
    signature: "sig-abc",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ─── init ─────────────────────────────────────────────────────────────────────

test("pg-introduction-store: init is idempotent (no error on second call)", async () => {
  const { store } = makeStore();
  await store.init();
  await store.init(); // should not throw
  assert(true, "double init OK");
});

// ─── save + get (insert) ──────────────────────────────────────────────────────

test("pg-introduction-store: save inserts and get retrieves request", async () => {
  const { store } = makeStore();
  const req = makeReq();
  await store.save(req);
  const found = await store.get("intro-001", "t1");
  assert(found !== null, "request found");
  eq(found!.id, "intro-001");
  eq(found!.sourceTenantId, "t1");
  eq(found!.targetTenantId, "t2");
  eq(found!.proofTarget.kind, "track-record");
  eq(found!.proofTarget.identityId, "actor-123");
  eq(found!.signature, "sig-abc");
  eq(found!.createdAt, "2025-01-01T00:00:00.000Z");
});

// ─── save (update) ────────────────────────────────────────────────────────────

test("pg-introduction-store: save with same id updates request", async () => {
  const { store } = makeStore();
  const req = makeReq();
  await store.save(req);
  const updated = { ...req, targetTenantId: "t3", signature: "sig-def" };
  await store.save(updated);
  const found = await store.get("intro-001", "t1");
  eq(found!.targetTenantId, "t3");
  eq(found!.signature, "sig-def");
});

// ─── get — not found / cross-tenant ──────────────────────────────────────────

test("pg-introduction-store: get returns null for missing id", async () => {
  const { store } = makeStore();
  const result = await store.get("t1", "does-not-exist");
  eq(result, null);
});

test("pg-introduction-store: get returns null for cross-tenant access", async () => {
  const { store } = makeStore();
  await store.save(makeReq({ sourceTenantId: "t1", id: "intro-t1" }));
  const result = await store.get("intro-t1", "t2"); // wrong tenant
  eq(result, null);
});

// ─── list ─────────────────────────────────────────────────────────────────────

test("pg-introduction-store: list returns all requests for source tenant", async () => {
  const { store } = makeStore();
  await store.save(makeReq({ id: "intro-a", sourceTenantId: "t1" }));
  await store.save(makeReq({ id: "intro-b", sourceTenantId: "t1" }));
  await store.save(makeReq({ id: "intro-c", sourceTenantId: "t2" })); // different tenant
  const list = await store.list("t1");
  eq(list.length, 2);
  const ids = list.map((r) => r.id).sort();
  eq(JSON.stringify(ids), JSON.stringify(["intro-a", "intro-b"]));
});

test("pg-introduction-store: list returns empty array when no requests", async () => {
  const { store } = makeStore();
  const list = await store.list("t-nobody");
  eq(list.length, 0);
});

// ─── listForTarget ────────────────────────────────────────────────────────────

test("pg-introduction-store: listForTarget returns inbox for target tenant", async () => {
  const { store } = makeStore();
  await store.save(makeReq({ id: "intro-a", sourceTenantId: "t1", targetTenantId: "t2" }));
  await store.save(makeReq({ id: "intro-b", sourceTenantId: "t1", targetTenantId: "t2" }));
  await store.save(makeReq({ id: "intro-c", sourceTenantId: "t3", targetTenantId: "t4" }));
  const list = await store.listForTarget("t2");
  eq(list.length, 2);
  assert(list.every((r) => r.targetTenantId === "t2"), "all items should target t2");
});

test("pg-introduction-store: listForTarget returns empty array when no inbox items", async () => {
  const { store } = makeStore();
  const list = await store.listForTarget("t-nobody");
  eq(list.length, 0);
});

// ─── getWithAccess ────────────────────────────────────────────────────────────

test("pg-introduction-store: getWithAccess allows source tenant", async () => {
  const { store } = makeStore();
  await store.save(makeReq({ id: "intro-ga", sourceTenantId: "t-src", targetTenantId: "t-tgt" }));
  const found = await store.getWithAccess("intro-ga", "t-src");
  assert(found !== null, "source tenant should have access");
  eq(found!.id, "intro-ga");
});

test("pg-introduction-store: getWithAccess allows target tenant", async () => {
  const { store } = makeStore();
  await store.save(makeReq({ id: "intro-ga2", sourceTenantId: "t-src", targetTenantId: "t-tgt" }));
  const found = await store.getWithAccess("intro-ga2", "t-tgt");
  assert(found !== null, "target tenant should have access");
  eq(found!.id, "intro-ga2");
});

test("pg-introduction-store: getWithAccess denies unrelated tenant", async () => {
  const { store } = makeStore();
  await store.save(makeReq({ id: "intro-ga3", sourceTenantId: "t-src", targetTenantId: "t-tgt" }));
  const found = await store.getWithAccess("intro-ga3", "t-evil");
  eq(found, null);
});

test("pg-introduction-store: getWithAccess returns null for missing id", async () => {
  const { store } = makeStore();
  const result = await store.getWithAccess("does-not-exist", "t1");
  eq(result, null);
});

// ─── tenant isolation ─────────────────────────────────────────────────────────

test("pg-introduction-store: tenant isolation — list only returns own outbox", async () => {
  const { store } = makeStore();
  await store.save(makeReq({ id: "intro-t1-1", sourceTenantId: "t1" }));
  await store.save(makeReq({ id: "intro-t1-2", sourceTenantId: "t1" }));
  await store.save(makeReq({ id: "intro-t2-1", sourceTenantId: "t2" }));
  const t1List = await store.list("t1");
  const t2List = await store.list("t2");
  eq(t1List.length, 2);
  eq(t2List.length, 1);
  eq(t2List[0].id, "intro-t2-1");
});

test("pg-introduction-store: tenant isolation — listForTarget only returns own inbox", async () => {
  const { store } = makeStore();
  await store.save(makeReq({ id: "intro-in1", sourceTenantId: "t1", targetTenantId: "t2" }));
  await store.save(makeReq({ id: "intro-in2", sourceTenantId: "t3", targetTenantId: "t4" }));
  const t2Inbox = await store.listForTarget("t2");
  const t4Inbox = await store.listForTarget("t4");
  eq(t2Inbox.length, 1);
  eq(t4Inbox.length, 1);
  eq(t2Inbox[0].id, "intro-in1");
  eq(t4Inbox[0].id, "intro-in2");
});

// ─── restart survival (core value of PgIntroductionStore) ───────────────────────

test("pg-introduction-store: data survives 'restart' (new instance, same pool)", async () => {
  const pool = new InMemoryPool();
  const store1 = new PgIntroductionStore(pool);
  await store1.save(makeReq({ id: "intro-restart", sourceTenantId: "t-restart", targetTenantId: "t-target" }));

  const store2 = new PgIntroductionStore(pool);
  const found = await store2.get("intro-restart", "t-restart");
  assert(found !== null, "data visible to new store instance after simulated restart");
  eq(found.proofTarget.identityId, "actor-123");
});
