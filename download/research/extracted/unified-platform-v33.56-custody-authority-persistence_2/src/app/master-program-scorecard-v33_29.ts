import { randomUUID } from 'node:crypto';
import {
  KeyRegistry,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';

export type MasterMetricLayerV33_29 =
  | 'CORE_AXIS'
  | 'COMPLEMENTARY_METRIC'
  | 'PROOF_GATE'
  | 'VALUE_HYPOTHESIS'
  | 'PROGRAM_PARAMETER';

export type LocalMaturityV33_29 = 'STRONG' | 'PARTIAL' | 'WEAK' | 'NOT_APPLICABLE';
export type ExternalMaturityV33_29 =
  | 'PASSED'
  | 'PARTIAL'
  | 'PENDING'
  | 'BLOCKED'
  | 'NOT_STARTED'
  | 'NOT_APPLICABLE';

export interface MasterMetricV33_29 {
  readonly id: string;
  readonly layer: MasterMetricLayerV33_29;
  readonly title: string;
  readonly localMaturity: LocalMaturityV33_29;
  readonly externalMaturity: ExternalMaturityV33_29;
  readonly historicalNumericBaseline?: {
    readonly version: string;
    readonly projectScore: number;
    readonly confidenceAdjustedProjectScore?: number;
  };
  readonly currentNumericScoreAvailable: false;
  readonly evidenceRefs: readonly string[];
  readonly blockers: readonly string[];
  readonly nextProof: string;
}

export interface ProgramParameterV33_29 {
  readonly id: string;
  readonly category: string;
  readonly target: string;
  readonly status: 'PRESERVED' | 'STRENGTHENED' | 'EXTERNAL_EVIDENCE_PENDING';
  readonly evidenceRefs: readonly string[];
}

export interface ProgramParameterLedgerV33_29 {
  readonly version: '33.29';
  readonly ledgerId: string;
  readonly previousVersion: '33.28';
  readonly previousLedgerDigest: string;
  readonly parameterCount: 14;
  readonly parameters: readonly ProgramParameterV33_29[];
  readonly preservedParameterCount: number;
  readonly strengthenedParameterCount: number;
  readonly externalEvidencePendingParameterCount: number;
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly ledgerDigest: string;
}

export interface ReleaseFactsV33_29 {
  readonly tests: { readonly files: number; readonly total: number; readonly passed: number; readonly failed: 0 };
  readonly directV33: { readonly files: number; readonly total: number; readonly passed: number; readonly failed: 0 };
  readonly architecture: {
    readonly sourceModules: number;
    readonly testFiles: number;
    readonly capabilityPaths: number;
    readonly closedCapabilityPaths: number;
    readonly sourceCycles: 0;
    readonly untestedSources: 0;
    readonly truthFindings: 0;
  };
  readonly releaseExitCode: 0;
  readonly retryUsed: false;
  readonly forceExitUsed: false;
  readonly cleanExtractionValidated: true;
}

export interface ExternalProgressV33_29 {
  readonly buyerInterviews: number;
  readonly urgentFundedConfirmations: number;
  readonly designPartners: number;
  readonly paidPilots: number;
  readonly humanPilotParticipants: number;
  readonly qualifiedRepositories: number;
  readonly qualifiedMissions: number;
  readonly liveExternalWitnesses: number;
  readonly liveExternalScannerReceipts: number;
  readonly livePostgresBackends: number;
  readonly annualRecurringRevenueUsd: number;
}

export interface MasterProgramScorecardV33_29 {
  readonly version: '33.29';
  readonly scorecardId: string;
  readonly generatedAt: string;
  readonly metricCount: 54;
  readonly layerCounts: {
    readonly coreAxes: 14;
    readonly complementaryMetrics: 8;
    readonly proofGates: 9;
    readonly valueHypotheses: 9;
    readonly programParameters: 14;
  };
  readonly metrics: readonly MasterMetricV33_29[];
  readonly releaseFacts: ReleaseFactsV33_29;
  readonly externalProgress: ExternalProgressV33_29;
  readonly normalizedStatus: {
    readonly localStrong: number;
    readonly localPartial: number;
    readonly localWeak: number;
    readonly externalPassed: number;
    readonly externalPartial: number;
    readonly externalPendingOrBlocked: number;
    readonly notStarted: number;
  };
  readonly proofGateStatus: { readonly passed: 2; readonly inProgress: 5; readonly notStarted: 2 };
  readonly valueHypothesisStatus: { readonly proven: 0; readonly partialLocal: 5; readonly unproven: 4 };
  readonly parameterStatus: { readonly preserved: 8; readonly strengthened: 3; readonly externalPending: 3 };
  readonly historicalScorecardStatus: 'HISTORICAL_BASELINE_ONLY_RESCORING_REQUIRED';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly scorecardDigest: string;
}

export interface StrategicRebalanceVerdictV33_29 {
  readonly version: '33.29';
  readonly verdictId: string;
  readonly status: 'LOCAL_ASSURANCE_STRONG_EXTERNAL_PRODUCT_MARKET_CRITICAL_GAP';
  readonly directionAssessment: 'TECHNICAL_DIRECTION_CORRECT_PORTFOLIO_BALANCE_REQUIRES_PIVOT_TO_EXTERNAL_PRODUCT_PROOF';
  readonly localReleaseIntegrity: 'PASS';
  readonly externalProductEvidence: 'CRITICAL_GAP';
  readonly marketEvidence: 'CRITICAL_GAP';
  readonly productionReadiness: 'BLOCKED';
  readonly overengineeringRisk: 'HIGH_IF_NEXT_RELEASES_ADD_LOCAL_TRUST_FEATURES_WITHOUT_PILOT_UNBLOCKING_VALUE';
  readonly requiredPriorityOrder: readonly [
    'G3_CONTROLLED_HUMAN_UX_PILOT',
    'G4_REAL_REPOSITORY_30_MISSION_CAMPAIGN',
    'G2_BUYER_INTERVIEWS_DESIGN_PARTNERS_PAID_PILOTS',
    'G5_ONLY_EXTERNAL_TRUST_CONTROLS_THAT_DIRECTLY_UNBLOCK_THE_PILOT',
  ];
  readonly localSecurityFeatureExpansionAllowed: false;
  readonly exceptionRule: 'ONLY_WHEN_A_DOCUMENTED_G2_G3_OR_G4_PILOT_BLOCKER_REQUIRES_IT';
  readonly scorecardDigest: string;
  readonly parameterLedgerDigest: string;
  readonly evaluatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

const EXPECTED_LAYER_COUNTS = {
  CORE_AXIS: 14,
  COMPLEMENTARY_METRIC: 8,
  PROOF_GATE: 9,
  VALUE_HYPOTHESIS: 9,
  PROGRAM_PARAMETER: 14,
} as const;

export const EXPECTED_CORE_AXIS_IDS_V33_29 = [
  'requirement-fidelity', 'correctness-invariants', 'adversarial-test-depth', 'security-trust-sovereignty',
  'durability-concurrency-consistency', 'architecture-modularity', 'evidence-integrity-traceability',
  'performance-resource-efficiency', 'stability-determinism', 'operability-recovery',
  'portability-supply-chain-isolation', 'product-value-operator-ux', 'external-readiness-scalability',
  'engineering-efficiency-change-safety',
] as const;

export const EXPECTED_COMPLEMENTARY_IDS_V33_29 = [
  'maintainability-evolvability', 'observability-diagnosability', 'data-integrity-lifecycle',
  'dependency-upgrade-resilience', 'compatibility-migration-safety', 'privacy-data-minimization',
  'accessibility-human-factors', 'cost-capacity-predictability',
] as const;

export const EXPECTED_GATE_IDS_V33_29 = ['G0','G1','G2','G3','G4','G5','G6','G7','G8'] as const;
export const EXPECTED_HYPOTHESIS_IDS_V33_29 = ['VH-01','VH-02','VH-03','VH-04','VH-05','VH-06','VH-07','VH-08','VH-09'] as const;
export const EXPECTED_PARAMETER_IDS_V33_29 = [
  'CHAT_NATIVE_GOVERNED_ACTION','ONE_CANONICAL_AUTHORITY','NO_LEARNED_AUTHORITY_EXPANSION',
  'EXTERNAL_EFFECTS_EXPLICITLY_GATED','SIGNED_BYTE_BOUND_EVIDENCE','FAIL_CLOSED_ON_UNCERTAINTY',
  'RECOVERY_REVOCATION_FALLBACK','UX_REDUCTION_AND_COMPREHENSION_TARGETS',
  'ENGINEERING_PRODUCT_PROOF_TARGETS','CATEGORY_AND_BUYER_PROOF_TARGETS',
  'EXTERNAL_ROLE_HOST_ORG_SEPARATION','RELEASE_REPRODUCIBILITY_AND_CLEAN_EXIT',
  'PROVIDER_NEUTRAL_SOVEREIGNTY','LARGE_OUTCOME_VALUE_FILTER',
] as const;

export function createProgramParameterLedgerV33_29(input: {
  readonly issuer: SigningIdentity;
  readonly previousLedgerDigest: string;
  readonly parameters: readonly ProgramParameterV33_29[];
  readonly generatedAt: Date;
}): SignedEnvelope<ProgramParameterLedgerV33_29> {
  requireDigest(input.previousLedgerDigest, 'previous_parameter_ledger_digest_invalid');
  requireDate(input.generatedAt, 'parameter_ledger_time_invalid');
  validateExactIds(input.parameters.map((p) => p.id), EXPECTED_PARAMETER_IDS_V33_29, 'parameter_ids_invalid');
  for (const parameter of input.parameters) {
    if (parameter.target.trim() === '' || parameter.category.trim() === '' || parameter.evidenceRefs.length === 0) throw new Error('parameter_content_invalid');
  }
  const preserved = input.parameters.filter((p) => p.status === 'PRESERVED').length;
  const strengthened = input.parameters.filter((p) => p.status === 'STRENGTHENED').length;
  const pending = input.parameters.filter((p) => p.status === 'EXTERNAL_EVIDENCE_PENDING').length;
  if (preserved !== 8 || strengthened !== 3 || pending !== 3) throw new Error('parameter_status_counts_invalid');
  const material = {
    version: '33.29' as const,
    ledgerId: randomUUID(),
    previousVersion: '33.28' as const,
    previousLedgerDigest: input.previousLedgerDigest,
    parameterCount: 14 as const,
    parameters: [...input.parameters],
    preservedParameterCount: preserved,
    strengthenedParameterCount: strengthened,
    externalEvidencePendingParameterCount: pending,
    generatedAt: input.generatedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, ledgerDigest: sha256(material) }, input.issuer);
}

export function createMasterProgramScorecardV33_29(input: {
  readonly issuer: SigningIdentity;
  readonly metrics: readonly MasterMetricV33_29[];
  readonly releaseFacts: ReleaseFactsV33_29;
  readonly externalProgress: ExternalProgressV33_29;
  readonly generatedAt: Date;
}): SignedEnvelope<MasterProgramScorecardV33_29> {
  requireDate(input.generatedAt, 'scorecard_time_invalid');
  validateMetricInventory(input.metrics);
  validateReleaseFacts(input.releaseFacts);
  validateExternalProgress(input.externalProgress);
  const localStrong = input.metrics.filter((m) => m.localMaturity === 'STRONG').length;
  const localPartial = input.metrics.filter((m) => m.localMaturity === 'PARTIAL').length;
  const localWeak = input.metrics.filter((m) => m.localMaturity === 'WEAK').length;
  const externalPassed = input.metrics.filter((m) => m.externalMaturity === 'PASSED').length;
  const externalPartial = input.metrics.filter((m) => m.externalMaturity === 'PARTIAL').length;
  const externalPendingOrBlocked = input.metrics.filter((m) => m.externalMaturity === 'PENDING' || m.externalMaturity === 'BLOCKED').length;
  const notStarted = input.metrics.filter((m) => m.externalMaturity === 'NOT_STARTED').length;
  const material = {
    version: '33.29' as const,
    scorecardId: randomUUID(),
    generatedAt: input.generatedAt.toISOString(),
    metricCount: 54 as const,
    layerCounts: { coreAxes: 14 as const, complementaryMetrics: 8 as const, proofGates: 9 as const, valueHypotheses: 9 as const, programParameters: 14 as const },
    metrics: [...input.metrics],
    releaseFacts: input.releaseFacts,
    externalProgress: input.externalProgress,
    normalizedStatus: { localStrong, localPartial, localWeak, externalPassed, externalPartial, externalPendingOrBlocked, notStarted },
    proofGateStatus: { passed: 2 as const, inProgress: 5 as const, notStarted: 2 as const },
    valueHypothesisStatus: { proven: 0 as const, partialLocal: 5 as const, unproven: 4 as const },
    parameterStatus: { preserved: 8 as const, strengthened: 3 as const, externalPending: 3 as const },
    historicalScorecardStatus: 'HISTORICAL_BASELINE_ONLY_RESCORING_REQUIRED' as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, scorecardDigest: sha256(material) }, input.issuer);
}

