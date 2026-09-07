import type { KeyRegistry, ExportedPublicKeyRecord, SignedEnvelope } from '../contracts/crypto.js';
import type { CredentialIssuerTrustRegistry, SignedCredentialIssuerGrant, SignedCredentialIssuerGrantRevocation } from '../security/credential-issuer-trust.js';
import type { ReviewerTrustRegistry, SignedReviewerCredential, SignedReviewerCredentialRevocation } from '../security/reviewer-trust.js';
import type { ProviderTrustRegistry, SignedProviderCredential, SignedProviderCredentialRevocation } from '../security/provider-trust.js';

export interface CredentialTrustRootPolicy {
  readonly trustedRootKeyIds: readonly string[];
  readonly custodianIdsByRootKeyId: Readonly<Record<string, string>>;
  readonly threshold: number;
}
export interface AcceptedReviewerCredentialRecord { readonly credential: SignedReviewerCredential; readonly acceptedAt: string; }
export interface AcceptedProviderCredentialRecord { readonly credential: SignedProviderCredential; readonly acceptedAt: string; }
export interface CredentialTrustBundlePayload {
  readonly version: 1;
  readonly bundleId: string;
  readonly generatedAt: string;
  readonly predecessorBundleDigest?: string;
  readonly rootPolicy: CredentialTrustRootPolicy;
  readonly publicKeys: readonly ExportedPublicKeyRecord[];
  readonly issuerGrants: readonly SignedCredentialIssuerGrant[];
  readonly issuerGrantRevocations: readonly SignedCredentialIssuerGrantRevocation[];
  readonly reviewerCredentials: readonly AcceptedReviewerCredentialRecord[];
  readonly reviewerCredentialRevocations: readonly SignedReviewerCredentialRevocation[];
  readonly providerCredentials: readonly AcceptedProviderCredentialRecord[];
  readonly providerCredentialRevocations: readonly SignedProviderCredentialRevocation[];
  readonly limitations: readonly string[];
}
export interface CredentialTrustBundleSignaturePayload {
  readonly bundleId: string;
  readonly payloadDigest: string;
  readonly generatedAt: string;
  readonly predecessorBundleDigest?: string;
}
export interface CredentialTrustBundle { readonly payload: CredentialTrustBundlePayload; readonly rootSignatures: readonly SignedEnvelope<CredentialTrustBundleSignaturePayload>[]; }
export interface PinnedCredentialTrustRoots { readonly fingerprints: ReadonlyMap<string, string>; readonly custodianIds: ReadonlyMap<string, string>; readonly threshold: number; }
export interface ImportedCredentialTrustBundle {
  readonly keyRegistry: KeyRegistry;
  readonly issuerTrust: CredentialIssuerTrustRegistry;
  readonly reviewerTrust: ReviewerTrustRegistry;
  readonly providerTrust: ProviderTrustRegistry;
  readonly bundleDigest: string;
  readonly payloadDigest: string;
}
export interface CredentialTrustAnchorRecord {
  readonly sequence: number;
  readonly bundleDigest: string;
  readonly bundleId: string;
  readonly generatedAt: string;
  readonly predecessorBundleDigest?: string;
  readonly previousAnchorDigest: string | null;
  readonly anchorDigest: string;
}
export interface CredentialTrustAnchor {
  current(): CredentialTrustAnchorRecord | undefined;
  assertCurrent(bundleDigest: string | undefined): void;
  advance(input: { readonly bundleDigest: string; readonly bundleId: string; readonly generatedAt: string; readonly predecessorBundleDigest?: string }): CredentialTrustAnchorRecord;
}
