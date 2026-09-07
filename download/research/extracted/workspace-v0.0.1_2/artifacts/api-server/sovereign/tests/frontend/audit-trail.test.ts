/**
 * tests/frontend/audit-trail.test.ts — Audit trail filter engine tests.
 *
 * Coverage: happy path, edge cases, fail-closed (tenant isolation).
 */

import type { UnifiedAuditEvent } from "../../frontend/audit-trail/types.ts";
import { applyFilter, summarise } from "../../frontend/audit-trail/filter.ts";
import type { FilterSpec } from "../../frontend/audit-trail/filter.ts";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const baseTime = "2026-06-15T10:00:00.000Z";

function evt(p: Partial<UnifiedAuditEvent> & { id: string; tenantId: string; timestamp: string }): UnifiedAuditEvent {
  return {
    vendor: "tfa",
    source: "system",
    actionType: "agent.task.run",
    outcome: "allowed",
    ...p,
  } as UnifiedAuditEvent;
}

const FIXTURES: UnifiedAuditEvent[] = [
  evt({ id: "e1", tenantId: "t-a", timestamp: "2026-06-15T08:00:00.000Z", vendor: "tfa", source: "alpha", actionType: "agent.task.run", outcome: "allowed", riskClass: "read_only", policyOutcome: "auto", provenance: "api" }),
  evt({ id: "e2", tenantId: "t-a", timestamp: "2026-06-15T09:00:00.000Z", vendor: "openai", source: "gpt-4", actionType: "file.edit", outcome: "allowed", riskClass: "write_safe", policyOutcome: "auto", provenance: "mcp" }),
  evt({ id: "e3", tenantId: "t-a", timestamp: "2026-06-15T10:00:00.000Z", vendor: "anthropic", source: "claude", actionType: "shell.exec", outcome: "denied", riskClass: "irreversible", policyOutcome: "deny", provenance: "webhook", reason: "unauthorised command" }),
  evt({ id: "e4", tenantId: "t-a", timestamp: "2026-06-15T11:00:00.000Z", vendor: "xai", source: "grok", actionType: "git.push", outcome: "escalated", riskClass: "irreversible", policyOutcome: "human", provenance: "api" }),
  evt({ id: "e5", tenantId: "t-a", timestamp: "2026-06-15T12:00:00.000Z", vendor: "google", source: "gemini", actionType: "db.migration", outcome: "error", riskClass: "write_destructive", policyOutcome: "threshold_escrow", provenance: "api" }),
  evt({ id: "e6", tenantId: "t-b", timestamp: "2026-06-15T09:30:00.000Z", vendor: "tfa", source: "beta", actionType: "ledger.transfer", outcome: "allowed", riskClass: "value_moving", policyOutcome: "opa_check", provenance: "api", amountMicrounits: "100000" }),
  evt({ id: "e7", tenantId: "t-b", timestamp: "2026-06-15T13:00:00.000Z", vendor: "custom", source: "internal-tool", actionType: "workflow.execute", outcome: "pending", riskClass: "write_safe", policyOutcome: "human", provenance: "mcp" }),
  evt({ id: "e8", tenantId: "t-a", timestamp: "2026-06-15T14:00:00.000Z", vendor: "unknown", source: "orphan", actionType: "file.read", outcome: "allowed", provenance: "webhook" }),
];

// ─── Assertions ─────────────────────────────────────────────────────────────

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("✗ " + msg);
}

function eq(a: unknown, b: unknown, msg: string) {
  assert(a === b, msg + ` (got ${a}, want ${b})`);
}

function ids(result: { events: UnifiedAuditEvent[] }): string[] {
  return result.events.map(e => e.id).sort();
}

// ─── Happy path ─────────────────────────────────────────────────────────────

// 1. Tenant isolation
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a" });
  eq(r.total, 6, "tenant t-a should match 6 events");
  eq(r.events.every(e => e.tenantId === "t-a"), true, "all results belong to t-a");
}

// 2. Single vendor filter
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", vendor: "openai" });
  eq(ids(r).join(","), "e2", "single vendor filter");
}

// 3. Multi-vendor filter (Set optimisation)
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", vendor: ["openai", "anthropic", "xai"] });
  eq(ids(r).join(","), "e2,e3,e4", "multi-vendor filter");
}

// 4. Outcome filter
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", outcome: "denied" });
  eq(ids(r).join(","), "e3", "outcome filter");
}

// 5. Multi-outcome filter
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", outcome: ["denied", "error"] });
  eq(ids(r).join(","), "e3,e5", "multi-outcome filter");
}

// 6. RiskClass filter
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", riskClass: "irreversible" });
  eq(ids(r).join(","), "e3,e4", "riskClass filter");
}

// 7. PolicyOutcome filter
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", policyOutcome: "auto" });
  eq(ids(r).join(","), "e1,e2", "policyOutcome filter");
}

// 8. Provenance filter
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", provenance: "api" });
  eq(ids(r).join(","), "e1,e4,e5", "provenance filter");
}

// 9. Date range filter
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", from: "2026-06-15T09:30:00.000Z", to: "2026-06-15T11:30:00.000Z" });
  eq(ids(r).join(","), "e3,e4", "date range filter");
}

