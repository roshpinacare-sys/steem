import { KeyRegistry, sha256, type SignedEnvelope } from '../contracts/crypto.js';
import type { AuthorizedProvider, ProviderAuthorizer } from '../contracts/provider.js';
import { CredentialIssuerTrustRegistry } from './credential-issuer-trust.js';

export interface ProviderCredential {
  readonly credentialId: string;
  readonly providerId: string;
  readonly providerKeyId: string;
  readonly allowedModels: readonly string[];
  readonly tenantIds: readonly string[];
  readonly scopes: readonly ['model.invoke'];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly issuerId: string;
  readonly issuerGrantDigest: string;
  readonly revokedAt?: string;
}
export type SignedProviderCredential = SignedEnvelope<ProviderCredential>;

export interface ProviderCredentialRevocation {
  readonly revocationId: string;
  readonly providerId: string;
  readonly credentialDigest: string;
  readonly reason: string;
  readonly revokedAt: string;
  readonly issuerId: string;
}
export type SignedProviderCredentialRevocation = SignedEnvelope<ProviderCredentialRevocation>;

export class ProviderTrustRegistry implements ProviderAuthorizer {
  readonly #credentialsById = new Map<string, SignedProviderCredential>();
  readonly #credentialsByDigest = new Map<string, SignedProviderCredential>();
  readonly #credentialDigestsByProvider = new Map<string, Set<string>>();
  readonly #revocationsById = new Map<string, SignedProviderCredentialRevocation>();
  readonly #revocationsByCredentialDigest = new Map<string, SignedProviderCredentialRevocation>();
  readonly #acceptedAtByCredentialDigest = new Map<string, string>();

  constructor(
    readonly keyRegistry: KeyRegistry,
    readonly issuerTrust: CredentialIssuerTrustRegistry,
    readonly clock: () => Date = () => new Date(),
  ) {}

  register(credential: SignedProviderCredential): void {
    const payload = credential.payload;
    if (payload.issuerId === payload.providerKeyId) throw new Error('provider_credential_self_issuance_forbidden');
    const acceptedAt = this.clock();
    if (!Number.isFinite(acceptedAt.getTime())) throw new Error('provider_credential_acceptance_time_invalid');
    validateProviderCredential(credential, this.keyRegistry, this.issuerTrust, acceptedAt.toISOString());
    const prior = this.#credentialsById.get(payload.credentialId);
    if (prior !== undefined && sha256(prior) !== sha256(credential)) throw new Error('provider_credential_conflict');
    const digest = sha256(credential);
    this.#credentialsById.set(payload.credentialId, structuredClone(credential));
    this.#credentialsByDigest.set(digest, structuredClone(credential));
    const priorAcceptedAt = this.#acceptedAtByCredentialDigest.get(digest);
    if (priorAcceptedAt !== undefined && priorAcceptedAt !== acceptedAt.toISOString()) throw new Error('provider_credential_acceptance_conflict');
    this.#acceptedAtByCredentialDigest.set(digest, acceptedAt.toISOString());
    const digests = this.#credentialDigestsByProvider.get(payload.providerId) ?? new Set<string>();
    digests.add(digest);
    this.#credentialDigestsByProvider.set(payload.providerId, digests);
  }

