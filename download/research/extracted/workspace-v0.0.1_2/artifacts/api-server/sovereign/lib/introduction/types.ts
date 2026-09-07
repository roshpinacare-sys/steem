/**
 * lib/introduction/types.ts — Cross-tenant introduction types.
 *
 * Step 1: tenant-a requests to expose a proof bundle to tenant-b.
 * The request is signed by the kernel signer so tenant-b can verify provenance.
 */

export type ProofTargetKind = "track-record" | "passport";

export interface ProofTarget {
  kind: ProofTargetKind;
  identityId: string;
}

export interface IntroductionRequest {
  id: string;
  sourceTenantId: string;
  targetTenantId: string;
  proofTarget: ProofTarget;
  /** Signature over the canonical JSON of {id, sourceTenantId, targetTenantId, proofTarget, createdAt}. */
  signature: string;
  createdAt: string;
}

export interface IntroductionRequestInput {
  targetTenantId: string;
  proofTarget: ProofTarget;
}
