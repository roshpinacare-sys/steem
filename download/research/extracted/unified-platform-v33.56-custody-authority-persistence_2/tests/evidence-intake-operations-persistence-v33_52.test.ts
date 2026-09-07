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
import type {
  ExternalReadinessCertificatePayloadV33_51,
  OperationsActorV33_51,
  OperationsPolicyPayloadV33_51,
} from '../src/supply-chain/evidence-intake-operations-plane-v33_51.js';
import {
  commitQueueOperationV33_52,
  createBacklogPressureSnapshotV33_52,
  createCrashRecoveryReceiptV33_52,
  createJournalReplicaReceiptV33_52,
  createLeaseExpiryWitnessV33_52,
  createPersistencePolicyV33_52,
  createWorkerLeaseV33_52,
  replayOperationsJournalV33_52,
  verifyAuditReplayVerdictV33_52,
  type AuditReplayVerdictPayloadV33_52,
  type EvidenceIntakePersistenceTrustV33_52,
  type JournalReplicaReceiptPayloadV33_52,
  type QueueJournalEntryPayloadV33_52,
} from '../src/supply-chain/evidence-intake-operations-persistence-v33_52.js';

const at = (value: string) => new Date(value);
const now = at('2026-07-23T05:00:00.000Z');
const registry = (...identities: SigningIdentity[]) => {
  const result = new KeyRegistry();
  for (const identity of identities) result.register(identity.keyId, identity.publicKey);
  return result;
};
const actor = (identity: SigningIdentity, suffix: string): OperationsActorV33_51 => ({
  keyId: identity.keyId,
  organizationId: `org-${suffix}`,
  administratorId: `admin-${suffix}`,
  hostId: `${suffix}.example.com`,
});
const digestPayload = <T extends Record<string, unknown>, K extends keyof T>(payload: T, key: K): string => {
  const copy = { ...payload };
  delete copy[key];
  return sha256(copy);
};
const resign = <T extends Record<string, unknown>>(envelope: SignedEnvelope<T>, signer: SigningIdentity, digestField: keyof T, patch: Partial<T>): SignedEnvelope<T> => {
  const payload = { ...envelope.payload, ...patch };
  delete payload[digestField];
  const complete = { ...payload, [digestField]: sha256(payload) } as T;
  return signEnvelope(complete, signer);
};

