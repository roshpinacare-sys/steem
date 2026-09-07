import "../_flush.mjs";
/**
 * tests/track-record/track-record-cache.test.ts — TrackRecordCache + invalidation on escrow state-change.
 *
 * Covers:
 *   • InMemoryTrackRecordCache get/set/invalidate/invalidateTenant
 *   • PgTrackRecordCache round-trip over InMemoryPool
 *   • getCachedOrCompute helper: miss → compute → hit
 *   • EscrowService invalidates involved identities on fund/release/refund/dispute/undispute
 *   • Tenant isolation: no leak across tenants
 *   • Edge cases: empty tenantId/identityId → null / no-op
 */
import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { EscrowService } from "../../lib/escrow/index.ts";
import {
  InMemoryTrackRecordCache,
  PgTrackRecordCache,
  getCachedOrCompute,
  type TrackRecordCache,
} from "../../lib/track-record/index.ts";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import type { TrackRecord } from "../../lib/track-record/index.ts";

function sampleRecord(tenantId: string, identityId: string): TrackRecord {
  return {
    tenantId,
    identityId,
    settledAsWorker: 1,
    settledAsFunder: 0,
    refunded: 0,
    denied: 0,
    settledVolume: "10000",
    score: 55,
    explanation: ["base 50", "+5 for 1 settled escrow(s)"],
    computedAt: new Date().toISOString(),
  };
}

async function settleOne(stack: any, t: string, funder: string, amount: bigint) {
  const payer = await stack.ledger.createAccount(t, funder, "asset", "P");
  const worker = await stack.ledger.createAccount(t, "worker-x", "asset", "W");
  await stack.ledger.mint(t, payer.id, amount * 2n, "seed", funder, false);
  const a = await stack.escrow.create({ tenantId: t, opportunityId: "o", payerAccountId: payer.id, workerAccountId: worker.id, amount });
  await stack.escrow.fund(t, a.id, funder);
  await stack.escrow.release(t, a.id, funder);
  return worker.id;
}

// ── InMemoryTrackRecordCache unit tests ──────────────────────────────────────

test("InMemoryTrackRecordCache: get returns null for missing entry", async () => {
  const cache = new InMemoryTrackRecordCache();
  const hit = await cache.get("t1", "alice");
  eq(hit, null);
});

test("InMemoryTrackRecordCache: set then get returns the record", async () => {
  const cache = new InMemoryTrackRecordCache();
  const r = sampleRecord("t1", "alice");
  await cache.set("t1", "alice", r);
  const hit = await cache.get("t1", "alice");
  eq(hit?.identityId, "alice");
  eq(hit?.score, 55);
});

test("InMemoryTrackRecordCache: invalidate drops one identity", async () => {
  const cache = new InMemoryTrackRecordCache();
  await cache.set("t1", "alice", sampleRecord("t1", "alice"));
  await cache.set("t1", "bob", sampleRecord("t1", "bob"));
  await cache.invalidate("t1", "alice");
  eq(await cache.get("t1", "alice"), null);
  eq((await cache.get("t1", "bob"))?.identityId, "bob");
});

test("InMemoryTrackRecordCache: invalidateTenant drops all for tenant", async () => {
  const cache = new InMemoryTrackRecordCache();
  await cache.set("t1", "alice", sampleRecord("t1", "alice"));
  await cache.set("t1", "bob", sampleRecord("t1", "bob"));
  await cache.set("t2", "carol", sampleRecord("t2", "carol"));
  await cache.invalidateTenant("t1");
  eq(await cache.get("t1", "alice"), null);
  eq(await cache.get("t1", "bob"), null);
  eq((await cache.get("t2", "carol"))?.identityId, "carol");
});

test("InMemoryTrackRecordCache: empty tenantId or identityId is safe", async () => {
  const cache = new InMemoryTrackRecordCache();
  eq(await cache.get("", "x"), null);
  eq(await cache.get("t", ""), null);
  // should not throw
  await cache.set("", "x", sampleRecord("", "x"));
  await cache.invalidate("", "x");
  await cache.invalidateTenant("");
  assert(true, "no throw on empty inputs");
});

