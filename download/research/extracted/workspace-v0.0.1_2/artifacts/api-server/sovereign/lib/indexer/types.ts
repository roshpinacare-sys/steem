/**
 * lib/indexer/types.ts — Trust-Graph read-model entity types.
 *
 * Projection from audit / ledger / proof / passport into a queryable read-model.
 * Zero external dependencies — only references canonical types from other lib/ modules.
 *
 * Entities: Actor, Execution, Approval, Escrow, Passport, Dispute.
 * All monetary fields are BigInt μ¢. All queries are tenant-isolated.
 */

import type { ExecutionStatus } from "../orchestrator/types.ts";
import type { ActionRiskClass, ApprovalClass } from "../orchestrator/types.ts";

// ─── Actor ────────────────────────────────────────────────────────────────────

/** Anyone who has performed or been party to an action in the system. */
export interface ReadModelActor {
  /** Globally unique read-model id (typically `${tenantId}:${actorId}`). */
  id: string;
  tenantId: string;
  actorId: string;
  actorType: "system" | "human" | "agent";
  firstSeenAt: string; // ISO-8601
  lastActiveAt: string; // ISO-8601
  totalActions: number;
  /** μ¢ moved by this actor across all actions (absolute sum). */
  totalValueMovedMicrounits: bigint;
}

// ─── Execution ────────────────────────────────────────────────────────────────

/** Projection of an ExecutionWorkflow into the read model. */
export interface ReadModelExecution {
  /** Same as the workflow id. */
  id: string;
  tenantId: string;
  workflowId: string;
  actionId: string;
  intentId?: string;
  status: ExecutionStatus;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  /** Actor who initiated or last transitioned the workflow. */
  actor: string;
  evidenceCount: number;
  approvalId?: string;
  // ─── Trust-graph cross-references ──────────────────────────────────────────
  /** passportId issued for this execution's audit record (if available). */
  passportId?: string;
  /** escrowId linked to this execution via opportunityId/actionId (if available). */
  escrowId?: string;
  // ─── Agent provenance (cross-vendor audit trail, v314) ─────────────────────
  /** Deterministic cross-vendor fingerprint (sha256 of canonical tuple). */
  provenanceId?: string;
  /** Normalized vendor label (xai|openai|anthropic|google|cursor|…|custom). */
  provenanceVendor?: string;
  /** Stable agent identifier within the vendor. */
  provenanceAgentId?: string;
}

// ─── Approval ─────────────────────────────────────────────────────────────────

/** Projection of an approval decision into the read model. */
export interface ReadModelApproval {
  id: string;
  tenantId: string;
  actionId: string;
  riskClass: ActionRiskClass;
  approvalClass: ApprovalClass;
  /** Signed decision trace, when available. */
  decisionTrace?: string;
  outcome: "allowed" | "denied";
  timestamp: string; // ISO-8601
  // ─── Trust-graph cross-references ──────────────────────────────────────────
  /** executionId whose workflow was gated by this approval (if known). */
  executionId?: string;
}

// ─── Escrow ───────────────────────────────────────────────────────────────────

/** Projection of a settlement/escrow agreement into the read model. */
export interface ReadModelEscrow {
  id: string;
  tenantId: string;
  agreementId: string;
  opportunityId: string;
  payerAccountId: string;
  workerAccountId: string;
  /** Total amount held in escrow (μ¢). */
  totalAmountMicrounits: bigint;
  /** Amount already released to the worker (μ¢). */
  releasedAmountMicrounits: bigint;
  /** Canonical settlement state. */
  state: string;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  // ─── Trust-graph cross-references ──────────────────────────────────────────
  /** passportId of the passport that covered the escrow release action (if known). */
  releasePassportId?: string;
  /** executionId of the workflow that triggered this escrow (if known). */
  executionId?: string;
}

// ─── Passport ───────────────────────────────────────────────────────────────────

/** Projection of an ActionPassport or PassportClaim into the read model. */
export interface ReadModelPassport {
  id: string;
  tenantId: string;
  passportId: string;
  auditId: string;
  issuedAt: string; // ISO-8601
  /** Outcome from the underlying audit record. */
  outcome: string;
  /** Ledger transaction id, if a ledger effect was attached. */
  ledgerEffectId?: string;
  attestationPresent: boolean;
  /** SHA-256 hash of the canonical passport body. */
  hash: string;
  // ─── Trust-graph cross-references ──────────────────────────────────────────
  /** executionId whose audit record produced this passport (if known). */
  executionId?: string;
  /** approvalId that authorized the action this passport covers (if known). */
  approvalId?: string;
}

// ─── Dispute ──────────────────────────────────────────────────────────────────

/** Projection of a dispute derived from a settlement in disputed or reversed state. */
export interface ReadModelDispute {
  id: string;
  tenantId: string;
  escrowId: string;
  raisedBy: string;
  reason?: string;
  state: "disputed" | "reversed";
  createdAt: string; // ISO-8601
  resolvedAt?: string; // ISO-8601
}

// ─── Error type ───────────────────────────────────────────────────────────────

export type IndexerErrorCode =
  | "invalid_input"
  | "tenant_mismatch";

export class IndexerError extends Error {
  readonly code: IndexerErrorCode;
  constructor(code: IndexerErrorCode, message: string) {
    super(message);
    this.name = "IndexerError";
    this.code = code;
  }
}

// ─── Event hooks ──────────────────────────────────────────────────────────────

/**
 * IndexerEvent — a discriminated union of domain events that the read-model
 * store can subscribe to for automatic projections.
 *
 * Each event carries the minimum payload needed to project the relevant entity
 * without coupling the indexer to the full domain type hierarchies.
 */
export type IndexerEvent =
  | {
      type: "execution.updated";
      tenantId: string;
      workflow: import("../orchestrator/types.ts").ExecutionWorkflow;
    }
  | {
      type: "approval.decided";
      tenantId: string;
      approvalId: string;
      actionId: string;
      riskClass: string;
      approvalClass: string;
      decisionTrace?: string;
      outcome: "allowed" | "denied";
      timestamp: string;
      executionId?: string;
    }
  | {
      type: "escrow.updated";
      tenantId: string;
      agreement: import("../escrow/settlement.ts").SettlementAgreement;
      executionId?: string;
    }
  | {
      type: "passport.issued";
      tenantId: string;
      passport: import("../passport/types.ts").ActionPassport;
      executionId?: string;
      approvalId?: string;
    };

/**
 * ReadModelStore — the minimal interface both InMemory and Pg stores satisfy.
 * Used for type-safe injection via event hooks.
 */
export interface ReadModelStore {
  projectExecution(workflow: import("../orchestrator/types.ts").ExecutionWorkflow): unknown;
  projectApproval(input: {
    id: string;
    tenantId: string;
    actionId: string;
    riskClass: string;
    approvalClass: string;
    decisionTrace?: string;
    outcome: "allowed" | "denied";
    timestamp: string;
    executionId?: string;
  }): unknown;
  projectEscrow(
    agreement: import("../escrow/settlement.ts").SettlementAgreement,
    opts?: { executionId?: string },
  ): unknown;
  projectPassport(
    passport: import("../passport/types.ts").ActionPassport,
    opts?: { executionId?: string; approvalId?: string },
  ): unknown;
}
