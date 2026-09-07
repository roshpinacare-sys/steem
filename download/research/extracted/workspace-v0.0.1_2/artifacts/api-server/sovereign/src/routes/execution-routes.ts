/**
 * src/routes/execution-routes.ts — framework-agnostic handlers for the ExecutionWorkflow API.
 *
 * Pattern: same as sovereign-routes.ts — each handler takes Ctx and returns Res.
 * Accepts both ExecutionStore (sync, InMemoryExecutionStore) and
 * AsyncExecutionStore (async, PgExecutionStore) — all store calls are wrapped in
 * Promise.resolve() so both variants work transparently.
 *
 * Routes:
 *   POST   /api/execution                    — create a new workflow
 *   GET    /api/execution                    — list workflows for tenant
 *   GET    /api/execution/:id                — get a workflow by id
 *   POST   /api/execution/:id/transition     — transition workflow status
 *   POST   /api/execution/:id/supervise      — supervise a failed workflow (retry)
 *
 * Invariants:
 *   • tenantId from x-tenant-id is mandatory — fail-closed.
 *   • Cross-tenant access → 404 (not 403 — do not confirm existence).
 *   • BigInt is not used here — workflow state carries no monetary amounts.
 */

import type { ExecutionStore, AsyncExecutionStore, ExecutionWorkflow } from "../../lib/orchestrator/types.ts";
import { ExecutionError } from "../../lib/orchestrator/execution-workflow.ts";
import {
  superviseFailedWorkflow,
} from "../../lib/orchestrator/execution-supervisor.ts";
import {
  DEFAULT_RETRY_POLICY,
} from "../../lib/orchestrator/retry-policy.ts";
import type { RetryPolicyConfig } from "../../lib/orchestrator/retry-policy.ts";
import type { IndexerEventBus } from "../../lib/indexer/index.ts";

export interface Ctx {
  tenantId: string;
  body: any;
  params: Record<string, string>;
}

export interface Res {
  status: number;
  body: any;
}

export interface Route {
  method: string;
  pattern: string;
  handler: (ctx: Ctx) => Promise<Res>;
}

const ok = (body: any, status = 200): Res => ({ status, body });
const err = (status: number, message: string): Res => ({ status, body: { error: message } });

/**
 * AnyExecutionStore — union that covers both sync and async store variants.
 * All store method calls in route handlers use `await Promise.resolve(...)` so
 * both InMemoryExecutionStore (synchronous) and PgExecutionStore (async) work.
 */
type AnyExecutionStore = ExecutionStore | AsyncExecutionStore;

function serializeWorkflow(wf: ExecutionWorkflow): Record<string, unknown> {
  return {
    id: wf.id,
    tenantId: wf.tenantId,
    actionId: wf.actionId,
    intentId: wf.intentId ?? null,
    status: wf.status,
    createdAt: wf.createdAt,
    updatedAt: wf.updatedAt,
    leaseExpiresAt: wf.leaseExpiresAt,
    claimedBy: wf.claimedBy,
    executionRef: wf.executionRef ?? null,
    approvalId: wf.approvalId ?? null,
    evidenceRefs: wf.evidenceRefs ?? null,
    retryOfWorkflowId: wf.retryOfWorkflowId ?? null,
    runLogLength: wf.runLog.length,
    runLog: wf.runLog,
  };
}

function mapExecutionError(e: ExecutionError): Res {
  switch (e.code) {
    case "workflow_not_found":
      return err(404, e.message);
    case "tenant_mismatch":
      return err(404, "not found");
    case "invalid_transition":
      return err(422, e.message);
    case "lease_denied":
    case "lease_not_held":
      return err(409, e.message);
    case "missing_tenant":
    case "missing_action_id":
      return err(400, e.message);
    case "invalid_retry_config":
      return err(422, e.message);
    case "tampered_log":
      return err(500, e.message);
    default:
      return err(500, e.message);
  }
}

/**
 * emitExecutionUpdated — fail-closed best-effort projection hook.
 * Never throws: IndexerEventBus.emit() already catches internally, but this
 * wrapper also tolerates a missing bus (older composition wiring).
 */
