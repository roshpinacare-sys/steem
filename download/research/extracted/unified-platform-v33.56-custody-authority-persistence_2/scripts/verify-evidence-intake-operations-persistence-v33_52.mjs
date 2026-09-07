import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  KeyRegistry, generateSigningIdentity, sha256, sha256Bytes,
} from '../dist/src/contracts/crypto.js';
import {
  replayOperationsJournalV33_52,
  verifyAuditReplayVerdictV33_52,
} from '../dist/src/supply-chain/evidence-intake-operations-persistence-v33_52.js';

const root = resolve('.');
const proofPath = join(root, 'release-evidence/v33.52/V33_52_EVIDENCE_INTAKE_OPERATIONS_PERSISTENCE_PROOF.json');
const verificationPath = join(root, 'release-evidence/v33.52/V33_52_INDEPENDENT_VERIFICATION.json');
const baseVerify = spawnSync(process.execPath, ['scripts/verify-evidence-intake-operations-plane-v33_51.mjs'], { cwd: root, encoding: 'utf8' });
if (baseVerify.status !== 0) throw new Error(`v33_51_verifier_failed:${baseVerify.stderr || baseVerify.stdout}`);
const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
const basePath = join(root, proof.base.proofPath);
const baseBytes = readFileSync(basePath);
if (sha256({ bytes: baseBytes.toString('base64') }) !== proof.base.proofSha256) throw new Error('base_proof_digest');
const base = JSON.parse(baseBytes.toString('utf8'));
if (base.certificate.payload.certificateDigest !== proof.base.verdictDigest || base.summary.totalChainSignatureCount !== proof.base.baseTotalChainSignatureCount) throw new Error('base_proof_binding');

const keyRecords = new Map(proof.publicKeys.map((record) => [record.keyId, record]));
const makeRegistry = (ids) => {
  const registry = new KeyRegistry();
  for (const id of ids) {
    const record = keyRecords.get(id);
    if (!record) throw new Error(`public_key_missing:${id}`);
    registry.registerExported(record);
  }
  return registry;
};
const trust = {
  policyRegistry: makeRegistry(proof.trustedIds.policy), trustedPolicySignerIds: proof.trustedIds.policy,
  leaseRegistry: makeRegistry(proof.trustedIds.lease), trustedLeaseSignerIds: proof.trustedIds.lease,
  witnessRegistry: makeRegistry(proof.trustedIds.witnesses), trustedWitnessSignerIds: proof.trustedIds.witnesses,
  journalRegistry: makeRegistry(proof.trustedIds.journal), trustedJournalSignerIds: proof.trustedIds.journal,
  replayRegistry: makeRegistry(proof.trustedIds.replay), trustedReplaySignerIds: proof.trustedIds.replay,
  pressureRegistry: makeRegistry(proof.trustedIds.pressure), trustedPressureSignerIds: proof.trustedIds.pressure,
  replicaRegistry: makeRegistry(proof.trustedIds.replicas), trustedReplicaSignerIds: proof.trustedIds.replicas,
  recoveryRegistry: makeRegistry(proof.trustedIds.recovery), trustedRecoverySignerIds: proof.trustedIds.recovery,
  auditRegistry: makeRegistry(proof.trustedIds.audit), trustedAuditSignerIds: proof.trustedIds.audit,
  baseReadinessRegistry: makeRegistry(proof.trustedIds.baseReadiness), trustedBaseReadinessSignerIds: proof.trustedIds.baseReadiness,
};
const decidedAt = new Date(proof.audit.payload.decidedAt);
const digestWithout = (payload, key) => { const copy = { ...payload }; delete copy[key]; return sha256(copy); };
if (!trust.policyRegistry.verifyAt(proof.policy, decidedAt) || digestWithout(proof.policy.payload, 'policyDigest') !== proof.policy.payload.policyDigest) throw new Error('policy_verification');
if (proof.policy.payload.baseReadinessCertificateDigest !== base.certificate.payload.certificateDigest || proof.policy.payload.baseOperationsPolicyDigest !== base.policy.payload.policyDigest) throw new Error('policy_base_binding');
const recomputed = replayOperationsJournalV33_52({
  signer: generateSigningIdentity('verification-v3352-audit'),
  policy: proof.policy,
  baseReadinessCertificate: base.certificate,
  entries: proof.entries,
  leases: proof.leases,
  expiryWitnesses: proof.expiryWitnesses,
  replayReceipts: proof.replayReceipts,
  pressureSnapshots: proof.pressureSnapshots,
  replicaReceipts: proof.replicaReceipts,
  recoveryReceipts: proof.recoveryReceipts,
  trust,
  decidedAt,
});
const verdict = verifyAuditReplayVerdictV33_52({ verdict: proof.audit, recomputed, trust, verifiedAt: decidedAt });

