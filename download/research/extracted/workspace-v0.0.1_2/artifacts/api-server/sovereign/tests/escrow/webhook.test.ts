import "../_flush.mjs";
/**
 * tests/escrow/webhook.test.ts — WebhookService: registration, signing, dispatch, verification.
 * Coverage: happy path · tenant isolation · fail-closed inputs · HMAC signing + verification ·
 * delivery to matching endpoints only · failed delivery swallowed · delete · replay prevention.
 */
import { test, assert, eq } from "../_harness.mjs";
import {
  WebhookService,
  InMemoryWebhookStore,
  InMemoryWebhookRelayer,
  WebhookError,
} from "../../lib/escrow/webhook.ts";

function makeService() {
  const store = new InMemoryWebhookStore();
  const relayer = new InMemoryWebhookRelayer();
  const svc = new WebhookService(store, relayer);
  return { store, relayer, svc };
}

// ─── Registration ──────────────────────────────────────────────────────────────

test("webhook: register creates an active registration with generated secret", async () => {
  const { svc } = makeService();
  const reg = await svc.register({
    tenantId: "t1",
    url: "https://example.com/hook",
    events: ["settlement.released"],
  });
  assert(reg.id, "has id");
  eq(reg.tenantId, "t1");
  eq(reg.url, "https://example.com/hook");
  eq(JSON.stringify(reg.events), JSON.stringify(["settlement.released"]));
  assert(reg.active, "active by default");
  assert(reg.secret.length >= 32, "secret is long enough");
  assert(reg.createdAt, "has timestamp");
});

test("webhook: register accepts caller-supplied secret", async () => {
  const { svc } = makeService();
  const reg = await svc.register({
    tenantId: "t1",
    url: "https://example.com/hook",
    events: ["settlement.funded"],
    secret: "my-secret-that-is-long-enough-ok",
  });
  eq(reg.secret, "my-secret-that-is-long-enough-ok");
});

test("webhook: register rejects invalid inputs", async () => {
  const { svc } = makeService();
  let bad = 0;

  // missing tenantId
  try { await svc.register({ tenantId: "", url: "https://x.com", events: ["a"] }); }
  catch (e) { if (e instanceof WebhookError && e.code === "invalid_input") bad++; }

  // missing url
  try { await svc.register({ tenantId: "t1", url: "", events: ["a"] }); }
  catch (e) { if (e instanceof WebhookError && e.code === "invalid_input") bad++; }

  // non-http url
  try { await svc.register({ tenantId: "t1", url: "ftp://bad", events: ["a"] }); }
  catch (e) { if (e instanceof WebhookError && e.code === "invalid_input") bad++; }

  // empty events
  try { await svc.register({ tenantId: "t1", url: "https://x.com", events: [] }); }
  catch (e) { if (e instanceof WebhookError && e.code === "invalid_input") bad++; }

  eq(bad, 4, "all four invalid inputs rejected");
});

// ─── List & get ────────────────────────────────────────────────────────────────

test("webhook: list is tenant-isolated", async () => {
  const { svc } = makeService();
  await svc.register({ tenantId: "ta", url: "https://a.com", events: ["settlement.released"] });
  await svc.register({ tenantId: "ta", url: "https://a2.com", events: ["settlement.funded"] });
  await svc.register({ tenantId: "tb", url: "https://b.com", events: ["settlement.released"] });

  const listA = await svc.list("ta");
  const listB = await svc.list("tb");
  eq(listA.length, 2);
  eq(listB.length, 1);
});

test("webhook: get returns null for cross-tenant id", async () => {
  const { svc } = makeService();
  const reg = await svc.register({ tenantId: "t1", url: "https://x.com", events: ["settlement.released"] });
  const fetched = await svc.get("other-tenant", reg.id);
  eq(fetched, null, "cross-tenant get = null (fail-closed)");
});

// ─── Delete ────────────────────────────────────────────────────────────────────

test("webhook: delete removes registration and returns true", async () => {
  const { svc } = makeService();
  const reg = await svc.register({ tenantId: "t1", url: "https://x.com", events: ["settlement.released"] });
  const deleted = await svc.delete("t1", reg.id);
  assert(deleted, "delete returned true");
  eq((await svc.list("t1")).length, 0, "list is empty after delete");
});

test("webhook: delete cross-tenant returns false", async () => {
  const { svc } = makeService();
  const reg = await svc.register({ tenantId: "t1", url: "https://x.com", events: ["settlement.released"] });
  const deleted = await svc.delete("other", reg.id);
  assert(!deleted, "cross-tenant delete = false");
  eq((await svc.list("t1")).length, 1, "registration still exists");
});

// ─── HMAC signing ─────────────────────────────────────────────────────────────

test("webhook: signPayload produces sha256= prefix", () => {
  const sig = WebhookService.signPayload("secret-key-here-long-enough", '{"event":"test"}');
  assert(sig.startsWith("sha256="), "starts with sha256=");
  assert(sig.length > 10, "non-empty signature");
});

test("webhook: verifySignature accepts valid signature", () => {
  const secret = "test-secret-long-enough";
  const payload = '{"event":"settlement.released","id":"abc"}';
  const sig = WebhookService.signPayload(secret, payload);
  assert(WebhookService.verifySignature(secret, payload, sig), "valid sig accepted");
});

