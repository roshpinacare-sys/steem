/**
 * src/sovereignty/break-glass-middleware.ts — enforce signed break-glass
 * tickets on sensitive routes (substep 1 of "break-glass enforcement
 * middleware" in MANIFEST v196 "החסר הבא #1").
 *
 * PURPOSE
 * -------
 * The issue side already exists (POST /api/sovereignty/break-glass, v192).
 * What was missing is the *consume* side: a single chokepoint that a
 * sensitive route can call to verify and consume a ticket before granting
 * a temporary scope. This module IS that chokepoint.
 *
 * `enforceBreakGlassTicket` is a pure, dependency-injected function (NOT a
 * framework middleware): the existing route stack uses plain `(ctx) => Res`
 * handlers (see src/routes/*.ts), so the cleanest "middleware" here is a
 * function the handler calls early, mirroring `requireScope`.
 *
 * INVARIANTS (fail-closed; every branch returns a denial — never throws on
 * untrusted input):
 *   • Encoded ticket missing / not a string / blank          → 401
 *   • Decode fails (bad base64, non-JSON, wrong version)     → 401
 *   • Signature invalid                                      → 401
 *   • Ticket expired                                         → 401
 *   • Ticket tenantId ≠ request tenantId                     → 401 (tenant mismatch)
 *   • grantScope does NOT cover requiredScope                → 403
 *   • Nonce already consumed (replay)                        → 409
 *
 * On success:
 *   • Nonce is recorded in the NonceRegistry (TTL = ticket.expiresAt) — a
 *     second call with the same encoded ticket is rejected as replay.
 *   • A signed audit record (actionType="break-glass.consumed",
 *     outcome="allowed") is appended to the tenant's chain. Audit failure
 *     surfaces as a 500 denial; we never grant access we cannot record.
 *   • Returns the verified ticket so the caller can log it / pass the
 *     grantScope into a downstream requireScope check.
 *
 * SCOPE-COVERAGE RULE
 * -------------------
 * A ticket grants exactly one scope. It covers `requiredScope` iff:
 *   ticket.grantScope === requiredScope  OR  ticket.grantScope === "superadmin"
 * The "superadmin" wildcard matches the existing requireScope semantics
 * (see lib/rbac/require-scope.ts). No other implicit broadening — a ticket
 * for "ledger:transfer" does NOT cover "settlement:write", etc.
 *
 * Zero external dependencies. Audit record format mirrors the issue side
 * (see src/sovereignty/break-glass.ts § BREAK_GLASS_AUDIT_ACTION_TYPE),
 * so the issue→consume pair leaves a tamper-evident pair of entries.
 */

