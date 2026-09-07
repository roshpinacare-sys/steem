import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  generateSigningIdentity,
  KeyRegistry,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../src/contracts/crypto.js';
import type { QualificationActorDescriptorV33_36 } from '../src/app/external-https-monitor-qualification-v33_36.js';
import {
  createRemoteAttestationEvidenceV33_40,
  createSignedHsmAdapterManifestV33_40,
  type HsmInteroperabilityVerdictV33_40,
} from '../src/app/hsm-interoperability-remote-attestation-v33_40.js';
import {
  createAttestationRevocationSnapshotV33_41,
  createProviderCheckpointAnchorV33_41,
  createProviderCheckpointMonitorReceiptV33_41,
  createProviderConformanceReceiptV33_41,
  createProviderReplacementApprovalV33_41,
  createProviderSiteRecoveryReceiptV33_41,
  createProviderTrustRootManifestV33_41,
  finalizeProviderReplacementV33_41,
  verifyAttestationRevocationSnapshotV33_41,
  verifyExternalProviderOnboardingQualificationV33_41,
  verifyProviderCheckpointV33_41,
  verifyProviderConformanceReceiptsV33_41,
  verifyProviderReplacementV33_41,
  verifyProviderSiteRecoveryV33_41,
  verifyProviderTrustRootsV33_41,
  type ProviderOnboardingTrustV33_41,
  type ProviderReplacementApprovalV33_41,
} from '../src/app/external-provider-onboarding-conformance-v33_41.js';

const now = new Date('2026-07-23T10:00:00.000Z');
const validFrom = new Date('2026-07-22T10:00:00.000Z');
const expires = new Date('2026-08-23T10:00:00.000Z');

function registry(ids: readonly SigningIdentity[]): KeyRegistry {
  const r = new KeyRegistry();
  for (const id of ids) r.register(id.keyId, id.publicKey);
  return r;
}
function actor(id: SigningIdentity, name: string): QualificationActorDescriptorV33_36 {
  const r = registry([id]);
  return {
    keyId: id.keyId,
    keyFingerprint: r.fingerprint(id.keyId)!,
    organizationId: `org-${name}`,
    hostId: `host-${name}`,
    administratorId: `admin-${name}`,
  };
}
function priorVerdict(): HsmInteroperabilityVerdictV33_40 {
  const material = {
    version: '33.40' as const,
    priorV33_39VerdictDigest: sha256({ prior: 39 }),
    adapterManifestCount: 3,
    providerCount: 3,
    remoteAttestationCount: 5,
    thresholdCertificateDigest: sha256({ threshold: 40 }),
    checkpointDigest: sha256({ checkpoint: 40 }),
    monitorReceiptCount: 3,
    crossSiteRecoveryDigest: sha256({ recovery: 40 }),
    status: 'LOCAL_MULTI_PROVIDER_INTEROP_REHEARSAL_ONLY' as const,
    externalTopologyObserved: false,
    externalHardwareObserved: false,
    externalHumanParticipants: 0 as const,
    verifiedAt: now.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, verdictDigest: sha256(material) };
}

