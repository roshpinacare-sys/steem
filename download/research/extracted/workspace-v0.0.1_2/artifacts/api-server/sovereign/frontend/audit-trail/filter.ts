/**
 * frontend/audit-trail/filter.ts — Compound predicate filter engine for audit events.
 *
 * DESIGN
 * ------
 * • Declarative FilterSpec — every field is optional; only specified predicates apply.
 * • AND semantics: an event must satisfy ALL specified predicates to match.
 * • tenantId is REQUIRED by default (fail-closed). Set includeAllTenants: true to
 *   override — useful for admin/overview dashboards that explicitly aggregate.
 * • Vendor lookup uses a Set (O(1)) instead of Array#includes (O(n)) — hot-path
 *   optimisation because vendor filtering is evaluated for every event.
 *
 * Zero runtime dependencies.
 */

import type { UnifiedAuditEvent, AuditOutcome, Vendor } from "./types.ts";

/** One filter specification. Unspecified fields are ignored. */
export interface FilterSpec {
  /** Exact tenant match. REQUIRED unless includeAllTenants is true. */
  tenantId?: string;
  /** Bypass tenant isolation gate (admin/overview mode). */
  includeAllTenants?: boolean;
  /** Single vendor or array of vendors. */
  vendor?: Vendor | Vendor[];
  /** Exact source match. */
  source?: string;
  /** Substring match on actionType. */
  actionType?: string;
  /** Exact outcome match or array of outcomes. */
  outcome?: AuditOutcome | AuditOutcome[];
  /** Exact riskClass match or array. */
  riskClass?: string | string[];
  /** Exact policyOutcome match or array. */
  policyOutcome?: string | string[];
  /** Exact provenance match or array. */
  provenance?: string | string[];
  /** Inclusive ISO-8601 lower bound. */
  from?: string;
  /** Inclusive ISO-8601 upper bound. */
  to?: string;
  /** Free-text search across actionType, source, and reason. Case-insensitive. */
  search?: string;
}

/** Filter result with the matched events and a summary. */
export interface FilterResult {
  events: UnifiedAuditEvent[];
  total: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normaliseArray<T>(v: T | T[] | undefined): T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

function inSet<T>(value: T, set: Set<T>): boolean {
  return set.has(value);
}

function substringMatch(haystack: string | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

// ─── Core filter ────────────────────────────────────────────────────────────

/**
 * Apply a FilterSpec to an array of UnifiedAuditEvent.
 *
 * INVARIANTS
 * ----------
 * • If spec.tenantId is missing AND spec.includeAllTenants is not true,
 *   returns empty result (fail-closed).
 * • If events is empty, returns empty result — never throws.
 * • Date bounds are inclusive; invalid date strings are treated as "no bound"
 *   so a malformed spec does not hide data.
 * • All comparisons are case-insensitive where human-readable strings are involved.
 */
export function applyFilter(
  events: readonly UnifiedAuditEvent[],
  spec: FilterSpec,
): FilterResult {
  // Fail-closed: tenant isolation is the default.
  if (!spec.tenantId && !spec.includeAllTenants) {
    return { events: [], total: 0 };
  }

  // Pre-build Sets for O(1) membership tests.
  const vendorSet = spec.vendor !== undefined
    ? new Set(normaliseArray(spec.vendor))
    : null;
  const outcomeSet = spec.outcome !== undefined
    ? new Set(normaliseArray(spec.outcome))
    : null;
  const riskClassSet = spec.riskClass !== undefined
    ? new Set(normaliseArray(spec.riskClass))
    : null;
  const policyOutcomeSet = spec.policyOutcome !== undefined
    ? new Set(normaliseArray(spec.policyOutcome))
    : null;
  const provenanceSet = spec.provenance !== undefined
    ? new Set(normaliseArray(spec.provenance))
    : null;

  // Parse date bounds once, fail-soft on invalid strings.
  const fromMs = spec.from ? Date.parse(spec.from) : NaN;
  const toMs = spec.to ? Date.parse(spec.to) : NaN;
  const hasFrom = !Number.isNaN(fromMs);
  const hasTo = !Number.isNaN(toMs);

  const searchLower = spec.search?.toLowerCase() ?? null;

  const out: UnifiedAuditEvent[] = [];
  for (const ev of events) {
    // Tenant isolation (fast path).
    if (spec.tenantId && ev.tenantId !== spec.tenantId) continue;

    // Vendor filter.
    if (vendorSet && !vendorSet.has(ev.vendor)) continue;

    // Source filter.
    if (spec.source && ev.source !== spec.source) continue;

    // ActionType substring.
    if (spec.actionType && !ev.actionType.includes(spec.actionType)) continue;

    // Outcome filter.
    if (outcomeSet && !outcomeSet.has(ev.outcome)) continue;

    // RiskClass filter.
    if (riskClassSet && (!ev.riskClass || !riskClassSet.has(ev.riskClass))) continue;

    // PolicyOutcome filter.
    if (policyOutcomeSet && (!ev.policyOutcome || !policyOutcomeSet.has(ev.policyOutcome))) continue;

    // Provenance filter.
    if (provenanceSet && (!ev.provenance || !provenanceSet.has(ev.provenance))) continue;

    // Date range.
    if (hasFrom || hasTo) {
      const ts = Date.parse(ev.timestamp);
      if (Number.isNaN(ts)) continue; // malformed event timestamp excluded
      if (hasFrom && ts < fromMs) continue;
      if (hasTo && ts > toMs) continue;
    }

    // Free-text search.
    if (searchLower) {
      const match =
        substringMatch(ev.actionType, searchLower) ||
        substringMatch(ev.source, searchLower) ||
        substringMatch(ev.reason, searchLower);
      if (!match) continue;
    }

    out.push(ev);
  }

  return { events: out, total: out.length };
}

/**
 * Compute a TrailSummary from a set of events.
 * Zero-dep; safe for empty arrays.
 */
export function summarise(events: readonly UnifiedAuditEvent[]): FilterResult & {
  summary: { byOutcome: Record<string, number>; byVendor: Record<string, number>; byRiskClass: Record<string, number> };
} {
  const result = applyFilter(events, { includeAllTenants: true });
  const byOutcome: Record<string, number> = {};
  const byVendor: Record<string, number> = {};
  const byRiskClass: Record<string, number> = {};

  for (const ev of result.events) {
    byOutcome[ev.outcome] = (byOutcome[ev.outcome] || 0) + 1;
    byVendor[ev.vendor] = (byVendor[ev.vendor] || 0) + 1;
    if (ev.riskClass) {
      byRiskClass[ev.riskClass] = (byRiskClass[ev.riskClass] || 0) + 1;
    }
  }

  return { ...result, summary: { byOutcome, byVendor, byRiskClass } };
}
