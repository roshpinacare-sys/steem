/**
 * frontend/audit-trail/types.ts — Unified cross-vendor audit-event model.
 *
 * Normalises actions from xAI, OpenAI, Anthropic, Google, custom vendors,
 * and TFA-native events into a single structure so the audit-trail dashboard
 * can render, filter, and correlate them without vendor-specific parsing.
 *
 * Zero runtime dependencies.
 */

/** Canonical vendor identifiers. "unknown" is the fail-closed fallback. */
export type Vendor =
  | "tfa"
  | "xai"
  | "openai"
  | "anthropic"
  | "google"
  | "custom"
  | "unknown";

/** Normalised outcome taxonomy. "pending" covers in-flight approvals. */
export type AuditOutcome =
  | "allowed"
  | "denied"
  | "error"
  | "escalated"
  | "pending";

/** Policy decision that produced the outcome. */
export type PolicyOutcome =
  | "auto"
  | "opa_check"
  | "human"
  | "threshold_escrow"
  | "deny";

/**
 * UnifiedAuditEvent — one row in the cross-vendor trail.
 *
 * Every field is optional except id, tenantId, and timestamp,
 * so partial/legacy events can still be ingested and displayed forensically.
 */
export interface UnifiedAuditEvent {
  /** Unique event id (UUID or vendor-native id). */
  id: string;
  /** Tenant isolation key. */
  tenantId: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Source vendor. */
  vendor: Vendor;
  /** Actor / agent / service that produced the action. */
  source: string;
  /** Hierarchical action type, e.g. "agent.task.run" or "file.delete". */
  actionType: string;
  /** Normalised outcome. */
  outcome: AuditOutcome;
  /** Canonical risk class (optional for legacy events). */
  riskClass?: string;
  /** Policy decision that governed this action. */
  policyOutcome?: PolicyOutcome;
  /** Origin / provenance of the intent, e.g. "api", "webhook", "mcp". */
  provenance?: string;
  /** Monetary value in micro-cents (μ¢), as string for JSON safety. */
  amountMicrounits?: string;
  /** Human-readable reason for denied/error/escalated outcomes. */
  reason?: string;
  /** Vendor-specific or TFA-specific extension data. */
  metadata?: Record<string, unknown>;
}

/** Summary statistics for a filtered trail view. */
export interface TrailSummary {
  total: number;
  byOutcome: Record<AuditOutcome, number>;
  byVendor: Record<string, number>;
  byRiskClass: Record<string, number>;
  dateRange: { from: string; to: string } | null;
}
