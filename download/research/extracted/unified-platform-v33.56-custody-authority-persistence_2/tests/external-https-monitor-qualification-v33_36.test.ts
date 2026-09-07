import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
  type SigningIdentity,
} from '../src/contracts/crypto.js';
import {
  createDurableMonitorRetrievalReceiptV33_36,
  createExternalHostEvidenceAttestationV33_36,
  createExternalTimeAttestationV33_36,
  createMonitorGossipStatementV33_36,
  createMonitorPartitionStatementV33_36,
  createPinnedHttpsPublicationV33_36,
  createReplacementMonitorActivationV33_36,
  detectMonitorSplitViewV33_36,
  finalizeMonitorReplacementV33_36,
  verifyHttpsMonitorQualificationV33_36,
  type QualificationActorDescriptorV33_36,
} from '../src/app/external-https-monitor-qualification-v33_36.js';

const at = (value: string) => new Date(value);
const verifiedAt = at('2026-07-22T18:00:00.000Z');
const digest = (name: string) => sha256({ name });
const registry = (...ids: SigningIdentity[]) => { const result = new KeyRegistry(); for (const id of ids) result.register(id.keyId, id.publicKey); return result; };
const actor = (id: SigningIdentity, n: string): QualificationActorDescriptorV33_36 => {
  const keys = registry(id);
  return { keyId: id.keyId, keyFingerprint: keys.fingerprint(id.keyId)!, organizationId: `${n}-org`, hostId: `${n}-host`, administratorId: `${n}-admin` };
};

function fixture(external = false) {
  const publisher = generateSigningIdentity('v3336-publisher');
  const timeSources = [1,2,3].map((n) => generateSigningIdentity(`v3336-time-${n}`));
  const monitors = [1,2,3].map((n) => generateSigningIdentity(`v3336-monitor-${n}`));
  const authority = generateSigningIdentity('v3336-qualification-authority');
  const auditors = [1,2].map((n) => generateSigningIdentity(`v3336-auditor-${n}`));
  const publisherDescriptor = actor(publisher, 'publisher');
  const timeDescriptors = timeSources.map((id, i) => actor(id, `time-${i+1}`));
  const monitorDescriptors = monitors.map((id, i) => actor(id, `monitor-${i+1}`));
  const auditorDescriptors = auditors.map((id, i) => actor(id, `auditor-${i+1}`));
  const evidence = new Map<string, ReturnType<typeof createExternalHostEvidenceAttestationV33_36>>();
  if (external) {
    const subjects = [publisherDescriptor, ...timeDescriptors, ...monitorDescriptors];
    subjects.forEach((subject, i) => {
      const auditor = auditors[i % auditors.length]!;
      const auditorDescriptor = auditorDescriptors[i % auditors.length]!;
      evidence.set(subject.keyId, createExternalHostEvidenceAttestationV33_36({ auditor, auditorDescriptor, subjectDescriptor: subject, providerEvidenceDigest: digest(`provider-${subject.keyId}`), observedAt: at('2026-07-22T17:00:00.000Z') }));
    });
  }
  const evidenceDigest = (keyId: string) => evidence.get(keyId)?.payload.evidenceDigest ?? null;
  const topology = external ? 'INDEPENDENT_EXTERNAL_ATTESTED' as const : 'LOCAL_HTTPS_REHEARSAL' as const;
  const content = Buffer.from(JSON.stringify({ version: '33.36', payload: 'qualification' }));
  const publication = createPinnedHttpsPublicationV33_36({ publisher, publisherDescriptor, artifactId: 'artifact-v3336', content, endpointUri: 'https://localhost:9443/artifact.json', serverName: 'localhost', certificateSha256: digest('certificate'), publishedAt: at('2026-07-22T17:10:00.000Z'), topology, externalHostEvidenceDigest: evidenceDigest(publisher.keyId) });
  const timeAttestations = timeSources.map((source, i) => createExternalTimeAttestationV33_36({ source, sourceDescriptor: timeDescriptors[i]!, sourceId: `time-source-${i+1}`, endpointUri: `https://time-${i+1}.example/time`, unixTimeMs: 1784740200000 + i * 100, maximumErrorMs: 500, observedAt: at(`2026-07-22T17:10:0${i}.000Z`), topology, externalHostEvidenceDigest: evidenceDigest(source.keyId) }));
  const retrievals = monitors.map((monitor, i) => createDurableMonitorRetrievalReceiptV33_36({ monitor, monitorDescriptor: monitorDescriptors[i]!, monitorId: `monitor-${i+1}`, monitorSetVersion: 1, publication, content, observedCertificateSha256: publication.payload.certificateSha256, observedTlsProtocol: 'TLSv1.3', httpStatus: 200, processId: 7000+i, timeAttestations: timeAttestations.slice(0,2), durableStoreId: `store-${i+1}`, durableStorePath: `/durable/monitor-${i+1}/receipt.json`, durableFileBytes: content, fsyncObserved: true, observedAt: at(`2026-07-22T17:11:0${i}.000Z`), topology, externalHostEvidenceDigest: evidenceDigest(monitor.keyId) }));
  const gossip = monitors.map((monitor, i) => createMonitorGossipStatementV33_36({ monitor, monitorDescriptor: monitorDescriptors[i]!, monitors: monitorDescriptors, monitorSetVersion: 1, retrieval: retrievals[i]!, peerRetrievals: retrievals, observedAt: at(`2026-07-22T17:12:0${i}.000Z`) }));
  const trust = {
    publisherRegistry: registry(publisher), trustedPublisherIds: [publisher.keyId],
    timeRegistry: registry(...timeSources), trustedTimeSourceIds: timeSources.map((x) => x.keyId),
    monitorRegistry: registry(...monitors), trustedMonitorIds: monitors.map((x) => x.keyId),
    qualificationAuthorityRegistry: registry(authority), trustedQualificationAuthorityIds: [authority.keyId],
    topologyAuditorRegistry: registry(...auditors), trustedTopologyAuditorIds: auditors.map((x) => x.keyId),
    monitors: monitorDescriptors, timeQuorum: 2, monitorQuorum: 3, maximumClockSkewMs: 1000,
  };
  return { publisher, publisherDescriptor, timeSources, timeDescriptors, monitors, monitorDescriptors, authority, auditors, auditorDescriptors, evidence: [...evidence.values()], content, publication, timeAttestations, retrievals, gossip, trust, topology };
}

