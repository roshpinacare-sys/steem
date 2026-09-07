import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../src/contracts/crypto.js';
import type { QualificationActorDescriptorV33_36 } from '../src/app/external-https-monitor-qualification-v33_36.js';
import {
  createDeploymentRoleAcceptanceV33_37,
  createDurableReceiptRecoveryAttestationV33_37,
  createExternalQualificationDeploymentManifestV33_37,
  createExternalQualificationEvidenceBundleV33_37,
  createExternalQualificationImportChallengeV33_37,
  verifyDeploymentReadinessV33_37,
  verifyExternalQualificationEvidenceImportV33_37,
  type DeploymentRoleV33_37,
  type ExternalQualificationImportTrustV33_37,
} from '../src/app/external-qualification-deployment-import-v33_37.js';

const at = (value: string) => new Date(value);
function registry(...identities: readonly SigningIdentity[]): KeyRegistry {
  const result = new KeyRegistry();
  for (const identity of identities) result.register(identity.keyId, identity.publicKey);
  return result;
}
function descriptor(identity: SigningIdentity, name: string): QualificationActorDescriptorV33_36 {
  const keys = registry(identity);
  return { keyId: identity.keyId, keyFingerprint: keys.fingerprint(identity.keyId)!, organizationId: `${name}-org`, hostId: `${name}-host`, administratorId: `${name}-admin` };
}
function resign<T extends object>(envelope: SignedEnvelope<T>, signer: SigningIdentity, digestField: keyof T, patch: Partial<T>): SignedEnvelope<T> {
  const material = { ...envelope.payload, ...patch } as T & Record<PropertyKey, unknown>;
  delete material[digestField];
  return signEnvelope({ ...material, [digestField]: sha256(material) } as T, signer);
}
function fixture() {
  const authority = generateSigningIdentity('v3337-authority');
  const publisher = generateSigningIdentity('v3337-publisher');
  const monitors = [1, 2, 3].map((n) => generateSigningIdentity(`v3337-monitor-${n}`));
  const auditors = [1, 2].map((n) => generateSigningIdentity(`v3337-auditor-${n}`));
  const times = [1, 2].map((n) => generateSigningIdentity(`v3337-time-${n}`));
  const exporter = generateSigningIdentity('v3337-exporter');
  const importer = generateSigningIdentity('v3337-importer');
  const recovery = generateSigningIdentity('v3337-recovery');
  const allRoles = [publisher, ...monitors, ...auditors, ...times, exporter, importer, recovery];
  const rows = new Map(allRoles.map((identity) => [identity.keyId, descriptor(identity, identity.keyId)]));
  const authorityRow = descriptor(authority, 'authority');
  const manifest = createExternalQualificationDeploymentManifestV33_37({
    deploymentAuthority: authority,
    deploymentAuthorityDescriptor: authorityRow,
    deploymentId: 'deployment-v3337',
    campaignId: 'campaign-v3337',
    artifactId: 'artifact-v3337',
    artifactDigest: sha256({ artifact: 'v3337' }),
    publisher: rows.get(publisher.keyId)!,
    monitors: monitors.map((row) => rows.get(row.keyId)!),
    topologyAuditors: auditors.map((row) => rows.get(row.keyId)!),
    timeSources: times.map((row) => rows.get(row.keyId)!),
    evidenceExporter: rows.get(exporter.keyId)!,
    evidenceImporter: rows.get(importer.keyId)!,
    recoveryVerifier: rows.get(recovery.keyId)!,
    allowedDnsNames: ['publisher.example.com'],
    providerEvidencePolicyDigest: sha256({ providerPolicy: 'v3337' }),
    issuedAt: at('2026-07-22T18:00:00.000Z'),
    expiresAt: at('2026-07-24T18:00:00.000Z'),
  });
  const assignments: { role: DeploymentRoleV33_37; actor: SigningIdentity }[] = [
    { role: 'PUBLISHER', actor: publisher },
    ...monitors.map((actor) => ({ role: 'MONITOR' as const, actor })),
    ...auditors.map((actor) => ({ role: 'TOPOLOGY_AUDITOR' as const, actor })),
    ...times.map((actor) => ({ role: 'TIME_SOURCE' as const, actor })),
    { role: 'EVIDENCE_EXPORTER', actor: exporter },
    { role: 'EVIDENCE_IMPORTER', actor: importer },
    { role: 'RECOVERY_VERIFIER', actor: recovery },
  ];
  const acceptances = assignments.map(({ role, actor }, index) => createDeploymentRoleAcceptanceV33_37({ actor, actorDescriptor: rows.get(actor.keyId)!, role, manifestDigest: manifest.payload.manifestDigest, acceptedAt: new Date(Date.parse('2026-07-22T18:00:00.000Z') + index * 60_000) }));
  const trust: ExternalQualificationImportTrustV33_37 = {
    deploymentAuthorityRegistry: registry(authority), trustedDeploymentAuthorityIds: [authority.keyId],
    roleRegistry: registry(...allRoles),
    evidenceExporterRegistry: registry(exporter), trustedEvidenceExporterIds: [exporter.keyId],
    evidenceImporterRegistry: registry(importer), trustedEvidenceImporterIds: [importer.keyId],
    recoveryVerifierRegistry: registry(recovery), trustedRecoveryVerifierIds: [recovery.keyId],
  };
  const readiness = verifyDeploymentReadinessV33_37({ manifest, acceptances, trust, verifiedAt: at('2026-07-22T19:00:00.000Z') });
  const challenge = createExternalQualificationImportChallengeV33_37({ importer, manifestDigest: manifest.payload.manifestDigest, nonce: new Uint8Array(32).fill(7), issuedAt: at('2026-07-22T19:01:00.000Z'), expiresAt: at('2026-07-22T20:01:00.000Z') });
  const receiptBytes = Buffer.from('durable receipt v3337');
  const verdictBytes = Buffer.from('{"status":"LOCAL_HTTPS_MONITOR_REHEARSAL_ONLY"}\n');
  const files = { 'receipts/monitor-1.bin': { bytes: receiptBytes, mediaType: 'application/octet-stream' }, 'qualification/verdict.json': { bytes: verdictBytes, mediaType: 'application/json' } };
  const bundle = createExternalQualificationEvidenceBundleV33_37({ exporter, exporterDescriptor: rows.get(exporter.keyId)!, manifestDigest: manifest.payload.manifestDigest, challengeDigest: challenge.payload.challengeDigest, executionClass: 'LOCAL_REHEARSAL', qualificationStatus: 'LOCAL_HTTPS_MONITOR_REHEARSAL_ONLY', externalTopologyObserved: false, qualificationVerdictDigest: sha256({ verdict: 'local' }), files, exportedAt: at('2026-07-22T19:02:00.000Z') });
  const receiptEntry = bundle.payload.files.find((row) => row.path === 'receipts/monitor-1.bin')!;
  const recoveryAttestation = createDurableReceiptRecoveryAttestationV33_37({ recoveryVerifier: recovery, manifestDigest: manifest.payload.manifestDigest, bundleDigest: bundle.payload.bundleDigest, durableReceiptPath: receiptEntry.path, inventoryFileDigest: receiptEntry.sha256, restoredBytes: receiptBytes, restoredAt: at('2026-07-22T19:03:00.000Z') });
  return { authority, authorityRow, publisher, monitors, auditors, times, exporter, importer, recovery, rows, allRoles, manifest, assignments, acceptances, trust, readiness, challenge, files, fileBytes: Object.fromEntries(Object.entries(files).map(([path, row]) => [path, row.bytes])), bundle, receiptBytes, verdictBytes, recoveryAttestation };
}

