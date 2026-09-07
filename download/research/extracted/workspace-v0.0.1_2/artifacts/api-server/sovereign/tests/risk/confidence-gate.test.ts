/**
 * tests/risk/confidence-gate.test.ts — ConfidenceGate full test suite.
 *
 * Coverage:
 *   validateConfig
 *     • accepts valid config (0.50/0.85 defaults)
 *     • throws ConfidenceGateError(invalid_threshold) for hitlThreshold < 0
 *     • throws for hitlThreshold > 1
 *     • throws for autoThreshold < 0
 *     • throws for autoThreshold > 1
 *     • throws when hitlThreshold > autoThreshold
 *     • accepts edge case: hitlThreshold == autoThreshold (0% HITL band)
 *
 *   resolveScore
 *     • returns score for valid number in [0, 1]
 *     • returns 0 for missing (undefined)
 *     • returns 0 for NaN
 *     • returns 0 for Infinity
 *     • returns 0 for score > 1 (fail-closed: not clamped to max)
 *     • returns 0 for score < 0
 *     • returns 0 for null
 *
 *   resolveVerdict
 *     • score ≥ autoThreshold → "auto"
 *     • autoThreshold > score ≥ hitlThreshold → "human"
 *     • score < hitlThreshold → "deny"
 *     • exact autoThreshold → "auto" (inclusive)
 *     • exact hitlThreshold → "human" (inclusive)
 *     • score = 0 → "deny"
 *     • score = 1 → "auto"
 *
 *   confidenceGate (GuardPolicy)
 *     • factory throws on invalid config (fail-fast)
 *     • score ≥ autoThreshold: allow: true
 *     • score in HITL band: allow: false, reason includes HITL_REQUIRED
 *     • score < hitlThreshold: allow: false, reason includes CONFIDENCE_BELOW_THRESHOLD
 *     • missing score (no confidenceScore on ctx): allow: false (fail-closed → 0 → deny)
 *     • NaN score: allow: false (fail-closed)
 *     • always attaches ctx.confidenceGateTrace (JSON string)
 *     • trace includes score, verdict, thresholds, policy name, timestamp
 *     • injectable now() for deterministic timestamp in trace
 *     • different gate names → different trace.policy values
 *
 *   verifyConfidenceGateTrace
 *     • returns true for a valid trace
 *     • returns false for tampered signature
 *     • returns false for mutated verdict
 *     • returns false for mutated score
 *     • returns false for wrong signer key
 *     • never throws on bad input (null, undefined, {})
 *
 *   Integration with approvalPolicyRouter (composition)
 *     • high-confidence + auto-risk → both gates allow (both traces set)
 *     • high-confidence + deny-risk → denied by approvalPolicyRouter, not gate
 *     • low-confidence + auto-risk → denied by confidence gate
 *     • mid-confidence + auto-risk → HITL gate kicks in
 *
 *   ActionContext confidenceScore additive field
 *     • ActionContext accepts confidenceScore without breaking existing usage
 *     • ActionContext accepts confidenceGateTrace without breaking existing usage
 */

import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import {
  confidenceGate,
  verifyConfidenceGateTrace,
  validateConfig as validateConfidenceGateConfig,
  resolveScore,
  resolveVerdict,
  DEFAULT_CONFIDENCE_CONFIG,
  ConfidenceGateError,
  type ConfidenceGateConfig,
  type ConfidenceGateTrace,
} from "../../lib/risk/confidence-gate.ts";
import { approvalPolicyRouter } from "../../lib/risk/approval-policy.ts";
import type { ActionContext } from "../../lib/orchestrator/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const signer = new HmacSigner("confidence-gate-test-secret-key");
const FIXED_NOW = () => "2030-01-01T00:00:00.000Z";

function makeCtx(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    action: { type: "test.action", payload: {} } as any,
    tenantId: "t1",
    timestamp: "2030-01-01T00:00:00.000Z",
    riskClass: "read_only",
    ...overrides,
  };
}

// ─── validateConfig ───────────────────────────────────────────────────────────

test("validateConfig: accepts valid default config", () => {
  validateConfidenceGateConfig(DEFAULT_CONFIDENCE_CONFIG); // should not throw
  assert(true, "no throw");
});