test('local HTTPS qualification verifies without external topology claim', () => {
  const f = fixture();
  const verdict = verifyHttpsMonitorQualificationV33_36({ publication: f.publication, timeAttestations: f.timeAttestations, retrievals: f.retrievals, gossip: f.gossip, trust: f.trust, verifiedAt });
  assert.equal(verdict.status, 'LOCAL_HTTPS_MONITOR_REHEARSAL_ONLY'); assert.equal(verdict.externalTopologyObserved, false); assert.equal(verdict.durableRetentionVerified, true);
});

test('independently attested external topology qualifies only with signed host evidence', () => {
  const f = fixture(true);
  const verdict = verifyHttpsMonitorQualificationV33_36({ publication: f.publication, timeAttestations: f.timeAttestations, externalHostEvidenceAttestations: f.evidence, retrievals: f.retrievals, gossip: f.gossip, trust: f.trust, verifiedAt });
  assert.equal(verdict.status, 'EXTERNAL_MONITOR_QUALIFIED'); assert.equal(verdict.externalTopologyObserved, true);
});

test('external labels without host evidence remain unqualified', () => {
  const f = fixture(true);
  const verdict = verifyHttpsMonitorQualificationV33_36({ publication: f.publication, timeAttestations: f.timeAttestations, retrievals: f.retrievals, gossip: f.gossip, trust: f.trust, verifiedAt });
  assert.equal(verdict.externalTopologyObserved, false);
});

test('HTTP publication is rejected', () => {
  const f = fixture();
  assert.throws(() => createPinnedHttpsPublicationV33_36({ publisher: f.publisher, publisherDescriptor: f.publisherDescriptor, artifactId: 'x', content: f.content, endpointUri: 'http://localhost/x', serverName: 'localhost', certificateSha256: digest('c'), publishedAt: verifiedAt, topology: 'LOCAL_HTTPS_REHEARSAL', externalHostEvidenceDigest: null }), /v33_36_publication_endpoint_invalid/);
});

