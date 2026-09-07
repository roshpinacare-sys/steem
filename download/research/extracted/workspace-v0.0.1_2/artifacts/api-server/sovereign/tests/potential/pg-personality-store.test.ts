import "../_flush.mjs";
/**
 * tests/potential/pg-personality-store.test.ts — PgPersonalityStore full test suite.
 *
 * Uses InMemoryPool — no external Postgres required.
 *
 * Coverage:
 *   init
 *     • idempotent (call twice — no error)
 *
 *   save (upsert)
 *     • happy path — all fields persisted
 *     • upsert: second save replaces first (same userId+tenantId)
 *     • upsert: latest analyzedAt wins
 *     • missing userId → PersonalityStoreError MISSING_USER_ID
 *     • missing tenantId → PersonalityStoreError MISSING_TENANT_ID
 *     • missing traits key → PersonalityStoreError INVALID_TRAITS
 *     • trait score > 100 → PersonalityStoreError INVALID_TRAITS
 *     • trait score < 0 → PersonalityStoreError INVALID_TRAITS
 *     • non-numeric trait → PersonalityStoreError INVALID_TRAITS
 *
 *   load
 *     • happy path — returns correct profile
 *     • unknown userId → null
 *     • cross-tenant isolation: user of tenant-A not visible from tenant-B
 *     • empty tenantId → null
 *     • empty userId → null
 *
 *   listByTenant
 *     • empty → []
 *     • returns all profiles for tenant
 *     • tenant isolation — other tenant's profiles excluded
 *     • empty tenantId → []
 *
 *   delete
 *     • happy path → true + subsequent load returns null
 *     • unknown userId → false
 *     • cross-tenant: cannot delete other tenant's profile → false + data intact
 *     • empty tenantId → false
 *
 *   totalCount
 *     • zero
 *     • counts only the requested tenant
 *     • decreases after delete
 *     • empty tenantId → 0
 *
 *   persistence
 *     • two instances sharing the same pool see the same data
 *
 *   composition integration
 *     • buildSovereignStack() exposes personalityStore
 *     • personalityStore.save + load round-trip through the stack
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import {
  PgPersonalityStore,
  PersonalityStoreError,
} from "../../lib/potential/pg-personality-store.ts";
import type { PersonalityProfile } from "../../lib/potential/personality-types.ts";
import { buildSovereignStack, defaultPolicies } from "../../src/composition.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProfile(
  userId = "u1",
  tenantId = "tenant-a",
  overrides: Partial<PersonalityProfile> = {}
): PersonalityProfile {
  return {
    userId,
    tenantId,
    traits: {
      extroversion: 70,
      focus: 55,
      collaboration: 80,
      creativity: 45,
      leadership: 60,
    },
    evidence: [
      { source: "mentorship", trait: "leadership", contribution: 60 },
    ],
    confidence: {
      extroversion: 0.8,
      focus: 0.6,
      collaboration: 1.0,
      creativity: 0.4,
      leadership: 1.0,
    },
    analyzedAt: new Date().toISOString(),
    ...overrides,
  };
}

function freshStore() {
  const pool = new InMemoryPool();
  const store = new PgPersonalityStore(pool);
  return { pool, store };
}

// ─── init ─────────────────────────────────────────────────────────────────────

test("PgPersonalityStore: init is idempotent (call twice → no error)", async () => {
  const { store } = freshStore();
  await store.init();
  await store.init(); // second call must not throw
  eq(await store.totalCount("nobody"), 0);
});

// ─── save ─────────────────────────────────────────────────────────────────────

test("PgPersonalityStore: save persists all fields", async () => {
  const { store } = freshStore();
  await store.init();
  const p = makeProfile("u1", "t-save");
  await store.save(p);
  const loaded = await store.load("t-save", "u1");
  assert(loaded !== null, "should find saved profile");
  eq(loaded!.userId, "u1");
  eq(loaded!.tenantId, "t-save");
  eq(loaded!.traits.leadership, 60);
  eq(loaded!.traits.focus, 55);
  eq(loaded!.evidence.length, 1);
  eq(loaded!.evidence[0].source, "mentorship");
  eq(loaded!.confidence.collaboration, 1.0);
  assert(typeof loaded!.analyzedAt === "string", "analyzedAt is string");
});

test("PgPersonalityStore: save upserts — second save replaces first", async () => {
  const { store } = freshStore();
  await store.init();
  await store.save(makeProfile("u1", "t-upsert", { traits: { extroversion: 10, focus: 10, collaboration: 10, creativity: 10, leadership: 10 } }));
  await store.save(makeProfile("u1", "t-upsert", { traits: { extroversion: 99, focus: 99, collaboration: 99, creativity: 99, leadership: 99 } }));
  const loaded = await store.load("t-upsert", "u1");
  assert(loaded !== null, "should find profile");
  eq(loaded!.traits.extroversion, 99);
  eq(await store.totalCount("t-upsert"), 1); // still exactly one row
});

test("PgPersonalityStore: save upsert — latest analyzedAt wins", async () => {
  const { store } = freshStore();
  await store.init();
  const t1 = "2026-01-01T00:00:00.000Z";
  const t2 = "2026-06-01T12:00:00.000Z";
  await store.save(makeProfile("u1", "t-ts", { analyzedAt: t1 }));
  await store.save(makeProfile("u1", "t-ts", { analyzedAt: t2 }));
  const loaded = await store.load("t-ts", "u1");
  eq(loaded!.analyzedAt, t2);
});

test("PgPersonalityStore: save missing userId → MISSING_USER_ID", async () => {
  const { store } = freshStore();
  await store.init();
  let caught: PersonalityStoreError | null = null;
  try { await store.save(makeProfile("", "t1")); } catch (e) { caught = e as PersonalityStoreError; }
  assert(caught instanceof PersonalityStoreError, "should throw PersonalityStoreError");
  eq(caught!.code, "MISSING_USER_ID");
});

test("PgPersonalityStore: save missing tenantId → MISSING_TENANT_ID", async () => {
  const { store } = freshStore();
  await store.init();
  let caught: PersonalityStoreError | null = null;
  try { await store.save(makeProfile("u1", "")); } catch (e) { caught = e as PersonalityStoreError; }
  assert(caught instanceof PersonalityStoreError, "should throw PersonalityStoreError");
  eq(caught!.code, "MISSING_TENANT_ID");
});

test("PgPersonalityStore: save trait score > 100 → INVALID_TRAITS", async () => {
  const { store } = freshStore();
  await store.init();
  let caught: PersonalityStoreError | null = null;
  try {
    await store.save(makeProfile("u1", "t1", {
      traits: { extroversion: 101, focus: 0, collaboration: 0, creativity: 0, leadership: 0 },
    }));
  } catch (e) { caught = e as PersonalityStoreError; }
  assert(caught instanceof PersonalityStoreError, "should throw");
  eq(caught!.code, "INVALID_TRAITS");
});

test("PgPersonalityStore: save trait score < 0 → INVALID_TRAITS", async () => {
  const { store } = freshStore();
  await store.init();
  let caught: PersonalityStoreError | null = null;
  try {
    await store.save(makeProfile("u1", "t1", {
      traits: { extroversion: -1, focus: 0, collaboration: 0, creativity: 0, leadership: 0 },
    }));
  } catch (e) { caught = e as PersonalityStoreError; }
  assert(caught instanceof PersonalityStoreError, "should throw");
  eq(caught!.code, "INVALID_TRAITS");
});

test("PgPersonalityStore: save non-numeric trait → INVALID_TRAITS", async () => {
  const { store } = freshStore();
  await store.init();
  let caught: PersonalityStoreError | null = null;
  try {
    await store.save(makeProfile("u1", "t1", {
      traits: { extroversion: "high" as unknown as number, focus: 0, collaboration: 0, creativity: 0, leadership: 0 },
    }));
  } catch (e) { caught = e as PersonalityStoreError; }
  assert(caught instanceof PersonalityStoreError, "should throw");
  eq(caught!.code, "INVALID_TRAITS");
});

// ─── load ─────────────────────────────────────────────────────────────────────

test("PgPersonalityStore: load returns null for unknown userId", async () => {
  const { store } = freshStore();
  await store.init();
  const result = await store.load("t1", "nonexistent");
  eq(result, null);
});

test("PgPersonalityStore: load — cross-tenant isolation (tenant-A user not visible from tenant-B)", async () => {
  const { store } = freshStore();
  await store.init();
  await store.save(makeProfile("u1", "tenant-A"));
  const result = await store.load("tenant-B", "u1");
  eq(result, null);
});

test("PgPersonalityStore: load empty tenantId → null", async () => {
  const { store } = freshStore();
  await store.init();
  eq(await store.load("", "u1"), null);
});

test("PgPersonalityStore: load empty userId → null", async () => {
  const { store } = freshStore();
  await store.init();
  eq(await store.load("t1", ""), null);
});

// ─── listByTenant ─────────────────────────────────────────────────────────────

test("PgPersonalityStore: listByTenant empty → []", async () => {
  const { store } = freshStore();
  await store.init();
  const list = await store.listByTenant("nobody");
  eq(list.length, 0);
});

test("PgPersonalityStore: listByTenant returns all profiles for tenant", async () => {
  const { store } = freshStore();
  await store.init();
  await store.save(makeProfile("u1", "t-list"));
  await store.save(makeProfile("u2", "t-list"));
  await store.save(makeProfile("u3", "t-list"));
  const list = await store.listByTenant("t-list");
  eq(list.length, 3);
  const ids = list.map(p => p.userId).sort();
  eq(ids[0], "u1");
  eq(ids[1], "u2");
  eq(ids[2], "u3");
});

test("PgPersonalityStore: listByTenant — tenant isolation (other tenant excluded)", async () => {
  const { store } = freshStore();
  await store.init();
  await store.save(makeProfile("u1", "t-iso-1"));
  await store.save(makeProfile("u2", "t-iso-2"));
  const list = await store.listByTenant("t-iso-1");
  eq(list.length, 1);
  eq(list[0].userId, "u1");
});

test("PgPersonalityStore: listByTenant empty tenantId → []", async () => {
  const { store } = freshStore();
  await store.init();
  eq((await store.listByTenant("")).length, 0);
});

// ─── delete ───────────────────────────────────────────────────────────────────

test("PgPersonalityStore: delete happy path → true + load returns null", async () => {
  const { store } = freshStore();
  await store.init();
  await store.save(makeProfile("u1", "t-del"));
  const deleted = await store.delete("t-del", "u1");
  eq(deleted, true);
  eq(await store.load("t-del", "u1"), null);
});

test("PgPersonalityStore: delete unknown userId → false", async () => {
  const { store } = freshStore();
  await store.init();
  eq(await store.delete("t1", "nonexistent"), false);
});

test("PgPersonalityStore: delete cross-tenant → false + data intact", async () => {
  const { store } = freshStore();
  await store.init();
  await store.save(makeProfile("u1", "t-owner"));
  const result = await store.delete("t-other", "u1");
  eq(result, false);
  // Profile still present for the correct tenant
  const loaded = await store.load("t-owner", "u1");
  assert(loaded !== null, "profile should still exist for t-owner");
});

test("PgPersonalityStore: delete empty tenantId → false", async () => {
  const { store } = freshStore();
  await store.init();
  eq(await store.delete("", "u1"), false);
});

// ─── totalCount ───────────────────────────────────────────────────────────────

test("PgPersonalityStore: totalCount zero", async () => {
  const { store } = freshStore();
  await store.init();
  eq(await store.totalCount("empty-tenant"), 0);
});

test("PgPersonalityStore: totalCount counts only the requested tenant", async () => {
  const { store } = freshStore();
  await store.init();
  await store.save(makeProfile("u1", "t-count"));
  await store.save(makeProfile("u2", "t-count"));
  await store.save(makeProfile("u3", "t-other"));
  eq(await store.totalCount("t-count"), 2);
  eq(await store.totalCount("t-other"), 1);
});

test("PgPersonalityStore: totalCount decreases after delete", async () => {
  const { store } = freshStore();
  await store.init();
  await store.save(makeProfile("u1", "t-del-count"));
  await store.save(makeProfile("u2", "t-del-count"));
  eq(await store.totalCount("t-del-count"), 2);
  await store.delete("t-del-count", "u1");
  eq(await store.totalCount("t-del-count"), 1);
});

test("PgPersonalityStore: totalCount empty tenantId → 0", async () => {
  const { store } = freshStore();
  await store.init();
  eq(await store.totalCount(""), 0);
});

// ─── persistence (two instances, one pool) ────────────────────────────────────

test("PgPersonalityStore: two instances on same pool see same data", async () => {
  const pool = new InMemoryPool();
  const storeA = new PgPersonalityStore(pool);
  const storeB = new PgPersonalityStore(pool);
  await storeA.init(); // only one init needed — shared pool
  await storeA.save(makeProfile("u1", "t-shared"));
  const loaded = await storeB.load("t-shared", "u1");
  assert(loaded !== null, "storeB should see storeA's data");
  eq(loaded!.userId, "u1");
});

// ─── composition integration ──────────────────────────────────────────────────

test("PgPersonalityStore: buildSovereignStack exposes personalityStore", () => {
  const stack = buildSovereignStack(defaultPolicies());
  assert(stack.personalityStore instanceof PgPersonalityStore, "personalityStore is PgPersonalityStore");
});

test("PgPersonalityStore: save+load round-trip through composition stack", async () => {
  const pool = new InMemoryPool();
  const stack = buildSovereignStack(defaultPolicies(), { pool });
  // Wait for init (fire-and-forget, but InMemoryPool is sync under the hood)
  await new Promise(r => setTimeout(r, 10));
  const profile = makeProfile("u-stack", "t-stack");
  await stack.personalityStore.save(profile);
  const loaded = await stack.personalityStore.load("t-stack", "u-stack");
  assert(loaded !== null, "should find saved profile");
  eq(loaded!.userId, "u-stack");
  eq(loaded!.traits.collaboration, 80);
});
