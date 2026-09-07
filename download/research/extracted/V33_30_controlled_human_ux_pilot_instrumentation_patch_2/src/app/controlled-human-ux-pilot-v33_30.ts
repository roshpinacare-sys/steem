import { randomUUID } from 'node:crypto';
import {
  KeyRegistry,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';

export type UxPilotEvidenceClassV33_30 = 'SIMULATED_CONTRACT_TEST' | 'HUMAN_OBSERVED_EXTERNAL';
export type UxFlowV33_30 = 'BASELINE' | 'GOVERNED';
export type UxEventTypeV33_30 =
  | 'TASK_STARTED'
  | 'INSTRUCTION_VIEWED'
  | 'ACTION_SELECTED'
  | 'APPROVAL_VIEWED'
  | 'EXPLANATION_OPENED'
  | 'COMPREHENSION_ANSWERED'
  | 'APPROVAL_SUBMITTED'
  | 'TASK_COMPLETED'
  | 'ERROR_OBSERVED';

export type UxPilotRoleV33_30 = 'RESEARCHER' | 'INSTRUMENTATION' | 'OBSERVER' | 'VERIFIER' | 'PARTICIPANT';

export interface UxPilotRoleBindingV33_30 {
  readonly keyId: string;
  readonly role: UxPilotRoleV33_30;
  readonly organization: string;
  readonly hostId: string;
}

export interface UxPilotProtocolV33_30 {
  readonly version: '33.30';
  readonly studyId: string;
  readonly protocolVersion: string;
  readonly title: string;
  readonly purpose: 'MEASURE_CHAT_PUSH_GOVERNED_ACTION_USABILITY';
  readonly scenarios: readonly string[];
  readonly minimumParticipants: 5;
  readonly minimumDistinctScenarios: 3;
  readonly targetStepReductionPercent: 70;
  readonly maximumMedianApprovals: 1;
  readonly maximumMedianComprehensionSeconds: 10;
  readonly requiredTaskSuccessRatePercent: 100;
  readonly requiredAccessibilityPassRatePercent: 100;
  readonly requiredEvidenceClosurePercent: 100;
  readonly consentVersion: string;
  readonly allowedDataFields: readonly [
    'participant_alias_digest',
    'experience_band',
    'accessibility_accommodation_code',
    'event_timestamps',
    'derived_metrics',
  ];
  readonly rawPiiCollectionAllowed: false;
  readonly audioVideoRecordingAllowed: false;
  readonly retentionDays: number;
  readonly withdrawalAllowed: true;
  readonly researcherKeyId: string;
  readonly researcherOrganization: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionCeiling: 'shadow';
  readonly externalEffectsExecuted: 0;
  readonly protocolDigest: string;
}

export interface UxParticipantConsentV33_30 {
  readonly version: '33.30';
  readonly consentId: string;
  readonly studyId: string;
  readonly participantId: string;
  readonly participantAliasDigest: string;
  readonly experienceBand: 'NOVICE' | 'INTERMEDIATE' | 'EXPERT';
  readonly accessibilityAccommodationCode: 'NONE' | 'KEYBOARD_ONLY' | 'SCREEN_READER' | 'LARGE_TEXT' | 'OTHER_MINIMIZED';
  readonly consentVersion: string;
  readonly evidenceClass: UxPilotEvidenceClassV33_30;
  readonly consentedAt: string;
  readonly expiresAt: string;
  readonly rawPiiProvided: false;
  readonly audioVideoRecordingAllowed: false;
  readonly withdrawalAcknowledged: true;
  readonly participantKeyId: string;
  readonly consentDigest: string;
}

export interface UxParticipantWithdrawalV33_30 {
  readonly version: '33.30';
  readonly withdrawalId: string;
  readonly studyId: string;
  readonly participantId: string;
  readonly consentDigest: string;
  readonly withdrawnAt: string;
  readonly reasonCode: 'PARTICIPANT_REQUEST' | 'CONSENT_EXPIRED' | 'DATA_MINIMIZATION_REQUEST';
  readonly participantKeyId: string;
  readonly withdrawalDigest: string;
}

export interface UxPilotEventV33_30 {
  readonly eventId: string;
  readonly sequence: number;
  readonly eventType: UxEventTypeV33_30;
  readonly occurredAt: string;
  readonly userAction: boolean;
  readonly correct?: boolean;
  readonly eventDigest: string;
}

export interface InstrumentedUxFlowSessionV33_30 {
  readonly version: '33.30';
  readonly sessionId: string;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly consentDigest: string;
  readonly participantId: string;
  readonly scenarioId: string;
  readonly flow: UxFlowV33_30;
  readonly evidenceClass: UxPilotEvidenceClassV33_30;
  readonly events: readonly UxPilotEventV33_30[];
  readonly eventChainDigest: string;
  readonly instrumentationKeyId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly productionCeiling: 'shadow';
  readonly externalEffectsExecuted: 0;
  readonly sessionDigest: string;
}

export interface ParticipantSessionAttestationV33_30 {
  readonly version: '33.30';
  readonly attestationId: string;
  readonly studyId: string;
  readonly participantId: string;
  readonly sessionDigest: string;
  readonly taskCompleted: boolean;
  readonly comprehensionAnswerDigest?: string;
  readonly attestedAt: string;
  readonly participantKeyId: string;
  readonly externalEffectsExecuted: 0;
  readonly attestationDigest: string;
}

export interface ObserverUxAssessmentV33_30 {
  readonly version: '33.30';
  readonly assessmentId: string;
  readonly studyId: string;
  readonly participantId: string;
  readonly sessionDigest: string;
  readonly taskSuccess: boolean;
  readonly accessibilityPassed: boolean;
  readonly comprehensionCorrect?: boolean;
  readonly errorCount: number;
  readonly evidenceArtifactDigest: string;
  readonly evidenceClass: UxPilotEvidenceClassV33_30;
  readonly observerKeyId: string;
  readonly observerOrganization: string;
  readonly observedAt: string;
  readonly externalEffectsExecuted: 0;
  readonly assessmentDigest: string;
}

export interface UxSessionEvidenceBundleV33_30 {
  readonly session: SignedEnvelope<InstrumentedUxFlowSessionV33_30>;
  readonly participantAttestation: SignedEnvelope<ParticipantSessionAttestationV33_30>;
  readonly observerAssessment: SignedEnvelope<ObserverUxAssessmentV33_30>;
}

export interface ControlledHumanUxPilotVerdictV33_30 {
  readonly version: '33.30';
  readonly verdictId: string;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly evidenceClass: UxPilotEvidenceClassV33_30 | 'MIXED_INVALID';
  readonly participantCount: number;
  readonly distinctScenarioCount: number;
  readonly baselineSessionCount: number;
  readonly governedSessionCount: number;
  readonly medianStepReductionPercent: number;
  readonly medianGovernedApprovals: number;
  readonly medianComprehensionSeconds: number | null;
  readonly taskSuccessRatePercent: number;
  readonly accessibilityPassRatePercent: number;
  readonly comprehensionCorrectRatePercent: number;
  readonly evidenceClosurePercent: number;
  readonly unauthorizedEffectCount: 0;
  readonly humanPilotPassed: boolean;
  readonly status:
    | 'HUMAN_UX_PILOT_PASSED_SHADOW_ONLY'
    | 'HUMAN_UX_PILOT_REQUIRED'
    | 'HUMAN_UX_PILOT_FAILED_THRESHOLDS'
    | 'HUMAN_UX_PILOT_INSUFFICIENT_EVIDENCE';
  readonly blockers: readonly string[];
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

export function createUxPilotProtocolV33_30(input: {
  readonly issuer: SigningIdentity;
  readonly studyId?: string;
  readonly protocolVersion: string;
  readonly title: string;
  readonly scenarios: readonly string[];
  readonly consentVersion: string;
  readonly retentionDays: number;
  readonly researcherOrganization: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<UxPilotProtocolV33_30> {
  requireDate(input.issuedAt, 'ux_protocol_issued_at_invalid');
  requireDate(input.expiresAt, 'ux_protocol_expires_at_invalid');
  if (input.expiresAt.getTime() <= input.issuedAt.getTime()) throw new Error('ux_protocol_window_invalid');
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 90) throw new Error('ux_protocol_retention_invalid');
  const scenarios = uniqueIdentifiers(input.scenarios, 'ux_protocol_scenarios_invalid');
  if (scenarios.length < 3 || scenarios.length > 12) throw new Error('ux_protocol_scenario_count_invalid');
  const material = {
    version: '33.30' as const,
    studyId: identifier(input.studyId ?? randomUUID(), 'ux_study_id_required'),
    protocolVersion: identifier(input.protocolVersion, 'ux_protocol_version_required'),
    title: nonEmpty(input.title, 'ux_protocol_title_required'),
    purpose: 'MEASURE_CHAT_PUSH_GOVERNED_ACTION_USABILITY' as const,
    scenarios,
    minimumParticipants: 5 as const,
    minimumDistinctScenarios: 3 as const,
    targetStepReductionPercent: 70 as const,
    maximumMedianApprovals: 1 as const,
    maximumMedianComprehensionSeconds: 10 as const,
    requiredTaskSuccessRatePercent: 100 as const,
    requiredAccessibilityPassRatePercent: 100 as const,
    requiredEvidenceClosurePercent: 100 as const,
    consentVersion: identifier(input.consentVersion, 'ux_consent_version_required'),
    allowedDataFields: [
      'participant_alias_digest',
      'experience_band',
      'accessibility_accommodation_code',
      'event_timestamps',
      'derived_metrics',
    ] as const,
    rawPiiCollectionAllowed: false as const,
    audioVideoRecordingAllowed: false as const,
    retentionDays: input.retentionDays,
    withdrawalAllowed: true as const,
    researcherKeyId: input.issuer.keyId,
    researcherOrganization: identifier(input.researcherOrganization, 'ux_researcher_org_required'),
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    productionCeiling: 'shadow' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, protocolDigest: sha256(material) }, input.issuer);
}

export function createParticipantConsentV33_30(input: {
  readonly participant: SigningIdentity;
  readonly protocol: SignedEnvelope<UxPilotProtocolV33_30>;
  readonly protocolRegistry: KeyRegistry;
  readonly trustedResearcherIds: readonly string[];
  readonly participantId: string;
  readonly participantAliasDigest: string;
  readonly experienceBand: UxParticipantConsentV33_30['experienceBand'];
  readonly accessibilityAccommodationCode: UxParticipantConsentV33_30['accessibilityAccommodationCode'];
  readonly evidenceClass: UxPilotEvidenceClassV33_30;
  readonly consentedAt: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<UxParticipantConsentV33_30> {
  const protocol = verifyProtocol(input.protocol, input.protocolRegistry, input.trustedResearcherIds, input.consentedAt);
  requireDate(input.consentedAt, 'ux_consent_time_invalid');
  requireDate(input.expiresAt, 'ux_consent_expiry_invalid');
  if (input.consentedAt.getTime() < Date.parse(protocol.issuedAt) || input.expiresAt.getTime() > Date.parse(protocol.expiresAt) || input.expiresAt.getTime() <= input.consentedAt.getTime()) throw new Error('ux_consent_window_invalid');
  requireDigest(input.participantAliasDigest, 'ux_participant_alias_digest_invalid');
  if (!['NOVICE','INTERMEDIATE','EXPERT'].includes(input.experienceBand)) throw new Error('ux_experience_band_invalid');
  if (!['NONE','KEYBOARD_ONLY','SCREEN_READER','LARGE_TEXT','OTHER_MINIMIZED'].includes(input.accessibilityAccommodationCode)) throw new Error('ux_accessibility_code_invalid');
  if (!['SIMULATED_CONTRACT_TEST','HUMAN_OBSERVED_EXTERNAL'].includes(input.evidenceClass)) throw new Error('ux_evidence_class_invalid');
  const material = {
    version: '33.30' as const,
    consentId: randomUUID(),
    studyId: protocol.studyId,
    participantId: identifier(input.participantId, 'ux_participant_id_required'),
    participantAliasDigest: input.participantAliasDigest,
    experienceBand: input.experienceBand,
    accessibilityAccommodationCode: input.accessibilityAccommodationCode,
    consentVersion: protocol.consentVersion,
    evidenceClass: input.evidenceClass,
    consentedAt: input.consentedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    rawPiiProvided: false as const,
    audioVideoRecordingAllowed: false as const,
    withdrawalAcknowledged: true as const,
    participantKeyId: input.participant.keyId,
  };
  return signEnvelope({ ...material, consentDigest: sha256(material) }, input.participant);
}

export function createParticipantWithdrawalV33_30(input: {
  readonly participant: SigningIdentity;
  readonly consent: SignedEnvelope<UxParticipantConsentV33_30>;
  readonly participantRegistry: KeyRegistry;
  readonly withdrawnAt: Date;
  readonly reasonCode: UxParticipantWithdrawalV33_30['reasonCode'];
}): SignedEnvelope<UxParticipantWithdrawalV33_30> {
  const consent = verifyConsent(input.consent, input.participantRegistry, [input.participant.keyId], input.withdrawnAt);
  if (consent.participantKeyId !== input.participant.keyId) throw new Error('ux_withdrawal_participant_mismatch');
  requireDate(input.withdrawnAt, 'ux_withdrawal_time_invalid');
  if (input.withdrawnAt.getTime() < Date.parse(consent.consentedAt)) throw new Error('ux_withdrawal_before_consent');
  const material = {
    version: '33.30' as const,
    withdrawalId: randomUUID(),
    studyId: consent.studyId,
    participantId: consent.participantId,
    consentDigest: consent.consentDigest,
    withdrawnAt: input.withdrawnAt.toISOString(),
    reasonCode: input.reasonCode,
    participantKeyId: input.participant.keyId,
  };
  return signEnvelope({ ...material, withdrawalDigest: sha256(material) }, input.participant);
}

export function createInstrumentedUxFlowSessionV33_30(input: {
  readonly instrumentation: SigningIdentity;
  readonly protocol: SignedEnvelope<UxPilotProtocolV33_30>;
  readonly protocolRegistry: KeyRegistry;
  readonly trustedResearcherIds: readonly string[];
  readonly consent: SignedEnvelope<UxParticipantConsentV33_30>;
  readonly participantRegistry: KeyRegistry;
  readonly trustedParticipantIds: readonly string[];
  readonly sessionId?: string;
  readonly scenarioId: string;
  readonly flow: UxFlowV33_30;
  readonly events: readonly Omit<UxPilotEventV33_30, 'eventDigest'>[];
}): SignedEnvelope<InstrumentedUxFlowSessionV33_30> {
  const firstTime = input.events[0]?.occurredAt;
  if (firstTime === undefined) throw new Error('ux_events_required');
  const at = new Date(requireInstant(firstTime, 'ux_event_time_invalid'));
  const protocol = verifyProtocol(input.protocol, input.protocolRegistry, input.trustedResearcherIds, at);
  const consent = verifyConsent(input.consent, input.participantRegistry, input.trustedParticipantIds, at);
  if (consent.studyId !== protocol.studyId || consent.consentVersion !== protocol.consentVersion) throw new Error('ux_consent_protocol_binding_invalid');
  const scenarioId = identifier(input.scenarioId, 'ux_scenario_id_required');
  if (!protocol.scenarios.includes(scenarioId)) throw new Error('ux_scenario_not_in_protocol');
  if (!['BASELINE','GOVERNED'].includes(input.flow)) throw new Error('ux_flow_invalid');
  const events = validateAndDigestEvents(input.events, input.flow);
  const startedAt = events[0]!.occurredAt;
  const completedAt = events.at(-1)!.occurredAt;
  if (Date.parse(completedAt) >= Date.parse(consent.expiresAt)) throw new Error('ux_session_after_consent_expiry');
  const material = {
    version: '33.30' as const,
    sessionId: identifier(input.sessionId ?? randomUUID(), 'ux_session_id_required'),
    studyId: protocol.studyId,
    protocolDigest: protocol.protocolDigest,
    consentDigest: consent.consentDigest,
    participantId: consent.participantId,
    scenarioId,
    flow: input.flow,
    evidenceClass: consent.evidenceClass,
    events,
    eventChainDigest: chainDigest(events.map((event) => event.eventDigest)),
    instrumentationKeyId: input.instrumentation.keyId,
    startedAt,
    completedAt,
    productionCeiling: 'shadow' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, sessionDigest: sha256(material) }, input.instrumentation);
}

export function createParticipantSessionAttestationV33_30(input: {
  readonly participant: SigningIdentity;
  readonly session: SignedEnvelope<InstrumentedUxFlowSessionV33_30>;
  readonly sessionRegistry: KeyRegistry;
  readonly trustedInstrumentationIds: readonly string[];
  readonly taskCompleted: boolean;
  readonly comprehensionAnswerDigest?: string;
  readonly attestedAt: Date;
}): SignedEnvelope<ParticipantSessionAttestationV33_30> {
  const session = verifySession(input.session, input.sessionRegistry, input.trustedInstrumentationIds, input.attestedAt);
  requireDate(input.attestedAt, 'ux_attestation_time_invalid');
  if (input.attestedAt.getTime() < Date.parse(session.completedAt)) throw new Error('ux_attestation_before_completion');
  if (session.flow === 'GOVERNED') requireDigest(input.comprehensionAnswerDigest, 'ux_comprehension_answer_digest_required');
  if (session.flow === 'BASELINE' && input.comprehensionAnswerDigest !== undefined) throw new Error('ux_baseline_comprehension_answer_forbidden');
  const material = {
    version: '33.30' as const,
    attestationId: randomUUID(),
    studyId: session.studyId,
    participantId: session.participantId,
    sessionDigest: session.sessionDigest,
    taskCompleted: input.taskCompleted,
    ...(input.comprehensionAnswerDigest === undefined ? {} : { comprehensionAnswerDigest: input.comprehensionAnswerDigest }),
    attestedAt: input.attestedAt.toISOString(),
    participantKeyId: input.participant.keyId,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, attestationDigest: sha256(material) }, input.participant);
}

export function createObserverUxAssessmentV33_30(input: {
  readonly observer: SigningIdentity;
  readonly observerOrganization: string;
  readonly session: SignedEnvelope<InstrumentedUxFlowSessionV33_30>;
  readonly sessionRegistry: KeyRegistry;
  readonly trustedInstrumentationIds: readonly string[];
  readonly taskSuccess: boolean;
  readonly accessibilityPassed: boolean;
  readonly comprehensionCorrect?: boolean;
  readonly evidenceArtifactDigest: string;
  readonly observedAt: Date;
}): SignedEnvelope<ObserverUxAssessmentV33_30> {
  const session = verifySession(input.session, input.sessionRegistry, input.trustedInstrumentationIds, input.observedAt);
  requireDate(input.observedAt, 'ux_observation_time_invalid');
  if (input.observedAt.getTime() < Date.parse(session.completedAt)) throw new Error('ux_observation_before_completion');
  requireDigest(input.evidenceArtifactDigest, 'ux_evidence_artifact_digest_invalid');
  if (session.flow === 'GOVERNED' && typeof input.comprehensionCorrect !== 'boolean') throw new Error('ux_governed_comprehension_assessment_required');
  if (session.flow === 'BASELINE' && input.comprehensionCorrect !== undefined) throw new Error('ux_baseline_comprehension_assessment_forbidden');
  const material = {
    version: '33.30' as const,
    assessmentId: randomUUID(),
    studyId: session.studyId,
    participantId: session.participantId,
    sessionDigest: session.sessionDigest,
    taskSuccess: input.taskSuccess,
    accessibilityPassed: input.accessibilityPassed,
    ...(input.comprehensionCorrect === undefined ? {} : { comprehensionCorrect: input.comprehensionCorrect }),
    errorCount: session.events.filter((event) => event.eventType === 'ERROR_OBSERVED').length,
    evidenceArtifactDigest: input.evidenceArtifactDigest,
    evidenceClass: session.evidenceClass,
    observerKeyId: input.observer.keyId,
    observerOrganization: identifier(input.observerOrganization, 'ux_observer_org_required'),
    observedAt: input.observedAt.toISOString(),
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, assessmentDigest: sha256(material) }, input.observer);
}

export function evaluateControlledHumanUxPilotV33_30(input: {
  readonly verifier: SigningIdentity;
  readonly protocol: SignedEnvelope<UxPilotProtocolV33_30>;
  readonly protocolRegistry: KeyRegistry;
  readonly trustedResearcherIds: readonly string[];
  readonly participantRegistry: KeyRegistry;
  readonly trustedParticipantIds: readonly string[];
  readonly instrumentationRegistry: KeyRegistry;
  readonly trustedInstrumentationIds: readonly string[];
  readonly observerRegistry: KeyRegistry;
  readonly trustedObserverIds: readonly string[];
  readonly roleBindings: readonly UxPilotRoleBindingV33_30[];
  readonly consents: readonly SignedEnvelope<UxParticipantConsentV33_30>[];
  readonly withdrawals?: readonly SignedEnvelope<UxParticipantWithdrawalV33_30>[];
  readonly baselineEvidence: readonly UxSessionEvidenceBundleV33_30[];
  readonly governedEvidence: readonly UxSessionEvidenceBundleV33_30[];
  readonly generatedAt: Date;
}): SignedEnvelope<ControlledHumanUxPilotVerdictV33_30> {
  const protocol = verifyProtocol(input.protocol, input.protocolRegistry, input.trustedResearcherIds, input.generatedAt);
  requireDate(input.generatedAt, 'ux_verdict_time_invalid');
  const bindings = validateRoleBindings(input.roleBindings, protocol, input.verifier.keyId);
  const consentRows = new Map<string, UxParticipantConsentV33_30>();
  for (const envelope of input.consents) {
    const consent = verifyConsent(envelope, input.participantRegistry, input.trustedParticipantIds, input.generatedAt);
    if (consent.studyId !== protocol.studyId) throw new Error('ux_consent_study_mismatch');
    if (consentRows.has(consent.participantId)) throw new Error('ux_consent_participant_duplicate');
    const binding = bindings.get(consent.participantKeyId);
    if (binding?.role !== 'PARTICIPANT') throw new Error('ux_participant_role_binding_invalid');
    consentRows.set(consent.participantId, consent);
  }
  const withdrawn = new Set<string>();
  for (const envelope of input.withdrawals ?? []) {
    const participantId = envelope.payload.participantId;
    const consent = consentRows.get(participantId);
    if (consent === undefined) throw new Error('ux_withdrawal_without_consent');
    const verified = verifyWithdrawal(envelope, input.participantRegistry, [consent.participantKeyId], input.generatedAt);
    if (verified.studyId !== protocol.studyId || verified.consentDigest !== consent.consentDigest) throw new Error('ux_withdrawal_binding_invalid');
    withdrawn.add(participantId);
  }
  const evidenceArtifacts = new Set<string>();
  const baselines = verifyBundles(input.baselineEvidence, 'BASELINE', protocol, consentRows, withdrawn, input, bindings, evidenceArtifacts);
  const governed = verifyBundles(input.governedEvidence, 'GOVERNED', protocol, consentRows, withdrawn, input, bindings, evidenceArtifacts);
  const baselineByParticipant = uniqueByParticipant(baselines, 'ux_baseline_participant_duplicate');
  const governedByParticipant = uniqueByParticipant(governed, 'ux_governed_participant_duplicate');
  const participantIds = [...new Set([...baselineByParticipant.keys(), ...governedByParticipant.keys()])].sort();
  const paired: Array<{ baseline: VerifiedBundle; governed: VerifiedBundle }> = [];
  for (const participantId of participantIds) {
    const baseline = baselineByParticipant.get(participantId);
    const controlled = governedByParticipant.get(participantId);
    if (baseline === undefined || controlled === undefined) continue;
    if (baseline.session.scenarioId !== controlled.session.scenarioId) throw new Error('ux_paired_scenario_mismatch');
    if (baseline.session.evidenceClass !== controlled.session.evidenceClass) throw new Error('ux_paired_evidence_class_mismatch');
    paired.push({ baseline, governed: controlled });
  }
  const classes = new Set(paired.flatMap((pair) => [pair.baseline.session.evidenceClass, pair.governed.session.evidenceClass]));
  const evidenceClass: ControlledHumanUxPilotVerdictV33_30['evidenceClass'] = classes.size === 1 ? [...classes][0]! : 'MIXED_INVALID';
  const stepReductions = paired.map(({ baseline, governed: controlled }) => round1(((baseline.userSteps - controlled.userSteps) / baseline.userSteps) * 100));
  const approvals = paired.map(({ governed: controlled }) => controlled.approvals);
  const comprehensionSeconds = paired.map(({ governed: controlled }) => controlled.comprehensionSeconds).filter((value): value is number => value !== null);
  const taskSuccessCount = paired.filter((pair) => pair.baseline.success && pair.governed.success).length;
  const accessibilityCount = paired.filter((pair) => pair.baseline.accessibilityPassed && pair.governed.accessibilityPassed).length;
  const comprehensionCorrectCount = paired.filter((pair) => pair.governed.comprehensionCorrect).length;
  const closedEvidenceCount = paired.filter((pair) => pair.baseline.closed && pair.governed.closed).length;
  const participantCount = paired.length;
  const distinctScenarioCount = new Set(paired.map((pair) => pair.governed.session.scenarioId)).size;
  const medianStepReductionPercent = median(stepReductions);
  const medianGovernedApprovals = median(approvals);
  const medianComprehensionSeconds = comprehensionSeconds.length === 0 ? null : median(comprehensionSeconds);
  const taskSuccessRatePercent = percent(taskSuccessCount, participantCount);
  const accessibilityPassRatePercent = percent(accessibilityCount, participantCount);
  const comprehensionCorrectRatePercent = percent(comprehensionCorrectCount, participantCount);
  const evidenceClosurePercent = percent(closedEvidenceCount, participantCount);
  const blockers: string[] = [];
  if (participantCount < protocol.minimumParticipants) blockers.push('minimum_participants_not_met');
  if (distinctScenarioCount < protocol.minimumDistinctScenarios) blockers.push('minimum_distinct_scenarios_not_met');
  if (medianStepReductionPercent < protocol.targetStepReductionPercent) blockers.push('step_reduction_target_not_met');
  if (medianGovernedApprovals > protocol.maximumMedianApprovals) blockers.push('approval_count_target_not_met');
  if (medianComprehensionSeconds === null || medianComprehensionSeconds > protocol.maximumMedianComprehensionSeconds) blockers.push('comprehension_time_target_not_met');
  if (taskSuccessRatePercent !== protocol.requiredTaskSuccessRatePercent) blockers.push('task_success_target_not_met');
  if (accessibilityPassRatePercent !== protocol.requiredAccessibilityPassRatePercent) blockers.push('accessibility_target_not_met');
  if (comprehensionCorrectRatePercent !== 100) blockers.push('comprehension_correctness_target_not_met');
  if (evidenceClosurePercent !== protocol.requiredEvidenceClosurePercent) blockers.push('evidence_closure_target_not_met');
  if (withdrawn.size > 0) blockers.push('withdrawn_participant_evidence_excluded');
  if (evidenceClass !== 'HUMAN_OBSERVED_EXTERNAL') blockers.push('external_human_observation_required');
  const thresholdsPassed = blockers.filter((b) => b !== 'withdrawn_participant_evidence_excluded' && b !== 'external_human_observation_required').length === 0;
  const humanPilotPassed = evidenceClass === 'HUMAN_OBSERVED_EXTERNAL' && thresholdsPassed;
  let status: ControlledHumanUxPilotVerdictV33_30['status'];
  if (humanPilotPassed) status = 'HUMAN_UX_PILOT_PASSED_SHADOW_ONLY';
  else if (evidenceClass !== 'HUMAN_OBSERVED_EXTERNAL') status = 'HUMAN_UX_PILOT_REQUIRED';
  else if (participantCount < protocol.minimumParticipants) status = 'HUMAN_UX_PILOT_INSUFFICIENT_EVIDENCE';
  else status = 'HUMAN_UX_PILOT_FAILED_THRESHOLDS';
  const material = {
    version: '33.30' as const,
    verdictId: randomUUID(),
    studyId: protocol.studyId,
    protocolDigest: protocol.protocolDigest,
    evidenceClass,
    participantCount,
    distinctScenarioCount,
    baselineSessionCount: baselines.length,
    governedSessionCount: governed.length,
    medianStepReductionPercent,
    medianGovernedApprovals,
    medianComprehensionSeconds,
    taskSuccessRatePercent,
    accessibilityPassRatePercent,
    comprehensionCorrectRatePercent,
    evidenceClosurePercent,
    unauthorizedEffectCount: 0 as const,
    humanPilotPassed,
    status,
    blockers: [...new Set(blockers)].sort(),
    generatedAt: input.generatedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, verdictDigest: sha256(material) }, input.verifier);
}

