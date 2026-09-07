import { KeyRegistry, sha256, sha256Bytes, signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';
import type {
  DualControlApprovalPayloadV33_51,
  ExternalReadinessCertificatePayloadV33_51,
  OperationsActorV33_51,
  OperationsPolicyPayloadV33_51,
} from './evidence-intake-operations-plane-v33_51.js';

export type PersistenceExecutionClassV33_52 = 'LOCAL_REHEARSAL' | 'LIVE_EXTERNAL';
export type QueueOperationTypeV33_52 =
  | 'ENQUEUE'
  | 'REVIEW_ACCEPT'
  | 'REVIEW_REJECT'
  | 'DISPUTE_OPEN'
  | 'RESUBMISSION_COMMIT'
  | 'APPROVAL_COMMIT'
  | 'SNAPSHOT_COMMIT'
  | 'BACKPRESSURE_ENABLE'
  | 'BACKPRESSURE_DISABLE'
  | 'RECOVERY_MARK';
export type CrashPointV33_52 = 'MID_REVIEW' | 'MID_DISPUTE' | 'MID_RESUBMISSION' | 'MID_SNAPSHOT';

export interface PersistencePolicyPayloadV33_52 {
  readonly version: '33.52';
  readonly persistencePlaneId: string;
  readonly operationsPlaneId: string;
  readonly baseOperationsPolicyDigest: string;
  readonly baseReadinessCertificateDigest: string;
  readonly authority: OperationsActorV33_51;
  readonly requiredReplicaCount: 3;
  readonly leaseWitnessQuorum: 3;
  readonly workerLeaseSeconds: number;
  readonly backlogHighWatermark: number;
  readonly backlogLowWatermark: number;
  readonly maximumOldestAgeSeconds: number;
  readonly requiredPressureSnapshots: 3;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly policyDigest: string;
}

export interface WorkerLeasePayloadV33_52 {
  readonly version: '33.52';
  readonly persistencePlaneId: string;
  readonly policyDigest: string;
  readonly queueId: string;
  readonly worker: OperationsActorV33_51;
  readonly term: number;
  readonly fenceSequence: number;
  readonly predecessorLeaseDigest: string | null;
  readonly allowedOperations: readonly QueueOperationTypeV33_52[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly leaseDigest: string;
}

export interface LeaseExpiryWitnessPayloadV33_52 {
  readonly version: '33.52';
  readonly persistencePlaneId: string;
  readonly policyDigest: string;
  readonly expiredLeaseDigest: string;
  readonly witness: OperationsActorV33_51;
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly witnessDigest: string;
}

export interface QueueJournalEntryPayloadV33_52 {
  readonly version: '33.52';
  readonly persistencePlaneId: string;
  readonly policyDigest: string;
  readonly sequence: number;
  readonly predecessorEntryDigest: string | null;
  readonly queueId: string;
  readonly roleSlot: string;
  readonly operationType: QueueOperationTypeV33_52;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly payloadDigest: string;
  readonly workerLeaseDigest: string;
  readonly leaseTerm: number;
  readonly fenceSequence: number;
  readonly executionClass: PersistenceExecutionClassV33_52;
  readonly committedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly entryDigest: string;
}

export interface IdempotentReplayReceiptPayloadV33_52 {
  readonly version: '33.52';
  readonly persistencePlaneId: string;
  readonly policyDigest: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly originalOperationId: string;
  readonly originalEntryDigest: string;
  readonly replayedAt: string;
  readonly journalEntryCreated: false;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly replayDigest: string;
}

export interface BacklogPressureSnapshotPayloadV33_52 {
  readonly version: '33.52';
  readonly persistencePlaneId: string;
  readonly policyDigest: string;
  readonly sequence: number;
  readonly predecessorSnapshotDigest: string | null;
  readonly backlogCount: number;
  readonly oldestAgeSeconds: number;
  readonly pressureActive: boolean;
  readonly reason: 'HIGH_WATERMARK' | 'OLDEST_AGE' | 'HYSTERESIS_CLEAR' | 'NORMAL';
  readonly recordedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export interface JournalReplicaReceiptPayloadV33_52 {
  readonly version: '33.52';
  readonly persistencePlaneId: string;
  readonly policyDigest: string;
  readonly replica: OperationsActorV33_51;
  readonly journalEntryCount: number;
  readonly journalHeadDigest: string;
  readonly exactBytesDigest: string;
  readonly exactByteLength: number;
  readonly fileFsync: true;
  readonly directoryFsync: true;
  readonly readBackDigest: string;
  readonly durableAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface CrashRecoveryReceiptPayloadV33_52 {
  readonly version: '33.52';
  readonly persistencePlaneId: string;
  readonly policyDigest: string;
  readonly crashPoint: CrashPointV33_52;
  readonly crashedWorkerLeaseDigest: string;
  readonly recoveredWorkerLeaseDigest: string;
  readonly preCrashJournalHeadDigest: string;
  readonly recoveredJournalHeadDigest: string;
  readonly recoveredEntryCount: number;
  readonly replayedOperationIds: readonly string[];
  readonly sequenceReset: false;
  readonly forkDetected: false;
  readonly recoveredAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly recoveryDigest: string;
}

export interface AuditReplayVerdictPayloadV33_52 {
  readonly version: '33.52';
  readonly persistencePlaneId: string;
  readonly policyDigest: string;
  readonly baseReadinessCertificateDigest: string;
  readonly journalEntryCount: number;
  readonly journalHeadDigest: string;
  readonly queueCount: number;
  readonly operationCount: number;
  readonly idempotencyKeyCount: number;
  readonly pressureSnapshotCount: number;
  readonly replicaReceiptCount: 3;
  readonly recoveryReceiptCount: number;
  readonly replayStateDigest: string;
  readonly journalChainVerified: true;
  readonly workerFencingVerified: true;
  readonly idempotencyVerified: true;
  readonly backlogControlsVerified: true;
  readonly replicaDurabilityVerified: true;
  readonly crashRecoveryVerified: true;
  readonly status: 'LOCAL_OPERATIONS_PERSISTENCE_REHEARSAL_ONLY';
  readonly externalTopologyObserved: false;
  readonly externalHumanParticipants: 0;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly decidedAt: string;
  readonly verdictDigest: string;
}

export interface EvidenceIntakePersistenceTrustV33_52 {
  readonly policyRegistry: KeyRegistry;
  readonly trustedPolicySignerIds: readonly string[];
  readonly leaseRegistry: KeyRegistry;
  readonly trustedLeaseSignerIds: readonly string[];
  readonly witnessRegistry: KeyRegistry;
  readonly trustedWitnessSignerIds: readonly string[];
  readonly journalRegistry: KeyRegistry;
  readonly trustedJournalSignerIds: readonly string[];
  readonly replayRegistry: KeyRegistry;
  readonly trustedReplaySignerIds: readonly string[];
  readonly pressureRegistry: KeyRegistry;
  readonly trustedPressureSignerIds: readonly string[];
  readonly replicaRegistry: KeyRegistry;
  readonly trustedReplicaSignerIds: readonly string[];
  readonly recoveryRegistry: KeyRegistry;
  readonly trustedRecoverySignerIds: readonly string[];
  readonly auditRegistry: KeyRegistry;
  readonly trustedAuditSignerIds: readonly string[];
  readonly baseReadinessRegistry: KeyRegistry;
  readonly trustedBaseReadinessSignerIds: readonly string[];
}

const HEX64 = /^[0-9a-f]{64}$/;
const OP_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,127}$/;
const digestWithout = <T extends Record<string, unknown>>(payload: T, key: keyof T): string => {
  const copy = { ...payload };
  delete copy[key];
  return sha256(copy);
};
const assertDigest = (payload: Record<string, unknown>, key: string, code: string): void => {
  const value = payload[key];
  if (typeof value !== 'string' || !HEX64.test(value) || digestWithout(payload, key) !== value) throw new Error(code);
};
const parseTime = (value: string, code: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
};
const verifyEnvelope = <T>(envelope: SignedEnvelope<T>, registry: KeyRegistry, trusted: readonly string[], at: Date, code: string): void => {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, at)) throw new Error(code);
};
const assertActor = (actor: OperationsActorV33_51, code: string): void => {
  if (Object.values(actor).some((value) => typeof value !== 'string' || value.trim() === '')) throw new Error(code);
};
const distinctActors = (actors: readonly OperationsActorV33_51[], code: string): void => {
  for (const field of ['keyId', 'organizationId', 'administratorId', 'hostId'] as const) {
    if (new Set(actors.map((actor) => actor[field])).size !== actors.length) throw new Error(code);
  }
};
const assertOperationId = (value: string, code: string): void => {
  if (!OP_ID.test(value)) throw new Error(code);
};

export function createPersistencePolicyV33_52(input: {
  signer: SigningIdentity;
  authority: OperationsActorV33_51;
  persistencePlaneId: string;
  baseOperationsPolicy: SignedEnvelope<OperationsPolicyPayloadV33_51>;
  baseReadinessCertificate: SignedEnvelope<ExternalReadinessCertificatePayloadV33_51>;
  issuedAt: Date;
  expiresAt: Date;
  workerLeaseSeconds?: number;
  backlogHighWatermark?: number;
  backlogLowWatermark?: number;
  maximumOldestAgeSeconds?: number;
}): SignedEnvelope<PersistencePolicyPayloadV33_52> {
  assertActor(input.authority, 'persistence_policy_actor');
  if (input.persistencePlaneId.trim() === '' || input.expiresAt <= input.issuedAt) throw new Error('persistence_policy_input');
  if (input.baseReadinessCertificate.payload.policyDigest !== input.baseOperationsPolicy.payload.policyDigest) throw new Error('persistence_base_binding');
  const workerLeaseSeconds = input.workerLeaseSeconds ?? 300;
  const backlogHighWatermark = input.backlogHighWatermark ?? 64;
  const backlogLowWatermark = input.backlogLowWatermark ?? 32;
  const maximumOldestAgeSeconds = input.maximumOldestAgeSeconds ?? 1800;
  if (workerLeaseSeconds < 30 || backlogLowWatermark < 1 || backlogHighWatermark <= backlogLowWatermark || maximumOldestAgeSeconds < 60) throw new Error('persistence_policy_limits');
  const material = {
    version: '33.52' as const,
    persistencePlaneId: input.persistencePlaneId,
    operationsPlaneId: input.baseOperationsPolicy.payload.operationsPlaneId,
    baseOperationsPolicyDigest: input.baseOperationsPolicy.payload.policyDigest,
    baseReadinessCertificateDigest: input.baseReadinessCertificate.payload.certificateDigest,
    authority: input.authority,
    requiredReplicaCount: 3 as const,
    leaseWitnessQuorum: 3 as const,
    workerLeaseSeconds,
    backlogHighWatermark,
    backlogLowWatermark,
    maximumOldestAgeSeconds,
    requiredPressureSnapshots: 3 as const,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, policyDigest: sha256(material) }, input.signer);
}

