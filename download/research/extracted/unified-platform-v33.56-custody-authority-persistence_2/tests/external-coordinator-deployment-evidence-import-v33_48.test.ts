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
import type { ExternalCoordinatorJournalQualificationVerdictV33_47 } from '../src/supply-chain/external-coordinator-journal-qualification-v33_47.js';
import {
  createAppendOnlyStoreRecoveryAttestationV33_48,
  createCoordinatorDeploymentRoleAcceptanceV33_48,
  createCoordinatorEvidenceImportChallengeV33_48,
  createCoordinatorExternalDeploymentManifestV33_48,
  createCoordinatorJournalEvidenceBundleV33_48,
  createExternalInfrastructureEvidenceAttestationV33_48,
  verifyCoordinatorDeploymentReadinessV33_48,
  verifyCoordinatorJournalEvidenceImportV33_48,
  type CoordinatorDeploymentActorV33_48,
  type CoordinatorDeploymentRoleV33_48,
  type CoordinatorExternalEvidenceImportTrustV33_48,
  type ExternalInfrastructureEvidencePayloadV33_48,
} from '../src/supply-chain/external-coordinator-deployment-evidence-import-v33_48.js';

const at = (value: string) => new Date(value);
function registry(...identities: readonly SigningIdentity[]): KeyRegistry { const result = new KeyRegistry(); identities.forEach((identity) => result.register(identity.keyId, identity.publicKey)); return result; }
function actor(identity: SigningIdentity, name: string): CoordinatorDeploymentActorV33_48 { const keys = registry(identity); return { keyId: identity.keyId, keyFingerprint: keys.fingerprint(identity.keyId)!, organizationId: `${name}-org`, hostId: `${name}.example.com`, administratorId: `${name}-admin` }; }
function baseVerdict(): ExternalCoordinatorJournalQualificationVerdictV33_47 {
  const d = (name: string) => sha256({ name });
  const material = {
    version: '33.47' as const,
    status: 'LOCAL_COORDINATOR_JOURNAL_QUALIFICATION_REHEARSAL_ONLY' as const,
    baseCoordinatorVerdictDigest: d('base'),
    hostAttestationDigests: [d('host')],
    clockDigests: [d('clock')],
    initialReplicaReceiptDigests: [d('initial')],
    failoverDigest: d('failover'),
    postFailoverReplicaReceiptDigests: [d('post')],
    checkpointDigest: d('checkpoint'),
    recoveryDigest: d('recovery'),
    journalHeadDigest: d('head'),
    journalBytesDigest: d('bytes'),
    initialReplicaCount: 3 as const,
    postFailoverReplicaCount: 3 as const,
    distinctReplicaProcessesObserved: true as const,
    independentClockQuorumVerified: true as const,
    partitionFailoverVerified: true as const,
    irreversibleFencingVerified: true as const,
    appendOnlyReplicationVerified: true as const,
    siteLossRecoveryVerified: true as const,
    externalTopologyObserved: false,
    externalHumanParticipants: 0 as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
    verifiedAt: '2026-07-23T00:00:00.000Z',
  };
  return { ...material, verdictDigest: sha256(material) };
}
function resign<T extends object>(envelope: SignedEnvelope<T>, signer: SigningIdentity, digestField: keyof T, patch: Partial<T>): SignedEnvelope<T> {
  const material = { ...envelope.payload, ...patch } as T & Record<PropertyKey, unknown>;
  delete material[digestField];
  return signEnvelope({ ...material, [digestField]: sha256(material) } as T, signer);
}
function fixture(mode: 'local' | 'external' = 'local') {
  const authority = generateSigningIdentity('v3348-authority');
  const hosts = [1, 2, 3, 4].map((n) => generateSigningIdentity(`v3348-host-${n}`));
  const clocks = [1, 2].map((n) => generateSigningIdentity(`v3348-clock-${n}`));
  const stores = [1, 2, 3].map((n) => generateSigningIdentity(`v3348-store-${n}`));
  const observers = [1, 2].map((n) => generateSigningIdentity(`v3348-observer-${n}`));
  const auditors = [1, 2].map((n) => generateSigningIdentity(`v3348-auditor-${n}`));
  const exporter = generateSigningIdentity('v3348-exporter');
  const importer = generateSigningIdentity('v3348-importer');
  const recoveryVerifier = generateSigningIdentity('v3348-recovery');
  const roleIdentities = [...hosts, ...clocks, ...stores, ...observers, ...auditors, exporter, importer, recoveryVerifier];
  const descriptors = new Map(roleIdentities.map((identity) => [identity.keyId, actor(identity, identity.keyId)]));
  const base = baseVerdict();
  const manifest = createCoordinatorExternalDeploymentManifestV33_48({
    deploymentAuthority: authority,
    deploymentAuthorityDescriptor: actor(authority, 'v3348-authority'),
    deploymentId: 'v3348-deployment', campaignId: 'v3348-campaign', artifactId: 'v3348-artifact',
    artifactDigest: sha256({ artifact: 'v3348' }), baseQualificationVerdictDigest: base.verdictDigest,
    coordinatorHosts: hosts.map((identity) => descriptors.get(identity.keyId)!),
    clockRoots: clocks.map((identity) => descriptors.get(identity.keyId)!),
    appendOnlyStores: stores.map((identity) => descriptors.get(identity.keyId)!),
    partitionObservers: observers.map((identity) => descriptors.get(identity.keyId)!),
    topologyAuditors: auditors.map((identity) => descriptors.get(identity.keyId)!),
    evidenceExporter: descriptors.get(exporter.keyId)!, evidenceImporter: descriptors.get(importer.keyId)!, recoveryVerifier: descriptors.get(recoveryVerifier.keyId)!,
    allowedDnsNames: [...hosts, ...clocks, ...stores, ...observers].map((identity) => descriptors.get(identity.keyId)!.hostId),
    evidencePolicyDigest: sha256({ policy: 'two-auditors-per-infrastructure-role' }),
    issuedAt: at('2026-07-23T00:00:00.000Z'), expiresAt: at('2026-08-23T00:00:00.000Z'),
  });
  const assignments: { role: CoordinatorDeploymentRoleV33_48; ordinal: number; identity: SigningIdentity }[] = [
    ...hosts.map((identity, index) => ({ role: 'COORDINATOR_HOST' as const, ordinal: index + 1, identity })),
    ...clocks.map((identity, index) => ({ role: 'CLOCK_ROOT' as const, ordinal: index + 1, identity })),
    ...stores.map((identity, index) => ({ role: 'APPEND_ONLY_STORE' as const, ordinal: index + 1, identity })),
    ...observers.map((identity, index) => ({ role: 'PARTITION_OBSERVER' as const, ordinal: index + 1, identity })),
    ...auditors.map((identity, index) => ({ role: 'TOPOLOGY_AUDITOR' as const, ordinal: index + 1, identity })),
    { role: 'EVIDENCE_EXPORTER', ordinal: 1, identity: exporter },
    { role: 'EVIDENCE_IMPORTER', ordinal: 1, identity: importer },
    { role: 'RECOVERY_VERIFIER', ordinal: 1, identity: recoveryVerifier },
  ];
  const acceptances = assignments.map((row, index) => createCoordinatorDeploymentRoleAcceptanceV33_48({ actor: row.identity, actorDescriptor: descriptors.get(row.identity.keyId)!, role: row.role, ordinal: row.ordinal, manifestDigest: manifest.payload.manifestDigest, acceptedAt: new Date(Date.parse('2026-07-23T00:10:00.000Z') + index * 1000) }));
  const trustedExternalEvidenceDigests: string[] = [];
  const trust: CoordinatorExternalEvidenceImportTrustV33_48 = {
    deploymentAuthorityRegistry: registry(authority), trustedDeploymentAuthorityIds: [authority.keyId],
    roleRegistry: registry(...roleIdentities), evidenceAuditorRegistry: registry(...auditors), trustedEvidenceAuditorIds: auditors.map((identity) => identity.keyId),
    evidenceExporterRegistry: registry(exporter), trustedEvidenceExporterIds: [exporter.keyId], evidenceImporterRegistry: registry(importer), trustedEvidenceImporterIds: [importer.keyId],
    recoveryVerifierRegistry: registry(recoveryVerifier), trustedRecoveryVerifierIds: [recoveryVerifier.keyId], trustedExternalEvidenceDigests,
  };
  const readiness = verifyCoordinatorDeploymentReadinessV33_48({ manifest, acceptances, trust, verifiedAt: at('2026-07-23T01:00:00.000Z') });
  const challenge = createCoordinatorEvidenceImportChallengeV33_48({ importer, manifestDigest: manifest.payload.manifestDigest, nonce: new Uint8Array(32).fill(48), issuedAt: at('2026-07-23T01:01:00.000Z'), expiresAt: at('2026-07-23T02:01:00.000Z') });
  const infrastructureRows = [
    ...hosts.map((identity, index) => ({ role: 'COORDINATOR_HOST' as const, ordinal: index + 1, identity })),
    ...clocks.map((identity, index) => ({ role: 'CLOCK_ROOT' as const, ordinal: index + 1, identity })),
    ...stores.map((identity, index) => ({ role: 'APPEND_ONLY_STORE' as const, ordinal: index + 1, identity })),
    ...observers.map((identity, index) => ({ role: 'PARTITION_OBSERVER' as const, ordinal: index + 1, identity })),
  ];
  const infrastructureEvidence: SignedEnvelope<ExternalInfrastructureEvidencePayloadV33_48>[] = [];
  if (mode === 'external') {
    for (const row of infrastructureRows) for (const auditor of auditors) {
      const providerEvidenceDigest = sha256({ role: row.role, ordinal: row.ordinal, auditor: auditor.keyId });
      trustedExternalEvidenceDigests.push(providerEvidenceDigest);
      infrastructureEvidence.push(createExternalInfrastructureEvidenceAttestationV33_48({ auditor, manifestDigest: manifest.payload.manifestDigest, role: row.role, ordinal: row.ordinal, subject: descriptors.get(row.identity.keyId)!, topology: 'INDEPENDENT_EXTERNAL_ATTESTED', providerEvidenceDigest, observedAt: at('2026-07-23T01:02:00.000Z') }));
    }
  }
  const files: Record<string, { bytes: Buffer; mediaType: string }> = {
    'qualification/v33_47-verdict.json': { bytes: Buffer.from(JSON.stringify(base) + '\n'), mediaType: 'application/json' },
    'hosts/host-1.json': { bytes: Buffer.from('{"host":1}\n'), mediaType: 'application/json' },
    'hosts/host-2.json': { bytes: Buffer.from('{"host":2}\n'), mediaType: 'application/json' },
    'hosts/host-3.json': { bytes: Buffer.from('{"host":3}\n'), mediaType: 'application/json' },
    'hosts/host-4.json': { bytes: Buffer.from('{"host":4}\n'), mediaType: 'application/json' },
    'clocks/root-1.json': { bytes: Buffer.from('{"clock":1}\n'), mediaType: 'application/json' },
    'clocks/root-2.json': { bytes: Buffer.from('{"clock":2}\n'), mediaType: 'application/json' },
    'stores/store-1-receipt.bin': { bytes: Buffer.from('append-only-store-1\n'), mediaType: 'application/octet-stream' },
    'stores/store-2-receipt.bin': { bytes: Buffer.from('append-only-store-2\n'), mediaType: 'application/octet-stream' },
    'stores/store-3-receipt.bin': { bytes: Buffer.from('append-only-store-3\n'), mediaType: 'application/octet-stream' },
    'partition/failover.json': { bytes: Buffer.from('{"partition":"observed"}\n'), mediaType: 'application/json' },
    'recovery/site-loss.json': { bytes: Buffer.from('{"recovery":"complete"}\n'), mediaType: 'application/json' },
  };
  const bundle = createCoordinatorJournalEvidenceBundleV33_48({ exporter, manifestDigest: manifest.payload.manifestDigest, challengeDigest: challenge.payload.challengeDigest, baseQualificationVerdictDigest: base.verdictDigest, executionClass: mode === 'external' ? 'LIVE_EXTERNAL' : 'LOCAL_REHEARSAL', qualificationStatus: mode === 'external' ? 'EXTERNAL_COORDINATOR_JOURNAL_QUALIFIED' : 'LOCAL_COORDINATOR_JOURNAL_QUALIFICATION_REHEARSAL_ONLY', externalTopologyObserved: mode === 'external', externalCoordinatorHostCount: mode === 'external' ? 4 : 0, externalClockRootCount: mode === 'external' ? 2 : 0, externalAppendOnlyStoreCount: mode === 'external' ? 3 : 0, externalPartitionObserverCount: mode === 'external' ? 2 : 0, infrastructureEvidence, files, exportedAt: at('2026-07-23T01:03:00.000Z') });
  const storeRow = bundle.payload.files.find((row) => row.path === 'stores/store-1-receipt.bin')!;
  const recovery = createAppendOnlyStoreRecoveryAttestationV33_48({ recoveryVerifier, manifestDigest: manifest.payload.manifestDigest, bundleDigest: bundle.payload.bundleDigest, durableStoreEvidencePath: storeRow.path, inventoryFileDigest: storeRow.sha256, restoredBytes: files[storeRow.path]!.bytes, fileFsync: true, directoryFsync: true, rereadVerified: true, restoredAt: at('2026-07-23T01:04:00.000Z') });
  return { authority, hosts, clocks, stores, observers, auditors, exporter, importer, recoveryVerifier, roleIdentities, descriptors, base, manifest, assignments, acceptances, trust, readiness, challenge, infrastructureRows, infrastructureEvidence, files, fileBytes: Object.fromEntries(Object.entries(files).map(([path, row]) => [path, row.bytes])), bundle, recovery };
}
function importFixture(f = fixture(), consumed = new Set<string>()) { return verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: f.base, manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, infrastructureEvidence: f.infrastructureEvidence, bundle: f.bundle, fileBytes: f.fileBytes, recovery: f.recovery, trust: f.trust, consumedChallengeDigests: consumed, importedAt: at('2026-07-23T01:05:00.000Z') }); }

