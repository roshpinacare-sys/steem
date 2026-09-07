import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AuthorityGrant } from '../src/contracts/canonical.js';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../src/contracts/crypto.js';
import {
  buildPushApprovalCard,
  compileChatMission,
  type ApprovalPolicy,
  type ChatMissionRequest,
  type PushApprovalCard,
} from '../src/product/chat-mission.js';
import {
  DeviceBindingRegistry,
  FileApprovalInbox,
  SimulatedDevicePushGateway,
  evaluateUserFlow,
  type DeviceApprovalCommand,
  type DeviceDeliveryAcknowledgement,
  type DeviceEnrollmentGrant,
  type DeviceRevocation,
  type PushDeliveryChallenge,
} from '../src/product/device-push-v33_3.js';
import { InMemoryApprovalInbox } from '../src/product/mission-conversation-v33_2.js';

const t0 = new Date('2026-07-21T04:00:00.000Z');
const grant: AuthorityGrant = {
  grantId: 'grant-push-1', tenantId: 'tenant-1', subjectId: 'user-1', workspaceId: 'workspace-1',
  scopes: ['production.deploy'], issuedAt: '2026-07-21T03:00:00.000Z', expiresAt: '2026-07-21T08:00:00.000Z', issuer: 'canonical-authority',
};
const policy: ApprovalPolicy = {
  policyId: 'policy-push-1', autoPrepareScopes: [], approvalRequiredScopes: ['production.deploy'],
  maxAutoPrepareCostUsd: 0, maxAutoPrepareRisk: 'LOW', minimumConfidence: 0.99,
  requireApprovalForIrreversible: true, requireApprovalForUnknownReversibility: true,
  approverIds: ['reviewer-1'],
};
const request: ChatMissionRequest = {
  missionId: 'mission-push-1', tenantId: 'tenant-1', requesterId: 'user-1', workspaceId: 'workspace-1',
  message: 'Prepare a production deployment proposal, but do not execute it.', objective: 'Approve bounded deployment preparation',
  requestedScopes: ['production.deploy'], riskLevel: 'CRITICAL', reversibility: 'IRREVERSIBLE', estimatedCostUsd: 20, confidence: 0.9,
  constraints: ['one approval'], prohibitedActions: ['execute production effect'], completionCriteria: ['signed decision receipt'],
  createdAt: '2026-07-21T03:59:00.000Z', expiresAt: '2026-07-21T05:00:00.000Z',
};

interface Fixture {
  readonly registrar: SigningIdentity;
  readonly gatewayIdentity: SigningIdentity;
  readonly device: SigningIdentity;
  readonly registrarKeys: KeyRegistry;
  readonly gatewayKeys: KeyRegistry;
  readonly devices: DeviceBindingRegistry;
  readonly inbox: InMemoryApprovalInbox;
  readonly gateway: SimulatedDevicePushGateway;
  readonly card: PushApprovalCard;
  readonly enrollment: SignedEnvelope<DeviceEnrollmentGrant>;
}

function fixture(): Fixture {
  const registrar = generateSigningIdentity('registrar-1');
  const gatewayIdentity = generateSigningIdentity('push-gateway-1');
  const device = generateSigningIdentity('device-key-1');
  const registrarKeys = new KeyRegistry();
  registrarKeys.register(registrar.keyId, registrar.publicKey);
  const gatewayKeys = new KeyRegistry();
  gatewayKeys.register(gatewayIdentity.keyId, gatewayIdentity.publicKey);
  const devicePublic = new KeyRegistry();
  devicePublic.register(device.keyId, device.publicKey);
  const enrollmentPayload: DeviceEnrollmentGrant = {
    version: '33.3', enrollmentId: 'enrollment-1', tenantId: 'tenant-1', userId: 'reviewer-1', deviceId: 'phone-1',
    channel: 'SIMULATED_PUSH', devicePublicKey: devicePublic.exportPublicKey(device.keyId),
    capabilities: ['APPROVAL_RECEIVE', 'APPROVAL_DECIDE'], issuedAt: '2026-07-21T03:50:00.000Z',
    notBefore: '2026-07-21T03:50:00.000Z', notAfter: '2026-07-21T06:00:00.000Z', nonce: 'enrollment-nonce-1', productionCeiling: 'shadow',
  };
  const enrollment = signEnvelope(enrollmentPayload, registrar);
  const devices = new DeviceBindingRegistry(registrarKeys, [registrar.keyId]);
  devices.enroll(enrollment, t0);
  const mission = compileChatMission(request, grant, policy, t0);
  const card = buildPushApprovalCard(mission, policy);
  const inbox = new InMemoryApprovalInbox();
  inbox.enqueue(card, t0);
  const gateway = new SimulatedDevicePushGateway(inbox, devices, gatewayIdentity, gatewayKeys);
  return { registrar, gatewayIdentity, device, registrarKeys, gatewayKeys, devices, inbox, gateway, card, enrollment };
}

