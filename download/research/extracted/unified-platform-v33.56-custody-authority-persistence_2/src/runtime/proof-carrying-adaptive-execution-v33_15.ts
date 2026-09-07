import { randomUUID } from 'node:crypto';
import {
  KeyRegistry,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';

export type ShortcutEvidenceClassV33_15 = 'TRAINING' | 'HOLDOUT' | 'SHADOW';
export type ShortcutPromotionCeilingV33_15 = 'shadow' | 'limited-revocable';
export type ShortcutRouteV33_15 = 'FULL_GOVERNED_WORKFLOW' | 'QUALIFIED_SHORTCUT_SHADOW';

export interface WorkflowBoundaryV33_15 {
  readonly tenantId: string;
  readonly workflowType: string;
  readonly authorityGrantDigest: string;
  readonly allowedScopes: readonly string[];
  readonly policyDigest: string;
  readonly inputSchemaDigest: string;
  readonly toolchainDigest: string;
  readonly modelSetDigest: string;
  readonly riskClass: 'low' | 'medium' | 'high' | 'critical';
  readonly reversible: boolean;
}

export interface WorkflowObservationV33_15 {
  readonly version: '33.15';
  readonly observationId: string;
  readonly evidenceClass: ShortcutEvidenceClassV33_15;
  readonly boundary: WorkflowBoundaryV33_15;
  readonly inputClassDigest: string;
  readonly fullWorkflowResultDigest: string;
  readonly fullWorkflowEvidenceRoot: string;
  readonly fullWorkflowPassed: boolean;
  readonly userDecision: 'APPROVED' | 'REJECTED' | 'NOT_REQUIRED';
  readonly userSteps: number;
  readonly approvalCount: number;
  readonly costUnits: number;
  readonly durationMs: number;
  readonly observedAt: string;
  readonly externalEffectsExecuted: 0;
  readonly observationDigest: string;
}

export interface ExecutionShortcutCandidateV33_15 {
  readonly version: '33.15';
  readonly candidateId: string;
  readonly tenantId: string;
  readonly workflowType: string;
  readonly boundaryDigest: string;
  readonly authorityGrantDigest: string;
  readonly allowedScopes: readonly string[];
  readonly policyDigest: string;
  readonly inputSchemaDigest: string;
  readonly toolchainDigest: string;
  readonly modelSetDigest: string;
  readonly maximumRiskClass: 'low' | 'medium';
  readonly reversibleRequired: true;
  readonly inputClassDigest: string;
  readonly projectedResultDigest: string;
  readonly trainingObservationIds: readonly string[];
  readonly minimumHoldoutCount: number;
  readonly minimumShadowCount: number;
  readonly maximumMismatchCount: 0;
  readonly discoveredAt: string;
  readonly promotionCeiling: 'shadow';
  readonly externalEffectsExecuted: 0;
  readonly candidateDigest: string;
}

export interface ShortcutQualificationV33_15 {
  readonly version: '33.15';
  readonly qualificationId: string;
  readonly candidateDigest: string;
  readonly holdoutObservationIds: readonly string[];
  readonly holdoutCount: number;
  readonly mismatchCount: number;
  readonly allFullWorkflowsPassed: boolean;
  readonly authorityPreserved: boolean;
  readonly scopePreserved: boolean;
  readonly resultEquivalenceProven: boolean;
  readonly qualifiedAt: string;
  readonly status: 'QUALIFIED_FOR_SHADOW';
  readonly externalEffectsExecuted: 0;
  readonly qualificationDigest: string;
}

export interface ShadowComparisonV33_15 {
  readonly version: '33.15';
  readonly comparisonId: string;
  readonly candidateDigest: string;
  readonly observationId: string;
  readonly fullWorkflowResultDigest: string;
  readonly shortcutResultDigest: string;
  readonly match: boolean;
  readonly comparedAt: string;
  readonly externalEffectsExecuted: 0;
  readonly comparisonDigest: string;
}

export interface ShortcutPassportV33_15 {
  readonly version: '33.15';
  readonly passportId: string;
  readonly candidateDigest: string;
  readonly qualificationDigest: string;
  readonly shadowComparisonDigests: readonly string[];
  readonly shadowCount: number;
  readonly mismatchCount: 0;
  readonly tenantId: string;
  readonly workflowType: string;
  readonly authorityGrantDigest: string;
  readonly allowedScopes: readonly string[];
  readonly policyDigest: string;
  readonly inputSchemaDigest: string;
  readonly toolchainDigest: string;
  readonly modelSetDigest: string;
  readonly inputClassDigest: string;
  readonly projectedResultDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly promotionCeiling: ShortcutPromotionCeilingV33_15;
  readonly requiresExplicitActivation: true;
  readonly driftRevokesAutomatically: true;
  readonly fallbackRoute: 'FULL_GOVERNED_WORKFLOW';
  readonly externalEffectsExecuted: 0;
  readonly passportDigest: string;
}

export interface ShortcutActivationV33_15 {
  readonly version: '33.15';
  readonly activationId: string;
  readonly passportDigest: string;
  readonly tenantId: string;
  readonly approvedBy: string;
  readonly approvedScopes: readonly string[];
  readonly activatedAt: string;
  readonly expiresAt: string;
  readonly activationCeiling: 'limited-revocable';
  readonly externalEffectsExecuted: 0;
  readonly activationDigest: string;
}

export interface ShortcutRevocationV33_15 {
  readonly version: '33.15';
  readonly revocationId: string;
  readonly passportDigest: string;
  readonly tenantId: string;
  readonly reason:
    | 'POLICY_DRIFT'
    | 'AUTHORITY_DRIFT'
    | 'SCOPE_DRIFT'
    | 'INPUT_SCHEMA_DRIFT'
    | 'TOOLCHAIN_DRIFT'
    | 'MODEL_SET_DRIFT'
    | 'RESULT_MISMATCH'
    | 'MANUAL_REVOCATION'
    | 'EXPIRED';
  readonly evidenceDigest: string;
  readonly revokedAt: string;
  readonly fallbackRoute: 'FULL_GOVERNED_WORKFLOW';
  readonly externalEffectsExecuted: 0;
  readonly revocationDigest: string;
}

export interface ShortcutRoutingDecisionV33_15 {
  readonly version: '33.15';
  readonly decisionId: string;
  readonly passportDigest: string;
  readonly route: ShortcutRouteV33_15;
  readonly reason:
    | 'QUALIFIED_AND_ACTIVATED'
    | 'PASSPORT_INVALID'
    | 'ACTIVATION_INVALID'
    | 'REVOKED'
    | 'EXPIRED'
    | 'BOUNDARY_DRIFT'
    | 'RISK_TOO_HIGH'
    | 'NOT_REVERSIBLE';
  readonly evaluatedAt: string;
  readonly authorityExpanded: false;
  readonly externalEffectsExecuted: 0;
  readonly decisionDigest: string;
}

export function createWorkflowObservationV33_15(input: Omit<WorkflowObservationV33_15, 'version' | 'observationDigest'>): WorkflowObservationV33_15 {
  validateBoundary(input.boundary);
  requireId(input.observationId, 'observation_id');
  requireDigest(input.inputClassDigest, 'input_class_digest');
  requireDigest(input.fullWorkflowResultDigest, 'full_workflow_result_digest');
  requireDigest(input.fullWorkflowEvidenceRoot, 'full_workflow_evidence_root');
  requireDate(input.observedAt, 'observed_at');
  requireNonNegativeInteger(input.userSteps, 'user_steps');
  requireNonNegativeInteger(input.approvalCount, 'approval_count');
  requireNonNegative(input.costUnits, 'cost_units');
  requireNonNegative(input.durationMs, 'duration_ms');
  if (input.externalEffectsExecuted !== 0) throw new Error('observation_external_effect_forbidden');
  const material = { version: '33.15' as const, ...input };
  return { ...material, observationDigest: sha256(material) };
}

export function verifyWorkflowObservationV33_15(observation: WorkflowObservationV33_15): boolean {
  try {
    const { observationDigest, ...material } = observation;
    createWorkflowObservationV33_15(material);
    return sha256(material) === observationDigest;
  } catch {
    return false;
  }
}

export function discoverShortcutCandidateV33_15(input: {
  readonly observations: readonly WorkflowObservationV33_15[];
  readonly minimumTrainingCount?: number;
  readonly minimumHoldoutCount?: number;
  readonly minimumShadowCount?: number;
  readonly now?: Date;
}): ExecutionShortcutCandidateV33_15 {
  const minimumTrainingCount = input.minimumTrainingCount ?? 5;
  const minimumHoldoutCount = input.minimumHoldoutCount ?? 3;
  const minimumShadowCount = input.minimumShadowCount ?? 5;
  requirePositiveInteger(minimumTrainingCount, 'minimum_training_count');
  requirePositiveInteger(minimumHoldoutCount, 'minimum_holdout_count');
  requirePositiveInteger(minimumShadowCount, 'minimum_shadow_count');
  if (input.observations.length < minimumTrainingCount) throw new Error('insufficient_training_observations');
  if (input.observations.some((item) => item.evidenceClass !== 'TRAINING')) throw new Error('training_evidence_class_required');
  validateUniqueObservations(input.observations);
  for (const observation of input.observations) {
    if (!verifyWorkflowObservationV33_15(observation)) throw new Error('training_observation_invalid');
    if (!observation.fullWorkflowPassed) throw new Error('training_full_workflow_failure');
    if (observation.boundary.riskClass !== 'low' && observation.boundary.riskClass !== 'medium') throw new Error('training_risk_too_high');
    if (!observation.boundary.reversible) throw new Error('training_reversibility_required');
  }
  const first = input.observations[0]!;
  const maximumRiskClass: 'low' | 'medium' = first.boundary.riskClass === 'low' ? 'low' : 'medium';
  const boundaryDigest = digestBoundary(first.boundary);
  const resultDigest = first.fullWorkflowResultDigest;
  const inputClassDigest = first.inputClassDigest;
  for (const observation of input.observations.slice(1)) {
    if (digestBoundary(observation.boundary) !== boundaryDigest) throw new Error('training_boundary_not_uniform');
    if (observation.inputClassDigest !== inputClassDigest) throw new Error('training_input_class_not_uniform');
    if (observation.fullWorkflowResultDigest !== resultDigest) throw new Error('training_result_not_deterministic');
  }
  const now = input.now ?? new Date();
  const discoveredAt = requireDate(now.toISOString(), 'discovered_at');
  const sortedScopes = normalizeScopes(first.boundary.allowedScopes);
  const material = {
    version: '33.15' as const,
    candidateId: `shortcut-candidate-${randomUUID()}`,
    tenantId: first.boundary.tenantId,
    workflowType: first.boundary.workflowType,
    boundaryDigest,
    authorityGrantDigest: first.boundary.authorityGrantDigest,
    allowedScopes: sortedScopes,
    policyDigest: first.boundary.policyDigest,
    inputSchemaDigest: first.boundary.inputSchemaDigest,
    toolchainDigest: first.boundary.toolchainDigest,
    modelSetDigest: first.boundary.modelSetDigest,
    maximumRiskClass,
    reversibleRequired: true as const,
    inputClassDigest,
    projectedResultDigest: resultDigest,
    trainingObservationIds: input.observations.map((item) => item.observationId).sort(),
    minimumHoldoutCount,
    minimumShadowCount,
    maximumMismatchCount: 0 as const,
    discoveredAt,
    promotionCeiling: 'shadow' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, candidateDigest: sha256(material) };
}

export function verifyShortcutCandidateV33_15(candidate: ExecutionShortcutCandidateV33_15): boolean {
  try {
    const { candidateDigest, ...material } = candidate;
    requireId(candidate.candidateId, 'candidate_id');
    requireDigest(candidate.boundaryDigest, 'boundary_digest');
    requireDigest(candidate.projectedResultDigest, 'projected_result_digest');
    if (candidate.promotionCeiling !== 'shadow' || candidate.externalEffectsExecuted !== 0 || !candidate.reversibleRequired || candidate.maximumMismatchCount !== 0) return false;
    normalizeScopes(candidate.allowedScopes);
    return sha256(material) === candidateDigest;
  } catch {
    return false;
  }
}

export function qualifyShortcutCandidateV33_15(input: {
  readonly candidate: ExecutionShortcutCandidateV33_15;
  readonly holdoutObservations: readonly WorkflowObservationV33_15[];
  readonly qualifier: SigningIdentity;
  readonly now?: Date;
}): SignedEnvelope<ShortcutQualificationV33_15> {
  if (!verifyShortcutCandidateV33_15(input.candidate)) throw new Error('candidate_invalid');
  if (input.holdoutObservations.length < input.candidate.minimumHoldoutCount) throw new Error('insufficient_holdout_observations');
  validateUniqueObservations(input.holdoutObservations);
  const trainingIds = new Set(input.candidate.trainingObservationIds);
  for (const observation of input.holdoutObservations) {
    if (observation.evidenceClass !== 'HOLDOUT') throw new Error('holdout_evidence_class_required');
    if (trainingIds.has(observation.observationId)) throw new Error('holdout_training_overlap');
    if (!verifyWorkflowObservationV33_15(observation)) throw new Error('holdout_observation_invalid');
    if (!observation.fullWorkflowPassed) throw new Error('holdout_full_workflow_failure');
    assertObservationMatchesCandidate(observation, input.candidate);
    if (observation.fullWorkflowResultDigest !== input.candidate.projectedResultDigest) throw new Error('holdout_result_mismatch');
  }
  const now = input.now ?? new Date();
  const material = {
    version: '33.15' as const,
    qualificationId: `shortcut-qualification-${randomUUID()}`,
    candidateDigest: input.candidate.candidateDigest,
    holdoutObservationIds: input.holdoutObservations.map((item) => item.observationId).sort(),
    holdoutCount: input.holdoutObservations.length,
    mismatchCount: 0,
    allFullWorkflowsPassed: true,
    authorityPreserved: true,
    scopePreserved: true,
    resultEquivalenceProven: true,
    qualifiedAt: requireDate(now.toISOString(), 'qualified_at'),
    status: 'QUALIFIED_FOR_SHADOW' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, qualificationDigest: sha256(material) }, input.qualifier);
}

