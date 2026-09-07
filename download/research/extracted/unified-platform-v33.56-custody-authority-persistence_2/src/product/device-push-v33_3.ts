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
import { randomUUID } from 'node:crypto';
import {
  type ExportedPublicKeyRecord,
  KeyRegistry,
  type SignedEnvelope,
  type SigningIdentity,
  sha256,
  signEnvelope,
} from '../contracts/crypto.js';
import {
  type ApprovalDecisionInput,
  type ApprovalDecisionRecord,
  type ApprovalOption,
  type PushApprovalCard,
} from './chat-mission.js';
import {
  type ApprovalInboxTransport,
  type ApprovalDeliveryReceipt,
  type ApprovalInboxItem,
  InMemoryApprovalInbox,
} from './mission-conversation-v33_2.js';
import { withSovereignFileLease } from '../persistence/sovereign-file-lease.js';

export const DEVICE_CAPABILITIES = ['APPROVAL_RECEIVE', 'APPROVAL_DECIDE'] as const;
export type DeviceCapability = (typeof DEVICE_CAPABILITIES)[number];

export interface DeviceEnrollmentGrant {
  readonly version: '33.3';
  readonly enrollmentId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly channel: 'SIMULATED_PUSH';
  readonly devicePublicKey: ExportedPublicKeyRecord;
  readonly capabilities: readonly DeviceCapability[];
  readonly issuedAt: string;
  readonly notBefore: string;
  readonly notAfter: string;
  readonly nonce: string;
  readonly productionCeiling: 'shadow';
}

export interface DeviceRevocation {
  readonly version: '33.3';
  readonly revocationId: string;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly enrollmentDigest: string;
  readonly revokedAt: string;
  readonly reason: string;
  readonly nonce: string;
}

export interface RegisteredDevice {
  readonly version: '33.3';
  readonly enrollment: SignedEnvelope<DeviceEnrollmentGrant>;
  readonly enrollmentDigest: string;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly revocation?: SignedEnvelope<DeviceRevocation>;
  readonly externalEffectsExecuted: 0;
  readonly recordDigest: string;
}

