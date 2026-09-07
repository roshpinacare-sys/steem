import "../_flush.mjs";
/**
 * tests/release/pg-idempotency-store.test.ts — PgIdempotencyStore + PgIdempotencySync (v112)
 *
 * J1 sub-step 1 (Persist-everything): idempotency records survive a restart.
 * Uses InMemoryPool — no external DB required.
 *
 * Coverage:
 *   init: idempotent (safe to call twice)
 *   getAsync/setAsync: round-trip — in-flight then done, status+body preserved
 *   getAsync: unknown key → undefined
 *   tenant isolation: same key, different tenants → independent records
 *   TTL: expired record → getAsync returns undefined (treated as absent)
 *   persistence: second PgIdempotencyStore instance on same pool sees data (restart-safe)
 *   totalCount: zero, after writes, across tenants
 *   PgIdempotencyStore.get()/set() (sync interface) throw — fail loud, not fail-open
 *   PgIdempotencySync: preload + get/set round-trip through checkIdempotency()
 *   PgIdempotencySync: end-to-end with checkIdempotency — proceed → finish → replay on retry
 *   PgIdempotencySync: write-through persists to pg (second sync instance sees it after preload)
 *   composition: startSovereignServer with TFA_PERSIST=pg + pool → idempotency survives "restart"
 *     (new server instance, same pool, same key → replay, no double-mint)
 */

import { test, eq, assert } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { PgIdempotencyStore, PgIdempotencySync } from "../../src/http/pg-idempotency-store.ts";
import { checkIdempotency } from "../../src/http/idempotency.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";

// ─── init ───────────────────────────────────────────────────────────────────

test("PG-IDEM init: idempotent (safe to call twice)", async () => {
  const pool = new InMemoryPool();
  const store = new PgIdempotencyStore(pool);
  await store.init();
  await store.init(); // must not throw
  eq(await store.totalCount(), 0);
});

// ─── getAsync / setAsync round-trip ────────────────────────────────────────────

test("PG-IDEM round-trip: set in-flight then done, status+body preserved", async () => {
  const pool = new InMemoryPool();
  const store = new PgIdempotencyStore(pool);
  await store.init();

  await store.setAsync("t1", "key-1", { status: 0, body: null, pathKey: "POST /api/x", state: "in-flight", createdAt: Date.now() });
  const inFlight = await store.getAsync("t1", "key-1");
  assert(inFlight, "in-flight record must be readable");
  eq(inFlight!.state, "in-flight");

  await store.setAsync("t1", "key-1", { status: 201, body: { ok: true, id: "abc" }, pathKey: "POST /api/x", state: "done", createdAt: Date.now() });
  const done = await store.getAsync("t1", "key-1");
  assert(done, "done record must be readable");
  eq(done!.state, "done");
  eq(done!.status, 201);
  eq(JSON.stringify(done!.body), JSON.stringify({ ok: true, id: "abc" }));
  eq(done!.pathKey, "POST /api/x");
});

test("PG-IDEM: unknown key → undefined", async () => {
  const pool = new InMemoryPool();
  const store = new PgIdempotencyStore(pool);
  await store.init();
  const rec = await store.getAsync("t1", "no-such-key");
  eq(rec, undefined);
});

// ─── Tenant isolation ───────────────────────────────────────────────────────────

test("PG-IDEM: tenant isolation — same key, different tenants → independent", async () => {
  const pool = new InMemoryPool();
  const store = new PgIdempotencyStore(pool);
  await store.init();

  await store.setAsync("tenant-A", "shared-key", { status: 201, body: { who: "A" }, pathKey: "POST /api/x", state: "done", createdAt: Date.now() });
  await store.setAsync("tenant-B", "shared-key", { status: 201, body: { who: "B" }, pathKey: "POST /api/x", state: "done", createdAt: Date.now() });

  const a = await store.getAsync("tenant-A", "shared-key");
  const b = await store.getAsync("tenant-B", "shared-key");
  eq(JSON.stringify(a!.body), JSON.stringify({ who: "A" }));
  eq(JSON.stringify(b!.body), JSON.stringify({ who: "B" }));
});