// ── PgTrackRecordCache round-trip (InMemoryPool) ─────────────────────────────

test("PgTrackRecordCache: init + set + get + invalidate round-trip", async () => {
  const pool = new InMemoryPool();
  const cache = new PgTrackRecordCache(pool);
  await cache.init();
  const r = sampleRecord("pgt", "dave");
  await cache.set("pgt", "dave", r);
  const hit = await cache.get("pgt", "dave");
  eq(hit?.identityId, "dave");
  eq(hit?.score, 55);
  eq(JSON.stringify(hit?.explanation), JSON.stringify(r.explanation));
  await cache.invalidate("pgt", "dave");
  eq(await cache.get("pgt", "dave"), null);
});

test("PgTrackRecordCache: tenant isolation", async () => {
  const pool = new InMemoryPool();
  const cache = new PgTrackRecordCache(pool);
  await cache.init();
  await cache.set("tA", "u1", sampleRecord("tA", "u1"));
  eq(await cache.get("tB", "u1"), null);
  eq((await cache.get("tA", "u1"))?.identityId, "u1");
});

test("PgTrackRecordCache: invalidateTenant clears only that tenant", async () => {
  const pool = new InMemoryPool();
  const cache = new PgTrackRecordCache(pool);
  await cache.init();
  await cache.set("t1", "a", sampleRecord("t1", "a"));
  await cache.set("t2", "b", sampleRecord("t2", "b"));
  await cache.invalidateTenant("t1");
  eq(await cache.get("t1", "a"), null);
  eq((await cache.get("t2", "b"))?.identityId, "b");
});

// ── getCachedOrCompute helper ────────────────────────────────────────────────

test("getCachedOrCompute: miss computes and stores", async () => {
  const stack = buildSovereignStack();
  const cache = new InMemoryTrackRecordCache();
  const r = await getCachedOrCompute(
    cache, (stack as any).orchestrator.audit, (stack as any).escrowStore, "t-h1", "nobody",
  );
  eq(r.score, 50);
  const hit = await cache.get("t-h1", "nobody");
  eq(hit?.score, 50);
});

test("getCachedOrCompute: hit returns cached without recomputation", async () => {
  const stack = buildSovereignStack();
  const cache = new InMemoryTrackRecordCache();
  const fake: TrackRecord = {
    tenantId: "t-h2", identityId: "fake",
    settledAsWorker: 99, settledAsFunder: 0, refunded: 0, denied: 0,
    settledVolume: "0", score: 99, explanation: ["cached"], computedAt: new Date().toISOString(),
  };
  await cache.set("t-h2", "fake", fake);
  const r = await getCachedOrCompute(
    cache, (stack as any).orchestrator.audit, (stack as any).escrowStore, "t-h2", "fake",
  );
  eq(r.score, 99);
});

test("getCachedOrCompute: no cache still computes", async () => {
  const stack = buildSovereignStack();
  const r = await getCachedOrCompute(
    undefined, (stack as any).orchestrator.audit, (stack as any).escrowStore, "t-h3", "nobody",
  );
  eq(r.score, 50);
});

// ── EscrowService invalidation integration ───────────────────────────────────

test("escrow fund invalidates funder and worker track records", async () => {
  const stack = buildSovereignStack();
  const cache = new InMemoryTrackRecordCache();
  const t = "t-i1";
  const payer = await stack.ledger.createAccount(t, "alice", "asset", "P");
  const worker = await stack.ledger.createAccount(t, "bob", "asset", "W");
  await stack.ledger.mint(t, payer.id, 200_000n, "seed", "alice", false);

  // Pre-seed cache with stale records (worker key = account id, as track-record compares identityId to workerAccountId)
  await cache.set(t, "alice", { ...sampleRecord(t, "alice"), score: 99 });
  await cache.set(t, worker.id, { ...sampleRecord(t, worker.id), score: 99 });

  const escrow = new EscrowService(stack.ledger, stack.escrowStore, cache);
  const a = await escrow.create({ tenantId: t, opportunityId: "o", payerAccountId: payer.id, workerAccountId: worker.id, amount: 100_000n });
  await escrow.fund(t, a.id, "alice");

  eq(await cache.get(t, "alice"), null);
  eq(await cache.get(t, worker.id), null);
});

