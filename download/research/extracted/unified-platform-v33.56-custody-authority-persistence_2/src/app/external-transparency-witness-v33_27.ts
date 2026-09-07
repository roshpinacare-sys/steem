import { randomUUID } from 'node:crypto';
import {
  KeyRegistry,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';
import {
  verifyExternalScannerBundleV33_26,
  verifyScannerTransparencyCheckpointV33_26,
  type ExternalScannerEvidenceBundleV33_26,
  type ExternalScannerEngineV33_26,
  type ScannerTransparencyCheckpointV33_26,
} from './scanner-evidence-transparency-v33_26.js';

export type ProgramParameterIdV33_27 =
  | 'CHAT_NATIVE_GOVERNED_ACTION'
  | 'ONE_CANONICAL_AUTHORITY'
  | 'NO_LEARNED_AUTHORITY_EXPANSION'
  | 'EXTERNAL_EFFECTS_EXPLICITLY_GATED'
  | 'SIGNED_BYTE_BOUND_EVIDENCE'
  | 'FAIL_CLOSED_ON_UNCERTAINTY'
  | 'RECOVERY_REVOCATION_FALLBACK'
  | 'UX_REDUCTION_AND_COMPREHENSION_TARGETS'
  | 'ENGINEERING_PRODUCT_PROOF_TARGETS'
  | 'CATEGORY_AND_BUYER_PROOF_TARGETS'
  | 'EXTERNAL_ROLE_HOST_ORG_SEPARATION'
  | 'RELEASE_REPRODUCIBILITY_AND_CLEAN_EXIT'
  | 'PROVIDER_NEUTRAL_SOVEREIGNTY'
  | 'LARGE_OUTCOME_VALUE_FILTER';

export type ProgramParameterStatusV33_27 =
  | 'PRESERVED'
  | 'STRENGTHENED'
  | 'EXTERNAL_EVIDENCE_PENDING';

export interface ProgramParameterV33_27 {
  readonly id: ProgramParameterIdV33_27;
  readonly category: 'PRODUCT' | 'AUTHORITY' | 'EVIDENCE' | 'UX' | 'MARKET' | 'QUALITY' | 'SOVEREIGNTY' | 'VALUE';
  readonly target: string;
  readonly status: ProgramParameterStatusV33_27;
  readonly evidenceRefs: readonly string[];
}

export interface SignedProgramParameterLedgerV33_27 {
  readonly version: '33.27';
  readonly ledgerId: string;
  readonly previousVersion: '33.26';
  readonly parameterCount: 14;
  readonly parameters: readonly ProgramParameterV33_27[];
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly ledgerDigest: string;
}

export type ExternalEnrollmentClassV33_27 = 'SYNTHETIC_REFERENCE' | 'LIVE_EXTERNAL';

export interface ExternalScannerOperatorEnrollmentV33_27 {
  readonly version: '33.27';
  readonly enrollmentId: string;
  readonly enrollmentClass: ExternalEnrollmentClassV33_27;
  readonly operatorId: string;
  readonly organizationId: string;
  readonly hostId: string;
  readonly engine: ExternalScannerEngineV33_26;
  readonly receiptSignerKeyId: string;
  readonly receiptSignerFingerprint: string;
  readonly enrolledAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly enrollmentDigest: string;
}

export interface TransparencyWitnessEnrollmentV33_27 {
  readonly version: '33.27';
  readonly enrollmentId: string;
  readonly enrollmentClass: ExternalEnrollmentClassV33_27;
  readonly witnessId: string;
  readonly organizationId: string;
  readonly hostId: string;
  readonly witnessSignerKeyId: string;
  readonly witnessSignerFingerprint: string;
  readonly enrolledAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly enrollmentDigest: string;
}

export interface TransparencyWitnessObservationV33_27 {
  readonly version: '33.27';
  readonly observationId: string;
  readonly witnessId: string;
  readonly witnessOrganizationId: string;
  readonly witnessHostId: string;
  readonly evidenceClass: ExternalEnrollmentClassV33_27;
  readonly logId: string;
  readonly treeSize: number;
  readonly rootHash: string;
  readonly checkpointDigest: string;
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly observationDigest: string;
}

export interface TransparencyWitnessGossipReceiptV33_27 {
  readonly version: '33.27';
  readonly gossipId: string;
  readonly senderWitnessId: string;
  readonly peerWitnessId: string;
  readonly senderObservationDigest: string;
  readonly peerObservationDigest: string;
  readonly logId: string;
  readonly treeSize: number;
  readonly status: 'CONSISTENT' | 'SPLIT_VIEW_DETECTED';
  readonly comparedRootHashes: readonly [string, string];
  readonly gossipedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly gossipDigest: string;
}

export interface ExternalWitnessScannerChallengeV33_27 {
  readonly version: '33.27';
  readonly challengeId: string;
  readonly requiredEngines: readonly ['CLAMAV', 'YARA'];
  readonly minimumScannerOrganizations: 2;
  readonly minimumScannerHosts: 2;
  readonly minimumWitnessOrganizations: 2;
  readonly minimumWitnessHosts: 2;
  readonly crossGossipRequired: true;
  readonly splitViewFailClosed: true;
  readonly syntheticEvidenceAccepted: false;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly challengeDigest: string;
}

export interface ExternalWitnessScannerQualificationVerdictV33_27 {
  readonly version: '33.27';
  readonly verdictId: string;
  readonly status:
    | 'EXTERNAL_WITNESS_AND_SCANNER_OPERATOR_QUALIFIED_FOR_PILOT'
    | 'EXTERNAL_WITNESS_AND_SCANNER_OPERATOR_QUALIFICATION_REQUIRED'
    | 'SPLIT_VIEW_DETECTED_QUARANTINE'
    | 'SCANNER_DISAGREEMENT_QUARANTINE'
    | 'REJECTED';
  readonly parameterLedgerVerified: boolean;
  readonly preservedParameterCount: number;
  readonly strengthenedParameterCount: number;
  readonly externalEvidencePendingParameterCount: number;
  readonly liveScannerReceiptCount: number;
  readonly syntheticScannerReceiptCount: number;
  readonly liveWitnessObservationCount: number;
  readonly syntheticWitnessObservationCount: number;
  readonly distinctScannerOrganizations: number;
  readonly distinctScannerHosts: number;
  readonly distinctWitnessOrganizations: number;
  readonly distinctWitnessHosts: number;
  readonly exactPackageAgreement: boolean;
  readonly exactFeedAgreement: boolean;
  readonly crossGossipVerified: boolean;
  readonly splitViewDetected: boolean;
  readonly scannerDisagreementDetected: boolean;
  readonly eligibleForProductionPromotion: false;
  readonly evaluatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

const DIGEST_RE = /^[0-9a-f]{64}$/;
const REQUIRED_PARAMETER_IDS: readonly ProgramParameterIdV33_27[] = [
  'CHAT_NATIVE_GOVERNED_ACTION',
  'ONE_CANONICAL_AUTHORITY',
  'NO_LEARNED_AUTHORITY_EXPANSION',
  'EXTERNAL_EFFECTS_EXPLICITLY_GATED',
  'SIGNED_BYTE_BOUND_EVIDENCE',
  'FAIL_CLOSED_ON_UNCERTAINTY',
  'RECOVERY_REVOCATION_FALLBACK',
  'UX_REDUCTION_AND_COMPREHENSION_TARGETS',
  'ENGINEERING_PRODUCT_PROOF_TARGETS',
  'CATEGORY_AND_BUYER_PROOF_TARGETS',
  'EXTERNAL_ROLE_HOST_ORG_SEPARATION',
  'RELEASE_REPRODUCIBILITY_AND_CLEAN_EXIT',
  'PROVIDER_NEUTRAL_SOVEREIGNTY',
  'LARGE_OUTCOME_VALUE_FILTER',
];

export function defaultProgramParametersV33_27(): readonly ProgramParameterV33_27[] {
  return [
    p('CHAT_NATIVE_GOVERNED_ACTION', 'PRODUCT', 'Chat or voice intent becomes a governed action rather than a dashboard-only workflow.', 'PRESERVED', ['src/product/chat-mission.ts']),
    p('ONE_CANONICAL_AUTHORITY', 'AUTHORITY', 'Exactly one canonical authority, policy and effect ledger; no competing production root.', 'PRESERVED', ['v33/governance-state/AUTHORITY_CONFLICT_MAP_V33.json']),
    p('NO_LEARNED_AUTHORITY_EXPANSION', 'AUTHORITY', 'Adaptive shortcuts may preserve or reduce scopes but never learn or enlarge authority.', 'PRESERVED', ['src/repository/proof-carrying-adaptive-execution-v33_15.ts']),
    p('EXTERNAL_EFFECTS_EXPLICITLY_GATED', 'AUTHORITY', 'External effects require explicit bound authority; current production effects remain blocked.', 'PRESERVED', ['v33/governance-state/PROOF_GATE_REGISTRY_V33.json']),
    p('SIGNED_BYTE_BOUND_EVIDENCE', 'EVIDENCE', 'Evidence is signed, digest-linked, bound to exact bytes and independently verifiable.', 'STRENGTHENED', ['src/app/scanner-evidence-transparency-v33_26.ts', 'src/app/external-transparency-witness-v33_27.ts']),
    p('FAIL_CLOSED_ON_UNCERTAINTY', 'EVIDENCE', 'Uncertainty, drift, expiry, disagreement, missing infrastructure or split-view fails closed.', 'STRENGTHENED', ['src/app/external-transparency-witness-v33_27.ts']),
    p('RECOVERY_REVOCATION_FALLBACK', 'EVIDENCE', 'Revocation, rollback or compensation and full-workflow fallback must remain provable.', 'PRESERVED', ['src/app/continuous-adaptive-control-service-v33_17.ts']),
    p('UX_REDUCTION_AND_COMPREHENSION_TARGETS', 'UX', 'At least 70% fewer user steps, median no more than one approval, approval understood in under 10 seconds.', 'EXTERNAL_EVIDENCE_PENDING', ['v33/governance-state/PROOF_GATE_REGISTRY_V33.json#G3']),
    p('ENGINEERING_PRODUCT_PROOF_TARGETS', 'QUALITY', 'Three repositories, thirty missions, zero unauthorized effects and 100% evidence closure.', 'EXTERNAL_EVIDENCE_PENDING', ['v33/governance-state/PROOF_GATE_REGISTRY_V33.json#G4']),
    p('CATEGORY_AND_BUYER_PROOF_TARGETS', 'MARKET', 'Fifteen interviews, five urgent funded confirmations, three design partners and two paid pilots.', 'EXTERNAL_EVIDENCE_PENDING', ['v33/governance-state/PROOF_GATE_REGISTRY_V33.json#G2']),
    p('EXTERNAL_ROLE_HOST_ORG_SEPARATION', 'EVIDENCE', 'Collector, operator, verifier and witnesses must be separated across required keys, hosts and organizations.', 'STRENGTHENED', ['src/app/external-transparency-witness-v33_27.ts']),
    p('RELEASE_REPRODUCIBILITY_AND_CLEAN_EXIT', 'QUALITY', 'All discovered tests pass with exit zero, no retry, no force-exit and a clean ZIP extraction validation.', 'PRESERVED', ['scripts/validate-v33_27.py']),
    p('PROVIDER_NEUTRAL_SOVEREIGNTY', 'SOVEREIGNTY', 'Provider-neutral sovereign contracts; missing external services remain UNAVAILABLE_FAIL_CLOSED.', 'PRESERVED', ['MASTER_DIRECTIVE.md']),
    p('LARGE_OUTCOME_VALUE_FILTER', 'VALUE', 'Each release must improve the path toward a high-value category product rather than merely increase code volume.', 'PRESERVED', ['v33/governance-state/VALUE_HYPOTHESIS_REGISTRY_V33.json']),
  ];
}

export function createSignedProgramParameterLedgerV33_27(input: {
  readonly signer: SigningIdentity;
  readonly parameters?: readonly ProgramParameterV33_27[];
  readonly generatedAt?: Date;
  readonly ledgerId?: string;
}): SignedEnvelope<SignedProgramParameterLedgerV33_27> {
  const parameters = [...(input.parameters ?? defaultProgramParametersV33_27())];
  validateParameters(parameters);
  const material = {
    version: '33.27' as const,
    ledgerId: nonEmpty(input.ledgerId ?? 'canonical-program-parameter-ledger-v33.27', 'parameter_ledger_id_required'),
    previousVersion: '33.26' as const,
    parameterCount: 14 as const,
    parameters,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, ledgerDigest: sha256(material) }, input.signer);
}

export function verifySignedProgramParameterLedgerV33_27(
  ledger: SignedEnvelope<SignedProgramParameterLedgerV33_27>,
  registry: KeyRegistry,
  trustedSignerIds: readonly string[],
  now: Date = new Date(),
): void {
  if (!trustedSignerIds.includes(ledger.issuerKeyId) || !registry.verifyAt(ledger, now)) throw new Error('parameter_ledger_signature_invalid');
  if (!digestFieldValid(ledger.payload, 'ledgerDigest')) throw new Error('parameter_ledger_digest_invalid');
  if (ledger.payload.version !== '33.27' || ledger.payload.previousVersion !== '33.26' || ledger.payload.parameterCount !== 14) throw new Error('parameter_ledger_version_invalid');
  if (Date.parse(ledger.payload.generatedAt) > now.getTime()) throw new Error('parameter_ledger_time_invalid');
  if (ledger.payload.productionAuthority !== 'NONE' || ledger.payload.externalEffectsExecuted !== 0) throw new Error('parameter_ledger_boundary_invalid');
  validateParameters(ledger.payload.parameters);
}

export function createExternalScannerOperatorEnrollmentV33_27(input: {
  readonly registrar: SigningIdentity;
  readonly enrollmentClass: ExternalEnrollmentClassV33_27;
  readonly operatorId: string;
  readonly organizationId: string;
  readonly hostId: string;
  readonly engine: ExternalScannerEngineV33_26;
  readonly receiptSignerKeyId: string;
  readonly receiptSignerFingerprint: string;
  readonly enrolledAt?: Date;
  readonly expiresAt?: Date;
  readonly enrollmentId?: string;
}): SignedEnvelope<ExternalScannerOperatorEnrollmentV33_27> {
  const enrolledAt = input.enrolledAt ?? new Date();
  const expiresAt = input.expiresAt ?? new Date(enrolledAt.getTime() + 30 * 24 * 60 * 60_000);
  requireTimeWindow(enrolledAt, expiresAt, 'scanner_operator_enrollment_time_invalid');
  requireDigest(input.receiptSignerFingerprint, 'scanner_operator_fingerprint_invalid');
  const material = {
    version: '33.27' as const,
    enrollmentId: nonEmpty(input.enrollmentId ?? randomUUID(), 'scanner_operator_enrollment_id_required'),
    enrollmentClass: input.enrollmentClass,
    operatorId: nonEmpty(input.operatorId, 'scanner_operator_id_required'),
    organizationId: nonEmpty(input.organizationId, 'scanner_operator_organization_required'),
    hostId: nonEmpty(input.hostId, 'scanner_operator_host_required'),
    engine: input.engine,
    receiptSignerKeyId: nonEmpty(input.receiptSignerKeyId, 'scanner_operator_signer_required'),
    receiptSignerFingerprint: input.receiptSignerFingerprint,
    enrolledAt: enrolledAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, enrollmentDigest: sha256(material) }, input.registrar);
}

