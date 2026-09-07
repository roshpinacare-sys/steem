import "../_flush.mjs";
/**
 * tests/potential/pg-collaboration-store.test.ts
 *
 * Unit tests for PgCollaborationStore (InMemoryPool, no external DB).
 * Integration tests for POST /api/potential/collaboration (auto-save)
 * and GET /api/potential/collaboration/:userId (load cached matches).
 *
 * Coverage — Store:
 *   init: creates table, idempotent
 *   save: happy path, upsert replaces, missing userId, missing tenantId, empty matches
 *   load: happy path, not found returns null, cross-tenant isolation, empty inputs
 *   delete: happy path, not found, cross-tenant (no-op), empty inputs
 *   totalCount: zero, multi-user, decreases after delete, empty tenantId
 *   persistence: two store instances on same pool see same data
 *   composition: buildSovereignStack exposes collaborationStore; save+load round-trip
 *
 * Coverage — HTTP (live server port=0):
 *   GET missing x-tenant-id → 400
 *   GET not found (no prior POST) → 404
 *   POST auto-save: POST then GET returns same matches
 *   GET data shape: ok:true, data is array, each match has correct fields
 *   POST twice same user: GET returns latest (upsert)
 *   Tenant isolation: tenant-B cannot GET tenant-A's cache
 *   cleanup: server.close()
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import {
  PgCollaborationStore,
  CollaborationStoreError,
} from "../../lib/potential/pg-collaboration-store.ts";
import type { CollaborationMatch } from "../../lib/potential/personality-types.ts";
import { buildSovereignStack, defaultPolicies } from "../../src/composition.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMatch(overrides: Partial<CollaborationMatch> = {}): CollaborationMatch {
  return {
    userA: "user-A",
    userB: "user-B",
    tenantId: "tenant-1",
    compatibilityScore: 75,
    complementaryStrengths: [
      { category: "leadership", strongUser: "user-A", weakUser: "user-B", delta: 30 },
    ],
    sharedStrengths: ["focus"],
    synergyReason: "Complementary strengths in leadership and focus",
    matchedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function makeStore(): Promise<PgCollaborationStore> {
  const pool = new InMemoryPool();
  const store = new PgCollaborationStore(pool);
  await store.init();
  return store;
}

// ─── init ─────────────────────────────────────────────────────────────────────

test("init() creates collaboration_matches_cache table", async () => {
  const pool = new InMemoryPool();
  const store = new PgCollaborationStore(pool);
  await store.init();
  const r = await pool.query("SELECT * FROM collaboration_matches_cache");
  eq(r.rows.length, 0);
});

test("init() is idempotent", async () => {
  const pool = new InMemoryPool();
  const store = new PgCollaborationStore(pool);
  await store.init();
  await store.init(); // second call must not throw
  assert(true, "no error");
});

// ─── save ─────────────────────────────────────────────────────────────────────

test("save: stores matches for a user", async () => {
  const store = await makeStore();
  await store.save("t1", "u1", [makeMatch()]);
  const loaded = await store.load("t1", "u1");
  assert(loaded !== null, "should have data");
  eq(loaded!.length, 1);
  eq(loaded![0].userA, "user-A");
});

test("save: stores empty matches array", async () => {
  const store = await makeStore();
  await store.save("t1", "u1", []);
  const loaded = await store.load("t1", "u1");
  assert(loaded !== null, "empty array is valid cache entry");
  eq(loaded!.length, 0);
});

test("save: upsert replaces existing cache", async () => {
  const store = await makeStore();
  const m1 = makeMatch({ compatibilityScore: 50 });
  const m2 = makeMatch({ compatibilityScore: 90 });
  await store.save("t1", "u1", [m1]);
  await store.save("t1", "u1", [m2]); // upsert
  const loaded = await store.load("t1", "u1");
  eq(loaded!.length, 1);
  eq(loaded![0].compatibilityScore, 90);
});

test("save: missing userId throws CollaborationStoreError MISSING_USER_ID", async () => {
  const store = await makeStore();
  let thrown: unknown;
  try { await store.save("t1", "", [makeMatch()]); } catch (e) { thrown = e; }
  assert(thrown instanceof CollaborationStoreError, "should throw CollaborationStoreError");
  eq((thrown as CollaborationStoreError).code, "MISSING_USER_ID");
});

test("save: missing tenantId throws CollaborationStoreError MISSING_TENANT_ID", async () => {
  const store = await makeStore();
  let thrown: unknown;
  try { await store.save("", "u1", [makeMatch()]); } catch (e) { thrown = e; }
  assert(thrown instanceof CollaborationStoreError, "should throw CollaborationStoreError");
  eq((thrown as CollaborationStoreError).code, "MISSING_TENANT_ID");
});

test("save: non-array matches throws INVALID_MATCHES", async () => {
  const store = await makeStore();
  let thrown: unknown;
  try { await store.save("t1", "u1", null as any); } catch (e) { thrown = e; }
  assert(thrown instanceof CollaborationStoreError, "should throw");
  eq((thrown as CollaborationStoreError).code, "INVALID_MATCHES");
});

// ─── load ─────────────────────────────────────────────────────────────────────

test("load: returns null when no cache exists", async () => {
  const store = await makeStore();
  const result = await store.load("t1", "never-saved");
  eq(result, null);
});

test("load: cross-tenant isolation — tenant-B cannot load tenant-A cache", async () => {
  const store = await makeStore();
  await store.save("tenant-A", "u1", [makeMatch()]);
  const result = await store.load("tenant-B", "u1");
  eq(result, null);
});

test("load: empty tenantId returns null", async () => {
  const store = await makeStore();
  const result = await store.load("", "u1");
  eq(result, null);
});

test("load: empty userId returns null", async () => {
  const store = await makeStore();
  const result = await store.load("t1", "");
  eq(result, null);
});

test("load: multiple matches stored and retrieved correctly", async () => {
  const store = await makeStore();
  const matches = [
    makeMatch({ userB: "cand-1", compatibilityScore: 80 }),
    makeMatch({ userB: "cand-2", compatibilityScore: 60 }),
    makeMatch({ userB: "cand-3", compatibilityScore: 40 }),
  ];
  await store.save("t1", "u1", matches);
  const loaded = await store.load("t1", "u1");
  eq(loaded!.length, 3);
  eq(loaded![0].userB, "cand-1");
  eq(loaded![1].compatibilityScore, 60);
});

// ─── delete ───────────────────────────────────────────────────────────────────

test("delete: returns true and removes cache", async () => {
  const store = await makeStore();
  await store.save("t1", "u1", [makeMatch()]);
  const result = await store.delete("t1", "u1");
  eq(result, true);
  eq(await store.load("t1", "u1"), null);
});

test("delete: returns false when user not found", async () => {
  const store = await makeStore();
  const result = await store.delete("t1", "nobody");
  eq(result, false);
});

test("delete: cross-tenant is no-op (returns false, tenant-A data intact)", async () => {
  const store = await makeStore();
  await store.save("tenant-A", "u1", [makeMatch()]);
  const result = await store.delete("tenant-B", "u1");
  eq(result, false);
  const loaded = await store.load("tenant-A", "u1");
  assert(loaded !== null, "tenant-A data intact");
});

test("delete: empty inputs return false", async () => {
  const store = await makeStore();
  eq(await store.delete("", "u1"), false);
  eq(await store.delete("t1", ""), false);
});

// ─── totalCount ───────────────────────────────────────────────────────────────

test("totalCount: returns 0 for empty tenant", async () => {
  const store = await makeStore();
  eq(await store.totalCount("t1"), 0);
});

test("totalCount: counts distinct users", async () => {
  const store = await makeStore();
  await store.save("t1", "u1", [makeMatch()]);
  await store.save("t1", "u2", [makeMatch()]);
  await store.save("t1", "u3", [makeMatch()]);
  eq(await store.totalCount("t1"), 3);
});

test("totalCount: tenant isolation — t2 does not see t1 count", async () => {
  const store = await makeStore();
  await store.save("t1", "u1", [makeMatch()]);
  await store.save("t1", "u2", [makeMatch()]);
  eq(await store.totalCount("t2"), 0);
});

test("totalCount: decreases after delete", async () => {
  const store = await makeStore();
  await store.save("t1", "u1", [makeMatch()]);
  await store.save("t1", "u2", [makeMatch()]);
  await store.delete("t1", "u1");
  eq(await store.totalCount("t1"), 1);
});

test("totalCount: empty tenantId returns 0", async () => {
  const store = await makeStore();
  eq(await store.totalCount(""), 0);
});

// ─── persistence ─────────────────────────────────────────────────────────────

test("persistence: two instances on same pool share data", async () => {
  const pool = new InMemoryPool();
  const store1 = new PgCollaborationStore(pool);
  await store1.init();
  await store1.save("t1", "u1", [makeMatch({ compatibilityScore: 77 })]);

  const store2 = new PgCollaborationStore(pool);
  await store2.init();
  const loaded = await store2.load("t1", "u1");
  assert(loaded !== null, "second instance sees data from first");
  eq(loaded![0].compatibilityScore, 77);
});

// ─── composition integration ─────────────────────────────────────────────────

test("composition: buildSovereignStack exposes collaborationStore", () => {
  const stack = buildSovereignStack(defaultPolicies());
  assert(stack.collaborationStore !== undefined, "collaborationStore in stack");
});

test("composition: collaborationStore save+load round-trip", async () => {
  const stack = buildSovereignStack(defaultPolicies());
  await stack.collaborationStore.save("t1", "u1", [makeMatch({ compatibilityScore: 88 })]);
  const loaded = await stack.collaborationStore.load("t1", "u1");
  assert(loaded !== null, "loaded from composition store");
  eq(loaded![0].compatibilityScore, 88);
});

// ─── HTTP integration tests ───────────────────────────────────────────────────

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;

const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
const post = (path: string, body: any, tenant = "cs-t1") =>
  fetch(base + path, { method: "POST", headers: H(tenant), body: JSON.stringify(body) });
const get = (path: string, tenant = "cs-t1") =>
  fetch(base + path, { headers: H(tenant) });

// StrengthProfile — strengths is UserStrength[] (category+score+confidence+evidence)
function makeProfile(userId: string, tenant = "cs-t1") {
  const cats = [
    { category: "leadership", score: 80 },
    { category: "focus", score: 20 },
    { category: "collaboration", score: 60 },
    { category: "creativity", score: 50 },
    { category: "communication", score: 40 },
  ];
  return {
    userId,
    tenantId: tenant,
    strengths: cats.map(s => ({ category: s.category, score: s.score, confidence: 0.8, evidence: [] })),
    analyzedAt: new Date().toISOString(),
  };
}

// Body that produces at least one match (complementary profiles)
const collabBody = (userId: string) => ({
  userId,
  userProfile: makeProfile(userId),
  candidates: [
    { userId: "cand-1", profile: makeProfile("cand-1") },
    { userId: "cand-2", profile: makeProfile("cand-2") },
  ],
  minCompatibility: 0,  // accept all scores so we always get matches
});

test("HTTP: GET missing x-tenant-id → 400", async () => {
  const r = await fetch(`${base}/api/potential/collaboration/any-user`);
  eq(r.status, 400);
});

test("HTTP: GET not found (no prior POST) → 404", async () => {
  const r = await get("/api/potential/collaboration/never-posted-user");
  eq(r.status, 404);
});

test("HTTP: POST auto-save → GET returns cached matches array", async () => {
  const uid = "http-collab-user-1";
  const pr = await post("/api/potential/collaboration", collabBody(uid));
  eq(pr.status, 200);
  const pj = await pr.json() as any;
  eq(pj.ok, true);
  assert(Array.isArray(pj.data), "POST returns array");

  const gr = await get(`/api/potential/collaboration/${uid}`);
  eq(gr.status, 200);
  const gj = await gr.json() as any;
  eq(gj.ok, true);
  assert(Array.isArray(gj.data), "GET returns array");
});

test("HTTP: GET data shape — each match has required fields", async () => {
  const uid = "shape-collab-user";
  await post("/api/potential/collaboration", collabBody(uid));
  const r = await get(`/api/potential/collaboration/${uid}`);
  const j = await r.json() as any;
  eq(r.status, 200);
  for (const match of j.data) {
    assert(typeof match.userA === "string", "userA string");
    assert(typeof match.userB === "string", "userB string");
    assert(typeof match.compatibilityScore === "number", "compatibilityScore number");
    assert(Array.isArray(match.complementaryStrengths), "complementaryStrengths array");
    assert(Array.isArray(match.sharedStrengths), "sharedStrengths array");
    assert(typeof match.synergyReason === "string", "synergyReason string");
  }
});

test("HTTP: POST twice same user → GET returns latest (upsert)", async () => {
  const uid = "upsert-collab-user";
  // First POST — 2 candidates
  await post("/api/potential/collaboration", collabBody(uid));
  // Second POST — 1 candidate (minCompatibility=0)
  const r2 = await post("/api/potential/collaboration", {
    userId: uid,
    userProfile: makeProfile(uid),
    candidates: [{ userId: "only-cand", profile: makeProfile("only-cand") }],
    minCompatibility: 0,
  });
  const j2 = await r2.json() as any;
  // GET should reflect second POST result
  const gr = await get(`/api/potential/collaboration/${uid}`);
  const gj = await gr.json() as any;
  eq(gr.status, 200);
  // The cached array length should match what the second POST returned
  eq(gj.data.length, j2.data.length);
});

test("HTTP: tenant isolation — tenant-B cannot GET tenant-A's cache", async () => {
  const uid = "isolation-collab-user";
  // POST as tenant-A
  await post("/api/potential/collaboration", collabBody(uid), "cs-tenantA");
  // GET as tenant-B → 404
  const r = await get(`/api/potential/collaboration/${uid}`, "cs-tenantB");
  eq(r.status, 404);
});

test("cleanup: close server", () => { server.close(); });