test("escrow release invalidates involved identities", async () => {
  const stack = buildSovereignStack();
  const cache = new InMemoryTrackRecordCache();
  const t = "t-i2";
  const payer = await stack.ledger.createAccount(t, "alice", "asset", "P");
  const worker = await stack.ledger.createAccount(t, "bob", "asset", "W");
  await stack.ledger.mint(t, payer.id, 200_000n, "seed", "alice", false);
  const escrow = new EscrowService(stack.ledger, stack.escrowStore, cache);
  const a = await escrow.create({ tenantId: t, opportunityId: "o", payerAccountId: payer.id, workerAccountId: worker.id, amount: 100_000n });
  await escrow.fund(t, a.id, "alice");

  await cache.set(t, "alice", { ...sampleRecord(t, "alice"), score: 99 });
  await cache.set(t, worker.id, { ...sampleRecord(t, worker.id), score: 99 });

  await escrow.release(t, a.id, "alice");
  eq(await cache.get(t, "alice"), null);
  eq(await cache.get(t, worker.id), null);
});

test("escrow refund invalidates involved identities", async () => {
  const stack = buildSovereignStack();
  const cache = new InMemoryTrackRecordCache();
  const t = "t-i3";
  const payer = await stack.ledger.createAccount(t, "alice", "asset", "P");
  const worker = await stack.ledger.createAccount(t, "bob", "asset", "W");
  await stack.ledger.mint(t, payer.id, 200_000n, "seed", "alice", false);
  const escrow = new EscrowService(stack.ledger, stack.escrowStore, cache);
  const a = await escrow.create({ tenantId: t, opportunityId: "o", payerAccountId: payer.id, workerAccountId: worker.id, amount: 100_000n });
  await escrow.fund(t, a.id, "alice");

  await cache.set(t, "alice", { ...sampleRecord(t, "alice"), score: 99 });
  await cache.set(t, worker.id, { ...sampleRecord(t, worker.id), score: 99 });

  await escrow.refund(t, a.id, "alice");
  eq(await cache.get(t, "alice"), null);
  eq(await cache.get(t, worker.id), null);
});

test("escrow dispute invalidates involved identities", async () => {
  const stack = buildSovereignStack();
  const cache = new InMemoryTrackRecordCache();
  const t = "t-i4";
  const payer = await stack.ledger.createAccount(t, "alice", "asset", "P");
  const worker = await stack.ledger.createAccount(t, "bob", "asset", "W");
  await stack.ledger.mint(t, payer.id, 200_000n, "seed", "alice", false);
  const escrow = new EscrowService(stack.ledger, stack.escrowStore, cache);
  const a = await escrow.create({ tenantId: t, opportunityId: "o", payerAccountId: payer.id, workerAccountId: worker.id, amount: 100_000n });
  await escrow.fund(t, a.id, "alice");

  await cache.set(t, "alice", { ...sampleRecord(t, "alice"), score: 99 });
  await cache.set(t, "bob", { ...sampleRecord(t, "bob"), score: 99 });

  await escrow.dispute(t, a.id, "bob", "work not delivered");
  eq(await cache.get(t, "alice"), null);
  eq(await cache.get(t, "bob"), null);
});

test("escrow undispute invalidates involved identities", async () => {
  const stack = buildSovereignStack();
  const cache = new InMemoryTrackRecordCache();
  const t = "t-i5";
  const payer = await stack.ledger.createAccount(t, "alice", "asset", "P");
  const worker = await stack.ledger.createAccount(t, "bob", "asset", "W");
  await stack.ledger.mint(t, payer.id, 200_000n, "seed", "alice", false);
  const escrow = new EscrowService(stack.ledger, stack.escrowStore, cache);
  const a = await escrow.create({ tenantId: t, opportunityId: "o", payerAccountId: payer.id, workerAccountId: worker.id, amount: 100_000n });
  await escrow.fund(t, a.id, "alice");
  await escrow.dispute(t, a.id, "bob", "concern");

  await cache.set(t, "alice", { ...sampleRecord(t, "alice"), score: 99 });
  await cache.set(t, worker.id, { ...sampleRecord(t, worker.id), score: 99 });

  await escrow.undispute(t, a.id, "alice");
  eq(await cache.get(t, "alice"), null);
  eq(await cache.get(t, worker.id), null);
});

