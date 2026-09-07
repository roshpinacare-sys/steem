/**
 * src/routes/sovereignty-routes.ts — Tenant sovereignty (data portability) routes.
 *
 * Routes:
 *   GET  /api/sovereignty/export
 *     Export all tenant data as a signed bundle. Response: 200 ExportBundle JSON
 *
 *   POST /api/sovereignty/import
 *     Restore a signed bundle. Verifies signature first (fail-closed).
 *     Body: ExportBundle JSON. Response: 200 ImportResult JSON
 *
 *   POST /api/sovereignty/verify
 *     Signature-only verification, no state change. Response: 200 {valid, reason?}
 *
 *   POST /api/sovereignty/rotate-key
 *     Live key rotation: atomically replace the stack's MutableSigner inner delegate.
 *     Body: { signerKind: "hmac", secret: "..." } | { signerKind: "ed25519", privateKey: "...", publicKey: "..." }
 *     Response: 200 { ok, rotatedAt, rotationCount, newAlgorithm }
 *     Security: require x-api-key with 'admin:key-rotation' scope (fail-closed; stub scope
 *     check in this implementation — full RBAC enforcement is via ApiKeyService middleware).
 *
 * Invariants:
 *   • tenantId from x-tenant-id is mandatory — fail-closed.
 *   • rotate-key rejects unknown signerKind (fail-closed).
 *   • rotate-key rejects secrets shorter than 16 bytes (fail-closed: HmacSigner throws).
 *   • rotate-key rejects missing Ed25519 PEM keys (fail-closed: Ed25519Signer throws).
 */

import type { SovereignStack } from "../composition.ts";
import { exportTenantBundle, ExportError } from "../sovereignty/tenant-export.ts";
import { importTenantBundle, verifyBundle } from "../sovereignty/tenant-import.ts";
import { HmacSigner, Ed25519Signer, SignerError } from "../../lib/orchestrator/signer.ts";
import type { Signer } from "../../lib/orchestrator/types.ts";
import { requireScope } from "../../lib/rbac/require-scope.ts";
import { enforceBreakGlassTicket } from "../sovereignty/break-glass-middleware.ts";
import {
  issueBreakGlassTicket,
  encodeBreakGlassTicket,
  BreakGlassError,
  BREAK_GLASS_DEFAULT_TTL_MS,
  BREAK_GLASS_MAX_TTL_MS,
  BREAK_GLASS_MIN_TTL_MS,
  BREAK_GLASS_AUDIT_ACTION_TYPE,
} from "../sovereignty/break-glass.ts";

// ── Route primitives (same shape as adapter-routes.ts) ────────────────────────

interface Ctx {
  tenantId: string;
  body: any;
  params: Record<string, string>;
  query: Record<string, string>;
  /** API-key scopes resolved by ApiKeyService. Empty array when using bare x-tenant-id. */
  scopes?: string[];
  /** Lowercased request headers; used to read `x-break-glass-ticket` (v198 wire-up). */
  headers?: Record<string, string | string[] | undefined>;
}
interface Res { status: number; body: unknown; }
interface Route { method: string; pattern: string; handler: (ctx: Ctx) => Promise<Res>; }

const ok = (body: unknown, status = 200): Res => ({ status, body });
const err = (status: number, message: string): Res => ({ status, body: { error: message } });

// ── Routes ────────────────────────────────────────────────────────────────────

