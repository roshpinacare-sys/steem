import {
  KeyRegistry,
  type SignedEnvelope,
  type SigningIdentity,
  sha256,
  signEnvelope,
} from '../contracts/crypto.js';
import { DeviceBindingRegistry } from './device-push-v33_3.js';
import type { HumanPilotObservationV33_6 } from './human-pilot-readiness-v33_6.js';

export interface ControlledPilotProtocolV33_7 {
  readonly version: '33.7';
  readonly studyId: string;
  readonly tenantId: string;
  readonly protocolRevision: number;
  readonly scenarioIds: readonly string[];
  readonly minimumParticipants: number;
  readonly maximumParticipants: number;
  readonly requiredObserverIds: readonly string[];
  readonly consentTextDigest: string;
  readonly telemetryFields: readonly string[];
  readonly retentionDays: number;
  readonly thresholds: {
    readonly minimumStepReductionPct: number;
    readonly maximumMedianApprovals: number;
    readonly maximumMedianComprehensionSeconds: number;
    readonly maximumErrorRatePct: number;
    readonly accessibilityRequired: true;
  };
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionCeiling: 'shadow';
  readonly externalEffectsExecuted: 0;
  readonly protocolDigest: string;
}

export interface ParticipantConsentV33_7 {
  readonly version: '33.7';
  readonly enrollmentId: string;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly tenantId: string;
  readonly participantAlias: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly deviceEnrollmentDigest: string;
  readonly consentTextDigest: string;
  readonly consentedAt: string;
  readonly expiresAt: string;
  readonly dataMinimizationAccepted: true;
  readonly withdrawalAvailable: true;
  readonly noDirectPersonalIdentifiers: true;
  readonly nonce: string;
  readonly externalEffectsExecuted: 0;
  readonly consentDigest: string;
}

export interface ControlledPilotObservationV33_7 {
  readonly version: '33.7';
  readonly controlledObservationId: string;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly enrollmentDigest: string;
  readonly baseObservationDigest: string;
  readonly participantAlias: string;
  readonly scenarioId: string;
  readonly observerId: string;
  readonly observerOrganization: string;
  readonly observedAt: string;
  readonly externalEffectsExecuted: 0;
  readonly controlledObservationDigest: string;
}

export interface ControlledPilotGateV33_7 {
  readonly version: '33.7';
  readonly studyId: string;
  readonly participantCount: number;
  readonly coveredScenarioCount: number;
  readonly requiredScenarioCount: number;
  readonly stepReductionPct: number;
  readonly medianApprovals: number;
  readonly medianComprehensionSeconds: number;
  readonly errorRatePct: number;
  readonly accessibilityPassed: boolean;
  readonly independentlyObserved: boolean;
  readonly humanPilotPassed: boolean;
  readonly evidenceClass: 'CONTROLLED_HUMAN_PILOT' | 'CONTROLLED_PILOT_INCOMPLETE';
  readonly productionCeiling: 'shadow';
  readonly externalEffectsExecuted: 0;
  readonly gateDigest: string;
}

export class ControlledHumanPilotRegistryV33_7 {
  readonly #authorityKeys: KeyRegistry;
  readonly #trustedAuthorityIds: ReadonlySet<string>;
  readonly #observerKeys: KeyRegistry;
  readonly #trustedObserverIds: ReadonlySet<string>;
  readonly #devices: DeviceBindingRegistry;
  readonly #protocols = new Map<string, SignedEnvelope<ControlledPilotProtocolV33_7>>();
  readonly #enrollments = new Map<string, SignedEnvelope<ParticipantConsentV33_7>>();
  readonly #participantOwners = new Map<string, string>();
  readonly #deviceOwners = new Map<string, string>();
  readonly #observations = new Map<string, SignedEnvelope<ControlledPilotObservationV33_7>>();

