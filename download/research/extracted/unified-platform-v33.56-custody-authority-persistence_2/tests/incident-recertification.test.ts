import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentAddressedArtifactStore } from '../src/artifacts/content-addressed-store.js';
import { evidenceDigest, type EvidenceRecord } from '../src/contracts/canonical.js';
import { PersistentCapabilityTrustStore, capabilityRef } from '../src/platform/capability-trust.js';
import { IncidentToRecertificationPipeline, type GovernedIncident, type IncidentCategory } from '../src/platform/incident-recertification.js';

const now = new Date('2026-07-17T12:00:00.000Z');
function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'incident-v21-'));
  const trust = new PersistentCapabilityTrustStore(join(directory, 'trust'));
  const state = trust.register({ tenantId: 'tenant-1', capabilityId: 'change-engine', version: '1.0.0', publisherId: 'publisher-1', originalScopes: ['repository.read', 'repository.write', 'evidence.emit'] }, now);
  const artifacts = new ContentAddressedArtifactStore(join(directory, 'artifacts'));
  return { directory, trust, artifacts, ref: capabilityRef(state.capabilityId, state.version), pipeline: new IncidentToRecertificationPipeline(trust, artifacts) };
}
function incident(category: IncidentCategory, severity: GovernedIncident['severity'] = 'HIGH'): GovernedIncident {
  return {
    incidentId: `incident-${category.toLowerCase()}`, tenantId: 'tenant-1', capabilityRef: 'change-engine@1.0.0', category, severity,
    subject: 'candidate-1', evidenceRefs: ['evidence-incident'], affectedContracts: ['contract.change'], affectedArtifacts: ['artifact.patch'],
    reportedBy: 'operator-1', occurredAt: now.toISOString(), summary: `Observed ${category}`,
  };
}
function recertificationEvidence(tenantId = 'tenant-1') {
  const base: EvidenceRecord[] = [
    record('regression', 'regression-test', tenantId), record('monitor', 'runtime-monitor', tenantId), record('artifact', 'artifact-integrity', tenantId),
  ];
  let previous: string | undefined;
  const records = base.map((item) => {
    const current = previous === undefined ? item : { ...item, previousDigest: previous };
    previous = evidenceDigest(current);
    return current;
  });
  return { records, root: evidenceDigest(records.at(-1)!) };
}
function record(id: string, kind: string, tenantId: string): EvidenceRecord {
  return { recordId: id, tenantId, kind, subject: 'change-engine@1.0.0', payload: { passed: true }, evidenceClass: 'ATTESTED', method: 'v21.recertification', environment: { runtime: 'node' }, createdAt: now.toISOString(), limitations: [] };
}

test('duplicate effect incident compiles failure knowledge, quarantines capability and opens recertification', () => {
  const h = harness();
  const plan = h.pipeline.open(incident('DUPLICATE_SIDE_EFFECT'), now);
  assert.equal(plan.status, 'OPEN');
  assert.equal(plan.trustStateAfterIncident.status, 'QUARANTINED');
  assert.match(plan.regressionTest, /crash after effect/i);
  assert.equal(h.artifacts.verify('tenant-1', plan.incidentArtifact.recordId).ok, true);
  assert.equal(h.artifacts.verify('tenant-1', plan.planArtifact.recordId).ok, true);
  assert.match(plan.digitalThreadRoot, /^[a-f0-9]{64}$/);
});

test('tenant leakage and artifact tampering force revocation even when reported severity is low', () => {
  for (const category of ['TENANT_LEAKAGE', 'ARTIFACT_TAMPERING'] as const) {
    const h = harness();
    const plan = h.pipeline.open(incident(category, 'LOW'), now);
    assert.equal(plan.status, 'NEW_VERSION_REQUIRED');
    assert.equal(plan.trustStateAfterIncident.status, 'REVOKED');
    const evidence = recertificationEvidence();
    assert.throws(() => h.pipeline.recertify({ caseId: plan.caseId, evidenceRecords: evidence.records, evidenceRoot: evidence.root, reviewerIds: ['r1', 'r2'], restoredScopes: ['repository.read'] }), /new_version/);
  }
});