export function createTransparencyWitnessEnrollmentV33_27(input: {
  readonly registrar: SigningIdentity;
  readonly enrollmentClass: ExternalEnrollmentClassV33_27;
  readonly witnessId: string;
  readonly organizationId: string;
  readonly hostId: string;
  readonly witnessSignerKeyId: string;
  readonly witnessSignerFingerprint: string;
  readonly enrolledAt?: Date;
  readonly expiresAt?: Date;
  readonly enrollmentId?: string;
}): SignedEnvelope<TransparencyWitnessEnrollmentV33_27> {
  const enrolledAt = input.enrolledAt ?? new Date();
  const expiresAt = input.expiresAt ?? new Date(enrolledAt.getTime() + 30 * 24 * 60 * 60_000);
  requireTimeWindow(enrolledAt, expiresAt, 'witness_enrollment_time_invalid');
  requireDigest(input.witnessSignerFingerprint, 'witness_fingerprint_invalid');
  const material = {
    version: '33.27' as const,
    enrollmentId: nonEmpty(input.enrollmentId ?? randomUUID(), 'witness_enrollment_id_required'),
    enrollmentClass: input.enrollmentClass,
    witnessId: nonEmpty(input.witnessId, 'witness_id_required'),
    organizationId: nonEmpty(input.organizationId, 'witness_organization_required'),
    hostId: nonEmpty(input.hostId, 'witness_host_required'),
    witnessSignerKeyId: nonEmpty(input.witnessSignerKeyId, 'witness_signer_required'),
    witnessSignerFingerprint: input.witnessSignerFingerprint,
    enrolledAt: enrolledAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, enrollmentDigest: sha256(material) }, input.registrar);
}

