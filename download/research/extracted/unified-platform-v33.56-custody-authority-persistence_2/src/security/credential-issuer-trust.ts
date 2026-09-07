import { KeyRegistry, sha256, type SignedEnvelope } from '../contracts/crypto.js';

export const CREDENTIAL_KINDS = ['REVIEWER', 'PROVIDER'] as const;
export type CredentialKind = typeof CREDENTIAL_KINDS[number];

export interface CredentialIssuerGrant {
  readonly grantId: string;
  readonly issuerKeyId: string;
  readonly credentialKinds: readonly CredentialKind[];
  readonly tenantIds: readonly string[];
  readonly scopes: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly rootAuthorityId: string;
}
export type SignedCredentialIssuerGrant = SignedEnvelope<CredentialIssuerGrant>;

export interface CredentialIssuerGrantRevocation {
  readonly revocationId: string;
  readonly grantDigest: string;
  readonly reason: string;
  readonly revokedAt: string;
  readonly rootAuthorityId: string;
}
export type SignedCredentialIssuerGrantRevocation = SignedEnvelope<CredentialIssuerGrantRevocation>;

export interface CredentialIssuerAuthorization {
  readonly issuerKeyId: string;
  readonly grantDigest: string;
  readonly rootAuthorityId: string;
}

export class CredentialIssuerTrustRegistry {
  readonly #grantsById = new Map<string, SignedCredentialIssuerGrant>();
  readonly #grantDigestsByIssuer = new Map<string, Set<string>>();
  readonly #grantsByDigest = new Map<string, SignedCredentialIssuerGrant>();
  readonly #revocationsByGrantDigest = new Map<string, SignedCredentialIssuerGrantRevocation>();
  readonly #revocationsById = new Map<string, SignedCredentialIssuerGrantRevocation>();

  constructor(
    readonly keyRegistry: KeyRegistry,
    readonly trustedRootKeyIds: ReadonlySet<string>,
  ) {
    if (trustedRootKeyIds.size === 0) throw new Error('credential_issuer_root_required');
    for (const rootKeyId of trustedRootKeyIds) {
      if (rootKeyId.trim() === '') throw new Error('credential_issuer_root_invalid');
      if (keyRegistry.fingerprint(rootKeyId) === undefined) throw new Error('credential_issuer_root_not_registered');
    }
  }

  registerGrant(grant: SignedCredentialIssuerGrant): void {
    if (!this.keyRegistry.verify(grant)) throw new Error('credential_issuer_grant_signature_invalid');
    const payload = grant.payload;
    if (!this.trustedRootKeyIds.has(grant.issuerKeyId) || payload.rootAuthorityId !== grant.issuerKeyId) throw new Error('credential_issuer_root_not_authorized');
    validateGrantPayload(payload, this.keyRegistry);
    const prior = this.#grantsById.get(payload.grantId);
    if (prior !== undefined && sha256(prior) !== sha256(grant)) throw new Error('credential_issuer_grant_conflict');
    const digest = sha256(grant);
    this.#grantsById.set(payload.grantId, structuredClone(grant));
    this.#grantsByDigest.set(digest, structuredClone(grant));
    const issuerGrants = this.#grantDigestsByIssuer.get(payload.issuerKeyId) ?? new Set<string>();
    issuerGrants.add(digest);
    this.#grantDigestsByIssuer.set(payload.issuerKeyId, issuerGrants);
  }

  registerRevocation(revocation: SignedCredentialIssuerGrantRevocation): void {
    if (!this.keyRegistry.verify(revocation)) throw new Error('credential_issuer_revocation_signature_invalid');
    const payload = revocation.payload;
    for (const value of [payload.revocationId, payload.grantDigest, payload.reason, payload.rootAuthorityId]) {
      if (value.trim() === '') throw new Error('credential_issuer_revocation_identity_invalid');
    }
    if (!this.trustedRootKeyIds.has(revocation.issuerKeyId) || payload.rootAuthorityId !== revocation.issuerKeyId) throw new Error('credential_issuer_revocation_root_not_authorized');
    const grant = this.#grantsByDigest.get(payload.grantDigest);
    if (grant === undefined) throw new Error('credential_issuer_revocation_grant_not_found');
    if (grant.issuerKeyId !== payload.rootAuthorityId) throw new Error('credential_issuer_revocation_wrong_root');
    const revokedAt = Date.parse(payload.revokedAt);
    if (!Number.isFinite(revokedAt) || revokedAt < Date.parse(grant.payload.issuedAt)) throw new Error('credential_issuer_revocation_time_invalid');
    const byId = this.#revocationsById.get(payload.revocationId);
    if (byId !== undefined && sha256(byId) !== sha256(revocation)) throw new Error('credential_issuer_revocation_conflict');
    const byGrant = this.#revocationsByGrantDigest.get(payload.grantDigest);
    if (byGrant !== undefined && sha256(byGrant) !== sha256(revocation)) throw new Error('credential_issuer_revocation_conflict');
    this.#revocationsById.set(payload.revocationId, structuredClone(revocation));
    this.#revocationsByGrantDigest.set(payload.grantDigest, structuredClone(revocation));
  }


