/**
 * src/routes/drift-explain-routes.ts — §2.C sub-step 9: Drift explainability
 *
 * Routes:
 *   POST /api/risk/drift-explain
 *     Accept { agentId, records: DriftRecord[], context? }, run
 *     explainDriftCompliance, and return a DriftComplianceReport.
 *
 * Design:
 *   • tenantId is mandatory (x-tenant-id header). The drift records are supplied
 *     by the caller; the endpoint does not fetch history itself (same pattern as
 *     assessRisk — caller owns the store).
 *   • fail-closed: < 2 records, missing agentId, or invalid record fields → 400.
 *   • No auth required beyond tenantId (read-only compliance query).
 */

import type { Route, Ctx, Res } from "./sovereign-routes.ts";
import {
  explainDriftCompliance,
  type DriftExplainInput,
} from "../../lib/risk/drift-explain.ts";

const ok = (body: unknown): Res => ({ status: 200, body });
const err = (status: number, message: string): Res => ({ status, body: { error: message } });

export function driftExplainRoutes(): Route[] {
  return [
    // ── POST /api/risk/drift-explain ──────────────────────────────────────────
    {
      method: "POST",
      pattern: "/api/risk/drift-explain",
      handler: (ctx: Ctx): Res => {
        const tenantId = ctx.headers?.["x-tenant-id"];
        if (!tenantId) return err(400, "x-tenant-id header is required");

        const body = ctx.body as Record<string, unknown> | null;
        if (!body || typeof body !== "object") {
          return err(400, "Request body must be a JSON object");
        }

        const { agentId, records, context } = body as Partial<DriftExplainInput> & {
          context?: Record<string, unknown>;
        };

        if (typeof agentId !== "string" || agentId.trim() === "") {
          return err(400, "agentId must be a non-empty string");
        }
        if (!Array.isArray(records)) {
          return err(400, "records must be an array of DriftRecord items");
        }
        if (records.length < 2) {
          return err(400, `records must contain at least 2 items (got ${records.length})`);
        }

        try {
          const report = explainDriftCompliance({
            agentId: agentId.trim(),
            records,
            context: context as DriftExplainInput["context"],
          });
          return ok(report);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // Validation errors from scoreRiskDrift propagate as 400 (bad input).
          return err(400, msg);
        }
      },
    },
  ];
}
