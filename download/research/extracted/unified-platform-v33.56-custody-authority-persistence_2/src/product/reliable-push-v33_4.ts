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
import { dirname, resolve } from 'node:path';
import {
  KeyRegistry,
  type SignedEnvelope,
  type SigningIdentity,
  sha256,
  signEnvelope,
} from '../contracts/crypto.js';
import { withSovereignFileLease } from '../persistence/sovereign-file-lease.js';
import {
  DeviceBindingRegistry,
  type DeviceEnrollmentGrant,
  type DeviceRevocation,
  type PushDeliveryChallenge,
} from './device-push-v33_3.js';

export type PushTransportFault =
  | 'ACCEPT'
  | 'DROP_BEFORE_PROVIDER'
  | 'ACCEPT_RESPONSE_LOST'
  | 'DUPLICATE_NETWORK'
  | 'DELAY'
  | 'PERMANENT_REJECT';

export type PushOutboxState =
  | 'QUEUED'
  | 'LEASED'
  | 'RETRY_WAIT'
  | 'ACCEPTED'
  | 'EXPIRED'
  | 'REVOKED'
  | 'DEAD_LETTER';

export interface TransportNeutralPushRequest {
  readonly version: '33.4';
  readonly requestId: string;
  readonly signedDelivery: SignedEnvelope<PushDeliveryChallenge>;
  readonly deliveryDigest: string;
  readonly targetAdapterId: string;
  readonly providerDedupKey: string;
  readonly queuedAt: string;
  readonly expiresAt: string;
  readonly productionCeiling: 'shadow';
  readonly externalEffectsExecuted: 0;
  readonly requestDigest: string;
}

export interface PushTransportProviderReceipt {
  readonly version: '33.4';
  readonly adapterId: string;
  readonly providerMessageId: string;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly deliveryId: string;
  readonly providerDedupKey: string;
  readonly deliveryDigest: string;
  readonly acceptedAt: string;
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface PushOutboxAttempt {
  readonly attemptId: string;
  readonly workerId: string;
  readonly leasedAt: string;
  readonly leaseExpiresAt: string;
  readonly completedAt?: string;
  readonly outcome?: 'ACCEPTED' | 'TRANSIENT_FAILURE' | 'PERMANENT_FAILURE' | 'REVOKED' | 'EXPIRED';
  readonly errorCode?: string;
  readonly providerReceiptDigest?: string;
  readonly attemptDigest: string;
}

export interface PushOutboxItem {
  readonly version: '33.4';
  readonly request: TransportNeutralPushRequest;
  readonly state: PushOutboxState;
  readonly attempts: readonly PushOutboxAttempt[];
  readonly nextAttemptAt: string;
  readonly crashRecoveries: number;
  readonly acceptedReceipt?: SignedEnvelope<PushTransportProviderReceipt>;
  readonly terminalReason?: string;
  readonly externalEffectsExecuted: 0;
  readonly itemDigest: string;
}

export interface PushOutboxSnapshot {
  readonly version: '33.4';
  readonly items: readonly PushOutboxItem[];
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export interface SignedPushOutboxFileRecord {
  readonly version: '33.4';
  readonly snapshot: PushOutboxSnapshot;
  readonly persistedAt: string;
  readonly externalEffectsExecuted: 0;
  readonly recordDigest: string;
}

export interface PushOutboxLease {
  readonly requestId: string;
  readonly attemptId: string;
  readonly workerId: string;
  readonly request: TransportNeutralPushRequest;
  readonly leaseExpiresAt: string;
}

export interface PushOutboxTransport {
  enqueue(delivery: SignedEnvelope<PushDeliveryChallenge>, input: { readonly requestId: string; readonly targetAdapterId: string; readonly providerDedupKey: string; readonly queuedAt: string }, now?: Date): PushOutboxItem;
  leaseNext(workerId: string, now?: Date, leaseMs?: number): PushOutboxLease | undefined;
  accept(lease: PushOutboxLease, receipt: SignedEnvelope<PushTransportProviderReceipt>, now?: Date): PushOutboxItem;
  failTransient(lease: PushOutboxLease, errorCode: string, now?: Date, retryDelayMs?: number, maxAttempts?: number): PushOutboxItem;
  failPermanent(lease: PushOutboxLease, errorCode: string, now?: Date): PushOutboxItem;
  failRevoked(lease: PushOutboxLease, errorCode: string, now?: Date): PushOutboxItem;
  recoverExpiredLeases(now?: Date): number;
  get(requestId: string): PushOutboxItem | undefined;
  list(): readonly PushOutboxItem[];
  export(): PushOutboxSnapshot;
}

export class InMemoryPushOutbox implements PushOutboxTransport {
  readonly #items = new Map<string, PushOutboxItem>();
  readonly #deliveryDigests = new Map<string, string>();
  readonly #dedupKeys = new Map<string, string>();
  readonly #gatewayKeys: KeyRegistry;
  readonly #trustedGatewayIds: ReadonlySet<string>;
  readonly #providerKeys: KeyRegistry;
  readonly #trustedProviderIds: ReadonlySet<string>;

