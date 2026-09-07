/**
 * lib/orchestrator/pg-execution-store.ts — PgExecutionStore: PostgreSQL-backed execution store.
 *
 * PURPOSE
 * -------
 * Production-grade persistence for ExecutionWorkflows and their run-logs.
 * Implements AsyncExecutionStore (see types.ts) using DbPool (lib/db/types.ts),
 * so it works identically with:
 *   • InMemoryPool — tests / local dev (no external Postgres required)
 *   • pg.Pool      — production (swap in at composition root)
 *
 * Why AsyncExecutionStore (not ExecutionStore)?
 * ---------------------------------------------
 * pool.query() always returns a Promise. Making the methods sync would require
 * a synchronous pool adapter that doesn't exist and can't exist in real Postgres.
 * Following the same pattern as PgAuditStore vs InMemoryAuditStore.
 *
 * TENANT ISOLATION (invariant)
 * ----------------------------
 * Every query filters by tenant_id. No path returns a workflow whose
 * tenantId ≠ the requested tenantId. Cross-tenant get() → null.
 *
 * SCHEMA
 * ------
 * Table: execution_workflows
 *   id                   TEXT — UUID
 *   tenant_id            TEXT — isolation scope
 *   action_id            TEXT
 *   intent_id            TEXT — nullable
 *   status               TEXT — ExecutionStatus
 *   created_at           TEXT — ISO-8601
 *   updated_at           TEXT — ISO-8601
 *   lease_expires_at     TEXT — nullable; stringified ms timestamp
 *   claimed_by           TEXT — nullable; worker id
 *   execution_ref        TEXT — nullable
 *   approval_id          TEXT — nullable
 *   evidence_refs        TEXT — nullable; JSON-encoded string array
 *   retry_of_workflow_id TEXT — nullable
 *
 * Table: execution_log_entries
 *   workflow_id  TEXT — reference to execution_workflows.id
 *   tenant_id    TEXT — denormalised for fast tenant-scoped queries
 *   seq          INTEGER — per-workflow monotonic sequence (0-based)
 *   timestamp    TEXT — ISO-8601
 *   from_status  TEXT — nullable; null for genesis entry
 *   to_status    TEXT
 *   actor        TEXT
 *   reason       TEXT — nullable
 *   hash         TEXT
 *   prev_hash    TEXT
 *
 * InMemoryPool limitations honoured:
 *   • No RETURNING, no ON CONFLICT, no JOINs, no JSONB.
 *   • get() = two sequential awaited queries: one for the workflow row, one for log entries.
 *   • lease() = read-then-update (no FOR UPDATE — single-process tests are safe).
 *
 * Zero external dependencies — node:crypto + DbPool only.
 */

import { createHash, randomUUID } from "node:crypto";
import type { DbPool } from "../db/types.ts";
import type {
  ActionId,
  ExecutionStatus,
  ExecutionLogEntry,
  ExecutionWorkflow,
  AsyncExecutionStore,
} from "./types.ts";
import { ExecutionError, VALID_TRANSITIONS, VALID_TRANSITION_SET } from "./execution-workflow.ts";

// ─── DDL ─────────────────────────────────────────────────────────────────────

const CREATE_WORKFLOWS_TABLE = `
  CREATE TABLE IF NOT EXISTS execution_workflows (
    id                   TEXT,
    tenant_id            TEXT,
    action_id            TEXT,
    intent_id            TEXT,
    status               TEXT,
    created_at           TEXT,
    updated_at           TEXT,
    lease_expires_at     TEXT,
    claimed_by           TEXT,
    execution_ref        TEXT,
    approval_id          TEXT,
    evidence_refs        TEXT,
    retry_of_workflow_id TEXT
  )
`;

const CREATE_LOG_TABLE = `
  CREATE TABLE IF NOT EXISTS execution_log_entries (
    workflow_id  TEXT,
    tenant_id    TEXT,
    seq          INTEGER,
    timestamp    TEXT,
    from_status  TEXT,
    to_status    TEXT,
    actor        TEXT,
    reason       TEXT,
    hash         TEXT,
    prev_hash    TEXT
  )
`;

// ─── Row types ────────────────────────────────────────────────────────────────

type WorkflowRow = {
  id: string;
  tenant_id: string;
  action_id: string;
  intent_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  lease_expires_at: string | null;
  claimed_by: string | null;
  execution_ref: string | null;
  approval_id: string | null;
  evidence_refs: string | null;
  retry_of_workflow_id: string | null;
};

type LogRow = {
  workflow_id: string;
  tenant_id: string;
  seq: number;
  timestamp: string;
  from_status: string | null;
  to_status: string;
  actor: string;
  reason: string | null;
  hash: string;
  prev_hash: string;
};

