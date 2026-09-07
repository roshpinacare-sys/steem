import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import {
  KeyRegistry,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';
import {
  PersistentAdaptivePolicyControllerV33_16,
  type DriftObservationV33_16,
  type DriftSweepReportV33_16,
} from './persistent-adaptive-policy-controller-v33_16.js';

export interface AdaptiveControlLeaseV33_17 {
  readonly version: '33.17';
  readonly serviceId: string;
  readonly ownerId: string;
  readonly fenceToken: number;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly leaseDigest: string;
}

export interface AdaptiveControlScheduleV33_17 {
  readonly version: '33.17';
  readonly scheduleId: string;
  readonly serviceId: string;
  readonly tenantId: string;
  readonly jobType: 'ADAPTIVE_DRIFT_SWEEP';
  readonly cadenceMs: number;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly maximumObservationCount: number;
  readonly externalEffectsExecuted: 0;
  readonly scheduleDigest: string;
}

export interface AdaptiveCycleRecoveryReceiptV33_17 {
  readonly version: '33.17';
  readonly recoveryId: string;
  readonly serviceId: string;
  readonly cycleId: string;
  readonly recoveredFromFenceToken: number;
  readonly recoveredByFenceToken: number;
  readonly recoveredByOwnerId: string;
  readonly reason: 'PRIOR_OWNER_LEASE_EXPIRED_AFTER_CYCLE_START';
  readonly recoveredAt: string;
  readonly externalEffectsExecuted: 0;
  readonly recoveryDigest: string;
}

export interface AdaptiveControlCycleReceiptV33_17 {
  readonly version: '33.17';
  readonly receiptId: string;
  readonly serviceId: string;
  readonly cycleId: string;
  readonly scheduleId: string;
  readonly scheduleDigest: string;
  readonly tenantId: string;
  readonly slot: number;
  readonly ownerId: string;
  readonly fenceToken: number;
  readonly inputDigest: string;
  readonly sweepReportDigest: string;
  readonly evaluatedRecordCount: number;
  readonly revokedRecordIds: readonly string[];
  readonly expiredRecordIds: readonly string[];
  readonly fallbackRoute: 'FULL_GOVERNED_WORKFLOW';
  readonly recovered: boolean;
  readonly completedAt: string;
  readonly authorityExpanded: false;
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface AdaptiveControlCycleRecordV33_17 {
  readonly version: '33.17';
  readonly cycleId: string;
  readonly serviceId: string;
  readonly scheduleId: string;
  readonly scheduleDigest: string;
  readonly tenantId: string;
  readonly slot: number;
  readonly inputDigest: string;
  readonly status: 'STARTED' | 'COMPLETED';
  readonly attempts: number;
  readonly startedByOwnerId: string;
  readonly startedFenceToken: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly recovery?: SignedEnvelope<AdaptiveCycleRecoveryReceiptV33_17>;
  readonly receipt?: SignedEnvelope<AdaptiveControlCycleReceiptV33_17>;
  readonly externalEffectsExecuted: 0;
  readonly cycleDigest: string;
}

export interface AdaptiveControlEventV33_17 {
  readonly version: '33.17';
  readonly eventId: string;
  readonly sequence: number;
  readonly eventType:
    | 'LEASE_ACQUIRED'
    | 'LEASE_RENEWED'
    | 'LEASE_RELEASED'
    | 'SCHEDULE_REGISTERED'
    | 'CYCLE_STARTED'
    | 'CYCLE_RECOVERED'
    | 'CYCLE_COMPLETED';
  readonly serviceId: string;
  readonly ownerId?: string;
  readonly cycleId?: string;
  readonly payloadDigest: string;
  readonly occurredAt: string;
  readonly previousEventDigest: string;
  readonly externalEffectsExecuted: 0;
  readonly eventDigest: string;
}

export interface AdaptiveControlSnapshotV33_17 {
  readonly version: '33.17';
  readonly serviceId: string;
  readonly fenceCounter: number;
  readonly lease?: AdaptiveControlLeaseV33_17;
  readonly schedules: readonly SignedEnvelope<AdaptiveControlScheduleV33_17>[];
  readonly cycles: readonly AdaptiveControlCycleRecordV33_17[];
  readonly events: readonly AdaptiveControlEventV33_17[];
  readonly lastObservedAt: string;
  readonly generatedAt: string;
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export interface AdaptiveControlTrustV33_17 {
  readonly scheduleRegistry: KeyRegistry;
  readonly trustedSchedulerSignerIds: readonly string[];
  readonly serviceRegistry: KeyRegistry;
  readonly trustedServiceSignerIds: readonly string[];
  readonly recoveryRegistry: KeyRegistry;
  readonly trustedRecoverySignerIds: readonly string[];
}

export interface AdaptiveControlCycleInputV33_17 {
  readonly cycleId: string;
  readonly tenantId: string;
  readonly observations: readonly DriftObservationV33_16[];
}

export class ContinuousAdaptiveControlStoreV33_17 {
  readonly #path: string;
  readonly #lockPath: string;
  readonly #serviceId: string;
  readonly #storeIdentity: SigningIdentity;
  readonly #storeRegistry: KeyRegistry;
  readonly #trustedStoreSignerIds: readonly string[];
  readonly #trust: AdaptiveControlTrustV33_17;
  #snapshot: AdaptiveControlSnapshotV33_17;

  constructor(input: {
    readonly path: string;
    readonly serviceId: string;
    readonly storeIdentity: SigningIdentity;
    readonly storeRegistry: KeyRegistry;
    readonly trustedStoreSignerIds: readonly string[];
    readonly trust: AdaptiveControlTrustV33_17;
    readonly now?: Date;
  }) {
    this.#path = resolve(nonEmpty(input.path, 'control_store_path_required'));
    this.#lockPath = `${this.#path}.lock`;
    this.#serviceId = nonEmpty(input.serviceId, 'service_id_required');
    this.#storeIdentity = input.storeIdentity;
    this.#storeRegistry = input.storeRegistry;
    this.#trustedStoreSignerIds = unique(input.trustedStoreSignerIds, 'duplicate_store_signer');
    this.#trust = input.trust;
    if ([...input.trust.trustedSchedulerSignerIds, ...input.trust.trustedServiceSignerIds, ...input.trust.trustedRecoverySignerIds].includes(input.storeIdentity.keyId)) throw new Error('control_store_role_separation_required');
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    const now = input.now ?? new Date();
    this.#snapshot = existsSync(this.#path) ? this.#read(now) : createSnapshot(this.#serviceId, 0, undefined, [], [], [], now, now);
    if (!existsSync(this.#path)) this.#persist(now);
  }

  snapshot(): AdaptiveControlSnapshotV33_17 { return structuredClone(this.#snapshot); }

  acquireLease(ownerId: string, ttlMs: number, now = new Date()): AdaptiveControlLeaseV33_17 {
    ownerId = nonEmpty(ownerId, 'lease_owner_required');
    positiveInteger(ttlMs, 'lease_ttl_invalid');
    return this.#mutate((snapshot) => {
      const active = snapshot.lease !== undefined && Date.parse(snapshot.lease.expiresAt) > now.getTime();
      if (active) throw new Error(snapshot.lease!.ownerId === ownerId ? 'lease_already_held' : 'lease_busy');
      const fenceToken = snapshot.fenceCounter + 1;
      const lease = createLease(this.#serviceId, ownerId, fenceToken, ttlMs, now);
      const event = appendEvent(snapshot.events, 'LEASE_ACQUIRED', this.#serviceId, lease.leaseDigest, now, { ownerId });
      return { snapshot: createSnapshot(this.#serviceId, fenceToken, lease, snapshot.schedules, snapshot.cycles, [...snapshot.events, event], now, now), value: lease };
    }, now);
  }

  renewLease(lease: AdaptiveControlLeaseV33_17, ttlMs: number, now = new Date()): AdaptiveControlLeaseV33_17 {
    positiveInteger(ttlMs, 'lease_ttl_invalid');
    return this.#mutate((snapshot) => {
      assertLease(snapshot, lease, now);
      const renewed = createLease(this.#serviceId, lease.ownerId, lease.fenceToken, ttlMs, now);
      const event = appendEvent(snapshot.events, 'LEASE_RENEWED', this.#serviceId, renewed.leaseDigest, now, { ownerId: lease.ownerId });
      return { snapshot: createSnapshot(this.#serviceId, snapshot.fenceCounter, renewed, snapshot.schedules, snapshot.cycles, [...snapshot.events, event], now, now), value: renewed };
    }, now);
  }

  releaseLease(lease: AdaptiveControlLeaseV33_17, now = new Date()): void {
    this.#mutate((snapshot) => {
      assertLease(snapshot, lease, now);
      const event = appendEvent(snapshot.events, 'LEASE_RELEASED', this.#serviceId, lease.leaseDigest, now, { ownerId: lease.ownerId });
      return { snapshot: createSnapshot(this.#serviceId, snapshot.fenceCounter, undefined, snapshot.schedules, snapshot.cycles, [...snapshot.events, event], now, now), value: undefined };
    }, now);
  }

  registerSchedule(envelope: SignedEnvelope<AdaptiveControlScheduleV33_17>, now = new Date()): SignedEnvelope<AdaptiveControlScheduleV33_17> {
    verifySchedule(envelope, this.#serviceId, this.#trust, now);
    return this.#mutate((snapshot) => {
      const prior = snapshot.schedules.find((item) => item.payload.scheduleId === envelope.payload.scheduleId);
      if (prior !== undefined) {
        if (sha256(prior) !== sha256(envelope)) throw new Error('schedule_id_conflict');
        return { snapshot, value: prior };
      }
      const event = appendEvent(snapshot.events, 'SCHEDULE_REGISTERED', this.#serviceId, envelope.payload.scheduleDigest, now);
      return { snapshot: createSnapshot(this.#serviceId, snapshot.fenceCounter, snapshot.lease, [...snapshot.schedules, envelope].sort(bySchedule), snapshot.cycles, [...snapshot.events, event], now, now), value: envelope };
    }, now);
  }

  startCycle(input: {
    readonly lease: AdaptiveControlLeaseV33_17;
    readonly schedule: SignedEnvelope<AdaptiveControlScheduleV33_17>;
    readonly cycle: AdaptiveControlCycleInputV33_17;
    readonly inputDigest: string;
    readonly slot: number;
    readonly recovery?: SignedEnvelope<AdaptiveCycleRecoveryReceiptV33_17>;
    readonly now?: Date;
  }): { readonly mode: 'STARTED' | 'RESUMED' | 'COMPLETED_RETRY'; readonly record: AdaptiveControlCycleRecordV33_17 } {
    const now = input.now ?? new Date();
    verifySchedule(input.schedule, this.#serviceId, this.#trust, now);
    digest(input.inputDigest, 'cycle_input_digest_invalid');
    return this.#mutate<{ readonly mode: 'STARTED' | 'RESUMED' | 'COMPLETED_RETRY'; readonly record: AdaptiveControlCycleRecordV33_17 }>((snapshot) => {
      assertLease(snapshot, input.lease, now);
      const prior = snapshot.cycles.find((item) => item.cycleId === input.cycle.cycleId);
      if (prior !== undefined && prior.inputDigest !== input.inputDigest) throw new Error('cycle_id_payload_conflict');
      const occupied = snapshot.cycles.find((item) => item.scheduleDigest === input.schedule.payload.scheduleDigest && item.slot === input.slot && item.cycleId !== input.cycle.cycleId);
      if (occupied !== undefined) throw new Error('schedule_slot_already_claimed');
      if (prior?.status === 'COMPLETED') return { snapshot, value: { mode: 'COMPLETED_RETRY' as const, record: prior } };
      let mode: 'STARTED' | 'RESUMED' = 'STARTED';
      let recovery = input.recovery;
      let attempts = 1;
      if (prior !== undefined) {
        if (input.lease.fenceToken <= prior.startedFenceToken) throw new Error('cycle_in_progress_under_current_fence');
        if (recovery === undefined) throw new Error('cycle_recovery_receipt_required');
        verifyRecovery(recovery, prior, input.lease, this.#trust, now);
        attempts = prior.attempts + 1;
        mode = 'RESUMED';
      } else if (recovery !== undefined) throw new Error('unexpected_cycle_recovery_receipt');
      const record = createCycleRecord({
        cycleId: input.cycle.cycleId,
        serviceId: this.#serviceId,
        scheduleId: input.schedule.payload.scheduleId,
        scheduleDigest: input.schedule.payload.scheduleDigest,
        tenantId: input.cycle.tenantId,
        slot: input.slot,
        inputDigest: input.inputDigest,
        status: 'STARTED',
        attempts,
        startedByOwnerId: input.lease.ownerId,
        startedFenceToken: input.lease.fenceToken,
        startedAt: prior?.startedAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
        ...(recovery === undefined ? {} : { recovery }),
      });
      const eventType: AdaptiveControlEventV33_17['eventType'] = mode === 'RESUMED' ? 'CYCLE_RECOVERED' : 'CYCLE_STARTED';
      const event = appendEvent(snapshot.events, eventType, this.#serviceId, record.cycleDigest, now, { ownerId: input.lease.ownerId, cycleId: record.cycleId });
      const cycles = snapshot.cycles.filter((item) => item.cycleId !== record.cycleId).concat(record).sort(byCycle);
      return { snapshot: createSnapshot(this.#serviceId, snapshot.fenceCounter, snapshot.lease, snapshot.schedules, cycles, [...snapshot.events, event], now, now), value: { mode, record } };
    }, now);
  }

  completeCycle(input: {
    readonly lease: AdaptiveControlLeaseV33_17;
    readonly cycleId: string;
    readonly inputDigest: string;
    readonly receipt: SignedEnvelope<AdaptiveControlCycleReceiptV33_17>;
    readonly now?: Date;
  }): AdaptiveControlCycleRecordV33_17 {
    const now = input.now ?? new Date();
    return this.#mutate((snapshot) => {
      assertLease(snapshot, input.lease, now);
      const prior = snapshot.cycles.find((item) => item.cycleId === input.cycleId);
      if (prior === undefined || prior.status !== 'STARTED') throw new Error('cycle_not_started');
      if (prior.inputDigest !== input.inputDigest || prior.startedFenceToken !== input.lease.fenceToken || prior.startedByOwnerId !== input.lease.ownerId) throw new Error('cycle_fence_binding_invalid');
      verifyCycleReceipt(input.receipt, prior, input.lease, this.#trust, now);
      const completed = createCycleRecord({
        cycleId: prior.cycleId,
        serviceId: prior.serviceId,
        scheduleId: prior.scheduleId,
        scheduleDigest: prior.scheduleDigest,
        tenantId: prior.tenantId,
        slot: prior.slot,
        inputDigest: prior.inputDigest,
        status: 'COMPLETED',
        attempts: prior.attempts,
        startedByOwnerId: prior.startedByOwnerId,
        startedFenceToken: prior.startedFenceToken,
        startedAt: prior.startedAt,
        updatedAt: now.toISOString(),
        ...(prior.recovery === undefined ? {} : { recovery: prior.recovery }),
        receipt: input.receipt,
      });
      const event = appendEvent(snapshot.events, 'CYCLE_COMPLETED', this.#serviceId, completed.cycleDigest, now, { ownerId: input.lease.ownerId, cycleId: completed.cycleId });
      const cycles = snapshot.cycles.filter((item) => item.cycleId !== completed.cycleId).concat(completed).sort(byCycle);
      return { snapshot: createSnapshot(this.#serviceId, snapshot.fenceCounter, snapshot.lease, snapshot.schedules, cycles, [...snapshot.events, event], now, now), value: completed };
    }, now);
  }

  getCycle(cycleId: string): AdaptiveControlCycleRecordV33_17 {
    const row = this.#snapshot.cycles.find((item) => item.cycleId === cycleId);
    if (row === undefined) throw new Error('cycle_not_found');
    return structuredClone(row);
  }

  assertLease(lease: AdaptiveControlLeaseV33_17, now = new Date()): void { assertLease(this.#snapshot, lease, now); }

  #read(now: Date): AdaptiveControlSnapshotV33_17 {
    let envelope: SignedEnvelope<AdaptiveControlSnapshotV33_17>;
    try { envelope = JSON.parse(readFileSync(this.#path, 'utf8')) as SignedEnvelope<AdaptiveControlSnapshotV33_17>; }
    catch { throw new Error('control_store_parse_invalid'); }
    if (!this.#trustedStoreSignerIds.includes(envelope.issuerKeyId) || !this.#storeRegistry.verifyAt(envelope, envelope.payload.generatedAt)) throw new Error('control_store_signature_invalid');
    verifySnapshot(envelope.payload, this.#serviceId, this.#trust, now);
    return structuredClone(envelope.payload);
  }

  #mutate<T>(fn: (snapshot: AdaptiveControlSnapshotV33_17) => { snapshot: AdaptiveControlSnapshotV33_17; value: T }, now: Date): T {
    const lock = acquireLock(this.#lockPath);
    try {
      if (existsSync(this.#path)) this.#snapshot = this.#read(now);
      assertClock(this.#snapshot, now);
      const result = fn(structuredClone(this.#snapshot));
      verifySnapshot(result.snapshot, this.#serviceId, this.#trust, now);
      this.#snapshot = result.snapshot;
      this.#persist(now);
      return structuredClone(result.value);
    } finally { releaseLock(lock, this.#lockPath); }
  }

  #persist(now: Date): void {
    this.#snapshot = createSnapshot(this.#serviceId, this.#snapshot.fenceCounter, this.#snapshot.lease, this.#snapshot.schedules, this.#snapshot.cycles, this.#snapshot.events, new Date(this.#snapshot.lastObservedAt), now);
    atomicReplace(this.#path, `${JSON.stringify(signEnvelope(this.#snapshot, this.#storeIdentity), null, 2)}\n`);
  }
}

export class ContinuousAdaptiveControlServiceV33_17 {
  readonly #serviceId: string;
  readonly #store: ContinuousAdaptiveControlStoreV33_17;
  readonly #controller: PersistentAdaptivePolicyControllerV33_16;
  readonly #serviceSigner: SigningIdentity;
  readonly #recoverySigner: SigningIdentity;
  readonly #trust: AdaptiveControlTrustV33_17;

  constructor(input: {
    readonly serviceId: string;
    readonly store: ContinuousAdaptiveControlStoreV33_17;
    readonly controller: PersistentAdaptivePolicyControllerV33_16;
    readonly serviceSigner: SigningIdentity;
    readonly recoverySigner: SigningIdentity;
    readonly trust: AdaptiveControlTrustV33_17;
  }) {
    this.#serviceId = nonEmpty(input.serviceId, 'service_id_required');
    if (input.serviceSigner.keyId === input.recoverySigner.keyId) throw new Error('service_recovery_separation_required');
    if (!input.trust.trustedServiceSignerIds.includes(input.serviceSigner.keyId) || !input.trust.trustedRecoverySignerIds.includes(input.recoverySigner.keyId)) throw new Error('service_signer_untrusted');
    this.#store = input.store;
    this.#controller = input.controller;
    this.#serviceSigner = input.serviceSigner;
    this.#recoverySigner = input.recoverySigner;
    this.#trust = input.trust;
  }

  createRecoveryReceipt(input: {
    readonly cycleId: string;
    readonly previousFenceToken: number;
    readonly lease: AdaptiveControlLeaseV33_17;
    readonly now?: Date;
  }): SignedEnvelope<AdaptiveCycleRecoveryReceiptV33_17> {
    const now = input.now ?? new Date();
    if (input.lease.serviceId !== this.#serviceId || input.lease.fenceToken <= input.previousFenceToken) throw new Error('recovery_fence_invalid');
    const material = {
      version: '33.17' as const,
      recoveryId: `adaptive-recovery-${randomUUID()}`,
      serviceId: this.#serviceId,
      cycleId: nonEmpty(input.cycleId, 'cycle_id_required'),
      recoveredFromFenceToken: input.previousFenceToken,
      recoveredByFenceToken: input.lease.fenceToken,
      recoveredByOwnerId: input.lease.ownerId,
      reason: 'PRIOR_OWNER_LEASE_EXPIRED_AFTER_CYCLE_START' as const,
      recoveredAt: now.toISOString(),
      externalEffectsExecuted: 0 as const,
    };
    return signEnvelope({ ...material, recoveryDigest: sha256(material) }, this.#recoverySigner);
  }

  runScheduledCycle(input: {
    readonly lease: AdaptiveControlLeaseV33_17;
    readonly schedule: SignedEnvelope<AdaptiveControlScheduleV33_17>;
    readonly cycle: AdaptiveControlCycleInputV33_17;
    readonly recovery?: SignedEnvelope<AdaptiveCycleRecoveryReceiptV33_17>;
    readonly crashAfterStart?: boolean;
    readonly now?: Date;
  }): SignedEnvelope<AdaptiveControlCycleReceiptV33_17> {
    const now = input.now ?? new Date();
    verifySchedule(input.schedule, this.#serviceId, this.#trust, now);
    if (input.schedule.payload.tenantId !== input.cycle.tenantId) throw new Error('cycle_tenant_schedule_mismatch');
    if (input.cycle.observations.length > input.schedule.payload.maximumObservationCount) throw new Error('cycle_observation_budget_exceeded');
    for (const observation of input.cycle.observations) if (observation.currentBoundary.tenantId !== input.cycle.tenantId) throw new Error('cycle_observation_tenant_mismatch');
    let priorCycle: AdaptiveControlCycleRecordV33_17 | undefined;
    try { priorCycle = this.#store.getCycle(input.cycle.cycleId); } catch (error) { if (!(error instanceof Error) || error.message !== 'cycle_not_found') throw error; }
    const slot = priorCycle?.slot ?? scheduleSlot(input.schedule.payload, now);
    const inputDigest = sha256({ cycleId: input.cycle.cycleId, tenantId: input.cycle.tenantId, scheduleDigest: input.schedule.payload.scheduleDigest, observations: input.cycle.observations });
    const started = this.#store.startCycle({ lease: input.lease, schedule: input.schedule, cycle: input.cycle, inputDigest, slot, ...(input.recovery === undefined ? {} : { recovery: input.recovery }), now });
    if (started.mode === 'COMPLETED_RETRY') {
      if (started.record.receipt === undefined) throw new Error('completed_cycle_receipt_missing');
      return started.record.receipt;
    }
    if (input.crashAfterStart === true) throw new Error('injected_crash_after_cycle_start');
    this.#store.assertLease(input.lease, now);
    const report = this.#controller.sweepDrift({ observations: input.cycle.observations, now });
    this.#store.assertLease(input.lease, now);
    const receipt = createCycleReceipt(this.#serviceId, input.lease, input.schedule.payload, input.cycle, inputDigest, slot, report, started.mode === 'RESUMED', now, this.#serviceSigner);
    const completed = this.#store.completeCycle({ lease: input.lease, cycleId: input.cycle.cycleId, inputDigest, receipt, now });
    if (completed.receipt === undefined) throw new Error('cycle_receipt_missing');
    return completed.receipt;
  }
}

export function issueAdaptiveControlScheduleV33_17(input: {
  readonly serviceId: string;
  readonly scheduleId: string;
  readonly tenantId: string;
  readonly cadenceMs: number;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly maximumObservationCount: number;
  readonly scheduler: SigningIdentity;
}): SignedEnvelope<AdaptiveControlScheduleV33_17> {
  positiveInteger(input.cadenceMs, 'schedule_cadence_invalid');
  positiveInteger(input.maximumObservationCount, 'schedule_observation_limit_invalid');
  const notBefore = instant(input.notBefore, 'schedule_not_before_invalid');
  const expiresAt = instant(input.expiresAt, 'schedule_expiry_invalid');
  if (expiresAt <= notBefore) throw new Error('schedule_window_invalid');
  const material = {
    version: '33.17' as const,
    scheduleId: nonEmpty(input.scheduleId, 'schedule_id_required'),
    serviceId: nonEmpty(input.serviceId, 'service_id_required'),
    tenantId: nonEmpty(input.tenantId, 'tenant_id_required'),
    jobType: 'ADAPTIVE_DRIFT_SWEEP' as const,
    cadenceMs: input.cadenceMs,
    notBefore: new Date(notBefore).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    maximumObservationCount: input.maximumObservationCount,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, scheduleDigest: sha256(material) }, input.scheduler);
}

export function verifyAdaptiveControlCycleReceiptV33_17(input: {
  readonly envelope: SignedEnvelope<AdaptiveControlCycleReceiptV33_17>;
  readonly registry: KeyRegistry;
  readonly trustedSignerIds: readonly string[];
}): boolean {
  const payload = input.envelope.payload;
  if (!input.trustedSignerIds.includes(input.envelope.issuerKeyId) || !input.registry.verifyAt(input.envelope, payload.completedAt)) return false;
  const { receiptDigest, ...material } = payload;
  return payload.version === '33.17' && !payload.authorityExpanded && payload.externalEffectsExecuted === 0 && payload.fallbackRoute === 'FULL_GOVERNED_WORKFLOW' && sha256(material) === receiptDigest;
}

function createLease(serviceId: string, ownerId: string, fenceToken: number, ttlMs: number, now: Date): AdaptiveControlLeaseV33_17 {
  const material = { version: '33.17' as const, serviceId, ownerId, fenceToken, acquiredAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString() };
  return { ...material, leaseDigest: sha256(material) };
}

function createCycleReceipt(serviceId: string, lease: AdaptiveControlLeaseV33_17, schedule: AdaptiveControlScheduleV33_17, cycle: AdaptiveControlCycleInputV33_17, inputDigest: string, slot: number, report: DriftSweepReportV33_16, recovered: boolean, now: Date, signer: SigningIdentity): SignedEnvelope<AdaptiveControlCycleReceiptV33_17> {
  const material = {
    version: '33.17' as const,
    receiptId: `adaptive-cycle-receipt-${randomUUID()}`,
    serviceId,
    cycleId: cycle.cycleId,
    scheduleId: schedule.scheduleId,
    scheduleDigest: schedule.scheduleDigest,
    tenantId: cycle.tenantId,
    slot,
    ownerId: lease.ownerId,
    fenceToken: lease.fenceToken,
    inputDigest,
    sweepReportDigest: report.reportDigest,
    evaluatedRecordCount: report.evaluatedRecordCount,
    revokedRecordIds: report.revokedRecordIds,
    expiredRecordIds: report.expiredRecordIds,
    fallbackRoute: 'FULL_GOVERNED_WORKFLOW' as const,
    recovered,
    completedAt: now.toISOString(),
    authorityExpanded: false as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, receiptDigest: sha256(material) }, signer);
}

function createCycleRecord(input: Omit<AdaptiveControlCycleRecordV33_17, 'version' | 'externalEffectsExecuted' | 'cycleDigest'>): AdaptiveControlCycleRecordV33_17 {
  const material = { version: '33.17' as const, ...input, externalEffectsExecuted: 0 as const };
  return { ...material, cycleDigest: sha256(material) };
}

function createSnapshot(serviceId: string, fenceCounter: number, lease: AdaptiveControlLeaseV33_17 | undefined, schedules: readonly SignedEnvelope<AdaptiveControlScheduleV33_17>[], cycles: readonly AdaptiveControlCycleRecordV33_17[], events: readonly AdaptiveControlEventV33_17[], priorObservedAt: Date, now: Date): AdaptiveControlSnapshotV33_17 {
  const lastObservedAt = new Date(Math.max(priorObservedAt.getTime(), now.getTime())).toISOString();
  const generatedAt = now.toISOString();
  const material = { version: '33.17' as const, serviceId, fenceCounter, ...(lease === undefined ? {} : { lease }), schedules: [...schedules].sort(bySchedule), cycles: [...cycles].sort(byCycle), events: [...events].sort((a, b) => a.sequence - b.sequence), lastObservedAt, generatedAt, externalEffectsExecuted: 0 as const };
  return { ...material, snapshotDigest: sha256(material) };
}

function verifySnapshot(snapshot: AdaptiveControlSnapshotV33_17, serviceId: string, trust: AdaptiveControlTrustV33_17, now: Date): void {
  const { snapshotDigest, ...material } = snapshot;
  if (snapshot.version !== '33.17' || snapshot.serviceId !== serviceId || snapshot.externalEffectsExecuted !== 0 || sha256(material) !== snapshotDigest) throw new Error('control_snapshot_invalid');
  if (Date.parse(snapshot.generatedAt) > now.getTime() || Date.parse(snapshot.lastObservedAt) > now.getTime()) throw new Error('control_snapshot_from_future');
  if (snapshot.lease !== undefined) verifyLease(snapshot.lease, serviceId);
  const scheduleIds = new Set<string>();
  for (const schedule of snapshot.schedules) { if (scheduleIds.has(schedule.payload.scheduleId)) throw new Error('duplicate_schedule'); scheduleIds.add(schedule.payload.scheduleId); verifySchedule(schedule, serviceId, trust, now, true); }
  const cycleIds = new Set<string>(); const slots = new Set<string>();
  for (const cycle of snapshot.cycles) {
    if (cycleIds.has(cycle.cycleId)) throw new Error('duplicate_cycle'); cycleIds.add(cycle.cycleId);
    const slotKey = `${cycle.scheduleDigest}:${cycle.slot}`; if (slots.has(slotKey)) throw new Error('duplicate_schedule_slot'); slots.add(slotKey);
    verifyCycle(cycle, serviceId, trust, now);
  }
  let previous = sha256('continuous-adaptive-control-genesis-v33.17');
  snapshot.events.forEach((event, index) => { if (event.sequence !== index + 1 || event.previousEventDigest !== previous) throw new Error('control_event_chain_invalid'); verifyEvent(event, serviceId); previous = event.eventDigest; });
  if (!Number.isInteger(snapshot.fenceCounter) || snapshot.fenceCounter < 0 || (snapshot.lease !== undefined && snapshot.lease.fenceToken > snapshot.fenceCounter)) throw new Error('fence_counter_invalid');
}

function verifyCycle(cycle: AdaptiveControlCycleRecordV33_17, serviceId: string, trust: AdaptiveControlTrustV33_17, now: Date): void {
  const { cycleDigest, ...material } = cycle;
  if (cycle.version !== '33.17' || cycle.serviceId !== serviceId || cycle.externalEffectsExecuted !== 0 || sha256(material) !== cycleDigest || cycle.attempts < 1) throw new Error('cycle_record_invalid');
  if (cycle.recovery !== undefined) {
    const payload = cycle.recovery.payload; const { recoveryDigest, ...recoveryMaterial } = payload;
    if (!trust.trustedRecoverySignerIds.includes(cycle.recovery.issuerKeyId) || !trust.recoveryRegistry.verifyAt(cycle.recovery, payload.recoveredAt) || payload.cycleId !== cycle.cycleId || payload.serviceId !== serviceId || payload.externalEffectsExecuted !== 0 || sha256(recoveryMaterial) !== recoveryDigest) throw new Error('cycle_recovery_invalid');
  }
  if (cycle.status === 'COMPLETED') {
    if (cycle.receipt === undefined || !verifyAdaptiveControlCycleReceiptV33_17({ envelope: cycle.receipt, registry: trust.serviceRegistry, trustedSignerIds: trust.trustedServiceSignerIds })) throw new Error('cycle_receipt_invalid');
  } else if (cycle.receipt !== undefined) throw new Error('started_cycle_has_receipt');
  if (Date.parse(cycle.updatedAt) > now.getTime()) throw new Error('cycle_from_future');
}

function verifySchedule(envelope: SignedEnvelope<AdaptiveControlScheduleV33_17>, serviceId: string, trust: AdaptiveControlTrustV33_17, now: Date, allowExpired = false): void {
  const payload = envelope.payload; const { scheduleDigest, ...material } = payload;
  if (!trust.trustedSchedulerSignerIds.includes(envelope.issuerKeyId) || !trust.scheduleRegistry.verifyAt(envelope, payload.notBefore)) throw new Error('schedule_signature_invalid');
  if (payload.version !== '33.17' || payload.serviceId !== serviceId || payload.jobType !== 'ADAPTIVE_DRIFT_SWEEP' || payload.externalEffectsExecuted !== 0 || sha256(material) !== scheduleDigest) throw new Error('schedule_invalid');
  positiveInteger(payload.cadenceMs, 'schedule_cadence_invalid'); positiveInteger(payload.maximumObservationCount, 'schedule_observation_limit_invalid');
  if (Date.parse(payload.notBefore) >= Date.parse(payload.expiresAt)) throw new Error('schedule_window_invalid');
  if (!allowExpired && (now.getTime() < Date.parse(payload.notBefore) || now.getTime() >= Date.parse(payload.expiresAt))) throw new Error('schedule_not_active');
}

function verifyRecovery(envelope: SignedEnvelope<AdaptiveCycleRecoveryReceiptV33_17>, prior: AdaptiveControlCycleRecordV33_17, lease: AdaptiveControlLeaseV33_17, trust: AdaptiveControlTrustV33_17, now: Date): void {
  const payload = envelope.payload; const { recoveryDigest, ...material } = payload;
  if (!trust.trustedRecoverySignerIds.includes(envelope.issuerKeyId) || !trust.recoveryRegistry.verifyAt(envelope, payload.recoveredAt) || sha256(material) !== recoveryDigest) throw new Error('recovery_signature_invalid');
  if (payload.serviceId !== prior.serviceId || payload.cycleId !== prior.cycleId || payload.recoveredFromFenceToken !== prior.startedFenceToken || payload.recoveredByFenceToken !== lease.fenceToken || payload.recoveredByOwnerId !== lease.ownerId || payload.externalEffectsExecuted !== 0 || Date.parse(payload.recoveredAt) > now.getTime()) throw new Error('recovery_binding_invalid');
}

function verifyCycleReceipt(envelope: SignedEnvelope<AdaptiveControlCycleReceiptV33_17>, record: AdaptiveControlCycleRecordV33_17, lease: AdaptiveControlLeaseV33_17, trust: AdaptiveControlTrustV33_17, now: Date): void {
  if (!verifyAdaptiveControlCycleReceiptV33_17({ envelope, registry: trust.serviceRegistry, trustedSignerIds: trust.trustedServiceSignerIds })) throw new Error('cycle_receipt_signature_invalid');
  const payload = envelope.payload;
  if (payload.cycleId !== record.cycleId || payload.serviceId !== record.serviceId || payload.scheduleDigest !== record.scheduleDigest || payload.tenantId !== record.tenantId || payload.slot !== record.slot || payload.inputDigest !== record.inputDigest || payload.ownerId !== lease.ownerId || payload.fenceToken !== lease.fenceToken || payload.completedAt !== now.toISOString()) throw new Error('cycle_receipt_binding_invalid');
}

function verifyLease(lease: AdaptiveControlLeaseV33_17, serviceId: string): void { const { leaseDigest, ...material } = lease; if (lease.version !== '33.17' || lease.serviceId !== serviceId || lease.fenceToken < 1 || sha256(material) !== leaseDigest || Date.parse(lease.acquiredAt) >= Date.parse(lease.expiresAt)) throw new Error('lease_invalid'); }
function assertLease(snapshot: AdaptiveControlSnapshotV33_17, lease: AdaptiveControlLeaseV33_17, now: Date): void { verifyLease(lease, snapshot.serviceId); const active = snapshot.lease; if (active === undefined || active.ownerId !== lease.ownerId || active.fenceToken !== lease.fenceToken || active.leaseDigest !== lease.leaseDigest) throw new Error('stale_fence'); if (Date.parse(active.expiresAt) <= now.getTime()) throw new Error('lease_expired'); }
function assertClock(snapshot: AdaptiveControlSnapshotV33_17, now: Date): void { if (now.getTime() < Date.parse(snapshot.lastObservedAt)) throw new Error('control_clock_rollback'); }
function scheduleSlot(schedule: AdaptiveControlScheduleV33_17, now: Date): number { const start = Date.parse(schedule.notBefore); const end = Date.parse(schedule.expiresAt); if (now.getTime() < start || now.getTime() >= end) throw new Error('schedule_not_active'); return Math.floor((now.getTime() - start) / schedule.cadenceMs); }
function appendEvent(events: readonly AdaptiveControlEventV33_17[], eventType: AdaptiveControlEventV33_17['eventType'], serviceId: string, payloadDigest: string, now: Date, optional: { ownerId?: string; cycleId?: string } = {}): AdaptiveControlEventV33_17 { const material = { version: '33.17' as const, eventId: `adaptive-control-event-${randomUUID()}`, sequence: events.length + 1, eventType, serviceId, ...optional, payloadDigest, occurredAt: now.toISOString(), previousEventDigest: events.at(-1)?.eventDigest ?? sha256('continuous-adaptive-control-genesis-v33.17'), externalEffectsExecuted: 0 as const }; return { ...material, eventDigest: sha256(material) }; }
function verifyEvent(event: AdaptiveControlEventV33_17, serviceId: string): void { const { eventDigest, ...material } = event; if (event.serviceId !== serviceId || event.externalEffectsExecuted !== 0 || sha256(material) !== eventDigest) throw new Error('control_event_invalid'); }
function bySchedule(a: SignedEnvelope<AdaptiveControlScheduleV33_17>, b: SignedEnvelope<AdaptiveControlScheduleV33_17>): number { return a.payload.scheduleId.localeCompare(b.payload.scheduleId); }
function byCycle(a: AdaptiveControlCycleRecordV33_17, b: AdaptiveControlCycleRecordV33_17): number { return a.cycleId.localeCompare(b.cycleId); }
function unique(values: readonly string[], code: string): readonly string[] { const rows = values.map((item) => nonEmpty(item, code)); if (new Set(rows).size !== rows.length) throw new Error(code); return [...rows].sort(); }
function nonEmpty(value: string, code: string): string { const normalized = value.trim(); if (normalized === '') throw new Error(code); return normalized; }
function digest(value: string, code: string): string { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(code); return value; }
function positiveInteger(value: number, code: string): void { if (!Number.isInteger(value) || value <= 0) throw new Error(code); }
function instant(value: string, code: string): number { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error(code); return parsed; }
function acquireLock(path: string): number { try { return openSync(path, 'wx', 0o600); } catch { throw new Error('control_store_locked'); } }
function releaseLock(fd: number, path: string): void { closeSync(fd); try { unlinkSync(path); } catch { /* best effort */ } }
function atomicReplace(path: string, contents: string): void { const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`; const fd = openSync(temporary, 'wx', 0o600); try { writeFileSync(fd, contents, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); } try { renameSync(temporary, path); } catch (error) { try { unlinkSync(temporary); } catch { /* best effort */ } throw error; } }
