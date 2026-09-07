/**
 * lib/indexer/in-memory-store.ts — In-memory read-model store with tenant-isolated projection.
 *
 * First sub-step of the Indexer/Trust-Graph read-model:
 *   • canonical entity types (Actor, Execution, Approval, Escrow, Passport, Dispute)
 *   • InMemoryReadModelStore — zero-dep, fail-closed, tenant-isolated
 *   • project* methods ingest domain objects and upsert read-model entities
 *   • query methods for each entity, all filtered by tenantId
 *
 * Zero external dependencies.
 */

import type {
  ReadModelActor,
  ReadModelExecution,
  ReadModelApproval,
  ReadModelEscrow,
  ReadModelPassport,
  ReadModelDispute,
} from "./types.ts";
import { IndexerError } from "./types.ts";
export { IndexerError };
import type { ExecutionWorkflow } from "../orchestrator/types.ts";
import type { SettlementAgreement } from "../escrow/settlement.ts";
import type { ActionPassport } from "../passport/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new IndexerError("invalid_input", `${field} is required and must be non-empty`);
  }
  return value;
}

function makeActorId(tenantId: string, actorId: string): string {
  return `${tenantId}:${actorId}`;
}

// ─── InMemoryReadModelStore ───────────────────────────────────────────────────

export class InMemoryReadModelStore {
  private readonly actors = new Map<string, ReadModelActor>();
  private readonly executions = new Map<string, ReadModelExecution>();
  // Monotonic projection-order counter, keyed by execution id. updatedAt
  // alone (ISO string, 1ms resolution) can tie under fast/sequential
  // projectExecution calls — this seq is the deterministic tiebreaker for
  // "most recently updated" so ordering never depends on clock granularity.
  private readonly executionSeq = new Map<string, number>();
  private executionSeqCounter = 0;
  private readonly approvals = new Map<string, ReadModelApproval>();
  private readonly escrows = new Map<string, ReadModelEscrow>();
  private readonly passports = new Map<string, ReadModelPassport>();
  private readonly disputes = new Map<string, ReadModelDispute>();

  // ─── Actor projections ──────────────────────────────────────────────────────

  /**
   * Upsert an Actor into the read model.
   * On first sight, sets firstSeenAt; on every call updates lastActiveAt and
   * increments totalActions and totalValueMovedMicrounits.
   */
  projectActor(input: {
    tenantId: string;
    actorId: string;
    actorType: "system" | "human" | "agent";
    timestamp: string;
    valueMovedMicrounits?: bigint;
  }): ReadModelActor {
    const tenantId = requireNonEmpty(input.tenantId, "tenantId");
    const actorId = requireNonEmpty(input.actorId, "actorId");
    const id = makeActorId(tenantId, actorId);
    const existing = this.actors.get(id);
    const ts = input.timestamp || nowIso();
    const valueMoved = input.valueMovedMicrounits ?? 0n;

    if (existing) {
      const updated: ReadModelActor = {
        ...existing,
        lastActiveAt: ts,
        totalActions: existing.totalActions + 1,
        totalValueMovedMicrounits: existing.totalValueMovedMicrounits + valueMoved,
      };
      this.actors.set(id, updated);
      return updated;
    }

    const actor: ReadModelActor = {
      id,
      tenantId,
      actorId,
      actorType: input.actorType,
      firstSeenAt: ts,
      lastActiveAt: ts,
      totalActions: 1,
      totalValueMovedMicrounits: valueMoved,
    };
    this.actors.set(id, actor);
    return actor;
  }

  getActor(tenantId: string, actorId: string): ReadModelActor | null {
    const id = makeActorId(tenantId, actorId);
    const a = this.actors.get(id);
    if (!a) return null;
    if (a.tenantId !== tenantId) return null;
    return a;
  }

  listActors(tenantId: string): ReadModelActor[] {
    const out: ReadModelActor[] = [];
    for (const a of this.actors.values()) {
      if (a.tenantId === tenantId) out.push(a);
    }
    return out;
  }

  // ─── Execution projections ────────────────────────────────────────────────

