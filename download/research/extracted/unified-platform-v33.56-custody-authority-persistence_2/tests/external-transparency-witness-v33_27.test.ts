import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
  type SignedEnvelope,
} from '../src/contracts/crypto.js';
import {
  ScannerTransparencyLogV33_26,
  createExternalScannerReceiptV33_26,
  type ExternalScannerEvidenceBundleV33_26,
  type ScannerTransparencyCheckpointV33_26,
} from '../src/app/scanner-evidence-transparency-v33_26.js';
import {
  createExternalScannerOperatorEnrollmentV33_27,
  createExternalWitnessScannerChallengeV33_27,
  createSignedProgramParameterLedgerV33_27,
  createTransparencyWitnessEnrollmentV33_27,
  createTransparencyWitnessGossipReceiptV33_27,
  createTransparencyWitnessObservationV33_27,
  defaultProgramParametersV33_27,
  evaluateExternalWitnessScannerQualificationV33_27,
  verifySignedProgramParameterLedgerV33_27,
  type ExternalEnrollmentClassV33_27,
  type ProgramParameterV33_27,
  type TransparencyWitnessObservationV33_27,
} from '../src/app/external-transparency-witness-v33_27.js';

const NOW = new Date('2026-07-22T03:00:00.000Z');
const BEFORE = new Date(NOW.getTime() - 60_000);
const AFTER = new Date(NOW.getTime() + 86_400_000);
const PACKAGE_DIGEST = sha256({ package: 'v33.27-fixture' });
const FEED_DIGEST = sha256({ feed: 'v33.27-fixture' });

interface FixtureOptions {
  readonly scannerClass?: ExternalEnrollmentClassV33_27;
  readonly witnessClass?: ExternalEnrollmentClassV33_27;
  readonly receiptResults?: readonly ['CLEAN' | 'REJECTED', 'CLEAN' | 'REJECTED'];
  readonly sameScannerOrganization?: boolean;
  readonly sameScannerHost?: boolean;
  readonly sameWitnessOrganization?: boolean;
  readonly sameWitnessHost?: boolean;
  readonly secondPackageDigest?: string;
  readonly secondFeedDigest?: string;
}