export function verifyShortcutQualificationV33_15(input: {
  readonly envelope: SignedEnvelope<ShortcutQualificationV33_15>;
  readonly registry: KeyRegistry;
  readonly expectedCandidateDigest: string;
  readonly trustedSignerIds: readonly string[];
}): boolean {
  const payload = input.envelope.payload;
  const { qualificationDigest, ...material } = payload;
  return input.trustedSignerIds.includes(input.envelope.issuerKeyId)
    && input.registry.verifyAt(input.envelope, payload.qualifiedAt)
    && payload.candidateDigest === input.expectedCandidateDigest
    && payload.status === 'QUALIFIED_FOR_SHADOW'
    && payload.mismatchCount === 0
    && payload.allFullWorkflowsPassed
    && payload.authorityPreserved
    && payload.scopePreserved
    && payload.resultEquivalenceProven
    && payload.externalEffectsExecuted === 0
    && sha256(material) === qualificationDigest;
}

export function compareShadowExecutionV33_15(input: {
  readonly candidate: ExecutionShortcutCandidateV33_15;
  readonly observation: WorkflowObservationV33_15;
  readonly shortcutResultDigest: string;
  readonly now?: Date;
}): ShadowComparisonV33_15 {
  if (!verifyShortcutCandidateV33_15(input.candidate)) throw new Error('candidate_invalid');
  if (input.observation.evidenceClass !== 'SHADOW') throw new Error('shadow_evidence_class_required');
  if (!verifyWorkflowObservationV33_15(input.observation)) throw new Error('shadow_observation_invalid');
  assertObservationMatchesCandidate(input.observation, input.candidate);
  requireDigest(input.shortcutResultDigest, 'shortcut_result_digest');
  const material = {
    version: '33.15' as const,
    comparisonId: `shortcut-shadow-${randomUUID()}`,
    candidateDigest: input.candidate.candidateDigest,
    observationId: input.observation.observationId,
    fullWorkflowResultDigest: input.observation.fullWorkflowResultDigest,
    shortcutResultDigest: input.shortcutResultDigest,
    match: input.observation.fullWorkflowPassed
      && input.observation.fullWorkflowResultDigest === input.shortcutResultDigest
      && input.shortcutResultDigest === input.candidate.projectedResultDigest,
    comparedAt: requireDate((input.now ?? new Date()).toISOString(), 'compared_at'),
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, comparisonDigest: sha256(material) };
}