export function createTransparencyWitnessObservationV33_27(input: {
  readonly witnessSigner: SigningIdentity;
  readonly enrollment: SignedEnvelope<TransparencyWitnessEnrollmentV33_27>;
  readonly registrarRegistry: KeyRegistry;
  readonly trustedRegistrarSignerIds: readonly string[];
  readonly checkpoint: SignedEnvelope<ScannerTransparencyCheckpointV33_26>;
  readonly checkpointRegistry: KeyRegistry;
  readonly trustedCheckpointSignerIds: readonly string[];
  readonly observedAt?: Date;
  readonly observationId?: string;
}): SignedEnvelope<TransparencyWitnessObservationV33_27> {
  const now = input.observedAt ?? new Date();
  verifyWitnessEnrollment(input.enrollment, input.registrarRegistry, input.trustedRegistrarSignerIds, now);
  if (input.witnessSigner.keyId !== input.enrollment.payload.witnessSignerKeyId) throw new Error('witness_signer_binding_invalid');
  verifyScannerTransparencyCheckpointV33_26(input.checkpoint, input.checkpointRegistry, input.trustedCheckpointSignerIds, now);
  const material = {
    version: '33.27' as const,
    observationId: nonEmpty(input.observationId ?? randomUUID(), 'witness_observation_id_required'),
    witnessId: input.enrollment.payload.witnessId,
    witnessOrganizationId: input.enrollment.payload.organizationId,
    witnessHostId: input.enrollment.payload.hostId,
    evidenceClass: input.enrollment.payload.enrollmentClass,
    logId: input.checkpoint.payload.logId,
    treeSize: input.checkpoint.payload.treeSize,
    rootHash: input.checkpoint.payload.rootHash,
    checkpointDigest: input.checkpoint.payload.checkpointDigest,
    observedAt: now.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, observationDigest: sha256(material) }, input.witnessSigner);
}

