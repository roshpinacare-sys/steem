/**
 * frontend/verifier/types.ts — Shared types for the public verifier module.
 *
 * Zero runtime dependencies. Used by parse.ts, render.ts, and the test.
 */

/** Payload types the verifier can handle. */
export type PayloadType = "receipt" | "passport" | "proof-bundle" | "unknown";

/** Successful parse result. */
export interface ParseOk {
  ok: true;
  type: PayloadType;
  /** Raw parsed object — caller may read any field. */
  raw: Record<string, unknown>;
}

/** Failed parse result. Never throws; always returns this instead. */
export interface ParseErr {
  ok: false;
  error: string;
  /**
   * Partial data extracted before the failure — enables forensic display of
   * invalid / unknown payloads (the same principle as rendering invalid
   * signatures with full chain detail, not a blank screen).
   */
  forensic?: Record<string, unknown>;
}

export type ParseResult = ParseOk | ParseErr;

/** Response shape from the backend verify endpoint (injected — never fetched here). */
export interface VerifyResponse {
  signatureValid: boolean;
  decisionValid?: boolean;
  reasons?: string[];
  /** Transparency-log leaf hash (from extended verify endpoint). */
  merkleLeaf?: string;
  /** Position in the transparency log. */
  merkleIndex?: number;
  /** Passport-level hash (passport verify only). */
  passportHash?: string;
  /** Audit-record hash extracted by the verifier (passport verify only). */
  auditHash?: string;
  /**
   * Witness co-signing quorum result for the transparency-log tree head this
   * payload's merkle proof is anchored to (mirrors WitnessQuorumResult from
   * lib/transparency-log/witness.ts). Absent when the backend has no witness
   * network configured for this log — displaying nothing is correct in that
   * case, never a fabricated "0 of 0".
   */
  witnessQuorum?: {
    /** True iff distinctWitnesses >= threshold. */
    reached: boolean;
    /** Number of distinct, signature-verified witnesses that co-signed this root. */
    distinctWitnesses: number;
    /** Minimum distinct witnesses required for quorum. */
    threshold: number;
  };
}

/** One item in the rendered proof chain. */
export interface ChainItem {
  label: string;
  value: string;
  /** true = checked-ok, false = checked-fail, null = informational. */
  ok: boolean | null;
}

/**
 * ProofRibbon — structured verification result ready for display.
 *
 * Both VALID and INVALID receipts/passports get a full ribbon so the UI can
 * show forensic detail on failure rather than a blank/generic error screen.
 */
export interface ProofRibbon {
  verdict: "VALID" | "INVALID" | "PARTIAL";
  payloadType: PayloadType;
  /** Primary identifier (intentId / passportId / bundle id). */
  id: string;
  tenantId: string;
  actorId?: string;
  toolId?: string;
  issuedAt: string;
  signatureValid: boolean;
  /** Present for receipts only (no policy decision in passports/bundles). */
  decisionValid?: boolean;
  /** Key identifier — present when the signer exposes a kid (Ed25519). */
  kid?: string;
  riskClass?: string;
  decision?: string;
  approvalClass?: string;
  merkleLeaf?: string;
  merkleIndex?: number;
  /** Witness co-signing quorum for this payload's anchored tree head, if any. */
  witnessQuorum?: {
    reached: boolean;
    distinctWitnesses: number;
    threshold: number;
  };
  /** Ordered chain of verifiable facts for display. */
  chain: ChainItem[];
  /** Reasons for any invalid/partial verdict (empty when VALID). */
  reasons: string[];
  /** Stable 12-char hex slug for shared permalink URLs. */
  permalinkSlug: string;
}
