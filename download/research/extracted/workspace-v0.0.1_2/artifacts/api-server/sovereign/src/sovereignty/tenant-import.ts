/**
 * src/sovereignty/tenant-import.ts — Tenant Import (restore from ExportBundle).
 *
 * `verifyBundle(bundle, signer)` — pure verification: recomputes the canonical
 *   signature and checks it against `bundle.signature`. Returns true/false.
 *
 * `importTenantBundle(bundle, stack)` — verifies the bundle then restores data:
 *   • re-appends escrow agreements (puts them into the escrowStore if absent)
 *
 * Note: audit chain records are **not** re-appended — the audit chain is
 * append-only and hash-linked. Importing into a fresh tenant preserves the
 * exported chain as evidence; importing into an existing tenant that already
 * has records would break the chain. The exported bundle serves as a portable
 * proof artifact — the canonical verification path is `verify-passport.mjs`.
 *
 * Escrow agreements ARE restored: they carry no hash-link invariants and
 * represent operational state the tenant needs to resume work.
 */

import { canonicalize, BUNDLE_SCHEMA, ExportError, type ExportBundle, type ExportPayload } from "./tenant-export.ts";
import type { Signer } from "../../lib/orchestrator/types.ts";
import type { SovereignStack } from "../composition.ts";

// ── Verification ──────────────────────────────────────────────────────────────

/**
 * Verify the bundle's signature without modifying any state.
 * Returns true if the signature is valid, false if tampered.
 * Throws ExportError for structural problems (wrong schema, missing fields).
 */
export function verifyBundle(bundle: unknown, signer: Signer): boolean {
  if (!bundle || typeof bundle !== "object") {
    throw new ExportError("bundle must be a non-null object", "invalid_bundle");
  }
  const b = bundle as Record<string, unknown>;

  if (b["schema"] !== BUNDLE_SCHEMA) {
    throw new ExportError(
      `unsupported schema: ${b["schema"]} (expected ${BUNDLE_SCHEMA})`,
      "schema_mismatch",
    );
  }
  if (typeof b["tenantId"] !== "string" || !b["tenantId"]) {
    throw new ExportError("bundle.tenantId must be a non-empty string", "invalid_bundle");
  }
  if (typeof b["signature"] !== "string" || !b["signature"]) {
    throw new ExportError("bundle.signature must be a non-empty string", "invalid_bundle");
  }

  // Reconstruct the payload (everything except `signature`) for canonicalization
  const payload: ExportPayload = {
    schema: b["schema"] as typeof BUNDLE_SCHEMA,
    tenantId: b["tenantId"] as string,
    exportedAt: b["exportedAt"] as string,
    auditChain: (b["auditChain"] ?? []) as ExportPayload["auditChain"],
    escrowAgreements: (b["escrowAgreements"] ?? []) as ExportPayload["escrowAgreements"],
    passports: (b["passports"] ?? []) as ExportPayload["passports"],
  };

  const canonical = canonicalize(payload as unknown as Record<string, unknown>);
  return signer.verify(canonical, b["signature"] as string);
}

// ── Import ────────────────────────────────────────────────────────────────────

export interface ImportResult {
  tenantId: string;
  auditChainLength: number;
  escrowsRestored: number;
  passportsInBundle: number;
}

/**
 * Verify the bundle and restore escrow agreements for the tenant.
 * Fail-closed: throws ExportError if signature is invalid or tenantId mismatches.
 */
export async function importTenantBundle(
  bundle: unknown,
  stack: SovereignStack,
  callerTenantId: string,
): Promise<ImportResult> {
  // Verify signature first — fail-closed: never restore tampered data
  const valid = verifyBundle(bundle, stack.signer);
  if (!valid) {
    throw new ExportError("bundle signature is invalid — import rejected", "signature_invalid");
  }

  const b = bundle as ExportBundle;

  // Tenant isolation: the calling tenant must match the bundle's tenantId
  if (b.tenantId !== callerTenantId) {
    throw new ExportError(
      `bundle tenantId (${b.tenantId}) does not match caller (${callerTenantId})`,
      "tenant_id_mismatch",
    );
  }

  // Restore escrow agreements — put each one if not already present
  let escrowsRestored = 0;
  for (const agreement of b.escrowAgreements) {
    const existing = await stack.escrowStore.get(b.tenantId, agreement.id);
    if (!existing) {
      await stack.escrowStore.put(agreement);
      escrowsRestored++;
    }
  }

  return {
    tenantId: b.tenantId,
    auditChainLength: b.auditChain.length,
    escrowsRestored,
    passportsInBundle: b.passports.length,
  };
}
