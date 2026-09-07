import type {
  CapabilityIdentity,
  CapabilityTrustEvent,
  CapabilityTrustState,
  TrustEventType,
  TrustViolation,
  TrustViolationSeverity,
} from './capability-trust-types.js';

export function validateCapabilityIdentity(identity: CapabilityIdentity): void {
  if (identity.tenantId.trim() === '' || identity.capabilityId.trim() === '' || identity.version.trim() === '' || identity.publisherId.trim() === '') {
    throw new Error('invalid_capability_identity');
  }
  if (identity.originalScopes.length === 0 || new Set(identity.originalScopes).size !== identity.originalScopes.length) {
    throw new Error('invalid_capability_scopes');
  }
  if (identity.originalScopes.some((scope) => scope === '*' || scope.endsWith('.*'))) {
    throw new Error('capability_wildcard_scope_forbidden');
  }
}

export function validateTrustViolation(violation: TrustViolation): void {
  if (violation.violationId.trim() === '' || violation.evidenceRef.trim() === '' || violation.message.trim() === '') {
    throw new Error('invalid_trust_violation');
  }
  if (!Number.isFinite(Date.parse(violation.observedAt))) throw new Error('invalid_trust_violation_time');
}

export function effectiveTrustViolationSeverity(violation: TrustViolation): TrustViolationSeverity {
  return violation.kind === 'EVIDENCE_TAMPERING' || violation.kind === 'TENANT_LEAK' ? 'CRITICAL' : violation.severity;
}

export function independentReviewers(reviewers: readonly string[], forbidden: string): string[] {
  return [...new Set(reviewers.filter((reviewer) => reviewer.trim() !== '' && reviewer !== forbidden))].sort();
}

export function validateTrustTransition(current: CapabilityTrustState | undefined, type: TrustEventType): void {
  if (type === 'REGISTERED' || type === 'UPGRADE_REGISTERED') {
    if (current !== undefined) throw new Error('capability_already_registered');
    return;
  }
  if (current === undefined) throw new Error('capability_trust_state_not_found');
  if (type === 'VIOLATION_RECORDED' && current.status === 'REVOKED') throw new Error('capability_already_revoked');
  if (type === 'APPEAL_OPENED' && current.status !== 'RESTRICTED' && current.status !== 'QUARANTINED') throw new Error('capability_appeal_not_allowed');
  if (type === 'OVERRIDE_APPROVED' && current.status !== 'RESTRICTED' && current.status !== 'QUARANTINED') throw new Error('capability_override_not_allowed');
  if (type === 'RECERTIFIED' && current.status !== 'REQUALIFICATION_REQUIRED' && current.status !== 'QUARANTINED' && current.status !== 'RESTRICTED') {
    throw new Error(current.status === 'REVOKED' ? 'revoked_capability_requires_new_version' : 'capability_recertification_not_required');
  }
  if (type === 'REVOKED' && current.status === 'REVOKED') throw new Error('capability_already_revoked');
}

export function applyCapabilityTrustEvent(current: CapabilityTrustState | undefined, event: CapabilityTrustEvent): CapabilityTrustState {
  if (event.type === 'REGISTERED' || event.type === 'UPGRADE_REGISTERED') return registrationState(event);
  if (current === undefined) throw new Error('capability_trust_event_without_registration');
  const base: CapabilityTrustState = { ...current, revision: current.revision + 1, lastEventDigest: event.digest };
  switch (event.type) {
    case 'VIOLATION_RECORDED': return applyViolation(base, current, event);
    case 'OVERRIDE_APPROVED': return { ...base, status: 'REQUALIFICATION_REQUIRED', allowedScopes: [] };
    case 'RECERTIFIED': return {
      ...base,
      status: 'TRUSTED',
      allowedScopes: requireStringArray(event.payload.restoredScopes, 'invalid_recertification_scopes'),
      lowSeverityStreak: 0,
      lastEvidenceRoot: requireString(event.payload.evidenceRoot, 'invalid_recertification_root'),
    };
    case 'REVOKED': return { ...base, status: 'REVOKED', allowedScopes: [] };
    case 'APPEAL_OPENED': return base;
    default: return assertNever(event.type);
  }
}

function registrationState(event: CapabilityTrustEvent): CapabilityTrustState {
  const payload = event.payload;
  const originalScopes = requireStringArray(payload.originalScopes, 'invalid_capability_scopes');
  return {
    tenantId: requireString(payload.tenantId, 'invalid_capability_tenant'),
    capabilityId: requireString(payload.capabilityId, 'invalid_capability_id'),
    version: requireString(payload.version, 'invalid_capability_version'),
    publisherId: requireString(payload.publisherId, 'invalid_capability_publisher'),
    originalScopes,
    status: event.type === 'REGISTERED' ? 'TRUSTED' : 'REQUALIFICATION_REQUIRED',
    allowedScopes: event.type === 'REGISTERED' ? originalScopes : [],
    violationCount: 0,
    lowSeverityStreak: 0,
    revision: 1,
    ...(typeof payload.predecessorRef === 'string' ? { predecessorRef: payload.predecessorRef } : {}),
    lastEventDigest: event.digest,
  };
}

function applyViolation(base: CapabilityTrustState, current: CapabilityTrustState, event: CapabilityTrustEvent): CapabilityTrustState {
  const severity = requireSeverity(event.payload.severity);
  const lowSeverityStreak = severity === 'LOW' ? current.lowSeverityStreak + 1 : 0;
  const status = severity === 'CRITICAL' ? 'REVOKED'
    : severity === 'HIGH' ? 'QUARANTINED'
      : severity === 'MEDIUM' || lowSeverityStreak >= 3 ? 'RESTRICTED'
        : current.status;
  const allowedScopes = status === 'TRUSTED' ? current.allowedScopes : status === 'RESTRICTED' ? readOnlyScopes(current.originalScopes) : [];
  return { ...base, status, allowedScopes, violationCount: current.violationCount + 1, lowSeverityStreak };
}

function readOnlyScopes(scopes: readonly string[]): string[] {
  return scopes.filter((scope) => scope.endsWith('.read') || scope.endsWith('.inspect') || scope === 'evidence.emit').sort();
}
function requireString(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(code);
  return value;
}
function requireStringArray(value: unknown, code: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim() === '')) throw new Error(code);
  return [...new Set(value as string[])].sort();
}
function requireSeverity(value: unknown): TrustViolationSeverity {
  if (value !== 'LOW' && value !== 'MEDIUM' && value !== 'HIGH' && value !== 'CRITICAL') throw new Error('invalid_trust_violation_severity');
  return value;
}
function assertNever(value: never): never { throw new Error(`unsupported_capability_trust_event:${String(value)}`); }
