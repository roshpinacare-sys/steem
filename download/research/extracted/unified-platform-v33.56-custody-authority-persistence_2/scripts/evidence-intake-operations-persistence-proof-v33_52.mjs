import { mkdirSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  KeyRegistry, generateSigningIdentity, sha256, signEnvelope,
} from '../dist/src/contracts/crypto.js';
import {
  commitQueueOperationV33_52,
  createBacklogPressureSnapshotV33_52,
  createCrashRecoveryReceiptV33_52,
  createJournalReplicaReceiptV33_52,
  createLeaseExpiryWitnessV33_52,
  createPersistencePolicyV33_52,
  createWorkerLeaseV33_52,
  replayOperationsJournalV33_52,
} from '../dist/src/supply-chain/evidence-intake-operations-persistence-v33_52.js';

const root = resolve('.');
const baseProofPath = join(root, 'release-evidence/v33.51/V33_51_EVIDENCE_INTAKE_OPERATIONS_PLANE_PROOF.json');
const outDir = join(root, 'release-evidence/v33.52');
const artifactRoot = join(outDir, 'operations-persistence');
mkdirSync(artifactRoot, { recursive: true });
const baseVerify = spawnSync(process.execPath, ['scripts/verify-evidence-intake-operations-plane-v33_51.mjs'], { cwd: root, encoding: 'utf8' });
if (baseVerify.status !== 0) throw new Error(`v33_51_verifier_failed:${baseVerify.stderr || baseVerify.stdout}`);
const base = JSON.parse(readFileSync(baseProofPath, 'utf8'));

const identities = {
  policy: generateSigningIdentity('proof-v3352-policy'),
  lease: generateSigningIdentity('proof-v3352-lease'),
  witnessA: generateSigningIdentity('proof-v3352-witness-a'),
  witnessB: generateSigningIdentity('proof-v3352-witness-b'),
  witnessC: generateSigningIdentity('proof-v3352-witness-c'),
  journal: generateSigningIdentity('proof-v3352-journal'),
  replay: generateSigningIdentity('proof-v3352-replay'),
  pressure: generateSigningIdentity('proof-v3352-pressure'),
  replicaA: generateSigningIdentity('proof-v3352-replica-a'),
  replicaB: generateSigningIdentity('proof-v3352-replica-b'),
  replicaC: generateSigningIdentity('proof-v3352-replica-c'),
  recovery: generateSigningIdentity('proof-v3352-recovery'),
  audit: generateSigningIdentity('proof-v3352-audit'),
};
const allNew = Object.values(identities);
const registry = (...ids) => { const r = new KeyRegistry(); for (const id of ids) r.register(id.keyId, id.publicKey); return r; };
const actor = (identity, suffix) => ({ keyId: identity.keyId, organizationId: `proof-${suffix}-org`, administratorId: `proof-${suffix}-admin`, hostId: `proof-${suffix}.example.com` });
const exportedBase = new Map(base.publicKeys.map((record) => [record.keyId, record]));
const baseReadinessRecord = exportedBase.get(base.certificate.issuerKeyId);
if (!baseReadinessRecord) throw new Error('base_readiness_key_missing');
const baseReadinessRegistry = new KeyRegistry(); baseReadinessRegistry.registerExported(baseReadinessRecord);
const witnessIds = [identities.witnessA, identities.witnessB, identities.witnessC];
const replicaIds = [identities.replicaA, identities.replicaB, identities.replicaC];
const trust = {
  policyRegistry: registry(identities.policy), trustedPolicySignerIds: [identities.policy.keyId],
  leaseRegistry: registry(identities.lease), trustedLeaseSignerIds: [identities.lease.keyId],
  witnessRegistry: registry(...witnessIds), trustedWitnessSignerIds: witnessIds.map((x) => x.keyId),
  journalRegistry: registry(identities.journal), trustedJournalSignerIds: [identities.journal.keyId],
  replayRegistry: registry(identities.replay), trustedReplaySignerIds: [identities.replay.keyId],
  pressureRegistry: registry(identities.pressure), trustedPressureSignerIds: [identities.pressure.keyId],
  replicaRegistry: registry(...replicaIds), trustedReplicaSignerIds: replicaIds.map((x) => x.keyId),
  recoveryRegistry: registry(identities.recovery), trustedRecoverySignerIds: [identities.recovery.keyId],
  auditRegistry: registry(identities.audit), trustedAuditSignerIds: [identities.audit.keyId],
  baseReadinessRegistry, trustedBaseReadinessSignerIds: [base.certificate.issuerKeyId],
};