export function createStrategicRebalanceVerdictV33_29(input: {
  readonly issuer: SigningIdentity;
  readonly scorecard: SignedEnvelope<MasterProgramScorecardV33_29>;
  readonly scorecardRegistry: KeyRegistry;
  readonly trustedScorecardSignerIds: readonly string[];
  readonly parameterLedger: SignedEnvelope<ProgramParameterLedgerV33_29>;
  readonly parameterRegistry: KeyRegistry;
  readonly trustedParameterSignerIds: readonly string[];
  readonly evaluatedAt: Date;
}): SignedEnvelope<StrategicRebalanceVerdictV33_29> {
  requireDate(input.evaluatedAt, 'rebalance_time_invalid');
  verifyEnvelope(input.scorecard, input.scorecardRegistry, input.trustedScorecardSignerIds, 'scorecard');
  verifyEnvelope(input.parameterLedger, input.parameterRegistry, input.trustedParameterSignerIds, 'parameter_ledger');
  verifyScorecardDigest(input.scorecard.payload);
  verifyParameterLedgerDigest(input.parameterLedger.payload);
  const progress = input.scorecard.payload.externalProgress;
  if (progress.buyerInterviews !== 0 || progress.designPartners !== 0 || progress.paidPilots !== 0 || progress.humanPilotParticipants !== 0 || progress.qualifiedRepositories !== 0 || progress.qualifiedMissions !== 0) {
    throw new Error('rebalance_external_progress_fixture_not_zero');
  }
  const facts = input.scorecard.payload.releaseFacts;
  if (facts.tests.failed !== 0 || facts.tests.total !== facts.tests.passed || facts.architecture.capabilityPaths !== facts.architecture.closedCapabilityPaths) throw new Error('rebalance_local_integrity_not_passed');
  const material = {
    version: '33.29' as const,
    verdictId: randomUUID(),
    status: 'LOCAL_ASSURANCE_STRONG_EXTERNAL_PRODUCT_MARKET_CRITICAL_GAP' as const,
    directionAssessment: 'TECHNICAL_DIRECTION_CORRECT_PORTFOLIO_BALANCE_REQUIRES_PIVOT_TO_EXTERNAL_PRODUCT_PROOF' as const,
    localReleaseIntegrity: 'PASS' as const,
    externalProductEvidence: 'CRITICAL_GAP' as const,
    marketEvidence: 'CRITICAL_GAP' as const,
    productionReadiness: 'BLOCKED' as const,
    overengineeringRisk: 'HIGH_IF_NEXT_RELEASES_ADD_LOCAL_TRUST_FEATURES_WITHOUT_PILOT_UNBLOCKING_VALUE' as const,
    requiredPriorityOrder: [
      'G3_CONTROLLED_HUMAN_UX_PILOT',
      'G4_REAL_REPOSITORY_30_MISSION_CAMPAIGN',
      'G2_BUYER_INTERVIEWS_DESIGN_PARTNERS_PAID_PILOTS',
      'G5_ONLY_EXTERNAL_TRUST_CONTROLS_THAT_DIRECTLY_UNBLOCK_THE_PILOT',
    ] as const,
    localSecurityFeatureExpansionAllowed: false as const,
    exceptionRule: 'ONLY_WHEN_A_DOCUMENTED_G2_G3_OR_G4_PILOT_BLOCKER_REQUIRES_IT' as const,
    scorecardDigest: input.scorecard.payload.scorecardDigest,
    parameterLedgerDigest: input.parameterLedger.payload.ledgerDigest,
    evaluatedAt: input.evaluatedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, verdictDigest: sha256(material) }, input.issuer);
}