function emitExecutionUpdated(
  bus: IndexerEventBus | undefined,
  tenantId: string,
  workflow: ExecutionWorkflow,
): void {
  if (!bus) return;
  bus.emit({ type: "execution.updated", tenantId, workflow });
}

/**
 * emitApprovalDecided — fail-closed best-effort projection hook.
 * Emitted when a workflow is created with a pre-existing approvalId.
 * riskClass/approvalClass/outcome may be unknown if the caller doesn't supply them;
 * the event-bus/projectApproval handles partial data gracefully.
 */
function emitApprovalDecided(
  bus: IndexerEventBus | undefined,
  tenantId: string,
  workflow: ExecutionWorkflow,
  extras?: { riskClass?: string; approvalClass?: string; outcome?: "allowed" | "denied"; decisionTrace?: string },
): void {
  if (!bus || !workflow.approvalId) return;
  bus.emit({
    type: "approval.decided",
    tenantId,
    approvalId: workflow.approvalId,
    actionId: workflow.actionId,
    riskClass: extras?.riskClass ?? "unknown",
    approvalClass: extras?.approvalClass ?? "auto",
    decisionTrace: extras?.decisionTrace,
    outcome: extras?.outcome ?? "allowed",
    timestamp: workflow.createdAt,
    executionId: workflow.id,
  });
}

