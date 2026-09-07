import "../_flush.mjs";
/**
 * tests/escrow/pg-webhook-delivery-log.test.ts — PgWebhookDeliveryLog: durable
 * webhook delivery log (closes MANIFEST v318 "next missing" #1 — the delivery
 * log no longer reverts to in-memory-only under TFA_PERSIST=pg).
 *
 * Coverage: init idempotent · record+list round-trip · newest-first ordering
 * survives identical attemptedAt timestamps (seq-based, not time-based) ·
 * tenant isolation · fail-closed on missing tenantId (write + read) ·
 * registrationId filter · bounded cap (oldest dropped first, persists across
 * a second eviction) · persistence across a second instance on the same pool ·
 * WebhookService wiring end-to-end with a real DbPool-backed log.
 */
import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { PgWebhookDeliveryLog } from "../../lib/escrow/pg-webhook-delivery-log.ts";
import {
  WebhookService,
  InMemoryWebhookStore,
  InMemoryWebhookRelayer,
} from "../../lib/escrow/webhook.ts";
import type { WebhookDeliveryRecord } from "../../lib/escrow/webhook.ts";

function rec(overrides: Partial<WebhookDeliveryRecord> = {}): WebhookDeliveryRecord {
  return {
    id: "d-" + Math.random().toString(36).slice(2, 8),
    tenantId: "t1",
    registrationId: "r1",
    event: "escrow.released",
    occurredAt: "2025-01-01T00:00:00.000Z",
    attemptedAt: "2025-01-01T00:00:00.000Z", // identical on purpose — tests seq ordering, not time
    ok: true,
    ...overrides,
  };
}

// ─── init ─────────────────────────────────────────────────────────────────

test("PgWebhookDeliveryLog: init creates table (no error)", async () => {
  const log = new PgWebhookDeliveryLog(new InMemoryPool());
  await log.init();
});

test("PgWebhookDeliveryLog: init idempotent — safe to call twice", async () => {
  const log = new PgWebhookDeliveryLog(new InMemoryPool());
  await log.init();
  await log.init();
});

// ─── record + list round-trip ───────────────────────────────────────────────

test("PgWebhookDeliveryLog: success record round-trips with statusCode", async () => {
  const log = new PgWebhookDeliveryLog(new InMemoryPool());
  await log.init();
  await log.record(rec({ id: "d1", ok: true, statusCode: 200 }));

  const list = await log.list("t1");
  eq(list.length, 1);
  eq(list[0].id, "d1");
  eq(list[0].ok, true);
  eq(list[0].statusCode, 200);
  eq(list[0].error, undefined);
});

test("PgWebhookDeliveryLog: failure record round-trips with error, not silently lost", async () => {
  const log = new PgWebhookDeliveryLog(new InMemoryPool());
  await log.init();
  await log.record(rec({ id: "d1", ok: false, statusCode: undefined, error: "relayer gave up after retries" }));

  const list = await log.list("t1");
  eq(list.length, 1);
  eq(list[0].ok, false);
  eq(list[0].error, "relayer gave up after retries");
  eq(list[0].statusCode, undefined);
});

// ─── ordering — seq-based, not time-based ───────────────────────────────────

test("PgWebhookDeliveryLog: newest-first ordering survives identical attemptedAt (seq tiebreak)", async () => {
  const log = new PgWebhookDeliveryLog(new InMemoryPool());
  await log.init();
  for (let i = 0; i < 4; i++) {
    await log.record(rec({ id: `d${i}` })); // same attemptedAt for all four
  }
  const list = await log.list("t1");
  eq(list.length, 4);
  eq(list[0].id, "d3", "most recently inserted must be first despite tied timestamps");
  eq(list[3].id, "d0", "first inserted must be last");
});

// ─── tenant isolation ────────────────────────────────────────────────────────

test("PgWebhookDeliveryLog: cross-tenant read returns empty, never another tenant's data", async () => {
  const log = new PgWebhookDeliveryLog(new InMemoryPool());
  await log.init();
  await log.record(rec({ id: "d1", tenantId: "t1" }));

  eq((await log.list("t1")).length, 1);
  eq((await log.list("t2")).length, 0, "tenant isolation — t2 sees nothing of t1's deliveries");
});

// ─── fail-closed ─────────────────────────────────────────────────────────────

test("PgWebhookDeliveryLog: fail-closed on missing tenantId — both write and read", async () => {
  const log = new PgWebhookDeliveryLog(new InMemoryPool());
  await log.init();
  await log.record(rec({ tenantId: "" })); // must be a no-op, never stored
  eq((await log.list("")).length, 0, "empty tenantId never returns data");
  eq((await log.list("t1")).length, 0, "the empty-tenant record above was never stored anywhere");
});

// ─── registrationId filter ───────────────────────────────────────────────────

test("PgWebhookDeliveryLog: filters by registrationId across multiple registrations", async () => {
  const log = new PgWebhookDeliveryLog(new InMemoryPool());
  await log.init();
  await log.record(rec({ id: "dA", registrationId: "regA" }));
  await log.record(rec({ id: "dB", registrationId: "regB" }));

  const logA = await log.list("t1", "regA");
  const logB = await log.list("t1", "regB");
  eq(logA.length, 1);
  eq(logA[0].registrationId, "regA");
  eq(logB.length, 1);
  eq(logB[0].registrationId, "regB");
});