function fixture() {
  const basePolicySigner = generateSigningIdentity('v3352-base-policy');
  const baseReadinessSigner = generateSigningIdentity('v3352-base-readiness');
  const policySigner = generateSigningIdentity('v3352-policy');
  const leaseSigner = generateSigningIdentity('v3352-lease');
  const witnessSigners = [generateSigningIdentity('v3352-witness-a'), generateSigningIdentity('v3352-witness-b'), generateSigningIdentity('v3352-witness-c')];
  const journalSigner = generateSigningIdentity('v3352-journal');
  const replaySigner = generateSigningIdentity('v3352-replay');
  const pressureSigner = generateSigningIdentity('v3352-pressure');
  const replicaSigners = [generateSigningIdentity('v3352-replica-a'), generateSigningIdentity('v3352-replica-b'), generateSigningIdentity('v3352-replica-c')];
  const recoverySigner = generateSigningIdentity('v3352-recovery');
  const auditSigner = generateSigningIdentity('v3352-audit');

  const basePolicyMaterial = {
    version: '33.51' as const,
    operationsPlaneId: 'operations-plane-v33-51',
    portalId: 'portal-v33-50', ceremonyId: 'ceremony-v33-49', basePolicyDigest: sha256({ base: 50 }), baseReadinessVerdictDigest: sha256({ verdict: 50 }),
    authority: actor(basePolicySigner, 'base-policy'), requiredRoleCount: 16 as const, requiredExternalAttestations: 22 as const,
    dualControlReviewQuorum: 2 as const, requiredQuorumSnapshots: 4 as const, ticketSlaSeconds: 3600, disputeSlaSeconds: 7200,
    issuedAt: '2026-07-23T04:00:00.000Z', expiresAt: '2026-07-23T12:00:00.000Z', productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  const basePolicy = signEnvelope({ ...basePolicyMaterial, policyDigest: sha256(basePolicyMaterial) } as OperationsPolicyPayloadV33_51, basePolicySigner);
  const baseReadinessMaterial = {
    version: '33.51' as const, operationsPlaneId: basePolicy.payload.operationsPlaneId, portalId: basePolicy.payload.portalId, ceremonyId: basePolicy.payload.ceremonyId,
    policyDigest: basePolicy.payload.policyDigest, baseReadinessVerdictDigest: basePolicy.payload.baseReadinessVerdictDigest, finalSnapshotDigest: sha256({ snapshot: 4 }),
    approvalDigests: Array.from({ length: 16 }, (_, index) => sha256({ approval: index + 1 })), roleCount: 16 as const, externalAttestationCount: 0,
    openDisputeCount: 0 as const, dualControlVerified: true as const, progressionLedgerVerified: true as const,
    status: 'LOCAL_OPERATIONS_COMPLETE_REHEARSAL_ONLY' as const, externalCeremonyObserved: false, externalHumanParticipants: 0 as const,
    issuedAt: '2026-07-23T04:30:00.000Z', expiresAt: '2026-07-23T12:00:00.000Z', productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  const baseReadiness = signEnvelope({ ...baseReadinessMaterial, certificateDigest: sha256(baseReadinessMaterial) } as ExternalReadinessCertificatePayloadV33_51, baseReadinessSigner);

  const trust: EvidenceIntakePersistenceTrustV33_52 = {
    policyRegistry: registry(policySigner), trustedPolicySignerIds: [policySigner.keyId],
    leaseRegistry: registry(leaseSigner), trustedLeaseSignerIds: [leaseSigner.keyId],
    witnessRegistry: registry(...witnessSigners), trustedWitnessSignerIds: witnessSigners.map((identity) => identity.keyId),
    journalRegistry: registry(journalSigner), trustedJournalSignerIds: [journalSigner.keyId],
    replayRegistry: registry(replaySigner), trustedReplaySignerIds: [replaySigner.keyId],
    pressureRegistry: registry(pressureSigner), trustedPressureSignerIds: [pressureSigner.keyId],
    replicaRegistry: registry(...replicaSigners), trustedReplicaSignerIds: replicaSigners.map((identity) => identity.keyId),
    recoveryRegistry: registry(recoverySigner), trustedRecoverySignerIds: [recoverySigner.keyId],
    auditRegistry: registry(auditSigner), trustedAuditSignerIds: [auditSigner.keyId],
    baseReadinessRegistry: registry(baseReadinessSigner), trustedBaseReadinessSignerIds: [baseReadinessSigner.keyId],
  };
  const policy = createPersistencePolicyV33_52({
    signer: policySigner, authority: actor(policySigner, 'policy'), persistencePlaneId: 'persistence-v33-52', baseOperationsPolicy: basePolicy,
    baseReadinessCertificate: baseReadiness, issuedAt: now, expiresAt: at('2026-07-23T12:00:00Z'), workerLeaseSeconds: 300,
    backlogHighWatermark: 8, backlogLowWatermark: 3, maximumOldestAgeSeconds: 900,
  });
  const allOperations = ['ENQUEUE','REVIEW_ACCEPT','REVIEW_REJECT','DISPUTE_OPEN','RESUBMISSION_COMMIT','APPROVAL_COMMIT','SNAPSHOT_COMMIT','BACKPRESSURE_ENABLE','BACKPRESSURE_DISABLE','RECOVERY_MARK'] as const;
  const lease1 = createWorkerLeaseV33_52({ signer: leaseSigner, policy, queueId: 'queue-org-a', worker: actor(leaseSigner, 'worker-a'), term: 1, fenceSequence: 1, allowedOperations: allOperations, issuedAt: now, trust });
  const pressure1 = createBacklogPressureSnapshotV33_52({ signer: pressureSigner, policy, sequence: 1, backlogCount: 2, oldestAgeSeconds: 20, recordedAt: at('2026-07-23T05:00:30Z') });
  const entries: SignedEnvelope<QueueJournalEntryPayloadV33_52>[] = [];
  const commit = (lease: typeof lease1, operationType: typeof allOperations[number], operationId: string, idempotencyKey: string, time: string, request: unknown = { operationId }, payload: unknown = { ok: true }, pressure = pressure1) => {
    const result = commitQueueOperationV33_52({ signer: journalSigner, replaySigner, policy, lease, priorEntries: entries, latestPressureSnapshot: pressure, roleSlot: 'COORDINATOR_HOST:1', operationType, operationId, idempotencyKey, request, payload, executionClass: 'LOCAL_REHEARSAL', committedAt: at(time), trust });
    if (result.entry) entries.push(result.entry);
    return result;
  };
  commit(lease1, 'ENQUEUE', 'op-001', 'idem-001', '2026-07-23T05:01:00Z', { evidence: 1 });
  commit(lease1, 'REVIEW_ACCEPT', 'op-002', 'idem-002', '2026-07-23T05:02:00Z');
  commit(lease1, 'DISPUTE_OPEN', 'op-003', 'idem-003', '2026-07-23T05:03:00Z');
  const replay = commitQueueOperationV33_52({ signer: journalSigner, replaySigner, policy, lease: lease1, priorEntries: entries, latestPressureSnapshot: pressure1, roleSlot: 'COORDINATOR_HOST:1', operationType: 'ENQUEUE', operationId: 'op-replay', idempotencyKey: 'idem-001', request: { evidence: 1 }, payload: { ignored: true }, executionClass: 'LOCAL_REHEARSAL', committedAt: at('2026-07-23T05:04:00Z'), trust }).replay!;
  const witnessTime = at('2026-07-23T05:05:30Z');
  const witnesses = witnessSigners.map((signer, index) => createLeaseExpiryWitnessV33_52({ signer, policy, expiredLease: lease1, witness: actor(signer, `witness-${index + 1}`), observedAt: witnessTime }));
  const lease2 = createWorkerLeaseV33_52({ signer: leaseSigner, policy, queueId: lease1.payload.queueId, worker: actor(leaseSigner, 'worker-b'), term: 2, fenceSequence: 2, predecessorLease: lease1, expiryWitnesses: witnesses, allowedOperations: allOperations, issuedAt: witnessTime, trust });
  const pressure2 = createBacklogPressureSnapshotV33_52({ signer: pressureSigner, policy, sequence: 2, predecessor: pressure1, backlogCount: 9, oldestAgeSeconds: 100, recordedAt: at('2026-07-23T05:06:00Z') });
  const pressure3 = createBacklogPressureSnapshotV33_52({ signer: pressureSigner, policy, sequence: 3, predecessor: pressure2, backlogCount: 5, oldestAgeSeconds: 100, recordedAt: at('2026-07-23T05:06:30Z') });
  const pressure4 = createBacklogPressureSnapshotV33_52({ signer: pressureSigner, policy, sequence: 4, predecessor: pressure3, backlogCount: 2, oldestAgeSeconds: 10, recordedAt: at('2026-07-23T05:07:00Z') });
  commit(lease2 as typeof lease1, 'BACKPRESSURE_ENABLE', 'op-004', 'idem-004', '2026-07-23T05:06:10Z', { pressure: true }, { snapshot: pressure2.payload.snapshotDigest }, pressure2);
  commit(lease2 as typeof lease1, 'RESUBMISSION_COMMIT', 'op-005', 'idem-005', '2026-07-23T05:06:40Z', { revision: 2 }, { receipt: sha256({ replacement: 1 }) }, pressure3);
  commit(lease2 as typeof lease1, 'APPROVAL_COMMIT', 'op-006', 'idem-006', '2026-07-23T05:07:10Z', { approval: 1 }, { dualControl: true }, pressure4);
  commit(lease2 as typeof lease1, 'SNAPSHOT_COMMIT', 'op-007', 'idem-007', '2026-07-23T05:07:30Z', { snapshot: 5 }, { roles: 16 }, pressure4);
  commit(lease2 as typeof lease1, 'RECOVERY_MARK', 'op-008', 'idem-008', '2026-07-23T05:08:00Z', { recovery: 1 }, { sequenceReset: false }, pressure4);
  const journalBytes = Buffer.from(JSON.stringify(entries));
  const replicas = replicaSigners.map((signer, index) => createJournalReplicaReceiptV33_52({ signer, policy, replica: actor(signer, `replica-${index + 1}`), entries, exactBytes: journalBytes, readBackBytes: Buffer.from(journalBytes), durableAt: at('2026-07-23T05:09:00Z') }));
  const recovery = createCrashRecoveryReceiptV33_52({ signer: recoverySigner, policy, crashPoint: 'MID_DISPUTE', crashedLease: lease1, recoveredLease: lease2, preCrashEntries: entries.slice(0, 3), recoveredEntries: entries, replayedOperationIds: ['op-003','op-005'], recoveredAt: at('2026-07-23T05:09:30Z') });
  const audit = replayOperationsJournalV33_52({ signer: auditSigner, policy, baseReadinessCertificate: baseReadiness, entries, leases: [lease1, lease2], expiryWitnesses: witnesses, replayReceipts: [replay], pressureSnapshots: [pressure1, pressure2, pressure3, pressure4], replicaReceipts: replicas, recoveryReceipts: [recovery], trust, decidedAt: at('2026-07-23T05:10:00Z') });
  return { basePolicySigner, baseReadinessSigner, policySigner, leaseSigner, witnessSigners, journalSigner, replaySigner, pressureSigner, replicaSigners, recoverySigner, auditSigner, basePolicy, baseReadiness, trust, policy, lease1, lease2, witnesses, pressure1, pressure2, pressure3, pressure4, entries, replay, journalBytes, replicas, recovery, audit, allOperations };
}

test('v33.52 fixture produces durable local verdict', () => { const f = fixture(); assert.equal(f.audit.payload.status, 'LOCAL_OPERATIONS_PERSISTENCE_REHEARSAL_ONLY'); assert.equal(f.audit.payload.journalEntryCount, 8); assert.equal(f.audit.payload.replicaReceiptCount, 3); });
test('v33.52 policy binds operations policy and readiness certificate', () => { const f = fixture(); assert.equal(f.policy.payload.baseOperationsPolicyDigest, f.basePolicy.payload.policyDigest); assert.equal(f.policy.payload.baseReadinessCertificateDigest, f.baseReadiness.payload.certificateDigest); });
test('v33.52 policy rejects mismatched base certificate', () => { const f = fixture(); const bad = resign(f.baseReadiness as unknown as SignedEnvelope<Record<string, unknown>>, f.baseReadinessSigner, 'certificateDigest', { policyDigest: sha256({ wrong: true }) }); assert.throws(() => createPersistencePolicyV33_52({ signer: f.policySigner, authority: actor(f.policySigner, 'policy'), persistencePlaneId: 'x', baseOperationsPolicy: f.basePolicy, baseReadinessCertificate: bad as unknown as typeof f.baseReadiness, issuedAt: now, expiresAt: at('2026-07-23T12:00:00Z') }), /persistence_base_binding/); });
test('v33.52 policy rejects invalid watermarks', () => { const f = fixture(); assert.throws(() => createPersistencePolicyV33_52({ signer: f.policySigner, authority: actor(f.policySigner, 'policy'), persistencePlaneId: 'x', baseOperationsPolicy: f.basePolicy, baseReadinessCertificate: f.baseReadiness, issuedAt: now, expiresAt: at('2026-07-23T12:00:00Z'), backlogHighWatermark: 3, backlogLowWatermark: 3 }), /persistence_policy_limits/); });
test('v33.52 initial lease has term and fence one', () => { const f = fixture(); assert.equal(f.lease1.payload.term, 1); assert.equal(f.lease1.payload.fenceSequence, 1); });
test('v33.52 successor lease requires predecessor', () => { const f = fixture(); assert.throws(() => createWorkerLeaseV33_52({ signer: f.leaseSigner, policy: f.policy, queueId: 'q', worker: actor(f.leaseSigner, 'w'), term: 2, fenceSequence: 2, allowedOperations: f.allOperations, issuedAt: at('2026-07-23T06:00:00Z'), trust: f.trust }), /lease_predecessor_required/); });
test('v33.52 takeover before expiry is rejected', () => { const f = fixture(); assert.throws(() => createWorkerLeaseV33_52({ signer: f.leaseSigner, policy: f.policy, queueId: f.lease1.payload.queueId, worker: actor(f.leaseSigner, 'w'), term: 2, fenceSequence: 2, predecessorLease: f.lease1, expiryWitnesses: f.witnesses, allowedOperations: f.allOperations, issuedAt: at('2026-07-23T05:04:59Z'), trust: f.trust }), /lease_takeover_early/); });
test('v33.52 takeover requires three expiry witnesses', () => { const f = fixture(); assert.throws(() => createWorkerLeaseV33_52({ signer: f.leaseSigner, policy: f.policy, queueId: f.lease1.payload.queueId, worker: actor(f.leaseSigner, 'w'), term: 2, fenceSequence: 2, predecessorLease: f.lease1, expiryWitnesses: f.witnesses.slice(0, 2), allowedOperations: f.allOperations, issuedAt: at('2026-07-23T05:05:30Z'), trust: f.trust }), /lease_witness_quorum/); });
test('v33.52 witness identities must be separate', () => { const f = fixture(); const duplicate = [f.witnesses[0]!, f.witnesses[0]!, f.witnesses[2]!]; assert.throws(() => createWorkerLeaseV33_52({ signer: f.leaseSigner, policy: f.policy, queueId: f.lease1.payload.queueId, worker: actor(f.leaseSigner, 'w'), term: 2, fenceSequence: 2, predecessorLease: f.lease1, expiryWitnesses: duplicate, allowedOperations: f.allOperations, issuedAt: at('2026-07-23T05:05:30Z'), trust: f.trust }), /lease_witness_separation/); });
test('v33.52 fence sequence cannot skip', () => { const f = fixture(); assert.throws(() => createWorkerLeaseV33_52({ signer: f.leaseSigner, policy: f.policy, queueId: f.lease1.payload.queueId, worker: actor(f.leaseSigner, 'w'), term: 2, fenceSequence: 3, predecessorLease: f.lease1, expiryWitnesses: f.witnesses, allowedOperations: f.allOperations, issuedAt: at('2026-07-23T05:05:30Z'), trust: f.trust }), /lease_fence_sequence/); });
test('v33.52 allowed operation list rejects duplicates', () => { const f = fixture(); assert.throws(() => createWorkerLeaseV33_52({ signer: f.leaseSigner, policy: f.policy, queueId: 'q', worker: actor(f.leaseSigner, 'w'), term: 1, fenceSequence: 1, allowedOperations: ['ENQUEUE','ENQUEUE'], issuedAt: now, trust: f.trust }), /lease_operations_duplicate/); });
test('v33.52 early expiry witness is rejected', () => { const f = fixture(); assert.throws(() => createLeaseExpiryWitnessV33_52({ signer: f.witnessSigners[0]!, policy: f.policy, expiredLease: f.lease1, witness: actor(f.witnessSigners[0]!, 'w'), observedAt: at('2026-07-23T05:04:00Z') }), /lease_witness_early/); });
test('v33.52 high watermark enables pressure', () => { const f = fixture(); assert.equal(f.pressure2.payload.pressureActive, true); assert.equal(f.pressure2.payload.reason, 'HIGH_WATERMARK'); });
test('v33.52 pressure remains active above low watermark', () => { const f = fixture(); assert.equal(f.pressure3.payload.pressureActive, true); });
test('v33.52 hysteresis clears below low watermark', () => { const f = fixture(); assert.equal(f.pressure4.payload.pressureActive, false); assert.equal(f.pressure4.payload.reason, 'HYSTERESIS_CLEAR'); });
test('v33.52 oldest age can enable pressure', () => { const f = fixture(); const p = createBacklogPressureSnapshotV33_52({ signer: f.pressureSigner, policy: f.policy, sequence: 1, backlogCount: 1, oldestAgeSeconds: 901, recordedAt: now }); assert.equal(p.payload.reason, 'OLDEST_AGE'); });
test('v33.52 pressure sequence cannot skip', () => { const f = fixture(); assert.throws(() => createBacklogPressureSnapshotV33_52({ signer: f.pressureSigner, policy: f.policy, sequence: 3, predecessor: f.pressure1, backlogCount: 1, oldestAgeSeconds: 1, recordedAt: now }), /pressure_sequence/); });
test('v33.52 journal is monotonic', () => { const f = fixture(); assert.deepEqual(f.entries.map((entry) => entry.payload.sequence), [1,2,3,4,5,6,7,8]); assert.equal(f.entries[1]!.payload.predecessorEntryDigest, f.entries[0]!.payload.entryDigest); });
test('v33.52 duplicate request yields replay receipt and no entry', () => { const f = fixture(); assert.equal(f.replay.payload.journalEntryCreated, false); assert.equal(f.replay.payload.originalEntryDigest, f.entries[0]!.payload.entryDigest); });
test('v33.52 conflicting idempotency request is rejected', () => { const f = fixture(); assert.throws(() => commitQueueOperationV33_52({ signer: f.journalSigner, replaySigner: f.replaySigner, policy: f.policy, lease: f.lease2, priorEntries: f.entries, latestPressureSnapshot: f.pressure4, roleSlot: 'COORDINATOR_HOST:1', operationType: 'ENQUEUE', operationId: 'op-x', idempotencyKey: 'idem-001', request: { evidence: 2 }, payload: {}, executionClass: 'LOCAL_REHEARSAL', committedAt: at('2026-07-23T05:08:30Z'), trust: f.trust }), /idempotency_conflict/); });
test('v33.52 duplicate operation id is rejected', () => { const f = fixture(); assert.throws(() => commitQueueOperationV33_52({ signer: f.journalSigner, replaySigner: f.replaySigner, policy: f.policy, lease: f.lease2, priorEntries: f.entries, latestPressureSnapshot: f.pressure4, roleSlot: 'COORDINATOR_HOST:1', operationType: 'APPROVAL_COMMIT', operationId: 'op-001', idempotencyKey: 'idem-new', request: {}, payload: {}, executionClass: 'LOCAL_REHEARSAL', committedAt: at('2026-07-23T05:08:30Z'), trust: f.trust }), /operation_id_duplicate/); });
test('v33.52 active backpressure rejects enqueue', () => { const f = fixture(); assert.throws(() => commitQueueOperationV33_52({ signer: f.journalSigner, replaySigner: f.replaySigner, policy: f.policy, lease: f.lease2, priorEntries: f.entries, latestPressureSnapshot: f.pressure2, roleSlot: 'COORDINATOR_HOST:1', operationType: 'ENQUEUE', operationId: 'op-new', idempotencyKey: 'idem-new', request: {}, payload: {}, executionClass: 'LOCAL_REHEARSAL', committedAt: at('2026-07-23T05:08:30Z'), trust: f.trust }), /backpressure_reject_enqueue/); });
test('v33.52 expired lease cannot commit', () => { const f = fixture(); assert.throws(() => commitQueueOperationV33_52({ signer: f.journalSigner, replaySigner: f.replaySigner, policy: f.policy, lease: f.lease1, priorEntries: f.entries.slice(0,3), latestPressureSnapshot: f.pressure1, roleSlot: 'x:1', operationType: 'REVIEW_ACCEPT', operationId: 'op-expired', idempotencyKey: 'idem-expired', request: {}, payload: {}, executionClass: 'LOCAL_REHEARSAL', committedAt: at('2026-07-23T05:05:01Z'), trust: f.trust }), /lease_inactive/); });
test('v33.52 lease forbids unlisted operation', () => { const f = fixture(); const limited = createWorkerLeaseV33_52({ signer: f.leaseSigner, policy: f.policy, queueId: 'q-limited', worker: actor(f.leaseSigner, 'limited'), term: 1, fenceSequence: 1, allowedOperations: ['REVIEW_ACCEPT'], issuedAt: now, trust: f.trust }); assert.throws(() => commitQueueOperationV33_52({ signer: f.journalSigner, replaySigner: f.replaySigner, policy: f.policy, lease: limited, priorEntries: [], latestPressureSnapshot: f.pressure1, roleSlot: 'x:1', operationType: 'ENQUEUE', operationId: 'op-limited', idempotencyKey: 'idem-limited', request: {}, payload: {}, executionClass: 'LOCAL_REHEARSAL', committedAt: at('2026-07-23T05:01:00Z'), trust: f.trust }), /lease_operation_forbidden/); });
test('v33.52 replica receipt requires exact readback', () => { const f = fixture(); assert.throws(() => createJournalReplicaReceiptV33_52({ signer: f.replicaSigners[0]!, policy: f.policy, replica: actor(f.replicaSigners[0]!, 'r'), entries: f.entries, exactBytes: f.journalBytes, readBackBytes: Buffer.from('different'), durableAt: now }), /replica_readback/); });
test('v33.52 three replicas bind identical bytes', () => { const f = fixture(); assert.equal(new Set(f.replicas.map((receipt) => receipt.payload.exactBytesDigest)).size, 1); });
test('v33.52 recovery preserves journal prefix', () => { const f = fixture(); assert.equal(f.recovery.payload.sequenceReset, false); assert.equal(f.recovery.payload.forkDetected, false); });
test('v33.52 recovery rejects forked prefix', () => { const f = fixture(); const forked = [...f.entries]; forked[1] = resign(f.entries[1] as unknown as SignedEnvelope<Record<string, unknown>>, f.journalSigner, 'entryDigest', { payloadDigest: sha256({ fork: true }) }) as unknown as typeof f.entries[number]; assert.throws(() => createCrashRecoveryReceiptV33_52({ signer: f.recoverySigner, policy: f.policy, crashPoint: 'MID_REVIEW', crashedLease: f.lease1, recoveredLease: f.lease2, preCrashEntries: f.entries.slice(0,3), recoveredEntries: forked, replayedOperationIds: [], recoveredAt: now }), /recovery_fork/); });
test('v33.52 recovery rejects unknown replay operation', () => { const f = fixture(); assert.throws(() => createCrashRecoveryReceiptV33_52({ signer: f.recoverySigner, policy: f.policy, crashPoint: 'MID_REVIEW', crashedLease: f.lease1, recoveredLease: f.lease2, preCrashEntries: f.entries.slice(0,3), recoveredEntries: f.entries, replayedOperationIds: ['op-missing'], recoveredAt: now }), /recovery_replay_unknown/); });
test('v33.52 audit replay verifies complete state', () => { const f = fixture(); assert.equal(f.audit.payload.journalChainVerified, true); assert.equal(f.audit.payload.replayStateDigest.length, 64); });
test('v33.52 audit rejects journal gap', () => { const f = fixture(); assert.throws(() => replayOperationsJournalV33_52({ signer: f.auditSigner, policy: f.policy, baseReadinessCertificate: f.baseReadiness, entries: [f.entries[0]!, ...f.entries.slice(2)], leases: [f.lease1,f.lease2], expiryWitnesses: f.witnesses, replayReceipts: [f.replay], pressureSnapshots: [f.pressure1,f.pressure2,f.pressure3,f.pressure4], replicaReceipts: f.replicas, recoveryReceipts: [f.recovery], trust: f.trust, decidedAt: at('2026-07-23T05:10:00Z') }), /audit_journal_chain/); });
test('v33.52 audit rejects worker fence tamper', () => { const f = fixture(); const bad = resign(f.entries[3] as unknown as SignedEnvelope<Record<string, unknown>>, f.journalSigner, 'entryDigest', { fenceSequence: 1 }); const entries = [...f.entries]; entries[3] = bad as unknown as typeof f.entries[number]; assert.throws(() => replayOperationsJournalV33_52({ signer: f.auditSigner, policy: f.policy, baseReadinessCertificate: f.baseReadiness, entries, leases: [f.lease1,f.lease2], expiryWitnesses: f.witnesses, replayReceipts: [f.replay], pressureSnapshots: [f.pressure1,f.pressure2,f.pressure3,f.pressure4], replicaReceipts: f.replicas, recoveryReceipts: [f.recovery], trust: f.trust, decidedAt: at('2026-07-23T05:10:00Z') }), /audit_worker_fence|audit_journal_chain/); });
test('v33.52 audit requires three pressure snapshots', () => { const f = fixture(); assert.throws(() => replayOperationsJournalV33_52({ signer: f.auditSigner, policy: f.policy, baseReadinessCertificate: f.baseReadiness, entries: f.entries, leases: [f.lease1,f.lease2], expiryWitnesses: f.witnesses, replayReceipts: [f.replay], pressureSnapshots: [f.pressure1,f.pressure2], replicaReceipts: f.replicas, recoveryReceipts: [f.recovery], trust: f.trust, decidedAt: at('2026-07-23T05:10:00Z') }), /audit_pressure_count/); });
test('v33.52 audit requires three replicas', () => { const f = fixture(); assert.throws(() => replayOperationsJournalV33_52({ signer: f.auditSigner, policy: f.policy, baseReadinessCertificate: f.baseReadiness, entries: f.entries, leases: [f.lease1,f.lease2], expiryWitnesses: f.witnesses, replayReceipts: [f.replay], pressureSnapshots: [f.pressure1,f.pressure2,f.pressure3,f.pressure4], replicaReceipts: f.replicas.slice(0,2), recoveryReceipts: [f.recovery], trust: f.trust, decidedAt: at('2026-07-23T05:10:00Z') }), /audit_replica_count/); });
test('v33.52 audit rejects duplicate replica administrator', () => { const f = fixture(); const duplicateActor = resign(f.replicas[1] as unknown as SignedEnvelope<Record<string, unknown>>, f.replicaSigners[1]!, 'receiptDigest', { replica: f.replicas[0]!.payload.replica }); const replicas = [f.replicas[0]!, duplicateActor as unknown as typeof f.replicas[number], f.replicas[2]!]; assert.throws(() => replayOperationsJournalV33_52({ signer: f.auditSigner, policy: f.policy, baseReadinessCertificate: f.baseReadiness, entries: f.entries, leases: [f.lease1,f.lease2], expiryWitnesses: f.witnesses, replayReceipts: [f.replay], pressureSnapshots: [f.pressure1,f.pressure2,f.pressure3,f.pressure4], replicaReceipts: replicas, recoveryReceipts: [f.recovery], trust: f.trust, decidedAt: at('2026-07-23T05:10:00Z') }), /audit_replica_separation/); });
test('v33.52 audit rejects replica byte split view', () => { const f = fixture(); const bad = resign(f.replicas[1] as unknown as SignedEnvelope<Record<string, unknown>>, f.replicaSigners[1]!, 'receiptDigest', { exactBytesDigest: sha256({ split: true }), readBackDigest: sha256({ split: true }) }); const replicas = [f.replicas[0]!, bad as unknown as typeof f.replicas[number], f.replicas[2]!]; assert.throws(() => replayOperationsJournalV33_52({ signer: f.auditSigner, policy: f.policy, baseReadinessCertificate: f.baseReadiness, entries: f.entries, leases: [f.lease1,f.lease2], expiryWitnesses: f.witnesses, replayReceipts: [f.replay], pressureSnapshots: [f.pressure1,f.pressure2,f.pressure3,f.pressure4], replicaReceipts: replicas, recoveryReceipts: [f.recovery], trust: f.trust, decidedAt: at('2026-07-23T05:10:00Z') }), /audit_replica_bytes/); });
test('v33.52 audit rejects invalid base readiness signature', () => { const f = fixture(); const bad = { ...f.baseReadiness, signature: `${f.baseReadiness.signature[0] === 'A' ? 'B' : 'A'}${f.baseReadiness.signature.slice(1)}` }; assert.throws(() => replayOperationsJournalV33_52({ signer: f.auditSigner, policy: f.policy, baseReadinessCertificate: bad, entries: f.entries, leases: [f.lease1,f.lease2], expiryWitnesses: f.witnesses, replayReceipts: [f.replay], pressureSnapshots: [f.pressure1,f.pressure2,f.pressure3,f.pressure4], replicaReceipts: f.replicas, recoveryReceipts: [f.recovery], trust: f.trust, decidedAt: at('2026-07-23T05:10:00Z') }), /base_readiness_signature/); });
test('v33.52 verifier accepts recomputed verdict', () => { const f = fixture(); assert.equal(verifyAuditReplayVerdictV33_52({ verdict: f.audit, recomputed: f.audit, trust: f.trust, verifiedAt: at('2026-07-23T05:11:00Z') }).verdictDigest, f.audit.payload.verdictDigest); });
test('v33.52 verifier rejects verdict recompute mismatch', () => { const f = fixture(); const bad = resign(f.audit as unknown as SignedEnvelope<Record<string, unknown>>, f.auditSigner, 'verdictDigest', { queueCount: 99 }); assert.throws(() => verifyAuditReplayVerdictV33_52({ verdict: bad as unknown as SignedEnvelope<AuditReplayVerdictPayloadV33_52>, recomputed: f.audit, trust: f.trust, verifiedAt: at('2026-07-23T05:11:00Z') }), /audit_verdict_recompute/); });
test('v33.52 verifier rejects production authority mutation', () => { const f = fixture(); const bad = resign(f.audit as unknown as SignedEnvelope<Record<string, unknown>>, f.auditSigner, 'verdictDigest', { productionAuthority: 'PRODUCTION' }); assert.throws(() => verifyAuditReplayVerdictV33_52({ verdict: bad as unknown as SignedEnvelope<AuditReplayVerdictPayloadV33_52>, recomputed: bad as unknown as SignedEnvelope<AuditReplayVerdictPayloadV33_52>, trust: f.trust, verifiedAt: at('2026-07-23T05:11:00Z') }), /audit_truth_boundary/); });
test('v33.52 verdict preserves external and production blocks', () => { const f = fixture(); assert.equal(f.audit.payload.externalTopologyObserved, false); assert.equal(f.audit.payload.externalHumanParticipants, 0); assert.equal(f.audit.payload.productionAuthority, 'NONE'); assert.equal(f.audit.payload.externalEffectsExecuted, 0); });