export function createTransparencyWitnessGossipReceiptV33_27(input: {
  readonly senderWitnessSigner: SigningIdentity;
  readonly senderObservation: SignedEnvelope<TransparencyWitnessObservationV33_27>;
  readonly peerObservation: SignedEnvelope<TransparencyWitnessObservationV33_27>;
  readonly witnessRegistry: KeyRegistry;
  readonly trustedWitnessSignerIds: readonly string[];
  readonly now?: Date;
  readonly gossipId?: string;
}): SignedEnvelope<TransparencyWitnessGossipReceiptV33_27> {
  const now = input.now ?? new Date();
  verifyWitnessObservation(input.senderObservation, input.witnessRegistry, input.trustedWitnessSignerIds, now);
  verifyWitnessObservation(input.peerObservation, input.witnessRegistry, input.trustedWitnessSignerIds, now);
  if (input.senderWitnessSigner.keyId !== input.senderObservation.issuerKeyId) throw new Error('gossip_sender_signer_invalid');
  if (input.senderObservation.payload.witnessId === input.peerObservation.payload.witnessId) throw new Error('gossip_distinct_witnesses_required');
  if (input.senderObservation.payload.logId !== input.peerObservation.payload.logId || input.senderObservation.payload.treeSize !== input.peerObservation.payload.treeSize) {
    throw new Error('gossip_checkpoint_coordinates_mismatch');
  }
  const roots: readonly [string, string] = [input.senderObservation.payload.rootHash, input.peerObservation.payload.rootHash];
  const material = {
    version: '33.27' as const,
    gossipId: nonEmpty(input.gossipId ?? randomUUID(), 'gossip_id_required'),
    senderWitnessId: input.senderObservation.payload.witnessId,
    peerWitnessId: input.peerObservation.payload.witnessId,
    senderObservationDigest: input.senderObservation.payload.observationDigest,
    peerObservationDigest: input.peerObservation.payload.observationDigest,
    logId: input.senderObservation.payload.logId,
    treeSize: input.senderObservation.payload.treeSize,
    status: roots[0] === roots[1] ? 'CONSISTENT' as const : 'SPLIT_VIEW_DETECTED' as const,
    comparedRootHashes: roots,
    gossipedAt: now.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, gossipDigest: sha256(material) }, input.senderWitnessSigner);
}

