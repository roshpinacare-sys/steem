/**
 * lib/indexer/insights.ts — tenant insights aggregation (K10, first sub-step).
 *
 * A PURE aggregation over already-fetched read-model records: it turns the trust
 * chain (escrows + passports) into the headline numbers a tenant wants to see —
 * settled count, value volume, value held, disputes, proofs issued, and a simple
 * trust-trend (proofs this window vs the previous window).
 *
 * The HTTP route (GET /api/insights) + caching + rate-limit are the NEXT sub-step;
 * keeping the math pure here makes it deterministic and testable offline. The route
 * will fetch tenant-scoped records from the read-model and call this function.
 *
 * INVARIANTS
 *   • money is BigInt μ¢ throughout (sums never use Number).
 *   • tenant isolation is fail-closed: any record whose tenantId ≠ the requested
 *     tenant throws IndexerError("tenant_mismatch") — never silently mixed.
 *   • invalid input (bad tenantId / window / timestamps) throws IndexerError.
 *
 * Zero external dependencies.
 */

import { IndexerError } from "./types.ts";
import type { ReadModelEscrow, ReadModelPassport } from "./types.ts";

export interface TenantInsightsInput {
  tenantId: string;
  escrows: ReadModelEscrow[];
  passports: ReadModelPassport[];
  /** "Now" as ISO-8601; the window ends here. */
  now: string;
  /** Trailing window length in days (default 30). */
  windowDays?: number;
}

export interface TenantInsights {
  tenantId: string;
  windowDays: number;
  /** Escrows that reached a released state in the current window. */
  settledCount: number;
  /** Sum of released amounts in the current window (μ¢). */
  volumeMicrounits: bigint;
  /** Value currently still held across all of the tenant's escrows (μ¢). */
  heldMicrounits: bigint;
  /** Escrows currently in a disputed/reversed state. */
  disputeCount: number;
  /** Passports (proofs) issued in the current window. */
  proofsIssued: number;
  /** proofsIssued(current window) − proofsIssued(previous equal window). */
  trustTrendDelta: number;
  /** Direction of the trust trend. */
  trustTrend: "up" | "flat" | "down";
}

const DAY_MS = 86_400_000;
const RELEASED_STATES = new Set(["released", "partially_released"]);
const DISPUTE_STATES = new Set(["disputed", "reversed"]);

function parseTime(value: string, field: string): number {
  if (typeof value !== "string" || value.length === 0) {
    throw new IndexerError("invalid_input", `${field} must be a non-empty ISO-8601 string`);
  }
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new IndexerError("invalid_input", `${field} must be a valid ISO-8601 timestamp`);
  return t;
}

/**
 * computeTenantInsights — aggregate a tenant's trust chain into headline metrics.
 * fail-closed on cross-tenant records and invalid input.
 */
export function computeTenantInsights(input: TenantInsightsInput): TenantInsights {
  if (!input || typeof input !== "object") {
    throw new IndexerError("invalid_input", "input must be an object");
  }
  const { tenantId } = input;
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new IndexerError("invalid_input", "tenantId must be a non-empty string");
  }
  const windowDays = input.windowDays ?? 30;
  if (!Number.isInteger(windowDays) || windowDays <= 0) {
    throw new IndexerError("invalid_input", "windowDays must be a positive integer");
  }
  if (!Array.isArray(input.escrows) || !Array.isArray(input.passports)) {
    throw new IndexerError("invalid_input", "escrows and passports must be arrays");
  }

  const nowMs = parseTime(input.now, "now");
  const windowStart = nowMs - windowDays * DAY_MS;
  const prevWindowStart = windowStart - windowDays * DAY_MS;

  let settledCount = 0;
  let volumeMicrounits = 0n;
  let heldMicrounits = 0n;
  let disputeCount = 0;

  for (const e of input.escrows) {
    // fail-closed tenant isolation.
    if (e.tenantId !== tenantId) {
      throw new IndexerError("tenant_mismatch", `escrow ${e.id} belongs to a different tenant`);
    }
    const total = BigInt(e.totalAmountMicrounits);
    const released = BigInt(e.releasedAmountMicrounits);
    const held = total - released;
    if (held > 0n) heldMicrounits += held;
    if (DISPUTE_STATES.has(e.state)) disputeCount++;

    if (RELEASED_STATES.has(e.state)) {
      const updated = parseTime(e.updatedAt, `escrow ${e.id} updatedAt`);
      if (updated >= windowStart && updated <= nowMs) {
        settledCount++;
        volumeMicrounits += released;
      }
    }
  }

  let proofsIssued = 0;
  let proofsPrev = 0;
  for (const p of input.passports) {
    if (p.tenantId !== tenantId) {
      throw new IndexerError("tenant_mismatch", `passport ${p.id} belongs to a different tenant`);
    }
    const issued = parseTime(p.issuedAt, `passport ${p.id} issuedAt`);
    if (issued >= windowStart && issued <= nowMs) proofsIssued++;
    else if (issued >= prevWindowStart && issued < windowStart) proofsPrev++;
  }

  const trustTrendDelta = proofsIssued - proofsPrev;
  const trustTrend = trustTrendDelta > 0 ? "up" : trustTrendDelta < 0 ? "down" : "flat";

  return {
    tenantId,
    windowDays,
    settledCount,
    volumeMicrounits,
    heldMicrounits,
    disputeCount,
    proofsIssued,
    trustTrendDelta,
    trustTrend,
  };
}
