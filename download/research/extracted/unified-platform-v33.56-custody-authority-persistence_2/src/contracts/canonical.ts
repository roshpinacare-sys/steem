import { sha256, type SignedEnvelope } from './crypto.js';

export const EVIDENCE_CLASSES = ['SIMULATED', 'COMPUTED', 'MEASURED', 'OBSERVED', 'ATTESTED', 'INFERRED', 'ESTIMATED'] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];
export type PromotionState = 'research' | 'shadow' | 'production';

export interface AuthorityGrant {
  readonly grantId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly workspaceId?: string;
  readonly scopes: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly issuer: string;
  readonly evidenceRef?: string;
  readonly revokedAt?: string;
}

export type SignedAuthorityGrant = SignedEnvelope<AuthorityGrant>;

export interface EvidenceRecord {
  readonly recordId: string;
  readonly tenantId: string;
  readonly kind: string;
  readonly subject: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly evidenceClass: EvidenceClass;
  readonly method: string;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly previousDigest?: string;
  readonly limitations: readonly string[];
}

export interface PromotionDecision {
  readonly candidateId: string;
  readonly tenantId: string;
  readonly fromState: PromotionState;
  readonly toState: PromotionState;
  readonly builderId: string;
  readonly reviewerIds: readonly string[];
  readonly evidenceRoot: string;
  readonly residualRisk: readonly string[];
  readonly rollbackRef: string;
  readonly expectedRevision: number;
}

export interface ActionPassport {
  readonly passportId: string;
  readonly tenantId: string;
  readonly subject: string;
  readonly authorityGrantDigest: string;
  readonly evidenceRoot: string;
  readonly promotionState: 'shadow';
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly reviewerIds: readonly string[];
  readonly limitations: readonly string[];
}

export const HIGH_RISK_SCOPES = new Set([
  'production.deploy',
  'payment.capture',
  'ledger.post',
  'secret.read',
  'authority.grant',
]);

function requireNonEmpty(value: string, code: string): void {
  if (value.trim() === '') throw new Error(code);
}

function parseInstant(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
}

export function validateAuthorityGrant(grant: AuthorityGrant, now = new Date()): void {
  requireNonEmpty(grant.grantId, 'grant_id_required');
  requireNonEmpty(grant.tenantId, 'tenant_id_required');
  requireNonEmpty(grant.subjectId, 'subject_id_required');
  requireNonEmpty(grant.issuer, 'issuer_required');
  if (grant.scopes.length === 0) throw new Error('scope_required');
  if (new Set(grant.scopes).size !== grant.scopes.length) throw new Error('duplicate_scope');
  if (grant.scopes.some((scope) => scope === '*' || scope.endsWith('.*'))) throw new Error('wildcard_scope_forbidden');
  if (grant.revokedAt !== undefined) throw new Error('grant_revoked');
  const issuedAt = parseInstant(grant.issuedAt, 'invalid_issued_at');
  const expiresAt = parseInstant(grant.expiresAt, 'invalid_expires_at');
  if (expiresAt <= issuedAt) throw new Error('invalid_expiry');
  if (now.getTime() >= expiresAt) throw new Error('grant_expired');
}

export function authorityAllows(
  grant: AuthorityGrant,
  request: { tenantId: string; subjectId: string; scope: string; workspaceId?: string },
  now = new Date(),
): boolean {
  try {
    validateAuthorityGrant(grant, now);
  } catch {
    return false;
  }
  return grant.tenantId === request.tenantId
    && grant.subjectId === request.subjectId
    && grant.scopes.includes(request.scope)
    && (grant.workspaceId === undefined || grant.workspaceId === request.workspaceId);
}

export function validateEvidenceRecord(record: EvidenceRecord): void {
  requireNonEmpty(record.recordId, 'record_id_required');
  requireNonEmpty(record.tenantId, 'tenant_id_required');
  requireNonEmpty(record.kind, 'kind_required');
  requireNonEmpty(record.subject, 'subject_required');
  requireNonEmpty(record.method, 'method_required');
  if (!EVIDENCE_CLASSES.includes(record.evidenceClass)) throw new Error('invalid_evidence_class');
  assertFinite(record.payload);
  if (record.evidenceClass === 'MEASURED' && typeof record.environment.instrumentId !== 'string') {
    throw new Error('measured_evidence_requires_instrument');
  }
  if (record.evidenceClass === 'SIMULATED' && record.payload.physicalClaimAllowed === true) {
    throw new Error('simulated_evidence_cannot_authorize_physical_claim');
  }
}

export function evidenceDigest(record: EvidenceRecord): string {
  validateEvidenceRecord(record);
  return sha256({
    ...record,
    payloadDigest: sha256(record.payload),
  });
}

export function validatePromotionDecision(decision: PromotionDecision): void {
  if (decision.reviewerIds.length === 0) throw new Error('reviewer_required');
  if (decision.reviewerIds.includes(decision.builderId)) throw new Error('self_approval_forbidden');
  if (new Set(decision.reviewerIds).size !== decision.reviewerIds.length) throw new Error('duplicate_reviewer');
  if (decision.rollbackRef.trim() === '') throw new Error('rollback_required');
  if (decision.expectedRevision < 0) throw new Error('invalid_revision');
  if (decision.toState === 'production') throw new Error('production_promotion_forbidden_in_proof');
  if (decision.toState !== 'shadow') throw new Error('only_shadow_promotion_allowed');
}

export function validateActionPassport(passport: ActionPassport, now = new Date()): void {
  requireNonEmpty(passport.passportId, 'passport_id_required');
  requireNonEmpty(passport.tenantId, 'tenant_id_required');
  requireNonEmpty(passport.subject, 'subject_required');
  requireNonEmpty(passport.evidenceRoot, 'evidence_root_required');
  if (passport.promotionState !== 'shadow') throw new Error('passport_must_be_shadow_only');
  if (passport.reviewerIds.length === 0) throw new Error('passport_reviewer_required');
  const issuedAt = parseInstant(passport.issuedAt, 'invalid_issued_at');
  const expiresAt = parseInstant(passport.expiresAt, 'invalid_expires_at');
  if (expiresAt <= issuedAt) throw new Error('invalid_expiry');
  if (now.getTime() >= expiresAt) throw new Error('passport_expired');
}

function assertFinite(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non_finite_value');
  if (Array.isArray(value)) {
    for (const child of value) assertFinite(child);
  } else if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) assertFinite(child);
  }
}
