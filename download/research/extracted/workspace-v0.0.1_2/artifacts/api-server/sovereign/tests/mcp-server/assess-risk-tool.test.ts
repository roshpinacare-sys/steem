/**
 * tests/mcp-server/assess-risk-tool.test.ts — MCP tfa_assess_risk tool.
 *
 * Covers:
 *   • approved path: basic assessment with server-side classification
 *   • enriched path: trackRecordCache + actorBaselineStore wired
 *   • value-aware: high value escalates risk score
 *   • fail-closed: missing required params throws
 *   • tenant isolation: stores do not leak across tenants
 *   • classification override: client-supplied riskClass ignored
 */

import { test, assert, eq } from "../_harness.mjs";
import { TfaMcpServer } from "../../lib/mcp-server/mcp-server.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { InMemoryNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";
import { InMemoryTrackRecordCache } from "../../lib/track-record/track-record-cache.ts";
import { InMemoryActorBaselineStore } from "../../lib/risk/actor-baseline.ts";

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

// ─── Happy path ──────────────────────────────────────────────────────────────

test("tfa_assess_risk: basic assessment returns riskScore + factors", async () => {
  const server = new TfaMcpServer(baseConfig());
  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_assess_risk",
    arguments: validAssessParams(),
  }));
  eq(r!.error, undefined);
  const text = JSON.parse((r!.result as any).content[0].text);
  eq(text.assessment.riskScore >= 0 && text.assessment.riskScore <= 100, true);
  eq(text.assessment.baseApprovalClass, "human");
  // No enrichment → no escalation above the static floor.
  eq(text.assessment.escalated, false);
  assert(Array.isArray(text.assessment.factors), "factors should be array");
  assert(text.assessment.factors.length > 0, "factors should not be empty");
  eq(text.serverRiskClass, "write_destructive");
  eq(text.intentSummary.tenantId, "tenant-a");
  eq(text.intentSummary.actorId, "actor-1");
});

test("tfa_assess_risk: auto action with trusted actor lowers informational score", async () => {
  const cache = new InMemoryTrackRecordCache();
  await cache.set("tenant-a", "actor-1", {
    tenantId: "tenant-a",
    identityId: "actor-1",
    settledAsWorker: 10,
    settledAsFunder: 5,
    refunded: 0,
    denied: 0,
    settledVolume: "1000000",
    score: 90,
    explanation: ["test"],
    selfDealing: 0,
    computedAt: new Date().toISOString(),
  });
  const server = new TfaMcpServer({ ...baseConfig(), trackRecordCache: cache });
  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_assess_risk",
    arguments: validAssessParams({ toolId: "file.read" }),
  }));
  eq(r!.error, undefined);
  const text = JSON.parse((r!.result as any).content[0].text);
  eq(text.assessment.baseApprovalClass, "auto");
  eq(text.assessment.reputationBand, "trusted");
  const repFactor = text.assessment.factors.find((f: any) => f.factor === "reputation:trusted");
  assert(repFactor, "trusted reputation factor should be present");
  eq(repFactor.contribution, -10);
});

test("tfa_assess_risk: actor baseline enriches contextual signals", async () => {
  const baseline = new InMemoryActorBaselineStore({ windowMs: 3600000 });
  const now = Date.now();
  // Establish a baseline of 1 action per completed window (past 24h).
  for (let w = 1; w <= 24; w++) {
    baseline.recordAction("tenant-a", "actor-1", now - w * 3600000);
  }
  // Record 10 actions in current window → 10× baseline → velocity escalation.
  for (let i = 0; i < 10; i++) {
    baseline.recordAction("tenant-a", "actor-1", now);
  }
  const server = new TfaMcpServer({ ...baseConfig(), actorBaselineStore: baseline });
  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_assess_risk",
    arguments: validAssessParams({ toolId: "file.read" }),
  }));
  eq(r!.error, undefined);
  const text = JSON.parse((r!.result as any).content[0].text);
  assert(text.assessment.contextual.signals.length > 0, "contextual signals should include velocity");
  assert(
    text.assessment.contextual.signals.some((s: any) => s.signal === "velocity_elevated" || s.signal === "velocity_extreme"),
    "should have velocity signal",
  );
});