// ─── TTL ─────────────────────────────────────────────────────────────────────

test("PG-IDEM: expired record (TTL exceeded) → getAsync returns undefined", async () => {
  const pool = new InMemoryPool();
  const store = new PgIdempotencyStore(pool, 100); // 100ms TTL
  await store.init();

  await store.setAsync("t1", "key-ttl", { status: 200, body: { ok: true }, pathKey: "POST /api/x", state: "done", createdAt: Date.now() - 1000 }); // already 1s old
  const rec = await store.getAsync("t1", "key-ttl");
  eq(rec, undefined, "expired record must be treated as absent");
});

// ─── Persistence across instances (restart-safety) ────────────────────────────

test("PG-IDEM: persistence — second store instance on same pool sees data", async () => {
  const pool = new InMemoryPool();
  const store1 = new PgIdempotencyStore(pool);
  await store1.init();
  await store1.setAsync("t1", "persist-key", { status: 200, body: { v: 1 }, pathKey: "POST /api/x", state: "done", createdAt: Date.now() });

  // Simulate restart: a fresh store instance on the SAME pool.
  const store2 = new PgIdempotencyStore(pool);
  await store2.init(); // idempotent CREATE TABLE
  const rec = await store2.getAsync("t1", "persist-key");
  assert(rec, "record must survive across store instances (restart-safe)");
  eq(JSON.stringify(rec!.body), JSON.stringify({ v: 1 }));
});

// ─── totalCount ─────────────────────────────────────────────────────────────────

test("PG-IDEM totalCount: zero, then after writes across tenants", async () => {
  const pool = new InMemoryPool();
  const store = new PgIdempotencyStore(pool);
  await store.init();
  eq(await store.totalCount(), 0);

  await store.setAsync("t1", "k1", { status: 200, body: {}, pathKey: "POST /a", state: "done", createdAt: Date.now() });
  await store.setAsync("t2", "k2", { status: 200, body: {}, pathKey: "POST /a", state: "done", createdAt: Date.now() });
  eq(await store.totalCount(), 2);

  // Updating an existing key must not increase the count.
  await store.setAsync("t1", "k1", { status: 201, body: { updated: true }, pathKey: "POST /a", state: "done", createdAt: Date.now() });
  eq(await store.totalCount(), 2);
});

// ─── Sync interface fails loudly (not fail-open) ─────────────────────────────

test("PG-IDEM: sync get()/set() throw — misuse fails loudly, not silently fail-open", async () => {
  const pool = new InMemoryPool();
  const store = new PgIdempotencyStore(pool);
  await store.init();

  let getThrew = false;
  try { store.get("t1", "k1"); } catch { getThrew = true; }
  assert(getThrew, "sync get() must throw");

  let setThrew = false;
  try { store.set("t1", "k1", { status: 200, body: {}, pathKey: "POST /a", state: "done", createdAt: Date.now() }); } catch { setThrew = true; }
  assert(setThrew, "sync set() must throw");
});

// ─── PgIdempotencySync — sync adapter ──────────────────────────────────────────

test("PG-IDEM-SYNC: preload + get/set round-trip", async () => {
  const pool = new InMemoryPool();
  const pg = new PgIdempotencyStore(pool);
  await pg.init();
  const sync = new PgIdempotencySync(pg);

  // Nothing yet — preload of an absent key leaves cache empty.
  await sync.preload("t1", "key-1");
  eq(sync.get("t1", "key-1"), undefined);

  // set() writes to cache synchronously (and write-through async to pg).
  sync.set("t1", "key-1", { status: 201, body: { id: "x" }, pathKey: "POST /api/x", state: "done", createdAt: Date.now() });
  const rec = sync.get("t1", "key-1");
  assert(rec, "set() must be readable immediately from cache");
  eq(rec!.status, 201);
});

