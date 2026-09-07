/** lib/track-record — Verified Track Record read-model (trust price discovery, step 1). */
export { computeTrackRecord, type TrackRecord, type ChainReader, type EscrowReader, type AccountOwnerResolver, type TrackRecordOptions } from "./track-record.ts";
export {
  type TrackRecordCache,
  InMemoryTrackRecordCache,
  getCachedOrCompute,
} from "./track-record-cache.ts";
export { PgTrackRecordCache } from "./pg-track-record-cache.ts";

export { buildTrustProofBundle, verifyBundleHash, type TrustProofBundle, type ProofPassportEntry } from "./proof-bundle.ts";
export {
  buildTrustProofBundleV2,
  verifyProofBundleV2,
  PROOF_BUNDLE_DEFAULT_VALID_MS,
  type TrustProofBundleV2,
  type ProofBundleSignerKey,
  type ProofBundleEvidenceItem,
  type ProofBundleApprovalRef,
  type ProofBundleLedgerRef,
  type ProofBundlePolicyRef,
  type BuildTrustProofBundleV2Input,
  type ProofBundleVerifyOptions,
} from "./proof-bundle-v2.ts";

export {
  buildCountProof,
  verifyCountProof,
  countProofSigningPayload,
  COUNT_PROOF_VERSION,
  CountProofError,
  type CountProof,
  type CountProofWitness,
  type CountProofPayloadFields,
  type BuildCountProofInput,
  type CountProofErrorCode,
} from "./count-proof.ts";

export {
  buildPredicateProof,
  verifyPredicateProof,
  predicateProofSigningPayload,
  PREDICATE_PROOF_VERSION,
  PredicateProofError,
  type PredicateProof,
  type PredicateProofWitness,
  type PredicateProofPayloadFields,
  type BuildPredicateProofInput,
  type PredicateProofErrorCode,
} from "./predicate-proof.ts";

export {
  buildRedactedProofBundle,
  verifyRedactedProofBundle,
  type RedactedTrustProofBundle,
  type RedactedArrayDigest,
  type RedactedBundleVerifyOptions,
} from "./redacted-proof-bundle.ts";

export {
  BILLING_DISPUTE_PROOF_VERSION,
  buildBillingDisputeProof,
  verifyBillingDisputeProof,
  billingDisputeProofSigningPayload,
  classifyDiscrepancy,
  BillingDisputeProofError,
  type BillingDisputeProof,
  type BillingDisputeProofPayloadFields,
  type BuildBillingDisputeProofInput,
  type BillingDiscrepancyType,
} from "./billing-dispute-proof.ts";
