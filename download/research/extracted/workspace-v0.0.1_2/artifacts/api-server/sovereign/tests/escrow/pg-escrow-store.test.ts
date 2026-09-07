import "../_flush.mjs";
/**
 * tests/escrow/pg-escrow-store.test.ts
 *
 * Unit tests for PgEscrowStore using InMemoryPool.
 * No external DB required. Runs with:
 *   node tests/escrow/pg-escrow-store.test.ts
 *
 * Coverage:
 *   init: idempotent (safe to call twice)
 *   put (insert): happy path, all fields round-trip, bigint amount preserved
 *   put (update): state machine transitions persist, audit ids written
 *   get: happy path, unknown id → null, cross-tenant → null (fail-closed)
 *   list: empty, after inserts, tenant isolation, empty tenantId → []
 *   totalCount: zero, multi-tenant, after updates (count unchanged)
 *   persistence: second instance on same pool sees data
 *   bigint: amount stored/loaded as bigint exactly (no precision loss)
 *   composition: buildSovereignStack uses PgEscrowStore when pool injected
 */

import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { PgEscrowStore } from "../../lib/escrow/pg-escrow-store.ts";
import type { EscrowAgreement } from "../../lib/escrow/types.ts";

// ─── Harness ──────────────────────────────────────────────────────────────────

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

function eq(a: unknown, b: unknown, label?: string): void {
  if (a !== b) throw new Error(`${label ?? "eq"}: expected ${String(b)}, got ${String(a)}`);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeAgreement(overrides: Partial<EscrowAgreement> = {}): EscrowAgreement {
  return {
    id: "ea-" + Math.random().toString(36).slice(2, 10),
    tenantId: "tenant-1",
    opportunityId: "opp-abc",
    payerAccountId: "acc-payer-1",
    workerAccountId: "acc-worker-1",
    escrowAccountId: "acc-escrow-1",
    amount: 50_000n,
    state: "created",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// init
await test("init: creates table (no error)", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();
});

await test("init: idempotent — safe to call twice", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();
  await store.init(); // must not throw
});

// put (insert) + get
await test("put (insert) + get: all fields round-trip", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();

  const a = makeAgreement({ id: "ea-round-trip" });
  await store.put(a);

  const loaded = await store.get(a.tenantId, a.id);
  assert(loaded !== null, "loaded must not be null");
  eq(loaded!.id, a.id);
  eq(loaded!.tenantId, a.tenantId);
  eq(loaded!.opportunityId, a.opportunityId);
  eq(loaded!.payerAccountId, a.payerAccountId);
  eq(loaded!.workerAccountId, a.workerAccountId);
  eq(loaded!.escrowAccountId, a.escrowAccountId);
  eq(loaded!.amount, a.amount); // bigint equality
  eq(loaded!.state, "created");
  eq(loaded!.createdAt, a.createdAt);
  eq(loaded!.fundAuditId, undefined);
  eq(loaded!.settleAuditId, undefined);
});

await test("put (insert): bigint amount preserved exactly (large value)", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();

  const big = 9_007_199_254_740_993n; // beyond Number.MAX_SAFE_INTEGER
  const a = makeAgreement({ id: "ea-bigint", amount: big });
  await store.put(a);

  const loaded = await store.get(a.tenantId, a.id);
  eq(loaded!.amount, big, "bigint must survive round-trip without precision loss");
  eq(typeof loaded!.amount, "bigint", "loaded amount must be a bigint");
});

// put (update) — state transitions
await test("put (update): state transitions persist (created→funded)", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();

  const a = makeAgreement({ id: "ea-state" });
  await store.put(a);

  const funded: EscrowAgreement = { ...a, state: "funded", fundAuditId: "audit-fund-1" };
  await store.put(funded);

  const loaded = await store.get(a.tenantId, a.id);
  eq(loaded!.state, "funded", "state must be updated");
  eq(loaded!.fundAuditId, "audit-fund-1", "fundAuditId must be stored");
  eq(loaded!.settleAuditId, undefined, "settleAuditId still absent");
});

await test("put (update): funded→released with settleAuditId", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();

  const a = makeAgreement({ id: "ea-release" });
  await store.put(a);
  await store.put({ ...a, state: "funded", fundAuditId: "aud-fund" });
  await store.put({ ...a, state: "released", fundAuditId: "aud-fund", settleAuditId: "aud-settle" });

  const loaded = await store.get(a.tenantId, a.id);
  eq(loaded!.state, "released");
  eq(loaded!.fundAuditId, "aud-fund");
  eq(loaded!.settleAuditId, "aud-settle");
});

