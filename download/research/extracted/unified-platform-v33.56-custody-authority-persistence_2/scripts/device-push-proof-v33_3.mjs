import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
} from '../dist/src/contracts/crypto.js';
import { buildPushApprovalCard, compileChatMission } from '../dist/src/product/chat-mission.js';
import {
  DeviceBindingRegistry,
  FileApprovalInbox,
  SimulatedDevicePushGateway,
  evaluateUserFlow,
} from '../dist/src/product/device-push-v33_3.js';

const now = new Date('2026-07-21T04:00:00.000Z');
const root = mkdtempSync(join(tmpdir(), 'v33-3-proof-'));
const blocked = (operation, pattern) => {
  try { operation(); return false; } catch (error) { return pattern.test(String(error)); }
};

try {
  const registrar = generateSigningIdentity('registrar-proof-v33.3');
  const gatewayIdentity = generateSigningIdentity('gateway-proof-v33.3');
  const deviceIdentity = generateSigningIdentity('device-proof-v33.3');
  const registrarKeys = new KeyRegistry(); registrarKeys.register(registrar.keyId, registrar.publicKey);
  const gatewayKeys = new KeyRegistry(); gatewayKeys.register(gatewayIdentity.keyId, gatewayIdentity.publicKey);
  const deviceKeys = new KeyRegistry(); deviceKeys.register(deviceIdentity.keyId, deviceIdentity.publicKey);
  const enrollment = signEnvelope({
    version: '33.3', enrollmentId: 'enrollment-proof', tenantId: 'tenant-proof', userId: 'reviewer-proof', deviceId: 'phone-proof',
    channel: 'SIMULATED_PUSH', devicePublicKey: deviceKeys.exportPublicKey(deviceIdentity.keyId), capabilities: ['APPROVAL_RECEIVE', 'APPROVAL_DECIDE'],
    issuedAt: '2026-07-21T03:50:00.000Z', notBefore: '2026-07-21T03:50:00.000Z', notAfter: '2026-07-21T06:00:00.000Z',
    nonce: 'enrollment-proof-nonce', productionCeiling: 'shadow',
  }, registrar);
  const devices = new DeviceBindingRegistry(registrarKeys, [registrar.keyId]);
  devices.enroll(enrollment, now);

  const grant = {
    grantId: 'grant-proof-v33.3', tenantId: 'tenant-proof', subjectId: 'operator-proof', workspaceId: 'workspace-proof',
    scopes: ['production.deploy'], issuedAt: '2026-07-21T03:00:00.000Z', expiresAt: '2026-07-21T08:00:00.000Z', issuer: 'canonical-authority',
  };
  const policy = {
    policyId: 'policy-proof-v33.3', autoPrepareScopes: [], approvalRequiredScopes: ['production.deploy'], maxAutoPrepareCostUsd: 0,
    maxAutoPrepareRisk: 'LOW', minimumConfidence: 0.99, requireApprovalForIrreversible: true, requireApprovalForUnknownReversibility: true,
    approverIds: ['reviewer-proof'],
  };
  const mission = compileChatMission({
    missionId: 'mission-proof-v33.3', tenantId: 'tenant-proof', requesterId: 'operator-proof', workspaceId: 'workspace-proof',
    message: 'Prepare the governed deployment and ask once.', objective: 'Prepare bounded deployment approval', requestedScopes: ['production.deploy'],
    riskLevel: 'CRITICAL', reversibility: 'IRREVERSIBLE', estimatedCostUsd: 20, confidence: 0.9,
    constraints: ['one approval'], prohibitedActions: ['external effect'], completionCriteria: ['signed device decision receipt'],
    createdAt: '2026-07-21T03:59:00.000Z', expiresAt: '2026-07-21T05:00:00.000Z',
  }, grant, policy, now);
  const card = buildPushApprovalCard(mission, policy);
  const inboxPath = join(root, 'approval-inbox.json');
  const inbox = new FileApprovalInbox(inboxPath);
  inbox.enqueue(card, now);
  const reopenedInbox = new FileApprovalInbox(inboxPath);
  const gateway = new SimulatedDevicePushGateway(reopenedInbox, devices, gatewayIdentity, gatewayKeys);
  const delivery = gateway.issue(card, {
    deliveryId: 'delivery-proof-v33.3', approverId: 'reviewer-proof', deviceId: 'phone-proof', challengeNonce: 'challenge-proof-v33.3',
    issuedAt: '2026-07-21T04:00:00.000Z', expiresAt: '2026-07-21T04:30:00.000Z', attempt: 1,
  }, now);
  const acknowledgement = signEnvelope({
    version: '33.3', acknowledgementId: 'ack-proof-v33.3', deliveryDigest: sha256(delivery), tenantId: 'tenant-proof', cardId: card.cardId,
    cardDigest: card.cardDigest, approverId: 'reviewer-proof', deviceId: 'phone-proof', challengeNonce: 'challenge-proof-v33.3',
    receivedAt: '2026-07-21T04:00:01.000Z', externalEffectsExecuted: 0,
  }, deviceIdentity);
  const deliveryReceipt = gateway.acknowledge(acknowledgement, new Date('2026-07-21T04:00:01.000Z'));
  const command = signEnvelope({
    version: '33.3', commandNonce: 'command-proof-v33.3', decisionId: 'decision-proof-v33.3', deliveryDigest: sha256(delivery),
    tenantId: 'tenant-proof', cardId: card.cardId, cardDigest: card.cardDigest, actorId: 'reviewer-proof', deviceId: 'phone-proof',
    challengeNonce: 'challenge-proof-v33.3', option: 'YES', occurredAt: '2026-07-21T04:00:02.000Z',
    reason: 'Existing authority scopes only', externalEffectsExecuted: 0,
  }, deviceIdentity);
  const decisionReceipt = gateway.decide(command, new Date('2026-07-21T04:00:03.000Z'));
  const signedSnapshot = gateway.exportSigned(new Date('2026-07-21T04:00:04.000Z'));
  const restored = SimulatedDevicePushGateway.restoreSigned(
    signedSnapshot,
    new FileApprovalInbox(inboxPath),
    DeviceBindingRegistry.restore(devices.export(), registrarKeys, [registrar.keyId], new Date('2026-07-21T04:00:04.000Z')),
    gatewayIdentity,
    gatewayKeys,
    new Date('2026-07-21T04:00:04.000Z'),
  );
  const flow = evaluateUserFlow([
    { scenarioId: 'repository-patch', baselineUserSteps: 10, prototypeUserSteps: 2, approvals: 1, humanObserved: false },
    { scenarioId: 'dependency-update', baselineUserSteps: 8, prototypeUserSteps: 2, approvals: 1, humanObserved: false },
    { scenarioId: 'rollback-review', baselineUserSteps: 12, prototypeUserSteps: 3, approvals: 1, humanObserved: false },
  ], false);
  const assertions = {
    trustedDeviceEnrollment: devices.get('tenant-proof', 'phone-proof', now).status === 'ACTIVE',
    fileInboxReopened: new FileApprovalInbox(inboxPath).get('tenant-proof', card.cardId, new Date('2026-07-21T04:00:04.000Z'))?.state === 'DECIDED',
    gatewayDeliverySigned: gatewayKeys.verifyAt(delivery, delivery.payload.issuedAt),
    deviceAcknowledgementSigned: deliveryReceipt.externalEffectsExecuted === 0,
    deviceDecisionSigned: decisionReceipt.payload.canonicalDecision.outcome === 'APPROVED',
    authorityScopePreserved: JSON.stringify(decisionReceipt.payload.canonicalDecision.approvedScopes) === JSON.stringify(card.requestedScopes),
    signedSnapshotRestored: restored.getDelivery(delivery.payload.deliveryId)?.payload.deviceId === 'phone-proof',
    replayConflictBlocked: blocked(() => gateway.decide(signEnvelope({ ...command.payload, decisionId: 'decision-replay', option: 'NO' }, deviceIdentity), new Date('2026-07-21T04:00:05.000Z')), /device_command_replay/),
    crossTenantBlocked: blocked(() => gateway.acknowledge(signEnvelope({ ...acknowledgement.payload, acknowledgementId: 'ack-other', tenantId: 'tenant-other' }, deviceIdentity), new Date('2026-07-21T04:00:05.000Z')), /push_ack_binding_invalid/),
    noExternalEffects: decisionReceipt.payload.externalEffectsExecuted === 0 && decisionReceipt.payload.canonicalDecision.externalEffectsExecuted === 0,
    structuralStepReduction: flow.structuralCriteriaPassed && flow.stepReductionPct >= 70 && flow.medianApprovals <= 1,
    g3NotSelfPromoted: flow.g3Eligible === false && flow.humanObservedScenarios === 0,
  };
  assert.equal(Object.values(assertions).every(Boolean), true);
  const material = {
    version: '33.3', generatedAt: new Date().toISOString(), status: 'passed', classification: 'device-bound-simulated-push-local-proof-shadow-only',
    assertions,
    counts: { deviceEnrollments: 1, pushDeliveries: 1, acknowledgements: 1, decisions: 1, simulatedFlowScenarios: flow.scenarios },
    userFlowEvidence: flow,
    digests: {
      enrollment: sha256(enrollment), delivery: sha256(delivery), acknowledgement: sha256(acknowledgement),
      decisionReceipt: sha256(decisionReceipt), signedGatewaySnapshot: sha256(signedSnapshot), approvalCard: card.cardDigest,
    },
    limitations: [
      'Transport is a local simulated push gateway; APNs and FCM are not integrated.',
      'Device keys are software-generated, not secure-enclave or hardware-attested.',
      'Gateway and registrar keys are local in-memory identities, not external KMS/HSM.',
      'Step reduction is simulated structural evidence, not a human task-flow study.',
      'Accessibility and approval-comprehension evidence have not been collected.',
    ],
    gates: { G0: 'passed', G1: 'passed', G3: 'in-progress-not-passed' },
    productionPromotion: 'blocked', externalQualification: 'not_executed',
  };
  const report = { ...material, reportDigest: sha256(material) };
  mkdirSync('release-evidence/v33.3', { recursive: true });
  writeFileSync('release-evidence/v33.3/V33_3_DEVICE_PUSH_PROOF.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
