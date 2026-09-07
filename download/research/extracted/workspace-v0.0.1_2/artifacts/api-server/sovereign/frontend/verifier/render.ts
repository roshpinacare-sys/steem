/**
 * frontend/verifier/render.ts — Render a ProofRibbon from a parsed payload + verify response.
 *
 * Design principles:
 *   • Both VALID and INVALID payloads get a full ribbon — forensic detail on
 *     failure is as important as confirmation on success.
 *   • PARTIAL verdict: signature valid but decision integrity failed (receipt-only).
 *   • The VerifyResponse is injected — this module never fetches anything.
 *   • Zero external dependencies; zero node built-in imports.
 */

import type { ParseOk, VerifyResponse, ChainItem, ProofRibbon, PayloadType } from "./types.ts";

export type { VerifyResponse, ChainItem, ProofRibbon };

/**
 * renderProofRibbon — convert a parsed payload + API verify response into a
 * display-ready ProofRibbon.
 *
 * @param parsed       Successful parse result from parseVerifierInput.
 * @param response     Backend verify response (injected, not fetched here).
 * @param permalinkSlug Pre-computed slug from computePermalinkSlug.
 */
export function renderProofRibbon(
  parsed: ParseOk,
  response: VerifyResponse,
  permalinkSlug: string
): ProofRibbon {
  const chain: ChainItem[] = [];
  const raw = parsed.raw;

  // Signature is the first chain item — always present.
  chain.push({
    label: "Signature",
    value: response.signatureValid ? "Valid ✓" : "Invalid ✗",
    ok: response.signatureValid,
  });

  if (parsed.type === "receipt") {
    return renderReceipt(raw, response, chain, permalinkSlug);
  }
  if (parsed.type === "passport") {
    return renderPassport(raw, response, chain, permalinkSlug);
  }
  // proof-bundle / unknown
  return renderBundle(raw, response, chain, permalinkSlug);
}

// ─── Per-type renderers ────────────────────────────────────────────────────────

function renderReceipt(
  raw: Record<string, unknown>,
  response: VerifyResponse,
  chain: ChainItem[],
  permalinkSlug: string
): ProofRibbon {
  const kid = stringOf(raw.kid);
  const riskClass = stringOf(raw.riskClass);
  const decision = stringOf(raw.decision);
  const approvalClass = stringOf(raw.approvalClass);
  const issuedAt = stringOf(raw.issuedAt) ?? "";

  if (kid) chain.push({ label: "Signing Key (kid)", value: kid, ok: null });
  if (riskClass) chain.push({ label: "Risk Class", value: riskClass, ok: null });
  if (decision)
    chain.push({
      label: "Decision",
      value: decision,
      ok: decision === "allowed",
    });
  if (approvalClass)
    chain.push({ label: "Approval Class", value: approvalClass, ok: null });

  if (response.decisionValid !== undefined) {
    chain.push({
      label: "Decision Integrity",
      value: response.decisionValid ? "Consistent ✓" : "Mismatch ✗",
      ok: response.decisionValid,
    });
  }

  appendTransparency(chain, response);

  const verdict = receiptVerdict(response);

  return {
    verdict,
    payloadType: "receipt",
    id: stringOf(raw.intentId) ?? "",
    tenantId: stringOf(raw.tenantId) ?? "",
    actorId: stringOf(raw.actorId),
    toolId: stringOf(raw.toolId),
    issuedAt,
    signatureValid: response.signatureValid,
    decisionValid: response.decisionValid,
    kid,
    riskClass,
    decision,
    approvalClass,
    merkleLeaf: response.merkleLeaf,
    merkleIndex: response.merkleIndex,
    witnessQuorum: response.witnessQuorum,
    chain,
    reasons: response.reasons ?? [],
    permalinkSlug,
  };
}

function renderPassport(
  raw: Record<string, unknown>,
  response: VerifyResponse,
  chain: ChainItem[],
  permalinkSlug: string
): ProofRibbon {
  const audit = raw.audit as Record<string, unknown> | undefined;
  const auditHash = audit ? stringOf(audit.hash) : undefined;

  if (auditHash) chain.push({ label: "Audit Hash", value: auditHash, ok: null });
  if (response.passportHash)
    chain.push({ label: "Passport Hash", value: response.passportHash, ok: null });
  appendTransparency(chain, response);

  return {
    verdict: response.signatureValid ? "VALID" : "INVALID",
    payloadType: "passport",
    id: stringOf(raw.passportId) ?? "",
    tenantId: stringOf(raw.tenantId) ?? "",
    issuedAt: stringOf(raw.issuedAt) ?? "",
    signatureValid: response.signatureValid,
    witnessQuorum: response.witnessQuorum,
    chain,
    reasons: response.reasons ?? [],
    permalinkSlug,
  };
}

function renderBundle(
  raw: Record<string, unknown>,
  response: VerifyResponse,
  chain: ChainItem[],
  permalinkSlug: string
): ProofRibbon {
  appendTransparency(chain, response);
  const type: PayloadType =
    "passports" in raw && Array.isArray(raw.passports) ? "proof-bundle" : "unknown";

  return {
    verdict: response.signatureValid ? "VALID" : "INVALID",
    payloadType: type,
    id: stringOf(raw.id) ?? "",
    tenantId: stringOf(raw.tenantId) ?? "",
    issuedAt: stringOf(raw.issuedAt) ?? "",
    signatureValid: response.signatureValid,
    witnessQuorum: response.witnessQuorum,
    chain,
    reasons: response.reasons ?? [],
    permalinkSlug,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function appendTransparency(chain: ChainItem[], response: VerifyResponse): void {
  if (response.merkleLeaf)
    chain.push({ label: "Transparency Log Leaf", value: response.merkleLeaf, ok: null });
  if (response.merkleIndex !== undefined)
    chain.push({ label: "Log Index", value: String(response.merkleIndex), ok: null });
  if (response.witnessQuorum) {
    const { reached, distinctWitnesses, threshold } = response.witnessQuorum;
    chain.push({
      label: "Witness Quorum",
      value: `${distinctWitnesses} of ${threshold} witnesses confirmed`,
      // Informational alongside signature verification, not a substitute for
      // it — quorum not reached is surfaced (ok: false) but never flips the
      // overall VALID/INVALID verdict computed from signatureValid above.
      ok: reached,
    });
  }
}

/**
 * VALID   — signature + decision both good (or decisionValid not present).
 * PARTIAL — signature ok but decision integrity failed.
 * INVALID — signature failed (decision can't be trusted either).
 */
function receiptVerdict(r: VerifyResponse): ProofRibbon["verdict"] {
  if (!r.signatureValid) return "INVALID";
  if (r.decisionValid === false) return "PARTIAL";
  return "VALID";
}

function stringOf(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