function delivery(f: Fixture, overrides: Partial<Parameters<SimulatedDevicePushGateway['issue']>[1]> = {}): SignedEnvelope<PushDeliveryChallenge> {
  return f.gateway.issue(f.card, {
    deliveryId: 'delivery-1', approverId: 'reviewer-1', deviceId: 'phone-1', challengeNonce: 'challenge-1',
    issuedAt: '2026-07-21T04:00:00.000Z', expiresAt: '2026-07-21T04:30:00.000Z', attempt: 1, ...overrides,
  }, t0);
}

function acknowledgement(f: Fixture, sent: SignedEnvelope<PushDeliveryChallenge>, overrides: Partial<DeviceDeliveryAcknowledgement> = {}): SignedEnvelope<DeviceDeliveryAcknowledgement> {
  return signEnvelope({
    version: '33.3', acknowledgementId: 'ack-1', deliveryDigest: sha256(sent), tenantId: 'tenant-1', cardId: f.card.cardId,
    cardDigest: f.card.cardDigest, approverId: 'reviewer-1', deviceId: 'phone-1', challengeNonce: 'challenge-1',
    receivedAt: '2026-07-21T04:00:01.000Z', externalEffectsExecuted: 0, ...overrides,
  }, f.device);
}

function command(f: Fixture, sent: SignedEnvelope<PushDeliveryChallenge>, overrides: Partial<DeviceApprovalCommand> = {}): SignedEnvelope<DeviceApprovalCommand> {
  return signEnvelope({
    version: '33.3', commandNonce: 'command-nonce-1', decisionId: 'decision-1', deliveryDigest: sha256(sent), tenantId: 'tenant-1',
    cardId: f.card.cardId, cardDigest: f.card.cardDigest, actorId: 'reviewer-1', deviceId: 'phone-1', challengeNonce: 'challenge-1',
    option: 'YES', occurredAt: '2026-07-21T04:00:02.000Z', reason: 'Approve only scopes already present in the card', externalEffectsExecuted: 0,
    ...overrides,
  }, f.device);
}

test('device enrollment requires a trusted registrar signature and fixed capabilities', () => {
  const f = fixture();
  const row = f.devices.get('tenant-1', 'phone-1', t0);
  assert.equal(row.status, 'ACTIVE');
  assert.equal(row.externalEffectsExecuted, 0);
  const attacker = generateSigningIdentity('attacker-registrar');
  const forged = signEnvelope({ ...f.enrollment.payload, enrollmentId: 'enrollment-forged', deviceId: 'phone-forged' }, attacker);
  assert.throws(() => f.devices.enroll(forged, t0), /device_registrar_untrusted/);
});

test('device identity conflicts and cross-user binding fail closed', () => {
  const f = fixture();
  const otherDevice = generateSigningIdentity('other-device-key');
  const publicKeys = new KeyRegistry(); publicKeys.register(otherDevice.keyId, otherDevice.publicKey);
  const conflict = signEnvelope({ ...f.enrollment.payload, enrollmentId: 'enrollment-2', nonce: 'enrollment-nonce-2', devicePublicKey: publicKeys.exportPublicKey(otherDevice.keyId) }, f.registrar);
  assert.throws(() => f.devices.enroll(conflict, t0), /device_identity_conflict/);
  assert.throws(() => f.devices.requireActive('tenant-1', 'reviewer-2', 'phone-1', 'APPROVAL_RECEIVE', t0), /device_user_binding_mismatch/);
});



