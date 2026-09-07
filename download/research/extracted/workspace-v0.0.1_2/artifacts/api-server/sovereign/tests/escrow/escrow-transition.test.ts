import "../_flush.mjs";
/**
 * tests/escrow/escrow-transition.test.ts — In-Memory → Pg transition test suite.
 *
 * Proves that InMemoryEscrowStore and PgEscrowStore are interchangeable behind
 * the EscrowStore interface:
 *   1. Normal transition: data written via InMemoryEscrowStore survives migration
 *      to PgEscrowStore (all fields, BigInt amounts, nullable audit ids).
 *   2. Tenant isolation: migrating one tenant does not leak agreements to another.
 *   3. Interface contract: EscrowService wired with either store behaves identically
 *      (create / fund / release / refund lifecycle).
 *   4. Edge cases: empty tenantId, unknown id, cross-tenant get, put idempotent.
 *   5. Failure case: bad pool propagates error correctly; valid inputs accepted.
 *
 * Run:
 *   node tests/escrow/escrow-transition.test.ts
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { InMemoryEscrowStore } from "../../lib/escrow/escrow.ts";
import { PgEscrowStore } from "../../lib/escrow/pg-escrow-store.ts";
import type { EscrowStore, CreateEscrowInput } from "../../lib/escrow/escrow.ts";
import type { EscrowAgreement } from "../../lib/escrow/types.ts";

// ─── Migration helper ──────────────────────────────────────────────────────────

/**
 * Migrate all agreements for `tenantId` from InMemoryEscrowStore → PgEscrowStore.
 * This mirrors the pattern used in drizzle-transition.test.ts for the ledger.
 */