export function createWorkerLeaseV33_52(input: {
  signer: SigningIdentity;
  policy: SignedEnvelope<PersistencePolicyPayloadV33_52>;
  queueId: string;
  worker: OperationsActorV33_51;
  term: number;
  fenceSequence: number;
  predecessorLease?: SignedEnvelope<WorkerLeasePayloadV33_52> | null;
  expiryWitnesses?: readonly SignedEnvelope<LeaseExpiryWitnessPayloadV33_52>[];
  allowedOperations: readonly QueueOperationTypeV33_52[];
  issuedAt: Date;
  trust: EvidenceIntakePersistenceTrustV33_52;
}): SignedEnvelope<WorkerLeasePayloadV33_52> {
  assertActor(input.worker, 'lease_worker');
  if (input.queueId.trim() === '' || input.term < 1 || input.fenceSequence < 1 || input.allowedOperations.length === 0) throw new Error('lease_input');
  if (new Set(input.allowedOperations).size !== input.allowedOperations.length) throw new Error('lease_operations_duplicate');
  const predecessor = input.predecessorLease ?? null;
  if ((input.term === 1) !== (predecessor === null)) throw new Error('lease_predecessor_required');
  if (predecessor) {
    verifyEnvelope(predecessor, input.trust.leaseRegistry, input.trust.trustedLeaseSignerIds, input.issuedAt, 'lease_predecessor_signature');
    assertDigest(predecessor.payload as unknown as Record<string, unknown>, 'leaseDigest', 'lease_predecessor_digest');
    if (predecessor.payload.queueId !== input.queueId || input.term !== predecessor.payload.term + 1 || input.fenceSequence !== predecessor.payload.fenceSequence + 1) throw new Error('lease_fence_sequence');
    if (input.issuedAt.getTime() <= parseTime(predecessor.payload.expiresAt, 'lease_predecessor_expiry')) throw new Error('lease_takeover_early');
    const witnesses = input.expiryWitnesses ?? [];
    if (witnesses.length !== input.policy.payload.leaseWitnessQuorum) throw new Error('lease_witness_quorum');
    const actors: OperationsActorV33_51[] = [];
    for (const witness of witnesses) {
      verifyEnvelope(witness, input.trust.witnessRegistry, input.trust.trustedWitnessSignerIds, input.issuedAt, 'lease_witness_signature');
      assertDigest(witness.payload as unknown as Record<string, unknown>, 'witnessDigest', 'lease_witness_digest');
      if (witness.payload.policyDigest !== input.policy.payload.policyDigest || witness.payload.expiredLeaseDigest !== predecessor.payload.leaseDigest) throw new Error('lease_witness_binding');
      if (parseTime(witness.payload.observedAt, 'lease_witness_time') <= parseTime(predecessor.payload.expiresAt, 'lease_predecessor_expiry')) throw new Error('lease_witness_early');
      actors.push(witness.payload.witness);
    }
    distinctActors(actors, 'lease_witness_separation');
  }
  const material = {
    version: '33.52' as const,
    persistencePlaneId: input.policy.payload.persistencePlaneId,
    policyDigest: input.policy.payload.policyDigest,
    queueId: input.queueId,
    worker: input.worker,
    term: input.term,
    fenceSequence: input.fenceSequence,
    predecessorLeaseDigest: predecessor?.payload.leaseDigest ?? null,
    allowedOperations: [...input.allowedOperations].sort(),
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: new Date(input.issuedAt.getTime() + input.policy.payload.workerLeaseSeconds * 1000).toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, leaseDigest: sha256(material) }, input.signer);
}