function fixture(options: FixtureOptions = {}) {
  const scannerClass = options.scannerClass ?? 'SYNTHETIC_REFERENCE';
  const witnessClass = options.witnessClass ?? 'SYNTHETIC_REFERENCE';
  const receiptEvidenceClass = scannerClass === 'LIVE_EXTERNAL' ? 'LIVE_EXTERNAL_SCANNER_EVIDENCE' as const : 'SYNTHETIC_CONTRACT_TEST' as const;
  const ledgerSigner = generateSigningIdentity('parameter-ledger-signer');
  const challengeSigner = generateSigningIdentity('challenge-signer');
  const registrar = generateSigningIdentity('trust-registrar');
  const scannerA = generateSigningIdentity('scanner-clamav');
  const scannerB = generateSigningIdentity('scanner-yara');
  const witnessA = generateSigningIdentity('witness-a');
  const witnessB = generateSigningIdentity('witness-b');
  const verifier = generateSigningIdentity('independent-verifier');
  const entrySigner = generateSigningIdentity('transparency-entry-signer');
  const checkpointSigner = generateSigningIdentity('transparency-checkpoint-signer');

  const ledgerRegistry = registryOf(ledgerSigner);
  const challengeRegistry = registryOf(challengeSigner);
  const registrarRegistry = registryOf(registrar);
  const scannerRegistry = registryOf(scannerA, scannerB);
  const witnessRegistry = registryOf(witnessA, witnessB);
  const entryRegistry = registryOf(entrySigner);
  const checkpointRegistry = registryOf(checkpointSigner);

  const parameterLedger = createSignedProgramParameterLedgerV33_27({ signer: ledgerSigner, generatedAt: BEFORE });
  const challenge = createExternalWitnessScannerChallengeV33_27({ signer: challengeSigner, issuedAt: BEFORE, expiresAt: AFTER });
  const scannerOrgA = 'scanner-org-a';
  const scannerOrgB = options.sameScannerOrganization ? scannerOrgA : 'scanner-org-b';
  const scannerHostA = 'scanner-host-a';
  const scannerHostB = options.sameScannerHost ? scannerHostA : 'scanner-host-b';
  const witnessOrgA = 'witness-org-a';
  const witnessOrgB = options.sameWitnessOrganization ? witnessOrgA : 'witness-org-b';
  const witnessHostA = 'witness-host-a';
  const witnessHostB = options.sameWitnessHost ? witnessHostA : 'witness-host-b';

  const operatorEnrollments = [
    createExternalScannerOperatorEnrollmentV33_27({
      registrar, enrollmentClass: scannerClass, operatorId: 'operator-clamav', organizationId: scannerOrgA, hostId: scannerHostA,
      engine: 'CLAMAV', receiptSignerKeyId: scannerA.keyId, receiptSignerFingerprint: scannerRegistry.fingerprint(scannerA.keyId)!, enrolledAt: BEFORE, expiresAt: AFTER,
    }),
    createExternalScannerOperatorEnrollmentV33_27({
      registrar, enrollmentClass: scannerClass, operatorId: 'operator-yara', organizationId: scannerOrgB, hostId: scannerHostB,
      engine: 'YARA', receiptSignerKeyId: scannerB.keyId, receiptSignerFingerprint: scannerRegistry.fingerprint(scannerB.keyId)!, enrolledAt: BEFORE, expiresAt: AFTER,
    }),
  ] as const;

  const witnessEnrollments = [
    createTransparencyWitnessEnrollmentV33_27({
      registrar, enrollmentClass: witnessClass, witnessId: 'witness-a', organizationId: witnessOrgA, hostId: witnessHostA,
      witnessSignerKeyId: witnessA.keyId, witnessSignerFingerprint: witnessRegistry.fingerprint(witnessA.keyId)!, enrolledAt: BEFORE, expiresAt: AFTER,
    }),
    createTransparencyWitnessEnrollmentV33_27({
      registrar, enrollmentClass: witnessClass, witnessId: 'witness-b', organizationId: witnessOrgB, hostId: witnessHostB,
      witnessSignerKeyId: witnessB.keyId, witnessSignerFingerprint: witnessRegistry.fingerprint(witnessB.keyId)!, enrolledAt: BEFORE, expiresAt: AFTER,
    }),
  ] as const;

  const results = options.receiptResults ?? ['CLEAN', 'CLEAN'] as const;
  const scannerBundles = [
    scannerBundle(scannerA, 'CLAMAV', scannerOrgA, scannerHostA, receiptEvidenceClass, results[0], PACKAGE_DIGEST, FEED_DIGEST),
    scannerBundle(scannerB, 'YARA', scannerOrgB, scannerHostB, receiptEvidenceClass, results[1], options.secondPackageDigest ?? PACKAGE_DIGEST, options.secondFeedDigest ?? FEED_DIGEST),
  ] as const;

  const log = new ScannerTransparencyLogV33_26(
    'scanner-log-v33.27', entryRegistry, [entrySigner.keyId], checkpointSigner, checkpointRegistry, [checkpointSigner.keyId],
  );
  const checkpoint = log.appendFeedCheckpoint({ signer: entrySigner, feedId: 'feed-v33.27', feedDigest: FEED_DIGEST, now: BEFORE });
  const observations = [
    createTransparencyWitnessObservationV33_27({
      witnessSigner: witnessA, enrollment: witnessEnrollments[0], registrarRegistry, trustedRegistrarSignerIds: [registrar.keyId],
      checkpoint, checkpointRegistry, trustedCheckpointSignerIds: [checkpointSigner.keyId], observedAt: NOW,
    }),
    createTransparencyWitnessObservationV33_27({
      witnessSigner: witnessB, enrollment: witnessEnrollments[1], registrarRegistry, trustedRegistrarSignerIds: [registrar.keyId],
      checkpoint, checkpointRegistry, trustedCheckpointSignerIds: [checkpointSigner.keyId], observedAt: NOW,
    }),
  ] as const;
  const gossip = [
    createTransparencyWitnessGossipReceiptV33_27({ senderWitnessSigner: witnessA, senderObservation: observations[0], peerObservation: observations[1], witnessRegistry, trustedWitnessSignerIds: [witnessA.keyId, witnessB.keyId], now: NOW }),
    createTransparencyWitnessGossipReceiptV33_27({ senderWitnessSigner: witnessB, senderObservation: observations[1], peerObservation: observations[0], witnessRegistry, trustedWitnessSignerIds: [witnessA.keyId, witnessB.keyId], now: NOW }),
  ] as const;

  const evaluate = (overrides: Partial<Parameters<typeof evaluateExternalWitnessScannerQualificationV33_27>[0]> = {}) => evaluateExternalWitnessScannerQualificationV33_27({
    parameterLedger, parameterLedgerRegistry: ledgerRegistry, trustedParameterLedgerSignerIds: [ledgerSigner.keyId],
    challenge, challengeRegistry, trustedChallengeSignerIds: [challengeSigner.keyId],
    scannerOperatorEnrollments: operatorEnrollments, witnessEnrollments, registrarRegistry, trustedRegistrarSignerIds: [registrar.keyId],
    scannerBundles, scannerRegistry, trustedScannerSignerIds: [scannerA.keyId, scannerB.keyId],
    witnessObservations: observations, gossipReceipts: gossip, witnessRegistry, trustedWitnessSignerIds: [witnessA.keyId, witnessB.keyId],
    verifierIdentity: verifier, now: NOW, ...overrides,
  });

  return {
    ledgerSigner, challengeSigner, registrar, scannerA, scannerB, witnessA, witnessB, verifier, checkpointSigner,
    ledgerRegistry, challengeRegistry, registrarRegistry, scannerRegistry, witnessRegistry, checkpointRegistry,
    parameterLedger, challenge, operatorEnrollments, witnessEnrollments, scannerBundles, checkpoint, observations, gossip, evaluate,
  };
}

