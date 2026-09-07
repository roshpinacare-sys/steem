/**
 * src/routes/spend-budget-routes.ts — spend-budget management endpoints.
 *
 * Exposes the SpendBudgetGuard (v415) over HTTP so operators and agents can
 * set, query, and clear cumulative-spend caps without a server restart.
 *
 * Routes:
 *
 *   PUT /api/budget
 *     Set or replace the tenant-level spend budget.
 *     Body: { limitMicroCents: string, windowMs: number }
 *       limitMicroCents is a string (JSON can't represent BigInt safely);
 *       the server parses it as BigInt internally.
 *     Response: 200 { ok: true, tenantId, limitMicroCents, windowMs }
 *     Scope: admin:budget-write
 *
 *   GET /api/budget
 *     Query the tenant's current budget configuration and live spend status.
 *     Response: 200 { ok: true, tenantId, hasBudget, ...status? }
 *       status is present only when a budget has been set.
 *
 *   DELETE /api/budget
 *     Remove the tenant's budget (stops enforcement; guard becomes pass-through
 *     for that tenant until a new budget is set, since requireBudget=false).
 *     Response: 200 { ok: true, tenantId, deleted: boolean }
 *     Scope: admin:budget-write
 *
 *   PUT /api/budget/actor/:actorId
 *     Set or replace a per-actor sub-budget for the tenant.
 *     Body: { limitMicroCents: string, windowMs: number }
 *     Response: 200 { ok: true, tenantId, actorId, limitMicroCents, windowMs }
 *     Scope: admin:budget-write
 *
 *   GET /api/budget/actor/:actorId
 *     Query a per-actor budget + live spend status within the tenant.
 *     Response: 200 { ok: true, tenantId, actorId, hasBudget, ...status? }
 *
 * Invariants:
 *   • Missing x-tenant-id → 400 on every route.
 *   • limitMicroCents must be a base-10 integer string representing a positive
 *     BigInt; non-parseable or ≤ 0 → 400.
 *   • windowMs must be a positive finite number → else 400.
 *   • Missing admin:budget-write scope on write routes → 403 (fail-closed).
 *   • Tenant isolation: every read/write is scoped to c.tenantId; an actor's
 *     key is `${tenantId}:${actorId}` — one tenant cannot touch another's data.
 *   • GET routes are read-only and do not require a write scope.
 *   • BigInt amounts are serialised as decimal strings in JSON responses
 *     (not Number, because JS Number can't represent all micro-cent amounts
 *     without precision loss).
 */

import type { SovereignStack } from "../composition.ts";
import { requireScope } from "../../lib/rbac/require-scope.ts";
import { SpendBudgetError } from "../../lib/policy/spend-budget-guard.ts";

interface Ctx {
  tenantId: string;
  body: any;
  params: Record<string, string>;
  query?: Record<string, string>;
  scopes?: string[];
}
interface Res { status: number; body: unknown; }
interface Route {
  method: string;
  pattern: string;
  requiresIdempotencyKey?: boolean;
  handler: (ctx: Ctx) => Promise<Res>;
}

const ok = (body: unknown): Res => ({ status: 200, body });
const err = (status: number, message: string): Res => ({ status, body: { error: message } });

