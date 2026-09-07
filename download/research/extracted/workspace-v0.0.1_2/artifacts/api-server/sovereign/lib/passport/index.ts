/**
 * lib/passport/index.ts — barrel export for the Action Passport subsystem.
 */

export { issuePassport, computePassportHash, canonicalStringify, resolveProvenance } from "./passport.ts";
export type { IssuePassportOptions } from "./passport.ts";
export { PassportError, ClaimError } from "./types.ts";
export type {
  ActionPassport,
  PassportAudit,
  PassportLedgerEffect,
  PassportPolicyDecision,
  PassportVersion,
  PassportErrorCode,
  WorkerAttestation,
  ClaimErrorCode,
  RiskEvidence,
} from "./types.ts";

export {
  buildPassportClaim,
  computeClaimHash,
  canonicalPassportClaim,
  normalizeRevocationStatus,
  revokeClaim,
  isClaimRevoked,
  clearRevocations,
  REVOCATION_STATUSES,
} from "./claim.ts";
export type { PassportClaim, RevocationStatus, BuildClaimOptions } from "./claim.ts";

export { verifyPassportClaim } from "./claim-verifier.ts";
export type { ClaimVerifyResult, ClaimVerifyKeys, ClaimVerifyOpts, ClaimCheck } from "./claim-verifier.ts";

export { verifyActionPassport } from "./passport-verifier.ts";
export type { PassportVerifyResult, PassportVerifyKeys, PassportVerifyOpts, PassportCheck } from "./passport-verifier.ts";

export { KeyRing, KeyRingError, computeKid } from "./key-ring.ts";
export type { KeyRingEntry, KeyAlgorithm, KeyStatus } from "./key-ring.ts";

export { PassportRevocationList, PassportRevocationError } from "./passport-revocation-list.ts";
export type { RevocationEntry } from "./passport-revocation-list.ts";
