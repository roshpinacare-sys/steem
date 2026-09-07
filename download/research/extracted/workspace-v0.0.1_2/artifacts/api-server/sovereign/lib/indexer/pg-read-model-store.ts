/**
 * lib/indexer/pg-read-model-store.ts — PgReadModelStore: PostgreSQL-backed read-model store.
 *
 * PURPOSE
 * -------
 * Production-grade persistence for Trust-Graph read-model entities.
 * Implements the same projection + query API as InMemoryReadModelStore, backed by DbPool
 * so it works identically with:
 *   • InMemoryPool  — tests / local dev (no external Postgres required)
 *   • pg.Pool       — production (swap in at composition root)
 *
 * TENANT ISOLATION (invariant)
 * ----------------------------
 * Every query filters by tenant_id. No path returns an entity whose
 * tenantId ≠ the requested tenantId. Cross-tenant get() → null.
 *
 * SCHEMA (6 tables)
 * -----------------
 * read_model_actors       — Actor projections
 * read_model_executions   — ExecutionWorkflow projections
 * read_model_approvals    — Approval decision projections
 * read_model_escrows      — SettlementAgreement projections
 * read_model_passports    — ActionPassport projections
 * read_model_disputes     — Dispute projections (derived from escrow)
 *
 * BigInt μ¢ fields are stored as TEXT decimal strings (JSON-safe).
 * ISO-8601 timestamps stored as TEXT.
 *
 * InMemoryPool limitations honoured:
 *   • No RETURNING, no ON CONFLICT, no COUNT(*), no JOINs, no JSONB.
 *   • Upsert = check-then-INSERT or UPDATE in two queries.
 *
 * Zero external dependencies — DbPool only.
 */

import type { DbPool } from "../db/types.ts";
import type {
  ReadModelActor,
  ReadModelExecution,
  ReadModelApproval,
  ReadModelEscrow,
  ReadModelPassport,
  ReadModelDispute,
} from "./types.ts";
import { IndexerError } from "./types.ts";
import type { ExecutionWorkflow } from "../orchestrator/types.ts";
import type { SettlementAgreement } from "../escrow/settlement.ts";
import type { ActionPassport } from "../passport/types.ts";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const DDL_ACTORS = `
  CREATE TABLE IF NOT EXISTS read_model_actors (
    id                           TEXT,
    tenant_id                    TEXT,
    actor_id                     TEXT,
    actor_type                   TEXT,
    first_seen_at                TEXT,
    last_active_at               TEXT,
    total_actions                INTEGER,
    total_value_moved_microunits TEXT
  )
`;

const DDL_EXECUTIONS = `
  CREATE TABLE IF NOT EXISTS read_model_executions (
    id            TEXT,
    tenant_id     TEXT,
    workflow_id   TEXT,
    action_id     TEXT,
    intent_id     TEXT,
    status        TEXT,
    created_at    TEXT,
    updated_at    TEXT,
    actor         TEXT,
    evidence_count INTEGER,
    approval_id   TEXT,
    passport_id   TEXT,
    escrow_id     TEXT
  )
`;

const DDL_APPROVALS = `
  CREATE TABLE IF NOT EXISTS read_model_approvals (
    id              TEXT,
    tenant_id       TEXT,
    action_id       TEXT,
    risk_class      TEXT,
    approval_class  TEXT,
    decision_trace  TEXT,
    outcome         TEXT,
    timestamp       TEXT,
    execution_id    TEXT
  )
`;

const DDL_ESCROWS = `
  CREATE TABLE IF NOT EXISTS read_model_escrows (
    id                          TEXT,
    tenant_id                   TEXT,
    agreement_id                TEXT,
    opportunity_id              TEXT,
    payer_account_id            TEXT,
    worker_account_id           TEXT,
    total_amount_microunits     TEXT,
    released_amount_microunits  TEXT,
    state                       TEXT,
    created_at                  TEXT,
    updated_at                  TEXT,
    execution_id                TEXT,
    release_passport_id         TEXT
  )
`;

const DDL_PASSPORTS = `
  CREATE TABLE IF NOT EXISTS read_model_passports (
    id                   TEXT,
    tenant_id            TEXT,
    passport_id          TEXT,
    audit_id             TEXT,
    issued_at            TEXT,
    outcome              TEXT,
    ledger_effect_id     TEXT,
    attestation_present  INTEGER,
    hash                 TEXT,
    execution_id         TEXT,
    approval_id          TEXT
  )
`;

