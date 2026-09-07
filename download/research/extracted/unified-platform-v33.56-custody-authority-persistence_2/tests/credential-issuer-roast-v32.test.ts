import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../src/contracts/crypto.js';
import {
  CredentialIssuerTrustRegistry,
  type CredentialIssuerGrant,
} from '../src/security/credential-issuer-trust.js';
import { ReviewerTrustRegistry, type ReviewerCredential } from '../src/security/reviewer-trust.js';
import { ProviderTrustRegistry, type ProviderCredential } from '../src/security/provider-trust.js';

const now = new Date('2026-07-18T00:00:00.000Z');

function authority() {
  const root = generateSigningIdentity('credential-root-v32');
  const issuer = generateSigningIdentity('credential-issuer-v32');
  const registry = new KeyRegistry();
  registry.register(root.keyId, root.publicKey);
  registry.register(issuer.keyId, issuer.publicKey);
  const trust = new CredentialIssuerTrustRegistry(registry, new Set([root.keyId]));
  const material: CredentialIssuerGrant = {
    grantId: 'issuer-grant-v32', issuerKeyId: issuer.keyId,
    credentialKinds: ['REVIEWER','PROVIDER'], tenantIds: ['tenant-1'], scopes: ['campaign.review','model.invoke'],
    issuedAt: new Date(now.getTime()-60_000).toISOString(), expiresAt: new Date(now.getTime()+600_000).toISOString(), rootAuthorityId: root.keyId,
  };
  const grant = signEnvelope(material, root); trust.registerGrant(grant);
  return { root, issuer, registry, trust, material, grant, grantDigest: sha256(grant) };
}

function reviewerCredential(input: { reviewerKeyId: string; issuerId: string; grantDigest: string; credentialId: string; issuedAt: string; organizationId?: string }): ReviewerCredential {
  return {
    credentialId: input.credentialId, reviewerKeyId: input.reviewerKeyId, organizationId: input.organizationId ?? 'org-a',
    roles: ['INDEPENDENT_REVIEWER'], tenantIds: ['tenant-1'], scopes: ['campaign.review'], issuedAt: input.issuedAt,
    expiresAt: new Date(now.getTime()+600_000).toISOString(), issuerId: input.issuerId, issuerGrantDigest: input.grantDigest,
  };
}
function providerCredential(input: { providerId?: string; providerKeyId: string; issuerId: string; grantDigest: string; credentialId: string; issuedAt: string }): ProviderCredential {
  return {
    credentialId: input.credentialId, providerId: input.providerId ?? 'provider-a', providerKeyId: input.providerKeyId,
    allowedModels: ['sol-5.6-qualified'], tenantIds: ['tenant-1'], scopes: ['model.invoke'], issuedAt: input.issuedAt,
    expiresAt: new Date(now.getTime()+600_000).toISOString(), issuerId: input.issuerId, issuerGrantDigest: input.grantDigest,
  };
}

test('registered keys cannot self-issue reviewer or provider credentials', () => {
  const h = authority();
  const reviewer = generateSigningIdentity('self-reviewer-v32'); const provider = generateSigningIdentity('self-provider-v32');
  h.registry.register(reviewer.keyId, reviewer.publicKey); h.registry.register(provider.keyId, provider.publicKey);
  const reviewerTrust = new ReviewerTrustRegistry(h.registry, h.trust, () => now);
  const providerTrust = new ProviderTrustRegistry(h.registry, h.trust, () => now);
  const issuedAt = now.toISOString();
  const selfReviewer = reviewerCredential({ reviewerKeyId: reviewer.keyId, issuerId: reviewer.keyId, grantDigest: h.grantDigest, credentialId: 'self-reviewer', issuedAt });
  const selfProvider = providerCredential({ providerKeyId: provider.keyId, issuerId: provider.keyId, grantDigest: h.grantDigest, credentialId: 'self-provider', issuedAt });
  assert.throws(() => reviewerTrust.register(signEnvelope(selfReviewer, reviewer)), /credential_issuer_not_authorized|self_issuance/);
  assert.throws(() => providerTrust.register(signEnvelope(selfProvider, provider)), /credential_issuer_not_authorized|self_issuance/);
});