export function verifyMasterProgramScorecardV33_29(input: {
  readonly scorecard: SignedEnvelope<MasterProgramScorecardV33_29>;
  readonly registry: KeyRegistry;
  readonly trustedSignerIds: readonly string[];
}): MasterProgramScorecardV33_29 {
  verifyEnvelope(input.scorecard, input.registry, input.trustedSignerIds, 'scorecard');
  verifyScorecardDigest(input.scorecard.payload);
  validateMetricInventory(input.scorecard.payload.metrics);
  validateReleaseFacts(input.scorecard.payload.releaseFacts);
  validateExternalProgress(input.scorecard.payload.externalProgress);
  return input.scorecard.payload;
}

export function verifyStrategicRebalanceVerdictV33_29(input: {
  readonly verdict: SignedEnvelope<StrategicRebalanceVerdictV33_29>;
  readonly registry: KeyRegistry;
  readonly trustedSignerIds: readonly string[];
  readonly expectedScorecardDigest: string;
  readonly expectedParameterLedgerDigest: string;
}): StrategicRebalanceVerdictV33_29 {
  verifyEnvelope(input.verdict, input.registry, input.trustedSignerIds, 'rebalance_verdict');
  const { verdictDigest, ...material } = input.verdict.payload;
  if (sha256(material) !== verdictDigest) throw new Error('rebalance_verdict_digest_invalid');
  if (input.verdict.payload.scorecardDigest !== input.expectedScorecardDigest || input.verdict.payload.parameterLedgerDigest !== input.expectedParameterLedgerDigest) throw new Error('rebalance_verdict_binding_invalid');
  if (input.verdict.payload.localSecurityFeatureExpansionAllowed !== false || input.verdict.payload.productionAuthority !== 'NONE' || input.verdict.payload.externalEffectsExecuted !== 0) throw new Error('rebalance_verdict_boundary_invalid');
  return input.verdict.payload;
}

