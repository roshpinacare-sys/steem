import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
} from '../dist/src/contracts/crypto.js';
import { buildPushApprovalCard, compileChatMission } from '../dist/src/product/chat-mission.js';
import { InMemoryApprovalInbox } from '../dist/src/product/mission-conversation-v33_2.js';
import {
  DeviceBindingRegistry,
  SimulatedDevicePushGateway,
} from '../dist/src/product/device-push-v33_3.js';
import {
  DeviceRecoveryCoordinator,
  DeviceSessionRegistry,
  FilePushOutbox,
  LossySimulatedPushAdapter,
  ReliablePushDispatcher,
  evaluateTransportReliability,
} from '../dist/src/product/reliable-push-v33_4.js';

const now = new Date('2026-07-21T04:00:00.000Z');
const root = mkdtempSync(join(tmpdir(), 'v33-4-proof-'));
const blocked = (operation, pattern) => {
  try { operation(); return false; } catch (error) { return pattern.test(String(error)); }
};

function enrollment(registrar, keys, identity, deviceId, enrollmentId) {
  return signEnvelope({
    version: '33.3', enrollmentId, tenantId: 'tenant-proof', userId: 'reviewer-proof', deviceId,
    channel: 'SIMULATED_PUSH', devicePublicKey: keys.exportPublicKey(identity.keyId), capabilities: ['APPROVAL_RECEIVE', 'APPROVAL_DECIDE'],
    issuedAt: '2026-07-21T03:50:00.000Z', notBefore: '2026-07-21T03:50:00.000Z', notAfter: '2026-07-21T07:00:00.000Z',
    nonce: `${enrollmentId}-nonce`, productionCeiling: 'shadow',
  }, registrar);
}

function approvalCard(index) {
  const grant = {
    grantId: `grant-proof-${index}`, tenantId: 'tenant-proof', subjectId: 'operator-proof', workspaceId: 'workspace-proof',
    scopes: ['production.deploy'], issuedAt: '2026-07-21T03:00:00.000Z', expiresAt: '2026-07-21T08:00:00.000Z', issuer: 'canonical-authority',
  };
  const policy = {
    policyId: `policy-proof-${index}`, autoPrepareScopes: [], approvalRequiredScopes: ['production.deploy'], maxAutoPrepareCostUsd: 0,
    maxAutoPrepareRisk: 'LOW', minimumConfidence: 0.99, requireApprovalForIrreversible: true,
    requireApprovalForUnknownReversibility: true, approverIds: ['reviewer-proof'],
  };
  const mission = compileChatMission({
    missionId: `mission-proof-${index}`, tenantId: 'tenant-proof', requesterId: 'operator-proof', workspaceId: 'workspace-proof',
    message: 'Prepare the governed action and ask once.', objective: 'Transport-neutral reliable approval', requestedScopes: ['production.deploy'],
    riskLevel: 'CRITICAL', reversibility: 'IRREVERSIBLE', estimatedCostUsd: 20, confidence: 0.9,
    constraints: ['one approval'], prohibitedActions: ['external effect'], completionCriteria: ['reliable signed delivery'],
    createdAt: '2026-07-21T03:59:00.000Z', expiresAt: '2026-07-21T05:00:00.000Z',
  }, grant, policy, now);
  return buildPushApprovalCard(mission, policy);
}