function scannerBundle(
  signer: ReturnType<typeof generateSigningIdentity>, engine: 'CLAMAV' | 'YARA', organizationId: string, hostId: string,
  evidenceClass: 'SYNTHETIC_CONTRACT_TEST' | 'LIVE_EXTERNAL_SCANNER_EVIDENCE', result: 'CLEAN' | 'REJECTED', packageDigest: string, feedDigest: string,
): ExternalScannerEvidenceBundleV33_26 {
  const bytes = {
    engineLog: Buffer.from(`${engine} engine log`), commandOutput: Buffer.from(`${engine} command output`),
    packageManifest: Buffer.from(JSON.stringify({ packageDigest })), signatureDatabaseMetadata: Buffer.from(JSON.stringify({ feedDigest })),
  };
  return createExternalScannerReceiptV33_26({
    signer, evidenceClass, engine, engineVersion: `${engine.toLowerCase()}-1.0`, signatureDatabaseVersion: 'db-1',
    signatureDatabaseUpdatedAt: new Date(NOW.getTime() - 60_000), operatorOrganizationId: organizationId,
    scannerOrganizationId: organizationId, operatorHostId: hostId, scannerHostId: hostId,
    packageId: 'package-v33.27', packageDigest, signatureFeedDigest: feedDigest, result,
    startedAt: new Date(NOW.getTime() - 30_000), completedAt: new Date(NOW.getTime() - 20_000), artifactBytesByName: bytes,
  });
}

function forkCheckpoint(
  checkpoint: SignedEnvelope<ScannerTransparencyCheckpointV33_26>, signer: ReturnType<typeof generateSigningIdentity>,
): SignedEnvelope<ScannerTransparencyCheckpointV33_26> {
  const material = {
    version: '33.26' as const, logId: checkpoint.payload.logId, treeSize: checkpoint.payload.treeSize,
    rootHash: sha256({ maliciousFork: true }), previousCheckpointDigest: checkpoint.payload.previousCheckpointDigest,
    generatedAt: checkpoint.payload.generatedAt, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, checkpointDigest: sha256(material) }, signer);
}

function registryOf(...identities: ReturnType<typeof generateSigningIdentity>[]): KeyRegistry {
  const registry = new KeyRegistry();
  for (const identity of identities) registry.register(identity.keyId, identity.publicKey);
  return registry;
}

function resign<T extends object>(envelope: SignedEnvelope<T>, signer: ReturnType<typeof generateSigningIdentity>, mutate: (payload: T) => T): SignedEnvelope<T> {
  return signEnvelope(mutate(envelope.payload), signer);
}