export function issueShortcutPassportV33_15(input: {
  readonly candidate: ExecutionShortcutCandidateV33_15;
  readonly qualification: SignedEnvelope<ShortcutQualificationV33_15>;
  readonly qualificationRegistry: KeyRegistry;
  readonly trustedQualifierIds: readonly string[];
  readonly comparisons: readonly ShadowComparisonV33_15[];
  readonly issuer: SigningIdentity;
  readonly expiresAt: string;
  readonly now?: Date;
}): SignedEnvelope<ShortcutPassportV33_15> {
  if (!verifyShortcutCandidateV33_15(input.candidate)) throw new Error('candidate_invalid');
  if (!verifyShortcutQualificationV33_15({ envelope: input.qualification, registry: input.qualificationRegistry, expectedCandidateDigest: input.candidate.candidateDigest, trustedSignerIds: input.trustedQualifierIds })) throw new Error('qualification_invalid');
  if (input.qualification.issuerKeyId === input.issuer.keyId) throw new Error('passport_issuer_must_be_independent_of_qualifier');
  if (input.comparisons.length < input.candidate.minimumShadowCount) throw new Error('insufficient_shadow_comparisons');
  const seen = new Set<string>();
  for (const comparison of input.comparisons) {
    if (seen.has(comparison.comparisonId)) throw new Error('duplicate_shadow_comparison');
    seen.add(comparison.comparisonId);
    if (!verifyShadowComparison(comparison)) throw new Error('shadow_comparison_invalid');
    if (comparison.candidateDigest !== input.candidate.candidateDigest || !comparison.match) throw new Error('shadow_mismatch');
  }
  const issuedAt = requireDate((input.now ?? new Date()).toISOString(), 'passport_issued_at');
  const expiresAt = requireDate(input.expiresAt, 'passport_expires_at');
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw new Error('passport_expiry_invalid');
  const material = {
    version: '33.15' as const,
    passportId: `shortcut-passport-${randomUUID()}`,
    candidateDigest: input.candidate.candidateDigest,
    qualificationDigest: input.qualification.payload.qualificationDigest,
    shadowComparisonDigests: input.comparisons.map((item) => item.comparisonDigest).sort(),
    shadowCount: input.comparisons.length,
    mismatchCount: 0 as const,
    tenantId: input.candidate.tenantId,
    workflowType: input.candidate.workflowType,
    authorityGrantDigest: input.candidate.authorityGrantDigest,
    allowedScopes: input.candidate.allowedScopes,
    policyDigest: input.candidate.policyDigest,
    inputSchemaDigest: input.candidate.inputSchemaDigest,
    toolchainDigest: input.candidate.toolchainDigest,
    modelSetDigest: input.candidate.modelSetDigest,
    inputClassDigest: input.candidate.inputClassDigest,
    projectedResultDigest: input.candidate.projectedResultDigest,
    issuedAt,
    expiresAt,
    promotionCeiling: 'limited-revocable' as const,
    requiresExplicitActivation: true as const,
    driftRevokesAutomatically: true as const,
    fallbackRoute: 'FULL_GOVERNED_WORKFLOW' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, passportDigest: sha256(material) }, input.issuer);
}