export interface DeviceRegistrySnapshot {
  readonly version: '33.3';
  readonly devices: readonly RegisteredDevice[];
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export class DeviceBindingRegistry {
  readonly #registrarKeys: KeyRegistry;
  readonly #trustedRegistrarIds: ReadonlySet<string>;
  readonly #devices = new Map<string, RegisteredDevice>();
  readonly #enrollmentIds = new Map<string, string>();
  readonly #enrollmentNonces = new Map<string, string>();
  readonly #deviceKeyOwners = new Map<string, string>();
  readonly #revocationIds = new Map<string, string>();
  readonly #revocationNonces = new Map<string, string>();

  constructor(registrarKeys: KeyRegistry, trustedRegistrarIds: readonly string[]) {
    this.#registrarKeys = registrarKeys;
    this.#trustedRegistrarIds = new Set(unique(trustedRegistrarIds, 'trusted_registrar_invalid'));
    if (this.#trustedRegistrarIds.size === 0) throw new Error('trusted_registrar_required');
  }

  enroll(envelope: SignedEnvelope<DeviceEnrollmentGrant>, now = new Date()): RegisteredDevice {
    validNow(now);
    const payload = envelope.payload;
    validateEnrollment(payload, now);
    this.#verifyRegistrarEnvelope(envelope, payload.issuedAt, now, 'device_enrollment_signature_invalid');
    const enrollmentDigest = sha256(envelope);
    const noncePrior = this.#enrollmentNonces.get(payload.nonce);
    if (noncePrior !== undefined && noncePrior !== enrollmentDigest) throw new Error('device_enrollment_nonce_replay');
    const ownerKey = deviceKey(payload.tenantId, payload.deviceId);
    const keyOwner = this.#deviceKeyOwners.get(`${payload.devicePublicKey.keyId}:${payload.devicePublicKey.fingerprint}`);
    if (keyOwner !== undefined && keyOwner !== ownerKey) throw new Error('device_public_key_reuse');
    const priorDigest = this.#enrollmentIds.get(payload.enrollmentId);
    if (priorDigest !== undefined) {
      if (priorDigest !== enrollmentDigest) throw new Error('device_enrollment_id_conflict');
      return this.get(payload.tenantId, payload.deviceId, now);
    }
    const key = deviceKey(payload.tenantId, payload.deviceId);
    const prior = this.#devices.get(key);
    if (prior !== undefined) {
      if (prior.enrollmentDigest !== enrollmentDigest) throw new Error('device_identity_conflict');
      return structuredClone(prior);
    }
    const material = {
      version: '33.3' as const,
      enrollment: envelope,
      enrollmentDigest,
      status: 'ACTIVE' as const,
      externalEffectsExecuted: 0 as const,
    };
    const record: RegisteredDevice = { ...material, recordDigest: sha256(material) };
    verifyRegisteredDevice(record, this.#registrarKeys, this.#trustedRegistrarIds, now, true);
    this.#devices.set(key, record);
    this.#enrollmentIds.set(payload.enrollmentId, enrollmentDigest);
    this.#enrollmentNonces.set(payload.nonce, enrollmentDigest);
    this.#deviceKeyOwners.set(`${payload.devicePublicKey.keyId}:${payload.devicePublicKey.fingerprint}`, key);
    return structuredClone(record);
  }

  revoke(envelope: SignedEnvelope<DeviceRevocation>, now = new Date()): RegisteredDevice {
    validNow(now);
    const payload = envelope.payload;
    validateRevocation(payload, now);
    const revocationDigest = sha256(envelope);
    const idPrior = this.#revocationIds.get(payload.revocationId);
    if (idPrior !== undefined && idPrior !== revocationDigest) throw new Error('device_revocation_id_conflict');
    const noncePrior = this.#revocationNonces.get(payload.nonce);
    if (noncePrior !== undefined && noncePrior !== revocationDigest) throw new Error('device_revocation_nonce_replay');
    this.#verifyRegistrarEnvelope(envelope, payload.revokedAt, now, 'device_revocation_signature_invalid');
    const key = deviceKey(payload.tenantId, payload.deviceId);
    const prior = this.#devices.get(key);
    if (prior === undefined) throw new Error('device_not_registered');
    verifyRegisteredDevice(prior, this.#registrarKeys, this.#trustedRegistrarIds, now, true);
    if (payload.enrollmentDigest !== prior.enrollmentDigest) throw new Error('device_revocation_enrollment_mismatch');
    if (prior.revocation !== undefined) {
      if (sha256(prior.revocation) !== sha256(envelope)) throw new Error('device_revocation_conflict');
      return structuredClone(prior);
    }
    const material = {
      version: '33.3' as const,
      enrollment: prior.enrollment,
      enrollmentDigest: prior.enrollmentDigest,
      status: 'REVOKED' as const,
      revocation: envelope,
      externalEffectsExecuted: 0 as const,
    };
    const record: RegisteredDevice = { ...material, recordDigest: sha256(material) };
    verifyRegisteredDevice(record, this.#registrarKeys, this.#trustedRegistrarIds, now, true);
    this.#devices.set(key, record);
    this.#revocationIds.set(payload.revocationId, revocationDigest);
    this.#revocationNonces.set(payload.nonce, revocationDigest);
    return structuredClone(record);
  }

  get(tenantId: string, deviceId: string, at = new Date()): RegisteredDevice {
    validNow(at);
    const row = this.#devices.get(deviceKey(tenantId, deviceId));
    if (row === undefined) throw new Error('device_not_registered');
    verifyRegisteredDevice(row, this.#registrarKeys, this.#trustedRegistrarIds, at, true);
    return structuredClone(row);
  }

  requireActive(tenantId: string, userId: string, deviceId: string, capability: DeviceCapability, at = new Date()): RegisteredDevice {
    const row = this.get(tenantId, deviceId, at);
    const payload = row.enrollment.payload;
    if (payload.userId !== identifier(userId, 'device_user_required')) throw new Error('device_user_binding_mismatch');
    if (!payload.capabilities.includes(capability)) throw new Error('device_capability_missing');
    const instantAt = at.getTime();
    if (instantAt < parseInstant(payload.notBefore, 'device_not_before_invalid') || instantAt >= parseInstant(payload.notAfter, 'device_not_after_invalid')) {
      throw new Error('device_credential_inactive');
    }
    if (row.status === 'REVOKED') {
      const revokedAt = parseInstant(row.revocation!.payload.revokedAt, 'device_revoked_at_invalid');
      if (instantAt >= revokedAt) throw new Error('device_revoked');
    }
    return row;
  }

  verifyDeviceEnvelope<T>(envelope: SignedEnvelope<T>, tenantId: string, userId: string, deviceId: string, capability: DeviceCapability, occurredAt: Date, acceptedAt = occurredAt): boolean {
    const row = this.requireActive(tenantId, userId, deviceId, capability, occurredAt);
    this.requireActive(tenantId, userId, deviceId, capability, acceptedAt);
    if (envelope.issuerKeyId !== row.enrollment.payload.devicePublicKey.keyId) return false;
    const deviceKeys = new KeyRegistry();
    deviceKeys.registerExported(row.enrollment.payload.devicePublicKey);
    return deviceKeys.verifyAt(envelope, occurredAt);
  }

  export(): DeviceRegistrySnapshot {
    const devices = [...this.#devices.values()]
      .sort((a, b) => deviceKey(a.enrollment.payload.tenantId, a.enrollment.payload.deviceId).localeCompare(deviceKey(b.enrollment.payload.tenantId, b.enrollment.payload.deviceId)))
      .map((row) => structuredClone(row));
    const material = { version: '33.3' as const, devices, externalEffectsExecuted: 0 as const };
    return { ...material, snapshotDigest: sha256(material) };
  }

  static restore(snapshot: DeviceRegistrySnapshot, registrarKeys: KeyRegistry, trustedRegistrarIds: readonly string[], now = new Date()): DeviceBindingRegistry {
    validNow(now);
    const { snapshotDigest, ...material } = snapshot;
    if (snapshot.version !== '33.3' || snapshot.externalEffectsExecuted !== 0 || sha256(material) !== snapshotDigest) {
      throw new Error('device_registry_snapshot_invalid');
    }
    const registry = new DeviceBindingRegistry(registrarKeys, trustedRegistrarIds);
    for (const row of snapshot.devices) {
      verifyRegisteredDevice(row, registrarKeys, registry.#trustedRegistrarIds, now, true);
      const payload = row.enrollment.payload;
      const key = deviceKey(payload.tenantId, payload.deviceId);
      if (registry.#devices.has(key) || registry.#enrollmentIds.has(payload.enrollmentId)) throw new Error('device_registry_restore_duplicate');
      const keyIdentity = `${payload.devicePublicKey.keyId}:${payload.devicePublicKey.fingerprint}`;
      if (registry.#enrollmentNonces.has(payload.nonce) || registry.#deviceKeyOwners.has(keyIdentity)) throw new Error('device_registry_restore_identity_reuse');
      registry.#devices.set(key, structuredClone(row));
      registry.#enrollmentIds.set(payload.enrollmentId, row.enrollmentDigest);
      registry.#enrollmentNonces.set(payload.nonce, row.enrollmentDigest);
      registry.#deviceKeyOwners.set(keyIdentity, key);
      if (row.revocation !== undefined) {
        const revocationDigest = sha256(row.revocation);
        const revocation = row.revocation.payload;
        if (registry.#revocationIds.has(revocation.revocationId) || registry.#revocationNonces.has(revocation.nonce)) throw new Error('device_registry_restore_revocation_reuse');
        registry.#revocationIds.set(revocation.revocationId, revocationDigest);
        registry.#revocationNonces.set(revocation.nonce, revocationDigest);
      }
    }
    return registry;
  }

  #verifyRegistrarEnvelope<T>(envelope: SignedEnvelope<T>, issuedAt: string, now: Date, code: string): void {
    if (!this.#trustedRegistrarIds.has(envelope.issuerKeyId)) throw new Error('device_registrar_untrusted');
    if (!this.#registrarKeys.verifyAt(envelope, issuedAt) || !this.#registrarKeys.verifyAt(envelope, now)) throw new Error(code);
  }
}

export interface PushDeliveryChallenge {
  readonly version: '33.3';
  readonly deliveryId: string;
  readonly tenantId: string;
  readonly cardId: string;
  readonly cardDigest: string;
  readonly approverId: string;
  readonly deviceId: string;
  readonly deviceEnrollmentDigest: string;
  readonly challengeNonce: string;
  readonly attempt: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly transport: 'SIMULATED_PUSH';
  readonly externalEffectsExecuted: 0;
}

export interface DeviceDeliveryAcknowledgement {
  readonly version: '33.3';
  readonly acknowledgementId: string;
  readonly deliveryDigest: string;
  readonly tenantId: string;
  readonly cardId: string;
  readonly cardDigest: string;
  readonly approverId: string;
  readonly deviceId: string;
  readonly challengeNonce: string;
  readonly receivedAt: string;
  readonly externalEffectsExecuted: 0;
}

export interface DeviceApprovalCommand {
  readonly version: '33.3';
  readonly commandNonce: string;
  readonly decisionId: string;
  readonly deliveryDigest: string;
  readonly tenantId: string;
  readonly cardId: string;
  readonly cardDigest: string;
  readonly actorId: string;
  readonly deviceId: string;
  readonly challengeNonce: string;
  readonly option: ApprovalOption;
  readonly occurredAt: string;
  readonly reason?: string;
  readonly changedConditions?: readonly string[];
  readonly externalEffectsExecuted: 0;
}

export interface PushDecisionReceipt {
  readonly version: '33.3';
  readonly receiptId: string;
  readonly tenantId: string;
  readonly cardId: string;
  readonly deviceId: string;
  readonly deliveryDigest: string;
  readonly acknowledgementDigest: string;
  readonly deviceCommandDigest: string;
  readonly canonicalDecision: ApprovalDecisionRecord;
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface PushGatewaySnapshot {
  readonly version: '33.3';
  readonly deliveries: readonly SignedEnvelope<PushDeliveryChallenge>[];
  readonly acknowledgements: readonly SignedEnvelope<DeviceDeliveryAcknowledgement>[];
  readonly commands: readonly SignedEnvelope<DeviceApprovalCommand>[];
  readonly receipts: readonly SignedEnvelope<PushDecisionReceipt>[];
  readonly generatedAt: string;
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export class SimulatedDevicePushGateway {
  readonly #inbox: ApprovalInboxTransport;
  readonly #devices: DeviceBindingRegistry;
  readonly #gatewayIdentity: SigningIdentity;
  readonly #gatewayKeys: KeyRegistry;
  readonly #deliveries = new Map<string, SignedEnvelope<PushDeliveryChallenge>>();
  readonly #acknowledgements = new Map<string, SignedEnvelope<DeviceDeliveryAcknowledgement>>();
  readonly #ackByDelivery = new Map<string, SignedEnvelope<DeviceDeliveryAcknowledgement>>();
  readonly #commands = new Map<string, SignedEnvelope<DeviceApprovalCommand>>();
  readonly #commandNonces = new Map<string, string>();
  readonly #receipts = new Map<string, SignedEnvelope<PushDecisionReceipt>>();

  constructor(inbox: ApprovalInboxTransport, devices: DeviceBindingRegistry, gatewayIdentity: SigningIdentity, gatewayKeys: KeyRegistry) {
    this.#inbox = inbox;
    this.#devices = devices;
    this.#gatewayIdentity = gatewayIdentity;
    this.#gatewayKeys = gatewayKeys;
    if (gatewayKeys.fingerprint(gatewayIdentity.keyId) === undefined) throw new Error('gateway_signing_key_not_registered');
    const probe = signEnvelope({ version: '33.3', purpose: 'gateway-key-binding' }, gatewayIdentity);
    if (!gatewayKeys.verify(probe)) throw new Error('gateway_signing_key_mismatch');
  }

  issue(card: PushApprovalCard, input: { readonly deliveryId: string; readonly approverId: string; readonly deviceId: string; readonly challengeNonce: string; readonly issuedAt: string; readonly expiresAt: string; readonly attempt: number }, now = new Date()): SignedEnvelope<PushDeliveryChallenge> {
    validNow(now);
    verifyPushCard(card);
    if (!card.approverIds.includes(input.approverId)) throw new Error('approval_actor_not_authorized');
    const issued = parseInstant(input.issuedAt, 'push_issued_at_invalid');
    const expires = parseInstant(input.expiresAt, 'push_expires_at_invalid');
    if (issued > now.getTime() || expires <= issued || expires > parseInstant(card.expiresAt, 'approval_expiry_invalid')) throw new Error('push_delivery_window_invalid');
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) throw new Error('push_attempt_invalid');
    const inboxItem = this.#inbox.get(card.tenantId, card.cardId, now);
    if (inboxItem === undefined || inboxItem.card.cardDigest !== card.cardDigest) throw new Error('approval_card_not_enqueued');
    const device = this.#devices.requireActive(card.tenantId, input.approverId, input.deviceId, 'APPROVAL_RECEIVE', now);
    const payload: PushDeliveryChallenge = {
      version: '33.3',
      deliveryId: identifier(input.deliveryId, 'push_delivery_id_required'),
      tenantId: card.tenantId,
      cardId: card.cardId,
      cardDigest: card.cardDigest,
      approverId: identifier(input.approverId, 'approval_actor_required'),
      deviceId: identifier(input.deviceId, 'device_id_required'),
      deviceEnrollmentDigest: device.enrollmentDigest,
      challengeNonce: identifier(input.challengeNonce, 'push_challenge_nonce_required'),
      attempt: input.attempt,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      transport: 'SIMULATED_PUSH',
      externalEffectsExecuted: 0,
    };
    const envelope = signEnvelope(payload, this.#gatewayIdentity);
    const prior = this.#deliveries.get(payload.deliveryId);
    if (prior !== undefined) {
      if (sha256(prior) !== sha256(envelope)) throw new Error('push_delivery_id_conflict');
      return structuredClone(prior);
    }
    for (const row of this.#deliveries.values()) {
      if (row.payload.challengeNonce === payload.challengeNonce && sha256(row) !== sha256(envelope)) throw new Error('push_challenge_nonce_reused');
    }
    this.#deliveries.set(payload.deliveryId, envelope);
    return structuredClone(envelope);
  }

  acknowledge(envelope: SignedEnvelope<DeviceDeliveryAcknowledgement>, now = new Date()): ApprovalDeliveryReceipt {
    validNow(now);
    const payload = envelope.payload;
    validateAcknowledgement(payload, now);
    const delivery = this.#requiredDeliveryDigest(payload.deliveryDigest);
    verifyAckBinding(payload, delivery.payload);
    const prior = this.#acknowledgements.get(payload.acknowledgementId);
    if (prior !== undefined) {
      if (sha256(prior) !== sha256(envelope)) throw new Error('push_acknowledgement_id_conflict');
      return this.#inbox.deliver({
        deliveryId: delivery.payload.deliveryId,
        tenantId: payload.tenantId,
        cardId: payload.cardId,
        approverId: payload.approverId,
        deliveredAt: payload.receivedAt,
      }, now);
    }
    if (now.getTime() >= parseInstant(delivery.payload.expiresAt, 'push_expires_at_invalid')) throw new Error('push_delivery_expired');
    if (!this.#devices.verifyDeviceEnvelope(envelope, payload.tenantId, payload.approverId, payload.deviceId, 'APPROVAL_RECEIVE', new Date(payload.receivedAt), now)) {
      throw new Error('device_ack_signature_invalid');
    }
    const bound = this.#ackByDelivery.get(payload.deliveryDigest);
    if (bound !== undefined && sha256(bound) !== sha256(envelope)) throw new Error('push_delivery_ack_conflict');
    const receipt = this.#inbox.deliver({
      deliveryId: delivery.payload.deliveryId,
      tenantId: payload.tenantId,
      cardId: payload.cardId,
      approverId: payload.approverId,
      deliveredAt: payload.receivedAt,
    }, now);
    this.#acknowledgements.set(payload.acknowledgementId, envelope);
    this.#ackByDelivery.set(payload.deliveryDigest, envelope);
    return receipt;
  }

  decide(envelope: SignedEnvelope<DeviceApprovalCommand>, now = new Date()): SignedEnvelope<PushDecisionReceipt> {
    validNow(now);
    const payload = envelope.payload;
    validateDeviceCommand(payload, now);
    const delivery = this.#requiredDeliveryDigest(payload.deliveryDigest);
    verifyCommandBinding(payload, delivery.payload);
    const commandDigest = sha256(envelope);
    const priorCommand = this.#commands.get(payload.decisionId);
    if (priorCommand !== undefined) {
      if (sha256(priorCommand) !== commandDigest) throw new Error('device_decision_id_conflict');
      const priorReceipt = this.#receipts.get(payload.decisionId);
      if (priorReceipt === undefined) throw new Error('push_receipt_missing');
      return structuredClone(priorReceipt);
    }
    if (now.getTime() >= parseInstant(delivery.payload.expiresAt, 'push_expires_at_invalid')) throw new Error('push_delivery_expired');
    const acknowledgement = this.#ackByDelivery.get(payload.deliveryDigest);
    if (acknowledgement === undefined) throw new Error('push_delivery_not_acknowledged');
    if (parseInstant(payload.occurredAt, 'approval_time_invalid') < parseInstant(acknowledgement.payload.receivedAt, 'push_received_at_invalid')) throw new Error('approval_before_delivery');
    if (!this.#devices.verifyDeviceEnvelope(envelope, payload.tenantId, payload.actorId, payload.deviceId, 'APPROVAL_DECIDE', new Date(payload.occurredAt), now)) {
      throw new Error('device_command_signature_invalid');
    }
    const noncePrior = this.#commandNonces.get(payload.commandNonce);
    if (noncePrior !== undefined && noncePrior !== commandDigest) throw new Error('device_command_replay');
    const input: ApprovalDecisionInput = {
      decisionId: payload.decisionId,
      cardId: payload.cardId,
      actorId: payload.actorId,
      option: payload.option,
      occurredAt: payload.occurredAt,
      ...(payload.reason === undefined ? {} : { reason: payload.reason }),
      ...(payload.changedConditions === undefined ? {} : { changedConditions: payload.changedConditions }),
    };
    const canonicalDecision = this.#inbox.decide(payload.tenantId, input, now);
    const material = {
      version: '33.3' as const,
      receiptId: `push-receipt-${canonicalDecision.decisionDigest.slice(0, 24)}`,
      tenantId: payload.tenantId,
      cardId: payload.cardId,
      deviceId: payload.deviceId,
      deliveryDigest: payload.deliveryDigest,
      acknowledgementDigest: sha256(acknowledgement),
      deviceCommandDigest: commandDigest,
      canonicalDecision,
      externalEffectsExecuted: 0 as const,
    };
    const receiptPayload: PushDecisionReceipt = { ...material, receiptDigest: sha256(material) };
    const receipt = signEnvelope(receiptPayload, this.#gatewayIdentity);
    this.#commands.set(payload.decisionId, envelope);
    this.#commandNonces.set(payload.commandNonce, commandDigest);
    this.#receipts.set(payload.decisionId, receipt);
    return structuredClone(receipt);
  }

  export(now = new Date()): PushGatewaySnapshot {
    validNow(now);
    const deliveries = sortedEnvelopes(this.#deliveries);
    const acknowledgements = sortedEnvelopes(this.#acknowledgements);
    const commands = sortedEnvelopes(this.#commands);
    const receipts = sortedEnvelopes(this.#receipts);
    const material = { version: '33.3' as const, deliveries, acknowledgements, commands, receipts, generatedAt: now.toISOString(), externalEffectsExecuted: 0 as const };
    return { ...material, snapshotDigest: sha256(material) };
  }

  exportSigned(now = new Date()): SignedEnvelope<PushGatewaySnapshot> {
    return signEnvelope(this.export(now), this.#gatewayIdentity);
  }

  static restoreSigned(envelope: SignedEnvelope<PushGatewaySnapshot>, inbox: ApprovalInboxTransport, devices: DeviceBindingRegistry, gatewayIdentity: SigningIdentity, gatewayKeys: KeyRegistry, now = new Date()): SimulatedDevicePushGateway {
    if (!gatewayKeys.verifyAt(envelope, envelope.payload.generatedAt)) throw new Error('push_gateway_snapshot_signature_invalid');
    return SimulatedDevicePushGateway.restore(envelope.payload, inbox, devices, gatewayIdentity, gatewayKeys, now);
  }

  static restore(snapshot: PushGatewaySnapshot, inbox: ApprovalInboxTransport, devices: DeviceBindingRegistry, gatewayIdentity: SigningIdentity, gatewayKeys: KeyRegistry, now = new Date()): SimulatedDevicePushGateway {
    validNow(now);
    const { snapshotDigest, ...material } = snapshot;
    if (snapshot.version !== '33.3' || snapshot.externalEffectsExecuted !== 0 || parseInstant(snapshot.generatedAt, 'push_gateway_generated_at_invalid') > now.getTime() || sha256(material) !== snapshotDigest) throw new Error('push_gateway_snapshot_invalid');
    const gateway = new SimulatedDevicePushGateway(inbox, devices, gatewayIdentity, gatewayKeys);
    const challengeNonces = new Set<string>();
    for (const delivery of snapshot.deliveries) {
      if (!gatewayKeys.verifyAt(delivery, delivery.payload.issuedAt)) throw new Error('push_delivery_signature_invalid');
      const payload = delivery.payload;
      const device = devices.requireActive(payload.tenantId, payload.approverId, payload.deviceId, 'APPROVAL_RECEIVE', new Date(payload.issuedAt));
      if (device.enrollmentDigest !== payload.deviceEnrollmentDigest) throw new Error('push_delivery_device_binding_invalid');
      if (gateway.#deliveries.has(payload.deliveryId) || challengeNonces.has(payload.challengeNonce)) throw new Error('push_gateway_restore_duplicate_delivery');
      challengeNonces.add(payload.challengeNonce);
      gateway.#deliveries.set(payload.deliveryId, structuredClone(delivery));
    }
    for (const acknowledgement of snapshot.acknowledgements) {
      const payload = acknowledgement.payload;
      if (!devices.verifyDeviceEnvelope(acknowledgement, payload.tenantId, payload.approverId, payload.deviceId, 'APPROVAL_RECEIVE', new Date(payload.receivedAt))) throw new Error('device_ack_signature_invalid');
      const delivery = gateway.#requiredDeliveryDigest(payload.deliveryDigest);
      verifyAckBinding(payload, delivery.payload);
      if (gateway.#acknowledgements.has(payload.acknowledgementId) || gateway.#ackByDelivery.has(payload.deliveryDigest)) throw new Error('push_gateway_restore_duplicate_ack');
      gateway.#acknowledgements.set(payload.acknowledgementId, structuredClone(acknowledgement));
      gateway.#ackByDelivery.set(payload.deliveryDigest, structuredClone(acknowledgement));
    }
    for (const command of snapshot.commands) {
      const payload = command.payload;
      if (!devices.verifyDeviceEnvelope(command, payload.tenantId, payload.actorId, payload.deviceId, 'APPROVAL_DECIDE', new Date(payload.occurredAt))) throw new Error('device_command_signature_invalid');
      const delivery = gateway.#requiredDeliveryDigest(payload.deliveryDigest);
      verifyCommandBinding(payload, delivery.payload);
      const acknowledgement = gateway.#ackByDelivery.get(payload.deliveryDigest);
      if (acknowledgement === undefined || parseInstant(payload.occurredAt, 'approval_time_invalid') < parseInstant(acknowledgement.payload.receivedAt, 'push_received_at_invalid')) throw new Error('push_command_ack_binding_invalid');
      if (gateway.#commands.has(payload.decisionId) || gateway.#commandNonces.has(payload.commandNonce)) throw new Error('push_gateway_restore_duplicate_command');
      gateway.#commands.set(payload.decisionId, structuredClone(command));
      gateway.#commandNonces.set(payload.commandNonce, sha256(command));
    }
    for (const receipt of snapshot.receipts) {
      if (!gatewayKeys.verifyAt(receipt, receipt.payload.canonicalDecision.occurredAt)) throw new Error('push_receipt_signature_invalid');
      const payload = receipt.payload;
      const { receiptDigest, ...receiptMaterial } = payload;
      if (sha256(receiptMaterial) !== receiptDigest) throw new Error('push_receipt_digest_invalid');
      const command = gateway.#commands.get(payload.canonicalDecision.decisionId);
      if (command === undefined || sha256(command) !== payload.deviceCommandDigest) throw new Error('push_receipt_command_binding_invalid');
      const acknowledgement = gateway.#ackByDelivery.get(payload.deliveryDigest);
      if (acknowledgement === undefined || sha256(acknowledgement) !== payload.acknowledgementDigest) throw new Error('push_receipt_ack_binding_invalid');
      if (payload.tenantId !== command.payload.tenantId || payload.cardId !== command.payload.cardId || payload.deviceId !== command.payload.deviceId || payload.canonicalDecision.cardId !== command.payload.cardId || payload.canonicalDecision.actorId !== command.payload.actorId) throw new Error('push_receipt_identity_binding_invalid');
      const inboxItem = inbox.get(payload.tenantId, payload.cardId, now);
      if (inboxItem === undefined || !inboxItem.decisions.some((decision) => decision.decisionDigest === payload.canonicalDecision.decisionDigest)) throw new Error('push_receipt_canonical_decision_missing');
      if (gateway.#receipts.has(payload.canonicalDecision.decisionId)) throw new Error('push_gateway_restore_duplicate_receipt');
      gateway.#receipts.set(payload.canonicalDecision.decisionId, structuredClone(receipt));
    }
    return gateway;
  }

  getDelivery(deliveryId: string): SignedEnvelope<PushDeliveryChallenge> | undefined {
    const row = this.#deliveries.get(identifier(deliveryId, 'push_delivery_id_required'));
    return row === undefined ? undefined : structuredClone(row);
  }

  #requiredDeliveryDigest(digest: string): SignedEnvelope<PushDeliveryChallenge> {
    digest64(digest, 'push_delivery_digest_invalid');
    for (const row of this.#deliveries.values()) if (sha256(row) === digest) return row;
    throw new Error('push_delivery_not_found');
  }
}


export class FileApprovalInbox implements ApprovalInboxTransport {
  readonly #path: string;

  constructor(path: string) {
    if (path.trim() === '') throw new Error('approval_inbox_path_required');
    this.#path = resolve(path);
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    if (!existsSync(this.#path)) atomicWrite(this.#path, '[]\n');
  }

  enqueue(card: PushApprovalCard, now = new Date()): ApprovalInboxItem {
    return this.#withStore(now, (store) => store.enqueue(card, now));
  }

  deliver(input: { readonly deliveryId: string; readonly tenantId: string; readonly cardId: string; readonly approverId: string; readonly deliveredAt: string }, now = new Date()): ApprovalDeliveryReceipt {
    return this.#withStore(now, (store) => store.deliver(input, now));
  }

  decide(tenantId: string, input: ApprovalDecisionInput, now = new Date()): ApprovalDecisionRecord {
    return this.#withStore(now, (store) => store.decide(tenantId, input, now));
  }

  list(tenantId: string, approverId: string, now = new Date()): readonly ApprovalInboxItem[] {
    return this.#withStore(now, (store) => store.list(tenantId, approverId, now));
  }

  get(tenantId: string, cardId: string, now = new Date()): ApprovalInboxItem | undefined {
    return this.#withStore(now, (store) => store.get(tenantId, cardId, now));
  }

  #withStore<T>(now: Date, operation: (store: InMemoryApprovalInbox) => T): T {
    validNow(now);
    return withSovereignFileLease(`${this.#path}.lock`, () => {
      let rows: readonly ApprovalInboxItem[];
      try {
        rows = JSON.parse(readFileSync(this.#path, 'utf8')) as readonly ApprovalInboxItem[];
      } catch {
        throw new Error('approval_inbox_file_invalid');
      }
      let store: InMemoryApprovalInbox;
      try {
        store = InMemoryApprovalInbox.restore(rows, now);
      } catch {
        throw new Error('approval_inbox_file_tampered');
      }
      const result = operation(store);
      atomicWrite(this.#path, `${JSON.stringify(store.export(), null, 2)}\n`);
      return result;
    });
  }
}

export interface UserFlowScenario {
  readonly scenarioId: string;
  readonly baselineUserSteps: number;
  readonly prototypeUserSteps: number;
  readonly approvals: number;
  readonly humanObserved: boolean;
  readonly comprehensionSeconds?: number;
}

export interface UserFlowEvidence {
  readonly version: '33.3';
  readonly scenarios: number;
  readonly baselineSteps: number;
  readonly prototypeSteps: number;
  readonly stepReductionPct: number;
  readonly medianApprovals: number;
  readonly humanObservedScenarios: number;
  readonly medianComprehensionSeconds?: number;
  readonly accessibilityPassed: boolean;
  readonly structuralCriteriaPassed: boolean;
  readonly humanCriteriaPassed: boolean;
  readonly g3Eligible: boolean;
  readonly evidenceClass: 'SIMULATED' | 'HUMAN_OBSERVED';
  readonly evidenceDigest: string;
}

export function evaluateUserFlow(scenarios: readonly UserFlowScenario[], accessibilityPassed: boolean): UserFlowEvidence {
  if (scenarios.length === 0) throw new Error('user_flow_scenario_required');
  const ids = new Set<string>();
  let baselineSteps = 0;
  let prototypeSteps = 0;
  const approvals: number[] = [];
  const comprehension: number[] = [];
  let humanObservedScenarios = 0;
  for (const scenario of scenarios) {
    const id = identifier(scenario.scenarioId, 'user_flow_scenario_id_required');
    if (ids.has(id)) throw new Error('user_flow_scenario_duplicate');
    ids.add(id);
    for (const [value, code] of [[scenario.baselineUserSteps, 'baseline_steps_invalid'], [scenario.prototypeUserSteps, 'prototype_steps_invalid'], [scenario.approvals, 'approval_count_invalid']] as const) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
    }
    if (scenario.baselineUserSteps === 0) throw new Error('baseline_steps_zero');
    if (scenario.prototypeUserSteps > scenario.baselineUserSteps) throw new Error('prototype_steps_exceed_baseline');
    if (scenario.humanObserved) {
      humanObservedScenarios += 1;
      if (scenario.comprehensionSeconds === undefined || !Number.isFinite(scenario.comprehensionSeconds) || scenario.comprehensionSeconds < 0) throw new Error('human_comprehension_required');
      comprehension.push(scenario.comprehensionSeconds);
    } else if (scenario.comprehensionSeconds !== undefined) {
      throw new Error('simulated_comprehension_forbidden');
    }
    baselineSteps += scenario.baselineUserSteps;
    prototypeSteps += scenario.prototypeUserSteps;
    approvals.push(scenario.approvals);
  }
  const stepReductionPct = Number((((baselineSteps - prototypeSteps) / baselineSteps) * 100).toFixed(2));
  const medianApprovals = median(approvals);
  const medianComprehensionSeconds = comprehension.length === 0 ? undefined : median(comprehension);
  const structuralCriteriaPassed = stepReductionPct >= 70 && medianApprovals <= 1;
  const humanCriteriaPassed = humanObservedScenarios >= 5 && medianComprehensionSeconds !== undefined && medianComprehensionSeconds < 10 && accessibilityPassed;
  const material = {
    version: '33.3' as const,
    scenarios: scenarios.length,
    baselineSteps,
    prototypeSteps,
    stepReductionPct,
    medianApprovals,
    humanObservedScenarios,
    ...(medianComprehensionSeconds === undefined ? {} : { medianComprehensionSeconds }),
    accessibilityPassed,
    structuralCriteriaPassed,
    humanCriteriaPassed,
    g3Eligible: structuralCriteriaPassed && humanCriteriaPassed,
    evidenceClass: (humanObservedScenarios === scenarios.length ? 'HUMAN_OBSERVED' : 'SIMULATED') as 'SIMULATED' | 'HUMAN_OBSERVED',
  };
  return { ...material, evidenceDigest: sha256(material) };
}

function validateEnrollment(payload: DeviceEnrollmentGrant, now: Date): void {
  if (payload.version !== '33.3' || payload.channel !== 'SIMULATED_PUSH' || payload.productionCeiling !== 'shadow') throw new Error('device_enrollment_contract_invalid');
  identifier(payload.enrollmentId, 'device_enrollment_id_required');
  identifier(payload.tenantId, 'tenant_id_required');
  identifier(payload.userId, 'device_user_required');
  identifier(payload.deviceId, 'device_id_required');
  identifier(payload.nonce, 'device_enrollment_nonce_required');
  const capabilities = unique(payload.capabilities, 'device_capability_invalid');
  if (capabilities.length !== DEVICE_CAPABILITIES.length || DEVICE_CAPABILITIES.some((capability) => !capabilities.includes(capability))) throw new Error('device_capability_set_invalid');
  if (payload.devicePublicKey.revoked || payload.devicePublicKey.revokedAt !== undefined) throw new Error('device_public_key_revoked');
  const issued = parseInstant(payload.issuedAt, 'device_issued_at_invalid');
  const notBefore = parseInstant(payload.notBefore, 'device_not_before_invalid');
  const notAfter = parseInstant(payload.notAfter, 'device_not_after_invalid');
  if (issued > now.getTime() || notAfter <= notBefore || issued > notBefore || now.getTime() >= notAfter) throw new Error('device_credential_window_invalid');
}

function validateRevocation(payload: DeviceRevocation, now: Date): void {
  if (payload.version !== '33.3') throw new Error('device_revocation_contract_invalid');
  identifier(payload.revocationId, 'device_revocation_id_required');
  identifier(payload.tenantId, 'tenant_id_required');
  identifier(payload.deviceId, 'device_id_required');
  digest64(payload.enrollmentDigest, 'device_enrollment_digest_invalid');
  identifier(payload.reason, 'device_revocation_reason_required');
  identifier(payload.nonce, 'device_revocation_nonce_required');
  if (parseInstant(payload.revokedAt, 'device_revoked_at_invalid') > now.getTime()) throw new Error('device_revocation_in_future');
}

function verifyRegisteredDevice(row: RegisteredDevice, registrarKeys: KeyRegistry, trustedRegistrarIds: ReadonlySet<string>, now: Date, allowInactive: boolean): void {
  const payload = row.enrollment.payload;
  if (row.version !== '33.3' || row.externalEffectsExecuted !== 0 || !trustedRegistrarIds.has(row.enrollment.issuerKeyId)) throw new Error('registered_device_invalid');
  validateEnrollment(payload, new Date(Math.min(now.getTime(), parseInstant(payload.notAfter, 'device_not_after_invalid') - 1)));
  if (!registrarKeys.verifyAt(row.enrollment, payload.issuedAt)) throw new Error('device_enrollment_signature_invalid');
  if (row.enrollmentDigest !== sha256(row.enrollment)) throw new Error('device_enrollment_digest_invalid');
  if (row.status === 'REVOKED') {
    if (row.revocation === undefined) throw new Error('device_revocation_missing');
    const revocation = row.revocation.payload;
    validateRevocation(revocation, new Date(Math.max(now.getTime(), parseInstant(revocation.revokedAt, 'device_revoked_at_invalid'))));
    if (!trustedRegistrarIds.has(row.revocation.issuerKeyId) || !registrarKeys.verifyAt(row.revocation, revocation.revokedAt)) throw new Error('device_revocation_signature_invalid');
    if (revocation.tenantId !== payload.tenantId || revocation.deviceId !== payload.deviceId || revocation.enrollmentDigest !== row.enrollmentDigest) throw new Error('device_revocation_binding_invalid');
  } else if (row.status !== 'ACTIVE' || row.revocation !== undefined) {
    throw new Error('device_status_invalid');
  }
  const { recordDigest, ...material } = row;
  if (sha256(material) !== recordDigest) throw new Error('device_record_digest_invalid');
  if (!allowInactive && now.getTime() >= parseInstant(payload.notAfter, 'device_not_after_invalid')) throw new Error('device_credential_inactive');
}

function validateAcknowledgement(payload: DeviceDeliveryAcknowledgement, now: Date): void {
  if (payload.version !== '33.3' || payload.externalEffectsExecuted !== 0) throw new Error('push_ack_contract_invalid');
  identifier(payload.acknowledgementId, 'push_acknowledgement_id_required');
  digest64(payload.deliveryDigest, 'push_delivery_digest_invalid');
  identifier(payload.tenantId, 'tenant_id_required');
  identifier(payload.cardId, 'approval_card_id_required');
  digest64(payload.cardDigest, 'approval_card_digest_invalid');
  identifier(payload.approverId, 'approval_actor_required');
  identifier(payload.deviceId, 'device_id_required');
  identifier(payload.challengeNonce, 'push_challenge_nonce_required');
  if (parseInstant(payload.receivedAt, 'push_received_at_invalid') > now.getTime()) throw new Error('push_received_at_in_future');
}

function validateDeviceCommand(payload: DeviceApprovalCommand, now: Date): void {
  if (payload.version !== '33.3' || payload.externalEffectsExecuted !== 0) throw new Error('device_command_contract_invalid');
  identifier(payload.commandNonce, 'device_command_nonce_required');
  identifier(payload.decisionId, 'decision_id_required');
  digest64(payload.deliveryDigest, 'push_delivery_digest_invalid');
  identifier(payload.tenantId, 'tenant_id_required');
  identifier(payload.cardId, 'approval_card_id_required');
  digest64(payload.cardDigest, 'approval_card_digest_invalid');
  identifier(payload.actorId, 'approval_actor_required');
  identifier(payload.deviceId, 'device_id_required');
  identifier(payload.challengeNonce, 'push_challenge_nonce_required');
  if (!['YES', 'NO', 'CHANGE_CONDITIONS', 'EXPLAIN'].includes(payload.option)) throw new Error('approval_option_invalid');
  if (parseInstant(payload.occurredAt, 'approval_time_invalid') > now.getTime()) throw new Error('approval_time_in_future');
}

function verifyAckBinding(ack: DeviceDeliveryAcknowledgement, delivery: PushDeliveryChallenge): void {
  // The deliveryDigest lookup is performed before this function and binds the acknowledgement to the signed envelope.
  if (ack.tenantId !== delivery.tenantId || ack.cardId !== delivery.cardId || ack.cardDigest !== delivery.cardDigest || ack.approverId !== delivery.approverId || ack.deviceId !== delivery.deviceId || ack.challengeNonce !== delivery.challengeNonce) throw new Error('push_ack_binding_invalid');
}

function verifyCommandBinding(command: DeviceApprovalCommand, delivery: PushDeliveryChallenge): void {
  if (command.tenantId !== delivery.tenantId || command.cardId !== delivery.cardId || command.cardDigest !== delivery.cardDigest || command.actorId !== delivery.approverId || command.deviceId !== delivery.deviceId || command.challengeNonce !== delivery.challengeNonce) throw new Error('device_command_binding_invalid');
}

function verifyPushCard(card: PushApprovalCard): void {
  if (card.version !== '33.1' || card.cardDigest !== sha256((({ cardDigest: _ignored, ...rest }) => rest)(card))) throw new Error('approval_card_digest_invalid');
}


function sortedEnvelopes<T>(rows: Map<string, SignedEnvelope<T>>): readonly SignedEnvelope<T>[] {
  return [...rows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => structuredClone(value));
}
function deviceKey(tenantId: string, deviceId: string): string { return `${identifier(tenantId, 'tenant_id_required')}\u0000${identifier(deviceId, 'device_id_required')}`; }
function identifier(value: string, code: string): string { const normalized = value.trim(); if (normalized === '' || normalized.length > 256) throw new Error(code); return normalized; }
function digest64(value: string, code: string): string { if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(code); return value; }
function parseInstant(value: string, code: string): number { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error(code); return parsed; }
function validNow(now: Date): void { if (!Number.isFinite(now.getTime())) throw new Error('current_time_invalid'); }
function unique<T extends string>(values: readonly T[], code: string): readonly T[] { const normalized = values.map((value) => identifier(value, code) as T); if (new Set(normalized).size !== normalized.length) throw new Error(code); return Object.freeze([...normalized]); }
function atomicWrite(path: string, contents: string): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, contents, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
  try { renameSync(temporary, path); } catch (error) { try { unlinkSync(temporary); } catch { /* best effort */ } throw error; }
  const dir = openSync(dirname(path), 'r');
  try { fsyncSync(dir); } finally { closeSync(dir); }
}
function median(values: readonly number[]): number { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2; }