test('server name must match endpoint host', () => {
  const f = fixture();
  assert.throws(() => createPinnedHttpsPublicationV33_36({ publisher: f.publisher, publisherDescriptor: f.publisherDescriptor, artifactId: 'x', content: f.content, endpointUri: 'https://localhost/x', serverName: 'example.com', certificateSha256: digest('c'), publishedAt: verifiedAt, topology: 'LOCAL_HTTPS_REHEARSAL', externalHostEvidenceDigest: null }), /v33_36_server_name_invalid/);
});

test('invalid certificate pin is rejected', () => {
  const f = fixture();
  assert.throws(() => createPinnedHttpsPublicationV33_36({ publisher: f.publisher, publisherDescriptor: f.publisherDescriptor, artifactId: 'x', content: f.content, endpointUri: 'https://localhost/x', serverName: 'localhost', certificateSha256: 'bad', publishedAt: verifiedAt, topology: 'LOCAL_HTTPS_REHEARSAL', externalHostEvidenceDigest: null }), /v33_36_certificate_pin_invalid/);
});

test('local topology cannot carry external evidence digest', () => {
  const f = fixture();
  assert.throws(() => createPinnedHttpsPublicationV33_36({ publisher: f.publisher, publisherDescriptor: f.publisherDescriptor, artifactId: 'x', content: f.content, endpointUri: 'https://localhost/x', serverName: 'localhost', certificateSha256: digest('c'), publishedAt: verifiedAt, topology: 'LOCAL_HTTPS_REHEARSAL', externalHostEvidenceDigest: digest('e') }), /v33_36_publication_topology_evidence_invalid/);
});

test('time source endpoint must use HTTPS', () => {
  const f = fixture();
  assert.throws(() => createExternalTimeAttestationV33_36({ source: f.timeSources[0]!, sourceDescriptor: f.timeDescriptors[0]!, sourceId: 'bad-time', endpointUri: 'http://time.local', unixTimeMs: 1, maximumErrorMs: 1, observedAt: verifiedAt, topology: 'LOCAL_HTTPS_REHEARSAL', externalHostEvidenceDigest: null }), /v33_36_time_endpoint_invalid/);
});

test('time quorum below two is rejected', () => {
  const f = fixture();
  assert.throws(() => verifyHttpsMonitorQualificationV33_36({ publication: f.publication, timeAttestations: f.timeAttestations.slice(0,1), retrievals: f.retrievals, gossip: f.gossip, trust: f.trust, verifiedAt }), /v33_36_time_quorum_not_met|v33_36_retrieval_time_binding_invalid/);
});

test('clock skew above policy is rejected', () => {
  const f = fixture();
  const late = createExternalTimeAttestationV33_36({ source: f.timeSources[1]!, sourceDescriptor: f.timeDescriptors[1]!, sourceId: 'late', endpointUri: 'https://time-2.example/time', unixTimeMs: f.timeAttestations[0]!.payload.unixTimeMs + 5000, maximumErrorMs: 500, observedAt: verifiedAt, topology: 'LOCAL_HTTPS_REHEARSAL', externalHostEvidenceDigest: null });
  assert.throws(() => verifyHttpsMonitorQualificationV33_36({ publication: f.publication, timeAttestations: [f.timeAttestations[0]!, late], retrievals: f.retrievals, gossip: f.gossip, trust: f.trust, verifiedAt }), /v33_36_clock_skew_exceeded/);
});

test('duplicate time organizations fail topology quorum', () => {
  const f = fixture();
  const duplicateDescriptor = { ...f.timeDescriptors[1]!, organizationId: f.timeDescriptors[0]!.organizationId };
  const duplicate = createExternalTimeAttestationV33_36({ source: f.timeSources[1]!, sourceDescriptor: duplicateDescriptor, sourceId: 'duplicate-org', endpointUri: 'https://time-2.example/time', unixTimeMs: f.timeAttestations[1]!.payload.unixTimeMs, maximumErrorMs: 500, observedAt: verifiedAt, topology: 'LOCAL_HTTPS_REHEARSAL', externalHostEvidenceDigest: null });
  assert.throws(() => verifyHttpsMonitorQualificationV33_36({ publication: f.publication, timeAttestations: [f.timeAttestations[0]!, duplicate], retrievals: f.retrievals, gossip: f.gossip, trust: f.trust, verifiedAt }), /v33_36_time_quorum_not_met/);
});

