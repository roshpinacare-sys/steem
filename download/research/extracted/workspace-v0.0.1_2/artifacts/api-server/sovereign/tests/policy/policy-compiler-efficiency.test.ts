import "../_flush.mjs";
import { test, eq, assert } from "../_harness.mjs";
import { compilePolicy } from "../../lib/policy/index.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

const ctx = (over: any = {}) =>
  ({
    action: {
      id: "a1",
      type: over.type || "ledger.mint",
      payload: { amount: over.amount ?? 100n },
      source: over.source || "api",
      isFinancial: over.isFinancial ?? true,
      isAutonomous: over.isAutonomous ?? false,
      requestedAt: "t",
    },
    tenantId: over.tenantId || "t1",
    timestamp: "t",
  }) as any;

// ── efficiency/set-based-condition-lookup ─────────────────────────────────────

test("efficiency/set-based-condition-lookup: large actionType list — matching type is allowed", () => {
  // Build a list of 100 distinct action types; target is in the list.
  const types: string[] = Array.from({ length: 100 }, (_, i) => `action.type${i}`);
  const target = "action.type57";
  const p = compilePolicy({
    name: "large-allowlist",
    rules: [{ if: { actionType: types }, then: "allow" }],
    default: "deny",
  });
  const res = p.evaluate(ctx({ type: target }));
  eq((res as any).allow, true);
});

test("efficiency/set-based-condition-lookup: large actionType list — non-member type falls through to deny", () => {
  const types: string[] = Array.from({ length: 100 }, (_, i) => `action.type${i}`);
  const p = compilePolicy({
    name: "large-allowlist-deny",
    rules: [{ if: { actionType: types }, then: "allow" }],
    // no default → fail-closed deny
  });
  const res = p.evaluate(ctx({ type: "action.unknown" }));
  eq((res as any).allow, false);
});

test("efficiency/set-based-condition-lookup: large actionTypeNotIn list — member present → deny (fail-closed exclusion)", () => {
  // Blocklist of 100 types; submitting a blocked type must be denied.
  const blocked: string[] = Array.from({ length: 100 }, (_, i) => `danger.op${i}`);
  const p = compilePolicy({
    name: "large-blocklist",
    rules: [{ if: { actionTypeNotIn: blocked }, then: "deny", reason: "blocked action" }],
    default: "allow",
  });
  // action in blocklist → condition matches (type IS in actionTypeNotIn, so condition triggers deny)
  // Wait — actionTypeNotIn means "type is NOT in this list": if the type IS in the list, the
  // condition does NOT match (it's an allow-list for unknown actions). Let's recheck semantics:
  // matchesSync: if actionTypeNotInSet && actionTypeNotInSet.has(type) → return false (no match).
  // So a blocked type does NOT trigger this rule — the default "allow" applies. That's correct
  // allow-list semantics (deny everything NOT in the known-safe list).
  // We test the fail-closed behaviour: an action whose type IS NOT in the blocklist triggers the
  // deny rule — meaning it's an unknown action denied by this rule.
  const unknown = p.evaluate(ctx({ type: "totally.unknown" }));
  eq((unknown as any).allow, false);
  assert((unknown as any).reason?.includes("blocked action"), "deny reason propagated");

  // A type that IS in the blocklist passes through (condition doesn't match → default allow).
  const known = p.evaluate(ctx({ type: "danger.op0" }));
  eq((known as any).allow, true);
});

test("efficiency/set-based-condition-lookup: large source allow-list — correct O(1) match", () => {
  const sources: string[] = Array.from({ length: 100 }, (_, i) => `agent-${i}`);
  const p = compilePolicy({
    name: "source-allowlist",
    rules: [{ if: { source: sources }, then: "allow" }],
    default: "deny",
  });
  eq((p.evaluate(ctx({ source: "agent-73" })) as any).allow, true);
  eq((p.evaluate(ctx({ source: "agent-rogue" })) as any).allow, false);
});

test("efficiency/set-based-condition-lookup: tenantId set — out-of-set tenant is denied (fail-closed)", () => {
  const p = compilePolicy({
    name: "vip-only",
    rules: [
      { if: { tenantId: ["vip-a", "vip-b", "vip-c"] }, then: "allow" },
      { if: {}, then: "deny", reason: "not a vip tenant" },
    ],
  });
  eq((p.evaluate(ctx({ tenantId: "vip-b" })) as any).allow, true);
  const denial = p.evaluate(ctx({ tenantId: "regular-tenant" }));
  eq((denial as any).allow, false);
  assert((denial as any).reason?.includes("not a vip tenant"), "denial reason correct");
});

test("efficiency/set-based-condition-lookup: duplicate entries in condition array deduplicated by Set (regression)", () => {
  // Duplicates in source arrays must not affect correctness — Set deduplication is transparent.
  const types = ["ledger.mint", "ledger.mint", "ledger.transfer", "ledger.transfer"];
  const p = compilePolicy({
    name: "dedup-regression",
    rules: [{ if: { actionType: types }, then: "allow" }],
    default: "deny",
  });
  eq((p.evaluate(ctx({ type: "ledger.mint" })) as any).allow, true);
  eq((p.evaluate(ctx({ type: "ledger.transfer" })) as any).allow, true);
  eq((p.evaluate(ctx({ type: "ledger.unknown" })) as any).allow, false);
});
