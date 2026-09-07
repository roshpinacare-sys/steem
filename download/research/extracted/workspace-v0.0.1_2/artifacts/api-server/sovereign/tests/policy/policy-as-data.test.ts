import "../_flush.mjs";
import { test, eq, assert } from "../_harness.mjs";
import { compilePolicy, validatePolicy } from "../../lib/policy/index.ts";

const ctx = (over: any = {}) => ({ action: { id: "a1", type: over.type || "ledger.mint", payload: { amount: over.amount ?? 100n }, source: over.source || "api", isFinancial: over.isFinancial ?? true, isAutonomous: over.isAutonomous ?? false, requestedAt: "t" }, tenantId: over.tenantId || "t1", timestamp: "t" } as any);

test("spending limit (μ¢ as data): allow under, deny over", () => {
  const p = compilePolicy({ name: "limit", rules: [{ if: { actionType: ["ledger.mint"], amountAbove: "1000000" }, then: "deny", reason: "over limit" }], default: "allow" });
  eq(p.evaluate(ctx({ amount: 999999n })).allow, true);
  const d = p.evaluate(ctx({ amount: 2000000n }));
  eq(d.allow, false); assert((d as any).reason.includes("over limit"), "reason carried to audit");
});
test("deny autonomous withdrawals via JSON", () => {
  const p = compilePolicy({ name: "no-auto-wd", rules: [{ if: { actionType: ["ledger.withdraw"], isAutonomous: true }, then: "deny", reason: "autonomous withdrawal blocked" }], default: "allow" });
  eq(p.evaluate(ctx({ type: "ledger.withdraw", isAutonomous: true })).allow, false);
  eq(p.evaluate(ctx({ type: "ledger.withdraw", isAutonomous: false })).allow, true);
});
test("fail-closed allow-list: unknown action denied", () => {
  const p = compilePolicy({ name: "allowlist", rules: [{ if: { actionTypeNotIn: ["ledger.mint", "ledger.transfer"] }, then: "deny", reason: "unknown action" }], default: "allow" });
  eq(p.evaluate(ctx({ type: "ledger.mint" })).allow, true);
  eq(p.evaluate(ctx({ type: "danger.delete_all" })).allow, false);
});
test("default deny when no rule matches (fail-closed by default)", () => {
  const p = compilePolicy({ name: "strict", rules: [{ if: { actionType: ["ledger.mint"] }, then: "allow" }] });
  eq(p.evaluate(ctx({ type: "ledger.mint" })).allow, true);
  eq(p.evaluate(ctx({ type: "ledger.transfer" })).allow, false); // no default → deny
});
test("invalid policy compiles to DENY-ALL (never silently allow)", () => {
  const p = compilePolicy({ name: "", rules: "nope" } as any);
  eq(p.evaluate(ctx()).allow, false);
});
test("validatePolicy reports errors", () => {
  const v = validatePolicy({ name: "x", rules: [{ if: {}, then: "deny" }] }); // deny without reason
  eq(v.ok, false); assert(v.errors.some(e => e.includes("reason")), "flags missing reason");
  const v2 = validatePolicy({ name: "ok", rules: [{ if: { amountAbove: "1000000" }, then: "deny", reason: "r" }] });
  eq(v2.ok, true);
});
test("tenant-scoped rule", () => {
  const p = compilePolicy({ name: "t", rules: [{ if: { tenantId: ["vip"] }, then: "allow" }, { if: {}, then: "deny", reason: "not vip" }] });
  eq(p.evaluate(ctx({ tenantId: "vip" })).allow, true);
  eq(p.evaluate(ctx({ tenantId: "other" })).allow, false);
});
