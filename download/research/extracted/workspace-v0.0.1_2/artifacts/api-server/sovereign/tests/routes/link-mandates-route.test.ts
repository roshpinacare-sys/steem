import "../_flush.mjs";
/**
 * tests/routes/link-mandates-route.test.ts — v252.
 *
 * POST /api/receipt/:id/link-mandates — HTTP wiring for AP2 mandate linkage.
 *
 * HAPPY PATH    allowed workflow → 201 + linkage + vc with linkage embedded
 *               running / approved workflows are also linkable
 * VALIDATION    missing mandates → 400; empty array → 400
 *               bad mandate type → 400; empty mandate id → 400
 * FAIL-CLOSED   missing tenantId → 400; missing id param → 400
 *               unknown workflow / cross-tenant → 404
 *               non-linkable status (planned, failed, denied) → 422
 * VC QUALITY    vc.linkage matches the linkage object returned
 *               linkage.receiptSignature is a non-empty string
 *               linkage.mandates in canonical order (intent → cart → payment)
 *               verifyMandateLinkage(linkage, signer) → valid
 *               validateVCSchema(vc) → valid
 */

import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { adapterRoutes } from "../../src/routes/adapter-routes.ts";
import { verifyMandateLinkage } from "../../lib/adapter/ap2-mandate-link.ts";
import type { Ctx } from "../../src/routes/adapter-routes.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const signer = new HmacSigner("link-mandates-route-test-secret-42!!");

function makeStack() {
  const store = new InMemoryExecutionStore();
  const routes = adapterRoutes(signer, store);

  function call(method: string, path: string, ctx: Partial<Ctx> & { tenantId?: string }) {
    const route = routes.find((r) => {
      if (r.method !== method) return false;
      if (r.pattern === path) return true;
      const re = new RegExp("^" + r.pattern.replace(/:([a-zA-Z_]+)/g, "([^/]+)") + "$");
      return re.test(path);
    });
    if (!route) throw new Error(`No route: ${method} ${path}`);
    const params: Record<string, string> = ctx.params ?? {};
    if (!ctx.params) {
      const re = new RegExp("^" + route.pattern.replace(/:([a-zA-Z_]+)/g, "([^/]+)") + "$");
      const names = [...route.pattern.matchAll(/:([a-zA-Z_]+)/g)].map((m) => m[1]);
      const match = path.match(re);
      if (match) names.forEach((n, i) => (params[n] = match[i + 1]));
    }
    return route.handler({ tenantId: "t1", body: {}, params, headers: {}, ...ctx });
  }

  // Helper: run an intent and return the workflow id
  async function runIntent(tenantId = "t1", riskClass = "read_only", toolId = "file.read") {
    const res = await call("POST", "/api/adapter/run", {
      tenantId,
      body: {
        actorId: "agent:test",
        toolId,
        resourceRef: "resource:doc-1",
        riskClass,
        nonce: "nonce-" + Math.random().toString(36).slice(2),
        expiry: "2099-01-01T00:00:00.000Z",
      },
      headers: { "idempotency-key": "run-" + Math.random().toString(36).slice(2) },
    });
    return res;
  }

  return { call, runIntent };
}

const GOOD_MANDATES = [
  { type: "intent", id: "urn:ap2:mandate:intent:123" },
  { type: "payment", id: "urn:ap2:mandate:payment:456" },
];

const ALL_MANDATES = [
  { type: "intent",  id: "urn:ap2:mandate:intent:1" },
  { type: "cart",    id: "urn:ap2:mandate:cart:2" },
  { type: "payment", id: "urn:ap2:mandate:payment:3" },
];

// ─── Happy path ───────────────────────────────────────────────────────────────