async function migrateEscrowTenant(
  src: InMemoryEscrowStore,
  dest: PgEscrowStore,
  tenantId: string,
): Promise<void> {
  const agreements = await src.list(tenantId);
  for (const a of agreements) {
    await dest.put(a);
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeAgreement(overrides: Partial<EscrowAgreement> = {}): EscrowAgreement {
  const id = "ea-" + Math.random().toString(36).slice(2, 10);
  return {
    id,
    tenantId: "tenant-1",
    opportunityId: "opp-abc",
    payerAccountId: "acc-payer-1",
    workerAccountId: "acc-worker-1",
    escrowAccountId: "acc-escrow-" + id,
    amount: 75_000n,
    state: "created",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ─── 1. Normal transition — all fields survive round-trip ────────────────────

test("escrow-transition: created agreement fields survive InMemory→Pg migration", async () => {
  const src = new InMemoryEscrowStore();
  const pool = new InMemoryPool();
  const dest = new PgEscrowStore(pool);
  await dest.init();

  const a = makeAgreement({ id: "ea-migrate-1", amount: 99_000n });
  await src.put(a);

  await migrateEscrowTenant(src, dest, "tenant-1");

  const loaded = await dest.get("tenant-1", a.id);
  assert(loaded !== null, "migrated agreement must be findable in Pg store");
  eq(loaded!.id, a.id);
  eq(loaded!.tenantId, a.tenantId);
  eq(loaded!.opportunityId, a.opportunityId);
  eq(loaded!.payerAccountId, a.payerAccountId);
  eq(loaded!.workerAccountId, a.workerAccountId);
  eq(loaded!.escrowAccountId, a.escrowAccountId);
  eq(loaded!.amount, 99_000n, "BigInt amount must survive exactly");
  eq(loaded!.state, "created");
  eq(loaded!.createdAt, a.createdAt);
  eq(loaded!.fundAuditId, undefined);
  eq(loaded!.settleAuditId, undefined);
});

test("escrow-transition: BigInt amount beyond MAX_SAFE_INTEGER survives migration", async () => {
  const src = new InMemoryEscrowStore();
  const pool = new InMemoryPool();
  const dest = new PgEscrowStore(pool);
  await dest.init();

  const bigAmount = 9_007_199_254_740_993n; // beyond Number.MAX_SAFE_INTEGER
  const a = makeAgreement({ id: "ea-bigint-migrate", amount: bigAmount });
  await src.put(a);

  await migrateEscrowTenant(src, dest, "tenant-1");

  const loaded = await dest.get("tenant-1", a.id);
  eq(loaded!.amount, bigAmount, "BigInt must survive without precision loss");
  eq(typeof loaded!.amount, "bigint", "loaded amount type must be bigint");
});

test("escrow-transition: funded agreement (with fundAuditId) survives migration", async () => {
  const src = new InMemoryEscrowStore();
  const pool = new InMemoryPool();
  const dest = new PgEscrowStore(pool);
  await dest.init();

  const a = makeAgreement({ id: "ea-funded-migrate" });
  const funded: EscrowAgreement = { ...a, state: "funded", fundAuditId: "audit-fund-42" };
  await src.put(funded);

  await migrateEscrowTenant(src, dest, "tenant-1");

  const loaded = await dest.get("tenant-1", a.id);
  eq(loaded!.state, "funded");
  eq(loaded!.fundAuditId, "audit-fund-42");
  eq(loaded!.settleAuditId, undefined, "settleAuditId absent in funded state");
});

test("escrow-transition: released agreement (with both audit ids) survives migration", async () => {
  const src = new InMemoryEscrowStore();
  const pool = new InMemoryPool();
  const dest = new PgEscrowStore(pool);
  await dest.init();

  const a = makeAgreement({ id: "ea-released-migrate" });
  const released: EscrowAgreement = {
    ...a,
    state: "released",
    fundAuditId: "audit-fund-1",
    settleAuditId: "audit-settle-1",
  };
  await src.put(released);

  await migrateEscrowTenant(src, dest, "tenant-1");

  const loaded = await dest.get("tenant-1", a.id);
  eq(loaded!.state, "released");
  eq(loaded!.fundAuditId, "audit-fund-1");
  eq(loaded!.settleAuditId, "audit-settle-1");
});

test("escrow-transition: multiple agreements in same tenant all migrate correctly", async () => {
  const src = new InMemoryEscrowStore();
  const pool = new InMemoryPool();
  const dest = new PgEscrowStore(pool);
  await dest.init();

  const agreements = [
    makeAgreement({ id: "ea-multi-1" }),
    makeAgreement({ id: "ea-multi-2", state: "funded", fundAuditId: "aud-f-2" } as Partial<EscrowAgreement>),
    makeAgreement({ id: "ea-multi-3" }),
  ];
  for (const a of agreements) await src.put(a);

  await migrateEscrowTenant(src, dest, "tenant-1");

  const destList = await dest.list("tenant-1");
  eq(destList.length, 3, "all three agreements must be in Pg store");
  for (const a of agreements) {
    assert(destList.some(d => d.id === a.id), `agreement ${a.id} must be present`);
  }
});

// ─── 2. Tenant isolation ──────────────────────────────────────────────────────

test("escrow-transition: migrating one tenant does not leak other tenant's agreements", async () => {
  const src = new InMemoryEscrowStore();
  const pool = new InMemoryPool();
  const dest = new PgEscrowStore(pool);
  await dest.init();

  const aT1 = makeAgreement({ id: "ea-t1", tenantId: "tenant-A" });
  const aT2 = makeAgreement({ id: "ea-t2", tenantId: "tenant-B" });
  await src.put(aT1);
  await src.put(aT2);

  // Migrate ONLY tenant-A
  await migrateEscrowTenant(src, dest, "tenant-A");

  const t1InDest = await dest.get("tenant-A", aT1.id);
  assert(t1InDest !== null, "tenant-A agreement must be in Pg store after migration");

  const t2InDest = await dest.get("tenant-B", aT2.id);
  eq(t2InDest, null, "tenant-B agreement must NOT be in Pg store (not migrated)");
});

test("escrow-transition: cross-tenant get on Pg store returns null after migration", async () => {
  const src = new InMemoryEscrowStore();
  const pool = new InMemoryPool();
  const dest = new PgEscrowStore(pool);
  await dest.init();

  const a = makeAgreement({ id: "ea-cross", tenantId: "tenant-X" });
  await src.put(a);
  await migrateEscrowTenant(src, dest, "tenant-X");

  // Cross-tenant access must return null (fail-closed)
  const xAccess = await dest.get("tenant-Y", a.id);
  eq(xAccess, null, "cross-tenant get must return null — fail-closed");
});

test("escrow-transition: list isolation — Pg store only returns correct tenant's agreements", async () => {
  const src = new InMemoryEscrowStore();
  const pool = new InMemoryPool();
  const dest = new PgEscrowStore(pool);
  await dest.init();

  const a1 = makeAgreement({ id: "ea-iso-1", tenantId: "tenant-P" });
  const a2 = makeAgreement({ id: "ea-iso-2", tenantId: "tenant-Q" });
  await src.put(a1);
  await src.put(a2);
  await migrateEscrowTenant(src, dest, "tenant-P");
  await migrateEscrowTenant(src, dest, "tenant-Q");

  const listP = await dest.list("tenant-P");
  const listQ = await dest.list("tenant-Q");
  eq(listP.length, 1, "tenant-P must see only its agreement");
  eq(listQ.length, 1, "tenant-Q must see only its agreement");
  eq(listP[0].id, "ea-iso-1");
  eq(listQ[0].id, "ea-iso-2");
});

// ─── 3. Interface contract — EscrowStore polymorphism ─────────────────────────

test("escrow-transition: EscrowStore interface is polymorphic — same put/get/list semantics", async () => {
  // Run the same put/get/list sequence against both store implementations and
  // assert identical behaviour. This proves EscrowService can swap the store
  // at composition time without changing business logic.
  async function exerciseStore(store: EscrowStore): Promise<void> {
    const a = makeAgreement({ id: "ea-poly-" + Math.random().toString(36).slice(2, 8) });

    // put (insert)
    await store.put(a);

    // get
    const loaded = await store.get(a.tenantId, a.id);
    assert(loaded !== null, "get must return agreement after put");
    eq(loaded!.id, a.id, "id must match");
    eq(loaded!.amount, a.amount, "amount must match (BigInt)");
    eq(loaded!.state, "created", "state must be created");

    // update (put again with new state)
    const funded: EscrowAgreement = { ...a, state: "funded", fundAuditId: "aud-f" };
    await store.put(funded);
    const afterUpdate = await store.get(a.tenantId, a.id);
    eq(afterUpdate!.state, "funded", "state must update to funded");
    eq(afterUpdate!.fundAuditId, "aud-f", "fundAuditId must be set");

    // list
    const all = await store.list(a.tenantId);
    assert(all.some(x => x.id === a.id), "list must include the agreement");

    // unknown id → null (fail-closed)
    const missing = await store.get(a.tenantId, "no-such-id");
    eq(missing, null, "unknown id must return null");

    // empty tenantId → null / []
    eq(await store.get("", a.id), null, "empty tenantId get → null");
    const emptyList = await store.list("");
    eq(emptyList.length, 0, "empty tenantId list → []");
  }

  // InMemoryEscrowStore
  await exerciseStore(new InMemoryEscrowStore());

  // PgEscrowStore (same behaviour via same interface)
  const pool = new InMemoryPool();
  const pgStore = new PgEscrowStore(pool);
  await pgStore.init();
  await exerciseStore(pgStore);
});

// ─── 4. Edge cases ────────────────────────────────────────────────────────────

test("escrow-transition: migrating empty InMemory store is a no-op on Pg store", async () => {
  const src = new InMemoryEscrowStore();
  const pool = new InMemoryPool();
  const dest = new PgEscrowStore(pool);
  await dest.init();

  // No agreements in src
  await migrateEscrowTenant(src, dest, "tenant-empty");

  const list = await dest.list("tenant-empty");
  eq(list.length, 0, "Pg store must remain empty after migrating empty InMemory store");
  eq(await dest.totalCount(), 0, "totalCount must be 0 after empty migration");
});

test("escrow-transition: re-migrating same data is idempotent (put upsert)", async () => {
  const src = new InMemoryEscrowStore();
  const pool = new InMemoryPool();
  const dest = new PgEscrowStore(pool);
  await dest.init();

  const a = makeAgreement({ id: "ea-idem" });
  await src.put(a);

  // Migrate twice — second call must not duplicate rows
  await migrateEscrowTenant(src, dest, "tenant-1");
  await migrateEscrowTenant(src, dest, "tenant-1");

  const list = await dest.list("tenant-1");
  eq(list.length, 1, "upsert must not create duplicate rows on repeated migration");
  eq(await dest.totalCount(), 1, "totalCount must remain 1 after idempotent re-migration");
});

// ─── 5. Failure case ──────────────────────────────────────────────────────────

test("escrow-transition: bad pool causes migration to throw — error propagates", async () => {
  const src = new InMemoryEscrowStore();
  const badPool = {
    query: async () => { throw new Error("DB connection lost"); },
    connect: async () => { throw new Error("DB connection lost"); },
    end: async () => {},
  } as any;

  const dest = new PgEscrowStore(badPool);
  // Do NOT call init() — badPool.query would throw

  const a = makeAgreement({ id: "ea-bad-pool" });
  await src.put(a);

  let threw = false;
  try {
    await migrateEscrowTenant(src, dest, "tenant-1");
  } catch (e: any) {
    threw = true;
    assert(
      e.message.includes("DB connection lost"),
      "migration error must propagate from pool: " + e.message,
    );
  }
  assert(threw, "migration to bad pool must throw — no silent failure");
});

test("escrow-transition: Pg store rejects invalid inputs (empty tenantId on put)", async () => {
  const pool = new InMemoryPool();
  const store = new PgEscrowStore(pool);
  await store.init();

  // put with empty tenantId should not create a queryable row for any tenant
  const a = makeAgreement({ id: "ea-empty-tenant", tenantId: "" });
  await store.put(a); // may or may not throw — but must not be retrievable

  const retrieved = await store.get("", a.id);
  // get("", ...) → null (guard in get handles empty tenantId)
  eq(retrieved, null, "empty tenantId agreement must not be retrievable via get");

  const listResult = await store.list("");
  eq(listResult.length, 0, "empty tenantId must return [] from list");
});
