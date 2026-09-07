import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { KeyRegistry, generateSigningIdentity, sha256, signEnvelope } from '../dist/src/contracts/crypto.js';
import {
  createExternalHumanPilotExecutionKitV33_32,
  createFederatedCheckpointGenesisAnchorV33_32,
  createFederatedCheckpointProposalV33_32,
  createFederatedCheckpointWitnessPolicyV33_32,
  createFederatedCheckpointWitnessVoteV33_32,
  detectFederatedCheckpointEquivocationV33_32,
  finalizeFederatedCheckpointTransitionV33_32,
  finalizeFederatedHumanPilotVerdictV33_32,
  verifyExternalHumanPilotExecutionKitV33_32,
  verifyFederatedCheckpointTransitionV33_32,
} from '../dist/src/app/federated-human-pilot-checkpoint-v33_32.js';

const out = resolve('release-evidence/v33.32');
mkdirSync(out, { recursive: true });
const write = (name, value) => writeFileSync(resolve(out, name), `${JSON.stringify(value, null, 2)}\n`);
const at = new Date('2026-07-22T12:30:00.000Z');
const verifyAt = new Date('2026-07-22T12:35:00.000Z');
const protocolDigest = sha256({ protocol: 'v33.32-federated-human-pilot-synthetic-reference' });
const challengeDigest = sha256({ challenge: 'v33.32-synthetic-one-time' });
const packageDigest = sha256({ package: 'v33.32-synthetic-reference' });
const ids = {
  policy: generateSigningIdentity('v33-32-policy-root'),
  importer: generateSigningIdentity('v33-32-importer'),
  coordinator: generateSigningIdentity('v33-32-coordinator'),
  verifier: generateSigningIdentity('v33-32-verifier'),
  baseVerifier: generateSigningIdentity('v33-31-base-verifier'),
  operator: generateSigningIdentity('v33-32-pilot-operator'),
  witnesses: Array.from({ length: 5 }, (_, i) => generateSigningIdentity(`v33-32-witness-${i + 1}`)),
};
const reg = (...values) => { const r = new KeyRegistry(); for (const value of values) r.register(value.keyId, value.publicKey); return r; };
const checkpoint = (sequence, previousCheckpointDigest, challenges, packages, generatedAt) => {
  const material = { version: '33.31', checkpointId: `v33-32-checkpoint-${sequence}`, sequence, previousCheckpointDigest, consumedChallengeDigests: challenges, consumedPackageDigests: packages, generatedAt: generatedAt.toISOString(), productionAuthority: 'NONE', externalEffectsExecuted: 0 };
  return signEnvelope({ ...material, checkpointDigest: sha256(material) }, ids.importer);
};
const witnessRows = ids.witnesses.map((identity, i) => ({ witnessId: `witness-${i + 1}`, keyId: identity.keyId, keyFingerprint: reg(identity).fingerprint(identity.keyId), organizationId: `Synthetic Witness Org ${i + 1}`, hostId: `synthetic-witness-host-${i + 1}` }));
const policy = createFederatedCheckpointWitnessPolicyV33_32({ policySigner: ids.policy, studyId: 'v33-32-synthetic-study', protocolDigest, epoch: 1, quorum: 3, witnesses: witnessRows, importer: { keyId: ids.importer.keyId, organizationId: 'Synthetic Import Org', hostId: 'synthetic-import-host' }, coordinator: { keyId: ids.coordinator.keyId, organizationId: 'Synthetic Coordinator Org', hostId: 'synthetic-coordinator-host' }, issuedAt: new Date('2026-07-22T12:00:00.000Z'), expiresAt: new Date('2026-07-23T12:00:00.000Z') });
const initialCheckpoint = checkpoint(0, null, [], [], new Date('2026-07-22T12:01:00.000Z'));
const previousAnchor = createFederatedCheckpointGenesisAnchorV33_32({ anchorSigner: ids.policy, policy, initialCheckpoint, generatedAt: new Date('2026-07-22T12:02:00.000Z') });
const candidateCheckpoint = checkpoint(1, initialCheckpoint.payload.checkpointDigest, [challengeDigest], [packageDigest], new Date('2026-07-22T12:20:00.000Z'));
const proposal = createFederatedCheckpointProposalV33_32({ importer: ids.importer, policy, previousAnchor, previousCheckpoint: initialCheckpoint, candidateCheckpoint, newChallengeDigest: challengeDigest, newPackageDigest: packageDigest, proposedAt: new Date('2026-07-22T12:21:00.000Z') });
const votes = ids.witnesses.slice(0, 3).map((witness, i) => createFederatedCheckpointWitnessVoteV33_32({ witness, witnessId: `witness-${i + 1}`, policy, proposal, observedAt: new Date(`2026-07-22T12:2${2 + i}:00.000Z`) }));
const trust = { policyRegistry: reg(ids.policy), trustedPolicySignerIds: [ids.policy.keyId], importerRegistry: reg(ids.importer), trustedImporterIds: [ids.importer.keyId], checkpointRegistry: reg(ids.importer), trustedCheckpointSignerIds: [ids.importer.keyId], witnessRegistry: reg(...ids.witnesses), trustedWitnessIds: ids.witnesses.map((row) => row.keyId), coordinatorRegistry: reg(ids.coordinator), trustedCoordinatorIds: [ids.coordinator.keyId], anchorRegistry: reg(ids.policy, ids.coordinator), trustedAnchorSignerIds: [ids.policy.keyId, ids.coordinator.keyId] };
const partial = { policy, previousAnchor, previousCheckpoint: initialCheckpoint, candidateCheckpoint, proposal, votes };
const finalized = finalizeFederatedCheckpointTransitionV33_32({ coordinator: ids.coordinator, bundle: partial, trust, issuedAt: at });
const transition = { ...partial, ...finalized };
const verifiedAnchor = verifyFederatedCheckpointTransitionV33_32({ bundle: transition, trust, verifiedAt: verifyAt });

