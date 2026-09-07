/**
 * src/routes/passport-revocation-routes.ts — HTTP routes for per-passport revocation.
 *
 * Routes:
 *   POST /api/passports/revoke
 *     Body: { passportId: string, reason?: string }
 *     Response: 200 { ok, entry: RevocationEntry }  — passport revoked (or already was).
 *     Response: 400 { error }                        — missing/invalid passportId, missing x-tenant-id.
 *     Idempotent: revoking an already-revoked passport is a safe no-op; same entry is returned.
 *     requiresIdempotencyKey: true  — state-changing; caller must supply Idempotency-Key.
 *
 *   GET /api/passports/:passportId/revocation
 *     Response: 200 { ok: true,  revoked: true,  entry: RevocationEntry }  — passport is revoked.
 *     Response: 200 { ok: true,  revoked: false, entry: null }              — passport is not revoked.
 *     Response: 400 { error }  — missing x-tenant-id or empty passportId.
 *
 *   GET /api/passports/revocations
 *     Response: 200 { ok, revocations: RevocationEntry[], total: number }
 *     Returns all revocation entries for the tenant, oldest-first.
 *     Returns { revocations: [], total: 0 } for a tenant with no revocations.
 *     Response: 400 { error }  — missing x-tenant-id.
 *
 * Invariants:
 *   • Missing x-tenant-id → 400 on every route.
 *   • Cross-tenant isolation is enforced by PassportRevocationList (isRevoked / get / list
 *     are all tenant-scoped; wrong-tenant queries return false/null/[]).
 *   • revoke() is additive-only and idempotent — the original entry is preserved on re-revoke.
 *   • No PassportRevocationError can escape: caught and mapped to 400.
 */

import type { SovereignStack } from "../composition.ts";
import type { Route } from "./sovereign-routes.ts";
import { PassportRevocationError } from "../../lib/passport/passport-revocation-list.ts";

interface Ctx {
  tenantId: string;
  body: any;
  params: Record<string, string>;
  query: Record<string, string>;
  scopes?: string[];
  headers?: Record<string, string | string[] | undefined>;
}
interface Res { status: number; body: unknown; }

const ok = (body: unknown, status = 200): Res => ({ status, body });
const err = (status: number, message: string): Res => ({ status, body: { error: message } });

export function passportRevocationRoutes(stack: SovereignStack): Route[] {
  const { revocationList } = stack;

  return [
    // ── POST /api/passports/revoke ────────────────────────────────────────────
    {
      method: "POST",
      pattern: "/api/passports/revoke",
      requiresIdempotencyKey: true,
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");

        const passportId = c.body?.passportId;
        if (typeof passportId !== "string" || passportId.length === 0) {
          return err(400, "passportId must be a non-empty string");
        }
        const reason: string | undefined = typeof c.body?.reason === "string" ? c.body.reason : undefined;

        try {
          revocationList.revoke(passportId, c.tenantId, reason);
        } catch (e) {
          if (e instanceof PassportRevocationError) {
            return err(400, e.message);
          }
          throw e;
        }

        const entry = revocationList.get(passportId, c.tenantId)!;
        return ok({ ok: true, entry });
      },
    },

    // ── GET /api/passports/:passportId/revocation ─────────────────────────────
    {
      method: "GET",
      pattern: "/api/passports/:passportId/revocation",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");

        const passportId = c.params.passportId;
        if (!passportId) return err(400, "passportId param required");

        const revoked = revocationList.isRevoked(passportId, c.tenantId);
        const entry = revocationList.get(passportId, c.tenantId);
        return ok({ ok: true, revoked, entry: entry ?? null });
      },
    },

    // ── GET /api/passports/revocations ────────────────────────────────────────
    {
      method: "GET",
      pattern: "/api/passports/revocations",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");

        const revocations = revocationList.list(c.tenantId);
        return ok({ ok: true, revocations, total: revocations.length });
      },
    },
  ];
}
