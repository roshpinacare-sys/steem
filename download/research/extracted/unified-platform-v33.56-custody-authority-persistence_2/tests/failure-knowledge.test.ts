import assert from 'node:assert/strict';
import test from 'node:test';
import { compileFailureKnowledge, type FailureObservation } from '../src/platform/failure-knowledge.js';

function observation(category: FailureObservation['category']): FailureObservation {
  return {
    failureId: `failure-${category}`, tenantId: 'tenant-1', category, sourceSystem: 'test-source',
    subject: 'subject', evidenceRefs: ['evidence-1'], observedAt: '2026-07-16T12:00:00.000Z', severity: 'HIGH',
  };
}

test('known failures compile into invariant, tests, monitor and recertification', () => {
  for (const category of ['DUPLICATE_EFFECT', 'STALE_WORKER', 'UNVERIFIED_WEBHOOK', 'IMPORT_SIDE_EFFECT', 'FALSE_HEALTH', 'FALSE_CLAIM', 'LEDGER_IMBALANCE', 'SELF_APPROVAL', 'TENANT_LEAK'] as const) {
    const compiled = compileFailureKnowledge(observation(category));
    assert.equal(compiled.automatic, true);
    assert.match(compiled.invariant, /./);
    assert.match(compiled.regressionTest, /./);
    assert.match(compiled.adversarialTest, /./);
    assert.match(compiled.runtimeMonitor, /./);
    assert.match(compiled.recertificationTrigger, /./);
    assert.match(compiled.digest, /^[a-f0-9]{64}$/);
  }
});

test('unknown failure requires human interpretation rather than fake automation', () => {
  const compiled = compileFailureKnowledge(observation('UNKNOWN'));
  assert.equal(compiled.automatic, false);
  assert.match(compiled.limitations[0] ?? '', /expert interpretation/);
});

test('failure knowledge refuses observations without evidence', () => {
  assert.throws(() => compileFailureKnowledge({ ...observation('FALSE_CLAIM'), evidenceRefs: [] }), /failure_evidence_required/);
});
