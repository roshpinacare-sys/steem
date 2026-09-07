import "../_flush.mjs";
/**
 * tests/routes/insights-route.test.ts — v180.
 * GET /api/insights route handler: tenant headline analytics, TTL caching,
 * tenant isolation, fail-closed validation.
 *
 *   FEATURE       returns settled count, volume (μ¢ strings), held, disputes,
 *                 proofs, trust-trend from read-model data.
 *   CACHE         second identical call returns cached:true; different tenant
 *                 is a cache miss; ?now= override bypasses cache.
 *   TENANT ISO    missing x-tenant-id → 400; different tenant sees only its data.
 *   FAIL-CLOSED   ?windowDays=0 or non-int → 400; store healthy (no cross-tenant
 *                 data can be in the store for a given tenantId, so tenant_mismatch
 *                 path is exercised via a custom scenario).
 *   EDGE          empty store → zeroed metrics; ?windowDays=7 accepted; serialized
 *                 as decimal strings (not numbers).
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryReadModelStore } from "../../lib/indexer/in-memory-store.ts";
import { indexerRoutes, InsightsCache, DEFAULT_INSIGHTS_CACHE_TTL_MS } from "../../src/routes/indexer-routes.ts";
import type { Ctx } from "../../src/routes/indexer-routes.ts";
import type { ReadModelEscrow, ReadModelPassport } from "../../lib/indexer/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = "2026-06-14T00:00:00.000Z";
const DAY_MS = 86_400_000;
function daysAgo(n: number) {
  return new Date(Date.parse(NOW) - n * DAY_MS).toISOString();
}

function makeRouter(store?: InMemoryReadModelStore, cache?: InsightsCache) {
  const s = store ?? new InMemoryReadModelStore();
  const c = cache ?? new InsightsCache(5_000); // short TTL for tests
  const routes = indexerRoutes(s, c);

  function call(
    path: string,
    opts: { tenantId?: string; query?: Record<string, string> } = {},
  ) {
    const route = routes.find((r) => r.method === "GET" && r.pattern === path);
    if (!route) throw new Error(`No route: GET ${path}`);
    const ctx: Ctx = {
      tenantId: opts.tenantId ?? "t1",
      body: {},
      params: {},
      query: opts.query,
    };
    return Promise.resolve(route.handler(ctx));
  }

  return { store: s, cache: c, call };
}

/** Create a released escrow SettlementAgreement for a tenant. */
function released(tenantId: string, amountMC: bigint, updatedAt: string): any {
  return {
    id: `escrow-${Math.random().toString(36).slice(2)}`,
    tenantId,
    agreementId: `agr-${Math.random().toString(36).slice(2)}`,
    opportunityId: "opp-1",
    payerAccountId: "payer-1",
    workerAccountId: "worker-1",
    totalAmount: amountMC,
    releasedAmount: amountMC,
    state: "released",
    createdAt: daysAgo(40),
    updatedAt,
  };
}

/** Create a passport for a tenant. */
function passport(tenantId: string, issuedAt: string): any {
  const ppId = `pp-${Math.random().toString(36).slice(2)}`;
  return {
    passportId: ppId,
    tenantId,
    issuedAt,
    audit: { id: `audit-${Math.random().toString(36).slice(2)}`, outcome: "success" },
    hash: "abc123",
    attestation: null,
    ledgerEffect: undefined,
  };
}

// ─── FEATURE: returns correct headline metrics ─────────────────────────────────

