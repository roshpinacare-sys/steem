import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generateSigningIdentity, KeyRegistry, sha256 } from '../dist/src/contracts/crypto.js';
import {
  createRemoteAttestationEvidenceV33_40,
  createSignedHsmAdapterManifestV33_40,
} from '../dist/src/app/hsm-interoperability-remote-attestation-v33_40.js';
import {
  createAttestationRevocationSnapshotV33_41,
  createProviderCheckpointAnchorV33_41,
  createProviderCheckpointMonitorReceiptV33_41,
  createProviderConformanceReceiptV33_41,
  createProviderReplacementApprovalV33_41,
  createProviderSiteRecoveryReceiptV33_41,
  createProviderTrustRootManifestV33_41,
  finalizeProviderReplacementV33_41,
  verifyExternalProviderOnboardingQualificationV33_41,
} from '../dist/src/app/external-provider-onboarding-conformance-v33_41.js';

const priorPath = resolve(process.argv[2] ?? 'release-evidence/v33.40/V33_40_HSM_INTEROPERABILITY_PROOF.json');
const output = resolve(process.argv[3] ?? 'release-evidence/v33.41/V33_41_PROVIDER_ONBOARDING_CONFORMANCE_PROOF.json');
const prior = JSON.parse(readFileSync(priorPath, 'utf8'));
const now = new Date('2026-07-23T10:00:00.000Z');
const validFrom = new Date('2026-07-22T10:00:00.000Z');
const expires = new Date('2026-08-23T10:00:00.000Z');
const newIdentities = [];
const make = (id) => { const x = generateSigningIdentity(id); newIdentities.push(x); return x; };
const registry = (ids) => { const r = new KeyRegistry(); for (const x of ids) r.register(x.keyId, x.publicKey); return r; };
const registryFromExported = (records, ids) => { const r = new KeyRegistry(); for (const id of ids) r.registerExported(records.find((x) => x.keyId === id)); return r; };
const descriptor = (id, n) => { const r = registry([id]); return { keyId: id.keyId, keyFingerprint: r.fingerprint(id.keyId), organizationId: `org-${n}`, hostId: `host-${n}`, administratorId: `admin-${n}` }; };
const exported = (id) => registry([id]).exportPublicKey(id.keyId);

const newAdapterSigner = make('v33.41-adapter-provider-gcp');
const newAttestationAuthority = make('v33.41-attestation-authority-provider-gcp');
const newRoleKey = make('v33.41-role-provider-gcp');
const rootRegistrars = [0, 1, 2, 3].map((i) => make(`v33.41-root-registrar-${i}`));
const laboratories = [0, 1, 2, 3].map((i) => make(`v33.41-conformance-lab-${i}`));
const revocationAuthority = make('v33.41-revocation-authority');
const custodians = [0, 1, 2, 3, 4].map((i) => make(`v33.41-replacement-custodian-${i}`));
const replacementAuthority = make('v33.41-replacement-authority');
const publicationAuthority = make('v33.41-publication-authority');
const publisher = make('v33.41-publisher');
const monitors = [0, 1, 2].map((i) => make(`v33.41-monitor-${i}`));
const recoveryVerifier = make('v33.41-recovery-verifier');

const newModuleBytes = Buffer.from('gcp provider adapter module v33.41');
const newManifest = createSignedHsmAdapterManifestV33_40({
  signer: newAdapterSigner, adapterClass: 'GCP_CLOUD_HSM', providerId: 'provider-gcp', moduleName: 'gcp-provider-adapter', moduleVersion: '1.0.0',
  moduleBytes: newModuleBytes, interfaceStandard: 'PROVIDER_NATIVE_SIGNING_API', abi: 'linux-x64',
  conformanceVectorDigest: sha256({ vector: 'v33.41-gcp' }), issuedAt: now, expiresAt: expires, executionClass: 'LOCAL_INTEROP_REHEARSAL',
});
const newAttestationDocument = Buffer.from('remote attestation document provider-gcp v33.41');
const newAttestationChallenge = Buffer.from('unique challenge provider-gcp v33.41');
const newAttestation = createRemoteAttestationEvidenceV33_40({
  authority: newAttestationAuthority, adapterManifest: newManifest.payload, roleKeyId: newRoleKey.keyId,
  roleKeyFingerprint: registry([newRoleKey]).fingerprint(newRoleKey.keyId), deviceId: 'device-provider-gcp', firmwareDigest: sha256({ firmware: 'gcp-v33.41' }),
  attestationDocument: newAttestationDocument, challenge: newAttestationChallenge, observedAt: now, expiresAt: expires, executionClass: 'LOCAL_INTEROP_REHEARSAL',
});

