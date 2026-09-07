import { KeyRegistry, sha256, type SignedEnvelope } from '../contracts/crypto.js';
import { REVIEWER_ROLES, type AuthorizedReviewer, type ReviewerAuthorizer, type ReviewerRole } from '../contracts/reviewer.js';
import { CredentialIssuerTrustRegistry } from './credential-issuer-trust.js';
export { REVIEWER_ROLES, type AuthorizedReviewer, type ReviewerAuthorizer, type ReviewerRole } from '../contracts/reviewer.js';

export interface ReviewerCredential {
  readonly credentialId: string;
  readonly reviewerKeyId: string;
  readonly organizationId: string;
  readonly roles: readonly ReviewerRole[];
  readonly tenantIds: readonly string[];
  readonly scopes: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly issuerId: string;
  readonly issuerGrantDigest: string;
  readonly revokedAt?: string;
}

export type SignedReviewerCredential = SignedEnvelope<ReviewerCredential>;

export interface ReviewerCredentialRevocation {
  readonly revocationId: string;
  readonly reviewerKeyId: string;
  readonly credentialDigest: string;
  readonly reason: string;
  readonly revokedAt: string;
  readonly issuerId: string;
}
export type SignedReviewerCredentialRevocation = SignedEnvelope<ReviewerCredentialRevocation>;

export class ReviewerTrustRegistry implements ReviewerAuthorizer {
  readonly #credentialsById = new Map<string, SignedReviewerCredential>();
  readonly #credentialsByDigest = new Map<string, SignedReviewerCredential>();
  readonly #credentialDigestsByReviewer = new Map<string, Set<string>>();
  readonly #revocationsById = new Map<string, SignedReviewerCredentialRevocation>();
  readonly #revocationsByCredentialDigest = new Map<string, SignedReviewerCredentialRevocation>();
  readonly #acceptedAtByCredentialDigest = new Map<string, string>();

  constructor(
    readonly keyRegistry: KeyRegistry,
    readonly issuerTrust: CredentialIssuerTrustRegistry,
    readonly clock: () => Date = () => new Date(),
  ) {}

  register(credential: SignedReviewerCredential): void {
    const payload = credential.payload;
    if (payload.issuerId === payload.reviewerKeyId) throw new Error('reviewer_credential_self_issuance_forbidden');
    const acceptedAt = this.clock();
    if (!Number.isFinite(acceptedAt.getTime())) throw new Error('reviewer_credential_acceptance_time_invalid');
    validateCredential(credential, this.keyRegistry, this.issuerTrust, acceptedAt.toISOString());
    const prior = this.#credentialsById.get(payload.credentialId);
    if (prior !== undefined && sha256(prior) !== sha256(credential)) throw new Error('reviewer_credential_conflict');
    const digest = sha256(credential);
    this.#credentialsById.set(payload.credentialId, structuredClone(credential));
    this.#credentialsByDigest.set(digest, structuredClone(credential));
    const priorAcceptedAt = this.#acceptedAtByCredentialDigest.get(digest);
    if (priorAcceptedAt !== undefined && priorAcceptedAt !== acceptedAt.toISOString()) throw new Error('reviewer_credential_acceptance_conflict');
    this.#acceptedAtByCredentialDigest.set(digest, acceptedAt.toISOString());
    const digests = this.#credentialDigestsByReviewer.get(payload.reviewerKeyId) ?? new Set<string>();
    digests.add(digest);
    this.#credentialDigestsByReviewer.set(payload.reviewerKeyId, digests);
  }