test("escrow create does NOT invalidate cache", async () => {
  const stack = buildSovereignStack();
  const cache = new InMemoryTrackRecordCache();
  const t = "t-i6";
  const payer = await stack.ledger.createAccount(t, "alice", "asset", "P");
  const worker = await stack.ledger.createAccount(t, "bob", "asset", "W");
  await cache.set(t, "alice", { ...sampleRecord(t, "alice"), score: 99 });
  const escrow = new EscrowService(stack.ledger, stack.escrowStore, cache);
  await escrow.create({ tenantId: t, opportunityId: "o", payerAccountId: payer.id, workerAccountId: worker.id, amount: 100_000n });
  eq((await cache.get(t, "alice"))?.score, 99);
});

test("escrow without cache does not throw on state changes", async () => {
  const stack = buildSovereignStack();
  const t = "t-i7";
  const payer = await stack.ledger.createAccount(t, "alice", "asset", "P");
  const worker = await stack.ledger.createAccount(t, "bob", "asset", "W");
  await stack.ledger.mint(t, payer.id, 200_000n, "seed", "alice", false);
  const escrow = new EscrowService(stack.ledger, stack.escrowStore); // no cache
  const a = await escrow.create({ tenantId: t, opportunityId: "o", payerAccountId: payer.id, workerAccountId: worker.id, amount: 100_000n });
  await escrow.fund(t, a.id, "alice");
  await escrow.release(t, a.id, "alice");
  assert(true, "no cache = no throw");
});

// ── Composition root integration ─────────────────────────────────────────────

test("buildSovereignStack exposes trackRecordCache", async () => {
  const stack = buildSovereignStack();
  assert(stack.trackRecordCache !== undefined, "trackRecordCache exists on stack");
  await stack.trackRecordCache.set("tc", "u1", sampleRecord("tc", "u1"));
  const hit = await stack.trackRecordCache.get("tc", "u1");
  eq(hit?.identityId, "u1");
});

// ── Tenant isolation via escrow invalidation ─────────────────────────────────

test("escrow invalidation does not leak across tenants", async () => {
  const stack = buildSovereignStack();
  const cache = new InMemoryTrackRecordCache();
  const t1 = "tx1";
  const t2 = "tx2";
  const payer1 = await stack.ledger.createAccount(t1, "alice", "asset", "P");
  const worker1 = await stack.ledger.createAccount(t1, "bob", "asset", "W");
  await stack.ledger.mint(t1, payer1.id, 200_000n, "seed", "alice", false);

  const payer2 = await stack.ledger.createAccount(t2, "alice", "asset", "P");
  const worker2 = await stack.ledger.createAccount(t2, "bob", "asset", "W");
  await stack.ledger.mint(t2, payer2.id, 200_000n, "seed", "alice", false);

  const escrow = new EscrowService(stack.ledger, stack.escrowStore, cache);
  const a1 = await escrow.create({ tenantId: t1, opportunityId: "o", payerAccountId: payer1.id, workerAccountId: worker1.id, amount: 100_000n });
  const a2 = await escrow.create({ tenantId: t2, opportunityId: "o", payerAccountId: payer2.id, workerAccountId: worker2.id, amount: 100_000n });

  await cache.set(t1, "alice", sampleRecord(t1, "alice"));
  await cache.set(t2, "alice", sampleRecord(t2, "alice"));

  await escrow.fund(t1, a1.id, "alice");
  eq(await cache.get(t1, "alice"), null);
  eq((await cache.get(t2, "alice"))?.identityId, "alice");

  await escrow.fund(t2, a2.id, "alice");
  eq(await cache.get(t2, "alice"), null);
});