  /** Project an ExecutionWorkflow into the read model (upsert). */
  projectExecution(workflow: ExecutionWorkflow, opts?: { passportId?: string; escrowId?: string; provenanceId?: string; provenanceVendor?: string; provenanceAgentId?: string }): ReadModelExecution {
    const tenantId = requireNonEmpty(workflow.tenantId, "tenantId");
    const id = workflow.id;

    const evidenceCount = workflow.evidenceRefs ? workflow.evidenceRefs.length : 0;
    // Derive actor from the first log entry if available, else "system"
    const actor = workflow.runLog.length > 0 ? workflow.runLog[0].actor : "system";

    // Preserve existing cross-references if not explicitly overridden
    const existing = this.executions.get(id);

    const exec: ReadModelExecution = {
      id,
      tenantId,
      workflowId: workflow.id,
      actionId: workflow.actionId,
      intentId: workflow.intentId,
      status: workflow.status,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
      actor,
      evidenceCount,
      approvalId: workflow.approvalId,
      passportId: opts?.passportId ?? existing?.passportId,
      escrowId: opts?.escrowId ?? existing?.escrowId,
      provenanceId: opts?.provenanceId ?? existing?.provenanceId,
      provenanceVendor: opts?.provenanceVendor ?? existing?.provenanceVendor,
      provenanceAgentId: opts?.provenanceAgentId ?? existing?.provenanceAgentId,
    };
    this.executions.set(id, exec);
    this.executionSeq.set(id, ++this.executionSeqCounter);
    return exec;
  }

  getExecution(tenantId: string, id: string): ReadModelExecution | null {
    const e = this.executions.get(id);
    if (!e) return null;
    if (e.tenantId !== tenantId) return null;
    return e;
  }

