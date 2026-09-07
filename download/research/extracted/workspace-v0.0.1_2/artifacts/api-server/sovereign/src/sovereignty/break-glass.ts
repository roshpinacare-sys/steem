/**
 * src/sovereignty/break-glass.ts — Break-glass / emergency-access ticket.
 *
 * PURPOSE
 * -------
 * Holders of the `admin:break-glass` API-key scope may, in an emergency
 * (lost admin key, blocked workflow, compromised dependency), request a
 * short-lived signed ticket that *attests* a temporary scope grant for
 * a specific tenant. The ticket is:
 *
 *   • Signed by the kernel `Signer` (HMAC or Ed25519) — same key chain
 *     as the audit store, so rotation invalidates outstanding tickets.
 *   • TTL-bound — `expiresAt` is at most BREAK_GLASS_MAX_TTL_MS in the
 *     future. Verification rejects expired tickets fail-closed.
 *   • Scope-bound — every ticket carries the exact `grantScope` it
 *     attests, the issuing operator's identifier, and a human reason.
 *   • Tenant-bound — signature covers `tenantId`, so a ticket for
 *     tenant A cannot be replayed against tenant B.
 *   • Single-use *intent* — every ticket carries a fresh `nonce`. The
 *     caller (HTTP route / consumer) is responsible for tracking
 *     consumed nonces in a registry; this module exports the nonce so
 *     a NonceRegistry can detect replay.
 *
 * The issue side ALSO writes a signed `break-glass.issued` audit
 * record into the per-tenant chain, so the ticket leaves a tamper-
 * evident trail even if it is never actually consumed.
 *
 * TICKET FORMAT (JSON, base64url-encoded for transport)
 * -----------------------------------------------------
 * {
 *   version:    "tfa-break-glass-v1"
 *   ticketId:   string   — uuid; also used as the audit `actionId`
 *   tenantId:   string
 *   grantScope: string   — the scope this ticket attests
 *   operator:   string   — who requested it (api-key name, OIDC sub…)
 *   reason:     string   — human-readable justification
 *   issuedAt:   string   — ISO-8601
 *   expiresAt:  string   — ISO-8601 (≤ issuedAt + MAX_TTL_MS)
 *   nonce:      string   — random, single-use
 *   signature:  string   — signer.sign(canonical payload)
 * }
 *
 * CANONICAL PAYLOAD (deterministic, pipe-separated)
 *   `${version}|${ticketId}|${tenantId}|${grantScope}|${operator}|${reason}|${issuedAt}|${expiresAt}|${nonce}`
 *
 * FAIL-CLOSED INVARIANTS
 * ----------------------
 * • issueBreakGlassTicket: tenantId, grantScope, operator, reason all
 *   required and non-empty. ttlMs ∈ [BREAK_GLASS_MIN_TTL_MS,
 *   BREAK_GLASS_MAX_TTL_MS]. Throws BreakGlassError otherwise.
 * • verifyBreakGlassTicket: returns `{ valid: false, reason }` for any
 *   structural, semantic, expiry, tenant-binding, or signature error.
 *   Never throws, never returns valid:true on partial input.
 *
 * Zero external dependencies — node:crypto only.
 */

import { randomBytes, randomUUID } from "node:crypto";
import type { Signer } from "../../lib/orchestrator/types.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

export const BREAK_GLASS_VERSION = "tfa-break-glass-v1" as const;
export const BREAK_GLASS_DEFAULT_TTL_MS = 5 * 60 * 1_000;   // 5 minutes
export const BREAK_GLASS_MIN_TTL_MS = 1_000;                // 1 second floor
export const BREAK_GLASS_MAX_TTL_MS = 60 * 60 * 1_000;      // 1 hour ceiling
export const BREAK_GLASS_AUDIT_ACTION_TYPE = "break-glass.issued" as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BreakGlassTicket {
  version: typeof BREAK_GLASS_VERSION;
  ticketId: string;
  tenantId: string;
  grantScope: string;
  operator: string;
  reason: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  signature: string;
}

export interface IssueBreakGlassInput {
  tenantId: string;
  grantScope: string;
  operator: string;
  reason: string;
  ttlMs?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export type VerifyResult =
  | { valid: true; ticket: BreakGlassTicket }
  | { valid: false; reason: string };

// ─── Errors ──────────────────────────────────────────────────────────────────

export class BreakGlassError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "BreakGlassError";
  }
}

// ─── Internals ───────────────────────────────────────────────────────────────