const oldProviders = ['provider-pkcs11', 'provider-aws', 'provider-azure'];
const priorManifestByProvider = new Map(prior.manifests.map((m) => [m.payload.providerId, m]));
const priorAttestationByProvider = new Map();
for (const a of prior.attestations) if (!priorAttestationByProvider.has(a.payload.providerId)) priorAttestationByProvider.set(a.payload.providerId, a);
const manifests = [...oldProviders.map((p) => priorManifestByProvider.get(p)), newManifest];
const attestations = [...oldProviders.map((p) => priorAttestationByProvider.get(p)), newAttestation];
if (manifests.some((x) => x === undefined) || attestations.some((x) => x === undefined)) throw new Error('v33_41_prior_provider_artifact_missing');
const priorModuleMap = new Map(prior.manifests.map((m, i) => [m.payload.manifestDigest, Buffer.from(prior.moduleBytesBase64[i], 'base64')]));
const moduleMap = new Map([...manifests.map((m) => [m.payload.manifestDigest, priorModuleMap.get(m.payload.manifestDigest)]), [newManifest.payload.manifestDigest, newModuleBytes]]);

const combinedAdapterSignerIds = [...prior.trustedIds.adapterSigners, newAdapterSigner.keyId];
const combinedAttestationAuthorityIds = [...prior.trustedIds.attestationAuthorities, newAttestationAuthority.keyId];
const combinedPublicKeys = [...prior.publicKeys, exported(newAdapterSigner), exported(newAttestationAuthority), exported(newRoleKey)];
const adapterRegistry = registryFromExported(combinedPublicKeys, combinedAdapterSignerIds);
const attestationRegistry = registryFromExported(combinedPublicKeys, combinedAttestationAuthorityIds);

const trust = {
  adapterSignerRegistry: adapterRegistry, trustedAdapterSignerIds: combinedAdapterSignerIds,
  attestationAuthorityRegistry: attestationRegistry, trustedAttestationAuthorityIds: combinedAttestationAuthorityIds,
  rootRegistrarRegistry: registry(rootRegistrars), trustedRootRegistrarIds: rootRegistrars.map((x) => x.keyId),
  conformanceLaboratoryRegistry: registry(laboratories), trustedConformanceLaboratoryIds: laboratories.map((x) => x.keyId),
  revocationAuthorityRegistry: registry([revocationAuthority]), trustedRevocationAuthorityIds: [revocationAuthority.keyId],
  custodianRegistry: registry(custodians), trustedCustodianIds: custodians.map((x) => x.keyId),
  replacementAuthorityRegistry: registry([replacementAuthority]), trustedReplacementAuthorityIds: [replacementAuthority.keyId],
  publicationAuthorityRegistry: registry([publicationAuthority]), trustedPublicationAuthorityIds: [publicationAuthority.keyId],
  monitorRegistry: registry(monitors), trustedMonitorIds: monitors.map((x) => x.keyId),
  recoveryVerifierRegistry: registry([recoveryVerifier]), trustedRecoveryVerifierIds: [recoveryVerifier.keyId],
};

const providers = [...oldProviders, 'provider-gcp'];
const rootBytes = providers.map((p) => Buffer.from(`public provider trust root ${p} v33.41`));
const roots = providers.map((providerId, i) => createProviderTrustRootManifestV33_41({
  registrar: rootRegistrars[i], providerId, rootClass: i === 0 ? 'PKCS11_VENDOR_ROOT' : 'CLOUD_HSM_ATTESTATION_ROOT', rootCertificateBytes: rootBytes[i],
  policyDigest: sha256({ providerId, policy: 'v33.41' }), publicDocumentationDigest: sha256({ providerId, docs: 'v33.41' }),
  validFrom, validUntil: expires, executionClass: 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL',
}));
const rootMap = new Map(roots.map((r, i) => [r.payload.rootManifestDigest, rootBytes[i]]));
const nonces = providers.map((p) => Buffer.from(`provider-session-nonce-${p}-v33.41-0123456789`));
const conformance = providers.map((providerId, i) => createProviderConformanceReceiptV33_41({
  laboratory: laboratories[i], laboratoryDescriptor: descriptor(laboratories[i], `lab-${i}`), providerId,
  trustRootManifest: roots[i].payload, adapterManifest: manifests[i].payload, remoteAttestation: attestations[i].payload,
  deviceId: attestations[i].payload.deviceId, tokenSerialDigest: sha256({ providerId, serial: 'v33.41' }), sessionNonce: nonces[i],
  testVectorDigest: sha256({ providerId, vector: 'v33.41-conformance' }), hardwareSessionObserved: false, executedAt: now, expiresAt: expires,
  executionClass: 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL',
}));
const nonceMap = new Map(conformance.map((r, i) => [r.payload.receiptDigest, nonces[i]]));

