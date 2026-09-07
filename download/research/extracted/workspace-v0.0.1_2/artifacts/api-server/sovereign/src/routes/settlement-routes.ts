/**
 * src/routes/settlement-routes.ts — framework-agnostic HTTP handlers for the Settlement API.
 *
 * Settlement routes (Settlement #3):
 *   POST   /api/settlement                           — create agreement
 *   GET    /api/settlement                           — list for tenant
 *   GET    /api/settlement/:id                       — get by id
 *   POST   /api/settlement/:id/fund                  — fund (created→held)
 *   POST   /api/settlement/:id/partial-release        — partial release
 *   POST   /api/settlement/:id/release               — full release
 *   POST   /api/settlement/:id/dispute               — dispute (freezes releases)
 *   POST   /api/settlement/:id/reverse               — reverse (disputed→reversed)
 *   POST   /api/settlement/:id/threshold-approval     — generate a threshold approval token
 *
 * Webhook routes:
 *   POST   /api/webhooks                             — register endpoint
 *   GET    /api/webhooks                             — list for tenant
 *   DELETE /api/webhooks/:id                         — delete registration
 *
 * Invariants:
 *   • tenantId from x-tenant-id mandatory (fail-closed → 400).
 *   • Cross-tenant access → 404 (not 403 — do not confirm existence).
 *   • BigInt amounts serialized as strings in all responses.
 *   • Settlement state transitions dispatch webhook events (best-effort, never abort request).
 *   • Threshold approval required when: settlement has thresholdAmount AND
 *     amount to release > thresholdAmount (body must include thresholdApprovalToken).
 */

import { randomUUID } from "node:crypto";
import { SettlementService, SettlementError, type SettlementAgreement } from "../../lib/escrow/settlement.ts";
import { WebhookService, WebhookError } from "../../lib/escrow/webhook.ts";
import { generateThresholdApproval, validateAndConsumeApproval, ThresholdApprovalError, InMemoryThresholdApprovalStore } from "../../lib/escrow/threshold-approval.ts";
import type { ThresholdApprovalStore } from "../../lib/escrow/threshold-approval.ts";
import type { IndexerEventBus } from "../../lib/indexer/index.ts";
import type { Signer } from "../../lib/orchestrator/types.ts";

import { requireScope } from "../../lib/rbac/require-scope.ts";