test("link-mandates: allowed workflow → 201 + linkage + vc", async () => {
  const { call, runIntent } = makeStack();

  const run = await runIntent();
  eq(run.status, 201, `run: ${JSON.stringify(run.body)}`);
  assert(run.body.ok, "run ok");
  const wfId = run.body.receipt?.executionId;
  assert(wfId, "executionId in receipt");

  const res = await call("POST", `/api/receipt/${wfId}/link-mandates`, {
    tenantId: "t1",
    body: { mandates: GOOD_MANDATES },
    headers: { "idempotency-key": "link-" + Date.now() },
    params: { id: wfId },
  });

  eq(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert(res.body.ok === true, "ok");
  assert(res.body.linkage, "linkage present");
  assert(res.body.vc, "vc present");
  eq(res.body.workflowId, wfId, "workflowId matches");
});

test("link-mandates: linkage.receiptSignature is a non-empty string", async () => {
  const { call, runIntent } = makeStack();
  const run = await runIntent();
  const wfId = run.body.receipt.executionId;

  const res = await call("POST", `/api/receipt/${wfId}/link-mandates`, {
    tenantId: "t1",
    body: { mandates: GOOD_MANDATES },
    params: { id: wfId },
  });
  assert(typeof res.body.linkage?.receiptSignature === "string" && res.body.linkage.receiptSignature.length > 0,
    "receiptSignature non-empty string");
});

test("link-mandates: mandates in canonical order (intent → cart → payment)", async () => {
  const { call, runIntent } = makeStack();
  const run = await runIntent();
  const wfId = run.body.receipt.executionId;

  // Supply mandates out of order (payment before intent)
  const res = await call("POST", `/api/receipt/${wfId}/link-mandates`, {
    tenantId: "t1",
    body: { mandates: [
      { type: "payment", id: "urn:ap2:mandate:payment:p1" },
      { type: "intent",  id: "urn:ap2:mandate:intent:i1" },
    ] },
    params: { id: wfId },
  });
  eq(res.status, 201, `expected 201`);
  // canonical order: intent first
  eq(res.body.linkage.mandates[0].type, "intent");
  eq(res.body.linkage.mandates[1].type, "payment");
});

test("link-mandates: verifyMandateLinkage(linkage, signer) → valid", async () => {
  const { call, runIntent } = makeStack();
  const run = await runIntent();
  const wfId = run.body.receipt.executionId;

  const res = await call("POST", `/api/receipt/${wfId}/link-mandates`, {
    tenantId: "t1",
    body: { mandates: ALL_MANDATES },
    params: { id: wfId },
  });
  eq(res.status, 201);
  const result = verifyMandateLinkage(res.body.linkage, signer);
  assert(result.valid === true, `linkage invalid: ${result.reason}`);
});

test("link-mandates: vc has W3C Verifiable Credential shape", async () => {
  const { call, runIntent } = makeStack();
  const run = await runIntent();
  const wfId = run.body.receipt.executionId;

  const res = await call("POST", `/api/receipt/${wfId}/link-mandates`, {
    tenantId: "t1",
    body: { mandates: GOOD_MANDATES },
    params: { id: wfId },
  });
  eq(res.status, 201);
  const vc = res.body.vc;
  assert(Array.isArray(vc["@context"]), "@context array");
  assert(Array.isArray(vc.type), "type array");
  assert(vc.type.includes("VerifiableCredential"), "type includes VerifiableCredential");
  assert(typeof vc.credentialSubject === "object", "credentialSubject present");
  assert(typeof vc.proof === "object", "proof present");
  assert(typeof vc.validFrom === "string", "validFrom present");
});

test("link-mandates: vc.credentialSubject.linkage matches returned linkage", async () => {
  const { call, runIntent } = makeStack();
  const run = await runIntent();
  const wfId = run.body.receipt.executionId;

  const res = await call("POST", `/api/receipt/${wfId}/link-mandates`, {
    tenantId: "t1",
    body: { mandates: GOOD_MANDATES },
    params: { id: wfId },
  });
  eq(res.status, 201);
  eq(
    JSON.stringify(res.body.vc?.credentialSubject?.linkage),
    JSON.stringify(res.body.linkage),
    "vc.credentialSubject.linkage matches linkage",
  );
});

// ─── Fail-closed input validation ─────────────────────────────────────────────

test("link-mandates: missing tenantId → 400", async () => {
  const { call, runIntent } = makeStack();
  const run = await runIntent();
  const wfId = run.body.receipt.executionId;

  const res = await call("POST", `/api/receipt/${wfId}/link-mandates`, {
    tenantId: "",
    body: { mandates: GOOD_MANDATES },
    params: { id: wfId },
  });
  eq(res.status, 400);
});

test("link-mandates: missing mandates → 400", async () => {
  const { call, runIntent } = makeStack();
  const run = await runIntent();
  const wfId = run.body.receipt.executionId;

  const res = await call("POST", `/api/receipt/${wfId}/link-mandates`, {
    tenantId: "t1",
    body: {},
    params: { id: wfId },
  });
  eq(res.status, 400);
  assert(typeof res.body.error === "string", "error field");
});

test("link-mandates: empty mandates array → 400", async () => {
  const { call, runIntent } = makeStack();
  const run = await runIntent();
  const wfId = run.body.receipt.executionId;

  const res = await call("POST", `/api/receipt/${wfId}/link-mandates`, {
    tenantId: "t1",
    body: { mandates: [] },
    params: { id: wfId },
  });
  eq(res.status, 400);
});

test("link-mandates: invalid mandate type → 400", async () => {
  const { call, runIntent } = makeStack();
  const run = await runIntent();
  const wfId = run.body.receipt.executionId;

  const res = await call("POST", `/api/receipt/${wfId}/link-mandates`, {
    tenantId: "t1",
    body: { mandates: [{ type: "unknown-type", id: "urn:ap2:x:1" }] },
    params: { id: wfId },
  });
  eq(res.status, 400);
});

test("link-mandates: empty mandate id → 400", async () => {
  const { call, runIntent } = makeStack();
  const run = await runIntent();
  const wfId = run.body.receipt.executionId;

  const res = await call("POST", `/api/receipt/${wfId}/link-mandates`, {
    tenantId: "t1",
    body: { mandates: [{ type: "intent", id: "" }] },
    params: { id: wfId },
  });
  eq(res.status, 400);
});

test("link-mandates: unknown workflow id → 404", async () => {
  const { call } = makeStack();
  const res = await call("POST", `/api/receipt/non-existent-id/link-mandates`, {
    tenantId: "t1",
    body: { mandates: GOOD_MANDATES },
    params: { id: "non-existent-id" },
  });
  eq(res.status, 404);
});

test("link-mandates: cross-tenant → 404", async () => {
  const { call, runIntent } = makeStack();
  const run = await runIntent("t1");
  const wfId = run.body.receipt.executionId;

  const res = await call("POST", `/api/receipt/${wfId}/link-mandates`, {
    tenantId: "t2",  // different tenant
    body: { mandates: GOOD_MANDATES },
    params: { id: wfId },
  });
  eq(res.status, 404);
});

// ─── Status gating (422 for non-linkable states) ─────────────────────────────

test("link-mandates: planned workflow → 422", async () => {
  // Create a planned workflow by calling the run route with token.approve (write_destructive -> approval_required)
  const store2 = new InMemoryExecutionStore();
  const routes2 = adapterRoutes(signer, store2);
  const runRoute = routes2.find((r) => r.pattern === "/api/adapter/run");
  const runRes = await runRoute.handler({
    tenantId: "t1",
    body: {
      actorId: "agent:test",
      toolId: "token.approve",
      resourceRef: "res:wallet",
      riskClass: "write_destructive",
      nonce: "n-planned-" + Math.random().toString(36).slice(2),
      expiry: "2099-01-01T00:00:00.000Z",
    },
    params: {},
    headers: { "idempotency-key": "idem-planned-" + Date.now() },
  });
  eq(runRes.status, 201, `run: ${JSON.stringify(runRes.body)}`);
  eq(runRes.body.decision, "approval_required", "must be approval_required");
  const wfId = runRes.body.receipt?.approvalToken;
  assert(wfId, "approvalToken present");

  const linkRoute = routes2.find((r) => r.pattern === "/api/receipt/:workflowId/link-mandates");
  const res = await linkRoute.handler({
    tenantId: "t1",
    body: { mandates: GOOD_MANDATES },
    params: { workflowId: wfId },
    headers: {},
  });
  eq(res.status, 422, `expected 422 for planned status, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert(res.body.error?.includes("planned"), `error should mention "planned": ${res.body.error}`);
});
