import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../src/contracts/crypto.js';
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
  type ExternalHumanPilotExecutionRoleV33_32,
  type FederatedCheckpointAnchorV33_32,
  type FederatedCheckpointCertificateV33_32,
  type FederatedCheckpointProposalV33_32,
  type FederatedCheckpointTransitionBundleV33_32,
  type FederatedCheckpointTrustV33_32,
  type FederatedCheckpointWitnessPolicyV33_32,
  type FederatedCheckpointWitnessVoteV33_32,
} from '../src/app/federated-human-pilot-checkpoint-v33_32.js';
import type {
  ExternalHumanPilotImportCheckpointV33_31,
  ExternalHumanPilotImportReceiptV33_31,
  ExternalHumanPilotQualificationVerdictV33_31,
} from '../src/app/external-human-pilot-evidence-import-v33_31.js';

const at = new Date('2026-07-22T12:00:00.000Z');
const later = new Date('2026-07-22T12:05:00.000Z');
const protocolDigest = sha256({ protocol: 'v33.32-test' });
const challengeDigest = sha256({ challenge: 'one' });
const packageDigest = sha256({ package: 'one' });

function registry(...identities: readonly SigningIdentity[]): KeyRegistry {
  const value = new KeyRegistry();
  for (const identity of identities) value.register(identity.keyId, identity.publicKey);
  return value;
}

function checkpoint(signer: SigningIdentity, sequence: number, previousCheckpointDigest: string | null, challenges: readonly string[], packages: readonly string[], generatedAt = at): SignedEnvelope<ExternalHumanPilotImportCheckpointV33_31> {
  const material = {
    version: '33.31' as const,
    checkpointId: `checkpoint-${sequence}`,
    sequence,
    previousCheckpointDigest,
    consumedChallengeDigests: challenges,
    consumedPackageDigests: packages,
    generatedAt: generatedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, checkpointDigest: sha256(material) }, signer);
}

function resign<T extends Record<string, unknown>>(payload: T, digestField: keyof T, signer: SigningIdentity): SignedEnvelope<T> {
  const material = { ...payload } as Record<string, unknown>;
  delete material[digestField as string];
  material[digestField as string] = sha256(material);
  return signEnvelope(material as T, signer);
}