export interface Ctx {
  tenantId: string;
  body: any;
  params: Record<string, string>;
  /** API-key scopes granted to the caller. Undefined = no key (requireApiKey=false). */
  scopes?: string[];
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

// ─── Default threshold approval store (single-process, per stack) ──────────
// In production, inject PgThresholdApprovalStore (durable, survives restart so a
// spent approval cannot be replayed) via the settlementRoutes `approvalStore` arg.
const defaultApprovalStore = new InMemoryThresholdApprovalStore();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ok = (body: any, status = 200): Res => ({ status, body });
const err = (status: number, message: string): Res => ({ status, body: { error: message } });

function serializeAgreement(a: SettlementAgreement): Record<string, unknown> {
  return {
    id: a.id,
    tenantId: a.tenantId,
    opportunityId: a.opportunityId,
    payerAccountId: a.payerAccountId,
    workerAccountId: a.workerAccountId,
    escrowAccountId: a.escrowAccountId,
    totalAmount: a.totalAmount.toString(),
    releasedAmount: a.releasedAmount.toString(),
    state: a.state,
    createdAt: a.createdAt,
    settledBy: a.settledBy,
    releaseAuditIds: a.releaseAuditIds ?? null,
    reversalAuditId: a.reversalAuditId ?? null,
    fundAuditId: a.fundAuditId ?? null,
    disputedBy: a.disputedBy ?? null,
    disputeReason: a.disputeReason ?? null,
    thresholdAmount: (a as any).thresholdAmount !== undefined ? String((a as any).thresholdAmount) : null,
  };
}

function mapSettlementError(e: SettlementError): Res {
  switch (e.code) {
    case "not_found":
    case "tenant_mismatch":
      return err(404, "settlement not found");
    case "wrong_state":
      return err(422, e.message);
    case "unauthorized":
      return err(403, e.message);
    case "invalid_input":
      return err(400, e.message);
    case "ledger_denied":
      return err(422, e.message);
    case "insufficient_funds":
      return err(422, e.message);
    default:
      return err(500, e.message);
  }
}

function dispatchEvent(
  webhookService: WebhookService,
  tenantId: string,
  eventType: string,
  agreement: SettlementAgreement,
): void {
  webhookService
    .dispatch(tenantId, {
      id: randomUUID(),
      event: eventType as any,
      tenantId,
      occurredAt: new Date().toISOString(),
      data: serializeAgreement(agreement),
    })
    .catch(() => {/* swallow — delivery failure must not abort caller */});
}

// ─── Routes factory ───────────────────────────────────────────────────────────

/**
 * emitEscrowUpdated — fail-closed best-effort projection hook into the
 * Trust-Graph read model. Tolerates a missing bus (older composition wiring).
 */
function emitEscrowUpdated(
  bus: IndexerEventBus | undefined,
  tenantId: string,
  agreement: SettlementAgreement,
): void {
  if (!bus) return;
  bus.emit({ type: "escrow.updated", tenantId, agreement });
}

export function settlementRoutes(
  service: SettlementService,
  webhookService: WebhookService,
  signer: Signer,
  indexerEventBus?: IndexerEventBus,
  injectedApprovalStore?: ThresholdApprovalStore,
): Route[] {
  // Use the injected durable store when provided (e.g. PgThresholdApprovalStore),
  // otherwise fall back to the in-process default. Replay protection only survives
  // restart when a durable store is injected.
  const approvalStore: ThresholdApprovalStore = injectedApprovalStore ?? defaultApprovalStore;
  return [

    // ── POST /api/settlement — create agreement ───────────────────────────────
    {
      method: "POST",
      pattern: "/api/settlement",
      handler: async (c) => {
        const denial = requireScope(c.scopes, "settlement:write");
        if (denial) return denial;
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const b = c.body ?? {};
        const { opportunityId, payerAccountId, workerAccountId, totalAmount, settledBy, thresholdAmount } = b;

        if (!opportunityId || typeof opportunityId !== "string") return err(400, "opportunityId (string) required");
        if (!payerAccountId || typeof payerAccountId !== "string") return err(400, "payerAccountId (string) required");
        if (!workerAccountId || typeof workerAccountId !== "string") return err(400, "workerAccountId (string) required");
        if (totalAmount === undefined) return err(400, "totalAmount (μ¢ as string or number) required");
        if (!settledBy || typeof settledBy !== "string") return err(400, "settledBy (string) required");

        let amountBig: bigint;
        try { amountBig = BigInt(totalAmount); } catch { return err(400, "totalAmount must be a valid integer (μ¢)"); }
        if (amountBig <= 0n) return err(400, "totalAmount must be positive (μ¢)");

        let threshBig: bigint | undefined;
        if (thresholdAmount !== undefined) {
          try { threshBig = BigInt(thresholdAmount); } catch { return err(400, "thresholdAmount must be a valid integer (μ¢)"); }
          if (threshBig <= 0n) return err(400, "thresholdAmount must be positive (μ¢)");
        }

        try {
          const agreement = await service.create({
            tenantId: c.tenantId,
            opportunityId,
            payerAccountId,
            workerAccountId,
            totalAmount: amountBig,
            settledBy,
            ...(threshBig !== undefined ? { thresholdAmount: threshBig } : {}),
          });
          dispatchEvent(webhookService, c.tenantId, "settlement.created", agreement);
          emitEscrowUpdated(indexerEventBus, c.tenantId, agreement);
          return ok({ ok: true, agreement: serializeAgreement(agreement) }, 201);
        } catch (e: any) {
          if (e instanceof SettlementError) return mapSettlementError(e);
          return err(400, e?.message ?? "failed to create settlement");
        }
      },
    },

    // ── GET /api/settlement — list for tenant ─────────────────────────────────
    {
      method: "GET",
      pattern: "/api/settlement",
      handler: async (c) => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        try {
          const agreements = await service.list(c.tenantId);
          return ok({ ok: true, agreements: agreements.map(serializeAgreement) });
        } catch (e: any) {
          return err(500, e?.message ?? "failed to list settlements");
        }
      },
    },

    // ── GET /api/settlement/:id — get by id ───────────────────────────────────
    {
      method: "GET",
      pattern: "/api/settlement/:id",
      handler: async (c) => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const { id } = c.params;
        if (!id) return err(400, "id param required");
        try {
          const agreement = await service.get(c.tenantId, id);
          if (!agreement) return err(404, "settlement not found");
          return ok({ ok: true, agreement: serializeAgreement(agreement) });
        } catch (e: any) {
          return err(500, e?.message ?? "failed to get settlement");
        }
      },
    },