import {
  decodeBreakGlassTicket,
  verifyBreakGlassTicket,
  type BreakGlassTicket,
} from "./break-glass.ts";
import type { Signer, AuditStore } from "../../lib/orchestrator/types.ts";
import type { NonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";

// ─── Canonical audit action type for the consume side ───────────────────────

export const BREAK_GLASS_CONSUMED_ACTION_TYPE = "break-glass.consumed" as const;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Same shape as ScopeDenial but allows a wider status set (401/403/409/500). */
export interface BreakGlassDenial {
  readonly status: 401 | 403 | 409 | 500;
  readonly body: { readonly error: string };
}

export interface EnforceBreakGlassInput {
  /** Raw encoded ticket as transported (e.g. `x-break-glass` header value). */
  encodedTicket: unknown;
  /** Tenant from the request context — ticket MUST be bound to this tenant. */
  tenantId: string;
  /** The scope the route requires (e.g. "ledger:transfer"). */
  requiredScope: string;
  /** Kernel signer — same instance used to issue the ticket (rotation invalidates). */
  signer: Signer;
  /** Replay-protection registry — must be shared across requests. */
  nonceRegistry: NonceRegistry;
  /** Audit store the issuance also wrote to. */
  auditStore: AuditStore;
  /**
   * Caller identifier recorded in the audit `source` field
   * (e.g. api-key name, "tenant:<id>"). Defaults to "tenant:<tenantId>".
   */
  operator?: string;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export type EnforceBreakGlassResult =
  | { ok: true; ticket: BreakGlassTicket }
  | { ok: false; denial: BreakGlassDenial };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deny(status: BreakGlassDenial["status"], message: string): EnforceBreakGlassResult {
  return { ok: false, denial: { status, body: { error: message } } };
}

/** A ticket's grantScope covers requiredScope iff exact match or wildcard. */
export function grantScopeCovers(grantScope: string, requiredScope: string): boolean {
  if (typeof grantScope !== "string" || typeof requiredScope !== "string") return false;
  if (grantScope.length === 0 || requiredScope.length === 0) return false;
  return grantScope === requiredScope || grantScope === "superadmin";
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Verify a transported break-glass ticket, enforce it covers `requiredScope`,
 * detect replay, and on success append the consume audit record.
 *
 * Pure: never throws on untrusted input. The only side effects on success
 * are the (1) nonceRegistry.add and (2) auditStore.append — both intentional
 * and observable to tests via `nonceRegistry.has(...)` / `getChain(tenantId)`.
 */
export function enforceBreakGlassTicket(input: EnforceBreakGlassInput): EnforceBreakGlassResult {
  const {
    encodedTicket,
    tenantId,
    requiredScope,
    signer,
    nonceRegistry,
    auditStore,
    operator,
    now,
  } = input;

  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return deny(401, "break-glass: tenantId required");
  }
  if (typeof requiredScope !== "string" || requiredScope.length === 0) {
    return deny(401, "break-glass: requiredScope required");
  }
  if (typeof encodedTicket !== "string" || encodedTicket.length === 0) {
    return deny(401, "break-glass ticket required");
  }

  const decoded = decodeBreakGlassTicket(encodedTicket);
  if (!decoded) {
    return deny(401, "break-glass: ticket malformed (decode failed)");
  }

  const verified = verifyBreakGlassTicket(decoded, signer, {
    now,
    expectedTenantId: tenantId,
  });
  if (!verified.valid) {
    // verifyBreakGlassTicket's reasons are stable: "ticket expired",
    // "tenant mismatch", "signature invalid", "unknown version", etc.
    return deny(401, `break-glass: ${verified.reason}`);
  }
  const ticket = verified.ticket;

  // Replay detection BEFORE scope/audit work — a replayed ticket must
  // not produce a second audit record.
  if (nonceRegistry.has(ticket.nonce)) {
    return deny(409, "break-glass: ticket already consumed (replay)");
  }

  // Scope coverage — exact match or superadmin wildcard.
  if (!grantScopeCovers(ticket.grantScope, requiredScope)) {
    return deny(
      403,
      `break-glass: grantScope "${ticket.grantScope}" does not cover required scope "${requiredScope}"`,
    );
  }

  // Record nonce FIRST so a parallel duplicate is also denied.
  // NonceRegistry.add is idempotent and synchronous to the in-mem mirror.
  nonceRegistry.add(ticket.nonce, ticket.expiresAt);

  const src = typeof operator === "string" && operator.length > 0
    ? `break-glass:${operator}`
    : `break-glass:tenant:${tenantId}`;
  const occurredAt = (now ? now() : new Date()).toISOString();

  try {
    auditStore.append({
      id: `${ticket.ticketId}.consumed` as any,
      tenantId,
      actionId: ticket.ticketId as any,
      actionType: BREAK_GLASS_CONSUMED_ACTION_TYPE,
      source: src,
      outcome: "allowed",
      reason:
        `grantScope=${ticket.grantScope}; requiredScope=${requiredScope}; ` +
        `ticketIssuedAt=${ticket.issuedAt}; ticketExpiresAt=${ticket.expiresAt}`,
      occurredAt: occurredAt as any,
    });
  } catch (e: any) {
    // Don't grant access we couldn't record. The nonce was already added so
    // this single ticket is effectively burned — preferable to silently
    // letting a sensitive op through without an audit trail.
    return deny(500, `break-glass: audit append failed — access denied: ${e?.message ?? "unknown error"}`);
  }

  return { ok: true, ticket };
}
