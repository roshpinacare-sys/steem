import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorityAllows, validateActionPassport, validateAuthorityGrant, validateEvidenceRecord, validatePromotionDecision,
  type ActionPassport, type AuthorityGrant, type EvidenceRecord, type PromotionDecision,
} from '../src/contracts/canonical.js';

const now = new Date('2026-07-17T12:00:00.000Z');
const grant = (overrides: Partial<AuthorityGrant> = {}): AuthorityGrant => ({ grantId: 'g', tenantId: 't', subjectId: 's', scopes: ['repository.read'], issuedAt: '2026-07-17T11:00:00.000Z', expiresAt: '2026-07-17T13:00:00.000Z', issuer: 'kernel', ...overrides });
const evidence = (overrides: Partial<EvidenceRecord> = {}): EvidenceRecord => ({ recordId: 'e', tenantId: 't', kind: 'test', subject: 's', payload: { nested: [1, { ok: true }] }, evidenceClass: 'COMPUTED', method: 'node', environment: {}, createdAt: now.toISOString(), limitations: [], ...overrides });
const decision = (overrides: Partial<PromotionDecision> = {}): PromotionDecision => ({ candidateId: 'c', tenantId: 't', fromState: 'research', toState: 'shadow', builderId: 'builder', reviewerIds: ['reviewer'], evidenceRoot: 'root', residualRisk: [], rollbackRef: 'rollback', expectedRevision: 0, ...overrides });
const passport = (overrides: Partial<ActionPassport> = {}): ActionPassport => ({ passportId: 'p', tenantId: 't', subject: 's', authorityGrantDigest: 'a', evidenceRoot: 'e', promotionState: 'shadow', issuedAt: '2026-07-17T11:00:00.000Z', expiresAt: '2026-07-17T13:00:00.000Z', reviewerIds: ['r'], limitations: [], ...overrides });

test('authority validation covers every required identity, time and scope boundary', () => {
  for (const [field, code] of [['grantId','grant_id_required'],['tenantId','tenant_id_required'],['subjectId','subject_id_required'],['issuer','issuer_required']] as const) assert.throws(() => validateAuthorityGrant(grant({ [field]: ' ' }), now), new RegExp(code));
  assert.throws(() => validateAuthorityGrant(grant({ scopes: [] }), now), /scope_required/);
  assert.throws(() => validateAuthorityGrant(grant({ scopes: ['repository.*'] }), now), /wildcard_scope_forbidden/);
  assert.throws(() => validateAuthorityGrant(grant({ revokedAt: now.toISOString() }), now), /grant_revoked/);
  assert.throws(() => validateAuthorityGrant(grant({ issuedAt: 'invalid' }), now), /invalid_issued_at/);
  assert.throws(() => validateAuthorityGrant(grant({ expiresAt: 'invalid' }), now), /invalid_expires_at/);
  assert.throws(() => validateAuthorityGrant(grant({ issuedAt: '2026-07-17T13:00:00Z', expiresAt: '2026-07-17T12:00:00Z' }), now), /invalid_expiry/);
  assert.equal(authorityAllows(grant(), { tenantId: 't', subjectId: 's', scope: 'repository.read' }, now), true);
  assert.equal(authorityAllows(grant({ expiresAt: now.toISOString() }), { tenantId: 't', subjectId: 's', scope: 'repository.read' }, now), false);
});

test('evidence validation covers required fields, classes and recursive finite values', () => {
  for (const [field, code] of [['recordId','record_id_required'],['tenantId','tenant_id_required'],['kind','kind_required'],['subject','subject_required'],['method','method_required']] as const) assert.throws(() => validateEvidenceRecord(evidence({ [field]: ' ' })), new RegExp(code));
  assert.throws(() => validateEvidenceRecord(evidence({ evidenceClass: 'UNKNOWN' as never })), /invalid_evidence_class/);
  assert.throws(() => validateEvidenceRecord(evidence({ payload: { array: [1, Number.POSITIVE_INFINITY] } })), /non_finite_value/);
  assert.throws(() => validateEvidenceRecord(evidence({ evidenceClass: 'MEASURED', environment: { instrumentId: 123 } })), /measured_evidence_requires_instrument/);
  assert.doesNotThrow(() => validateEvidenceRecord(evidence({ evidenceClass: 'SIMULATED', payload: { physicalClaimAllowed: false } })));
});

test('promotion validation covers quorum, rollback, revision and every forbidden state', () => {
  assert.throws(() => validatePromotionDecision(decision({ reviewerIds: [] })), /reviewer_required/);
  assert.throws(() => validatePromotionDecision(decision({ reviewerIds: ['r','r'] })), /duplicate_reviewer/);
  assert.throws(() => validatePromotionDecision(decision({ rollbackRef: ' ' })), /rollback_required/);
  assert.throws(() => validatePromotionDecision(decision({ expectedRevision: -1 })), /invalid_revision/);
  assert.throws(() => validatePromotionDecision(decision({ toState: 'research' })), /only_shadow_promotion_allowed/);
});

test('passport validation covers identity, state and all time boundaries', () => {
  for (const [field, code] of [['passportId','passport_id_required'],['tenantId','tenant_id_required'],['subject','subject_required'],['evidenceRoot','evidence_root_required']] as const) assert.throws(() => validateActionPassport(passport({ [field]: ' ' }), now), new RegExp(code));
  assert.throws(() => validateActionPassport(passport({ promotionState: 'production' as never }), now), /passport_must_be_shadow_only/);
  assert.throws(() => validateActionPassport(passport({ issuedAt: 'bad' }), now), /invalid_issued_at/);
  assert.throws(() => validateActionPassport(passport({ expiresAt: 'bad' }), now), /invalid_expires_at/);
  assert.throws(() => validateActionPassport(passport({ issuedAt: '2026-07-17T13:00:00Z', expiresAt: '2026-07-17T12:00:00Z' }), now), /invalid_expiry/);
  assert.throws(() => validateActionPassport(passport({ expiresAt: now.toISOString() }), now), /passport_expired/);
});
