/**
 * tests/adapter/approval-capability-token.test.ts — v194.
 * runActionThroughTfa issues a SIGNED ApprovalCapabilityToken alongside the raw
 * approvalToken when decision === "approval_required" (additive, non-breaking).
 *
 *   FEATURE       approval_required → receipt carries an encoded capability token
 *                 bound to the workflow (executionId+tenantId), verifiable + not expired.
 *   COMPAT        raw approvalToken (= workflow id) is still present and unchanged.
 *   EDGE          a tiny TTL makes the capability verify as expired in the future.
 *   FAIL-CLOSED   allowed / denied decisions carry NO capability token.
 */
import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { runActionThroughTfa } from "../../lib/adapter/agent-adapter.ts";
import { decodeCapabilityToken, verifyCapabilityToken } from "../../lib/mcp-server/capability-token.ts";

const signer = new HmacSigner("approval-cap-token-test-secret");

function intent(over: Record<string, unknown> = {}) {
  return {
    tenantId: "t1", actorId: "agent:1", toolId: "file.delete", resourceRef: "res:1",
    riskClass: "read_only", valueMicrounits: 0n, privacyLevel: "internal",
    approvalPolicyRef: "pol:default", nonce: "nonce-" + Math.random().toString(36).slice(2),
    expiry: "2099-01-01T00:00:00.000Z", provenance: "agent", evidencePolicy: "ev:default",
    ...over,
  } as any;
}

test("approval_required issues a signed capability token bound to the workflow", () => {
  const store = new InMemoryExecutionStore();
  const r = runActionThroughTfa(intent({ toolId: "file.delete" }), signer, { executionStore: store });
  eq(r.decision, "approval_required", "file.delete → write_destructive → human → approval_required");
  const cap = r.receipt.approvalCapabilityToken;
  assert(typeof cap === "string" && cap.length > 0, "capability token present");
  assert(typeof r.receipt.approvalToken === "string" && r.receipt.approvalToken!.length > 0, "raw approvalToken still present");

  const decoded = decodeCapabilityToken(cap!);
  assert(decoded, "capability token decodes");
  eq(decoded!.version, "tfa-cap-v1");
  eq(decoded!.executionId, r.receipt.approvalToken, "capability bound to the workflow id");
  eq(decoded!.tenantId, "t1");
  const v = verifyCapabilityToken(decoded, signer, r.receipt.approvalToken, "t1");
  assert(v.valid, `capability verifies: ${JSON.stringify(v)}`);
});

test("edge: a short TTL makes the capability expire; wrong tenant fails", () => {
  const store = new InMemoryExecutionStore();
  const fixed = "2026-01-01T00:00:00.000Z";
  const r = runActionThroughTfa(intent({ toolId: "file.delete" }), signer, {
    executionStore: store, now: () => fixed, capabilityTtlMs: 1000,
  });
  const decoded = decodeCapabilityToken(r.receipt.approvalCapabilityToken!)!;
  const future = Date.parse(fixed) + 3_600_000;
  assert(!verifyCapabilityToken(decoded, signer, decoded.executionId, "t1", future).valid, "expired capability fails");
  assert(!verifyCapabilityToken(decoded, signer, decoded.executionId, "other-tenant").valid, "wrong tenant fails");
});

test("fail-closed: allowed and denied carry no capability token", () => {
  const store = new InMemoryExecutionStore();
  const allowed = runActionThroughTfa(intent({ toolId: "file.read" }), signer, { executionStore: store });
  const denied = runActionThroughTfa(intent({ toolId: "infra.apply" }), signer, { executionStore: store });
  if (allowed.decision === "allowed") eq(allowed.receipt.approvalCapabilityToken, undefined, "allowed → no cap token");
  if (denied.decision === "denied") eq(denied.receipt.approvalCapabilityToken, undefined, "denied → no cap token");
});
