import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  generateSigningIdentity,
  KeyRegistry,
  sha256,
  signEnvelope,
  type SigningIdentity,
} from '../src/contracts/crypto.js';
import {
  CredentialIssuerTrustRegistry,
  type CredentialIssuerGrant,
} from '../src/security/credential-issuer-trust.js';
import { ReviewerTrustRegistry, type ReviewerCredential } from '../src/security/reviewer-trust.js';
import { ProviderTrustRegistry, type ProviderCredential } from '../src/security/provider-trust.js';
import {
  createCredentialTrustBundle,
  credentialTrustBundleDigest,
  FileCredentialTrustAnchor,
  FileCredentialTrustBundleStore,
  verifyAndImportCredentialTrustBundle,
  type CredentialTrustAnchor,
  type CredentialTrustAnchorRecord,
  type CredentialTrustBundle,
  type CredentialTrustBundleSignaturePayload,
  type PinnedCredentialTrustRoots,
} from '../src/platform/credential-trust-bundle.js';

const t0 = new Date('2026-07-18T01:00:00.000Z');

type Harness = ReturnType<typeof harness>;
function harness() {
  const roots = [generateSigningIdentity('trust-root-a-v32'), generateSigningIdentity('trust-root-b-v32')] as const;
  const issuer = generateSigningIdentity('trust-issuer-v32');
  const reviewer = generateSigningIdentity('trust-reviewer-v32');
  const providerOld = generateSigningIdentity('trust-provider-old-v32');
  const providerNew = generateSigningIdentity('trust-provider-new-v32');
  const registry = new KeyRegistry();
  for (const identity of [...roots, issuer, reviewer, providerOld, providerNew]) registry.register(identity.keyId, identity.publicKey);
  const issuerTrust = new CredentialIssuerTrustRegistry(registry, new Set(roots.map((root) => root.keyId)));
  const grantMaterial: CredentialIssuerGrant = {
    grantId: 'portable-grant-v32', issuerKeyId: issuer.keyId, credentialKinds: ['REVIEWER', 'PROVIDER'],
    tenantIds: ['tenant-1'], scopes: ['campaign.review', 'model.invoke'],
    issuedAt: new Date(t0.getTime() - 120_000).toISOString(), expiresAt: new Date(t0.getTime() + 600_000).toISOString(), rootAuthorityId: roots[0].keyId,
  };
  const grant = signEnvelope(grantMaterial, roots[0]); issuerTrust.registerGrant(grant); const grantDigest = sha256(grant);
  let acceptanceTime = new Date(t0.getTime() - 50_000);
  const reviewerTrust = new ReviewerTrustRegistry(registry, issuerTrust, () => acceptanceTime);
  const oldReviewer = signEnvelope(reviewerCredential('reviewer-old', reviewer.keyId, issuer.keyId, grantDigest, new Date(t0.getTime() - 60_000).toISOString(), 'org-a'), issuer);
  const newReviewer = signEnvelope(reviewerCredential('reviewer-new', reviewer.keyId, issuer.keyId, grantDigest, new Date(t0.getTime() - 30_000).toISOString(), 'org-b'), issuer);
  reviewerTrust.register(oldReviewer);
  acceptanceTime = new Date(t0.getTime() - 20_000); reviewerTrust.register(newReviewer);
  reviewerTrust.registerRevocation(signEnvelope({ revocationId: 'revoke-reviewer-old-bundle', reviewerKeyId: reviewer.keyId, credentialDigest: sha256(oldReviewer), reason: 'rotation', revokedAt: new Date(t0.getTime() - 10_000).toISOString(), issuerId: issuer.keyId }, issuer));
  acceptanceTime = new Date(t0.getTime() - 50_000);
  const providerTrust = new ProviderTrustRegistry(registry, issuerTrust, () => acceptanceTime);
  const oldProvider = signEnvelope(providerCredential('provider-old', providerOld.keyId, issuer.keyId, grantDigest, new Date(t0.getTime() - 60_000).toISOString()), issuer);
  const newProvider = signEnvelope(providerCredential('provider-new', providerNew.keyId, issuer.keyId, grantDigest, new Date(t0.getTime() - 30_000).toISOString()), issuer);
  providerTrust.register(oldProvider);
  acceptanceTime = new Date(t0.getTime() - 20_000); providerTrust.register(newProvider);
  providerTrust.registerRevocation(signEnvelope({ revocationId: 'revoke-provider-old-bundle', providerId: 'provider-a', credentialDigest: sha256(oldProvider), reason: 'rotation', revokedAt: new Date(t0.getTime() - 10_000).toISOString(), issuerId: issuer.keyId }, issuer));
  const pins: PinnedCredentialTrustRoots = { fingerprints: new Map(roots.map((root) => [root.keyId, registry.fingerprint(root.keyId)!])), custodianIds: new Map([[roots[0].keyId,'custodian-a'],[roots[1].keyId,'custodian-b']]), threshold: 2 };
  return { roots, issuer, reviewer, providerOld, providerNew, registry, issuerTrust, reviewerTrust, providerTrust, grant, grantDigest, pins };
}

