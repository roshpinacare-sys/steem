import { randomUUID } from 'node:crypto';
import {
  KeyRegistry,
  sha256,
  sha256Bytes,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';
import type { ContinuityActorDescriptorV33_33 } from './federated-checkpoint-continuity-v33_33.js';

export interface QualificationActorDescriptorV33_36 extends ContinuityActorDescriptorV33_33 {
  readonly administratorId: string;
}

export type QualificationTopologyV33_36 = 'LOCAL_HTTPS_REHEARSAL' | 'INDEPENDENT_EXTERNAL_ATTESTED';


export interface ExternalHostEvidenceAttestationV33_36 {
  readonly version: '33.36';
  readonly evidenceId: string;
  readonly subjectKeyId: string;
  readonly subjectOrganizationId: string;
  readonly subjectHostId: string;
  readonly subjectAdministratorId: string;
  readonly auditorKeyId: string;
  readonly auditorOrganizationId: string;
  readonly auditorHostId: string;
  readonly auditorAdministratorId: string;
  readonly providerEvidenceDigest: string;
  readonly observedAt: string;
  readonly decision: 'INDEPENDENT_EXTERNAL_HOST_OBSERVED';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly evidenceDigest: string;
}

export interface ExternalTimeAttestationV33_36 {
  readonly version: '33.36';
  readonly attestationId: string;
  readonly sourceId: string;
  readonly sourceKeyId: string;
  readonly sourceOrganizationId: string;
  readonly sourceHostId: string;
  readonly sourceAdministratorId: string;
  readonly endpointUri: string;
  readonly unixTimeMs: number;
  readonly maximumErrorMs: number;
  readonly observedAt: string;
  readonly topology: QualificationTopologyV33_36;
  readonly externalHostEvidenceDigest: string | null;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly attestationDigest: string;
}

export interface PinnedHttpsPublicationV33_36 {
  readonly version: '33.36';
  readonly publicationId: string;
  readonly artifactId: string;
  readonly artifactDigest: string;
  readonly contentDigest: string;
  readonly endpointUri: string;
  readonly serverName: string;
  readonly tlsProtocol: 'TLSv1.3';
  readonly certificateSha256: string;
  readonly publisherKeyId: string;
  readonly publisherOrganizationId: string;
  readonly publisherHostId: string;
  readonly publisherAdministratorId: string;
  readonly publishedAt: string;
  readonly topology: QualificationTopologyV33_36;
  readonly externalHostEvidenceDigest: string | null;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly publicationDigest: string;
}

export interface DurableMonitorRetrievalReceiptV33_36 {
  readonly version: '33.36';
  readonly retrievalId: string;
  readonly monitorId: string;
  readonly monitorKeyId: string;
  readonly monitorOrganizationId: string;
  readonly monitorHostId: string;
  readonly monitorAdministratorId: string;
  readonly monitorSetVersion: number;
  readonly publicationDigest: string;
  readonly endpointUri: string;
  readonly artifactDigest: string;
  readonly contentDigest: string;
  readonly certificateSha256: string;
  readonly tlsProtocol: 'TLSv1.3';
  readonly httpStatus: 200;
  readonly processId: number;
  readonly observedAt: string;
  readonly timeAttestationDigests: readonly string[];
  readonly durableStoreId: string;
  readonly durableStorePathDigest: string;
  readonly durableFileDigest: string;
  readonly fsyncObserved: true;
  readonly networkFetchObserved: true;
  readonly topology: QualificationTopologyV33_36;
  readonly externalHostEvidenceDigest: string | null;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly retrievalDigest: string;
}

export interface MonitorPartitionStatementV33_36 {
  readonly version: '33.36';
  readonly statementId: string;
  readonly monitorSetDigest: string;
  readonly monitorSetVersion: number;
  readonly unavailableMonitorKeyId: string;
  readonly observerMonitorKeyId: string;
  readonly observerOrganizationId: string;
  readonly observerHostId: string;
  readonly observerAdministratorId: string;
  readonly partitionStartedAt: string;
  readonly observedAt: string;
  readonly minimumPartitionMs: number;
  readonly decision: 'MONITOR_UNAVAILABLE';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly statementDigest: string;
}

export interface ReplacementMonitorActivationV33_36 {
  readonly version: '33.36';
  readonly activationId: string;
  readonly predecessorMonitorSetDigest: string;
  readonly predecessorMonitorSetVersion: number;
  readonly nextMonitorSetVersion: number;
  readonly unavailableMonitorKeyId: string;
  readonly replacementMonitorId: string;
  readonly replacementMonitorKeyId: string;
  readonly replacementMonitorKeyFingerprint: string;
  readonly replacementOrganizationId: string;
  readonly replacementHostId: string;
  readonly replacementAdministratorId: string;
  readonly challengeDigest: string;
  readonly activatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly activationDigest: string;
}

export interface MonitorReplacementCertificateV33_36 {
  readonly version: '33.36';
  readonly certificateId: string;
  readonly predecessorMonitorSetDigest: string;
  readonly predecessorMonitorSetVersion: number;
  readonly nextMonitorSetVersion: number;
  readonly unavailableMonitorKeyId: string;
  readonly replacementMonitorKeyId: string;
  readonly partitionStatementDigests: readonly string[];
  readonly partitionObserverKeyIds: readonly string[];
  readonly activationDigest: string;
  readonly nextMonitors: readonly QualificationActorDescriptorV33_36[];
  readonly issuedAt: string;
  readonly qualificationAuthorityKeyId: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly replacementDigest: string;
}

export interface MonitorGossipStatementV33_36 {
  readonly version: '33.36';
  readonly gossipId: string;
  readonly monitorSetDigest: string;
  readonly monitorSetVersion: number;
  readonly publicationDigest: string;
  readonly artifactDigest: string;
  readonly contentDigest: string;
  readonly retrievalDigest: string;
  readonly peerRetrievalDigests: readonly string[];
  readonly monitorKeyId: string;
  readonly monitorOrganizationId: string;
  readonly monitorHostId: string;
  readonly monitorAdministratorId: string;
  readonly observedAt: string;
  readonly decision: 'CONSISTENT';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly gossipDigest: string;
}

export interface HttpsMonitorQualificationTrustV33_36 {
  readonly publisherRegistry: KeyRegistry;
  readonly trustedPublisherIds: readonly string[];
  readonly timeRegistry: KeyRegistry;
  readonly trustedTimeSourceIds: readonly string[];
  readonly monitorRegistry: KeyRegistry;
  readonly trustedMonitorIds: readonly string[];
  readonly qualificationAuthorityRegistry: KeyRegistry;
  readonly trustedQualificationAuthorityIds: readonly string[];
  readonly topologyAuditorRegistry: KeyRegistry;
  readonly trustedTopologyAuditorIds: readonly string[];
  readonly monitors: readonly QualificationActorDescriptorV33_36[];
  readonly timeQuorum: number;
  readonly monitorQuorum: number;
  readonly maximumClockSkewMs: number;
}

export interface HttpsMonitorQualificationVerdictV33_36 {
  readonly version: '33.36';
  readonly publicationDigest: string;
  readonly monitorSetDigest: string;
  readonly monitorSetVersion: number;
  readonly retrievalQuorumVerified: true;
  readonly timeQuorumVerified: true;
  readonly durableRetentionVerified: true;
  readonly pinnedTlsVerified: true;
  readonly gossipConsistencyVerified: true;
  readonly splitViewRejected: true;
  readonly monitorReplacementVerified: boolean;
  readonly distinctMonitorProcessesObserved: boolean;
  readonly networkFetchObserved: true;
  readonly externalTopologyObserved: boolean;
  readonly externalHumanParticipants: 0;
  readonly status: 'LOCAL_HTTPS_MONITOR_REHEARSAL_ONLY' | 'EXTERNAL_MONITOR_QUALIFIED';
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

function requireDate(value: Date, code: string): void {
  if (!Number.isFinite(value.getTime())) throw new Error(code);
}
function requireDigest(value: string, code: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(code);
}
function requireHttps(uri: string, code: string): URL {
  let parsed: URL;
  try { parsed = new URL(uri); } catch { throw new Error(code); }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.hash !== '') throw new Error(code);
  return parsed;
}
function assertBoundary(row: { productionAuthority: 'NONE'; externalEffectsExecuted: 0 }, code: string): void {
  if (row.productionAuthority !== 'NONE' || row.externalEffectsExecuted !== 0) throw new Error(code);
}
function assertDescriptor(row: QualificationActorDescriptorV33_36, code: string): void {
  if ([row.keyId, row.keyFingerprint, row.organizationId, row.hostId, row.administratorId].some((v) => v.trim() === '')) throw new Error(code);
  requireDigest(row.keyFingerprint, code);
}
function assertTopology(topology: QualificationTopologyV33_36, evidence: string | null, code: string): void {
  if (topology === 'INDEPENDENT_EXTERNAL_ATTESTED') {
    if (evidence === null) throw new Error(code);
    requireDigest(evidence, code);
  } else if (evidence !== null) throw new Error(code);
}
function distinctTopology(rows: readonly QualificationActorDescriptorV33_36[], code: string): void {
  const fields: (keyof QualificationActorDescriptorV33_36)[] = ['keyId', 'organizationId', 'hostId', 'administratorId'];
  for (const field of fields) if (new Set(rows.map((row) => row[field])).size !== rows.length) throw new Error(code);
}
function monitorSetDigest(version: number, monitors: readonly QualificationActorDescriptorV33_36[]): string {
  return sha256({ monitorSetVersion: version, monitors: [...monitors].sort((a, b) => a.keyId.localeCompare(b.keyId)) });
}

export function createExternalHostEvidenceAttestationV33_36(input: {
  readonly auditor: SigningIdentity;
  readonly auditorDescriptor: QualificationActorDescriptorV33_36;
  readonly subjectDescriptor: QualificationActorDescriptorV33_36;
  readonly providerEvidenceDigest: string;
  readonly observedAt: Date;
}): SignedEnvelope<ExternalHostEvidenceAttestationV33_36> {
  requireDate(input.observedAt, 'v33_36_host_evidence_time_invalid');
  assertDescriptor(input.auditorDescriptor, 'v33_36_host_evidence_auditor_invalid');
  assertDescriptor(input.subjectDescriptor, 'v33_36_host_evidence_subject_invalid');
  if (input.auditor.keyId !== input.auditorDescriptor.keyId) throw new Error('v33_36_host_evidence_auditor_binding_invalid');
  if ([input.auditorDescriptor.keyId, input.auditorDescriptor.organizationId, input.auditorDescriptor.hostId, input.auditorDescriptor.administratorId].some((value, index) => value === [input.subjectDescriptor.keyId, input.subjectDescriptor.organizationId, input.subjectDescriptor.hostId, input.subjectDescriptor.administratorId][index])) throw new Error('v33_36_host_evidence_independence_invalid');
  requireDigest(input.providerEvidenceDigest, 'v33_36_provider_evidence_digest_invalid');
  const material = {
    version: '33.36' as const, evidenceId: randomUUID(), subjectKeyId: input.subjectDescriptor.keyId,
    subjectOrganizationId: input.subjectDescriptor.organizationId, subjectHostId: input.subjectDescriptor.hostId,
    subjectAdministratorId: input.subjectDescriptor.administratorId, auditorKeyId: input.auditor.keyId,
    auditorOrganizationId: input.auditorDescriptor.organizationId, auditorHostId: input.auditorDescriptor.hostId,
    auditorAdministratorId: input.auditorDescriptor.administratorId, providerEvidenceDigest: input.providerEvidenceDigest,
    observedAt: input.observedAt.toISOString(), decision: 'INDEPENDENT_EXTERNAL_HOST_OBSERVED' as const,
    productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, evidenceDigest: sha256(material) }, input.auditor);
}