export function verifyShortcutPassportV33_15(input: {
  readonly envelope: SignedEnvelope<ShortcutPassportV33_15>;
  readonly registry: KeyRegistry;
  readonly trustedIssuerIds: readonly string[];
  readonly now?: Date;
}): boolean {
  const payload = input.envelope.payload;
  const { passportDigest, ...material } = payload;
  const now = input.now ?? new Date();
  return input.trustedIssuerIds.includes(input.envelope.issuerKeyId)
    && input.registry.verifyAt(input.envelope, payload.issuedAt)
    && Date.parse(payload.issuedAt) <= now.getTime()
    && now.getTime() < Date.parse(payload.expiresAt)
    && payload.promotionCeiling === 'limited-revocable'
    && payload.requiresExplicitActivation
    && payload.driftRevokesAutomatically
    && payload.fallbackRoute === 'FULL_GOVERNED_WORKFLOW'
    && payload.mismatchCount === 0
    && payload.externalEffectsExecuted === 0
    && sha256(material) === passportDigest;
}

export function activateShortcutPassportV33_15(input: {
  readonly passport: SignedEnvelope<ShortcutPassportV33_15>;
  readonly passportRegistry: KeyRegistry;
  readonly trustedPassportIssuerIds: readonly string[];
  readonly approvedBy: string;
  readonly approvedScopes: readonly string[];
  readonly signer: SigningIdentity;
  readonly expiresAt: string;
  readonly now?: Date;
}): SignedEnvelope<ShortcutActivationV33_15> {
  const now = input.now ?? new Date();
  if (!verifyShortcutPassportV33_15({ envelope: input.passport, registry: input.passportRegistry, trustedIssuerIds: input.trustedPassportIssuerIds, now })) throw new Error('passport_invalid');
  requireId(input.approvedBy, 'approved_by');
  const approvedScopes = normalizeScopes(input.approvedScopes);
  if (!isSubset(approvedScopes, input.passport.payload.allowedScopes)) throw new Error('activation_scope_expansion');
  const activatedAt = requireDate(now.toISOString(), 'activated_at');
  const expiresAt = requireDate(input.expiresAt, 'activation_expires_at');
  if (Date.parse(expiresAt) <= Date.parse(activatedAt) || Date.parse(expiresAt) > Date.parse(input.passport.payload.expiresAt)) throw new Error('activation_expiry_invalid');
  const material = {
    version: '33.15' as const,
    activationId: `shortcut-activation-${randomUUID()}`,
    passportDigest: input.passport.payload.passportDigest,
    tenantId: input.passport.payload.tenantId,
    approvedBy: input.approvedBy,
    approvedScopes,
    activatedAt,
    expiresAt,
    activationCeiling: 'limited-revocable' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, activationDigest: sha256(material) }, input.signer);
}