function fixture() {
  const policySigner = generateSigningIdentity('policy-root-v33-32');
  const importer = generateSigningIdentity('importer-v33-32');
  const coordinator = generateSigningIdentity('coordinator-v33-32');
  const verifier = generateSigningIdentity('verifier-v33-32');
  const baseVerifier = generateSigningIdentity('base-verifier-v33-31');
  const pilotOperator = generateSigningIdentity('pilot-operator-v33-32');
  const witnesses = Array.from({ length: 5 }, (_, index) => generateSigningIdentity(`witness-${index + 1}`));
  const witnessRows = witnesses.map((identity, index) => ({
    witnessId: `witness-${index + 1}`,
    keyId: identity.keyId,
    keyFingerprint: registry(identity).fingerprint(identity.keyId)!,
    organizationId: `Witness Organization ${index + 1}`,
    hostId: `witness-host-${index + 1}`,
  }));
  const policy = createFederatedCheckpointWitnessPolicyV33_32({
    policySigner,
    studyId: 'study-v33-32',
    protocolDigest,
    epoch: 1,
    quorum: 3,
    witnesses: witnessRows,
    importer: { keyId: importer.keyId, organizationId: 'Import Authority', hostId: 'import-host' },
    coordinator: { keyId: coordinator.keyId, organizationId: 'Witness Coordinator Org', hostId: 'coordinator-host' },
    issuedAt: new Date('2026-07-22T11:00:00.000Z'),
    expiresAt: new Date('2026-07-23T11:00:00.000Z'),
  });
  const initialCheckpoint = checkpoint(importer, 0, null, [], [], new Date('2026-07-22T11:01:00.000Z'));
  const genesis = createFederatedCheckpointGenesisAnchorV33_32({ anchorSigner: policySigner, policy, initialCheckpoint, generatedAt: new Date('2026-07-22T11:02:00.000Z') });
  const candidateCheckpoint = checkpoint(importer, 1, initialCheckpoint.payload.checkpointDigest, [challengeDigest], [packageDigest], new Date('2026-07-22T11:55:00.000Z'));
  const proposal = createFederatedCheckpointProposalV33_32({ importer, policy, previousAnchor: genesis, previousCheckpoint: initialCheckpoint, candidateCheckpoint, newChallengeDigest: challengeDigest, newPackageDigest: packageDigest, proposedAt: new Date('2026-07-22T11:56:00.000Z') });
  const votes = witnesses.slice(0, 3).map((witness, index) => createFederatedCheckpointWitnessVoteV33_32({ witness, witnessId: `witness-${index + 1}`, policy, proposal, observedAt: new Date(`2026-07-22T11:5${7 + index}:00.000Z`) }));
  const trust: FederatedCheckpointTrustV33_32 = {
    policyRegistry: registry(policySigner),
    trustedPolicySignerIds: [policySigner.keyId],
    importerRegistry: registry(importer),
    trustedImporterIds: [importer.keyId],
    checkpointRegistry: registry(importer),
    trustedCheckpointSignerIds: [importer.keyId],
    witnessRegistry: registry(...witnesses),
    trustedWitnessIds: witnesses.map((row) => row.keyId),
    coordinatorRegistry: registry(coordinator),
    trustedCoordinatorIds: [coordinator.keyId],
    anchorRegistry: registry(policySigner, coordinator),
    trustedAnchorSignerIds: [policySigner.keyId, coordinator.keyId],
  };
  const partial = { policy, previousAnchor: genesis, previousCheckpoint: initialCheckpoint, candidateCheckpoint, proposal, votes };
  const finalized = finalizeFederatedCheckpointTransitionV33_32({ coordinator, bundle: partial, trust, issuedAt: at });
  const bundle: FederatedCheckpointTransitionBundleV33_32 = { ...partial, ...finalized };
  const executionRoles: ExternalHumanPilotExecutionRoleV33_32[] = [
    ['PILOT_OPERATOR', pilotOperator.keyId], ['RESEARCHER', 'researcher-key'], ['REGISTRAR', 'registrar-key'], ['EXPORTER', 'exporter-key'], ['IMPORTER', importer.keyId], ['OBSERVER', 'observer-key'], ['VERIFIER', verifier.keyId], ['WITNESS_COORDINATOR', coordinator.keyId], ['PRIVACY_OFFICER', 'privacy-key'],
  ].map(([role, keyId], index) => ({ role: role as ExternalHumanPilotExecutionRoleV33_32['role'], keyId: keyId!, organizationId: `Execution Org ${index + 1}`, hostId: `execution-host-${index + 1}` }));
  return { policySigner, importer, coordinator, verifier, baseVerifier, pilotOperator, witnesses, witnessRows, policy, initialCheckpoint, genesis, candidateCheckpoint, proposal, votes, trust, partial, bundle, executionRoles };
}