// ─── Hash computation (mirrors execution-workflow.ts) ─────────────────────────

function computeLogHash(entry: Omit<ExecutionLogEntry, "hash">): string {
  const data = [
    entry.timestamp,
    entry.fromStatus ?? "null",
    entry.toStatus,
    entry.actor,
    entry.reason ?? "",
    entry.prevHash,
  ].join("|");
  return createHash("sha256").update(data, "utf8").digest("hex");
}

// ─── Row ↔ domain ─────────────────────────────────────────────────────────────

function rowToLogEntry(row: LogRow): ExecutionLogEntry {
  return {
    timestamp: row.timestamp,
    fromStatus: row.from_status as ExecutionStatus | null,
    toStatus: row.to_status as ExecutionStatus,
    actor: row.actor,
    reason: row.reason ?? undefined,
    hash: row.hash,
    prevHash: row.prev_hash,
  };
}

function rowsToWorkflow(wfRow: WorkflowRow, logRows: LogRow[]): ExecutionWorkflow {
  // Callers (get / list) query with ORDER BY seq ASC, so rows are already sorted.
  // Avoid redundant copy + O(n log n) in-memory sort.
  return {
    id: wfRow.id,
    tenantId: wfRow.tenant_id,
    actionId: wfRow.action_id,
    intentId: wfRow.intent_id ?? undefined,
    status: wfRow.status as ExecutionStatus,
    createdAt: wfRow.created_at,
    updatedAt: wfRow.updated_at,
    leaseExpiresAt: wfRow.lease_expires_at !== null ? Number(wfRow.lease_expires_at) : null,
    claimedBy: wfRow.claimed_by ?? null,
    executionRef: wfRow.execution_ref ?? undefined,
    approvalId: wfRow.approval_id ?? undefined,
    evidenceRefs: wfRow.evidence_refs
      ? (JSON.parse(wfRow.evidence_refs) as string[])
      : undefined,
    retryOfWorkflowId: wfRow.retry_of_workflow_id ?? undefined,
    runLog: logRows.map(rowToLogEntry),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function nowMs(): number {
  return Date.now();
}

const WORKFLOW_COLS =
  "id, tenant_id, action_id, intent_id, status, created_at, updated_at, " +
  "lease_expires_at, claimed_by, execution_ref, approval_id, evidence_refs, retry_of_workflow_id";

// ─── PgExecutionStore ─────────────────────────────────────────────────────────

/**
 * PgExecutionStore — implements AsyncExecutionStore on top of a DbPool.
 *
 * Call init() once at application startup before first use.
 *
 * Usage (InMemoryPool — tests):
 * ```ts
 * const pool = new InMemoryPool();
 * const store = new PgExecutionStore(pool);
 * await store.init();
 * const wf = await store.create({ tenantId: "t1", actionId: "a1" });
 * ```
 *
 * Usage (production — real pg.Pool):
 * ```ts
 * import { Pool } from "pg";
 * const store = new PgExecutionStore(new Pool({ connectionString: process.env.DATABASE_URL }) as unknown as DbPool);
 * await store.init();
 * ```
 */
export class PgExecutionStore implements AsyncExecutionStore {
  private readonly pool: DbPool;
  private initialised = false;

  constructor(pool: DbPool) {
    this.pool = pool;
  }

  /**
   * Create both tables (idempotent — IF NOT EXISTS).
   * Must be called once before any other method.
   */
  async init(): Promise<void> {
    if (this.initialised) return;
    await this.pool.query(CREATE_WORKFLOWS_TABLE, []);
    await this.pool.query(CREATE_LOG_TABLE, []);
    this.initialised = true;
  }

  // ── create ─────────────────────────────────────────────────────────────────

  async create(input: {
    tenantId: string;
    actionId: ActionId;
    intentId?: string;
    executionRef?: string;
    approvalId?: string;
    evidenceRefs?: string[];
    retryOfWorkflowId?: string;
  }): Promise<ExecutionWorkflow> {
    if (!input.tenantId) {
      throw new ExecutionError("missing_tenant", "tenantId is required");
    }
    if (!input.actionId) {
      throw new ExecutionError("missing_action_id", "actionId is required");
    }

    const id = randomUUID();
    const ts = nowIso();

    const genesis: Omit<ExecutionLogEntry, "hash"> = {
      timestamp: ts,
      fromStatus: null,
      toStatus: "planned",
      actor: "system",
      reason: "workflow created",
      prevHash: "genesis",
    };
    const genesisHash = computeLogHash(genesis);
    const genesisEntry: ExecutionLogEntry = { ...genesis, hash: genesisHash };

    await this.pool.query(
      `INSERT INTO execution_workflows
         (id, tenant_id, action_id, intent_id, status, created_at, updated_at,
          lease_expires_at, claimed_by, execution_ref, approval_id, evidence_refs,
          retry_of_workflow_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        input.tenantId,
        input.actionId,
        input.intentId ?? null,
        "planned",
        ts,
        ts,
        null,
        null,
        input.executionRef ?? null,
        input.approvalId ?? null,
        input.evidenceRefs ? JSON.stringify(input.evidenceRefs) : null,
        input.retryOfWorkflowId ?? null,
      ],
    );

    await this.pool.query(
      `INSERT INTO execution_log_entries
         (workflow_id, tenant_id, seq, timestamp, from_status, to_status,
          actor, reason, hash, prev_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        input.tenantId,
        0,
        genesisEntry.timestamp,
        null,
        genesisEntry.toStatus,
        genesisEntry.actor,
        genesisEntry.reason ?? null,
        genesisEntry.hash,
        genesisEntry.prevHash,
      ],
    );

    return {
      id,
      tenantId: input.tenantId,
      actionId: input.actionId,
      intentId: input.intentId,
      status: "planned",
      createdAt: ts,
      updatedAt: ts,
      runLog: [genesisEntry],
      leaseExpiresAt: null,
      claimedBy: null,
      executionRef: input.executionRef,
      approvalId: input.approvalId,
      evidenceRefs: input.evidenceRefs ? [...input.evidenceRefs] : undefined,
      retryOfWorkflowId: input.retryOfWorkflowId,
    };
  }

  // ── get ─────────────────────────────────────────────────────────────────────

  async get(id: string, tenantId: string): Promise<ExecutionWorkflow | null> {
    const wfResult = await this.pool.query<WorkflowRow>(
      `SELECT ${WORKFLOW_COLS} FROM execution_workflows WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (wfResult.rows.length === 0) return null;

    const logResult = await this.pool.query<LogRow>(
      `SELECT workflow_id, tenant_id, seq, timestamp, from_status, to_status, actor, reason, hash, prev_hash
         FROM execution_log_entries
        WHERE workflow_id = $1 AND tenant_id = $2
        ORDER BY seq ASC`,
      [id, tenantId],
    );

    return rowsToWorkflow(wfResult.rows[0], logResult.rows);
  }

  // ── list ────────────────────────────────────────────────────────────────────

  async list(tenantId: string): Promise<ExecutionWorkflow[]> {
    const wfResult = await this.pool.query<WorkflowRow>(
      `SELECT ${WORKFLOW_COLS} FROM execution_workflows WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    if (wfResult.rows.length === 0) return [];

    const logResult = await this.pool.query<LogRow>(
      `SELECT workflow_id, tenant_id, seq, timestamp, from_status, to_status, actor, reason, hash, prev_hash
         FROM execution_log_entries
        WHERE tenant_id = $1
        ORDER BY seq ASC`,
      [tenantId],
    );

    const logsByWorkflow = new Map<string, LogRow[]>();
    for (const row of logResult.rows) {
      if (!logsByWorkflow.has(row.workflow_id)) logsByWorkflow.set(row.workflow_id, []);
      logsByWorkflow.get(row.workflow_id)!.push(row);
    }

    return wfResult.rows.map((wfRow) =>
      rowsToWorkflow(wfRow, logsByWorkflow.get(wfRow.id) ?? []),
    );
  }

  // ── transition ──────────────────────────────────────────────────────────────

  async transition(
    id: string,
    tenantId: string,
    toStatus: ExecutionStatus,
    actor: string,
    reason?: string,
  ): Promise<ExecutionWorkflow> {
    const wf = await this.get(id, tenantId);
    if (!wf) {
      throw new ExecutionError("workflow_not_found", `workflow ${id} not found`);
    }

    const allowed = VALID_TRANSITION_SET[wf.status];
    if (!allowed || !allowed.has(toStatus)) {
      throw new ExecutionError(
        "invalid_transition",
        `invalid transition from "${wf.status}" to "${toStatus}"`,
      );
    }

    const prevEntry = wf.runLog[wf.runLog.length - 1];
    const ts = nowIso();
    const partial: Omit<ExecutionLogEntry, "hash"> = {
      timestamp: ts,
      fromStatus: wf.status,
      toStatus,
      actor,
      reason,
      prevHash: prevEntry.hash,
    };
    const hash = computeLogHash(partial);
    const newEntry: ExecutionLogEntry = { ...partial, hash };
    const nextSeq = wf.runLog.length;

    await this.pool.query(
      `INSERT INTO execution_log_entries
         (workflow_id, tenant_id, seq, timestamp, from_status, to_status, actor, reason, hash, prev_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        tenantId,
        nextSeq,
        newEntry.timestamp,
        newEntry.fromStatus,
        newEntry.toStatus,
        newEntry.actor,
        newEntry.reason ?? null,
        newEntry.hash,
        newEntry.prevHash,
      ],
    );

    const updatedAt = nowIso();
    await this.pool.query(
      `UPDATE execution_workflows SET status = $1, updated_at = $2 WHERE id = $3 AND tenant_id = $4`,
      [toStatus, updatedAt, id, tenantId],
    );

    return { ...wf, status: toStatus, updatedAt, runLog: [...wf.runLog, newEntry] };
  }

  // ── verifyChain ─────────────────────────────────────────────────────────────

  async verifyChain(id: string, tenantId: string): Promise<boolean> {
    const wf = await this.get(id, tenantId);
    if (!wf) return false;

    const log = wf.runLog;
    if (log.length === 0) return false;

    for (let i = 0; i < log.length; i++) {
      const entry = log[i];
      const expectedPrev = i === 0 ? "genesis" : log[i - 1].hash;
      if (entry.prevHash !== expectedPrev) return false;
      const { hash, ...partial } = entry;
      if (hash !== computeLogHash(partial)) return false;
    }
    return true;
  }

  // ── replay ──────────────────────────────────────────────────────────────────

  async replay(
    tenantId: string,
    id: string,
    handler: (entry: ExecutionLogEntry, index: number) => void,
  ): Promise<number> {
    const wfResult = await this.pool.query<{ id: string }>(
      `SELECT id FROM execution_workflows WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );

    if (wfResult.rows.length === 0) {
      const anyResult = await this.pool.query<{ id: string }>(
        `SELECT id FROM execution_workflows WHERE id = $1 LIMIT 1`,
        [id],
      );
      if (anyResult.rows.length > 0) {
        throw new ExecutionError(
          "tenant_mismatch",
          `workflow ${id} does not belong to tenant ${tenantId}`,
        );
      }
      throw new ExecutionError("workflow_not_found", `workflow ${id} not found`);
    }

    const logResult = await this.pool.query<LogRow>(
      `SELECT workflow_id, tenant_id, seq, timestamp, from_status, to_status, actor, reason, hash, prev_hash
         FROM execution_log_entries
        WHERE workflow_id = $1 AND tenant_id = $2
        ORDER BY seq ASC`,
      [id, tenantId],
    );

    // Single pass: rowToLogEntry + handler dispatch in one loop — eliminates
    // the intermediate `entries` array that .map() would allocate before the
    // for-loop ever ran. `count` doubles as the running index.
    let count = 0;
    for (const row of logResult.rows) {
      handler(rowToLogEntry(row), count);
      count++;
    }
    return count;
  }

  // ── lease ───────────────────────────────────────────────────────────────────

  async lease(
    id: string,
    tenantId: string,
    workerId: string,
    durationMs: number,
  ): Promise<boolean> {
    if (!workerId) throw new ExecutionError("lease_denied", "workerId is required");
    if (durationMs <= 0) throw new ExecutionError("lease_denied", "durationMs must be positive");

    const wf = await this.get(id, tenantId);
    if (!wf) return false;

    const now = nowMs();
    const leaseActive =
      wf.claimedBy !== null &&
      wf.leaseExpiresAt !== null &&
      wf.leaseExpiresAt > now;

    if (leaseActive) return false;

    const newExpiry = String(now + durationMs);
    const updatedAt = nowIso();
    await this.pool.query(
      `UPDATE execution_workflows SET claimed_by = $1, lease_expires_at = $2, updated_at = $3 WHERE id = $4 AND tenant_id = $5`,
      [workerId, newExpiry, updatedAt, id, tenantId],
    );
    return true;
  }

  // ── releaseLease ─────────────────────────────────────────────────────────────

  async releaseLease(
    id: string,
    tenantId: string,
    workerId: string,
  ): Promise<boolean> {
    const wf = await this.get(id, tenantId);
    if (!wf) return false;

    const now = nowMs();
    const leaseExpired = !wf.leaseExpiresAt || wf.leaseExpiresAt <= now;
    if (wf.claimedBy && wf.claimedBy !== workerId && !leaseExpired) {
      return false;
    }

    const updatedAt = nowIso();
    await this.pool.query(
      `UPDATE execution_workflows SET claimed_by = $1, lease_expires_at = $2, updated_at = $3 WHERE id = $4 AND tenant_id = $5`,
      [null, null, updatedAt, id, tenantId],
    );
    return true;
  }
}