const oldAttestation = attestations[0].payload;
const revocation = createAttestationRevocationSnapshotV33_41({
  authority: revocationAuthority, sequence: 1, trustRootManifestDigests: roots.map((r) => r.payload.rootManifestDigest),
  revokedAttestationDigests: [oldAttestation.evidenceDigest], revokedDeviceIds: [oldAttestation.deviceId], effectiveAt: now,
  executionClass: 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL',
});
const activeProviderIdsBefore = ['provider-pkcs11', 'provider-aws', 'provider-azure', 'provider-dedicated', 'provider-spare'].sort();
const previousReplacementDigest = sha256({ previous: prior.finalVerdict.crossSiteRecoveryDigest });
const replacementSequence = 1;
const replacementPlanDigest = sha256({
  previousReplacementDigest, replacementSequence, oldProviderId: 'provider-pkcs11', oldAttestationDigest: oldAttestation.evidenceDigest,
  newProviderId: 'provider-gcp', newTrustRootManifestDigest: roots[3].payload.rootManifestDigest,
  newConformanceReceiptDigest: conformance[3].payload.receiptDigest, revocationSnapshotDigest: revocation.payload.snapshotDigest,
  activeProviderIdsBefore,
});
const replacementApprovals = custodians.slice(0, 3).map((custodian, i) => createProviderReplacementApprovalV33_41({
  custodian, descriptor: descriptor(custodian, `custodian-${i}`), replacementPlanDigest, shareIndex: i + 1, approvedAt: now,
}));
const replacement = finalizeProviderReplacementV33_41({
  authority: replacementAuthority, previousReplacementDigest, replacementSequence, oldProviderId: 'provider-pkcs11', oldAttestation,
  newProviderId: 'provider-gcp', newTrustRoot: roots[3].payload, newConformanceReceipt: conformance[3].payload,
  revocationSnapshot: revocation.payload, activeProviderIdsBefore, approvals: replacementApprovals, trust, issuedAt: now,
});

const checkpointBytes = Buffer.from('public provider onboarding checkpoint v33.41');
const checkpointAnchor = createProviderCheckpointAnchorV33_41({
  authority: publicationAuthority, priorV33_40Verdict: prior.finalVerdict, roots: roots.map((r) => r.payload),
  conformanceReceipts: conformance.map((r) => r.payload), revocationSnapshot: revocation.payload, replacementCertificate: replacement.payload,
  previousAnchorDigest: prior.finalVerdict.checkpointDigest, anchorSequence: 3, checkpointBytes,
  endpoint: 'https://checkpoint.local/v33.41.json', publisher: descriptor(publisher, 'publisher'), publicNetworkRetrievalObserved: false,
  publishedAt: now, executionClass: 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL',
});
const monitorProviderIds = ['monitor-provider-a', 'monitor-provider-b', 'monitor-provider-c'];
const monitorReceipts = monitors.map((monitor, i) => createProviderCheckpointMonitorReceiptV33_41({
  monitor, descriptor: descriptor(monitor, `monitor-${i}`), providerId: monitorProviderIds[i], anchor: checkpointAnchor.payload,
  retrievedBytes: checkpointBytes, retrievedAt: now, networkClass: 'LOCAL_LOOPBACK',
}));
const siteRecovery = createProviderSiteRecoveryReceiptV33_41({
  verifier: recoveryVerifier, descriptor: descriptor(recoveryVerifier, 'recovery'), previousRecoveryDigest: prior.finalVerdict.crossSiteRecoveryDigest,
  recoverySequence: 3, sourceSiteId: 'local-site-a', targetSiteId: 'local-site-b', sourceProviderId: 'provider-aws', targetProviderId: 'provider-gcp',
  anchor: checkpointAnchor.payload, replacementCertificate: replacement.payload, restoredBytes: checkpointBytes, recoveredAt: now,
  executionClass: 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL',
});