/** Parse a limitMicroCents string into BigInt; return null on invalid input. */
function parseLimitMicroCents(raw: unknown): bigint | null {
  if (typeof raw !== "string" || !/^\d+$/.test(raw.trim())) return null;
  try {
    const n = BigInt(raw.trim());
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

/** Serialise a BigInt as a decimal string for JSON (avoids precision loss). */
function strBig(n: bigint): string {
  return n.toString(10);
}

/** Actor-scoped composite key: guarantees tenant isolation at the guard layer. */
function actorKey(tenantId: string, actorId: string): string {
  return `${tenantId}:actor:${actorId}`;
}

export function spendBudgetRoutes(stack: SovereignStack): Route[] {
  const guard = stack.spendBudgetGuard;

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Validate and parse a budget request body. */
  function parseBudgetBody(body: any): { limitMicroCents: bigint; windowMs: number } | { error: string } {
    const limit = parseLimitMicroCents(body?.limitMicroCents);
    if (limit === null) {
      return { error: "limitMicroCents must be a positive integer string (e.g. \"100000\" for $1.00)" };
    }
    const windowMs = Number(body?.windowMs);
    if (typeof body?.windowMs === "string" || !Number.isFinite(windowMs) || windowMs <= 0) {
      return { error: "windowMs must be a positive finite number (milliseconds)" };
    }
    return { limitMicroCents: limit, windowMs };
  }

  /** Build a live spend status snapshot for a guard key, if a budget is set. */
  function budgetStatus(key: string): Record<string, unknown> | null {
    if (!guard.hasBudget(key)) return null;
    const auth = guard.authorize(key, 0n, Date.now());
    return {
      limitMicroCents: strBig(auth.limitMicroCents),
      spentMicroCents: strBig(auth.spentMicroCents),
      remainingMicroCents: strBig(auth.remainingMicroCents),
    };
  }

  return [
    // ── PUT /api/budget (set/replace tenant budget) ──────────────────────────
    {
      method: "PUT",
      pattern: "/api/budget",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const denial = requireScope(c.scopes, "admin:budget-write");
        if (denial) return err(403, denial);

        const parsed = parseBudgetBody(c.body);
        if ("error" in parsed) return err(400, parsed.error);
        const { limitMicroCents, windowMs } = parsed;

        try {
          guard.setBudget(c.tenantId, { limitMicroCents, windowMs });
        } catch (e) {
          if (e instanceof SpendBudgetError) return err(400, e.message);
          throw e;
        }

        return ok({
          ok: true,
          tenantId: c.tenantId,
          limitMicroCents: strBig(limitMicroCents),
          windowMs,
        });
      },
    },

    // ── GET /api/budget (query tenant budget) ────────────────────────────────
    {
      method: "GET",
      pattern: "/api/budget",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const hasBudget = guard.hasBudget(c.tenantId);
        const status = budgetStatus(c.tenantId);
        return ok({
          ok: true,
          tenantId: c.tenantId,
          hasBudget,
          ...(status ? { budget: status } : {}),
        });
      },
    },

    // ── DELETE /api/budget (remove tenant budget) ────────────────────────────
    {
      method: "DELETE",
      pattern: "/api/budget",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const denial = requireScope(c.scopes, "admin:budget-write");
        if (denial) return err(403, denial);
        const deleted = guard.deleteBudget(c.tenantId);
        return ok({ ok: true, tenantId: c.tenantId, deleted });
      },
    },

    // ── PUT /api/budget/actor/:actorId (set per-actor budget) ────────────────
    {
      method: "PUT",
      pattern: "/api/budget/actor/:actorId",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const denial = requireScope(c.scopes, "admin:budget-write");
        if (denial) return err(403, denial);

        const actorId = c.params.actorId;
        if (!actorId || actorId.trim() === "") return err(400, "actorId param required");

        const parsed = parseBudgetBody(c.body);
        if ("error" in parsed) return err(400, parsed.error);
        const { limitMicroCents, windowMs } = parsed;

        try {
          guard.setBudget(actorKey(c.tenantId, actorId), { limitMicroCents, windowMs });
        } catch (e) {
          if (e instanceof SpendBudgetError) return err(400, e.message);
          throw e;
        }

        return ok({
          ok: true,
          tenantId: c.tenantId,
          actorId,
          limitMicroCents: strBig(limitMicroCents),
          windowMs,
        });
      },
    },

    // ── GET /api/budget/actor/:actorId (query per-actor budget) ─────────────
    {
      method: "GET",
      pattern: "/api/budget/actor/:actorId",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");

        const actorId = c.params.actorId;
        if (!actorId || actorId.trim() === "") return err(400, "actorId param required");

        const key = actorKey(c.tenantId, actorId);
        const hasBudget = guard.hasBudget(key);
        const status = budgetStatus(key);
        return ok({
          ok: true,
          tenantId: c.tenantId,
          actorId,
          hasBudget,
          ...(status ? { budget: status } : {}),
        });
      },
    },
  ];
}