export function createExternalTimeAttestationV33_36(input: {
  readonly source: SigningIdentity;
  readonly sourceDescriptor: QualificationActorDescriptorV33_36;
  readonly sourceId: string;
  readonly endpointUri: string;
  readonly unixTimeMs: number;
  readonly maximumErrorMs: number;
  readonly observedAt: Date;
  readonly topology: QualificationTopologyV33_36;
  readonly externalHostEvidenceDigest: string | null;
}): SignedEnvelope<ExternalTimeAttestationV33_36> {
  requireDate(input.observedAt, 'v33_36_time_observed_at_invalid');
  assertDescriptor(input.sourceDescriptor, 'v33_36_time_source_descriptor_invalid');
  requireHttps(input.endpointUri, 'v33_36_time_endpoint_invalid');
  if (input.source.keyId !== input.sourceDescriptor.keyId || input.sourceId.trim() === '') throw new Error('v33_36_time_source_binding_invalid');
  if (!Number.isSafeInteger(input.unixTimeMs) || input.unixTimeMs <= 0 || !Number.isSafeInteger(input.maximumErrorMs) || input.maximumErrorMs < 0 || input.maximumErrorMs > 60_000) throw new Error('v33_36_time_value_invalid');
  assertTopology(input.topology, input.externalHostEvidenceDigest, 'v33_36_time_topology_evidence_invalid');
  const material = {
    version: '33.36' as const, attestationId: randomUUID(), sourceId: input.sourceId, sourceKeyId: input.source.keyId,
    sourceOrganizationId: input.sourceDescriptor.organizationId, sourceHostId: input.sourceDescriptor.hostId,
    sourceAdministratorId: input.sourceDescriptor.administratorId, endpointUri: input.endpointUri, unixTimeMs: input.unixTimeMs,
    maximumErrorMs: input.maximumErrorMs, observedAt: input.observedAt.toISOString(), topology: input.topology,
    externalHostEvidenceDigest: input.externalHostEvidenceDigest, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, attestationDigest: sha256(material) }, input.source);
}