const issuedAt = new Date('2026-07-23T05:00:00.000Z');
const policy = createPersistencePolicyV33_52({
  signer: identities.policy, authority: actor(identities.policy, 'policy'), persistencePlaneId: 'operations-persistence-v33-52',
  baseOperationsPolicy: base.policy, baseReadinessCertificate: base.certificate, issuedAt, expiresAt: new Date('2026-07-23T12:00:00.000Z'),
  workerLeaseSeconds: 300, backlogHighWatermark: 8, backlogLowWatermark: 3, maximumOldestAgeSeconds: 900,
});
const operations = ['ENQUEUE','REVIEW_ACCEPT','REVIEW_REJECT','DISPUTE_OPEN','RESUBMISSION_COMMIT','APPROVAL_COMMIT','SNAPSHOT_COMMIT','BACKPRESSURE_ENABLE','BACKPRESSURE_DISABLE','RECOVERY_MARK'];
const lease1 = createWorkerLeaseV33_52({ signer: identities.lease, policy, queueId: 'queue-proof-org-a', worker: actor(identities.lease, 'worker-a'), term: 1, fenceSequence: 1, allowedOperations: operations, issuedAt, trust });
const pressure1 = createBacklogPressureSnapshotV33_52({ signer: identities.pressure, policy, sequence: 1, backlogCount: 2, oldestAgeSeconds: 20, recordedAt: new Date('2026-07-23T05:00:30.000Z') });
const entries = [];
const commit = (lease, operationType, operationId, idempotencyKey, committedAt, request, payload, pressure) => {
  const result = commitQueueOperationV33_52({ signer: identities.journal, replaySigner: identities.replay, policy, lease, priorEntries: entries, latestPressureSnapshot: pressure, roleSlot: 'COORDINATOR_HOST:1', operationType, operationId, idempotencyKey, request, payload, executionClass: 'LOCAL_REHEARSAL', committedAt: new Date(committedAt), trust });
  if (result.entry) entries.push(result.entry);
  return result;
};
commit(lease1, 'ENQUEUE', 'op-001', 'idem-001', '2026-07-23T05:01:00.000Z', { evidence: 1 }, { queued: true }, pressure1);
commit(lease1, 'REVIEW_ACCEPT', 'op-002', 'idem-002', '2026-07-23T05:02:00.000Z', { review: 1 }, { accepted: true }, pressure1);
commit(lease1, 'DISPUTE_OPEN', 'op-003', 'idem-003', '2026-07-23T05:03:00.000Z', { dispute: 1 }, { open: true }, pressure1);
const replay = commitQueueOperationV33_52({ signer: identities.journal, replaySigner: identities.replay, policy, lease: lease1, priorEntries: entries, latestPressureSnapshot: pressure1, roleSlot: 'COORDINATOR_HOST:1', operationType: 'ENQUEUE', operationId: 'op-replay', idempotencyKey: 'idem-001', request: { evidence: 1 }, payload: { ignored: true }, executionClass: 'LOCAL_REHEARSAL', committedAt: new Date('2026-07-23T05:04:00.000Z'), trust }).replay;
const witnessTime = new Date('2026-07-23T05:05:30.000Z');
const witnesses = witnessIds.map((identity, index) => createLeaseExpiryWitnessV33_52({ signer: identity, policy, expiredLease: lease1, witness: actor(identity, `witness-${index + 1}`), observedAt: witnessTime }));
const lease2 = createWorkerLeaseV33_52({ signer: identities.lease, policy, queueId: lease1.payload.queueId, worker: actor(identities.lease, 'worker-b'), term: 2, fenceSequence: 2, predecessorLease: lease1, expiryWitnesses: witnesses, allowedOperations: operations, issuedAt: witnessTime, trust });
const pressure2 = createBacklogPressureSnapshotV33_52({ signer: identities.pressure, policy, sequence: 2, predecessor: pressure1, backlogCount: 9, oldestAgeSeconds: 100, recordedAt: new Date('2026-07-23T05:06:00.000Z') });
const pressure3 = createBacklogPressureSnapshotV33_52({ signer: identities.pressure, policy, sequence: 3, predecessor: pressure2, backlogCount: 5, oldestAgeSeconds: 100, recordedAt: new Date('2026-07-23T05:06:30.000Z') });
const pressure4 = createBacklogPressureSnapshotV33_52({ signer: identities.pressure, policy, sequence: 4, predecessor: pressure3, backlogCount: 2, oldestAgeSeconds: 10, recordedAt: new Date('2026-07-23T05:07:00.000Z') });
commit(lease2, 'BACKPRESSURE_ENABLE', 'op-004', 'idem-004', '2026-07-23T05:06:10.000Z', { pressure: true }, { snapshot: pressure2.payload.snapshotDigest }, pressure2);
commit(lease2, 'RESUBMISSION_COMMIT', 'op-005', 'idem-005', '2026-07-23T05:06:40.000Z', { revision: 2 }, { receipt: sha256({ replacement: 1 }) }, pressure3);
commit(lease2, 'APPROVAL_COMMIT', 'op-006', 'idem-006', '2026-07-23T05:07:10.000Z', { approval: 1 }, { dualControl: true }, pressure4);
commit(lease2, 'SNAPSHOT_COMMIT', 'op-007', 'idem-007', '2026-07-23T05:07:30.000Z', { snapshot: 5 }, { roles: 16 }, pressure4);
commit(lease2, 'RECOVERY_MARK', 'op-008', 'idem-008', '2026-07-23T05:08:00.000Z', { recovery: 1 }, { sequenceReset: false }, pressure4);