const DDL_DISPUTES = `
  CREATE TABLE IF NOT EXISTS read_model_disputes (
    id          TEXT,
    tenant_id   TEXT,
    escrow_id   TEXT,
    raised_by   TEXT,
    reason      TEXT,
    state       TEXT,
    created_at  TEXT,
    resolved_at TEXT
  )
`;

const ALL_DDL = [DDL_ACTORS, DDL_EXECUTIONS, DDL_APPROVALS, DDL_ESCROWS, DDL_PASSPORTS, DDL_DISPUTES];

// ─── Row shapes ───────────────────────────────────────────────────────────────

type ActorRow = {
  id: string; tenant_id: string; actor_id: string; actor_type: string;
  first_seen_at: string; last_active_at: string; total_actions: number;
  total_value_moved_microunits: string;
};

type ExecutionRow = {
  id: string; tenant_id: string; workflow_id: string; action_id: string;
  intent_id: string | null; status: string; created_at: string; updated_at: string;
  actor: string; evidence_count: number; approval_id: string | null;
  passport_id: string | null; escrow_id: string | null;
};

type ApprovalRow = {
  id: string; tenant_id: string; action_id: string; risk_class: string;
  approval_class: string; decision_trace: string | null; outcome: string; timestamp: string;
  execution_id: string | null;
};

type EscrowRow = {
  id: string; tenant_id: string; agreement_id: string; opportunity_id: string;
  payer_account_id: string; worker_account_id: string;
  total_amount_microunits: string; released_amount_microunits: string;
  state: string; created_at: string; updated_at: string;
  execution_id: string | null; release_passport_id: string | null;
};

type PassportRow = {
  id: string; tenant_id: string; passport_id: string; audit_id: string;
  issued_at: string; outcome: string; ledger_effect_id: string | null;
  attestation_present: number; hash: string;
  execution_id: string | null; approval_id: string | null;
};

type DisputeRow = {
  id: string; tenant_id: string; escrow_id: string; raised_by: string;
  reason: string | null; state: string; created_at: string; resolved_at: string | null;
};

// ─── Row ↔ entity converters ──────────────────────────────────────────────────

function rowToActor(row: ActorRow): ReadModelActor {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    actorType: row.actor_type as ReadModelActor["actorType"],
    firstSeenAt: row.first_seen_at,
    lastActiveAt: row.last_active_at,
    totalActions: Number(row.total_actions),
    totalValueMovedMicrounits: BigInt(row.total_value_moved_microunits),
  };
}

function rowToExecution(row: ExecutionRow): ReadModelExecution {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workflowId: row.workflow_id,
    actionId: row.action_id,
    ...(row.intent_id ? { intentId: row.intent_id } : {}),
    status: row.status as ReadModelExecution["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    actor: row.actor,
    evidenceCount: Number(row.evidence_count),
    ...(row.approval_id ? { approvalId: row.approval_id } : {}),
    ...(row.passport_id ? { passportId: row.passport_id } : {}),
    ...(row.escrow_id ? { escrowId: row.escrow_id } : {}),
  };
}

function rowToApproval(row: ApprovalRow): ReadModelApproval {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actionId: row.action_id,
    riskClass: row.risk_class as ReadModelApproval["riskClass"],
    approvalClass: row.approval_class as ReadModelApproval["approvalClass"],
    ...(row.decision_trace ? { decisionTrace: row.decision_trace } : {}),
    outcome: row.outcome as "allowed" | "denied",
    timestamp: row.timestamp,
    ...(row.execution_id ? { executionId: row.execution_id } : {}),
  };
}

function rowToEscrow(row: EscrowRow): ReadModelEscrow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agreementId: row.agreement_id,
    opportunityId: row.opportunity_id,
    payerAccountId: row.payer_account_id,
    workerAccountId: row.worker_account_id,
    totalAmountMicrounits: BigInt(row.total_amount_microunits),
    releasedAmountMicrounits: BigInt(row.released_amount_microunits),
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.execution_id ? { executionId: row.execution_id } : {}),
    ...(row.release_passport_id ? { releasePassportId: row.release_passport_id } : {}),
  };
}

function rowToPassport(row: PassportRow): ReadModelPassport {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    passportId: row.passport_id,
    auditId: row.audit_id,
    issuedAt: row.issued_at,
    outcome: row.outcome,
    ...(row.ledger_effect_id ? { ledgerEffectId: row.ledger_effect_id } : {}),
    attestationPresent: Boolean(row.attestation_present),
    hash: row.hash,
    ...(row.execution_id ? { executionId: row.execution_id } : {}),
    ...(row.approval_id ? { approvalId: row.approval_id } : {}),
  };
}