export function createPinnedHttpsPublicationV33_36(input: {
  readonly publisher: SigningIdentity;
  readonly publisherDescriptor: QualificationActorDescriptorV33_36;
  readonly artifactId: string;
  readonly content: Uint8Array;
  readonly endpointUri: string;
  readonly serverName: string;
  readonly certificateSha256: string;
  readonly publishedAt: Date;
  readonly topology: QualificationTopologyV33_36;
  readonly externalHostEvidenceDigest: string | null;
}): SignedEnvelope<PinnedHttpsPublicationV33_36> {
  requireDate(input.publishedAt, 'v33_36_publication_time_invalid');
  assertDescriptor(input.publisherDescriptor, 'v33_36_publisher_descriptor_invalid');
  const endpoint = requireHttps(input.endpointUri, 'v33_36_publication_endpoint_invalid');
  if (input.publisher.keyId !== input.publisherDescriptor.keyId || input.artifactId.trim() === '') throw new Error('v33_36_publisher_binding_invalid');
  if (input.serverName.trim() === '' || endpoint.hostname !== input.serverName) throw new Error('v33_36_server_name_invalid');
  requireDigest(input.certificateSha256, 'v33_36_certificate_pin_invalid');
  assertTopology(input.topology, input.externalHostEvidenceDigest, 'v33_36_publication_topology_evidence_invalid');
  const contentDigest = sha256Bytes(input.content);
  const material = {
    version: '33.36' as const, publicationId: randomUUID(), artifactId: input.artifactId, artifactDigest: sha256({ artifactId: input.artifactId, contentDigest }),
    contentDigest, endpointUri: input.endpointUri, serverName: input.serverName, tlsProtocol: 'TLSv1.3' as const,
    certificateSha256: input.certificateSha256, publisherKeyId: input.publisher.keyId,
    publisherOrganizationId: input.publisherDescriptor.organizationId, publisherHostId: input.publisherDescriptor.hostId,
    publisherAdministratorId: input.publisherDescriptor.administratorId, publishedAt: input.publishedAt.toISOString(), topology: input.topology,
    externalHostEvidenceDigest: input.externalHostEvidenceDigest, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, publicationDigest: sha256(material) }, input.publisher);
}