test('default parameter ledger has all fourteen canonical parameters', () => {
  const parameters = defaultProgramParametersV33_27();
  assert.equal(parameters.length, 14);
  assert.equal(new Set(parameters.map((item) => item.id)).size, 14);
  assert.equal(parameters.filter((item) => item.status === 'EXTERNAL_EVIDENCE_PENDING').length, 3);
});

test('signed parameter ledger verifies', () => {
  const f = fixture();
  assert.doesNotThrow(() => verifySignedProgramParameterLedgerV33_27(f.parameterLedger, f.ledgerRegistry, [f.ledgerSigner.keyId], NOW));
});

test('missing canonical parameter is rejected', () => {
  const signer = generateSigningIdentity('ledger');
  const parameters = defaultProgramParametersV33_27().slice(1);
  assert.throws(() => createSignedProgramParameterLedgerV33_27({ signer, parameters }), /parameter_ledger_count_invalid/);
});

test('external UX target cannot be prematurely marked passed', () => {
  const signer = generateSigningIdentity('ledger');
  const parameters = defaultProgramParametersV33_27().map((item) => item.id === 'UX_REDUCTION_AND_COMPREHENSION_TARGETS' ? { ...item, status: 'PRESERVED' as const } : item);
  assert.throws(() => createSignedProgramParameterLedgerV33_27({ signer, parameters }), /external_parameter_prematurely_closed/);
});

test('tampered parameter ledger signature is rejected', () => {
  const f = fixture();
  const tampered = { ...f.parameterLedger, payload: { ...f.parameterLedger.payload, ledgerId: 'tampered' } };
  assert.throws(() => verifySignedProgramParameterLedgerV33_27(tampered, f.ledgerRegistry, [f.ledgerSigner.keyId], NOW), /parameter_ledger_signature_invalid/);
});

test('future parameter ledger is rejected', () => {
  const signer = generateSigningIdentity('future-ledger');
  const registry = registryOf(signer);
  const ledger = createSignedProgramParameterLedgerV33_27({ signer, generatedAt: new Date(NOW.getTime() + 1) });
  assert.throws(() => verifySignedProgramParameterLedgerV33_27(ledger, registry, [signer.keyId], NOW), /parameter_ledger_time_invalid/);
});

test('scanner operator enrollment rejects malformed fingerprint', () => {
  const registrar = generateSigningIdentity('registrar');
  assert.throws(() => createExternalScannerOperatorEnrollmentV33_27({ registrar, enrollmentClass: 'SYNTHETIC_REFERENCE', operatorId: 'op', organizationId: 'org', hostId: 'host', engine: 'CLAMAV', receiptSignerKeyId: 'key', receiptSignerFingerprint: 'bad' }), /scanner_operator_fingerprint_invalid/);
});

test('witness enrollment rejects malformed fingerprint', () => {
  const registrar = generateSigningIdentity('registrar');
  assert.throws(() => createTransparencyWitnessEnrollmentV33_27({ registrar, enrollmentClass: 'SYNTHETIC_REFERENCE', witnessId: 'w', organizationId: 'org', hostId: 'host', witnessSignerKeyId: 'key', witnessSignerFingerprint: 'bad' }), /witness_fingerprint_invalid/);
});

test('witness observation binds the enrolled signer', () => {
  const f = fixture();
  const other = generateSigningIdentity('other-witness');
  assert.throws(() => createTransparencyWitnessObservationV33_27({ witnessSigner: other, enrollment: f.witnessEnrollments[0], registrarRegistry: f.registrarRegistry, trustedRegistrarSignerIds: [f.registrar.keyId], checkpoint: f.checkpoint, checkpointRegistry: f.checkpointRegistry, trustedCheckpointSignerIds: [f.checkpointSigner.keyId], observedAt: NOW }), /witness_signer_binding_invalid/);
});

test('witness observation rejects untrusted checkpoint signer', () => {
  const f = fixture();
  assert.throws(() => createTransparencyWitnessObservationV33_27({ witnessSigner: f.witnessA, enrollment: f.witnessEnrollments[0], registrarRegistry: f.registrarRegistry, trustedRegistrarSignerIds: [f.registrar.keyId], checkpoint: f.checkpoint, checkpointRegistry: f.checkpointRegistry, trustedCheckpointSignerIds: ['not-trusted'], observedAt: NOW }), /transparency_checkpoint_signature_invalid/);
});