test('passing regression, monitor and artifact evidence restores bounded authority with independent quorum', () => {
  const h = harness();
  const plan = h.pipeline.open(incident('FALSE_COMPLETION_CLAIM'), now);
  const evidence = recertificationEvidence();
  const result = h.pipeline.recertify({ caseId: plan.caseId, evidenceRecords: evidence.records, evidenceRoot: evidence.root, reviewerIds: ['reviewer-1', 'reviewer-2'], restoredScopes: ['repository.read', 'evidence.emit'] }, new Date(now.getTime() + 1));
  assert.equal(result.status, 'RECERTIFIED');
  assert.equal(result.capabilityState.status, 'TRUSTED');
  assert.deepEqual(result.capabilityState.allowedScopes, ['evidence.emit', 'repository.read']);
  assert.match(result.digitalThreadRoot, /^[a-f0-9]{64}$/);
});

test('recertification requires two reviewers and all required evidence kinds', () => {
  const h = harness();
  const plan = h.pipeline.open(incident('TEST_DELETION'), now);
  const evidence = recertificationEvidence();
  assert.throws(() => h.pipeline.recertify({ caseId: plan.caseId, evidenceRecords: evidence.records, evidenceRoot: evidence.root, reviewerIds: ['reviewer-1'], restoredScopes: ['repository.read'] }), /quorum/);
  const incomplete = evidence.records.filter((item) => item.kind !== 'runtime-monitor');
  const repairedChain: EvidenceRecord[] = [];
  let previous: string | undefined;
  for (const item of incomplete) {
    const { previousDigest: _ignored, ...rest } = item;
    const current: EvidenceRecord = previous === undefined ? rest : { ...rest, previousDigest: previous };
    repairedChain.push(current); previous = evidenceDigest(current);
  }
  assert.throws(() => h.pipeline.recertify({ caseId: plan.caseId, evidenceRecords: repairedChain, evidenceRoot: evidenceDigest(repairedChain.at(-1)!), reviewerIds: ['r1', 'r2'], restoredScopes: ['repository.read'] }), /evidence_missing/);
});

test('cross-tenant, failing or wrong-root recertification evidence is rejected', () => {
  const h = harness();
  const plan = h.pipeline.open(incident('INVALID_WEBHOOK'), now);
  const foreign = recertificationEvidence('tenant-2');
  assert.throws(() => h.pipeline.recertify({ caseId: plan.caseId, evidenceRecords: foreign.records, evidenceRoot: foreign.root, reviewerIds: ['r1', 'r2'], restoredScopes: ['repository.read'] }), /cross_tenant/);
  const local = recertificationEvidence();
  assert.throws(() => h.pipeline.recertify({ caseId: plan.caseId, evidenceRecords: local.records, evidenceRoot: '0'.repeat(64), reviewerIds: ['r1', 'r2'], restoredScopes: ['repository.read'] }), /root_mismatch/);
});

test('unknown rollback and key-compromise incidents remain honest about automation limits', () => {
  const rollback = harness().pipeline.open(incident('ROLLBACK_FAILURE'), now);
  assert.equal(rollback.failureKnowledge.automatic, false);
  assert.match(rollback.failureKnowledge.limitations.join(' '), /unknown failures/i);
  const compromised = harness().pipeline.open(incident('KEY_COMPROMISE'), now);
  assert.equal(compromised.status, 'NEW_VERSION_REQUIRED');
});

test('incident scope and evidence are mandatory', () => {
  const h = harness();
  assert.throws(() => h.pipeline.open({ ...incident('DATABASE_RECOVERY_INCIDENT'), evidenceRefs: [] }), /scope_and_evidence/);
  assert.throws(() => h.pipeline.open({ ...incident('DATABASE_RECOVERY_INCIDENT'), affectedArtifacts: [] }), /scope_and_evidence/);
});

test('trust state produced by incident remains persistent after pipeline process ends', () => {
  const h = harness();
  h.pipeline.open(incident('DUPLICATE_SIDE_EFFECT'), now);
  const reopened = new PersistentCapabilityTrustStore(join(h.directory, 'trust'));
  assert.equal(reopened.get('tenant-1', h.ref).status, 'QUARANTINED');
  assert.equal(reopened.verify().ok, true);
});