function bundle(h: Harness, id = 'trust-bundle-1', generatedAt = t0.toISOString(), predecessorBundleDigest?: string): CredentialTrustBundle {
  return createCredentialTrustBundle({ bundleId: id, generatedAt, ...(predecessorBundleDigest === undefined ? {} : { predecessorBundleDigest }), rootPolicy: { trustedRootKeyIds: h.roots.map((root) => root.keyId), custodianIdsByRootKeyId: Object.fromEntries([[h.roots[0].keyId,'custodian-a'],[h.roots[1].keyId,'custodian-b']]), threshold: 2 }, rootSigners: h.roots, keyRegistry: h.registry, issuerTrust: h.issuerTrust, reviewerTrust: h.reviewerTrust, providerTrust: h.providerTrust });
}

function resign(h: Harness, candidate: CredentialTrustBundle): CredentialTrustBundle {
  const payloadDigest = sha256(candidate.payload);
  const signaturePayload: CredentialTrustBundleSignaturePayload = { bundleId: candidate.payload.bundleId, payloadDigest, generatedAt: candidate.payload.generatedAt, ...(candidate.payload.predecessorBundleDigest === undefined ? {} : { predecessorBundleDigest: candidate.payload.predecessorBundleDigest }) };
  return { payload: candidate.payload, rootSignatures: h.roots.map((root) => signEnvelope(signaturePayload, root)).sort((a, b) => a.issuerKeyId.localeCompare(b.issuerKeyId)) };
}

function reviewerCredential(credentialId: string, reviewerKeyId: string, issuerId: string, issuerGrantDigest: string, issuedAt: string, organizationId: string): ReviewerCredential {
  return { credentialId, reviewerKeyId, organizationId, roles: ['INDEPENDENT_REVIEWER'], tenantIds: ['tenant-1'], scopes: ['campaign.review'], issuedAt, expiresAt: new Date(t0.getTime() + 300_000).toISOString(), issuerId, issuerGrantDigest };
}
function providerCredential(credentialId: string, providerKeyId: string, issuerId: string, issuerGrantDigest: string, issuedAt: string): ProviderCredential {
  return { credentialId, providerId: 'provider-a', providerKeyId, allowedModels: ['sol-5.6-qualified'], tenantIds: ['tenant-1'], scopes: ['model.invoke'], issuedAt, expiresAt: new Date(t0.getTime() + 300_000).toISOString(), issuerId, issuerGrantDigest };
}

