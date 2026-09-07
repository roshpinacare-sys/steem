import { sha256, signEnvelope, type KeyRegistry, type SigningIdentity } from '../src/contracts/crypto.js';
import {
  CredentialIssuerTrustRegistry,
  type CredentialKind,
  type SignedCredentialIssuerGrant,
} from '../src/security/credential-issuer-trust.js';

export interface CredentialIssuerFixture {
  readonly trust: CredentialIssuerTrustRegistry;
  readonly grant: SignedCredentialIssuerGrant;
  readonly grantDigest: string;
}

export function registerCredentialIssuerFixture(input: {
  readonly registry: KeyRegistry;
  readonly root: SigningIdentity;
  readonly issuer: SigningIdentity;
  readonly kinds: readonly CredentialKind[];
  readonly tenantIds: readonly string[];
  readonly scopes: readonly string[];
  readonly now: Date;
  readonly trust?: CredentialIssuerTrustRegistry;
  readonly grantId?: string;
}): CredentialIssuerFixture {
  input.registry.register(input.root.keyId, input.root.publicKey);
  input.registry.register(input.issuer.keyId, input.issuer.publicKey);
  const trust = input.trust ?? new CredentialIssuerTrustRegistry(input.registry, new Set([input.root.keyId]));
  const grant = signEnvelope({
    grantId: input.grantId ?? `issuer-grant:${input.issuer.keyId}:${input.kinds.join('+')}`,
    issuerKeyId: input.issuer.keyId,
    credentialKinds: [...input.kinds],
    tenantIds: [...input.tenantIds],
    scopes: [...input.scopes],
    issuedAt: new Date(input.now.getTime() - 120_000).toISOString(),
    expiresAt: new Date(input.now.getTime() + 120_000).toISOString(),
    rootAuthorityId: input.root.keyId,
  }, input.root);
  trust.registerGrant(grant);
  return { trust, grant, grantDigest: sha256(grant) };
}