  listExecutions(tenantId: string): ReadModelExecution[] {
    const out: ReadModelExecution[] = [];
    for (const e of this.executions.values()) {
      if (e.tenantId === tenantId) out.push(e);
    }
    // newest first by updatedAt; on a tie (possible at 1ms ISO resolution),
    // break by projection-order seq (higher = more recently projected) so
    // ordering is deterministic, not clock-dependent.
    out.sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
      const sa = this.executionSeq.get(a.id) ?? 0;
      const sb = this.executionSeq.get(b.id) ?? 0;
      return sb - sa;
    });
    return out;
  }

  // ─── Approval projections ─────────────────────────────────────────────────

  /** Project an approval decision into the read model. */
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
  }): ReadModelApproval {
    const tenantId = requireNonEmpty(input.tenantId, "tenantId");
    const id = requireNonEmpty(input.id, "id");

    const approval: ReadModelApproval = {
      id,
      tenantId,
      actionId: requireNonEmpty(input.actionId, "actionId"),
      riskClass: input.riskClass as ReadModelApproval["riskClass"],
      approvalClass: input.approvalClass as ReadModelApproval["approvalClass"],
      decisionTrace: input.decisionTrace,
      outcome: input.outcome,
      timestamp: input.timestamp || nowIso(),
      executionId: input.executionId,
    };
    this.approvals.set(id, approval);
    return approval;
  }

  getApproval(tenantId: string, id: string): ReadModelApproval | null {
    const a = this.approvals.get(id);
    if (!a) return null;
    if (a.tenantId !== tenantId) return null;
    return a;
  }

  listApprovals(tenantId: string): ReadModelApproval[] {
    const out: ReadModelApproval[] = [];
    for (const a of this.approvals.values()) {
      if (a.tenantId === tenantId) out.push(a);
    }
    return out;
  }

  // ─── Escrow projections ─────────────────────────────────────────────────────

  /** Project a SettlementAgreement into the read model (upsert). */
  projectEscrow(agreement: SettlementAgreement, opts?: { executionId?: string; releasePassportId?: string }): ReadModelEscrow {
    const tenantId = requireNonEmpty(agreement.tenantId, "tenantId");
    const id = agreement.id;

    // Preserve existing cross-references if not explicitly overridden
    const existing = this.escrows.get(id);

    const escrow: ReadModelEscrow = {
      id,
      tenantId,
      agreementId: agreement.id,
      opportunityId: agreement.opportunityId,
      payerAccountId: agreement.payerAccountId,
      workerAccountId: agreement.workerAccountId,
      totalAmountMicrounits: agreement.totalAmount,
      releasedAmountMicrounits: agreement.releasedAmount,
      state: agreement.state,
      createdAt: agreement.createdAt,
      updatedAt: nowIso(),
      executionId: opts?.executionId ?? existing?.executionId,
      releasePassportId: opts?.releasePassportId ?? existing?.releasePassportId,
    };
    this.escrows.set(id, escrow);

    // If the agreement is in a dispute-related state, also project a Dispute.
    if (agreement.state === "disputed" || agreement.state === "reversed") {
      this.projectDisputeFromEscrow(agreement);
    }

    return escrow;
  }

  getEscrow(tenantId: string, id: string): ReadModelEscrow | null {
    const e = this.escrows.get(id);
    if (!e) return null;
    if (e.tenantId !== tenantId) return null;
    return e;
  }

  listEscrows(tenantId: string): ReadModelEscrow[] {
    const out: ReadModelEscrow[] = [];
    for (const e of this.escrows.values()) {
      if (e.tenantId === tenantId) out.push(e);
    }
    return out;
  }

  // ─── Passport projections ───────────────────────────────────────────────────

  /** Project an ActionPassport into the read model (upsert). */
  projectPassport(passport: ActionPassport, opts?: { executionId?: string; approvalId?: string }): ReadModelPassport {
    const tenantId = requireNonEmpty(passport.tenantId, "tenantId");
    const id = passport.passportId;

    const p: ReadModelPassport = {
      id,
      tenantId,
      passportId: passport.passportId,
      auditId: passport.audit.id,
      issuedAt: passport.issuedAt,
      outcome: passport.audit.outcome,
      ledgerEffectId: passport.ledgerEffect?.transactionId,
      attestationPresent: passport.attestation !== null,
      hash: passport.hash,
      executionId: opts?.executionId,
      approvalId: opts?.approvalId,
    };
    this.passports.set(id, p);

    // Back-link: if executionId is provided, update the execution's passportId ref
    if (opts?.executionId) {
      const exec = this.executions.get(opts.executionId);
      if (exec && exec.tenantId === tenantId) {
        this.executions.set(opts.executionId, { ...exec, passportId: passport.passportId });
      }
    }

    return p;
  }

  getPassport(tenantId: string, id: string): ReadModelPassport | null {
    const p = this.passports.get(id);
    if (!p) return null;
    if (p.tenantId !== tenantId) return null;
    return p;
  }

  listPassports(tenantId: string): ReadModelPassport[] {
    const out: ReadModelPassport[] = [];
    for (const p of this.passports.values()) {
      if (p.tenantId === tenantId) out.push(p);
    }
    return out;
  }

  // ─── Dispute projections (derived from escrow) ──────────────────────────────

  private projectDisputeFromEscrow(agreement: SettlementAgreement): ReadModelDispute {
    const tenantId = agreement.tenantId;
    const id = `${agreement.id}:dispute`;
    const state: "disputed" | "reversed" =
      agreement.state === "reversed" ? "reversed" : "disputed";

    const dispute: ReadModelDispute = {
      id,
      tenantId,
      escrowId: agreement.id,
      raisedBy: agreement.disputedBy || "unknown",
      reason: agreement.disputeReason,
      state,
      createdAt: agreement.createdAt,
      resolvedAt: state === "reversed" ? nowIso() : undefined,
    };
    this.disputes.set(id, dispute);
    return dispute;
  }

  getDispute(tenantId: string, id: string): ReadModelDispute | null {
    const d = this.disputes.get(id);
    if (!d) return null;
    if (d.tenantId !== tenantId) return null;
    return d;
  }

  listDisputes(tenantId: string): ReadModelDispute[] {
    const out: ReadModelDispute[] = [];
    for (const d of this.disputes.values()) {
      if (d.tenantId === tenantId) out.push(d);
    }
    return out;
  }

  // ─── Extended query APIs (Indexer #5) ────────────────────────────────────────

  /**
   * List executions for a tenant filtered by status.
   * Returns newest-first by updatedAt (same order as listExecutions).
   */
  listExecutionsByStatus(tenantId: string, status: string): ReadModelExecution[] {
    return this.listExecutions(tenantId).filter((e) => e.status === status);
  }

  /**
   * List executions for a tenant whose updatedAt falls within [from, to] (inclusive, ISO-8601).
   * Returns newest-first by updatedAt.
   * Throws IndexerError("invalid_input") if from > to.
   */
  listExecutionsByDateRange(tenantId: string, from: string, to: string): ReadModelExecution[] {
    if (from > to) {
      throw new IndexerError("invalid_input", `date range invalid: from (${from}) must be ≤ to (${to})`);
    }
    return this.listExecutions(tenantId).filter(
      (e) => e.updatedAt >= from && e.updatedAt <= to,
    );
  }

  /**
   * One Audit Trail — list executions for a tenant filtered by agent provenance.
   * Supports filtering by provenanceId (exact), vendor (exact normalized), or both.
   * Returns newest-first by updatedAt. Tenant-isolated; fail-closed (empty if no match).
   * At least one filter must be provided (throws on empty opts).
   *
   * Cross-vendor value: a single query surfaces all agent actions across xAI/OpenAI/
   * Anthropic/Google/Cursor/etc., neutral, without trusting the vendor's own audit.
   */
  listExecutionsByProvenance(
    tenantId: string,
    opts: { provenanceId?: string; vendor?: string },
  ): ReadModelExecution[] {
    requireNonEmpty(tenantId, "tenantId");
    if (!opts.provenanceId && !opts.vendor) {
      throw new IndexerError("invalid_input", "at least one of provenanceId or vendor must be provided");
    }
    return this.listExecutions(tenantId).filter((e) => {
      if (opts.provenanceId && e.provenanceId !== opts.provenanceId) return false;
      if (opts.vendor && e.provenanceVendor !== opts.vendor) return false;
      return true;
    });
  }

  /**
   * Look up an execution by its actionId (index lookup within tenant).
   * Returns null if none found or if the execution belongs to a different tenant.
   * If multiple executions share the same actionId, returns the most recently updated one.
   */
  getExecutionByActionId(tenantId: string, actionId: string): ReadModelExecution | null {
    requireNonEmpty(tenantId, "tenantId");
    requireNonEmpty(actionId, "actionId");
    // Single-pass scan tracking the most-recently-updated match, instead of
    // calling listExecutions() (which sorts the tenant's ENTIRE execution
    // list, O(m log m)) just to filter+take one actionId match. Ties on
    // updatedAt break by projection-order seq (deterministic — see
    // listExecutions), so this matches its ordering exactly without sorting.
    let best: ReadModelExecution | null = null;
    let bestSeq = -1;
    for (const e of this.executions.values()) {
      if (e.tenantId !== tenantId) continue;
      if (e.actionId !== actionId) continue;
      const seq = this.executionSeq.get(e.id) ?? 0;
      if (
        best === null ||
        e.updatedAt > best.updatedAt ||
        (e.updatedAt === best.updatedAt && seq > bestSeq)
      ) {
        best = e;
        bestSeq = seq;
      }
    }
    return best;
  }

  /**
   * Actor summary for a given actor within a tenant.
   * Returns the actor record plus a count of their executions.
   * Returns null if the actor is unknown or belongs to a different tenant.
   */
  actorSummary(
    tenantId: string,
    actorId: string,
  ): { actor: ReadModelActor; executionCount: number } | null {
    const actor = this.getActor(tenantId, actorId);
    if (!actor) return null;
    // Single-pass unsorted count, instead of listExecutions(tenantId) (which
    // sorts the tenant's ENTIRE execution list, O(m log m)) just to take a
    // .filter().length — order is irrelevant to a count. Mirrors
    // PgReadModelStore.actorSummary, which also counts via an unordered query.
    let executionCount = 0;
    for (const e of this.executions.values()) {
      if (e.tenantId === tenantId && e.actor === actorId) executionCount++;
    }
    return { actor, executionCount };
  }
}
