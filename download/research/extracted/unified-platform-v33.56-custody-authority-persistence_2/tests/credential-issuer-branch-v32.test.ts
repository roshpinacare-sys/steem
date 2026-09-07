import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../src/contracts/crypto.js';
import { CredentialIssuerTrustRegistry, type CredentialIssuerGrant } from '../src/security/credential-issuer-trust.js';

const now = new Date('2026-07-18T02:00:00.000Z');
function base() {
  const root = generateSigningIdentity('issuer-branch-root'); const issuer = generateSigningIdentity('issuer-branch-issuer'); const registry = new KeyRegistry();
  registry.register(root.keyId, root.publicKey); registry.register(issuer.keyId, issuer.publicKey);
  const trust = new CredentialIssuerTrustRegistry(registry, new Set([root.keyId]));
  const material: CredentialIssuerGrant = { grantId: 'grant-a', issuerKeyId: issuer.keyId, credentialKinds: ['REVIEWER'], tenantIds: ['tenant-1'], scopes: ['campaign.review'], issuedAt: new Date(now.getTime()-10_000).toISOString(), expiresAt: new Date(now.getTime()+10_000).toISOString(), rootAuthorityId: root.keyId };
  const grant = signEnvelope(material, root); trust.registerGrant(grant);
  return { root, issuer, registry, trust, material, grant, digest: sha256(grant) };
}

test('issuer trust constructor rejects missing, blank and unregistered roots', () => {
  const registry = new KeyRegistry();
  assert.throws(() => new CredentialIssuerTrustRegistry(registry, new Set()), /root_required/);
  assert.throws(() => new CredentialIssuerTrustRegistry(registry, new Set([' '])), /root_invalid/);
  assert.throws(() => new CredentialIssuerTrustRegistry(registry, new Set(['missing'])), /root_not_registered/);
});

test('grant registration covers signature, root, identity, issuer-key, kind, scope, time and conflict branches', () => {
  const h = base(); const rogue = generateSigningIdentity('issuer-branch-rogue'); h.registry.register(rogue.keyId, rogue.publicKey);
  assert.throws(() => h.trust.registerGrant({ ...h.grant, signature: 'bad' }), /signature_invalid/);
  assert.throws(() => h.trust.registerGrant(signEnvelope({ ...h.material, grantId: 'rogue-root', rootAuthorityId: rogue.keyId }, rogue)), /root_not_authorized/);
  const cases: Array<[Partial<CredentialIssuerGrant>, RegExp]> = [
    [{ grantId: '' }, /identity_invalid/],
    [{ issuerKeyId: 'missing-key', grantId: 'missing-key' }, /key_not_registered/],
    [{ credentialKinds: [], grantId: 'empty-kind' }, /kind_invalid/],
    [{ credentialKinds: ['REVIEWER','REVIEWER'], grantId: 'duplicate-kind' }, /kind_invalid/],
    [{ credentialKinds: ['BAD' as never], grantId: 'bad-kind' }, /kind_invalid/],
    [{ tenantIds: [], grantId: 'empty-tenant' }, /scope_invalid/],
    [{ scopes: [], grantId: 'empty-scope' }, /scope_invalid/],
    [{ tenantIds: ['tenant-1','tenant-1'], grantId: 'duplicate-tenant' }, /scope_invalid/],
    [{ scopes: ['campaign.review','campaign.review'], grantId: 'duplicate-scope' }, /scope_invalid/],
    [{ issuedAt: 'bad', grantId: 'bad-issued' }, /time_invalid/],
    [{ expiresAt: h.material.issuedAt, grantId: 'bad-expiry' }, /time_invalid/],
  ];
  for (const [patch, expected] of cases) assert.throws(() => h.trust.registerGrant(signEnvelope({ ...h.material, ...patch }, h.root)), expected);
  assert.throws(() => h.trust.registerGrant(signEnvelope({ ...h.material, scopes: ['other'] }, h.root)), /grant_conflict/);
});

