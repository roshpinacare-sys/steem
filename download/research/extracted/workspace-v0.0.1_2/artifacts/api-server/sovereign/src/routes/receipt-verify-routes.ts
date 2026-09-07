/**
 * src/routes/receipt-verify-routes.ts — Receipt verification endpoint.
 *
 * POST /api/receipt/verify
 *   Body:  { receipt: ExecutionReceipt }
 *   Returns: { signatureValid: boolean; decisionValid: boolean; reasons: string[] }
 *
 * Pairs two independent verifications:
 *   1. verifyExecutionReceipt — signature authenticity (not tampered, signed by TFA).
 *   2. verifyDecisionIntegrity — decision correctness (re-derived from server-side policy).
 *
 * fail-closed: any missing/invalid input → 400; malformed receipt → both flags false with reasons.
 */
import type { Signer } from "../../lib/orchestrator/types.ts";
import { verifyExecutionReceipt, type ExecutionReceipt } from "../../lib/adapter/agent-adapter.ts";
import { verifyDecisionIntegrity } from "../../lib/adapter/decision-integrity.ts";
import { verifyTfaProof } from "../../lib/adapter/verify-tfa-proof.ts";

export interface Ctx {
  tenantId: string;
  body: any;
  params: Record<string, string>;
  headers?: Record<string, string | string[] | undefined>;
}

export interface Res {
  status: number;
  body: any;
  headers?: Record<string, string>;
}

export interface Route {
  method: string;
  pattern: string;
  handler: (ctx: Ctx) => Promise<Res> | Res;
}

const ok = (body: any, status = 200): Res => ({ status, body });
const err = (status: number, message: string): Res => ({ status, body: { error: message } });

export function receiptVerifyRoutes(signer: Signer): Route[] {
  return [
    {
      method: "POST",
      pattern: "/api/receipt/verify",
      handler: async (c: Ctx): Promise<Res> => {
        const b = c.body ?? {};
        const receipt = b.receipt;
        if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
          return err(400, "receipt must be an object");
        }

        const r = receipt as Record<string, unknown>;
        const version = r.version;
        let signatureValid = false;
        let decisionValid = false;
        const reasons: string[] = [];

        if (version === "tfa-receipt-v1") {
          signatureValid = verifyExecutionReceipt(r as unknown as ExecutionReceipt, signer);
          const di = verifyDecisionIntegrity(r as unknown as ExecutionReceipt);
          decisionValid = di.valid;
          if (!di.valid && di.reasons.length > 0) {
            reasons.push(...di.reasons);
          }
        } else if (version === "tfa-status-receipt-v1") {
          // Decision integrity applies only to execution receipts; status receipts are
          // state attestations without a policy decision to re-derive.
          signatureValid = verifyExecutionReceipt(r as unknown as ExecutionReceipt, signer);
          decisionValid = true; // no decision to validate; signature is the only claim
        } else {
          signatureValid = false;
          decisionValid = false;
          reasons.push("unknown receipt version");
        }

        // v273: when an AP2 mandate linkage is supplied, run the unified verifier so
        // the caller gets one authoritative verdict including the linkage binding.
        // Additive — the existing fields are unchanged when no linkage is sent.
        let mandateLinkageValid: boolean | undefined;
        if (version === "tfa-receipt-v1" && b.mandateLinkage && typeof b.mandateLinkage === "object") {
          const verdict = verifyTfaProof(r as unknown as ExecutionReceipt, {
            keys: signer,
            mandateLinkage: b.mandateLinkage,
          });
          mandateLinkageValid = verdict.checks.mandateLinkage === true;
          if (!mandateLinkageValid) {
            for (const reason of verdict.reasons) {
              if (reason.startsWith("mandateLinkage")) reasons.push(reason);
            }
          }
        }

        return ok({
          ok: true,
          valid: signatureValid && decisionValid && (mandateLinkageValid !== false),
          signatureValid,
          decisionValid,
          ...(mandateLinkageValid !== undefined ? { mandateLinkageValid } : {}),
          reasons,
        });
      },
    },
  ];
}
