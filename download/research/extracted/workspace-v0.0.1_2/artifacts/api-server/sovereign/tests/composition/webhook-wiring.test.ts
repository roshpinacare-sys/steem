import "../_flush.mjs";
/**
 * tests/composition/webhook-wiring.test.ts — Webhook wiring in buildSovereignStack.
 *
 * Verifies that:
 *   • Without a pool: InMemoryWebhookStore + InMemoryWebhookRelayer (dev/test mode)
 *   • With a pool:    PgWebhookStore + HttpWebhookRelayer (production mode)
 *   • persistenceReport reflects actual store type ("in-memory" vs "pg")
 *   • WebhookService is functional in both modes (register + dispatch)
 *   • PgWebhookStore init() is called and the table is usable immediately
 *   • tenant isolation held through the stack (register on t1, list empty for t2)
 *
 * Uses InMemoryPool to exercise the Pg code path without a real Postgres.
 */
import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { InMemoryWebhookRelayer, InMemoryWebhookStore, InMemoryWebhookDeliveryLog } from "../../lib/escrow/webhook.ts";
import { PgWebhookStore } from "../../lib/escrow/pg-webhook-store.ts";
import { PgWebhookDeliveryLog } from "../../lib/escrow/pg-webhook-delivery-log.ts";
import { HttpWebhookRelayer } from "../../lib/escrow/http-webhook-relayer.ts";

// ─── Mode: no pool (dev/test) ─────────────────────────────────────────────────

test("webhook-wiring: without pool uses InMemoryWebhookStore + InMemoryWebhookRelayer", () => {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  // webhookRelayer is exposed on the stack
  assert(stack.webhookRelayer instanceof InMemoryWebhookRelayer, "relayer is InMemoryWebhookRelayer");
  // persistenceReport must say in-memory
  eq(stack.persistenceReport.webhooks, "in-memory");
});

test("webhook-wiring: without pool — persistenceReport.webhooks is 'in-memory'", () => {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  eq(stack.persistenceReport.webhooks, "in-memory");
});

// ─── Mode: with pool (production / TFA_PERSIST=pg) ───────────────────────────

test("webhook-wiring: with pool uses HttpWebhookRelayer", () => {
  const pool = new InMemoryPool();
  const stack = buildSovereignStack(undefined, { pool, provider: new InMemoryLedger() });
  assert(stack.webhookRelayer instanceof HttpWebhookRelayer, "relayer is HttpWebhookRelayer");
});

test("webhook-wiring: with pool — persistenceReport.webhooks is 'pg'", () => {
  const pool = new InMemoryPool();
  const stack = buildSovereignStack(undefined, { pool, provider: new InMemoryLedger() });
  eq(stack.persistenceReport.webhooks, "pg");
});

// ─── Functional: register + list via WebhookService (no-pool mode) ────────────

test("webhook-wiring: no-pool — webhookService.register + list works", async () => {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const reg = await stack.webhookService.register({
    tenantId: "t1",
    url: "https://example.com/hook",
    events: ["settlement.released"],
  });
  assert(reg.id, "registration has id");
  eq(reg.tenantId, "t1");
  const list = await stack.webhookService.list("t1");
  eq(list.length, 1);
  eq(list[0].id, reg.id);
});

test("webhook-wiring: no-pool — dispatch does not throw (InMemoryRelayer captures delivery)", async () => {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  await stack.webhookService.register({
    tenantId: "t1",
    url: "https://example.com/hook",
    events: ["settlement.released"],
  });
  // dispatch must not throw even if relayer records it
  await stack.webhookService.dispatch("t1", {
    id: "evt-1",
    event: "settlement.released",
    tenantId: "t1",
    occurredAt: new Date().toISOString(),
    data: { test: true },
  });
  // InMemoryWebhookRelayer records deliveries
  const relayer = stack.webhookRelayer as InMemoryWebhookRelayer;
  eq(relayer.deliveries.length, 1);
  eq(relayer.deliveries[0].delivery.event, "settlement.released");
});

// ─── Functional: register + list via WebhookService (pool mode) ──────────────

test("webhook-wiring: with-pool — webhookService.register + list works (PgWebhookStore)", async () => {
  const pool = new InMemoryPool();
  const stack = buildSovereignStack(undefined, { pool, provider: new InMemoryLedger() });
  // Give init() time to complete (it's async fire-and-forget on the stack; pool is sync-ready)
  // InMemoryPool is synchronous in execution, so this works immediately
  const reg = await stack.webhookService.register({
    tenantId: "t2",
    url: "https://production.example.com/hook",
    events: ["settlement.funded", "settlement.released"],
  });
  assert(reg.id, "registration has id");
  eq(reg.tenantId, "t2");
  const list = await stack.webhookService.list("t2");
  eq(list.length, 1);
  eq(list[0].url, "https://production.example.com/hook");
});

