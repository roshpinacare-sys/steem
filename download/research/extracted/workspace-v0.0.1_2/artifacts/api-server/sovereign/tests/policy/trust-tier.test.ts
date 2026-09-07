import "../_flush.mjs";
/**
 * tests/policy/trust-tier.test.ts — Trust-Tier Policy (v87)
 *
 * minTrustScore is the heart of Trust Price Discovery: a policy can require
 * a minimum verified trust score before granting an action. The score is
 * computed from the signed audit+escrow chain — it cannot be faked without
 * breaking cryptographic proofs.
 *
 * Coverage:
 *   • allow when actor score meets threshold
 *   • deny when actor score is below threshold
 *   • fail-closed when no TrustScoreProvider is configured (no provider = deny)
 *   • fail-closed when source is empty/missing
 *   • combined condition: minTrustScore AND actionType (both must match)
 *   • validatePolicy rejects out-of-range minTrustScore
 *   • sync-path unaffected: policies without minTrustScore still work synchronously
 *   • compilePolicies forwards opts to each compiled policy
 */
import { test, eq, assert } from "../_harness.mjs";
import { compilePolicy, compilePolicies, validatePolicy } from "../../lib/policy/index.ts";
import type { TrustScoreProvider } from "../../lib/policy/index.ts";

function ctx(over: any = {}): any {
  return {
    action: {
      id: "a1",
      type: over.type || "ledger.transfer",
      payload: { amount: over.amount ?? 100n },
      source: over.source ?? "agent-x",
      isFinancial: over.isFinancial ?? true,
      isAutonomous: over.isAutonomous ?? false,
      requestedAt: "t",
    },
    tenantId: over.tenantId || "t1",
    timestamp: "t",
  };
}

const makeProvider = (scoreMap: Record<string, number>): TrustScoreProvider =>
  async (tenantId: string, identityId: string) => scoreMap[`${tenantId}:${identityId}`] ?? 0;

// ─── Core allow/deny ──────────────────────────────────────────────────────────

test("minTrustScore: allow when score meets threshold", async () => {
  const provider = makeProvider({ "t1:agent-x": 75 });
  const p = compilePolicy(
    { name: "trust-gate", rules: [{ if: { minTrustScore: 70 }, then: "allow" }], default: "deny" },
    { trustScoreProvider: provider },
  );
  const d = await p.evaluate(ctx());
  eq(d.allow, true);
});

test("minTrustScore: deny when score is below threshold", async () => {
  const provider = makeProvider({ "t1:agent-x": 60 });
  const p = compilePolicy(
    { name: "trust-gate", rules: [{ if: { minTrustScore: 70 }, then: "allow" }], default: "deny" },
    { trustScoreProvider: provider },
  );
  const d = await p.evaluate(ctx());
  eq(d.allow, false);
  assert((d as any).reason?.includes("default deny") || (d as any).reason?.includes("no rule matched"), "default deny reason present");
});

test("minTrustScore: exact threshold boundary — score equal to threshold allows", async () => {
  const provider = makeProvider({ "t1:agent-x": 70 });
  const p = compilePolicy(
    { name: "boundary", rules: [{ if: { minTrustScore: 70 }, then: "allow" }], default: "deny" },
    { trustScoreProvider: provider },
  );
  eq((await p.evaluate(ctx())).allow, true);
});

test("minTrustScore: score one below boundary denies", async () => {
  const provider = makeProvider({ "t1:agent-x": 69 });
  const p = compilePolicy(
    { name: "boundary", rules: [{ if: { minTrustScore: 70 }, then: "allow" }], default: "deny" },
    { trustScoreProvider: provider },
  );
  eq((await p.evaluate(ctx())).allow, false);
});

// ─── Fail-closed ──────────────────────────────────────────────────────────────

test("minTrustScore: fail-closed — no provider → condition never matches → default deny", async () => {
  const p = compilePolicy(
    { name: "trust-gate-noprov", rules: [{ if: { minTrustScore: 50 }, then: "allow" }], default: "deny" },
    // no trustScoreProvider
  );
  const d = await p.evaluate(ctx());
  eq(d.allow, false);
});

test("minTrustScore: fail-closed — empty source → deny", async () => {
  const provider = makeProvider({ "t1:": 80 }); // no score for empty key
  const p = compilePolicy(
    { name: "trust-gate-nosrc", rules: [{ if: { minTrustScore: 50 }, then: "allow" }], default: "deny" },
    { trustScoreProvider: provider },
  );
  const d = await p.evaluate(ctx({ source: "" }));
  eq(d.allow, false);
});

// ─── Combined conditions ──────────────────────────────────────────────────────

