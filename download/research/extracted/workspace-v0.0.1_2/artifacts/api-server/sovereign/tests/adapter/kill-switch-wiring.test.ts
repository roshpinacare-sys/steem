import "../_flush.mjs";
/**
 * tests/adapter/kill-switch-wiring.test.ts — v225.
 * KillSwitch wired into the adapter chokepoint: allowed → denied when tripped.
 */
import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import {
  runActionThroughTfa, verifyExecutionReceipt,
} from "../../lib/adapter/agent-adapter.ts";
import { KillSwitch } from "../../lib/policy/kill-switch.ts";

const signer = new HmacSigner("ks-wiring-test-secret");

function intent(over: Record<string, unknown> = {}) {
  return {
    tenantId: "t1", actorId: "agent:1", toolId: "file.read", resourceRef: "res:1",
    riskClass: "read_only", valueMicrounits: 0n, privacyLevel: "internal",
    approvalPolicyRef: "pol:default", nonce: "nonce-" + Math.random().toString(36).slice(2),
    expiry: "2099-01-01T00:00:00.000Z", provenance: "agent", evidencePolicy: "ev:default",
    ...over,
  } as any;
}

// ── FEATURE: kill-switch tripped → allowed becomes denied ──
test("global kill-switch trips adapter decision from allowed to denied", () => {
  const ks = new KillSwitch();
  ks.engageGlobal("incident-2026-06");

  const r = runActionThroughTfa(intent({ toolId: "file.read" }), signer, { killSwitch: ks });
  eq(r.decision, "denied");
  eq(r.receipt.decision, "denied");
  assert(r.receipt.killSwitchVerdict?.tripped);
  eq(r.receipt.killSwitchVerdict?.scope, "global");
  eq(r.receipt.killSwitchVerdict?.reason, "incident-2026-06");
  assert(verifyExecutionReceipt(r.receipt, signer), "receipt must self-verify with killSwitchVerdict");
});

test("tenant kill-switch trips only for matching tenant", () => {
  const ks = new KillSwitch();
  ks.engageTenant("t-bad", "compromised key");

  const good = runActionThroughTfa(intent({ tenantId: "t-good", toolId: "file.read" }), signer, { killSwitch: ks });
  eq(good.decision, "allowed");
  eq(good.receipt.killSwitchVerdict?.tripped, false);
  assert(verifyExecutionReceipt(good.receipt, signer));

  const bad = runActionThroughTfa(intent({ tenantId: "t-bad", toolId: "file.read" }), signer, { killSwitch: ks });
  eq(bad.decision, "denied");
  assert(bad.receipt.killSwitchVerdict?.tripped);
  eq(bad.receipt.killSwitchVerdict?.scope, "tenant");
  assert(verifyExecutionReceipt(bad.receipt, signer));
});

test("action-type kill-switch trips only for matching toolId", () => {
  const ks = new KillSwitch();
  ks.engageActionType("shell.exec", "freeze during incident");

  const safe = runActionThroughTfa(intent({ toolId: "file.read" }), signer, { killSwitch: ks });
  eq(safe.decision, "allowed");
  eq(safe.receipt.killSwitchVerdict?.tripped, false);

  const dangerous = runActionThroughTfa(intent({ toolId: "shell.exec" }), signer, { killSwitch: ks });
  eq(dangerous.decision, "denied");
  assert(dangerous.receipt.killSwitchVerdict?.tripped);
  eq(dangerous.receipt.killSwitchVerdict?.scope, "action_type");
});

test("approval_required also downgraded to denied when kill-switch tripped", () => {
  const ks = new KillSwitch();
  ks.engageGlobal("halt");

  const r = runActionThroughTfa(intent({ toolId: "ledger.mint", valueMicrounits: 500000n }), signer, { killSwitch: ks });
  eq(r.decision, "denied");
  eq(r.receipt.decision, "denied");
  assert(r.receipt.killSwitchVerdict?.tripped);
});

// ── FAIL-CLOSED: no killSwitch passed → no denial ──
test("absent killSwitch does not affect decision", () => {
  const r = runActionThroughTfa(intent({ toolId: "file.read" }), signer);
  eq(r.decision, "allowed");
  eq(r.receipt.killSwitchVerdict, undefined);
});

// ── EDGE: tampering with killSwitchVerdict breaks verification ──
test("tampering killSwitchVerdict breaks receipt verification", () => {
  const ks = new KillSwitch();
  ks.engageGlobal("halt");
  const { receipt } = runActionThroughTfa(intent({ toolId: "file.read" }), signer, { killSwitch: ks });
  assert(verifyExecutionReceipt(receipt, signer), "baseline verifies");

  const tampered = { ...receipt, killSwitchVerdict: { tripped: false } } as any;
  assert(!verifyExecutionReceipt(tampered, signer), "tampered verdict fails verify");
});
