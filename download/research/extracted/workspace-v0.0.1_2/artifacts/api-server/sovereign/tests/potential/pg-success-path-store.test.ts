import "../_flush.mjs";
/**
 * tests/potential/pg-success-path-store.test.ts
 *
 * Unit tests for PgSuccessPathStore (InMemoryPool, no external DB).
 * Integration tests for POST /api/potential/success-path (auto-save)
 * and GET /api/potential/success-path/:userId/:opportunityId (load).
 *
 * Coverage — Store:
 *   init: idempotent
 *   save: happy path, upsert replaces, missing userId/tenantId/opportunityId/id, empty fields
 *   load: happy path, not found, cross-tenant isolation, empty inputs
 *   listByUser: empty, multi-opportunity, tenant isolation, empty inputs
 *   delete: happy path, not found, cross-tenant, empty inputs
 *   totalCount: zero, multi-tenant, decreases after delete, empty tenantId
 *   persistence: two instances same pool
 *   composition: buildSovereignStack exposes successPathStore; save+load round-trip
 *
 * Coverage — HTTP (live server port=0):
 *   POST /api/potential/success-path: auto-save after compute
 *   GET /api/potential/success-path/:userId/:opportunityId: load saved path
 *   GET: missing x-tenant-id → 400, not found → 404, cross-tenant → 404
 *   GET: after POST, GET returns same data (id, fitScores, steps)
 *   POST twice same user+opportunity: GET returns latest
 *   Tenant isolation: tenant-B cannot GET tenant-A's path
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import {
  PgSuccessPathStore,
  SuccessPathStoreError,
} from "../../lib/potential/pg-success-path-store.ts";
import type { SuccessPath } from "../../lib/potential/personality-types.ts";
import { buildSovereignStack, defaultPolicies } from "../../src/composition.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { randomUUID } from "node:crypto";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePath(overrides: Partial<SuccessPath> = {}): SuccessPath {
  return {
    id: randomUUID(),
    userId: "u1",
    tenantId: "tenant-sp",
    targetOpportunityId: "opp-1",
    currentFitScore: 40,
    projectedFitScore: 80,
    steps: [
      { id: randomUUID(), title: "Learn TypeScript", description: "Study TS", targetCategory: "technical", expectedGain: 20, estimatedHours: 10, difficulty: 2 },
    ],
    totalHours: 10,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function freshStore() {
  const pool = new InMemoryPool();
  const store = new PgSuccessPathStore(pool);
  return { pool, store };
}

// ─── init ─────────────────────────────────────────────────────────────────────

test("PgSuccessPathStore: init is idempotent (call twice → no error)", async () => {
  const { store } = freshStore();
  await store.init();
  await store.init();
  eq(await store.totalCount("nobody"), 0);
});

// ─── save ─────────────────────────────────────────────────────────────────────

test("PgSuccessPathStore: save persists all fields", async () => {
  const { store } = freshStore();
  await store.init();
  const p = makePath({ userId: "u1", tenantId: "t-save", targetOpportunityId: "opp-save" });
  await store.save(p);
  const loaded = await store.load("t-save", "u1", "opp-save");
  assert(loaded !== null, "should find saved path");
  eq(loaded!.id, p.id);
  eq(loaded!.userId, "u1");
  eq(loaded!.tenantId, "t-save");
  eq(loaded!.targetOpportunityId, "opp-save");
  eq(loaded!.currentFitScore, 40);
  eq(loaded!.projectedFitScore, 80);
  eq(loaded!.steps.length, 1);
  eq(loaded!.steps[0].title, "Learn TypeScript");
  eq(loaded!.totalHours, 10);
  assert(typeof loaded!.createdAt === "string", "createdAt is string");
});

test("PgSuccessPathStore: save upserts — second save replaces first", async () => {
  const { store } = freshStore();
  await store.init();
  const id1 = randomUUID(), id2 = randomUUID();
  await store.save(makePath({ id: id1, userId: "u1", tenantId: "t-ups", targetOpportunityId: "opp-x", projectedFitScore: 50 }));
  await store.save(makePath({ id: id2, userId: "u1", tenantId: "t-ups", targetOpportunityId: "opp-x", projectedFitScore: 90 }));
  const loaded = await store.load("t-ups", "u1", "opp-x");
  assert(loaded !== null, "should find path");
  eq(loaded!.id, id2);
  eq(loaded!.projectedFitScore, 90);
  eq(await store.totalCount("t-ups"), 1); // still one row
});

test("PgSuccessPathStore: save missing userId → MISSING_USER_ID", async () => {
  const { store } = freshStore();
  await store.init();
  let caught: SuccessPathStoreError | null = null;
  try { await store.save(makePath({ userId: "" })); } catch (e) { caught = e as SuccessPathStoreError; }
  assert(caught instanceof SuccessPathStoreError, "should throw");
  eq(caught!.code, "MISSING_USER_ID");
});

test("PgSuccessPathStore: save missing tenantId → MISSING_TENANT_ID", async () => {
  const { store } = freshStore();
  await store.init();
  let caught: SuccessPathStoreError | null = null;
  try { await store.save(makePath({ tenantId: "" })); } catch (e) { caught = e as SuccessPathStoreError; }
  assert(caught instanceof SuccessPathStoreError, "should throw");
  eq(caught!.code, "MISSING_TENANT_ID");
});

test("PgSuccessPathStore: save missing targetOpportunityId → MISSING_OPPORTUNITY_ID", async () => {
  const { store } = freshStore();
  await store.init();
  let caught: SuccessPathStoreError | null = null;
  try { await store.save(makePath({ targetOpportunityId: "" })); } catch (e) { caught = e as SuccessPathStoreError; }
  assert(caught instanceof SuccessPathStoreError, "should throw");
  eq(caught!.code, "MISSING_OPPORTUNITY_ID");
});

test("PgSuccessPathStore: save missing id → MISSING_PATH_ID", async () => {
  const { store } = freshStore();
  await store.init();
  let caught: SuccessPathStoreError | null = null;
  try { await store.save(makePath({ id: "" })); } catch (e) { caught = e as SuccessPathStoreError; }
  assert(caught instanceof SuccessPathStoreError, "should throw");
  eq(caught!.code, "MISSING_PATH_ID");
});

// ─── load ─────────────────────────────────────────────────────────────────────

test("PgSuccessPathStore: load returns null for unknown", async () => {
  const { store } = freshStore();
  await store.init();
  eq(await store.load("t1", "nobody", "opp-x"), null);
});

test("PgSuccessPathStore: load — cross-tenant isolation", async () => {
  const { store } = freshStore();
  await store.init();
  await store.save(makePath({ userId: "u1", tenantId: "tenant-A", targetOpportunityId: "opp-1" }));
  eq(await store.load("tenant-B", "u1", "opp-1"), null);
});

test("PgSuccessPathStore: load empty inputs → null", async () => {
  const { store } = freshStore();
  await store.init();
  eq(await store.load("", "u1", "opp"), null);
  eq(await store.load("t1", "", "opp"), null);
  eq(await store.load("t1", "u1", ""), null);
});

// ─── listByUser ───────────────────────────────────────────────────────────────

test("PgSuccessPathStore: listByUser empty → []", async () => {
  const { store } = freshStore();
  await store.init();
  eq((await store.listByUser("t1", "nobody")).length, 0);
});

test("PgSuccessPathStore: listByUser returns paths for multiple opportunities", async () => {
  const { store } = freshStore();
  await store.init();
  await store.save(makePath({ userId: "u1", tenantId: "t-list", targetOpportunityId: "opp-1" }));
  await store.save(makePath({ userId: "u1", tenantId: "t-list", targetOpportunityId: "opp-2" }));
  await store.save(makePath({ userId: "u2", tenantId: "t-list", targetOpportunityId: "opp-1" }));
  const paths = await store.listByUser("t-list", "u1");
  eq(paths.length, 2);
  const opps = paths.map(p => p.targetOpportunityId).sort();
  eq(opps[0], "opp-1");
  eq(opps[1], "opp-2");
});

test("PgSuccessPathStore: listByUser tenant isolation", async () => {
  const { store } = freshStore();
  await store.init();
  await store.save(makePath({ userId: "u1", tenantId: "t-iso-1", targetOpportunityId: "opp-1" }));
  await store.save(makePath({ userId: "u1", tenantId: "t-iso-2", targetOpportunityId: "opp-1" }));
  eq((await store.listByUser("t-iso-1", "u1")).length, 1);
  eq((await store.listByUser("t-iso-2", "u1")).length, 1);
});

test("PgSuccessPathStore: listByUser empty inputs → []", async () => {
  const { store } = freshStore();
  await store.init();
  eq((await store.listByUser("", "u1")).length, 0);
  eq((await store.listByUser("t1", "")).length, 0);
});

// ─── delete ───────────────────────────────────────────────────────────────────

test("PgSuccessPathStore: delete happy path → true, then load → null", async () => {
  const { store } = freshStore();
  await store.init();
  await store.save(makePath({ userId: "u1", tenantId: "t-del", targetOpportunityId: "opp-del" }));
  eq(await store.delete("t-del", "u1", "opp-del"), true);
  eq(await store.load("t-del", "u1", "opp-del"), null);
});

test("PgSuccessPathStore: delete unknown → false", async () => {
  const { store } = freshStore();
  await store.init();
  eq(await store.delete("t1", "nobody", "opp"), false);
});

test("PgSuccessPathStore: delete cross-tenant → false, data intact", async () => {
  const { store } = freshStore();
  await store.init();
  await store.save(makePath({ userId: "u1", tenantId: "t-owner", targetOpportunityId: "opp-x" }));
  eq(await store.delete("t-other", "u1", "opp-x"), false);
  assert(await store.load("t-owner", "u1", "opp-x") !== null, "data should be intact");
});

test("PgSuccessPathStore: delete empty inputs → false", async () => {
  const { store } = freshStore();
  await store.init();
  eq(await store.delete("", "u1", "opp"), false);
});

// ─── totalCount ───────────────────────────────────────────────────────────────

test("PgSuccessPathStore: totalCount zero", async () => {
  const { store } = freshStore();
  await store.init();
  eq(await store.totalCount("empty"), 0);
});

test("PgSuccessPathStore: totalCount counts only requested tenant", async () => {
  const { store } = freshStore();
  await store.init();
  await store.save(makePath({ userId: "u1", tenantId: "t-c1", targetOpportunityId: "opp-1" }));
  await store.save(makePath({ userId: "u1", tenantId: "t-c1", targetOpportunityId: "opp-2" }));
  await store.save(makePath({ userId: "u1", tenantId: "t-c2", targetOpportunityId: "opp-1" }));
  eq(await store.totalCount("t-c1"), 2);
  eq(await store.totalCount("t-c2"), 1);
});

test("PgSuccessPathStore: totalCount decreases after delete", async () => {
  const { store } = freshStore();
  await store.init();
  await store.save(makePath({ userId: "u1", tenantId: "t-dc", targetOpportunityId: "opp-1" }));
  await store.save(makePath({ userId: "u1", tenantId: "t-dc", targetOpportunityId: "opp-2" }));
  eq(await store.totalCount("t-dc"), 2);
  await store.delete("t-dc", "u1", "opp-1");
  eq(await store.totalCount("t-dc"), 1);
});

test("PgSuccessPathStore: totalCount empty tenantId → 0", async () => {
  const { store } = freshStore();
  await store.init();
  eq(await store.totalCount(""), 0);
});

// ─── persistence (two instances, one pool) ────────────────────────────────────

test("PgSuccessPathStore: two instances on same pool see same data", async () => {
  const pool = new InMemoryPool();
  const storeA = new PgSuccessPathStore(pool);
  const storeB = new PgSuccessPathStore(pool);
  await storeA.init();
  const p = makePath({ userId: "u1", tenantId: "t-shared", targetOpportunityId: "opp-shared" });
  await storeA.save(p);
  const loaded = await storeB.load("t-shared", "u1", "opp-shared");
  assert(loaded !== null, "storeB should see storeA's data");
  eq(loaded!.id, p.id);
});

// ─── composition integration ──────────────────────────────────────────────────

test("PgSuccessPathStore: buildSovereignStack exposes successPathStore", () => {
  const stack = buildSovereignStack(defaultPolicies());
  assert(stack.successPathStore instanceof PgSuccessPathStore, "successPathStore is PgSuccessPathStore");
});

test("PgSuccessPathStore: save+load round-trip through composition stack", async () => {
  const pool = new InMemoryPool();
  const stack = buildSovereignStack(defaultPolicies(), { pool });
  await new Promise(r => setTimeout(r, 10)); // let fire-and-forget init settle
  const p = makePath({ userId: "u-stack", tenantId: "t-stack", targetOpportunityId: "opp-stack" });
  await stack.successPathStore.save(p);
  const loaded = await stack.successPathStore.load("t-stack", "u-stack", "opp-stack");
  assert(loaded !== null, "should find saved path");
  eq(loaded!.projectedFitScore, 80);
});

// ─── HTTP integration tests (live server) ─────────────────────────────────────

const pool = new InMemoryPool();
const server = startSovereignServer(0, buildSovereignStack(defaultPolicies(), { pool }), { requireIdempotencyKey: false });
const PORT = (server.address() as { port: number }).port;
const BASE = `http://127.0.0.1:${PORT}`;
const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
const post = (url: string, body: any, tenant = "tenant-http") =>
  fetch(BASE + url, { method: "POST", headers: H(tenant), body: JSON.stringify(body) });
const get = (url: string, tenant = "tenant-http") =>
  fetch(BASE + url, { method: "GET", headers: H(tenant) });

// Helper: create opportunity in catalog, then POST success-path
async function setupOppAndPath(tenant: string, userId: string, oppTitle = "Backend Engineer") {
  const oppRes = await post("/api/marketplace/opportunities", { title: oppTitle, description: "Build APIs", requiredStrengths: [{ category: "technical", minScore: 80 }] }, tenant);
  const oppBody = await oppRes.json();
  const oppId = oppBody.opportunity?.id;

  const profile = {
    userId, tenantId: tenant,
    strengths: [{ category: "technical", score: 50, confidence: 0.8, evidence: [] }],
    computedAt: new Date().toISOString(),
  };
  const spRes = await post("/api/potential/success-path", { userId, profile, targetOpportunityId: oppId }, tenant);
  return { oppId, spRes };
}

test("HTTP GET /api/potential/success-path: missing x-tenant-id → 400", async () => {
  const r = await fetch(BASE + "/api/potential/success-path/u1/opp-1", { method: "GET" });
  eq(r.status, 400);
});

test("HTTP GET /api/potential/success-path: not found → 404", async () => {
  const r = await get("/api/potential/success-path/nobody/opp-none", "tenant-http");
  eq(r.status, 404);
  const b = await r.json();
  assert(b.error, "error message present");
});

test("HTTP POST /api/potential/success-path: auto-saves, then GET retrieves it", async () => {
  const tenant = "t-autosave-" + Date.now();
  const userId = "u-autosave";
  const { oppId, spRes } = await setupOppAndPath(tenant, userId);

  eq(spRes.status, 200);
  const spBody = await spRes.json();
  assert(spBody.ok, "POST returned ok");
  const computed = spBody.data;
  assert(computed.id, "path has id");
  assert(computed.targetOpportunityId === oppId, "correct opportunity");

  // Wait a tick for the fire-and-forget save
  await new Promise(r => setTimeout(r, 20));

  const getRes = await get(`/api/potential/success-path/${userId}/${oppId}`, tenant);
  eq(getRes.status, 200);
  const getBody = await getRes.json();
  assert(getBody.ok, "GET returned ok");
  eq(getBody.data.id, computed.id);
  eq(getBody.data.userId, userId);
  eq(getBody.data.tenantId, tenant);
  eq(getBody.data.targetOpportunityId, oppId);
  assert(typeof getBody.data.currentFitScore === "number", "currentFitScore is number");
  assert(typeof getBody.data.projectedFitScore === "number", "projectedFitScore is number");
  assert(Array.isArray(getBody.data.steps), "steps is array");
  assert(typeof getBody.data.totalHours === "number", "totalHours is number");
  assert(typeof getBody.data.createdAt === "string", "createdAt is string");
});

test("HTTP GET: cross-tenant isolation — tenant-B cannot see tenant-A path", async () => {
  const tenantA = "t-iso-a-" + Date.now();
  const tenantB = "t-iso-b-" + Date.now();
  const userId = "u-iso";

  const { oppId } = await setupOppAndPath(tenantA, userId);
  await new Promise(r => setTimeout(r, 20));

  // tenant-B tries to load tenant-A's path with same userId+oppId
  const r = await get(`/api/potential/success-path/${userId}/${oppId}`, tenantB);
  eq(r.status, 404);
});

test("HTTP POST twice same user+opportunity: GET returns latest", async () => {
  const tenant = "t-refresh-" + Date.now();
  const userId = "u-refresh";

  // Create opportunity
  const oppRes = await post("/api/marketplace/opportunities", { title: "Refresh Test", description: "x", requiredStrengths: [{ category: "technical", minScore: 80 }] }, tenant);
  const oppId = (await oppRes.json()).opportunity?.id;

  const profile = {
    userId, tenantId: tenant,
    strengths: [{ category: "technical", score: 40, confidence: 0.8, evidence: [] }],
    computedAt: new Date().toISOString(),
  };
  // First POST
  const sp1Res = await post("/api/potential/success-path", { userId, profile, targetOpportunityId: oppId }, tenant);
  const sp1 = (await sp1Res.json()).data;

  // Second POST with higher score (re-computation)
  const profile2 = { ...profile, strengths: [{ category: "technical", score: 70, confidence: 0.9, evidence: [] }] };
  const sp2Res = await post("/api/potential/success-path", { userId, profile: profile2, targetOpportunityId: oppId }, tenant);
  const sp2 = (await sp2Res.json()).data;

  await new Promise(r => setTimeout(r, 20));

  const getRes = await get(`/api/potential/success-path/${userId}/${oppId}`, tenant);
  eq(getRes.status, 200);
  const latest = (await getRes.json()).data;
  // Latest save should be sp2 (different id, higher score → fewer gaps → different path)
  eq(latest.id, sp2.id);
});

test("cleanup: close success-path server", () => { server.close(); });