export function createExternalWitnessScannerChallengeV33_27(input: {
  readonly signer: SigningIdentity;
  readonly issuedAt?: Date;
  readonly expiresAt?: Date;
  readonly challengeId?: string;
}): SignedEnvelope<ExternalWitnessScannerChallengeV33_27> {
  const issuedAt = input.issuedAt ?? new Date();
  const expiresAt = input.expiresAt ?? new Date(issuedAt.getTime() + 30 * 24 * 60 * 60_000);
  requireTimeWindow(issuedAt, expiresAt, 'external_witness_challenge_time_invalid');
  const material = {
    version: '33.27' as const,
    challengeId: nonEmpty(input.challengeId ?? 'external-transparency-witness-v33.27', 'external_witness_challenge_id_required'),
    requiredEngines: ['CLAMAV', 'YARA'] as const,
    minimumScannerOrganizations: 2 as const,
    minimumScannerHosts: 2 as const,
    minimumWitnessOrganizations: 2 as const,
    minimumWitnessHosts: 2 as const,
    crossGossipRequired: true as const,
    splitViewFailClosed: true as const,
    syntheticEvidenceAccepted: false as const,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, challengeDigest: sha256(material) }, input.signer);
}

export function evaluateExternalWitnessScannerQualificationV33_27(input: {
  readonly parameterLedger: SignedEnvelope<SignedProgramParameterLedgerV33_27>;
  readonly parameterLedgerRegistry: KeyRegistry;
  readonly trustedParameterLedgerSignerIds: readonly string[];
  readonly challenge: SignedEnvelope<ExternalWitnessScannerChallengeV33_27>;
  readonly challengeRegistry: KeyRegistry;
  readonly trustedChallengeSignerIds: readonly string[];
  readonly scannerOperatorEnrollments: readonly SignedEnvelope<ExternalScannerOperatorEnrollmentV33_27>[];
  readonly witnessEnrollments: readonly SignedEnvelope<TransparencyWitnessEnrollmentV33_27>[];
  readonly registrarRegistry: KeyRegistry;
  readonly trustedRegistrarSignerIds: readonly string[];
  readonly scannerBundles: readonly ExternalScannerEvidenceBundleV33_26[];
  readonly scannerRegistry: KeyRegistry;
  readonly trustedScannerSignerIds: readonly string[];
  readonly witnessObservations: readonly SignedEnvelope<TransparencyWitnessObservationV33_27>[];
  readonly gossipReceipts: readonly SignedEnvelope<TransparencyWitnessGossipReceiptV33_27>[];
  readonly witnessRegistry: KeyRegistry;
  readonly trustedWitnessSignerIds: readonly string[];
  readonly verifierIdentity: SigningIdentity;
  readonly now?: Date;
}): SignedEnvelope<ExternalWitnessScannerQualificationVerdictV33_27> {
  const now = input.now ?? new Date();
  verifySignedProgramParameterLedgerV33_27(input.parameterLedger, input.parameterLedgerRegistry, input.trustedParameterLedgerSignerIds, now);
  verifyExternalWitnessChallenge(input.challenge, input.challengeRegistry, input.trustedChallengeSignerIds, now);
  if ([...input.trustedParameterLedgerSignerIds, ...input.trustedChallengeSignerIds, ...input.trustedRegistrarSignerIds, ...input.trustedScannerSignerIds, ...input.trustedWitnessSignerIds].includes(input.verifierIdentity.keyId)) {
    throw new Error('external_witness_verifier_role_overlap');
  }
  const operatorEnrollments = input.scannerOperatorEnrollments.map((enrollment) => {
    verifyScannerOperatorEnrollment(enrollment, input.registrarRegistry, input.trustedRegistrarSignerIds, now);
    return enrollment.payload;
  });
  const witnessEnrollments = input.witnessEnrollments.map((enrollment) => {
    verifyWitnessEnrollment(enrollment, input.registrarRegistry, input.trustedRegistrarSignerIds, now);
    return enrollment.payload;
  });
  uniqueBy(operatorEnrollments, (item) => item.operatorId, 'scanner_operator_duplicate');
  uniqueBy(operatorEnrollments, (item) => item.receiptSignerKeyId, 'scanner_operator_signer_duplicate');
  uniqueBy(witnessEnrollments, (item) => item.witnessId, 'witness_duplicate');
  uniqueBy(witnessEnrollments, (item) => item.witnessSignerKeyId, 'witness_signer_duplicate');
  if (new Set([...operatorEnrollments.map((item) => item.receiptSignerKeyId), ...witnessEnrollments.map((item) => item.witnessSignerKeyId)]).size !== operatorEnrollments.length + witnessEnrollments.length) {
    throw new Error('scanner_witness_signer_role_overlap');
  }

  const receipts = input.scannerBundles.map((bundle) => {
    verifyExternalScannerBundleV33_26(bundle, input.scannerRegistry, input.trustedScannerSignerIds, now);
    const enrollment = operatorEnrollments.find((item) => item.receiptSignerKeyId === bundle.receipt.issuerKeyId);
    if (enrollment === undefined) throw new Error('scanner_operator_enrollment_missing');
    const receipt = bundle.receipt.payload;
    if (enrollment.engine !== receipt.engine || enrollment.organizationId !== receipt.scannerOrganizationId || enrollment.hostId !== receipt.scannerHostId) {
      throw new Error('scanner_operator_receipt_binding_invalid');
    }
    return { receipt, enrollment };
  });

  const observations = input.witnessObservations.map((observation) => {
    verifyWitnessObservation(observation, input.witnessRegistry, input.trustedWitnessSignerIds, now);
    const enrollment = witnessEnrollments.find((item) => item.witnessSignerKeyId === observation.issuerKeyId);
    if (enrollment === undefined) throw new Error('witness_enrollment_missing');
    if (enrollment.witnessId !== observation.payload.witnessId || enrollment.organizationId !== observation.payload.witnessOrganizationId || enrollment.hostId !== observation.payload.witnessHostId || enrollment.enrollmentClass !== observation.payload.evidenceClass) {
      throw new Error('witness_observation_binding_invalid');
    }
    return { observation: observation.payload, enrollment };
  });

  const gossip = input.gossipReceipts.map((receipt) => {
    verifyGossipReceipt(receipt, input.witnessRegistry, input.trustedWitnessSignerIds, now);
    if (!observations.some((item) => item.observation.observationDigest === receipt.payload.senderObservationDigest)
      || !observations.some((item) => item.observation.observationDigest === receipt.payload.peerObservationDigest)) {
      throw new Error('gossip_observation_missing');
    }
    return receipt.payload;
  });

  const liveReceipts = receipts.filter(({ receipt, enrollment }) => receipt.evidenceClass === 'LIVE_EXTERNAL_SCANNER_EVIDENCE' && enrollment.enrollmentClass === 'LIVE_EXTERNAL');
  const liveObservations = observations.filter(({ observation, enrollment }) => observation.evidenceClass === 'LIVE_EXTERNAL' && enrollment.enrollmentClass === 'LIVE_EXTERNAL');
  const splitViewDetected = gossip.some((item) => item.status === 'SPLIT_VIEW_DETECTED') || hasSplitView(observations.map((item) => item.observation));
  const scannerDisagreementDetected = liveReceipts.length >= 2 && new Set(liveReceipts.map(({ receipt }) => receipt.result)).size > 1;
  const exactPackageAgreement = liveReceipts.length >= 2 && new Set(liveReceipts.map(({ receipt }) => `${receipt.packageId}:${receipt.packageDigest}`)).size === 1;
  const exactFeedAgreement = liveReceipts.length >= 2 && new Set(liveReceipts.map(({ receipt }) => receipt.signatureFeedDigest)).size === 1;
  const crossGossipVerified = liveObservations.length >= 2
    && gossip.filter((item) => item.status === 'CONSISTENT').some((item) => item.senderWitnessId !== item.peerWitnessId)
    && new Set(liveObservations.map(({ observation }) => observation.rootHash)).size === 1;
  const distinctScannerOrganizations = new Set(liveReceipts.map(({ enrollment }) => enrollment.organizationId)).size;
  const distinctScannerHosts = new Set(liveReceipts.map(({ enrollment }) => enrollment.hostId)).size;
  const distinctWitnessOrganizations = new Set(liveObservations.map(({ enrollment }) => enrollment.organizationId)).size;
  const distinctWitnessHosts = new Set(liveObservations.map(({ enrollment }) => enrollment.hostId)).size;
  const structurallyQualified = liveReceipts.length >= 2
    && new Set(liveReceipts.map(({ receipt }) => receipt.engine)).size === 2
    && distinctScannerOrganizations >= input.challenge.payload.minimumScannerOrganizations
    && distinctScannerHosts >= input.challenge.payload.minimumScannerHosts
    && liveObservations.length >= 2
    && distinctWitnessOrganizations >= input.challenge.payload.minimumWitnessOrganizations
    && distinctWitnessHosts >= input.challenge.payload.minimumWitnessHosts
    && exactPackageAgreement
    && exactFeedAgreement
    && crossGossipVerified
    && !splitViewDetected
    && !scannerDisagreementDetected
    && liveReceipts.every(({ receipt }) => receipt.result === 'CLEAN');

  let status: ExternalWitnessScannerQualificationVerdictV33_27['status'];
  if (splitViewDetected) status = 'SPLIT_VIEW_DETECTED_QUARANTINE';
  else if (scannerDisagreementDetected) status = 'SCANNER_DISAGREEMENT_QUARANTINE';
  else if (structurallyQualified) status = 'EXTERNAL_WITNESS_AND_SCANNER_OPERATOR_QUALIFIED_FOR_PILOT';
  else if (liveReceipts.length < 2 || liveObservations.length < 2) status = 'EXTERNAL_WITNESS_AND_SCANNER_OPERATOR_QUALIFICATION_REQUIRED';
  else status = 'REJECTED';

  const parameterStatuses = input.parameterLedger.payload.parameters.map((item) => item.status);
  const material = {
    version: '33.27' as const,
    verdictId: randomUUID(),
    status,
    parameterLedgerVerified: true as const,
    preservedParameterCount: parameterStatuses.filter((item) => item === 'PRESERVED').length,
    strengthenedParameterCount: parameterStatuses.filter((item) => item === 'STRENGTHENED').length,
    externalEvidencePendingParameterCount: parameterStatuses.filter((item) => item === 'EXTERNAL_EVIDENCE_PENDING').length,
    liveScannerReceiptCount: liveReceipts.length,
    syntheticScannerReceiptCount: receipts.length - liveReceipts.length,
    liveWitnessObservationCount: liveObservations.length,
    syntheticWitnessObservationCount: observations.length - liveObservations.length,
    distinctScannerOrganizations,
    distinctScannerHosts,
    distinctWitnessOrganizations,
    distinctWitnessHosts,
    exactPackageAgreement,
    exactFeedAgreement,
    crossGossipVerified,
    splitViewDetected,
    scannerDisagreementDetected,
    eligibleForProductionPromotion: false as const,
    evaluatedAt: now.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, verdictDigest: sha256(material) }, input.verifierIdentity);
}