test("webhook-wiring: with-pool — tenant isolation: t1 regs not visible to t2", async () => {
  const pool = new InMemoryPool();
  const stack = buildSovereignStack(undefined, { pool, provider: new InMemoryLedger() });
  await stack.webhookService.register({
    tenantId: "t1",
    url: "https://t1.example.com/hook",
    events: ["settlement.released"],
  });
  const t2List = await stack.webhookService.list("t2");
  eq(t2List.length, 0);
});

test("webhook-wiring: with-pool — dispatch is best-effort (HttpWebhookRelayer returns ok:false, no throw)", async () => {
  const pool = new InMemoryPool();
  // Use a fast HttpWebhookRelayer (short timeout, no retries) so the unreachable
  // RFC5737 host fails in < 1s instead of the default ~30s — keeps the audit
  // harness from marking this suite as cannotRun under p95×3 adaptive timeout.
  const fastRelayer = new HttpWebhookRelayer({
    maxRetries: 1,
    requestTimeoutMs: 250,
    baseDelayMs: 10,
    maxDelayMs: 50,
    jitterFraction: 0,
  });
  const stack = buildSovereignStack(undefined, {
    pool,
    provider: new InMemoryLedger(),
    webhookRelayer: fastRelayer,
  });
  // Sanity: the override is wired through.
  if (!(stack.webhookRelayer instanceof HttpWebhookRelayer)) {
    throw new Error("expected HttpWebhookRelayer override to be wired");
  }
  await stack.webhookService.register({
    tenantId: "t3",
    url: "http://192.0.2.1/hook", // RFC5737 TEST-NET — unreachable
    events: ["settlement.reversed"],
  });
  // dispatch is best-effort — must NOT throw even though HttpWebhookRelayer will fail
  let threw = false;
  try {
    await stack.webhookService.dispatch("t3", {
      id: "evt-fail",
      event: "settlement.reversed",
      tenantId: "t3",
      occurredAt: new Date().toISOString(),
      data: {},
    });
  } catch { threw = true; }
  eq(threw, false); // errors are swallowed in dispatch()
});

// ─── persistenceReport — full picture with pool ───────────────────────────────

test("webhook-wiring: persistenceReport has expected keys with pool", () => {
  const pool = new InMemoryPool();
  const stack = buildSovereignStack(undefined, { pool, provider: new InMemoryLedger() });
  const r = stack.persistenceReport;
  assert("webhooks" in r, "has webhooks key");
  assert("ledger" in r, "has ledger key");
  assert("escrow" in r, "has escrow key");
  assert("settlement" in r, "has settlement key");
  assert("readModel" in r, "has readModel key");
});

// ─── Delivery-log durability (MANIFEST v318 "next missing" #1) ────────────────

test("webhook-wiring: without pool — delivery log defaults to in-memory", () => {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  eq(stack.persistenceReport.webhookDeliveryLog, "in-memory");
});

test("webhook-wiring: with pool — delivery log persistenceReport is 'pg'", () => {
  const pool = new InMemoryPool();
  const stack = buildSovereignStack(undefined, { pool, provider: new InMemoryLedger() });
  eq(stack.persistenceReport.webhookDeliveryLog, "pg");
});

test("webhook-wiring: with pool — dispatch outcomes survive a stack rebuild on the same pool (restart simulation)", async () => {
  const pool = new InMemoryPool();
  const stack1 = buildSovereignStack(undefined, { pool, provider: new InMemoryLedger() });
  const reg = await stack1.webhookService.register({
    tenantId: "t-restart",
    url: "https://example.com/hook",
    events: ["settlement.released"],
  });
  await stack1.webhookService.dispatch("t-restart", {
    id: "evt-restart",
    event: "settlement.released",
    tenantId: "t-restart",
    occurredAt: new Date().toISOString(),
    data: {},
  });
  eq((await stack1.webhookService.getDeliveryLog("t-restart")).length, 1, "delivery recorded before rebuild");

  // Rebuild the stack on the SAME pool — simulates a process restart. Before this
  // fix, the delivery log defaulted to InMemoryWebhookDeliveryLog every time, so a
  // rebuild lost all recorded outcomes even though the pool (and PgWebhookStore
  // registrations) survived.
  const stack2 = buildSovereignStack(undefined, { pool, provider: new InMemoryLedger() });
  const log = await stack2.webhookService.getDeliveryLog("t-restart");
  eq(log.length, 1, "delivery outcome must survive a stack rebuild on the same pool");
  eq(log[0].registrationId, reg.id);
});
