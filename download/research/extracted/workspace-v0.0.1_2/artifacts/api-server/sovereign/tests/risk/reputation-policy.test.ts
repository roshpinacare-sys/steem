import "../_flush.mjs";
/**
 * tests/risk/reputation-policy.test.ts — injectReputationScore GuardPolicy.
 *
 * Coverage:
 *   APPROVED  cache hit → reputationScore injected → approvalPolicyRouter fuses it.
 *   MISS      cache miss → reputationScore stays undefined → legacy path works.
 *   ISOLATION tenant A record is invisible to tenant B (cross-tenant = null).
 *   FAIL      cache throws → GuardEvaluator denies (fail-closed).
 *   CUSTOM    actorIdResolver override works.
 *   ORCH      full orchestrator flow: injectRiskClass → injectReputationScore → approvalPolicyRouter.
 */
import { test, assert, eq } from "../_harness.mjs";
import { injectReputationScore } from "../../lib/risk/reputation-policy.ts";
import { approvalPolicyRouter } from "../../lib/risk/approval-policy.ts";
import { injectRiskClass } from "../../lib/risk/action-risk.ts";
import { TfaOrchestrator } from "../../lib/orchestrator/orchestrator.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryTrackRecordCache } from "../../lib/track-record/index.ts";
import type { TrackRecord, TrackRecordCache } from "../../lib/track-record/index.ts";
import type { Action, ActionContext } from "../../lib/orchestrator/types.ts";

function makeSigner(): HmacSigner {
  return new HmacSigner("test-secret-for-reputation-policy-32b");
}