export function verifyControlledHumanUxPilotVerdictV33_30(input: {
  readonly verdict: SignedEnvelope<ControlledHumanUxPilotVerdictV33_30>;
  readonly verifierRegistry: KeyRegistry;
  readonly trustedVerifierIds: readonly string[];
  readonly expectedProtocolDigest: string;
}): ControlledHumanUxPilotVerdictV33_30 {
  if (!input.trustedVerifierIds.includes(input.verdict.issuerKeyId) || !input.verifierRegistry.verifyAt(input.verdict, input.verdict.payload.generatedAt)) throw new Error('ux_verdict_signature_invalid');
  const payload = input.verdict.payload;
  if (payload.protocolDigest !== input.expectedProtocolDigest) throw new Error('ux_verdict_protocol_binding_invalid');
  const { verdictDigest, ...material } = payload;
  if (verdictDigest !== sha256(material)) throw new Error('ux_verdict_digest_invalid');
  if (payload.productionAuthority !== 'NONE' || payload.externalEffectsExecuted !== 0 || payload.unauthorizedEffectCount !== 0) throw new Error('ux_verdict_boundary_invalid');
  if (payload.evidenceClass !== 'HUMAN_OBSERVED_EXTERNAL' && payload.humanPilotPassed) throw new Error('ux_synthetic_verdict_cannot_pass');
  return structuredClone(payload);
}