    // ── POST /api/settlement/:id/fund — fund (created→held) ──────────────────
    {
      method: "POST",
      pattern: "/api/settlement/:id/fund",
      handler: async (c) => {
        const denial = requireScope(c.scopes, "settlement:write");
        if (denial) return denial;
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const { id } = c.params;
        if (!id) return err(400, "id param required");
        const { initiatedBy } = c.body ?? {};
        if (!initiatedBy || typeof initiatedBy !== "string") return err(400, "initiatedBy (string) required");

        try {
          const updated = await service.fund(c.tenantId, id, initiatedBy);
          dispatchEvent(webhookService, c.tenantId, "settlement.funded", updated);
          emitEscrowUpdated(indexerEventBus, c.tenantId, updated);
          return ok({ ok: true, agreement: serializeAgreement(updated) });
        } catch (e: any) {
          if (e instanceof SettlementError) return mapSettlementError(e);
          return err(500, e?.message ?? "fund failed");
        }
      },
    },

    // ── POST /api/settlement/:id/partial-release ─────────────────────────────
    {
      method: "POST",
      pattern: "/api/settlement/:id/partial-release",
      handler: async (c) => {
        const denial = requireScope(c.scopes, "settlement:write");
        if (denial) return denial;
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const { id } = c.params;
        if (!id) return err(400, "id param required");
        const { initiatedBy, amount, thresholdApprovalToken } = c.body ?? {};
        if (!initiatedBy || typeof initiatedBy !== "string") return err(400, "initiatedBy (string) required");
        if (amount === undefined) return err(400, "amount (μ¢ as string or number) required");

        let amountBig: bigint;
        try { amountBig = BigInt(amount); } catch { return err(400, "amount must be a valid integer (μ¢)"); }
        if (amountBig <= 0n) return err(400, "amount must be positive (μ¢)");

        // Threshold check: if agreement has thresholdAmount and amount > it, token required
        try {
          const existing = await service.get(c.tenantId, id);
          if (!existing) return err(404, "settlement not found");

          const threshBig = (existing as any).thresholdAmount as bigint | undefined;
          if (threshBig !== undefined && amountBig > threshBig) {
            if (!thresholdApprovalToken || typeof thresholdApprovalToken !== "string") {
              return err(422, `release amount ${amountBig} exceeds threshold ${threshBig} — thresholdApprovalToken required`);
            }
            try {
              validateAndConsumeApproval(signer.sign("threshold-secret-context"), thresholdApprovalToken, id, c.tenantId, amountBig, approvalStore);
            } catch (te: any) {
              if (te instanceof ThresholdApprovalError) return err(422, `threshold approval failed: ${te.message}`);
              return err(422, "threshold approval validation error");
            }
          }

          const updated = await service.partialRelease(c.tenantId, id, amountBig, initiatedBy);
          dispatchEvent(webhookService, c.tenantId, "settlement.partially_released", updated);
          emitEscrowUpdated(indexerEventBus, c.tenantId, updated);
          return ok({ ok: true, agreement: serializeAgreement(updated) });
        } catch (e: any) {
          if (e instanceof SettlementError) return mapSettlementError(e);
          return err(500, e?.message ?? "partial-release failed");
        }
      },
    },

