import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../src/contracts/crypto.js';
import { CredentialIssuerTrustRegistry } from '../src/security/credential-issuer-trust.js';
import { ReviewerTrustRegistry, type ReviewerCredential } from '../src/security/reviewer-trust.js';
import { ProviderTrustRegistry, type ProviderCredential } from '../src/security/provider-trust.js';

const issued = new Date('2026-07-18T00:00:00.000Z');
const accepted = new Date('2026-07-18T00:01:00.000Z');
const revoked = new Date('2026-07-18T00:02:00.000Z');
const later = new Date('2026-07-18T00:03:00.000Z');

test('time-effective key revocation preserves historical verification while blocking current trust', () => {
  const signer = generateSigningIdentity('time-aware-signer-v32');
  const registry = new KeyRegistry(); registry.register(signer.keyId, signer.publicKey);
  const envelope = signEnvelope({ value: 'historical' }, signer);
  registry.revokeAt(signer.keyId, revoked);
  assert.equal(registry.verifyAt(envelope, accepted), true);
  assert.equal(registry.verifyAt(envelope, revoked), false);
  assert.equal(registry.verifyAt(envelope, later), false);
  assert.equal(registry.isRevoked(signer.keyId, accepted), false);
  assert.equal(registry.isRevoked(signer.keyId, later), true);
});

test('export and import preserve the effective revocation timestamp', () => {
  const signer = generateSigningIdentity('export-revocation-v32');
  const source = new KeyRegistry(); source.register(signer.keyId, signer.publicKey); source.revokeAt(signer.keyId, revoked);
  const record = source.exportPublicKey(signer.keyId);
  assert.equal(record.revokedAt, revoked.toISOString());
  const imported = new KeyRegistry(); imported.registerExported(record);
  const envelope = signEnvelope({ value: 1 }, signer);
  assert.equal(imported.verifyAt(envelope, accepted), true);
  assert.equal(imported.verifyAt(envelope, later), false);
  assert.equal(imported.revocationEffectiveAt(signer.keyId), revoked.toISOString());
});

test('credential accepted before issuer-key revocation remains historically valid', () => {
  const root = generateSigningIdentity('historical-root-v32');
  const issuer = generateSigningIdentity('historical-issuer-v32');
  const reviewer = generateSigningIdentity('historical-reviewer-v32');
  const registry = new KeyRegistry(); for (const id of [root, issuer, reviewer]) registry.register(id.keyId, id.publicKey);
  const issuerTrust = new CredentialIssuerTrustRegistry(registry, new Set([root.keyId]));
  const grant = signEnvelope({ grantId:'historical-grant',issuerKeyId:issuer.keyId,credentialKinds:['REVIEWER'] as const,tenantIds:['tenant-1'],scopes:['campaign.review'],issuedAt:new Date(issued.getTime()-60_000).toISOString(),expiresAt:new Date(later.getTime()+60_000).toISOString(),rootAuthorityId:root.keyId }, root);
  issuerTrust.registerGrant(grant);
  const trust = new ReviewerTrustRegistry(registry, issuerTrust, () => accepted);
  const payload: ReviewerCredential = { credentialId:'historical-credential',reviewerKeyId:reviewer.keyId,organizationId:'org-a',roles:['INDEPENDENT_REVIEWER'],tenantIds:['tenant-1'],scopes:['campaign.review'],issuedAt:issued.toISOString(),expiresAt:new Date(later.getTime()+60_000).toISOString(),issuerId:issuer.keyId,issuerGrantDigest:sha256(grant) };
  trust.register(signEnvelope(payload, issuer));
  registry.revokeAt(issuer.keyId, revoked);
  assert.doesNotThrow(() => trust.authorize({ reviewerKeyId: reviewer.keyId, tenantId:'tenant-1',scope:'campaign.review',role:'INDEPENDENT_REVIEWER',at:later.toISOString() }));
});