export function sovereigntyRoutes(stack: SovereignStack): Route[] {
  return [
    // ── GET /api/sovereignty/export ──────────────────────────────────────────
    {
      method: "GET",
      pattern: "/api/sovereignty/export",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        try {
          const bundle = await exportTenantBundle(c.tenantId, stack);
          return ok(bundle);
        } catch (e: any) {
          if (e instanceof ExportError) {
            switch (e.code) {
              case "invalid_tenant_id": return err(400, e.message);
              case "tenant_mismatch":   return err(403, "tenant mismatch — export aborted");
              default:                  return err(500, e.message);
            }
          }
          return err(500, e?.message ?? "export failed");
        }
      },
    },

    // ── POST /api/sovereignty/import ─────────────────────────────────────────
    {
      method: "POST",
      pattern: "/api/sovereignty/import",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        if (!c.body || typeof c.body !== "object") {
          return err(400, "request body must be a JSON export bundle");
        }
        try {
          const result = await importTenantBundle(c.body, stack, c.tenantId);
          return ok({ ok: true, ...result });
        } catch (e: any) {
          if (e instanceof ExportError) {
            switch (e.code) {
              case "schema_mismatch":    return err(400, e.message);
              case "invalid_bundle":     return err(400, e.message);
              case "signature_invalid":  return err(422, e.message);
              case "tenant_id_mismatch": return err(403, e.message);
              default:                   return err(500, e.message);
            }
          }
          return err(500, e?.message ?? "import failed");
        }
      },
    },

    // ── POST /api/sovereignty/verify ─────────────────────────────────────────
    // Lightweight verification-only endpoint: does not modify state.
    {
      method: "POST",
      pattern: "/api/sovereignty/verify",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        if (!c.body || typeof c.body !== "object") {
          return err(400, "request body must be a JSON export bundle");
        }
        try {
          const valid = verifyBundle(c.body, stack.signer);
          if (!valid) {
            return ok({ valid: false, reason: "signature_invalid" }, 200);
          }
          return ok({ valid: true });
        } catch (e: any) {
          if (e instanceof ExportError) {
            switch (e.code) {
              case "schema_mismatch": return err(400, e.message);
              case "invalid_bundle":  return err(400, e.message);
              default:                return err(500, e.message);
            }
          }
          return err(500, e?.message ?? "verification failed");
        }
      },
    },
    // ── POST /api/sovereignty/rotate-key ────────────────────────────────────
    // Live key rotation — replaces the MutableSigner inner delegate atomically.
    // The new key takes effect for ALL subsequent sign() and verify() calls
    // (audit store, orchestrator, export bundles, threshold approvals).
    //
    // Body shapes:
    //   { signerKind: "hmac", secret: "<≥16-byte UTF-8 string>" }
    //   { signerKind: "ed25519", privateKey: "<PKCS8 PEM>", publicKey: "<SPKI PEM>" }
    //
    // Fail-closed invariants:
    //   • Unknown signerKind → 400
    //   • Invalid key material → 400 (SignerError propagated)
    //   • Missing x-tenant-id → 400 (standard gate)
    //   • Missing admin:key-rotation scope → 403 (RBAC)
    {
      method: "POST",
      pattern: "/api/sovereignty/rotate-key",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        // v198 — opt-in break-glass enforcement: if the caller presents an
        // `x-break-glass-ticket` header, verify+consume it instead of the
        // standard scope check. The chokepoint is fail-closed (see
        // src/sovereignty/break-glass-middleware.ts): a malformed, expired,
        // replayed, cross-tenant, or insufficiently-scoped ticket denies the
        // request without falling through to RBAC. If no ticket is presented,
        // the existing requireScope path is used unchanged.
        const rawTicket = c.headers?.["x-break-glass-ticket"];
        const encodedTicket = Array.isArray(rawTicket) ? rawTicket[0] : rawTicket;
        if (typeof encodedTicket === "string" && encodedTicket.length > 0) {
          const result = enforceBreakGlassTicket({
            encodedTicket,
            tenantId: c.tenantId,
            requiredScope: "admin:key-rotation",
            signer: stack.signer,
            nonceRegistry: stack.nonceRegistry,
            auditStore: stack.auditStore,
          });
          if (!result.ok) return { status: result.denial.status, body: result.denial.body };
          // Ticket consumed; proceed without consulting c.scopes.
        } else {
          const denial = requireScope(c.scopes, "admin:key-rotation");
          if (denial) return denial;
        }
        const body = c.body ?? {};
        const { signerKind } = body;

        if (signerKind !== "hmac" && signerKind !== "ed25519") {
          return err(400, `signerKind must be "hmac" or "ed25519"; got ${JSON.stringify(signerKind)}`);
        }

        let newSigner: Signer;
        try {
          if (signerKind === "hmac") {
            const { secret } = body;
            if (!secret || typeof secret !== "string") {
              return err(400, 'secret (string) required for signerKind="hmac"');
            }
            newSigner = new HmacSigner(secret);
          } else {
            // ed25519
            const { privateKey, publicKey } = body;
            if (!privateKey || typeof privateKey !== "string") {
              return err(400, 'privateKey (PKCS8 PEM string) required for signerKind="ed25519"');
            }
            if (!publicKey || typeof publicKey !== "string") {
              return err(400, 'publicKey (SPKI PEM string) required for signerKind="ed25519"');
            }
            newSigner = new Ed25519Signer(privateKey, publicKey);
          }
        } catch (e: any) {
          if (e instanceof SignerError) {
            return err(400, `key material invalid: ${e.message}`);
          }
          return err(400, `signer construction failed: ${e?.message ?? "unknown error"}`);
        }

        try {
          const event = stack.signer.rotate(newSigner);
          return ok({
            ok: true,
            rotatedAt: event.rotatedAt,
            rotationCount: event.sequence,
            newAlgorithm: event.newAlgorithm,
          });
        } catch (e: any) {
          return err(500, `rotation failed: ${e?.message ?? "unknown error"}`);
        }
      },
    },

    // ── POST /api/sovereignty/break-glass ───────────────────────────────────
    // Emergency-access ticket issuance. Holders of `admin:break-glass` scope
    // request a short-lived signed ticket that ATTESTS a temporary scope
    // grant. The ticket is bound to {tenantId, grantScope, nonce, expiry}
    // and signed by the kernel signer (rotating the key invalidates all
    // outstanding tickets). A signed audit record is appended to the
    // tenant's chain so the issuance is tamper-evident even if the ticket
    // is never consumed downstream.
    //
    // Body:
    //   {
    //     reason:     string  (≥10 chars; required, audited verbatim)
    //     grantScope: string  (required; the scope being attested — e.g.
    //                          "ledger:transfer", "superadmin")
    //     ttlMs?:     number  (default 5min, range [1s, 1h])
    //     operator?:  string  (free-form id; defaults to "tenant:<tenantId>")
    //   }
    //
    // Fail-closed invariants:
    //   • Missing x-tenant-id                          → 400
    //   • Missing admin:break-glass scope              → 403
    //   • Missing/short/empty reason                   → 400
    //   • Missing/empty grantScope                     → 400
    //   • ttlMs out of [MIN, MAX] range                → 400
    //   • Any internal failure                         → 500 (no ticket leak)
    {
      method: "POST",
      pattern: "/api/sovereignty/break-glass",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const denial = requireScope(c.scopes, "admin:break-glass");
        if (denial) return denial;

        const body = (c.body ?? {}) as Record<string, unknown>;
        const reason = body.reason;
        const grantScope = body.grantScope;
        const ttlMsRaw = body.ttlMs;
        const operatorRaw = body.operator;

        if (typeof reason !== "string" || reason.trim().length < 10) {
          return err(400, "reason (string, ≥10 chars) is required and is recorded verbatim in the audit chain");
        }
        if (typeof grantScope !== "string" || grantScope.length === 0) {
          return err(400, "grantScope (non-empty string) is required");
        }
        let ttlMs: number = BREAK_GLASS_DEFAULT_TTL_MS;
        if (ttlMsRaw !== undefined) {
          if (typeof ttlMsRaw !== "number" || !Number.isFinite(ttlMsRaw)) {
            return err(400, "ttlMs must be a finite number when provided");
          }
          if (ttlMsRaw < BREAK_GLASS_MIN_TTL_MS || ttlMsRaw > BREAK_GLASS_MAX_TTL_MS) {
            return err(400, `ttlMs must be in [${BREAK_GLASS_MIN_TTL_MS}, ${BREAK_GLASS_MAX_TTL_MS}] (got ${ttlMsRaw})`);
          }
          ttlMs = ttlMsRaw;
        }
        const operator =
          typeof operatorRaw === "string" && operatorRaw.length > 0
            ? operatorRaw
            : `tenant:${c.tenantId}`;

        let ticket;
        try {
          ticket = issueBreakGlassTicket(
            {
              tenantId: c.tenantId,
              grantScope,
              operator,
              reason: reason.trim(),
              ttlMs,
            },
            stack.signer,
          );
        } catch (e: any) {
          if (e instanceof BreakGlassError) {
            return err(400, `ticket issuance rejected: ${e.message}`);
          }
          return err(500, `ticket issuance failed: ${e?.message ?? "unknown error"}`);
        }

        // Tamper-evident audit trail — signed by the same kernel signer.
        // Failure to append must NOT silently succeed: surface as 500 and
        // do not return a ticket the system has no record of issuing.
        try {
          stack.orchestrator.audit.append({
            id: ticket.ticketId as any,
            tenantId: c.tenantId,
            actionId: ticket.ticketId as any,
            actionType: BREAK_GLASS_AUDIT_ACTION_TYPE,
            source: `break-glass:${operator}`,
            outcome: "allowed",
            reason: `grantScope=${grantScope}; reason=${reason.trim()}; expiresAt=${ticket.expiresAt}`,
            occurredAt: ticket.issuedAt as any,
          });
        } catch (e: any) {
          return err(500, `audit append failed — ticket not issued: ${e?.message ?? "unknown error"}`);
        }

        return ok({
          ok: true,
          ticketId: ticket.ticketId,
          tenantId: ticket.tenantId,
          grantScope: ticket.grantScope,
          operator: ticket.operator,
          issuedAt: ticket.issuedAt,
          expiresAt: ticket.expiresAt,
          ticket,
          encodedTicket: encodeBreakGlassTicket(ticket),
        });
      },
    },
  ];
}