export function createLeaseExpiryWitnessV33_52(input: {
  signer: SigningIdentity;
  policy: SignedEnvelope<PersistencePolicyPayloadV33_52>;
  expiredLease: SignedEnvelope<WorkerLeasePayloadV33_52>;
  witness: OperationsActorV33_51;
  observedAt: Date;
}): SignedEnvelope<LeaseExpiryWitnessPayloadV33_52> {
  assertActor(input.witness, 'lease_witness_actor');
  if (input.observedAt.getTime() <= parseTime(input.expiredLease.payload.expiresAt, 'lease_expiry')) throw new Error('lease_witness_early');
  const material = {
    version: '33.52' as const,
    persistencePlaneId: input.policy.payload.persistencePlaneId,
    policyDigest: input.policy.payload.policyDigest,
    expiredLeaseDigest: input.expiredLease.payload.leaseDigest,
    witness: input.witness,
    observedAt: input.observedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, witnessDigest: sha256(material) }, input.signer);
}

export function createBacklogPressureSnapshotV33_52(input: {
  signer: SigningIdentity;
  policy: SignedEnvelope<PersistencePolicyPayloadV33_52>;
  sequence: number;
  predecessor?: SignedEnvelope<BacklogPressureSnapshotPayloadV33_52> | null;
  backlogCount: number;
  oldestAgeSeconds: number;
  recordedAt: Date;
}): SignedEnvelope<BacklogPressureSnapshotPayloadV33_52> {
  const predecessor = input.predecessor ?? null;
  if (input.sequence < 1 || (input.sequence === 1) !== (predecessor === null) || input.backlogCount < 0 || input.oldestAgeSeconds < 0) throw new Error('pressure_input');
  if (predecessor && input.sequence !== predecessor.payload.sequence + 1) throw new Error('pressure_sequence');
  let pressureActive: boolean;
  let reason: BacklogPressureSnapshotPayloadV33_52['reason'];
  if (input.backlogCount >= input.policy.payload.backlogHighWatermark) { pressureActive = true; reason = 'HIGH_WATERMARK'; }
  else if (input.oldestAgeSeconds >= input.policy.payload.maximumOldestAgeSeconds) { pressureActive = true; reason = 'OLDEST_AGE'; }
  else if (predecessor?.payload.pressureActive && input.backlogCount > input.policy.payload.backlogLowWatermark) { pressureActive = true; reason = predecessor.payload.reason === 'OLDEST_AGE' ? 'OLDEST_AGE' : 'HIGH_WATERMARK'; }
  else if (predecessor?.payload.pressureActive) { pressureActive = false; reason = 'HYSTERESIS_CLEAR'; }
  else { pressureActive = false; reason = 'NORMAL'; }
  const material = {
    version: '33.52' as const,
    persistencePlaneId: input.policy.payload.persistencePlaneId,
    policyDigest: input.policy.payload.policyDigest,
    sequence: input.sequence,
    predecessorSnapshotDigest: predecessor?.payload.snapshotDigest ?? null,
    backlogCount: input.backlogCount,
    oldestAgeSeconds: input.oldestAgeSeconds,
    pressureActive,
    reason,
    recordedAt: input.recordedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, snapshotDigest: sha256(material) }, input.signer);
}

