import "../_flush.mjs";
/**
 * tests/risk/approval-policy-score-once.test.ts
 *
 * v384 efficiency: on the legacy path (no reputationScore), scoreContextualRisk
 * is called once and the result is reused in trace creation — not recomputed.
 *
 * Observable invariants:
 *   1. Happy path   — trace.contextualRisk.effectiveApprovalClass matches the
 *                     allow/deny decision (same result used for both).
 *   2. Edge case    — escalated contextual signal raises both the decision AND
 *                     the trace faithfully (coherence: one result, two consumers).
 *   3. Fail-closed  — irreversible riskClass → deny; trace.approvalClass=deny.
 */

import { test, assert, eq } from "../_harness.mjs";
import { approvalPolicyRouter } from "../../lib/risk/approval-policy.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import type { ActionContext, Action } from "../../lib/orchestrator/types.ts";

function makeSigner(): HmacSigner {
  return new HmacSigner("test-secret-score-once-32bytekey!");
}

function makeCtx(
  riskClass: string,
  riskContext?: Record<string, unknown>,
): ActionContext {
  const ctx: ActionContext = {
    tenantId: "t1",
    action: { id: "a1", tenantId: "t1", type: "marketplace:create" } as Action,
    riskClass: riskClass as ActionContext["riskClass"],
  } as unknown as ActionContext;
  if (riskContext) (ctx as any).riskContext = riskContext;
  return ctx;
}

// ─── 1. Happy path ────────────────────────────────────────────────────────────

test(
  "score-once: legacy path — trace.approvalClass matches decision (auto for write_safe)",
  () => {
    const router = approvalPolicyRouter(makeSigner());
    const ctx = makeCtx("write_safe");
    const result = router.evaluate(ctx);

    assert(result.allow === true, "expected allow for write_safe");
    assert(typeof (ctx as any).approvalTrace === "string", "approvalTrace must be set");

    const trace = JSON.parse((ctx as any).approvalTrace as string);
    eq(trace.approvalClass, "auto", "trace.approvalClass should be auto for write_safe");
    assert(typeof trace.signature === "string" && trace.signature.length > 0, "trace must be signed");
  },
);

// ─── 2. Edge case: contextual escalation ─────────────────────────────────────

test(
  "score-once: contextual escalation — decision and trace are coherent (same computed result)",
  () => {
    // high velocity pushes write_safe → escalated class in contextual risk.
    const router = approvalPolicyRouter(makeSigner());
    const ctx = makeCtx("write_safe", { velocityScore: 100 });
    const result = router.evaluate(ctx);

    assert(typeof (ctx as any).approvalTrace === "string", "approvalTrace must be set");
    const trace = JSON.parse((ctx as any).approvalTrace as string);

    // The effective class in the trace must match the allow/deny decision.
    const traceAllows = trace.approvalClass !== "deny";
    eq(
      traceAllows,
      result.allow as boolean,
      "trace.approvalClass allow/deny must match the evaluated decision",
    );

    // contextualRisk block must be present (populated from the one computed result).
    assert(
      trace.contextualRisk !== undefined,
      "trace.contextualRisk must be present on the legacy path",
    );
    eq(
      trace.contextualRisk.effectiveApprovalClass,
      trace.approvalClass,
      "contextualRisk.effectiveApprovalClass must equal trace.approvalClass",
    );
  },
);

// ─── 3. Fail-closed ───────────────────────────────────────────────────────────

test(
  "score-once: fail-closed — irreversible riskClass → deny; trace.approvalClass=deny",
  () => {
    const router = approvalPolicyRouter(makeSigner());
    const ctx = makeCtx("irreversible");
    const result = router.evaluate(ctx);

    eq(result.allow, false, "irreversible must be denied");
    assert(typeof (ctx as any).approvalTrace === "string", "approvalTrace must be set on deny");

    const trace = JSON.parse((ctx as any).approvalTrace as string);
    eq(trace.approvalClass, "deny", "trace.approvalClass must be deny for irreversible");
    assert(typeof trace.signature === "string" && trace.signature.length > 0, "denied trace must be signed");
  },
);
