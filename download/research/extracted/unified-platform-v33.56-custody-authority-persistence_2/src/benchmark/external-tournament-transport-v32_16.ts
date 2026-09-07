import { sha256, type KeyRegistry, type SignedEnvelope, type SigningIdentity, signEnvelope } from '../contracts/crypto.js';

export type TournamentTransportAuthorityV32_16 = 'LOCAL_FIXTURE' | 'EXTERNAL_PINNED';
export type TournamentTransportModeV32_16 = 'LOCAL_DRY_RUN' | 'EXTERNAL_OBSERVED';

export interface TournamentInvocationV32_16 {
  readonly schemaVersion: '32.16';
  readonly runId: string;
  readonly taskId: string;
  readonly blindLabel: string;
  readonly providerId: string;
  readonly requestDigest: string;
  readonly responseDigest: string;
  readonly nonce: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly externalResponseId: string;
  readonly synthetic: boolean;
}

export interface TournamentTransportObservationV32_16 {
  readonly invocationDigest: string;
  readonly observerId: string;
  readonly observerOrganizationId: string;
  readonly providerId: string;
  readonly providerOrganizationId: string;
  readonly transport: 'HTTPS';
  readonly observedAt: string;
  readonly externalResponseId: string;
  readonly requestDigest: string;
  readonly responseDigest: string;
  readonly synthetic: boolean;
}

export interface TournamentTransportTrustV32_16 {
  readonly policyDigest: string;
  readonly observerAuthorizations: readonly {
    readonly observerId: string;
    readonly organizationId: string;
    readonly keyId: string;
    readonly keyFingerprint: string;
    readonly authority: TournamentTransportAuthorityV32_16;
  }[];
}

export interface TournamentTransportReportV32_16 {
  readonly schemaVersion: '32.16';
  readonly mode: TournamentTransportModeV32_16;
  readonly state: 'FAILED' | 'DRY_RUN_PASSED' | 'PASSED';
  readonly externallyObserved: boolean;
  readonly findings: readonly string[];
  readonly invocationDigest: string;
  readonly reportDigest: string;
}

export function signTournamentTransportObservationV32_16(
  observation: TournamentTransportObservationV32_16,
  identity: SigningIdentity,
): SignedEnvelope<TournamentTransportObservationV32_16> {
  validateObservation(observation);
  return signEnvelope(observation, identity);
}

export function evaluateTournamentTransportV32_16(options: {
  readonly invocation: TournamentInvocationV32_16;
  readonly observation: SignedEnvelope<TournamentTransportObservationV32_16>;
  readonly registry: KeyRegistry;
  readonly trust: TournamentTransportTrustV32_16;
  readonly mode: TournamentTransportModeV32_16;
  readonly now: Date;
}): TournamentTransportReportV32_16 {
  validateInvocation(options.invocation);
  validateTrust(options.trust);
  if (!Number.isFinite(options.now.getTime())) throw new Error('tournament_transport_time_invalid');
  const findings: string[] = [];
  const invocationDigest = sha256(options.invocation);
  const observed = options.observation.payload;
  try { validateObservation(observed); } catch { findings.push('transport-observation-shape-invalid'); }
  const authorization = options.trust.observerAuthorizations.find((row) => row.keyId === options.observation.issuerKeyId);
  if (authorization === undefined || options.registry.fingerprint(options.observation.issuerKeyId) !== authorization.keyFingerprint || !options.registry.verifyAt(options.observation, observed.observedAt)) {
    findings.push('transport-observation-signature-invalid');
  }
  if (authorization === undefined || authorization.observerId !== observed.observerId || authorization.organizationId !== observed.observerOrganizationId) {
    findings.push('transport-observer-authorization-mismatch');
  }
  if (observed.observerId === options.invocation.providerId || observed.observerOrganizationId === observed.providerOrganizationId) {
    findings.push('transport-self-attestation');
  }
  if (observed.invocationDigest !== invocationDigest || observed.providerId !== options.invocation.providerId || observed.externalResponseId !== options.invocation.externalResponseId || observed.requestDigest !== options.invocation.requestDigest || observed.responseDigest !== options.invocation.responseDigest) {
    findings.push('transport-lineage-mismatch');
  }
  const observedAt = Date.parse(observed.observedAt);
  const startedAt = Date.parse(options.invocation.startedAt);
  const completedAt = Date.parse(options.invocation.completedAt);
  if (!Number.isFinite(observedAt) || observedAt < startedAt || observedAt > options.now.getTime() + 60_000 || completedAt < startedAt || observedAt < completedAt) {
    findings.push('transport-observation-time-invalid');
  }
  const external = findings.length === 0 && options.mode === 'EXTERNAL_OBSERVED' && authorization?.authority === 'EXTERNAL_PINNED' && !options.invocation.synthetic && !observed.synthetic;
  if (options.mode === 'EXTERNAL_OBSERVED' && !external) findings.push('transport-external-evidence-insufficient');
  const state: TournamentTransportReportV32_16['state'] = findings.length > 0 ? 'FAILED' : external ? 'PASSED' : 'DRY_RUN_PASSED';
  const material = { schemaVersion: '32.16' as const, mode: options.mode, state, externallyObserved: external, findings, invocationDigest };
  return { ...material, reportDigest: sha256(material) };
}

function validateInvocation(value: TournamentInvocationV32_16): void {
  if (value.schemaVersion !== '32.16' || [value.runId, value.taskId, value.blindLabel, value.providerId, value.nonce, value.externalResponseId].some((item) => item.trim() === '')) throw new Error('tournament_transport_invocation_identity_invalid');
  if (![value.requestDigest, value.responseDigest].every(digest)) throw new Error('tournament_transport_invocation_digest_invalid');
  const start = Date.parse(value.startedAt), end = Date.parse(value.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('tournament_transport_invocation_time_invalid');
}
function validateObservation(value: TournamentTransportObservationV32_16): void {
  if ([value.observerId, value.observerOrganizationId, value.providerId, value.providerOrganizationId, value.externalResponseId].some((item) => item.trim() === '')) throw new Error('tournament_transport_observation_identity_invalid');
  if (![value.invocationDigest, value.requestDigest, value.responseDigest].every(digest) || !Number.isFinite(Date.parse(value.observedAt))) throw new Error('tournament_transport_observation_digest_invalid');
}
function validateTrust(value: TournamentTransportTrustV32_16): void {
  if (!digest(value.policyDigest) || value.observerAuthorizations.length === 0 || new Set(value.observerAuthorizations.map((row) => row.keyId)).size !== value.observerAuthorizations.length) throw new Error('tournament_transport_trust_invalid');
  for (const row of value.observerAuthorizations) if ([row.observerId, row.organizationId, row.keyId].some((item) => item.trim() === '') || !digest(row.keyFingerprint)) throw new Error('tournament_transport_authorization_invalid');
}
function digest(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