export function commitQueueOperationV33_52(input: {
  signer: SigningIdentity;
  replaySigner: SigningIdentity;
  policy: SignedEnvelope<PersistencePolicyPayloadV33_52>;
  lease: SignedEnvelope<WorkerLeasePayloadV33_52>;
  priorEntries: readonly SignedEnvelope<QueueJournalEntryPayloadV33_52>[];
  latestPressureSnapshot: SignedEnvelope<BacklogPressureSnapshotPayloadV33_52> | null;
  roleSlot: string;
  operationType: QueueOperationTypeV33_52;
  operationId: string;
  idempotencyKey: string;
  request: unknown;
  payload: unknown;
  executionClass: PersistenceExecutionClassV33_52;
  committedAt: Date;
  trust: EvidenceIntakePersistenceTrustV33_52;
}): { readonly entry: SignedEnvelope<QueueJournalEntryPayloadV33_52> | null; readonly replay: SignedEnvelope<IdempotentReplayReceiptPayloadV33_52> | null } {
  assertOperationId(input.operationId, 'operation_id');
  assertOperationId(input.idempotencyKey, 'idempotency_key');
  verifyEnvelope(input.lease, input.trust.leaseRegistry, input.trust.trustedLeaseSignerIds, input.committedAt, 'lease_signature');
  assertDigest(input.lease.payload as unknown as Record<string, unknown>, 'leaseDigest', 'lease_digest');
  if (input.lease.payload.policyDigest !== input.policy.payload.policyDigest || input.committedAt.getTime() > parseTime(input.lease.payload.expiresAt, 'lease_expiry')) throw new Error('lease_inactive');
  if (!input.lease.payload.allowedOperations.includes(input.operationType)) throw new Error('lease_operation_forbidden');
  if (input.latestPressureSnapshot?.payload.pressureActive && input.operationType === 'ENQUEUE') throw new Error('backpressure_reject_enqueue');
  const requestDigest = sha256(input.request);
  const prior = input.priorEntries.find((entry) => entry.payload.idempotencyKey === input.idempotencyKey);
  if (prior) {
    if (prior.payload.requestDigest !== requestDigest) throw new Error('idempotency_conflict');
    const material = {
      version: '33.52' as const,
      persistencePlaneId: input.policy.payload.persistencePlaneId,
      policyDigest: input.policy.payload.policyDigest,
      idempotencyKey: input.idempotencyKey,
      requestDigest,
      originalOperationId: prior.payload.operationId,
      originalEntryDigest: prior.payload.entryDigest,
      replayedAt: input.committedAt.toISOString(),
      journalEntryCreated: false as const,
      productionAuthority: 'NONE' as const,
      externalEffectsExecuted: 0 as const,
    };
    return { entry: null, replay: signEnvelope({ ...material, replayDigest: sha256(material) }, input.replaySigner) };
  }
  if (input.priorEntries.some((entry) => entry.payload.operationId === input.operationId)) throw new Error('operation_id_duplicate');
  const predecessor = input.priorEntries.at(-1) ?? null;
  const material = {
    version: '33.52' as const,
    persistencePlaneId: input.policy.payload.persistencePlaneId,
    policyDigest: input.policy.payload.policyDigest,
    sequence: input.priorEntries.length + 1,
    predecessorEntryDigest: predecessor?.payload.entryDigest ?? null,
    queueId: input.lease.payload.queueId,
    roleSlot: input.roleSlot,
    operationType: input.operationType,
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    requestDigest,
    payloadDigest: sha256(input.payload),
    workerLeaseDigest: input.lease.payload.leaseDigest,
    leaseTerm: input.lease.payload.term,
    fenceSequence: input.lease.payload.fenceSequence,
    executionClass: input.executionClass,
    committedAt: input.committedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { entry: signEnvelope({ ...material, entryDigest: sha256(material) }, input.signer), replay: null };
}

export function createJournalReplicaReceiptV33_52(input: {
  signer: SigningIdentity;
  policy: SignedEnvelope<PersistencePolicyPayloadV33_52>;
  replica: OperationsActorV33_51;
  entries: readonly SignedEnvelope<QueueJournalEntryPayloadV33_52>[];
  exactBytes: Uint8Array;
  readBackBytes: Uint8Array;
  durableAt: Date;
}): SignedEnvelope<JournalReplicaReceiptPayloadV33_52> {
  assertActor(input.replica, 'replica_actor');
  if (input.entries.length === 0 || input.exactBytes.byteLength === 0) throw new Error('replica_input');
  const exactBytesDigest = sha256Bytes(input.exactBytes);
  const readBackDigest = sha256Bytes(input.readBackBytes);
  if (exactBytesDigest !== readBackDigest || input.exactBytes.byteLength !== input.readBackBytes.byteLength) throw new Error('replica_readback');
  const material = {
    version: '33.52' as const,
    persistencePlaneId: input.policy.payload.persistencePlaneId,
    policyDigest: input.policy.payload.policyDigest,
    replica: input.replica,
    journalEntryCount: input.entries.length,
    journalHeadDigest: input.entries.at(-1)!.payload.entryDigest,
    exactBytesDigest,
    exactByteLength: input.exactBytes.byteLength,
    fileFsync: true as const,
    directoryFsync: true as const,
    readBackDigest,
    durableAt: input.durableAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, receiptDigest: sha256(material) }, input.signer);
}

