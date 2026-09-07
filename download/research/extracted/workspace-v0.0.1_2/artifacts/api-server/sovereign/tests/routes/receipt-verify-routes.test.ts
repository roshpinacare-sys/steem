/**
 * tests/routes/receipt-verify-routes.test.ts — v261.
 * Unit tests for POST /api/receipt/verify.
 *
 *   FEATURE      genuine receipt passes both signature and decision integrity.
 *   CATCH-WRONG  tampered decision fails decisionValid but still reports signatureValid.
 *   FAIL-CLOSED  missing receipt → 400; unknown version → 400; no throw.
 */
import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { runActionThroughTfa } from "../../lib/adapter/agent-adapter.ts";
import { receiptVerifyRoutes } from "../../src/routes/receipt-verify-routes.ts";
import type { Ctx } from "../../src/routes/receipt-verify-routes.ts";

const signer = new HmacSigner("receipt-verify-route-test-secret");

function makeCtx(body: any): Ctx {
  return { tenantId: "t1", body, params: {}, headers: {} };
}

function genuineReceipt(toolId: string) {
  const store = new InMemoryExecutionStore();
  const intent = {
    tenantId: "t1", actorId: "agent:1", toolId, resourceRef: "res:1",
    riskClass: "read_only", valueMicrounits: 0n, privacyLevel: "internal",
    approvalPolicyRef: "pol:default", nonce: "n-" + Math.random().toString(36).slice(2),
    expiry: "2099-01-01T00:00:00.000Z", provenance: "agent", evidencePolicy: "ev:default",
  } as any;
  return runActionThroughTfa(intent, signer, { executionStore: store }).receipt;
}

const routes = receiptVerifyRoutes(signer);
const route = routes.find((r) => r.pattern === "/api/receipt/verify")!;

async function call(body: any) {
  return route.handler(makeCtx(body));
}

test("genuine receipt: signatureValid=true, decisionValid=true", async () => {
  const receipt = genuineReceipt("file.read");
  const res = await call({ receipt });
  eq(res.status, 200);
  eq(res.body.signatureValid, true);
  eq(res.body.decisionValid, true);
  eq(res.body.reasons.length, 0);
});

test("tampered decision: signatureValid=false, decisionValid=false", async () => {
  const receipt = genuineReceipt("file.delete");
  const tampered = { ...receipt, decision: "allowed" };
  const res = await call({ receipt: tampered });
  eq(res.status, 200);
  // Signature fails because decision is part of signed payload
  eq(res.body.signatureValid, false);
  eq(res.body.decisionValid, false);
  assert(res.body.reasons.some((r: string) => r.includes("decision") || r.includes("approvalClass")), "reason must mention decision or approvalClass");
});

test("tampered serverRiskClass: decisionValid catches mismatch", async () => {
  const receipt = genuineReceipt("infra.apply");
  const tampered = { ...receipt, serverRiskClass: "read_only" };
  const res = await call({ receipt: tampered });
  eq(res.status, 200);
  eq(res.body.signatureValid, false);
  eq(res.body.decisionValid, false);
  assert(res.body.reasons.some((r: string) => r.includes("serverRiskClass")), "reason must mention serverRiskClass");
});

test("fail-closed: missing receipt → 400", async () => {
  const res = await call({});
  eq(res.status, 400);
  eq(res.body.error, "receipt must be an object");
});

test("fail-closed: null receipt → 400", async () => {
  const res = await call({ receipt: null });
  eq(res.status, 400);
  eq(res.body.error, "receipt must be an object");
});

test("unknown version → 200 with both flags false and a reason", async () => {
  const res = await call({ receipt: { version: "bogus" } });
  eq(res.status, 200);
  eq(res.body.ok, true);
  eq(res.body.valid, false);
  eq(res.body.signatureValid, false);
  eq(res.body.decisionValid, false);
  assert(res.body.reasons.includes("unknown receipt version"));
});

test("status receipt: signature checked, decisionValid=true (no decision to validate)", async () => {
  const receipt = genuineReceipt("file.read");
  const statusReceipt = { ...receipt, version: "tfa-status-receipt-v1" };
  const res = await call({ receipt: statusReceipt });
  eq(res.status, 200);
  eq(res.body.decisionValid, true);
  eq(res.body.reasons.length, 0);
});

// ── v273: AP2 mandate linkage via the unified verifier ──────────────────────
import { linkReceiptToMandates } from "../../lib/adapter/ap2-mandate-link.ts";
import { runActionThroughTfa as _runForLink } from "../../lib/adapter/agent-adapter.ts";
import { InMemoryExecutionStore as _StoreForLink } from "../../lib/orchestrator/execution-workflow.ts";

test("receipt/verify: optional AP2 mandateLinkage is verified and bound", async () => {
  const s = new HmacSigner("receipt-verify-ap2-secret");
  const intent = {
    tenantId: "t1", actorId: "agent:1", toolId: "token.swap", resourceRef: "res:1",
    riskClass: "read_only", valueMicrounits: 1000n, privacyLevel: "internal",
    approvalPolicyRef: "pol:default", nonce: "n-" + Math.random().toString(36).slice(2),
    expiry: "2099-01-01T00:00:00.000Z", provenance: "agent", evidencePolicy: "ev:default",
  } as any;
  const receipt = _runForLink(intent, s, { executionStore: new _StoreForLink() }).receipt;
  const linkage = linkReceiptToMandates(receipt, [{ type: "intent", id: "urn:ap2:intent:9" }], s);

  const routes = receiptVerifyRoutes(s);
  const route = routes.find((r) => r.pattern === "/api/receipt/verify")!;

  // valid linkage → mandateLinkageValid true, overall valid
  const good: any = await route.handler({ tenantId: "t1", body: { receipt, mandateLinkage: linkage }, params: {} });
  eq(good.body.mandateLinkageValid, true, "valid linkage verifies");
  eq(good.body.valid, true);

  // tampered linkage → mandateLinkageValid false, overall invalid
  const tampered = { ...linkage, mandates: [{ type: "intent", id: "urn:ap2:intent:EVIL" }] };
  const bad: any = await route.handler({ tenantId: "t1", body: { receipt, mandateLinkage: tampered }, params: {} });
  eq(bad.body.mandateLinkageValid, false, "tampered linkage fails");
  eq(bad.body.valid, false, "overall verdict fails when linkage fails");

  // no linkage → field absent, contract unchanged
  const none: any = await route.handler({ tenantId: "t1", body: { receipt }, params: {} });
  eq(none.body.mandateLinkageValid, undefined, "no linkage → field absent (additive)");
  eq(none.body.signatureValid, true);
});