export function executionRoutes(store: AnyExecutionStore, indexerEventBus?: IndexerEventBus): Route[] {
  return [
    // ── POST /api/execution — create workflow ────────────────────────────────
    {
      method: "POST",
      pattern: "/api/execution",
      handler: async (c) => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const b = c.body ?? {};
        const { actionId, intentId, executionRef, approvalId, evidenceRefs, retryOfWorkflowId,
                riskClass, approvalClass, approvalOutcome, decisionTrace } = b;
        if (!actionId || typeof actionId !== "string") {
          return err(400, "actionId (string) is required");
        }
        if (evidenceRefs !== undefined && !Array.isArray(evidenceRefs)) {
          return err(400, "evidenceRefs must be an array of strings");
        }

        try {
          const wf = await Promise.resolve(
            store.create({
              tenantId: c.tenantId,
              actionId,
              intentId: intentId ? String(intentId) : undefined,
              executionRef: executionRef ? String(executionRef) : undefined,
              approvalId: approvalId ? String(approvalId) : undefined,
              evidenceRefs: evidenceRefs
                ? (evidenceRefs as unknown[]).map(String)
                : undefined,
              retryOfWorkflowId: retryOfWorkflowId ? String(retryOfWorkflowId) : undefined,
            }),
          );
          emitExecutionUpdated(indexerEventBus, c.tenantId, wf);
          if (wf.approvalId) {
            emitApprovalDecided(indexerEventBus, c.tenantId, wf, {
              riskClass: riskClass ? String(riskClass) : undefined,
              approvalClass: approvalClass ? String(approvalClass) : undefined,
              outcome: approvalOutcome === "denied" ? "denied" : "allowed",
              decisionTrace: decisionTrace ? String(decisionTrace) : undefined,
            });
          }
          return ok({ ok: true, workflow: serializeWorkflow(wf) }, 201);
        } catch (e: any) {
          if (e instanceof ExecutionError) return mapExecutionError(e);
          return err(400, e?.message ?? "failed to create workflow");
        }
      },
    },

    // ── GET /api/execution — list workflows for tenant ───────────────────────
    {
      method: "GET",
      pattern: "/api/execution",
      handler: async (c) => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        try {
          const workflows = await Promise.resolve(store.list(c.tenantId));
          return ok({ ok: true, workflows: workflows.map(serializeWorkflow) });
        } catch (e: any) {
          if (e instanceof ExecutionError) return mapExecutionError(e);
          return err(500, e?.message ?? "failed to list workflows");
        }
      },
    },

    // ── GET /api/execution/:id — get workflow by id ──────────────────────────
    {
      method: "GET",
      pattern: "/api/execution/:id",
      handler: async (c) => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const { id } = c.params;
        if (!id) return err(400, "id param required");
        try {
          const wf = await Promise.resolve(store.get(id, c.tenantId));
          if (!wf) return err(404, "workflow not found");
          return ok({ ok: true, workflow: serializeWorkflow(wf) });
        } catch (e: any) {
          if (e instanceof ExecutionError) return mapExecutionError(e);
          return err(500, e?.message ?? "failed to get workflow");
        }
      },
    },

    // ── POST /api/execution/:id/transition — transition status ───────────────
    {
      method: "POST",
      pattern: "/api/execution/:id/transition",
      handler: async (c) => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const { id } = c.params;
        if (!id) return err(400, "id param required");
        const b = c.body ?? {};
        const { toStatus, actor, reason } = b;
        if (!toStatus || typeof toStatus !== "string") {
          return err(400, "toStatus (string) is required");
        }
        if (!actor || typeof actor !== "string") {
          return err(400, "actor (string) is required");
        }
        try {
          const wf = await Promise.resolve(
            store.transition(
              id,
              c.tenantId,
              toStatus as any,
              actor,
              reason ? String(reason) : undefined,
            ),
          );
          emitExecutionUpdated(indexerEventBus, c.tenantId, wf);
          return ok({ ok: true, workflow: serializeWorkflow(wf) });
        } catch (e: any) {
          if (e instanceof ExecutionError) return mapExecutionError(e);
          return err(500, e?.message ?? "failed to transition workflow");
        }
      },
    },

    // ── POST /api/execution/:id/supervise — supervise failed workflow ─────────
    {
      method: "POST",
      pattern: "/api/execution/:id/supervise",
      handler: async (c) => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const { id } = c.params;
        if (!id) return err(400, "id param required");
        const b = c.body ?? {};
        const { workerId, retryConfig } = b;
        if (!workerId || typeof workerId !== "string") {
          return err(400, "workerId (string) is required");
        }

        let config: RetryPolicyConfig = DEFAULT_RETRY_POLICY;
        if (retryConfig !== undefined) {
          if (typeof retryConfig !== "object" || retryConfig === null) {
            return err(400, "retryConfig must be an object");
          }
          config = retryConfig as RetryPolicyConfig;
        }

        try {
          // superviseFailedWorkflow works with both sync and async stores via casting
          // The ExecutionStore interface is synchronous; for async stores we wrap the
          // store so supervise can operate on the already-fetched workflow.
          const wf = await Promise.resolve(store.get(id, c.tenantId));
          if (!wf) return err(404, "workflow not found");
          if (wf.status !== "failed") {
            return err(
              422,
              `retry only applies to a failed workflow (status is "${wf.status}")`,
            );
          }

          // Use the sync superviseFailedWorkflow with an InMemoryExecutionStore wrapper
          // that holds the prefetched workflow, OR work with sync store directly.
          // Since superviseFailedWorkflow needs a store.get + store.create, delegate:
          const outcome = superviseFailedWorkflow(
            store as any,
            id,
            c.tenantId,
            workerId,
            config,
          );
          // superviseFailedWorkflow is sync; for async stores, we need to await create()
          // but since outcome.retryWorkflow is already created (sync), we check if it's
          // a Promise and resolve it.
          const retryWorkflow = outcome.retryWorkflow instanceof Promise
            ? await outcome.retryWorkflow
            : outcome.retryWorkflow;
          const original = outcome.original instanceof Promise
            ? await outcome.original
            : outcome.original;
          emitExecutionUpdated(indexerEventBus, c.tenantId, original);
          if (retryWorkflow) emitExecutionUpdated(indexerEventBus, c.tenantId, retryWorkflow);
          return ok({
            ok: true,
            plan: outcome.plan,
            original: serializeWorkflow(original),
            retryWorkflow: retryWorkflow ? serializeWorkflow(retryWorkflow) : null,
          });
        } catch (e: any) {
          if (e instanceof ExecutionError) return mapExecutionError(e);
          return err(500, e?.message ?? "supervise failed");
        }
      },
    },
  ];
}