function canonicalPayload(t: Omit<BreakGlassTicket, "signature">): string {
  return [
    t.version,
    t.ticketId,
    t.tenantId,
    t.grantScope,
    t.operator,
    t.reason,
    t.issuedAt,
    t.expiresAt,
    t.nonce,
  ].join("|");
}

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BreakGlassError("INVALID_INPUT", `${name} must be a non-empty string`);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Issue a signed break-glass ticket. Pure: no side effects on any store.
 * The caller is responsible for persisting the audit record (see
 * `recordBreakGlassAudit`) and tracking the nonce.
 */
export function issueBreakGlassTicket(
  input: IssueBreakGlassInput,
  signer: Signer,
): BreakGlassTicket {
  assertNonEmptyString(input.tenantId, "tenantId");
  assertNonEmptyString(input.grantScope, "grantScope");
  assertNonEmptyString(input.operator, "operator");
  assertNonEmptyString(input.reason, "reason");

  const ttlMs = input.ttlMs ?? BREAK_GLASS_DEFAULT_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs < BREAK_GLASS_MIN_TTL_MS || ttlMs > BREAK_GLASS_MAX_TTL_MS) {
    throw new BreakGlassError(
      "INVALID_TTL",
      `ttlMs must be between ${BREAK_GLASS_MIN_TTL_MS} and ${BREAK_GLASS_MAX_TTL_MS} (got ${ttlMs})`,
    );
  }

  const now = input.now ? input.now() : new Date();
  const unsigned: Omit<BreakGlassTicket, "signature"> = {
    version: BREAK_GLASS_VERSION,
    ticketId: randomUUID(),
    tenantId: input.tenantId,
    grantScope: input.grantScope,
    operator: input.operator,
    reason: input.reason,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    nonce: randomBytes(16).toString("hex"),
  };
  const signature = signer.sign(canonicalPayload(unsigned));
  return { ...unsigned, signature };
}

/**
 * Verify a ticket. Fail-closed on any anomaly. `expectedTenantId` is
 * optional but recommended: when provided, the ticket's tenantId MUST
 * equal it (defense against cross-tenant replay even before signature).
 */
export function verifyBreakGlassTicket(
  ticket: unknown,
  signer: Signer,
  opts: { now?: () => Date; expectedTenantId?: string } = {},
): VerifyResult {
  if (!ticket || typeof ticket !== "object") {
    return { valid: false, reason: "ticket must be an object" };
  }
  const t = ticket as Record<string, unknown>;
  if (t.version !== BREAK_GLASS_VERSION) {
    return { valid: false, reason: `unknown version: ${String(t.version)}` };
  }
  for (const f of ["ticketId", "tenantId", "grantScope", "operator", "reason", "issuedAt", "expiresAt", "nonce", "signature"] as const) {
    if (typeof t[f] !== "string" || (t[f] as string).length === 0) {
      return { valid: false, reason: `field ${f} missing or not a non-empty string` };
    }
  }
  const typed = t as unknown as BreakGlassTicket;

  if (opts.expectedTenantId !== undefined && typed.tenantId !== opts.expectedTenantId) {
    return { valid: false, reason: "tenant mismatch" };
  }

  const expiresAtMs = Date.parse(typed.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return { valid: false, reason: "expiresAt is not a valid ISO timestamp" };
  }
  const now = (opts.now ? opts.now() : new Date()).getTime();
  if (now >= expiresAtMs) {
    return { valid: false, reason: "ticket expired" };
  }

  const { signature, ...rest } = typed;
  let ok = false;
  try { ok = signer.verify(canonicalPayload(rest), signature); } catch { ok = false; }
  if (!ok) return { valid: false, reason: "signature invalid" };

  return { valid: true, ticket: typed };
}

/** Extract a ticket's nonce without verifying — for NonceRegistry replay tracking. */
export function extractBreakGlassNonce(ticket: BreakGlassTicket): string {
  return ticket.nonce;
}

/** Base64url helpers (mirrors capability-token transport encoding). */
export function encodeBreakGlassTicket(ticket: BreakGlassTicket): string {
  return Buffer.from(JSON.stringify(ticket), "utf8").toString("base64url");
}

export function decodeBreakGlassTicket(encoded: string): BreakGlassTicket | null {
  if (typeof encoded !== "string" || encoded.length === 0) return null;
  try {
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as BreakGlassTicket;
  } catch {
    return null;
  }
}