function verifyScannerOperatorEnrollment(
  enrollment: SignedEnvelope<ExternalScannerOperatorEnrollmentV33_27>,
  registry: KeyRegistry,
  trustedRegistrarSignerIds: readonly string[],
  now: Date,
): void {
  if (!trustedRegistrarSignerIds.includes(enrollment.issuerKeyId) || !registry.verifyAt(enrollment, now)) throw new Error('scanner_operator_enrollment_signature_invalid');
  if (!digestFieldValid(enrollment.payload, 'enrollmentDigest')) throw new Error('scanner_operator_enrollment_digest_invalid');
  requireDigest(enrollment.payload.receiptSignerFingerprint, 'scanner_operator_fingerprint_invalid');
  requireEnrollmentActive(enrollment.payload.enrolledAt, enrollment.payload.expiresAt, now, 'scanner_operator_enrollment_expired');
  if (enrollment.payload.productionAuthority !== 'NONE' || enrollment.payload.externalEffectsExecuted !== 0) throw new Error('scanner_operator_enrollment_boundary_invalid');
}

function verifyWitnessEnrollment(
  enrollment: SignedEnvelope<TransparencyWitnessEnrollmentV33_27>,
  registry: KeyRegistry,
  trustedRegistrarSignerIds: readonly string[],
  now: Date,
): void {
  if (!trustedRegistrarSignerIds.includes(enrollment.issuerKeyId) || !registry.verifyAt(enrollment, now)) throw new Error('witness_enrollment_signature_invalid');
  if (!digestFieldValid(enrollment.payload, 'enrollmentDigest')) throw new Error('witness_enrollment_digest_invalid');
  requireDigest(enrollment.payload.witnessSignerFingerprint, 'witness_fingerprint_invalid');
  requireEnrollmentActive(enrollment.payload.enrolledAt, enrollment.payload.expiresAt, now, 'witness_enrollment_expired');
  if (enrollment.payload.productionAuthority !== 'NONE' || enrollment.payload.externalEffectsExecuted !== 0) throw new Error('witness_enrollment_boundary_invalid');
}

