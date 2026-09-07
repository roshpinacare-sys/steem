/**
 * src/sovereignty/tenant-export.ts — Tenant Export Bundle (ריבונות / data portability).
 *
 * `exportTenantBundle(tenantId, stack)` collects all durable data for a tenant:
 *   • audit chain  — the canonical hash-linked record log
 *   • escrow agreements — all escrow objects for the tenant
 *   • passports — one signed ActionPassport per audit record
 *
 * The assembled bundle is serialized to JSON, then the JSON string is signed with
 * `stack.signer` (the same key that signs audit records — no new credentials needed).
 *
 * Bundle schema (ExportBundle):
 * {
 *   schema: "tfa-export-bundle/v1",
 *   tenantId: string,
 *   exportedAt: ISO-8601 string,
 *   auditChain: AuditRecord[],
 *   escrowAgreements: EscrowAgreement[],
 *   passports: ActionPassport[],   // one per auditChain entry, in order
 *   signature: string              // signer.sign(canonical JSON of {schema,tenantId,exportedAt,…data})
 * }
 *
 * Canonicalization for signature: JSON.stringify of the payload object WITHOUT the
 * `signature` field, using a stable key order (keys sorted alphabetically at each level).
 * This is deterministic and simple — we do not depend on external canonicalization libs.
 */

import type { AuditRecord } from "../../lib/orchestrator/types.ts";
import type { EscrowAgreement } from "../../lib/escrow/escrow.ts";
import type { ActionPassport } from "../../lib/passport/types.ts";
import { issuePassport, PassportError } from "../../lib/passport/index.ts";
import type { SovereignStack } from "../composition.ts";

// ── Schema constant ────────────────────────────────────────────────────────────

export const BUNDLE_SCHEMA = "tfa-export-bundle/v1" as const;

// ── Types ──────────────────────────────────────────────────────────────────────

/** The signed export bundle returned by exportTenantBundle(). */
export interface ExportBundle {
  schema: typeof BUNDLE_SCHEMA;
  tenantId: string;
  exportedAt: string;       // ISO-8601 UTC
  auditChain: AuditRecord[];
  escrowAgreements: EscrowAgreement[];
  passports: ActionPassport[];
  /** HMAC-SHA256 (or Ed25519) signature over the canonical payload JSON (without this field). */
  signature: string;
}

/** Payload object that is signed (bundle minus the signature field). */
export interface ExportPayload {
  schema: typeof BUNDLE_SCHEMA;
  tenantId: string;
  exportedAt: string;
  auditChain: AuditRecord[];
  escrowAgreements: EscrowAgreement[];
  passports: ActionPassport[];
}

// ── Canonicalization ──────────────────────────────────────────────────────────

/**
 * Stable JSON serialization for signing.
 * Produces deterministic output regardless of property insertion order.
 * Values of type `bigint` are serialized as strings (μ¢ amounts).
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object" && typeof value !== "bigint") {
    if (typeof value === "bigint") return String(value);
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return String(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

// ── Export ────────────────────────────────────────────────────────────────────

/**
 * Assemble and sign a sovereign export bundle for `tenantId`.
 * Fail-closed: any error (empty chain, escrow fetch failure, passport issue error) propagates.
 */
export async function exportTenantBundle(
  tenantId: string,
  stack: SovereignStack,
): Promise<ExportBundle> {
  if (!tenantId || typeof tenantId !== "string") {
    throw new ExportError("tenantId is required", "invalid_tenant_id");
  }

  // 1. Audit chain (synchronous on in-memory store; async wrapper if Pg)
  const auditChain: AuditRecord[] = stack.orchestrator.audit.getChain(tenantId);

  // 2. Escrow agreements
  const escrowAgreements: EscrowAgreement[] = await stack.escrowStore.list(tenantId);

  // 3. Passports — one per audit record (best-effort; skip if a record has no passportable data)
  const passports: ActionPassport[] = [];
  for (const record of auditChain) {
    try {
      const passport = issuePassport({
        auditStore: stack.orchestrator.audit,
        signer: stack.signer,
        auditId: record.id,
        tenantId,
      });
      passports.push(passport);
    } catch (e) {
      if (e instanceof PassportError && e.code === "tenant_mismatch") {
        throw new ExportError(
          `tenant mismatch on record ${record.id} — cross-tenant data leak prevented`,
          "tenant_mismatch",
        );
      }
      // Other errors (e.g. missing signer) — surface them
      throw e;
    }
  }

  // 4. Assemble payload and sign
  const exportedAt = new Date().toISOString();
  const payload: ExportPayload = {
    schema: BUNDLE_SCHEMA,
    tenantId,
    exportedAt,
    auditChain,
    escrowAgreements,
    passports,
  };

  const canonical = canonicalize(payload as unknown as Record<string, unknown>);
  const signature = stack.signer.sign(canonical);

  return { ...payload, signature };
}

// ── ExportError ───────────────────────────────────────────────────────────────

export type ExportErrorCode =
  | "invalid_tenant_id"
  | "tenant_mismatch"
  | "invalid_bundle"
  | "schema_mismatch"
  | "signature_invalid"
  | "tenant_id_mismatch";

export class ExportError extends Error {
  readonly code: ExportErrorCode;
  constructor(message: string, code: ExportErrorCode) {
    super(message);
    this.name = "ExportError";
    this.code = code;
  }
}