export function createDurableMonitorRetrievalReceiptV33_36(input: {
  readonly monitor: SigningIdentity;
  readonly monitorDescriptor: QualificationActorDescriptorV33_36;
  readonly monitorId: string;
  readonly monitorSetVersion: number;
  readonly publication: SignedEnvelope<PinnedHttpsPublicationV33_36>;
  readonly content: Uint8Array;
  readonly observedCertificateSha256: string;
  readonly observedTlsProtocol: string;
  readonly httpStatus: number;
  readonly processId: number;
  readonly timeAttestations: readonly SignedEnvelope<ExternalTimeAttestationV33_36>[];
  readonly durableStoreId: string;
  readonly durableStorePath: string;
  readonly durableFileBytes: Uint8Array;
  readonly fsyncObserved: boolean;
  readonly observedAt: Date;
  readonly topology: QualificationTopologyV33_36;
  readonly externalHostEvidenceDigest: string | null;
}): SignedEnvelope<DurableMonitorRetrievalReceiptV33_36> {
  requireDate(input.observedAt, 'v33_36_retrieval_time_invalid');
  assertDescriptor(input.monitorDescriptor, 'v33_36_monitor_descriptor_invalid');
  if (input.monitor.keyId !== input.monitorDescriptor.keyId || input.monitorId.trim() === '') throw new Error('v33_36_monitor_binding_invalid');
  if (!Number.isInteger(input.monitorSetVersion) || input.monitorSetVersion < 1) throw new Error('v33_36_monitor_set_version_invalid');
  if (input.httpStatus !== 200 || input.processId <= 0 || !Number.isInteger(input.processId)) throw new Error('v33_36_retrieval_transport_invalid');
  if (input.observedTlsProtocol !== 'TLSv1.3' || input.observedCertificateSha256 !== input.publication.payload.certificateSha256) throw new Error('v33_36_tls_pin_mismatch');
  if (sha256Bytes(input.content) !== input.publication.payload.contentDigest) throw new Error('v33_36_content_digest_mismatch');
  if (input.timeAttestations.length < 2) throw new Error('v33_36_time_attestation_quorum_not_met');
  if (input.durableStoreId.trim() === '' || input.durableStorePath.trim() === '' || input.fsyncObserved !== true) throw new Error('v33_36_durable_retention_invalid');
  if (sha256Bytes(input.durableFileBytes) !== sha256Bytes(input.content)) throw new Error('v33_36_durable_file_mismatch');
  assertTopology(input.topology, input.externalHostEvidenceDigest, 'v33_36_retrieval_topology_evidence_invalid');
  const material = {
    version: '33.36' as const, retrievalId: randomUUID(), monitorId: input.monitorId, monitorKeyId: input.monitor.keyId,
    monitorOrganizationId: input.monitorDescriptor.organizationId, monitorHostId: input.monitorDescriptor.hostId,
    monitorAdministratorId: input.monitorDescriptor.administratorId, monitorSetVersion: input.monitorSetVersion,
    publicationDigest: input.publication.payload.publicationDigest, endpointUri: input.publication.payload.endpointUri,
    artifactDigest: input.publication.payload.artifactDigest, contentDigest: input.publication.payload.contentDigest,
    certificateSha256: input.observedCertificateSha256, tlsProtocol: 'TLSv1.3' as const, httpStatus: 200 as const, processId: input.processId,
    observedAt: input.observedAt.toISOString(), timeAttestationDigests: input.timeAttestations.map((row) => row.payload.attestationDigest).sort(),
    durableStoreId: input.durableStoreId, durableStorePathDigest: sha256({ path: input.durableStorePath }),
    durableFileDigest: sha256Bytes(input.durableFileBytes), fsyncObserved: true as const, networkFetchObserved: true as const,
    topology: input.topology, externalHostEvidenceDigest: input.externalHostEvidenceDigest, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, retrievalDigest: sha256(material) }, input.monitor);
}

export function createMonitorPartitionStatementV33_36(input: {
  readonly observer: SigningIdentity;
  readonly observerDescriptor: QualificationActorDescriptorV33_36;
  readonly monitors: readonly QualificationActorDescriptorV33_36[];
  readonly monitorSetVersion: number;
  readonly unavailableMonitorKeyId: string;
  readonly partitionStartedAt: Date;
  readonly observedAt: Date;
  readonly minimumPartitionMs: number;
}): SignedEnvelope<MonitorPartitionStatementV33_36> {
  requireDate(input.partitionStartedAt, 'v33_36_partition_time_invalid'); requireDate(input.observedAt, 'v33_36_partition_time_invalid');
  distinctTopology(input.monitors, 'v33_36_monitor_topology_invalid');
  const observer = input.monitors.find((row) => row.keyId === input.observer.keyId);
  if (observer === undefined || observer.keyId !== input.observerDescriptor.keyId || input.unavailableMonitorKeyId === input.observer.keyId || !input.monitors.some((row) => row.keyId === input.unavailableMonitorKeyId)) throw new Error('v33_36_partition_observer_binding_invalid');
  if (!Number.isSafeInteger(input.minimumPartitionMs) || input.minimumPartitionMs < 1_000 || input.observedAt.getTime() - input.partitionStartedAt.getTime() < input.minimumPartitionMs) throw new Error('v33_36_partition_duration_insufficient');
  const setDigest = monitorSetDigest(input.monitorSetVersion, input.monitors);
  const material = {
    version: '33.36' as const, statementId: randomUUID(), monitorSetDigest: setDigest, monitorSetVersion: input.monitorSetVersion,
    unavailableMonitorKeyId: input.unavailableMonitorKeyId, observerMonitorKeyId: input.observer.keyId,
    observerOrganizationId: observer.organizationId, observerHostId: observer.hostId, observerAdministratorId: observer.administratorId,
    partitionStartedAt: input.partitionStartedAt.toISOString(), observedAt: input.observedAt.toISOString(), minimumPartitionMs: input.minimumPartitionMs,
    decision: 'MONITOR_UNAVAILABLE' as const, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, statementDigest: sha256(material) }, input.observer);
}