const artifactRoot = resolve(root, proof.executionEvidence.root);
if (!artifactRoot.startsWith(root)) throw new Error('artifact_root_escape');
for (const record of proof.executionEvidence.signedArtifactWrites) {
  const path = resolve(artifactRoot, record.path);
  if (!path.startsWith(artifactRoot)) throw new Error('artifact_path_escape');
  const bytes = readFileSync(path);
  if (bytes.length !== record.byteLength || sha256({ bytes: bytes.toString('base64') }) !== record.sha256 || !record.fsync || !record.directoryFsync || !record.readBackVerified) throw new Error(`durable_artifact_mismatch:${record.path}`);
}
if (proof.executionEvidence.signedArtifactWrites.length !== 24 || proof.executionEvidence.signedArtifactWriteCount !== 24) throw new Error('signed_artifact_count');
if (proof.executionEvidence.replicaProcesses.length !== 3 || proof.executionEvidence.replicaProcessCount !== 3) throw new Error('replica_process_count');
const processIds = new Set();
for (let index = 0; index < proof.executionEvidence.replicaProcesses.length; index += 1) {
  const process = proof.executionEvidence.replicaProcesses[index];
  const marker = 'release-evidence/v33.52/operations-persistence/';
  const normalizedDestination = String(process.destination).replaceAll('\\', '/');
  const markerIndex = normalizedDestination.indexOf(marker);
  const destination = markerIndex >= 0
    ? resolve(root, normalizedDestination.slice(markerIndex))
    : resolve(root, process.destination);
  if (!destination.startsWith(artifactRoot) || relative(artifactRoot, destination).startsWith('..')) throw new Error('replica_destination_escape');
  const bytes = readFileSync(destination);
  const receipt = proof.replicaReceipts[index];
  if (bytes.length !== process.byteLength || sha256Bytes(bytes) !== process.sha256 || process.sha256 !== receipt.payload.exactBytesDigest || process.pid <= 0 || !process.fileFsync || !process.directoryFsync || !process.readBackVerified) throw new Error(`replica_process_mismatch:${index + 1}`);
  processIds.add(process.pid);
}
if (processIds.size !== 3) throw new Error('replica_process_pid_separation');

const expectedSummary = {
  newSignatureCount: 24,
  totalChainSignatureCount: base.summary.totalChainSignatureCount + 24,
  workerLeaseCount: 2,
  expiryWitnessCount: 3,
  journalEntryCount: 8,
  replayReceiptCount: 1,
  pressureSnapshotCount: 4,
  replicaReceiptCount: 3,
  recoveryReceiptCount: 1,
  replicaProcessCount: 3,
  signedArtifactWriteCount: 24,
};
for (const [key, value] of Object.entries(expectedSummary)) if (proof.summary[key] !== value) throw new Error(`summary_${key}`);
if (Object.values(proof.attacks).some((value) => value !== true)) throw new Error('attack_matrix');
const truth = proof.truthBoundary;
if (truth.status !== 'LOCAL_OPERATIONS_PERSISTENCE_REHEARSAL_ONLY' || truth.externalTopologyObserved !== false || truth.externalInfrastructureAttestations !== 0 || truth.externalHumanParticipants !== 0 || truth.productionAuthority !== 'NONE' || truth.externalEffectsExecuted !== 0 || truth.g3 !== 'BLOCKED' || truth.productionPromotion !== 'BLOCKED') throw new Error('truth_boundary');
if (verdict.status !== truth.status || verdict.productionAuthority !== 'NONE' || verdict.externalEffectsExecuted !== 0) throw new Error('verdict_truth_boundary');

const result = {
  version: '33.52', verifiedAt: new Date().toISOString(), status: 'PASS',
  baseVerifierPassed: true, baseProofDigestVerified: true, policyVerified: true,
  auditReplayRecomputed: true, journalChainVerified: verdict.journalChainVerified,
  workerFencingVerified: verdict.workerFencingVerified, idempotencyVerified: verdict.idempotencyVerified,
  backlogControlsVerified: verdict.backlogControlsVerified, replicaDurabilityVerified: verdict.replicaDurabilityVerified,
  crashRecoveryVerified: verdict.crashRecoveryVerified, replicaProcessCount: processIds.size,
  newSignatureCount: proof.summary.newSignatureCount, totalChainSignatureCount: proof.summary.totalChainSignatureCount,
  truthBoundary: truth,
};
writeFileSync(verificationPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