function setup() {
  const providers = ['provider-pkcs11', 'provider-aws', 'provider-azure', 'provider-gcp'] as const;
  const adapterSigners = providers.map((p) => generateSigningIdentity(`adapter-${p}`));
  const attestationAuthorities = providers.map((p) => generateSigningIdentity(`attest-${p}`));
  const rootRegistrars = providers.map((p) => generateSigningIdentity(`root-registrar-${p}`));
  const laboratories = providers.map((p) => generateSigningIdentity(`lab-${p}`));
  const roleKeys = providers.map((p) => generateSigningIdentity(`role-${p}`));
  const revocationAuthority = generateSigningIdentity('revocation-authority');
  const custodians = [0, 1, 2, 3, 4].map((i) => generateSigningIdentity(`replacement-custodian-${i}`));
  const replacementAuthority = generateSigningIdentity('replacement-authority');
  const publicationAuthority = generateSigningIdentity('provider-publication-authority');
  const publisher = generateSigningIdentity('provider-publisher');
  const monitors = [0, 1, 2].map((i) => generateSigningIdentity(`provider-monitor-${i}`));
  const recoveryVerifier = generateSigningIdentity('provider-recovery-verifier');

  const trust: ProviderOnboardingTrustV33_41 = {
    adapterSignerRegistry: registry(adapterSigners), trustedAdapterSignerIds: adapterSigners.map((x) => x.keyId),
    attestationAuthorityRegistry: registry(attestationAuthorities), trustedAttestationAuthorityIds: attestationAuthorities.map((x) => x.keyId),
    rootRegistrarRegistry: registry(rootRegistrars), trustedRootRegistrarIds: rootRegistrars.map((x) => x.keyId),
    conformanceLaboratoryRegistry: registry(laboratories), trustedConformanceLaboratoryIds: laboratories.map((x) => x.keyId),
    revocationAuthorityRegistry: registry([revocationAuthority]), trustedRevocationAuthorityIds: [revocationAuthority.keyId],
    custodianRegistry: registry(custodians), trustedCustodianIds: custodians.map((x) => x.keyId),
    replacementAuthorityRegistry: registry([replacementAuthority]), trustedReplacementAuthorityIds: [replacementAuthority.keyId],
    publicationAuthorityRegistry: registry([publicationAuthority]), trustedPublicationAuthorityIds: [publicationAuthority.keyId],
    monitorRegistry: registry(monitors), trustedMonitorIds: monitors.map((x) => x.keyId),
    recoveryVerifierRegistry: registry([recoveryVerifier]), trustedRecoveryVerifierIds: [recoveryVerifier.keyId],
  };

  const moduleBytes = providers.map((p) => Buffer.from(`adapter-module-${p}`));
  const manifestConfig = [
    ['PKCS11_GENERIC', 'PKCS11-3.1'],
    ['AWS_CLOUDHSM', 'PROVIDER_NATIVE_SIGNING_API'],
    ['AZURE_MANAGED_HSM', 'PROVIDER_NATIVE_SIGNING_API'],
    ['GCP_CLOUD_HSM', 'PROVIDER_NATIVE_SIGNING_API'],
  ] as const;
  const manifests = providers.map((providerId, i) => createSignedHsmAdapterManifestV33_40({
    signer: adapterSigners[i]!, adapterClass: manifestConfig[i]![0], providerId, moduleName: `module-${providerId}`,
    moduleVersion: '1.0.0', moduleBytes: moduleBytes[i]!, interfaceStandard: manifestConfig[i]![1], abi: 'linux-x64',
    conformanceVectorDigest: sha256({ providerId, vector: 1 }), issuedAt: now, expiresAt: expires, executionClass: 'LOCAL_INTEROP_REHEARSAL',
  }));

  const moduleMap = new Map(manifests.map((m, i) => [m.payload.manifestDigest, moduleBytes[i]!]));

  const attestationDocuments = providers.map((p) => Buffer.from(`attestation-document-${p}`));
  const attestationChallenges = providers.map((p) => Buffer.from(`attestation-challenge-${p}-long`));
  const attestations = providers.map((providerId, i) => createRemoteAttestationEvidenceV33_40({
    authority: attestationAuthorities[i]!, adapterManifest: manifests[i]!.payload, roleKeyId: roleKeys[i]!.keyId,
    roleKeyFingerprint: registry([roleKeys[i]!]).fingerprint(roleKeys[i]!.keyId)!, deviceId: `device-${providerId}`,
    firmwareDigest: sha256({ providerId, firmware: 1 }), attestationDocument: attestationDocuments[i]!, challenge: attestationChallenges[i]!,
    observedAt: now, expiresAt: expires, executionClass: 'LOCAL_INTEROP_REHEARSAL',
  }));

  const rootBytes = providers.map((p) => Buffer.from(`public-root-certificate-${p}`));
  const roots = providers.map((providerId, i) => createProviderTrustRootManifestV33_41({
    registrar: rootRegistrars[i]!, providerId, rootClass: i === 0 ? 'PKCS11_VENDOR_ROOT' : 'CLOUD_HSM_ATTESTATION_ROOT',
    rootCertificateBytes: rootBytes[i]!, policyDigest: sha256({ providerId, policy: 1 }), publicDocumentationDigest: sha256({ providerId, docs: 1 }),
    validFrom, validUntil: expires, executionClass: 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL',
  }));
  const rootMap = new Map(roots.map((r, i) => [r.payload.rootManifestDigest, rootBytes[i]!]));

  const nonces = providers.map((p) => Buffer.from(`session-nonce-${p}-0123456789`));
  const conformance = providers.map((providerId, i) => createProviderConformanceReceiptV33_41({
    laboratory: laboratories[i]!, laboratoryDescriptor: actor(laboratories[i]!, `lab-${i}`), providerId,
    trustRootManifest: roots[i]!.payload, adapterManifest: manifests[i]!.payload, remoteAttestation: attestations[i]!.payload,
    deviceId: attestations[i]!.payload.deviceId, tokenSerialDigest: sha256({ providerId, serial: 1 }), sessionNonce: nonces[i]!,
    testVectorDigest: sha256({ providerId, conformance: 1 }), hardwareSessionObserved: false, executedAt: now, expiresAt: expires,
    executionClass: 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL',
  }));
  const nonceMap = new Map(conformance.map((r, i) => [r.payload.receiptDigest, nonces[i]!]));

  const revocation = createAttestationRevocationSnapshotV33_41({
    authority: revocationAuthority, sequence: 1, trustRootManifestDigests: roots.map((r) => r.payload.rootManifestDigest),
    revokedAttestationDigests: [attestations[0]!.payload.evidenceDigest], revokedDeviceIds: [attestations[0]!.payload.deviceId],
    effectiveAt: now, executionClass: 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL',
  });

  const activeBefore = ['provider-pkcs11', 'provider-aws', 'provider-azure', 'provider-dedicated', 'provider-spare'].sort();
  const previousReplacementDigest = sha256({ replacement: 'previous' });
  const replacementSequence = 1;
  const planDigest = sha256({
    previousReplacementDigest, replacementSequence, oldProviderId: providers[0], oldAttestationDigest: attestations[0]!.payload.evidenceDigest,
    newProviderId: providers[3], newTrustRootManifestDigest: roots[3]!.payload.rootManifestDigest,
    newConformanceReceiptDigest: conformance[3]!.payload.receiptDigest, revocationSnapshotDigest: revocation.payload.snapshotDigest,
    activeProviderIdsBefore: activeBefore,
  });
  const replacementApprovals = custodians.slice(0, 3).map((custodian, i) => createProviderReplacementApprovalV33_41({
    custodian, descriptor: actor(custodian, `custodian-${i}`), replacementPlanDigest: planDigest, shareIndex: i + 1, approvedAt: now,
  }));
  const replacement = finalizeProviderReplacementV33_41({
    authority: replacementAuthority, previousReplacementDigest, replacementSequence, oldProviderId: providers[0], oldAttestation: attestations[0]!.payload,
    newProviderId: providers[3], newTrustRoot: roots[3]!.payload, newConformanceReceipt: conformance[3]!.payload,
    revocationSnapshot: revocation.payload, activeProviderIdsBefore: activeBefore, approvals: replacementApprovals, trust, issuedAt: now,
  });

  const checkpointBytes = Buffer.from('provider onboarding checkpoint v33.41');
  const checkpointAnchor = createProviderCheckpointAnchorV33_41({
    authority: publicationAuthority, priorV33_40Verdict: priorVerdict(), roots: roots.map((r) => r.payload),
    conformanceReceipts: conformance.map((r) => r.payload), revocationSnapshot: revocation.payload, replacementCertificate: replacement.payload,
    previousAnchorDigest: sha256({ anchor: 'previous' }), anchorSequence: 1, checkpointBytes,
    endpoint: 'https://checkpoint.local/v33.41.json', publisher: actor(publisher, 'publisher'), publicNetworkRetrievalObserved: false,
    publishedAt: now, executionClass: 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL',
  });
  const monitorProviders = ['monitor-provider-a', 'monitor-provider-b', 'monitor-provider-c'];
  const monitorReceipts = monitors.map((monitor, i) => createProviderCheckpointMonitorReceiptV33_41({
    monitor, descriptor: actor(monitor, `monitor-${i}`), providerId: monitorProviders[i]!, anchor: checkpointAnchor.payload,
    retrievedBytes: checkpointBytes, retrievedAt: now, networkClass: 'LOCAL_LOOPBACK',
  }));
  const siteRecovery = createProviderSiteRecoveryReceiptV33_41({
    verifier: recoveryVerifier, descriptor: actor(recoveryVerifier, 'recovery'), previousRecoveryDigest: sha256({ recovery: 'previous' }),
    recoverySequence: 1, sourceSiteId: 'site-a', targetSiteId: 'site-b', sourceProviderId: 'provider-aws', targetProviderId: 'provider-gcp',
    anchor: checkpointAnchor.payload, replacementCertificate: replacement.payload, restoredBytes: checkpointBytes, recoveredAt: now,
    executionClass: 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL',
  });

  const final = () => verifyExternalProviderOnboardingQualificationV33_41({
    priorV33_40Verdict: priorVerdict(), roots, rootCertificateBytesByManifestDigest: rootMap, manifests, moduleBytesByManifestDigest: moduleMap,
    attestations, conformanceReceipts: conformance, sessionNoncesByReceiptDigest: nonceMap,
    revocationSnapshot: revocation, replacementCertificate: replacement, replacementApprovals, oldAttestation: attestations[0]!.payload,
    newTrustRoot: roots[3]!.payload, newConformanceReceipt: conformance[3]!.payload, checkpointAnchor, checkpointBytes, monitorReceipts,
    siteRecoveryReceipt: siteRecovery, restoredBytes: checkpointBytes, trust, verifiedAt: now,
  });

  return {
    providers, adapterSigners, attestationAuthorities, rootRegistrars, laboratories, roleKeys, revocationAuthority, custodians,
    replacementAuthority, publicationAuthority, publisher, monitors, recoveryVerifier, trust, moduleBytes, moduleMap, manifests, attestations,
    rootBytes, roots, rootMap, nonces, conformance, nonceMap, revocation, activeBefore, previousReplacementDigest,
    replacementSequence, planDigest, replacementApprovals, replacement, checkpointBytes, checkpointAnchor, monitorProviders,
    monitorReceipts, siteRecovery, final,
  };
}