test('grant authorization covers time, absence, inactive, kind, tenant, scope, exact digest and newest selection', () => {
  const h = base();
  assert.throws(() => h.trust.authorize({ issuerKeyId: h.issuer.keyId, credentialKind: 'REVIEWER', tenantIds: ['tenant-1'], scopes: ['campaign.review'], at: 'bad' }), /time_invalid/);
  assert.throws(() => h.trust.authorize({ issuerKeyId: 'missing', credentialKind: 'REVIEWER', tenantIds: ['tenant-1'], scopes: ['campaign.review'], at: now.toISOString() }), /not_authorized/);
  for (const input of [
    { credentialKind: 'PROVIDER' as const, tenantIds: ['tenant-1'], scopes: ['campaign.review'] },
    { credentialKind: 'REVIEWER' as const, tenantIds: ['tenant-2'], scopes: ['campaign.review'] },
    { credentialKind: 'REVIEWER' as const, tenantIds: ['tenant-1'], scopes: ['other'] },
  ]) assert.throws(() => h.trust.authorize({ issuerKeyId: h.issuer.keyId, ...input, at: now.toISOString() }), /not_authorized/);
  assert.throws(() => h.trust.authorize({ issuerKeyId: h.issuer.keyId, credentialKind: 'REVIEWER', tenantIds: ['tenant-1'], scopes: ['campaign.review'], at: new Date(now.getTime()+20_000).toISOString() }), /not_authorized/);
  assert.throws(() => h.trust.authorizeGrantDigest({ grantDigest: '0'.repeat(64), issuerKeyId: h.issuer.keyId, credentialKind: 'REVIEWER', tenantIds: ['tenant-1'], scopes: ['campaign.review'], at: now.toISOString() }), /binding_invalid/);
  assert.throws(() => h.trust.authorizeGrantDigest({ grantDigest: h.digest, issuerKeyId: 'wrong', credentialKind: 'REVIEWER', tenantIds: ['tenant-1'], scopes: ['campaign.review'], at: now.toISOString() }), /binding_invalid/);
  assert.throws(() => h.trust.authorizeGrantDigest({ grantDigest: h.digest, issuerKeyId: h.issuer.keyId, credentialKind: 'PROVIDER', tenantIds: ['tenant-1'], scopes: ['campaign.review'], at: now.toISOString() }), /not_authorized/);
  assert.throws(() => h.trust.authorizeGrantDigest({ grantDigest: h.digest, issuerKeyId: h.issuer.keyId, credentialKind: 'REVIEWER', tenantIds: ['tenant-1'], scopes: ['campaign.review'], at: 'bad' }), /time_invalid/);
  assert.throws(() => h.trust.authorizeGrantDigest({ grantDigest: h.digest, issuerKeyId: h.issuer.keyId, credentialKind: 'REVIEWER', tenantIds: ['tenant-1'], scopes: ['campaign.review'], at: new Date(now.getTime()-20_000).toISOString() }), /grant_inactive/);
  const newer = signEnvelope({ ...h.material, grantId: 'grant-newer', issuedAt: new Date(now.getTime()-5_000).toISOString() }, h.root); h.trust.registerGrant(newer);
  assert.equal(h.trust.authorize({ issuerKeyId: h.issuer.keyId, credentialKind: 'REVIEWER', tenantIds: ['tenant-1'], scopes: ['campaign.review'], at: now.toISOString() }).grantDigest, sha256(newer));
  assert.equal(h.trust.listGrants().length, 2); assert.equal(h.trust.listRevocations().length, 0);
});

test('grant revocation covers signature, identity, root, lookup, root binding, time, conflict and effective branches', () => {
  const h = base(); const rogueRoot = generateSigningIdentity('issuer-revoke-rogue'); h.registry.register(rogueRoot.keyId, rogueRoot.publicKey);
  const valid = signEnvelope({ revocationId: 'revoke-a', grantDigest: h.digest, reason: 'compromise', revokedAt: now.toISOString(), rootAuthorityId: h.root.keyId }, h.root);
  assert.throws(() => h.trust.registerRevocation({ ...valid, signature: 'bad' }), /signature_invalid/);
  assert.throws(() => h.trust.registerRevocation(signEnvelope({ ...valid.payload, revocationId: '' }, h.root)), /identity_invalid/);
  assert.throws(() => h.trust.registerRevocation(signEnvelope({ ...valid.payload, revocationId: 'rogue', rootAuthorityId: rogueRoot.keyId }, rogueRoot)), /root_not_authorized/);
  assert.throws(() => h.trust.registerRevocation(signEnvelope({ ...valid.payload, revocationId: 'missing', grantDigest: '0'.repeat(64) }, h.root)), /grant_not_found/);
  assert.throws(() => h.trust.registerRevocation(signEnvelope({ ...valid.payload, revocationId: 'too-early', revokedAt: new Date(Date.parse(h.material.issuedAt)-1).toISOString() }, h.root)), /time_invalid/);
  h.trust.registerRevocation(valid); h.trust.registerRevocation(valid); assert.equal(h.trust.listRevocations().length, 1);
  assert.throws(() => h.trust.registerRevocation(signEnvelope({ ...valid.payload, reason: 'changed' }, h.root)), /revocation_conflict/);
  assert.throws(() => h.trust.authorizeGrantDigest({ grantDigest: h.digest, issuerKeyId: h.issuer.keyId, credentialKind: 'REVIEWER', tenantIds: ['tenant-1'], scopes: ['campaign.review'], at: now.toISOString() }), /grant_revoked/);
  assert.throws(() => h.trust.authorize({ issuerKeyId: h.issuer.keyId, credentialKind: 'REVIEWER', tenantIds: ['tenant-1'], scopes: ['campaign.review'], at: now.toISOString() }), /not_authorized/);
});
