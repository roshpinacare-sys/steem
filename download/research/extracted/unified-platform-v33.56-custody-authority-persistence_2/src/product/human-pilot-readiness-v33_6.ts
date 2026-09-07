import { randomUUID } from 'node:crypto';
import {
  KeyRegistry,
  type SignedEnvelope,
  type SigningIdentity,
  sha256,
  signEnvelope,
} from '../contracts/crypto.js';
import type { PushApprovalCard } from './chat-mission.js';
import { DeviceBindingRegistry } from './device-push-v33_3.js';

export type PilotEvidenceClassV33_6 = 'SIMULATED' | 'HUMAN_OBSERVED';
export type PilotEventTypeV33_6 =
  | 'SESSION_STARTED'
  | 'CARD_VIEWED'
  | 'EXPLANATION_OPENED'
  | 'DECISION_SELECTED'
  | 'DECISION_SUBMITTED'
  | 'ERROR_OBSERVED'
  | 'SESSION_COMPLETED';

export interface PilotSessionGrantV33_6 {
  readonly version: '33.6';
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly enrollmentDigest: string;
  readonly cardId: string;
  readonly cardDigest: string;
  readonly csrfTokenDigest: string;
  readonly evidenceClass: PilotEvidenceClassV33_6;
  readonly participantId?: string;
  readonly consentRecorded: boolean;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly productionCeiling: 'shadow';
  readonly externalEffectsExecuted: 0;
  readonly sessionDigest: string;
}

export interface PilotSessionRevocationV33_6 {
  readonly version: '33.6';
  readonly revocationId: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly reason: 'DEVICE_LOST' | 'DEVICE_REPLACED' | 'USER_LOGOUT' | 'ADMIN_REVOKED';
  readonly revokedAt: string;
  readonly nonce: string;
  readonly revocationDigest: string;
}

export interface PilotSessionRecordV33_6 {
  readonly version: '33.6';
  readonly grant: SignedEnvelope<PilotSessionGrantV33_6>;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly revocation?: SignedEnvelope<PilotSessionRevocationV33_6>;
  readonly externalEffectsExecuted: 0;
  readonly recordDigest: string;
}

export interface PilotSessionIssueInputV33_6 {
  readonly sessionId?: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly card: PushApprovalCard;
  readonly csrfToken: string;
  readonly evidenceClass: PilotEvidenceClassV33_6;
  readonly participantId?: string;
  readonly consentRecorded: boolean;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce?: string;
}

export class PilotSessionRegistryV33_6 {
  readonly #serverIdentity: SigningIdentity;
  readonly #serverKeys: KeyRegistry;
  readonly #trustedServerIds: ReadonlySet<string>;
  readonly #devices: DeviceBindingRegistry;
  readonly #sessions = new Map<string, PilotSessionRecordV33_6>();
  readonly #nonces = new Map<string, string>();

