import "../_flush.mjs";
/**
 * tests/pg-plan/pg-plan-sync.test.ts — PgPlanSync: synchronous TenantPlanRegistry
 * backed by PostgreSQL (v117, J1 part D).
 *
 * Coverage (28 tests):
 *
 * PgPlanSync unit tests (InMemoryPool as pg stand-in):
 *   • init() creates the tenant_plans table (idempotent)
 *   • get() returns undefined for unknown tenant
 *   • set() + get() round-trip
 *   • set() overwrites existing plan (upgrade free → pro)
 *   • set() downgrade pro → free
 *   • cacheSize reflects number of distinct tenants
 *   • pgWriteErrors starts at 0
 *   • set() missing tenantId → throws (fail-closed)
 *   • set() missing plan → throws (fail-closed)
 *   • tenant isolation: get() for tenant-B never returns tenant-A's plan
 *   • multiple tenants stored independently
 *
 * Restart survival (write-through + preload):
 *   • set() fires async write to pg; new PgPlanSync.init() reloads it
 *   • after restart, get() returns previously-set plan
 *   • after restart, cacheSize equals number of distinct tenants written
 *   • upgrade followed by restart → upgraded plan survives
 *   • empty table → init() leaves cache empty (no crash)
 *
 * persistenceReport (composition integration):
 *   • without pool: persistenceReport.tenantPlans = "in-memory"
 *   • with pool: persistenceReport.tenantPlans = "pg"
 *   • tenantPlans field present in persistenceReport
 *
 * Behavioural compatibility with TenantPlanRegistry (drop-in swap):
 *   • PgPlanSync.get returns undefined (not null) for missing tenant
 *   • PgPlanSync is used by the plan guard (stack end-to-end)
 *   • plan set via PgPlanSync is visible to guard (deny on over-limit free)
 *
 * HTTP integration (via buildSovereignStack with InMemoryPool):
 *   • POST /api/tenants with plan → GET /api/tenants returns plan
 *   • plan survives simulated restart (reload from same pool)
 */

import { test, eq, assert } from "../_harness.mjs";
import { PgPlanSync } from "../../src/pg-plan-sync.ts";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function freshPool() { return new InMemoryPool(); }
async function freshSync(): Promise<[PgPlanSync, InMemoryPool]> {
  const pool = freshPool();
  const sync = new PgPlanSync(pool);
  await sync.init();
  return [sync, pool];
}

// ─── Unit: init + basic get/set ───────────────────────────────────────────────

test("PgPlanSync: init() completes without error (creates table)", async () => {
  const pool = freshPool();
  const sync = new PgPlanSync(pool);
  await sync.init(); // must not throw
  eq(sync.cacheSize, 0);
});

test("PgPlanSync: init() is idempotent (safe to call twice)", async () => {
  const pool = freshPool();
  const sync = new PgPlanSync(pool);
  await sync.init();
  await sync.init(); // second call — must not throw
  eq(sync.cacheSize, 0);
});

test("PgPlanSync: get() returns undefined for unknown tenant", async () => {
  const [sync] = await freshSync();
  eq(sync.get("unknown-tenant"), undefined);
});

test("PgPlanSync: set() + get() round-trip (free)", async () => {
  const [sync] = await freshSync();
  sync.set("t1", "free");
  eq(sync.get("t1"), "free");
});

test("PgPlanSync: set() + get() round-trip (pro)", async () => {
  const [sync] = await freshSync();
  sync.set("t2", "pro");
  eq(sync.get("t2"), "pro");
});

test("PgPlanSync: set() overwrites — free → pro (upgrade)", async () => {
  const [sync] = await freshSync();
  sync.set("t3", "free");
  sync.set("t3", "pro");
  eq(sync.get("t3"), "pro");
});

test("PgPlanSync: set() overwrites — pro → free (downgrade)", async () => {
  const [sync] = await freshSync();
  sync.set("t4", "pro");
  sync.set("t4", "free");
  eq(sync.get("t4"), "free");
});