  registerRevocation(revocation: SignedReviewerCredentialRevocation): void {
    const payload = revocation.payload;
    for (const value of [payload.revocationId, payload.reviewerKeyId, payload.credentialDigest, payload.reason, payload.issuerId]) if (value.trim() === '') throw new Error('reviewer_revocation_identity_invalid');
    if (payload.issuerId !== revocation.issuerKeyId) throw new Error('reviewer_revocation_issuer_mismatch');
    const credential = this.#credentialsByDigest.get(payload.credentialDigest);
    if (credential === undefined) {
      if (this.#credentialDigestsByReviewer.has(payload.reviewerKeyId)) throw new Error('reviewer_revocation_credential_binding_invalid');
      throw new Error('reviewer_revocation_credential_not_found');
    }
    if (credential.payload.reviewerKeyId !== payload.reviewerKeyId) throw new Error('reviewer_revocation_credential_binding_invalid');
    if (credential.issuerKeyId !== payload.issuerId) throw new Error('reviewer_revocation_issuer_not_authorized');
    if (sha256(credential) !== payload.credentialDigest) throw new Error('reviewer_revocation_credential_binding_invalid');
    const revokedAt = Date.parse(payload.revokedAt);
    if (!Number.isFinite(revokedAt) || revokedAt < Date.parse(credential.payload.issuedAt)) throw new Error('reviewer_revocation_time_invalid');
    if (!this.keyRegistry.verifyAt(revocation, payload.revokedAt) || !this.keyRegistry.verifyAt(revocation, this.clock())) throw new Error('reviewer_revocation_signature_invalid');
    const priorById = this.#revocationsById.get(payload.revocationId);
    if (priorById !== undefined && sha256(priorById) !== sha256(revocation)) throw new Error('reviewer_revocation_conflict');
    const priorByCredential = this.#revocationsByCredentialDigest.get(payload.credentialDigest);
    if (priorByCredential !== undefined && sha256(priorByCredential) !== sha256(revocation)) throw new Error('reviewer_revocation_conflict');
    this.#revocationsById.set(payload.revocationId, structuredClone(revocation));
    this.#revocationsByCredentialDigest.set(payload.credentialDigest, structuredClone(revocation));
  }

  listCredentialRecords(): readonly { readonly credential: SignedReviewerCredential; readonly acceptedAt: string }[] {
    return [...this.#credentialsByDigest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([digest, credential]) => ({ credential: structuredClone(credential), acceptedAt: this.#acceptedAtByCredentialDigest.get(digest)! }));
  }

  listRevocations(): readonly SignedReviewerCredentialRevocation[] {
    return [...this.#revocationsByCredentialDigest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, revocation]) => structuredClone(revocation));
  }

  authorize(input: { readonly reviewerKeyId: string; readonly tenantId: string; readonly scope: string; readonly role: ReviewerRole; readonly at: string }): AuthorizedReviewer {
    const at = Date.parse(input.at);
    if (!Number.isFinite(at)) throw new Error('reviewer_time_invalid');
    const digests = this.#credentialDigestsByReviewer.get(input.reviewerKeyId);
    if (digests === undefined) throw new Error('reviewer_not_credentialed');
    const candidates = [...digests]
      .map((digest) => ({ digest, credential: this.#credentialsByDigest.get(digest)!, acceptedAt: this.#acceptedAtByCredentialDigest.get(digest)! }))
      .filter(({ digest, credential, acceptedAt }) => {
        validateCredential(credential, this.keyRegistry, this.issuerTrust, acceptedAt);
        const payload = credential.payload;
        const revocation = this.#revocationsByCredentialDigest.get(digest);
        if (revocation !== undefined && at >= Date.parse(revocation.payload.revokedAt)) return false;
        return at >= Date.parse(payload.issuedAt)
          && at < Date.parse(payload.expiresAt)
          && payload.revokedAt === undefined
          && payload.tenantIds.includes(input.tenantId)
          && payload.scopes.includes(input.scope)
          && payload.roles.includes(input.role);
      })
      .sort((a, b) => Date.parse(b.credential.payload.issuedAt) - Date.parse(a.credential.payload.issuedAt) || a.digest.localeCompare(b.digest));
    const selected = candidates[0];
    if (selected === undefined) {
      const matchingPolicy = [...digests].map((digest) => ({ digest, credential: this.#credentialsByDigest.get(digest)! })).filter(({ credential }) => {
        const payload = credential.payload;
        return payload.tenantIds.includes(input.tenantId) && payload.scopes.includes(input.scope) && payload.roles.includes(input.role);
      });
      if (matchingPolicy.some(({ digest }) => { const revocation = this.#revocationsByCredentialDigest.get(digest); return revocation !== undefined && at >= Date.parse(revocation.payload.revokedAt); })) throw new Error('reviewer_credential_revoked');
      if (matchingPolicy.length > 0) throw new Error('reviewer_credential_inactive');
      const anyActive = [...digests].some((digest) => {
        const credential = this.#credentialsByDigest.get(digest)!;
        const payload = credential.payload;
        const revocation = this.#revocationsByCredentialDigest.get(digest);
        return at >= Date.parse(payload.issuedAt) && at < Date.parse(payload.expiresAt) && payload.revokedAt === undefined && !(revocation !== undefined && at >= Date.parse(revocation.payload.revokedAt));
      });
      if (anyActive) throw new Error('reviewer_not_authorized');
      throw new Error('reviewer_credential_inactive');
    }
    const payload = selected.credential.payload;
    return { reviewerKeyId: payload.reviewerKeyId, organizationId: payload.organizationId, role: input.role, credentialDigest: selected.digest };
  }
}

function validateCredential(credential: SignedReviewerCredential, keyRegistry: KeyRegistry, issuerTrust: CredentialIssuerTrustRegistry, acceptedAt?: string): void {
  const payload = credential.payload;
  if (payload.issuerId !== credential.issuerKeyId) throw new Error('reviewer_credential_issuer_mismatch');
  for (const value of [payload.credentialId, payload.reviewerKeyId, payload.organizationId, payload.issuerId, payload.issuerGrantDigest]) if (value.trim() === '') throw new Error('reviewer_credential_identity_invalid');
  if (keyRegistry.fingerprint(payload.reviewerKeyId) === undefined) throw new Error('reviewer_key_not_registered');
  if (payload.roles.length === 0 || new Set(payload.roles).size !== payload.roles.length || payload.roles.some((role) => !REVIEWER_ROLES.includes(role))) throw new Error('reviewer_roles_invalid');
  if (payload.tenantIds.length === 0 || payload.scopes.length === 0 || new Set(payload.tenantIds).size !== payload.tenantIds.length || new Set(payload.scopes).size !== payload.scopes.length || [...payload.tenantIds, ...payload.scopes].some((value) => value.trim() === '')) throw new Error('reviewer_scope_invalid');
  const issuedAt = Date.parse(payload.issuedAt); const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) throw new Error('reviewer_credential_time_invalid');
  if (payload.revokedAt !== undefined && (!Number.isFinite(Date.parse(payload.revokedAt)) || Date.parse(payload.revokedAt) < issuedAt)) throw new Error('reviewer_credential_revocation_invalid');
  if (!keyRegistry.verifyAt(credential, payload.issuedAt) || (acceptedAt !== undefined && !keyRegistry.verifyAt(credential, acceptedAt))) throw new Error('reviewer_credential_signature_invalid');
  try { issuerTrust.authorizeGrantDigest({ grantDigest: payload.issuerGrantDigest, issuerKeyId: payload.issuerId, credentialKind: 'REVIEWER', tenantIds: payload.tenantIds, scopes: payload.scopes, at: payload.issuedAt }); }
  catch (error) { throw new Error(`reviewer_credential_issuer_grant_binding_invalid:${String(error)}`); }
  if (acceptedAt !== undefined) {
    try { issuerTrust.authorizeGrantDigest({ grantDigest: payload.issuerGrantDigest, issuerKeyId: payload.issuerId, credentialKind: 'REVIEWER', tenantIds: payload.tenantIds, scopes: payload.scopes, at: acceptedAt }); }
    catch (error) { throw new Error(`reviewer_credential_issuer_acceptance_invalid:${String(error)}`); }
  }
}
