import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActionPassport } from '../src/contracts/canonical.js';
import { generateSigningIdentity, sha256 } from '../src/contracts/crypto.js';
import {
  createOfflineVerificationBundle,
  verifyOfflineVerificationBundle,
  type OfflineVerificationBundle,
} from '../src/platform/offline-verification.js';
import { KeyLifecycleRegistry, type KeyDescriptor } from '../src/security/key-lifecycle.js';

const now = new Date('2026-07-17T13:00:00.000Z');

function descriptor(keyId: string, purpose: KeyDescriptor['purpose']) {
  return {
    keyId,
    familyId: `family-${purpose}`,
    purpose,
    environment: 'airgap' as const,
    tenantId: 'tenant-1',
    notBefore: new Date(now.getTime() - 1_000).toISOString(),
    notAfter: new Date(now.getTime() + 3_600_000).toISOString(),
  };
}

function fixture() {
  const registry = new KeyLifecycleRegistry();
  const passportIdentity = generateSigningIdentity('offline-branch-passport');
  const attestationIdentity = generateSigningIdentity('offline-branch-attestation');
  registry.register(passportIdentity, descriptor(passportIdentity.keyId, 'action-passport'));
  registry.register(attestationIdentity, descriptor(attestationIdentity.keyId, 'evidence-attestation'));
  const passport: ActionPassport = {
    passportId: 'passport-branch', tenantId: 'tenant-1', subject: 'candidate', authorityGrantDigest: sha256('grant'),
    evidenceRoot: sha256('evidence'), promotionState: 'shadow', issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(), reviewerIds: ['reviewer'], limitations: ['shadow-only'],
  };
  const artifacts = [{ name: 'artifact.json', digest: sha256('artifact'), mediaType: 'application/json', byteLength: 8 }];
  const bundle = createOfflineVerificationBundle({ registry, passportIdentity, attestationIdentity, passport, artifacts, now, ttlMs: 60_000 });
  return { registry, passportIdentity, attestationIdentity, passport, artifacts, bundle };
}

function reseal(bundle: OfflineVerificationBundle, patch: Partial<Omit<OfflineVerificationBundle, 'bundleDigest'>>): OfflineVerificationBundle {
  const material = {
    version: patch.version ?? bundle.version,
    passport: patch.passport ?? bundle.passport,
    attestation: patch.attestation ?? bundle.attestation,
    trustSnapshot: patch.trustSnapshot ?? bundle.trustSnapshot,
    artifacts: patch.artifacts ?? bundle.artifacts,
  };
  return { ...material, bundleDigest: sha256(material) };
}

test('offline bundle creation rejects every invalid artifact and TTL branch', () => {
  const h = fixture();
  const create = (artifacts: typeof h.artifacts, ttlMs = 60_000) => createOfflineVerificationBundle({
    registry: h.registry, passportIdentity: h.passportIdentity, attestationIdentity: h.attestationIdentity,
    passport: h.passport, artifacts, now, ttlMs,
  });
  assert.throws(() => create([], 60_000), /offline_artifact_manifest_required/);
  assert.throws(() => create(h.artifacts, 0), /offline_bundle_ttl_required/);
  assert.throws(() => create([{ ...h.artifacts[0]!, name: '' }]), /invalid_or_duplicate_offline_artifact/);
  assert.throws(() => create([h.artifacts[0]!, h.artifacts[0]!]), /invalid_or_duplicate_offline_artifact/);
  assert.throws(() => create([{ ...h.artifacts[0]!, digest: 'ABC' }]), /invalid_offline_artifact_digest/);
  assert.throws(() => create([{ ...h.artifacts[0]!, mediaType: '' }]), /invalid_offline_artifact_metadata/);
  assert.throws(() => create([{ ...h.artifacts[0]!, byteLength: 1.5 }]), /invalid_offline_artifact_metadata/);
  assert.throws(() => create([{ ...h.artifacts[0]!, byteLength: -1 }]), /invalid_offline_artifact_metadata/);
});