function makeAction(type = "agent.task.run", overrides: Partial<Action> = {}): Action {
  return {
    id: "a1",
    tenantId: "t1",
    type,
    payload: {},
    source: "alice",
    isFinancial: false,
    isAutonomous: false,
    requestedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function sampleRecord(tenantId: string, identityId: string, score: number): TrackRecord {
  return {
    tenantId,
    identityId,
    settledAsWorker: 1,
    settledAsFunder: 0,
    refunded: 0,
    denied: 0,
    settledVolume: "10000",
    score,
    explanation: ["base 50", `+${score - 50} for settled escrow(s)`],
    computedAt: new Date().toISOString(),
  };
}

// ── APPROVED: cache hit injects reputationScore and router uses it ──
test("injectReputationScore hits cache and injects score into ctx", async () => {
  const cache = new InMemoryTrackRecordCache();
  await cache.set("t1", "alice", sampleRecord("t1", "alice", 70));

  const policy = injectReputationScore(cache);
  eq(policy.name, "inject-reputation-score");

  const ctx: ActionContext = {
    action: makeAction(),
    tenantId: "t1",
    timestamp: "2026-01-01T00:00:00.000Z",
    riskClass: "read_only",
  };

  const d = await policy.evaluate(ctx);
  assert(d.allow, "injection policy should always allow");
  eq(ctx.reputationScore, 70, "reputationScore should be injected from cache");
});

// ── MISS: cache miss leaves reputationScore undefined (backward-compat) ──
test("injectReputationScore miss leaves reputationScore undefined", async () => {
  const cache = new InMemoryTrackRecordCache();
  const policy = injectReputationScore(cache);

  const ctx: ActionContext = {
    action: makeAction(),
    tenantId: "t1",
    timestamp: "2026-01-01T00:00:00.000Z",
    riskClass: "read_only",
  };

  const d = await policy.evaluate(ctx);
  assert(d.allow, "injection policy should always allow on miss");
  eq(ctx.reputationScore, undefined, "reputationScore should stay undefined on cache miss");
});

// ── ISOLATION: cross-tenant queries return null ──
test("injectReputationScore enforces tenant isolation", async () => {
  const cache = new InMemoryTrackRecordCache();
  await cache.set("t1", "alice", sampleRecord("t1", "alice", 70));

  const policy = injectReputationScore(cache);

  // Same identity, different tenant → should be a miss.
  const ctx: ActionContext = {
    action: makeAction(),
    tenantId: "t2",
    timestamp: "2026-01-01T00:00:00.000Z",
    riskClass: "read_only",
  };

  const d = await policy.evaluate(ctx);
  assert(d.allow, "should allow even on cross-tenant miss");
  eq(ctx.reputationScore, undefined, "cross-tenant record must not leak");
});

// ── FAIL-CLOSED: cache throws → GuardEvaluator denies ──
test("injectReputationScore throw is caught by GuardEvaluator as deny", async () => {
  const badCache: TrackRecordCache = {
    get: async () => { throw new Error("cache unavailable"); },
    set: async () => {},
    invalidate: async () => {},
    invalidateTenant: async () => {},
  };

  const policy = injectReputationScore(badCache);
  const orch = new TfaOrchestrator([policy]);
  const action = makeAction("ledger.solvency_check", { isFinancial: true });

  const result = await orch.run(action, async () => "ok");
  assert(!result.ok, "should deny when cache throws");
  assert(result.reason.includes("cache unavailable"), "reason should mention the cache error");
});

// ── CUSTOM actorIdResolver ──
test("injectReputationScore respects custom actorIdResolver", async () => {
  const cache = new InMemoryTrackRecordCache();
  await cache.set("t1", "custom-actor", sampleRecord("t1", "custom-actor", 85));

  const policy = injectReputationScore(cache, {
    actorIdResolver: (ctx) => ctx.action.payload.actor as string,
  });

  const ctx: ActionContext = {
    action: makeAction("agent.task.run", { payload: { actor: "custom-actor" } }),
    tenantId: "t1",
    timestamp: "2026-01-01T00:00:00.000Z",
    riskClass: "read_only",
  };

  const d = await policy.evaluate(ctx);
  assert(d.allow);
  eq(ctx.reputationScore, 85, "custom resolver should map to correct actor");
});

// ── ORCH: full flow injectRiskClass → injectReputationScore → approvalPolicyRouter ──
test("full orchestrator flow with reputation injection and approval router", async () => {
  const signer = makeSigner();
  const cache = new InMemoryTrackRecordCache();
  await cache.set("t1", "alice", sampleRecord("t1", "alice", 70));

  const injectRep = injectReputationScore(cache);
  const router = approvalPolicyRouter(signer);

  const orch = new TfaOrchestrator([injectRiskClass(), injectRep, router]);
  const action = makeAction("ledger.solvency_check", { isFinancial: true });

  const result = await orch.run(action, async () => "ok");
  assert(result.ok, "trusted actor (70) with read_only risk should allow");

  const rec = orch.audit.getRecord(result.auditId);
  assert(rec !== null);
  eq(rec!.outcome, "allowed");
  assert(rec!.reason !== undefined, "audit should carry trace");

  const trace = JSON.parse(rec!.reason!);
  eq(trace.policy, "approval-policy-router");
  eq(trace.riskClass, "read_only");
  eq(trace.approvalClass, "auto");
  assert(trace.riskIntelligence !== undefined, "trace should carry riskIntelligence");
  eq(trace.riskIntelligence.reputationBand, "trusted");
  eq(trace.riskIntelligence.effectiveApprovalClass, "auto");
  assert(typeof trace.signature === "string");
});

// ── ORCH: new actor (low score) escalates via router ──
test("new actor with low reputationScore escalates approval class", async () => {
  const signer = makeSigner();
  const cache = new InMemoryTrackRecordCache();
  await cache.set("t1", "bob", sampleRecord("t1", "bob", 40));

  const injectRep = injectReputationScore(cache);
  const router = approvalPolicyRouter(signer);

  const orch = new TfaOrchestrator([injectRiskClass(), injectRep, router]);
  const action = makeAction("ledger.solvency_check", { isFinancial: true, source: "bob" });

  const result = await orch.run(action, async () => "ok");
  assert(result.ok, "new actor should still allow (opa_check)");

  const rec = orch.audit.getRecord(result.auditId);
  const trace = JSON.parse(rec!.reason!);
  eq(trace.approvalClass, "opa_check");
  eq(trace.riskIntelligence.reputationBand, "new");
});

// ── ORCH: untrusted actor (very low score) escalates to human ──
test("untrusted actor escalates to human review", async () => {
  const signer = makeSigner();
  const cache = new InMemoryTrackRecordCache();
  await cache.set("t1", "mallory", sampleRecord("t1", "mallory", 10));

  const injectRep = injectReputationScore(cache);
  const router = approvalPolicyRouter(signer);

  const orch = new TfaOrchestrator([injectRiskClass(), injectRep, router]);
  const action = makeAction("ledger.solvency_check", { isFinancial: true, source: "mallory" });

  const result = await orch.run(action, async () => "ok");
  assert(result.ok, "untrusted actor should allow (human review)");

  const rec = orch.audit.getRecord(result.auditId);
  const trace = JSON.parse(rec!.reason!);
  eq(trace.approvalClass, "human");
  eq(trace.riskIntelligence.reputationBand, "untrusted");
});

// ── ORCH: backward-compat without cache wiring (no injectReputationScore) ──
test("legacy path without injectReputationScore still works", async () => {
  const signer = makeSigner();
  const router = approvalPolicyRouter(signer);

  const orch = new TfaOrchestrator([injectRiskClass(), router]);
  const action = makeAction("ledger.solvency_check", { isFinancial: true });

  const result = await orch.run(action, async () => "ok");
  assert(result.ok, "legacy path should allow");

  const rec = orch.audit.getRecord(result.auditId);
  const trace = JSON.parse(rec!.reason!);
  eq(trace.approvalClass, "auto");
  // Without reputationScore, riskIntelligence should NOT be present (legacy path).
  assert(trace.riskIntelligence === undefined, "legacy path should not have riskIntelligence");
});