test('consistent witness gossip is signed and consistent', () => {
  const f = fixture();
  assert.equal(f.gossip[0].payload.status, 'CONSISTENT');
  assert.equal(f.gossip[0].payload.comparedRootHashes[0], f.gossip[0].payload.comparedRootHashes[1]);
});

test('same witness cannot gossip with itself', () => {
  const f = fixture();
  assert.throws(() => createTransparencyWitnessGossipReceiptV33_27({ senderWitnessSigner: f.witnessA, senderObservation: f.observations[0], peerObservation: f.observations[0], witnessRegistry: f.witnessRegistry, trustedWitnessSignerIds: [f.witnessA.keyId], now: NOW }), /gossip_distinct_witnesses_required/);
});

test('gossip requires same log coordinates', () => {
  const f = fixture();
  const payload = f.observations[1].payload;
  const changedMaterial = { ...payload, treeSize: payload.treeSize + 1 };
  delete (changedMaterial as Partial<typeof changedMaterial>).observationDigest;
  const changed = signEnvelope({ ...changedMaterial, observationDigest: sha256(changedMaterial) } as TransparencyWitnessObservationV33_27, f.witnessB);
  assert.throws(() => createTransparencyWitnessGossipReceiptV33_27({ senderWitnessSigner: f.witnessA, senderObservation: f.observations[0], peerObservation: changed, witnessRegistry: f.witnessRegistry, trustedWitnessSignerIds: [f.witnessA.keyId, f.witnessB.keyId], now: NOW }), /gossip_checkpoint_coordinates_mismatch/);
});

test('synthetic scanner and witness evidence never qualifies externally', () => {
  const verdict = fixture().evaluate();
  assert.equal(verdict.payload.status, 'EXTERNAL_WITNESS_AND_SCANNER_OPERATOR_QUALIFICATION_REQUIRED');
  assert.equal(verdict.payload.liveScannerReceiptCount, 0);
  assert.equal(verdict.payload.liveWitnessObservationCount, 0);
});

test('structurally valid live external evidence qualifies pilot only', () => {
  const verdict = fixture({ scannerClass: 'LIVE_EXTERNAL', witnessClass: 'LIVE_EXTERNAL' }).evaluate();
  assert.equal(verdict.payload.status, 'EXTERNAL_WITNESS_AND_SCANNER_OPERATOR_QUALIFIED_FOR_PILOT');
  assert.equal(verdict.payload.eligibleForProductionPromotion, false);
});

test('live scanner disagreement is quarantined', () => {
  const verdict = fixture({ scannerClass: 'LIVE_EXTERNAL', witnessClass: 'LIVE_EXTERNAL', receiptResults: ['CLEAN', 'REJECTED'] }).evaluate();
  assert.equal(verdict.payload.status, 'SCANNER_DISAGREEMENT_QUARANTINE');
  assert.equal(verdict.payload.scannerDisagreementDetected, true);
});

test('split view between two witnesses is quarantined', () => {
  const f = fixture({ scannerClass: 'LIVE_EXTERNAL', witnessClass: 'LIVE_EXTERNAL' });
  const fork = forkCheckpoint(f.checkpoint, f.checkpointSigner);
  const observationB = createTransparencyWitnessObservationV33_27({ witnessSigner: f.witnessB, enrollment: f.witnessEnrollments[1], registrarRegistry: f.registrarRegistry, trustedRegistrarSignerIds: [f.registrar.keyId], checkpoint: fork, checkpointRegistry: f.checkpointRegistry, trustedCheckpointSignerIds: [f.checkpointSigner.keyId], observedAt: NOW });
  const gossip = createTransparencyWitnessGossipReceiptV33_27({ senderWitnessSigner: f.witnessA, senderObservation: f.observations[0], peerObservation: observationB, witnessRegistry: f.witnessRegistry, trustedWitnessSignerIds: [f.witnessA.keyId, f.witnessB.keyId], now: NOW });
  const verdict = f.evaluate({ witnessObservations: [f.observations[0], observationB], gossipReceipts: [gossip] });
  assert.equal(verdict.payload.status, 'SPLIT_VIEW_DETECTED_QUARANTINE');
  assert.equal(verdict.payload.splitViewDetected, true);
});