test('a device public key cannot be rebound to another device or user', () => {
  const f = fixture();
  const reused = signEnvelope({
    ...f.enrollment.payload, enrollmentId: 'enrollment-reuse', nonce: 'enrollment-reuse-nonce', deviceId: 'phone-2', userId: 'reviewer-2',
  }, f.registrar);
  assert.throws(() => f.devices.enroll(reused, t0), /device_public_key_reuse/);
});

test('gateway private key must match the registered public key', () => {
  const f = fixture();
  const wrong = generateSigningIdentity('push-gateway-1');
  const wrongKeys = new KeyRegistry();
  wrongKeys.register(wrong.keyId, wrong.publicKey);
  assert.throws(() => new SimulatedDevicePushGateway(f.inbox, f.devices, f.gatewayIdentity, wrongKeys), /gateway_signing_key_mismatch/);
});
test('push cannot be issued for a card that is not in the canonical inbox', () => {
  const f = fixture();
  const empty = new InMemoryApprovalInbox();
  const gateway = new SimulatedDevicePushGateway(empty, f.devices, f.gatewayIdentity, f.gatewayKeys);
  assert.throws(() => gateway.issue(f.card, {
    deliveryId: 'missing-card', approverId: 'reviewer-1', deviceId: 'phone-1', challengeNonce: 'missing-card-nonce',
    issuedAt: '2026-07-21T04:00:00.000Z', expiresAt: '2026-07-21T04:30:00.000Z', attempt: 1,
  }, t0), /approval_card_not_enqueued/);
});

test('device-bound push acknowledgement and decision produce signed receipts without effects', () => {
  const f = fixture();
  const sent = delivery(f);
  const ack = acknowledgement(f, sent);
  const deliveryReceipt = f.gateway.acknowledge(ack, new Date('2026-07-21T04:00:01.000Z'));
  assert.equal(deliveryReceipt.externalEffectsExecuted, 0);
  const receipt = f.gateway.decide(command(f, sent), new Date('2026-07-21T04:00:03.000Z'));
  assert.equal(f.gatewayKeys.verifyAt(receipt, '2026-07-21T04:00:03.000Z'), true);
  assert.equal(receipt.payload.canonicalDecision.outcome, 'APPROVED');
  assert.deepEqual(receipt.payload.canonicalDecision.approvedScopes, ['production.deploy']);
  assert.equal(receipt.payload.externalEffectsExecuted, 0);
  assert.equal(receipt.payload.canonicalDecision.externalEffectsExecuted, 0);
});

test('duplicate network delivery, acknowledgement and decision are idempotent', () => {
  const f = fixture();
  const sent = delivery(f);
  assert.equal(sha256(delivery(f)), sha256(sent));
  const ack = acknowledgement(f, sent);
  const firstAck = f.gateway.acknowledge(ack, new Date('2026-07-21T04:00:01.000Z'));
  const retryAck = f.gateway.acknowledge(ack, new Date('2026-07-21T04:00:02.000Z'));
  assert.equal(firstAck.deliveryDigest, retryAck.deliveryDigest);
  const signedCommand = command(f, sent);
  const first = f.gateway.decide(signedCommand, new Date('2026-07-21T04:00:03.000Z'));
  const retry = f.gateway.decide(signedCommand, new Date('2026-07-21T04:00:04.000Z'));
  assert.equal(sha256(first), sha256(retry));
});