test('threshold-signed trust bundle imports roots, grants, credential rotations and revocations offline', () => {
  const h = harness(); const b = bundle(h); const imported = verifyAndImportCredentialTrustBundle(b, h.pins);
  assert.equal(imported.bundleDigest, credentialTrustBundleDigest(b));
  assert.equal(imported.reviewerTrust.authorize({ reviewerKeyId: h.reviewer.keyId, tenantId: 'tenant-1', scope: 'campaign.review', role: 'INDEPENDENT_REVIEWER', at: t0.toISOString() }).organizationId, 'org-b');
  assert.throws(() => imported.providerTrust.authorize({ providerId: 'provider-a', providerKeyId: h.providerOld.keyId, model: 'sol-5.6-qualified', tenantId: 'tenant-1', at: t0.toISOString() }), /credential_revoked/);
  assert.doesNotThrow(() => imported.providerTrust.authorize({ providerId: 'provider-a', providerKeyId: h.providerNew.keyId, model: 'sol-5.6-qualified', tenantId: 'tenant-1', at: t0.toISOString() }));
});

test('bundle requires the externally pinned threshold and exact root set', () => {
  const h = harness(); const b = bundle(h);
  assert.throws(() => verifyAndImportCredentialTrustBundle({ ...b, rootSignatures: b.rootSignatures.slice(0, 1) }, h.pins), /signature_threshold_not_met/);
  assert.throws(() => verifyAndImportCredentialTrustBundle(b, { fingerprints: new Map([[h.roots[0].keyId, h.registry.fingerprint(h.roots[0].keyId)!]]), custodianIds: new Map([[h.roots[0].keyId,'custodian-a']]), threshold: 1 }), /root_policy_pin_mismatch/);
});

test('root fingerprint, public key and payload substitutions are rejected', () => {
  const h = harness(); const b = bundle(h);
  const badPins = { fingerprints: new Map(h.pins.fingerprints), custodianIds: new Map(h.pins.custodianIds), threshold: 2 }; badPins.fingerprints.set(h.roots[0].keyId, '0'.repeat(64));
  assert.throws(() => verifyAndImportCredentialTrustBundle(b, badPins), /root_fingerprint_mismatch/);
  const badCustodians = { fingerprints: new Map(h.pins.fingerprints), custodianIds: new Map(h.pins.custodianIds), threshold: 2 }; badCustodians.custodianIds.set(h.roots[1].keyId,'custodian-a');
  assert.throws(() => verifyAndImportCredentialTrustBundle(b, badCustodians), /custodian_pin_mismatch/);
  const keys = b.payload.publicKeys.map((record, index) => index === 0 ? { ...record, fingerprint: '1'.repeat(64) } : record);
  assert.throws(() => verifyAndImportCredentialTrustBundle({ ...b, payload: { ...b.payload, publicKeys: keys } }, h.pins), /fingerprint_mismatch|signature_invalid/);
  const tampered = { ...b, payload: { ...b.payload, limitations: [...b.payload.limitations, 'fabricated'] } };
  assert.throws(() => verifyAndImportCredentialTrustBundle(tampered, h.pins), /signature_invalid/);
});

test('bundle preserves original acceptance time and rejects a root-signed backdated acceptance after grant revocation', () => {
  const h = harness();
  h.issuerTrust.registerRevocation(signEnvelope({ revocationId: 'revoke-portable-grant', grantDigest: h.grantDigest, reason: 'issuer-compromise', revokedAt: new Date(t0.getTime() + 1_000).toISOString(), rootAuthorityId: h.roots[0].keyId }, h.roots[0]));
  const valid = bundle(h, 'trust-bundle-with-revocation', new Date(t0.getTime() + 2_000).toISOString());
  assert.doesNotThrow(() => verifyAndImportCredentialTrustBundle(valid, h.pins));
  const records = valid.payload.reviewerCredentials.map((record, index) => index === 0 ? { ...record, acceptedAt: new Date(t0.getTime() + 1_500).toISOString() } : record);
  const malicious = resign(h, { ...valid, payload: { ...valid.payload, reviewerCredentials: records } });
  assert.throws(() => verifyAndImportCredentialTrustBundle(malicious, h.pins), /issuer_acceptance_invalid.*grant_revoked/);
});

