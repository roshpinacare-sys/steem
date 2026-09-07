import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateUncertainty } from '../src/platform/uncertainty-assurance.js';

const requirement = { requirementId: 'req-1', criticality: 'HIGH' as const, toleranceMin: 9, toleranceMax: 11, minimumSamples: 10, allowedEvidenceClasses: ['OBSERVED', 'SIMULATED'] as const };
const evidence = { measurementId: 'm-1', requirementId: 'req-1', evidenceClass: 'OBSERVED' as const, estimate: 10, lowerBound: 9.5, upperBound: 10.5, unit: 'ms', sampleCount: 20, method: 'benchmark', evidenceRef: 'evidence:1' };

test('observed interval inside tolerance passes', () => {
  const result = evaluateUncertainty(requirement, evidence);
  assert.equal(result.decision, 'PASS');
  assert.equal(result.marginToLower, 0.5);
});

test('simulation is explicitly labeled and safety-critical simulation is inconclusive', () => {
  assert.equal(evaluateUncertainty(requirement, { ...evidence, evidenceClass: 'SIMULATED' }).decision, 'SIMULATION_PASS');
  const critical = evaluateUncertainty({ ...requirement, criticality: 'SAFETY_CRITICAL' }, { ...evidence, evidenceClass: 'SIMULATED' });
  assert.equal(critical.decision, 'INCONCLUSIVE');
  assert.ok(critical.reasons.includes('SAFETY_CRITICAL_SIMULATION_ONLY'));
});

test('interval outside tolerance fails and insufficient samples are inconclusive', () => {
  assert.equal(evaluateUncertainty(requirement, { ...evidence, upperBound: 12 }).decision, 'FAIL');
  assert.equal(evaluateUncertainty(requirement, { ...evidence, sampleCount: 2 }).decision, 'INCONCLUSIVE');
});

test('invalid and mismatched records fail closed', () => {
  assert.throws(() => evaluateUncertainty({ ...requirement, toleranceMax: 8 }, evidence), /tolerance_invalid/);
  assert.throws(() => evaluateUncertainty(requirement, { ...evidence, requirementId: 'other' }), /requirement_mismatch/);
});
