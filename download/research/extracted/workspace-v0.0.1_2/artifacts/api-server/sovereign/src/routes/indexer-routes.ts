/**
 * src/routes/indexer-routes.ts — framework-agnostic HTTP handlers for the Trust-Graph Indexer API.
 *
 * Exposes the InMemoryReadModelStore (Indexer #5) query APIs over HTTP.
 * All routes are tenant-isolated (x-tenant-id mandatory, fail-closed).
 * Cross-tenant access returns 404 (not 403 — do not confirm existence).\
 *
 * Routes:
 *   GET /api/insights                                 — tenant headline analytics (K10, v180)
 *   GET /api/index/executions                         — list executions (opt: ?status= ?from= ?to=)
 *   GET /api/index/executions/by-action/:actionId     — execution by actionId
 *   GET /api/index/executions/:id                     — execution by id
 *   GET /api/index/actors                             — list actors
 *   GET /api/index/actors/:actorId/summary            — actor summary (actor + executionCount)
 *   GET /api/index/escrows                            — list escrows
 *   GET /api/index/escrows/:id                        — escrow by id
 *   GET /api/index/passports                          — list passports
 *   GET /api/index/passports/:id                      — passport by id
 *   GET /api/index/approvals                          — list approvals
 *   GET /api/index/approvals/:id                      — approval by id
 *   GET /api/index/disputes                           — list disputes
 *   GET /api/index/disputes/:id                       — dispute by id
 *
 * Invariants:
 *   • tenantId from x-tenant-id is mandatory — fail-closed (400).
 *   • BigInt fields serialized as strings.
 *   • All list endpoints support optional query params; unknown params are ignored.
 */

import { InMemoryReadModelStore, IndexerError, computeTenantInsights } from "../../lib/indexer/index.ts";
import type { TenantInsights } from "../../lib/indexer/index.ts";

export interface Ctx {
  tenantId: string;
  body: any;
  params: Record<string, string>;
  query?: Record<string, string>;
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
 * InsightsCache — simple in-memory TTL cache for GET /api/insights responses.
 *
 * One entry per tenant. Entries are invalidated when the TTL expires or when
 * invalidate(tenantId) is called explicitly (e.g. after new data is projected).
 *
 * The cache is intentionally NOT shared across indexerRoutes() calls — each
 * mounted route set owns its cache. Zero external dependencies.
 */
export class InsightsCache {
  private readonly cache = new Map<string, { value: TenantInsights; expiresAt: number }>();
  readonly ttlMs: number;
  constructor(ttlMs: number = 30_000) {
    this.ttlMs = ttlMs;
  }

  get(tenantId: string): TenantInsights | null {
    const entry = this.cache.get(tenantId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(tenantId);
      return null;
    }
    return entry.value;
  }