  constructor(gatewayKeys: KeyRegistry, trustedGatewayIds: readonly string[], providerKeys: KeyRegistry, trustedProviderIds: readonly string[]) {
    this.#gatewayKeys = gatewayKeys;
    this.#trustedGatewayIds = new Set(unique(trustedGatewayIds, 'trusted_push_gateway_invalid'));
    this.#providerKeys = providerKeys;
    this.#trustedProviderIds = new Set(unique(trustedProviderIds, 'trusted_push_provider_invalid'));
    if (this.#trustedGatewayIds.size === 0) throw new Error('trusted_push_gateway_required');
    if (this.#trustedProviderIds.size === 0) throw new Error('trusted_push_provider_required');
  }

  enqueue(
    delivery: SignedEnvelope<PushDeliveryChallenge>,
    input: { readonly requestId: string; readonly targetAdapterId: string; readonly providerDedupKey: string; readonly queuedAt: string },
    now = new Date(),
  ): PushOutboxItem {
    validDate(now);
    validateDeliveryEnvelopeShape(delivery);
    if (!this.#trustedGatewayIds.has(delivery.issuerKeyId) || !this.#gatewayKeys.verifyAt(delivery, delivery.payload.issuedAt) || !this.#gatewayKeys.verifyAt(delivery, now)) throw new Error('push_gateway_delivery_signature_invalid');
    const requestId = id(input.requestId, 'push_request_id_required');
    const targetAdapterId = id(input.targetAdapterId, 'push_adapter_id_required');
    const providerDedupKey = id(input.providerDedupKey, 'push_provider_dedup_key_required');
    const queuedAtMs = instant(input.queuedAt, 'push_queued_at_invalid');
    const expiresAtMs = instant(delivery.payload.expiresAt, 'push_expires_at_invalid');
    if (queuedAtMs > now.getTime() || expiresAtMs <= queuedAtMs || now.getTime() >= expiresAtMs) throw new Error('push_outbox_window_invalid');
    const deliveryDigest = sha256(delivery);
    const requestMaterial = {
      version: '33.4' as const,
      requestId,
      signedDelivery: delivery,
      deliveryDigest,
      targetAdapterId,
      providerDedupKey,
      queuedAt: input.queuedAt,
      expiresAt: delivery.payload.expiresAt,
      productionCeiling: 'shadow' as const,
      externalEffectsExecuted: 0 as const,
    };
    const request: TransportNeutralPushRequest = { ...requestMaterial, requestDigest: sha256(requestMaterial) };
    const prior = this.#items.get(requestId);
    if (prior !== undefined) {
      if (prior.request.requestDigest !== request.requestDigest) throw new Error('push_request_id_conflict');
      return structuredClone(prior);
    }
    const deliveryOwner = this.#deliveryDigests.get(deliveryDigest);
    if (deliveryOwner !== undefined && deliveryOwner !== requestId) throw new Error('push_delivery_already_queued');
    const scopedDedupKey = providerScope(targetAdapterId, delivery.payload.tenantId, providerDedupKey);
    const dedupOwner = this.#dedupKeys.get(scopedDedupKey);
    if (dedupOwner !== undefined && dedupOwner !== deliveryDigest) throw new Error('push_provider_dedup_key_conflict');
    const item = buildOutboxItem(request, 'QUEUED', [], input.queuedAt, 0);
    this.#items.set(requestId, item);
    this.#deliveryDigests.set(deliveryDigest, requestId);
    this.#dedupKeys.set(scopedDedupKey, deliveryDigest);
    return structuredClone(item);
  }

  leaseNext(workerId: string, now = new Date(), leaseMs = 30_000): PushOutboxLease | undefined {
    validDate(now);
    const worker = id(workerId, 'push_worker_id_required');
    positiveInteger(leaseMs, 'push_lease_ms_invalid');
    this.recoverExpiredLeases(now);
    const candidates = [...this.#items.values()]
      .filter((row) => (row.state === 'QUEUED' || row.state === 'RETRY_WAIT') && instant(row.nextAttemptAt, 'push_next_attempt_at_invalid') <= now.getTime())
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt) || a.request.requestId.localeCompare(b.request.requestId));
    for (const current of candidates) {
      if (now.getTime() >= instant(current.request.expiresAt, 'push_expires_at_invalid')) {
        this.#items.set(current.request.requestId, buildOutboxItem(current.request, 'EXPIRED', current.attempts, current.nextAttemptAt, current.crashRecoveries, undefined, 'push_expired_before_dispatch'));
        continue;
      }
      const attemptIndex = current.attempts.length + 1;
      const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
      const attemptMaterial = {
        attemptId: `${current.request.requestId}:attempt:${attemptIndex}`,
        workerId: worker,
        leasedAt: now.toISOString(),
        leaseExpiresAt,
      };
      const attempt: PushOutboxAttempt = { ...attemptMaterial, attemptDigest: sha256(attemptMaterial) };
      const updated = buildOutboxItem(current.request, 'LEASED', [...current.attempts, attempt], current.nextAttemptAt, current.crashRecoveries);
      this.#items.set(current.request.requestId, updated);
      return {
        requestId: current.request.requestId,
        attemptId: attempt.attemptId,
        workerId: worker,
        request: structuredClone(current.request),
        leaseExpiresAt,
      };
    }
    return undefined;
  }

  accept(lease: PushOutboxLease, receipt: SignedEnvelope<PushTransportProviderReceipt>, now = new Date()): PushOutboxItem {
    const current = this.#requiredLease(lease, now);
    validateProviderReceipt(receipt.payload, now);
    if (!this.#trustedProviderIds.has(receipt.issuerKeyId) || !this.#providerKeys.verifyAt(receipt, receipt.payload.acceptedAt) || !this.#providerKeys.verifyAt(receipt, now)) throw new Error('push_provider_receipt_signature_invalid');
    if (receipt.payload.adapterId !== current.request.targetAdapterId || receipt.payload.tenantId !== current.request.signedDelivery.payload.tenantId || receipt.payload.deviceId !== current.request.signedDelivery.payload.deviceId || receipt.payload.deliveryId !== current.request.signedDelivery.payload.deliveryId || receipt.payload.deliveryDigest !== current.request.deliveryDigest || receipt.payload.providerDedupKey !== current.request.providerDedupKey) {
      throw new Error('push_provider_receipt_binding_invalid');
    }
    if (current.acceptedReceipt !== undefined) {
      if (sha256(current.acceptedReceipt) !== sha256(receipt)) throw new Error('push_provider_receipt_conflict');
      return structuredClone(current);
    }
    const attempts = completeAttempt(current.attempts, lease, now, 'ACCEPTED', undefined, sha256(receipt));
    const updated = buildOutboxItem(current.request, 'ACCEPTED', attempts, current.nextAttemptAt, current.crashRecoveries, receipt);
    this.#items.set(current.request.requestId, updated);
    return structuredClone(updated);
  }

  failTransient(lease: PushOutboxLease, errorCode: string, now = new Date(), retryDelayMs = 1_000, maxAttempts = 5): PushOutboxItem {
    const current = this.#requiredLease(lease, now);
    const code = id(errorCode, 'push_transport_error_required');
    positiveInteger(retryDelayMs, 'push_retry_delay_invalid');
    positiveInteger(maxAttempts, 'push_max_attempts_invalid');
    const attempts = completeAttempt(current.attempts, lease, now, 'TRANSIENT_FAILURE', code);
    const terminal = attempts.length >= maxAttempts;
    const updated = buildOutboxItem(
      current.request,
      terminal ? 'DEAD_LETTER' : 'RETRY_WAIT',
      attempts,
      terminal ? current.nextAttemptAt : new Date(now.getTime() + retryDelayMs).toISOString(),
      current.crashRecoveries,
      undefined,
      terminal ? `max_attempts:${code}` : undefined,
    );
    this.#items.set(current.request.requestId, updated);
    return structuredClone(updated);
  }

  failPermanent(lease: PushOutboxLease, errorCode: string, now = new Date()): PushOutboxItem {
    return this.#terminalFailure(lease, errorCode, 'PERMANENT_FAILURE', 'DEAD_LETTER', now);
  }

  failRevoked(lease: PushOutboxLease, errorCode: string, now = new Date()): PushOutboxItem {
    return this.#terminalFailure(lease, errorCode, 'REVOKED', 'REVOKED', now);
  }

  recoverExpiredLeases(now = new Date()): number {
    validDate(now);
    let recovered = 0;
    for (const [requestId, current] of this.#items) {
      if (current.state !== 'LEASED') continue;
      const active = current.attempts.at(-1);
      if (active === undefined || active.outcome !== undefined) throw new Error('push_active_lease_missing');
      if (instant(active.leaseExpiresAt, 'push_lease_expiry_invalid') > now.getTime()) continue;
      const attempts = completeAttempt(current.attempts, {
        requestId,
        attemptId: active.attemptId,
        workerId: active.workerId,
        request: current.request,
        leaseExpiresAt: active.leaseExpiresAt,
      }, now, 'TRANSIENT_FAILURE', 'worker_lease_expired');
      const state: PushOutboxState = now.getTime() >= instant(current.request.expiresAt, 'push_expires_at_invalid') ? 'EXPIRED' : 'RETRY_WAIT';
      const updated = buildOutboxItem(
        current.request,
        state,
        attempts,
        now.toISOString(),
        current.crashRecoveries + 1,
        undefined,
        state === 'EXPIRED' ? 'push_expired_during_recovery' : undefined,
      );
      this.#items.set(requestId, updated);
      recovered += 1;
    }
    return recovered;
  }

  get(requestId: string): PushOutboxItem | undefined {
    const row = this.#items.get(id(requestId, 'push_request_id_required'));
    if (row === undefined) return undefined;
    verifyOutboxItem(row);
    return structuredClone(row);
  }

  list(): readonly PushOutboxItem[] {
    return [...this.#items.values()]
      .sort((a, b) => a.request.requestId.localeCompare(b.request.requestId))
      .map((row) => {
        verifyOutboxItem(row);
        return structuredClone(row);
      });
  }

  export(): PushOutboxSnapshot {
    const items = this.list();
    const material = { version: '33.4' as const, items, externalEffectsExecuted: 0 as const };
    return { ...material, snapshotDigest: sha256(material) };
  }

  static restore(snapshot: PushOutboxSnapshot, gatewayKeys: KeyRegistry, trustedGatewayIds: readonly string[], providerKeys: KeyRegistry, trustedProviderIds: readonly string[]): InMemoryPushOutbox {
    const { snapshotDigest, ...material } = snapshot;
    if (snapshot.version !== '33.4' || snapshot.externalEffectsExecuted !== 0 || sha256(material) !== snapshotDigest) throw new Error('push_outbox_snapshot_invalid');
    const store = new InMemoryPushOutbox(gatewayKeys, trustedGatewayIds, providerKeys, trustedProviderIds);
    for (const row of snapshot.items) {
      verifyOutboxItem(row);
      if (store.#items.has(row.request.requestId)) throw new Error('push_outbox_restore_duplicate');
      const deliveryOwner = store.#deliveryDigests.get(row.request.deliveryDigest);
      if (deliveryOwner !== undefined) throw new Error('push_outbox_restore_delivery_duplicate');
      const scopedDedupKey = providerScope(row.request.targetAdapterId, row.request.signedDelivery.payload.tenantId, row.request.providerDedupKey);
      const dedupOwner = store.#dedupKeys.get(scopedDedupKey);
      if (dedupOwner !== undefined && dedupOwner !== row.request.deliveryDigest) throw new Error('push_outbox_restore_dedup_conflict');
      store.#items.set(row.request.requestId, structuredClone(row));
      store.#deliveryDigests.set(row.request.deliveryDigest, row.request.requestId);
      store.#dedupKeys.set(scopedDedupKey, row.request.deliveryDigest);
    }
    return store;
  }

  #terminalFailure(
    lease: PushOutboxLease,
    errorCode: string,
    outcome: 'PERMANENT_FAILURE' | 'REVOKED',
    state: 'DEAD_LETTER' | 'REVOKED',
    now: Date,
  ): PushOutboxItem {
    const current = this.#requiredLease(lease, now);
    const code = id(errorCode, 'push_transport_error_required');
    const attempts = completeAttempt(current.attempts, lease, now, outcome, code);
    const updated = buildOutboxItem(current.request, state, attempts, current.nextAttemptAt, current.crashRecoveries, undefined, code);
    this.#items.set(current.request.requestId, updated);
    return structuredClone(updated);
  }

  #requiredLease(lease: PushOutboxLease, now: Date): PushOutboxItem {
    validDate(now);
    const current = this.#items.get(id(lease.requestId, 'push_request_id_required'));
    if (current === undefined) throw new Error('push_outbox_item_missing');
    verifyOutboxItem(current);
    if (current.state === 'ACCEPTED') {
      const completed = current.attempts.at(-1);
      if (completed === undefined || completed.outcome !== 'ACCEPTED' || completed.attemptId !== lease.attemptId || completed.workerId !== lease.workerId || lease.request.requestDigest !== current.request.requestDigest || completed.leaseExpiresAt !== lease.leaseExpiresAt) throw new Error('push_lease_binding_invalid');
      return current;
    }
    if (current.state !== 'LEASED') throw new Error('push_outbox_not_leased');
    const active = current.attempts.at(-1);
    if (active === undefined || active.outcome !== undefined) throw new Error('push_active_lease_missing');
    if (active.attemptId !== lease.attemptId || active.workerId !== lease.workerId || lease.request.requestDigest !== current.request.requestDigest) throw new Error('push_lease_binding_invalid');
    if (active.leaseExpiresAt !== lease.leaseExpiresAt) throw new Error('push_lease_binding_invalid');
    if (now.getTime() >= instant(active.leaseExpiresAt, 'push_lease_expiry_invalid')) throw new Error('push_lease_expired');
    return current;
  }
}

export class FilePushOutbox implements PushOutboxTransport {
  readonly #path: string;
  readonly #stateIdentity: SigningIdentity;
  readonly #stateKeys: KeyRegistry;
  readonly #trustedStateSignerIds: ReadonlySet<string>;
  readonly #gatewayKeys: KeyRegistry;
  readonly #trustedGatewayIds: readonly string[];
  readonly #providerKeys: KeyRegistry;
  readonly #trustedProviderIds: readonly string[];

  constructor(
    path: string,
    stateIdentity: SigningIdentity,
    stateKeys: KeyRegistry,
    trustedStateSignerIds: readonly string[],
    gatewayKeys: KeyRegistry,
    trustedGatewayIds: readonly string[],
    providerKeys: KeyRegistry,
    trustedProviderIds: readonly string[],
  ) {
    if (path.trim() === '') throw new Error('push_outbox_path_required');
    this.#path = resolve(path);
    this.#stateIdentity = stateIdentity;
    this.#stateKeys = stateKeys;
    this.#trustedStateSignerIds = new Set(unique(trustedStateSignerIds, 'trusted_outbox_state_signer_invalid'));
    this.#gatewayKeys = gatewayKeys;
    this.#trustedGatewayIds = unique(trustedGatewayIds, 'trusted_push_gateway_invalid');
    this.#providerKeys = providerKeys;
    this.#trustedProviderIds = unique(trustedProviderIds, 'trusted_push_provider_invalid');
    if (this.#trustedStateSignerIds.size === 0 || !this.#trustedStateSignerIds.has(stateIdentity.keyId)) throw new Error('trusted_outbox_state_signer_required');
    if (stateKeys.fingerprint(stateIdentity.keyId) === undefined || !stateKeys.verify(signEnvelope({ version: '33.4', purpose: 'outbox-state-key-binding' }, stateIdentity))) throw new Error('outbox_state_signing_key_invalid');
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    if (!existsSync(this.#path)) this.#persist(new InMemoryPushOutbox(this.#gatewayKeys, this.#trustedGatewayIds, this.#providerKeys, this.#trustedProviderIds), new Date());
  }

  enqueue(delivery: SignedEnvelope<PushDeliveryChallenge>, input: { readonly requestId: string; readonly targetAdapterId: string; readonly providerDedupKey: string; readonly queuedAt: string }, now = new Date()): PushOutboxItem {
    return this.#mutate((store) => store.enqueue(delivery, input, now));
  }

  leaseNext(workerId: string, now = new Date(), leaseMs = 30_000): PushOutboxLease | undefined {
    return this.#mutate((store) => store.leaseNext(workerId, now, leaseMs));
  }

  accept(lease: PushOutboxLease, receipt: SignedEnvelope<PushTransportProviderReceipt>, now = new Date()): PushOutboxItem {
    return this.#mutate((store) => store.accept(lease, receipt, now));
  }

  failTransient(lease: PushOutboxLease, errorCode: string, now = new Date(), retryDelayMs = 1_000, maxAttempts = 5): PushOutboxItem {
    return this.#mutate((store) => store.failTransient(lease, errorCode, now, retryDelayMs, maxAttempts));
  }

  failPermanent(lease: PushOutboxLease, errorCode: string, now = new Date()): PushOutboxItem {
    return this.#mutate((store) => store.failPermanent(lease, errorCode, now));
  }

  failRevoked(lease: PushOutboxLease, errorCode: string, now = new Date()): PushOutboxItem {
    return this.#mutate((store) => store.failRevoked(lease, errorCode, now));
  }

  recoverExpiredLeases(now = new Date()): number {
    return this.#mutate((store) => store.recoverExpiredLeases(now));
  }

  get(requestId: string): PushOutboxItem | undefined {
    return this.#read().get(requestId);
  }

  list(): readonly PushOutboxItem[] {
    return this.#read().list();
  }

  export(): PushOutboxSnapshot {
    return this.#read().export();
  }

  #read(): InMemoryPushOutbox {
    return withSovereignFileLease(`${this.#path}.lock`, () => this.#load());
  }

  #mutate<T>(operation: (store: InMemoryPushOutbox) => T): T {
    return withSovereignFileLease(`${this.#path}.lock`, () => {
      const store = this.#load();
      const result = operation(store);
      this.#persist(store, new Date());
      return result;
    });
  }

  #load(): InMemoryPushOutbox {
    try {
      const envelope = JSON.parse(readFileSync(this.#path, 'utf8')) as SignedEnvelope<SignedPushOutboxFileRecord>;
      const payload = envelope.payload;
      if (!this.#trustedStateSignerIds.has(envelope.issuerKeyId) || !this.#stateKeys.verifyAt(envelope, payload.persistedAt)) throw new Error('signature');
      const { recordDigest, ...material } = payload;
      if (payload.version !== '33.4' || payload.externalEffectsExecuted !== 0 || sha256(material) !== recordDigest) throw new Error('digest');
      return InMemoryPushOutbox.restore(payload.snapshot, this.#gatewayKeys, this.#trustedGatewayIds, this.#providerKeys, this.#trustedProviderIds);
    } catch {
      throw new Error('push_outbox_file_tampered');
    }
  }

  #persist(store: InMemoryPushOutbox, now: Date): void {
    const material = { version: '33.4' as const, snapshot: store.export(), persistedAt: now.toISOString(), externalEffectsExecuted: 0 as const };
    const payload: SignedPushOutboxFileRecord = { ...material, recordDigest: sha256(material) };
    const envelope = signEnvelope(payload, this.#stateIdentity);
    atomicWrite(this.#path, `${JSON.stringify(envelope, null, 2)}\n`);
  }
}

export class TransientPushTransportError extends Error {}
export class PermanentPushTransportError extends Error {}

export interface PushTransportAdapter {
  readonly adapterId: string;
  send(request: TransportNeutralPushRequest, now?: Date): SignedEnvelope<PushTransportProviderReceipt>;
}

export interface SimulatedTransportMetrics {
  readonly adapterId: string;
  readonly sendCalls: number;
  readonly uniqueProviderAcceptances: number;
  readonly duplicateSuppressions: number;
  readonly droppedBeforeProvider: number;
  readonly acceptedResponseLost: number;
  readonly delayed: number;
  readonly permanentRejects: number;
}

export class LossySimulatedPushAdapter implements PushTransportAdapter {
  readonly adapterId: string;
  readonly #identity: SigningIdentity;
  readonly #keys: KeyRegistry;
  readonly #faults: PushTransportFault[];
  readonly #accepted = new Map<string, SignedEnvelope<PushTransportProviderReceipt>>();
  #sendCalls = 0;
  #duplicateSuppressions = 0;
  #droppedBeforeProvider = 0;
  #acceptedResponseLost = 0;
  #delayed = 0;
  #permanentRejects = 0;

  constructor(adapterId: string, identity: SigningIdentity, keys: KeyRegistry, faults: readonly PushTransportFault[] = []) {
    this.adapterId = id(adapterId, 'push_adapter_id_required');
    this.#identity = identity;
    this.#keys = keys;
    this.#faults = [...faults];
    if (keys.fingerprint(identity.keyId) === undefined || !keys.verify(signEnvelope({ version: '33.4', purpose: 'push-adapter-binding' }, identity))) {
      throw new Error('push_adapter_signing_key_invalid');
    }
  }

  send(request: TransportNeutralPushRequest, now = new Date()): SignedEnvelope<PushTransportProviderReceipt> {
    validDate(now);
    verifyTransportRequest(request);
    if (request.targetAdapterId !== this.adapterId) throw new PermanentPushTransportError('push_transport_adapter_mismatch');
    this.#sendCalls += 1;
    const fault = this.#faults.shift() ?? 'ACCEPT';
    if (fault === 'DROP_BEFORE_PROVIDER') {
      this.#droppedBeforeProvider += 1;
      throw new TransientPushTransportError('push_transport_dropped');
    }
    if (fault === 'DELAY') {
      this.#delayed += 1;
      throw new TransientPushTransportError('push_transport_delayed');
    }
    if (fault === 'PERMANENT_REJECT') {
      this.#permanentRejects += 1;
      throw new PermanentPushTransportError('push_transport_permanent_reject');
    }
    if (fault === 'DUPLICATE_NETWORK') {
      const receipt = this.#accept(request, now);
      this.#accept(request, now);
      return receipt;
    }
    if (fault === 'ACCEPT_RESPONSE_LOST') {
      this.#accept(request, now);
      this.#acceptedResponseLost += 1;
      throw new TransientPushTransportError('push_transport_response_lost');
    }
    return this.#accept(request, now);
  }

  metrics(): SimulatedTransportMetrics {
    return {
      adapterId: this.adapterId,
      sendCalls: this.#sendCalls,
      uniqueProviderAcceptances: this.#accepted.size,
      duplicateSuppressions: this.#duplicateSuppressions,
      droppedBeforeProvider: this.#droppedBeforeProvider,
      acceptedResponseLost: this.#acceptedResponseLost,
      delayed: this.#delayed,
      permanentRejects: this.#permanentRejects,
    };
  }

  #accept(request: TransportNeutralPushRequest, now: Date): SignedEnvelope<PushTransportProviderReceipt> {
    const acceptanceKey = providerScope(this.adapterId, request.signedDelivery.payload.tenantId, request.providerDedupKey);
    const prior = this.#accepted.get(acceptanceKey);
    if (prior !== undefined) {
      if (prior.payload.deliveryDigest !== request.deliveryDigest) throw new PermanentPushTransportError('push_provider_dedup_collision');
      this.#duplicateSuppressions += 1;
      return structuredClone(prior);
    }
    const material = {
      version: '33.4' as const,
      adapterId: this.adapterId,
      providerMessageId: `sim-${sha256({ adapterId: this.adapterId, tenantId: request.signedDelivery.payload.tenantId, dedup: request.providerDedupKey }).slice(0, 24)}`,
      tenantId: request.signedDelivery.payload.tenantId,
      deviceId: request.signedDelivery.payload.deviceId,
      deliveryId: request.signedDelivery.payload.deliveryId,
      providerDedupKey: request.providerDedupKey,
      deliveryDigest: request.deliveryDigest,
      acceptedAt: now.toISOString(),
      externalEffectsExecuted: 0 as const,
    };
    const payload: PushTransportProviderReceipt = { ...material, receiptDigest: sha256(material) };
    const receipt = signEnvelope(payload, this.#identity);
    this.#accepted.set(acceptanceKey, receipt);
    return structuredClone(receipt);
  }
}

export interface DispatchResult {
  readonly status: 'IDLE' | 'ACCEPTED' | 'RETRY_SCHEDULED' | 'DEAD_LETTER' | 'REVOKED';
  readonly requestId?: string;
  readonly item?: PushOutboxItem;
}

export class ReliablePushDispatcher {
  readonly #outbox: PushOutboxTransport;
  readonly #devices: DeviceBindingRegistry;
  readonly #adapter: PushTransportAdapter;
  readonly #gatewayKeys: KeyRegistry;
  readonly #trustedGatewayIds: ReadonlySet<string>;
  readonly #providerKeys: KeyRegistry;
  readonly #trustedProviderIds: ReadonlySet<string>;

  constructor(
    outbox: PushOutboxTransport,
    devices: DeviceBindingRegistry,
    adapter: PushTransportAdapter,
    gatewayKeys: KeyRegistry,
    trustedGatewayIds: readonly string[],
    providerKeys: KeyRegistry,
    trustedProviderIds: readonly string[],
  ) {
    this.#outbox = outbox;
    this.#devices = devices;
    this.#adapter = adapter;
    this.#gatewayKeys = gatewayKeys;
    this.#trustedGatewayIds = new Set(unique(trustedGatewayIds, 'trusted_push_gateway_invalid'));
    this.#providerKeys = providerKeys;
    this.#trustedProviderIds = new Set(unique(trustedProviderIds, 'trusted_push_provider_invalid'));
    if (this.#trustedGatewayIds.size === 0) throw new Error('trusted_push_gateway_required');
    if (this.#trustedProviderIds.size === 0) throw new Error('trusted_push_provider_required');
  }

  dispatchOne(workerId: string, now = new Date(), options: { readonly leaseMs?: number; readonly retryDelayMs?: number; readonly maxAttempts?: number } = {}): DispatchResult {
    const lease = this.#outbox.leaseNext(workerId, now, options.leaseMs ?? 30_000);
    if (lease === undefined) return { status: 'IDLE' };
    const deliveryEnvelope = lease.request.signedDelivery;
    const delivery = deliveryEnvelope.payload;
    try {
      if (!this.#trustedGatewayIds.has(deliveryEnvelope.issuerKeyId) || !this.#gatewayKeys.verifyAt(deliveryEnvelope, delivery.issuedAt) || !this.#gatewayKeys.verifyAt(deliveryEnvelope, now)) {
        throw new PermanentPushTransportError('push_gateway_delivery_signature_invalid');
      }
      const device = this.#devices.requireActive(delivery.tenantId, delivery.approverId, delivery.deviceId, 'APPROVAL_RECEIVE', now);
      if (device.enrollmentDigest !== delivery.deviceEnrollmentDigest) throw new Error('push_device_enrollment_changed');
      const receipt = this.#adapter.send(lease.request, now);
      this.#verifyProviderReceipt(receipt, lease.request, now);
      const item = this.#outbox.accept(lease, receipt, now);
      return { status: 'ACCEPTED', requestId: lease.requestId, item };
    } catch (error) {
      const code = errorCode(error);
      if (code === 'device_revoked' || code === 'device_credential_inactive' || code === 'push_device_enrollment_changed' || code === 'device_not_registered') {
        const item = this.#outbox.failRevoked(lease, code, now);
        return { status: 'REVOKED', requestId: lease.requestId, item };
      }
      if (error instanceof PermanentPushTransportError || code === 'push_provider_receipt_signature_invalid' || code === 'push_provider_receipt_binding_invalid') {
        const item = this.#outbox.failPermanent(lease, code, now);
        return { status: 'DEAD_LETTER', requestId: lease.requestId, item };
      }
      const item = this.#outbox.failTransient(lease, code, now, options.retryDelayMs ?? 1_000, options.maxAttempts ?? 5);
      return { status: item.state === 'DEAD_LETTER' ? 'DEAD_LETTER' : 'RETRY_SCHEDULED', requestId: lease.requestId, item };
    }
  }

  #verifyProviderReceipt(receipt: SignedEnvelope<PushTransportProviderReceipt>, request: TransportNeutralPushRequest, now: Date): void {
    if (!this.#trustedProviderIds.has(receipt.issuerKeyId) || !this.#providerKeys.verifyAt(receipt, receipt.payload.acceptedAt) || !this.#providerKeys.verifyAt(receipt, now)) {
      throw new PermanentPushTransportError('push_provider_receipt_signature_invalid');
    }
    validateProviderReceipt(receipt.payload, now);
    if (receipt.payload.adapterId !== this.#adapter.adapterId || receipt.payload.adapterId !== request.targetAdapterId || receipt.payload.tenantId !== request.signedDelivery.payload.tenantId || receipt.payload.deviceId !== request.signedDelivery.payload.deviceId || receipt.payload.deliveryId !== request.signedDelivery.payload.deliveryId || receipt.payload.deliveryDigest !== request.deliveryDigest || receipt.payload.providerDedupKey !== request.providerDedupKey) {
      throw new PermanentPushTransportError('push_provider_receipt_binding_invalid');
    }
  }
}

export interface DeviceSessionRecord {
  readonly version: '33.4';
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly enrollmentDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly externalEffectsExecuted: 0;
  readonly sessionDigest: string;
}

export class DeviceSessionRegistry {
  readonly #devices: DeviceBindingRegistry;
  readonly #sessions = new Map<string, DeviceSessionRecord>();
  readonly #nonces = new Map<string, string>();

  constructor(devices: DeviceBindingRegistry) {
    this.#devices = devices;
  }

  open(input: Omit<DeviceSessionRecord, 'version' | 'enrollmentDigest' | 'externalEffectsExecuted' | 'sessionDigest'>, now = new Date()): DeviceSessionRecord {
    validDate(now);
    const issuedAt = instant(input.issuedAt, 'device_session_issued_at_invalid');
    const expiresAt = instant(input.expiresAt, 'device_session_expires_at_invalid');
    if (issuedAt > now.getTime() || expiresAt <= issuedAt || now.getTime() >= expiresAt) throw new Error('device_session_window_invalid');
    const device = this.#devices.requireActive(input.tenantId, input.userId, input.deviceId, 'APPROVAL_RECEIVE', now);
    const material = {
      version: '33.4' as const,
      sessionId: id(input.sessionId, 'device_session_id_required'),
      tenantId: id(input.tenantId, 'tenant_id_required'),
      userId: id(input.userId, 'device_user_required'),
      deviceId: id(input.deviceId, 'device_id_required'),
      enrollmentDigest: device.enrollmentDigest,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      nonce: id(input.nonce, 'device_session_nonce_required'),
      externalEffectsExecuted: 0 as const,
    };
    const record: DeviceSessionRecord = { ...material, sessionDigest: sha256(material) };
    const prior = this.#sessions.get(record.sessionId);
    if (prior !== undefined) {
      if (prior.sessionDigest !== record.sessionDigest) throw new Error('device_session_id_conflict');
      return structuredClone(prior);
    }
    const nonceOwner = this.#nonces.get(record.nonce);
    if (nonceOwner !== undefined && nonceOwner !== record.sessionDigest) throw new Error('device_session_nonce_replay');
    this.#sessions.set(record.sessionId, record);
    this.#nonces.set(record.nonce, record.sessionDigest);
    return structuredClone(record);
  }

  requireActive(sessionId: string, now = new Date()): DeviceSessionRecord {
    validDate(now);
    const record = this.#sessions.get(id(sessionId, 'device_session_id_required'));
    if (record === undefined) throw new Error('device_session_missing');
    verifyDeviceSession(record);
    if (now.getTime() >= instant(record.expiresAt, 'device_session_expires_at_invalid')) throw new Error('device_session_expired');
    const device = this.#devices.requireActive(record.tenantId, record.userId, record.deviceId, 'APPROVAL_RECEIVE', now);
    if (device.enrollmentDigest !== record.enrollmentDigest) throw new Error('device_session_enrollment_changed');
    return structuredClone(record);
  }

  export(): readonly DeviceSessionRecord[] {
    return [...this.#sessions.values()].sort((a, b) => a.sessionId.localeCompare(b.sessionId)).map((row) => structuredClone(row));
  }

  static restore(rows: readonly DeviceSessionRecord[], devices: DeviceBindingRegistry): DeviceSessionRegistry {
    const registry = new DeviceSessionRegistry(devices);
    for (const row of rows) {
      verifyDeviceSession(row);
      if (registry.#sessions.has(row.sessionId)) throw new Error('device_session_restore_duplicate');
      const nonceOwner = registry.#nonces.get(row.nonce);
      if (nonceOwner !== undefined && nonceOwner !== row.sessionDigest) throw new Error('device_session_restore_nonce_conflict');
      registry.#sessions.set(row.sessionId, structuredClone(row));
      registry.#nonces.set(row.nonce, row.sessionDigest);
    }
    return registry;
  }
}

export interface DeviceReplacementGrant {
  readonly version: '33.4';
  readonly replacementId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly oldDeviceId: string;
  readonly oldEnrollmentDigest: string;
  readonly newDeviceId: string;
  readonly newEnrollmentDigest: string;
  readonly issuedAt: string;
  readonly notAfter: string;
  readonly nonce: string;
  readonly reason: string;
  readonly productionCeiling: 'shadow';
}

export interface DeviceReplacementReceipt {
  readonly version: '33.4';
  readonly replacementId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly oldDeviceId: string;
  readonly newDeviceId: string;
  readonly oldRevocationDigest: string;
  readonly newEnrollmentDigest: string;
  readonly grantDigest: string;
  readonly completedAt: string;
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export class DeviceRecoveryCoordinator {
  readonly #devices: DeviceBindingRegistry;
  readonly #registrarKeys: KeyRegistry;
  readonly #trustedRegistrarIds: ReadonlySet<string>;
  readonly #completed = new Map<string, DeviceReplacementReceipt>();
  readonly #nonces = new Map<string, string>();

  constructor(devices: DeviceBindingRegistry, registrarKeys: KeyRegistry, trustedRegistrarIds: readonly string[]) {
    this.#devices = devices;
    this.#registrarKeys = registrarKeys;
    this.#trustedRegistrarIds = new Set(unique(trustedRegistrarIds, 'trusted_registrar_invalid'));
    if (this.#trustedRegistrarIds.size === 0) throw new Error('trusted_registrar_required');
  }

  replace(
    grant: SignedEnvelope<DeviceReplacementGrant>,
    oldRevocation: SignedEnvelope<DeviceRevocation>,
    newEnrollment: SignedEnvelope<DeviceEnrollmentGrant>,
    now = new Date(),
  ): DeviceReplacementReceipt {
    validDate(now);
    validateReplacementGrant(grant.payload, now);
    this.#verifyRegistrar(grant, grant.payload.issuedAt, now, 'device_replacement_grant_invalid');
    this.#verifyRegistrar(oldRevocation, oldRevocation.payload.revokedAt, now, 'device_replacement_revocation_invalid');
    this.#verifyRegistrar(newEnrollment, newEnrollment.payload.issuedAt, now, 'device_replacement_enrollment_invalid');
    const payload = grant.payload;
    const grantDigest = sha256(grant);
    const prior = this.#completed.get(payload.replacementId);
    if (prior !== undefined) {
      if (prior.grantDigest !== grantDigest) throw new Error('device_replacement_id_conflict');
      return structuredClone(prior);
    }
    const noncePrior = this.#nonces.get(payload.nonce);
    if (noncePrior !== undefined && noncePrior !== grantDigest) throw new Error('device_replacement_nonce_replay');
    const old = this.#devices.get(payload.tenantId, payload.oldDeviceId, now);
    if (old.enrollment.payload.userId !== payload.userId || old.enrollmentDigest !== payload.oldEnrollmentDigest) throw new Error('device_replacement_old_binding_invalid');
    if (oldRevocation.payload.tenantId !== payload.tenantId || oldRevocation.payload.deviceId !== payload.oldDeviceId || oldRevocation.payload.enrollmentDigest !== payload.oldEnrollmentDigest) {
      throw new Error('device_replacement_revocation_binding_invalid');
    }
    const next = newEnrollment.payload;
    if (next.tenantId !== payload.tenantId || next.userId !== payload.userId || next.deviceId !== payload.newDeviceId || sha256(newEnrollment) !== payload.newEnrollmentDigest) {
      throw new Error('device_replacement_new_binding_invalid');
    }
    const simulation = DeviceBindingRegistry.restore(this.#devices.export(), this.#registrarKeys, [...this.#trustedRegistrarIds], now);
    simulation.revoke(oldRevocation, now);
    simulation.enroll(newEnrollment, now);
    this.#devices.revoke(oldRevocation, now);
    const registered = this.#devices.enroll(newEnrollment, now);
    const material = {
      version: '33.4' as const,
      replacementId: payload.replacementId,
      tenantId: payload.tenantId,
      userId: payload.userId,
      oldDeviceId: payload.oldDeviceId,
      newDeviceId: payload.newDeviceId,
      oldRevocationDigest: sha256(oldRevocation),
      newEnrollmentDigest: registered.enrollmentDigest,
      grantDigest,
      completedAt: now.toISOString(),
      externalEffectsExecuted: 0 as const,
    };
    const receipt: DeviceReplacementReceipt = { ...material, receiptDigest: sha256(material) };
    this.#completed.set(payload.replacementId, receipt);
    this.#nonces.set(payload.nonce, grantDigest);
    return structuredClone(receipt);
  }

  #verifyRegistrar<T>(envelope: SignedEnvelope<T>, occurredAt: string, now: Date, code: string): void {
    if (!this.#trustedRegistrarIds.has(envelope.issuerKeyId) || !this.#registrarKeys.verifyAt(envelope, occurredAt) || !this.#registrarKeys.verifyAt(envelope, now)) throw new Error(code);
  }
}

export interface TransportReliabilityEvidence {
  readonly version: '33.4';
  readonly requests: number;
  readonly accepted: number;
  readonly retryWait: number;
  readonly deadLetter: number;
  readonly revoked: number;
  readonly expired: number;
  readonly attempts: number;
  readonly crashRecoveries: number;
  readonly successRatePct: number;
  readonly duplicateSuppressions: number;
  readonly uniqueProviderAcceptances: number;
  readonly externalEffectsExecuted: 0;
  readonly evidenceClass: 'SIMULATED_FAULT_INJECTION';
  readonly g3Eligible: false;
  readonly evidenceDigest: string;
}

export function evaluateTransportReliability(outbox: PushOutboxTransport, metrics: SimulatedTransportMetrics): TransportReliabilityEvidence {
  const rows = outbox.list();
  const counts = (state: PushOutboxState): number => rows.filter((row) => row.state === state).length;
  const attempts = rows.reduce((sum, row) => sum + row.attempts.length, 0);
  const crashRecoveries = rows.reduce((sum, row) => sum + row.crashRecoveries, 0);
  const accepted = counts('ACCEPTED');
  const requests = rows.length;
  const material = {
    version: '33.4' as const,
    requests,
    accepted,
    retryWait: counts('RETRY_WAIT') + counts('QUEUED') + counts('LEASED'),
    deadLetter: counts('DEAD_LETTER'),
    revoked: counts('REVOKED'),
    expired: counts('EXPIRED'),
    attempts,
    crashRecoveries,
    successRatePct: requests === 0 ? 0 : Number(((accepted / requests) * 100).toFixed(2)),
    duplicateSuppressions: metrics.duplicateSuppressions,
    uniqueProviderAcceptances: metrics.uniqueProviderAcceptances,
    externalEffectsExecuted: 0 as const,
    evidenceClass: 'SIMULATED_FAULT_INJECTION' as const,
    g3Eligible: false as const,
  };
  return { ...material, evidenceDigest: sha256(material) };
}

function buildOutboxItem(
  request: TransportNeutralPushRequest,
  state: PushOutboxState,
  attempts: readonly PushOutboxAttempt[],
  nextAttemptAt: string,
  crashRecoveries: number,
  acceptedReceipt?: SignedEnvelope<PushTransportProviderReceipt>,
  terminalReason?: string,
): PushOutboxItem {
  const material = {
    version: '33.4' as const,
    request,
    state,
    attempts: Object.freeze([...attempts]),
    nextAttemptAt,
    crashRecoveries,
    ...(acceptedReceipt === undefined ? {} : { acceptedReceipt }),
    ...(terminalReason === undefined ? {} : { terminalReason }),
    externalEffectsExecuted: 0 as const,
  };
  const item: PushOutboxItem = { ...material, itemDigest: sha256(material) };
  verifyOutboxItem(item);
  return item;
}

function completeAttempt(
  attempts: readonly PushOutboxAttempt[],
  lease: PushOutboxLease,
  now: Date,
  outcome: NonNullable<PushOutboxAttempt['outcome']>,
  errorCode?: string,
  providerReceiptDigest?: string,
): readonly PushOutboxAttempt[] {
  const active = attempts.at(-1);
  if (active === undefined || active.attemptId !== lease.attemptId || active.workerId !== lease.workerId || active.outcome !== undefined) throw new Error('push_lease_binding_invalid');
  const material = {
    attemptId: active.attemptId,
    workerId: active.workerId,
    leasedAt: active.leasedAt,
    leaseExpiresAt: active.leaseExpiresAt,
    completedAt: now.toISOString(),
    outcome,
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(providerReceiptDigest === undefined ? {} : { providerReceiptDigest }),
  };
  const completed: PushOutboxAttempt = { ...material, attemptDigest: sha256(material) };
  return Object.freeze([...attempts.slice(0, -1), completed]);
}

function verifyOutboxItem(item: PushOutboxItem): void {
  if (item.version !== '33.4' || item.externalEffectsExecuted !== 0) throw new Error('push_outbox_item_invalid');
  verifyTransportRequest(item.request);
  instant(item.nextAttemptAt, 'push_next_attempt_at_invalid');
  if (!Number.isSafeInteger(item.crashRecoveries) || item.crashRecoveries < 0) throw new Error('push_crash_recovery_count_invalid');
  let open = 0;
  for (const attempt of item.attempts) {
    const { attemptDigest, ...material } = attempt;
    if (sha256(material) !== attemptDigest) throw new Error('push_attempt_digest_invalid');
    id(attempt.attemptId, 'push_attempt_id_required');
    id(attempt.workerId, 'push_worker_id_required');
    instant(attempt.leasedAt, 'push_leased_at_invalid');
    instant(attempt.leaseExpiresAt, 'push_lease_expiry_invalid');
    if (attempt.outcome === undefined) open += 1;
  }
  if ((item.state === 'LEASED' && open !== 1) || (item.state !== 'LEASED' && open !== 0)) throw new Error('push_outbox_lease_state_invalid');
  if (item.state === 'ACCEPTED') {
    if (item.acceptedReceipt === undefined) throw new Error('push_outbox_acceptance_missing');
    if (item.acceptedReceipt.payload.deliveryDigest !== item.request.deliveryDigest) throw new Error('push_outbox_acceptance_binding_invalid');
  } else if (item.acceptedReceipt !== undefined) {
    throw new Error('push_outbox_unexpected_acceptance');
  }
  if (['EXPIRED', 'REVOKED', 'DEAD_LETTER'].includes(item.state) && item.terminalReason === undefined) throw new Error('push_outbox_terminal_reason_missing');
  const { itemDigest, ...material } = item;
  if (sha256(material) !== itemDigest) throw new Error('push_outbox_item_digest_invalid');
}

function verifyTransportRequest(request: TransportNeutralPushRequest): void {
  if (request.version !== '33.4' || request.productionCeiling !== 'shadow' || request.externalEffectsExecuted !== 0) throw new Error('push_transport_request_invalid');
  id(request.requestId, 'push_request_id_required');
  validateDeliveryEnvelopeShape(request.signedDelivery);
  if (request.deliveryDigest !== sha256(request.signedDelivery)) throw new Error('push_transport_delivery_digest_invalid');
  id(request.targetAdapterId, 'push_adapter_id_required');
  id(request.providerDedupKey, 'push_provider_dedup_key_required');
  instant(request.queuedAt, 'push_queued_at_invalid');
  if (request.expiresAt !== request.signedDelivery.payload.expiresAt) throw new Error('push_transport_expiry_binding_invalid');
  const { requestDigest, ...material } = request;
  if (sha256(material) !== requestDigest) throw new Error('push_transport_request_digest_invalid');
}

function validateProviderReceipt(receipt: PushTransportProviderReceipt, now: Date): void {
  if (receipt.version !== '33.4' || receipt.externalEffectsExecuted !== 0) throw new Error('push_provider_receipt_invalid');
  id(receipt.adapterId, 'push_adapter_id_required');
  id(receipt.providerMessageId, 'push_provider_message_id_required');
  id(receipt.tenantId, 'tenant_id_required');
  id(receipt.deviceId, 'device_id_required');
  id(receipt.deliveryId, 'push_delivery_id_required');
  id(receipt.providerDedupKey, 'push_provider_dedup_key_required');
  digest64(receipt.deliveryDigest, 'push_delivery_digest_invalid');
  if (instant(receipt.acceptedAt, 'push_provider_accepted_at_invalid') > now.getTime()) throw new Error('push_provider_accepted_at_future');
  const { receiptDigest, ...material } = receipt;
  if (sha256(material) !== receiptDigest) throw new Error('push_provider_receipt_digest_invalid');
}

function validateDeliveryEnvelopeShape(delivery: SignedEnvelope<PushDeliveryChallenge>): void {
  const payload = delivery.payload;
  if (payload.version !== '33.3' || payload.transport !== 'SIMULATED_PUSH' || payload.externalEffectsExecuted !== 0) throw new Error('push_delivery_contract_invalid');
  id(payload.deliveryId, 'push_delivery_id_required');
  id(payload.tenantId, 'tenant_id_required');
  id(payload.cardId, 'approval_card_id_required');
  digest64(payload.cardDigest, 'approval_card_digest_invalid');
  id(payload.approverId, 'approval_actor_required');
  id(payload.deviceId, 'device_id_required');
  digest64(payload.deviceEnrollmentDigest, 'device_enrollment_digest_invalid');
  id(payload.challengeNonce, 'push_challenge_nonce_required');
  const issued = instant(payload.issuedAt, 'push_issued_at_invalid');
  const expires = instant(payload.expiresAt, 'push_expires_at_invalid');
  if (expires <= issued || !Number.isSafeInteger(payload.attempt) || payload.attempt < 1) throw new Error('push_delivery_window_invalid');
}

function verifyDeviceSession(row: DeviceSessionRecord): void {
  if (row.version !== '33.4' || row.externalEffectsExecuted !== 0) throw new Error('device_session_invalid');
  id(row.sessionId, 'device_session_id_required');
  id(row.tenantId, 'tenant_id_required');
  id(row.userId, 'device_user_required');
  id(row.deviceId, 'device_id_required');
  digest64(row.enrollmentDigest, 'device_enrollment_digest_invalid');
  id(row.nonce, 'device_session_nonce_required');
  const issued = instant(row.issuedAt, 'device_session_issued_at_invalid');
  const expires = instant(row.expiresAt, 'device_session_expires_at_invalid');
  if (expires <= issued) throw new Error('device_session_window_invalid');
  const { sessionDigest, ...material } = row;
  if (sha256(material) !== sessionDigest) throw new Error('device_session_digest_invalid');
}

function validateReplacementGrant(payload: DeviceReplacementGrant, now: Date): void {
  if (payload.version !== '33.4' || payload.productionCeiling !== 'shadow') throw new Error('device_replacement_contract_invalid');
  id(payload.replacementId, 'device_replacement_id_required');
  id(payload.tenantId, 'tenant_id_required');
  id(payload.userId, 'device_user_required');
  id(payload.oldDeviceId, 'old_device_id_required');
  id(payload.newDeviceId, 'new_device_id_required');
  if (payload.oldDeviceId === payload.newDeviceId) throw new Error('device_replacement_same_device');
  digest64(payload.oldEnrollmentDigest, 'old_enrollment_digest_invalid');
  digest64(payload.newEnrollmentDigest, 'new_enrollment_digest_invalid');
  id(payload.nonce, 'device_replacement_nonce_required');
  id(payload.reason, 'device_replacement_reason_required');
  const issued = instant(payload.issuedAt, 'device_replacement_issued_at_invalid');
  const notAfter = instant(payload.notAfter, 'device_replacement_not_after_invalid');
  if (issued > now.getTime() || notAfter <= issued || now.getTime() >= notAfter) throw new Error('device_replacement_window_invalid');
}

function emptySnapshot(): PushOutboxSnapshot {
  const material = { version: '33.4' as const, items: [] as readonly PushOutboxItem[], externalEffectsExecuted: 0 as const };
  return { ...material, snapshotDigest: sha256(material) };
}

function atomicWrite(path: string, content: string): void {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = openSync(temp, 'wx', 0o600);
  try {
    writeFileSync(descriptor, content, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temp, path);
    fsyncDirectory(dirname(path));
  } catch (error) {
    try { unlinkSync(temp); } catch { /* best effort */ }
    throw error;
  }
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, 'r');
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function id(value: string, code: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim() || value.length > 512) throw new Error(code);
  return value;
}

function digest64(value: string, code: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(code);
}

function instant(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(code);
  return parsed;
}

function validDate(value: Date): void {
  if (!Number.isFinite(value.getTime())) throw new Error('invalid_time');
}

function positiveInteger(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code);
  return value;
}

function unique(values: readonly string[], code: string): string[] {
  const rows = values.map((value) => id(value, code));
  if (new Set(rows).size !== rows.length) throw new Error(code);
  return rows;
}

function providerScope(adapterId: string, tenantId: string, dedupKey: string): string {
  return `${id(adapterId, 'push_adapter_id_required')}::${id(tenantId, 'tenant_id_required')}::${id(dedupKey, 'push_provider_dedup_key_required')}`;
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return 'push_transport_unknown_error';
}
