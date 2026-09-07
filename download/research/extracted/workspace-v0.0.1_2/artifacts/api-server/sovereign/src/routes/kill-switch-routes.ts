/**
 * src/routes/kill-switch-routes.ts — KillSwitch admin routes.
 *
 * Routes:
 *   POST /api/admin/kill-switch/engage
 *     Body: { scope: "global"|"tenant"|"action_type", tenantId?, actionType?, reason: string }
 *     Response: 200 { ok, scope, reason }
 *     Scope required: admin:kill-switch
 *     Audit: signed record appended to tenant chain.
 *
 *   POST /api/admin/kill-switch/disengage
 *     Body: { scope: "global"|"tenant"|"action_type", tenantId?, actionType? }
 *     Response: 200 { ok, scope }
 *     Scope required: admin:kill-switch
 *     Audit: signed record appended to tenant chain.
 *
 *   GET /api/admin/kill-switch/status
 *     Response: 200 { ok, armed, snapshot }
 *     Scope required: admin:kill-switch
 *
 * Invariants:
 *   • Missing x-tenant-id → 400
 *   • Missing admin:kill-switch scope → 403
 *   • Empty reason on engage → 400
 *   • Unknown scope → 400 (fail-closed)
 *   • Every state change is audited (signed, append-only).
 */

import type { SovereignStack } from "../composition.ts";
import { requireScope } from "../../lib/rbac/require-scope.ts";

interface Ctx {
  tenantId: string;
  body: any;
  params: Record<string, string>;
  query: Record<string, string>;
  scopes?: string[];
  headers?: Record<string, string | string[] | undefined>;
}
interface Res { status: number; body: unknown; }
interface Route { method: string; pattern: string; handler: (ctx: Ctx) => Promise<Res>; }

const ok = (body: unknown, status = 200): Res => ({ status, body });
const err = (status: number, message: string): Res => ({ status, body: { error: message } });

export function killSwitchRoutes(stack: SovereignStack): Route[] {
  const audit = (tenantId: string, actionType: string, reason: string, outcome: "allowed" | "denied") => {
    stack.auditStore.append({
      id: `ks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId,
      actionId: `kill-switch-${Date.now()}`,
      actionType,
      source: "kill-switch-admin",
      outcome,
      reason,
      occurredAt: new Date().toISOString(),
    });
  };

  return [
    {
      method: "POST",
      pattern: "/api/admin/kill-switch/engage",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const denial = requireScope(c.scopes, "admin:kill-switch");
        if (denial) return denial;

        const body = c.body ?? {};
        const { scope, tenantId, actionType, reason } = body;

        if (typeof reason !== "string" || reason.length === 0) {
          return err(400, "reason (non-empty string) is required");
        }
        if (scope !== "global" && scope !== "tenant" && scope !== "action_type") {
          return err(400, 'scope must be "global", "tenant", or "action_type"');
        }

        try {
          if (scope === "global") {
            stack.killSwitch.engageGlobal(reason);
          } else if (scope === "tenant") {
            if (typeof tenantId !== "string" || tenantId.length === 0) {
              return err(400, "tenantId (non-empty string) is required for tenant scope");
            }
            stack.killSwitch.engageTenant(tenantId, reason);
          } else if (scope === "action_type") {
            if (typeof actionType !== "string" || actionType.length === 0) {
              return err(400, "actionType (non-empty string) is required for action_type scope");
            }
            stack.killSwitch.engageActionType(actionType, reason);
          }
        } catch (e: any) {
          return err(400, `engage failed: ${e?.message ?? "unknown error"}`);
        }

        audit(c.tenantId, `kill-switch.engage.${scope}`, `engaged ${scope}: ${reason}`, "allowed");
        return ok({ ok: true, scope, reason });
      },
    },

    {
      method: "POST",
      pattern: "/api/admin/kill-switch/disengage",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const denial = requireScope(c.scopes, "admin:kill-switch");
        if (denial) return denial;

        const body = c.body ?? {};
        const { scope, tenantId, actionType } = body;

        if (scope !== "global" && scope !== "tenant" && scope !== "action_type") {
          return err(400, 'scope must be "global", "tenant", or "action_type"');
        }

        try {
          if (scope === "global") {
            stack.killSwitch.disengageGlobal();
          } else if (scope === "tenant") {
            if (typeof tenantId !== "string" || tenantId.length === 0) {
              return err(400, "tenantId (non-empty string) is required for tenant scope");
            }
            stack.killSwitch.disengageTenant(tenantId);
          } else if (scope === "action_type") {
            if (typeof actionType !== "string" || actionType.length === 0) {
              return err(400, "actionType (non-empty string) is required for action_type scope");
            }
            stack.killSwitch.disengageActionType(actionType);
          }
        } catch (e: any) {
          return err(400, `disengage failed: ${e?.message ?? "unknown error"}`);
        }

        audit(c.tenantId, `kill-switch.disengage.${scope}`, `disengaged ${scope}`, "allowed");
        return ok({ ok: true, scope });
      },
    },

    {
      method: "GET",
      pattern: "/api/admin/kill-switch/status",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const denial = requireScope(c.scopes, "admin:kill-switch");
        if (denial) return denial;

        return ok({ ok: true, armed: stack.killSwitch.isArmed, snapshot: stack.killSwitch.snapshot() });
      },
    },
  ];
}