    // ── POST /api/settlement/:id/release — full release ───────────────────────
    {
      method: "POST",
      pattern: "/api/settlement/:id/release",
      handler: async (c) => {
        const denial = requireScope(c.scopes, "settlement:write");
        if (denial) return denial;
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const { id } = c.params;
        if (!id) return err(400, "id param required");
        const { initiatedBy, thresholdApprovalToken } = c.body ?? {};
        if (!initiatedBy || typeof initiatedBy !== "string") return err(400, "initiatedBy (string) required");

        try {
          const existing = await service.get(c.tenantId, id);
          if (!existing) return err(404, "settlement not found");

          const remaining = existing.totalAmount - existing.releasedAmount;
          const threshBig = (existing as any).thresholdAmount as bigint | undefined;

          if (threshBig !== undefined && remaining > threshBig) {
            if (!thresholdApprovalToken || typeof thresholdApprovalToken !== "string") {
              return err(422, `release amount ${remaining} exceeds threshold ${threshBig} — thresholdApprovalToken required`);
            }
            try {
              validateAndConsumeApproval(signer.sign("threshold-secret-context"), thresholdApprovalToken, id, c.tenantId, remaining, approvalStore);
            } catch (te: any) {
              if (te instanceof ThresholdApprovalError) return err(422, `threshold approval failed: ${te.message}`);
              return err(422, "threshold approval validation error");
            }
          }

          const updated = await service.release(c.tenantId, id, initiatedBy);
          dispatchEvent(webhookService, c.tenantId, "settlement.released", updated);
          emitEscrowUpdated(indexerEventBus, c.tenantId, updated);
          return ok({ ok: true, agreement: serializeAgreement(updated) });
        } catch (e: any) {
          if (e instanceof SettlementError) return mapSettlementError(e);
          return err(500, e?.message ?? "release failed");
        }
      },
    },

    // ── POST /api/settlement/:id/dispute ─────────────────────────────────────
    {
      method: "POST",
      pattern: "/api/settlement/:id/dispute",
      handler: async (c) => {
        const denial = requireScope(c.scopes, "settlement:write");
        if (denial) return denial;
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const { id } = c.params;
        if (!id) return err(400, "id param required");
        const { initiatedBy, reason } = c.body ?? {};
        if (!initiatedBy || typeof initiatedBy !== "string") return err(400, "initiatedBy (string) required");

        try {
          const updated = await service.dispute(c.tenantId, id, initiatedBy, reason ? String(reason) : undefined);
          dispatchEvent(webhookService, c.tenantId, "settlement.disputed", updated);
          dispatchEvent(webhookService, c.tenantId, "dispute.opened", updated);
          emitEscrowUpdated(indexerEventBus, c.tenantId, updated);
          return ok({ ok: true, agreement: serializeAgreement(updated) });
        } catch (e: any) {
          if (e instanceof SettlementError) return mapSettlementError(e);
          return err(500, e?.message ?? "dispute failed");
        }
      },
    },

    // ── POST /api/settlement/:id/reverse ─────────────────────────────────────
    {
      method: "POST",
      pattern: "/api/settlement/:id/reverse",
      handler: async (c) => {
        const denial = requireScope(c.scopes, "settlement:write");
        if (denial) return denial;
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const { id } = c.params;
        if (!id) return err(400, "id param required");
        const { initiatedBy } = c.body ?? {};
        if (!initiatedBy || typeof initiatedBy !== "string") return err(400, "initiatedBy (string) required");

        try {
          const updated = await service.reverse(c.tenantId, id, initiatedBy);
          dispatchEvent(webhookService, c.tenantId, "settlement.reversed", updated);
          emitEscrowUpdated(indexerEventBus, c.tenantId, updated);
          return ok({ ok: true, agreement: serializeAgreement(updated) });
        } catch (e: any) {
          if (e instanceof SettlementError) return mapSettlementError(e);
          return err(500, e?.message ?? "reverse failed");
        }
      },
    },