// 10. Free-text search across actionType, source, reason
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", search: "exec" });
  eq(ids(r).join(","), "e3", "search matches actionType");
}

// 11. Free-text search matches source
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", search: "claude" });
  eq(ids(r).join(","), "e3", "search matches source");
}

// 12. Free-text search matches reason
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", search: "unauthorised" });
  eq(ids(r).join(","), "e3", "search matches reason");
}

// 13. Compound filter (tenant + vendor + outcome)
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", vendor: ["tfa", "openai"], outcome: "allowed" });
  eq(ids(r).join(","), "e1,e2", "compound filter");
}

// 14. ActionType substring filter
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", actionType: "git." });
  eq(ids(r).join(","), "e4", "actionType substring filter");
}

// 15. summarise() aggregates correctly
{
  const r = summarise(FIXTURES);
  eq(r.total, 8, "summarise total");
  eq(r.summary.byOutcome["allowed"], 4, "summarise allowed count");
  eq(r.summary.byVendor["tfa"], 2, "summarise tfa vendor count");
  eq(r.summary.byRiskClass["irreversible"], 2, "summarise irreversible count");
}

// ─── Edge cases ─────────────────────────────────────────────────────────────

// 16. Empty events array
{
  const r = applyFilter([], { tenantId: "t-a" });
  eq(r.total, 0, "empty events → empty result");
}

// 17. No matches
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", vendor: "nonexistent" as any });
  eq(r.total, 0, "no matching vendor → empty result");
}

// 18. Partial events (missing optional fields) do not crash
{
  const partial: UnifiedAuditEvent = {
    id: "p1", tenantId: "t-a", timestamp: "2026-06-15T10:00:00.000Z",
    vendor: "tfa", source: "partial", actionType: "test.action", outcome: "allowed",
  };
  const r = applyFilter([partial], { tenantId: "t-a", riskClass: "read_only" });
  eq(r.total, 0, "partial event without riskClass excluded by riskClass filter");
}

// 19. Partial event passes when filter does not touch missing field
{
  const partial: UnifiedAuditEvent = {
    id: "p1", tenantId: "t-a", timestamp: "2026-06-15T10:00:00.000Z",
    vendor: "tfa", source: "partial", actionType: "test.action", outcome: "allowed",
  };
  const r = applyFilter([partial], { tenantId: "t-a" });
  eq(r.total, 1, "partial event included when filter does not touch missing fields");
}

// 20. Invalid date string in spec treated as no bound (fail-soft)
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", from: "not-a-date" });
  eq(r.total, 6, "invalid from date treated as no bound");
}

// 21. Event with malformed timestamp excluded from date-range results
{
  const badTs: UnifiedAuditEvent = {
    id: "bad", tenantId: "t-a", timestamp: "invalid-timestamp",
    vendor: "tfa", source: "bad", actionType: "test.action", outcome: "allowed",
  };
  const r = applyFilter([...FIXTURES, badTs], { tenantId: "t-a", from: "2026-06-15T00:00:00.000Z", to: "2026-06-15T23:59:59.000Z" });
  eq(r.events.some(e => e.id === "bad"), false, "malformed timestamp excluded from date range");
}

// 22. Search with empty string matches nothing that is undefined, but matches defined fields
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", search: "" });
  // Empty search string: substringMatch returns true for any defined haystack because "".includes("") is true,
  // but false for undefined. We treat empty search as effectively "match nothing with undefined fields".
  // Actually, let's verify it doesn't exclude events with all three fields defined.
  eq(r.events.length >= 1, true, "empty search does not over-exclude");
}

// 23. includeAllTenants returns events from all tenants
{
  const r = applyFilter(FIXTURES, { includeAllTenants: true });
  eq(r.total, 8, "includeAllTenants returns all events");
}

// 24. Source filter exact match
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", source: "claude" });
  eq(ids(r).join(","), "e3", "source exact match");
}

// ─── Fail-closed ────────────────────────────────────────────────────────────

// 25. Missing tenantId without override → empty result (fail-closed)
{
  const r = applyFilter(FIXTURES, {});
  eq(r.total, 0, "missing tenantId without includeAllTenants → empty (fail-closed)");
}

// 26. Cross-tenant events are excluded
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a" });
  eq(r.events.some(e => e.tenantId !== "t-a"), false, "cross-tenant events never leak");
}

// 27. Explicit tenantId overrides includeAllTenants semantic (still filters by tenant)
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", includeAllTenants: true });
  eq(r.events.every(e => e.tenantId === "t-a"), true, "tenantId still isolates even with includeAllTenants flag");
}

// 28. Unknown vendor in event is handled naturally by vendor filter
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", vendor: "unknown" });
  eq(ids(r).join(","), "e8", "unknown vendor passes when explicitly requested");
}

// 29. Multi-policyOutcome filter
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", policyOutcome: ["auto", "deny"] });
  eq(ids(r).join(","), "e1,e2,e3", "multi-policyOutcome filter");
}

// 30. Multi-provenance filter
{
  const r = applyFilter(FIXTURES, { tenantId: "t-a", provenance: ["api", "mcp"] });
  eq(ids(r).join(","), "e1,e2,e4,e5", "multi-provenance filter");
}

console.log("Passed: 30 / Failed: 0");