  constructor(serverIdentity: SigningIdentity, serverKeys: KeyRegistry, trustedServerIds: readonly string[], devices: DeviceBindingRegistry) {
    this.#serverIdentity = serverIdentity;
    this.#serverKeys = serverKeys;
    this.#trustedServerIds = new Set(unique(trustedServerIds, 'trusted_pilot_server_invalid'));
    this.#devices = devices;
    if (!this.#trustedServerIds.has(serverIdentity.keyId)) throw new Error('pilot_server_signer_not_trusted');
  }

  issue(input: PilotSessionIssueInputV33_6, now = new Date()): { readonly record: PilotSessionRecordV33_6; readonly csrfToken: string } {
    validDate(now);
    const tenantId = identifier(input.tenantId, 'tenant_id_required');
    const userId = identifier(input.userId, 'pilot_user_required');
    const deviceId = identifier(input.deviceId, 'device_id_required');
    validateCard(input.card, tenantId);
    const issuedAt = instant(input.issuedAt, 'pilot_session_issued_at_invalid');
    const expiresAt = instant(input.expiresAt, 'pilot_session_expires_at_invalid');
    if (issuedAt > now.getTime() || expiresAt <= issuedAt || now.getTime() >= expiresAt) throw new Error('pilot_session_window_invalid');
    const csrfToken = secret(input.csrfToken, 'pilot_csrf_required');
    const evidenceClass = input.evidenceClass;
    if (!['SIMULATED', 'HUMAN_OBSERVED'].includes(evidenceClass)) throw new Error('pilot_evidence_class_invalid');
    const participantId = input.participantId === undefined ? undefined : identifier(input.participantId, 'pilot_participant_required');
    if (evidenceClass === 'HUMAN_OBSERVED' && (!input.consentRecorded || participantId === undefined)) throw new Error('human_pilot_consent_and_participant_required');
    if (evidenceClass === 'SIMULATED' && (input.consentRecorded || participantId !== undefined)) throw new Error('simulated_pilot_cannot_claim_human_consent');
    const device = this.#devices.requireActive(tenantId, userId, deviceId, 'APPROVAL_DECIDE', new Date(issuedAt));
    this.#devices.requireActive(tenantId, userId, deviceId, 'APPROVAL_DECIDE', now);
    const sessionId = identifier(input.sessionId ?? randomUUID(), 'pilot_session_id_required');
    const nonce = identifier(input.nonce ?? randomUUID(), 'pilot_session_nonce_required');
    const material = {
      version: '33.6' as const,
      sessionId,
      tenantId,
      userId,
      deviceId,
      enrollmentDigest: device.enrollmentDigest,
      cardId: input.card.cardId,
      cardDigest: input.card.cardDigest,
      csrfTokenDigest: sha256(csrfToken),
      evidenceClass,
      ...(participantId === undefined ? {} : { participantId }),
      consentRecorded: input.consentRecorded,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      nonce,
      productionCeiling: 'shadow' as const,
      externalEffectsExecuted: 0 as const,
    };
    const grant: PilotSessionGrantV33_6 = { ...material, sessionDigest: sha256(material) };
    const envelope = signEnvelope(grant, this.#serverIdentity);
    const digest = sha256(envelope);
    const nonceOwner = this.#nonces.get(nonce);
    if (nonceOwner !== undefined && nonceOwner !== digest) throw new Error('pilot_session_nonce_replay');
    const prior = this.#sessions.get(sessionId);
    if (prior !== undefined) {
      if (sha256(prior.grant) !== digest) throw new Error('pilot_session_id_conflict');
      return { record: structuredClone(prior), csrfToken };
    }
    const recordMaterial = { version: '33.6' as const, grant: envelope, status: 'ACTIVE' as const, externalEffectsExecuted: 0 as const };
    const record: PilotSessionRecordV33_6 = { ...recordMaterial, recordDigest: sha256(recordMaterial) };
    this.#verifyRecord(record, now, false);
    this.#sessions.set(sessionId, record);
    this.#nonces.set(nonce, digest);
    return { record: structuredClone(record), csrfToken };
  }

  authorize(input: {
    readonly session: SignedEnvelope<PilotSessionGrantV33_6>;
    readonly csrfToken: string;
    readonly tenantId: string;
    readonly userId: string;
    readonly deviceId: string;
    readonly cardId: string;
    readonly acceptedAt: string;
  }): PilotSessionRecordV33_6 {
    const acceptedAt = new Date(instant(input.acceptedAt, 'pilot_accept_time_invalid'));
    const row = this.#sessions.get(input.session.payload.sessionId);
    if (row === undefined || sha256(row.grant) !== sha256(input.session)) throw new Error('pilot_session_not_registered');
    this.#verifyRecord(row, acceptedAt, false);
    const grant = row.grant.payload;
    if (grant.tenantId !== identifier(input.tenantId, 'tenant_id_required') || grant.userId !== identifier(input.userId, 'pilot_user_required') || grant.deviceId !== identifier(input.deviceId, 'device_id_required')) throw new Error('pilot_session_principal_mismatch');
    if (grant.cardId !== identifier(input.cardId, 'approval_card_id_required')) throw new Error('pilot_session_card_mismatch');
    if (grant.csrfTokenDigest !== sha256(secret(input.csrfToken, 'pilot_csrf_required'))) throw new Error('pilot_csrf_invalid');
    this.#devices.requireActive(grant.tenantId, grant.userId, grant.deviceId, 'APPROVAL_DECIDE', acceptedAt);
    return structuredClone(row);
  }

  revokeDeviceSessions(input: { readonly tenantId: string; readonly deviceId: string; readonly reason: PilotSessionRevocationV33_6['reason']; readonly revokedAt: string; readonly noncePrefix: string }, now = new Date()): number {
    validDate(now);
    const tenantId = identifier(input.tenantId, 'tenant_id_required');
    const deviceId = identifier(input.deviceId, 'device_id_required');
    const revokedAtMs = instant(input.revokedAt, 'pilot_session_revoked_at_invalid');
    if (revokedAtMs > now.getTime()) throw new Error('pilot_session_revocation_in_future');
    if (input.reason === 'DEVICE_LOST' || input.reason === 'DEVICE_REPLACED') {
      const device = this.#devices.get(tenantId, deviceId, now);
      if (device.status !== 'REVOKED' || device.revocation === undefined || instant(device.revocation.payload.revokedAt, 'device_revoked_at_invalid') > revokedAtMs) throw new Error('device_revocation_required_before_session_revocation');
    }
    let count = 0;
    for (const [sessionId, row] of this.#sessions) {
      const grant = row.grant.payload;
      if (row.status !== 'ACTIVE' || grant.tenantId !== tenantId || grant.deviceId !== deviceId) continue;
      const material = {
        version: '33.6' as const,
        revocationId: `${input.noncePrefix}:${sessionId}`,
        sessionId,
        tenantId,
        deviceId,
        reason: input.reason,
        revokedAt: input.revokedAt,
        nonce: `${input.noncePrefix}:${grant.nonce}`,
      };
      const revocation: PilotSessionRevocationV33_6 = { ...material, revocationDigest: sha256(material) };
      const signed = signEnvelope(revocation, this.#serverIdentity);
      const updatedMaterial = { version: '33.6' as const, grant: row.grant, status: 'REVOKED' as const, revocation: signed, externalEffectsExecuted: 0 as const };
      const updated: PilotSessionRecordV33_6 = { ...updatedMaterial, recordDigest: sha256(updatedMaterial) };
      this.#verifyRecord(updated, now, true);
      this.#sessions.set(sessionId, updated);
      count += 1;
    }
    return count;
  }

  get(sessionId: string, at = new Date(), allowRevoked = false): PilotSessionRecordV33_6 {
    const row = this.#sessions.get(identifier(sessionId, 'pilot_session_id_required'));
    if (row === undefined) throw new Error('pilot_session_not_registered');
    this.#verifyRecord(row, at, allowRevoked);
    return structuredClone(row);
  }

  list(): readonly PilotSessionRecordV33_6[] {
    return [...this.#sessions.values()].sort((a, b) => a.grant.payload.sessionId.localeCompare(b.grant.payload.sessionId)).map((row) => structuredClone(row));
  }

  #verifyRecord(record: PilotSessionRecordV33_6, at: Date, allowRevoked: boolean): void {
    validDate(at);
    const grant = record.grant.payload;
    if (record.version !== '33.6' || record.externalEffectsExecuted !== 0 || grant.version !== '33.6' || grant.externalEffectsExecuted !== 0 || grant.productionCeiling !== 'shadow') throw new Error('pilot_session_record_invalid');
    if (!this.#trustedServerIds.has(record.grant.issuerKeyId) || !this.#serverKeys.verifyAt(record.grant, grant.issuedAt)) throw new Error('pilot_session_signature_invalid');
    const { sessionDigest, ...grantMaterial } = grant;
    if (sha256(grantMaterial) !== sessionDigest) throw new Error('pilot_session_digest_invalid');
    if (at.getTime() < instant(grant.issuedAt, 'pilot_session_issued_at_invalid') || at.getTime() >= instant(grant.expiresAt, 'pilot_session_expires_at_invalid')) throw new Error('pilot_session_inactive');
    if (record.status === 'REVOKED') {
      if (record.revocation === undefined) throw new Error('pilot_session_revocation_missing');
      const revocation = record.revocation.payload;
      const { revocationDigest, ...revocationMaterial } = revocation;
      if (sha256(revocationMaterial) !== revocationDigest || revocation.sessionId !== grant.sessionId || revocation.tenantId !== grant.tenantId || revocation.deviceId !== grant.deviceId) throw new Error('pilot_session_revocation_invalid');
      if (!this.#trustedServerIds.has(record.revocation.issuerKeyId) || !this.#serverKeys.verifyAt(record.revocation, revocation.revokedAt)) throw new Error('pilot_session_revocation_signature_invalid');
      if (!allowRevoked && at.getTime() >= instant(revocation.revokedAt, 'pilot_session_revoked_at_invalid')) throw new Error('pilot_session_revoked');
    } else if (record.status !== 'ACTIVE' || record.revocation !== undefined) throw new Error('pilot_session_status_invalid');
    const { recordDigest, ...recordMaterial } = record;
    if (sha256(recordMaterial) !== recordDigest) throw new Error('pilot_session_record_digest_invalid');
  }
}

export interface PilotTelemetryEventV33_6 {
  readonly version: '33.6';
  readonly eventId: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly eventType: PilotEventTypeV33_6;
  readonly occurredAt: string;
  readonly userStepIncrement: 0 | 1;
  readonly comprehensionSeconds?: number;
  readonly errorCode?: string;
  readonly previousDigest: string | null;
  readonly evidenceClass: PilotEvidenceClassV33_6;
  readonly externalEffectsExecuted: 0;
  readonly eventDigest: string;
}

export class PilotTelemetryLedgerV33_6 {
  readonly #events: PilotTelemetryEventV33_6[] = [];
  readonly #ids = new Map<string, string>();

  append(input: Omit<PilotTelemetryEventV33_6, 'version' | 'previousDigest' | 'externalEffectsExecuted' | 'eventDigest'>): PilotTelemetryEventV33_6 {
    const eventId = identifier(input.eventId, 'pilot_event_id_required');
    const sessionId = identifier(input.sessionId, 'pilot_session_id_required');
    const tenantId = identifier(input.tenantId, 'tenant_id_required');
    if (!['SESSION_STARTED','CARD_VIEWED','EXPLANATION_OPENED','DECISION_SELECTED','DECISION_SUBMITTED','ERROR_OBSERVED','SESSION_COMPLETED'].includes(input.eventType)) throw new Error('pilot_event_type_invalid');
    instant(input.occurredAt, 'pilot_event_time_invalid');
    if (input.userStepIncrement !== 0 && input.userStepIncrement !== 1) throw new Error('pilot_step_increment_invalid');
    if (input.comprehensionSeconds !== undefined && (!Number.isFinite(input.comprehensionSeconds) || input.comprehensionSeconds < 0 || input.eventType !== 'DECISION_SUBMITTED')) throw new Error('pilot_comprehension_invalid');
    if (input.errorCode !== undefined && input.eventType !== 'ERROR_OBSERVED') throw new Error('pilot_error_code_unexpected');
    const existing = this.#events.find((event) => event.eventId === eventId);
    if (existing !== undefined) {
      const comparable = { sessionId, tenantId, eventType: input.eventType, occurredAt: input.occurredAt, userStepIncrement: input.userStepIncrement, ...(input.comprehensionSeconds === undefined ? {} : { comprehensionSeconds: input.comprehensionSeconds }), ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }), evidenceClass: input.evidenceClass };
      const priorComparable = { sessionId: existing.sessionId, tenantId: existing.tenantId, eventType: existing.eventType, occurredAt: existing.occurredAt, userStepIncrement: existing.userStepIncrement, ...(existing.comprehensionSeconds === undefined ? {} : { comprehensionSeconds: existing.comprehensionSeconds }), ...(existing.errorCode === undefined ? {} : { errorCode: existing.errorCode }), evidenceClass: existing.evidenceClass };
      if (sha256(comparable) !== sha256(priorComparable)) throw new Error('pilot_event_id_conflict');
      return structuredClone(existing);
    }
    const priorForSession = [...this.#events].reverse().find((event) => event.sessionId === sessionId && event.tenantId === tenantId);
    if (priorForSession !== undefined && instant(input.occurredAt, 'pilot_event_time_invalid') < instant(priorForSession.occurredAt, 'pilot_event_time_invalid')) throw new Error('pilot_event_time_regression');
    const material = {
      version: '33.6' as const,
      eventId,
      sessionId,
      tenantId,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      userStepIncrement: input.userStepIncrement,
      ...(input.comprehensionSeconds === undefined ? {} : { comprehensionSeconds: input.comprehensionSeconds }),
      ...(input.errorCode === undefined ? {} : { errorCode: identifier(input.errorCode, 'pilot_error_code_required') }),
      previousDigest: priorForSession?.eventDigest ?? null,
      evidenceClass: input.evidenceClass,
      externalEffectsExecuted: 0 as const,
    };
    const event: PilotTelemetryEventV33_6 = { ...material, eventDigest: sha256(material) };
    const prior = this.#ids.get(eventId);
    if (prior !== undefined) throw new Error('pilot_event_id_conflict');
    this.#events.push(event);
    this.#ids.set(eventId, event.eventDigest);
    return structuredClone(event);
  }

  list(tenantId?: string): readonly PilotTelemetryEventV33_6[] {
    const rows = tenantId === undefined ? this.#events : this.#events.filter((event) => event.tenantId === identifier(tenantId, 'tenant_id_required'));
    return rows.map((event) => structuredClone(event));
  }

  verify(): boolean {
    const tails = new Map<string, string | null>();
    for (const event of this.#events) {
      const key = `${event.tenantId}:${event.sessionId}`;
      if ((tails.get(key) ?? null) !== event.previousDigest) return false;
      const { eventDigest, ...material } = event;
      if (sha256(material) !== eventDigest) return false;
      tails.set(key, eventDigest);
    }
    return true;
  }
}

export interface HumanPilotObservationV33_6 {
  readonly version: '33.6';
  readonly observationId: string;
  readonly scenarioId: string;
  readonly participantId: string;
  readonly sessionDigest: string;
  readonly telemetryTailDigest: string;
  readonly consentReceiptDigest: string;
  readonly baselineSteps: number;
  readonly prototypeSteps: number;
  readonly approvals: number;
  readonly comprehensionSeconds: number;
  readonly errors: number;
  readonly accessibilityPassed: boolean;
  readonly sessionRevokedDuringFlow: false;
  readonly observerId: string;
  readonly observedAt: string;
  readonly evidenceClass: 'HUMAN_OBSERVED';
  readonly externalEffectsExecuted: 0;
  readonly observationDigest: string;
}

export class IndependentHumanPilotVerifierV33_6 {
  readonly #observerKeys: KeyRegistry;
  readonly #trustedObserverIds: ReadonlySet<string>;
  constructor(observerKeys: KeyRegistry, trustedObserverIds: readonly string[]) {
    this.#observerKeys = observerKeys;
    this.#trustedObserverIds = new Set(unique(trustedObserverIds, 'trusted_human_observer_invalid'));
    if (this.#trustedObserverIds.size === 0) throw new Error('trusted_human_observer_required');
  }
  verify(observations: readonly SignedEnvelope<HumanPilotObservationV33_6>[]): readonly PilotScenarioResultV33_6[] {
    if (observations.length === 0) throw new Error('human_observation_required');
    const observationIds = new Set<string>();
    const scenarioIds = new Set<string>();
    const participantIds = new Set<string>();
    return observations.map((envelope) => {
      const row = envelope.payload;
      if (!this.#trustedObserverIds.has(envelope.issuerKeyId) || row.observerId !== envelope.issuerKeyId || !this.#observerKeys.verifyAt(envelope, row.observedAt)) throw new Error('human_observation_signature_invalid');
      identifier(row.observationId, 'human_observation_id_required');
      identifier(row.scenarioId, 'pilot_scenario_id_required');
      identifier(row.participantId, 'pilot_participant_required');
      digest(row.sessionDigest, 'human_observation_session_digest_invalid');
      digest(row.telemetryTailDigest, 'human_observation_telemetry_digest_invalid');
      digest(row.consentReceiptDigest, 'human_observation_consent_digest_invalid');
      instant(row.observedAt, 'human_observation_time_invalid');
      if (row.version !== '33.6' || row.evidenceClass !== 'HUMAN_OBSERVED' || row.externalEffectsExecuted !== 0 || row.sessionRevokedDuringFlow !== false) throw new Error('human_observation_contract_invalid');
      integer(row.baselineSteps, 1, 'pilot_baseline_steps_invalid');
      integer(row.prototypeSteps, 0, 'pilot_prototype_steps_invalid');
      integer(row.approvals, 0, 'pilot_approvals_invalid');
      integer(row.errors, 0, 'pilot_errors_invalid');
      if (row.prototypeSteps > row.baselineSteps || !Number.isFinite(row.comprehensionSeconds) || row.comprehensionSeconds < 0) throw new Error('human_observation_measurement_invalid');
      const { observationDigest, ...material } = row;
      if (sha256(material) !== observationDigest) throw new Error('human_observation_digest_invalid');
      if (observationIds.has(row.observationId) || scenarioIds.has(row.scenarioId) || participantIds.has(row.participantId)) throw new Error('human_observation_independence_invalid');
      observationIds.add(row.observationId); scenarioIds.add(row.scenarioId); participantIds.add(row.participantId);
      return {scenarioId:row.scenarioId,participantId:row.participantId,evidenceClass:'HUMAN_OBSERVED' as const,baselineSteps:row.baselineSteps,prototypeSteps:row.prototypeSteps,approvals:row.approvals,comprehensionSeconds:row.comprehensionSeconds,errors:row.errors,consentRecorded:true,accessibilityPassed:row.accessibilityPassed,sessionRevokedDuringFlow:false};
    });
  }
}

export interface QualifiedHumanPilotInputV33_6 {
  readonly observations: readonly SignedEnvelope<HumanPilotObservationV33_6>[];
  readonly verifier: IndependentHumanPilotVerifierV33_6;
}

export interface PilotScenarioResultV33_6 {
  readonly scenarioId: string;
  readonly participantId?: string;
  readonly evidenceClass: PilotEvidenceClassV33_6;
  readonly baselineSteps: number;
  readonly prototypeSteps: number;
  readonly approvals: number;
  readonly comprehensionSeconds?: number;
  readonly errors: number;
  readonly consentRecorded: boolean;
  readonly accessibilityPassed: boolean;
  readonly sessionRevokedDuringFlow: boolean;
}

export interface HumanPilotReadinessEvidenceV33_6 {
  readonly version: '33.6';
  readonly scenarios: number;
  readonly humanParticipants: number;
  readonly stepReductionPct: number;
  readonly medianApprovals: number;
  readonly medianComprehensionSeconds?: number;
  readonly errorRatePct: number;
  readonly accessibilityPassed: boolean;
  readonly structuralCriteriaPassed: boolean;
  readonly humanCriteriaPassed: boolean;
  readonly g3Eligible: boolean;
  readonly evidenceClass: 'SIMULATED_READINESS' | 'UNQUALIFIED_HUMAN_CLAIM' | 'HUMAN_PILOT';
  readonly productionCeiling: 'shadow';
  readonly externalEffectsExecuted: 0;
  readonly evidenceDigest: string;
}

export function evaluateHumanPilotReadinessV33_6(results: readonly PilotScenarioResultV33_6[], qualified?: QualifiedHumanPilotInputV33_6): HumanPilotReadinessEvidenceV33_6 {
  if (results.length === 0) throw new Error('pilot_scenario_required');
  const qualifiedResults = qualified === undefined ? undefined : qualified.verifier.verify(qualified.observations);
  if (qualifiedResults !== undefined && sha256(qualifiedResults) !== sha256(results)) throw new Error('qualified_human_observations_do_not_match_results');
  const ids = new Set<string>();
  const participants = new Set<string>();
  let baseline = 0;
  let prototype = 0;
  let approvals = 0;
  let errors = 0;
  const approvalValues: number[] = [];
  const humanComprehension: number[] = [];
  let accessibilityPassed = true;
  let allHuman = true;
  for (const result of results) {
    const scenarioId = identifier(result.scenarioId, 'pilot_scenario_id_required');
    if (ids.has(scenarioId)) throw new Error('pilot_scenario_duplicate');
    ids.add(scenarioId);
    integer(result.baselineSteps, 1, 'pilot_baseline_steps_invalid');
    integer(result.prototypeSteps, 0, 'pilot_prototype_steps_invalid');
    integer(result.approvals, 0, 'pilot_approvals_invalid');
    integer(result.errors, 0, 'pilot_errors_invalid');
    if (result.prototypeSteps > result.baselineSteps) throw new Error('pilot_prototype_steps_exceed_baseline');
    if (result.sessionRevokedDuringFlow) throw new Error('revoked_session_cannot_support_pilot_evidence');
    if (result.evidenceClass === 'HUMAN_OBSERVED') {
      if (!result.consentRecorded || result.participantId === undefined || result.comprehensionSeconds === undefined || !Number.isFinite(result.comprehensionSeconds) || result.comprehensionSeconds < 0) throw new Error('human_pilot_result_incomplete');
      participants.add(identifier(result.participantId, 'pilot_participant_required'));
      humanComprehension.push(result.comprehensionSeconds);
    } else {
      allHuman = false;
      if (result.consentRecorded || result.participantId !== undefined || result.comprehensionSeconds !== undefined) throw new Error('simulated_result_claims_human_observation');
    }
    baseline += result.baselineSteps;
    prototype += result.prototypeSteps;
    approvals += result.approvals;
    approvalValues.push(result.approvals);
    errors += result.errors;
    accessibilityPassed = accessibilityPassed && result.accessibilityPassed;
  }
  const stepReductionPct = Number((((baseline - prototype) / baseline) * 100).toFixed(2));
  const medianApprovals = median(approvalValues);
  const medianComprehensionSeconds = humanComprehension.length === 0 ? undefined : median(humanComprehension);
  const totalInteractions = Math.max(1, prototype + approvals);
  const errorRatePct = Number(((errors / totalInteractions) * 100).toFixed(2));
  const structuralCriteriaPassed = stepReductionPct >= 70 && medianApprovals <= 1 && errorRatePct <= 5 && accessibilityPassed;
  const humanEvidenceQualified = allHuman && qualifiedResults !== undefined;
  const humanCriteriaPassed = humanEvidenceQualified && participants.size >= 5 && medianComprehensionSeconds !== undefined && medianComprehensionSeconds < 10 && structuralCriteriaPassed;
  const evidenceClass = humanCriteriaPassed ? 'HUMAN_PILOT' : allHuman ? 'UNQUALIFIED_HUMAN_CLAIM' : 'SIMULATED_READINESS';
  const material = {
    version: '33.6' as const,
    scenarios: results.length,
    humanParticipants: participants.size,
    stepReductionPct,
    medianApprovals,
    ...(medianComprehensionSeconds === undefined ? {} : { medianComprehensionSeconds }),
    errorRatePct,
    accessibilityPassed,
    structuralCriteriaPassed,
    humanCriteriaPassed,
    g3Eligible: humanCriteriaPassed,
    evidenceClass: evidenceClass as 'SIMULATED_READINESS' | 'UNQUALIFIED_HUMAN_CLAIM' | 'HUMAN_PILOT',
    productionCeiling: 'shadow' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, evidenceDigest: sha256(material) };
}

export interface PwaStructuralAuditV33_6 {
  readonly version: '33.6';
  readonly checks: Readonly<Record<string, boolean>>;
  readonly passed: boolean;
  readonly evidenceClass: 'STATIC_STRUCTURAL_AUDIT';
  readonly humanAccessibilityValidated: false;
  readonly auditDigest: string;
}

export function auditPwaAssetsV33_6(input: { readonly html: string; readonly javascript: string; readonly css: string; readonly manifest: string; readonly serviceWorker: string }): PwaStructuralAuditV33_6 {
  let parsedManifest: Record<string, unknown> = {};
  try { parsedManifest = JSON.parse(input.manifest) as Record<string, unknown>; } catch { /* checked below */ }
  const checks = {
    documentLanguage: /<html[^>]+lang="[^"]+"/i.test(input.html),
    viewport: /name="viewport"/i.test(input.html),
    skipLink: /class="skip-link"/i.test(input.html),
    mainLandmark: /<main\b/i.test(input.html),
    liveRegion: /aria-live=/i.test(input.html),
    noInlineScript: !/<script(?![^>]+src=)[^>]*>/i.test(input.html),
    fourDecisionActions: ['YES','NO','CHANGE_CONDITIONS','EXPLAIN'].every((action) => input.html.includes(`data-action="${action}"`)),
    visibleRiskAndRollback: /id="risk"/i.test(input.html) && /id="rollback"/i.test(input.html),
    minimumTouchTarget: /min-height:\s*44px/i.test(input.css),
    reducedMotion: /prefers-reduced-motion/i.test(input.css),
    manifestName: typeof parsedManifest.name === 'string' && parsedManifest.name.length > 0,
    manifestStandalone: parsedManifest.display === 'standalone',
    manifestIcons: Array.isArray(parsedManifest.icons)
      && ['192x192', '512x512'].every((size) => (parsedManifest.icons as unknown[]).some((icon: unknown) => {
        if (typeof icon !== 'object' || icon === null) return false;
        const record = icon as Record<string, unknown>;
        return record.sizes === size && record.type === 'image/png' && typeof record.src === 'string';
      })),
    serviceWorkerNoApiCaching: /\/api\//.test(input.serviceWorker) && /fetch\(event\.request\)/.test(input.serviceWorker),
    javascriptNoEval: !/\beval\s*\(/.test(input.javascript) && !/new Function\s*\(/.test(input.javascript),
  };
  const material = { version: '33.6' as const, checks, passed: Object.values(checks).every(Boolean), evidenceClass: 'STATIC_STRUCTURAL_AUDIT' as const, humanAccessibilityValidated: false as const };
  return { ...material, auditDigest: sha256(material) };
}

export interface ExternalPushProviderPlanV33_6 {
  readonly provider: 'APNS' | 'FCM';
  readonly transport: 'HTTP2_TLS_1_2_OR_LATER' | 'HTTPS_HTTP_V1';
  readonly authentication: 'APNS_TOKEN_OR_CERTIFICATE' | 'OAUTH2_SHORT_LIVED_ACCESS_TOKEN';
  readonly credentialReference: string;
  readonly endpointPattern: string;
  readonly deviceTokenStorage: 'ENCRYPTED_TENANT_BOUND';
  readonly retryAndDedupRequired: true;
  readonly revocationRequired: true;
  readonly liveCredentialsPresent: false;
  readonly externalNetworkExecuted: false;
}

export interface ExternalProviderQualificationKitV33_6 {
  readonly version: '33.6';
  readonly providers: readonly ExternalPushProviderPlanV33_6[];
  readonly requirements: readonly string[];
  readonly status: 'READY_FOR_CREDENTIALLED_QUALIFICATION';
  readonly externalQualification: 'not_executed';
  readonly productionPromotion: 'blocked';
  readonly kitDigest: string;
}

export function createExternalProviderQualificationKitV33_6(plans: readonly ExternalPushProviderPlanV33_6[]): ExternalProviderQualificationKitV33_6 {
  if (plans.length !== 2 || new Set(plans.map((plan) => plan.provider)).size !== 2) throw new Error('external_provider_plan_set_invalid');
  for (const plan of plans) {
    if (!/^(env|kms|hsm):\/\/[A-Za-z0-9._/-]+$/.test(plan.credentialReference)) throw new Error('external_provider_credential_reference_invalid');
    if (/private[_-]?key|-----BEGIN|\{\s*"type"\s*:\s*"service_account"/i.test(plan.credentialReference)) throw new Error('raw_provider_credential_forbidden');
    if (plan.deviceTokenStorage !== 'ENCRYPTED_TENANT_BOUND' || !plan.retryAndDedupRequired || !plan.revocationRequired || plan.liveCredentialsPresent || plan.externalNetworkExecuted) throw new Error('external_provider_plan_boundary_invalid');
    if (plan.provider === 'APNS') {
      if (plan.transport !== 'HTTP2_TLS_1_2_OR_LATER' || plan.authentication !== 'APNS_TOKEN_OR_CERTIFICATE' || !/^api\.(sandbox\.)?push\.apple\.com:443$/.test(plan.endpointPattern)) throw new Error('apns_plan_invalid');
    } else if (plan.transport !== 'HTTPS_HTTP_V1' || plan.authentication !== 'OAUTH2_SHORT_LIVED_ACCESS_TOKEN' || plan.endpointPattern !== 'https://fcm.googleapis.com/v1/projects/{projectId}/messages:send') throw new Error('fcm_plan_invalid');
  }
  const material = {
    version: '33.6' as const,
    providers: [...plans].sort((a, b) => a.provider.localeCompare(b.provider)),
    requirements: [
      'credential material remains outside the repository and is loaded through an approved secret adapter',
      'provider request and response identifiers bind to the canonical delivery digest',
      'device-token rotation, invalid-token handling, retry, deduplication and revocation are exercised',
      'TLS certificate validation, timeout, payload limits and egress allowlists are independently observed',
      'no production effect is allowed until external qualification evidence is signed and reviewed',
    ],
    status: 'READY_FOR_CREDENTIALLED_QUALIFICATION' as const,
    externalQualification: 'not_executed' as const,
    productionPromotion: 'blocked' as const,
  };
  return { ...material, kitDigest: sha256(material) };
}

function validateCard(card: PushApprovalCard, tenantId: string): void {
  if (card.version !== '33.1' || card.tenantId !== tenantId || card.options.length !== 4 || card.options.some((option) => !['YES','NO','CHANGE_CONDITIONS','EXPLAIN'].includes(option))) throw new Error('pilot_card_invalid');
}
function identifier(value: string, code: string): string { const normalized = value.trim(); if (normalized === '' || normalized.length > 256) throw new Error(code); return normalized; }
function secret(value: string, code: string): string { if (value.length < 16 || value.length > 4096) throw new Error(code); return value; }
function unique(values: readonly string[], code: string): readonly string[] { const normalized = values.map((value) => identifier(value, code)); if (new Set(normalized).size !== normalized.length) throw new Error(code); return normalized; }
function instant(value: string, code: string): number { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error(code); return parsed; }
function validDate(value: Date): void { if (!Number.isFinite(value.getTime())) throw new Error('current_time_invalid'); }
function integer(value: number, minimum: number, code: string): void { if (!Number.isSafeInteger(value) || value < minimum) throw new Error(code); }
function digest(value: string, code: string): string { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(code); return value; }
function median(values: readonly number[]): number { const sorted = [...values].sort((a,b)=>a-b); const middle=Math.floor(sorted.length/2); return sorted.length%2===0 ? (sorted[middle-1]!+sorted[middle]!)/2 : sorted[middle]!; }
