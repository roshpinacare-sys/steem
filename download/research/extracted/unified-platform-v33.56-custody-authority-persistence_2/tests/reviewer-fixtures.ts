import { sha256, signEnvelope, type KeyRegistry, type SignedEnvelope, type SigningIdentity } from '../src/contracts/crypto.js';
import {
  ReviewerTrustRegistry,
  type ReviewerCredential,
  type ReviewerRole,
  type SignedReviewerCredential,
} from '../src/security/reviewer-trust.js';
import type { CampaignResultAttestation, CampaignItemStatus } from '../src/product/engineering-campaign.js';

export interface ReviewerFixture {
  readonly signer: SigningIdentity;
  readonly organizationId: string;
  readonly role: ReviewerRole;
  readonly credential: SignedReviewerCredential;
  readonly credentialDigest: string;
}

export function registerReviewerFixture(input: {
  readonly registry: KeyRegistry;
  readonly trust: ReviewerTrustRegistry;
  readonly issuer: SigningIdentity;
  readonly signer: SigningIdentity;
  readonly organizationId: string;
  readonly now: Date;
  readonly tenantId?: string;
  readonly role?: ReviewerRole;
  readonly scope?: string;
  readonly revokedAt?: string;
}): ReviewerFixture {
  const role = input.role ?? 'INDEPENDENT_REVIEWER';
  const tenantId = input.tenantId ?? 'tenant-1';
  const scope = input.scope ?? 'campaign.review';
  const issuedAt = new Date(input.now.getTime() - 60_000).toISOString();
  const issuerGrantDigest = input.trust.issuerTrust.authorize({ issuerKeyId: input.issuer.keyId, credentialKind: 'REVIEWER', tenantIds: [tenantId], scopes: [scope], at: issuedAt }).grantDigest;
  const material: ReviewerCredential = {
    credentialId: `credential:${input.signer.keyId}:${input.organizationId}:${issuedAt}`,
    reviewerKeyId: input.signer.keyId,
    organizationId: input.organizationId,
    roles: [role],
    tenantIds: [tenantId],
    scopes: [scope],
    issuedAt,
    expiresAt: new Date(input.now.getTime() + 60_000).toISOString(),
    issuerId: input.issuer.keyId,
    issuerGrantDigest,
    ...(input.revokedAt === undefined ? {} : { revokedAt: input.revokedAt }),
  };
  const credential = signEnvelope(material, input.issuer);
  input.trust.register(credential);
  return {
    signer: input.signer,
    organizationId: input.organizationId,
    role,
    credential,
    credentialDigest: sha256(credential),
  };
}

export function reviewerAttestation(input: {
  readonly fixture: ReviewerFixture;
  readonly campaignId: string;
  readonly itemId: string;
  readonly status: Exclude<CampaignItemStatus, 'PENDING'>;
  readonly evidenceDigest: string;
  readonly reviewedAt: string;
}): SignedEnvelope<CampaignResultAttestation> {
  return signEnvelope({
    campaignId: input.campaignId,
    itemId: input.itemId,
    status: input.status,
    evidenceDigest: input.evidenceDigest,
    reviewerId: input.fixture.signer.keyId,
    reviewerRole: input.fixture.role,
    reviewerOrganizationId: input.fixture.organizationId,
    reviewerCredentialDigest: input.fixture.credentialDigest,
    reviewedAt: input.reviewedAt,
  }, input.fixture.signer);
}
