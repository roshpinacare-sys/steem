import "../_flush.mjs";
/**
 * tests/release/pg-api-key-store.test.ts — PgApiKeyStore (J1 sub-step 2, part A: api-keys).
 *
 * v91 added per-tenant API keys (ApiKeyService + InMemoryApiKeyStore) but the
 * registry was in-memory — every key (and every revocation!) is lost on restart.
 * PgApiKeyStore is a drop-in ApiKeyStore over DbPool (InMemoryPool for tests,
 * pg.Pool in production) — same pattern as PgPersonalityStore / PgEscrowStore.
 *
 * Coverage:
 *   • put + get round-trip (all fields incl. scopes array, revokedAt/expiresAt undefined)
 *   • getByHashedSecret round-trip
 *   • put is an upsert (same keyId updates in place, not a duplicate row)
 *   • list(tenantId) returns only that tenant's keys, hashedSecret omitted
 *   • tenant isolation: list never returns another tenant's keys
 *   • revoke: sets revokedAt, returns true; revoke again → false (already revoked)
 *   • revoke unknown keyId → false
 *   • get/getByHashedSecret for unknown → null
 *   • totalCount across tenants
 *   • EDGE: revoked/expiresAt round-trip through "" sentinel → undefined (not "")
 *   • PERSISTENCE-ACROSS-INSTANCES: a second PgApiKeyStore over the same pool sees
 *     all data written by the first (init() is idempotent — IF NOT EXISTS)
 *   • END-TO-END with ApiKeyService: create → validate → revoke → validate (null),
 *     identical behaviour to InMemoryApiKeyStore (tests/auth/api-key.test.ts)
 *   • FAILURE CASE: a key with no scopes (undefined) persists as [] (matches InMemory)
 */
import { test, eq, assert } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { PgApiKeyStore } from "../../lib/api-key/pg-api-key-store.ts";
import { ApiKeyService } from "../../lib/api-key/api-key-service.ts";
import type { ApiKey } from "../../lib/api-key/types.ts";