// ─── bounded cap — resilience under sustained failure ───────────────────────

test("PgWebhookDeliveryLog: bounded per tenant — oldest dropped first, no unbounded growth", async () => {
  const log = new PgWebhookDeliveryLog(new InMemoryPool(), 3);
  await log.init();
  for (let i = 0; i < 5; i++) {
    await log.record(rec({ id: `d${i}` }));
  }
  const all = await log.list("t1", undefined, 100);
  eq(all.length, 3, "capped at 3 even though 5 were recorded");
  eq(all[0].id, "d4", "newest first");
  eq(all[2].id, "d2", "oldest two (d0,d1) were dropped");
});

test("PgWebhookDeliveryLog: cap holds across repeated eviction cycles (table never grows past cap+1 between writes)", async () => {
  const log = new PgWebhookDeliveryLog(new InMemoryPool(), 2);
  await log.init();
  for (let i = 0; i < 10; i++) {
    await log.record(rec({ id: `d${i}` }));
  }
  const all = await log.list("t1", undefined, 100);
  eq(all.length, 2, "still capped at 2 after 10 writes");
  eq(all[0].id, "d9");
  eq(all[1].id, "d8");
});

test("PgWebhookDeliveryLog: cap is per-tenant — one tenant's volume never evicts another's", async () => {
  const log = new PgWebhookDeliveryLog(new InMemoryPool(), 2);
  await log.init();
  for (let i = 0; i < 5; i++) await log.record(rec({ id: `a${i}`, tenantId: "tenant-A" }));
  await log.record(rec({ id: "b0", tenantId: "tenant-B" }));

  eq((await log.list("tenant-A")).length, 2, "tenant-A capped at 2");
  eq((await log.list("tenant-B")).length, 1, "tenant-B unaffected by tenant-A's volume");
});

// ─── persistence ──────────────────────────────────────────────────────────────

test("PgWebhookDeliveryLog: persistence — second instance on same pool sees data", async () => {
  const pool = new InMemoryPool();
  const log1 = new PgWebhookDeliveryLog(pool);
  await log1.init();
  await log1.record(rec({ id: "d-persist", tenantId: "t-p" }));

  const log2 = new PgWebhookDeliveryLog(pool); // same pool, different instance (simulates restart)
  await log2.init();
  const list = await log2.list("t-p");
  eq(list.length, 1, "second instance must see data written by the first");
  eq(list[0].id, "d-persist");
});

test("PgWebhookDeliveryLog: persistence — seq continues correctly for a fresh instance (no duplicate/overwritten seq)", async () => {
  const pool = new InMemoryPool();
  const log1 = new PgWebhookDeliveryLog(pool);
  await log1.init();
  await log1.record(rec({ id: "d0", tenantId: "t-seq" }));
  await log1.record(rec({ id: "d1", tenantId: "t-seq" }));

  const log2 = new PgWebhookDeliveryLog(pool); // fresh instance, e.g. after restart
  await log2.init();
  await log2.record(rec({ id: "d2", tenantId: "t-seq" }));

  const list = await log2.list("t-seq", undefined, 100);
  eq(list.length, 3, "all three records present, none overwritten by seq collision");
  eq(list[0].id, "d2", "newest record from the fresh instance is still ordered last-in-first-out");
});

// ─── WebhookService end-to-end wiring ────────────────────────────────────────

test("PgWebhookDeliveryLog: wired into WebhookService.dispatch + getDeliveryLog end-to-end", async () => {
  const store = new InMemoryWebhookStore();
  const relayer = new InMemoryWebhookRelayer();
  const log = new PgWebhookDeliveryLog(new InMemoryPool());
  await log.init();
  const svc = new WebhookService(store, relayer, log);

  const reg = await svc.register({ tenantId: "t1", url: "https://example.com/hook", events: ["escrow.released"] });
  await svc.dispatch("t1", { id: "evt1", event: "escrow.released", tenantId: "t1", occurredAt: new Date().toISOString(), data: {} });

  const list = await svc.getDeliveryLog("t1");
  eq(list.length, 1);
  eq(list[0].ok, true);
  eq(list[0].registrationId, reg.id);
});

test("PgWebhookDeliveryLog: a failed delivery dispatched through WebhookService is recorded, not silently lost", async () => {
  const store = new InMemoryWebhookStore();
  const relayer = new InMemoryWebhookRelayer();
  relayer.setFailNext(1);
  const log = new PgWebhookDeliveryLog(new InMemoryPool());
  await log.init();
  const svc = new WebhookService(store, relayer, log);

  await svc.register({ tenantId: "t1", url: "https://example.com/hook", events: ["escrow.released"] });
  await svc.dispatch("t1", { id: "evt1", event: "escrow.released", tenantId: "t1", occurredAt: new Date().toISOString(), data: {} });

  const list = await svc.getDeliveryLog("t1");
  eq(list.length, 1);
  eq(list[0].ok, false);
  eq(list[0].error, "simulated delivery failure");
});