test('only a trusted root can authorize a credential issuer and grant scope cannot be exceeded', () => {
  const h = authority(); const rogueRoot = generateSigningIdentity('rogue-root-v32'); h.registry.register(rogueRoot.keyId, rogueRoot.publicKey);
  const forged = signEnvelope({ ...h.material, grantId: 'forged-grant', rootAuthorityId: rogueRoot.keyId }, rogueRoot);
  assert.throws(() => h.trust.registerGrant(forged), /root_not_authorized/);
  assert.throws(() => h.trust.authorize({ issuerKeyId: h.issuer.keyId, credentialKind: 'REVIEWER', tenantIds: ['tenant-2'], scopes: ['campaign.review'], at: now.toISOString() }), /issuer_not_authorized/);
  assert.throws(() => h.trust.authorize({ issuerKeyId: h.issuer.keyId, credentialKind: 'PROVIDER', tenantIds: ['tenant-1'], scopes: ['model.invoke','admin'], at: now.toISOString() }), /issuer_not_authorized/);
});

test('credential binds to the exact root-issued grant digest', () => {
  const h = authority(); const reviewer = generateSigningIdentity('grant-bound-reviewer-v32'); h.registry.register(reviewer.keyId, reviewer.publicKey);
  const trust = new ReviewerTrustRegistry(h.registry, h.trust, () => now);
  const material = reviewerCredential({ reviewerKeyId: reviewer.keyId, issuerId: h.issuer.keyId, grantDigest: sha256('substituted-grant'), credentialId: 'bad-grant-binding', issuedAt: now.toISOString() });
  assert.throws(() => trust.register(signEnvelope(material, h.issuer)), /issuer_grant_binding_invalid/);
});

test('reviewer credential rotation selects the newest active credential and revoking the old credential leaves the new credential active', () => {
  const h = authority(); const reviewer = generateSigningIdentity('rotating-reviewer-v32'); h.registry.register(reviewer.keyId, reviewer.publicKey);
  const trust = new ReviewerTrustRegistry(h.registry, h.trust, () => now);
  const oldCredential = signEnvelope(reviewerCredential({ reviewerKeyId: reviewer.keyId, issuerId: h.issuer.keyId, grantDigest: h.grantDigest, credentialId: 'reviewer-old', issuedAt: new Date(now.getTime()-30_000).toISOString(), organizationId: 'org-old' }), h.issuer);
  const newCredential = signEnvelope(reviewerCredential({ reviewerKeyId: reviewer.keyId, issuerId: h.issuer.keyId, grantDigest: h.grantDigest, credentialId: 'reviewer-new', issuedAt: new Date(now.getTime()-10_000).toISOString(), organizationId: 'org-new' }), h.issuer);
  trust.register(oldCredential); trust.register(newCredential);
  const selected = trust.authorize({ reviewerKeyId: reviewer.keyId, tenantId: 'tenant-1', scope: 'campaign.review', role: 'INDEPENDENT_REVIEWER', at: now.toISOString() });
  assert.equal(selected.credentialDigest, sha256(newCredential)); assert.equal(selected.organizationId, 'org-new');
  trust.registerRevocation(signEnvelope({ revocationId: 'revoke-reviewer-old', reviewerKeyId: reviewer.keyId, credentialDigest: sha256(oldCredential), reason: 'rotated', revokedAt: now.toISOString(), issuerId: h.issuer.keyId }, h.issuer));
  assert.equal(trust.authorize({ reviewerKeyId: reviewer.keyId, tenantId: 'tenant-1', scope: 'campaign.review', role: 'INDEPENDENT_REVIEWER', at: now.toISOString() }).credentialDigest, sha256(newCredential));
});