type EvaluationInput = Parameters<typeof evaluateControlledHumanUxPilotV33_30>[0];
interface VerifiedBundle {
  readonly session: InstrumentedUxFlowSessionV33_30;
  readonly userSteps: number;
  readonly approvals: number;
  readonly comprehensionSeconds: number | null;
  readonly success: boolean;
  readonly accessibilityPassed: boolean;
  readonly comprehensionCorrect: boolean;
  readonly closed: boolean;
}

function verifyBundles(
  bundles: readonly UxSessionEvidenceBundleV33_30[],
  flow: UxFlowV33_30,
  protocol: UxPilotProtocolV33_30,
  consents: ReadonlyMap<string, UxParticipantConsentV33_30>,
  withdrawn: ReadonlySet<string>,
  input: EvaluationInput,
  bindings: ReadonlyMap<string, UxPilotRoleBindingV33_30>,
  evidenceArtifacts: Set<string>,
): VerifiedBundle[] {
  const sessionIds = new Set<string>();
  return bundles.flatMap((bundle) => {
    const session = verifySession(bundle.session, input.instrumentationRegistry, input.trustedInstrumentationIds, input.generatedAt);
    if (session.flow !== flow || session.studyId !== protocol.studyId || session.protocolDigest !== protocol.protocolDigest) throw new Error('ux_session_protocol_or_flow_invalid');
    if (sessionIds.has(session.sessionId)) throw new Error('ux_session_duplicate');
    sessionIds.add(session.sessionId);
    const consent = consents.get(session.participantId);
    if (consent === undefined || consent.consentDigest !== session.consentDigest) throw new Error('ux_session_consent_binding_invalid');
    if (withdrawn.has(session.participantId)) return [];
    const participantAttestation = verifyParticipantAttestation(bundle.participantAttestation, input.participantRegistry, [consent.participantKeyId], input.generatedAt);
    if (participantAttestation.sessionDigest !== session.sessionDigest || participantAttestation.participantId !== session.participantId) throw new Error('ux_attestation_session_binding_invalid');
    const observerAssessment = verifyObserverAssessment(bundle.observerAssessment, input.observerRegistry, input.trustedObserverIds, input.generatedAt);
    if (observerAssessment.sessionDigest !== session.sessionDigest || observerAssessment.participantId !== session.participantId || observerAssessment.evidenceClass !== session.evidenceClass) throw new Error('ux_observer_session_binding_invalid');
    if (evidenceArtifacts.has(observerAssessment.evidenceArtifactDigest)) throw new Error('ux_evidence_artifact_duplicate');
    evidenceArtifacts.add(observerAssessment.evidenceArtifactDigest);
    const observerBinding = bindings.get(observerAssessment.observerKeyId);
    const instrumentBinding = bindings.get(session.instrumentationKeyId);
    const participantBinding = bindings.get(consent.participantKeyId);
    if (observerBinding?.role !== 'OBSERVER' || instrumentBinding?.role !== 'INSTRUMENTATION' || participantBinding?.role !== 'PARTICIPANT') throw new Error('ux_role_binding_invalid');
    if (observerBinding.organization === protocol.researcherOrganization || observerBinding.keyId === protocol.researcherKeyId || observerBinding.organization === instrumentBinding.organization) throw new Error('ux_observer_independence_invalid');
    if ([protocol.researcherKeyId, session.instrumentationKeyId, observerAssessment.observerKeyId, input.verifier.keyId].includes(consent.participantKeyId)) throw new Error('ux_participant_staff_overlap');
    const comprehension = deriveComprehensionSeconds(session);
    const userSteps = session.events.filter((event) => event.userAction).length;
    if (userSteps <= 0) throw new Error('ux_user_steps_invalid');
    const approvals = session.events.filter((event) => event.eventType === 'APPROVAL_SUBMITTED').length;
    const eventCorrect = session.events.find((event) => event.eventType === 'COMPREHENSION_ANSWERED')?.correct;
    if (flow === 'GOVERNED' && (eventCorrect !== observerAssessment.comprehensionCorrect || participantAttestation.comprehensionAnswerDigest === undefined)) throw new Error('ux_comprehension_evidence_inconsistent');
    const completed = session.events.at(-1)?.eventType === 'TASK_COMPLETED';
    const success = completed && participantAttestation.taskCompleted && observerAssessment.taskSuccess && observerAssessment.errorCount === 0;
    return [{ session, userSteps, approvals, comprehensionSeconds: comprehension, success, accessibilityPassed: observerAssessment.accessibilityPassed, comprehensionCorrect: flow === 'BASELINE' ? true : observerAssessment.comprehensionCorrect === true, closed: true }];
  });
}