  registerRevocation(revocation: SignedProviderCredentialRevocation): void {
    const payload = revocation.payload;
    for (const value of [payload.revocationId, payload.providerId, payload.credentialDigest, payload.reason, payload.issuerId]) if (value.trim() === '') throw new Error('provider_revocation_identity_invalid');
    if (payload.issuerId !== revocation.issuerKeyId) throw new Error('provider_revocation_issuer_mismatch');
    const credential = this.#credentialsByDigest.get(payload.credentialDigest);
    if (credential === undefined) {
      if (this.#credentialDigestsByProvider.has(payload.providerId)) throw new Error('provider_revocation_credential_binding_invalid');
      throw new Error('provider_revocation_credential_not_found');
    }
    if (credential.payload.providerId !== payload.providerId) throw new Error('provider_revocation_credential_binding_invalid');
    if (credential.issuerKeyId !== payload.issuerId) throw new Error('provider_revocation_issuer_not_authorized');
    if (sha256(credential) !== payload.credentialDigest) throw new Error('provider_revocation_credential_binding_invalid');
    const revokedAt = Date.parse(payload.revokedAt);
    if (!Number.isFinite(revokedAt) || revokedAt < Date.parse(credential.payload.issuedAt)) throw new Error('provider_revocation_time_invalid');
    if (!this.keyRegistry.verifyAt(revocation, payload.revokedAt) || !this.keyRegistry.verifyAt(revocation, this.clock())) throw new Error('provider_revocation_signature_invalid');
    const priorById = this.#revocationsById.get(payload.revocationId);
    if (priorById !== undefined && sha256(priorById) !== sha256(revocation)) throw new Error('provider_revocation_conflict');
    const priorByCredential = this.#revocationsByCredentialDigest.get(payload.credentialDigest);
    if (priorByCredential !== undefined && sha256(priorByCredential) !== sha256(revocation)) throw new Error('provider_revocation_conflict');
    this.#revocationsById.set(payload.revocationId, structuredClone(revocation));
    this.#revocationsByCredentialDigest.set(payload.credentialDigest, structuredClone(revocation));
  }

  listCredentialRecords(): readonly { readonly credential: SignedProviderCredential; readonly acceptedAt: string }[] {
    return [...this.#credentialsByDigest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([digest, credential]) => ({ credential: structuredClone(credential), acceptedAt: this.#acceptedAtByCredentialDigest.get(digest)! }));
  }

  listRevocations(): readonly SignedProviderCredentialRevocation[] {
    return [...this.#revocationsByCredentialDigest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, revocation]) => structuredClone(revocation));
  }

  authorize(input: { readonly providerId: string; readonly providerKeyId: string; readonly model: string; readonly tenantId: string; readonly at: string }): AuthorizedProvider {
    const at = Date.parse(input.at);
    if (!Number.isFinite(at)) throw new Error('provider_time_invalid');
    const digests = this.#credentialDigestsByProvider.get(input.providerId);
    if (digests === undefined) throw new Error('provider_not_credentialed');
    const candidates = [...digests]
      .map((digest) => ({ digest, credential: this.#credentialsByDigest.get(digest)!, acceptedAt: this.#acceptedAtByCredentialDigest.get(digest)! }))
      .filter(({ digest, credential, acceptedAt }) => {
        validateProviderCredential(credential, this.keyRegistry, this.issuerTrust, acceptedAt);
        const payload = credential.payload;
        const revocation = this.#revocationsByCredentialDigest.get(digest);
        if (revocation !== undefined && at >= Date.parse(revocation.payload.revokedAt)) return false;
        return payload.providerKeyId === input.providerKeyId
          && at >= Date.parse(payload.issuedAt)
          && at < Date.parse(payload.expiresAt)
          && payload.revokedAt === undefined
          && payload.allowedModels.includes(input.model)
          && payload.tenantIds.includes(input.tenantId)
          && payload.scopes.includes('model.invoke');
      })
      .sort((a, b) => Date.parse(b.credential.payload.issuedAt) - Date.parse(a.credential.payload.issuedAt) || a.digest.localeCompare(b.digest));
    const selected = candidates[0];
    if (selected === undefined) {
      const matchingKeyAndPolicy = [...digests].map((digest) => ({ digest, credential: this.#credentialsByDigest.get(digest)! })).filter(({ credential }) => {
        const payload = credential.payload;
        return payload.providerKeyId === input.providerKeyId && payload.allowedModels.includes(input.model) && payload.tenantIds.includes(input.tenantId);
      });
      if (matchingKeyAndPolicy.some(({ digest }) => { const revocation = this.#revocationsByCredentialDigest.get(digest); return revocation !== undefined && at >= Date.parse(revocation.payload.revokedAt); })) throw new Error('provider_credential_revoked');
      if (matchingKeyAndPolicy.length > 0) throw new Error('provider_credential_inactive');
      const activeForProvider = [...digests].filter((digest) => {
        const credential = this.#credentialsByDigest.get(digest)!;
        const payload = credential.payload;
        const revocation = this.#revocationsByCredentialDigest.get(digest);
        return at >= Date.parse(payload.issuedAt) && at < Date.parse(payload.expiresAt) && payload.revokedAt === undefined && !(revocation !== undefined && at >= Date.parse(revocation.payload.revokedAt));
      });
      if (activeForProvider.length === 0) throw new Error('provider_credential_inactive');
      if (!activeForProvider.some((digest) => this.#credentialsByDigest.get(digest)!.payload.providerKeyId === input.providerKeyId)) throw new Error('provider_key_binding_invalid');
      throw new Error('provider_not_authorized');
    }
    return { credentialDigest: selected.digest };
  }
}

function validateProviderCredential(credential: SignedProviderCredential, keyRegistry: KeyRegistry, issuerTrust: CredentialIssuerTrustRegistry, acceptedAt?: string): void {
  const payload = credential.payload;
  if (payload.issuerId !== credential.issuerKeyId) throw new Error('provider_credential_issuer_mismatch');
  for (const value of [payload.credentialId, payload.providerId, payload.providerKeyId, payload.issuerId, payload.issuerGrantDigest]) if (value.trim() === '') throw new Error('provider_credential_identity_invalid');
  if (keyRegistry.fingerprint(payload.providerKeyId) === undefined) throw new Error('provider_key_not_registered');
  if (payload.allowedModels.length === 0 || payload.tenantIds.length === 0 || payload.scopes.length !== 1 || payload.scopes[0] !== 'model.invoke') throw new Error('provider_credential_scope_invalid');
  if (new Set(payload.allowedModels).size !== payload.allowedModels.length || new Set(payload.tenantIds).size !== payload.tenantIds.length || [...payload.allowedModels, ...payload.tenantIds].some((value) => value.trim() === '')) throw new Error('provider_credential_scope_invalid');
  const issuedAt = Date.parse(payload.issuedAt); const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) throw new Error('provider_credential_time_invalid');
  if (payload.revokedAt !== undefined && (!Number.isFinite(Date.parse(payload.revokedAt)) || Date.parse(payload.revokedAt) < issuedAt)) throw new Error('provider_credential_revocation_invalid');
  if (!keyRegistry.verifyAt(credential, payload.issuedAt) || (acceptedAt !== undefined && !keyRegistry.verifyAt(credential, acceptedAt))) throw new Error('provider_credential_signature_invalid');
  try { issuerTrust.authorizeGrantDigest({ grantDigest: payload.issuerGrantDigest, issuerKeyId: payload.issuerId, credentialKind: 'PROVIDER', tenantIds: payload.tenantIds, scopes: payload.scopes, at: payload.issuedAt }); }
  catch (error) { throw new Error(`provider_credential_issuer_grant_binding_invalid:${String(error)}`); }
  if (acceptedAt !== undefined) {
    try { issuerTrust.authorizeGrantDigest({ grantDigest: payload.issuerGrantDigest, issuerKeyId: payload.issuerId, credentialKind: 'PROVIDER', tenantIds: payload.tenantIds, scopes: payload.scopes, at: acceptedAt }); }
    catch (error) { throw new Error(`provider_credential_issuer_acceptance_invalid:${String(error)}`); }
  }
}
