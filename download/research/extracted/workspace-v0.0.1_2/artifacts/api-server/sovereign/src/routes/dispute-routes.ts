/**
 * src/routes/dispute-routes.ts — Billing-dispute proof endpoint.
 *
 * Routes:
 *
 *   POST /api/dispute/proof
 *     Given the authorized amount, the amount actually billed, and the TFA
 *     decision for an intent, builds and signs a portable BillingDisputeProof
 *     that a tenant can hand to a vendor or mediator.
 *
 *     Body: {
 *       intentId: string,
 *       authorizedMicrounits: string,   // decimal, >= 0 ("0" when denied)
 *       billedMicrounits: string,       // decimal, > 0
 *       decision: string,               // e.g. "allowed" | "denied"
 *     }
 *     All monetary amounts are decimal strings (JSON can't represent BigInt).
 *
 *     Response 200: { ok: true, proof: BillingDisputeProof }
 *
 * Invariants:
 *   • Missing x-tenant-id → 400.
 *   • intentId/decision must be non-empty strings → else 400.
 *   • authorizedMicrounits/billedMicrounits must be valid decimal integer
 *     strings (authorized >= 0, billed > 0) → 400 on bad parse.
 *   • No discrepancy (billed === authorized and decision isn't "denied") → 400
 *     (BillingDisputeProofError surfaces as a 400, not a 500 — it's a caller
 *     input problem, not a server fault).
 *   • The proof is signed with the kernel signer (same provenance key as
 *     passports/receipts) — no store write, this is a pure read+sign.
 *   • Unexpected errors re-thrown → 500 (fail-closed).
 */

import { buildBillingDisputeProof, BillingDisputeProofError } from "../../lib/track-record/billing-dispute-proof.ts";
import type { SovereignStack } from "../composition.ts";
import type { Route } from "./sovereign-routes.ts";

interface Ctx {
  tenantId: string;
  body: any;
  params: Record<string, string>;
  query?: Record<string, string>;
  scopes?: string[];
}
type Res = { status: number; body: unknown };
const ok = (body: unknown): Res => ({ status: 200, body });
const err = (status: number, message: string): Res => ({ status, body: { ok: false, error: message } });

/** Parse a decimal-string BigInt that must be >= 0. Returns null on failure. */
function parseMc(s: unknown): bigint | null {
  if (typeof s !== "string" || !/^[0-9]+$/.test(s)) return null;
  try { return BigInt(s); } catch { return null; }
}

function nonEmptyString(s: unknown): s is string {
  return typeof s === "string" && s.trim() !== "";
}

export function disputeRoutes(stack: SovereignStack): Route[] {
  return [
    {
      method: "POST",
      pattern: "/api/dispute/proof",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");

        const body = c.body;
        if (!body || typeof body !== "object") {
          return err(400, "body must be an object");
        }
        if (!nonEmptyString(body.intentId)) {
          return err(400, "body.intentId must be a non-empty string");
        }
        if (!nonEmptyString(body.decision)) {
          return err(400, "body.decision must be a non-empty string");
        }
        const authorizedMicrounits = parseMc(body.authorizedMicrounits);
        if (authorizedMicrounits === null) {
          return err(400, "body.authorizedMicrounits must be a non-negative decimal integer string");
        }
        const billedMicrounits = parseMc(body.billedMicrounits);
        if (billedMicrounits === null || billedMicrounits === 0n) {
          return err(400, "body.billedMicrounits must be a positive decimal integer string");
        }

        try {
          const proof = buildBillingDisputeProof({
            tenantId: c.tenantId,
            intentId: body.intentId,
            authorizedMicrounits,
            billedMicrounits,
            decision: body.decision,
            signer: stack.signer,
            signerId: "kernel",
          });
          return ok({ ok: true, proof });
        } catch (e) {
          if (e instanceof BillingDisputeProofError) return err(400, e.message);
          throw e;
        }
      },
    },
  ];
}