function baseEvidence(f: ReturnType<typeof fixture>, live = true) {
  const receiptMaterial = {
    version: '33.31' as const,
    receiptId: 'receipt-1', packageId: 'package-1', packageDigest, challengeDigest, checkpointSequence: 1,
    evidenceClass: live ? 'LIVE_EXTERNAL' as const : 'SYNTHETIC_REFERENCE' as const,
    status: live ? 'VERIFIED_LIVE_EXTERNAL_EVIDENCE_READY_FOR_EVALUATION' as const : 'SYNTHETIC_REFERENCE_NOT_EXTERNAL' as const,
    participantCount: 5, externalHumanParticipants: live ? 5 : 0, artifactCount: 10,
    artifactBytesVerified: true as const, observationSchemaVerified: true as const, roleProofsVerified: true as const, roleBindingsExternallyAttested: true as const, replayProtected: true as const,
    importedAt: at.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  const receipt = signEnvelope({ ...receiptMaterial, receiptDigest: sha256(receiptMaterial) }, f.importer);
  const verdictMaterial = {
    version: '33.31' as const, verdictId: 'base-verdict', studyId: 'study-v33-32', protocolDigest, packageDigest,
    importReceiptDigest: receipt.payload.receiptDigest, baseContractVerdictDigest: sha256({ base: true }), evidenceClass: receiptMaterial.evidenceClass,
    participantCount: 5, distinctScenarioCount: 3, medianStepReductionPercent: 40, medianGovernedApprovals: 1, medianComprehensionSeconds: 4,
    taskSuccessRatePercent: 100, accessibilityPassRatePercent: 100, comprehensionCorrectRatePercent: 100, evidenceClosurePercent: 100,
    externalProvenanceVerified: live, observationArtifactsVerified: true as const, roleProofsVerified: true as const, replayProtected: true as const,
    humanPilotPassed: live, status: live ? 'HUMAN_UX_PILOT_PASSED_SHADOW_ONLY' as const : 'HUMAN_UX_PILOT_REQUIRED' as const,
    blockers: live ? [] as readonly string[] : ['external_human_pilot_required'] as readonly string[], generatedAt: at.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  const verdict = signEnvelope({ ...verdictMaterial, verdictDigest: sha256(verdictMaterial) }, f.baseVerifier);
  return { receipt, verdict };
}

test('valid three-of-five witness transition verifies', () => { const f = fixture(); assert.equal(verifyFederatedCheckpointTransitionV33_32({ bundle: f.bundle, trust: f.trust, verifiedAt: later }).sequence, 1); });
test('two witness votes fail quorum', () => { const f = fixture(); assert.throws(() => finalizeFederatedCheckpointTransitionV33_32({ coordinator: f.coordinator, bundle: { ...f.partial, votes: f.votes.slice(0, 2) }, trust: f.trust, issuedAt: at }), /quorum_not_met/); });
test('policy rejects fewer than three witnesses', () => { const f = fixture(); assert.throws(() => createFederatedCheckpointWitnessPolicyV33_32({ policySigner: f.policySigner, studyId: 's', protocolDigest, epoch: 1, quorum: 2, witnesses: f.witnessRows.slice(0, 2), importer: { keyId: f.importer.keyId, organizationId: 'i', hostId: 'ih' }, coordinator: { keyId: f.coordinator.keyId, organizationId: 'c', hostId: 'ch' }, issuedAt: at, expiresAt: later }), /quorum_invalid|witness_count_invalid/); });
test('policy rejects duplicate witness organization', () => { const f = fixture(); const rows = f.witnessRows.map((row, i) => i === 1 ? { ...row, organizationId: f.witnessRows[0]!.organizationId } : row); assert.throws(() => createFederatedCheckpointWitnessPolicyV33_32({ policySigner: f.policySigner, studyId: 's', protocolDigest, epoch: 1, quorum: 3, witnesses: rows, importer: { keyId: f.importer.keyId, organizationId: 'i', hostId: 'ih' }, coordinator: { keyId: f.coordinator.keyId, organizationId: 'c', hostId: 'ch' }, issuedAt: at, expiresAt: later }), /topology_duplicate/); });
test('policy rejects duplicate witness host', () => { const f = fixture(); const rows = f.witnessRows.map((row, i) => i === 1 ? { ...row, hostId: f.witnessRows[0]!.hostId } : row); assert.throws(() => createFederatedCheckpointWitnessPolicyV33_32({ policySigner: f.policySigner, studyId: 's', protocolDigest, epoch: 1, quorum: 3, witnesses: rows, importer: { keyId: f.importer.keyId, organizationId: 'i', hostId: 'ih' }, coordinator: { keyId: f.coordinator.keyId, organizationId: 'c', hostId: 'ch' }, issuedAt: at, expiresAt: later }), /topology_duplicate/); });
test('policy rejects witness overlap with importer', () => { const f = fixture(); assert.throws(() => createFederatedCheckpointWitnessPolicyV33_32({ policySigner: f.policySigner, studyId: 's', protocolDigest, epoch: 1, quorum: 3, witnesses: f.witnessRows, importer: { keyId: f.importer.keyId, organizationId: f.witnessRows[0]!.organizationId, hostId: 'ih' }, coordinator: { keyId: f.coordinator.keyId, organizationId: 'c', hostId: 'ch' }, issuedAt: at, expiresAt: later }), /witness_role_overlap/); });
test('policy rejects importer coordinator overlap', () => { const f = fixture(); assert.throws(() => createFederatedCheckpointWitnessPolicyV33_32({ policySigner: f.policySigner, studyId: 's', protocolDigest, epoch: 1, quorum: 3, witnesses: f.witnessRows, importer: { keyId: f.importer.keyId, organizationId: 'same', hostId: 'ih' }, coordinator: { keyId: f.coordinator.keyId, organizationId: 'same', hostId: 'ch' }, issuedAt: at, expiresAt: later }), /importer_coordinator_overlap/); });
test('expired policy fails transition verification', () => { const f = fixture(); assert.throws(() => verifyFederatedCheckpointTransitionV33_32({ bundle: f.bundle, trust: f.trust, verifiedAt: new Date('2026-07-24T00:00:00.000Z') }), /policy_not_active/); });
test('tampered policy signature fails', () => { const f = fixture(); const policy = { ...f.policy, payload: { ...f.policy.payload, quorum: 4 } }; assert.throws(() => verifyFederatedCheckpointTransitionV33_32({ bundle: { ...f.bundle, policy }, trust: f.trust, verifiedAt: later }), /policy_signature/); });
test('untrusted policy signer fails', () => { const f = fixture(); assert.throws(() => verifyFederatedCheckpointTransitionV33_32({ bundle: f.bundle, trust: { ...f.trust, trustedPolicySignerIds: ['other'] }, verifiedAt: later }), /policy_signature/); });
test('rollback sequence is rejected', () => { const f = fixture(); const bad = checkpoint(f.importer, 0, null, [challengeDigest], [packageDigest]); assert.throws(() => createFederatedCheckpointProposalV33_32({ importer: f.importer, policy: f.policy, previousAnchor: f.genesis, previousCheckpoint: f.initialCheckpoint, candidateCheckpoint: bad, newChallengeDigest: challengeDigest, newPackageDigest: packageDigest, proposedAt: at }), /non_monotonic/); });
test('skipped sequence is rejected', () => { const f = fixture(); const bad = checkpoint(f.importer, 2, f.initialCheckpoint.payload.checkpointDigest, [challengeDigest], [packageDigest]); assert.throws(() => createFederatedCheckpointProposalV33_32({ importer: f.importer, policy: f.policy, previousAnchor: f.genesis, previousCheckpoint: f.initialCheckpoint, candidateCheckpoint: bad, newChallengeDigest: challengeDigest, newPackageDigest: packageDigest, proposedAt: at }), /non_monotonic/); });
test('wrong previous checkpoint digest is rejected', () => { const f = fixture(); const bad = checkpoint(f.importer, 1, sha256({ wrong: true }), [challengeDigest], [packageDigest]); assert.throws(() => createFederatedCheckpointProposalV33_32({ importer: f.importer, policy: f.policy, previousAnchor: f.genesis, previousCheckpoint: f.initialCheckpoint, candidateCheckpoint: bad, newChallengeDigest: challengeDigest, newPackageDigest: packageDigest, proposedAt: at }), /non_monotonic/); });
test('challenge consumption must be exact append', () => { const f = fixture(); const bad = checkpoint(f.importer, 1, f.initialCheckpoint.payload.checkpointDigest, [sha256({ other: true })], [packageDigest]); assert.throws(() => createFederatedCheckpointProposalV33_32({ importer: f.importer, policy: f.policy, previousAnchor: f.genesis, previousCheckpoint: f.initialCheckpoint, candidateCheckpoint: bad, newChallengeDigest: challengeDigest, newPackageDigest: packageDigest, proposedAt: at }), /challenge_consumption/); });
test('package consumption must be exact append', () => { const f = fixture(); const bad = checkpoint(f.importer, 1, f.initialCheckpoint.payload.checkpointDigest, [challengeDigest], [sha256({ other: true })]); assert.throws(() => createFederatedCheckpointProposalV33_32({ importer: f.importer, policy: f.policy, previousAnchor: f.genesis, previousCheckpoint: f.initialCheckpoint, candidateCheckpoint: bad, newChallengeDigest: challengeDigest, newPackageDigest: packageDigest, proposedAt: at }), /package_consumption/); });
test('tampered proposal signature fails', () => { const f = fixture(); const proposal = { ...f.proposal, payload: { ...f.proposal.payload, candidateSequence: 9 } }; assert.throws(() => finalizeFederatedCheckpointTransitionV33_32({ coordinator: f.coordinator, bundle: { ...f.partial, proposal }, trust: f.trust, issuedAt: at }), /proposal_signature/); });
test('untrusted importer proposal fails', () => { const f = fixture(); assert.throws(() => finalizeFederatedCheckpointTransitionV33_32({ coordinator: f.coordinator, bundle: f.partial, trust: { ...f.trust, trustedImporterIds: ['other'] }, issuedAt: at }), /proposal_signature/); });
test('tampered witness vote fails', () => { const f = fixture(); const votes = [{ ...f.votes[0]!, payload: { ...f.votes[0]!.payload, sequence: 2 } }, ...f.votes.slice(1)]; assert.throws(() => finalizeFederatedCheckpointTransitionV33_32({ coordinator: f.coordinator, bundle: { ...f.partial, votes }, trust: f.trust, issuedAt: at }), /vote_signature/); });
test('untrusted witness fails', () => { const f = fixture(); assert.throws(() => finalizeFederatedCheckpointTransitionV33_32({ coordinator: f.coordinator, bundle: f.partial, trust: { ...f.trust, trustedWitnessIds: f.witnesses.slice(1).map((row) => row.keyId) }, issuedAt: at }), /vote_signature|policy_witness_trust_binding/); });
test('duplicate witness vote cannot satisfy quorum', () => { const f = fixture(); const votes = [f.votes[0]!, f.votes[0]!, f.votes[1]!]; assert.throws(() => finalizeFederatedCheckpointTransitionV33_32({ coordinator: f.coordinator, bundle: { ...f.partial, votes }, trust: f.trust, issuedAt: at }), /topology_duplicate/); });
test('vote bound to wrong proposal is rejected', () => { const f = fixture(); const payload = { ...f.votes[0]!.payload, proposalDigest: sha256({ wrong: true }) }; const bad = resign(payload as unknown as Record<string, unknown>, 'voteDigest', f.witnesses[0]!) as unknown as SignedEnvelope<FederatedCheckpointWitnessVoteV33_32>; assert.throws(() => finalizeFederatedCheckpointTransitionV33_32({ coordinator: f.coordinator, bundle: { ...f.partial, votes: [bad, ...f.votes.slice(1)] }, trust: f.trust, issuedAt: at }), /vote_proposal_binding/); });
test('equivocation detector finds conflicting witness votes', () => { const f = fixture(); const payload = { ...f.votes[0]!.payload, candidateCheckpointDigest: sha256({ fork: true }) }; const fork = resign(payload as unknown as Record<string, unknown>, 'voteDigest', f.witnesses[0]!) as unknown as SignedEnvelope<FederatedCheckpointWitnessVoteV33_32>; const findings = detectFederatedCheckpointEquivocationV33_32([f.votes[0]!, fork]); assert.equal(findings.length, 1); assert.equal(findings[0]!.conflictingCandidateCheckpointDigests.length, 2); });
test('equivocation blocks transition', () => { const f = fixture(); const payload = { ...f.votes[0]!.payload, candidateCheckpointDigest: sha256({ fork: true }) }; const fork = resign(payload as unknown as Record<string, unknown>, 'voteDigest', f.witnesses[0]!) as unknown as SignedEnvelope<FederatedCheckpointWitnessVoteV33_32>; assert.throws(() => finalizeFederatedCheckpointTransitionV33_32({ coordinator: f.coordinator, bundle: { ...f.partial, votes: [...f.votes, fork] }, trust: f.trust, issuedAt: at }), /vote_proposal_binding|equivocation/); });
test('tampered certificate signature fails', () => { const f = fixture(); const certificate = { ...f.bundle.certificate, payload: { ...f.bundle.certificate.payload, quorumRequired: 4 } }; assert.throws(() => verifyFederatedCheckpointTransitionV33_32({ bundle: { ...f.bundle, certificate }, trust: f.trust, verifiedAt: later }), /certificate_signature/); });
test('untrusted coordinator fails', () => { const f = fixture(); assert.throws(() => verifyFederatedCheckpointTransitionV33_32({ bundle: f.bundle, trust: { ...f.trust, trustedCoordinatorIds: ['other'] }, verifiedAt: later }), /certificate_signature/); });
test('certificate vote inventory tamper is rejected even when resigned', () => { const f = fixture(); const payload = { ...f.bundle.certificate.payload, witnessKeyIds: [...f.bundle.certificate.payload.witnessKeyIds].reverse() }; const certificate = resign(payload as unknown as Record<string, unknown>, 'certificateDigest', f.coordinator) as unknown as SignedEnvelope<FederatedCheckpointCertificateV33_32>; assert.throws(() => verifyFederatedCheckpointTransitionV33_32({ bundle: { ...f.bundle, certificate }, trust: f.trust, verifiedAt: later }), /vote_set_invalid/); });
test('tampered next anchor signature fails', () => { const f = fixture(); const nextAnchor = { ...f.bundle.nextAnchor, payload: { ...f.bundle.nextAnchor.payload, sequence: 2 } }; assert.throws(() => verifyFederatedCheckpointTransitionV33_32({ bundle: { ...f.bundle, nextAnchor }, trust: f.trust, verifiedAt: later }), /anchor_signature/); });
test('resigned next anchor with wrong certificate is rejected', () => { const f = fixture(); const payload = { ...f.bundle.nextAnchor.payload, certificateDigest: sha256({ wrong: true }) }; const nextAnchor = resign(payload as unknown as Record<string, unknown>, 'anchorDigest', f.coordinator) as unknown as SignedEnvelope<FederatedCheckpointAnchorV33_32>; assert.throws(() => verifyFederatedCheckpointTransitionV33_32({ bundle: { ...f.bundle, nextAnchor }, trust: f.trust, verifiedAt: later }), /next_anchor_binding/); });
test('execution kit verifies as structural only', () => { const f = fixture(); const kit = createExternalHumanPilotExecutionKitV33_32({ pilotOperator: f.pilotOperator, studyId: 'study-v33-32', protocolDigest, witnessPolicyDigest: f.policy.payload.policyDigest, roleAssignments: f.executionRoles, issuedAt: at, expiresAt: new Date('2026-07-23T12:00:00.000Z') }); const readiness = verifyExternalHumanPilotExecutionKitV33_32({ kit, operatorRegistry: registry(f.pilotOperator), trustedOperatorIds: [f.pilotOperator.keyId], expectedProtocolDigest: protocolDigest, expectedWitnessPolicyDigest: f.policy.payload.policyDigest, evaluatedAt: later }); assert.equal(readiness.externalExecutionPerformed, false); assert.equal(readiness.externalHumanParticipants, 0); });
test('execution kit rejects missing required role', () => { const f = fixture(); assert.throws(() => createExternalHumanPilotExecutionKitV33_32({ pilotOperator: f.pilotOperator, studyId: 's', protocolDigest, witnessPolicyDigest: f.policy.payload.policyDigest, roleAssignments: f.executionRoles.slice(1), issuedAt: at, expiresAt: later }), /role_missing/); });
test('execution kit rejects overlapping organizations', () => { const f = fixture(); const roles = f.executionRoles.map((row, i) => i === 1 ? { ...row, organizationId: f.executionRoles[0]!.organizationId } : row); assert.throws(() => createExternalHumanPilotExecutionKitV33_32({ pilotOperator: f.pilotOperator, studyId: 's', protocolDigest, witnessPolicyDigest: f.policy.payload.policyDigest, roleAssignments: roles, issuedAt: at, expiresAt: later }), /role_overlap/); });
test('execution kit rejects retention beyond 30 days', () => { const f = fixture(); assert.throws(() => createExternalHumanPilotExecutionKitV33_32({ pilotOperator: f.pilotOperator, studyId: 's', protocolDigest, witnessPolicyDigest: f.policy.payload.policyDigest, roleAssignments: f.executionRoles, issuedAt: at, expiresAt: later, retentionDays: 31 }), /retention_invalid/); });
test('tampered execution kit signature fails', () => { const f = fixture(); const kit = createExternalHumanPilotExecutionKitV33_32({ pilotOperator: f.pilotOperator, studyId: 's', protocolDigest, witnessPolicyDigest: f.policy.payload.policyDigest, roleAssignments: f.executionRoles, issuedAt: at, expiresAt: new Date('2026-07-23T00:00:00.000Z') }); const bad = { ...kit, payload: { ...kit.payload, retentionDays: 10 } }; assert.throws(() => verifyExternalHumanPilotExecutionKitV33_32({ kit: bad, operatorRegistry: registry(f.pilotOperator), trustedOperatorIds: [f.pilotOperator.keyId], expectedProtocolDigest: protocolDigest, expectedWitnessPolicyDigest: f.policy.payload.policyDigest, evaluatedAt: later }), /kit_signature/); });
test('execution kit binding mismatch fails', () => { const f = fixture(); const kit = createExternalHumanPilotExecutionKitV33_32({ pilotOperator: f.pilotOperator, studyId: 's', protocolDigest, witnessPolicyDigest: f.policy.payload.policyDigest, roleAssignments: f.executionRoles, issuedAt: at, expiresAt: new Date('2026-07-23T00:00:00.000Z') }); assert.throws(() => verifyExternalHumanPilotExecutionKitV33_32({ kit, operatorRegistry: registry(f.pilotOperator), trustedOperatorIds: [f.pilotOperator.keyId], expectedProtocolDigest: protocolDigest, expectedWitnessPolicyDigest: sha256({ wrong: true }), evaluatedAt: later }), /kit_binding/); });
test('expired execution kit fails', () => { const f = fixture(); const kit = createExternalHumanPilotExecutionKitV33_32({ pilotOperator: f.pilotOperator, studyId: 's', protocolDigest, witnessPolicyDigest: f.policy.payload.policyDigest, roleAssignments: f.executionRoles, issuedAt: new Date('2026-07-20T00:00:00.000Z'), expiresAt: new Date('2026-07-21T00:00:00.000Z') }); assert.throws(() => verifyExternalHumanPilotExecutionKitV33_32({ kit, operatorRegistry: registry(f.pilotOperator), trustedOperatorIds: [f.pilotOperator.keyId], expectedProtocolDigest: protocolDigest, expectedWitnessPolicyDigest: f.policy.payload.policyDigest, evaluatedAt: later }), /kit_not_active/); });
test('live external base verdict can pass only with federated transition', () => { const f = fixture(); const base = baseEvidence(f, true); const verdict = finalizeFederatedHumanPilotVerdictV33_32({ verifier: f.verifier, baseVerdict: base.verdict, baseReceipt: base.receipt, baseVerifierRegistry: registry(f.baseVerifier), trustedBaseVerifierIds: [f.baseVerifier.keyId], receiptRegistry: registry(f.importer), trustedReceiptSignerIds: [f.importer.keyId], transition: f.bundle, transitionTrust: f.trust, generatedAt: later }); assert.equal(verdict.payload.humanPilotPassed, true); assert.equal(verdict.payload.status, 'HUMAN_UX_PILOT_PASSED_SHADOW_ONLY_FEDERATED_CHECKPOINT'); });
test('synthetic base verdict remains blocked despite witness quorum', () => { const f = fixture(); const base = baseEvidence(f, false); const verdict = finalizeFederatedHumanPilotVerdictV33_32({ verifier: f.verifier, baseVerdict: base.verdict, baseReceipt: base.receipt, baseVerifierRegistry: registry(f.baseVerifier), trustedBaseVerifierIds: [f.baseVerifier.keyId], receiptRegistry: registry(f.importer), trustedReceiptSignerIds: [f.importer.keyId], transition: f.bundle, transitionTrust: f.trust, generatedAt: later }); assert.equal(verdict.payload.humanPilotPassed, false); assert.equal(verdict.payload.status, 'HUMAN_UX_PILOT_REQUIRED'); });
test('receipt checkpoint mismatch blocks final verdict', () => { const f = fixture(); const base = baseEvidence(f, true); const payload = { ...base.receipt.payload, checkpointSequence: 2 }; const receipt = resign(payload as unknown as Record<string, unknown>, 'receiptDigest', f.importer) as unknown as SignedEnvelope<ExternalHumanPilotImportReceiptV33_31>; assert.throws(() => finalizeFederatedHumanPilotVerdictV33_32({ verifier: f.verifier, baseVerdict: base.verdict, baseReceipt: receipt, baseVerifierRegistry: registry(f.baseVerifier), trustedBaseVerifierIds: [f.baseVerifier.keyId], receiptRegistry: registry(f.importer), trustedReceiptSignerIds: [f.importer.keyId], transition: f.bundle, transitionTrust: f.trust, generatedAt: later }), /receipt_verdict_binding|receipt_checkpoint_binding/); });
test('all v33.32 outputs preserve shadow-only zero-effect boundary', () => { const f = fixture(); const base = baseEvidence(f, true); const verdict = finalizeFederatedHumanPilotVerdictV33_32({ verifier: f.verifier, baseVerdict: base.verdict, baseReceipt: base.receipt, baseVerifierRegistry: registry(f.baseVerifier), trustedBaseVerifierIds: [f.baseVerifier.keyId], receiptRegistry: registry(f.importer), trustedReceiptSignerIds: [f.importer.keyId], transition: f.bundle, transitionTrust: f.trust, generatedAt: later }); assert.equal(f.bundle.certificate.payload.productionAuthority, 'NONE'); assert.equal(f.bundle.nextAnchor.payload.externalEffectsExecuted, 0); assert.equal(verdict.payload.productionAuthority, 'NONE'); assert.equal(verdict.payload.externalEffectsExecuted, 0); });
test('policy witness fingerprint must match trusted registry', () => { const f = fixture(); const payload = { ...f.policy.payload, witnesses: f.policy.payload.witnesses.map((row, i) => i === 0 ? { ...row, keyFingerprint: sha256({ forged: true }) } : row) }; const policy = resign(payload as unknown as Record<string, unknown>, 'policyDigest', f.policySigner) as unknown as SignedEnvelope<FederatedCheckpointWitnessPolicyV33_32>; assert.throws(() => verifyFederatedCheckpointTransitionV33_32({ bundle: { ...f.bundle, policy }, trust: f.trust, verifiedAt: later }), /witness_trust_binding/); });
test('next anchor must be signed by coordinator', () => { const f = fixture(); const nextAnchor = resign(f.bundle.nextAnchor.payload as unknown as Record<string, unknown>, 'anchorDigest', f.policySigner) as unknown as SignedEnvelope<FederatedCheckpointAnchorV33_32>; assert.throws(() => verifyFederatedCheckpointTransitionV33_32({ bundle: { ...f.bundle, nextAnchor }, trust: f.trust, verifiedAt: later }), /next_anchor_signer/); });
test('independent kit verifier rejects resigned missing role', () => { const f = fixture(); const kit = createExternalHumanPilotExecutionKitV33_32({ pilotOperator: f.pilotOperator, studyId: 's', protocolDigest, witnessPolicyDigest: f.policy.payload.policyDigest, roleAssignments: f.executionRoles, issuedAt: at, expiresAt: new Date('2026-07-23T00:00:00.000Z') }); const payload = { ...kit.payload, roleAssignments: kit.payload.roleAssignments.filter((row) => row.role !== 'PRIVACY_OFFICER') }; const bad = resign(payload as unknown as Record<string, unknown>, 'kitDigest', f.pilotOperator) as unknown as typeof kit; assert.throws(() => verifyExternalHumanPilotExecutionKitV33_32({ kit: bad, operatorRegistry: registry(f.pilotOperator), trustedOperatorIds: [f.pilotOperator.keyId], expectedProtocolDigest: protocolDigest, expectedWitnessPolicyDigest: f.policy.payload.policyDigest, evaluatedAt: later }), /role_missing/); });
test('receipt evidence class cannot contradict base verdict', () => { const f = fixture(); const base = baseEvidence(f, true); const payload = { ...base.receipt.payload, evidenceClass: 'SYNTHETIC_REFERENCE' as const, status: 'SYNTHETIC_REFERENCE_NOT_EXTERNAL' as const, externalHumanParticipants: 0 }; const receipt = resign(payload as unknown as Record<string, unknown>, 'receiptDigest', f.importer) as unknown as SignedEnvelope<ExternalHumanPilotImportReceiptV33_31>; assert.throws(() => finalizeFederatedHumanPilotVerdictV33_32({ verifier: f.verifier, baseVerdict: base.verdict, baseReceipt: receipt, baseVerifierRegistry: registry(f.baseVerifier), trustedBaseVerifierIds: [f.baseVerifier.keyId], receiptRegistry: registry(f.importer), trustedReceiptSignerIds: [f.importer.keyId], transition: f.bundle, transitionTrust: f.trust, generatedAt: later }), /receipt_verdict_binding|evidence_class/); });
test('synthetic receipt cannot claim external participant count', () => { const f = fixture(); const base = baseEvidence(f, false); const payload = { ...base.receipt.payload, externalHumanParticipants: 5 }; const receipt = resign(payload as unknown as Record<string, unknown>, 'receiptDigest', f.importer) as unknown as SignedEnvelope<ExternalHumanPilotImportReceiptV33_31>; assert.throws(() => finalizeFederatedHumanPilotVerdictV33_32({ verifier: f.verifier, baseVerdict: base.verdict, baseReceipt: receipt, baseVerifierRegistry: registry(f.baseVerifier), trustedBaseVerifierIds: [f.baseVerifier.keyId], receiptRegistry: registry(f.importer), trustedReceiptSignerIds: [f.importer.keyId], transition: f.bundle, transitionTrust: f.trust, generatedAt: later }), /receipt_verdict_binding|evidence_class/); });