function validateRoleBindings(bindings: readonly UxPilotRoleBindingV33_30[], protocol: UxPilotProtocolV33_30, verifierKeyId: string): Map<string, UxPilotRoleBindingV33_30> {
  const map = new Map<string, UxPilotRoleBindingV33_30>();
  for (const binding of bindings) {
    identifier(binding.keyId, 'ux_role_key_required');
    identifier(binding.organization, 'ux_role_org_required');
    identifier(binding.hostId, 'ux_role_host_required');
    if (map.has(binding.keyId)) throw new Error('ux_role_key_duplicate');
    map.set(binding.keyId, binding);
  }
  if (map.get(protocol.researcherKeyId)?.role !== 'RESEARCHER') throw new Error('ux_researcher_role_missing');
  if (map.get(verifierKeyId)?.role !== 'VERIFIER') throw new Error('ux_verifier_role_missing');
  const staff = [...map.values()].filter((b) => b.role !== 'PARTICIPANT');
  if (new Set(staff.map((b) => b.keyId)).size !== staff.length) throw new Error('ux_staff_key_overlap');
  const verifier = map.get(verifierKeyId)!;
  const researcher = map.get(protocol.researcherKeyId)!;
  if (verifier.organization === researcher.organization || verifier.hostId === researcher.hostId) throw new Error('ux_verifier_researcher_separation_invalid');
  return map;
}