test('accepted retries remain idempotent after delivery expiry and later device revocation', () => {
  const f = fixture();
  const sent = delivery(f, { expiresAt: '2026-07-21T04:10:00.000Z' });
  const ack = acknowledgement(f, sent);
  const signedCommand = command(f, sent);
  const acceptedAck = f.gateway.acknowledge(ack, new Date('2026-07-21T04:00:01.000Z'));
  const acceptedDecision = f.gateway.decide(signedCommand, new Date('2026-07-21T04:00:03.000Z'));
  const revocationPayload: DeviceRevocation = {
    version: '33.3', revocationId: 'revocation-after-accepted', tenantId: 'tenant-1', deviceId: 'phone-1',
    enrollmentDigest: sha256(f.enrollment), revokedAt: '2026-07-21T04:05:00.000Z', reason: 'retired', nonce: 'revocation-after-accepted-nonce',
  };
  f.devices.revoke(signEnvelope(revocationPayload, f.registrar), new Date('2026-07-21T04:05:01.000Z'));
  const retryAck = f.gateway.acknowledge(ack, new Date('2026-07-21T04:20:00.000Z'));
  const retryDecision = f.gateway.decide(signedCommand, new Date('2026-07-21T04:20:00.000Z'));
  assert.equal(retryAck.deliveryDigest, acceptedAck.deliveryDigest);
  assert.equal(sha256(retryDecision), sha256(acceptedDecision));
});
test('tampered or wrong-device signatures are rejected', () => {
  const f = fixture();
  const sent = delivery(f);
  const attacker = generateSigningIdentity('attacker-device');
  const forgedAck = signEnvelope(acknowledgement(f, sent).payload, attacker);
  assert.throws(() => f.gateway.acknowledge(forgedAck, new Date('2026-07-21T04:00:02.000Z')), /device_ack_signature_invalid/);
  const tampered = structuredClone(acknowledgement(f, sent));
  (tampered.payload as { cardId: string }).cardId = 'other-card';
  assert.throws(() => f.gateway.acknowledge(tampered, new Date('2026-07-21T04:00:02.000Z')), /push_ack_binding_invalid/);
});

test('decision before acknowledgement and decision before delivery fail closed', () => {
  const f = fixture();
  const sent = delivery(f);
  assert.throws(() => f.gateway.decide(command(f, sent), new Date('2026-07-21T04:00:03.000Z')), /push_delivery_not_acknowledged/);
  f.gateway.acknowledge(acknowledgement(f, sent), new Date('2026-07-21T04:00:01.000Z'));
  assert.throws(() => f.gateway.decide(command(f, sent, { decisionId: 'decision-early', commandNonce: 'command-early', occurredAt: '2026-07-21T04:00:00.500Z' }), new Date('2026-07-21T04:00:03.000Z')), /approval_before_delivery/);
});

test('command nonce replay with changed content is rejected', () => {
  const f = fixture();
  const sent = delivery(f);
  f.gateway.acknowledge(acknowledgement(f, sent), new Date('2026-07-21T04:00:01.000Z'));
  f.gateway.decide(command(f, sent, { option: 'EXPLAIN' }), new Date('2026-07-21T04:00:03.000Z'));
  const replay = command(f, sent, { decisionId: 'decision-2', option: 'NO' });
  assert.throws(() => f.gateway.decide(replay, new Date('2026-07-21T04:00:04.000Z')), /device_command_replay/);
});

test('revoked device cannot acknowledge or decide even with a previously valid key', () => {
  const f = fixture();
  const sent = delivery(f);
  const revocationPayload: DeviceRevocation = {
    version: '33.3', revocationId: 'revocation-1', tenantId: 'tenant-1', deviceId: 'phone-1',
    enrollmentDigest: sha256(f.enrollment), revokedAt: '2026-07-21T04:00:00.500Z', reason: 'device lost', nonce: 'revocation-nonce-1',
  };
  f.devices.revoke(signEnvelope(revocationPayload, f.registrar), new Date('2026-07-21T04:00:01.000Z'));
  assert.throws(() => f.gateway.acknowledge(acknowledgement(f, sent), new Date('2026-07-21T04:00:02.000Z')), /device_revoked/);
});