export function createReplacementMonitorActivationV33_36(input: {
  readonly replacement: SigningIdentity;
  readonly replacementDescriptor: QualificationActorDescriptorV33_36;
  readonly predecessorMonitors: readonly QualificationActorDescriptorV33_36[];
  readonly predecessorMonitorSetVersion: number;
  readonly unavailableMonitorKeyId: string;
  readonly challengeDigest: string;
  readonly activatedAt: Date;
}): SignedEnvelope<ReplacementMonitorActivationV33_36> {
  requireDate(input.activatedAt, 'v33_36_activation_time_invalid'); assertDescriptor(input.replacementDescriptor, 'v33_36_replacement_descriptor_invalid');
  if (input.replacement.keyId !== input.replacementDescriptor.keyId || input.predecessorMonitors.some((row) => row.keyId === input.replacement.keyId)) throw new Error('v33_36_replacement_binding_invalid');
  requireDigest(input.challengeDigest, 'v33_36_replacement_challenge_invalid');
  const all = [...input.predecessorMonitors.filter((row) => row.keyId !== input.unavailableMonitorKeyId), input.replacementDescriptor]; distinctTopology(all, 'v33_36_replacement_topology_invalid');
  const registry = new KeyRegistry(); registry.register(input.replacement.keyId, input.replacement.publicKey);
  const material = {
    version: '33.36' as const, activationId: randomUUID(), predecessorMonitorSetDigest: monitorSetDigest(input.predecessorMonitorSetVersion, input.predecessorMonitors),
    predecessorMonitorSetVersion: input.predecessorMonitorSetVersion, nextMonitorSetVersion: input.predecessorMonitorSetVersion + 1,
    unavailableMonitorKeyId: input.unavailableMonitorKeyId, replacementMonitorId: `replacement-${input.replacement.keyId}`,
    replacementMonitorKeyId: input.replacement.keyId, replacementMonitorKeyFingerprint: registry.fingerprint(input.replacement.keyId)!,
    replacementOrganizationId: input.replacementDescriptor.organizationId, replacementHostId: input.replacementDescriptor.hostId,
    replacementAdministratorId: input.replacementDescriptor.administratorId, challengeDigest: input.challengeDigest,
    activatedAt: input.activatedAt.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, activationDigest: sha256(material) }, input.replacement);
}

export function finalizeMonitorReplacementV33_36(input: {
  readonly qualificationAuthority: SigningIdentity;
  readonly predecessorMonitors: readonly QualificationActorDescriptorV33_36[];
  readonly predecessorMonitorSetVersion: number;
  readonly partitionStatements: readonly SignedEnvelope<MonitorPartitionStatementV33_36>[];
  readonly activation: SignedEnvelope<ReplacementMonitorActivationV33_36>;
  readonly monitorRegistry: KeyRegistry;
  readonly replacementRegistry: KeyRegistry;
  readonly issuedAt: Date;
}): SignedEnvelope<MonitorReplacementCertificateV33_36> {
  requireDate(input.issuedAt, 'v33_36_replacement_certificate_time_invalid');
  distinctTopology(input.predecessorMonitors, 'v33_36_monitor_topology_invalid');
  if (input.partitionStatements.length < 2) throw new Error('v33_36_partition_quorum_not_met');
  const setDigest = monitorSetDigest(input.predecessorMonitorSetVersion, input.predecessorMonitors);
  const observerIds = new Set<string>();
  let unavailable = '';
  for (const row of input.partitionStatements) {
    if (!input.monitorRegistry.verifyAt(row, input.issuedAt) || row.payload.statementDigest !== digestWithout(row.payload as unknown as Record<string, unknown>, 'statementDigest')) throw new Error('v33_36_partition_statement_invalid');
    assertBoundary(row.payload, 'v33_36_partition_boundary_invalid');
    if (row.payload.monitorSetDigest !== setDigest || row.payload.monitorSetVersion !== input.predecessorMonitorSetVersion) throw new Error('v33_36_partition_set_binding_invalid');
    unavailable ||= row.payload.unavailableMonitorKeyId;
    if (row.payload.unavailableMonitorKeyId !== unavailable) throw new Error('v33_36_partition_target_conflict');
    observerIds.add(row.payload.observerMonitorKeyId);
  }
  if (observerIds.size < 2 || observerIds.has(unavailable)) throw new Error('v33_36_partition_quorum_not_met');
  const activation = input.activation.payload;
  if (!input.replacementRegistry.verifyAt(input.activation, input.issuedAt)) throw new Error('v33_36_activation_signature_invalid');
  if (activation.activationDigest !== digestWithout(activation, 'activationDigest')) throw new Error('v33_36_activation_digest_invalid');
  if (activation.predecessorMonitorSetDigest !== setDigest || activation.predecessorMonitorSetVersion !== input.predecessorMonitorSetVersion || activation.nextMonitorSetVersion !== input.predecessorMonitorSetVersion + 1 || activation.unavailableMonitorKeyId !== unavailable) throw new Error('v33_36_activation_binding_invalid');
  const replacement = {
    keyId: activation.replacementMonitorKeyId, keyFingerprint: activation.replacementMonitorKeyFingerprint,
    organizationId: activation.replacementOrganizationId, hostId: activation.replacementHostId, administratorId: activation.replacementAdministratorId,
  };
  const nextMonitors = [...input.predecessorMonitors.filter((row) => row.keyId !== unavailable), replacement];
  if (nextMonitors.length !== input.predecessorMonitors.length) throw new Error('v33_36_replacement_cardinality_invalid');
  distinctTopology(nextMonitors, 'v33_36_replacement_topology_invalid');
  const material = {
    version: '33.36' as const, certificateId: randomUUID(), predecessorMonitorSetDigest: setDigest,
    predecessorMonitorSetVersion: input.predecessorMonitorSetVersion, nextMonitorSetVersion: input.predecessorMonitorSetVersion + 1,
    unavailableMonitorKeyId: unavailable, replacementMonitorKeyId: activation.replacementMonitorKeyId,
    partitionStatementDigests: input.partitionStatements.map((row) => row.payload.statementDigest).sort(),
    partitionObserverKeyIds: [...observerIds].sort(), activationDigest: activation.activationDigest,
    nextMonitors: [...nextMonitors].sort((a, b) => a.keyId.localeCompare(b.keyId)), issuedAt: input.issuedAt.toISOString(),
    qualificationAuthorityKeyId: input.qualificationAuthority.keyId, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, replacementDigest: sha256(material) }, input.qualificationAuthority);
}