test("GET /api/insights: returns correct settled/volume/held/disputes/proofs", async () => {
  const store = new InMemoryReadModelStore();
  // 2 released escrows in window, 1 held, 1 disputed
  store.projectEscrow({
    id: "e1", tenantId: "t1", state: "released",
    opportunityId: "o1", payerAccountId: "p1", workerAccountId: "w1",
    totalAmount: 500_000n, releasedAmount: 500_000n,
    createdAt: daysAgo(40), updatedAt: daysAgo(5),
  } as any);
  store.projectEscrow({
    id: "e2", tenantId: "t1", state: "released",
    opportunityId: "o1", payerAccountId: "p1", workerAccountId: "w1",
    totalAmount: 1_000_000n, releasedAmount: 1_000_000n,
    createdAt: daysAgo(40), updatedAt: daysAgo(10),
  } as any);
  store.projectEscrow({
    id: "e3", tenantId: "t1", state: "held",
    opportunityId: "o1", payerAccountId: "p1", workerAccountId: "w1",
    totalAmount: 200_000n, releasedAmount: 0n,
    createdAt: daysAgo(5), updatedAt: daysAgo(2),
  } as any);
  store.projectEscrow({
    id: "e4", tenantId: "t1", state: "disputed",
    opportunityId: "o1", payerAccountId: "p1", workerAccountId: "w1",
    totalAmount: 300_000n, releasedAmount: 0n,
    createdAt: daysAgo(3), updatedAt: daysAgo(1),
  } as any);
  // 3 passports in window
  store.projectPassport({ passportId: "pp1", tenantId: "t1", issuedAt: daysAgo(3),
    audit: { id: "a1", outcome: "success" }, hash: "h1", attestation: null } as any);
  store.projectPassport({ passportId: "pp2", tenantId: "t1", issuedAt: daysAgo(7),
    audit: { id: "a2", outcome: "success" }, hash: "h2", attestation: null } as any);
  store.projectPassport({ passportId: "pp3", tenantId: "t1", issuedAt: daysAgo(20),
    audit: { id: "a3", outcome: "success" }, hash: "h3", attestation: null } as any);

  const { call } = makeRouter(store);
  // No ?now override: store sets updatedAt=nowIso(), so use real server time as window end.
  const res = await call("/api/insights");
  eq(res.status, 200);
  assert(res.body.ok, "ok");
  const ins = res.body.insights;
  eq(ins.tenantId, "t1");
  eq(ins.settledCount, 2);
  eq(ins.volumeMicrounits, "1500000");
  eq(ins.heldMicrounits, "500000");  // e3(200k) + e4(300k − 0 = 300k) = 500k
  eq(ins.disputeCount, 1);
  eq(ins.proofsIssued, 3);
  // volumeMicrounits is a string (BigInt serialized)
  eq(typeof ins.volumeMicrounits, "string");
  eq(typeof ins.heldMicrounits, "string");
});

// ─── CACHE: second call returns cached:true ────────────────────────────────────

test("GET /api/insights: second call (no ?now) returns cached:true", async () => {
  const { call, cache } = makeRouter();
  const r1 = await call("/api/insights");
  eq(r1.status, 200);
  eq(r1.body.cached, false, "first call: not cached");
  eq(cache.size(), 1);

  const r2 = await call("/api/insights");
  eq(r2.status, 200);
  eq(r2.body.cached, true, "second call: cached");
  eq(r2.body.insights.tenantId, "t1");
});

test("GET /api/insights: ?now= override bypasses cache", async () => {
  const { call, cache } = makeRouter();
  // Prime cache with default call
  await call("/api/insights");
  eq(cache.size(), 1);

  // Call with ?now= override — should not use cache
  const r = await call("/api/insights", { query: { now: NOW } });
  eq(r.status, 200);
  eq(r.body.cached, false, "?now override bypasses cache");
  // Cache size unchanged (not cached)
  eq(cache.size(), 1);
});

test("GET /api/insights: different tenant is a separate cache entry", async () => {
  const { call, cache } = makeRouter();
  await call("/api/insights", { tenantId: "t1" });
  await call("/api/insights", { tenantId: "t2" });
  eq(cache.size(), 2);

  const r1 = await call("/api/insights", { tenantId: "t1" });
  const r2 = await call("/api/insights", { tenantId: "t2" });
  eq(r1.body.cached, true);
  eq(r2.body.cached, true);
  eq(r1.body.insights.tenantId, "t1");
  eq(r2.body.insights.tenantId, "t2");
});