  set(tenantId: string, value: TenantInsights): void {
    this.cache.set(tenantId, { value, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  /** For testing — how many tenants are currently cached. */
  size(): number {
    return this.cache.size;
  }
}

/** Default cache TTL: 30 seconds. */
export const DEFAULT_INSIGHTS_CACHE_TTL_MS = 30_000;

/** Serialize read-model entity: converts BigInt fields to strings for JSON. */
function serializeEntity(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return out;
}

/** Serialize TenantInsights: BigInt μ¢ fields to decimal strings. */
function serializeInsights(ins: TenantInsights): Record<string, unknown> {
  return {
    tenantId: ins.tenantId,
    windowDays: ins.windowDays,
    settledCount: ins.settledCount,
    volumeMicrounits: ins.volumeMicrounits.toString(),
    heldMicrounits: ins.heldMicrounits.toString(),
    disputeCount: ins.disputeCount,
    proofsIssued: ins.proofsIssued,
    trustTrendDelta: ins.trustTrendDelta,
    trustTrend: ins.trustTrend,
  };
}

export function indexerRoutes(store: InMemoryReadModelStore, insightsCache?: InsightsCache): Route[] {
  const cache = insightsCache ?? new InsightsCache(DEFAULT_INSIGHTS_CACHE_TTL_MS);
  return [
    // ── GET /api/audit-trail (v314) ────────────────────────────────────────────
    // One Audit Trail — agent actions for a tenant across all vendors, filtered by
    // provenanceId and/or vendor. Cross-vendor wedge: neutral audit over xAI/OpenAI/
    // Anthropic/Google/Cursor/etc. without trusting any single vendor's own trail.
    //
    // Query params (at least one required):
    //   ?provenanceId=<hex>   — sha256 fingerprint of the agent identity
    //   ?vendor=<normalized>  — canonical vendor (xai|openai|anthropic|google|…|custom)
    {
      method: "GET",
      pattern: "/api/audit-trail",
      handler: async (ctx) => {
        if (!ctx.tenantId) return err(400, "x-tenant-id header required");
        const q = ctx.query ?? {};
        const provenanceId = q.provenanceId;
        const vendor = q.vendor;
        if (!provenanceId && !vendor) {
          return err(400, "at least one of provenanceId or vendor query param is required");
        }
        try {
          const executions = store.listExecutionsByProvenance(ctx.tenantId, { provenanceId, vendor });
          return ok({ executions: executions.map(serializeEntity) });
        } catch (e) {
          if (e instanceof IndexerError && e.code === "invalid_input") {
            return err(400, e.message);
          }
          throw e;
        }
      },
    },

    // ── GET /api/insights (K10) ───────────────────────────────────────────────
    // Tenant headline analytics: settled count, volume, held, disputes, proofs,
    // trust trend — aggregated from the read-model, with TTL caching.
    //
    // Query params:
    //   ?windowDays=N  (positive integer, default 30)
    //   ?now=ISO       (override "now" for deterministic tests; default: server time)
    {
      method: "GET",
      pattern: "/api/insights",
      handler: async (ctx) => {
        if (!ctx.tenantId) return err(400, "x-tenant-id header required");

        // Parse optional query params — fail-closed.
        const q = ctx.query ?? {};
        let windowDays = 30;
        if (q.windowDays !== undefined) {
          const parsed = Number(q.windowDays);
          if (!Number.isInteger(parsed) || parsed <= 0) {
            return err(400, "windowDays must be a positive integer");
          }
          windowDays = parsed;
        }
        const now = q.now ?? new Date().toISOString();

        // Cache key is tenant + windowDays (different windows = different data).
        // We only cache the default window (30 days, no ?now override) to avoid
        // time-overriding clients poisoning the cache.
        const cacheable = windowDays === 30 && q.now === undefined;
        if (cacheable) {
          const cached = cache.get(ctx.tenantId);
          if (cached) {
            return ok({
              ok: true,
              cached: true,
              insights: serializeInsights(cached),
            });
          }
        }

        try {
          const escrows = store.listEscrows(ctx.tenantId);
          const passports = store.listPassports(ctx.tenantId);
          const insights = computeTenantInsights({
            tenantId: ctx.tenantId,
            escrows,
            passports,
            now,
            windowDays,
          });
          if (cacheable) cache.set(ctx.tenantId, insights);
          return ok({ ok: true, cached: false, insights: serializeInsights(insights) });
        } catch (e) {
          if (e instanceof IndexerError) {
            if (e.code === "invalid_input") return err(400, e.message);
            if (e.code === "tenant_mismatch") return err(400, e.message);
          }
          return err(500, (e as Error)?.message ?? "insights computation failed");
        }
      },
    },

    // ── Executions ────────────────────────────────────────────────────────────

    {
      method: "GET",
      pattern: "/api/index/executions",
      handler: async (ctx) => {
        try {
          const { status, from, to } = ctx.query ?? {};
          let results;
          if (from && to) {
            results = store.listExecutionsByDateRange(ctx.tenantId, from, to);
          } else if (status) {
            results = store.listExecutionsByStatus(ctx.tenantId, status);
          } else {
            results = store.listExecutions(ctx.tenantId);
          }
          return ok({ executions: results.map(serializeEntity) });
        } catch (e) {
          if (e instanceof IndexerError && e.code === "invalid_input") {
            return err(400, e.message);
          }
          throw e;
        }
      },
    },

    {
      method: "GET",
      pattern: "/api/index/executions/by-action/:actionId",
      handler: async (ctx) => {
        try {
          const exec = store.getExecutionByActionId(ctx.tenantId, ctx.params.actionId);
          if (!exec) return err(404, "execution not found");
          return ok({ execution: serializeEntity(exec as unknown as Record<string, unknown>) });
        } catch (e) {
          if (e instanceof IndexerError && e.code === "invalid_input") {
            return err(400, e.message);
          }
          throw e;
        }
      },
    },

    {
      method: "GET",
      pattern: "/api/index/executions/:id",
      handler: async (ctx) => {
        const exec = store.getExecution(ctx.tenantId, ctx.params.id);
        if (!exec) return err(404, "execution not found");
        return ok({ execution: serializeEntity(exec as unknown as Record<string, unknown>) });
      },
    },

    // ── Actors ───────────────────────────────────────────────────────────────

    {
      method: "GET",
      pattern: "/api/index/actors",
      handler: async (ctx) => {
        const actors = store.listActors(ctx.tenantId);
        return ok({ actors: actors.map(serializeEntity) });
      },
    },

    {
      method: "GET",
      pattern: "/api/index/actors/:actorId/summary",
      handler: async (ctx) => {
        const summary = store.actorSummary(ctx.tenantId, ctx.params.actorId);
        if (!summary) return err(404, "actor not found");
        return ok({
          actor: serializeEntity(summary.actor as unknown as Record<string, unknown>),
          executionCount: summary.executionCount,
        });
      },
    },

    // ── Escrows ───────────────────────────────────────────────────────────────

    {
      method: "GET",
      pattern: "/api/index/escrows",
      handler: async (ctx) => {
        const escrows = store.listEscrows(ctx.tenantId);
        return ok({ escrows: escrows.map(serializeEntity) });
      },
    },

    {
      method: "GET",
      pattern: "/api/index/escrows/:id",
      handler: async (ctx) => {
        const escrow = store.getEscrow(ctx.tenantId, ctx.params.id);
        if (!escrow) return err(404, "escrow not found");
        return ok({ escrow: serializeEntity(escrow as unknown as Record<string, unknown>) });
      },
    },

    // ── Passports ─────────────────────────────────────────────────────────────

    {
      method: "GET",
      pattern: "/api/index/passports",
      handler: async (ctx) => {
        const passports = store.listPassports(ctx.tenantId);
        return ok({ passports: passports.map(serializeEntity) });
      },
    },

    {
      method: "GET",
      pattern: "/api/index/passports/:id",
      handler: async (ctx) => {
        const passport = store.getPassport(ctx.tenantId, ctx.params.id);
        if (!passport) return err(404, "passport not found");
        return ok({ passport: serializeEntity(passport as unknown as Record<string, unknown>) });
      },
    },

    // ── Approvals ─────────────────────────────────────────────────────────────

    {
      method: "GET",
      pattern: "/api/index/approvals",
      handler: async (ctx) => {
        const approvals = store.listApprovals(ctx.tenantId);
        return ok({ approvals: approvals.map(serializeEntity) });
      },
    },

    {
      method: "GET",
      pattern: "/api/index/approvals/:id",
      handler: async (ctx) => {
        const approval = store.getApproval(ctx.tenantId, ctx.params.id);
        if (!approval) return err(404, "approval not found");
        return ok({ approval: serializeEntity(approval as unknown as Record<string, unknown>) });
      },
    },

    // ── Disputes ──────────────────────────────────────────────────────────────

    {
      method: "GET",
      pattern: "/api/index/disputes",
      handler: async (ctx) => {
        const disputes = store.listDisputes(ctx.tenantId);
        return ok({ disputes: disputes.map(serializeEntity) });
      },
    },

    {
      method: "GET",
      pattern: "/api/index/disputes/:id",
      handler: async (ctx) => {
        const dispute = store.getDispute(ctx.tenantId, ctx.params.id);
        if (!dispute) return err(404, "dispute not found");
        return ok({ dispute: serializeEntity(dispute as unknown as Record<string, unknown>) });
      },
    },
  ];
}
