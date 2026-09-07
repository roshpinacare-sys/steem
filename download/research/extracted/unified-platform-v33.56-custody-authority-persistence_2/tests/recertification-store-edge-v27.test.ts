import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sha256 } from '../src/contracts/crypto.js';
import { DigitalThread } from '../src/platform/digital-thread.js';
import { PersistentRecertificationCaseStore, type StoredRecertificationCase } from '../src/platform/recertification-case-store.js';
import type { RecertificationPlan, RecertificationResult } from '../src/platform/incident-recertification.js';

const now = new Date('2026-07-17T12:00:00.000Z');
function fixture() {
  const thread = new DigitalThread();
  thread.addNode({ nodeId: 'incident-1', tenantId: 'tenant-1', kind: 'INCIDENT', subject: 'subject', payloadDigest: sha256('incident'), createdAt: now.toISOString() });
  thread.addNode({ nodeId: 'case-1', tenantId: 'tenant-1', kind: 'RECERTIFICATION', subject: 'cap@1', payloadDigest: sha256('case'), createdAt: now.toISOString() });
  thread.addEdge({ edgeId: 'edge-1', tenantId: 'tenant-1', fromNodeId: 'incident-1', toNodeId: 'case-1', relation: 'TRIGGERS', createdAt: now.toISOString() });
  const plan = {
    caseId: 'case-1', tenantId: 'tenant-1', capabilityRef: 'cap@1', incidentId: 'incident-1', status: 'OPEN',
    regressionTest: 'regression', adversarialTest: 'adversarial', runtimeMonitor: 'monitor', recertificationTrigger: 'trigger',
    requiredEvidenceKinds: ['regression-test','runtime-monitor','artifact-integrity'],
    trustStateAfterIncident: { tenantId: 'tenant-1', capabilityId: 'cap', version: '1', publisherId: 'publisher', originalScopes: ['repository.read'], status: 'QUARANTINED', allowedScopes: [], violationCount: 1, lowSeverityStreak: 0, revision: 2, lastEventDigest: sha256('event') },
    failureKnowledge: { failureId: 'incident-1', tenantId: 'tenant-1', category: 'FALSE_CLAIM', subject: 'subject', invariant: 'no false claim', regressionTest: 'regression', adversarialTest: 'adversarial', runtimeMonitor: 'monitor', recertificationTrigger: 'trigger', evidenceRefs: ['e1'], compiledAt: now.toISOString(), packageDigest: sha256('failure') },
    incidentArtifact: { recordId: 'a1', tenantId: 'tenant-1', kind: 'incident-record', mediaType: 'application/json', blobDigest: sha256('a1'), metadataDigest: sha256('m1'), createdAt: now.toISOString() },
    planArtifact: { recordId: 'a2', tenantId: 'tenant-1', kind: 'recertification-plan', mediaType: 'application/json', blobDigest: sha256('a2'), metadataDigest: sha256('m2'), createdAt: now.toISOString() },
    digitalThreadRoot: thread.verify('tenant-1').root, createdAt: now.toISOString(),
  } as unknown as RecertificationPlan;
  const result: RecertificationResult = {
    caseId: 'case-1', status: 'RECERTIFIED', capabilityState: { ...plan.trustStateAfterIncident, status: 'TRUSTED', allowedScopes: ['repository.read'], revision: 3, lastEvidenceRoot: sha256('root') },
    evidenceRoot: sha256('root'), reviewerIds: ['r1','r2'], digitalThreadRoot: thread.verify('tenant-1').root, certificationDigest: sha256('cert'),
  };
  return { thread, plan, result };
}

test('recertification store rejects invalid identifiers, digests and missing cases', () => {
  assert.throws(() => new PersistentRecertificationCaseStore(' '), /root_required/);
  const root = mkdtempSync(join(tmpdir(), 'recert-store-v27-'));
  const store = new PersistentRecertificationCaseStore(root);
  const { thread, plan, result } = fixture();
  assert.throws(() => store.findByIncident(' '), /incident_id_required/);
  assert.throws(() => store.get(' '), /case_id_required/);
  assert.throws(() => store.get('missing'), /case_not_found/);
  assert.throws(() => store.create('bad', plan, thread.snapshot('tenant-1')), /incident_digest_invalid/);
  assert.throws(() => store.complete(plan.caseId, 'bad', result, thread.snapshot('tenant-1')), /completion_digest_invalid/);
});

test('recertification store recovers stale lock and preserves idempotent create/complete', () => {
  const root = mkdtempSync(join(tmpdir(), 'recert-lock-v27-'));
  writeFileSync(join(root, '.write.lock'), JSON.stringify({ pid: 99999999, at: 'bad' }));
  const store = new PersistentRecertificationCaseStore(root);
  const { thread, plan, result } = fixture();
  const incidentDigest = sha256('incident');
  const created = store.create(incidentDigest, plan, thread.snapshot('tenant-1'));
  assert.equal(created.plan.caseId, plan.caseId);
  assert.equal(store.create(incidentDigest, plan, thread.snapshot('tenant-1')).digest, created.digest);
  assert.throws(() => store.create(sha256('other'), plan, thread.snapshot('tenant-1')), /incident_id_conflict/);
  assert.equal(readdirSync(root).some((name) => name.includes('.write.lock.stale-')), true);
  const completed = store.complete(plan.caseId, sha256('completion'), result, thread.snapshot('tenant-1'));
  assert.equal(completed.result?.status, 'RECERTIFIED');
  assert.equal(store.complete(plan.caseId, sha256('completion'), result, thread.snapshot('tenant-1')).digest, completed.digest);
  assert.throws(() => store.complete(plan.caseId, sha256('other-completion'), result, thread.snapshot('tenant-1')), /completion_conflict/);
  assert.throws(() => store.complete(plan.caseId, sha256('completion'), { ...result, evidenceRoot: sha256('different') }, thread.snapshot('tenant-1')), /completion_conflict/);
});

test('recertification store rejects validly-digested but structurally invalid records and tampering', () => {
  const root = mkdtempSync(join(tmpdir(), 'recert-invalid-v27-'));
  const store = new PersistentRecertificationCaseStore(root);
  const { thread, plan } = fixture();
  const created = store.create(sha256('incident'), plan, thread.snapshot('tenant-1'));
  const path = join(root, readdirSync(root).find((name) => name.endsWith('.json'))!);
  const row = JSON.parse(readFileSync(path, 'utf8')) as StoredRecertificationCase;
  writeFileSync(path, JSON.stringify({ ...row, plan: { ...row.plan, incidentId: '' } }));
  assert.throws(() => store.get(plan.caseId), /tampered/);

  const material = { version: 1 as const, incidentDigest: sha256('incident'), plan: { ...plan, incidentId: '' }, thread: thread.snapshot('tenant-1') };
  writeFileSync(path, JSON.stringify({ ...material, digest: sha256(material) }));
  assert.throws(() => store.get(plan.caseId), /case_invalid/);

  const parsed = JSON.parse(JSON.stringify(created)) as StoredRecertificationCase;
  writeFileSync(path, JSON.stringify(parsed));
  assert.equal(store.findByIncident('incident-1')?.digest, created.digest);
});
