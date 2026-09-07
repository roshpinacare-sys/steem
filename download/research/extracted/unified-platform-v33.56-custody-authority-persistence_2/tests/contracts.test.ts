import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorityAllows,
  evidenceDigest,
  validateActionPassport,
  validateAuthorityGrant,
  validateEvidenceRecord,
  validatePromotionDecision,
  type ActionPassport,
  type EvidenceRecord,
  type PromotionDecision,
} from '../src/contracts/canonical.js';
import { generateSigningIdentity, KeyRegistry, signEnvelope } from '../src/contracts/crypto.js';

const now = new Date('2026-07-16T10:00:00.000Z');

function validGrant() {
  return {
    grantId: 'g1', tenantId: 't1', subjectId: 's1', scopes: ['repository.read'],
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), issuer: 'kernel',
  } as const;
}

test('signed grant verifies and tampering fails', () => {
  const identity = generateSigningIdentity('key-1');
  const registry = new KeyRegistry();
  registry.register(identity.keyId, identity.publicKey);
  const signed = signEnvelope(validGrant(), identity);
  assert.equal(registry.verify(signed), true);
  assert.equal(registry.verify({ ...signed, payload: { ...signed.payload, tenantId: 'other' } }), false);
});

test('revoked signing key invalidates envelope', () => {
  const identity = generateSigningIdentity('key-1');
  const registry = new KeyRegistry();
  registry.register(identity.keyId, identity.publicKey);
  const signed = signEnvelope(validGrant(), identity);
  registry.revoke(identity.keyId);
  assert.equal(registry.verify(signed), false);
});

test('key id cannot be silently rebound', () => {
  const first = generateSigningIdentity('same');
  const second = generateSigningIdentity('same');
  const registry = new KeyRegistry();
  registry.register(first.keyId, first.publicKey);
  assert.throws(() => registry.register(second.keyId, second.publicKey), /key_id_conflict/);
});

test('authority validation rejects wildcard, expiry, and duplicate scope', () => {
  assert.throws(() => validateAuthorityGrant({ ...validGrant(), scopes: ['*'] }, now), /wildcard_scope_forbidden/);
  assert.throws(() => validateAuthorityGrant({ ...validGrant(), expiresAt: now.toISOString() }, now), /grant_expired|invalid_expiry/);
  assert.throws(() => validateAuthorityGrant({ ...validGrant(), scopes: ['repository.read', 'repository.read'] }, now), /duplicate_scope/);
});

test('authority is tenant, subject, scope, and workspace bound', () => {
  const grant = { ...validGrant(), workspaceId: 'w1' };
  assert.equal(authorityAllows(grant, { tenantId: 't1', subjectId: 's1', scope: 'repository.read', workspaceId: 'w1' }, now), true);
  assert.equal(authorityAllows(grant, { tenantId: 't2', subjectId: 's1', scope: 'repository.read', workspaceId: 'w1' }, now), false);
  assert.equal(authorityAllows(grant, { tenantId: 't1', subjectId: 'other', scope: 'repository.read', workspaceId: 'w1' }, now), false);
  assert.equal(authorityAllows(grant, { tenantId: 't1', subjectId: 's1', scope: 'repository.write', workspaceId: 'w1' }, now), false);
  assert.equal(authorityAllows(grant, { tenantId: 't1', subjectId: 's1', scope: 'repository.read', workspaceId: 'w2' }, now), false);
});

test('measured evidence requires an instrument', () => {
  const record: EvidenceRecord = {
    recordId: 'e1', tenantId: 't1', kind: 'temperature', subject: 'device', payload: { celsius: 20 },
    evidenceClass: 'MEASURED', method: 'sensor', environment: {}, createdAt: now.toISOString(), limitations: [],
  };
  assert.throws(() => validateEvidenceRecord(record), /measured_evidence_requires_instrument/);
  assert.doesNotThrow(() => validateEvidenceRecord({ ...record, environment: { instrumentId: 'sensor-1' } }));
});

test('simulated evidence cannot authorize a physical claim', () => {
  const record: EvidenceRecord = {
    recordId: 'e1', tenantId: 't1', kind: 'simulation', subject: 'module',
    payload: { physicalClaimAllowed: true }, evidenceClass: 'SIMULATED', method: 'simulator',
    environment: {}, createdAt: now.toISOString(), limitations: [],
  };
  assert.throws(() => validateEvidenceRecord(record), /simulated_evidence_cannot_authorize_physical_claim/);
});

test('evidence rejects non-finite values and digest changes on payload change', () => {
  const record: EvidenceRecord = {
    recordId: 'e1', tenantId: 't1', kind: 'computed', subject: 'module', payload: { score: 1 },
    evidenceClass: 'COMPUTED', method: 'test', environment: {}, createdAt: now.toISOString(), limitations: [],
  };
  assert.throws(() => validateEvidenceRecord({ ...record, payload: { score: Number.NaN } }), /non_finite_value/);
  assert.notEqual(evidenceDigest(record), evidenceDigest({ ...record, payload: { score: 2 } }));
});

test('promotion is shadow-only and forbids self approval', () => {
  const decision: PromotionDecision = {
    candidateId: 'c1', tenantId: 't1', fromState: 'research', toState: 'shadow', builderId: 'builder',
    reviewerIds: ['reviewer'], evidenceRoot: 'root', residualRisk: [], rollbackRef: 'rollback', expectedRevision: 1,
  };
  assert.doesNotThrow(() => validatePromotionDecision(decision));
  assert.throws(() => validatePromotionDecision({ ...decision, reviewerIds: ['builder'] }), /self_approval_forbidden/);
  assert.throws(() => validatePromotionDecision({ ...decision, toState: 'production' }), /production_promotion_forbidden/);
});

test('action passport is shadow-only, time-bound, and review-bound', () => {
  const passport: ActionPassport = {
    passportId: 'p1', tenantId: 't1', subject: 'c1', authorityGrantDigest: 'a', evidenceRoot: 'e',
    promotionState: 'shadow', issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    reviewerIds: ['r1'], limitations: [],
  };
  assert.doesNotThrow(() => validateActionPassport(passport, now));
  assert.throws(() => validateActionPassport({ ...passport, reviewerIds: [] }, now), /passport_reviewer_required/);
  assert.throws(() => validateActionPassport({ ...passport, expiresAt: now.toISOString() }, now), /passport_expired|invalid_expiry/);
});