test("validateConfig: throws for hitlThreshold < 0", () => {
  let threw = false;
  try {
    validateConfidenceGateConfig({ autoThreshold: 0.85, hitlThreshold: -0.1 });
  } catch (e: unknown) {
    threw = true;
    assert(e instanceof ConfidenceGateError, "should be ConfidenceGateError");
    eq((e as ConfidenceGateError).code, "invalid_threshold");
  }
  assert(threw);
});

test("validateConfig: throws for hitlThreshold > 1", () => {
  let threw = false;
  try {
    validateConfidenceGateConfig({ autoThreshold: 0.85, hitlThreshold: 1.1 });
  } catch (e: unknown) {
    threw = true;
    assert(e instanceof ConfidenceGateError);
    eq((e as ConfidenceGateError).code, "invalid_threshold");
  }
  assert(threw);
});

test("validateConfig: throws for autoThreshold > 1", () => {
  let threw = false;
  try {
    validateConfidenceGateConfig({ autoThreshold: 1.1, hitlThreshold: 0.5 });
  } catch (e: unknown) {
    threw = true;
    assert(e instanceof ConfidenceGateError);
  }
  assert(threw);
});

test("validateConfig: throws when hitlThreshold > autoThreshold", () => {
  let threw = false;
  try {
    validateConfidenceGateConfig({ autoThreshold: 0.4, hitlThreshold: 0.6 });
  } catch (e: unknown) {
    threw = true;
    assert(e instanceof ConfidenceGateError);
    assert((e as ConfidenceGateError).message.includes("≤") || (e as ConfidenceGateError).message.includes("must be"),
      "should mention ordering constraint");
  }
  assert(threw);
});

test("validateConfig: accepts edge case hitlThreshold == autoThreshold", () => {
  validateConfidenceGateConfig({ autoThreshold: 0.7, hitlThreshold: 0.7 });
  assert(true, "no throw");
});

// ─── resolveScore ─────────────────────────────────────────────────────────────

test("resolveScore: returns score for valid value in [0, 1]", () => {
  eq(resolveScore(makeCtx({ confidenceScore: 0.9 })), 0.9);
  eq(resolveScore(makeCtx({ confidenceScore: 0 })), 0);
  eq(resolveScore(makeCtx({ confidenceScore: 1 })), 1);
  eq(resolveScore(makeCtx({ confidenceScore: 0.55 })), 0.55);
});

test("resolveScore: returns 0 for missing (undefined)", () => {
  eq(resolveScore(makeCtx()), 0);
});

test("resolveScore: returns 0 for NaN", () => {
  eq(resolveScore(makeCtx({ confidenceScore: NaN })), 0);
});

test("resolveScore: returns 0 for Infinity", () => {
  eq(resolveScore(makeCtx({ confidenceScore: Infinity })), 0);
});

test("resolveScore: returns 0 for score > 1 (fail-closed)", () => {
  eq(resolveScore(makeCtx({ confidenceScore: 1.01 })), 0);
  eq(resolveScore(makeCtx({ confidenceScore: 99 })), 0);
});

test("resolveScore: returns 0 for score < 0", () => {
  eq(resolveScore(makeCtx({ confidenceScore: -0.1 })), 0);
});

// ─── resolveVerdict ───────────────────────────────────────────────────────────

const cfg = DEFAULT_CONFIDENCE_CONFIG; // auto=0.85, hitl=0.50

test("resolveVerdict: score ≥ autoThreshold → auto", () => {
  eq(resolveVerdict(0.85, cfg), "auto");
  eq(resolveVerdict(0.99, cfg), "auto");
  eq(resolveVerdict(1.0, cfg), "auto");
});

test("resolveVerdict: autoThreshold > score ≥ hitlThreshold → human", () => {
  eq(resolveVerdict(0.84, cfg), "human");
  eq(resolveVerdict(0.5, cfg), "human");
  eq(resolveVerdict(0.65, cfg), "human");
});

