/**
 * src/routes/arbitrage-routes.ts — Cost arbitrage endpoint.
 *
 * Routes:
 *
 *   POST /api/arbitrage/quotes
 *     Given N vendor cost estimates for the same action, returns the cheapest
 *     vendor, the spread (revenue headroom), and a routing-fee suggestion.
 *
 *     Body: {
 *       quotes: Array<{ vendorId: string; estimatedCostMc: string }>,
 *       feeFractionNumerator?:   string,   // default "1"
 *       feeFractionDenominator?: string,   // default "2"  (50% of spread)
 *     }
 *     All monetary amounts are decimal strings (JSON can't represent BigInt).
 *
 *     Response 200: {
 *       ok: true,
 *       winner: { vendorId: string; estimatedCostMc: string },
 *       runnerUp: { vendorId: string; estimatedCostMc: string } | null,
 *       spreadMc: string,
 *       suggestedRoutingFeeMc: string,
 *       sortedQuotes: Array<{ vendorId: string; estimatedCostMc: string }>,
 *     }
 *
 * Invariants:
 *   • Missing x-tenant-id → 400.
 *   • quotes must be a non-empty array → else 400.
 *   • estimatedCostMc must be a valid non-negative decimal integer string → 400 on bad parse.
 *   • feeFractionNumerator / feeFractionDenominator default to 1/2 (50% of spread).
 *   • All monetary output is serialized as decimal strings (never Number).
 *   • Tenant isolation: the route is scoped to the caller's tenantId; the
 *     arbitrage primitive itself is pure (no store writes).
 *   • ArbitrageError (invalid input from the caller) → 400.
 *   • Unexpected errors re-thrown → 500 (fail-closed).
 */

import { selectCheapestVendor, routingFeeFromSpread, ArbitrageError } from "../../lib/marketplace/cost-arbitrage.ts";
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

/** Parse a decimal-string BigInt that must be ≥ 0. Returns null on failure. */
function parseMc(s: unknown): bigint | null {
  if (typeof s !== "string" || !/^[0-9]+$/.test(s)) return null;
  try { return BigInt(s); } catch { return null; }
}

/** Serialise a quote for JSON output (estimatedCostMc as string). */
function serQuote(q: { vendorId: string; estimatedCostMc: bigint }) {
  return { vendorId: q.vendorId, estimatedCostMc: q.estimatedCostMc.toString() };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function arbitrageRoutes(_stack: SovereignStack): Route[] {
  return [
    {
      method: "POST",
      pattern: "/api/arbitrage/quotes",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");

        const body = c.body;
        if (!body || typeof body !== "object" || !Array.isArray(body.quotes)) {
          return err(400, "body.quotes must be an array");
        }
        if (body.quotes.length === 0) {
          return err(400, "body.quotes must be non-empty");
        }

        // Parse and validate each quote — convert decimal-string mc to BigInt
        const parsed: { vendorId: string; estimatedCostMc: bigint }[] = [];
        for (let i = 0; i < body.quotes.length; i++) {
          const q = body.quotes[i];
          if (!q || typeof q !== "object") {
            return err(400, `quotes[${i}]: must be an object`);
          }
          if (!q.vendorId || typeof q.vendorId !== "string" || q.vendorId.trim() === "") {
            return err(400, `quotes[${i}]: vendorId must be a non-empty string`);
          }
          const mc = parseMc(q.estimatedCostMc);
          if (mc === null) {
            return err(400, `quotes[${i}] (vendor "${q.vendorId}"): estimatedCostMc must be a non-negative decimal integer string`);
          }
          parsed.push({ vendorId: q.vendorId, estimatedCostMc: mc });
        }

        // Parse fee fraction (default 1/2 = 50% of spread)
        const numStr: unknown = body.feeFractionNumerator ?? "1";
        const denStr: unknown = body.feeFractionDenominator ?? "2";
        const feeNum = parseMc(numStr);
        const feeDen = parseMc(denStr);
        if (feeNum === null) return err(400, "feeFractionNumerator must be a non-negative decimal integer string");
        if (feeDen === null || feeDen === 0n) return err(400, "feeFractionDenominator must be a positive decimal integer string");
        if (feeNum > feeDen) return err(400, "feeFractionNumerator must be ≤ feeFractionDenominator (fraction cannot exceed 1)");

        try {
          const result = selectCheapestVendor(parsed);
          const suggestedRoutingFeeMc = routingFeeFromSpread(result.spreadMc, feeNum, feeDen);

          return ok({
            ok: true,
            winner: serQuote(result.winner),
            runnerUp: result.runnerUp ? serQuote(result.runnerUp) : null,
            spreadMc: result.spreadMc.toString(),
            suggestedRoutingFeeMc: suggestedRoutingFeeMc.toString(),
            sortedQuotes: result.sortedQuotes.map(serQuote),
          });
        } catch (e) {
          if (e instanceof ArbitrageError) return err(400, e.message);
          throw e;
        }
      },
    },
  ];
}