  constructor(input: {
    readonly authorityKeys: KeyRegistry;
    readonly trustedAuthorityIds: readonly string[];
    readonly observerKeys: KeyRegistry;
    readonly trustedObserverIds: readonly string[];
    readonly devices: DeviceBindingRegistry;
  }) {
    this.#authorityKeys = input.authorityKeys;
    this.#trustedAuthorityIds = new Set(unique(input.trustedAuthorityIds, 'pilot_authority_invalid'));
    this.#observerKeys = input.observerKeys;
    this.#trustedObserverIds = new Set(unique(input.trustedObserverIds, 'pilot_observer_invalid'));
    this.#devices = input.devices;
    if (this.#trustedAuthorityIds.size === 0 || this.#trustedObserverIds.size === 0) throw new Error('pilot_trust_roots_required');
    for (const id of this.#trustedAuthorityIds) if (this.#trustedObserverIds.has(id)) throw new Error('pilot_authority_observer_separation_required');
  }

  registerProtocol(envelope: SignedEnvelope<ControlledPilotProtocolV33_7>, now = new Date()): ControlledPilotProtocolV33_7 {
    validDate(now);
    const protocol = envelope.payload;
    validateProtocol(protocol, now);
    if (!this.#trustedAuthorityIds.has(envelope.issuerKeyId) || !this.#authorityKeys.verifyAt(envelope, protocol.issuedAt) || !this.#authorityKeys.verifyAt(envelope, now)) throw new Error('pilot_protocol_signature_invalid');
    const prior = this.#protocols.get(protocol.studyId);
    if (prior !== undefined) {
      if (sha256(prior) !== sha256(envelope)) throw new Error('pilot_protocol_immutable');
      return structuredClone(prior.payload);
    }
    this.#protocols.set(protocol.studyId, structuredClone(envelope));
    return structuredClone(protocol);
  }

  enrollParticipant(envelope: SignedEnvelope<ParticipantConsentV33_7>, now = new Date()): ParticipantConsentV33_7 {
    validDate(now);
    const consent = envelope.payload;
    const protocolEnvelope = this.#protocols.get(identifier(consent.studyId, 'pilot_study_id_required'));
    if (protocolEnvelope === undefined) throw new Error('pilot_protocol_not_registered');
    const protocol = protocolEnvelope.payload;
    validateConsent(consent, protocol, now);
    if (!this.#devices.verifyDeviceEnvelope(envelope, consent.tenantId, consent.userId, consent.deviceId, 'APPROVAL_DECIDE', new Date(consent.consentedAt), now)) throw new Error('participant_consent_device_signature_invalid');
    const registeredDevice = this.#devices.requireActive(consent.tenantId, consent.userId, consent.deviceId, 'APPROVAL_DECIDE', now);
    if (registeredDevice.enrollmentDigest !== consent.deviceEnrollmentDigest) throw new Error('participant_consent_device_binding_invalid');
    const enrollmentDigest = sha256(envelope);
    const prior = this.#enrollments.get(consent.enrollmentId);
    if (prior !== undefined) {
      if (sha256(prior) !== enrollmentDigest) throw new Error('participant_enrollment_id_conflict');
      return structuredClone(prior.payload);
    }
    const participantKey = `${consent.studyId}:${consent.participantAlias}`;
    const deviceKey = `${consent.studyId}:${consent.tenantId}:${consent.deviceId}`;
    const participantOwner = this.#participantOwners.get(participantKey);
    const deviceOwner = this.#deviceOwners.get(deviceKey);
    if (participantOwner !== undefined && participantOwner !== enrollmentDigest) throw new Error('participant_alias_reuse');
    if (deviceOwner !== undefined && deviceOwner !== consent.participantAlias) throw new Error('pilot_device_shared_between_participants');
    this.#enrollments.set(consent.enrollmentId, structuredClone(envelope));
    this.#participantOwners.set(participantKey, enrollmentDigest);
    this.#deviceOwners.set(deviceKey, consent.participantAlias);
    return structuredClone(consent);
  }

  addObservation(input: {
    readonly envelope: SignedEnvelope<ControlledPilotObservationV33_7>;
    readonly baseObservation: SignedEnvelope<HumanPilotObservationV33_6>;
  }, now = new Date()): ControlledPilotObservationV33_7 {
    validDate(now);
    const row = input.envelope.payload;
    const protocolEnvelope = this.#protocols.get(identifier(row.studyId, 'pilot_study_id_required'));
    if (protocolEnvelope === undefined) throw new Error('pilot_protocol_not_registered');
    const protocol = protocolEnvelope.payload;
    if (row.protocolDigest !== protocol.protocolDigest || row.externalEffectsExecuted !== 0) throw new Error('controlled_observation_protocol_mismatch');
    if (!protocol.requiredObserverIds.includes(row.observerId) || row.observerId !== input.envelope.issuerKeyId || !this.#trustedObserverIds.has(row.observerId)) throw new Error('controlled_observer_untrusted');
    if (!this.#observerKeys.verifyAt(input.envelope, row.observedAt) || !this.#observerKeys.verifyAt(input.envelope, now)) throw new Error('controlled_observation_signature_invalid');
    if (!this.#observerKeys.verifyAt(input.baseObservation, input.baseObservation.payload.observedAt) || input.baseObservation.issuerKeyId !== row.observerId) throw new Error('base_observation_signature_invalid');
    if (sha256(input.baseObservation) !== row.baseObservationDigest || input.baseObservation.payload.observationDigest !== sha256(stripDigest(input.baseObservation.payload, 'observationDigest'))) throw new Error('base_observation_digest_invalid');
    const enrollment = [...this.#enrollments.values()].find((candidate) => sha256(candidate) === row.enrollmentDigest);
    if (enrollment === undefined) throw new Error('controlled_observation_enrollment_missing');
    if (enrollment.payload.participantAlias !== row.participantAlias || enrollment.payload.studyId !== row.studyId) throw new Error('controlled_observation_participant_mismatch');
    if (input.baseObservation.payload.participantId !== row.participantAlias || input.baseObservation.payload.scenarioId !== row.scenarioId) throw new Error('controlled_observation_base_mismatch');
    if (!protocol.scenarioIds.includes(row.scenarioId)) throw new Error('controlled_observation_scenario_not_in_protocol');
    if (instant(row.observedAt, 'controlled_observation_time_invalid') < instant(enrollment.payload.consentedAt, 'consent_time_invalid') || instant(row.observedAt, 'controlled_observation_time_invalid') >= instant(enrollment.payload.expiresAt, 'consent_expiry_invalid')) throw new Error('controlled_observation_outside_consent');
    if (row.controlledObservationDigest !== sha256(stripDigest(row, 'controlledObservationDigest'))) throw new Error('controlled_observation_digest_invalid');
    const prior = this.#observations.get(row.controlledObservationId);
    if (prior !== undefined) {
      if (sha256(prior) !== sha256(input.envelope)) throw new Error('controlled_observation_id_conflict');
      return structuredClone(prior.payload);
    }
    if ([...this.#observations.values()].some((candidate) => candidate.payload.studyId === row.studyId && candidate.payload.participantAlias === row.participantAlias && candidate.payload.scenarioId === row.scenarioId)) throw new Error('controlled_observation_duplicate_participant_scenario');
    this.#observations.set(row.controlledObservationId, structuredClone(input.envelope));
    return structuredClone(row);
  }

  evaluate(studyId: string, baseObservations: readonly SignedEnvelope<HumanPilotObservationV33_6>[]): ControlledPilotGateV33_7 {
    const protocolEnvelope = this.#protocols.get(identifier(studyId, 'pilot_study_id_required'));
    if (protocolEnvelope === undefined) throw new Error('pilot_protocol_not_registered');
    const protocol = protocolEnvelope.payload;
    const controlled = [...this.#observations.values()].filter((row) => row.payload.studyId === studyId);
    const baseByDigest = new Map(baseObservations.map((row) => [sha256(row), row]));
    const participants = new Set<string>();
    const scenarios = new Set<string>();
    const observerOrgs = new Set<string>();
    const approvals: number[] = [];
    const comprehension: number[] = [];
    let baseline = 0;
    let prototype = 0;
    let errors = 0;
    let accessibilityPassed = true;
    for (const controlledRow of controlled) {
      const base = baseByDigest.get(controlledRow.payload.baseObservationDigest);
      if (base === undefined) throw new Error('controlled_pilot_base_observation_missing');
      const observation = base.payload;
      participants.add(controlledRow.payload.participantAlias);
      scenarios.add(controlledRow.payload.scenarioId);
      observerOrgs.add(controlledRow.payload.observerOrganization);
      baseline += observation.baselineSteps;
      prototype += observation.prototypeSteps;
      approvals.push(observation.approvals);
      comprehension.push(observation.comprehensionSeconds);
      errors += observation.errors;
      accessibilityPassed = accessibilityPassed && observation.accessibilityPassed;
    }
    const stepReductionPct = baseline === 0 ? 0 : Number((((baseline - prototype) / baseline) * 100).toFixed(2));
    const medianApprovals = approvals.length === 0 ? Number.POSITIVE_INFINITY : median(approvals);
    const medianComprehensionSeconds = comprehension.length === 0 ? Number.POSITIVE_INFINITY : median(comprehension);
    const errorRatePct = Number(((errors / Math.max(1, prototype + approvals.reduce((sum, value) => sum + value, 0))) * 100).toFixed(2));
    const independentlyObserved = observerOrgs.size >= 1 && controlled.every((row) => !this.#trustedAuthorityIds.has(row.payload.observerId));
    const humanPilotPassed = participants.size >= protocol.minimumParticipants
      && participants.size <= protocol.maximumParticipants
      && protocol.scenarioIds.every((scenario) => scenarios.has(scenario))
      && stepReductionPct >= protocol.thresholds.minimumStepReductionPct
      && medianApprovals <= protocol.thresholds.maximumMedianApprovals
      && medianComprehensionSeconds < protocol.thresholds.maximumMedianComprehensionSeconds
      && errorRatePct <= protocol.thresholds.maximumErrorRatePct
      && (!protocol.thresholds.accessibilityRequired || accessibilityPassed)
      && independentlyObserved;
    const material = {
      version: '33.7' as const,
      studyId,
      participantCount: participants.size,
      coveredScenarioCount: scenarios.size,
      requiredScenarioCount: protocol.scenarioIds.length,
      stepReductionPct,
      medianApprovals,
      medianComprehensionSeconds,
      errorRatePct,
      accessibilityPassed,
      independentlyObserved,
      humanPilotPassed,
      evidenceClass: (humanPilotPassed ? 'CONTROLLED_HUMAN_PILOT' : 'CONTROLLED_PILOT_INCOMPLETE') as ControlledPilotGateV33_7['evidenceClass'],
      productionCeiling: 'shadow' as const,
      externalEffectsExecuted: 0 as const,
    };
    return { ...material, gateDigest: sha256(material) };
  }
}

export type ExternalPushProviderV33_7 = 'APNS' | 'FCM';

export interface ProviderQualificationRunV33_7 {
  readonly version: '33.7';
  readonly runId: string;
  readonly provider: ExternalPushProviderV33_7;
  readonly environment: 'APNS_SANDBOX' | 'FCM_ISOLATED_PROJECT';
  readonly endpoint: string;
  readonly credentialReference: string;
  readonly authentication: 'APNS_ES256_JWT' | 'FCM_OAUTH2_ACCESS_TOKEN';
  readonly tlsVersion: 'TLS1.2' | 'TLS1.3';
  readonly tlsPeerFingerprint: string;
  readonly realDeviceObserved: true;
  readonly externalNetworkExecuted: true;
  readonly credentialMaterialDisclosed: false;
  readonly requestCount: number;
  readonly providerAcceptanceCount: number;
  readonly duplicateAcceptanceCount: 0;
  readonly invalidTokenHandled: true;
  readonly retryDedupPassed: true;
  readonly deviceTokenRotationPassed: true;
  readonly providerCredentialRevocationPassed: true;
  readonly transcriptDigest: string;
  readonly operatorId: string;
  readonly operatorOrganization: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly productionCeiling: 'shadow';
  readonly externalEffectsExecuted: 0;
  readonly runDigest: string;
}

export interface ProviderQualificationWitnessV33_7 {
  readonly version: '33.7';
  readonly witnessId: string;
  readonly runDigest: string;
  readonly provider: ExternalPushProviderV33_7;
  readonly tlsPeerFingerprint: string;
  readonly transcriptDigest: string;
  readonly witnessOrganization: string;
  readonly observedAt: string;
  readonly externalEffectsExecuted: 0;
  readonly witnessDigest: string;
}

export interface ProviderQualificationGateV33_7 {
  readonly version: '33.7';
  readonly provider: ExternalPushProviderV33_7;
  readonly qualified: boolean;
  readonly operatorOrganization: string;
  readonly witnessOrganization: string;
  readonly independentWitness: boolean;
  readonly productionCeiling: 'shadow';
  readonly externalEffectsExecuted: 0;
  readonly gateDigest: string;
}

export class ExternalProviderVerifierV33_7 {
  readonly #operatorKeys: KeyRegistry;
  readonly #trustedOperatorIds: ReadonlySet<string>;
  readonly #witnessKeys: KeyRegistry;
  readonly #trustedWitnessIds: ReadonlySet<string>;
  constructor(input: { readonly operatorKeys: KeyRegistry; readonly trustedOperatorIds: readonly string[]; readonly witnessKeys: KeyRegistry; readonly trustedWitnessIds: readonly string[] }) {
    this.#operatorKeys = input.operatorKeys;
    this.#trustedOperatorIds = new Set(unique(input.trustedOperatorIds, 'provider_operator_invalid'));
    this.#witnessKeys = input.witnessKeys;
    this.#trustedWitnessIds = new Set(unique(input.trustedWitnessIds, 'provider_witness_invalid'));
    if (this.#trustedOperatorIds.size === 0 || this.#trustedWitnessIds.size === 0) throw new Error('provider_qualification_trust_roots_required');
  }
  verify(runEnvelope: SignedEnvelope<ProviderQualificationRunV33_7>, witnessEnvelope: SignedEnvelope<ProviderQualificationWitnessV33_7>, now = new Date()): ProviderQualificationGateV33_7 {
    validDate(now);
    const run = runEnvelope.payload;
    const witness = witnessEnvelope.payload;
    validateProviderRun(run, now);
    if (!this.#trustedOperatorIds.has(runEnvelope.issuerKeyId) || run.operatorId !== runEnvelope.issuerKeyId || !this.#operatorKeys.verifyAt(runEnvelope, run.completedAt) || !this.#operatorKeys.verifyAt(runEnvelope, now)) throw new Error('provider_run_signature_invalid');
    if (!this.#trustedWitnessIds.has(witnessEnvelope.issuerKeyId) || !this.#witnessKeys.verifyAt(witnessEnvelope, witness.observedAt) || !this.#witnessKeys.verifyAt(witnessEnvelope, now)) throw new Error('provider_witness_signature_invalid');
    if (witness.runDigest !== sha256(runEnvelope) || witness.provider !== run.provider || witness.tlsPeerFingerprint !== run.tlsPeerFingerprint || witness.transcriptDigest !== run.transcriptDigest) throw new Error('provider_witness_binding_invalid');
    if (witness.externalEffectsExecuted !== 0 || witness.witnessDigest !== sha256(stripDigest(witness, 'witnessDigest'))) throw new Error('provider_witness_digest_invalid');
    const independentWitness = run.operatorOrganization !== witness.witnessOrganization && runEnvelope.issuerKeyId !== witnessEnvelope.issuerKeyId;
    const qualified = independentWitness;
    const material = { version: '33.7' as const, provider: run.provider, qualified, operatorOrganization: run.operatorOrganization, witnessOrganization: witness.witnessOrganization, independentWitness, productionCeiling: 'shadow' as const, externalEffectsExecuted: 0 as const };
    return { ...material, gateDigest: sha256(material) };
  }
}

export type BuyerEvidenceTypeV33_7 = 'INTERVIEW' | 'DESIGN_PARTNER' | 'PAID_PILOT';
export interface BuyerEvidenceV33_7 {
  readonly version: '33.7';
  readonly evidenceId: string;
  readonly organizationAlias: string;
  readonly buyerRole: string;
  readonly evidenceType: BuyerEvidenceTypeV33_7;
  readonly problemUrgent: boolean;
  readonly budgetOwnerConfirmed: boolean;
  readonly currentWorkaroundDigest: string;
  readonly evidenceArtifactDigest: string;
  readonly annualContractValueUsd?: number;
  readonly interviewerId: string;
  readonly collectedAt: string;
  readonly expiresAt: string;
  readonly evidenceClass: 'EXTERNAL_BUYER_EVIDENCE';
  readonly evidenceDigest: string;
}
export interface BuyerValidationGateV33_7 {
  readonly version: '33.7';
  readonly uniqueOrganizations: number;
  readonly interviews: number;
  readonly urgentBudgetConfirmed: number;
  readonly designPartners: number;
  readonly paidPilots: number;
  readonly committedPilotAcvUsd: number;
  readonly g2Passed: boolean;
  readonly evidenceClass: 'BUYER_VALIDATION' | 'BUYER_VALIDATION_INCOMPLETE';
  readonly gateDigest: string;
}
export class BuyerEvidenceVerifierV33_7 {
  readonly #keys: KeyRegistry;
  readonly #trustedInterviewerIds: ReadonlySet<string>;
  constructor(keys: KeyRegistry, trustedInterviewerIds: readonly string[]) { this.#keys = keys; this.#trustedInterviewerIds = new Set(unique(trustedInterviewerIds, 'buyer_interviewer_invalid')); if (this.#trustedInterviewerIds.size === 0) throw new Error('buyer_interviewer_required'); }
  evaluate(envelopes: readonly SignedEnvelope<BuyerEvidenceV33_7>[], now = new Date()): BuyerValidationGateV33_7 {
    validDate(now);
    const ids = new Set<string>();
    const orgs = new Set<string>();
    const strongestByOrg = new Map<string, BuyerEvidenceTypeV33_7>();
    let interviews = 0;
    let urgentBudgetConfirmed = 0;
    let committedPilotAcvUsd = 0;
    for (const envelope of envelopes) {
      const row = envelope.payload;
      validateBuyerEvidence(row, now);
      if (!this.#trustedInterviewerIds.has(envelope.issuerKeyId) || row.interviewerId !== envelope.issuerKeyId || !this.#keys.verifyAt(envelope, row.collectedAt) || !this.#keys.verifyAt(envelope, now)) throw new Error('buyer_evidence_signature_invalid');
      if (ids.has(row.evidenceId)) throw new Error('buyer_evidence_id_duplicate');
      ids.add(row.evidenceId);
      orgs.add(row.organizationAlias);
      if (row.evidenceType === 'INTERVIEW') interviews += 1;
      if (row.problemUrgent && row.budgetOwnerConfirmed) urgentBudgetConfirmed += 1;
      const prior = strongestByOrg.get(row.organizationAlias);
      if (rankBuyerEvidence(row.evidenceType) > rankBuyerEvidence(prior)) strongestByOrg.set(row.organizationAlias, row.evidenceType);
      if (row.evidenceType === 'PAID_PILOT') committedPilotAcvUsd += row.annualContractValueUsd!;
    }
    const designPartners = [...strongestByOrg.values()].filter((type) => type === 'DESIGN_PARTNER' || type === 'PAID_PILOT').length;
    const paidPilots = [...strongestByOrg.values()].filter((type) => type === 'PAID_PILOT').length;
    const g2Passed = interviews >= 15 && orgs.size >= 15 && urgentBudgetConfirmed >= 5 && designPartners >= 3 && paidPilots >= 2 && committedPilotAcvUsd >= 50_000;
    const material = { version: '33.7' as const, uniqueOrganizations: orgs.size, interviews, urgentBudgetConfirmed, designPartners, paidPilots, committedPilotAcvUsd, g2Passed, evidenceClass: (g2Passed ? 'BUYER_VALIDATION' : 'BUYER_VALIDATION_INCOMPLETE') as BuyerValidationGateV33_7['evidenceClass'] };
    return { ...material, gateDigest: sha256(material) };
  }
}

export interface V33_7ReadinessSummary {
  readonly version: '33.7';
  readonly controlledHumanPilot: 'not_executed';
  readonly credentialledProviderQualification: 'not_executed';
  readonly buyerValidation: 'not_executed';
  readonly gates: { readonly G2: 'in-progress-not-passed'; readonly G3: 'in-progress-not-passed' };
  readonly productionPromotion: 'blocked';
  readonly externalEffectsExecuted: 0;
  readonly summaryDigest: string;
}
export function createV33_7ReadinessSummary(): V33_7ReadinessSummary {
  const material = { version: '33.7' as const, controlledHumanPilot: 'not_executed' as const, credentialledProviderQualification: 'not_executed' as const, buyerValidation: 'not_executed' as const, gates: { G2: 'in-progress-not-passed' as const, G3: 'in-progress-not-passed' as const }, productionPromotion: 'blocked' as const, externalEffectsExecuted: 0 as const };
  return { ...material, summaryDigest: sha256(material) };
}

export function createControlledPilotProtocolV33_7(input: Omit<ControlledPilotProtocolV33_7, 'version' | 'productionCeiling' | 'externalEffectsExecuted' | 'protocolDigest'>, authority: SigningIdentity): SignedEnvelope<ControlledPilotProtocolV33_7> {
  const material = { version: '33.7' as const, ...input, productionCeiling: 'shadow' as const, externalEffectsExecuted: 0 as const };
  const protocol: ControlledPilotProtocolV33_7 = { ...material, protocolDigest: sha256(material) };
  return signEnvelope(protocol, authority);
}

function validateProtocol(protocol: ControlledPilotProtocolV33_7, now: Date): void {
  identifier(protocol.studyId, 'pilot_study_id_required'); identifier(protocol.tenantId, 'tenant_id_required');
  integer(protocol.protocolRevision, 1, 'pilot_protocol_revision_invalid');
  const scenarios = unique(protocol.scenarioIds, 'pilot_scenario_invalid'); if (scenarios.length < 3) throw new Error('pilot_scenarios_insufficient');
  integer(protocol.minimumParticipants, 5, 'pilot_minimum_participants_invalid'); integer(protocol.maximumParticipants, protocol.minimumParticipants, 'pilot_maximum_participants_invalid');
  const observers = unique(protocol.requiredObserverIds, 'pilot_observer_invalid'); if (observers.length === 0) throw new Error('pilot_observer_required');
  digest(protocol.consentTextDigest, 'consent_text_digest_invalid');
  const fields = unique(protocol.telemetryFields, 'telemetry_field_invalid'); if (fields.some((field) => /name|email|phone|address|raw/i.test(field))) throw new Error('pilot_telemetry_pii_forbidden');
  integer(protocol.retentionDays, 1, 'pilot_retention_invalid'); if (protocol.retentionDays > 90) throw new Error('pilot_retention_excessive');
  const thresholds = protocol.thresholds;
  numberRange(thresholds.minimumStepReductionPct, 70, 100, 'pilot_step_reduction_threshold_invalid');
  numberRange(thresholds.maximumMedianApprovals, 0, 1, 'pilot_approval_threshold_invalid');
  numberRange(thresholds.maximumMedianComprehensionSeconds, 1, 10, 'pilot_comprehension_threshold_invalid');
  numberRange(thresholds.maximumErrorRatePct, 0, 5, 'pilot_error_threshold_invalid');
  if (!thresholds.accessibilityRequired || protocol.productionCeiling !== 'shadow' || protocol.externalEffectsExecuted !== 0) throw new Error('pilot_protocol_boundary_invalid');
  const issued = instant(protocol.issuedAt, 'pilot_protocol_issued_at_invalid'); const expires = instant(protocol.expiresAt, 'pilot_protocol_expires_at_invalid');
  if (issued > now.getTime() || expires <= issued || now.getTime() >= expires) throw new Error('pilot_protocol_window_invalid');
  if (protocol.protocolDigest !== sha256(stripDigest(protocol, 'protocolDigest'))) throw new Error('pilot_protocol_digest_invalid');
}
function validateConsent(consent: ParticipantConsentV33_7, protocol: ControlledPilotProtocolV33_7, now: Date): void {
  identifier(consent.enrollmentId, 'participant_enrollment_id_required'); identifier(consent.participantAlias, 'participant_alias_required'); identifier(consent.userId, 'pilot_user_required'); identifier(consent.deviceId, 'device_id_required');
  if (consent.studyId !== protocol.studyId || consent.protocolDigest !== protocol.protocolDigest || consent.tenantId !== protocol.tenantId || consent.consentTextDigest !== protocol.consentTextDigest) throw new Error('participant_consent_protocol_mismatch');
  digest(consent.deviceEnrollmentDigest, 'participant_device_digest_invalid');
  if (!consent.dataMinimizationAccepted || !consent.withdrawalAvailable || !consent.noDirectPersonalIdentifiers || consent.externalEffectsExecuted !== 0) throw new Error('participant_consent_boundary_invalid');
  const consented = instant(consent.consentedAt, 'participant_consent_time_invalid'); const expires = instant(consent.expiresAt, 'participant_consent_expiry_invalid');
  if (consented > now.getTime() || expires <= consented || expires > instant(protocol.expiresAt, 'protocol_expiry_invalid') || now.getTime() >= expires) throw new Error('participant_consent_window_invalid');
  identifier(consent.nonce, 'participant_consent_nonce_required');
  if (consent.consentDigest !== sha256(stripDigest(consent, 'consentDigest'))) throw new Error('participant_consent_digest_invalid');
}
function validateProviderRun(run: ProviderQualificationRunV33_7, now: Date): void {
  identifier(run.runId, 'provider_run_id_required'); identifier(run.operatorId, 'provider_operator_id_required'); identifier(run.operatorOrganization, 'provider_operator_org_required');
  if (!/^(kms|hsm|workload):\/\/[A-Za-z0-9._/-]+$/.test(run.credentialReference)) throw new Error('provider_credential_reference_invalid');
  if (run.credentialMaterialDisclosed || !run.realDeviceObserved || !run.externalNetworkExecuted || run.externalEffectsExecuted !== 0 || run.productionCeiling !== 'shadow') throw new Error('provider_run_boundary_invalid');
  if (run.provider === 'APNS') {
    if (run.environment !== 'APNS_SANDBOX' || run.endpoint !== 'api.sandbox.push.apple.com:443' || run.authentication !== 'APNS_ES256_JWT') throw new Error('apns_qualification_run_invalid');
  } else if (run.environment !== 'FCM_ISOLATED_PROJECT' || !/^https:\/\/fcm\.googleapis\.com\/v1\/projects\/[A-Za-z0-9._-]+\/messages:send$/.test(run.endpoint) || run.authentication !== 'FCM_OAUTH2_ACCESS_TOKEN') throw new Error('fcm_qualification_run_invalid');
  if (!['TLS1.2','TLS1.3'].includes(run.tlsVersion)) throw new Error('provider_tls_version_invalid');
  digest(run.tlsPeerFingerprint, 'provider_tls_fingerprint_invalid'); digest(run.transcriptDigest, 'provider_transcript_digest_invalid');
  integer(run.requestCount, 1, 'provider_request_count_invalid'); integer(run.providerAcceptanceCount, 1, 'provider_acceptance_count_invalid');
  if (run.providerAcceptanceCount > run.requestCount || run.duplicateAcceptanceCount !== 0 || !run.invalidTokenHandled || !run.retryDedupPassed || !run.deviceTokenRotationPassed || !run.providerCredentialRevocationPassed) throw new Error('provider_qualification_controls_failed');
  const started = instant(run.startedAt, 'provider_run_start_invalid'); const completed = instant(run.completedAt, 'provider_run_completed_invalid');
  if (completed < started || completed > now.getTime()) throw new Error('provider_run_window_invalid');
  if (run.runDigest !== sha256(stripDigest(run, 'runDigest'))) throw new Error('provider_run_digest_invalid');
}
function validateBuyerEvidence(row: BuyerEvidenceV33_7, now: Date): void {
  identifier(row.evidenceId, 'buyer_evidence_id_required'); identifier(row.organizationAlias, 'buyer_organization_required'); identifier(row.buyerRole, 'buyer_role_required'); identifier(row.interviewerId, 'buyer_interviewer_required');
  if (!['INTERVIEW','DESIGN_PARTNER','PAID_PILOT'].includes(row.evidenceType) || row.evidenceClass !== 'EXTERNAL_BUYER_EVIDENCE') throw new Error('buyer_evidence_type_invalid');
  digest(row.currentWorkaroundDigest, 'buyer_workaround_digest_invalid'); digest(row.evidenceArtifactDigest, 'buyer_artifact_digest_invalid');
  if (row.evidenceType === 'PAID_PILOT') { if (row.annualContractValueUsd === undefined || !Number.isFinite(row.annualContractValueUsd) || row.annualContractValueUsd < 25_000) throw new Error('paid_pilot_value_invalid'); }
  else if (row.annualContractValueUsd !== undefined) throw new Error('non_paid_evidence_has_contract_value');
  const collected = instant(row.collectedAt, 'buyer_collected_at_invalid'); const expires = instant(row.expiresAt, 'buyer_expires_at_invalid'); if (collected > now.getTime() || expires <= collected || now.getTime() >= expires) throw new Error('buyer_evidence_window_invalid');
  if (row.evidenceDigest !== sha256(stripDigest(row, 'evidenceDigest'))) throw new Error('buyer_evidence_digest_invalid');
}
function rankBuyerEvidence(type: BuyerEvidenceTypeV33_7 | undefined): number { return type === 'PAID_PILOT' ? 3 : type === 'DESIGN_PARTNER' ? 2 : type === 'INTERVIEW' ? 1 : 0; }
function stripDigest<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> { const clone = { ...value }; delete clone[key]; return clone; }
function identifier(value: string, code: string): string { const normalized = value.trim(); if (normalized === '' || normalized.length > 256) throw new Error(code); return normalized; }
function unique(values: readonly string[], code: string): readonly string[] { const normalized = values.map((value) => identifier(value, code)); if (new Set(normalized).size !== normalized.length) throw new Error(code); return normalized; }
function digest(value: string, code: string): string { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(code); return value; }
function instant(value: string, code: string): number { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error(code); return parsed; }
function validDate(value: Date): void { if (!Number.isFinite(value.getTime())) throw new Error('current_time_invalid'); }
function integer(value: number, minimum: number, code: string): void { if (!Number.isSafeInteger(value) || value < minimum) throw new Error(code); }
function numberRange(value: number, minimum: number, maximum: number, code: string): void { if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(code); }
function median(values: readonly number[]): number { const sorted = [...values].sort((a,b)=>a-b); const middle=Math.floor(sorted.length/2); return sorted.length%2===0 ? (sorted[middle-1]!+sorted[middle]!)/2 : sorted[middle]!; }