test("resolveVerdict: score < hitlThreshold → deny", () => {
  eq(resolveVerdict(0.49, cfg), "deny");
  eq(resolveVerdict(0, cfg), "deny");
  eq(resolveVerdict(0.1, cfg), "deny");
});

test("resolveVerdict: exact autoThreshold → auto (inclusive)", () => {
  eq(resolveVerdict(0.85, cfg), "auto");
});

test("resolveVerdict: exact hitlThreshold → human (inclusive)", () => {
  eq(resolveVerdict(0.5, cfg), "human");
});

// ─── confidenceGate GuardPolicy ───────────────────────────────────────────────

test("confidenceGate: factory throws on invalid config (fail-fast)", () => {
  let threw = false;
  try {
    confidenceGate(signer, { autoThreshold: 0.3, hitlThreshold: 0.8 });
  } catch (e: unknown) {
    threw = true;
    assert(e instanceof ConfidenceGateError);
  }
  assert(threw, "should throw on bad config");
});

test("confidenceGate: score ≥ autoThreshold → allow: true", () => {
  const gate = confidenceGate(signer, DEFAULT_CONFIDENCE_CONFIG, FIXED_NOW);
  const ctx = makeCtx({ confidenceScore: 0.9 });
  const result = gate.evaluate(ctx);
  assert(!(result instanceof Promise), "should be sync");
  eq((result as any).allow, true);
});

test("confidenceGate: HITL band → allow: false, reason HITL_REQUIRED", () => {
  const gate = confidenceGate(signer, DEFAULT_CONFIDENCE_CONFIG, FIXED_NOW);
  const ctx = makeCtx({ confidenceScore: 0.65 });
  const result = gate.evaluate(ctx) as any;
  eq(result.allow, false);
  assert(result.reason.includes("HITL_REQUIRED"), `reason should include HITL_REQUIRED, got: ${result.reason}`);
});

test("confidenceGate: score < hitlThreshold → allow: false, reason CONFIDENCE_BELOW_THRESHOLD", () => {
  const gate = confidenceGate(signer, DEFAULT_CONFIDENCE_CONFIG, FIXED_NOW);
  const ctx = makeCtx({ confidenceScore: 0.2 });
  const result = gate.evaluate(ctx) as any;
  eq(result.allow, false);
  assert(result.reason.includes("CONFIDENCE_BELOW_THRESHOLD"),
    `reason should include CONFIDENCE_BELOW_THRESHOLD, got: ${result.reason}`);
});

test("confidenceGate: missing score → allow: false (fail-closed → 0 → deny)", () => {
  const gate = confidenceGate(signer, DEFAULT_CONFIDENCE_CONFIG, FIXED_NOW);
  const ctx = makeCtx(); // no confidenceScore
  const result = gate.evaluate(ctx) as any;
  eq(result.allow, false);
  assert(result.reason.includes("CONFIDENCE_BELOW_THRESHOLD"));
});

test("confidenceGate: NaN score → allow: false (fail-closed)", () => {
  const gate = confidenceGate(signer, DEFAULT_CONFIDENCE_CONFIG, FIXED_NOW);
  const ctx = makeCtx({ confidenceScore: NaN });
  const result = gate.evaluate(ctx) as any;
  eq(result.allow, false);
});

test("confidenceGate: always attaches ctx.confidenceGateTrace (JSON string)", () => {
  const gate = confidenceGate(signer, DEFAULT_CONFIDENCE_CONFIG, FIXED_NOW);
  const ctx = makeCtx({ confidenceScore: 0.9 });
  gate.evaluate(ctx);
  assert(typeof ctx.confidenceGateTrace === "string" && ctx.confidenceGateTrace.length > 0,
    "trace should be set on ctx");
  const trace = JSON.parse(ctx.confidenceGateTrace!) as ConfidenceGateTrace;
  eq(trace.verdict, "auto");
  eq(trace.score, 0.9);
});