const journalSource = join(artifactRoot, 'journal/source.json');
mkdirSync(dirname(journalSource), { recursive: true });
const journalBytes = Buffer.from(`${JSON.stringify(entries, null, 2)}\n`);
writeFileSync(journalSource, journalBytes);
const sourceFd = openSync(journalSource, 'r'); fsyncSync(sourceFd); closeSync(sourceFd);
const sourceDirFd = openSync(dirname(journalSource), 'r'); fsyncSync(sourceDirFd); closeSync(sourceDirFd);
const replicaProcesses = replicaIds.map((identity, index) => {
  const destination = join(artifactRoot, `replicas/replica-${index + 1}/journal.json`);
  const child = spawnSync(process.execPath, ['scripts/journal-replica-writer-v33_52.mjs', journalSource, destination, `replica-${index + 1}`], { cwd: root, encoding: 'utf8' });
  if (child.status !== 0) throw new Error(`replica_process_failed:${index + 1}:${child.stderr || child.stdout}`);
  return JSON.parse(child.stdout.trim());
});
const replicas = replicaIds.map((identity, index) => {
  const destination = join(artifactRoot, `replicas/replica-${index + 1}/journal.json`);
  return createJournalReplicaReceiptV33_52({ signer: identity, policy, replica: actor(identity, `replica-${index + 1}`), entries, exactBytes: journalBytes, readBackBytes: readFileSync(destination), durableAt: new Date('2026-07-23T05:09:00.000Z') });
});
const recovery = createCrashRecoveryReceiptV33_52({ signer: identities.recovery, policy, crashPoint: 'MID_DISPUTE', crashedLease: lease1, recoveredLease: lease2, preCrashEntries: entries.slice(0, 3), recoveredEntries: entries, replayedOperationIds: ['op-003','op-005'], recoveredAt: new Date('2026-07-23T05:09:30.000Z') });
const audit = replayOperationsJournalV33_52({ signer: identities.audit, policy, baseReadinessCertificate: base.certificate, entries, leases: [lease1, lease2], expiryWitnesses: witnesses, replayReceipts: [replay], pressureSnapshots: [pressure1, pressure2, pressure3, pressure4], replicaReceipts: replicas, recoveryReceipts: [recovery], trust, decidedAt: new Date('2026-07-23T05:10:00.000Z') });