const s = setup();

test('provider trust roots verify across four providers', () => assert.equal(verifyProviderTrustRootsV33_41({ roots: s.roots, rootCertificateBytesByManifestDigest: s.rootMap, trust: s.trust, verifiedAt: now }).length, 4));
test('trust root byte substitution is rejected', () => { const m = new Map(s.rootMap); m.set(s.roots[0]!.payload.rootManifestDigest, Buffer.from('bad')); assert.throws(() => verifyProviderTrustRootsV33_41({ roots: s.roots, rootCertificateBytesByManifestDigest: m, trust: s.trust, verifiedAt: now })); });
test('trust root duplicate provider is rejected', () => { const base = s.roots[1]!.payload; const material = { ...base, providerId: s.roots[0]!.payload.providerId }; delete (material as any).rootManifestDigest; const duplicate = signEnvelope({ ...material, rootManifestDigest: sha256(material) }, s.rootRegistrars[1]!); assert.throws(() => verifyProviderTrustRootsV33_41({ roots: [s.roots[0]!, duplicate, s.roots[2]!], rootCertificateBytesByManifestDigest: s.rootMap, trust: s.trust, verifiedAt: now })); });
test('expired trust root is rejected', () => assert.throws(() => verifyProviderTrustRootsV33_41({ roots: s.roots, rootCertificateBytesByManifestDigest: s.rootMap, trust: s.trust, verifiedAt: new Date('2027-01-01T00:00:00Z') })));
test('trust root requires quorum', () => assert.throws(() => verifyProviderTrustRootsV33_41({ roots: s.roots.slice(0, 2), rootCertificateBytesByManifestDigest: s.rootMap, trust: s.trust, verifiedAt: now })));