function validateMetricInventory(metrics: readonly MasterMetricV33_29[]): void {
  if (metrics.length !== 54) throw new Error('master_metric_count_invalid');
  const ids = new Set<string>();
  for (const metric of metrics) {
    if (ids.has(`${metric.layer}:${metric.id}`)) throw new Error('master_metric_duplicate');
    ids.add(`${metric.layer}:${metric.id}`);
    if (metric.title.trim() === '' || metric.evidenceRefs.length === 0 || metric.nextProof.trim() === '') throw new Error('master_metric_content_invalid');
    if (metric.currentNumericScoreAvailable !== false) throw new Error('current_numeric_score_must_be_unavailable');
    if (metric.historicalNumericBaseline !== undefined) {
      if (metric.historicalNumericBaseline.version !== '32.5' || metric.historicalNumericBaseline.projectScore < 0 || metric.historicalNumericBaseline.projectScore > 100) throw new Error('historical_baseline_invalid');
    }
  }
  for (const [layer, count] of Object.entries(EXPECTED_LAYER_COUNTS)) if (metrics.filter((m) => m.layer === layer).length !== count) throw new Error(`master_metric_layer_count_invalid:${layer}`);
  validateExactIds(metrics.filter((m) => m.layer === 'CORE_AXIS').map((m) => m.id), EXPECTED_CORE_AXIS_IDS_V33_29, 'core_axis_ids_invalid');
  validateExactIds(metrics.filter((m) => m.layer === 'COMPLEMENTARY_METRIC').map((m) => m.id), EXPECTED_COMPLEMENTARY_IDS_V33_29, 'complementary_metric_ids_invalid');
  validateExactIds(metrics.filter((m) => m.layer === 'PROOF_GATE').map((m) => m.id), EXPECTED_GATE_IDS_V33_29, 'proof_gate_ids_invalid');
  validateExactIds(metrics.filter((m) => m.layer === 'VALUE_HYPOTHESIS').map((m) => m.id), EXPECTED_HYPOTHESIS_IDS_V33_29, 'value_hypothesis_ids_invalid');
  validateExactIds(metrics.filter((m) => m.layer === 'PROGRAM_PARAMETER').map((m) => m.id), EXPECTED_PARAMETER_IDS_V33_29, 'scorecard_parameter_ids_invalid');
}