test('credential submitted after issuer-key revocation is rejected even when backdated', () => {
  const root = generateSigningIdentity('backdate-root-v32');
  const issuer = generateSigningIdentity('backdate-issuer-v32');
  const reviewer = generateSigningIdentity('backdate-reviewer-v32');
  const registry = new KeyRegistry(); for (const id of [root, issuer, reviewer]) registry.register(id.keyId, id.publicKey);
  const issuerTrust = new CredentialIssuerTrustRegistry(registry, new Set([root.keyId]));
  const grant = signEnvelope({ grantId:'backdate-grant',issuerKeyId:issuer.keyId,credentialKinds:['REVIEWER'] as const,tenantIds:['tenant-1'],scopes:['campaign.review'],issuedAt:new Date(issued.getTime()-60_000).toISOString(),expiresAt:new Date(later.getTime()+60_000).toISOString(),rootAuthorityId:root.keyId }, root);
  issuerTrust.registerGrant(grant); registry.revokeAt(issuer.keyId, revoked);
  const trust = new ReviewerTrustRegistry(registry, issuerTrust, () => later);
  const payload: ReviewerCredential = { credentialId:'backdated-after-revoke',reviewerKeyId:reviewer.keyId,organizationId:'org-a',roles:['INDEPENDENT_REVIEWER'],tenantIds:['tenant-1'],scopes:['campaign.review'],issuedAt:issued.toISOString(),expiresAt:new Date(later.getTime()+60_000).toISOString(),issuerId:issuer.keyId,issuerGrantDigest:sha256(grant) };
  assert.throws(() => trust.register(signEnvelope(payload, issuer)), /signature_invalid/);
});


test('provider credential submitted after issuer-key revocation is rejected even when backdated', () => {
  const root = generateSigningIdentity('provider-backdate-root-v32');
  const issuer = generateSigningIdentity('provider-backdate-issuer-v32');
  const provider = generateSigningIdentity('provider-backdate-key-v32');
  const registry = new KeyRegistry(); for (const id of [root, issuer, provider]) registry.register(id.keyId, id.publicKey);
  const issuerTrust = new CredentialIssuerTrustRegistry(registry, new Set([root.keyId]));
  const grant = signEnvelope({ grantId:'provider-backdate-grant',issuerKeyId:issuer.keyId,credentialKinds:['PROVIDER'] as const,tenantIds:['tenant-1'],scopes:['model.invoke'],issuedAt:new Date(issued.getTime()-60_000).toISOString(),expiresAt:new Date(later.getTime()+60_000).toISOString(),rootAuthorityId:root.keyId }, root);
  issuerTrust.registerGrant(grant); registry.revokeAt(issuer.keyId, revoked);
  const trust = new ProviderTrustRegistry(registry, issuerTrust, () => later);
  const payload: ProviderCredential = { credentialId:'provider-backdated-after-revoke',providerId:'provider-a',providerKeyId:provider.keyId,allowedModels:['sol-5.6-qualified'],tenantIds:['tenant-1'],scopes:['model.invoke'],issuedAt:issued.toISOString(),expiresAt:new Date(later.getTime()+60_000).toISOString(),issuerId:issuer.keyId,issuerGrantDigest:sha256(grant) };
  assert.throws(() => trust.register(signEnvelope(payload, issuer)), /signature_invalid/);
});

test('time-aware key registry fails closed on malformed, conflicting and legacy revocation records', () => {
  const signer = generateSigningIdentity('revocation-branch-signer-v32');
  const registry = new KeyRegistry(); registry.register(signer.keyId, signer.publicKey);
  assert.throws(() => registry.revokeAt(signer.keyId, 'invalid'), /revocation_time_invalid/);
  assert.throws(() => registry.revokeAt('missing-key', revoked), /key_not_found/);
  registry.revokeAt(signer.keyId, revoked);
  assert.doesNotThrow(() => registry.revokeAt(signer.keyId, revoked));
  assert.throws(() => registry.revokeAt(signer.keyId, later), /revocation_conflict/);
  const envelope = signEnvelope({ branch: true }, signer);
  assert.equal(registry.verifyAt(envelope, 'invalid'), false);
  assert.equal(registry.verifyAt({ ...envelope, algorithm: 'invalid' as 'Ed25519' }, accepted), false);
  assert.equal(new KeyRegistry().verifyAt(envelope, accepted), false);
  assert.equal(registry.verifyAt({ ...envelope, signature: 'not-base64-signature' }, accepted), false);
  assert.equal(registry.isRevoked(signer.keyId, 'invalid'), false);

  const legacy = registry.exportPublicKey(signer.keyId);
  const { revokedAt: _ignored, ...legacyWithoutTime } = legacy;
  const imported = new KeyRegistry(); imported.registerExported({ ...legacyWithoutTime, revoked: true });
  assert.equal(imported.verifyAt(envelope, new Date(0)), false);
});