test('provider key rotation permits the new key while revoking the old credential does not disable the provider identity', () => {
  const h = authority(); const oldKey = generateSigningIdentity('provider-old-key-v32'); const newKey = generateSigningIdentity('provider-new-key-v32');
  h.registry.register(oldKey.keyId, oldKey.publicKey); h.registry.register(newKey.keyId, newKey.publicKey);
  const trust = new ProviderTrustRegistry(h.registry, h.trust, () => now);
  const oldCredential = signEnvelope(providerCredential({ providerKeyId: oldKey.keyId, issuerId: h.issuer.keyId, grantDigest: h.grantDigest, credentialId: 'provider-old', issuedAt: new Date(now.getTime()-30_000).toISOString() }), h.issuer);
  const newCredential = signEnvelope(providerCredential({ providerKeyId: newKey.keyId, issuerId: h.issuer.keyId, grantDigest: h.grantDigest, credentialId: 'provider-new', issuedAt: new Date(now.getTime()-10_000).toISOString() }), h.issuer);
  trust.register(oldCredential); trust.register(newCredential);
  assert.equal(trust.authorize({ providerId: 'provider-a', providerKeyId: newKey.keyId, model: 'sol-5.6-qualified', tenantId: 'tenant-1', at: now.toISOString() }).credentialDigest, sha256(newCredential));
  trust.registerRevocation(signEnvelope({ revocationId: 'revoke-provider-old', providerId: 'provider-a', credentialDigest: sha256(oldCredential), reason: 'rotated', revokedAt: now.toISOString(), issuerId: h.issuer.keyId }, h.issuer));
  assert.throws(() => trust.authorize({ providerId: 'provider-a', providerKeyId: oldKey.keyId, model: 'sol-5.6-qualified', tenantId: 'tenant-1', at: now.toISOString() }), /credential_revoked/);
  assert.equal(trust.authorize({ providerId: 'provider-a', providerKeyId: newKey.keyId, model: 'sol-5.6-qualified', tenantId: 'tenant-1', at: now.toISOString() }).credentialDigest, sha256(newCredential));
});

test('revoking an issuer grant prevents later issuer authorization without rewriting existing grant evidence', () => {
  const h = authority();
  const revocation = signEnvelope({ revocationId: 'revoke-issuer-grant', grantDigest: h.grantDigest, reason: 'issuer-compromise', revokedAt: now.toISOString(), rootAuthorityId: h.root.keyId }, h.root);
  h.trust.registerRevocation(revocation); h.trust.registerRevocation(revocation);
  assert.throws(() => h.trust.authorize({ issuerKeyId: h.issuer.keyId, credentialKind: 'REVIEWER', tenantIds: ['tenant-1'], scopes: ['campaign.review'], at: now.toISOString() }), /issuer_not_authorized/);
  assert.throws(() => h.trust.registerRevocation(signEnvelope({ ...revocation.payload, reason: 'substituted' }, h.root)), /revocation_conflict/);
});

test('revoked issuer cannot backdate a newly submitted credential to before grant revocation', () => {
  const h = authority(); const reviewer = generateSigningIdentity('backdated-reviewer-v32'); h.registry.register(reviewer.keyId, reviewer.publicKey);
  h.trust.registerRevocation(signEnvelope({ revocationId: 'revoke-before-backdated-submit', grantDigest: h.grantDigest, reason: 'issuer-compromised', revokedAt: now.toISOString(), rootAuthorityId: h.root.keyId }, h.root));
  const trust = new ReviewerTrustRegistry(h.registry, h.trust, () => new Date(now.getTime()+1));
  const backdated = reviewerCredential({ reviewerKeyId: reviewer.keyId, issuerId: h.issuer.keyId, grantDigest: h.grantDigest, credentialId: 'backdated-after-revocation', issuedAt: new Date(now.getTime()-30_000).toISOString() });
  assert.throws(() => trust.register(signEnvelope(backdated, h.issuer)), /issuer_acceptance_invalid.*grant_revoked/);
});
