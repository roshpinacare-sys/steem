import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../src/contracts/crypto.js';
import { buildPushApprovalCard, compileChatMission, type PushApprovalCard } from '../src/product/chat-mission.js';
import {
  DeviceBindingRegistry,
  SimulatedDevicePushGateway,
  type DeviceEnrollmentGrant,
  type DeviceRevocation,
  type PushDeliveryChallenge,
} from '../src/product/device-push-v33_3.js';
import { InMemoryApprovalInbox } from '../src/product/mission-conversation-v33_2.js';
import {
  DeviceRecoveryCoordinator,
  DeviceSessionRegistry,
  FilePushOutbox,
  InMemoryPushOutbox,
  LossySimulatedPushAdapter,
  PermanentPushTransportError,
  ReliablePushDispatcher,
  evaluateTransportReliability,
  type DeviceReplacementGrant,
  type PushTransportAdapter,
  type PushTransportProviderReceipt,
  type PushTransportFault,
  type TransportNeutralPushRequest,
} from '../src/product/reliable-push-v33_4.js';

const t0 = new Date('2026-07-21T04:00:00.000Z');

interface Fixture {
  readonly registrar: SigningIdentity;
  readonly gatewayIdentity: SigningIdentity;
  readonly providerIdentity: SigningIdentity;
  readonly deviceIdentity: SigningIdentity;
  readonly registrarKeys: KeyRegistry;
  readonly gatewayKeys: KeyRegistry;
  readonly providerKeys: KeyRegistry;
  readonly deviceKeys: KeyRegistry;
  readonly devices: DeviceBindingRegistry;
  readonly enrollment: SignedEnvelope<DeviceEnrollmentGrant>;
  readonly inbox: InMemoryApprovalInbox;
  readonly gateway: SimulatedDevicePushGateway;
  readonly outbox: InMemoryPushOutbox;
  readonly adapter: LossySimulatedPushAdapter;
  readonly dispatcher: ReliablePushDispatcher;
}

function fixture(faults: readonly PushTransportFault[] = []): Fixture {
  const registrar = generateSigningIdentity('registrar-v33.4');
  const gatewayIdentity = generateSigningIdentity('gateway-v33.4');
  const providerIdentity = generateSigningIdentity('provider-v33.4');
  const deviceIdentity = generateSigningIdentity('device-v33.4');
  const registrarKeys = new KeyRegistry(); registrarKeys.register(registrar.keyId, registrar.publicKey);
  const gatewayKeys = new KeyRegistry(); gatewayKeys.register(gatewayIdentity.keyId, gatewayIdentity.publicKey);
  const providerKeys = new KeyRegistry(); providerKeys.register(providerIdentity.keyId, providerIdentity.publicKey);
  const deviceKeys = new KeyRegistry(); deviceKeys.register(deviceIdentity.keyId, deviceIdentity.publicKey);
  const enrollment = enrollmentFor(registrar, deviceKeys, deviceIdentity, 'phone-1', 'reviewer-1', 'enrollment-1');
  const devices = new DeviceBindingRegistry(registrarKeys, [registrar.keyId]);
  devices.enroll(enrollment, t0);
  const inbox = new InMemoryApprovalInbox();
  const gateway = new SimulatedDevicePushGateway(inbox, devices, gatewayIdentity, gatewayKeys);
  const outbox = new InMemoryPushOutbox(gatewayKeys, [gatewayIdentity.keyId], providerKeys, [providerIdentity.keyId]);
  const adapter = new LossySimulatedPushAdapter('sim-provider', providerIdentity, providerKeys, faults);
  const dispatcher = new ReliablePushDispatcher(outbox, devices, adapter, gatewayKeys, [gatewayIdentity.keyId], providerKeys, [providerIdentity.keyId]);
  return { registrar, gatewayIdentity, providerIdentity, deviceIdentity, registrarKeys, gatewayKeys, providerKeys, deviceKeys, devices, enrollment, inbox, gateway, outbox, adapter, dispatcher };
}