test('provider conformance receipts verify exact device sessions', () => assert.equal(verifyProviderConformanceReceiptsV33_41({ receipts: s.conformance, roots: s.roots.map((r) => r.payload), manifests: s.manifests, moduleBytesByManifestDigest: s.moduleMap, attestations: s.attestations, sessionNoncesByReceiptDigest: s.nonceMap, trust: s.trust, verifiedAt: now }).length, 4));
test('conformance session nonce substitution is rejected', () => { const m = new Map(s.nonceMap); m.set(s.conformance[0]!.payload.receiptDigest, Buffer.from('bad')); assert.throws(() => verifyProviderConformanceReceiptsV33_41({ receipts: s.conformance, roots: s.roots.map((r) => r.payload), manifests: s.manifests, moduleBytesByManifestDigest: s.moduleMap, attestations: s.attestations, sessionNoncesByReceiptDigest: m, trust: s.trust, verifiedAt: now })); });
test('conformance provider rebinding is rejected', () => { const base = s.conformance[0]!.payload; const material = { ...base, providerId: 'provider-aws' }; delete (material as any).receiptDigest; const bad = signEnvelope({ ...material, receiptDigest: sha256(material) }, s.laboratories[0]!); assert.throws(() => verifyProviderConformanceReceiptsV33_41({ receipts: [bad, ...s.conformance.slice(1)], roots: s.roots.map((r) => r.payload), manifests: s.manifests, moduleBytesByManifestDigest: s.moduleMap, attestations: s.attestations, sessionNoncesByReceiptDigest: s.nonceMap, trust: s.trust, verifiedAt: now })); });
test('duplicate laboratory topology is rejected', () => { const base = s.conformance[1]!.payload; const material = { ...base, laboratory: s.conformance[0]!.payload.laboratory }; delete (material as any).receiptDigest; const bad = signEnvelope({ ...material, receiptDigest: sha256(material) }, s.laboratories[1]!); const map = new Map(s.nonceMap); map.set(bad.payload.receiptDigest, s.nonces[1]!); assert.throws(() => verifyProviderConformanceReceiptsV33_41({ receipts: [s.conformance[0]!, bad, ...s.conformance.slice(2)], roots: s.roots.map((r) => r.payload), manifests: s.manifests, moduleBytesByManifestDigest: s.moduleMap, attestations: s.attestations, sessionNoncesByReceiptDigest: map, trust: s.trust, verifiedAt: now })); });
test('live conformance requires observed hardware session', () => assert.throws(() => createProviderConformanceReceiptV33_41({ laboratory: s.laboratories[0]!, laboratoryDescriptor: actor(s.laboratories[0]!, 'live-lab'), providerId: s.providers[0], trustRootManifest: s.roots[0]!.payload, adapterManifest: s.manifests[0]!.payload, remoteAttestation: s.attestations[0]!.payload, deviceId: s.attestations[0]!.payload.deviceId, tokenSerialDigest: sha256({ serial: 1 }), sessionNonce: Buffer.from('0123456789abcdef'), testVectorDigest: sha256({ vector: 1 }), hardwareSessionObserved: false, executedAt: now, expiresAt: expires, executionClass: 'LIVE_EXTERNAL_PROVIDER_CONFORMANCE' })));

