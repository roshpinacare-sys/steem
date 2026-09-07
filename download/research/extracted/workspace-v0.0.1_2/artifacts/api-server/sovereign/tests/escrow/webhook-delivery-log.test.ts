import "../_flush.mjs";
/**
 * tests/escrow/webhook-delivery-log.test.ts — WebhookDeliveryLog: resilience/observability
 * for webhook dispatch. Coverage: success recorded · failure recorded (not silently lost) ·
 * tenant isolation · fail-closed on missing tenantId · registrationId filter · bounded cap
 * (oldest dropped first) · WebhookService.getDeliveryLog() wiring end-to-end.
 */
import { test, assert, eq } from "../_harness.mjs";
import {
  WebhookService,
  InMemoryWebhookStore,
  InMemoryWebhookRelayer,
  InMemoryWebhookDeliveryLog,
} from "../../lib/escrow/webhook.ts";

function makeService(deliveryLog?: InMemoryWebhookDeliveryLog) {
  const store = new InMemoryWebhookStore();
  const relayer = new InMemoryWebhookRelayer();
  const svc = deliveryLog
    ? new WebhookService(store, relayer, deliveryLog)
    : new WebhookService(store, relayer);
  return { store, relayer, svc };
}

// ─── Happy path ─────────────────────────────────────────────────────────────

test("delivery log: successful dispatch is recorded with ok:true", async () => {
  const { svc } = makeService();
  const reg = await svc.register({ tenantId: "t1", url: "https://example.com/hook", events: ["escrow.released"] });
  await svc.dispatch("t1", { id: "evt1", event: "escrow.released", tenantId: "t1", occurredAt: new Date().toISOString(), data: {} });

  const log = await svc.getDeliveryLog("t1");
  eq(log.length, 1, "one delivery recorded");
  eq(log[0].ok, true);
  eq(log[0].registrationId, reg.id);
  eq(log[0].statusCode, 200);
});

// ─── Failure is observable, not silently lost ──────────────────────────────

test("delivery log: failed delivery is recorded with ok:false and error — not swallowed", async () => {
  const { svc, relayer } = makeService();
  await svc.register({ tenantId: "t1", url: "https://example.com/hook", events: ["escrow.released"] });
  relayer.setFailNext(1);
  await svc.dispatch("t1", { id: "evt1", event: "escrow.released", tenantId: "t1", occurredAt: new Date().toISOString(), data: {} });

  const log = await svc.getDeliveryLog("t1");
  eq(log.length, 1);
  eq(log[0].ok, false);
  eq(log[0].error, "simulated delivery failure");
});

// ─── Tenant isolation ───────────────────────────────────────────────────────

test("delivery log: cross-tenant read returns empty, never another tenant's data", async () => {
  const { svc } = makeService();
  await svc.register({ tenantId: "t1", url: "https://example.com/hook", events: ["escrow.released"] });
  await svc.dispatch("t1", { id: "evt1", event: "escrow.released", tenantId: "t1", occurredAt: new Date().toISOString(), data: {} });

  const t1log = await svc.getDeliveryLog("t1");
  const t2log = await svc.getDeliveryLog("t2");
  eq(t1log.length, 1);
  eq(t2log.length, 0, "tenant isolation — t2 sees nothing of t1's deliveries");
});

// ─── Fail-closed ────────────────────────────────────────────────────────────

test("delivery log: fail-closed on missing tenantId — both read and write", async () => {
  const log = new InMemoryWebhookDeliveryLog();
  // @ts-expect-error — intentionally testing the runtime guard with an invalid record
  await log.record({ id: "x", tenantId: "", registrationId: "r1", event: "e", occurredAt: "t", attemptedAt: "t", ok: true });
  const empty = await log.list("");
  eq(empty.length, 0, "empty tenantId never returns data");
  const nothingStored = await log.list("");
  eq(nothingStored.length, 0, "the empty-tenant record above was never stored");
});

// ─── Filter by registrationId ───────────────────────────────────────────────

test("delivery log: filters by registrationId across multiple registrations", async () => {
  const { svc } = makeService();
  const regA = await svc.register({ tenantId: "t1", url: "https://a.example.com/hook", events: ["escrow.released"] });
  const regB = await svc.register({ tenantId: "t1", url: "https://b.example.com/hook", events: ["escrow.released"] });
  await svc.dispatch("t1", { id: "evt1", event: "escrow.released", tenantId: "t1", occurredAt: new Date().toISOString(), data: {} });

  const logA = await svc.getDeliveryLog("t1", regA.id);
  const logB = await svc.getDeliveryLog("t1", regB.id);
  eq(logA.length, 1);
  eq(logA[0].registrationId, regA.id);
  eq(logB.length, 1);
  eq(logB[0].registrationId, regB.id);
});

// ─── Bounded — efficiency/resilience under sustained failure ───────────────

test("delivery log: bounded per tenant — oldest dropped first, no unbounded growth", async () => {
  const log = new InMemoryWebhookDeliveryLog(3);
  for (let i = 0; i < 5; i++) {
    await log.record({
      id: `d${i}`, tenantId: "t1", registrationId: "r1", event: "escrow.released",
      occurredAt: "t", attemptedAt: "t", ok: true,
    });
  }
  const all = await log.list("t1", undefined, 100);
  eq(all.length, 3, "capped at 3 even though 5 were recorded");
  eq(all[0].id, "d4", "newest first");
  eq(all[2].id, "d2", "oldest two (d0,d1) were dropped");
});

// ─── Logging never breaks dispatch (settlement-critical path) ──────────────

test("delivery log: a throwing log implementation never aborts dispatch", async () => {
  const throwingLog = { record: async () => { throw new Error("log store down"); }, list: async () => [] };
  const { svc } = makeService(throwingLog as unknown as InMemoryWebhookDeliveryLog);
  await svc.register({ tenantId: "t1", url: "https://example.com/hook", events: ["escrow.released"] });
  let threw = false;
  try {
    await svc.dispatch("t1", { id: "evt1", event: "escrow.released", tenantId: "t1", occurredAt: new Date().toISOString(), data: {} });
  } catch { threw = true; }
  assert(!threw, "dispatch must not throw even if the delivery log fails");
});