export function routeAdaptiveExecutionV33_15(input: {
  readonly passport: SignedEnvelope<ShortcutPassportV33_15>;
  readonly passportRegistry: KeyRegistry;
  readonly trustedPassportIssuerIds: readonly string[];
  readonly activation: SignedEnvelope<ShortcutActivationV33_15>;
  readonly activationRegistry: KeyRegistry;
  readonly trustedActivationSignerIds: readonly string[];
  readonly currentBoundary: WorkflowBoundaryV33_15;
  readonly inputClassDigest: string;
  readonly revocations?: readonly SignedEnvelope<ShortcutRevocationV33_15>[];
  readonly revocationRegistry?: KeyRegistry;
  readonly trustedRevocationSignerIds?: readonly string[];
  readonly now?: Date;
}): ShortcutRoutingDecisionV33_15 {
  const now = input.now ?? new Date();
  let route: ShortcutRouteV33_15 = 'FULL_GOVERNED_WORKFLOW';
  let reason: ShortcutRoutingDecisionV33_15['reason'] = 'PASSPORT_INVALID';
  const passport = input.passport.payload;
  if (!verifyShortcutPassportV33_15({ envelope: input.passport, registry: input.passportRegistry, trustedIssuerIds: input.trustedPassportIssuerIds, now })) {
    reason = now.getTime() >= Date.parse(passport.expiresAt) ? 'EXPIRED' : 'PASSPORT_INVALID';
  } else if (!verifyActivation(input.activation, input.activationRegistry, input.trustedActivationSignerIds, passport, now)) {
    reason = 'ACTIVATION_INVALID';
  } else if (hasValidRevocation(input.revocations ?? [], input.revocationRegistry, input.trustedRevocationSignerIds, passport.passportDigest)) {
    reason = 'REVOKED';
  } else if (input.currentBoundary.riskClass === 'high' || input.currentBoundary.riskClass === 'critical') {
    reason = 'RISK_TOO_HIGH';
  } else if (!input.currentBoundary.reversible) {
    reason = 'NOT_REVERSIBLE';
  } else if (!boundaryMatchesPassport(input.currentBoundary, input.inputClassDigest, passport, input.activation.payload.approvedScopes)) {
    reason = 'BOUNDARY_DRIFT';
  } else {
    route = 'QUALIFIED_SHORTCUT_SHADOW';
    reason = 'QUALIFIED_AND_ACTIVATED';
  }
  const material = {
    version: '33.15' as const,
    decisionId: `shortcut-route-${randomUUID()}`,
    passportDigest: passport.passportDigest,
    route,
    reason,
    evaluatedAt: requireDate(now.toISOString(), 'route_evaluated_at'),
    authorityExpanded: false as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, decisionDigest: sha256(material) };
}