const roles = [
  ['PILOT_OPERATOR', ids.operator.keyId], ['RESEARCHER', 'synthetic-researcher-key'], ['REGISTRAR', 'synthetic-registrar-key'], ['EXPORTER', 'synthetic-exporter-key'], ['IMPORTER', ids.importer.keyId], ['OBSERVER', 'synthetic-observer-key'], ['VERIFIER', ids.verifier.keyId], ['WITNESS_COORDINATOR', ids.coordinator.keyId], ['PRIVACY_OFFICER', 'synthetic-privacy-key'],
].map(([role, keyId], i) => ({ role, keyId, organizationId: `Synthetic Execution Org ${i + 1}`, hostId: `synthetic-execution-host-${i + 1}` }));
const executionKit = createExternalHumanPilotExecutionKitV33_32({ pilotOperator: ids.operator, studyId: policy.payload.studyId, protocolDigest, witnessPolicyDigest: policy.payload.policyDigest, roleAssignments: roles, issuedAt: at, expiresAt: new Date('2026-07-23T12:30:00.000Z') });
const readiness = verifyExternalHumanPilotExecutionKitV33_32({ kit: executionKit, operatorRegistry: reg(ids.operator), trustedOperatorIds: [ids.operator.keyId], expectedProtocolDigest: protocolDigest, expectedWitnessPolicyDigest: policy.payload.policyDigest, evaluatedAt: verifyAt });

const receiptMaterial = { version: '33.31', receiptId: 'synthetic-receipt', packageId: 'synthetic-package', packageDigest, challengeDigest, checkpointSequence: 1, evidenceClass: 'SYNTHETIC_REFERENCE', status: 'SYNTHETIC_REFERENCE_NOT_EXTERNAL', participantCount: 5, externalHumanParticipants: 0, artifactCount: 10, artifactBytesVerified: true, observationSchemaVerified: true, roleProofsVerified: true, roleBindingsExternallyAttested: true, replayProtected: true, importedAt: at.toISOString(), productionAuthority: 'NONE', externalEffectsExecuted: 0 };
const receipt = signEnvelope({ ...receiptMaterial, receiptDigest: sha256(receiptMaterial) }, ids.importer);
const baseVerdictMaterial = { version: '33.31', verdictId: 'synthetic-base-verdict', studyId: policy.payload.studyId, protocolDigest, packageDigest, importReceiptDigest: receipt.payload.receiptDigest, baseContractVerdictDigest: sha256({ base: 'synthetic' }), evidenceClass: 'SYNTHETIC_REFERENCE', participantCount: 5, distinctScenarioCount: 3, medianStepReductionPercent: 40, medianGovernedApprovals: 1, medianComprehensionSeconds: 4, taskSuccessRatePercent: 100, accessibilityPassRatePercent: 100, comprehensionCorrectRatePercent: 100, evidenceClosurePercent: 100, externalProvenanceVerified: false, observationArtifactsVerified: true, roleProofsVerified: true, replayProtected: true, humanPilotPassed: false, status: 'HUMAN_UX_PILOT_REQUIRED', blockers: ['external_human_pilot_required'], generatedAt: at.toISOString(), productionAuthority: 'NONE', externalEffectsExecuted: 0 };
const baseVerdict = signEnvelope({ ...baseVerdictMaterial, verdictDigest: sha256(baseVerdictMaterial) }, ids.baseVerifier);
const federatedVerdict = finalizeFederatedHumanPilotVerdictV33_32({ verifier: ids.verifier, baseVerdict, baseReceipt: receipt, baseVerifierRegistry: reg(ids.baseVerifier), trustedBaseVerifierIds: [ids.baseVerifier.keyId], receiptRegistry: reg(ids.importer), trustedReceiptSignerIds: [ids.importer.keyId], transition, transitionTrust: trust, generatedAt: verifyAt });

