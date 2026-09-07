import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorityAllows, evidenceDigest, type AuthorityGrant, type EvidenceRecord } from '../src/contracts/canonical.js';
import { sha256 } from '../src/contracts/crypto.js';
import { DigitalThread } from '../src/platform/digital-thread.js';
import { capabilityRef, PersistentCapabilityTrustStore } from '../src/platform/capability-trust.js';
import { createHarness } from './helpers.js';

const now = new Date('2026-07-17T17:00:00.000Z');
function rng(seed = 0x22c0ffee) { let state = seed >>> 0; return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000); }
function token(random: () => number): string { return Math.floor(random() * 1e9).toString(36); }

test('property: authority never crosses tenant, subject, scope or expiry boundaries', () => {
  const random = rng();
  for (let i = 0; i < 500; i += 1) {
    const tenant = `tenant-${token(random)}`; const subject = `subject-${token(random)}`; const scope = `scope.${token(random)}`;
    const grant: AuthorityGrant = { grantId: `g-${i}`, tenantId: tenant, subjectId: subject, scopes: [scope], issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), issuer: 'kernel' };
    assert.equal(authorityAllows(grant, { tenantId: tenant, subjectId: subject, scope }, now), true);
    assert.equal(authorityAllows(grant, { tenantId: `${tenant}-x`, subjectId: subject, scope }, now), false);
    assert.equal(authorityAllows(grant, { tenantId: tenant, subjectId: `${subject}-x`, scope }, now), false);
    assert.equal(authorityAllows(grant, { tenantId: tenant, subjectId: subject, scope: `${scope}.other` }, now), false);
    assert.equal(authorityAllows(grant, { tenantId: tenant, subjectId: subject, scope }, new Date(now.getTime() + 60_001)), false);
  }
});

test('property: cross-tenant Digital Thread edges are always rejected', () => {
  const random = rng(7);
  for (let i = 0; i < 200; i += 1) {
    const thread = new DigitalThread(); const a = `a-${token(random)}`; const b = `b-${token(random)}`;
    thread.addNode({ nodeId: a, tenantId: 'tenant-a', kind: 'MISSION', subject: 's', payloadDigest: sha256(a), createdAt: now.toISOString() });
    thread.addNode({ nodeId: b, tenantId: 'tenant-b', kind: 'EVIDENCE', subject: 's', payloadDigest: sha256(b), createdAt: now.toISOString() });
    assert.throws(() => thread.addEdge({ edgeId: `e-${i}`, tenantId: 'tenant-a', fromNodeId: a, toNodeId: b, relation: 'SUPPORTS', createdAt: now.toISOString() }), /cross_tenant/);
  }
});

test('property: any evidence payload mutation changes the chain root', () => {
  const random = rng(11);
  for (let i = 0; i < 300; i += 1) {
    const first: EvidenceRecord = { recordId: `r-${i}-1`, tenantId: 't', kind: 'k', subject: 's', payload: { value: token(random) }, evidenceClass: 'COMPUTED', method: 'property', environment: {}, createdAt: now.toISOString(), limitations: [] };
    const firstDigest = evidenceDigest(first);
    const second: EvidenceRecord = { ...first, recordId: `r-${i}-2`, payload: { value: token(random) }, previousDigest: firstDigest };
    const root = evidenceDigest(second);
    const mutated = { ...second, payload: { value: `${String(second.payload.value)}-mutated` } };
    assert.notEqual(evidenceDigest(mutated), root);
  }
});

test('property: duplicate effect keys never create a second external effect after crash recovery', async () => {
  for (let i = 0; i < 40; i += 1) {
    const h = createHarness();
    try {
      const missionId = `property-idem-${i}`;
      h.engine.createAuthorizedMission(h.signedGrant, { missionId, tenantId: 'tenant-1', subjectId: 'subject-1', builderId: 'builder-1', scope: 'repository.read', effectKey: `effect:${missionId}`, approvalRequired: false }, h.now);
      const lease = h.engine.acquire(missionId, 'worker-1', 30_000, h.now.getTime()); const outbox = h.engine.prepare(lease, { i }, h.now.getTime()); if (!outbox) throw new Error('outbox_expected');
      await assert.rejects(h.engine.execute(outbox, lease, () => ({ applied: i }), { crashAfterEffect: true, now: h.now }), /injected_crash/);
      await h.engine.execute(outbox, lease, () => { throw new Error('duplicate'); }, { now: h.now });
      assert.equal(h.store.countEffects(`effect:${missionId}`), 1);
    } finally { h.store.close(); }
  }
});

test('property: restricted, quarantined or revoked capabilities never retain write scopes', () => {
  const severities = ['MEDIUM', 'HIGH', 'CRITICAL'] as const;
  for (let i = 0; i < 90; i += 1) {
    const store = new PersistentCapabilityTrustStore(mkdtempSync(join(tmpdir(), 'property-trust-v22-')));
    const registered = store.register({ tenantId: 'tenant-1', capabilityId: `cap-${i}`, version: '1.0.0', publisherId: 'publisher', originalScopes: ['repository.read', 'repository.inspect', 'repository.write', 'network.write', 'evidence.emit'] }, now);
    const severity = severities[i % severities.length]!;
    const state = store.recordViolation('tenant-1', capabilityRef(registered.capabilityId, registered.version), { violationId: `v-${i}`, kind: severity === 'CRITICAL' ? 'EVIDENCE_TAMPERING' : 'POLICY', severity, evidenceRef: `e-${i}`, observedAt: now.toISOString(), message: 'property violation' }, now);
    assert.equal(state.allowedScopes.some((scope) => scope.endsWith('.write')), false);
  }
});
