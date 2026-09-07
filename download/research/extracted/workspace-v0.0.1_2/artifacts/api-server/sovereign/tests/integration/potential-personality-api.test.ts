import "../_flush.mjs";
/**
 * tests/integration/potential-personality-api.test.ts
 *
 * Live-server HTTP integration tests for the new endpoint added in v55:
 *   POST /api/potential/personality
 *
 * The endpoint maps KnowledgeSignals + AnalyticsSignals to a PersonalityProfile
 * containing five traits: extroversion, focus, collaboration, creativity, leadership.
 *
 * Covered:
 *   Validation
 *     • missing x-tenant-id → 400
 *     • missing userId → 400
 *
 *   Happy path — response shape
 *     • 200 + ok:true
 *     • data.userId / data.tenantId match request
 *     • data.traits: all five keys present, all numbers 0–100
 *     • data.confidence: all five keys present, all numbers 0–1
 *     • data.evidence: array
 *     • data.analyzedAt: ISO timestamp string
 *
 *   Trait computation (live signals)
 *     • empty signals → all traits 0
 *     • KG signal 'mentorship' (weight 1.0) → leadership > 0, extroversion > 0
 *     • analytics signal 'deep.work.session' (value 1.0) → focus > 0
 *     • 5 same-trait signals → confidence === 1 for that trait
 *
 *   Tenant isolation
 *     • cross-tenant signals: only own-tenant signals contribute to traits
 *
 * All assertions against a live Node http server (startSovereignServer port=0).
 * Zero external dependencies — built-in fetch only.
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;

const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
const post = (path: string, body: any, tenant = "pers-t1") =>
  fetch(base + path, { method: "POST", headers: H(tenant), body: JSON.stringify(body) });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function kgSig(nodeType: string, category: string, weight: number, tenant = "pers-t1", userId = "user-1") {
  return { userId, tenantId: tenant, nodeType, category, weight };
}
function anSig(eventType: string, category: string, value: number, tenant = "pers-t1", userId = "user-1") {
  return { userId, tenantId: tenant, eventType, category, value };
}

// ─── Validation ───────────────────────────────────────────────────────────────

test("POST /api/potential/personality: missing x-tenant-id → 400", async () => {
  const res = await fetch(base + "/api/potential/personality", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "user-1" }),
  });
  eq(res.status, 400);
});

test("POST /api/potential/personality: missing userId → 400", async () => {
  const res = await post("/api/potential/personality", {});
  eq(res.status, 400);
  const body = await res.json() as any;
  assert(body.error || body.message || body.ok === false, "should indicate error");
});

// ─── Happy path — response shape ─────────────────────────────────────────────

test("POST /api/potential/personality: 200 + ok:true + full shape", async () => {
  const res = await post("/api/potential/personality", { userId: "user-1" });
  eq(res.status, 200);
  const body = await res.json() as any;
  eq(body.ok, true);
  const d = body.data;
  assert(d !== undefined, "data field must be present");
  eq(d.userId, "user-1");
  eq(d.tenantId, "pers-t1");
  assert(typeof d.analyzedAt === "string" && d.analyzedAt.length > 0, "analyzedAt must be ISO string");
});

test("POST /api/potential/personality: traits object has all five keys, values 0–100", async () => {
  const res = await post("/api/potential/personality", { userId: "user-1" });
  const { data } = await res.json() as any;
  const traits = data.traits;
  assert(traits !== undefined, "traits must be present");
  for (const key of ["extroversion", "focus", "collaboration", "creativity", "leadership"]) {
    assert(typeof traits[key] === "number", `traits.${key} must be a number`);
    assert(traits[key] >= 0 && traits[key] <= 100, `traits.${key} must be 0–100, got ${traits[key]}`);
  }
});

test("POST /api/potential/personality: confidence object has all five keys, values 0–1", async () => {
  const res = await post("/api/potential/personality", { userId: "user-1" });
  const { data } = await res.json() as any;
  const conf = data.confidence;
  assert(conf !== undefined, "confidence must be present");
  for (const key of ["extroversion", "focus", "collaboration", "creativity", "leadership"]) {
    assert(typeof conf[key] === "number", `confidence.${key} must be a number`);
    assert(conf[key] >= 0 && conf[key] <= 1, `confidence.${key} must be 0–1, got ${conf[key]}`);
  }
});

test("POST /api/potential/personality: evidence is an array", async () => {
  const res = await post("/api/potential/personality", { userId: "user-1" });
  const { data } = await res.json() as any;
  assert(Array.isArray(data.evidence), "evidence must be an array");
});

// ─── Trait computation ────────────────────────────────────────────────────────

test("POST /api/potential/personality: empty signals → all traits 0", async () => {
  const res = await post("/api/potential/personality", {
    userId: "user-empty",
    knowledgeSignals: [],
    analyticsSignals: [],
  });
  const { data } = await res.json() as any;
  for (const key of ["extroversion", "focus", "collaboration", "creativity", "leadership"]) {
    eq(data.traits[key], 0, `${key} should be 0 with no signals`);
  }
});

test("POST /api/potential/personality: KG 'mentorship' → leadership > 0 and extroversion > 0", async () => {
  const res = await post("/api/potential/personality", {
    userId: "user-1",
    knowledgeSignals: [kgSig("mentorship", "leadership", 1.0)],
  });
  const { data } = await res.json() as any;
  assert(data.traits.leadership > 0, `leadership should be > 0, got ${data.traits.leadership}`);
  assert(data.traits.extroversion > 0, `extroversion should be > 0, got ${data.traits.extroversion}`);
});

test("POST /api/potential/personality: analytics 'deep.work.session' → focus > 0", async () => {
  const res = await post("/api/potential/personality", {
    userId: "user-1",
    analyticsSignals: [anSig("deep.work.session", "focus", 1.0)],
  });
  const { data } = await res.json() as any;
  assert(data.traits.focus > 0, `focus should be > 0, got ${data.traits.focus}`);
});

test("POST /api/potential/personality: 5 same-trait signals → confidence === 1 for that trait", async () => {
  const signals = Array.from({ length: 5 }, () => anSig("deep.work.session", "focus", 1.0));
  const res = await post("/api/potential/personality", {
    userId: "user-1",
    analyticsSignals: signals,
  });
  const { data } = await res.json() as any;
  eq(data.confidence.focus, 1, "focus confidence should saturate at 1 after 5 signals");
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

test("POST /api/potential/personality: cross-tenant signals are discarded", async () => {
  // Send signals with wrong tenantId — they should be silently discarded by PersonalityMapper
  const wrongTenantSignals = [
    { userId: "user-1", tenantId: "WRONG-TENANT", nodeType: "mentorship", category: "leadership", weight: 1.0 },
  ];
  const res = await post("/api/potential/personality", {
    userId: "user-1",
    knowledgeSignals: wrongTenantSignals,
  }, "pers-t1");
  const { data } = await res.json() as any;
  eq(data.traits.leadership, 0, "cross-tenant signals must be discarded → leadership stays 0");
});

test("cleanup: close server", () => { server.close(); });