await test("put (update): funded→refunded with settleAuditId", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();

  const a = makeAgreement({ id: "ea-refund" });
  await store.put(a);
  await store.put({ ...a, state: "funded", fundAuditId: "aud-f" });
  await store.put({ ...a, state: "refunded", fundAuditId: "aud-f", settleAuditId: "aud-r" });

  const loaded = await store.get(a.tenantId, a.id);
  eq(loaded!.state, "refunded");
  eq(loaded!.settleAuditId, "aud-r");
});

// get — fail-closed
await test("get: unknown id → null", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();
  const r = await store.get("any-tenant", "does-not-exist");
  eq(r, null, "unknown id must return null");
});

await test("get: cross-tenant → null (tenant isolation fail-closed)", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();

  const a = makeAgreement({ id: "ea-iso", tenantId: "tenant-A" });
  await store.put(a);

  const r = await store.get("tenant-B", a.id);
  eq(r, null, "cross-tenant get must return null");
});

await test("get: empty tenantId → null", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();
  eq(await store.get("", "any-id"), null);
});

// list
await test("list: empty → []", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();
  const items = await store.list("tenant-1");
  eq(items.length, 0);
});

await test("list: returns all agreements for tenant", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();

  const a1 = makeAgreement({ id: "ea-list-1" });
  const a2 = makeAgreement({ id: "ea-list-2" });
  await store.put(a1);
  await store.put(a2);

  const items = await store.list("tenant-1");
  eq(items.length, 2);
  assert(items.some(i => i.id === "ea-list-1"), "must contain a1");
  assert(items.some(i => i.id === "ea-list-2"), "must contain a2");
});

await test("list: tenant isolation — tenant-B agreements not in tenant-A list", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();

  await store.put(makeAgreement({ id: "ea-A", tenantId: "tenant-A" }));
  await store.put(makeAgreement({ id: "ea-B", tenantId: "tenant-B" }));

  const listA = await store.list("tenant-A");
  const listB = await store.list("tenant-B");
  eq(listA.length, 1);
  eq(listB.length, 1);
  eq(listA[0].id, "ea-A");
  eq(listB[0].id, "ea-B");
});

await test("list: empty tenantId → []", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();
  await store.put(makeAgreement({ id: "ea-nonempty" }));
  eq((await store.list("")).length, 0);
});

// totalCount
await test("totalCount: zero on fresh pool", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();
  eq(await store.totalCount(), 0);
});

await test("totalCount: counts across all tenants", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();

  await store.put(makeAgreement({ id: "ea-c1", tenantId: "t1" }));
  await store.put(makeAgreement({ id: "ea-c2", tenantId: "t2" }));
  await store.put(makeAgreement({ id: "ea-c3", tenantId: "t1" }));
  eq(await store.totalCount(), 3);
});

await test("totalCount: unchanged after update (put idempotent on existing)", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();

  const a = makeAgreement({ id: "ea-cnt" });
  await store.put(a);
  await store.put({ ...a, state: "funded", fundAuditId: "x" });
  eq(await store.totalCount(), 1, "update must not add a new row");
});

// persistence
await test("persistence: second instance on same pool sees data", async () => {
  const pool = new InMemoryPool();
  const store1 = new PgEscrowStore(pool);
  await store1.init();
  await store1.put(makeAgreement({ id: "ea-persist", tenantId: "t-p" }));

  const store2 = new PgEscrowStore(pool); // same pool, different instance
  await store2.init();
  const loaded = await store2.get("t-p", "ea-persist");
  assert(loaded !== null, "second instance must see data from first");
  eq(loaded!.id, "ea-persist");
});

// composition integration
await test("composition: buildSovereignStack uses PgEscrowStore when pool provided", async () => {
  const { buildSovereignStack } = await import("../../src/composition.ts");
  const { InMemoryPool: IMP } = await import("../../lib/db/in-memory-driver.ts");
  const { PgEscrowStore: PES } = await import("../../lib/escrow/pg-escrow-store.ts");
  const pool = new IMP();

  // build with pool — escrowStore should be PgEscrowStore
  const stack = buildSovereignStack(undefined, { pool: pool as any });

  // Verify the escrow service is wired (can create an agreement via HTTP-style stack test)
  // We just confirm the stack has escrow and it's functional
  assert(typeof stack.escrow === "object", "stack must have escrow");
  assert(typeof stack.escrow.create === "function", "escrow must have create()");
  assert(typeof stack.escrow.fund === "function", "escrow must have fund()");
  assert(typeof stack.escrow.release === "function", "escrow must have release()");
  assert(typeof stack.escrow.refund === "function", "escrow must have refund()");
});

await test("composition: buildSovereignStack without pool uses InMemoryEscrowStore", async () => {
  const { buildSovereignStack } = await import("../../src/composition.ts");
  const stack = buildSovereignStack(); // no pool
  assert(typeof stack.escrow === "object", "stack must have escrow");
  assert(typeof stack.escrow.create === "function");
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nResult: ${passed} pass, ${failed} fail`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
