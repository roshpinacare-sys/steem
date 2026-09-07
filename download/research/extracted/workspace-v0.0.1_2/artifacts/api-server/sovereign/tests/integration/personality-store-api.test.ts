import "../_flush.mjs";
/**
 * tests/integration/personality-store-api.test.ts
 *
 * Live-server HTTP integration tests for:
 *   POST /api/potential/personality  — auto-saves after map()
 *   GET  /api/potential/personality/:userId — loads saved profile
 *
 * Covered:
 *   POST auto-save
 *     • 200 + profile returned (existing behaviour preserved)
 *     • profile is persisted: immediate GET returns same data
 *     • second POST overwrites (upsert): GET returns updated profile
 *
 *   GET /api/potential/personality/:userId
 *     • 404 when profile never saved
 *     • 200 + ok:true + full profile shape after POST
 *     • data.userId / data.tenantId match
 *     • data.traits, confidence, evidence, analyzedAt present
 *
 *   Tenant isolation
 *     • GET with wrong tenant → 404 (not visible cross-tenant)
 *     • POST tenant-A does not affect tenant-B GET
 *
 *   Validation
 *     • GET missing x-tenant-id → 400
 *
 * All assertions against a live Node http server (startSovereignServer port=0).
 * Zero external dependencies.
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;

const H  = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
const post = (path: string, body: any, tenant = "ps-t1") =>
  fetch(base + path, { method: "POST", headers: H(tenant), body: JSON.stringify(body) });
const get  = (path: string, tenant = "ps-t1") =>
  fetch(base + path, { headers: H(tenant) });

// Minimal POST body for a known user
const body1 = { userId: "user-store-1" };
const body2 = { userId: "user-store-2" };

// ─── POST auto-save — basic ───────────────────────────────────────────────────

test("POST /api/potential/personality still returns 200 + ok:true", async () => {
  const r = await post("/api/potential/personality", body1);
  eq(r.status, 200);
  const j = await r.json() as any;
  eq(j.ok, true);
  assert(j.data !== undefined, "data present");
});

test("POST auto-save: immediate GET returns the saved profile", async () => {
  await post("/api/potential/personality", { userId: "save-test-user" });
  const r = await get("/api/potential/personality/save-test-user");
  eq(r.status, 200);
  const j = await r.json() as any;
  eq(j.ok, true);
  eq(j.data.userId, "save-test-user");
  eq(j.data.tenantId, "ps-t1");
});

test("POST auto-save: second POST upserts — GET returns most recent analyzedAt", async () => {
  const uid = "upsert-user";
  // First POST — no signals
  const r1 = await post("/api/potential/personality", { userId: uid });
  const at1 = (await r1.json() as any).data.analyzedAt;

  // Small delay to ensure different timestamp
  await new Promise(res => setTimeout(res, 5));

  // Second POST — with a KG signal
  const kgSig = { userId: uid, tenantId: "ps-t1", nodeType: "mentorship", category: "leadership", weight: 1.0 };
  const r2 = await post("/api/potential/personality", {
    userId: uid,
    knowledgeSignals: [kgSig],
  });
  const at2 = (await r2.json() as any).data.analyzedAt;

  // GET should return the SECOND (upserted) profile
  const rGet = await get(`/api/potential/personality/${uid}`);
  const j = await rGet.json() as any;
  eq(j.data.analyzedAt, at2);
  // Second profile has higher leadership from mentorship signal
  assert(j.data.traits.leadership > 0, "leadership > 0 from mentorship signal");
});

// ─── GET — not-found before POST ─────────────────────────────────────────────

test("GET returns 404 for user who has never POSTed", async () => {
  const r = await get("/api/potential/personality/never-saved-99999");
  eq(r.status, 404);
  const j = await r.json() as any;
  assert(j.error !== undefined || j.ok === false || r.status === 404, "404 response");
});

// ─── GET — shape after POST ───────────────────────────────────────────────────

test("GET returns full profile shape: traits, confidence, evidence, analyzedAt", async () => {
  await post("/api/potential/personality", { userId: "shape-user" });
  const r = await get("/api/potential/personality/shape-user");
  eq(r.status, 200);
  const j = (await r.json() as any).data;

  // traits
  const traitKeys = ["extroversion", "focus", "collaboration", "creativity", "leadership"];
  for (const k of traitKeys) {
    assert(typeof j.traits[k] === "number", `traits.${k} is number`);
    assert(j.traits[k] >= 0 && j.traits[k] <= 100, `traits.${k} in [0,100]`);
  }
  // confidence
  for (const k of traitKeys) {
    assert(typeof j.confidence[k] === "number", `confidence.${k} is number`);
    assert(j.confidence[k] >= 0 && j.confidence[k] <= 1, `confidence.${k} in [0,1]`);
  }
  // evidence
  assert(Array.isArray(j.evidence), "evidence is array");
  // analyzedAt
  assert(typeof j.analyzedAt === "string", "analyzedAt is string");
  assert(!isNaN(Date.parse(j.analyzedAt)), "analyzedAt is valid ISO");
});

test("GET data.userId and data.tenantId match the request", async () => {
  await post("/api/potential/personality", { userId: "id-check-user" });
  const j = (await get("/api/potential/personality/id-check-user")).json() as any;
  const data = (await j).data;
  eq(data.userId, "id-check-user");
  eq(data.tenantId, "ps-t1");
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

test("GET with wrong tenant returns 404 (cross-tenant isolation)", async () => {
  // POST as tenant-A
  await post("/api/potential/personality", { userId: "tenant-iso-user" }, "iso-tenant-A");
  // GET as tenant-B → must not find it
  const r = await get("/api/potential/personality/tenant-iso-user", "iso-tenant-B");
  eq(r.status, 404);
});

test("POST tenant-A does not affect GET for tenant-B same userId", async () => {
  const uid = "shared-uid";
  // POST as tenant-X with a strong signal
  const kgSig = { userId: uid, tenantId: "tenant-X", nodeType: "skill", category: "mentorship", weight: 1.0 };
  await post("/api/potential/personality", { userId: uid, knowledgeSignals: [kgSig] }, "tenant-X");

  // tenant-Y has not POSTed → 404
  const r = await get(`/api/potential/personality/${uid}`, "tenant-Y");
  eq(r.status, 404);
});

test("Two tenants with same userId have independent profiles", async () => {
  const uid = "twin-user";
  const kgSig = (t: string) => ({ userId: uid, tenantId: t, nodeType: "mentorship", category: "leadership", weight: 1.0 });

  // tenant-1: POST with signal → leadership > 0
  await post("/api/potential/personality", { userId: uid, knowledgeSignals: [kgSig("twin-1")] }, "twin-1");
  // tenant-2: POST with no signals → all 0
  await post("/api/potential/personality", { userId: uid }, "twin-2");

  const j1 = (await (await get(`/api/potential/personality/${uid}`, "twin-1")).json() as any).data;
  const j2 = (await (await get(`/api/potential/personality/${uid}`, "twin-2")).json() as any).data;

  assert(j1.traits.leadership > 0, "tenant-1 leadership > 0");
  eq(j2.traits.leadership, 0);
});

// ─── Validation ───────────────────────────────────────────────────────────────

test("GET missing x-tenant-id → 400", async () => {
  const r = await fetch(`${base}/api/potential/personality/any-user`);
  eq(r.status, 400);
});

test("cleanup: close server", () => { server.close(); });