test("minTrustScore + actionType: both must match — allow", async () => {
  const provider = makeProvider({ "t1:agent-x": 80 });
  const p = compilePolicy(
    {
      name: "combined",
      rules: [{ if: { minTrustScore: 70, actionType: ["ledger.transfer"] }, then: "allow" }],
      default: "deny",
    },
    { trustScoreProvider: provider },
  );
  eq((await p.evaluate(ctx({ type: "ledger.transfer" }))).allow, true);
});

test("minTrustScore + actionType: score ok but wrong action type → deny", async () => {
  const provider = makeProvider({ "t1:agent-x": 80 });
  const p = compilePolicy(
    {
      name: "combined",
      rules: [{ if: { minTrustScore: 70, actionType: ["ledger.transfer"] }, then: "allow" }],
      default: "deny",
    },
    { trustScoreProvider: provider },
  );
  eq((await p.evaluate(ctx({ type: "ledger.mint" }))).allow, false);
});

test("minTrustScore + actionType: action type ok but score too low → deny", async () => {
  const provider = makeProvider({ "t1:agent-x": 40 });
  const p = compilePolicy(
    {
      name: "combined",
      rules: [{ if: { minTrustScore: 70, actionType: ["ledger.transfer"] }, then: "allow" }],
      default: "deny",
    },
    { trustScoreProvider: provider },
  );
  eq((await p.evaluate(ctx({ type: "ledger.transfer" }))).allow, false);
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

test("minTrustScore: tenant isolation — same agent, different tenants get independent scores", async () => {
  const provider = makeProvider({ "t1:agent-x": 80, "t2:agent-x": 30 });
  const p = compilePolicy(
    { name: "trust-tenant", rules: [{ if: { minTrustScore: 70 }, then: "allow" }], default: "deny" },
    { trustScoreProvider: provider },
  );
  eq((await p.evaluate(ctx({ tenantId: "t1" }))).allow, true);
  eq((await p.evaluate(ctx({ tenantId: "t2" }))).allow, false);
});

// ─── Validation ───────────────────────────────────────────────────────────────

test("validatePolicy: rejects minTrustScore > 100", () => {
  const v = validatePolicy({ name: "x", rules: [{ if: { minTrustScore: 150 }, then: "allow" }] });
  eq(v.ok, false);
  assert(v.errors.some(e => e.includes("minTrustScore")), "flags invalid minTrustScore");
});

test("validatePolicy: rejects minTrustScore < 0", () => {
  const v = validatePolicy({ name: "x", rules: [{ if: { minTrustScore: -1 }, then: "allow" }] });
  eq(v.ok, false);
  assert(v.errors.some(e => e.includes("minTrustScore")), "flags negative minTrustScore");
});

test("validatePolicy: rejects non-number minTrustScore", () => {
  const v = validatePolicy({ name: "x", rules: [{ if: { minTrustScore: "high" as any }, then: "allow" }] });
  eq(v.ok, false);
  assert(v.errors.some(e => e.includes("minTrustScore")), "flags string minTrustScore");
});

test("validatePolicy: accepts valid minTrustScore 0", () => {
  const v = validatePolicy({ name: "x", rules: [{ if: { minTrustScore: 0 }, then: "allow" }] });
  eq(v.ok, true);
});

test("validatePolicy: accepts valid minTrustScore 100", () => {
  const v = validatePolicy({ name: "x", rules: [{ if: { minTrustScore: 100 }, then: "allow" }] });
  eq(v.ok, true);
});

// ─── Backward compatibility ───────────────────────────────────────────────────

test("sync-path unaffected: policy without minTrustScore evaluates synchronously", () => {
  const p = compilePolicy({
    name: "sync",
    rules: [{ if: { actionType: ["ledger.mint"], amountAbove: "1000" }, then: "deny", reason: "over limit" }],
    default: "allow",
  });
  const d = p.evaluate(ctx({ type: "ledger.mint", amount: 2000n }));
  // Must be a plain GuardDecision (not a Promise) for sync policies
  assert(typeof (d as any).then !== "function", "sync policy evaluate returns GuardDecision, not Promise");
  eq((d as any).allow, false);
});

test("compilePolicies: forwards opts to each compiled policy", async () => {
  const provider = makeProvider({ "t1:agent-x": 90 });
  const policies = compilePolicies(
    [
      { name: "p1", rules: [{ if: { minTrustScore: 80 }, then: "allow" }], default: "deny" },
      { name: "p2", rules: [{ if: { actionType: ["ledger.transfer"] }, then: "allow" }], default: "deny" },
    ],
    { trustScoreProvider: provider },
  );
  eq(policies.length, 2);
  eq((await policies[0].evaluate(ctx())).allow, true);  // score 90 >= 80
  eq((await policies[1].evaluate(ctx())).allow, true);  // action type matches
});
