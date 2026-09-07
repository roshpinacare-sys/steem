import "../_flush.mjs";
/**
 * tests/marketplace/pg-catalog.test.ts
 *
 * Unit tests for PgOpportunityCatalog using InMemoryPool.
 * No external DB required. Runs with:
 *   node tests/marketplace/pg-catalog.test.ts
 *
 * Coverage:
 *   create: happy path, tenantId/title validation, invalid strengths, duplicate id
 *   list: empty, single tenant, tenant isolation, empty tenantId
 *   get: happy path, unknown id, cross-tenant fail-closed
 *   delete: happy path, not found, cross-tenant fail-closed
 *   totalCount: zero, multi-tenant, after delete
 *   persistence: second instance on same pool sees data
 */

import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { PgOpportunityCatalog } from "../../lib/marketplace/pg-catalog.ts";
import { MarketplaceError } from "../../lib/marketplace/types.ts";

// ── harness ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log("  pass " + name);
    passed++;
  } catch (e: any) {
    console.error("  FAIL " + name);
    console.error("       " + (e?.message ?? e));
    failed++;
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("Assert: " + msg);
}

async function assertMarketplaceError(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
    throw new Error("Expected MarketplaceError(" + code + ") but resolved");
  } catch (e: any) {
    if (!(e instanceof MarketplaceError))
      throw new Error("Expected MarketplaceError, got " + (e?.constructor?.name ?? e));
    if (e.code !== code)
      throw new Error("Expected code " + code + ", got " + e.code);
  }
}

async function makeCatalog(): Promise<PgOpportunityCatalog> {
  const pool = new InMemoryPool();
  const cat = new PgOpportunityCatalog(pool);
  await cat.init();
  return cat;
}

// ── create ────────────────────────────────────────────────────────────────────

console.log("\nPgOpportunityCatalog — create");

await test("happy path: returns Opportunity with generated id", async () => {
  const cat = await makeCatalog();
  const opp = await cat.create({ tenantId: "t1", title: "Dev Role", description: "Build" });
  assert(typeof opp.id === "string" && opp.id.length > 0, "id generated");
  assert(opp.tenantId === "t1", "tenantId");
  assert(opp.title === "Dev Role", "title");
  assert(opp.description === "Build", "description");
  assert(Array.isArray(opp.requiredStrengths) && opp.requiredStrengths.length === 0, "empty strengths");
});

await test("requiredStrengths stored and returned correctly", async () => {
  const cat = await makeCatalog();
  const opp = await cat.create({
    tenantId: "t1", title: "Analyst", description: "",
    requiredStrengths: [{ category: "logic", minScore: 75 }],
  });
  assert(opp.requiredStrengths.length === 1, "one strength");
  assert(opp.requiredStrengths[0].category === "logic", "category");
  assert(opp.requiredStrengths[0].minScore === 75, "minScore");
});

await test("caller-supplied id is preserved", async () => {
  const cat = await makeCatalog();
  const opp = await cat.create({ id: "fixed-id", tenantId: "t1", title: "X", description: "" });
  assert(opp.id === "fixed-id", "id preserved");
});

await test("missing tenantId throws missing_tenant_id", async () => {
  const cat = await makeCatalog();
  await assertMarketplaceError(
    () => cat.create({ tenantId: "", title: "X", description: "" }),
    "missing_tenant_id"
  );
});

await test("missing title throws missing_title", async () => {
  const cat = await makeCatalog();
  await assertMarketplaceError(
    () => cat.create({ tenantId: "t1", title: "  ", description: "" }),
    "missing_title"
  );
});

await test("minScore > 100 throws invalid_min_score", async () => {
  const cat = await makeCatalog();
  await assertMarketplaceError(
    () => cat.create({ tenantId: "t1", title: "X", description: "",
      requiredStrengths: [{ category: "c", minScore: 150 }] }),
    "invalid_min_score"
  );
});

await test("blank category throws invalid_required_strength", async () => {
  const cat = await makeCatalog();
  await assertMarketplaceError(
    () => cat.create({ tenantId: "t1", title: "X", description: "",
      requiredStrengths: [{ category: "", minScore: 50 }] }),
    "invalid_required_strength"
  );
});

await test("duplicate id throws duplicate_id", async () => {
  const cat = await makeCatalog();
  await cat.create({ id: "dup", tenantId: "t1", title: "A", description: "" });
  await assertMarketplaceError(
    () => cat.create({ id: "dup", tenantId: "t1", title: "B", description: "" }),
    "duplicate_id"
  );
});

// ── list ──────────────────────────────────────────────────────────────────────

console.log("\nPgOpportunityCatalog — list");

await test("empty catalog returns []", async () => {
  const cat = await makeCatalog();
  const r = await cat.list("t1");
  assert(r.length === 0, "empty");
});