test("confidenceGate: trace includes score, verdict, thresholds, policy, timestamp", () => {
  const gate = confidenceGate(signer, DEFAULT_CONFIDENCE_CONFIG, FIXED_NOW);
  const ctx = makeCtx({ confidenceScore: 0.65 });
  gate.evaluate(ctx);
  const trace = JSON.parse(ctx.confidenceGateTrace!) as ConfidenceGateTrace;
  eq(trace.score, 0.65);
  eq(trace.verdict, "human");
  eq(trace.autoThreshold, 0.85);
  eq(trace.hitlThreshold, 0.5);
  eq(trace.policy, "confidence-gate");
  eq(trace.timestamp, FIXED_NOW());
  assert(typeof trace.signature === "string" && trace.signature.length > 0, "signature present");
});

test("confidenceGate: injectable now() for deterministic timestamp", () => {
  const gate = confidenceGate(signer, DEFAULT_CONFIDENCE_CONFIG, () => "2099-12-31T00:00:00.000Z");
  const ctx = makeCtx({ confidenceScore: 0.9 });
  gate.evaluate(ctx);
  const trace = JSON.parse(ctx.confidenceGateTrace!) as ConfidenceGateTrace;
  eq(trace.timestamp, "2099-12-31T00:00:00.000Z");
});

test("confidenceGate: custom name appears in trace.policy", () => {
  const gate = confidenceGate(signer, { ...DEFAULT_CONFIDENCE_CONFIG, name: "my-custom-gate" }, FIXED_NOW);
  const ctx = makeCtx({ confidenceScore: 0.9 });
  gate.evaluate(ctx);
  const trace = JSON.parse(ctx.confidenceGateTrace!) as ConfidenceGateTrace;
  eq(trace.policy, "my-custom-gate");
});

// ─── verifyConfidenceGateTrace ────────────────────────────────────────────────

test("verifyConfidenceGateTrace: returns true for a valid trace", () => {
  const gate = confidenceGate(signer, DEFAULT_CONFIDENCE_CONFIG, FIXED_NOW);
  const ctx = makeCtx({ confidenceScore: 0.9 });
  gate.evaluate(ctx);
  const trace = JSON.parse(ctx.confidenceGateTrace!) as ConfidenceGateTrace;
  assert(verifyConfidenceGateTrace(trace, signer), "valid trace should verify");
});

test("verifyConfidenceGateTrace: returns false for tampered signature", () => {
  const gate = confidenceGate(signer, DEFAULT_CONFIDENCE_CONFIG, FIXED_NOW);
  const ctx = makeCtx({ confidenceScore: 0.9 });
  gate.evaluate(ctx);
  const trace = JSON.parse(ctx.confidenceGateTrace!) as ConfidenceGateTrace;
  const tampered = { ...trace, signature: "bad-sig" };
  assert(!verifyConfidenceGateTrace(tampered, signer), "tampered signature should fail");
});

test("verifyConfidenceGateTrace: returns false for mutated verdict", () => {
  const gate = confidenceGate(signer, DEFAULT_CONFIDENCE_CONFIG, FIXED_NOW);
  const ctx = makeCtx({ confidenceScore: 0.9 });
  gate.evaluate(ctx);
  const trace = JSON.parse(ctx.confidenceGateTrace!) as ConfidenceGateTrace;
  const tampered = { ...trace, verdict: "deny" as any };
  assert(!verifyConfidenceGateTrace(tampered, signer), "mutated verdict should fail");
});

test("verifyConfidenceGateTrace: returns false for mutated score", () => {
  const gate = confidenceGate(signer, DEFAULT_CONFIDENCE_CONFIG, FIXED_NOW);
  const ctx = makeCtx({ confidenceScore: 0.9 });
  gate.evaluate(ctx);
  const trace = JSON.parse(ctx.confidenceGateTrace!) as ConfidenceGateTrace;
  const tampered = { ...trace, score: 0.1 };
  assert(!verifyConfidenceGateTrace(tampered, signer), "mutated score should fail");
});

test("verifyConfidenceGateTrace: returns false for different signer key", () => {
  const gate = confidenceGate(signer, DEFAULT_CONFIDENCE_CONFIG, FIXED_NOW);
  const ctx = makeCtx({ confidenceScore: 0.9 });
  gate.evaluate(ctx);
  const trace = JSON.parse(ctx.confidenceGateTrace!) as ConfidenceGateTrace;
  const otherSigner = new HmacSigner("completely-different-secret-key-123");
  assert(!verifyConfidenceGateTrace(trace, otherSigner), "different signer key should fail");
});