function enrollmentFor(
  registrar: SigningIdentity,
  keys: KeyRegistry,
  identity: SigningIdentity,
  deviceId: string,
  userId: string,
  enrollmentId: string,
): SignedEnvelope<DeviceEnrollmentGrant> {
  return signEnvelope({
    version: '33.3', enrollmentId, tenantId: 'tenant-1', userId, deviceId,
    channel: 'SIMULATED_PUSH', devicePublicKey: keys.exportPublicKey(identity.keyId),
    capabilities: ['APPROVAL_RECEIVE', 'APPROVAL_DECIDE'], issuedAt: '2026-07-21T03:50:00.000Z',
    notBefore: '2026-07-21T03:50:00.000Z', notAfter: '2026-07-21T07:00:00.000Z',
    nonce: `${enrollmentId}-nonce`, productionCeiling: 'shadow',
  }, registrar);
}

function card(index = 1, expiresAt = '2026-07-21T05:00:00.000Z'): PushApprovalCard {
  const grant = {
    grantId: `grant-${index}`, tenantId: 'tenant-1', subjectId: 'operator-1', workspaceId: 'workspace-1',
    scopes: ['production.deploy'], issuedAt: '2026-07-21T03:00:00.000Z', expiresAt: '2026-07-21T08:00:00.000Z', issuer: 'canonical-authority',
  };
  const policy = {
    policyId: `policy-${index}`, autoPrepareScopes: [], approvalRequiredScopes: ['production.deploy'], maxAutoPrepareCostUsd: 0,
    maxAutoPrepareRisk: 'LOW' as const, minimumConfidence: 0.99, requireApprovalForIrreversible: true,
    requireApprovalForUnknownReversibility: true, approverIds: ['reviewer-1'],
  };
  const mission = compileChatMission({
    missionId: `mission-${index}`, tenantId: 'tenant-1', requesterId: 'operator-1', workspaceId: 'workspace-1',
    message: 'Prepare and ask once.', objective: 'Prepare governed approval', requestedScopes: ['production.deploy'],
    riskLevel: 'CRITICAL', reversibility: 'IRREVERSIBLE', estimatedCostUsd: 20, confidence: 0.9,
    constraints: ['one approval'], prohibitedActions: ['external effect'], completionCriteria: ['signed decision'],
    createdAt: '2026-07-21T03:59:00.000Z', expiresAt,
  }, grant, policy, t0);
  return buildPushApprovalCard(mission, policy);
}

function issue(f: Fixture, index = 1, expiresAt = '2026-07-21T04:30:00.000Z'): SignedEnvelope<PushDeliveryChallenge> {
  const approval = card(index, '2026-07-21T05:00:00.000Z');
  f.inbox.enqueue(approval, t0);
  return f.gateway.issue(approval, {
    deliveryId: `delivery-${index}`, approverId: 'reviewer-1', deviceId: 'phone-1', challengeNonce: `challenge-${index}`,
    issuedAt: '2026-07-21T04:00:00.000Z', expiresAt, attempt: 1,
  }, t0);
}

function enqueue(f: Fixture, index = 1, expiresAt?: string): SignedEnvelope<PushDeliveryChallenge> {
  const delivery = issue(f, index, expiresAt);
  f.outbox.enqueue(delivery, { requestId: `request-${index}`, targetAdapterId: 'sim-provider', providerDedupKey: `dedup-${index}`, queuedAt: t0.toISOString() }, t0);
  return delivery;
}

test('transport-neutral dispatcher accepts a trusted gateway delivery', () => {
  const f = fixture();
  enqueue(f);
  const result = f.dispatcher.dispatchOne('worker-1', t0);
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.item?.state, 'ACCEPTED');
  assert.equal(result.item?.externalEffectsExecuted, 0);
  assert.equal(f.adapter.metrics().uniqueProviderAcceptances, 1);
});