export function createMonitorGossipStatementV33_36(input: {
  readonly monitor: SigningIdentity;
  readonly monitorDescriptor: QualificationActorDescriptorV33_36;
  readonly monitors: readonly QualificationActorDescriptorV33_36[];
  readonly monitorSetVersion: number;
  readonly retrieval: SignedEnvelope<DurableMonitorRetrievalReceiptV33_36>;
  readonly peerRetrievals: readonly SignedEnvelope<DurableMonitorRetrievalReceiptV33_36>[];
  readonly observedAt: Date;
}): SignedEnvelope<MonitorGossipStatementV33_36> {
  requireDate(input.observedAt, 'v33_36_gossip_time_invalid'); distinctTopology(input.monitors, 'v33_36_monitor_topology_invalid');
  if (input.monitor.keyId !== input.monitorDescriptor.keyId || input.retrieval.payload.monitorKeyId !== input.monitor.keyId) throw new Error('v33_36_gossip_monitor_binding_invalid');
  const peerDigests = input.peerRetrievals.map((row) => row.payload.retrievalDigest).filter((value) => value !== input.retrieval.payload.retrievalDigest);
  if (new Set(peerDigests).size !== input.monitors.length - 1) throw new Error('v33_36_gossip_peer_coverage_invalid');
  const material = {
    version: '33.36' as const, gossipId: randomUUID(), monitorSetDigest: monitorSetDigest(input.monitorSetVersion, input.monitors), monitorSetVersion: input.monitorSetVersion,
    publicationDigest: input.retrieval.payload.publicationDigest, artifactDigest: input.retrieval.payload.artifactDigest,
    contentDigest: input.retrieval.payload.contentDigest, retrievalDigest: input.retrieval.payload.retrievalDigest,
    peerRetrievalDigests: [...peerDigests].sort(), monitorKeyId: input.monitor.keyId,
    monitorOrganizationId: input.monitorDescriptor.organizationId, monitorHostId: input.monitorDescriptor.hostId,
    monitorAdministratorId: input.monitorDescriptor.administratorId, observedAt: input.observedAt.toISOString(), decision: 'CONSISTENT' as const,
    productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, gossipDigest: sha256(material) }, input.monitor);
}