export function createShortcutRevocationV33_15(input: {
  readonly passport: SignedEnvelope<ShortcutPassportV33_15>;
  readonly reason: ShortcutRevocationV33_15['reason'];
  readonly evidence: unknown;
  readonly signer: SigningIdentity;
  readonly now?: Date;
}): SignedEnvelope<ShortcutRevocationV33_15> {
  const material = {
    version: '33.15' as const,
    revocationId: `shortcut-revocation-${randomUUID()}`,
    passportDigest: input.passport.payload.passportDigest,
    tenantId: input.passport.payload.tenantId,
    reason: input.reason,
    evidenceDigest: sha256(input.evidence),
    revokedAt: requireDate((input.now ?? new Date()).toISOString(), 'revoked_at'),
    fallbackRoute: 'FULL_GOVERNED_WORKFLOW' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, revocationDigest: sha256(material) }, input.signer);
}

export function detectShortcutDriftV33_15(input: {
  readonly passport: SignedEnvelope<ShortcutPassportV33_15>;
  readonly currentBoundary: WorkflowBoundaryV33_15;
  readonly inputClassDigest: string;
  readonly observedShortcutResultDigest?: string;
}): ShortcutRevocationV33_15['reason'] | undefined {
  const passport = input.passport.payload;
  if (input.currentBoundary.authorityGrantDigest !== passport.authorityGrantDigest) return 'AUTHORITY_DRIFT';
  if (!sameScopes(input.currentBoundary.allowedScopes, passport.allowedScopes)) return 'SCOPE_DRIFT';
  if (input.currentBoundary.policyDigest !== passport.policyDigest) return 'POLICY_DRIFT';
  if (input.currentBoundary.inputSchemaDigest !== passport.inputSchemaDigest || input.inputClassDigest !== passport.inputClassDigest) return 'INPUT_SCHEMA_DRIFT';
  if (input.currentBoundary.toolchainDigest !== passport.toolchainDigest) return 'TOOLCHAIN_DRIFT';
  if (input.currentBoundary.modelSetDigest !== passport.modelSetDigest) return 'MODEL_SET_DRIFT';
  if (input.observedShortcutResultDigest !== undefined && input.observedShortcutResultDigest !== passport.projectedResultDigest) return 'RESULT_MISMATCH';
  return undefined;
}

