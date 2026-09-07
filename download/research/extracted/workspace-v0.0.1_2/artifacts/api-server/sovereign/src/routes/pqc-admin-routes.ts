/**
 * src/routes/pqc-admin-routes.ts — PQC provider admin routes.
 *
 * Routes:
 *   POST /api/admin/pqc/install
 *     Attempts to install a real post-quantum crypto provider via npm.
 *     Response: 200 { ok: true, package } on success
 *               503 { ok: false, error } on install failure
 *     Scope required: admin:pqc-install
 *     Audit: signed record appended to tenant chain.
 *
 * Invariants:
 *   • Missing x-tenant-id → 400
 *   • Missing admin:pqc-install scope → 403
 *   • Install failure is not a server error → 503 (service unavailable)
 *   • Every call is audited (signed, append-only).
 */

import type { SovereignStack } from "../composition.ts";
import { requireScope } from "../../lib/rbac/require-scope.ts";

// Type-only import path for the installer shape ( avoids re-parsing the script at test time ).
interface Installer {
  (opts?: {
    packages?: string[];
    cwd?: string;
    timeout?: number;
  }): Promise<{ success: boolean; package?: string; error?: string }>;
}

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

export function pqcAdminRoutes(
  stack: SovereignStack,
  opts?: { installer?: Installer },
): Route[] {
  const installer = opts?.installer ??
    // Lazy import so the script is not evaluated during unit-test mocking.
    (async (...args: Parameters<Installer>) => {
      const { installPqcProvider } = await import("../../scripts/install-pqc-provider.mjs");
      return installPqcProvider(...args);
    }) as Installer;

  const audit = (
    tenantId: string,
    actionType: string,
    reason: string,
    outcome: "allowed" | "denied",
  ) => {
    stack.auditStore.append({
      id: `pqc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId,
      actionId: `pqc-install-${Date.now()}`,
      actionType,
      source: "pqc-admin",
      outcome,
      reason,
      occurredAt: new Date().toISOString(),
    });
  };

  return [
    {
      method: "POST",
      pattern: "/api/admin/pqc/install",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const denial = requireScope(c.scopes, "admin:pqc-install");
        if (denial) return denial;

        let result: { success: boolean; package?: string; error?: string };
        try {
          result = await installer();
        } catch (e: any) {
          audit(c.tenantId, "pqc.install", `installer threw: ${e?.message ?? "unknown"}`, "denied");
          return err(503, `install attempt failed: ${e?.message ?? "unknown error"}`);
        }

        if (result.success) {
          audit(c.tenantId, "pqc.install", `installed ${result.package}`, "allowed");
          return ok({ ok: true, package: result.package });
        }

        audit(c.tenantId, "pqc.install", result.error ?? "install failed", "denied");
        return { status: 503, body: { ok: false, error: result.error ?? "install failed" } };
      },
    },
  ];
}