test('expired push challenge blocks acknowledgement and decision', () => {
  const f = fixture();
  const sent = delivery(f, { expiresAt: '2026-07-21T04:00:02.000Z' });
  assert.throws(() => f.gateway.acknowledge(acknowledgement(f, sent, { receivedAt: '2026-07-21T04:00:01.000Z' }), new Date('2026-07-21T04:00:02.000Z')), /push_delivery_expired/);
});

test('cross-tenant and cross-device payload binding is rejected', () => {
  const f = fixture();
  const sent = delivery(f);
  assert.throws(() => f.gateway.acknowledge(acknowledgement(f, sent, { tenantId: 'tenant-2' }), new Date('2026-07-21T04:00:02.000Z')), /push_ack_binding_invalid/);
  assert.throws(() => f.gateway.acknowledge(acknowledgement(f, sent, { deviceId: 'phone-2' }), new Date('2026-07-21T04:00:02.000Z')), /push_ack_binding_invalid/);
});

test('device registry snapshot restores and rejects tampering', () => {
  const f = fixture();
  const snapshot = f.devices.export();
  const restored = DeviceBindingRegistry.restore(snapshot, f.registrarKeys, ['registrar-1'], t0);
  assert.equal(restored.get('tenant-1', 'phone-1', t0).enrollmentDigest, sha256(f.enrollment));
  const tampered = structuredClone(snapshot);
  (tampered.devices[0] as { status: string }).status = 'REVOKED';
  assert.throws(() => DeviceBindingRegistry.restore(tampered, f.registrarKeys, ['registrar-1'], t0), /device_registry_snapshot_invalid/);
});

test('push gateway snapshot restores signed state and rejects tampering', () => {
  const f = fixture();
  const sent = delivery(f);
  f.gateway.acknowledge(acknowledgement(f, sent), new Date('2026-07-21T04:00:01.000Z'));
  f.gateway.decide(command(f, sent), new Date('2026-07-21T04:00:03.000Z'));
  const snapshot = f.gateway.exportSigned(new Date('2026-07-21T04:00:04.000Z'));
  const restoredInbox = InMemoryApprovalInbox.restore(f.inbox.export(), new Date('2026-07-21T04:00:04.000Z'));
  const restored = SimulatedDevicePushGateway.restoreSigned(snapshot, restoredInbox, f.devices, f.gatewayIdentity, f.gatewayKeys, new Date('2026-07-21T04:00:04.000Z'));
  assert.equal(restored.getDelivery('delivery-1')?.payload.deviceId, 'phone-1');
  const tampered = structuredClone(snapshot);
  (tampered.payload.deliveries[0]!.payload as { deviceId: string }).deviceId = 'attacker-phone';
  assert.throws(() => SimulatedDevicePushGateway.restoreSigned(tampered, restoredInbox, f.devices, f.gatewayIdentity, f.gatewayKeys, new Date('2026-07-21T04:00:04.000Z')), /push_gateway_snapshot_signature_invalid/);
});



test('delayed pre-revocation acknowledgement is rejected after revocation acceptance time', () => {
  const f = fixture();
  const sent = delivery(f);
  const revocationPayload: DeviceRevocation = {
    version: '33.3', revocationId: 'revocation-delayed', tenantId: 'tenant-1', deviceId: 'phone-1',
    enrollmentDigest: sha256(f.enrollment), revokedAt: '2026-07-21T04:00:00.500Z', reason: 'device compromise', nonce: 'revocation-delayed-nonce',
  };
  f.devices.revoke(signEnvelope(revocationPayload, f.registrar), new Date('2026-07-21T04:00:01.000Z'));
  const signedBeforeRevocation = acknowledgement(f, sent, { receivedAt: '2026-07-21T04:00:00.250Z' });
  assert.throws(() => f.gateway.acknowledge(signedBeforeRevocation, new Date('2026-07-21T04:00:02.000Z')), /device_revoked/);
});