export function createCrashRecoveryReceiptV33_52(input: {
  signer: SigningIdentity;
  policy: SignedEnvelope<PersistencePolicyPayloadV33_52>;
  crashPoint: CrashPointV33_52;
  crashedLease: SignedEnvelope<WorkerLeasePayloadV33_52>;
  recoveredLease: SignedEnvelope<WorkerLeasePayloadV33_52>;
  preCrashEntries: readonly SignedEnvelope<QueueJournalEntryPayloadV33_52>[];
  recoveredEntries: readonly SignedEnvelope<QueueJournalEntryPayloadV33_52>[];
  replayedOperationIds: readonly string[];
  recoveredAt: Date;
}): SignedEnvelope<CrashRecoveryReceiptPayloadV33_52> {
  if (input.preCrashEntries.length === 0 || input.recoveredEntries.length < input.preCrashEntries.length) throw new Error('recovery_entries');
  if (input.recoveredLease.payload.term !== input.crashedLease.payload.term + 1 || input.recoveredLease.payload.fenceSequence !== input.crashedLease.payload.fenceSequence + 1) throw new Error('recovery_lease');
  for (let index = 0; index < input.preCrashEntries.length; index += 1) {
    if (input.preCrashEntries[index]!.payload.entryDigest !== input.recoveredEntries[index]!.payload.entryDigest) throw new Error('recovery_fork');
  }
  if (new Set(input.replayedOperationIds).size !== input.replayedOperationIds.length) throw new Error('recovery_replay_duplicate');
  const known = new Set(input.recoveredEntries.map((entry) => entry.payload.operationId));
  if (input.replayedOperationIds.some((id) => !known.has(id))) throw new Error('recovery_replay_unknown');
  const material = {
    version: '33.52' as const,
    persistencePlaneId: input.policy.payload.persistencePlaneId,
    policyDigest: input.policy.payload.policyDigest,
    crashPoint: input.crashPoint,
    crashedWorkerLeaseDigest: input.crashedLease.payload.leaseDigest,
    recoveredWorkerLeaseDigest: input.recoveredLease.payload.leaseDigest,
    preCrashJournalHeadDigest: input.preCrashEntries.at(-1)!.payload.entryDigest,
    recoveredJournalHeadDigest: input.recoveredEntries.at(-1)!.payload.entryDigest,
    recoveredEntryCount: input.recoveredEntries.length,
    replayedOperationIds: [...input.replayedOperationIds].sort(),
    sequenceReset: false as const,
    forkDetected: false as const,
    recoveredAt: input.recoveredAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, recoveryDigest: sha256(material) }, input.signer);
}

