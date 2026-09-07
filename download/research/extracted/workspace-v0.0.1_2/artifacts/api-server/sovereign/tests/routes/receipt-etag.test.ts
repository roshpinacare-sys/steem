import "../_flush.mjs";
/**
 * tests/routes/receipt-etag.test.ts — v166.
 * Conditional GET (ETag/Last-Modified/304) for GET /api/execution/:id/receipt.
 * Cheap receipt polling for agents/CI — the receipt is the product artifact.
 *
 *   FEATURE       200 returns ETag + Last-Modified + cache-control headers.
 *   CONDITIONAL   a matching If-None-Match → 304 with no body, same ETag.
 *   EDGE          a stale/absent If-None-Match → 200 with the receipt body.
 *   FAIL-CLOSED   missing tenant → 400; unknown id → 404 (no headers leaked).
 */
import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { adapterRoutes } from "../../src/routes/adapter-routes.ts";

const signer = new HmacSigner("receipt-etag-test-secret");

function setup() {
  const store = new InMemoryExecutionStore();
  const routes = adapterRoutes(signer, store);
  const receiptRoute = routes.find((r) => r.method === "GET" && r.pattern === "/api/execution/:id/receipt")!;
  return { store, receiptRoute };
}

const get = (route: any, id: string, tenantId: string, headers?: Record<string, string>) =>
  route.handler({ tenantId, body: {}, params: { id }, headers });

test("200 response carries ETag, Last-Modified and cache-control", async () => {
  const { store, receiptRoute } = setup();
  const wf = store.create({ tenantId: "t1", actionId: "act-1" });
  const r = await get(receiptRoute, wf.id, "t1");
  eq(r.status, 200);
  assert(r.headers, "headers present");
  assert(/^"[0-9a-f]{32}"$/.test(r.headers.etag), `etag is a quoted 32-hex string: ${r.headers.etag}`);
  assert(typeof r.headers["last-modified"] === "string" && r.headers["last-modified"].length > 0, "last-modified present");
  eq(r.headers["cache-control"], "no-cache");
  assert(r.body?.ok === true && r.body?.receipt, "body has the receipt");
});

test("matching If-None-Match returns 304 with no body and the same ETag", async () => {
  const { store, receiptRoute } = setup();
  const wf = store.create({ tenantId: "t1", actionId: "act-2" });
  const first = await get(receiptRoute, wf.id, "t1");
  const etag = first.headers.etag;
  const second = await get(receiptRoute, wf.id, "t1", { "if-none-match": etag });
  eq(second.status, 304, "unchanged workflow → 304");
  eq(second.body, undefined, "304 carries no body");
  eq(second.headers.etag, etag, "ETag echoed on 304");
});

test("ETag rotates when the workflow state changes (stale If-None-Match → 200)", async () => {
  const { store, receiptRoute } = setup();
  const wf = store.create({ tenantId: "t1", actionId: "act-3" });
  const before = await get(receiptRoute, wf.id, "t1");
  // Advance the workflow: planned → approved (changes status + updatedAt).
  store.transition(wf.id, "t1", "approved", "approver");
  const after = await get(receiptRoute, wf.id, "t1", { "if-none-match": before.headers.etag });
  eq(after.status, 200, "changed workflow → fresh 200, not 304");
  assert(after.headers.etag !== before.headers.etag, "ETag rotated on state change");
});

test("fail-closed: missing tenant → 400, unknown id → 404", async () => {
  const { store, receiptRoute } = setup();
  const noTenant = await get(receiptRoute, "anything", "");
  eq(noTenant.status, 400);
  const unknown = await get(receiptRoute, "no-such-id", "t1");
  eq(unknown.status, 404);
  assert(!unknown.headers, "no caching headers leaked on 404");
});
