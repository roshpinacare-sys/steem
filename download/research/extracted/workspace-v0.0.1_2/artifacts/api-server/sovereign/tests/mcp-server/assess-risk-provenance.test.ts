/**
 * tests/mcp-server/assess-risk-provenance.test.ts — tfa_assess_risk + provenance (v316).
 *
 * Covers:
 *   • happy path: raw AgentProvenanceInput → normalized, vendor alias resolved, provenanceId present
 *   • deterministic fingerprint: same input twice → same provenanceId
 *   • pass-through: already-normalized AgentProvenance (has provenanceId) is echoed back unchanged
 *   • backward-compat: no provenance supplied → output has no `provenance` key at all
 *   • fail-closed: missing agentId → error, assessment is not silently returned
 *   • fail-closed: empty vendor → error
 */

import { test, assert, eq } from "../_harness.mjs";
import { TfaMcpServer } from "../../lib/mcp-server/mcp-server.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { InMemoryNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";

function makeSigner() {
  return new HmacSigner("test-secret-32-bytes-long-for-hmac!!");
}

function baseConfig() {
  return {
    signer: makeSigner(),
    executionStore: new InMemoryExecutionStore(),
    nonceRegistry: new InMemoryNonceRegistry(),
  };
}

function req(method: string, params?: Record<string, unknown>) {
  return { jsonrpc: "2.0" as const, id: 1, method, params: params ?? {} };
}

function validAssessParams(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-a",
    actorId: "actor-1",
    toolId: "file.delete",
    resourceRef: "/tmp/test.txt",
    nonce: "nonce-" + Math.random().toString(36).slice(2),
    expiry: new Date(Date.now() + 60000).toISOString(),
    ...overrides,
  };
}

async function callAssess(params: Record<string, unknown>) {
  const server = new TfaMcpServer(baseConfig());
  const r = await server.handleRequest(req("tools/call", { name: "tfa_assess_risk", arguments: params }));
  return r!;
}

// ─── Happy path ──────────────────────────────────────────────────────────────

test("tfa_assess_risk+provenance: raw input is normalized with provenanceId", async () => {
  const r = await callAssess(validAssessParams({
    agentProvenance: { vendor: "claude-code", agentId: "agent-7", sessionId: "run-42" },
  }));
  eq(r.error, undefined);
  const text = JSON.parse((r.result as any).content[0].text);
  eq(text.provenance.vendor, "anthropic"); // "claude-code" is a known alias
  eq(text.provenance.vendorRaw, "claude-code");
  eq(text.provenance.agentId, "agent-7");
  eq(typeof text.provenance.provenanceId, "string");
  eq(text.provenance.provenanceId.length > 0, true);
  // assessment is still present alongside provenance.
  eq(text.assessment.riskScore >= 0 && text.assessment.riskScore <= 100, true);
});

test("tfa_assess_risk+provenance: deterministic — same identity → same provenanceId", async () => {
  const input = { vendor: "cursor", agentId: "agent-9", model: "composer-1" };
  const r1 = await callAssess(validAssessParams({ agentProvenance: input }));
  const r2 = await callAssess(validAssessParams({ agentProvenance: { ...input } }));
  const t1 = JSON.parse((r1.result as any).content[0].text);
  const t2 = JSON.parse((r2.result as any).content[0].text);
  eq(t1.provenance.provenanceId, t2.provenance.provenanceId);
});

test("tfa_assess_risk+provenance: already-normalized provenance passes through unchanged", async () => {
  const normalized = {
    vendor: "openai",
    vendorRaw: "openai",
    agentId: "agent-3",
    provenanceId: "deadbeef-fixed-for-test",
  };
  const r = await callAssess(validAssessParams({ agentProvenance: normalized }));
  eq(r.error, undefined);
  const text = JSON.parse((r.result as any).content[0].text);
  eq(text.provenance.provenanceId, "deadbeef-fixed-for-test");
});

// ─── Backward compatibility ────────────────────────────────────────────────────

test("tfa_assess_risk+provenance: no provenance supplied → key omitted, unchanged behaviour", async () => {
  const r = await callAssess(validAssessParams());
  eq(r.error, undefined);
  const text = JSON.parse((r.result as any).content[0].text);
  eq("provenance" in text, false);
  eq(text.assessment.riskScore >= 0 && text.assessment.riskScore <= 100, true);
});

// ─── Fail-closed ────────────────────────────────────────────────────────────────

test("tfa_assess_risk+provenance: fail-closed — missing agentId returns error", async () => {
  const r = await callAssess(validAssessParams({ agentProvenance: { vendor: "anthropic" } }));
  eq(r.error !== undefined, true);
});

test("tfa_assess_risk+provenance: fail-closed — empty vendor returns error", async () => {
  const r = await callAssess(validAssessParams({ agentProvenance: { vendor: "", agentId: "agent-1" } }));
  eq(r.error !== undefined, true);
});
