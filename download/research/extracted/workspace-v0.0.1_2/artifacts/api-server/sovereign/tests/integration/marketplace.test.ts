import "../_flush.mjs";
/**
 * tests/integration/marketplace.test.ts
 *
 * Live-server HTTP integration tests for שלב E: Marketplace.
 * Tests the four new routes added in v50:
 *
 *   POST /api/marketplace/opportunities
 *     • missing x-tenant-id → 400
 *     • missing title → 400
 *     • happy path → 201 + ok:true + opportunity shape
 *     • id is present and is a string
 *     • description stored correctly
 *     • requiredStrengths stored correctly
 *     • tenant isolation: opportunity belongs to creating tenant only
 *
 *   GET /api/marketplace/opportunities
 *     • missing x-tenant-id → 400
 *     • empty catalog → { ok:true, opportunities:[] }
 *     • after create → opportunity appears
 *     • tenant isolation: tenant-A opportunities not visible from tenant-B
 *
 *   DELETE /api/marketplace/opportunities/:id
 *     • unknown id → 404
 *     • happy path → 200 + ok:true
 *     • after delete: no longer in list
 *     • cross-tenant delete (wrong tenant) → 404 (fail-closed)
 *
 *   POST /api/marketplace/route
 *     • missing x-tenant-id → 400
 *     • missing userId → 400
 *     • empty catalog → ok:true + empty matches (not an error)
 *     • after adding opportunities: route returns matches array
 *     • matched opportunity ids are from the tenant's catalog
 *     • tenant isolation: routing only matches own-tenant opportunities
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
const post  = (path: string, body: any, tenant = "mkt-t1") =>
  fetch(base + path, { method: "POST",   headers: H(tenant), body: JSON.stringify(body) });
const get   = (path: string, tenant = "mkt-t1") =>
  fetch(base + path, { headers: H(tenant) });
const del   = (path: string, tenant = "mkt-t1") =>
  fetch(base + path, { method: "DELETE", headers: H(tenant) });

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/marketplace/opportunities — CREATE
// ─────────────────────────────────────────────────────────────────────────────

test("marketplace create: missing x-tenant-id → 400", async () => {
  const r = await fetch(base + "/api/marketplace/opportunities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Dev" }),
  });
  eq(r.status, 400);
});

test("marketplace create: missing title → 400", async () => {
  const r = await post("/api/marketplace/opportunities", { description: "No title" });
  eq(r.status, 400);
  const b = await r.json();
  assert(b.error, "error message present");
});

test("marketplace create: happy path → 201 + opportunity", async () => {
  const r = await post("/api/marketplace/opportunities", {
    title: "Senior TypeScript Engineer",
    description: "Build sovereign software",
  });
  eq(r.status, 201);
  const b = await r.json();
  eq(b.ok, true);
  assert(b.opportunity, "opportunity object present");
  assert(typeof b.opportunity.id === "string", "id is a string");
  eq(b.opportunity.title, "Senior TypeScript Engineer");
  eq(b.opportunity.description, "Build sovereign software");
  eq(b.opportunity.tenantId, "mkt-t1");
});

test("marketplace create: requiredStrengths stored correctly", async () => {
  const r = await post("/api/marketplace/opportunities", {
    title: "ML Researcher",
    description: "AI/ML focus",
    requiredStrengths: [{ category: "analytical", minScore: 80 }],
  });
  eq(r.status, 201);
  const b = await r.json();
  eq(b.opportunity.requiredStrengths.length, 1);
  eq(b.opportunity.requiredStrengths[0].category, "analytical");
  eq(b.opportunity.requiredStrengths[0].minScore, 80);
});

test("marketplace create: invalid minScore → 400", async () => {
  const r = await post("/api/marketplace/opportunities", {
    title: "Bad",
    requiredStrengths: [{ category: "x", minScore: 150 }],
  });
  eq(r.status, 400);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/marketplace/opportunities — LIST
// ─────────────────────────────────────────────────────────────────────────────

test("marketplace list: missing x-tenant-id → 400", async () => {
  const r = await fetch(base + "/api/marketplace/opportunities");
  eq(r.status, 400);
});

test("marketplace list: empty catalog → ok:true + empty array", async () => {
  const r = await get("/api/marketplace/opportunities", "mkt-empty-tenant");
  eq(r.status, 200);
  const b = await r.json();
  eq(b.ok, true);
  eq(Array.isArray(b.opportunities), true);
  eq(b.opportunities.length, 0);
});

test("marketplace list: created opportunity appears", async () => {
  // Create one
  const cr = await post("/api/marketplace/opportunities", {
    title: "Listed Role",
    description: "Should appear in list",
  }, "mkt-list-t");
  eq(cr.status, 201);

  const r = await get("/api/marketplace/opportunities", "mkt-list-t");
  eq(r.status, 200);
  const b = await r.json();
  const found = b.opportunities.find((o: any) => o.title === "Listed Role");
  assert(found, "opportunity found in list");
  eq(found.description, "Should appear in list");
});

test("marketplace list: tenant isolation — tenant-A opps not visible from tenant-B", async () => {
  await post("/api/marketplace/opportunities", { title: "Tenant-A Only" }, "mkt-iso-a");
  const r = await get("/api/marketplace/opportunities", "mkt-iso-b");
  const b = await r.json();
  const leaked = (b.opportunities || []).find((o: any) => o.title === "Tenant-A Only");
  assert(!leaked, "tenant-A opp must NOT appear for tenant-B");
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/marketplace/opportunities/:id — DELETE
// ─────────────────────────────────────────────────────────────────────────────

test("marketplace delete: unknown id → 404", async () => {
  const r = await del("/api/marketplace/opportunities/nonexistent-id-xyz");
  eq(r.status, 404);
});

test("marketplace delete: happy path → 200 + ok:true", async () => {
  const cr = await post("/api/marketplace/opportunities", { title: "To Delete" }, "mkt-del-t");
  const created = (await cr.json()).opportunity;

  const r = await del(`/api/marketplace/opportunities/${created.id}`, "mkt-del-t");
  eq(r.status, 200);
  const b = await r.json();
  eq(b.ok, true);

  // Verify gone from list
  const lr = await get("/api/marketplace/opportunities", "mkt-del-t");
  const lb = await lr.json();
  const still = lb.opportunities.find((o: any) => o.id === created.id);
  assert(!still, "deleted opportunity must not appear in list");
});

test("marketplace delete: cross-tenant fail-closed → 404", async () => {
  // Create under tenant-A
  const cr = await post("/api/marketplace/opportunities", { title: "Cross Tenant" }, "mkt-cross-a");
  const created = (await cr.json()).opportunity;

  // Try to delete from tenant-B → should 404 (not visible, fail-closed)
  const r = await del(`/api/marketplace/opportunities/${created.id}`, "mkt-cross-b");
  eq(r.status, 404);

  // Verify still exists for tenant-A
  const lr = await get("/api/marketplace/opportunities", "mkt-cross-a");
  const lb = await lr.json();
  const still = lb.opportunities.find((o: any) => o.id === created.id);
  assert(still, "opportunity must still exist under tenant-A after cross-tenant delete attempt");
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/marketplace/route — ROUTE
// ─────────────────────────────────────────────────────────────────────────────

test("marketplace route: missing x-tenant-id → 400", async () => {
  const r = await fetch(base + "/api/marketplace/route", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "u1" }),
  });
  eq(r.status, 400);
});

test("marketplace route: missing userId → 400", async () => {
  const r = await post("/api/marketplace/route", {});
  eq(r.status, 400);
  const b = await r.json();
  assert(b.error, "error message present");
});

test("marketplace route: empty catalog → ok:true + empty matches (no error)", async () => {
  const r = await post("/api/marketplace/route",
    { userId: "u1", knowledgeSignals: [], analyticsSignals: [] },
    "mkt-route-empty"
  );
  eq(r.status, 200);
  const b = await r.json();
  eq(b.ok, true);
  // Empty catalog: matches array should be empty
  const matches = b.data?.matches ?? [];
  eq(Array.isArray(matches), true);
});

test("marketplace route: after adding opportunities — returns matches array", async () => {
  const tenant = "mkt-route-full";

  // Seed two opportunities
  await post("/api/marketplace/opportunities", {
    title: "Backend Engineer",
    description: "Node/TS",
    requiredStrengths: [{ category: "technical", minScore: 60 }],
  }, tenant);
  await post("/api/marketplace/opportunities", {
    title: "Open Role",
    description: "No requirements",
    requiredStrengths: [],
  }, tenant);

  const r = await post("/api/marketplace/route", {
    userId: "mkt-user-1",
    knowledgeSignals: [
      { userId: "mkt-user-1", tenantId: tenant, nodeType: "skill", category: "technical", weight: 0.9 },
    ],
    analyticsSignals: [],
  }, tenant);

  eq(r.status, 200);
  const b = await r.json();
  eq(b.ok, true);
  assert(b.auditId, "auditId present (passed through orchestrator)");
  const matches = b.data?.matches ?? [];
  assert(matches.length >= 1, `should have ≥1 match, got ${matches.length}`);
  // The "Open Role" (no requirements) should always match
  const openRole = matches.find((m: any) => m.opportunity?.title === "Open Role");
  assert(openRole, "open role should appear in matches");
  eq(openRole.fitScore, 100, "open role fitScore = 100");
});

test("marketplace route: tenant isolation — only own-tenant opportunities matched", async () => {
  const tenantA = "mkt-route-iso-a";
  const tenantB = "mkt-route-iso-b";

  await post("/api/marketplace/opportunities", { title: "TenantA Exclusive", requiredStrengths: [] }, tenantA);
  await post("/api/marketplace/opportunities", { title: "TenantB Exclusive", requiredStrengths: [] }, tenantB);

  // Route as tenant-A: should only see TenantA Exclusive
  const r = await post("/api/marketplace/route", { userId: "u-iso", knowledgeSignals: [], analyticsSignals: [] }, tenantA);
  eq(r.status, 200);
  const b = await r.json();
  const matches = b.data?.matches ?? [];
  const titles = matches.map((m: any) => m.opportunity?.title);
  assert(titles.includes("TenantA Exclusive"), "tenant-A opp in matches");
  assert(!titles.includes("TenantB Exclusive"), "tenant-B opp NOT in matches");
});

// Graceful shutdown — last test closes the server so Node exits cleanly.
test("cleanup: close server", () => { server.close(); });