    // ── POST /api/settlement/:id/threshold-approval ───────────────────────────
    {
      method: "POST",
      pattern: "/api/settlement/:id/threshold-approval",
      handler: async (c) => {
        const denial = requireScope(c.scopes, "settlement:write");
        if (denial) return denial;
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const { id } = c.params;
        if (!id) return err(400, "id param required");
        const { approvedBy, maxAmount } = c.body ?? {};
        if (!approvedBy || typeof approvedBy !== "string") return err(400, "approvedBy (string) required");
        if (maxAmount === undefined) return err(400, "maxAmount (μ¢ as string or number) required");

        let maxAmountBig: bigint;
        try { maxAmountBig = BigInt(maxAmount); } catch { return err(400, "maxAmount must be a valid integer (μ¢)"); }
        if (maxAmountBig <= 0n) return err(400, "maxAmount must be positive (μ¢)");

        try {
          const existing = await service.get(c.tenantId, id);
          if (!existing) return err(404, "settlement not found");
          if (approvedBy !== existing.settledBy) {
            return err(403, `threshold approval must be issued by the settlement authority ('${existing.settledBy}')`);
          }

          const approval = generateThresholdApproval(
            signer.sign("threshold-secret-context"),
            {
              agreementId: id,
              tenantId: c.tenantId,
              maxAmount: maxAmountBig,
              approvedBy,
            },
          );
          return ok({
            ok: true,
            approval: {
              id: approval.id,
              agreementId: approval.agreementId,
              maxAmount: approval.maxAmount,
              approvedBy: approval.approvedBy,
              issuedAt: approval.issuedAt,
              expiresAt: approval.expiresAt,
              token: approval.token,
            },
          }, 201);
        } catch (e: any) {
          if (e instanceof ThresholdApprovalError) return err(422, e.message);
          if (e instanceof SettlementError) return mapSettlementError(e);
          return err(500, e?.message ?? "threshold approval generation failed");
        }
      },
    },

    // ── POST /api/webhooks — register endpoint ────────────────────────────────
    {
      method: "POST",
      pattern: "/api/webhooks",
      handler: async (c) => {
        const denial = requireScope(c.scopes, "settlement:write");
        if (denial) return denial;
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const { url, events, secret } = c.body ?? {};
        if (!url || typeof url !== "string") return err(400, "url (string) required");
        if (!Array.isArray(events) || events.length === 0) return err(400, "events must be a non-empty array");

        try {
          const reg = await webhookService.register({
            tenantId: c.tenantId,
            url,
            events,
            ...(secret ? { secret: String(secret) } : {}),
          });
          // Return registration without the secret (security: don't echo it back)
          return ok({
            ok: true,
            registration: {
              id: reg.id,
              tenantId: reg.tenantId,
              url: reg.url,
              events: reg.events,
              createdAt: reg.createdAt,
              active: reg.active,
            },
          }, 201);
        } catch (e: any) {
          if (e instanceof WebhookError && e.code === "invalid_input") return err(400, e.message);
          return err(500, e?.message ?? "webhook registration failed");
        }
      },
    },

    // ── GET /api/webhooks — list for tenant ────────────────────────────────────
    {
      method: "GET",
      pattern: "/api/webhooks",
      handler: async (c) => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        try {
          const regs = await webhookService.list(c.tenantId);
          return ok({
            ok: true,
            registrations: regs.map((r) => ({
              id: r.id,
              tenantId: r.tenantId,
              url: r.url,
              events: r.events,
              createdAt: r.createdAt,
              active: r.active,
            })),
          });
        } catch (e: any) {
          return err(500, e?.message ?? "failed to list webhooks");
        }
      },
    },

    // ── DELETE /api/webhooks/:id — delete registration ────────────────────────
    {
      method: "DELETE",
      pattern: "/api/webhooks/:id",
      handler: async (c) => {
        const denial = requireScope(c.scopes, "settlement:write");
        if (denial) return denial;
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const { id } = c.params;
        if (!id) return err(400, "id param required");
        try {
          const deleted = await webhookService.delete(c.tenantId, id);
          if (!deleted) return err(404, "webhook registration not found");
          return ok({ ok: true, deleted: true });
        } catch (e: any) {
          return err(500, e?.message ?? "webhook deletion failed");
        }
      },
    },
  ];
}