test('v33.48 readiness verifies sixteen separated roles', () => { const f = fixture(); assert.equal(f.readiness.acceptedRoleCount, 16); assert.equal(f.readiness.coordinatorHostCount, 4); });
test('v33.48 local import remains rehearsal only', () => { const receipt = importFixture(); assert.equal(receipt.status, 'LOCAL_EXTERNAL_DEPLOYMENT_IMPORT_REHEARSAL_ONLY'); assert.equal(receipt.externalTopologyObserved, false); });
test('v33.48 synthetic external quorum path is accepted by the verifier', () => { const f = fixture('external'); const receipt = importFixture(f); assert.equal(receipt.status, 'EXTERNAL_COORDINATOR_DEPLOYMENT_EVIDENCE_ACCEPTED'); assert.equal(receipt.infrastructureEvidenceCount, 22); });
test('v33.48 rejects wrong role cardinality', () => { const f = fixture(); assert.throws(() => createCoordinatorExternalDeploymentManifestV33_48({ deploymentAuthority: f.authority, deploymentAuthorityDescriptor: actor(f.authority, 'authority-x'), deploymentId: 'd', campaignId: 'c', artifactId: 'a', artifactDigest: sha256({ a: 1 }), baseQualificationVerdictDigest: f.base.verdictDigest, coordinatorHosts: f.hosts.slice(0, 3).map((x) => f.descriptors.get(x.keyId)!), clockRoots: f.clocks.map((x) => f.descriptors.get(x.keyId)!), appendOnlyStores: f.stores.map((x) => f.descriptors.get(x.keyId)!), partitionObservers: f.observers.map((x) => f.descriptors.get(x.keyId)!), topologyAuditors: f.auditors.map((x) => f.descriptors.get(x.keyId)!), evidenceExporter: f.descriptors.get(f.exporter.keyId)!, evidenceImporter: f.descriptors.get(f.importer.keyId)!, recoveryVerifier: f.descriptors.get(f.recoveryVerifier.keyId)!, allowedDnsNames: [...f.hosts, ...f.clocks, ...f.stores, ...f.observers].map((x) => f.descriptors.get(x.keyId)!.hostId), evidencePolicyDigest: sha256({ p: 1 }), issuedAt: at('2026-07-23T00:00:00Z'), expiresAt: at('2026-07-24T00:00:00Z') }), /role_cardinality/); });
test('v33.48 rejects authority role overlap', () => { const f = fixture(); const authorityRow = actor(f.authority, 'authority-overlap'); assert.throws(() => createCoordinatorExternalDeploymentManifestV33_48({ deploymentAuthority: f.authority, deploymentAuthorityDescriptor: authorityRow, deploymentId: 'd', campaignId: 'c', artifactId: 'a', artifactDigest: sha256({ a: 1 }), baseQualificationVerdictDigest: f.base.verdictDigest, coordinatorHosts: [authorityRow, ...f.hosts.slice(1).map((x) => f.descriptors.get(x.keyId)!)], clockRoots: f.clocks.map((x) => f.descriptors.get(x.keyId)!), appendOnlyStores: f.stores.map((x) => f.descriptors.get(x.keyId)!), partitionObservers: f.observers.map((x) => f.descriptors.get(x.keyId)!), topologyAuditors: f.auditors.map((x) => f.descriptors.get(x.keyId)!), evidenceExporter: f.descriptors.get(f.exporter.keyId)!, evidenceImporter: f.descriptors.get(f.importer.keyId)!, recoveryVerifier: f.descriptors.get(f.recoveryVerifier.keyId)!, allowedDnsNames: [authorityRow.hostId, ...f.hosts.slice(1).map((x) => f.descriptors.get(x.keyId)!.hostId), ...f.clocks.map((x) => f.descriptors.get(x.keyId)!.hostId), ...f.stores.map((x) => f.descriptors.get(x.keyId)!.hostId), ...f.observers.map((x) => f.descriptors.get(x.keyId)!.hostId)], evidencePolicyDigest: sha256({ p: 1 }), issuedAt: at('2026-07-23T00:00:00Z'), expiresAt: at('2026-07-24T00:00:00Z') }), /role_separation/); });
test('v33.48 rejects shared organization', () => { const f = fixture(); const duplicate = { ...f.descriptors.get(f.hosts[1]!.keyId)!, organizationId: f.descriptors.get(f.hosts[0]!.keyId)!.organizationId }; assert.throws(() => createCoordinatorExternalDeploymentManifestV33_48({ deploymentAuthority: f.authority, deploymentAuthorityDescriptor: actor(f.authority, 'authority-y'), deploymentId: 'd', campaignId: 'c', artifactId: 'a', artifactDigest: sha256({ a: 1 }), baseQualificationVerdictDigest: f.base.verdictDigest, coordinatorHosts: [f.descriptors.get(f.hosts[0]!.keyId)!, duplicate, ...f.hosts.slice(2).map((x) => f.descriptors.get(x.keyId)!)], clockRoots: f.clocks.map((x) => f.descriptors.get(x.keyId)!), appendOnlyStores: f.stores.map((x) => f.descriptors.get(x.keyId)!), partitionObservers: f.observers.map((x) => f.descriptors.get(x.keyId)!), topologyAuditors: f.auditors.map((x) => f.descriptors.get(x.keyId)!), evidenceExporter: f.descriptors.get(f.exporter.keyId)!, evidenceImporter: f.descriptors.get(f.importer.keyId)!, recoveryVerifier: f.descriptors.get(f.recoveryVerifier.keyId)!, allowedDnsNames: [...f.hosts, ...f.clocks, ...f.stores, ...f.observers].map((x) => f.descriptors.get(x.keyId)!.hostId), evidencePolicyDigest: sha256({ p: 1 }), issuedAt: at('2026-07-23T00:00:00Z'), expiresAt: at('2026-07-24T00:00:00Z') }), /role_separation/); });
test('v33.48 rejects localhost DNS', () => { const f = fixture(); assert.throws(() => createCoordinatorExternalDeploymentManifestV33_48({ deploymentAuthority: f.authority, deploymentAuthorityDescriptor: actor(f.authority, 'authority-z'), deploymentId: 'd', campaignId: 'c', artifactId: 'a', artifactDigest: sha256({ a: 1 }), baseQualificationVerdictDigest: f.base.verdictDigest, coordinatorHosts: f.hosts.map((x) => f.descriptors.get(x.keyId)!), clockRoots: f.clocks.map((x) => f.descriptors.get(x.keyId)!), appendOnlyStores: f.stores.map((x) => f.descriptors.get(x.keyId)!), partitionObservers: f.observers.map((x) => f.descriptors.get(x.keyId)!), topologyAuditors: f.auditors.map((x) => f.descriptors.get(x.keyId)!), evidenceExporter: f.descriptors.get(f.exporter.keyId)!, evidenceImporter: f.descriptors.get(f.importer.keyId)!, recoveryVerifier: f.descriptors.get(f.recoveryVerifier.keyId)!, allowedDnsNames: ['localhost', ...f.hosts.slice(1).map((x) => f.descriptors.get(x.keyId)!.hostId), ...f.clocks.map((x) => f.descriptors.get(x.keyId)!.hostId), ...f.stores.map((x) => f.descriptors.get(x.keyId)!.hostId), ...f.observers.map((x) => f.descriptors.get(x.keyId)!.hostId)], evidencePolicyDigest: sha256({ p: 1 }), issuedAt: at('2026-07-23T00:00:00Z'), expiresAt: at('2026-07-24T00:00:00Z') }), /dns_invalid|dns_coverage/); });
test('v33.48 rejects incomplete DNS coverage', () => { const f = fixture(); const names = [...f.hosts, ...f.clocks, ...f.stores, ...f.observers].map((x) => f.descriptors.get(x.keyId)!.hostId).slice(1); assert.throws(() => createCoordinatorExternalDeploymentManifestV33_48({ deploymentAuthority: f.authority, deploymentAuthorityDescriptor: actor(f.authority, 'authority-q'), deploymentId: 'd', campaignId: 'c', artifactId: 'a', artifactDigest: sha256({ a: 1 }), baseQualificationVerdictDigest: f.base.verdictDigest, coordinatorHosts: f.hosts.map((x) => f.descriptors.get(x.keyId)!), clockRoots: f.clocks.map((x) => f.descriptors.get(x.keyId)!), appendOnlyStores: f.stores.map((x) => f.descriptors.get(x.keyId)!), partitionObservers: f.observers.map((x) => f.descriptors.get(x.keyId)!), topologyAuditors: f.auditors.map((x) => f.descriptors.get(x.keyId)!), evidenceExporter: f.descriptors.get(f.exporter.keyId)!, evidenceImporter: f.descriptors.get(f.importer.keyId)!, recoveryVerifier: f.descriptors.get(f.recoveryVerifier.keyId)!, allowedDnsNames: names, evidencePolicyDigest: sha256({ p: 1 }), issuedAt: at('2026-07-23T00:00:00Z'), expiresAt: at('2026-07-24T00:00:00Z') }), /dns_coverage/); });
test('v33.48 rejects expired manifest readiness', () => { const f = fixture(); assert.throws(() => verifyCoordinatorDeploymentReadinessV33_48({ manifest: f.manifest, acceptances: f.acceptances, trust: f.trust, verifiedAt: at('2026-09-23T00:00:00Z') }), /expired/); });
test('v33.48 rejects missing role acceptance', () => { const f = fixture(); assert.throws(() => verifyCoordinatorDeploymentReadinessV33_48({ manifest: f.manifest, acceptances: f.acceptances.slice(0, -1), trust: f.trust, verifiedAt: at('2026-07-23T01:00:00Z') }), /cardinality/); });
test('v33.48 rejects duplicate role acceptance', () => { const f = fixture(); assert.throws(() => verifyCoordinatorDeploymentReadinessV33_48({ manifest: f.manifest, acceptances: [...f.acceptances.slice(0, -1), f.acceptances[0]!], trust: f.trust, verifiedAt: at('2026-07-23T01:00:00Z') }), /duplicate|missing/); });
test('v33.48 rejects wrong acceptance assignment', () => { const f = fixture(); const wrong = createCoordinatorDeploymentRoleAcceptanceV33_48({ actor: f.hosts[1]!, actorDescriptor: f.descriptors.get(f.hosts[1]!.keyId)!, role: 'COORDINATOR_HOST', ordinal: 1, manifestDigest: f.manifest.payload.manifestDigest, acceptedAt: at('2026-07-23T00:20:00Z') }); assert.throws(() => verifyCoordinatorDeploymentReadinessV33_48({ manifest: f.manifest, acceptances: [wrong, ...f.acceptances.slice(1)], trust: f.trust, verifiedAt: at('2026-07-23T01:00:00Z') }), /assignment/); });
test('v33.48 rejects descriptor fingerprint mismatch', () => { const f = fixture(); const bad = { ...f.manifest, payload: { ...f.manifest.payload, coordinatorHosts: [{ ...f.manifest.payload.coordinatorHosts[0]!, keyFingerprint: '0'.repeat(64) }, ...f.manifest.payload.coordinatorHosts.slice(1)] } }; assert.throws(() => verifyCoordinatorDeploymentReadinessV33_48({ manifest: bad, acceptances: f.acceptances, trust: f.trust, verifiedAt: at('2026-07-23T01:00:00Z') }), /signature|fingerprint/); });
test('v33.48 rejects short challenge nonce', () => { const f = fixture(); assert.throws(() => createCoordinatorEvidenceImportChallengeV33_48({ importer: f.importer, manifestDigest: f.manifest.payload.manifestDigest, nonce: new Uint8Array(8), issuedAt: at('2026-07-23T01:00:00Z'), expiresAt: at('2026-07-23T02:00:00Z') }), /challenge_invalid/); });
test('v33.48 rejects expired challenge', () => { const f = fixture(); assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: f.base, manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, infrastructureEvidence: f.infrastructureEvidence, bundle: f.bundle, fileBytes: f.fileBytes, recovery: f.recovery, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T03:00:00Z') }), /challenge_expired/); });
test('v33.48 blocks challenge replay', () => { const f = fixture(); const consumed = new Set<string>(); importFixture(f, consumed); assert.throws(() => importFixture(f, consumed), /challenge_replay/); });
test('v33.48 rejects extra inventory file', () => { const f = fixture(); assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: f.base, manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, infrastructureEvidence: f.infrastructureEvidence, bundle: f.bundle, fileBytes: { ...f.fileBytes, 'extra.txt': Buffer.from('extra') }, recovery: f.recovery, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T01:05:00Z') }), /exact_set/); });
test('v33.48 rejects missing inventory file', () => { const f = fixture(); const bytes = { ...f.fileBytes }; delete bytes['hosts/host-1.json']; assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: f.base, manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, infrastructureEvidence: f.infrastructureEvidence, bundle: f.bundle, fileBytes: bytes, recovery: f.recovery, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T01:05:00Z') }), /exact_set/); });
test('v33.48 rejects tampered inventory bytes', () => { const f = fixture(); assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: f.base, manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, infrastructureEvidence: f.infrastructureEvidence, bundle: f.bundle, fileBytes: { ...f.fileBytes, 'hosts/host-1.json': Buffer.from('tampered') }, recovery: f.recovery, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T01:05:00Z') }), /inventory_bytes/); });
test('v33.48 rejects path traversal at bundle creation', () => { const f = fixture(); assert.throws(() => createCoordinatorJournalEvidenceBundleV33_48({ exporter: f.exporter, manifestDigest: f.manifest.payload.manifestDigest, challengeDigest: f.challenge.payload.challengeDigest, baseQualificationVerdictDigest: f.base.verdictDigest, executionClass: 'LOCAL_REHEARSAL', qualificationStatus: 'LOCAL_COORDINATOR_JOURNAL_QUALIFICATION_REHEARSAL_ONLY', externalTopologyObserved: false, externalCoordinatorHostCount: 0, externalClockRootCount: 0, externalAppendOnlyStoreCount: 0, externalPartitionObserverCount: 0, infrastructureEvidence: [], files: { '../escape': { bytes: Buffer.from('x'), mediaType: 'text/plain' }, ...f.files }, exportedAt: at('2026-07-23T01:03:00Z') }), /inventory_path/); });
test('v33.48 blocks local evidence relabeling', () => { const f = fixture(); const relabel = { ...f.bundle, payload: { ...f.bundle.payload, executionClass: 'LIVE_EXTERNAL' as const, qualificationStatus: 'EXTERNAL_COORDINATOR_JOURNAL_QUALIFIED' as const, externalTopologyObserved: true, externalCoordinatorHostCount: 4, externalClockRootCount: 2, externalAppendOnlyStoreCount: 3, externalPartitionObserverCount: 2 } }; assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: f.base, manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, infrastructureEvidence: [], bundle: relabel, fileBytes: f.fileBytes, recovery: f.recovery, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T01:05:00Z') }), /bundle_signature|evidence_cardinality/); });
test('v33.48 rejects external bundle without evidence', () => { const f = fixture('external'); assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: f.base, manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, infrastructureEvidence: [], bundle: f.bundle, fileBytes: f.fileBytes, recovery: f.recovery, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T01:05:00Z') }), /evidence_cardinality/); });
test('v33.48 rejects one-auditor external evidence', () => { const f = fixture('external'); const half = f.infrastructureEvidence.filter((row) => row.issuerKeyId === f.auditors[0]!.keyId); const bundle = resign(f.bundle, f.exporter, 'bundleDigest', { infrastructureEvidenceDigests: half.map((row) => row.payload.evidenceDigest).sort() }); assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: f.base, manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, infrastructureEvidence: half, bundle, fileBytes: f.fileBytes, recovery: f.recovery, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T01:05:00Z') }), /evidence_cardinality|evidence_quorum/); });
test('v33.48 rejects evidence self-attestation creation', () => { const f = fixture(); assert.throws(() => createExternalInfrastructureEvidenceAttestationV33_48({ auditor: f.hosts[0]!, manifestDigest: f.manifest.payload.manifestDigest, role: 'COORDINATOR_HOST', ordinal: 1, subject: f.descriptors.get(f.hosts[0]!.keyId)!, topology: 'INDEPENDENT_EXTERNAL_ATTESTED', providerEvidenceDigest: sha256({ provider: 1 }), observedAt: at('2026-07-23T01:02:00Z') }), /self_attestation/); });
test('v33.48 rejects untrusted provider evidence digest', () => { const f = fixture('external'); const trust = { ...f.trust, trustedExternalEvidenceDigests: [] }; assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: f.base, manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, infrastructureEvidence: f.infrastructureEvidence, bundle: f.bundle, fileBytes: f.fileBytes, recovery: f.recovery, trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T01:05:00Z') }), /external_evidence_binding/); });
test('v33.48 rejects external evidence subject substitution', () => { const f = fixture('external'); const first = f.infrastructureEvidence[0]!; const bad = resign(first, f.auditors[0]!, 'evidenceDigest', { subject: f.descriptors.get(f.hosts[1]!.keyId)! }); const evidence = [bad, ...f.infrastructureEvidence.slice(1)]; const bundle = resign(f.bundle, f.exporter, 'bundleDigest', { infrastructureEvidenceDigests: evidence.map((row) => row.payload.evidenceDigest).sort() }); assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: f.base, manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, infrastructureEvidence: evidence, bundle, fileBytes: f.fileBytes, recovery: f.recovery, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T01:05:00Z') }), /evidence_subject/); });
test('v33.48 rejects bundle evidence digest mismatch', () => { const f = fixture('external'); const bundle = resign(f.bundle, f.exporter, 'bundleDigest', { infrastructureEvidenceDigests: f.bundle.payload.infrastructureEvidenceDigests.slice(1) }); assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: f.base, manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, infrastructureEvidence: f.infrastructureEvidence, bundle, fileBytes: f.fileBytes, recovery: f.recovery, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T01:05:00Z') }), /evidence_cardinality|evidence_inventory/); });
test('v33.48 rejects recovery outside stores path', () => { const f = fixture(); assert.throws(() => createAppendOnlyStoreRecoveryAttestationV33_48({ recoveryVerifier: f.recoveryVerifier, manifestDigest: f.manifest.payload.manifestDigest, bundleDigest: f.bundle.payload.bundleDigest, durableStoreEvidencePath: 'hosts/host-1.json', inventoryFileDigest: f.bundle.payload.files.find((row) => row.path === 'hosts/host-1.json')!.sha256, restoredBytes: f.fileBytes['hosts/host-1.json']!, fileFsync: true, directoryFsync: true, rereadVerified: true, restoredAt: at('2026-07-23T01:04:00Z') }), /path_invalid/); });
test('v33.48 rejects recovery byte mismatch', () => { const f = fixture(); const bad = resign(f.recovery, f.recoveryVerifier, 'recoveryDigest', { restoredBytesDigest: sha256({ wrong: true }) }); assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: f.base, manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, infrastructureEvidence: f.infrastructureEvidence, bundle: f.bundle, fileBytes: f.fileBytes, recovery: bad, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T01:05:00Z') }), /recovery_binding/); });
test('v33.48 rejects recovery signer substitution', () => { const f = fixture(); const bad = signEnvelope(f.recovery.payload, f.exporter); const trust = { ...f.trust, recoveryVerifierRegistry: registry(f.recoveryVerifier, f.exporter), trustedRecoveryVerifierIds: [f.recoveryVerifier.keyId, f.exporter.keyId] }; assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: f.base, manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, infrastructureEvidence: f.infrastructureEvidence, bundle: f.bundle, fileBytes: f.fileBytes, recovery: bad, trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T01:05:00Z') }), /recovery_issuer/); });
test('v33.48 rejects challenge signer substitution', () => { const f = fixture(); const bad = signEnvelope(f.challenge.payload, f.exporter); const trust = { ...f.trust, evidenceImporterRegistry: registry(f.importer, f.exporter), trustedEvidenceImporterIds: [f.importer.keyId, f.exporter.keyId] }; assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: f.base, manifest: f.manifest, readiness: f.readiness, challenge: bad, infrastructureEvidence: f.infrastructureEvidence, bundle: f.bundle, fileBytes: f.fileBytes, recovery: f.recovery, trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T01:05:00Z') }), /challenge_issuer/); });
test('v33.48 rejects bundle signer substitution', () => { const f = fixture(); const bad = signEnvelope(f.bundle.payload, f.importer); const trust = { ...f.trust, evidenceExporterRegistry: registry(f.exporter, f.importer), trustedEvidenceExporterIds: [f.exporter.keyId, f.importer.keyId] }; assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: f.base, manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, infrastructureEvidence: f.infrastructureEvidence, bundle: bad, fileBytes: f.fileBytes, recovery: f.recovery, trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T01:05:00Z') }), /bundle_issuer/); });
test('v33.48 rejects base production authority mutation', () => { const f = fixture(); assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: { ...f.base, productionAuthority: 'PRODUCTION' as never }, manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, infrastructureEvidence: f.infrastructureEvidence, bundle: f.bundle, fileBytes: f.fileBytes, recovery: f.recovery, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T01:05:00Z') }), /base_verdict_binding/); });
test('v33.48 rejects base verdict digest mismatch', () => { const f = fixture(); assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: { ...f.base, verdictDigest: sha256({ wrong: true }) }, manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, infrastructureEvidence: f.infrastructureEvidence, bundle: f.bundle, fileBytes: f.fileBytes, recovery: f.recovery, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T01:05:00Z') }), /base_verdict_binding/); });
test('v33.48 rejects readiness digest tamper', () => { const f = fixture(); assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: f.base, manifest: f.manifest, readiness: { ...f.readiness, readinessDigest: sha256({ wrong: true }) }, challenge: f.challenge, infrastructureEvidence: f.infrastructureEvidence, bundle: f.bundle, fileBytes: f.fileBytes, recovery: f.recovery, trust: f.trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T01:05:00Z') }), /readiness_digest/); });
test('v33.48 rejects manifest signature tamper', () => { const f = fixture(); const bad = { ...f.manifest, signature: (f.manifest.signature.startsWith('A') ? 'B' : 'A') + f.manifest.signature.slice(1) }; assert.throws(() => verifyCoordinatorDeploymentReadinessV33_48({ manifest: bad, acceptances: f.acceptances, trust: f.trust, verifiedAt: at('2026-07-23T01:00:00Z') }), /manifest_signature/); });
test('v33.48 rejects infrastructure auditor outside manifest', () => { const f = fixture('external'); const outsider = generateSigningIdentity('v3348-outsider-auditor'); const first = f.infrastructureEvidence[0]!; const bad = signEnvelope(first.payload, outsider); const evidence = [bad, ...f.infrastructureEvidence.slice(1)]; const bundle = resign(f.bundle, f.exporter, 'bundleDigest', { infrastructureEvidenceDigests: evidence.map((row) => row.payload.evidenceDigest).sort() }); const trust = { ...f.trust, evidenceAuditorRegistry: registry(...f.auditors, outsider), trustedEvidenceAuditorIds: [...f.auditors.map((x) => x.keyId), outsider.keyId] }; assert.throws(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: f.base, manifest: f.manifest, readiness: f.readiness, challenge: f.challenge, infrastructureEvidence: evidence, bundle, fileBytes: f.fileBytes, recovery: f.recovery, trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-23T01:05:00Z') }), /auditor_assignment/); });
test('v33.48 receipt always preserves no production authority', () => { const receipt = importFixture(); assert.equal(receipt.productionAuthority, 'NONE'); assert.equal(receipt.externalEffectsExecuted, 0); });