function validateReleaseFacts(facts: ReleaseFactsV33_29): void {
  if (facts.tests.files < 1 || facts.tests.total < 1 || facts.tests.total !== facts.tests.passed || facts.tests.failed !== 0) throw new Error('release_test_facts_invalid');
  if (facts.directV33.files < 1 || facts.directV33.total < 1 || facts.directV33.total !== facts.directV33.passed || facts.directV33.failed !== 0) throw new Error('release_direct_facts_invalid');
  const a = facts.architecture;
  if (a.sourceModules < 1 || a.testFiles !== facts.tests.files || a.capabilityPaths < 1 || a.capabilityPaths !== a.closedCapabilityPaths || a.sourceCycles !== 0 || a.untestedSources !== 0 || a.truthFindings !== 0) throw new Error('release_architecture_facts_invalid');
  if (facts.releaseExitCode !== 0 || facts.retryUsed !== false || facts.forceExitUsed !== false || facts.cleanExtractionValidated !== true) throw new Error('release_reproducibility_facts_invalid');
}

function validateExternalProgress(progress: ExternalProgressV33_29): void {
  for (const value of Object.values(progress)) if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) throw new Error('external_progress_invalid');
  if (progress.buyerInterviews > 15 || progress.urgentFundedConfirmations > 5 || progress.designPartners > 3 || progress.paidPilots > 2 || progress.qualifiedRepositories > 3 || progress.qualifiedMissions > 30) throw new Error('external_progress_exceeds_target');
}

function verifyScorecardDigest(payload: MasterProgramScorecardV33_29): void {
  const { scorecardDigest, ...material } = payload;
  if (sha256(material) !== scorecardDigest) throw new Error('scorecard_digest_invalid');
}
function verifyParameterLedgerDigest(payload: ProgramParameterLedgerV33_29): void {
  const { ledgerDigest, ...material } = payload;
  if (sha256(material) !== ledgerDigest) throw new Error('parameter_ledger_digest_invalid');
}
function verifyEnvelope<T>(envelope: SignedEnvelope<T>, registry: KeyRegistry, trusted: readonly string[], label: string): void {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verify(envelope)) throw new Error(`${label}_signature_invalid`);
}
function validateExactIds(actual: readonly string[], expected: readonly string[], code: string): void {
  const a = [...actual].sort(); const e = [...expected].sort();
  if (a.length !== e.length || a.some((value, index) => value !== e[index])) throw new Error(code);
}
function requireDigest(value: string, code: string): void { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(code); }
function requireDate(value: Date, code: string): void { if (!Number.isFinite(value.getTime())) throw new Error(code); }