test('scanner receipt must match enrolled engine organization and host', () => {
  const f = fixture();
  const badEnrollment = createExternalScannerOperatorEnrollmentV33_27({ registrar: f.registrar, enrollmentClass: 'SYNTHETIC_REFERENCE', operatorId: 'operator-clamav', organizationId: 'wrong-org', hostId: 'scanner-host-a', engine: 'CLAMAV', receiptSignerKeyId: f.scannerA.keyId, receiptSignerFingerprint: f.scannerRegistry.fingerprint(f.scannerA.keyId)!, enrolledAt: BEFORE, expiresAt: AFTER });
  assert.throws(() => f.evaluate({ scannerOperatorEnrollments: [badEnrollment, f.operatorEnrollments[1]] }), /scanner_operator_receipt_binding_invalid/);
});

test('scanner receipt without enrollment is rejected', () => {
  const f = fixture();
  assert.throws(() => f.evaluate({ scannerOperatorEnrollments: [f.operatorEnrollments[0]] }), /scanner_operator_enrollment_missing/);
});

test('tampered witness observation is rejected', () => {
  const f = fixture();
  const tampered = { ...f.observations[0], payload: { ...f.observations[0].payload, rootHash: sha256({ tamper: true }) } };
  assert.throws(() => f.evaluate({ witnessObservations: [tampered, f.observations[1]] }), /witness_observation_signature_invalid/);
});

test('tampered gossip receipt is rejected', () => {
  const f = fixture();
  const tampered = { ...f.gossip[0], payload: { ...f.gossip[0].payload, status: 'SPLIT_VIEW_DETECTED' as const } };
  assert.throws(() => f.evaluate({ gossipReceipts: [tampered, f.gossip[1]] }), /gossip_signature_invalid/);
});

test('verifier cannot overlap a trusted role', () => {
  const f = fixture();
  assert.throws(() => f.evaluate({ verifierIdentity: f.witnessA }), /external_witness_verifier_role_overlap/);
});

test('duplicate scanner operator IDs are rejected', () => {
  const f = fixture();
  const duplicate = createExternalScannerOperatorEnrollmentV33_27({ registrar: f.registrar, enrollmentClass: 'SYNTHETIC_REFERENCE', operatorId: f.operatorEnrollments[0].payload.operatorId, organizationId: 'scanner-org-b', hostId: 'scanner-host-b', engine: 'YARA', receiptSignerKeyId: f.scannerB.keyId, receiptSignerFingerprint: f.scannerRegistry.fingerprint(f.scannerB.keyId)!, enrolledAt: BEFORE, expiresAt: AFTER });
  assert.throws(() => f.evaluate({ scannerOperatorEnrollments: [f.operatorEnrollments[0], duplicate] }), /scanner_operator_duplicate/);
});

test('duplicate scanner signer enrollment is rejected', () => {
  const f = fixture();
  const duplicate = createExternalScannerOperatorEnrollmentV33_27({ registrar: f.registrar, enrollmentClass: 'SYNTHETIC_REFERENCE', operatorId: 'other', organizationId: 'scanner-org-b', hostId: 'scanner-host-b', engine: 'YARA', receiptSignerKeyId: f.scannerA.keyId, receiptSignerFingerprint: f.scannerRegistry.fingerprint(f.scannerA.keyId)!, enrolledAt: BEFORE, expiresAt: AFTER });
  assert.throws(() => f.evaluate({ scannerOperatorEnrollments: [f.operatorEnrollments[0], duplicate] }), /scanner_operator_signer_duplicate/);
});

test('duplicate witness IDs are rejected', () => {
  const f = fixture();
  const duplicate = createTransparencyWitnessEnrollmentV33_27({ registrar: f.registrar, enrollmentClass: 'SYNTHETIC_REFERENCE', witnessId: f.witnessEnrollments[0].payload.witnessId, organizationId: 'witness-org-b', hostId: 'witness-host-b', witnessSignerKeyId: f.witnessB.keyId, witnessSignerFingerprint: f.witnessRegistry.fingerprint(f.witnessB.keyId)!, enrolledAt: BEFORE, expiresAt: AFTER });
  assert.throws(() => f.evaluate({ witnessEnrollments: [f.witnessEnrollments[0], duplicate] }), /witness_duplicate/);
});