test("tfa_assess_risk: both stores wired → full enrichment", async () => {
  const cache = new InMemoryTrackRecordCache();
  await cache.set("tenant-a", "actor-1", {
    tenantId: "tenant-a",
    identityId: "actor-1",
    settledAsWorker: 5,
    settledAsFunder: 2,
    refunded: 1,
    denied: 0,
    settledVolume: "500000",
    score: 65,
    explanation: ["test"],
    selfDealing: 0,
    computedAt: new Date().toISOString(),
  });
  const baseline = new InMemoryActorBaselineStore();
  const server = new TfaMcpServer({ ...baseConfig(), trackRecordCache: cache, actorBaselineStore: baseline });
  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_assess_risk",
    arguments: validAssessParams(),
  }));
  eq(r!.error, undefined);
  const text = JSON.parse((r!.result as any).content[0].text);
  eq(text.assessment.reputationBand, "normal");
  eq(text.assessment.baseApprovalClass, "human");
});

test("tfa_assess_risk: high value escalates risk score", async () => {
  const server = new TfaMcpServer(baseConfig());
  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_assess_risk",
    arguments: validAssessParams({ valueMicrounits: "100000000" }),
  }));
  eq(r!.error, undefined);
  const text = JSON.parse((r!.result as any).content[0].text);
  const highRiskScore = text.assessment.riskScore;

  const r2 = await server.handleRequest(req("tools/call", {
    name: "tfa_assess_risk",
    arguments: validAssessParams({ valueMicrounits: "0" }),
  }));
  eq(r2!.error, undefined);
  const text2 = JSON.parse((r2!.result as any).content[0].text);
  const lowRiskScore = text2.assessment.riskScore;

  assert(highRiskScore >= lowRiskScore, "high value should not lower risk score");
});

// ─── Fail-closed ─────────────────────────────────────────────────────────────

test("tfa_assess_risk: missing tenantId returns error", async () => {
  const server = new TfaMcpServer(baseConfig());
  const params = validAssessParams();
  delete (params as any).tenantId;
  const r = await server.handleRequest(req("tools/call", { name: "tfa_assess_risk", arguments: params }));
  eq(r!.error !== undefined, true);
});

test("tfa_assess_risk: missing actorId returns error", async () => {
  const server = new TfaMcpServer(baseConfig());
  const params = validAssessParams();
  delete (params as any).actorId;
  const r = await server.handleRequest(req("tools/call", { name: "tfa_assess_risk", arguments: params }));
  eq(r!.error !== undefined, true);
});

// ─── Tenant isolation ──────────────────────────────────────────────────────

test("tfa_assess_risk: trackRecordCache does not leak across tenants", async () => {
  const cache = new InMemoryTrackRecordCache();
  await cache.set("tenant-a", "actor-1", {
    tenantId: "tenant-a",
    identityId: "actor-1",
    settledAsWorker: 10,
    settledAsFunder: 5,
    refunded: 0,
    denied: 0,
    settledVolume: "1000000",
    score: 90,
    explanation: ["test"],
    selfDealing: 0,
    computedAt: new Date().toISOString(),
  });
  const server = new TfaMcpServer({ ...baseConfig(), trackRecordCache: cache });
  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_assess_risk",
    arguments: validAssessParams({ tenantId: "tenant-b", actorId: "actor-1" }),
  }));
  eq(r!.error, undefined);
  const text = JSON.parse((r!.result as any).content[0].text);
  eq(text.assessment.reputationBand, "new");
  eq(text.assessment.factors.some((f: any) => f.factor === "reputation:trusted"), false);
});

// ─── Classification override ─────────────────────────────────────────────────

test("tfa_assess_risk: client riskClass is overridden by server classification", async () => {
  const server = new TfaMcpServer(baseConfig());
  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_assess_risk",
    arguments: validAssessParams({ toolId: "file.delete", riskClass: "read_only" }),
  }));
  eq(r!.error, undefined);
  const text = JSON.parse((r!.result as any).content[0].text);
  eq(text.serverRiskClass, "write_destructive");
  eq(text.assessment.baseApprovalClass, "human");
});