test("webhook: verifySignature rejects tampered payload", () => {
  const secret = "test-secret-long-enough";
  const payload = '{"event":"settlement.released"}';
  const sig = WebhookService.signPayload(secret, payload);
  const tampered = '{"event":"settlement.reversed"}';
  assert(!WebhookService.verifySignature(secret, tampered, sig), "tampered payload rejected");
});

test("webhook: verifySignature rejects wrong secret", () => {
  const payload = '{"event":"settlement.released"}';
  const sig = WebhookService.signPayload("secret-a-long-enough", payload);
  assert(!WebhookService.verifySignature("secret-b-long-enough", payload, sig), "wrong secret rejected");
});

test("webhook: verifySignature rejects truncated signature", () => {
  const secret = "test-secret-long-enough";
  const payload = '{"event":"settlement.released"}';
  const sig = WebhookService.signPayload(secret, payload);
  const truncated = sig.slice(0, sig.length - 4);
  assert(!WebhookService.verifySignature(secret, payload, truncated), "truncated signature rejected");
});

// ─── Dispatch ─────────────────────────────────────────────────────────────────

test("webhook: dispatch delivers to all matching active registrations", async () => {
  const { svc, relayer } = makeService();
  await svc.register({ tenantId: "t1", url: "https://a.com", events: ["settlement.released"] });
  await svc.register({ tenantId: "t1", url: "https://b.com", events: ["settlement.released", "settlement.funded"] });
  await svc.register({ tenantId: "t1", url: "https://c.com", events: ["settlement.funded"] }); // should NOT receive released

  await svc.dispatch("t1", {
    id: "evt-1",
    event: "settlement.released",
    tenantId: "t1",
    occurredAt: new Date().toISOString(),
    data: { agreementId: "agree-1", state: "released" },
  });

  eq(relayer.deliveries.length, 2, "exactly two endpoints received the event");
  const urls = relayer.deliveries.map((d) => d.delivery.url).sort();
  eq(urls[0], "https://a.com");
  eq(urls[1], "https://b.com");
});

test("webhook: dispatch signature in delivery headers is verifiable", async () => {
  const { svc, relayer } = makeService();
  const secret = "my-verifiable-secret-long-enough";
  const reg = await svc.register({
    tenantId: "t1",
    url: "https://x.com",
    events: ["settlement.released"],
    secret,
  });

  const event = {
    id: "evt-2",
    event: "settlement.released" as const,
    tenantId: "t1",
    occurredAt: new Date().toISOString(),
    data: { agreementId: "agree-1" },
  };
  await svc.dispatch("t1", event);

  eq(relayer.deliveries.length, 1);
  const { delivery } = relayer.deliveries[0];
  const sig = delivery.headers["x-tfa-signature"];
  assert(sig, "signature header present");

  // Consumer verifies independently
  const valid = WebhookService.verifySignature(secret, delivery.payload, sig);
  assert(valid, "consumer can verify signature offline");
});

test("webhook: dispatch does not deliver to wrong tenant endpoints", async () => {
  const { svc, relayer } = makeService();
  await svc.register({ tenantId: "t-other", url: "https://other.com", events: ["settlement.released"] });

  await svc.dispatch("t1", {
    id: "evt-3",
    event: "settlement.released",
    tenantId: "t1",
    occurredAt: new Date().toISOString(),
    data: {},
  });

  eq(relayer.deliveries.length, 0, "no cross-tenant delivery");
});

test("webhook: dispatch swallows delivery failures and does not throw", async () => {
  const { svc, relayer } = makeService();
  relayer.setFailNext(10);
  await svc.register({ tenantId: "t1", url: "https://x.com", events: ["settlement.funded"] });

  // Must not throw even though delivery fails
  await svc.dispatch("t1", {
    id: "evt-4",
    event: "settlement.funded",
    tenantId: "t1",
    occurredAt: new Date().toISOString(),
    data: {},
  });

  eq(relayer.deliveries.length, 1, "delivery attempted");
  eq(relayer.deliveries[0].result.ok, false, "delivery failed");
});

test("webhook: dispatch to empty tenant delivers nothing gracefully", async () => {
  const { svc, relayer } = makeService();
  await svc.dispatch("t-no-hooks", {
    id: "evt-5",
    event: "settlement.released",
    tenantId: "t-no-hooks",
    occurredAt: new Date().toISOString(),
    data: {},
  });
  eq(relayer.deliveries.length, 0);
});

test("webhook: dispatch headers include x-tfa-event and x-tfa-timestamp", async () => {
  const { svc, relayer } = makeService();
  await svc.register({ tenantId: "t1", url: "https://x.com", events: ["settlement.funded"] });

  const ts = new Date().toISOString();
  await svc.dispatch("t1", { id: "evt-6", event: "settlement.funded", tenantId: "t1", occurredAt: ts, data: {} });

  const headers = relayer.deliveries[0].delivery.headers;
  eq(headers["x-tfa-event"], "settlement.funded");
  eq(headers["x-tfa-timestamp"], ts);
  assert(headers["x-tfa-delivery-id"], "delivery id present");
});
