import assert from 'node:assert/strict';
import test from 'node:test';
import {
  tfaCapabilityToGrant,
  tfaPassportVerificationToEvidence,
  titaiPrincipalToGrant,
  titaiRunSummaryToEvidence,
} from '../src/contracts/adapters.js';
import { validateAuthorityGrant, validateEvidenceRecord } from '../src/contracts/canonical.js';

const now = new Date('2026-07-16T10:00:00.000Z');

test('TITAI principal maps to canonical grant', () => {
  const grant = titaiPrincipalToGrant({ id: 'agent', tenantId: 'tenant', workspaceId: 'workspace' }, {
    scopes: ['repository.read'], now,
  });
  assert.equal(grant.tenantId, 'tenant');
  assert.equal(grant.workspaceId, 'workspace');
  assert.doesNotThrow(() => validateAuthorityGrant(grant, now));
});

test('disabled TITAI principal maps to revoked grant', () => {
  const grant = titaiPrincipalToGrant({ id: 'agent', tenantId: 'tenant', disabled: true }, {
    scopes: ['repository.read'], now,
  });
  assert.throws(() => validateAuthorityGrant(grant, now), /grant_revoked/);
});

test('TFA capability maps to tenant and subject bound grant', () => {
  const grant = tfaCapabilityToGrant({
    capabilityId: 'cap-1', tenantId: 'tenant', subjectId: 'subject', actions: ['repository.read'],
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), passportId: 'p1',
  });
  assert.equal(grant.evidenceRef, 'p1');
  assert.doesNotThrow(() => validateAuthorityGrant(grant, now));
});

test('TITAI run summary remains computed evidence', () => {
  const evidence = titaiRunSummaryToEvidence({ state: 'complete', coverage: 0.9, reconstructable: true }, 'run-1', 'tenant', now);
  assert.equal(evidence.evidenceClass, 'COMPUTED');
  assert.doesNotThrow(() => validateEvidenceRecord(evidence));
});

test('TFA passport verification remains attested evidence with limitation', () => {
  const evidence = tfaPassportVerificationToEvidence(
    { passportId: 'p1', hash: 'hash', algorithm: 'Ed25519' },
    { ok: true, checks: ['signature'] },
    'tenant', now,
  );
  assert.equal(evidence.evidenceClass, 'ATTESTED');
  assert.ok(evidence.limitations.includes('attestation-does-not-prove-underlying-claim-truth'));
});