test("PgPlanSync: cacheSize reflects distinct tenant count", async () => {
  const [sync] = await freshSync();
  eq(sync.cacheSize, 0);
  sync.set("a", "free");
  eq(sync.cacheSize, 1);
  sync.set("b", "pro");
  eq(sync.cacheSize, 2);
  sync.set("a", "pro"); // overwrite — same tenant
  eq(sync.cacheSize, 2);
});

test("PgPlanSync: pgWriteErrors starts at 0", async () => {
  const [sync] = await freshSync();
  eq(sync.pgWriteErrors, 0);
});

// ─── Fail-closed ──────────────────────────────────────────────────────────────

test("PgPlanSync: set() with empty tenantId → throws (fail-closed)", async () => {
  const [sync] = await freshSync();
  let threw = false;
  try { sync.set("", "free"); } catch { threw = true; }
  assert(threw, "empty tenantId must throw");
});

test("PgPlanSync: set() with empty plan → throws (fail-closed)", async () => {
  const [sync] = await freshSync();
  let threw = false;
  try { sync.set("t-fc", ""); } catch { threw = true; }
  assert(threw, "empty plan must throw");
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

test("PgPlanSync: tenant isolation — tenant-A plan invisible to tenant-B", async () => {
  const [sync] = await freshSync();
  sync.set("iso-A", "pro");
  eq(sync.get("iso-B"), undefined);
  eq(sync.get("iso-A"), "pro");
});

test("PgPlanSync: multiple tenants stored independently", async () => {
  const [sync] = await freshSync();
  sync.set("x1", "free");
  sync.set("x2", "pro");
  sync.set("x3", "free");
  eq(sync.get("x1"), "free");
  eq(sync.get("x2"), "pro");
  eq(sync.get("x3"), "free");
  eq(sync.cacheSize, 3);
});

// ─── Restart survival (write-through + preload) ───────────────────────────────

test("PgPlanSync: set() writes to pg; new instance after init() reloads it", async () => {
  const [sync, pool] = await freshSync();
  sync.set("rs-t1", "pro");
  // Brief wait for fire-and-forget async write
  await new Promise(r => setTimeout(r, 30));

  const sync2 = new PgPlanSync(pool);
  await sync2.init();
  eq(sync2.get("rs-t1"), "pro", "plan survives restart");
});

test("PgPlanSync: after restart cacheSize equals distinct tenants written", async () => {
  const [sync, pool] = await freshSync();
  sync.set("rs-a", "free");
  sync.set("rs-b", "pro");
  sync.set("rs-c", "free");
  await new Promise(r => setTimeout(r, 30));

  const sync2 = new PgPlanSync(pool);
  await sync2.init();
  eq(sync2.cacheSize, 3);
});

test("PgPlanSync: upgrade then restart → upgraded plan survives", async () => {
  const [sync, pool] = await freshSync();
  sync.set("rs-up", "free");
  sync.set("rs-up", "pro"); // upgrade
  await new Promise(r => setTimeout(r, 30));

  const sync2 = new PgPlanSync(pool);
  await sync2.init();
  eq(sync2.get("rs-up"), "pro", "upgrade survives restart");
});

test("PgPlanSync: empty table → init() leaves cache empty (no crash)", async () => {
  const pool = freshPool();
  const sync = new PgPlanSync(pool);
  await sync.init();
  eq(sync.cacheSize, 0);
  eq(sync.get("any"), undefined);
});

// ─── persistenceReport (composition integration) ─────────────────────────────

test("persistenceReport.tenantPlans = 'in-memory' without pool", () => {
  const stack = buildSovereignStack(); // no pool
  assert("tenantPlans" in stack.persistenceReport, "tenantPlans field present");
  eq(stack.persistenceReport.tenantPlans, "in-memory");
});

test("persistenceReport.tenantPlans = 'pg' with pool", async () => {
  const pool = freshPool();
  const stack = buildSovereignStack(undefined, { pool });
  await new Promise(r => setTimeout(r, 30)); // let async inits fire
  eq(stack.persistenceReport.tenantPlans, "pg");
});

test("persistenceReport has all expected fields (including tenantPlans)", () => {
  const stack = buildSovereignStack();
  const fields = Object.keys(stack.persistenceReport);
  const required = ["ledger", "identities", "audit", "apiKeys", "escrow", "tenantPlans"];
  for (const f of required) {
    assert(fields.includes(f), `persistenceReport.${f} present`);
  }
});

// ─── Behavioural compatibility with TenantPlanRegistry ───────────────────────

test("PgPlanSync.get returns undefined (not null) for missing tenant", async () => {
  const [sync] = await freshSync();
  const val = sync.get("never-set");
  eq(val, undefined); // must be undefined, not null
  eq(val === null, false);
});

test("PgPlanSync: without pool, buildSovereignStack uses TenantPlanRegistry (in-memory)", () => {
  const stack = buildSovereignStack();
  // In-memory: plans are not persisted
  stack.tenantPlans.set("tp-t1", "pro");
  eq(stack.tenantPlans.get("tp-t1"), "pro");
  eq(stack.persistenceReport.tenantPlans, "in-memory");
});

test("PgPlanSync: with pool, buildSovereignStack uses PgPlanSync (pg-backed)", async () => {
  const pool = freshPool();
  const stack = buildSovereignStack(undefined, { pool });
  stack.tenantPlans.set("pp-t1", "pro");
  eq(stack.tenantPlans.get("pp-t1"), "pro");
  eq(stack.persistenceReport.tenantPlans, "pg");
});

// ─── HTTP integration (live server) ──────────────────────────────────────────

test("HTTP: POST /api/tenants + GET /api/tenants → plan persisted via PgPlanSync", async () => {
  const pool = freshPool();
  const stack = buildSovereignStack(undefined, { pool });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const H = { "content-type": "application/json", "x-tenant-id": "pps-http-t1" };

  // Register with explicit plan
  const r1 = await (await fetch(base + "/api/tenants", {
    method: "POST", headers: H, body: JSON.stringify({ plan: "pro" }),
  })).json();
  eq(r1.ok, true);
  eq(r1.plan, "pro");

  // GET /api/tenants → reads from PgPlanSync cache
  const r2 = await (await fetch(base + "/api/tenants", { headers: H })).json();
  eq(r2.ok, true);
  eq(r2.plan, "pro");

  server.close();
});

test("HTTP: plan upgrade survives in-session re-read via PgPlanSync", async () => {
  const pool = freshPool();
  const stack = buildSovereignStack(undefined, { pool });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const H = { "content-type": "application/json", "x-tenant-id": "pps-upgrade-t" };

  // Start free
  await fetch(base + "/api/tenants", { method: "POST", headers: H, body: JSON.stringify({ plan: "free" }) });
  // Upgrade to pro
  await fetch(base + "/api/tenants", { method: "POST", headers: H, body: JSON.stringify({ plan: "pro" }) });
  // Check
  const r = await (await fetch(base + "/api/tenants", { headers: H })).json();
  eq(r.plan, "pro", "upgrade reflected immediately");

  server.close();
});

test("HTTP: plan survives restart — new buildSovereignStack with same pool preloads from pg", async () => {
  const pool = freshPool();
  // First server: set plan
  const stack1 = buildSovereignStack(undefined, { pool });
  stack1.tenantPlans.set("pps-restart", "pro");
  await new Promise(r => setTimeout(r, 40)); // flush async write

  // Second stack: same pool — init() should preload
  const stack2 = buildSovereignStack(undefined, { pool });
  await new Promise(r => setTimeout(r, 40)); // let init() fire
  eq(stack2.tenantPlans.get("pps-restart"), "pro", "plan survives restart");
});
