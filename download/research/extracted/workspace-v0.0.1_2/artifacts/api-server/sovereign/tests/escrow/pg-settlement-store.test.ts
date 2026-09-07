import "../_flush.mjs";
/**
 * tests/escrow/pg-settlement-store.test.ts — PgSettlementStore with InMemoryPool.
 * Coverage: put/get/list · upsert (update mutable fields) · tenant isolation ·
 * BigInt round-trip · releaseAuditIds JSON · thresholdAmount storage ·
 * all settlement states · totalCount.
 */
import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { PgSettlementStore } from "../../lib/escrow/pg-settlement-store.ts";
import type { SettlementAgreement } from "../../lib/escrow/settlement.ts";

async function makeStore() {
  const pool = new InMemoryPool();
  const store = new PgSettlementStore(pool);
  await store.init();
  return store;
}

function makeAgreement(overrides: Partial<SettlementAgreement> = {}): SettlementAgreement {
  return {
    id: "settle-1",
    tenantId: "tenant-a",
    opportunityId: "opp-1",
    payerAccountId: "payer-acct",
    workerAccountId: "worker-acct",
    escrowAccountId: "escrow-acct",
    totalAmount: 500_000n,
    releasedAmount: 0n,
    state: "created",
    createdAt: new Date().toISOString(),
    settledBy: "authority-1",
    ...overrides,
  };
}

// ─── Basic put/get ─────────────────────────────────────────────────────────────

test("pg-settlement-store: put and get round-trip", async () => {
  const store = await makeStore();
  const a = makeAgreement();
  await store.put(a);

  const fetched = await store.get("tenant-a", "settle-1");
  assert(fetched, "fetched is not null");
  eq(fetched!.id, "settle-1");
  eq(fetched!.tenantId, "tenant-a");
  eq(fetched!.totalAmount, 500_000n);
  eq(fetched!.releasedAmount, 0n);
  eq(fetched!.state, "created");
  eq(fetched!.settledBy, "authority-1");
});

test("pg-settlement-store: get returns null for unknown id", async () => {
  const store = await makeStore();
  const result = await store.get("tenant-a", "nonexistent");
  eq(result, null);
});

test("pg-settlement-store: get is tenant-isolated (cross-tenant = null)", async () => {
  const store = await makeStore();
  await store.put(makeAgreement({ id: "s1", tenantId: "t-a" }));
  const cross = await store.get("t-b", "s1");
  eq(cross, null, "cross-tenant get returns null");
});

// ─── BigInt round-trip ─────────────────────────────────────────────────────────

test("pg-settlement-store: BigInt amounts survive serialization round-trip", async () => {
  const store = await makeStore();
  const a = makeAgreement({
    totalAmount: 9_007_199_254_740_993n, // > Number.MAX_SAFE_INTEGER
    releasedAmount: 1_000_000_000_000n,
  });
  await store.put(a);
  const fetched = await store.get("tenant-a", "settle-1");
  eq(fetched!.totalAmount, 9_007_199_254_740_993n);
  eq(fetched!.releasedAmount, 1_000_000_000_000n);
});

// ─── Update (upsert mutable fields) ───────────────────────────────────────────

test("pg-settlement-store: put updates mutable fields on second call", async () => {
  const store = await makeStore();
  const a = makeAgreement();
  await store.put(a);

  const updated: SettlementAgreement = {
    ...a,
    state: "held",
    fundAuditId: "audit-fund-1",
    releasedAmount: 0n,
  };
  await store.put(updated);

  const fetched = await store.get("tenant-a", "settle-1");
  eq(fetched!.state, "held");
  eq(fetched!.fundAuditId, "audit-fund-1");
});

test("pg-settlement-store: put updates releaseAuditIds across multiple partial releases", async () => {
  const store = await makeStore();
  const a = makeAgreement({ state: "held" });
  await store.put(a);

  const r1: SettlementAgreement = { ...a, state: "partially_released", releasedAmount: 100_000n, releaseAuditIds: ["audit-1"] };
  await store.put(r1);
  eq(JSON.stringify((await store.get("tenant-a", "settle-1"))!.releaseAuditIds), JSON.stringify(["audit-1"]));

  const r2: SettlementAgreement = { ...r1, releasedAmount: 200_000n, releaseAuditIds: ["audit-1", "audit-2"] };
  await store.put(r2);
  const fetched2 = await store.get("tenant-a", "settle-1");
  eq(fetched2!.releasedAmount, 200_000n);
  eq(JSON.stringify(fetched2!.releaseAuditIds), JSON.stringify(["audit-1", "audit-2"]));
});