test("PG-IDEM-SYNC: end-to-end with checkIdempotency — proceed → finish → replay on retry", async () => {
  const pool = new InMemoryPool();
  const pg = new PgIdempotencyStore(pool);
  await pg.init();
  const sync = new PgIdempotencySync(pg);

  const tenantId = "t1", key = "order-1", method = "POST", path = "/api/ledger/mint";

  // First request: nothing cached → proceed.
  await sync.preload(tenantId, key);
  const d1 = checkIdempotency(sync, tenantId, key, method, path);
  assert(d1.kind === "proceed", "first request must proceed");
  if (d1.kind === "proceed") d1.finish(200, { auditId: "audit-123", minted: "1000" });

  // Let the queued write-throughs (reserve, then finish) land in pg.
  await new Promise((r) => setTimeout(r, 20));

  // Retry: preload from pg (simulates a fresh process picking it up), then replay.
  const sync2 = new PgIdempotencySync(pg);
  await sync2.preload(tenantId, key);
  const d2 = checkIdempotency(sync2, tenantId, key, method, path);
  assert(d2.kind === "replay", "retry must replay the original response");
  if (d2.kind === "replay") {
    eq(d2.status, 200);
    eq(JSON.stringify(d2.body), JSON.stringify({ auditId: "audit-123", minted: "1000" }));
  }
});

test("PG-IDEM-SYNC: write-through persists — second sync instance sees it after preload (restart-safe)", async () => {
  const pool = new InMemoryPool();
  const pg = new PgIdempotencyStore(pool);
  await pg.init();

  const syncA = new PgIdempotencySync(pg);
  syncA.set("t1", "key-restart", { status: 201, body: { ok: true }, pathKey: "POST /api/x", state: "done", createdAt: Date.now() });

  // Give the fire-and-forget write-through a tick to land.
  await new Promise((r) => setTimeout(r, 10));

  // A brand-new sync instance (simulating a restarted process) must see it via preload.
  const syncB = new PgIdempotencySync(pg);
  await syncB.preload("t1", "key-restart");
  const rec = syncB.get("t1", "key-restart");
  assert(rec, "record must be visible to a fresh PgIdempotencySync after preload");
  eq(rec!.status, 201);
});

// ─── composition: TFA_PERSIST=pg end-to-end ────────────────────────────────────

test("COMPOSITION: TFA_PERSIST=pg + pool — idempotency survives server restart (no double-mint)", async () => {
  const pool = new InMemoryPool();
  const prevPersist = process.env.TFA_PERSIST;
  const prevEnvSkip = process.env.TFA_ENV_CHECK_SKIP;
  process.env.TFA_PERSIST = "pg";
  // TFA_ENV_CHECK_SKIP=1: this test uses InMemoryPool (not a real Postgres URL).
  // The env check would reject TFA_PERSIST=pg without DB_URL, but this test
  // is explicitly verifying idempotency behaviour — not env validation.
  process.env.TFA_ENV_CHECK_SKIP = "1";

  try {
    const H = (t: string, extra: Record<string, string> = {}) => ({ "content-type": "application/json", "x-tenant-id": t, ...extra });

    // Shared stack across both "server instances" — represents a deployment where the
    // ledger itself is also pg-backed (this test isolates the idempotency-persistence
    // behaviour added in v112; ledger persistence is a separate, already-existing J1 area).
    const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger(), pool });

    // Server instance 1.
    const server1 = startSovereignServer(0, stack, { requireIdempotencyKey: false, pool });
    const port1: number = (server1.address() as any).port;
    const base1 = `http://127.0.0.1:${port1}`;

    const accRes = await fetch(`${base1}/api/ledger/accounts`, {
      method: "POST", headers: H("pg-idem-t"),
      body: JSON.stringify({ ownerId: "u1", type: "asset", name: "Alice" }),
    });
    eq(accRes.status, 201);
    const { account } = await accRes.json();

    const idemKey = "restart-test-key-1";
    const mintRes1 = await fetch(`${base1}/api/ledger/mint`, {
      method: "POST", headers: H("pg-idem-t", { "idempotency-key": idemKey }),
      body: JSON.stringify({ toAccountId: account.id, amount: "5000", memo: "first" }),
    });
    eq(mintRes1.status, 200);
    const body1 = await mintRes1.json();
    assert(typeof body1.auditId === "string");

    // Give the async write-through a tick before "restarting".
    await new Promise((r) => setTimeout(r, 20));
    server1.close();

    // Server instance 2 — fresh idempotency-cache process state, SAME pool (simulates restart).
    const server2 = startSovereignServer(0, stack, { requireIdempotencyKey: false, pool });
    const port2: number = (server2.address() as any).port;
    const base2 = `http://127.0.0.1:${port2}`;

    const mintRes2 = await fetch(`${base2}/api/ledger/mint`, {
      method: "POST", headers: H("pg-idem-t", { "idempotency-key": idemKey }),
      body: JSON.stringify({ toAccountId: account.id, amount: "5000", memo: "retry-after-restart" }),
    });
    eq(mintRes2.status, 200);
    eq(mintRes2.headers.get("idempotency-replayed"), "true", "retry after restart must replay, not double-mint");
    const body2 = await mintRes2.json();
    eq(body2.auditId, body1.auditId, "replayed response must be identical to the original");

    // Verify the balance only reflects ONE mint of 5000, not two.
    const balRes = await fetch(`${base2}/api/ledger/accounts/${account.id}`, { headers: H("pg-idem-t") });
    const { account: acc2 } = await balRes.json();
    eq(acc2.balance, "5000", "balance must reflect a single mint despite the retry across restart");

    server2.close();
  } finally {
    if (prevPersist === undefined) delete process.env.TFA_PERSIST;
    else process.env.TFA_PERSIST = prevPersist;
    if (prevEnvSkip === undefined) delete process.env.TFA_ENV_CHECK_SKIP;
    else process.env.TFA_ENV_CHECK_SKIP = prevEnvSkip;
  }
});