const finalVerdict = verifyExternalProviderOnboardingQualificationV33_41({
  priorV33_40Verdict: prior.finalVerdict, roots, rootCertificateBytesByManifestDigest: rootMap, manifests,
  moduleBytesByManifestDigest: moduleMap, attestations, conformanceReceipts: conformance, sessionNoncesByReceiptDigest: nonceMap,
  revocationSnapshot: revocation, replacementCertificate: replacement, replacementApprovals, oldAttestation,
  newTrustRoot: roots[3].payload, newConformanceReceipt: conformance[3].payload, checkpointAnchor, checkpointBytes, monitorReceipts,
  siteRecoveryReceipt: siteRecovery, restoredBytes: checkpointBytes, trust, verifiedAt: now,
});

const attacks = {};
try { const bad = new Map(rootMap); bad.set(roots[0].payload.rootManifestDigest, Buffer.from('tampered')); verifyExternalProviderOnboardingQualificationV33_41({ priorV33_40Verdict: prior.finalVerdict, roots, rootCertificateBytesByManifestDigest: bad, manifests, moduleBytesByManifestDigest: moduleMap, attestations, conformanceReceipts: conformance, sessionNoncesByReceiptDigest: nonceMap, revocationSnapshot: revocation, replacementCertificate: replacement, replacementApprovals, oldAttestation, newTrustRoot: roots[3].payload, newConformanceReceipt: conformance[3].payload, checkpointAnchor, checkpointBytes, monitorReceipts, siteRecoveryReceipt: siteRecovery, restoredBytes: checkpointBytes, trust, verifiedAt: now }); attacks.rootSubstitutionBlocked = false; } catch { attacks.rootSubstitutionBlocked = true; }
try { const bad = new Map(moduleMap); bad.set(newManifest.payload.manifestDigest, Buffer.from('tampered')); verifyExternalProviderOnboardingQualificationV33_41({ priorV33_40Verdict: prior.finalVerdict, roots, rootCertificateBytesByManifestDigest: rootMap, manifests, moduleBytesByManifestDigest: bad, attestations, conformanceReceipts: conformance, sessionNoncesByReceiptDigest: nonceMap, revocationSnapshot: revocation, replacementCertificate: replacement, replacementApprovals, oldAttestation, newTrustRoot: roots[3].payload, newConformanceReceipt: conformance[3].payload, checkpointAnchor, checkpointBytes, monitorReceipts, siteRecoveryReceipt: siteRecovery, restoredBytes: checkpointBytes, trust, verifiedAt: now }); attacks.moduleSubstitutionBlocked = false; } catch { attacks.moduleSubstitutionBlocked = true; }
try { const bad = new Map(nonceMap); bad.set(conformance[0].payload.receiptDigest, Buffer.from('bad')); verifyExternalProviderOnboardingQualificationV33_41({ priorV33_40Verdict: prior.finalVerdict, roots, rootCertificateBytesByManifestDigest: rootMap, manifests, moduleBytesByManifestDigest: moduleMap, attestations, conformanceReceipts: conformance, sessionNoncesByReceiptDigest: bad, revocationSnapshot: revocation, replacementCertificate: replacement, replacementApprovals, oldAttestation, newTrustRoot: roots[3].payload, newConformanceReceipt: conformance[3].payload, checkpointAnchor, checkpointBytes, monitorReceipts, siteRecoveryReceipt: siteRecovery, restoredBytes: checkpointBytes, trust, verifiedAt: now }); attacks.sessionNonceSubstitutionBlocked = false; } catch { attacks.sessionNonceSubstitutionBlocked = true; }
try { finalizeProviderReplacementV33_41({ authority: replacementAuthority, previousReplacementDigest, replacementSequence, oldProviderId: 'provider-pkcs11', oldAttestation, newProviderId: 'provider-gcp', newTrustRoot: roots[3].payload, newConformanceReceipt: conformance[3].payload, revocationSnapshot: revocation.payload, activeProviderIdsBefore, approvals: replacementApprovals.slice(0, 2), trust, issuedAt: now }); attacks.replacementQuorumBlocked = false; } catch { attacks.replacementQuorumBlocked = true; }
try { verifyExternalProviderOnboardingQualificationV33_41({ priorV33_40Verdict: { ...prior.finalVerdict, status: 'EXTERNAL_MULTI_PROVIDER_INTEROP_EVIDENCE_ACCEPTED' }, roots, rootCertificateBytesByManifestDigest: rootMap, manifests, moduleBytesByManifestDigest: moduleMap, attestations, conformanceReceipts: conformance, sessionNoncesByReceiptDigest: nonceMap, revocationSnapshot: revocation, replacementCertificate: replacement, replacementApprovals, oldAttestation, newTrustRoot: roots[3].payload, newConformanceReceipt: conformance[3].payload, checkpointAnchor, checkpointBytes, monitorReceipts, siteRecoveryReceipt: siteRecovery, restoredBytes: checkpointBytes, trust, verifiedAt: now }); attacks.priorRelabelBlocked = false; } catch { attacks.priorRelabelBlocked = true; }
try { verifyExternalProviderOnboardingQualificationV33_41({ priorV33_40Verdict: prior.finalVerdict, roots, rootCertificateBytesByManifestDigest: rootMap, manifests, moduleBytesByManifestDigest: moduleMap, attestations, conformanceReceipts: conformance, sessionNoncesByReceiptDigest: nonceMap, revocationSnapshot: revocation, replacementCertificate: replacement, replacementApprovals, oldAttestation, newTrustRoot: roots[3].payload, newConformanceReceipt: conformance[3].payload, checkpointAnchor, checkpointBytes, monitorReceipts: monitorReceipts.slice(0, 2), siteRecoveryReceipt: siteRecovery, restoredBytes: checkpointBytes, trust, verifiedAt: now }); attacks.monitorQuorumBlocked = false; } catch { attacks.monitorQuorumBlocked = true; }

