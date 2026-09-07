/**
 * tests/risk/policy-dryrun.test.ts — Historical Policy Dry-Run.
 *
 * HAPPY        replay a batch; aggregate counts; headline; per-record diffs.
 *              candidate deny-all escalates previously-allowed actions to denied.
 * EDGE         empty history → zero report; unchanged outcomes counted; relaxed
 *              direction detected; classifyDelta unit cases across the scale.
 * FAIL-CLOSED  cross-tenant record throws; invalid recordedDecision throws;
 *              bad input shapes throw.
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  runPolicyDryRun,
  classifyDelta,
} from "../../lib/risk/policy-dryrun.ts";
import type { HistoricalActionRecord } from "../../lib/risk/policy-dryrun.ts";
import { allowAll, denyAll } from "../../lib/orchestrator/guard.ts";
import { approvalPolicyRouter } from "../../lib/risk/approval-policy.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import type { ActionIntent } from "../../lib/orchestrator/types.ts";

const signer = new HmacSigner("test-secret-32chars-minimum!!!!!");

function makeIntent(overrides: Partial<ActionIntent> = {}): ActionIntent {
  const future = new Date(Date.now() + 3600_000).toISOString();
  return {
    tenantId: "t1",
    actorId: "alice",
    toolId: "ledger.transfer",
    resourceRef: "account-42",
    riskClass: "write_safe",
    valueMicrounits: 1_000_000n,
    privacyLevel: "internal",
    approvalPolicyRef: "default",
    nonce: "nonce-" + Math.random().toString(36).slice(2),
    expiry: future,
    provenance: "api",
    evidencePolicy: "default",
    ...overrides,
  };
}

// A "safe read" tool the server classifies read_only → auto → allowed.
function makeReadIntent(overrides: Partial<ActionIntent> = {}): ActionIntent {
  return makeIntent({ toolId: "file.read", riskClass: "read_only", valueMicrounits: 0n, privacyLevel: "public", ...overrides });
}


// ─── classifyDelta unit cases ─────────────────────────────────────────────────

test("classifyDelta: covers the full severity scale", () => {
  eq(classifyDelta("allowed", "allowed"), "unchanged");
  eq(classifyDelta("allowed", "approval_required"), "escalated");
  eq(classifyDelta("allowed", "denied"), "newly_denied");
  eq(classifyDelta("approval_required", "denied"), "newly_denied");
  eq(classifyDelta("denied", "approval_required"), "relaxed");
  eq(classifyDelta("denied", "allowed"), "newly_allowed");
  eq(classifyDelta("approval_required", "allowed"), "newly_allowed");
  eq(classifyDelta("approval_required", "approval_required"), "unchanged");
});

// ─── HAPPY: deny-all candidate escalates everything to denied ──────────────────

test("HAPPY: deny-all candidate denies actions that were previously allowed", async () => {
  const history: HistoricalActionRecord[] = [
    { intent: makeReadIntent(), recordedDecision: "allowed", recordId: "a1" },
    { intent: makeReadIntent(), recordedDecision: "allowed", recordId: "a2" },
    { intent: makeIntent(), recordedDecision: "approval_required", reputationScore: 75, recordId: "a3" },
  ];
  const report = await runPolicyDryRun({
    tenantId: "t1",
    candidatePolicies: [denyAll()],
    history,
    signer,
  });

  eq(report.total, 3);
  eq(report.counts.newly_denied, 3, "all three become denied under deny-all");
  eq(report.counts.unchanged, 0);
  eq(report.changed.length, 3, "all three are changed");
  assert(report.headline.includes("3 of 3"), "headline reflects all escalated");
  assert(report.headline.includes("newly denied"), "headline notes new denials");
});

// ─── HAPPY: mixed batch produces a correct aggregate under allow-all ───────────

test("HAPPY: mixed batch aggregates unchanged + escalated correctly", async () => {
  // Under allowAll(), the approval router classifies by server risk class:
  //   file.read (read_only) → allowed; ledger.transfer (value_moving) → approval_required.
  // We label both as recorded "allowed", so the financial one escalates.
  const history: HistoricalActionRecord[] = [
    { intent: makeReadIntent(), recordedDecision: "allowed", recordId: "read-1" },
    { intent: makeIntent(), recordedDecision: "allowed", reputationScore: 75, recordId: "xfer-1" },
  ];
  const report = await runPolicyDryRun({
    tenantId: "t1",
    candidatePolicies: [allowAll(), approvalPolicyRouter(signer)],
    history,
    signer,
  });

  eq(report.total, 2);
  eq(report.records[0].replayedDecision, "allowed", "read stays allowed");
  eq(report.records[0].delta, "unchanged", "read unchanged");
  eq(report.records[1].replayedDecision, "approval_required", "transfer needs approval");
  eq(report.records[1].delta, "escalated", "transfer escalated from allowed");
  eq(report.counts.unchanged, 1);
  eq(report.counts.escalated, 1);
  eq(report.changed.length, 1, "only the transfer changed");
});

// ─── EDGE: empty history ───────────────────────────────────────────────────────

test("EDGE: empty history yields a zeroed report", async () => {
  const report = await runPolicyDryRun({
    tenantId: "t1",
    candidatePolicies: [allowAll()],
    history: [],
  });
  eq(report.total, 0);
  eq(report.changed.length, 0);
  eq(report.counts.unchanged, 0);
  eq(report.headline, "no history to replay");
});

// ─── EDGE: relaxed direction is detected ───────────────────────────────────────

test("EDGE: a previously-denied action that now passes is classified relaxed/newly_allowed", async () => {
  // Recorded as denied; candidate allow-all on a safe read → allowed → newly_allowed.
  const report = await runPolicyDryRun({
    tenantId: "t1",
    candidatePolicies: [allowAll()],
    history: [{ intent: makeReadIntent(), recordedDecision: "denied", recordId: "r1" }],
  });
  eq(report.total, 1);
  const rec = report.records[0];
  assert(
    rec.delta === "newly_allowed" || rec.delta === "relaxed",
    `expected relaxation, got ${rec.delta}`
  );
  assert(report.counts.newly_denied === 0, "no new denials");
});

// ─── FAIL-CLOSED: cross-tenant record rejected ─────────────────────────────────

test("FAIL-CLOSED: a record from another tenant throws (no silent mixing)", async () => {
  let threw = false;
  try {
    await runPolicyDryRun({
      tenantId: "t1",
      candidatePolicies: [allowAll()],
      history: [{ intent: makeReadIntent({ tenantId: "t2" }), recordedDecision: "allowed" }],
    });
  } catch (e) {
    threw = true;
    assert(String((e as Error).message).includes("cross-tenant"), "error names the cross-tenant cause");
  }
  assert(threw, "cross-tenant record must throw");
});

// ─── FAIL-CLOSED: invalid recordedDecision throws ──────────────────────────────

test("FAIL-CLOSED: invalid recordedDecision throws", async () => {
  let threw = false;
  try {
    await runPolicyDryRun({
      tenantId: "t1",
      candidatePolicies: [allowAll()],
      history: [{ intent: makeReadIntent(), recordedDecision: "maybe" as any }],
    });
  } catch {
    threw = true;
  }
  assert(threw, "invalid recordedDecision must throw");
});

// ─── FAIL-CLOSED: bad input shapes throw ───────────────────────────────────────

test("FAIL-CLOSED: missing tenantId / non-array fields throw", async () => {
  let a = false, b = false, c = false;
  try { await runPolicyDryRun({ candidatePolicies: [], history: [] } as any); } catch { a = true; }
  try { await runPolicyDryRun({ tenantId: "t1", candidatePolicies: {} as any, history: [] }); } catch { b = true; }
  try { await runPolicyDryRun({ tenantId: "t1", candidatePolicies: [], history: {} as any }); } catch { c = true; }
  assert(a, "missing tenantId throws");
  assert(b, "non-array candidatePolicies throws");
  assert(c, "non-array history throws");
});