test('untrusted gateway delivery is dead-lettered before provider acceptance', () => {
  const f = fixture();
  const attacker = generateSigningIdentity('attacker-gateway');
  const legitimate = issue(f);
  const forged = signEnvelope(legitimate.payload, attacker);
  assert.throws(() => f.outbox.enqueue(forged, { requestId: 'request-forged', targetAdapterId: 'sim-provider', providerDedupKey: 'dedup-forged', queuedAt: t0.toISOString() }, t0), /push_gateway_delivery_signature_invalid/);
  assert.equal(f.adapter.metrics().uniqueProviderAcceptances, 0);
});

test('drop before provider schedules retry and later succeeds', () => {
  const f = fixture(['DROP_BEFORE_PROVIDER', 'ACCEPT']);
  enqueue(f);
  assert.equal(f.dispatcher.dispatchOne('worker-1', t0, { retryDelayMs: 1_000 }).status, 'RETRY_SCHEDULED');
  assert.equal(f.dispatcher.dispatchOne('worker-2', new Date('2026-07-21T04:00:00.500Z')).status, 'IDLE');
  assert.equal(f.dispatcher.dispatchOne('worker-2', new Date('2026-07-21T04:00:01.000Z')).status, 'ACCEPTED');
  assert.equal(f.outbox.get('request-1')?.attempts.length, 2);
});

test('provider acceptance with lost response remains exactly once after retry', () => {
  const f = fixture(['ACCEPT_RESPONSE_LOST', 'ACCEPT']);
  enqueue(f);
  assert.equal(f.dispatcher.dispatchOne('worker-1', t0, { retryDelayMs: 1_000 }).status, 'RETRY_SCHEDULED');
  assert.equal(f.adapter.metrics().uniqueProviderAcceptances, 1);
  assert.equal(f.dispatcher.dispatchOne('worker-2', new Date('2026-07-21T04:00:01.000Z')).status, 'ACCEPTED');
  const metrics = f.adapter.metrics();
  assert.equal(metrics.uniqueProviderAcceptances, 1);
  assert.equal(metrics.duplicateSuppressions, 1);
});

test('duplicate network delivery is suppressed by provider deduplication', () => {
  const f = fixture(['DUPLICATE_NETWORK']);
  enqueue(f);
  assert.equal(f.dispatcher.dispatchOne('worker-1', t0).status, 'ACCEPTED');
  assert.equal(f.adapter.metrics().uniqueProviderAcceptances, 1);
  assert.equal(f.adapter.metrics().duplicateSuppressions, 1);
});

test('delayed first request permits second request and later retry reorders safely', () => {
  const f = fixture(['DELAY', 'ACCEPT', 'ACCEPT']);
  enqueue(f, 1);
  enqueue(f, 2);
  assert.equal(f.dispatcher.dispatchOne('worker-1', t0, { retryDelayMs: 2_000 }).status, 'RETRY_SCHEDULED');
  const second = f.dispatcher.dispatchOne('worker-2', t0, { retryDelayMs: 2_000 });
  assert.equal(second.requestId, 'request-2');
  assert.equal(second.status, 'ACCEPTED');
  const first = f.dispatcher.dispatchOne('worker-3', new Date('2026-07-21T04:00:02.000Z'));
  assert.equal(first.requestId, 'request-1');
  assert.equal(first.status, 'ACCEPTED');
});

test('expired worker lease is recovered after crash and retried', () => {
  const f = fixture();
  enqueue(f);
  const lease = f.outbox.leaseNext('crashed-worker', t0, 1_000);
  assert.ok(lease);
  assert.equal(f.outbox.recoverExpiredLeases(new Date('2026-07-21T04:00:01.000Z')), 1);
  const result = f.dispatcher.dispatchOne('recovery-worker', new Date('2026-07-21T04:00:01.000Z'));
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.item?.crashRecoveries, 1);
});

test('stale lease cannot complete after expiration', () => {
  const f = fixture();
  enqueue(f);
  const lease = f.outbox.leaseNext('worker-1', t0, 1_000)!;
  const receipt = f.adapter.send(lease.request, t0);
  assert.throws(() => f.outbox.accept(lease, receipt, new Date('2026-07-21T04:00:01.000Z')), /push_lease_expired/);
});