  listGrants(): readonly SignedCredentialIssuerGrant[] {
    return [...this.#grantsByDigest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, grant]) => structuredClone(grant));
  }

  listRevocations(): readonly SignedCredentialIssuerGrantRevocation[] {
    return [...this.#revocationsByGrantDigest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, revocation]) => structuredClone(revocation));
  }

  authorizeGrantDigest(input: {
    readonly grantDigest: string;
    readonly issuerKeyId: string;
    readonly credentialKind: CredentialKind;
    readonly tenantIds: readonly string[];
    readonly scopes: readonly string[];
    readonly at: string;
  }): CredentialIssuerAuthorization {
    const at = Date.parse(input.at);
    if (!Number.isFinite(at)) throw new Error('credential_issuer_time_invalid');
    const grant = this.#grantsByDigest.get(input.grantDigest);
    if (grant === undefined || grant.payload.issuerKeyId !== input.issuerKeyId || !this.keyRegistry.verify(grant)) throw new Error('credential_issuer_grant_binding_invalid');
    const payload = grant.payload;
    const revocation = this.#revocationsByGrantDigest.get(input.grantDigest);
    if (revocation !== undefined && at >= Date.parse(revocation.payload.revokedAt)) throw new Error('credential_issuer_grant_revoked');
    if (at < Date.parse(payload.issuedAt) || at >= Date.parse(payload.expiresAt)) throw new Error('credential_issuer_grant_inactive');
    if (!payload.credentialKinds.includes(input.credentialKind) || !input.tenantIds.every((tenantId) => payload.tenantIds.includes(tenantId)) || !input.scopes.every((scope) => payload.scopes.includes(scope))) throw new Error('credential_issuer_not_authorized');
    return { issuerKeyId: input.issuerKeyId, grantDigest: input.grantDigest, rootAuthorityId: payload.rootAuthorityId };
  }
  authorize(input: {
    readonly issuerKeyId: string;
    readonly credentialKind: CredentialKind;
    readonly tenantIds: readonly string[];
    readonly scopes: readonly string[];
    readonly at: string;
  }): CredentialIssuerAuthorization {
    const at = Date.parse(input.at);
    if (!Number.isFinite(at)) throw new Error('credential_issuer_time_invalid');
    const digests = this.#grantDigestsByIssuer.get(input.issuerKeyId);
    if (digests === undefined) throw new Error('credential_issuer_not_authorized');
    const candidates = [...digests]
      .map((digest) => ({ digest, grant: this.#grantsByDigest.get(digest)! }))
      .filter(({ digest, grant }) => {
        if (!this.keyRegistry.verify(grant)) return false;
        const payload = grant.payload;
        const revocation = this.#revocationsByGrantDigest.get(digest);
        if (revocation !== undefined && at >= Date.parse(revocation.payload.revokedAt)) return false;
        return at >= Date.parse(payload.issuedAt)
          && at < Date.parse(payload.expiresAt)
          && payload.credentialKinds.includes(input.credentialKind)
          && input.tenantIds.every((tenantId) => payload.tenantIds.includes(tenantId))
          && input.scopes.every((scope) => payload.scopes.includes(scope));
      })
      .sort((a, b) => Date.parse(b.grant.payload.issuedAt) - Date.parse(a.grant.payload.issuedAt) || a.digest.localeCompare(b.digest));
    const selected = candidates[0];
    if (selected === undefined) throw new Error('credential_issuer_not_authorized');
    return {
      issuerKeyId: input.issuerKeyId,
      grantDigest: selected.digest,
      rootAuthorityId: selected.grant.payload.rootAuthorityId,
    };
  }
}

function validateGrantPayload(payload: CredentialIssuerGrant, keyRegistry: KeyRegistry): void {
  for (const value of [payload.grantId, payload.issuerKeyId, payload.rootAuthorityId]) {
    if (value.trim() === '') throw new Error('credential_issuer_grant_identity_invalid');
  }
  if (keyRegistry.fingerprint(payload.issuerKeyId) === undefined) throw new Error('credential_issuer_key_not_registered');
  if (payload.credentialKinds.length === 0 || new Set(payload.credentialKinds).size !== payload.credentialKinds.length || payload.credentialKinds.some((kind) => !CREDENTIAL_KINDS.includes(kind))) throw new Error('credential_issuer_grant_kind_invalid');
  if (payload.tenantIds.length === 0 || payload.scopes.length === 0 || new Set(payload.tenantIds).size !== payload.tenantIds.length || new Set(payload.scopes).size !== payload.scopes.length || [...payload.tenantIds, ...payload.scopes].some((value) => value.trim() === '')) throw new Error('credential_issuer_grant_scope_invalid');
  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) throw new Error('credential_issuer_grant_time_invalid');
}