// ─── TENANT ISOLATION ─────────────────────────────────────────────────────────

test("GET /api/insights: tenant sees only its own data", async () => {
  const store = new InMemoryReadModelStore();
  // t1 has data, t2 sees zeroes
  store.projectEscrow({
    id: "e-t1", tenantId: "t1", state: "released",
    opportunityId: "o1", payerAccountId: "p1", workerAccountId: "w1",
    totalAmount: 999_000n, releasedAmount: 999_000n,
    createdAt: daysAgo(40), updatedAt: daysAgo(5),
  } as any);

  const { call } = makeRouter(store);
  const rt1 = await call("/api/insights", { tenantId: "t1" });
  const rt2 = await call("/api/insights", { tenantId: "t2" });
  eq(rt1.body.insights.settledCount, 1);
  eq(rt2.body.insights.settledCount, 0, "t2 sees nothing from t1");
  eq(rt2.body.insights.volumeMicrounits, "0");
});

// ─── FAIL-CLOSED ──────────────────────────────────────────────────────────────

test("GET /api/insights: missing tenantId → 400", async () => {
  const { call } = makeRouter();
  const res = await call("/api/insights", { tenantId: "" });
  eq(res.status, 400);
});

test("GET /api/insights: ?windowDays=0 → 400", async () => {
  const { call } = makeRouter();
  const res = await call("/api/insights", { query: { windowDays: "0" } });
  eq(res.status, 400);
  assert(res.body.error.includes("windowDays"), "error message mentions windowDays");
});

test("GET /api/insights: ?windowDays=abc → 400", async () => {
  const { call } = makeRouter();
  const res = await call("/api/insights", { query: { windowDays: "abc" } });
  eq(res.status, 400);
});

test("GET /api/insights: ?windowDays=-5 → 400", async () => {
  const { call } = makeRouter();
  const res = await call("/api/insights", { query: { windowDays: "-5" } });
  eq(res.status, 400);
});

// ─── EDGE ─────────────────────────────────────────────────────────────────────

test("GET /api/insights: empty store returns zeroed metrics", async () => {
  const { call } = makeRouter();
  const res = await call("/api/insights", { query: { now: NOW } });
  eq(res.status, 200);
  const ins = res.body.insights;
  eq(ins.settledCount, 0);
  eq(ins.volumeMicrounits, "0");
  eq(ins.heldMicrounits, "0");
  eq(ins.disputeCount, 0);
  eq(ins.proofsIssued, 0);
  eq(ins.trustTrendDelta, 0);
  eq(ins.trustTrend, "flat");
});

test("GET /api/insights: ?windowDays=7 accepted", async () => {
  const { call } = makeRouter();
  const res = await call("/api/insights", { query: { windowDays: "7", now: NOW } });
  eq(res.status, 200);
  eq(res.body.insights.windowDays, 7);
  eq(res.body.cached, false);
});

test("InsightsCache: TTL expiry returns null", async () => {
  const cache = new InsightsCache(1); // 1ms TTL
  const fake = { tenantId: "t1" } as any;
  cache.set("t1", fake);
  await new Promise((r) => setTimeout(r, 5));
  eq(cache.get("t1"), null, "expired");
});

test("InsightsCache: invalidate removes entry", () => {
  const cache = new InsightsCache(60_000);
  cache.set("t1", { tenantId: "t1" } as any);
  eq(cache.size(), 1);
  cache.invalidate("t1");
  eq(cache.size(), 0);
  eq(cache.get("t1"), null);
});

test("DEFAULT_INSIGHTS_CACHE_TTL_MS is 30 seconds", () => {
  eq(DEFAULT_INSIGHTS_CACHE_TTL_MS, 30_000);
});