// ─── All states ───────────────────────────────────────────────────────────────

test("pg-settlement-store: all settlement states stored and retrieved", async () => {
  const store = await makeStore();
  const states: SettlementAgreement["state"][] = [
    "created", "held", "partially_released", "released", "disputed", "reversed",
  ];
  for (let i = 0; i < states.length; i++) {
    const a = makeAgreement({ id: `s-${i}`, state: states[i] });
    await store.put(a);
    const f = await store.get("tenant-a", `s-${i}`);
    eq(f!.state, states[i]);
  }
});

// ─── Nullable fields ──────────────────────────────────────────────────────────

test("pg-settlement-store: nullable fields round-trip correctly", async () => {
  const store = await makeStore();
  const a = makeAgreement({
    state: "disputed",
    disputedBy: "worker-actor",
    disputeReason: "deliverable incomplete",
    fundAuditId: "fund-42",
  });
  await store.put(a);
  const f = await store.get("tenant-a", "settle-1");
  eq(f!.disputedBy, "worker-actor");
  eq(f!.disputeReason, "deliverable incomplete");
  eq(f!.fundAuditId, "fund-42");
  eq(f!.reversalAuditId, undefined);
});

test("pg-settlement-store: reversalAuditId stored after reverse", async () => {
  const store = await makeStore();
  const a = makeAgreement({ state: "reversed", reversalAuditId: "rev-audit-99" });
  await store.put(a);
  const f = await store.get("tenant-a", "settle-1");
  eq(f!.reversalAuditId, "rev-audit-99");
  eq(f!.state, "reversed");
});

// ─── thresholdAmount ──────────────────────────────────────────────────────────

test("pg-settlement-store: thresholdAmount stored and retrieved as BigInt", async () => {
  const store = await makeStore();
  const a: SettlementAgreement & { thresholdAmount?: bigint } = {
    ...makeAgreement(),
    thresholdAmount: 250_000n,
  };
  await store.put(a as SettlementAgreement);
  const f = await store.get("tenant-a", "settle-1") as any;
  eq(f.thresholdAmount, 250_000n);
});

test("pg-settlement-store: thresholdAmount absent when not set", async () => {
  const store = await makeStore();
  const a = makeAgreement(); // no thresholdAmount
  await store.put(a);
  const f = await store.get("tenant-a", "settle-1") as any;
  eq(f.thresholdAmount, undefined);
});

// ─── List ─────────────────────────────────────────────────────────────────────

test("pg-settlement-store: list returns all agreements for tenant", async () => {
  const store = await makeStore();
  await store.put(makeAgreement({ id: "s1", tenantId: "t-x" }));
  await store.put(makeAgreement({ id: "s2", tenantId: "t-x" }));
  await store.put(makeAgreement({ id: "s3", tenantId: "t-y" }));

  const listX = await store.list("t-x");
  const listY = await store.list("t-y");
  eq(listX.length, 2);
  eq(listY.length, 1);
  eq(listX.map((a) => a.id).sort().join(","), "s1,s2");
});

test("pg-settlement-store: list returns empty array for unknown tenant", async () => {
  const store = await makeStore();
  const list = await store.list("no-such-tenant");
  eq(list.length, 0);
});

// ─── totalCount ───────────────────────────────────────────────────────────────

test("pg-settlement-store: totalCount counts across all tenants", async () => {
  const store = await makeStore();
  eq(await store.totalCount(), 0);
  await store.put(makeAgreement({ id: "s1", tenantId: "t-a" }));
  await store.put(makeAgreement({ id: "s2", tenantId: "t-b" }));
  eq(await store.totalCount(), 2);
});

// ─── get with empty params (fail-closed) ──────────────────────────────────────

test("pg-settlement-store: get with empty tenantId or id returns null", async () => {
  const store = await makeStore();
  await store.put(makeAgreement());
  eq(await store.get("", "settle-1"), null);
  eq(await store.get("tenant-a", ""), null);
});
