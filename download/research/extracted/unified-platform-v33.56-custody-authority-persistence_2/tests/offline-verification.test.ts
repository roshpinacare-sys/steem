import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActionPassport } from '../src/contracts/canonical.js';
import { generateSigningIdentity, sha256 } from '../src/contracts/crypto.js';
import { createOfflineVerificationBundle, verifyOfflineVerificationBundle } from '../src/platform/offline-verification.js';
import { KeyLifecycleRegistry, type KeyDescriptor } from '../src/security/key-lifecycle.js';

const now = new Date('2026-07-17T13:00:00.000Z');
function descriptor(keyId: string, purpose: KeyDescriptor['purpose']) {
  return { keyId, familyId: `family-${purpose}`, purpose, environment: 'airgap' as const, tenantId: 'tenant-1', notBefore: new Date(now.getTime() - 1_000).toISOString(), notAfter: new Date(now.getTime() + 3600_000).toISOString() };
}
function fixture() {
  const registry = new KeyLifecycleRegistry();
  const passportIdentity = generateSigningIdentity('airgap-passport');
  const attestationIdentity = generateSigningIdentity('airgap-evidence');
  registry.register(passportIdentity, descriptor(passportIdentity.keyId, 'action-passport'));
  registry.register(attestationIdentity, descriptor(attestationIdentity.keyId, 'evidence-attestation'));
  const passport: ActionPassport = { passportId: 'passport-offline-1', tenantId: 'tenant-1', subject: 'candidate-1', authorityGrantDigest: sha256('grant'), evidenceRoot: sha256('evidence'), promotionState: 'shadow', issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), reviewerIds: ['reviewer-1'], limitations: ['shadow-only'] };
  const artifacts = [{ name: 'patch.diff', digest: sha256('patch'), mediaType: 'text/x-diff', byteLength: 42 }, { name: 'tests.json', digest: sha256('tests'), mediaType: 'application/json', byteLength: 80 }];
  const bundle = createOfflineVerificationBundle({ registry, passportIdentity, attestationIdentity, passport, artifacts, now, ttlMs: 60_000 });
  return { registry, passportIdentity, attestationIdentity, passport, artifacts, bundle };
}

test('offline bundle verifies signatures, evidence root, artifacts and trust epoch without a server', () => {
  const { bundle } = fixture();
  const result = verifyOfflineVerificationBundle(bundle, { now, minimumTrustEpoch: bundle.trustSnapshot.epoch });
  assert.equal(result.ok, true);
  assert.equal(result.artifactCount, 2);
});

test('tampered artifact manifest or passport is detected', () => {
  const { bundle } = fixture();
  const tamperedArtifacts = { ...bundle, artifacts: [{ ...bundle.artifacts[0]!, digest: sha256('tampered') }, bundle.artifacts[1]!] };
  assert.equal(verifyOfflineVerificationBundle(tamperedArtifacts, { now, minimumTrustEpoch: bundle.trustSnapshot.epoch }).ok, false);
  const tamperedPassport = { ...bundle, passport: { ...bundle.passport, payload: { ...bundle.passport.payload, evidenceRoot: sha256('other') } } };
  const result = verifyOfflineVerificationBundle(tamperedPassport, { now, minimumTrustEpoch: bundle.trustSnapshot.epoch });
  assert.ok(result.failures.includes('passport_signature_invalid_or_revoked'));
});

test('stale trust snapshot is rejected by an externally supplied minimum epoch', () => {
  const { bundle } = fixture();
  const result = verifyOfflineVerificationBundle(bundle, { now, minimumTrustEpoch: bundle.trustSnapshot.epoch + 1 });
  assert.ok(result.failures.includes('trust_snapshot_stale'));
});

test('bundle expiration is enforced offline', () => {
  const { bundle } = fixture();
  const result = verifyOfflineVerificationBundle(bundle, { now: new Date(now.getTime() + 120_000), minimumTrustEpoch: bundle.trustSnapshot.epoch });
  assert.ok(result.failures.includes('offline_bundle_expired'));
  assert.ok(result.failures.includes('passport_signature_invalid_or_revoked'));
});

test('revocation in a newer trust snapshot invalidates an old passport', () => {
  const { registry, passportIdentity, bundle } = fixture();
  registry.revoke(passportIdentity.keyId, { status: 'COMPROMISED', reason: 'key compromise', effectiveAt: now, approvedBy: ['reviewer-1'] });
  const newerSnapshot = registry.snapshot(new Date(now.getTime() + 1));
  const rebundled = { ...bundle, trustSnapshot: newerSnapshot };
  const { bundleDigest: _ignored, ...material } = rebundled;
  const resealed = { ...rebundled, bundleDigest: sha256(material) };
  const result = verifyOfflineVerificationBundle(resealed, { now: new Date(now.getTime() + 2), minimumTrustEpoch: newerSnapshot.epoch });
  assert.ok(result.failures.includes('passport_signature_invalid_or_revoked'));
});

test('duplicate artifact names and invalid digests are rejected during creation', () => {
  const { registry, passportIdentity, attestationIdentity, passport, artifacts } = fixture();
  assert.throws(() => createOfflineVerificationBundle({ registry, passportIdentity, attestationIdentity, passport, artifacts: [artifacts[0]!, artifacts[0]!], now, ttlMs: 60_000 }), /duplicate/);
  assert.throws(() => createOfflineVerificationBundle({ registry, passportIdentity, attestationIdentity, passport, artifacts: [{ ...artifacts[0]!, digest: 'bad' }], now, ttlMs: 60_000 }), /digest/);
});