function verifyActivation(envelope: SignedEnvelope<ShortcutActivationV33_15>, registry: KeyRegistry, trustedSignerIds: readonly string[], passport: ShortcutPassportV33_15, now: Date): boolean {
  const payload = envelope.payload;
  const { activationDigest, ...material } = payload;
  return trustedSignerIds.includes(envelope.issuerKeyId)
    && registry.verifyAt(envelope, payload.activatedAt)
    && payload.passportDigest === passport.passportDigest
    && payload.tenantId === passport.tenantId
    && payload.activationCeiling === 'limited-revocable'
    && payload.externalEffectsExecuted === 0
    && Date.parse(payload.activatedAt) <= now.getTime()
    && now.getTime() < Date.parse(payload.expiresAt)
    && Date.parse(payload.expiresAt) <= Date.parse(passport.expiresAt)
    && isSubset(payload.approvedScopes, passport.allowedScopes)
    && sha256(material) === activationDigest;
}

function hasValidRevocation(envelopes: readonly SignedEnvelope<ShortcutRevocationV33_15>[], registry: KeyRegistry | undefined, trustedSignerIds: readonly string[] | undefined, passportDigest: string): boolean {
  if (envelopes.length === 0) return false;
  if (registry === undefined || trustedSignerIds === undefined) return true;
  return envelopes.some((envelope) => {
    const { revocationDigest, ...material } = envelope.payload;
    return trustedSignerIds.includes(envelope.issuerKeyId)
      && envelope.payload.passportDigest === passportDigest
      && envelope.payload.fallbackRoute === 'FULL_GOVERNED_WORKFLOW'
      && envelope.payload.externalEffectsExecuted === 0
      && registry.verifyAt(envelope, envelope.payload.revokedAt)
      && sha256(material) === revocationDigest;
  });
}