test('verification reports digest, trust, artifact and signature failures independently', () => {
  const h = fixture();
  assert.ok(verifyOfflineVerificationBundle({ ...h.bundle, bundleDigest: 'bad' }, { now, minimumTrustEpoch: h.bundle.trustSnapshot.epoch }).failures.includes('bundle_digest_invalid'));

  const invalidSnapshot = { ...h.bundle.trustSnapshot, root: 'bad' };
  const invalidTrust = verifyOfflineVerificationBundle(reseal(h.bundle, { trustSnapshot: invalidSnapshot }), { now, minimumTrustEpoch: h.bundle.trustSnapshot.epoch });
  assert.ok(invalidTrust.failures.includes('trust_snapshot_invalid'));

  const badArtifacts = [{ ...h.bundle.artifacts[0]!, byteLength: -1 }];
  const invalidArtifacts = verifyOfflineVerificationBundle(reseal(h.bundle, { artifacts: badArtifacts }), { now, minimumTrustEpoch: h.bundle.trustSnapshot.epoch });
  assert.ok(invalidArtifacts.failures.includes('invalid_offline_artifact_metadata'));

  const badPassport = { ...h.bundle.passport, signature: Buffer.alloc(64).toString('base64url') };
  const passportFailure = verifyOfflineVerificationBundle(reseal(h.bundle, { passport: badPassport }), { now, minimumTrustEpoch: h.bundle.trustSnapshot.epoch });
  assert.ok(passportFailure.failures.includes('passport_signature_invalid_or_revoked'));

  const badAttestation = { ...h.bundle.attestation, signature: Buffer.alloc(64).toString('base64url') };
  const attestationFailure = verifyOfflineVerificationBundle(reseal(h.bundle, { attestation: badAttestation }), { now, minimumTrustEpoch: h.bundle.trustSnapshot.epoch });
  assert.ok(attestationFailure.failures.includes('attestation_signature_invalid_or_revoked'));
});

test('verification reports every cross-object binding and epoch branch', () => {
  const h = fixture();
  const tenantAttestation = { ...h.bundle.attestation, payload: { ...h.bundle.attestation.payload, tenantId: 'tenant-2' } };
  assert.ok(verifyOfflineVerificationBundle(reseal(h.bundle, { attestation: tenantAttestation }), { now, minimumTrustEpoch: h.bundle.trustSnapshot.epoch }).failures.includes('offline_bundle_tenant_mismatch'));

  const passportDigestAttestation = { ...h.bundle.attestation, payload: { ...h.bundle.attestation.payload, passportDigest: 'bad' } };
  assert.ok(verifyOfflineVerificationBundle(reseal(h.bundle, { attestation: passportDigestAttestation }), { now, minimumTrustEpoch: h.bundle.trustSnapshot.epoch }).failures.includes('offline_bundle_passport_digest_mismatch'));

  const evidenceAttestation = { ...h.bundle.attestation, payload: { ...h.bundle.attestation.payload, evidenceRoot: 'bad' } };
  assert.ok(verifyOfflineVerificationBundle(reseal(h.bundle, { attestation: evidenceAttestation }), { now, minimumTrustEpoch: h.bundle.trustSnapshot.epoch }).failures.includes('offline_bundle_evidence_root_mismatch'));

  const artifactAttestation = { ...h.bundle.attestation, payload: { ...h.bundle.attestation.payload, artifactManifestRoot: 'bad' } };
  assert.ok(verifyOfflineVerificationBundle(reseal(h.bundle, { attestation: artifactAttestation }), { now, minimumTrustEpoch: h.bundle.trustSnapshot.epoch }).failures.includes('offline_bundle_artifact_manifest_mismatch'));

  const epochAttestation = { ...h.bundle.attestation, payload: { ...h.bundle.attestation.payload, requiredTrustEpoch: h.bundle.trustSnapshot.epoch + 1 } };
  assert.ok(verifyOfflineVerificationBundle(reseal(h.bundle, { attestation: epochAttestation }), { now, minimumTrustEpoch: h.bundle.trustSnapshot.epoch }).failures.includes('offline_bundle_epoch_mismatch'));

  const stale = verifyOfflineVerificationBundle(h.bundle, { now, minimumTrustEpoch: h.bundle.trustSnapshot.epoch + 1 });
  assert.ok(stale.failures.includes('trust_snapshot_stale'));
  assert.ok(stale.failures.includes('offline_bundle_epoch_mismatch'));

  const expiredAttestation = { ...h.bundle.attestation, payload: { ...h.bundle.attestation.payload, expiresAt: new Date(now.getTime() - 1).toISOString() } };
  assert.ok(verifyOfflineVerificationBundle(reseal(h.bundle, { attestation: expiredAttestation }), { now, minimumTrustEpoch: h.bundle.trustSnapshot.epoch }).failures.includes('offline_bundle_expired'));
});
