import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvidenceRecord } from '../src/contracts/canonical.js';
import type { EngineeringCommitment } from '../src/contracts/system.js';
import { toOpenLineageCompleteEvent, toSlsaLikeProvenance } from '../src/platform/standards-adapters.js';

const commitment: EngineeringCommitment = {
  commitmentId: 'c1', tenantId: 'tenant-1', subjectId: 'subject-1', builderId: 'builder-1', domainPackId: 'software-delivery',
  goal: 'Inventory repository', authorityGrantDigest: 'a'.repeat(64), requirementIds: ['r2', 'r1'], promotionCeiling: 'shadow',
  createdAt: '2026-07-16T12:00:00.000Z', expiresAt: '2026-07-16T13:00:00.000Z',
};
const evidence: EvidenceRecord = {
  recordId: 'e1', tenantId: 'tenant-1', kind: 'inventory', subject: 'c1', payload: { fileCount: 2 },
  evidenceClass: 'COMPUTED', method: 'test', environment: {}, createdAt: '2026-07-16T12:01:00.000Z', limitations: [],
};

test('OpenLineage adapter preserves run, job, input and output lineage', () => {
  const event = toOpenLineageCompleteEvent({ commitment, evidence, artifactNames: ['artifact:a'] });
  assert.equal(event.eventType, 'COMPLETE');
  assert.equal(event.run.runId, 'c1');
  assert.equal(event.job.namespace, 'tenant-1');
  assert.deepEqual(event.inputs.map((input) => input.name), ['requirement:r2', 'requirement:r1']);
  assert.equal(event.outputs[0]?.name, 'artifact:a');
});

test('SLSA-like adapter emits deterministic sorted dependencies and in-toto statement shape', () => {
  const provenance = toSlsaLikeProvenance({
    commitment, artifactName: 'artifact', artifactDigest: 'b'.repeat(64), builderId: 'builder-1',
    startedOn: commitment.createdAt, finishedOn: evidence.createdAt,
    dependencyDigests: { 'z:dependency': 'c'.repeat(64), 'a:dependency': 'd'.repeat(64) },
  });
  assert.equal(provenance._type, 'https://in-toto.io/Statement/v1');
  assert.equal(provenance.predicateType, 'https://slsa.dev/provenance/v1');
  assert.deepEqual(provenance.predicate.buildDefinition.resolvedDependencies.map((dependency) => dependency.uri), ['a:dependency', 'z:dependency']);
});