function rowToDispute(row: DisputeRow): ReadModelDispute {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    escrowId: row.escrow_id,
    raisedBy: row.raised_by,
    ...(row.reason ? { reason: row.reason } : {}),
    state: row.state as "disputed" | "reversed",
    createdAt: row.created_at,
    ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
  };
}

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

// ─── PgReadModelStore ─────────────────────────────────────────────────────────

/**
 * PostgreSQL-backed read-model store.
 *
 * Drop-in replacement for InMemoryReadModelStore — same projection + query API,
 * same fail-closed tenant isolation, same BigInt μ¢ handling.
 *
 * Call init() once before use (idempotent; creates tables if missing).
 */
export class PgReadModelStore {
  private readonly pool: DbPool;
  private initialised = false;

  constructor(pool: DbPool) {
    this.pool = pool;
  }

  // ── init ──────────────────────────────────────────────────────────────────

  /**
   * Create all read-model tables if they do not already exist.
   * Safe to call multiple times (idempotent).
   */
  async init(): Promise<void> {
    if (this.initialised) return;
    for (const ddl of ALL_DDL) {
      try {
        await this.pool.query(ddl);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("already exists")) throw err;
      }
    }
    this.initialised = true;
  }

  // ─── Actor projections ────────────────────────────────────────────────────

  async projectActor(input: {
    tenantId: string;
    actorId: string;
    actorType: "system" | "human" | "agent";
    timestamp: string;
    valueMovedMicrounits?: bigint;
  }): Promise<ReadModelActor> {
    const tenantId = requireNonEmpty(input.tenantId, "tenantId");
    const actorId = requireNonEmpty(input.actorId, "actorId");
    const id = makeActorId(tenantId, actorId);
    const ts = input.timestamp || nowIso();
    const valueMoved = input.valueMovedMicrounits ?? 0n;

    const existing = await this.getActor(tenantId, actorId);
    if (existing) {
      const updated: ReadModelActor = {
        ...existing,
        lastActiveAt: ts,
        totalActions: existing.totalActions + 1,
        totalValueMovedMicrounits: existing.totalValueMovedMicrounits + valueMoved,
      };
      await this.pool.query(
        `UPDATE read_model_actors SET last_active_at=$1, total_actions=$2, total_value_moved_microunits=$3 WHERE id=$4 AND tenant_id=$5`,
        [updated.lastActiveAt, updated.totalActions, updated.totalValueMovedMicrounits.toString(), id, tenantId],
      );
      return updated;
    }

    const actor: ReadModelActor = {
      id, tenantId, actorId, actorType: input.actorType,
      firstSeenAt: ts, lastActiveAt: ts, totalActions: 1,
      totalValueMovedMicrounits: valueMoved,
    };
    await this.pool.query(
      `INSERT INTO read_model_actors (id, tenant_id, actor_id, actor_type, first_seen_at, last_active_at, total_actions, total_value_moved_microunits) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, tenantId, actorId, actor.actorType, actor.firstSeenAt, actor.lastActiveAt, actor.totalActions, actor.totalValueMovedMicrounits.toString()],
    );
    return actor;
  }

  async getActor(tenantId: string, actorId: string): Promise<ReadModelActor | null> {
    const id = makeActorId(tenantId, actorId);
    const result = await this.pool.query<ActorRow>(
      `SELECT * FROM read_model_actors WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId],
    );
    if (result.rows.length === 0) return null;
    return rowToActor(result.rows[0]);
  }

  async listActors(tenantId: string): Promise<ReadModelActor[]> {
    const result = await this.pool.query<ActorRow>(
      `SELECT * FROM read_model_actors WHERE tenant_id=$1`,
      [tenantId],
    );
    return result.rows.map(rowToActor);
  }

  // ─── Execution projections ────────────────────────────────────────────────

  async projectExecution(workflow: ExecutionWorkflow, opts?: { passportId?: string; escrowId?: string }): Promise<ReadModelExecution> {
    const tenantId = requireNonEmpty(workflow.tenantId, "tenantId");
    const id = workflow.id;
    const evidenceCount = workflow.evidenceRefs ? workflow.evidenceRefs.length : 0;
    const actor = workflow.runLog.length > 0 ? workflow.runLog[0].actor : "system";

    const existing = await this.getExecution(tenantId, id);

    const exec: ReadModelExecution = {
      id, tenantId, workflowId: workflow.id, actionId: workflow.actionId,
      intentId: workflow.intentId, status: workflow.status,
      createdAt: workflow.createdAt, updatedAt: workflow.updatedAt,
      actor, evidenceCount, approvalId: workflow.approvalId,
      passportId: opts?.passportId ?? existing?.passportId,
      escrowId: opts?.escrowId ?? existing?.escrowId,
    };

    if (existing) {
      await this.pool.query(
        `UPDATE read_model_executions SET action_id=$1, intent_id=$2, status=$3, updated_at=$4, actor=$5, evidence_count=$6, approval_id=$7, passport_id=$8, escrow_id=$9 WHERE id=$10 AND tenant_id=$11`,
        [exec.actionId, exec.intentId ?? null, exec.status, exec.updatedAt, exec.actor, exec.evidenceCount, exec.approvalId ?? null, exec.passportId ?? null, exec.escrowId ?? null, id, tenantId],
      );
    } else {
      await this.pool.query(
        `INSERT INTO read_model_executions (id, tenant_id, workflow_id, action_id, intent_id, status, created_at, updated_at, actor, evidence_count, approval_id, passport_id, escrow_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, tenantId, exec.workflowId, exec.actionId, exec.intentId ?? null, exec.status, exec.createdAt, exec.updatedAt, exec.actor, exec.evidenceCount, exec.approvalId ?? null, exec.passportId ?? null, exec.escrowId ?? null],
      );
    }
    return exec;
  }

  async getExecution(tenantId: string, id: string): Promise<ReadModelExecution | null> {
    const result = await this.pool.query<ExecutionRow>(
      `SELECT * FROM read_model_executions WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId],
    );
    if (result.rows.length === 0) return null;
    return rowToExecution(result.rows[0]);
  }

  async listExecutions(tenantId: string): Promise<ReadModelExecution[]> {
    const result = await this.pool.query<ExecutionRow>(
      `SELECT * FROM read_model_executions WHERE tenant_id=$1 ORDER BY updated_at DESC`,
      [tenantId],
    );
    return result.rows.map(rowToExecution);
  }

  async listExecutionsByStatus(tenantId: string, status: string): Promise<ReadModelExecution[]> {
    const result = await this.pool.query<ExecutionRow>(
      `SELECT * FROM read_model_executions WHERE tenant_id=$1 AND status=$2 ORDER BY updated_at DESC`,
      [tenantId, status],
    );
    return result.rows.map(rowToExecution);
  }

  async listExecutionsByDateRange(tenantId: string, from: string, to: string): Promise<ReadModelExecution[]> {
    if (from > to) {
      throw new IndexerError("invalid_input", `date range invalid: from (${from}) must be ≤ to (${to})`);
    }
    const result = await this.pool.query<ExecutionRow>(
      `SELECT * FROM read_model_executions WHERE tenant_id=$1 AND updated_at >= $2 AND updated_at <= $3 ORDER BY updated_at DESC`,
      [tenantId, from, to],
    );
    return result.rows.map(rowToExecution);
  }

  async getExecutionByActionId(tenantId: string, actionId: string): Promise<ReadModelExecution | null> {
    requireNonEmpty(tenantId, "tenantId");
    requireNonEmpty(actionId, "actionId");
    const result = await this.pool.query<ExecutionRow>(
      `SELECT * FROM read_model_executions WHERE tenant_id=$1 AND action_id=$2 ORDER BY updated_at DESC`,
      [tenantId, actionId],
    );
    if (result.rows.length === 0) return null;
    return rowToExecution(result.rows[0]);
  }

  async actorSummary(
    tenantId: string,
    actorId: string,
  ): Promise<{ actor: ReadModelActor; executionCount: number } | null> {
    const actor = await this.getActor(tenantId, actorId);
    if (!actor) return null;
    const result = await this.pool.query<ExecutionRow>(
      `SELECT * FROM read_model_executions WHERE tenant_id=$1 AND actor=$2`,
      [tenantId, actorId],
    );
    return { actor, executionCount: result.rows.length };
  }

  // ─── Approval projections ─────────────────────────────────────────────────

  async projectApproval(input: {
    id: string; tenantId: string; actionId: string;
    riskClass: string; approvalClass: string;
    decisionTrace?: string; outcome: "allowed" | "denied"; timestamp: string;
    executionId?: string;
  }): Promise<ReadModelApproval> {
    const tenantId = requireNonEmpty(input.tenantId, "tenantId");
    const id = requireNonEmpty(input.id, "id");

    const approval: ReadModelApproval = {
      id, tenantId,
      actionId: requireNonEmpty(input.actionId, "actionId"),
      riskClass: input.riskClass as ReadModelApproval["riskClass"],
      approvalClass: input.approvalClass as ReadModelApproval["approvalClass"],
      decisionTrace: input.decisionTrace,
      outcome: input.outcome,
      timestamp: input.timestamp || nowIso(),
      executionId: input.executionId,
    };

    const existing = await this.getApproval(tenantId, id);
    if (existing) {
      await this.pool.query(
        `UPDATE read_model_approvals SET action_id=$1, risk_class=$2, approval_class=$3, decision_trace=$4, outcome=$5, timestamp=$6, execution_id=$7 WHERE id=$8 AND tenant_id=$9`,
        [approval.actionId, approval.riskClass, approval.approvalClass, approval.decisionTrace ?? null, approval.outcome, approval.timestamp, approval.executionId ?? null, id, tenantId],
      );
    } else {
      await this.pool.query(
        `INSERT INTO read_model_approvals (id, tenant_id, action_id, risk_class, approval_class, decision_trace, outcome, timestamp, execution_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, tenantId, approval.actionId, approval.riskClass, approval.approvalClass, approval.decisionTrace ?? null, approval.outcome, approval.timestamp, approval.executionId ?? null],
      );
    }
    return approval;
  }

  async getApproval(tenantId: string, id: string): Promise<ReadModelApproval | null> {
    const result = await this.pool.query<ApprovalRow>(
      `SELECT * FROM read_model_approvals WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId],
    );
    if (result.rows.length === 0) return null;
    return rowToApproval(result.rows[0]);
  }

  async listApprovals(tenantId: string): Promise<ReadModelApproval[]> {
    const result = await this.pool.query<ApprovalRow>(
      `SELECT * FROM read_model_approvals WHERE tenant_id=$1`,
      [tenantId],
    );
    return result.rows.map(rowToApproval);
  }

  // ─── Escrow projections ───────────────────────────────────────────────────

  async projectEscrow(agreement: SettlementAgreement, opts?: { executionId?: string; releasePassportId?: string }): Promise<ReadModelEscrow> {
    const tenantId = requireNonEmpty(agreement.tenantId, "tenantId");
    const id = agreement.id;

    const existing = await this.getEscrow(tenantId, id);

    const escrow: ReadModelEscrow = {
      id, tenantId, agreementId: agreement.id,
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

    if (existing) {
      await this.pool.query(
        `UPDATE read_model_escrows SET state=$1, released_amount_microunits=$2, updated_at=$3, execution_id=$4, release_passport_id=$5 WHERE id=$6 AND tenant_id=$7`,
        [escrow.state, escrow.releasedAmountMicrounits.toString(), escrow.updatedAt, escrow.executionId ?? null, escrow.releasePassportId ?? null, id, tenantId],
      );
    } else {
      await this.pool.query(
        `INSERT INTO read_model_escrows (id, tenant_id, agreement_id, opportunity_id, payer_account_id, worker_account_id, total_amount_microunits, released_amount_microunits, state, created_at, updated_at, execution_id, release_passport_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, tenantId, escrow.agreementId, escrow.opportunityId, escrow.payerAccountId, escrow.workerAccountId, escrow.totalAmountMicrounits.toString(), escrow.releasedAmountMicrounits.toString(), escrow.state, escrow.createdAt, escrow.updatedAt, escrow.executionId ?? null, escrow.releasePassportId ?? null],
      );
    }

    if (agreement.state === "disputed" || agreement.state === "reversed") {
      await this.projectDisputeFromEscrow(agreement);
    }

    return escrow;
  }

  async getEscrow(tenantId: string, id: string): Promise<ReadModelEscrow | null> {
    const result = await this.pool.query<EscrowRow>(
      `SELECT * FROM read_model_escrows WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId],
    );
    if (result.rows.length === 0) return null;
    return rowToEscrow(result.rows[0]);
  }

  async listEscrows(tenantId: string): Promise<ReadModelEscrow[]> {
    const result = await this.pool.query<EscrowRow>(
      `SELECT * FROM read_model_escrows WHERE tenant_id=$1`,
      [tenantId],
    );
    return result.rows.map(rowToEscrow);
  }

  // ─── Passport projections ─────────────────────────────────────────────────

  async projectPassport(passport: ActionPassport, opts?: { executionId?: string; approvalId?: string }): Promise<ReadModelPassport> {
    const tenantId = requireNonEmpty(passport.tenantId, "tenantId");
    const id = passport.passportId;

    const p: ReadModelPassport = {
      id, tenantId, passportId: passport.passportId,
      auditId: passport.audit.id,
      issuedAt: passport.issuedAt,
      outcome: passport.audit.outcome,
      ledgerEffectId: passport.ledgerEffect?.transactionId,
      attestationPresent: passport.attestation !== null,
      hash: passport.hash,
      executionId: opts?.executionId,
      approvalId: opts?.approvalId,
    };

    const existing = await this.getPassport(tenantId, id);
    if (existing) {
      await this.pool.query(
        `UPDATE read_model_passports SET outcome=$1, ledger_effect_id=$2, attestation_present=$3, hash=$4, execution_id=$5, approval_id=$6 WHERE id=$7 AND tenant_id=$8`,
        [p.outcome, p.ledgerEffectId ?? null, p.attestationPresent ? 1 : 0, p.hash, p.executionId ?? null, p.approvalId ?? null, id, tenantId],
      );
    } else {
      await this.pool.query(
        `INSERT INTO read_model_passports (id, tenant_id, passport_id, audit_id, issued_at, outcome, ledger_effect_id, attestation_present, hash, execution_id, approval_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, tenantId, p.passportId, p.auditId, p.issuedAt, p.outcome, p.ledgerEffectId ?? null, p.attestationPresent ? 1 : 0, p.hash, p.executionId ?? null, p.approvalId ?? null],
      );
    }
    return p;
  }

  async getPassport(tenantId: string, id: string): Promise<ReadModelPassport | null> {
    const result = await this.pool.query<PassportRow>(
      `SELECT * FROM read_model_passports WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId],
    );
    if (result.rows.length === 0) return null;
    return rowToPassport(result.rows[0]);
  }

  async listPassports(tenantId: string): Promise<ReadModelPassport[]> {
    const result = await this.pool.query<PassportRow>(
      `SELECT * FROM read_model_passports WHERE tenant_id=$1`,
      [tenantId],
    );
    return result.rows.map(rowToPassport);
  }

  // ─── Dispute projections ──────────────────────────────────────────────────

  private async projectDisputeFromEscrow(agreement: SettlementAgreement): Promise<ReadModelDispute> {
    const tenantId = agreement.tenantId;
    const id = `${agreement.id}:dispute`;
    const state: "disputed" | "reversed" = agreement.state === "reversed" ? "reversed" : "disputed";

    const dispute: ReadModelDispute = {
      id, tenantId, escrowId: agreement.id,
      raisedBy: agreement.disputedBy || "unknown",
      reason: agreement.disputeReason,
      state,
      createdAt: agreement.createdAt,
      resolvedAt: state === "reversed" ? nowIso() : undefined,
    };

    const existing = await this.getDispute(tenantId, id);
    if (existing) {
      await this.pool.query(
        `UPDATE read_model_disputes SET state=$1, resolved_at=$2 WHERE id=$3 AND tenant_id=$4`,
        [dispute.state, dispute.resolvedAt ?? null, id, tenantId],
      );
    } else {
      await this.pool.query(
        `INSERT INTO read_model_disputes (id, tenant_id, escrow_id, raised_by, reason, state, created_at, resolved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, tenantId, dispute.escrowId, dispute.raisedBy, dispute.reason ?? null, dispute.state, dispute.createdAt, dispute.resolvedAt ?? null],
      );
    }
    return dispute;
  }

  async getDispute(tenantId: string, id: string): Promise<ReadModelDispute | null> {
    const result = await this.pool.query<DisputeRow>(
      `SELECT * FROM read_model_disputes WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId],
    );
    if (result.rows.length === 0) return null;
    return rowToDispute(result.rows[0]);
  }

  async listDisputes(tenantId: string): Promise<ReadModelDispute[]> {
    const result = await this.pool.query<DisputeRow>(
      `SELECT * FROM read_model_disputes WHERE tenant_id=$1`,
      [tenantId],
    );
    return result.rows.map(rowToDispute);
  }
}
