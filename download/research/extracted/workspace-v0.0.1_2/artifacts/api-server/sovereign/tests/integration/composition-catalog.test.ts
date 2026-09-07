import "../_flush.mjs";
/**
 * tests/integration/composition-catalog.test.ts — v54: שלב E חלק ה'.
 *
 * Verifies PgOpportunityCatalog is wired into composition root when a DbPool
 * is provided, while InMemoryOpportunityCatalog remains the default for tests
 * without a pool.
 *
 * No external DB. Runs with: node tests/integration/composition-catalog.test.ts
 *
 * Coverage:
 *   • buildSovereignStackAsync with pool → PgOpportunityCatalog (functional)
 *   • buildSovereignStackAsync without pool → InMemoryOpportunityCatalog (backward compat)
 *   • catalog.create + catalog.list work via stack after init
 *   • Tenant isolation preserved through PgOpportunityCatalog
 *   • Persistence: two stacks on same pool see same catalog data
 *   • buildSovereignStack (sync) with pool → PgOpportunityCatalog fire-and-forget
 *   • buildSovereignStack (sync) without pool → InMemory
 *   • Explicit catalog option takes precedence over pool (async)
 *   • catalog.get and catalog.delete functional via stack
 *   • totalCount (global, not tenant-scoped) via PgOpportunityCatalog
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { InMemoryOpportunityCatalog } from "../../lib/marketplace/catalog.ts";
import {
  buildSovereignStackAsync,
  buildSovereignStack,
  defaultPolicies,
} from "../../src/composition.ts";

// ─── 1. buildSovereignStackAsync with pool → PgOpportunityCatalog ─────────────

test("composition-catalog: buildSovereignStackAsync with pool → functional catalog", async () => {
  const pool = new InMemoryPool();
  const stack = await buildSovereignStackAsync(defaultPolicies(), { pool });
  assert(stack.catalog !== undefined, "catalog exists");

  const opp = await stack.catalog.create({
    tenantId: "tenant-pg",
    title: "SaaS PM Role",
    description: "Lead product",
    requiredStrengths: [{ category: "leadership", minScore: 70 }],
  });
  eq(opp.tenantId, "tenant-pg");
  assert(opp.id.length > 0, "opp has id");

  const list = await stack.catalog.list("tenant-pg");
  eq(list.length, 1);
  eq(list[0].id, opp.id);
});

// ─── 2. buildSovereignStackAsync without pool → InMemoryOpportunityCatalog ───

test("composition-catalog: buildSovereignStackAsync without pool → InMemoryOpportunityCatalog", async () => {
  const stack = await buildSovereignStackAsync();
  assert(stack.catalog !== undefined, "catalog exists");

  const opp = await stack.catalog.create({
    tenantId: "tenant-mem",
    title: "Dev Role",
    description: "Build stuff",
    requiredStrengths: [],
  });
  eq(opp.tenantId, "tenant-mem");
  const list = await stack.catalog.list("tenant-mem");
  eq(list.length, 1);
});

// ─── 3. Tenant isolation preserved ────────────────────────────────────────────

test("composition-catalog: tenant isolation preserved via PgOpportunityCatalog", async () => {
  const pool = new InMemoryPool();
  const stack = await buildSovereignStackAsync(defaultPolicies(), { pool });

  await stack.catalog.create({ tenantId: "t-a", title: "Opp A", description: "", requiredStrengths: [] });
  await stack.catalog.create({ tenantId: "t-b", title: "Opp B", description: "", requiredStrengths: [] });

  const listA = await stack.catalog.list("t-a");
  const listB = await stack.catalog.list("t-b");
  eq(listA.length, 1);
  eq(listB.length, 1);
  eq(listA[0].title, "Opp A");
  eq(listB[0].title, "Opp B");
});

// ─── 4. Persistence: two stacks on same pool share catalog ────────────────────

test("composition-catalog: two stacks on same pool share data", async () => {
  const pool = new InMemoryPool();
  const stackA = await buildSovereignStackAsync(defaultPolicies(), { pool });
  const opp = await stackA.catalog.create({
    tenantId: "t-shared",
    title: "Shared Opp",
    description: "Persists",
    requiredStrengths: [],
  });

  // Second stack on same pool — init() is idempotent (IF NOT EXISTS), data persists
  const stackB = await buildSovereignStackAsync(defaultPolicies(), { pool });
  const list = await stackB.catalog.list("t-shared");
  eq(list.length, 1, "second stack sees same data");
  eq(list[0].id, opp.id);
});

// ─── 5. catalog.get functional ────────────────────────────────────────────────

test("composition-catalog: catalog.get works via PgOpportunityCatalog stack", async () => {
  const pool = new InMemoryPool();
  const stack = await buildSovereignStackAsync(defaultPolicies(), { pool });
  const opp = await stack.catalog.create({
    tenantId: "t-get",
    title: "Get Test",
    description: "",
    requiredStrengths: [],
  });

  const fetched = await stack.catalog.get("t-get", opp.id);
  assert(fetched !== null, "get returns the opportunity");
  eq(fetched!.id, opp.id);
  eq(fetched!.title, "Get Test");

  // Cross-tenant → null (fail-closed)
  const cross = await stack.catalog.get("t-other", opp.id);
  eq(cross, null, "cross-tenant get returns null");
});

// ─── 6. catalog.delete functional ────────────────────────────────────────────

test("composition-catalog: catalog.delete works via PgOpportunityCatalog stack", async () => {
  const pool = new InMemoryPool();
  const stack = await buildSovereignStackAsync(defaultPolicies(), { pool });
  const opp = await stack.catalog.create({
    tenantId: "t-del",
    title: "Delete Test",
    description: "",
    requiredStrengths: [],
  });

  const deleted = await stack.catalog.delete("t-del", opp.id);
  assert(deleted, "delete returns true for existing opp");

  const list = await stack.catalog.list("t-del");
  eq(list.length, 0, "list is empty after delete");

  const again = await stack.catalog.delete("t-del", opp.id);
  assert(!again, "delete returns false for already-deleted opp");
});

// ─── 7. totalCount (global) via PgOpportunityCatalog ─────────────────────────

test("composition-catalog: catalog.totalCount (global) via PgOpportunityCatalog stack", async () => {
  const pool = new InMemoryPool();
  const stack = await buildSovereignStackAsync(defaultPolicies(), { pool });
  eq(await stack.catalog.totalCount(), 0, "fresh pool → 0");

  await stack.catalog.create({ tenantId: "t-cnt", title: "Opp 1", description: "", requiredStrengths: [] });
  await stack.catalog.create({ tenantId: "t-cnt", title: "Opp 2", description: "", requiredStrengths: [] });
  eq(await stack.catalog.totalCount(), 2, "two opps → 2");

  // Delete one → 1
  const list = await stack.catalog.list("t-cnt");
  await stack.catalog.delete("t-cnt", list[0].id);
  eq(await stack.catalog.totalCount(), 1, "after delete → 1");
});

// ─── 8. Explicit catalog option takes precedence over pool (async) ────────────

test("composition-catalog: explicit catalog option wins over pool in async build", async () => {
  const pool = new InMemoryPool();
  const explicitCatalog = new InMemoryOpportunityCatalog();

  // Pre-seed the explicit catalog
  await explicitCatalog.create({ tenantId: "t-exp", title: "Explicit Opp", description: "", requiredStrengths: [] });

  // Pass both pool AND explicit catalog — catalog should win
  const stack = await buildSovereignStackAsync(defaultPolicies(), { pool, catalog: explicitCatalog });
  const list = await stack.catalog.list("t-exp");
  eq(list.length, 1, "explicit catalog with pre-seeded data is used");
  eq(list[0].title, "Explicit Opp");

  // Pool-backed catalog should be empty (never written to)
  const poolStack = await buildSovereignStackAsync(defaultPolicies(), { pool });
  const poolList = await poolStack.catalog.list("t-exp");
  eq(poolList.length, 0, "pool-backed catalog was not written to");
});

// ─── 9. buildSovereignStack (sync) with pool → PgOpportunityCatalog ──────────

test("composition-catalog: buildSovereignStack (sync) with pool builds PgOpportunityCatalog", async () => {
  const pool = new InMemoryPool();

  // Fire-and-forget init() — yield for it to complete
  const stack = buildSovereignStack(defaultPolicies(), { pool });
  await new Promise<void>(r => setTimeout(r, 20));

  const opp = await stack.catalog.create({
    tenantId: "t-sync",
    title: "Sync Stack Test",
    description: "",
    requiredStrengths: [],
  });
  eq(opp.tenantId, "t-sync");
  const list = await stack.catalog.list("t-sync");
  eq(list.length, 1);
});

// ─── 10. buildSovereignStack (sync) without pool → InMemoryOpportunityCatalog ─

test("composition-catalog: buildSovereignStack (sync) without pool → InMemory", async () => {
  const stack = buildSovereignStack(defaultPolicies());
  assert(stack.catalog !== undefined);

  const opp = await stack.catalog.create({
    tenantId: "t-sync-mem",
    title: "Mem catalog",
    description: "",
    requiredStrengths: [],
  });
  eq(opp.tenantId, "t-sync-mem");
});