function importLocal(f = fixture(), consumed = new Set<string>()) {
  return verifyExternalQualificationEvidenceImportV33_37({ manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, bundle: f.bundle, fileBytes: f.fileBytes, recovery: f.recoveryAttestation, trust: f.trust, consumedChallengeDigests: consumed, importedAt: at('2026-07-22T19:04:00.000Z') });
}

test('v33.37 deployment readiness verifies all eleven separated roles', () => { const f = fixture(); assert.equal(f.readiness.status, 'READY_FOR_EXTERNAL_EXECUTION'); assert.equal(f.readiness.acceptedRoleCount, 11); });
test('v33.37 local import remains rehearsal only', () => { const receipt = importLocal(); assert.equal(receipt.status, 'LOCAL_IMPORT_REHEARSAL_ONLY'); assert.equal(receipt.externalTopologyObserved, false); assert.equal(receipt.productionAuthority, 'NONE'); });
test('v33.37 rejects self-attesting authority role overlap', () => { const f = fixture(); assert.throws(() => createExternalQualificationDeploymentManifestV33_37({ deploymentAuthority: f.authority, deploymentAuthorityDescriptor: f.authorityRow, deploymentId: 'd', campaignId: 'c', artifactId: 'a', artifactDigest: sha256({ a: 1 }), publisher: f.authorityRow, monitors: f.monitors.map((x) => f.rows.get(x.keyId)!), topologyAuditors: f.auditors.map((x) => f.rows.get(x.keyId)!), timeSources: f.times.map((x) => f.rows.get(x.keyId)!), evidenceExporter: f.rows.get(f.exporter.keyId)!, evidenceImporter: f.rows.get(f.importer.keyId)!, recoveryVerifier: f.rows.get(f.recovery.keyId)!, allowedDnsNames: ['publisher.example.com'], providerEvidencePolicyDigest: sha256({ p: 1 }), issuedAt: at('2026-07-22T18:00:00Z'), expiresAt: at('2026-07-23T18:00:00Z') }), /role_separation/); });
test('v33.37 rejects shared organization across roles', () => { const f = fixture(); const duplicate = { ...f.rows.get(f.monitors[1]!.keyId)!, organizationId: f.rows.get(f.monitors[0]!.keyId)!.organizationId }; assert.throws(() => createExternalQualificationDeploymentManifestV33_37({ deploymentAuthority: f.authority, deploymentAuthorityDescriptor: f.authorityRow, deploymentId: 'd', campaignId: 'c', artifactId: 'a', artifactDigest: sha256({ a: 1 }), publisher: f.rows.get(f.publisher.keyId)!, monitors: [f.rows.get(f.monitors[0]!.keyId)!, duplicate, f.rows.get(f.monitors[2]!.keyId)!], topologyAuditors: f.auditors.map((x) => f.rows.get(x.keyId)!), timeSources: f.times.map((x) => f.rows.get(x.keyId)!), evidenceExporter: f.rows.get(f.exporter.keyId)!, evidenceImporter: f.rows.get(f.importer.keyId)!, recoveryVerifier: f.rows.get(f.recovery.keyId)!, allowedDnsNames: ['publisher.example.com'], providerEvidencePolicyDigest: sha256({ p: 1 }), issuedAt: at('2026-07-22T18:00:00Z'), expiresAt: at('2026-07-23T18:00:00Z') }), /role_separation/); });
test('v33.37 rejects localhost DNS', () => { const f = fixture(); assert.throws(() => createExternalQualificationDeploymentManifestV33_37({ deploymentAuthority: f.authority, deploymentAuthorityDescriptor: f.authorityRow, deploymentId: 'd', campaignId: 'c', artifactId: 'a', artifactDigest: sha256({ a: 1 }), publisher: f.rows.get(f.publisher.keyId)!, monitors: f.monitors.map((x) => f.rows.get(x.keyId)!), topologyAuditors: f.auditors.map((x) => f.rows.get(x.keyId)!), timeSources: f.times.map((x) => f.rows.get(x.keyId)!), evidenceExporter: f.rows.get(f.exporter.keyId)!, evidenceImporter: f.rows.get(f.importer.keyId)!, recoveryVerifier: f.rows.get(f.recovery.keyId)!, allowedDnsNames: ['localhost'], providerEvidencePolicyDigest: sha256({ p: 1 }), issuedAt: at('2026-07-22T18:00:00Z'), expiresAt: at('2026-07-23T18:00:00Z') }), /dns_name/); });
test('v33.37 rejects IP literal as DNS', () => { const f = fixture(); assert.throws(() => createExternalQualificationDeploymentManifestV33_37({ deploymentAuthority: f.authority, deploymentAuthorityDescriptor: f.authorityRow, deploymentId: 'd', campaignId: 'c', artifactId: 'a', artifactDigest: sha256({ a: 1 }), publisher: f.rows.get(f.publisher.keyId)!, monitors: f.monitors.map((x) => f.rows.get(x.keyId)!), topologyAuditors: f.auditors.map((x) => f.rows.get(x.keyId)!), timeSources: f.times.map((x) => f.rows.get(x.keyId)!), evidenceExporter: f.rows.get(f.exporter.keyId)!, evidenceImporter: f.rows.get(f.importer.keyId)!, recoveryVerifier: f.rows.get(f.recovery.keyId)!, allowedDnsNames: ['127.0.0.1'], providerEvidencePolicyDigest: sha256({ p: 1 }), issuedAt: at('2026-07-22T18:00:00Z'), expiresAt: at('2026-07-23T18:00:00Z') }), /dns_name/); });
test('v33.37 rejects wrong monitor cardinality', () => { const f = fixture(); assert.throws(() => createExternalQualificationDeploymentManifestV33_37({ deploymentAuthority: f.authority, deploymentAuthorityDescriptor: f.authorityRow, deploymentId: 'd', campaignId: 'c', artifactId: 'a', artifactDigest: sha256({ a: 1 }), publisher: f.rows.get(f.publisher.keyId)!, monitors: f.monitors.slice(0, 2).map((x) => f.rows.get(x.keyId)!), topologyAuditors: f.auditors.map((x) => f.rows.get(x.keyId)!), timeSources: f.times.map((x) => f.rows.get(x.keyId)!), evidenceExporter: f.rows.get(f.exporter.keyId)!, evidenceImporter: f.rows.get(f.importer.keyId)!, recoveryVerifier: f.rows.get(f.recovery.keyId)!, allowedDnsNames: ['publisher.example.com'], providerEvidencePolicyDigest: sha256({ p: 1 }), issuedAt: at('2026-07-22T18:00:00Z'), expiresAt: at('2026-07-23T18:00:00Z') }), /cardinality/); });
test('v33.37 rejects expired manifest', () => { const f = fixture(); assert.throws(() => verifyDeploymentReadinessV33_37({ manifest: f.manifest, acceptances: f.acceptances, trust: f.trust, verifiedAt: at('2026-07-25T00:00:00Z') }), /not_active/); });
test('v33.37 rejects missing acceptance', () => { const f = fixture(); assert.throws(() => verifyDeploymentReadinessV33_37({ manifest: f.manifest, acceptances: f.acceptances.slice(1), trust: f.trust, verifiedAt: at('2026-07-22T19:00:00Z') }), /count/); });
test('v33.37 rejects duplicate acceptance', () => { const f = fixture(); const rows = [...f.acceptances.slice(0, -1), f.acceptances[0]!]; assert.throws(() => verifyDeploymentReadinessV33_37({ manifest: f.manifest, acceptances: rows, trust: f.trust, verifiedAt: at('2026-07-22T19:00:00Z') }), /duplicate|coverage/); });
test('v33.37 rejects acceptance assigned to wrong role', () => { const f = fixture(); const bad = resign(f.acceptances[0]!, f.publisher, 'acceptanceDigest', { role: 'TIME_SOURCE' }); assert.throws(() => verifyDeploymentReadinessV33_37({ manifest: f.manifest, acceptances: [bad, ...f.acceptances.slice(1)], trust: f.trust, verifiedAt: at('2026-07-22T19:00:00Z') }), /assignment/); });
test('v33.37 rejects tampered acceptance signature', () => { const f = fixture(); const bad = { ...f.acceptances[0]!, payload: { ...f.acceptances[0]!.payload, acceptedAt: '2026-07-22T20:00:00.000Z' } }; assert.throws(() => verifyDeploymentReadinessV33_37({ manifest: f.manifest, acceptances: [bad, ...f.acceptances.slice(1)], trust: f.trust, verifiedAt: at('2026-07-22T19:00:00Z') }), /signature/); });
test('v33.37 rejects short challenge nonce', () => { const f = fixture(); assert.throws(() => createExternalQualificationImportChallengeV33_37({ importer: f.importer, manifestDigest: f.manifest.payload.manifestDigest, nonce: new Uint8Array(8), issuedAt: at('2026-07-22T19:00:00Z'), expiresAt: at('2026-07-22T20:00:00Z') }), /challenge_invalid/); });
test('v33.37 rejects traversal inventory path', () => { const f = fixture(); assert.throws(() => createExternalQualificationEvidenceBundleV33_37({ exporter: f.exporter, exporterDescriptor: f.rows.get(f.exporter.keyId)!, manifestDigest: f.manifest.payload.manifestDigest, challengeDigest: f.challenge.payload.challengeDigest, executionClass: 'LOCAL_REHEARSAL', qualificationStatus: 'LOCAL_HTTPS_MONITOR_REHEARSAL_ONLY', externalTopologyObserved: false, qualificationVerdictDigest: sha256({ v: 1 }), files: { '../secret': { bytes: Buffer.from('x'), mediaType: 'text/plain' } }, exportedAt: at('2026-07-22T19:02:00Z') }), /path/); });
test('v33.37 rejects local bundle claiming external status', () => { const f = fixture(); assert.throws(() => createExternalQualificationEvidenceBundleV33_37({ exporter: f.exporter, exporterDescriptor: f.rows.get(f.exporter.keyId)!, manifestDigest: f.manifest.payload.manifestDigest, challengeDigest: f.challenge.payload.challengeDigest, executionClass: 'LOCAL_REHEARSAL', qualificationStatus: 'EXTERNAL_MONITOR_QUALIFIED', externalTopologyObserved: true, qualificationVerdictDigest: sha256({ v: 1 }), files: f.files, exportedAt: at('2026-07-22T19:02:00Z') }), /rehearsal_claim/); });
test('v33.37 rejects live bundle without external qualification', () => { const f = fixture(); assert.throws(() => createExternalQualificationEvidenceBundleV33_37({ exporter: f.exporter, exporterDescriptor: f.rows.get(f.exporter.keyId)!, manifestDigest: f.manifest.payload.manifestDigest, challengeDigest: f.challenge.payload.challengeDigest, executionClass: 'LIVE_EXTERNAL', qualificationStatus: 'LOCAL_HTTPS_MONITOR_REHEARSAL_ONLY', externalTopologyObserved: false, qualificationVerdictDigest: sha256({ v: 1 }), files: f.files, exportedAt: at('2026-07-22T19:02:00Z') }), /live_evidence/); });
test('v33.37 rejects challenge replay', () => { const f = fixture(); const used = new Set<string>(); importLocal(f, used); assert.throws(() => importLocal(f, used), /replay/); });
test('v33.37 rejects missing inventory file', () => { const f = fixture(); const bytes = { 'receipts/monitor-1.bin': f.receiptBytes }; assert.throws(() => verifyExternalQualificationEvidenceImportV33_37({ manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, bundle: f.bundle, fileBytes: bytes, recovery: f.recoveryAttestation, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-22T19:04:00Z') }), /exactness/); });
test('v33.37 rejects extra inventory file', () => { const f = fixture(); const bytes = { ...f.fileBytes, 'extra.txt': Buffer.from('extra') }; assert.throws(() => verifyExternalQualificationEvidenceImportV33_37({ manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, bundle: f.bundle, fileBytes: bytes, recovery: f.recoveryAttestation, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-22T19:04:00Z') }), /exactness/); });
test('v33.37 rejects changed file bytes', () => { const f = fixture(); const bytes = { ...f.fileBytes, 'receipts/monitor-1.bin': Buffer.from('changed') }; assert.throws(() => verifyExternalQualificationEvidenceImportV33_37({ manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, bundle: f.bundle, fileBytes: bytes, recovery: f.recoveryAttestation, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-22T19:04:00Z') }), /inventory_bytes/); });
test('v33.37 rejects bundle bound to another challenge', () => { const f = fixture(); const bad = resign(f.bundle, f.exporter, 'bundleDigest', { challengeDigest: sha256({ other: true }) }); assert.throws(() => verifyExternalQualificationEvidenceImportV33_37({ manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, bundle: bad, fileBytes: f.fileBytes, recovery: f.recoveryAttestation, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-22T19:04:00Z') }), /bundle_binding/); });
test('v33.37 refuses recovery attestation over different bytes', () => { const f = fixture(); const entry = f.bundle.payload.files[0]!; assert.throws(() => createDurableReceiptRecoveryAttestationV33_37({ recoveryVerifier: f.recovery, manifestDigest: f.manifest.payload.manifestDigest, bundleDigest: f.bundle.payload.bundleDigest, durableReceiptPath: entry.path, inventoryFileDigest: entry.sha256, restoredBytes: Buffer.from('different'), restoredAt: at('2026-07-22T19:03:00Z') }), /recovery_bytes/); });
test('v33.37 rejects recovery path outside inventory', () => { const f = fixture(); const bad = resign(f.recoveryAttestation, f.recovery, 'recoveryDigest', { durableReceiptPath: 'receipts/other.bin' }); assert.throws(() => verifyExternalQualificationEvidenceImportV33_37({ manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, bundle: f.bundle, fileBytes: f.fileBytes, recovery: bad, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-22T19:04:00Z') }), /inventory_binding/); });
test('v33.37 rejects recovery signed by unknown verifier', () => { const f = fixture(); const attacker = generateSigningIdentity('attacker'); const bad = signEnvelope(f.recoveryAttestation.payload, attacker); assert.throws(() => verifyExternalQualificationEvidenceImportV33_37({ manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, bundle: f.bundle, fileBytes: f.fileBytes, recovery: bad, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-22T19:04:00Z') }), /recovery_signature/); });
test('v33.37 rejects relabelled rehearsal bundle', () => { const f = fixture(); const bad = { ...f.bundle, payload: { ...f.bundle.payload, executionClass: 'LIVE_EXTERNAL' as const, qualificationStatus: 'EXTERNAL_MONITOR_QUALIFIED' as const, externalTopologyObserved: true } }; assert.throws(() => verifyExternalQualificationEvidenceImportV33_37({ manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, bundle: bad, fileBytes: f.fileBytes, recovery: f.recoveryAttestation, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-22T19:04:00Z') }), /bundle_signature/); });
test('v33.37 accepts internally consistent live external bundle but grants no production authority', () => { const f = fixture(); const live = createExternalQualificationEvidenceBundleV33_37({ exporter: f.exporter, exporterDescriptor: f.rows.get(f.exporter.keyId)!, manifestDigest: f.manifest.payload.manifestDigest, challengeDigest: f.challenge.payload.challengeDigest, executionClass: 'LIVE_EXTERNAL', qualificationStatus: 'EXTERNAL_MONITOR_QUALIFIED', externalTopologyObserved: true, qualificationVerdictDigest: sha256({ verdict: 'external' }), files: f.files, exportedAt: at('2026-07-22T19:02:00Z') }); const entry = live.payload.files.find((row) => row.path === 'receipts/monitor-1.bin')!; const recovery = createDurableReceiptRecoveryAttestationV33_37({ recoveryVerifier: f.recovery, manifestDigest: f.manifest.payload.manifestDigest, bundleDigest: live.payload.bundleDigest, durableReceiptPath: entry.path, inventoryFileDigest: entry.sha256, restoredBytes: f.receiptBytes, restoredAt: at('2026-07-22T19:03:00Z') }); const receipt = verifyExternalQualificationEvidenceImportV33_37({ manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, bundle: live, fileBytes: f.fileBytes, recovery, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-22T19:04:00Z') }); assert.equal(receipt.status, 'EXTERNAL_EVIDENCE_ACCEPTED'); assert.equal(receipt.productionAuthority, 'NONE'); });
test('v33.37 rejects expired import challenge', () => { const f = fixture(); assert.throws(() => verifyExternalQualificationEvidenceImportV33_37({ manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, bundle: f.bundle, fileBytes: f.fileBytes, recovery: f.recoveryAttestation, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-22T21:00:00Z') }), /not_active/); });
test('v33.37 rejects exporter topology mismatch even with valid exporter signature', () => { const f = fixture(); const bad = resign(f.bundle, f.exporter, 'bundleDigest', { exporterHostId: 'different-host' }); assert.throws(() => verifyExternalQualificationEvidenceImportV33_37({ manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, bundle: bad, fileBytes: f.fileBytes, recovery: f.recoveryAttestation, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-22T19:04:00Z') }), /exporter_topology/); });
test('v33.37 rejects forged readiness verdict', () => { const f = fixture(); const readiness = { ...f.readiness, acceptedRoleCount: 99 }; assert.throws(() => verifyExternalQualificationEvidenceImportV33_37({ manifest: f.manifest, readiness, challenge: f.challenge, bundle: f.bundle, fileBytes: f.fileBytes, recovery: f.recoveryAttestation, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-22T19:04:00Z') }), /readiness/); });
test('v33.37 rejects recovery bound to a different bundle', () => { const f = fixture(); const bad = resign(f.recoveryAttestation, f.recovery, 'recoveryDigest', { bundleDigest: sha256({ other: true }) }); assert.throws(() => verifyExternalQualificationEvidenceImportV33_37({ manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, bundle: f.bundle, fileBytes: f.fileBytes, recovery: bad, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-22T19:04:00Z') }), /recovery_binding/); });