test('TLS pin mismatch is rejected before receipt signing', () => {
  const f = fixture();
  assert.throws(() => createDurableMonitorRetrievalReceiptV33_36({ monitor: f.monitors[0]!, monitorDescriptor: f.monitorDescriptors[0]!, monitorId: 'm', monitorSetVersion: 1, publication: f.publication, content: f.content, observedCertificateSha256: digest('other-cert'), observedTlsProtocol: 'TLSv1.3', httpStatus: 200, processId: 1, timeAttestations: f.timeAttestations, durableStoreId: 's', durableStorePath: '/s', durableFileBytes: f.content, fsyncObserved: true, observedAt: verifiedAt, topology: 'LOCAL_HTTPS_REHEARSAL', externalHostEvidenceDigest: null }), /v33_36_tls_pin_mismatch/);
});

test('TLS 1.2 is rejected', () => {
  const f = fixture();
  assert.throws(() => createDurableMonitorRetrievalReceiptV33_36({ monitor: f.monitors[0]!, monitorDescriptor: f.monitorDescriptors[0]!, monitorId: 'm', monitorSetVersion: 1, publication: f.publication, content: f.content, observedCertificateSha256: f.publication.payload.certificateSha256, observedTlsProtocol: 'TLSv1.2', httpStatus: 200, processId: 1, timeAttestations: f.timeAttestations, durableStoreId: 's', durableStorePath: '/s', durableFileBytes: f.content, fsyncObserved: true, observedAt: verifiedAt, topology: 'LOCAL_HTTPS_REHEARSAL', externalHostEvidenceDigest: null }), /v33_36_tls_pin_mismatch/);
});

test('durable file bytes must equal fetched bytes', () => {
  const f = fixture();
  assert.throws(() => createDurableMonitorRetrievalReceiptV33_36({ monitor: f.monitors[0]!, monitorDescriptor: f.monitorDescriptors[0]!, monitorId: 'm', monitorSetVersion: 1, publication: f.publication, content: f.content, observedCertificateSha256: f.publication.payload.certificateSha256, observedTlsProtocol: 'TLSv1.3', httpStatus: 200, processId: 1, timeAttestations: f.timeAttestations, durableStoreId: 's', durableStorePath: '/s', durableFileBytes: Buffer.from('different'), fsyncObserved: true, observedAt: verifiedAt, topology: 'LOCAL_HTTPS_REHEARSAL', externalHostEvidenceDigest: null }), /v33_36_durable_file_mismatch/);
});

test('fsync evidence is mandatory', () => {
  const f = fixture();
  assert.throws(() => createDurableMonitorRetrievalReceiptV33_36({ monitor: f.monitors[0]!, monitorDescriptor: f.monitorDescriptors[0]!, monitorId: 'm', monitorSetVersion: 1, publication: f.publication, content: f.content, observedCertificateSha256: f.publication.payload.certificateSha256, observedTlsProtocol: 'TLSv1.3', httpStatus: 200, processId: 1, timeAttestations: f.timeAttestations, durableStoreId: 's', durableStorePath: '/s', durableFileBytes: f.content, fsyncObserved: false, observedAt: verifiedAt, topology: 'LOCAL_HTTPS_REHEARSAL', externalHostEvidenceDigest: null }), /v33_36_durable_retention_invalid/);
});

test('retrieval quorum below three is rejected', () => {
  const f = fixture();
  assert.throws(() => verifyHttpsMonitorQualificationV33_36({ publication: f.publication, timeAttestations: f.timeAttestations, retrievals: f.retrievals.slice(0,2), gossip: f.gossip.slice(0,2), trust: f.trust, verifiedAt }), /v33_36_retrieval_quorum_not_met/);
});