function verifyWitnessObservation(
  observation: SignedEnvelope<TransparencyWitnessObservationV33_27>,
  registry: KeyRegistry,
  trustedSignerIds: readonly string[],
  now: Date,
): void {
  if (!trustedSignerIds.includes(observation.issuerKeyId) || !registry.verifyAt(observation, now)) throw new Error('witness_observation_signature_invalid');
  if (!digestFieldValid(observation.payload, 'observationDigest')) throw new Error('witness_observation_digest_invalid');
  requireDigest(observation.payload.rootHash, 'witness_root_hash_invalid');
  requireDigest(observation.payload.checkpointDigest, 'witness_checkpoint_digest_invalid');
  if (!Number.isSafeInteger(observation.payload.treeSize) || observation.payload.treeSize < 1) throw new Error('witness_tree_size_invalid');
  if (Date.parse(observation.payload.observedAt) > now.getTime()) throw new Error('witness_observation_time_invalid');
  if (observation.payload.productionAuthority !== 'NONE' || observation.payload.externalEffectsExecuted !== 0) throw new Error('witness_observation_boundary_invalid');
}

function verifyGossipReceipt(
  receipt: SignedEnvelope<TransparencyWitnessGossipReceiptV33_27>,
  registry: KeyRegistry,
  trustedSignerIds: readonly string[],
  now: Date,
): void {
  if (!trustedSignerIds.includes(receipt.issuerKeyId) || !registry.verifyAt(receipt, now)) throw new Error('gossip_signature_invalid');
  if (!digestFieldValid(receipt.payload, 'gossipDigest')) throw new Error('gossip_digest_invalid');
  if (receipt.payload.senderWitnessId === receipt.payload.peerWitnessId) throw new Error('gossip_distinct_witnesses_required');
  if (!receipt.payload.comparedRootHashes.every((item) => DIGEST_RE.test(item))) throw new Error('gossip_root_hash_invalid');
  const expectedStatus = receipt.payload.comparedRootHashes[0] === receipt.payload.comparedRootHashes[1] ? 'CONSISTENT' : 'SPLIT_VIEW_DETECTED';
  if (receipt.payload.status !== expectedStatus) throw new Error('gossip_status_invalid');
  if (Date.parse(receipt.payload.gossipedAt) > now.getTime()) throw new Error('gossip_time_invalid');
  if (receipt.payload.productionAuthority !== 'NONE' || receipt.payload.externalEffectsExecuted !== 0) throw new Error('gossip_boundary_invalid');
}