test('attestation revocation snapshot verifies monotonic genesis', () => assert.equal(verifyAttestationRevocationSnapshotV33_41({ snapshot: s.revocation, roots: s.roots.map((r) => r.payload), trust: s.trust, verifiedAt: now }).sequence, 1));
test('revocation rollback is rejected', () => { const previous = s.revocation.payload; assert.throws(() => createAttestationRevocationSnapshotV33_41({ authority: s.revocationAuthority, sequence: 2, previousSnapshot: previous, trustRootManifestDigests: s.roots.map((r) => r.payload.rootManifestDigest), revokedAttestationDigests: [sha256({ other: 1 })], revokedDeviceIds: ['other-device'], effectiveAt: now, executionClass: 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL' })); });
test('revocation sequence gap is rejected', () => assert.throws(() => createAttestationRevocationSnapshotV33_41({ authority: s.revocationAuthority, sequence: 3, previousSnapshot: s.revocation.payload, trustRootManifestDigests: s.roots.map((r) => r.payload.rootManifestDigest), revokedAttestationDigests: s.revocation.payload.revokedAttestationDigests, revokedDeviceIds: s.revocation.payload.revokedDeviceIds, effectiveAt: now, executionClass: 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL' })));
test('future revocation is not yet effective', () => { const future = createAttestationRevocationSnapshotV33_41({ authority: s.revocationAuthority, sequence: 1, trustRootManifestDigests: s.roots.map((r) => r.payload.rootManifestDigest), revokedAttestationDigests: s.revocation.payload.revokedAttestationDigests, revokedDeviceIds: s.revocation.payload.revokedDeviceIds, effectiveAt: new Date('2026-07-24T00:00:00Z'), executionClass: 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL' }); assert.throws(() => verifyAttestationRevocationSnapshotV33_41({ snapshot: future, roots: s.roots.map((r) => r.payload), trust: s.trust, verifiedAt: now })); });

test('provider replacement preserves five-provider set and fences old provider', () => { const c = verifyProviderReplacementV33_41({ certificate: s.replacement, approvals: s.replacementApprovals, oldAttestation: s.attestations[0]!.payload, newTrustRoot: s.roots[3]!.payload, newConformanceReceipt: s.conformance[3]!.payload, revocationSnapshot: s.revocation.payload, trust: s.trust, verifiedAt: now }); assert.equal(c.activeProviderIdsAfter.length, 5); assert.equal(c.oldProviderFenced, true); });
test('provider replacement requires three custodians', () => assert.throws(() => finalizeProviderReplacementV33_41({ authority: s.replacementAuthority, previousReplacementDigest: s.previousReplacementDigest, replacementSequence: s.replacementSequence, oldProviderId: s.providers[0], oldAttestation: s.attestations[0]!.payload, newProviderId: s.providers[3], newTrustRoot: s.roots[3]!.payload, newConformanceReceipt: s.conformance[3]!.payload, revocationSnapshot: s.revocation.payload, activeProviderIdsBefore: s.activeBefore, approvals: s.replacementApprovals.slice(0, 2), trust: s.trust, issuedAt: now })));
test('provider replacement requires old attestation revocation', () => { const bad = { ...s.revocation.payload, revokedAttestationDigests: [sha256({ other: 1 })] }; assert.throws(() => finalizeProviderReplacementV33_41({ authority: s.replacementAuthority, previousReplacementDigest: s.previousReplacementDigest, replacementSequence: 1, oldProviderId: s.providers[0], oldAttestation: s.attestations[0]!.payload, newProviderId: s.providers[3], newTrustRoot: s.roots[3]!.payload, newConformanceReceipt: s.conformance[3]!.payload, revocationSnapshot: bad, activeProviderIdsBefore: s.activeBefore, approvals: s.replacementApprovals, trust: s.trust, issuedAt: now })); });
test('replacement cannot onboard provider already active', () => assert.throws(() => finalizeProviderReplacementV33_41({ authority: s.replacementAuthority, previousReplacementDigest: s.previousReplacementDigest, replacementSequence: 1, oldProviderId: s.providers[0], oldAttestation: s.attestations[0]!.payload, newProviderId: s.providers[1], newTrustRoot: s.roots[1]!.payload, newConformanceReceipt: s.conformance[1]!.payload, revocationSnapshot: s.revocation.payload, activeProviderIdsBefore: s.activeBefore, approvals: s.replacementApprovals, trust: s.trust, issuedAt: now })));
test('duplicate replacement custodian approval is rejected', () => assert.throws(() => finalizeProviderReplacementV33_41({ authority: s.replacementAuthority, previousReplacementDigest: s.previousReplacementDigest, replacementSequence: 1, oldProviderId: s.providers[0], oldAttestation: s.attestations[0]!.payload, newProviderId: s.providers[3], newTrustRoot: s.roots[3]!.payload, newConformanceReceipt: s.conformance[3]!.payload, revocationSnapshot: s.revocation.payload, activeProviderIdsBefore: s.activeBefore, approvals: [s.replacementApprovals[0]!, s.replacementApprovals[0]!, s.replacementApprovals[2]!], trust: s.trust, issuedAt: now })));
test('tampered replacement certificate is rejected', () => { const bad = { ...s.replacement, payload: { ...s.replacement.payload, replacementSequence: 2 } }; assert.throws(() => verifyProviderReplacementV33_41({ certificate: bad, approvals: s.replacementApprovals, oldAttestation: s.attestations[0]!.payload, newTrustRoot: s.roots[3]!.payload, newConformanceReceipt: s.conformance[3]!.payload, revocationSnapshot: s.revocation.payload, trust: s.trust, verifiedAt: now })); });

test('provider checkpoint anchor verifies three durable monitor receipts', () => assert.equal(verifyProviderCheckpointV33_41({ anchor: s.checkpointAnchor, checkpointBytes: s.checkpointBytes, receipts: s.monitorReceipts, priorV33_40Verdict: priorVerdict(), roots: s.roots.map((r) => r.payload), conformanceReceipts: s.conformance.map((r) => r.payload), revocationSnapshot: s.revocation.payload, replacementCertificate: s.replacement.payload, trust: s.trust, verifiedAt: now }).anchorSequence, 1));
test('checkpoint byte substitution is rejected', () => assert.throws(() => verifyProviderCheckpointV33_41({ anchor: s.checkpointAnchor, checkpointBytes: Buffer.from('bad'), receipts: s.monitorReceipts, priorV33_40Verdict: priorVerdict(), roots: s.roots.map((r) => r.payload), conformanceReceipts: s.conformance.map((r) => r.payload), revocationSnapshot: s.revocation.payload, replacementCertificate: s.replacement.payload, trust: s.trust, verifiedAt: now })));
test('checkpoint requires three monitor receipts', () => assert.throws(() => verifyProviderCheckpointV33_41({ anchor: s.checkpointAnchor, checkpointBytes: s.checkpointBytes, receipts: s.monitorReceipts.slice(0, 2), priorV33_40Verdict: priorVerdict(), roots: s.roots.map((r) => r.payload), conformanceReceipts: s.conformance.map((r) => r.payload), revocationSnapshot: s.revocation.payload, replacementCertificate: s.replacement.payload, trust: s.trust, verifiedAt: now })));
test('checkpoint monitor provider diversity is required', () => { const receipts = s.monitorReceipts.map((e, i) => { const material = { ...e.payload, providerId: 'same-provider' }; delete (material as any).receiptDigest; return signEnvelope({ ...material, receiptDigest: sha256(material) }, s.monitors[i]!); }); assert.throws(() => verifyProviderCheckpointV33_41({ anchor: s.checkpointAnchor, checkpointBytes: s.checkpointBytes, receipts, priorV33_40Verdict: priorVerdict(), roots: s.roots.map((r) => r.payload), conformanceReceipts: s.conformance.map((r) => r.payload), revocationSnapshot: s.revocation.payload, replacementCertificate: s.replacement.payload, trust: s.trust, verifiedAt: now })); });
test('live checkpoint requires public HTTPS retrieval', () => assert.throws(() => createProviderCheckpointAnchorV33_41({ authority: s.publicationAuthority, priorV33_40Verdict: priorVerdict(), roots: s.roots.map((r) => r.payload), conformanceReceipts: s.conformance.map((r) => r.payload), revocationSnapshot: s.revocation.payload, replacementCertificate: s.replacement.payload, previousAnchorDigest: sha256({ p: 1 }), anchorSequence: 2, checkpointBytes: s.checkpointBytes, endpoint: 'https://checkpoint.local/v', publisher: actor(s.publisher, 'live-publisher'), publicNetworkRetrievalObserved: false, publishedAt: now, executionClass: 'LIVE_EXTERNAL_PROVIDER_CONFORMANCE' })));

test('site recovery verifies exact bytes across sites and providers', () => assert.equal(verifyProviderSiteRecoveryV33_41({ receipt: s.siteRecovery, anchor: s.checkpointAnchor.payload, replacementCertificate: s.replacement.payload, restoredBytes: s.checkpointBytes, trust: s.trust, verifiedAt: now }).recoverySequence, 1));
test('site recovery requires distinct sites', () => assert.throws(() => createProviderSiteRecoveryReceiptV33_41({ verifier: s.recoveryVerifier, descriptor: actor(s.recoveryVerifier, 'same-site'), previousRecoveryDigest: sha256({ p: 1 }), recoverySequence: 2, sourceSiteId: 'site-a', targetSiteId: 'site-a', sourceProviderId: 'p1', targetProviderId: 'p2', anchor: s.checkpointAnchor.payload, replacementCertificate: s.replacement.payload, restoredBytes: s.checkpointBytes, recoveredAt: now, executionClass: 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL' })));
test('site recovery requires distinct providers', () => assert.throws(() => createProviderSiteRecoveryReceiptV33_41({ verifier: s.recoveryVerifier, descriptor: actor(s.recoveryVerifier, 'same-provider'), previousRecoveryDigest: sha256({ p: 1 }), recoverySequence: 2, sourceSiteId: 'site-a', targetSiteId: 'site-b', sourceProviderId: 'p1', targetProviderId: 'p1', anchor: s.checkpointAnchor.payload, replacementCertificate: s.replacement.payload, restoredBytes: s.checkpointBytes, recoveredAt: now, executionClass: 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL' })));
test('site recovery restored byte substitution is rejected', () => assert.throws(() => verifyProviderSiteRecoveryV33_41({ receipt: s.siteRecovery, anchor: s.checkpointAnchor.payload, replacementCertificate: s.replacement.payload, restoredBytes: Buffer.from('bad'), trust: s.trust, verifiedAt: now })));

test('full provider onboarding qualification remains local-only and blocked', () => { const v = s.final(); assert.equal(v.status, 'LOCAL_PROVIDER_ONBOARDING_CONFORMANCE_REHEARSAL_ONLY'); assert.equal(v.externalTrustRootsObserved, false); assert.equal(v.productionAuthority, 'NONE'); assert.equal(v.externalEffectsExecuted, 0); });
test('prior v33.40 verdict mutation is rejected', () => { const prior = { ...priorVerdict(), status: 'EXTERNAL_MULTI_PROVIDER_INTEROP_EVIDENCE_ACCEPTED' as const }; assert.throws(() => verifyExternalProviderOnboardingQualificationV33_41({ priorV33_40Verdict: prior, roots: s.roots, rootCertificateBytesByManifestDigest: s.rootMap, manifests: s.manifests, moduleBytesByManifestDigest: s.moduleMap, attestations: s.attestations, conformanceReceipts: s.conformance, sessionNoncesByReceiptDigest: s.nonceMap, revocationSnapshot: s.revocation, replacementCertificate: s.replacement, replacementApprovals: s.replacementApprovals, oldAttestation: s.attestations[0]!.payload, newTrustRoot: s.roots[3]!.payload, newConformanceReceipt: s.conformance[3]!.payload, checkpointAnchor: s.checkpointAnchor, checkpointBytes: s.checkpointBytes, monitorReceipts: s.monitorReceipts, siteRecoveryReceipt: s.siteRecovery, restoredBytes: s.checkpointBytes, trust: s.trust, verifiedAt: now })); });
test('all v33.41 signed artifacts preserve zero-effect boundary', () => { const artifacts: SignedEnvelope<{ productionAuthority: 'NONE'; externalEffectsExecuted: 0 }>[] = [...s.roots, ...s.conformance, s.revocation, ...s.replacementApprovals, s.replacement, s.checkpointAnchor, ...s.monitorReceipts, s.siteRecovery]; for (const artifact of artifacts) { assert.equal(artifact.payload.productionAuthority, 'NONE'); assert.equal(artifact.payload.externalEffectsExecuted, 0); } });