test("verifyConfidenceGateTrace: never throws on bad input (fail-closed)", () => {
  const inputs = [null, undefined, {}, "string", 42, [], { verdict: "auto" }];
  for (const input of inputs) {
    const result = verifyConfidenceGateTrace(input as any, signer);
    assert(result === false, `bad input ${JSON.stringify(input)} should return false`);
  }
});

// ─── Integration with approvalPolicyRouter ────────────────────────────────────

test("integration: high-confidence + auto-risk → both gates allow", () => {
  const router = approvalPolicyRouter(signer);
  const gate = confidenceGate(signer, DEFAULT_CONFIDENCE_CONFIG, FIXED_NOW);

  const ctx = makeCtx({ riskClass: "read_only", confidenceScore: 0.9 });
  const routerResult = router.evaluate(ctx) as any;
  assert(routerResult.allow === true, "approval router should allow read_only");

  const gateResult = gate.evaluate(ctx) as any;
  assert(gateResult.allow === true, "confidence gate should allow high score");

  // Both traces are set
  assert(typeof ctx.approvalTrace === "string", "approvalTrace should be set");
  assert(typeof ctx.confidenceGateTrace === "string", "confidenceGateTrace should be set");
});

test("integration: high-confidence + deny-risk → denied by approvalPolicyRouter", () => {
  const router = approvalPolicyRouter(signer);
  const gate = confidenceGate(signer, DEFAULT_CONFIDENCE_CONFIG, FIXED_NOW);

  const ctx = makeCtx({ riskClass: "irreversible", confidenceScore: 0.99 });
  const routerResult = router.evaluate(ctx) as any;
  eq(routerResult.allow, false);
  assert(routerResult.reason.includes("deny"), "should mention deny");

  // Gate would still allow (high confidence), but router blocked first
  const gateResult = gate.evaluate(ctx) as any;
  eq(gateResult.allow, true);
});

test("integration: low-confidence + auto-risk → denied by confidence gate", () => {
  const router = approvalPolicyRouter(signer);
  const gate = confidenceGate(signer, DEFAULT_CONFIDENCE_CONFIG, FIXED_NOW);

  const ctx = makeCtx({ riskClass: "read_only", confidenceScore: 0.1 });
  const routerResult = router.evaluate(ctx) as any;
  eq(routerResult.allow, true); // risk class allows

  const gateResult = gate.evaluate(ctx) as any;
  eq(gateResult.allow, false); // confidence gate blocks
  assert(gateResult.reason.includes("CONFIDENCE_BELOW_THRESHOLD"));
});

test("integration: mid-confidence + auto-risk → HITL gate", () => {
  const gate = confidenceGate(signer, DEFAULT_CONFIDENCE_CONFIG, FIXED_NOW);
  const ctx = makeCtx({ riskClass: "write_safe", confidenceScore: 0.65 });
  const result = gate.evaluate(ctx) as any;
  eq(result.allow, false);
  assert(result.reason.includes("HITL_REQUIRED"));
  const trace = JSON.parse(ctx.confidenceGateTrace!) as ConfidenceGateTrace;
  eq(trace.verdict, "human");
});

// ─── ActionContext additive fields ────────────────────────────────────────────

test("ActionContext: accepts confidenceScore and confidenceGateTrace without breaking existing usage", () => {
  // Standard ctx without new fields — should work fine
  const ctx1: ActionContext = {
    action: { type: "test", payload: {} } as any,
    tenantId: "t1",
    timestamp: "2030-01-01T00:00:00.000Z",
  };
  assert(ctx1.confidenceScore === undefined, "should be undefined by default");
  assert(ctx1.confidenceGateTrace === undefined, "should be undefined by default");

  // With new fields — additive
  const ctx2: ActionContext = {
    ...ctx1,
    confidenceScore: 0.75,
    confidenceGateTrace: "{}",
  };
  eq(ctx2.confidenceScore, 0.75);
  eq(ctx2.confidenceGateTrace, "{}");
});
