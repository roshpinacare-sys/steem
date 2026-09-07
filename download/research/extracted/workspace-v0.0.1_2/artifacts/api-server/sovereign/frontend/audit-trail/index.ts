/**
 * TFA Frontend Audit Trail — public API.
 *
 * Cross-vendor unified event model + compound filter engine.
 * Zero runtime dependencies.
 */

export type {
  UnifiedAuditEvent,
  Vendor,
  AuditOutcome,
  PolicyOutcome,
  TrailSummary,
} from "./types.ts";

export type { FilterSpec, FilterResult } from "./filter.ts";
export { applyFilter, summarise } from "./filter.ts";
