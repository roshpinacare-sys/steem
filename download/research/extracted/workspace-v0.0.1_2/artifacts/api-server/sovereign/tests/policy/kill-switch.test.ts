/**
 * tests/policy/kill-switch.test.ts — v224.
 * KillSwitch: emergency stop / circuit breaker (use-breaking gap, OWASP Agentic).
 */
import { test, assert, eq } from "../_harness.mjs";
import { KillSwitch, applyKillSwitch } from "../../lib/policy/kill-switch.ts";

test("global kill-switch trips everything", () => {
  const ks = new KillSwitch();
  eq(ks.isArmed, false);
  ks.engageGlobal("incident-2026-06");
  assert(ks.isArmed);
  const v = ks.isTripped({ tenantId: "t1", actionType: "file.read" });
  assert(v.tripped && v.scope === "global"); eq(v.reason, "incident-2026-06");
  ks.disengageGlobal();
  eq(ks.isTripped({ tenantId: "t1" }).tripped, false);
});

test("tenant kill-switch halts only that tenant", () => {
  const ks = new KillSwitch();
  ks.engageTenant("t-bad", "compromised key");
  assert(ks.isTripped({ tenantId: "t-bad" }).tripped);
  eq(ks.isTripped({ tenantId: "t-good" }).tripped, false);
  eq(ks.isTripped({ tenantId: "t-bad" }).scope, "tenant");
});

test("action-type kill-switch halts one class cross-tenant", () => {
  const ks = new KillSwitch();
  ks.engageActionType("infra.apply", "freeze during incident");
  assert(ks.isTripped({ tenantId: "t1", actionType: "infra.apply" }).tripped);
  assert(ks.isTripped({ tenantId: "t2", actionType: "infra.apply" }).tripped);
  eq(ks.isTripped({ tenantId: "t1", actionType: "file.read" }).tripped, false);
});

test("applyKillSwitch downgrades any decision to denied when tripped", () => {
  const ks = new KillSwitch();
  eq(applyKillSwitch("allowed", ks, { tenantId: "t1" }).decision, "allowed");
  eq(applyKillSwitch("approval_required", ks, { tenantId: "t1" }).decision, "approval_required");
  ks.engageGlobal("halt");
  const r = applyKillSwitch("allowed", ks, { tenantId: "t1", actionType: "file.read" });
  eq(r.decision, "denied");
  assert(r.killSwitch.tripped && r.killSwitch.reason === "halt");
});

test("fail-closed: malformed check trips; empty engage args throw", () => {
  const ks = new KillSwitch();
  assert(ks.isTripped(null as any).tripped);
  for (const bad of ["", null, undefined]) {
    let t1 = false; try { ks.engageTenant(bad as any, "r"); } catch { t1 = true; }
    assert(t1);
    let t2 = false; try { ks.engageGlobal(bad as any); } catch { t2 = true; }
    assert(t2);
  }
  ks.engageActionType("token.swap", "audit");
  eq(ks.snapshot().actionTypes[0], "token.swap");
});