await test("returns opportunity after create", async () => {
  const cat = await makeCatalog();
  await cat.create({ tenantId: "t1", title: "Role A", description: "" });
  const r = await cat.list("t1");
  assert(r.length === 1 && r[0].title === "Role A", "one result");
});

await test("tenant isolation: t1 cannot see t2 data", async () => {
  const cat = await makeCatalog();
  await cat.create({ tenantId: "t1", title: "T1 Opp", description: "" });
  await cat.create({ tenantId: "t2", title: "T2 Opp", description: "" });
  const t1 = await cat.list("t1");
  const t2 = await cat.list("t2");
  assert(t1.length === 1 && t1[0].tenantId === "t1", "t1 scoped");
  assert(t2.length === 1 && t2[0].tenantId === "t2", "t2 scoped");
});

await test("empty tenantId returns []", async () => {
  const cat = await makeCatalog();
  await cat.create({ tenantId: "t1", title: "X", description: "" });
  const r = await cat.list("");
  assert(r.length === 0, "empty tenantId returns []");
});

// ── get ───────────────────────────────────────────────────────────────────────

console.log("\nPgOpportunityCatalog — get");

await test("happy path returns correct opportunity", async () => {
  const cat = await makeCatalog();
  const created = await cat.create({ tenantId: "t1", title: "Found", description: "d" });
  const got = await cat.get("t1", created.id);
  assert(got !== null && got.id === created.id, "found");
  assert(got!.title === "Found", "title matches");
});

await test("unknown id returns null", async () => {
  const cat = await makeCatalog();
  const r = await cat.get("t1", "ghost");
  assert(r === null, "null for unknown");
});

await test("cross-tenant get fail-closed (returns null)", async () => {
  const cat = await makeCatalog();
  const opp = await cat.create({ tenantId: "t1", title: "Private", description: "" });
  const r = await cat.get("t2", opp.id);
  assert(r === null, "cross-tenant returns null");
});

// ── delete ────────────────────────────────────────────────────────────────────

console.log("\nPgOpportunityCatalog — delete");

await test("happy path: returns true, list is empty", async () => {
  const cat = await makeCatalog();
  const opp = await cat.create({ tenantId: "t1", title: "Del", description: "" });
  const ok = await cat.delete("t1", opp.id);
  assert(ok === true, "returns true");
  assert((await cat.list("t1")).length === 0, "gone from list");
});

await test("not found returns false", async () => {
  const cat = await makeCatalog();
  const r = await cat.delete("t1", "ghost");
  assert(r === false, "false for missing");
});

await test("cross-tenant delete fail-closed: returns false, data intact", async () => {
  const cat = await makeCatalog();
  const opp = await cat.create({ tenantId: "t1", title: "Safe", description: "" });
  const r = await cat.delete("t2", opp.id);
  assert(r === false, "cross-tenant returns false");
  assert((await cat.get("t1", opp.id)) !== null, "still exists in t1");
});

// ── totalCount ────────────────────────────────────────────────────────────────

console.log("\nPgOpportunityCatalog — totalCount");

await test("zero initially", async () => {
  const cat = await makeCatalog();
  assert((await cat.totalCount()) === 0, "zero");
});

await test("counts across tenants", async () => {
  const cat = await makeCatalog();
  await cat.create({ tenantId: "t1", title: "A", description: "" });
  await cat.create({ tenantId: "t1", title: "B", description: "" });
  await cat.create({ tenantId: "t2", title: "C", description: "" });
  assert((await cat.totalCount()) === 3, "3 total");
});

await test("decreases after delete", async () => {
  const cat = await makeCatalog();
  const opp = await cat.create({ tenantId: "t1", title: "X", description: "" });
  assert((await cat.totalCount()) === 1, "1 after create");
  await cat.delete("t1", opp.id);
  assert((await cat.totalCount()) === 0, "0 after delete");
});

// ── persistence ───────────────────────────────────────────────────────────────

console.log("\nPgOpportunityCatalog — persistence");

await test("second catalog instance on same pool sees existing data", async () => {
  const pool = new InMemoryPool();
  const cat1 = new PgOpportunityCatalog(pool);
  await cat1.init();
  await cat1.create({ tenantId: "t1", title: "Persisted", description: "yes" });

  const cat2 = new PgOpportunityCatalog(pool);
  await cat2.init(); // idempotent — must not recreate table
  const list = await cat2.list("t1");
  assert(list.length === 1, "sees opportunity");
  assert(list[0].title === "Persisted", "correct title");
});

// ─── summary ─────────────────────────────────────────────────────────────────

console.log("\nPassed: " + passed + " / Failed: " + failed);
if (failed > 0) process.exit(1);