function validateAndDigestEvents(events: readonly Omit<UxPilotEventV33_30, 'eventDigest'>[], flow: UxFlowV33_30): UxPilotEventV33_30[] {
  if (events.length < 3 || events.length > 100) throw new Error('ux_event_count_invalid');
  const ids = new Set<string>();
  let last = -Infinity;
  const rows = events.map((event, index) => {
    if (event.sequence !== index + 1) throw new Error('ux_event_sequence_invalid');
    if (ids.has(event.eventId)) throw new Error('ux_event_id_duplicate');
    ids.add(identifier(event.eventId, 'ux_event_id_required'));
    const time = requireInstant(event.occurredAt, 'ux_event_time_invalid');
    if (time < last) throw new Error('ux_event_time_not_monotonic');
    last = time;
    if (event.eventType === 'COMPREHENSION_ANSWERED' && typeof event.correct !== 'boolean') throw new Error('ux_comprehension_correct_required');
    if (event.eventType !== 'COMPREHENSION_ANSWERED' && event.correct !== undefined) throw new Error('ux_event_correct_field_forbidden');
    const material = { eventId: event.eventId, sequence: event.sequence, eventType: event.eventType, occurredAt: event.occurredAt, userAction: event.userAction, ...(event.correct === undefined ? {} : { correct: event.correct }) };
    return { ...material, eventDigest: sha256(material) };
  });
  if (rows[0]!.eventType !== 'TASK_STARTED' || rows.at(-1)!.eventType !== 'TASK_COMPLETED') throw new Error('ux_event_boundary_invalid');
  const approvalViews = rows.filter((event) => event.eventType === 'APPROVAL_VIEWED').length;
  const comprehension = rows.filter((event) => event.eventType === 'COMPREHENSION_ANSWERED').length;
  const approvals = rows.filter((event) => event.eventType === 'APPROVAL_SUBMITTED').length;
  if (flow === 'BASELINE' && (approvalViews !== 0 || comprehension !== 0 || approvals !== 0)) throw new Error('ux_baseline_approval_events_forbidden');
  if (flow === 'GOVERNED' && (approvalViews !== 1 || comprehension !== 1 || approvals < 0 || approvals > 2)) throw new Error('ux_governed_event_shape_invalid');
  return rows;
}

