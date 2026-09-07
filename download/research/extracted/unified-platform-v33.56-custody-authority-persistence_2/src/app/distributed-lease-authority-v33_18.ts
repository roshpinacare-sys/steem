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
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import {
  KeyRegistry,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';

export type LeaseBackendKindV33_18 = 'POSTGRESQL' | 'ETCD' | 'CONSUL';
export type LeaseBackendStatusV33_18 = 'AVAILABLE_NOT_QUALIFIED' | 'UNAVAILABLE_FAIL_CLOSED';

export interface LeaseBackendProbeV33_18 {
  readonly version: '33.18';
  readonly backend: LeaseBackendKindV33_18;
  readonly status: LeaseBackendStatusV33_18;
  readonly executable?: string;
  readonly qualification: 'EXTERNAL_QUALIFICATION_REQUIRED';
  readonly productionAuthority: 'NONE';
  readonly probedAt: string;
  readonly probeDigest: string;
}

export interface DistributedLeaseCommandV33_18 {
  readonly version: '33.18';
  readonly commandId: string;
  readonly operation: 'ACQUIRE' | 'RENEW' | 'ASSERT_FENCE';
  readonly authorityId: string;
  readonly tenantId: string;
  readonly serviceId: string;
  readonly controllerId: string;
  readonly requestedTtlMs?: number;
  readonly expectedFenceToken?: number;
  readonly expectedLeaseDigest?: string;
  readonly requestedAt: string;
  readonly authorityExpanded: false;
  readonly externalEffectsExecuted: 0;
  readonly commandDigest: string;
}

export interface DistributedLeaseGrantV33_18 {
  readonly version: '33.18';
  readonly leaseId: string;
  readonly authorityId: string;
  readonly tenantId: string;
  readonly serviceId: string;
  readonly controllerId: string;
  readonly fenceToken: number;
  readonly authorityEpoch: number;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly witnessReceiptDigest: string;
  readonly authorityExpanded: false;
  readonly externalEffectsExecuted: 0;
  readonly leaseDigest: string;
}

export interface DistributedLeaseDecisionV33_18 {
  readonly version: '33.18';
  readonly decisionId: string;
  readonly commandId: string;
  readonly commandDigest: string;
  readonly authorityId: string;
  readonly tenantId: string;
  readonly serviceId: string;
  readonly controllerId: string;
  readonly operation: DistributedLeaseCommandV33_18['operation'];
  readonly accepted: boolean;
  readonly reason:
    | 'LEASE_GRANTED'
    | 'LEASE_RENEWED'
    | 'FENCE_VALID'
    | 'LEASE_BUSY'
    | 'LEASE_ALREADY_HELD'
    | 'LEASE_NOT_FOUND'
    | 'LEASE_EXPIRED'
    | 'STALE_FENCE'
    | 'COMMAND_INVALID';
  readonly currentFenceToken: number;
  readonly grant?: DistributedLeaseGrantV33_18;
  readonly decidedAt: string;
  readonly fallbackRoute: 'FULL_GOVERNED_WORKFLOW';
  readonly authorityExpanded: false;
  readonly externalEffectsExecuted: 0;
  readonly decisionDigest: string;
}

export interface MonotonicFenceWitnessReceiptV33_18 {
  readonly version: '33.18';
  readonly witnessId: string;
  readonly authorityId: string;
  readonly leaseKey: string;
  readonly fenceToken: number;
  readonly previousReceiptDigest: string;
  readonly observedAt: string;
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface DistributedLeaseOutboxRecordV33_18 {
  readonly version: '33.18';
  readonly eventId: string;
  readonly sequence: number;
  readonly eventType:
    | 'LEASE_GRANTED'
    | 'LEASE_RENEWED'
    | 'LEASE_TAKEOVER'
    | 'STALE_FENCE_REJECTED'
    | 'FALLBACK_REQUIRED';
  readonly authorityId: string;
  readonly tenantId: string;
  readonly serviceId: string;
  readonly controllerId: string;
  readonly fenceToken: number;
  readonly commandId: string;
  readonly decisionDigest: string;
  readonly createdAt: string;
  readonly previousEventDigest: string;
  readonly acknowledgedAt?: string;
  readonly acknowledgedBy?: string;
  readonly externalEffectsExecuted: 0;
  readonly eventDigest: string;
}

export interface DistributedLeaseSnapshotV33_18 {
  readonly version: '33.18';
  readonly authorityId: string;
  readonly authorityEpoch: number;
  readonly fenceCounter: number;
  readonly activeLeases: readonly DistributedLeaseGrantV33_18[];
  readonly decisions: readonly SignedEnvelope<DistributedLeaseDecisionV33_18>[];
  readonly outbox: readonly SignedEnvelope<DistributedLeaseOutboxRecordV33_18>[];
  readonly lastObservedAt: string;
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

interface WitnessSnapshotV33_18 {
  readonly version: '33.18';
  readonly witnessId: string;
  readonly highestByLeaseKey: Readonly<Record<string, SignedEnvelope<MonotonicFenceWitnessReceiptV33_18>>>;
  readonly generatedAt: string;
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export interface DistributedLeaseTrustV33_18 {
  readonly controllerRegistry: KeyRegistry;
  readonly trustedControllerSignerIds: readonly string[];
  readonly authorityRegistry: KeyRegistry;
  readonly trustedAuthoritySignerIds: readonly string[];
  readonly witnessRegistry: KeyRegistry;
  readonly trustedWitnessSignerIds: readonly string[];
  readonly deliveryRegistry: KeyRegistry;
  readonly trustedDeliverySignerIds: readonly string[];
}

export interface OutboxAcknowledgementV33_18 {
  readonly version: '33.18';
  readonly eventId: string;
  readonly eventDigest: string;
  readonly deliveryWorkerId: string;
  readonly acknowledgedAt: string;
  readonly externalEffectsExecuted: 0;
  readonly acknowledgementDigest: string;
}

export class MonotonicFenceWitnessStoreV33_18 {
  readonly #path: string;
  readonly #identity: SigningIdentity;
  readonly #registry: KeyRegistry;
  readonly #trustedSignerIds: readonly string[];
  readonly #witnessId: string;
  #snapshot: WitnessSnapshotV33_18;

  constructor(input: {
    readonly path: string;
    readonly witnessId: string;
    readonly identity: SigningIdentity;
    readonly registry: KeyRegistry;
    readonly trustedSignerIds: readonly string[];
    readonly now?: Date;
  }) {
    this.#path = resolve(nonEmpty(input.path, 'witness_path_required'));
    this.#witnessId = nonEmpty(input.witnessId, 'witness_id_required');
    this.#identity = input.identity;
    this.#registry = input.registry;
    this.#trustedSignerIds = unique(input.trustedSignerIds, 'duplicate_witness_signer');
    if (!this.#trustedSignerIds.includes(input.identity.keyId)) throw new Error('witness_signer_untrusted');
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    this.#snapshot = existsSync(this.#path) ? this.#read() : createWitnessSnapshot(this.#witnessId, {}, input.now ?? new Date());
    if (!existsSync(this.#path)) this.#persist(input.now ?? new Date());
  }

  highest(leaseKey: string): number {
    return this.#snapshot.highestByLeaseKey[leaseKey]?.payload.fenceToken ?? 0;
  }

  maximumFence(): number {
    return Object.values(this.#snapshot.highestByLeaseKey).reduce((maximum, item) => Math.max(maximum, item.payload.fenceToken), 0);
  }

  advance(input: { readonly authorityId: string; readonly leaseKey: string; readonly fenceToken: number; readonly now?: Date }): SignedEnvelope<MonotonicFenceWitnessReceiptV33_18> {
    const now = input.now ?? new Date();
    positiveInteger(input.fenceToken, 'witness_fence_invalid');
    const current = this.#snapshot.highestByLeaseKey[input.leaseKey];
    const currentFence = current?.payload.fenceToken ?? 0;
    if (input.fenceToken <= currentFence) {
      if (input.fenceToken === currentFence && current !== undefined) return structuredClone(current);
      throw new Error('witness_fence_not_monotonic');
    }
    if (input.fenceToken !== currentFence + 1) throw new Error('witness_fence_gap');
    const material = {
      version: '33.18' as const,
      witnessId: this.#witnessId,
      authorityId: nonEmpty(input.authorityId, 'authority_id_required'),
      leaseKey: nonEmpty(input.leaseKey, 'lease_key_required'),
      fenceToken: input.fenceToken,
      previousReceiptDigest: current?.payload.receiptDigest ?? sha256('distributed-fence-witness-genesis-v33.18'),
      observedAt: now.toISOString(),
      externalEffectsExecuted: 0 as const,
    };
    const receipt = signEnvelope({ ...material, receiptDigest: sha256(material) }, this.#identity);
    const highestByLeaseKey = { ...this.#snapshot.highestByLeaseKey, [input.leaseKey]: receipt };
    this.#snapshot = createWitnessSnapshot(this.#witnessId, highestByLeaseKey, now);
    this.#persist(now);
    return structuredClone(receipt);
  }

  verifyReceipt(envelope: SignedEnvelope<MonotonicFenceWitnessReceiptV33_18>): boolean {
    if (!this.#trustedSignerIds.includes(envelope.issuerKeyId) || !this.#registry.verifyAt(envelope, envelope.payload.observedAt)) return false;
    const { receiptDigest, ...material } = envelope.payload;
    return envelope.payload.version === '33.18' && envelope.payload.witnessId === this.#witnessId && envelope.payload.externalEffectsExecuted === 0 && sha256(material) === receiptDigest;
  }

  #read(): WitnessSnapshotV33_18 {
    let envelope: SignedEnvelope<WitnessSnapshotV33_18>;
    try { envelope = JSON.parse(readFileSync(this.#path, 'utf8')) as SignedEnvelope<WitnessSnapshotV33_18>; }
    catch { throw new Error('witness_store_parse_invalid'); }
    if (!this.#trustedSignerIds.includes(envelope.issuerKeyId) || !this.#registry.verifyAt(envelope, envelope.payload.generatedAt)) throw new Error('witness_store_signature_invalid');
    verifyWitnessSnapshot(envelope.payload, this.#witnessId, this);
    return structuredClone(envelope.payload);
  }

  #persist(now: Date): void {
    this.#snapshot = createWitnessSnapshot(this.#witnessId, this.#snapshot.highestByLeaseKey, now);
    atomicReplace(this.#path, `${JSON.stringify(signEnvelope(this.#snapshot, this.#identity), null, 2)}\n`);
  }
}

export class DistributedLeaseAuthorityStoreV33_18 {
  readonly #path: string;
  readonly #lockPath: string;
  readonly #authorityId: string;
  readonly #authorityIdentity: SigningIdentity;
  readonly #storeIdentity: SigningIdentity;
  readonly #storeRegistry: KeyRegistry;
  readonly #trustedStoreSignerIds: readonly string[];
  readonly #trust: DistributedLeaseTrustV33_18;
  readonly #witness: MonotonicFenceWitnessStoreV33_18;
  #snapshot: DistributedLeaseSnapshotV33_18;

  constructor(input: {
    readonly path: string;
    readonly authorityId: string;
    readonly authorityIdentity: SigningIdentity;
    readonly storeIdentity: SigningIdentity;
    readonly storeRegistry: KeyRegistry;
    readonly trustedStoreSignerIds: readonly string[];
    readonly trust: DistributedLeaseTrustV33_18;
    readonly witness: MonotonicFenceWitnessStoreV33_18;
    readonly now?: Date;
  }) {
    this.#path = resolve(nonEmpty(input.path, 'lease_authority_path_required'));
    this.#lockPath = `${this.#path}.lock`;
    this.#authorityId = nonEmpty(input.authorityId, 'authority_id_required');
    this.#authorityIdentity = input.authorityIdentity;
    this.#storeIdentity = input.storeIdentity;
    this.#storeRegistry = input.storeRegistry;
    this.#trustedStoreSignerIds = unique(input.trustedStoreSignerIds, 'duplicate_authority_store_signer');
    this.#trust = input.trust;
    this.#witness = input.witness;
    if (!input.trust.trustedAuthoritySignerIds.includes(input.authorityIdentity.keyId)) throw new Error('authority_signer_untrusted');
    const roleIds = new Set([input.authorityIdentity.keyId, input.storeIdentity.keyId]);
    if (roleIds.size !== 2 || input.trust.trustedControllerSignerIds.includes(input.authorityIdentity.keyId) || input.trust.trustedWitnessSignerIds.includes(input.authorityIdentity.keyId)) throw new Error('distributed_lease_role_separation_required');
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    const now = input.now ?? new Date();
    this.#snapshot = existsSync(this.#path) ? this.#read(now) : createAuthoritySnapshot(this.#authorityId, 1, 0, [], [], [], now, now);
    this.#assertWitnessFloor();
    if (!existsSync(this.#path)) this.#persist(now);
  }

  snapshot(): DistributedLeaseSnapshotV33_18 { return structuredClone(this.#snapshot); }

  processCommand(envelope: SignedEnvelope<DistributedLeaseCommandV33_18>, now = new Date()): SignedEnvelope<DistributedLeaseDecisionV33_18> {
    verifyCommandEnvelope(envelope, this.#authorityId, this.#trust, now);
    return this.#mutate((snapshot) => {
      const prior = snapshot.decisions.find((item) => item.payload.commandId === envelope.payload.commandId);
      if (prior !== undefined) {
        if (prior.payload.commandDigest !== envelope.payload.commandDigest) throw new Error('distributed_command_id_conflict');
        return { snapshot, value: prior };
      }
      const key = leaseKey(envelope.payload.tenantId, envelope.payload.serviceId);
      const active = snapshot.activeLeases.find((item) => leaseKey(item.tenantId, item.serviceId) === key);
      let decision: SignedEnvelope<DistributedLeaseDecisionV33_18>;
      let leases = [...snapshot.activeLeases];
      let outbox = [...snapshot.outbox];
      let fenceCounter = snapshot.fenceCounter;
      if (envelope.payload.operation === 'ACQUIRE') {
        const currentActive = active !== undefined && Date.parse(active.expiresAt) > now.getTime();
        if (currentActive) {
          decision = this.#decision(envelope.payload, false, active!.controllerId === envelope.payload.controllerId ? 'LEASE_ALREADY_HELD' : 'LEASE_BUSY', active!.fenceToken, now);
        } else {
          const nextFence = Math.max(snapshot.fenceCounter, this.#witness.highest(key)) + 1;
          const witness = this.#witness.advance({ authorityId: this.#authorityId, leaseKey: key, fenceToken: nextFence, now });
          const grant = createGrant(envelope.payload, nextFence, snapshot.authorityEpoch, witness.payload.receiptDigest, now);
          const reason = active === undefined ? 'LEASE_GRANTED' : 'LEASE_GRANTED';
          decision = this.#decision(envelope.payload, true, reason, nextFence, now, grant);
          leases = leases.filter((item) => leaseKey(item.tenantId, item.serviceId) !== key).concat(grant).sort(byLease);
          fenceCounter = nextFence;
          outbox = appendOutbox(outbox, active === undefined ? 'LEASE_GRANTED' : 'LEASE_TAKEOVER', decision.payload, now, this.#authorityIdentity);
          if (active !== undefined) outbox = appendOutbox(outbox, 'FALLBACK_REQUIRED', this.#decisionForFallback(envelope.payload, active, decision.payload, now), now, this.#authorityIdentity);
        }
      } else if (envelope.payload.operation === 'RENEW') {
        if (active === undefined) decision = this.#decision(envelope.payload, false, 'LEASE_NOT_FOUND', snapshot.fenceCounter, now);
        else if (Date.parse(active.expiresAt) <= now.getTime()) decision = this.#decision(envelope.payload, false, 'LEASE_EXPIRED', active.fenceToken, now);
        else if (!matchesExpected(envelope.payload, active)) decision = this.#decision(envelope.payload, false, 'STALE_FENCE', active.fenceToken, now);
        else {
          const grant = renewGrant(active, envelope.payload, now);
          decision = this.#decision(envelope.payload, true, 'LEASE_RENEWED', grant.fenceToken, now, grant);
          leases = leases.filter((item) => leaseKey(item.tenantId, item.serviceId) !== key).concat(grant).sort(byLease);
          outbox = appendOutbox(outbox, 'LEASE_RENEWED', decision.payload, now, this.#authorityIdentity);
        }
      } else {
        if (active === undefined) decision = this.#decision(envelope.payload, false, 'LEASE_NOT_FOUND', snapshot.fenceCounter, now);
        else if (Date.parse(active.expiresAt) <= now.getTime()) decision = this.#decision(envelope.payload, false, 'LEASE_EXPIRED', active.fenceToken, now);
        else if (!matchesExpected(envelope.payload, active)) {
          decision = this.#decision(envelope.payload, false, 'STALE_FENCE', active.fenceToken, now);
          outbox = appendOutbox(outbox, 'STALE_FENCE_REJECTED', decision.payload, now, this.#authorityIdentity);
        } else decision = this.#decision(envelope.payload, true, 'FENCE_VALID', active.fenceToken, now, active);
      }
      const decisions = [...snapshot.decisions, decision].sort(byDecision);
      const next = createAuthoritySnapshot(this.#authorityId, snapshot.authorityEpoch, fenceCounter, leases, decisions, outbox, now, now);
      return { snapshot: next, value: decision };
    }, now);
  }

  acknowledgeOutbox(envelope: SignedEnvelope<OutboxAcknowledgementV33_18>, now = new Date()): SignedEnvelope<DistributedLeaseOutboxRecordV33_18> {
    verifyOutboxAcknowledgement(envelope, this.#trust, now);
    return this.#mutate((snapshot) => {
      const index = snapshot.outbox.findIndex((item) => item.payload.eventId === envelope.payload.eventId);
      if (index < 0) throw new Error('outbox_event_not_found');
      const current = snapshot.outbox[index]!;
      if (current.payload.eventDigest !== envelope.payload.eventDigest) throw new Error('outbox_ack_digest_mismatch');
      if (current.payload.acknowledgedAt !== undefined) {
        if (current.payload.acknowledgedAt !== envelope.payload.acknowledgedAt || current.payload.acknowledgedBy !== envelope.payload.deliveryWorkerId) throw new Error('outbox_ack_conflict');
        return { snapshot, value: current };
      }
      const updated = signEnvelope({ ...current.payload, acknowledgedAt: envelope.payload.acknowledgedAt, acknowledgedBy: envelope.payload.deliveryWorkerId }, this.#authorityIdentity);
      const outbox = [...snapshot.outbox]; outbox[index] = updated;
      return { snapshot: createAuthoritySnapshot(this.#authorityId, snapshot.authorityEpoch, snapshot.fenceCounter, snapshot.activeLeases, snapshot.decisions, outbox, now, now), value: updated };
    }, now);
  }

  verifyDecision(envelope: SignedEnvelope<DistributedLeaseDecisionV33_18>): boolean {
    if (!this.#trust.trustedAuthoritySignerIds.includes(envelope.issuerKeyId) || !this.#trust.authorityRegistry.verifyAt(envelope, envelope.payload.decidedAt)) return false;
    const { decisionDigest, ...material } = envelope.payload;
    return envelope.payload.version === '33.18' && envelope.payload.authorityId === this.#authorityId && envelope.payload.externalEffectsExecuted === 0 && envelope.payload.authorityExpanded === false && sha256(material) === decisionDigest;
  }

  #decision(command: DistributedLeaseCommandV33_18, accepted: boolean, reason: DistributedLeaseDecisionV33_18['reason'], currentFenceToken: number, now: Date, grant?: DistributedLeaseGrantV33_18): SignedEnvelope<DistributedLeaseDecisionV33_18> {
    const material = {
      version: '33.18' as const,
      decisionId: `distributed-lease-decision-${randomUUID()}`,
      commandId: command.commandId,
      commandDigest: command.commandDigest,
      authorityId: this.#authorityId,
      tenantId: command.tenantId,
      serviceId: command.serviceId,
      controllerId: command.controllerId,
      operation: command.operation,
      accepted,
      reason,
      currentFenceToken,
      ...(grant === undefined ? {} : { grant }),
      decidedAt: now.toISOString(),
      fallbackRoute: 'FULL_GOVERNED_WORKFLOW' as const,
      authorityExpanded: false as const,
      externalEffectsExecuted: 0 as const,
    };
    return signEnvelope({ ...material, decisionDigest: sha256(material) }, this.#authorityIdentity);
  }

  #decisionForFallback(command: DistributedLeaseCommandV33_18, prior: DistributedLeaseGrantV33_18, replacement: DistributedLeaseDecisionV33_18, now: Date): DistributedLeaseDecisionV33_18 {
    const material = {
      version: '33.18' as const,
      decisionId: `distributed-fallback-${randomUUID()}`,
      commandId: command.commandId,
      commandDigest: command.commandDigest,
      authorityId: this.#authorityId,
      tenantId: prior.tenantId,
      serviceId: prior.serviceId,
      controllerId: prior.controllerId,
      operation: 'ASSERT_FENCE' as const,
      accepted: false,
      reason: 'STALE_FENCE' as const,
      currentFenceToken: replacement.currentFenceToken,
      decidedAt: now.toISOString(),
      fallbackRoute: 'FULL_GOVERNED_WORKFLOW' as const,
      authorityExpanded: false as const,
      externalEffectsExecuted: 0 as const,
    };
    return { ...material, decisionDigest: sha256(material) };
  }

  #read(now: Date): DistributedLeaseSnapshotV33_18 {
    let envelope: SignedEnvelope<DistributedLeaseSnapshotV33_18>;
    try { envelope = JSON.parse(readFileSync(this.#path, 'utf8')) as SignedEnvelope<DistributedLeaseSnapshotV33_18>; }
    catch { throw new Error('distributed_lease_store_parse_invalid'); }
    if (!this.#trustedStoreSignerIds.includes(envelope.issuerKeyId) || !this.#storeRegistry.verifyAt(envelope, envelope.payload.generatedAt)) throw new Error('distributed_lease_store_signature_invalid');
    verifyAuthoritySnapshot(envelope.payload, this.#authorityId, this.#trust, this.#witness, now);
    return structuredClone(envelope.payload);
  }

  #assertWitnessFloor(): void {
    for (const lease of this.#snapshot.activeLeases) if (lease.fenceToken < this.#witness.highest(leaseKey(lease.tenantId, lease.serviceId))) throw new Error('authority_snapshot_rollback_detected');
    const highest = this.#witness.maximumFence();
    if (this.#snapshot.fenceCounter < highest) throw new Error('authority_fence_counter_below_witness');
  }

  #mutate<T>(fn: (snapshot: DistributedLeaseSnapshotV33_18) => { snapshot: DistributedLeaseSnapshotV33_18; value: T }, now: Date): T {
    const lock = acquireLockWithWait(this.#lockPath, 2000);
    try {
      if (existsSync(this.#path)) this.#snapshot = this.#read(now);
      if (now.getTime() < Date.parse(this.#snapshot.lastObservedAt)) throw new Error('distributed_authority_clock_rollback');
      this.#assertWitnessFloor();
      const result = fn(structuredClone(this.#snapshot));
      verifyAuthoritySnapshot(result.snapshot, this.#authorityId, this.#trust, this.#witness, now);
      this.#snapshot = result.snapshot;
      this.#persist(now);
      return structuredClone(result.value);
    } finally { releaseLock(lock, this.#lockPath); }
  }

  #persist(now: Date): void {
    this.#snapshot = createAuthoritySnapshot(this.#authorityId, this.#snapshot.authorityEpoch, this.#snapshot.fenceCounter, this.#snapshot.activeLeases, this.#snapshot.decisions, this.#snapshot.outbox, new Date(this.#snapshot.lastObservedAt), now);
    atomicReplace(this.#path, `${JSON.stringify(signEnvelope(this.#snapshot, this.#storeIdentity), null, 2)}\n`);
  }
}

export function issueDistributedLeaseCommandV33_18(input: {
  readonly authorityId: string;
  readonly tenantId: string;
  readonly serviceId: string;
  readonly controllerId: string;
  readonly operation: DistributedLeaseCommandV33_18['operation'];
  readonly signer: SigningIdentity;
  readonly requestedTtlMs?: number;
  readonly expectedFenceToken?: number;
  readonly expectedLeaseDigest?: string;
  readonly commandId?: string;
  readonly now?: Date;
}): SignedEnvelope<DistributedLeaseCommandV33_18> {
  const now = input.now ?? new Date();
  if ((input.operation === 'ACQUIRE' || input.operation === 'RENEW') && input.requestedTtlMs === undefined) throw new Error('requested_ttl_required');
  if (input.operation !== 'ACQUIRE' && (input.expectedFenceToken === undefined || input.expectedLeaseDigest === undefined)) throw new Error('expected_lease_required');
  const material = {
    version: '33.18' as const,
    commandId: input.commandId ?? `distributed-lease-command-${randomUUID()}`,
    operation: input.operation,
    authorityId: nonEmpty(input.authorityId, 'authority_id_required'),
    tenantId: nonEmpty(input.tenantId, 'tenant_id_required'),
    serviceId: nonEmpty(input.serviceId, 'service_id_required'),
    controllerId: nonEmpty(input.controllerId, 'controller_id_required'),
    ...(input.requestedTtlMs === undefined ? {} : { requestedTtlMs: positiveIntegerValue(input.requestedTtlMs, 'requested_ttl_invalid') }),
    ...(input.expectedFenceToken === undefined ? {} : { expectedFenceToken: positiveIntegerValue(input.expectedFenceToken, 'expected_fence_invalid') }),
    ...(input.expectedLeaseDigest === undefined ? {} : { expectedLeaseDigest: digest(input.expectedLeaseDigest, 'expected_lease_digest_invalid') }),
    requestedAt: now.toISOString(),
    authorityExpanded: false as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, commandDigest: sha256(material) }, input.signer);
}

export function issueOutboxAcknowledgementV33_18(input: {
  readonly event: SignedEnvelope<DistributedLeaseOutboxRecordV33_18>;
  readonly deliveryWorkerId: string;
  readonly signer: SigningIdentity;
  readonly now?: Date;
}): SignedEnvelope<OutboxAcknowledgementV33_18> {
  const material = {
    version: '33.18' as const,
    eventId: input.event.payload.eventId,
    eventDigest: input.event.payload.eventDigest,
    deliveryWorkerId: nonEmpty(input.deliveryWorkerId, 'delivery_worker_id_required'),
    acknowledgedAt: (input.now ?? new Date()).toISOString(),
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, acknowledgementDigest: sha256(material) }, input.signer);
}

export function probeLeaseBackendsV33_18(input: { readonly executables: Readonly<Partial<Record<LeaseBackendKindV33_18, string>>>; readonly now?: Date }): readonly LeaseBackendProbeV33_18[] {
  const now = input.now ?? new Date();
  return (['POSTGRESQL', 'ETCD', 'CONSUL'] as const).map((backend) => {
    const executable = input.executables[backend];
    const material = {
      version: '33.18' as const,
      backend,
      status: executable === undefined ? 'UNAVAILABLE_FAIL_CLOSED' as const : 'AVAILABLE_NOT_QUALIFIED' as const,
      ...(executable === undefined ? {} : { executable }),
      qualification: 'EXTERNAL_QUALIFICATION_REQUIRED' as const,
      productionAuthority: 'NONE' as const,
      probedAt: now.toISOString(),
    };
    return { ...material, probeDigest: sha256(material) };
  });
}

export function createDistributedLeaseAuthorityHttpServerV33_18(input: {
  readonly store: DistributedLeaseAuthorityStoreV33_18;
  readonly now: () => Date;
  readonly maximumBodyBytes?: number;
}): Server {
  const maximumBodyBytes = input.maximumBodyBytes ?? 128 * 1024;
  return createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/distributed-lease/command') { response.writeHead(404).end(); return; }
    const chunks: Buffer[] = []; let bytes = 0;
    request.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > maximumBodyBytes) request.destroy(new Error('request_too_large')); else chunks.push(chunk); });
    request.on('error', () => { if (!response.headersSent) response.writeHead(413).end(); });
    request.on('end', () => {
      try {
        const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')) as SignedEnvelope<DistributedLeaseCommandV33_18>;
        const decision = input.store.processCommand(envelope, input.now());
        response.writeHead(decision.payload.accepted ? 200 : 409, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify(decision));
      } catch (error) {
        response.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'distributed_lease_error' }));
      }
    });
  });
}

export async function sendDistributedLeaseCommandV33_18(input: {
  readonly endpoint: string;
  readonly envelope: SignedEnvelope<DistributedLeaseCommandV33_18>;
  readonly timeoutMs?: number;
}): Promise<SignedEnvelope<DistributedLeaseDecisionV33_18>> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 2000);
  try {
    const response = await fetch(`${input.endpoint.replace(/\/$/, '')}/v1/distributed-lease/command`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input.envelope), redirect: 'error', signal: controller.signal });
    const body = await response.text();
    if (response.status !== 200 && response.status !== 409) throw new Error(`lease_authority_http_${response.status}`);
    return JSON.parse(body) as SignedEnvelope<DistributedLeaseDecisionV33_18>;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('lease_authority_unavailable_fail_closed');
    throw error;
  } finally { clearTimeout(timer); }
}

function verifyCommandEnvelope(envelope: SignedEnvelope<DistributedLeaseCommandV33_18>, authorityId: string, trust: DistributedLeaseTrustV33_18, now: Date): void {
  if (!trust.trustedControllerSignerIds.includes(envelope.issuerKeyId) || !trust.controllerRegistry.verifyAt(envelope, envelope.payload.requestedAt)) throw new Error('distributed_command_signature_invalid');
  const payload = envelope.payload; const { commandDigest, ...material } = payload;
  if (payload.version !== '33.18' || payload.authorityId !== authorityId || payload.authorityExpanded !== false || payload.externalEffectsExecuted !== 0 || sha256(material) !== commandDigest) throw new Error('distributed_command_invalid');
  if (Date.parse(payload.requestedAt) > now.getTime() || now.getTime() - Date.parse(payload.requestedAt) > 60_000) throw new Error('distributed_command_time_invalid');
  if ((payload.operation === 'ACQUIRE' || payload.operation === 'RENEW') && (payload.requestedTtlMs === undefined || payload.requestedTtlMs > 60_000)) throw new Error('distributed_command_ttl_invalid');
  if (payload.operation !== 'ACQUIRE' && (payload.expectedFenceToken === undefined || payload.expectedLeaseDigest === undefined)) throw new Error('distributed_command_expected_lease_missing');
}

function verifyAuthoritySnapshot(snapshot: DistributedLeaseSnapshotV33_18, authorityId: string, trust: DistributedLeaseTrustV33_18, witness: MonotonicFenceWitnessStoreV33_18, now: Date): void {
  const { snapshotDigest, ...material } = snapshot;
  if (snapshot.version !== '33.18' || snapshot.authorityId !== authorityId || snapshot.productionAuthority !== 'NONE' || snapshot.externalEffectsExecuted !== 0 || sha256(material) !== snapshotDigest) throw new Error('distributed_authority_snapshot_invalid');
  if (Date.parse(snapshot.generatedAt) > now.getTime() || Date.parse(snapshot.lastObservedAt) > now.getTime()) throw new Error('distributed_authority_snapshot_from_future');
  const keys = new Set<string>();
  for (const lease of snapshot.activeLeases) {
    verifyGrant(lease, authorityId); const key = leaseKey(lease.tenantId, lease.serviceId); if (keys.has(key)) throw new Error('duplicate_distributed_lease'); keys.add(key);
    if (lease.fenceToken > snapshot.fenceCounter || lease.fenceToken < witness.highest(key)) throw new Error('distributed_lease_witness_floor_violation');
  }
  const commands = new Set<string>();
  for (const decision of snapshot.decisions) {
    if (commands.has(decision.payload.commandId)) throw new Error('duplicate_distributed_command'); commands.add(decision.payload.commandId);
    if (!trust.trustedAuthoritySignerIds.includes(decision.issuerKeyId) || !trust.authorityRegistry.verifyAt(decision, decision.payload.decidedAt)) throw new Error('distributed_decision_signature_invalid');
    const { decisionDigest, ...decisionMaterial } = decision.payload; if (sha256(decisionMaterial) !== decisionDigest || decision.payload.externalEffectsExecuted !== 0 || decision.payload.authorityExpanded !== false) throw new Error('distributed_decision_invalid');
  }
  let previous = sha256('distributed-lease-outbox-genesis-v33.18');
  snapshot.outbox.forEach((event, index) => {
    if (!trust.trustedAuthoritySignerIds.includes(event.issuerKeyId) || !trust.authorityRegistry.verifyAt(event, event.payload.createdAt)) throw new Error('distributed_outbox_signature_invalid');
    const eventDigest = event.payload.eventDigest;
    const eventMaterial = immutableOutboxMaterial(event.payload);
    if (event.payload.sequence !== index + 1 || event.payload.previousEventDigest !== previous || event.payload.externalEffectsExecuted !== 0 || sha256(eventMaterial) !== eventDigest) throw new Error('distributed_outbox_chain_invalid');
    previous = eventDigest;
  });
}

function verifyWitnessSnapshot(snapshot: WitnessSnapshotV33_18, witnessId: string, store: MonotonicFenceWitnessStoreV33_18): void {
  const { snapshotDigest, ...material } = snapshot;
  if (snapshot.version !== '33.18' || snapshot.witnessId !== witnessId || snapshot.externalEffectsExecuted !== 0 || sha256(material) !== snapshotDigest) throw new Error('witness_snapshot_invalid');
  for (const envelope of Object.values(snapshot.highestByLeaseKey)) if (!store.verifyReceipt(envelope)) throw new Error('witness_receipt_invalid');
}

function verifyOutboxAcknowledgement(envelope: SignedEnvelope<OutboxAcknowledgementV33_18>, trust: DistributedLeaseTrustV33_18, now: Date): void {
  if (!trust.trustedDeliverySignerIds.includes(envelope.issuerKeyId) || !trust.deliveryRegistry.verifyAt(envelope, envelope.payload.acknowledgedAt)) throw new Error('outbox_ack_signature_invalid');
  const { acknowledgementDigest, ...material } = envelope.payload;
  if (envelope.payload.version !== '33.18' || envelope.payload.externalEffectsExecuted !== 0 || sha256(material) !== acknowledgementDigest || Date.parse(envelope.payload.acknowledgedAt) > now.getTime()) throw new Error('outbox_ack_invalid');
}

function createGrant(command: DistributedLeaseCommandV33_18, fenceToken: number, authorityEpoch: number, witnessReceiptDigest: string, now: Date): DistributedLeaseGrantV33_18 {
  const ttl = positiveIntegerValue(command.requestedTtlMs ?? 0, 'requested_ttl_invalid');
  const material = {
    version: '33.18' as const,
    leaseId: `distributed-lease-${randomUUID()}`,
    authorityId: command.authorityId,
    tenantId: command.tenantId,
    serviceId: command.serviceId,
    controllerId: command.controllerId,
    fenceToken,
    authorityEpoch,
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl).toISOString(),
    witnessReceiptDigest,
    authorityExpanded: false as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, leaseDigest: sha256(material) };
}

function renewGrant(active: DistributedLeaseGrantV33_18, command: DistributedLeaseCommandV33_18, now: Date): DistributedLeaseGrantV33_18 {
  const material = {
    version: '33.18' as const,
    leaseId: active.leaseId,
    authorityId: active.authorityId,
    tenantId: active.tenantId,
    serviceId: active.serviceId,
    controllerId: active.controllerId,
    fenceToken: active.fenceToken,
    authorityEpoch: active.authorityEpoch,
    acquiredAt: active.acquiredAt,
    expiresAt: new Date(now.getTime() + positiveIntegerValue(command.requestedTtlMs ?? 0, 'requested_ttl_invalid')).toISOString(),
    witnessReceiptDigest: active.witnessReceiptDigest,
    authorityExpanded: false as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, leaseDigest: sha256(material) };
}

function appendOutbox(outbox: readonly SignedEnvelope<DistributedLeaseOutboxRecordV33_18>[], eventType: DistributedLeaseOutboxRecordV33_18['eventType'], decision: DistributedLeaseDecisionV33_18, now: Date, signer: SigningIdentity): SignedEnvelope<DistributedLeaseOutboxRecordV33_18>[] {
  const material = {
    version: '33.18' as const,
    eventId: `distributed-outbox-${randomUUID()}`,
    sequence: outbox.length + 1,
    eventType,
    authorityId: decision.authorityId,
    tenantId: decision.tenantId,
    serviceId: decision.serviceId,
    controllerId: decision.controllerId,
    fenceToken: decision.currentFenceToken,
    commandId: decision.commandId,
    decisionDigest: decision.decisionDigest,
    createdAt: now.toISOString(),
    previousEventDigest: outbox.at(-1)?.payload.eventDigest ?? sha256('distributed-lease-outbox-genesis-v33.18'),
    externalEffectsExecuted: 0 as const,
  };
  return [...outbox, signEnvelope({ ...material, eventDigest: sha256(material) }, signer)];
}


function immutableOutboxMaterial(event: DistributedLeaseOutboxRecordV33_18): Omit<DistributedLeaseOutboxRecordV33_18, 'eventDigest' | 'acknowledgedAt' | 'acknowledgedBy'> {
  const { eventDigest: _eventDigest, acknowledgedAt: _acknowledgedAt, acknowledgedBy: _acknowledgedBy, ...material } = event;
  return material;
}

function createAuthoritySnapshot(authorityId: string, authorityEpoch: number, fenceCounter: number, activeLeases: readonly DistributedLeaseGrantV33_18[], decisions: readonly SignedEnvelope<DistributedLeaseDecisionV33_18>[], outbox: readonly SignedEnvelope<DistributedLeaseOutboxRecordV33_18>[], lastObservedAt: Date, generatedAt: Date): DistributedLeaseSnapshotV33_18 {
  const material = { version: '33.18' as const, authorityId, authorityEpoch, fenceCounter, activeLeases: [...activeLeases], decisions: [...decisions], outbox: [...outbox], lastObservedAt: lastObservedAt.toISOString(), generatedAt: generatedAt.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return { ...material, snapshotDigest: sha256(material) };
}

function createWitnessSnapshot(witnessId: string, highestByLeaseKey: Readonly<Record<string, SignedEnvelope<MonotonicFenceWitnessReceiptV33_18>>>, generatedAt: Date): WitnessSnapshotV33_18 {
  const material = { version: '33.18' as const, witnessId, highestByLeaseKey, generatedAt: generatedAt.toISOString(), externalEffectsExecuted: 0 as const };
  return { ...material, snapshotDigest: sha256(material) };
}

function verifyGrant(grant: DistributedLeaseGrantV33_18, authorityId: string): void { const { leaseDigest, ...material } = grant; if (grant.version !== '33.18' || grant.authorityId !== authorityId || grant.fenceToken < 1 || grant.authorityExpanded !== false || grant.externalEffectsExecuted !== 0 || Date.parse(grant.acquiredAt) >= Date.parse(grant.expiresAt) || sha256(material) !== leaseDigest) throw new Error('distributed_lease_grant_invalid'); }
function matchesExpected(command: DistributedLeaseCommandV33_18, active: DistributedLeaseGrantV33_18): boolean { return command.controllerId === active.controllerId && command.expectedFenceToken === active.fenceToken && command.expectedLeaseDigest === active.leaseDigest; }
function leaseKey(tenantId: string, serviceId: string): string { return `${tenantId}\u0000${serviceId}`; }
function byLease(a: DistributedLeaseGrantV33_18, b: DistributedLeaseGrantV33_18): number { return leaseKey(a.tenantId, a.serviceId).localeCompare(leaseKey(b.tenantId, b.serviceId)); }
function byDecision(a: SignedEnvelope<DistributedLeaseDecisionV33_18>, b: SignedEnvelope<DistributedLeaseDecisionV33_18>): number { return a.payload.commandId.localeCompare(b.payload.commandId); }
function nonEmpty(value: string, code: string): string { const normalized = value.trim(); if (normalized === '') throw new Error(code); return normalized; }
function digest(value: string, code: string): string { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(code); return value; }
function positiveInteger(value: number, code: string): void { if (!Number.isInteger(value) || value <= 0) throw new Error(code); }
function positiveIntegerValue(value: number, code: string): number { positiveInteger(value, code); return value; }
function unique(values: readonly string[], code: string): readonly string[] { const rows = values.map((value) => nonEmpty(value, code)); if (new Set(rows).size !== rows.length) throw new Error(code); return [...rows].sort(); }
function acquireLockWithWait(path: string, timeoutMs: number): number { const start = Date.now(); for (;;) { try { return openSync(path, 'wx', 0o600); } catch { if (Date.now() - start >= timeoutMs) throw new Error('distributed_lease_store_locked'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); } } }
function releaseLock(fd: number, path: string): void { closeSync(fd); try { unlinkSync(path); } catch { /* best effort */ } }
function atomicReplace(path: string, contents: string): void { const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`; const fd = openSync(temporary, 'wx', 0o600); try { writeFileSync(fd, contents, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); } try { renameSync(temporary, path); } catch (error) { try { unlinkSync(temporary); } catch { /* best effort */ } throw error; } }