test('forged retrieval signature is rejected', () => {
  const f = fixture(); const forged = { ...f.retrievals[0]!, signature: `${f.retrievals[0]!.signature}x` };
  assert.throws(() => verifyHttpsMonitorQualificationV33_36({ publication: f.publication, timeAttestations: f.timeAttestations, retrievals: [forged, ...f.retrievals.slice(1)], gossip: f.gossip, trust: f.trust, verifiedAt }), /v33_36_retrieval_signature_invalid/);
});

test('tampered publication bytes binding is rejected', () => {
  const f = fixture(); const payload = { ...f.publication.payload, contentDigest: digest('evil') };
  const tampered = { ...f.publication, payload };
  assert.throws(() => verifyHttpsMonitorQualificationV33_36({ publication: tampered, timeAttestations: f.timeAttestations, retrievals: f.retrievals, gossip: f.gossip, trust: f.trust, verifiedAt }), /v33_36_publication_signature_invalid/);
});

test('gossip must cover every peer retrieval', () => {
  const f = fixture(); const payload = f.gossip[0]!.payload; const material = { ...payload, peerRetrievalDigests: payload.peerRetrievalDigests.slice(0,1) }; delete (material as { gossipDigest?: string }).gossipDigest;
  const bad = signEnvelope({ ...material, gossipDigest: sha256(material) }, f.monitors[0]!);
  assert.throws(() => verifyHttpsMonitorQualificationV33_36({ publication: f.publication, timeAttestations: f.timeAttestations, retrievals: f.retrievals, gossip: [bad, ...f.gossip.slice(1)], trust: f.trust, verifiedAt }), /v33_36_gossip_peer_coverage_invalid/);
});

test('split view across content digests is detected', () => {
  const f = fixture(); const payload = f.retrievals[2]!.payload; const material = { ...payload, contentDigest: digest('split-content') }; delete (material as { retrievalDigest?: string }).retrievalDigest;
  const split = signEnvelope({ ...material, retrievalDigest: sha256(material) }, f.monitors[2]!);
  assert.equal(detectMonitorSplitViewV33_36([f.retrievals[0]!, f.retrievals[1]!, split]).length, 1);
});

test('partition statement before minimum duration is rejected', () => {
  const f = fixture();
  assert.throws(() => createMonitorPartitionStatementV33_36({ observer: f.monitors[0]!, observerDescriptor: f.monitorDescriptors[0]!, monitors: f.monitorDescriptors, monitorSetVersion: 1, unavailableMonitorKeyId: f.monitors[2]!.keyId, partitionStartedAt: at('2026-07-22T17:00:00.000Z'), observedAt: at('2026-07-22T17:00:01.000Z'), minimumPartitionMs: 10_000 }), /v33_36_partition_duration_insufficient/);
});

test('unavailable monitor cannot vote on its own partition', () => {
  const f = fixture();
  assert.throws(() => createMonitorPartitionStatementV33_36({ observer: f.monitors[2]!, observerDescriptor: f.monitorDescriptors[2]!, monitors: f.monitorDescriptors, monitorSetVersion: 1, unavailableMonitorKeyId: f.monitors[2]!.keyId, partitionStartedAt: at('2026-07-22T17:00:00.000Z'), observedAt: at('2026-07-22T17:01:00.000Z'), minimumPartitionMs: 10_000 }), /v33_36_partition_observer_binding_invalid/);
});

test('monitor replacement requires two active observer statements', () => {
  const f = fixture(); const replacement = generateSigningIdentity('replacement-monitor'); const replacementDescriptor = actor(replacement, 'replacement-monitor');
  const statement = createMonitorPartitionStatementV33_36({ observer: f.monitors[0]!, observerDescriptor: f.monitorDescriptors[0]!, monitors: f.monitorDescriptors, monitorSetVersion: 1, unavailableMonitorKeyId: f.monitors[2]!.keyId, partitionStartedAt: at('2026-07-22T17:00:00.000Z'), observedAt: at('2026-07-22T17:01:00.000Z'), minimumPartitionMs: 10_000 });
  const activation = createReplacementMonitorActivationV33_36({ replacement, replacementDescriptor, predecessorMonitors: f.monitorDescriptors, predecessorMonitorSetVersion: 1, unavailableMonitorKeyId: f.monitors[2]!.keyId, challengeDigest: digest('replace'), activatedAt: verifiedAt });
  assert.throws(() => finalizeMonitorReplacementV33_36({ qualificationAuthority: f.authority, predecessorMonitors: f.monitorDescriptors, predecessorMonitorSetVersion: 1, partitionStatements: [statement], activation, monitorRegistry: registry(...f.monitors), replacementRegistry: registry(replacement), issuedAt: verifiedAt }), /v33_36_partition_quorum_not_met/);
});