function deriveComprehensionSeconds(session: InstrumentedUxFlowSessionV33_30): number | null {
  if (session.flow === 'BASELINE') return null;
  const viewed = session.events.find((event) => event.eventType === 'APPROVAL_VIEWED');
  const answered = session.events.find((event) => event.eventType === 'COMPREHENSION_ANSWERED');
  if (viewed === undefined || answered === undefined) throw new Error('ux_comprehension_events_missing');
  const seconds = (Date.parse(answered.occurredAt) - Date.parse(viewed.occurredAt)) / 1000;
  if (seconds < 0 || seconds > 300) throw new Error('ux_comprehension_duration_invalid');
  return round1(seconds);
}

function verifyProtocol(envelope: SignedEnvelope<UxPilotProtocolV33_30>, registry: KeyRegistry, trusted: readonly string[], at: Date): UxPilotProtocolV33_30 {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, at)) throw new Error('ux_protocol_signature_invalid');
  const payload = envelope.payload;
  const { protocolDigest, ...material } = payload;
  if (protocolDigest !== sha256(material)) throw new Error('ux_protocol_digest_invalid');
  if (at.getTime() < Date.parse(payload.issuedAt) || at.getTime() >= Date.parse(payload.expiresAt)) throw new Error('ux_protocol_not_active');
  if (payload.rawPiiCollectionAllowed || payload.audioVideoRecordingAllowed || payload.externalEffectsExecuted !== 0 || payload.productionCeiling !== 'shadow') throw new Error('ux_protocol_boundary_invalid');
  return payload;
}
function verifyConsent(envelope: SignedEnvelope<UxParticipantConsentV33_30>, registry: KeyRegistry, trusted: readonly string[], at: Date): UxParticipantConsentV33_30 {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, at)) throw new Error('ux_consent_signature_invalid');
  const payload = envelope.payload;
  const { consentDigest, ...material } = payload;
  if (consentDigest !== sha256(material)) throw new Error('ux_consent_digest_invalid');
  if (payload.participantKeyId !== envelope.issuerKeyId || payload.rawPiiProvided || payload.audioVideoRecordingAllowed) throw new Error('ux_consent_boundary_invalid');
  if (at.getTime() >= Date.parse(payload.expiresAt)) throw new Error('ux_consent_expired');
  return payload;
}
function verifyWithdrawal(envelope: SignedEnvelope<UxParticipantWithdrawalV33_30>, registry: KeyRegistry, trusted: readonly string[], at: Date): UxParticipantWithdrawalV33_30 {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, at)) throw new Error('ux_withdrawal_signature_invalid');
  const payload = envelope.payload;
  const { withdrawalDigest, ...material } = payload;
  if (withdrawalDigest !== sha256(material) || payload.participantKeyId !== envelope.issuerKeyId) throw new Error('ux_withdrawal_digest_invalid');
  return payload;
}
function verifySession(envelope: SignedEnvelope<InstrumentedUxFlowSessionV33_30>, registry: KeyRegistry, trusted: readonly string[], at: Date): InstrumentedUxFlowSessionV33_30 {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, at)) throw new Error('ux_session_signature_invalid');
  const payload = envelope.payload;
  const { sessionDigest, ...material } = payload;
  if (sessionDigest !== sha256(material)) throw new Error('ux_session_digest_invalid');
  if (payload.instrumentationKeyId !== envelope.issuerKeyId || payload.eventChainDigest !== chainDigest(payload.events.map((event) => event.eventDigest))) throw new Error('ux_session_chain_invalid');
  for (const event of payload.events) { const { eventDigest, ...eventMaterial } = event; if (eventDigest !== sha256(eventMaterial)) throw new Error('ux_event_digest_invalid'); }
  if (payload.externalEffectsExecuted !== 0 || payload.productionCeiling !== 'shadow') throw new Error('ux_session_boundary_invalid');
  return payload;
}
function verifyParticipantAttestation(envelope: SignedEnvelope<ParticipantSessionAttestationV33_30>, registry: KeyRegistry, trusted: readonly string[], at: Date): ParticipantSessionAttestationV33_30 {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, at)) throw new Error('ux_attestation_signature_invalid');
  const payload = envelope.payload; const { attestationDigest, ...material } = payload;
  if (attestationDigest !== sha256(material) || payload.participantKeyId !== envelope.issuerKeyId || payload.externalEffectsExecuted !== 0) throw new Error('ux_attestation_digest_invalid');
  return payload;
}
function verifyObserverAssessment(envelope: SignedEnvelope<ObserverUxAssessmentV33_30>, registry: KeyRegistry, trusted: readonly string[], at: Date): ObserverUxAssessmentV33_30 {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, at)) throw new Error('ux_observer_signature_invalid');
  const payload = envelope.payload; const { assessmentDigest, ...material } = payload;
  if (assessmentDigest !== sha256(material) || payload.observerKeyId !== envelope.issuerKeyId || payload.externalEffectsExecuted !== 0) throw new Error('ux_observer_digest_invalid');
  return payload;
}
function uniqueByParticipant(rows: readonly VerifiedBundle[], error: string): Map<string, VerifiedBundle> {
  const map = new Map<string, VerifiedBundle>();
  for (const row of rows) { if (map.has(row.session.participantId)) throw new Error(error); map.set(row.session.participantId, row); }
  return map;
}
function chainDigest(digests: readonly string[]): string { let chain = sha256({ genesis: 'V33.30_UX_EVENT_CHAIN' }); for (const digest of digests) { requireDigest(digest, 'ux_chain_digest_invalid'); chain = sha256({ previous: chain, digest }); } return chain; }
function percent(numerator: number, denominator: number): number { return denominator === 0 ? 0 : round1((numerator / denominator) * 100); }
function median(values: readonly number[]): number { if (values.length === 0) return 0; const sorted = [...values].sort((a,b)=>a-b); const mid = Math.floor(sorted.length/2); return sorted.length%2===1 ? sorted[mid]! : round1((sorted[mid-1]!+sorted[mid]!)/2); }
function round1(value: number): number { return Math.round(value * 10) / 10; }
function identifier(value: string, error: string): string { const clean = value.trim(); if (clean === '' || clean.length > 200) throw new Error(error); return clean; }
function nonEmpty(value: string, error: string): string { return identifier(value, error); }
function uniqueIdentifiers(values: readonly string[], error: string): string[] { const rows = values.map((value)=>identifier(value,error)); if (new Set(rows).size !== rows.length) throw new Error(error); return rows; }
function requireDigest(value: string | undefined, error: string): asserts value is string { if (value === undefined || !/^[0-9a-f]{64}$/.test(value)) throw new Error(error); }
function requireDate(value: Date, error: string): void { if (!Number.isFinite(value.getTime())) throw new Error(error); }
function requireInstant(value: string, error: string): number { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error(error); return parsed; }