test('historical signed push state remains verifiable after later device revocation', () => {
  const f = fixture();
  const sent = delivery(f);
  f.gateway.acknowledge(acknowledgement(f, sent), new Date('2026-07-21T04:00:01.000Z'));
  f.gateway.decide(command(f, sent), new Date('2026-07-21T04:00:03.000Z'));
  const revocationPayload: DeviceRevocation = {
    version: '33.3', revocationId: 'revocation-after-decision', tenantId: 'tenant-1', deviceId: 'phone-1',
    enrollmentDigest: sha256(f.enrollment), revokedAt: '2026-07-21T04:10:00.000Z', reason: 'device retired', nonce: 'revocation-after-nonce',
  };
  f.devices.revoke(signEnvelope(revocationPayload, f.registrar), new Date('2026-07-21T04:10:01.000Z'));
  const signedSnapshot = f.gateway.exportSigned(new Date('2026-07-21T04:11:00.000Z'));
  const restoredDevices = DeviceBindingRegistry.restore(f.devices.export(), f.registrarKeys, ['registrar-1'], new Date('2026-07-21T04:11:00.000Z'));
  const restoredInbox = InMemoryApprovalInbox.restore(f.inbox.export(), new Date('2026-07-21T04:11:00.000Z'));
  const restored = SimulatedDevicePushGateway.restoreSigned(signedSnapshot, restoredInbox, restoredDevices, f.gatewayIdentity, f.gatewayKeys, new Date('2026-07-21T04:11:00.000Z'));
  assert.equal(restored.getDelivery('delivery-1')?.payload.approverId, 'reviewer-1');
});

test('file approval inbox persists across reopen and detects tampering', () => {
  const f = fixture();
  const root = mkdtempSync(join(tmpdir(), 'v33-3-inbox-'));
  const path = join(root, 'approval-inbox.json');
  try {
    const first = new FileApprovalInbox(path);
    first.enqueue(f.card, t0);
    const reopened = new FileApprovalInbox(path);
    assert.equal(reopened.get('tenant-1', f.card.cardId, t0)?.state, 'PENDING');
    const rows = JSON.parse(readFileSync(path, 'utf8')) as Array<{ state: string }>;
    rows[0]!.state = 'DECIDED';
    writeFileSync(path, `${JSON.stringify(rows)}\n`, 'utf8');
    assert.throws(() => reopened.get('tenant-1', f.card.cardId, t0), /approval_inbox_file_tampered/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('simulated flow can prove structural reduction but cannot promote G3', () => {
  const result = evaluateUserFlow([
    { scenarioId: 'patch', baselineUserSteps: 10, prototypeUserSteps: 2, approvals: 1, humanObserved: false },
    { scenarioId: 'dependency', baselineUserSteps: 8, prototypeUserSteps: 2, approvals: 1, humanObserved: false },
    { scenarioId: 'rollback', baselineUserSteps: 12, prototypeUserSteps: 3, approvals: 1, humanObserved: false },
  ], false);
  assert.equal(result.stepReductionPct, 76.67);
  assert.equal(result.medianApprovals, 1);
  assert.equal(result.structuralCriteriaPassed, true);
  assert.equal(result.humanCriteriaPassed, false);
  assert.equal(result.g3Eligible, false);
  assert.equal(result.evidenceClass, 'SIMULATED');
});

test('G3 eligibility requires human observations, fast comprehension and accessibility', () => {
  const scenarios = Array.from({ length: 5 }, (_, index) => ({
    scenarioId: `human-${index}`, baselineUserSteps: 10, prototypeUserSteps: 2, approvals: index === 4 ? 0 : 1,
    humanObserved: true, comprehensionSeconds: 6 + index * 0.5,
  }));
  const passed = evaluateUserFlow(scenarios, true);
  assert.equal(passed.g3Eligible, true);
  const inaccessible = evaluateUserFlow(scenarios, false);
  assert.equal(inaccessible.g3Eligible, false);
  const slow = evaluateUserFlow(scenarios.map((row) => ({ ...row, comprehensionSeconds: 12 })), true);
  assert.equal(slow.g3Eligible, false);
});