test('file outbox reopens, recovers a crash and detects tampering', () => {
  const f = fixture();
  const root = mkdtempSync(join(tmpdir(), 'v33-4-outbox-'));
  const path = join(root, 'outbox.json');
  try {
    const delivery = issue(f);
    const stateIdentity = generateSigningIdentity('outbox-state-v33.4');
    const stateKeys = new KeyRegistry(); stateKeys.register(stateIdentity.keyId, stateIdentity.publicKey);
    const first = new FilePushOutbox(path, stateIdentity, stateKeys, [stateIdentity.keyId], f.gatewayKeys, [f.gatewayIdentity.keyId], f.providerKeys, [f.providerIdentity.keyId]);
    first.enqueue(delivery, { requestId: 'request-file', targetAdapterId: 'sim-provider', providerDedupKey: 'dedup-file', queuedAt: t0.toISOString() }, t0);
    assert.ok(first.leaseNext('crashed-worker', t0, 1_000));
    const reopened = new FilePushOutbox(path, stateIdentity, stateKeys, [stateIdentity.keyId], f.gatewayKeys, [f.gatewayIdentity.keyId], f.providerKeys, [f.providerIdentity.keyId]);
    assert.equal(reopened.recoverExpiredLeases(new Date('2026-07-21T04:00:01.000Z')), 1);
    assert.equal(reopened.get('request-file')?.state, 'RETRY_WAIT');
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as { payload: { snapshot: { items: Array<{ state: string; itemDigest: string }>; snapshotDigest: string }; recordDigest: string } };
    snapshot.payload.snapshot.items[0]!.state = 'ACCEPTED';
    snapshot.payload.snapshot.items[0]!.itemDigest = sha256({ forged: true });
    snapshot.payload.snapshot.snapshotDigest = sha256({ forged: true });
    snapshot.payload.recordDigest = sha256({ forged: true });
    writeFileSync(path, `${JSON.stringify(snapshot)}\n`, 'utf8');
    assert.throws(() => reopened.list(), /push_outbox_file_tampered/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('revocation invalidates queued delivery before transport', () => {
  const f = fixture();
  enqueue(f);
  const revocation: DeviceRevocation = {
    version: '33.3', revocationId: 'revocation-queued', tenantId: 'tenant-1', deviceId: 'phone-1',
    enrollmentDigest: sha256(f.enrollment), revokedAt: '2026-07-21T04:00:00.500Z', reason: 'lost', nonce: 'revocation-queued-nonce',
  };
  f.devices.revoke(signEnvelope(revocation, f.registrar), new Date('2026-07-21T04:00:01.000Z'));
  const result = f.dispatcher.dispatchOne('worker-1', new Date('2026-07-21T04:00:01.000Z'));
  assert.equal(result.status, 'REVOKED');
  assert.equal(f.adapter.metrics().uniqueProviderAcceptances, 0);
});

test('active device session is invalidated immediately by device revocation', () => {
  const f = fixture();
  const sessions = new DeviceSessionRegistry(f.devices);
  sessions.open({ sessionId: 'session-1', tenantId: 'tenant-1', userId: 'reviewer-1', deviceId: 'phone-1', issuedAt: t0.toISOString(), expiresAt: '2026-07-21T05:00:00.000Z', nonce: 'session-nonce-1' }, t0);
  assert.equal(sessions.requireActive('session-1', t0).deviceId, 'phone-1');
  const revocation: DeviceRevocation = {
    version: '33.3', revocationId: 'revocation-session', tenantId: 'tenant-1', deviceId: 'phone-1',
    enrollmentDigest: sha256(f.enrollment), revokedAt: '2026-07-21T04:00:00.500Z', reason: 'compromised', nonce: 'revocation-session-nonce',
  };
  f.devices.revoke(signEnvelope(revocation, f.registrar), new Date('2026-07-21T04:00:01.000Z'));
  assert.throws(() => sessions.requireActive('session-1', new Date('2026-07-21T04:00:01.000Z')), /device_revoked/);
});

test('device replacement requires bound registrar proof and revokes old device', () => {
  const f = fixture();
  const newDevice = generateSigningIdentity('device-v33.4-new');
  const newKeys = new KeyRegistry(); newKeys.register(newDevice.keyId, newDevice.publicKey);
  const newEnrollment = enrollmentFor(f.registrar, newKeys, newDevice, 'phone-2', 'reviewer-1', 'enrollment-2');
  const revocation: DeviceRevocation = {
    version: '33.3', revocationId: 'revocation-replace', tenantId: 'tenant-1', deviceId: 'phone-1',
    enrollmentDigest: sha256(f.enrollment), revokedAt: '2026-07-21T04:00:01.000Z', reason: 'replacement', nonce: 'revocation-replace-nonce',
  };
  const grant: DeviceReplacementGrant = {
    version: '33.4', replacementId: 'replacement-1', tenantId: 'tenant-1', userId: 'reviewer-1',
    oldDeviceId: 'phone-1', oldEnrollmentDigest: sha256(f.enrollment), newDeviceId: 'phone-2', newEnrollmentDigest: sha256(newEnrollment),
    issuedAt: t0.toISOString(), notAfter: '2026-07-21T04:30:00.000Z', nonce: 'replacement-nonce-1', reason: 'lost device', productionCeiling: 'shadow',
  };
  const recovery = new DeviceRecoveryCoordinator(f.devices, f.registrarKeys, [f.registrar.keyId]);
  const receipt = recovery.replace(signEnvelope(grant, f.registrar), signEnvelope(revocation, f.registrar), newEnrollment, new Date('2026-07-21T04:00:02.000Z'));
  assert.equal(receipt.newDeviceId, 'phone-2');
  assert.equal(f.devices.get('tenant-1', 'phone-1', new Date('2026-07-21T04:00:02.000Z')).status, 'REVOKED');
  assert.equal(f.devices.requireActive('tenant-1', 'reviewer-1', 'phone-2', 'APPROVAL_RECEIVE', new Date('2026-07-21T04:00:02.000Z')).status, 'ACTIVE');
});

test('mismatched replacement grant fails before mutating registry', () => {
  const f = fixture();
  const newDevice = generateSigningIdentity('device-v33.4-other');
  const newKeys = new KeyRegistry(); newKeys.register(newDevice.keyId, newDevice.publicKey);
  const newEnrollment = enrollmentFor(f.registrar, newKeys, newDevice, 'phone-2', 'reviewer-2', 'enrollment-other');
  const revocation: DeviceRevocation = {
    version: '33.3', revocationId: 'revocation-other', tenantId: 'tenant-1', deviceId: 'phone-1',
    enrollmentDigest: sha256(f.enrollment), revokedAt: '2026-07-21T04:00:01.000Z', reason: 'replacement', nonce: 'revocation-other-nonce',
  };
  const grant: DeviceReplacementGrant = {
    version: '33.4', replacementId: 'replacement-other', tenantId: 'tenant-1', userId: 'reviewer-1',
    oldDeviceId: 'phone-1', oldEnrollmentDigest: sha256(f.enrollment), newDeviceId: 'phone-2', newEnrollmentDigest: sha256(newEnrollment),
    issuedAt: t0.toISOString(), notAfter: '2026-07-21T04:30:00.000Z', nonce: 'replacement-other-nonce', reason: 'lost device', productionCeiling: 'shadow',
  };
  const recovery = new DeviceRecoveryCoordinator(f.devices, f.registrarKeys, [f.registrar.keyId]);
  assert.throws(() => recovery.replace(signEnvelope(grant, f.registrar), signEnvelope(revocation, f.registrar), newEnrollment, new Date('2026-07-21T04:00:02.000Z')), /device_replacement_new_binding_invalid/);
  assert.equal(f.devices.get('tenant-1', 'phone-1', new Date('2026-07-21T04:00:02.000Z')).status, 'ACTIVE');
});

test('provider receipt from untrusted key is rejected and dead-lettered', () => {
  const f = fixture();
  enqueue(f);
  const attacker = generateSigningIdentity('provider-attacker');
  const adapter: PushTransportAdapter = {
    adapterId: 'bad-provider',
    send(request: TransportNeutralPushRequest, now = new Date()): SignedEnvelope<PushTransportProviderReceipt> {
      const material = {
        version: '33.4' as const, adapterId: 'bad-provider', providerMessageId: 'bad-message', tenantId: request.signedDelivery.payload.tenantId, deviceId: request.signedDelivery.payload.deviceId, deliveryId: request.signedDelivery.payload.deliveryId, providerDedupKey: request.providerDedupKey,
        deliveryDigest: request.deliveryDigest, acceptedAt: now.toISOString(), externalEffectsExecuted: 0 as const,
      };
      return signEnvelope({ ...material, receiptDigest: sha256(material) }, attacker);
    },
  };
  const dispatcher = new ReliablePushDispatcher(f.outbox, f.devices, adapter, f.gatewayKeys, [f.gatewayIdentity.keyId], f.providerKeys, [f.providerIdentity.keyId]);
  const result = dispatcher.dispatchOne('worker-1', t0);
  assert.equal(result.status, 'DEAD_LETTER');
  assert.match(result.item?.terminalReason ?? '', /push_provider_receipt_signature_invalid/);
});

test('permanent provider rejection is dead-lettered without retry', () => {
  const f = fixture(['PERMANENT_REJECT']);
  enqueue(f);
  const result = f.dispatcher.dispatchOne('worker-1', t0);
  assert.equal(result.status, 'DEAD_LETTER');
  assert.equal(result.item?.attempts.length, 1);
});

test('transient failures stop at bounded maximum attempts', () => {
  const f = fixture(['DROP_BEFORE_PROVIDER', 'DROP_BEFORE_PROVIDER']);
  enqueue(f);
  assert.equal(f.dispatcher.dispatchOne('worker-1', t0, { retryDelayMs: 1_000, maxAttempts: 2 }).status, 'RETRY_SCHEDULED');
  const second = f.dispatcher.dispatchOne('worker-2', new Date('2026-07-21T04:00:01.000Z'), { retryDelayMs: 1_000, maxAttempts: 2 });
  assert.equal(second.status, 'DEAD_LETTER');
  assert.match(second.item?.terminalReason ?? '', /max_attempts/);
});

test('expired queued request is not leased or sent', () => {
  const f = fixture();
  enqueue(f, 1, '2026-07-21T04:00:01.000Z');
  const result = f.dispatcher.dispatchOne('worker-1', new Date('2026-07-21T04:00:01.000Z'));
  assert.equal(result.status, 'IDLE');
  assert.equal(f.outbox.get('request-1')?.state, 'EXPIRED');
  assert.equal(f.adapter.metrics().sendCalls, 0);
});

test('accepted completion is idempotent for identical receipt', () => {
  const f = fixture();
  enqueue(f);
  const lease = f.outbox.leaseNext('worker-1', t0)!;
  const receipt = f.adapter.send(lease.request, t0);
  const first = f.outbox.accept(lease, receipt, t0);
  const second = f.outbox.accept(lease, receipt, t0);
  assert.equal(first.itemDigest, second.itemDigest);
});

test('outbox snapshot restore rejects tampering', () => {
  const f = fixture();
  enqueue(f);
  const snapshot = f.outbox.export();
  assert.equal(InMemoryPushOutbox.restore(snapshot, f.gatewayKeys, [f.gatewayIdentity.keyId], f.providerKeys, [f.providerIdentity.keyId]).get('request-1')?.state, 'QUEUED');
  const tampered = structuredClone(snapshot);
  (tampered.items[0] as { state: string }).state = 'ACCEPTED';
  assert.throws(() => InMemoryPushOutbox.restore(tampered, f.gatewayKeys, [f.gatewayIdentity.keyId], f.providerKeys, [f.providerIdentity.keyId]), /push_outbox_snapshot_invalid/);
});

test('reliability evidence stays simulated and cannot self-promote G3', () => {
  const f = fixture(['ACCEPT_RESPONSE_LOST', 'ACCEPT', 'DUPLICATE_NETWORK']);
  enqueue(f, 1);
  enqueue(f, 2);
  assert.equal(f.dispatcher.dispatchOne('worker-1', t0, { retryDelayMs: 1_000 }).status, 'RETRY_SCHEDULED');
  assert.equal(f.dispatcher.dispatchOne('worker-2', t0).status, 'ACCEPTED');
  assert.equal(f.dispatcher.dispatchOne('worker-3', new Date('2026-07-21T04:00:01.000Z')).status, 'ACCEPTED');
  const evidence = evaluateTransportReliability(f.outbox, f.adapter.metrics());
  assert.equal(evidence.requests, 2);
  assert.equal(evidence.accepted, 2);
  assert.equal(evidence.successRatePct, 100);
  assert.ok(evidence.duplicateSuppressions >= 2);
  assert.equal(evidence.evidenceClass, 'SIMULATED_FAULT_INJECTION');
  assert.equal(evidence.g3Eligible, false);
  assert.equal(evidence.externalEffectsExecuted, 0);
});

test('adapter rejects provider dedup collision across different delivery digests', () => {
  const f = fixture();
  const first = enqueue(f, 1);
  const lease = f.outbox.leaseNext('worker-1', t0)!;
  f.adapter.send(lease.request, t0);
  const other = issue(f, 2);
  const request: TransportNeutralPushRequest = {
    ...lease.request,
    requestId: 'collision-request',
    signedDelivery: other,
    deliveryDigest: sha256(other),
    requestDigest: '',
  };
  const { requestDigest: _, ...material } = request;
  const collision = { ...request, requestDigest: sha256(material) };
  assert.throws(() => f.adapter.send(collision, t0), PermanentPushTransportError);
  assert.notEqual(sha256(first), sha256(other));
});

test('trusted provider cannot accept a request targeted to another adapter', () => {
  const f = fixture();
  enqueue(f);
  const adapter = new LossySimulatedPushAdapter('other-provider', f.providerIdentity, f.providerKeys, ['ACCEPT']);
  const dispatcher = new ReliablePushDispatcher(f.outbox, f.devices, adapter, f.gatewayKeys, [f.gatewayIdentity.keyId], f.providerKeys, [f.providerIdentity.keyId]);
  const result = dispatcher.dispatchOne('worker-wrong-adapter', t0);
  assert.equal(result.status, 'DEAD_LETTER');
  assert.match(result.item?.terminalReason ?? '', /push_transport_adapter_mismatch/);
});

test('provider dedup key is scoped by adapter and tenant', () => {
  const f = fixture();
  const first = issue(f, 1);
  f.outbox.enqueue(first, { requestId: 'request-tenant-1', targetAdapterId: 'sim-provider', providerDedupKey: 'shared-dedup', queuedAt: t0.toISOString() }, t0);
  const tenantTwoPayload = {
    ...first.payload,
    deliveryId: 'delivery-tenant-2',
    tenantId: 'tenant-2',
    cardId: 'card-tenant-2',
    cardDigest: sha256({ tenant: 2, card: true }),
    deviceEnrollmentDigest: sha256({ tenant: 2, enrollment: true }),
    challengeNonce: 'challenge-tenant-2',
  };
  const tenantTwo = signEnvelope(tenantTwoPayload, f.gatewayIdentity);
  assert.doesNotThrow(() => f.outbox.enqueue(tenantTwo, { requestId: 'request-tenant-2', targetAdapterId: 'sim-provider', providerDedupKey: 'shared-dedup', queuedAt: t0.toISOString() }, t0));
});

test('accepted idempotent retry requires the exact original lease binding', () => {
  const f = fixture();
  enqueue(f);
  const lease = f.outbox.leaseNext('worker-1', t0)!;
  const receipt = f.adapter.send(lease.request, t0);
  f.outbox.accept(lease, receipt, t0);
  const forgedLease = { ...lease, workerId: 'worker-attacker' };
  assert.throws(() => f.outbox.accept(forgedLease, receipt, t0), /push_lease_binding_invalid/);
});
