import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregatePilot, createHumanPilotProtocol, pseudonymizeObservation, validateObservation, type PilotObservation } from '../src/product/human-pilot.js';
import { evaluateSlo, nearestRank } from '../src/operations/slo-qualification.js';

function observation(participantId: string, taskId: PilotObservation['taskId'] = 'permission-review', overrides: Partial<PilotObservation> = {}): PilotObservation {
  return { participantId, consented: true, role: 'reviewer', taskId, completed: true, elapsedMs: 60_000, criticalErrors: 0, assistRequests: 0, comprehensionCorrect: 4, comprehensionTotal: 4, stoppedForSafety: false, ...overrides };
}

test('human pilot protocol defines concrete safety stop conditions for every task', () => {
  const protocol = createHumanPilotProtocol();
  assert.equal(protocol.tasks.length, 5);
  assert.equal(protocol.tasks.every((task) => task.stopCondition.trim() !== '' && task.successCriterion.trim() !== ''), true);
  assert.equal(protocol.forbiddenClaims.includes('human value improvement'), true);
});

test('pilot observations require consent and bounded, internally consistent measurements', () => {
  assert.throws(() => validateObservation(observation('p1', 'permission-review', { consented: false })), /pilot_consent_required/);
  assert.throws(() => validateObservation(observation('p1', 'permission-review', { comprehensionCorrect: 5, comprehensionTotal: 4 })), /pilot_comprehension_invalid/);
  assert.throws(() => validateObservation(observation('p1', 'permission-review', { elapsedMs: 999_999 })), /pilot_elapsed_invalid/);
});

test('pilot aggregation refuses human-value conclusions below the predefined sample size', () => {
  const result = aggregatePilot([observation('p1'), observation('p2'), observation('p3')]);
  assert.equal(result.status, 'insufficient-sample');
  assert.equal('completionRate' in result, false);
});

test('pilot aggregation exposes critical errors and comprehension failures instead of averaging them away', () => {
  const rows: PilotObservation[] = [];
  for (let index = 0; index < 5; index += 1) {
    rows.push(observation(`p${index}`, 'permission-review', index === 4 ? { criticalErrors: 1, stoppedForSafety: true, comprehensionCorrect: 1 } : {}));
  }
  const result = aggregatePilot(rows);
  assert.equal(result.status, 'measured');
  assert.equal(result.taskResults?.[0]?.pass, false);
  assert.equal(result.taskResults?.[0]?.reasons.includes('critical_error_or_safety_stop'), true);
});

test('participant identifiers are pseudonymized deterministically without being retained', () => {
  const first = pseudonymizeObservation(observation('person@example.com'));
  const second = pseudonymizeObservation(observation('person@example.com'));
  assert.equal(first.participantRef, second.participantRef);
  assert.equal('participantId' in first, false);
  assert.notEqual(first.participantRef, 'person@example.com');
});

test('nearest-rank percentile is deterministic and validates samples', () => {
  assert.equal(nearestRank([4, 1, 3, 2, 5], 95), 5);
  assert.throws(() => nearestRank([], 95), /samples_required/);
  assert.throws(() => nearestRank([1, -1], 95), /sample_invalid/);
});

test('SLO evaluation distinguishes local evidence, qualified evidence and threshold failure', () => {
  const threshold = { metric: 'passport-verify', percentile: 95 as const, maximumMs: 10, minimumSamples: 100 };
  const insufficient = evaluateSlo({ metric: 'passport-verify', samplesMs: [1,2], environment: 'local-single-host' }, threshold);
  assert.equal(insufficient.status, 'insufficient-evidence');
  const local = evaluateSlo({ metric: 'passport-verify', samplesMs: Array(100).fill(3), environment: 'local-single-host' }, threshold);
  assert.equal(local.status, 'local-evidence-only');
  const qualified = evaluateSlo({ metric: 'passport-verify', samplesMs: Array(100).fill(3), environment: 'qualified-multi-host' }, threshold);
  assert.equal(qualified.status, 'qualified');
  const failed = evaluateSlo({ metric: 'passport-verify', samplesMs: [...Array(94).fill(3), ...Array(6).fill(20)], environment: 'qualified-multi-host' }, threshold);
  assert.equal(failed.status, 'failed');
});