export function replayOperationsJournalV33_52(input: {
  signer: SigningIdentity;
  policy: SignedEnvelope<PersistencePolicyPayloadV33_52>;
  baseReadinessCertificate: SignedEnvelope<ExternalReadinessCertificatePayloadV33_51>;
  entries: readonly SignedEnvelope<QueueJournalEntryPayloadV33_52>[];
  leases: readonly SignedEnvelope<WorkerLeasePayloadV33_52>[];
  expiryWitnesses: readonly SignedEnvelope<LeaseExpiryWitnessPayloadV33_52>[];
  replayReceipts: readonly SignedEnvelope<IdempotentReplayReceiptPayloadV33_52>[];
  pressureSnapshots: readonly SignedEnvelope<BacklogPressureSnapshotPayloadV33_52>[];
  replicaReceipts: readonly SignedEnvelope<JournalReplicaReceiptPayloadV33_52>[];
  recoveryReceipts: readonly SignedEnvelope<CrashRecoveryReceiptPayloadV33_52>[];
  trust: EvidenceIntakePersistenceTrustV33_52;
  decidedAt: Date;
}): SignedEnvelope<AuditReplayVerdictPayloadV33_52> {
  verifyEnvelope(input.policy, input.trust.policyRegistry, input.trust.trustedPolicySignerIds, input.decidedAt, 'audit_policy_signature');
  assertDigest(input.policy.payload as unknown as Record<string, unknown>, 'policyDigest', 'audit_policy_digest');
  if (input.decidedAt.getTime() > parseTime(input.policy.payload.expiresAt, 'audit_policy_expiry')) throw new Error('audit_policy_expired');
  verifyEnvelope(input.baseReadinessCertificate, input.trust.baseReadinessRegistry, input.trust.trustedBaseReadinessSignerIds, input.decidedAt, 'base_readiness_signature');
  assertDigest(input.baseReadinessCertificate.payload as unknown as Record<string, unknown>, 'certificateDigest', 'base_readiness_digest');
  if (input.baseReadinessCertificate.payload.certificateDigest !== input.policy.payload.baseReadinessCertificateDigest) throw new Error('audit_base_binding');
  if (input.entries.length === 0) throw new Error('audit_empty_journal');
  const leaseByDigest = new Map<string, SignedEnvelope<WorkerLeasePayloadV33_52>>();
  for (const lease of input.leases) {
    verifyEnvelope(lease, input.trust.leaseRegistry, input.trust.trustedLeaseSignerIds, input.decidedAt, 'audit_lease_signature');
    assertDigest(lease.payload as unknown as Record<string, unknown>, 'leaseDigest', 'audit_lease_digest');
    if (lease.payload.policyDigest !== input.policy.payload.policyDigest || leaseByDigest.has(lease.payload.leaseDigest)) throw new Error('audit_lease_binding');
    leaseByDigest.set(lease.payload.leaseDigest, lease);
  }
  const leasesByQueue = new Map<string, SignedEnvelope<WorkerLeasePayloadV33_52>[]>();
  for (const lease of input.leases) {
    const list = leasesByQueue.get(lease.payload.queueId) ?? [];
    list.push(lease);
    leasesByQueue.set(lease.payload.queueId, list);
  }
  for (const list of leasesByQueue.values()) {
    list.sort((a, b) => a.payload.term - b.payload.term);
    for (let index = 0; index < list.length; index += 1) {
      const lease = list[index]!;
      const predecessorLease = index === 0 ? null : list[index - 1]!;
      if (lease.payload.term !== index + 1 || lease.payload.fenceSequence !== index + 1 || lease.payload.predecessorLeaseDigest !== (predecessorLease?.payload.leaseDigest ?? null)) throw new Error('audit_lease_chain');
      if (predecessorLease) {
        if (parseTime(lease.payload.issuedAt, 'audit_lease_issued') <= parseTime(predecessorLease.payload.expiresAt, 'audit_lease_expiry')) throw new Error('audit_lease_takeover_early');
        const witnesses = input.expiryWitnesses.filter((witness) => witness.payload.expiredLeaseDigest === predecessorLease.payload.leaseDigest);
        if (witnesses.length !== input.policy.payload.leaseWitnessQuorum) throw new Error('audit_lease_witness_quorum');
        const actors: OperationsActorV33_51[] = [];
        for (const witness of witnesses) {
          verifyEnvelope(witness, input.trust.witnessRegistry, input.trust.trustedWitnessSignerIds, input.decidedAt, 'audit_witness_signature');
          assertDigest(witness.payload as unknown as Record<string, unknown>, 'witnessDigest', 'audit_witness_digest');
          if (witness.payload.policyDigest !== input.policy.payload.policyDigest || parseTime(witness.payload.observedAt, 'audit_witness_time') <= parseTime(predecessorLease.payload.expiresAt, 'audit_lease_expiry')) throw new Error('audit_witness_binding');
          actors.push(witness.payload.witness);
        }
        distinctActors(actors, 'audit_witness_separation');
      }
    }
  }
  const idempotency = new Map<string, string>();
  const operations = new Set<string>();
  const queues = new Set<string>();
  let predecessor: string | null = null;
  for (let index = 0; index < input.entries.length; index += 1) {
    const entry = input.entries[index]!;
    verifyEnvelope(entry, input.trust.journalRegistry, input.trust.trustedJournalSignerIds, input.decidedAt, 'audit_entry_signature');
    assertDigest(entry.payload as unknown as Record<string, unknown>, 'entryDigest', 'audit_entry_digest');
    if (entry.payload.sequence !== index + 1 || entry.payload.predecessorEntryDigest !== predecessor || entry.payload.policyDigest !== input.policy.payload.policyDigest) throw new Error('audit_journal_chain');
    const lease = leaseByDigest.get(entry.payload.workerLeaseDigest);
    if (!lease || lease.payload.queueId !== entry.payload.queueId || lease.payload.term !== entry.payload.leaseTerm || lease.payload.fenceSequence !== entry.payload.fenceSequence || !lease.payload.allowedOperations.includes(entry.payload.operationType)) throw new Error('audit_worker_fence');
    if (parseTime(entry.payload.committedAt, 'audit_entry_time') < parseTime(lease.payload.issuedAt, 'audit_lease_start') || parseTime(entry.payload.committedAt, 'audit_entry_time') > parseTime(lease.payload.expiresAt, 'audit_lease_end')) throw new Error('audit_lease_window');
    const priorRequest = idempotency.get(entry.payload.idempotencyKey);
    if (priorRequest && priorRequest !== entry.payload.requestDigest) throw new Error('audit_idempotency_conflict');
    if (priorRequest || operations.has(entry.payload.operationId)) throw new Error('audit_duplicate_operation');
    idempotency.set(entry.payload.idempotencyKey, entry.payload.requestDigest);
    operations.add(entry.payload.operationId);
    queues.add(entry.payload.queueId);
    predecessor = entry.payload.entryDigest;
  }
  for (const replay of input.replayReceipts) {
    verifyEnvelope(replay, input.trust.replayRegistry, input.trust.trustedReplaySignerIds, input.decidedAt, 'audit_replay_signature');
    assertDigest(replay.payload as unknown as Record<string, unknown>, 'replayDigest', 'audit_replay_digest');
    const original = input.entries.find((entry) => entry.payload.entryDigest === replay.payload.originalEntryDigest);
    if (!original || original.payload.idempotencyKey !== replay.payload.idempotencyKey || original.payload.requestDigest !== replay.payload.requestDigest || replay.payload.journalEntryCreated !== false) throw new Error('audit_replay_binding');
  }
  let pressurePredecessor: string | null = null;
  for (let index = 0; index < input.pressureSnapshots.length; index += 1) {
    const snapshot = input.pressureSnapshots[index]!;
    verifyEnvelope(snapshot, input.trust.pressureRegistry, input.trust.trustedPressureSignerIds, input.decidedAt, 'audit_pressure_signature');
    assertDigest(snapshot.payload as unknown as Record<string, unknown>, 'snapshotDigest', 'audit_pressure_digest');
    if (snapshot.payload.sequence !== index + 1 || snapshot.payload.predecessorSnapshotDigest !== pressurePredecessor || snapshot.payload.policyDigest !== input.policy.payload.policyDigest) throw new Error('audit_pressure_chain');
    const prior = index === 0 ? null : input.pressureSnapshots[index - 1]!;
    let expectedActive: boolean;
    let expectedReason: BacklogPressureSnapshotPayloadV33_52['reason'];
    if (snapshot.payload.backlogCount >= input.policy.payload.backlogHighWatermark) { expectedActive = true; expectedReason = 'HIGH_WATERMARK'; }
    else if (snapshot.payload.oldestAgeSeconds >= input.policy.payload.maximumOldestAgeSeconds) { expectedActive = true; expectedReason = 'OLDEST_AGE'; }
    else if (prior?.payload.pressureActive && snapshot.payload.backlogCount > input.policy.payload.backlogLowWatermark) { expectedActive = true; expectedReason = prior.payload.reason === 'OLDEST_AGE' ? 'OLDEST_AGE' : 'HIGH_WATERMARK'; }
    else if (prior?.payload.pressureActive) { expectedActive = false; expectedReason = 'HYSTERESIS_CLEAR'; }
    else { expectedActive = false; expectedReason = 'NORMAL'; }
    if (snapshot.payload.pressureActive !== expectedActive || snapshot.payload.reason !== expectedReason) throw new Error('audit_pressure_recompute');
    pressurePredecessor = snapshot.payload.snapshotDigest;
  }
  if (input.pressureSnapshots.length < input.policy.payload.requiredPressureSnapshots) throw new Error('audit_pressure_count');
  if (input.replicaReceipts.length !== input.policy.payload.requiredReplicaCount) throw new Error('audit_replica_count');
  const replicaActors: OperationsActorV33_51[] = [];
  const head = input.entries.at(-1)!.payload.entryDigest;
  const replicaBytes = new Set<string>();
  for (const receipt of input.replicaReceipts) {
    verifyEnvelope(receipt, input.trust.replicaRegistry, input.trust.trustedReplicaSignerIds, input.decidedAt, 'audit_replica_signature');
    assertDigest(receipt.payload as unknown as Record<string, unknown>, 'receiptDigest', 'audit_replica_digest');
    if (receipt.payload.journalHeadDigest !== head || receipt.payload.journalEntryCount !== input.entries.length || receipt.payload.exactBytesDigest !== receipt.payload.readBackDigest || !receipt.payload.fileFsync || !receipt.payload.directoryFsync) throw new Error('audit_replica_binding');
    replicaActors.push(receipt.payload.replica);
    replicaBytes.add(receipt.payload.exactBytesDigest);
  }
  distinctActors(replicaActors, 'audit_replica_separation');
  if (replicaBytes.size !== 1) throw new Error('audit_replica_bytes');
  for (const recovery of input.recoveryReceipts) {
    verifyEnvelope(recovery, input.trust.recoveryRegistry, input.trust.trustedRecoverySignerIds, input.decidedAt, 'audit_recovery_signature');
    assertDigest(recovery.payload as unknown as Record<string, unknown>, 'recoveryDigest', 'audit_recovery_digest');
    const crashedLease = leaseByDigest.get(recovery.payload.crashedWorkerLeaseDigest);
    const recoveredLease = leaseByDigest.get(recovery.payload.recoveredWorkerLeaseDigest);
    if (recovery.payload.policyDigest !== input.policy.payload.policyDigest || recovery.payload.sequenceReset || recovery.payload.forkDetected || recovery.payload.recoveredJournalHeadDigest !== head || !crashedLease || !recoveredLease || recoveredLease.payload.term !== crashedLease.payload.term + 1 || recoveredLease.payload.fenceSequence !== crashedLease.payload.fenceSequence + 1) throw new Error('audit_recovery_binding');
  }
  const replayState = {
    queueIds: [...queues].sort(),
    operations: input.entries.map((entry) => ({ sequence: entry.payload.sequence, queueId: entry.payload.queueId, roleSlot: entry.payload.roleSlot, operationType: entry.payload.operationType, operationId: entry.payload.operationId, entryDigest: entry.payload.entryDigest })),
    pressureHead: input.pressureSnapshots.at(-1)!.payload.snapshotDigest,
    replicaBytesDigest: [...replicaBytes][0],
    recoveryDigests: input.recoveryReceipts.map((receipt) => receipt.payload.recoveryDigest).sort(),
  };
  const material = {
    version: '33.52' as const,
    persistencePlaneId: input.policy.payload.persistencePlaneId,
    policyDigest: input.policy.payload.policyDigest,
    baseReadinessCertificateDigest: input.baseReadinessCertificate.payload.certificateDigest,
    journalEntryCount: input.entries.length,
    journalHeadDigest: head,
    queueCount: queues.size,
    operationCount: operations.size,
    idempotencyKeyCount: idempotency.size,
    pressureSnapshotCount: input.pressureSnapshots.length,
    replicaReceiptCount: 3 as const,
    recoveryReceiptCount: input.recoveryReceipts.length,
    replayStateDigest: sha256(replayState),
    journalChainVerified: true as const,
    workerFencingVerified: true as const,
    idempotencyVerified: true as const,
    backlogControlsVerified: true as const,
    replicaDurabilityVerified: true as const,
    crashRecoveryVerified: true as const,
    status: 'LOCAL_OPERATIONS_PERSISTENCE_REHEARSAL_ONLY' as const,
    externalTopologyObserved: false as const,
    externalHumanParticipants: 0 as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
    decidedAt: input.decidedAt.toISOString(),
  };
  return signEnvelope({ ...material, verdictDigest: sha256(material) }, input.signer);
}