test('scanner and witness signer role overlap is rejected', () => {
  const f = fixture();
  const overlap = createTransparencyWitnessEnrollmentV33_27({ registrar: f.registrar, enrollmentClass: 'SYNTHETIC_REFERENCE', witnessId: 'witness-overlap', organizationId: 'witness-org-a', hostId: 'witness-host-a', witnessSignerKeyId: f.scannerA.keyId, witnessSignerFingerprint: f.scannerRegistry.fingerprint(f.scannerA.keyId)!, enrolledAt: BEFORE, expiresAt: AFTER });
  assert.throws(() => f.evaluate({ witnessEnrollments: [overlap, f.witnessEnrollments[1]] }), /scanner_witness_signer_role_overlap/);
});

test('different package digests cannot qualify', () => {
  const verdict = fixture({ scannerClass: 'LIVE_EXTERNAL', witnessClass: 'LIVE_EXTERNAL', secondPackageDigest: sha256({ other: 'package' }) }).evaluate();
  assert.equal(verdict.payload.status, 'REJECTED');
  assert.equal(verdict.payload.exactPackageAgreement, false);
});

test('different feed digests cannot qualify', () => {
  const verdict = fixture({ scannerClass: 'LIVE_EXTERNAL', witnessClass: 'LIVE_EXTERNAL', secondFeedDigest: sha256({ other: 'feed' }) }).evaluate();
  assert.equal(verdict.payload.status, 'REJECTED');
  assert.equal(verdict.payload.exactFeedAgreement, false);
});

test('scanner organizations must be distinct', () => {
  const verdict = fixture({ scannerClass: 'LIVE_EXTERNAL', witnessClass: 'LIVE_EXTERNAL', sameScannerOrganization: true }).evaluate();
  assert.equal(verdict.payload.status, 'REJECTED');
  assert.equal(verdict.payload.distinctScannerOrganizations, 1);
});

test('scanner hosts must be distinct', () => {
  const verdict = fixture({ scannerClass: 'LIVE_EXTERNAL', witnessClass: 'LIVE_EXTERNAL', sameScannerHost: true }).evaluate();
  assert.equal(verdict.payload.status, 'REJECTED');
  assert.equal(verdict.payload.distinctScannerHosts, 1);
});

test('witness organizations must be distinct', () => {
  const verdict = fixture({ scannerClass: 'LIVE_EXTERNAL', witnessClass: 'LIVE_EXTERNAL', sameWitnessOrganization: true }).evaluate();
  assert.equal(verdict.payload.status, 'REJECTED');
  assert.equal(verdict.payload.distinctWitnessOrganizations, 1);
});

test('witness hosts must be distinct', () => {
  const verdict = fixture({ scannerClass: 'LIVE_EXTERNAL', witnessClass: 'LIVE_EXTERNAL', sameWitnessHost: true }).evaluate();
  assert.equal(verdict.payload.status, 'REJECTED');
  assert.equal(verdict.payload.distinctWitnessHosts, 1);
});

test('missing gossip prevents qualification', () => {
  const f = fixture({ scannerClass: 'LIVE_EXTERNAL', witnessClass: 'LIVE_EXTERNAL' });
  const verdict = f.evaluate({ gossipReceipts: [] });
  assert.equal(verdict.payload.status, 'REJECTED');
  assert.equal(verdict.payload.crossGossipVerified, false);
});

test('expired challenge is rejected', () => {
  const f = fixture();
  const expired = createExternalWitnessScannerChallengeV33_27({ signer: f.challengeSigner, issuedAt: new Date(NOW.getTime() - 10_000), expiresAt: new Date(NOW.getTime() - 1) });
  assert.throws(() => f.evaluate({ challenge: expired }), /external_witness_challenge_expired/);
});

test('tampered challenge is rejected', () => {
  const f = fixture();
  const tampered = { ...f.challenge, payload: { ...f.challenge.payload, minimumWitnessHosts: 1 as 2 } };
  assert.throws(() => f.evaluate({ challenge: tampered }), /external_witness_challenge_signature_invalid/);
});

