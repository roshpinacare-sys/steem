/**
 * src/routes/confidence-routes.ts — ConfidenceGate HTTP routes.
 *
 * Routes:
 *   POST /api/confidence/evaluate
 *     Accept an action description + confidenceScore, run it through the
 *     ConfidenceGate GuardPolicy, and return the signed trace.
 *
 *   POST /api/confidence/verify
 *     Verify the signature on a previously returned ConfidenceGateTrace.
 *
 * Design:
 *   • Same Ctx/Res contract as sovereign-routes.ts — zero framework lock-in.
 *   • tenantId is mandatory; cross-tenant leakage is impossible (trace carries
 *     no tenant-scoped data, but the evaluation is logged per-tenant).
 *   • Thresholds are configurable per-request (autoThreshold, hitlThreshold);
 *     omitting both uses DEFAULT_CONFIDENCE_CONFIG.
 *   • fail-closed: missing/invalid confidenceScore → deny; invalid thresholds
 *     in the request → 400 (misconfiguration, not a security event).
 *   • All verdicts carry a signed ConfidenceGateTrace so callers can prove
 *     the gate's decision to downstream auditors.
 */

import type { Route, Ctx, Res } from "./sovereign-routes.ts";
import type { Signer } from "../../lib/orchestrator/types.ts";
import {
  confidenceGate,
  verifyConfidenceGateTrace,
  DEFAULT_CONFIDENCE_CONFIG,
  ConfidenceGateError,
  type ConfidenceGateConfig,
} from "../../lib/risk/confidence-gate.ts";

const ok = (body: any, status = 200): Res => ({ status, body });
const err = (status: number, message: string): Res => ({ status, body: { error: message } });

/**
 * Build the two ConfidenceGate HTTP routes.
 *
 * @param signer — the stack's kernel signer (HMAC or Ed25519). The trace
 *   signature is produced with this key, so verifiers must possess the
 *   same public key / secret to check it offline.
 */
export function confidenceRoutes(signer: Signer): Route[] {
  return [
    // ── POST /api/confidence/evaluate ──────────────────────────────────────────
    {
      method: "POST",
      pattern: "/api/confidence/evaluate",
      handler: (ctx: Ctx): Res => {
        const { confidenceScore, actionType, autoThreshold, hitlThreshold } = ctx.body || {};

        // Build config from request (additive overrides) or fall back to defaults
        const cfg: ConfidenceGateConfig = {
          autoThreshold:
            typeof autoThreshold === "number" ? autoThreshold : DEFAULT_CONFIDENCE_CONFIG.autoThreshold,
          hitlThreshold:
            typeof hitlThreshold === "number" ? hitlThreshold : DEFAULT_CONFIDENCE_CONFIG.hitlThreshold,
          name: DEFAULT_CONFIDENCE_CONFIG.name,
        };

        // Validate config before constructing the gate — fail-fast on bad input
        try {
          const gate = confidenceGate(signer, cfg);
          const evalCtx = {
            action: {
              id: "confidence-eval",
              tenantId: ctx.tenantId,
              type: typeof actionType === "string" ? actionType : "confidence.evaluate",
              payload: ctx.body || {},
              source: "api",
              isFinancial: false,
              isAutonomous: false,
              requestedAt: new Date().toISOString(),
            },
            tenantId: ctx.tenantId,
            timestamp: new Date().toISOString(),
            confidenceScore: typeof confidenceScore === "number" ? confidenceScore : undefined,
          };
          const result = gate.evaluate(evalCtx);
          const verdict = (result as any).allow
            ? "auto"
            : result.reason?.includes("HITL_REQUIRED")
              ? "human"
              : "deny";

          return ok({
            ok: true,
            verdict,
            allow: (result as any).allow === true,
            trace: evalCtx.confidenceGateTrace ? JSON.parse(evalCtx.confidenceGateTrace) : null,
          });
        } catch (e: unknown) {
          if (e instanceof ConfidenceGateError) {
            return err(400, `invalid confidence gate configuration: ${(e as ConfidenceGateError).message}`);
          }
          return err(500, `confidence gate evaluation failed: ${(e as Error).message}`);
        }
      },
    },

    // ── POST /api/confidence/verify ──────────────────────────────────────────
    {
      method: "POST",
      pattern: "/api/confidence/verify",
      handler: (ctx: Ctx): Res => {
        const { trace } = ctx.body || {};
        if (!trace || typeof trace !== "object") {
          return err(400, "trace object required in body");
        }
        const valid = verifyConfidenceGateTrace(trace, signer);
        return ok({ ok: true, valid });
      },
    },
  ];
}
