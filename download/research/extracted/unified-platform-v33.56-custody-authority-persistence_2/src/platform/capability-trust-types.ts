export type CapabilityTrustStatus = 'TRUSTED' | 'RESTRICTED' | 'QUARANTINED' | 'REQUALIFICATION_REQUIRED' | 'REVOKED';
export type TrustViolationSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TrustViolationKind = 'POLICY' | 'INVALID_OUTPUT' | 'RESOURCE_ABUSE' | 'EVIDENCE_TAMPERING' | 'TENANT_LEAK' | 'REPEATED_FAILURE';
export type TrustEventType = 'REGISTERED' | 'VIOLATION_RECORDED' | 'APPEAL_OPENED' | 'OVERRIDE_APPROVED' | 'RECERTIFIED' | 'REVOKED' | 'UPGRADE_REGISTERED';

export interface CapabilityIdentity {
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly version: string;
  readonly publisherId: string;
  readonly originalScopes: readonly string[];
}
export interface CapabilityTrustState extends CapabilityIdentity {
  readonly status: CapabilityTrustStatus;
  readonly allowedScopes: readonly string[];
  readonly violationCount: number;
  readonly lowSeverityStreak: number;
  readonly revision: number;
  readonly lastEvidenceRoot?: string;
  readonly predecessorRef?: string;
  readonly lastEventDigest: string;
}
export interface TrustViolation {
  readonly violationId: string;
  readonly kind: TrustViolationKind;
  readonly severity: TrustViolationSeverity;
  readonly evidenceRef: string;
  readonly observedAt: string;
  readonly message: string;
}
export interface CapabilityTrustEvent {
  readonly sequence: number;
  readonly eventId: string;
  readonly tenantId: string;
  readonly capabilityRef: string;
  readonly type: TrustEventType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly previousDigest: string | null;
  readonly digest: string;
}