test("COMPOSITION: without TFA_PERSIST=pg, behaviour unchanged (in-memory, idempotency does NOT survive restart)", async () => {
  const pool = new InMemoryPool();
  const prevPersist = process.env.TFA_PERSIST;
  delete process.env.TFA_PERSIST;

  try {
    const H = (t: string, extra: Record<string, string> = {}) => ({ "content-type": "application/json", "x-tenant-id": t, ...extra });
    const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger(), pool });

    const server1 = startSovereignServer(0, stack, { requireIdempotencyKey: false, pool });
    const port1: number = (server1.address() as any).port;
    const base1 = `http://127.0.0.1:${port1}`;

    const accRes = await fetch(`${base1}/api/ledger/accounts`, {
      method: "POST", headers: H("nopersist-t"),
      body: JSON.stringify({ ownerId: "u1", type: "asset", name: "Bob" }),
    });
    const { account } = await accRes.json();

    const idemKey = "no-persist-key-1";
    await fetch(`${base1}/api/ledger/mint`, {
      method: "POST", headers: H("nopersist-t", { "idempotency-key": idemKey }),
      body: JSON.stringify({ toAccountId: account.id, amount: "1000", memo: "first" }),
    });
    server1.close();

    // Fresh server (new in-memory idempotency map), same stack/ledger — same key is treated as NEW.
    const server2 = startSovereignServer(0, stack, { requireIdempotencyKey: false, pool });
    const port2: number = (server2.address() as any).port;
    const base2 = `http://127.0.0.1:${port2}`;

    const mintRes2 = await fetch(`${base2}/api/ledger/mint`, {
      method: "POST", headers: H("nopersist-t", { "idempotency-key": idemKey }),
      body: JSON.stringify({ toAccountId: account.id, amount: "1000", memo: "retry-after-restart" }),
    });
    eq(mintRes2.status, 200);
    assert(!mintRes2.headers.get("idempotency-replayed"), "without TFA_PERSIST=pg, retry after restart is NOT a replay (documented v111 behaviour)");

    // Balance now reflects TWO mints — this is the gap J1 exists to close for pg-backed deployments.
    const balRes = await fetch(`${base2}/api/ledger/accounts/${account.id}`, { headers: H("nopersist-t") });
    const { account: acc2 } = await balRes.json();
    eq(acc2.balance, "2000", "without persistence, restart loses idempotency dedup (expected v111 gap)");

    server2.close();
  } finally {
    if (prevPersist === undefined) delete process.env.TFA_PERSIST;
    else process.env.TFA_PERSIST = prevPersist;
  }
});