try {
  const registrar = generateSigningIdentity('registrar-proof-v33.4');
  const gatewayIdentity = generateSigningIdentity('gateway-proof-v33.4');
  const providerIdentity = generateSigningIdentity('provider-proof-v33.4');
  const stateIdentity = generateSigningIdentity('outbox-state-proof-v33.4');
  const deviceIdentity = generateSigningIdentity('device-proof-v33.4');
  const newDeviceIdentity = generateSigningIdentity('device-new-proof-v33.4');
  const registrarKeys = new KeyRegistry(); registrarKeys.register(registrar.keyId, registrar.publicKey);
  const gatewayKeys = new KeyRegistry(); gatewayKeys.register(gatewayIdentity.keyId, gatewayIdentity.publicKey);
  const providerKeys = new KeyRegistry(); providerKeys.register(providerIdentity.keyId, providerIdentity.publicKey);
  const stateKeys = new KeyRegistry(); stateKeys.register(stateIdentity.keyId, stateIdentity.publicKey);
  const deviceKeys = new KeyRegistry(); deviceKeys.register(deviceIdentity.keyId, deviceIdentity.publicKey);
  const newDeviceKeys = new KeyRegistry(); newDeviceKeys.register(newDeviceIdentity.keyId, newDeviceIdentity.publicKey);
  const firstEnrollment = enrollment(registrar, deviceKeys, deviceIdentity, 'phone-proof-1', 'enrollment-proof-1');
  const devices = new DeviceBindingRegistry(registrarKeys, [registrar.keyId]);
  devices.enroll(firstEnrollment, now);
  const inbox = new InMemoryApprovalInbox();
  const gateway = new SimulatedDevicePushGateway(inbox, devices, gatewayIdentity, gatewayKeys);
  const outboxPath = join(root, 'signed-push-outbox.json');
  const outbox = new FilePushOutbox(
    outboxPath, stateIdentity, stateKeys, [stateIdentity.keyId], gatewayKeys, [gatewayIdentity.keyId], providerKeys, [providerIdentity.keyId],
  );
  const adapter = new LossySimulatedPushAdapter('sim-provider', providerIdentity, providerKeys, [
    'ACCEPT_RESPONSE_LOST',
    'DUPLICATE_NETWORK',
    'DROP_BEFORE_PROVIDER',
    'DELAY',
    'PERMANENT_REJECT',
    'ACCEPT', 'ACCEPT', 'ACCEPT', 'ACCEPT',
  ]);
  const dispatcher = new ReliablePushDispatcher(outbox, devices, adapter, gatewayKeys, [gatewayIdentity.keyId], providerKeys, [providerIdentity.keyId]);

  const issue = (index) => {
    const card = approvalCard(index);
    inbox.enqueue(card, now);
    const delivery = gateway.issue(card, {
      deliveryId: `delivery-proof-${index}`, approverId: 'reviewer-proof', deviceId: 'phone-proof-1', challengeNonce: `challenge-proof-${index}`,
      issuedAt: now.toISOString(), expiresAt: '2026-07-21T04:30:00.000Z', attempt: 1,
    }, now);
    outbox.enqueue(delivery, {
      requestId: `request-proof-${index}`, targetAdapterId: 'sim-provider', providerDedupKey: `dedup-proof-${index}`, queuedAt: now.toISOString(),
    }, now);
    return delivery;
  };

  for (let index = 1; index <= 5; index += 1) issue(index);
  const dispatches = [];
  dispatches.push(dispatcher.dispatchOne('worker-1', now, { retryDelayMs: 1_000 }));
  dispatches.push(dispatcher.dispatchOne('worker-2', now, { retryDelayMs: 1_000 }));
  dispatches.push(dispatcher.dispatchOne('worker-3', now, { retryDelayMs: 1_000 }));
  dispatches.push(dispatcher.dispatchOne('worker-4', now, { retryDelayMs: 2_000 }));
  dispatches.push(dispatcher.dispatchOne('worker-5', now, { retryDelayMs: 1_000 }));
  dispatches.push(dispatcher.dispatchOne('worker-6', new Date('2026-07-21T04:00:01.000Z'), { retryDelayMs: 1_000 }));
  dispatches.push(dispatcher.dispatchOne('worker-7', new Date('2026-07-21T04:00:01.000Z'), { retryDelayMs: 1_000 }));
  dispatches.push(dispatcher.dispatchOne('worker-8', new Date('2026-07-21T04:00:02.000Z'), { retryDelayMs: 1_000 }));

  const crashCard = approvalCard(6);
  inbox.enqueue(crashCard, now);
  const crashDelivery = gateway.issue(crashCard, {
    deliveryId: 'delivery-proof-6', approverId: 'reviewer-proof', deviceId: 'phone-proof-1', challengeNonce: 'challenge-proof-6',
    issuedAt: now.toISOString(), expiresAt: '2026-07-21T04:30:00.000Z', attempt: 1,
  }, now);
  outbox.enqueue(crashDelivery, { requestId: 'request-proof-6', targetAdapterId: 'sim-provider', providerDedupKey: 'dedup-proof-6', queuedAt: now.toISOString() }, now);
  assert.ok(outbox.leaseNext('crashed-worker', now, 1_000));
  const reopenedOutbox = new FilePushOutbox(
    outboxPath, stateIdentity, stateKeys, [stateIdentity.keyId], gatewayKeys, [gatewayIdentity.keyId], providerKeys, [providerIdentity.keyId],
  );
  assert.equal(reopenedOutbox.recoverExpiredLeases(new Date('2026-07-21T04:00:01.000Z')), 1);
  const recoveredDispatcher = new ReliablePushDispatcher(reopenedOutbox, devices, adapter, gatewayKeys, [gatewayIdentity.keyId], providerKeys, [providerIdentity.keyId]);
  const crashRecoveryResult = recoveredDispatcher.dispatchOne('recovery-worker', new Date('2026-07-21T04:00:01.000Z'));

  const sessions = new DeviceSessionRegistry(devices);
  sessions.open({
    sessionId: 'device-session-proof', tenantId: 'tenant-proof', userId: 'reviewer-proof', deviceId: 'phone-proof-1',
    issuedAt: now.toISOString(), expiresAt: '2026-07-21T05:00:00.000Z', nonce: 'device-session-proof-nonce',
  }, now);
  const nextEnrollment = enrollment(registrar, newDeviceKeys, newDeviceIdentity, 'phone-proof-2', 'enrollment-proof-2');
  const revocation = signEnvelope({
    version: '33.3', revocationId: 'revocation-proof-v33.4', tenantId: 'tenant-proof', deviceId: 'phone-proof-1',
    enrollmentDigest: sha256(firstEnrollment), revokedAt: '2026-07-21T04:10:00.000Z', reason: 'device replacement', nonce: 'revocation-proof-v33.4-nonce',
  }, registrar);
  const replacementGrant = signEnvelope({
    version: '33.4', replacementId: 'replacement-proof-v33.4', tenantId: 'tenant-proof', userId: 'reviewer-proof',
    oldDeviceId: 'phone-proof-1', oldEnrollmentDigest: sha256(firstEnrollment), newDeviceId: 'phone-proof-2', newEnrollmentDigest: sha256(nextEnrollment),
    issuedAt: '2026-07-21T04:09:00.000Z', notAfter: '2026-07-21T04:30:00.000Z', nonce: 'replacement-proof-v33.4-nonce',
    reason: 'replace lost device', productionCeiling: 'shadow',
  }, registrar);
  const recovery = new DeviceRecoveryCoordinator(devices, registrarKeys, [registrar.keyId]);
  const replacementReceipt = recovery.replace(replacementGrant, revocation, nextEnrollment, new Date('2026-07-21T04:10:01.000Z'));
  const sessionRevoked = blocked(() => sessions.requireActive('device-session-proof', new Date('2026-07-21T04:10:01.000Z')), /device_revoked/);

  const signedFile = JSON.parse(readFileSync(outboxPath, 'utf8'));
  signedFile.payload.snapshot.items[0].state = 'ACCEPTED';
  signedFile.payload.snapshot.items[0].itemDigest = sha256({ forged: 'item' });
  signedFile.payload.snapshot.snapshotDigest = sha256({ forged: 'snapshot' });
  signedFile.payload.recordDigest = sha256({ forged: 'record' });
  const tamperedPath = join(root, 'tampered-outbox.json');
  writeFileSync(tamperedPath, `${JSON.stringify(signedFile)}\n`, 'utf8');
  const tamperBlocked = blocked(() => new FilePushOutbox(
    tamperedPath, stateIdentity, stateKeys, [stateIdentity.keyId], gatewayKeys, [gatewayIdentity.keyId], providerKeys, [providerIdentity.keyId],
  ).list(), /push_outbox_file_tampered/);

  const reliability = evaluateTransportReliability(reopenedOutbox, adapter.metrics());
  const terminalCounts = Object.fromEntries(reopenedOutbox.list().map((row) => [row.request.requestId, row.state]));
  const assertions = {
    responseLossRecoveredExactlyOnce: adapter.metrics().acceptedResponseLost === 1 && adapter.metrics().uniqueProviderAcceptances >= 4,
    duplicateSuppressed: adapter.metrics().duplicateSuppressions >= 2,
    dropRetried: adapter.metrics().droppedBeforeProvider === 1,
    delayRetried: adapter.metrics().delayed === 1,
    permanentFailureBounded: adapter.metrics().permanentRejects === 1 && Object.values(terminalCounts).includes('DEAD_LETTER'),
    crashLeaseRecovered: crashRecoveryResult.status === 'ACCEPTED' && reliability.crashRecoveries === 1,
    signedOutboxTamperingBlocked: tamperBlocked,
    oldSessionInvalidated: sessionRevoked,
    replacementBoundToSameUser: replacementReceipt.userId === 'reviewer-proof' && replacementReceipt.newDeviceId === 'phone-proof-2',
    oldDeviceRevoked: devices.get('tenant-proof', 'phone-proof-1', new Date('2026-07-21T04:10:01.000Z')).status === 'REVOKED',
    newDeviceActive: devices.requireActive('tenant-proof', 'reviewer-proof', 'phone-proof-2', 'APPROVAL_RECEIVE', new Date('2026-07-21T04:10:01.000Z')).status === 'ACTIVE',
    noExternalEffects: reopenedOutbox.list().every((row) => row.externalEffectsExecuted === 0 && row.request.externalEffectsExecuted === 0),
    noG3SelfPromotion: reliability.evidenceClass === 'SIMULATED_FAULT_INJECTION' && reliability.g3Eligible === false,
  };
  assert.equal(Object.values(assertions).every(Boolean), true);
  const material = {
    version: '33.4', generatedAt: new Date().toISOString(), status: 'passed',
    classification: 'transport-neutral-reliable-push-local-fault-injection-shadow-only',
    assertions,
    dispatchSequence: dispatches.map((row) => ({ status: row.status, requestId: row.requestId })),
    transportMetrics: adapter.metrics(),
    reliabilityEvidence: reliability,
    terminalCounts,
    digests: {
      signedOutbox: sha256(JSON.parse(readFileSync(outboxPath, 'utf8'))),
      replacementGrant: sha256(replacementGrant), replacementReceipt: replacementReceipt.receiptDigest,
      deviceRegistry: devices.export().snapshotDigest,
    },
    limitations: [
      'The transport adapter is a deterministic local simulator, not APNs, FCM or another external provider.',
      'Provider, gateway, state and registrar keys are process-local software keys, not external KMS/HSM or hardware-backed keys.',
      'Fault injection proves local state-machine behavior; it does not prove real mobile-network latency, provider SLOs or notification presentation.',
      'Device replacement is single-process and evidence-bounded; distributed locking and external identity recovery are not qualified.',
      'No human comprehension, accessibility or real-device delivery evidence has been collected; G3 remains in progress.',
    ],
    gates: { G0: 'passed', G1: 'passed', G2: 'not-started', G3: 'in-progress-not-passed' },
    productionPromotion: 'blocked', externalQualification: 'not_executed',
  };
  const report = { ...material, reportDigest: sha256(material) };
  await import('node:fs').then(({ mkdirSync, writeFileSync: write }) => {
    mkdirSync('release-evidence/v33.4', { recursive: true });
    write('release-evidence/v33.4/V33_4_RELIABLE_PUSH_PROOF.json', `${JSON.stringify(report, null, 2)}\n`);
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