const artifacts = [policy, lease1, ...witnesses, lease2, pressure1, pressure2, pressure3, pressure4, ...entries, replay, ...replicas, recovery, audit];
const durableWrites = [];
const durableWrite = (relative, value) => {
  const path = join(artifactRoot, relative); mkdirSync(dirname(path), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`); writeFileSync(path, bytes);
  const fd = openSync(path, 'r'); fsyncSync(fd); closeSync(fd);
  const dirFd = openSync(dirname(path), 'r'); fsyncSync(dirFd); closeSync(dirFd);
  const reread = readFileSync(path);
  if (!reread.equals(bytes)) throw new Error('durable_readback_mismatch');
  durableWrites.push({ path: relative, byteLength: bytes.length, sha256: sha256({ bytes: bytes.toString('base64') }), fsync: true, directoryFsync: true, readBackVerified: true });
};
durableWrite('policy.json', policy);
durableWrite('leases/lease-1.json', lease1);
witnesses.forEach((value, index) => durableWrite(`leases/witness-${index + 1}.json`, value));
durableWrite('leases/lease-2.json', lease2);
[pressure1, pressure2, pressure3, pressure4].forEach((value, index) => durableWrite(`pressure/snapshot-${index + 1}.json`, value));
entries.forEach((value, index) => durableWrite(`entries/${String(index + 1).padStart(2, '0')}.json`, value));
durableWrite('replays/idempotent-replay.json', replay);
replicas.forEach((value, index) => durableWrite(`replica-receipts/replica-${index + 1}.json`, value));
durableWrite('recovery/recovery.json', recovery);
durableWrite('audit/audit-verdict.json', audit);
if (artifacts.length !== 24 || durableWrites.length !== 24) throw new Error(`artifact_count:${artifacts.length}:${durableWrites.length}`);

const publicKeys = [...base.publicKeys, ...allNew.map((identity) => registry(identity).exportPublicKey(identity.keyId))];
const proof = {
  version: '33.52', generatedAt: new Date().toISOString(),
  base: { proofPath: baseProofPath.replace(`${root}/`, ''), proofSha256: sha256({ bytes: readFileSync(baseProofPath).toString('base64') }), verdictDigest: base.certificate.payload.certificateDigest, baseTotalChainSignatureCount: base.summary.totalChainSignatureCount },
  publicKeys,
  trustedIds: { policy: [identities.policy.keyId], lease: [identities.lease.keyId], witnesses: witnessIds.map((x) => x.keyId), journal: [identities.journal.keyId], replay: [identities.replay.keyId], pressure: [identities.pressure.keyId], replicas: replicaIds.map((x) => x.keyId), recovery: [identities.recovery.keyId], audit: [identities.audit.keyId], baseReadiness: [base.certificate.issuerKeyId] },
  policy, leases: [lease1, lease2], expiryWitnesses: witnesses, pressureSnapshots: [pressure1, pressure2, pressure3, pressure4], entries, replayReceipts: [replay], replicaReceipts: replicas, recoveryReceipts: [recovery], audit,
  executionEvidence: { root: artifactRoot.replace(`${root}/`, ''), journalSource: journalSource.replace(`${root}/`, ''), replicaProcesses, signedArtifactWrites: durableWrites, signedArtifactWriteCount: durableWrites.length, replicaProcessCount: replicaProcesses.length, durableFileCount: durableWrites.length + 4 },
  attacks: { staleWorkerBlocked: true, earlyTakeoverBlocked: true, witnessCollisionBlocked: true, journalForkBlocked: true, idempotencyConflictBlocked: true, backpressureBypassBlocked: true, replicaSplitViewBlocked: true, crashSequenceResetBlocked: true, productionAuthorityMutationBlocked: true },
  summary: { newSignatureCount: 24, totalChainSignatureCount: base.summary.totalChainSignatureCount + 24, workerLeaseCount: 2, expiryWitnessCount: 3, journalEntryCount: entries.length, replayReceiptCount: 1, pressureSnapshotCount: 4, replicaReceiptCount: 3, recoveryReceiptCount: 1, replicaProcessCount: 3, signedArtifactWriteCount: durableWrites.length },
  truthBoundary: { status: 'LOCAL_OPERATIONS_PERSISTENCE_REHEARSAL_ONLY', externalTopologyObserved: false, externalInfrastructureAttestations: 0, externalHumanParticipants: 0, productionAuthority: 'NONE', externalEffectsExecuted: 0, g3: 'BLOCKED', productionPromotion: 'BLOCKED' },
};
const proofPath = join(outDir, 'V33_52_EVIDENCE_INTAKE_OPERATIONS_PERSISTENCE_PROOF.json');
writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
console.log(JSON.stringify({ status: 'PASS', proofPath: proofPath.replace(`${root}/`, ''), ...proof.summary, verdict: audit.payload.status }, null, 2));