test('synthetic operator enrollment cannot make a live receipt count', () => {
  const f = fixture({ scannerClass: 'SYNTHETIC_REFERENCE', witnessClass: 'LIVE_EXTERNAL' });
  const liveBundles = [
    scannerBundle(f.scannerA, 'CLAMAV', 'scanner-org-a', 'scanner-host-a', 'LIVE_EXTERNAL_SCANNER_EVIDENCE', 'CLEAN', PACKAGE_DIGEST, FEED_DIGEST),
    scannerBundle(f.scannerB, 'YARA', 'scanner-org-b', 'scanner-host-b', 'LIVE_EXTERNAL_SCANNER_EVIDENCE', 'CLEAN', PACKAGE_DIGEST, FEED_DIGEST),
  ];
  const verdict = f.evaluate({ scannerBundles: liveBundles });
  assert.equal(verdict.payload.liveScannerReceiptCount, 0);
  assert.equal(verdict.payload.status, 'EXTERNAL_WITNESS_AND_SCANNER_OPERATOR_QUALIFICATION_REQUIRED');
});

test('synthetic witness enrollment cannot make an observation count as live', () => {
  const f = fixture({ scannerClass: 'LIVE_EXTERNAL', witnessClass: 'SYNTHETIC_REFERENCE' });
  const verdict = f.evaluate();
  assert.equal(verdict.payload.liveWitnessObservationCount, 0);
  assert.equal(verdict.payload.status, 'EXTERNAL_WITNESS_AND_SCANNER_OPERATOR_QUALIFICATION_REQUIRED');
});

test('expired scanner operator enrollment is rejected', () => {
  const f = fixture();
  const expired = createExternalScannerOperatorEnrollmentV33_27({ registrar: f.registrar, enrollmentClass: 'SYNTHETIC_REFERENCE', operatorId: 'operator-clamav', organizationId: 'scanner-org-a', hostId: 'scanner-host-a', engine: 'CLAMAV', receiptSignerKeyId: f.scannerA.keyId, receiptSignerFingerprint: f.scannerRegistry.fingerprint(f.scannerA.keyId)!, enrolledAt: new Date(NOW.getTime() - 20_000), expiresAt: new Date(NOW.getTime() - 1) });
  assert.throws(() => f.evaluate({ scannerOperatorEnrollments: [expired, f.operatorEnrollments[1]] }), /scanner_operator_enrollment_expired/);
});

test('expired witness enrollment is rejected', () => {
  const f = fixture();
  const expired = createTransparencyWitnessEnrollmentV33_27({ registrar: f.registrar, enrollmentClass: 'SYNTHETIC_REFERENCE', witnessId: 'witness-a', organizationId: 'witness-org-a', hostId: 'witness-host-a', witnessSignerKeyId: f.witnessA.keyId, witnessSignerFingerprint: f.witnessRegistry.fingerprint(f.witnessA.keyId)!, enrolledAt: new Date(NOW.getTime() - 20_000), expiresAt: new Date(NOW.getTime() - 1) });
  assert.throws(() => f.evaluate({ witnessEnrollments: [expired, f.witnessEnrollments[1]] }), /witness_enrollment_expired/);
});

test('verdict reports the canonical parameter state', () => {
  const verdict = fixture().evaluate();
  assert.equal(verdict.payload.parameterLedgerVerified, true);
  assert.equal(verdict.payload.preservedParameterCount, 8);
  assert.equal(verdict.payload.strengthenedParameterCount, 3);
  assert.equal(verdict.payload.externalEvidencePendingParameterCount, 3);
  assert.equal(verdict.payload.productionAuthority, 'NONE');
  assert.equal(verdict.payload.externalEffectsExecuted, 0);
});

test('resigned but internally inconsistent gossip is rejected', () => {
  const f = fixture();
  const inconsistent = resign(f.gossip[0], f.witnessA, (payload) => ({ ...payload, status: 'SPLIT_VIEW_DETECTED' as const }));
  assert.throws(() => f.evaluate({ gossipReceipts: [inconsistent, f.gossip[1]] }), /gossip_digest_invalid|gossip_status_invalid/);
});