function verifyExternalWitnessChallenge(
  challenge: SignedEnvelope<ExternalWitnessScannerChallengeV33_27>,
  registry: KeyRegistry,
  trustedSignerIds: readonly string[],
  now: Date,
): void {
  if (!trustedSignerIds.includes(challenge.issuerKeyId) || !registry.verifyAt(challenge, now)) throw new Error('external_witness_challenge_signature_invalid');
  if (!digestFieldValid(challenge.payload, 'challengeDigest')) throw new Error('external_witness_challenge_digest_invalid');
  if (Date.parse(challenge.payload.issuedAt) > now.getTime() || Date.parse(challenge.payload.expiresAt) <= now.getTime()) throw new Error('external_witness_challenge_expired');
  if (challenge.payload.syntheticEvidenceAccepted !== false || challenge.payload.splitViewFailClosed !== true || challenge.payload.productionAuthority !== 'NONE') throw new Error('external_witness_challenge_boundary_invalid');
}

function hasSplitView(observations: readonly TransparencyWitnessObservationV33_27[]): boolean {
  const rootsByCoordinate = new Map<string, Set<string>>();
  for (const observation of observations) {
    const key = `${observation.logId}:${observation.treeSize}`;
    const roots = rootsByCoordinate.get(key) ?? new Set<string>();
    roots.add(observation.rootHash);
    rootsByCoordinate.set(key, roots);
  }
  return [...rootsByCoordinate.values()].some((roots) => roots.size > 1);
}

function validateParameters(parameters: readonly ProgramParameterV33_27[]): void {
  if (parameters.length !== 14) throw new Error('parameter_ledger_count_invalid');
  const ids = parameters.map((item) => item.id);
  if (new Set(ids).size !== ids.length || REQUIRED_PARAMETER_IDS.some((id) => !ids.includes(id))) throw new Error('parameter_ledger_required_parameter_missing');
  for (const parameter of parameters) {
    nonEmpty(parameter.target, 'parameter_target_required');
    if (parameter.evidenceRefs.length === 0 || parameter.evidenceRefs.some((item) => item.trim() === '')) throw new Error('parameter_evidence_refs_required');
  }
  const externalPending = new Set(parameters.filter((item) => item.status === 'EXTERNAL_EVIDENCE_PENDING').map((item) => item.id));
  for (const required of ['UX_REDUCTION_AND_COMPREHENSION_TARGETS', 'ENGINEERING_PRODUCT_PROOF_TARGETS', 'CATEGORY_AND_BUYER_PROOF_TARGETS'] as const) {
    if (!externalPending.has(required)) throw new Error('external_parameter_prematurely_closed');
  }
}

function p(
  id: ProgramParameterIdV33_27,
  category: ProgramParameterV33_27['category'],
  target: string,
  status: ProgramParameterStatusV33_27,
  evidenceRefs: readonly string[],
): ProgramParameterV33_27 { return { id, category, target, status, evidenceRefs }; }

function digestFieldValid(payload: object, field: string): boolean {
  const record = payload as Record<string, unknown>;
  const digest = record[field];
  if (typeof digest !== 'string' || !DIGEST_RE.test(digest)) return false;
  const material = { ...record };
  delete material[field];
  return sha256(material) === digest;
}
function requireDigest(value: string, error: string): void { if (!DIGEST_RE.test(value)) throw new Error(error); }
function nonEmpty(value: string, error: string): string { const trimmed = value.trim(); if (trimmed === '') throw new Error(error); return trimmed; }
function requireTimeWindow(start: Date, end: Date, error: string): void { if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end.getTime() <= start.getTime()) throw new Error(error); }
function requireEnrollmentActive(start: string, end: string, now: Date, error: string): void { const s = Date.parse(start); const e = Date.parse(end); if (!Number.isFinite(s) || !Number.isFinite(e) || s > now.getTime() || e <= now.getTime()) throw new Error(error); }
function uniqueBy<T>(items: readonly T[], selector: (item: T) => string, error: string): void { const values = items.map(selector); if (new Set(values).size !== values.length) throw new Error(error); }
