import type { ActionPassport } from '../contracts/canonical.js';
import { sha256, type SigningIdentity } from '../contracts/crypto.js';
import {
  KeyLifecycleRegistry,
  type PurposeBoundEnvelope,
  type TrustSnapshot,
} from '../security/key-lifecycle.js';

export interface OfflineArtifactDescriptor {
  readonly name: string;
  readonly digest: string;
  readonly mediaType: string;
  readonly byteLength: number;
}

export interface OfflineBundleAttestation {
  readonly tenantId: string;
  readonly passportDigest: string;
  readonly evidenceRoot: string;
  readonly artifactManifestRoot: string;
  readonly requiredTrustEpoch: number;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly limitations: readonly string[];
}

export interface OfflineVerificationBundle {
  readonly version: '1.0';
  readonly passport: PurposeBoundEnvelope<ActionPassport>;
  readonly attestation: PurposeBoundEnvelope<OfflineBundleAttestation>;
  readonly trustSnapshot: TrustSnapshot;
  readonly artifacts: readonly OfflineArtifactDescriptor[];
  readonly bundleDigest: string;
}

export interface OfflineVerificationResult {
  readonly ok: boolean;
  readonly failures: readonly string[];
  readonly tenantId: string;
  readonly evidenceRoot: string;
  readonly artifactCount: number;
  readonly trustEpoch: number;
  readonly verificationDigest: string;
}

export function createOfflineVerificationBundle(input: {
  readonly registry: KeyLifecycleRegistry;
  readonly passportIdentity: SigningIdentity;
  readonly attestationIdentity: SigningIdentity;
  readonly passport: ActionPassport;
  readonly artifacts: readonly OfflineArtifactDescriptor[];
  readonly now: Date;
  readonly ttlMs: number;
}): OfflineVerificationBundle {
  validateArtifacts(input.artifacts);
  if (input.ttlMs <= 0) throw new Error('offline_bundle_ttl_required');
  const artifacts = [...input.artifacts].sort((a, b) => a.name.localeCompare(b.name));
  const passport = input.registry.sign(input.passport, input.passportIdentity, {
    purpose: 'action-passport',
    environment: 'airgap',
    tenantId: input.passport.tenantId,
    nonce: `passport:${input.passport.passportId}`,
    issuedAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + input.ttlMs).toISOString(),
  });
  const snapshot = input.registry.snapshot(input.now);
  const attestationPayload: OfflineBundleAttestation = {
    tenantId: input.passport.tenantId,
    passportDigest: sha256(passport),
    evidenceRoot: input.passport.evidenceRoot,
    artifactManifestRoot: sha256(artifacts),
    requiredTrustEpoch: snapshot.epoch,
    generatedAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + input.ttlMs).toISOString(),
    limitations: ['offline-verification-proves-signatures-integrity-and-revocation-state-not-claim-truth'],
  };
  const attestation = input.registry.sign(attestationPayload, input.attestationIdentity, {
    purpose: 'evidence-attestation',
    environment: 'airgap',
    tenantId: input.passport.tenantId,
    nonce: `bundle:${input.passport.passportId}:${snapshot.epoch}`,
    issuedAt: input.now.toISOString(),
    expiresAt: attestationPayload.expiresAt,
  });
  const material = { version: '1.0' as const, passport, attestation, trustSnapshot: snapshot, artifacts };
  return { ...material, bundleDigest: sha256(material) };
}

export function verifyOfflineVerificationBundle(
  bundle: OfflineVerificationBundle,
  input: { readonly now: Date; readonly minimumTrustEpoch: number },
): OfflineVerificationResult {
  const failures: string[] = [];
  const { bundleDigest: _bundleDigest, ...material } = bundle;
  if (bundle.bundleDigest !== sha256(material)) failures.push('bundle_digest_invalid');
  if (!KeyLifecycleRegistry.verifySnapshot(bundle.trustSnapshot)) failures.push('trust_snapshot_invalid');
  if (bundle.trustSnapshot.epoch < input.minimumTrustEpoch) failures.push('trust_snapshot_stale');
  try { validateArtifacts(bundle.artifacts); } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
  const offline = KeyLifecycleRegistry.verifySnapshot(bundle.trustSnapshot)
    ? KeyLifecycleRegistry.fromSnapshot(bundle.trustSnapshot)
    : undefined;
  if (offline !== undefined) {
    if (!offline.verify(bundle.passport, {
      purpose: 'action-passport', environment: 'airgap', tenantId: bundle.passport.payload.tenantId,
      minimumEpoch: input.minimumTrustEpoch,
    }, input.now)) failures.push('passport_signature_invalid_or_revoked');
    if (!offline.verify(bundle.attestation, {
      purpose: 'evidence-attestation', environment: 'airgap', tenantId: bundle.passport.payload.tenantId,
      minimumEpoch: input.minimumTrustEpoch,
    }, input.now)) failures.push('attestation_signature_invalid_or_revoked');
  }
  const attestation = bundle.attestation.payload;
  if (Date.parse(attestation.expiresAt) <= input.now.getTime()) failures.push('offline_bundle_expired');
  if (attestation.tenantId !== bundle.passport.payload.tenantId) failures.push('offline_bundle_tenant_mismatch');
  if (attestation.passportDigest !== sha256(bundle.passport)) failures.push('offline_bundle_passport_digest_mismatch');
  if (attestation.evidenceRoot !== bundle.passport.payload.evidenceRoot) failures.push('offline_bundle_evidence_root_mismatch');
  if (attestation.artifactManifestRoot !== sha256([...bundle.artifacts].sort((a, b) => a.name.localeCompare(b.name)))) failures.push('offline_bundle_artifact_manifest_mismatch');
  if (attestation.requiredTrustEpoch !== bundle.trustSnapshot.epoch || attestation.requiredTrustEpoch < input.minimumTrustEpoch) failures.push('offline_bundle_epoch_mismatch');
  const result = {
    ok: failures.length === 0,
    failures,
    tenantId: bundle.passport.payload.tenantId,
    evidenceRoot: bundle.passport.payload.evidenceRoot,
    artifactCount: bundle.artifacts.length,
    trustEpoch: bundle.trustSnapshot.epoch,
  };
  return { ...result, verificationDigest: sha256(result) };
}

function validateArtifacts(artifacts: readonly OfflineArtifactDescriptor[]): void {
  if (artifacts.length === 0) throw new Error('offline_artifact_manifest_required');
  const names = new Set<string>();
  for (const artifact of artifacts) {
    if (artifact.name.trim() === '' || names.has(artifact.name)) throw new Error('invalid_or_duplicate_offline_artifact');
    names.add(artifact.name);
    if (!/^[a-f0-9]{64}$/.test(artifact.digest)) throw new Error('invalid_offline_artifact_digest');
    if (artifact.mediaType.trim() === '' || !Number.isInteger(artifact.byteLength) || artifact.byteLength < 0) throw new Error('invalid_offline_artifact_metadata');
  }
}