function boundaryMatchesPassport(boundary: WorkflowBoundaryV33_15, inputClassDigest: string, passport: ShortcutPassportV33_15, approvedScopes: readonly string[]): boolean {
  try { validateBoundary(boundary); } catch { return false; }
  return boundary.tenantId === passport.tenantId
    && boundary.workflowType === passport.workflowType
    && boundary.authorityGrantDigest === passport.authorityGrantDigest
    && sameScopes(boundary.allowedScopes, passport.allowedScopes)
    && isSubset(boundary.allowedScopes, approvedScopes)
    && boundary.policyDigest === passport.policyDigest
    && boundary.inputSchemaDigest === passport.inputSchemaDigest
    && boundary.toolchainDigest === passport.toolchainDigest
    && boundary.modelSetDigest === passport.modelSetDigest
    && boundary.riskClass !== 'high'
    && boundary.riskClass !== 'critical'
    && boundary.reversible
    && inputClassDigest === passport.inputClassDigest;
}

function assertObservationMatchesCandidate(observation: WorkflowObservationV33_15, candidate: ExecutionShortcutCandidateV33_15): void {
  if (digestBoundary(observation.boundary) !== candidate.boundaryDigest) throw new Error('observation_boundary_mismatch');
  if (observation.inputClassDigest !== candidate.inputClassDigest) throw new Error('observation_input_class_mismatch');
  if (observation.externalEffectsExecuted !== 0) throw new Error('observation_external_effect_forbidden');
}

function verifyShadowComparison(comparison: ShadowComparisonV33_15): boolean {
  const { comparisonDigest, ...material } = comparison;
  return comparison.externalEffectsExecuted === 0 && sha256(material) === comparisonDigest;
}

function validateUniqueObservations(observations: readonly WorkflowObservationV33_15[]): void {
  const ids = new Set<string>();
  const digests = new Set<string>();
  for (const observation of observations) {
    if (ids.has(observation.observationId)) throw new Error('duplicate_observation_id');
    if (digests.has(observation.observationDigest)) throw new Error('duplicate_observation_digest');
    ids.add(observation.observationId);
    digests.add(observation.observationDigest);
  }
}

function validateBoundary(boundary: WorkflowBoundaryV33_15): void {
  requireId(boundary.tenantId, 'tenant_id');
  requireId(boundary.workflowType, 'workflow_type');
  requireDigest(boundary.authorityGrantDigest, 'authority_grant_digest');
  normalizeScopes(boundary.allowedScopes);
  requireDigest(boundary.policyDigest, 'policy_digest');
  requireDigest(boundary.inputSchemaDigest, 'input_schema_digest');
  requireDigest(boundary.toolchainDigest, 'toolchain_digest');
  requireDigest(boundary.modelSetDigest, 'model_set_digest');
}

function digestBoundary(boundary: WorkflowBoundaryV33_15): string {
  validateBoundary(boundary);
  return sha256({ ...boundary, allowedScopes: normalizeScopes(boundary.allowedScopes) });
}

function normalizeScopes(scopes: readonly string[]): readonly string[] {
  if (scopes.length === 0) throw new Error('scopes_required');
  const normalized = scopes.map((scope) => scope.trim());
  if (normalized.some((scope) => scope === '' || scope === '*')) throw new Error('scope_invalid');
  const unique = [...new Set(normalized)].sort();
  if (unique.length !== normalized.length) throw new Error('duplicate_scope');
  return unique;
}

function sameScopes(left: readonly string[], right: readonly string[]): boolean {
  try { return sha256(normalizeScopes(left)) === sha256(normalizeScopes(right)); } catch { return false; }
}

function isSubset(left: readonly string[], right: readonly string[]): boolean {
  const available = new Set(normalizeScopes(right));
  return normalizeScopes(left).every((scope) => available.has(scope));
}

function requireId(value: string, name: string): string {
  if (value.trim() === '') throw new Error(`${name}_required`);
  return value;
}

function requireDigest(value: string, name: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${name}_invalid`);
  return value;
}

function requireDate(value: string, name: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${name}_invalid`);
  return new Date(value).toISOString();
}

function requireNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name}_invalid`);
}

function requireNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name}_invalid`);
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name}_invalid`);
}