test('file trust store persists, reloads and enforces predecessor monotonicity against rollback and forks', () => {
  const h = harness(); const dir = mkdtempSync(join(tmpdir(), 'trust-bundle-v32-')); const path = join(dir, 'trust.json'); const store = new FileCredentialTrustBundleStore(path, h.pins);
  const first = bundle(h); const firstDigest = store.save(first); assert.equal(store.load().bundleDigest, firstDigest);
  const second = bundle(h, 'trust-bundle-2', new Date(t0.getTime() + 10_000).toISOString(), firstDigest); const secondDigest = store.save(second); assert.equal(store.load().bundleDigest, secondDigest);
  assert.throws(() => store.save(first), /predecessor_mismatch|time_not_monotonic/);
  const fork = bundle(h, 'trust-bundle-fork', new Date(t0.getTime() + 20_000).toISOString(), firstDigest);
  assert.throws(() => store.save(fork), /predecessor_mismatch/);
  const reopened = new FileCredentialTrustBundleStore(path, h.pins); assert.equal(reopened.load().bundleDigest, secondDigest);
});

test('file trust store detects tampering, malformed JSON and symlink substitution', () => {
  const h = harness(); const dir = mkdtempSync(join(tmpdir(), 'trust-bundle-tamper-v32-')); const path = join(dir, 'trust.json'); const store = new FileCredentialTrustBundleStore(path, h.pins); store.save(bundle(h));
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as CredentialTrustBundle; writeFileSync(path, `${JSON.stringify({ ...parsed, payload: { ...parsed.payload, bundleId: 'tampered' } })}\n`);
  assert.throws(() => store.load(), /signature_invalid/);
  writeFileSync(path, '{broken'); assert.throws(() => store.load(), /bundle_corrupt/);
  const target = join(dir, 'target.json'); writeFileSync(target, '{}'); const link = join(dir, 'link.json'); symlinkSync(target, link);
  assert.throws(() => new FileCredentialTrustBundleStore(link, h.pins).load(), /symlink_forbidden/);
});

test('same bundle is idempotent while same bundle id with different signed material is rejected', () => {
  const h = harness(); const dir = mkdtempSync(join(tmpdir(), 'trust-bundle-idempotent-v32-')); const path = join(dir, 'trust.json'); const store = new FileCredentialTrustBundleStore(path, h.pins); const first = bundle(h);
  const digest = store.save(first); assert.equal(store.save(first), digest);
  const conflicting = bundle(h, first.payload.bundleId, new Date(t0.getTime() + 10_000).toISOString(), digest);
  assert.throws(() => store.save(conflicting), /bundle_id_conflict/);
});


test('independent anchor detects replacement of the trust bundle with an older valid signed bundle after restart', () => {
  const h = harness(); const dir = mkdtempSync(join(tmpdir(), 'trust-bundle-anchor-v32-')); const path = join(dir, 'trust.json');
  const anchor = new FileCredentialTrustAnchor(join(dir, 'anchor.json')); const store = new FileCredentialTrustBundleStore(path, h.pins, anchor);
  assert.equal(store.rollbackProtection(), 'INDEPENDENT_FILE_ANCHOR');
  const first = bundle(h); const firstJson = `${JSON.stringify(first)}\n`; const firstDigest = store.save(first);
  const second = bundle(h, 'trust-bundle-anchor-2', new Date(t0.getTime() + 10_000).toISOString(), firstDigest); store.save(second);
  writeFileSync(path, firstJson);
  assert.throws(() => new FileCredentialTrustBundleStore(path, h.pins, new FileCredentialTrustAnchor(join(dir, 'anchor.json'))).load(), /anchor_mismatch/);
});