const allPublicKeys = [...combinedPublicKeys, ...newIdentities.map(exported)];
const dedupPublicKeys = [...new Map(allPublicKeys.map((x) => [x.keyId, x])).values()];
const envelopes = [...manifests, ...attestations, ...roots, ...conformance, revocation, ...replacementApprovals, replacement, checkpointAnchor, ...monitorReceipts, siteRecovery];
const newEnvelopes = [newManifest, newAttestation, ...roots, ...conformance, revocation, ...replacementApprovals, replacement, checkpointAnchor, ...monitorReceipts, siteRecovery];
const proof = {
  version: '33.41', generatedAt: new Date().toISOString(), priorV33_40ProofDigest: sha256(prior), priorV33_40Verdict: prior.finalVerdict,
  manifests, moduleBytesBase64: manifests.map((m) => moduleMap.get(m.payload.manifestDigest).toString('base64')),
  attestations, roots, rootCertificateBytesBase64: rootBytes.map((x) => x.toString('base64')),
  conformance, sessionNoncesBase64: nonces.map((x) => x.toString('base64')), revocation, replacementApprovals, replacement,
  checkpointAnchor, checkpointBytesBase64: checkpointBytes.toString('base64'), monitorReceipts, siteRecovery, finalVerdict,
  publicKeys: dedupPublicKeys,
  trustedIds: {
    adapterSigners: combinedAdapterSignerIds, attestationAuthorities: combinedAttestationAuthorityIds,
    rootRegistrars: rootRegistrars.map((x) => x.keyId), laboratories: laboratories.map((x) => x.keyId),
    revocationAuthorities: [revocationAuthority.keyId], custodians: custodians.map((x) => x.keyId),
    replacementAuthorities: [replacementAuthority.keyId], publicationAuthorities: [publicationAuthority.keyId],
    monitors: monitors.map((x) => x.keyId), recoveryVerifiers: [recoveryVerifier.keyId],
  },
  attacks,
  summary: { providerCount: providers.length, trustRootCount: roots.length, conformanceReceiptCount: conformance.length, verifiedSignatureCount: envelopes.length, newSignatureCount: newEnvelopes.length, monitorReceiptCount: monitorReceipts.length },
  truthBoundary: { executionClass: 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL', externalTrustRootsObserved: false, externalHardwareSessionsObserved: false, publicCheckpointObserved: false, externalRoleOwnersObserved: 0, externalHumanParticipants: 0, productionAuthority: 'NONE', externalEffectsExecuted: 0, g3: 'blocked', productionPromotion: 'blocked' },
};
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PASS', output, verifiedSignatureCount: envelopes.length, newSignatureCount: newEnvelopes.length, finalStatus: finalVerdict.status, attacks }, null, 2));