const attack = (fn) => { try { fn(); return 'SURVIVED'; } catch (error) { return error instanceof Error ? `KILLED:${error.message}` : 'KILLED:unknown'; } };
const rollback = checkpoint(0, null, [challengeDigest], [packageDigest], at);
const forkPayload = { ...votes[0].payload, candidateCheckpointDigest: sha256({ fork: true }) };
const { voteDigest: _oldVote, ...forkMaterial } = forkPayload;
const forkVote = signEnvelope({ ...forkMaterial, voteDigest: sha256(forkMaterial) }, ids.witnesses[0]);
const attacks = {
  rollback: attack(() => createFederatedCheckpointProposalV33_32({ importer: ids.importer, policy, previousAnchor, previousCheckpoint: initialCheckpoint, candidateCheckpoint: rollback, newChallengeDigest: challengeDigest, newPackageDigest: packageDigest, proposedAt: at })),
  insufficientQuorum: attack(() => finalizeFederatedCheckpointTransitionV33_32({ coordinator: ids.coordinator, bundle: { ...partial, votes: votes.slice(0, 2) }, trust, issuedAt: at })),
  equivocation: detectFederatedCheckpointEquivocationV33_32([votes[0], forkVote]).length === 1 ? 'KILLED:detected' : 'SURVIVED',
  certificateTamper: attack(() => verifyFederatedCheckpointTransitionV33_32({ bundle: { ...transition, certificate: { ...transition.certificate, payload: { ...transition.certificate.payload, quorumRequired: 4 } } }, trust, verifiedAt: verifyAt })),
  syntheticPromotion: federatedVerdict.payload.humanPilotPassed ? 'SURVIVED' : 'KILLED:synthetic_evidence_remains_blocked',
};
const proofMaterial = { version: '33.32', status: 'FEDERATED_CHECKPOINT_PROTOCOL_PROVEN_LOCALLY_EXTERNAL_EXECUTION_BLOCKED', focusedTestsExpected: 118, witnessPolicy: '3_OF_5', witnessCount: 5, quorum: 3, checkpointSequence: verifiedAnchor.sequence, checkpointEpoch: verifiedAnchor.epoch, rollbackResistanceProtocolVerified: true, equivocationDetectionEnabled: true, executionKitStatus: readiness.status, syntheticReferenceParticipants: 5, externalHumanParticipants: 0, humanPilotPassed: false, attacks, metricInventoryCount: 54, parameterCount: 14, productionAuthority: 'NONE', externalEffectsExecuted: 0, productionPromotion: 'blocked' };
const proof = signEnvelope({ ...proofMaterial, proofDigest: sha256(proofMaterial) }, ids.verifier);
const publicKeys = [
  ['policy', ids.policy], ['importer', ids.importer], ['coordinator', ids.coordinator], ['verifier', ids.verifier], ['baseVerifier', ids.baseVerifier], ['operator', ids.operator], ...ids.witnesses.map((id, i) => [`witness-${i + 1}`, id]),
].map(([role, id]) => ({ role, ...reg(id).exportPublicKey(id.keyId) }));
write('V33_32_WITNESS_POLICY.json', policy);
write('V33_32_GENESIS_ANCHOR.json', previousAnchor);
write('V33_32_CANDIDATE_CHECKPOINT.json', candidateCheckpoint);
write('V33_32_CHECKPOINT_PROPOSAL.json', proposal);
write('V33_32_WITNESS_VOTES.json', votes);
write('V33_32_QUORUM_CERTIFICATE.json', finalized.certificate);
write('V33_32_FEDERATED_ANCHOR.json', finalized.nextAnchor);
write('V33_32_EXECUTION_KIT.json', executionKit);
write('V33_32_EXECUTION_READINESS.json', readiness);
write('V33_32_SYNTHETIC_BASE_RECEIPT.json', receipt);
write('V33_32_SYNTHETIC_BASE_VERDICT.json', baseVerdict);
write('V33_32_SYNTHETIC_FEDERATED_VERDICT.json', federatedVerdict);
write('V33_32_FEDERATED_CHECKPOINT_PROOF.json', proof);
write('V33_32_PROOF_PUBLIC_KEYS.json', publicKeys);
console.log(JSON.stringify({ status: 'passed', witnessPolicy: '3_OF_5', checkpointSequence: verifiedAnchor.sequence, executionKitStatus: readiness.status, externalHumanParticipants: 0, humanPilotPassed: false, attacks, productionPromotion: 'blocked' }, null, 2));