export function verifyHttpsMonitorQualificationV33_36(input: {
  readonly publication: SignedEnvelope<PinnedHttpsPublicationV33_36>;
  readonly timeAttestations: readonly SignedEnvelope<ExternalTimeAttestationV33_36>[];
  readonly externalHostEvidenceAttestations?: readonly SignedEnvelope<ExternalHostEvidenceAttestationV33_36>[];
  readonly retrievals: readonly SignedEnvelope<DurableMonitorRetrievalReceiptV33_36>[];
  readonly gossip: readonly SignedEnvelope<MonitorGossipStatementV33_36>[];
  readonly trust: HttpsMonitorQualificationTrustV33_36;
  readonly replacementCertificate?: SignedEnvelope<MonitorReplacementCertificateV33_36>;
  readonly verifiedAt: Date;
}): HttpsMonitorQualificationVerdictV33_36 {
  requireDate(input.verifiedAt, 'v33_36_verification_time_invalid');
  const publication = input.publication.payload;
  if (!input.trust.trustedPublisherIds.includes(input.publication.issuerKeyId) || !input.trust.publisherRegistry.verifyAt(input.publication, input.verifiedAt)) throw new Error('v33_36_publication_signature_invalid');
  if (publication.publicationDigest !== digestWithout(publication, 'publicationDigest')) throw new Error('v33_36_publication_digest_invalid');
  assertBoundary(publication, 'v33_36_publication_boundary_invalid');
  requireHttps(publication.endpointUri, 'v33_36_publication_endpoint_invalid'); requireDigest(publication.certificateSha256, 'v33_36_certificate_pin_invalid');
  if (publication.tlsProtocol !== 'TLSv1.3') throw new Error('v33_36_tls_protocol_invalid');
  const evidenceBySubject = new Map<string, ExternalHostEvidenceAttestationV33_36[]>();
  const auditorIds = new Set<string>(); const auditorOrgs = new Set<string>(); const auditorHosts = new Set<string>(); const auditorAdmins = new Set<string>();
  for (const envelope of input.externalHostEvidenceAttestations ?? []) {
    const row = envelope.payload;
    if (!input.trust.trustedTopologyAuditorIds.includes(envelope.issuerKeyId) || !input.trust.topologyAuditorRegistry.verifyAt(envelope, input.verifiedAt)) throw new Error('v33_36_host_evidence_signature_invalid');
    if (row.evidenceDigest !== digestWithout(row, 'evidenceDigest')) throw new Error('v33_36_host_evidence_digest_invalid');
    assertBoundary(row, 'v33_36_host_evidence_boundary_invalid');
    auditorIds.add(row.auditorKeyId); auditorOrgs.add(row.auditorOrganizationId); auditorHosts.add(row.auditorHostId); auditorAdmins.add(row.auditorAdministratorId);
    const rows = evidenceBySubject.get(row.subjectKeyId) ?? []; rows.push(row); evidenceBySubject.set(row.subjectKeyId, rows);
  }
  const evidenceVerified = (subject: QualificationActorDescriptorV33_36, digest: string | null): boolean => {
    if (digest === null) return false;
    const rows = evidenceBySubject.get(subject.keyId) ?? [];
    return rows.some((row) => row.evidenceDigest === digest && row.subjectOrganizationId === subject.organizationId && row.subjectHostId === subject.hostId && row.subjectAdministratorId === subject.administratorId);
  };
  const auditorQuorumVerified = [auditorIds, auditorOrgs, auditorHosts, auditorAdmins].every((set) => set.size >= 2);
  const timeIds = new Set<string>(); const timeOrgs = new Set<string>(); const timeHosts = new Set<string>(); const timeAdmins = new Set<string>();
  const times: number[] = []; const publisherDescriptor: QualificationActorDescriptorV33_36 = { keyId: publication.publisherKeyId, keyFingerprint: input.trust.publisherRegistry.fingerprint(publication.publisherKeyId) ?? '', organizationId: publication.publisherOrganizationId, hostId: publication.publisherHostId, administratorId: publication.publisherAdministratorId };
  let allExternal = auditorQuorumVerified && publication.topology === 'INDEPENDENT_EXTERNAL_ATTESTED' && evidenceVerified(publisherDescriptor, publication.externalHostEvidenceDigest);
  for (const envelope of input.timeAttestations) {
    const row = envelope.payload;
    if (!input.trust.trustedTimeSourceIds.includes(envelope.issuerKeyId) || !input.trust.timeRegistry.verifyAt(envelope, input.verifiedAt)) throw new Error('v33_36_time_signature_invalid');
    if (row.attestationDigest !== digestWithout(row, 'attestationDigest')) throw new Error('v33_36_time_digest_invalid');
    assertBoundary(row, 'v33_36_time_boundary_invalid'); assertTopology(row.topology, row.externalHostEvidenceDigest, 'v33_36_time_topology_evidence_invalid');
    timeIds.add(row.sourceKeyId); timeOrgs.add(row.sourceOrganizationId); timeHosts.add(row.sourceHostId); timeAdmins.add(row.sourceAdministratorId); times.push(row.unixTimeMs);
    const timeDescriptor: QualificationActorDescriptorV33_36 = { keyId: row.sourceKeyId, keyFingerprint: input.trust.timeRegistry.fingerprint(row.sourceKeyId) ?? '', organizationId: row.sourceOrganizationId, hostId: row.sourceHostId, administratorId: row.sourceAdministratorId };
    allExternal = allExternal && row.topology === 'INDEPENDENT_EXTERNAL_ATTESTED' && evidenceVerified(timeDescriptor, row.externalHostEvidenceDigest);
  }
  if ([timeIds, timeOrgs, timeHosts, timeAdmins].some((set) => set.size < input.trust.timeQuorum)) throw new Error('v33_36_time_quorum_not_met');
  if (Math.max(...times) - Math.min(...times) > input.trust.maximumClockSkewMs) throw new Error('v33_36_clock_skew_exceeded');
  distinctTopology(input.trust.monitors, 'v33_36_monitor_topology_invalid');
  const expectedSetDigest = monitorSetDigest(input.retrievals[0]?.payload.monitorSetVersion ?? 0, input.trust.monitors);
  const monitorIds = new Set<string>(); const processIds = new Set<number>(); const retrievalDigests = new Set<string>();
  for (const envelope of input.retrievals) {
    const row = envelope.payload;
    if (!input.trust.trustedMonitorIds.includes(envelope.issuerKeyId) || !input.trust.monitorRegistry.verifyAt(envelope, input.verifiedAt)) throw new Error('v33_36_retrieval_signature_invalid');
    if (row.retrievalDigest !== digestWithout(row, 'retrievalDigest')) throw new Error('v33_36_retrieval_digest_invalid');
    assertBoundary(row, 'v33_36_retrieval_boundary_invalid'); assertTopology(row.topology, row.externalHostEvidenceDigest, 'v33_36_retrieval_topology_evidence_invalid');
    if (row.publicationDigest !== publication.publicationDigest || row.endpointUri !== publication.endpointUri || row.artifactDigest !== publication.artifactDigest || row.contentDigest !== publication.contentDigest || row.certificateSha256 !== publication.certificateSha256 || row.tlsProtocol !== 'TLSv1.3' || row.httpStatus !== 200 || row.fsyncObserved !== true || row.networkFetchObserved !== true || row.durableFileDigest !== publication.contentDigest) throw new Error('v33_36_retrieval_binding_invalid');
    const descriptor = input.trust.monitors.find((candidate) => candidate.keyId === row.monitorKeyId);
    if (descriptor === undefined || descriptor.organizationId !== row.monitorOrganizationId || descriptor.hostId !== row.monitorHostId || descriptor.administratorId !== row.monitorAdministratorId) throw new Error('v33_36_retrieval_topology_invalid');
    if (row.timeAttestationDigests.length < input.trust.timeQuorum || !row.timeAttestationDigests.every((digest) => input.timeAttestations.some((att) => att.payload.attestationDigest === digest))) throw new Error('v33_36_retrieval_time_binding_invalid');
    monitorIds.add(row.monitorKeyId); processIds.add(row.processId); retrievalDigests.add(row.retrievalDigest);
    allExternal = allExternal && row.topology === 'INDEPENDENT_EXTERNAL_ATTESTED' && evidenceVerified(descriptor, row.externalHostEvidenceDigest);
  }
  if (monitorIds.size < input.trust.monitorQuorum || retrievalDigests.size < input.trust.monitorQuorum) throw new Error('v33_36_retrieval_quorum_not_met');
  if (input.gossip.length < input.trust.monitorQuorum) throw new Error('v33_36_gossip_quorum_not_met');
  const gossipMonitors = new Set<string>();
  for (const envelope of input.gossip) {
    const row = envelope.payload;
    if (!input.trust.monitorRegistry.verifyAt(envelope, input.verifiedAt) || row.gossipDigest !== digestWithout(row, 'gossipDigest')) throw new Error('v33_36_gossip_signature_invalid');
    assertBoundary(row, 'v33_36_gossip_boundary_invalid');
    if (row.monitorSetDigest !== expectedSetDigest || row.publicationDigest !== publication.publicationDigest || row.artifactDigest !== publication.artifactDigest || row.contentDigest !== publication.contentDigest || !retrievalDigests.has(row.retrievalDigest)) throw new Error('v33_36_gossip_binding_invalid');
    if (new Set(row.peerRetrievalDigests).size < input.trust.monitorQuorum - 1 || !row.peerRetrievalDigests.every((digest) => retrievalDigests.has(digest))) throw new Error('v33_36_gossip_peer_coverage_invalid');
    gossipMonitors.add(row.monitorKeyId);
  }
  if (gossipMonitors.size < input.trust.monitorQuorum) throw new Error('v33_36_gossip_quorum_not_met');
  if (detectMonitorSplitViewV33_36(input.retrievals).length > 0) throw new Error('v33_36_split_view_detected');
  let replacementVerified = false;
  if (input.replacementCertificate !== undefined) {
    const cert = input.replacementCertificate.payload;
    if (!input.trust.trustedQualificationAuthorityIds.includes(input.replacementCertificate.issuerKeyId) || !input.trust.qualificationAuthorityRegistry.verifyAt(input.replacementCertificate, input.verifiedAt)) throw new Error('v33_36_replacement_certificate_signature_invalid');
    if (cert.replacementDigest !== digestWithout(cert, 'replacementDigest')) throw new Error('v33_36_replacement_certificate_digest_invalid');
    assertBoundary(cert, 'v33_36_replacement_certificate_boundary_invalid'); distinctTopology(cert.nextMonitors, 'v33_36_replacement_topology_invalid');
    if (cert.nextMonitorSetVersion !== input.retrievals[0]!.payload.monitorSetVersion || monitorSetDigest(cert.nextMonitorSetVersion, cert.nextMonitors) !== expectedSetDigest) throw new Error('v33_36_replacement_certificate_set_binding_invalid');
    replacementVerified = true;
  }
  const material = {
    version: '33.36' as const, publicationDigest: publication.publicationDigest, monitorSetDigest: expectedSetDigest,
    monitorSetVersion: input.retrievals[0]!.payload.monitorSetVersion, retrievalQuorumVerified: true as const, timeQuorumVerified: true as const,
    durableRetentionVerified: true as const, pinnedTlsVerified: true as const, gossipConsistencyVerified: true as const, splitViewRejected: true as const,
    monitorReplacementVerified: replacementVerified, distinctMonitorProcessesObserved: processIds.size >= input.trust.monitorQuorum,
    networkFetchObserved: true as const, externalTopologyObserved: allExternal, externalHumanParticipants: 0 as const,
    status: allExternal ? 'EXTERNAL_MONITOR_QUALIFIED' as const : 'LOCAL_HTTPS_MONITOR_REHEARSAL_ONLY' as const,
    generatedAt: input.verifiedAt.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return { ...material, verdictDigest: sha256(material) };
}

export function detectMonitorSplitViewV33_36(receipts: readonly SignedEnvelope<DurableMonitorRetrievalReceiptV33_36>[]): readonly { readonly endpointUri: string; readonly publicationDigests: readonly string[]; readonly contentDigests: readonly string[]; readonly certificatePins: readonly string[]; readonly monitorKeyIds: readonly string[] }[] {
  const byEndpoint = new Map<string, DurableMonitorRetrievalReceiptV33_36[]>();
  for (const envelope of receipts) {
    const rows = byEndpoint.get(envelope.payload.endpointUri) ?? []; rows.push(envelope.payload); byEndpoint.set(envelope.payload.endpointUri, rows);
  }
  const findings = [];
  for (const [endpointUri, rows] of byEndpoint) {
    const publicationDigests = [...new Set(rows.map((row) => row.publicationDigest))];
    const contentDigests = [...new Set(rows.map((row) => row.contentDigest))];
    const certificatePins = [...new Set(rows.map((row) => row.certificateSha256))];
    if (publicationDigests.length > 1 || contentDigests.length > 1 || certificatePins.length > 1) findings.push({ endpointUri, publicationDigests, contentDigests, certificatePins, monitorKeyIds: [...new Set(rows.map((row) => row.monitorKeyId))] });
  }
  return findings;
}

function digestWithout<T extends object>(row: T, field: keyof T): string {
  const copy = { ...row } as Record<PropertyKey, unknown>; delete copy[field as PropertyKey]; return sha256(copy);
}