export function verifyAuditReplayVerdictV33_52(input: {
  verdict: SignedEnvelope<AuditReplayVerdictPayloadV33_52>;
  recomputed: SignedEnvelope<AuditReplayVerdictPayloadV33_52>;
  trust: EvidenceIntakePersistenceTrustV33_52;
  verifiedAt: Date;
}): AuditReplayVerdictPayloadV33_52 {
  verifyEnvelope(input.verdict, input.trust.auditRegistry, input.trust.trustedAuditSignerIds, input.verifiedAt, 'audit_verdict_signature');
  assertDigest(input.verdict.payload as unknown as Record<string, unknown>, 'verdictDigest', 'audit_verdict_digest');
  if (input.verdict.payload.verdictDigest !== input.recomputed.payload.verdictDigest || sha256(input.verdict.payload) !== sha256(input.recomputed.payload)) throw new Error('audit_verdict_recompute');
  if (input.verdict.payload.status !== 'LOCAL_OPERATIONS_PERSISTENCE_REHEARSAL_ONLY' || input.verdict.payload.externalTopologyObserved || input.verdict.payload.productionAuthority !== 'NONE' || input.verdict.payload.externalEffectsExecuted !== 0 || input.verdict.payload.externalHumanParticipants !== 0) throw new Error('audit_truth_boundary');
  return input.verdict.payload;
}