function makeKey(overrides: Partial<ApiKey> = {}): ApiKey {
  const keyId = overrides.keyId ?? "key-" + Math.random().toString(36).slice(2, 10);
  return {
    keyId,
    tenantId: "tenant-1",
    name: "test-key",
    hashedSecret: "hash-" + keyId,
    scopes: ["read", "write"],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── basic round-trip ───────────────────────────────────────────────────────

test("PgApiKeyStore: put + get round-trip preserves all fields", async () => {
  const store = new PgApiKeyStore(new InMemoryPool());
  await store.init();
  const k = makeKey({ scopes: ["read", "admin"] });
  await store.put(k);

  const got = await store.get(k.keyId);
  assert(got, "key must be found");
  eq(got!.keyId, k.keyId);
  eq(got!.tenantId, "tenant-1");
  eq(got!.name, "test-key");
  eq(got!.hashedSecret, k.hashedSecret);
  eq(JSON.stringify(got!.scopes), JSON.stringify(["read", "admin"]));
  eq(got!.createdAt, k.createdAt);
  eq(got!.revokedAt, undefined, "revokedAt absent → undefined, not \"\"");
  eq(got!.expiresAt, undefined, "expiresAt absent → undefined, not \"\"");
});

test("PgApiKeyStore: getByHashedSecret round-trip", async () => {
  const store = new PgApiKeyStore(new InMemoryPool());
  await store.init();
  const k = makeKey();
  await store.put(k);

  const got = await store.getByHashedSecret(k.hashedSecret);
  assert(got, "key must be found by hashed secret");
  eq(got!.keyId, k.keyId);
});

test("PgApiKeyStore: get/getByHashedSecret for unknown id return null", async () => {
  const store = new PgApiKeyStore(new InMemoryPool());
  await store.init();
  eq(await store.get("nope"), null);
  eq(await store.getByHashedSecret("nope"), null);
});

// ─── upsert ──────────────────────────────────────────────────────────────────

test("PgApiKeyStore: put is an upsert (same keyId updates in place)", async () => {
  const store = new PgApiKeyStore(new InMemoryPool());
  await store.init();
  const k = makeKey({ name: "v1" });
  await store.put(k);
  await store.put({ ...k, name: "v2", scopes: ["admin"] });

  const got = await store.get(k.keyId);
  eq(got!.name, "v2");
  eq(JSON.stringify(got!.scopes), JSON.stringify(["admin"]));

  // exactly one row for this tenant
  const list = await store.list(k.tenantId);
  eq(list.filter((x) => x.keyId === k.keyId).length, 1, "no duplicate row after upsert");
});

// ─── list + tenant isolation ────────────────────────────────────────────────

test("PgApiKeyStore: list(tenantId) returns only that tenant's keys, hashedSecret omitted", async () => {
  const store = new PgApiKeyStore(new InMemoryPool());
  await store.init();
  await store.put(makeKey({ keyId: "a1", tenantId: "tenant-A" }));
  await store.put(makeKey({ keyId: "a2", tenantId: "tenant-A" }));
  await store.put(makeKey({ keyId: "b1", tenantId: "tenant-B" }));

  const listA = await store.list("tenant-A");
  eq(listA.length, 2);
  for (const k of listA) {
    eq(k.tenantId, "tenant-A");
    assert(!("hashedSecret" in k), "hashedSecret must be omitted from list()");
  }

  const listB = await store.list("tenant-B");
  eq(listB.length, 1);
  eq(listB[0].keyId, "b1");
});

test("PgApiKeyStore: list for empty tenantId returns []", async () => {
  const store = new PgApiKeyStore(new InMemoryPool());
  await store.init();
  eq((await store.list("")).length, 0);
});

// ─── revoke ──────────────────────────────────────────────────────────────────

test("PgApiKeyStore: revoke sets revokedAt and returns true; second revoke returns false", async () => {
  const store = new PgApiKeyStore(new InMemoryPool());
  await store.init();
  const k = makeKey();
  await store.put(k);

  const first = await store.revoke(k.keyId);
  eq(first, true);
  const got = await store.get(k.keyId);
  assert(got!.revokedAt, "revokedAt must be set");

  const second = await store.revoke(k.keyId);
  eq(second, false, "revoking an already-revoked key returns false");
});

test("PgApiKeyStore: revoke unknown keyId returns false", async () => {
  const store = new PgApiKeyStore(new InMemoryPool());
  await store.init();
  eq(await store.revoke("nope"), false);
});

// ─── totalCount ──────────────────────────────────────────────────────────────

test("PgApiKeyStore: totalCount counts across all tenants", async () => {
  const store = new PgApiKeyStore(new InMemoryPool());
  await store.init();
  eq(await store.totalCount(), 0);
  await store.put(makeKey({ keyId: "c1", tenantId: "tenant-A" }));
  await store.put(makeKey({ keyId: "c2", tenantId: "tenant-B" }));
  eq(await store.totalCount(), 2);
});

// ─── persistence across instances ──────────────────────────────────────────

test("PgApiKeyStore: persistence across instances over the same pool", async () => {
  const pool = new InMemoryPool();
  const store1 = new PgApiKeyStore(pool);
  await store1.init();
  const k = makeKey({ keyId: "persist-1" });
  await store1.put(k);
  await store1.revoke("persist-1");

  // Fresh instance, same pool — init() is idempotent (IF NOT EXISTS)
  const store2 = new PgApiKeyStore(pool);
  await store2.init();
  const got = await store2.get("persist-1");
  assert(got, "second instance sees data written by the first");
  assert(got!.revokedAt, "revocation persisted across instances");
});

// ─── end-to-end with ApiKeyService ─────────────────────────────────────────

test("END-TO-END (ApiKeyService + PgApiKeyStore): create → validate → revoke → validate", async () => {
  const store = new PgApiKeyStore(new InMemoryPool());
  await store.init();
  const svc = new ApiKeyService(store);

  const created = await svc.create({ tenantId: "tenant-svc", name: "svc-key", scopes: ["read"] });
  assert(created.secret.startsWith("tfa_"), "secret must start with tfa_");
  assert(!("hashedSecret" in created.key), "returned key must not contain hashedSecret");

  const validated = await svc.validate(created.secret);
  assert(validated, "valid secret validates");
  eq(validated!.tenantId, "tenant-svc");

  const revoked = await svc.revoke(created.key.keyId);
  eq(revoked, true);

  const afterRevoke = await svc.validate(created.secret);
  eq(afterRevoke, null, "revoked key fails validation (fail-closed)");
});

test("END-TO-END: validate with wrong secret returns null (fail-closed)", async () => {
  const store = new PgApiKeyStore(new InMemoryPool());
  await store.init();
  const svc = new ApiKeyService(store);
  await svc.create({ tenantId: "tenant-svc", name: "svc-key" });

  eq(await svc.validate("tfa_totally-wrong-secret"), null);
});

// ─── edge: scopes defaulting / "" sentinel ─────────────────────────────────

test("EDGE: key with empty scopes array round-trips as []", async () => {
  const store = new PgApiKeyStore(new InMemoryPool());
  await store.init();
  const k = makeKey({ scopes: [] });
  await store.put(k);
  const got = await store.get(k.keyId);
  eq(JSON.stringify(got!.scopes), JSON.stringify([]));
});

test("EDGE: expiresAt set is preserved, expiresAt absent stays undefined", async () => {
  const store = new PgApiKeyStore(new InMemoryPool());
  await store.init();
  const future = new Date(Date.now() + 86400000).toISOString();
  const withExp = makeKey({ keyId: "exp-1", expiresAt: future });
  const withoutExp = makeKey({ keyId: "exp-2" });
  await store.put(withExp);
  await store.put(withoutExp);

  eq((await store.get("exp-1"))!.expiresAt, future);
  eq((await store.get("exp-2"))!.expiresAt, undefined);
});

// ─── composition: buildSovereignStack wiring ───────────────────────────────

test("COMPOSITION: buildSovereignStack uses PgApiKeyStore when pool provided, InMemory otherwise", async () => {
  const { buildSovereignStack, defaultPolicies } = await import("../../src/composition.ts");
  const { InMemoryLedger } = await import("../../lib/ledger/in-memory-ledger.ts");
  const { InMemoryApiKeyStore: IMAKS } = await import("../../lib/api-key/api-key-store.ts");

  // no pool → InMemoryApiKeyStore (unchanged behaviour)
  const stackNoPool = buildSovereignStack([...defaultPolicies()], { provider: new InMemoryLedger() });
  assert(stackNoPool.apiKeyStore instanceof IMAKS, "no pool → InMemoryApiKeyStore");

  // pool provided → PgApiKeyStore, and it works end-to-end through ApiKeyService
  const pool = new InMemoryPool();
  const stackWithPool = buildSovereignStack([...defaultPolicies()], { provider: new InMemoryLedger(), pool: pool as any });
  assert(stackWithPool.apiKeyStore instanceof PgApiKeyStore, "pool provided → PgApiKeyStore");

  const created = await stackWithPool.apiKeyService.create({ tenantId: "tenant-comp", name: "comp-key" });
  const validated = await stackWithPool.apiKeyService.validate(created.secret);
  assert(validated, "key created via composed stack validates");
  eq(validated!.tenantId, "tenant-comp");
});