test('replacement monitor cannot reuse an existing administrator', () => {
  const f = fixture(); const replacement = generateSigningIdentity('replacement-overlap'); const replacementDescriptor = { ...actor(replacement, 'replacement-overlap'), administratorId: f.monitorDescriptors[0]!.administratorId };
  assert.throws(() => createReplacementMonitorActivationV33_36({ replacement, replacementDescriptor, predecessorMonitors: f.monitorDescriptors, predecessorMonitorSetVersion: 1, unavailableMonitorKeyId: f.monitors[2]!.keyId, challengeDigest: digest('replace'), activatedAt: verifiedAt }), /v33_36_replacement_topology_invalid/);
});

test('monitor replacement certificate verifies and increments set version', () => {
  const f = fixture(); const replacement = generateSigningIdentity('replacement-good'); const replacementDescriptor = actor(replacement, 'replacement-good');
  const statements = [0,1].map((i) => createMonitorPartitionStatementV33_36({ observer: f.monitors[i]!, observerDescriptor: f.monitorDescriptors[i]!, monitors: f.monitorDescriptors, monitorSetVersion: 1, unavailableMonitorKeyId: f.monitors[2]!.keyId, partitionStartedAt: at('2026-07-22T17:00:00.000Z'), observedAt: at(`2026-07-22T17:01:0${i}.000Z`), minimumPartitionMs: 10_000 }));
  const activation = createReplacementMonitorActivationV33_36({ replacement, replacementDescriptor, predecessorMonitors: f.monitorDescriptors, predecessorMonitorSetVersion: 1, unavailableMonitorKeyId: f.monitors[2]!.keyId, challengeDigest: digest('replace'), activatedAt: verifiedAt });
  const certificate = finalizeMonitorReplacementV33_36({ qualificationAuthority: f.authority, predecessorMonitors: f.monitorDescriptors, predecessorMonitorSetVersion: 1, partitionStatements: statements, activation, monitorRegistry: registry(...f.monitors), replacementRegistry: registry(replacement), issuedAt: verifiedAt });
  assert.equal(certificate.payload.nextMonitorSetVersion, 2); assert.equal(certificate.payload.nextMonitors.length, 3);
});

test('host evidence auditor must be independent from subject', () => {
  const f = fixture();
  assert.throws(() => createExternalHostEvidenceAttestationV33_36({ auditor: f.publisher, auditorDescriptor: f.publisherDescriptor, subjectDescriptor: f.publisherDescriptor, providerEvidenceDigest: digest('provider'), observedAt: verifiedAt }), /v33_36_host_evidence_independence_invalid/);
});

test('forged external host evidence cannot qualify topology', () => {
  const f = fixture(true); const forged = { ...f.evidence[0]!, signature: `${f.evidence[0]!.signature}x` };
  assert.throws(() => verifyHttpsMonitorQualificationV33_36({ publication: f.publication, timeAttestations: f.timeAttestations, externalHostEvidenceAttestations: [forged, ...f.evidence.slice(1)], retrievals: f.retrievals, gossip: f.gossip, trust: f.trust, verifiedAt }), /v33_36_host_evidence_signature_invalid/);
});

test('production authority mutation is rejected even with a valid signature', () => {
  const f = fixture(); const payload = f.publication.payload; const material = { ...payload, productionAuthority: 'PRODUCTION' as never }; delete (material as { publicationDigest?: string }).publicationDigest;
  const mutated = signEnvelope({ ...material, publicationDigest: sha256(material) }, f.publisher) as typeof f.publication;
  assert.throws(() => verifyHttpsMonitorQualificationV33_36({ publication: mutated, timeAttestations: f.timeAttestations, retrievals: f.retrievals, gossip: f.gossip, trust: f.trust, verifiedAt }), /v33_36_publication_boundary_invalid/);
});
