/**
 * @ecos/verifier — TypeScript declarations
 * @version 374.0.0
 */

export interface AuditEntry {
  index: number;
  ts: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface LedgerEntry {
  kind: 'CREDIT' | 'DEBIT';
  from?: string | null;
  to?: string | null;
  amount: string;
}

export interface AccountBalance {
  microcents?: string | number;
  balance?: string | number;
}

export interface ProofSnapshot {
  auditEntries?: AuditEntry[];
  ledgerEntries?: LedgerEntry[];
  accountBalances?: AccountBalance[];
}

export interface VerificationHooks {
  hashFn?: (s: string) => string;
  canonicalize?: (v: unknown) => string;
}

export interface VerificationChecks {
  proofHash?: boolean;
  chainRecomputed?: boolean;
  headMatchesCommitment?: boolean;
  conservation?: boolean;
  split?: boolean;
}

export interface VerificationResult {
  valid: boolean;
  version: string;
  checks: VerificationChecks;
  mismatches: string[];
}

/**
 * Verify a portable proof emitted by ECOS `GET /api/v1/proof/portable`.
 * Works for V372 and V373 proofs. No network, no trust, no npm deps.
 */
export function verifyPortableProof(
  proof: Record<string, unknown>,
  snapshot?: ProofSnapshot,
  hooks?: VerificationHooks
): VerificationResult;

/** Alias of verifyPortableProof (V373 original name). */
export function verifyPortableProof373(
  proof: Record<string, unknown>,
  snapshot?: ProofSnapshot,
  hooks?: VerificationHooks
): VerificationResult;

export declare const VERIFIER_SDK_VERSION_373: string;
export declare const ACCEPTED_SCHEMAS_373: readonly string[];
export declare const SDK_VERSION_374: string;

/** Internal SHA-256 hex helper — override via hooks.hashFn if needed. */
export function _sha256Hex373(s: string): string;
/** Internal canonical JSON serialiser — override via hooks.canonicalize if needed. */
export function _canon373(v: unknown): string;