test('anchor chain tampering is detected and anchor cannot advance from the wrong predecessor', () => {
  const h = harness(); const dir = mkdtempSync(join(tmpdir(), 'trust-anchor-tamper-v32-')); const anchorPath = join(dir, 'anchor.json'); const anchor = new FileCredentialTrustAnchor(anchorPath);
  const first = bundle(h); const firstDigest = credentialTrustBundleDigest(first);
  anchor.advance({ bundleDigest: firstDigest, bundleId: first.payload.bundleId, generatedAt: first.payload.generatedAt });
  assert.throws(() => anchor.advance({ bundleDigest: 'a'.repeat(64), bundleId: 'fork', generatedAt: new Date(t0.getTime() + 10_000).toISOString(), predecessorBundleDigest: 'b'.repeat(64) }), /anchor_predecessor_mismatch/);
  const state = JSON.parse(readFileSync(anchorPath, 'utf8')) as { records: Array<Record<string, unknown>> };
  state.records[0] = { ...state.records[0], bundleId: 'tampered' }; writeFileSync(anchorPath, `${JSON.stringify(state)}\n`);
  assert.throws(() => new FileCredentialTrustAnchor(anchorPath), /anchor_digest_invalid/);
});

test('store without an independent anchor is explicitly classified as API-chain-only protection', () => {
  const h = harness(); const dir = mkdtempSync(join(tmpdir(), 'trust-bundle-api-only-v32-'));
  assert.equal(new FileCredentialTrustBundleStore(join(dir, 'trust.json'), h.pins).rollbackProtection(), 'API_CHAIN_ONLY');
});


test('pending journal recovers a crash after bundle write and before anchor advancement without replaying publication', () => {
  const h = harness(); const dir = mkdtempSync(join(tmpdir(), 'trust-bundle-pending-v32-')); const path = join(dir, 'trust.json');
  const delegate = new FileCredentialTrustAnchor(join(dir, 'anchor.json'));
  let failNext = false;
  const flakyAnchor: CredentialTrustAnchor = {
    current: () => delegate.current(),
    assertCurrent: (digest) => delegate.assertCurrent(digest),
    advance: (input): CredentialTrustAnchorRecord => { if (failNext) { failNext = false; throw new Error('simulated_anchor_outage'); } return delegate.advance(input); },
  };
  const store = new FileCredentialTrustBundleStore(path, h.pins, flakyAnchor); const first = bundle(h); const firstDigest = store.save(first);
  const second = bundle(h, 'trust-bundle-pending-2', new Date(t0.getTime() + 10_000).toISOString(), firstDigest);
  failNext = true; assert.throws(() => store.save(second), /simulated_anchor_outage/);
  assert.equal(delegate.current()!.bundleDigest, firstDigest);
  const recovered = new FileCredentialTrustBundleStore(path, h.pins, flakyAnchor).load();
  assert.equal(recovered.bundleDigest, credentialTrustBundleDigest(second));
  assert.equal(delegate.current()!.bundleDigest, recovered.bundleDigest);
  assert.equal(existsSync(`${path}.pending`), false);
});

test('pending journal tampering and contradictory file-anchor state fail closed', () => {
  const h = harness(); const dir = mkdtempSync(join(tmpdir(), 'trust-bundle-pending-tamper-v32-')); const path = join(dir, 'trust.json');
  const anchor = new FileCredentialTrustAnchor(join(dir, 'anchor.json')); const store = new FileCredentialTrustBundleStore(path, h.pins, anchor); const first = bundle(h); const firstDigest = store.save(first);
  const second = bundle(h, 'trust-bundle-pending-tamper-2', new Date(t0.getTime() + 10_000).toISOString(), firstDigest);
  const nextDigest = credentialTrustBundleDigest(second);
  const intentMaterial = { version: 1, priorBundleDigest: firstDigest, nextBundleDigest: nextDigest, bundleId: second.payload.bundleId, generatedAt: second.payload.generatedAt, bundle: second };
  writeFileSync(`${path}.pending`, `${JSON.stringify({ ...intentMaterial, intentDigest: '0'.repeat(64) })}\n`);
  assert.throws(() => store.load(), /pending_digest_invalid/);
});
