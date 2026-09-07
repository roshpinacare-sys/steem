import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStabilityAssurance } from '../src/validation/stability-assurance.js';

const runs = [1, 2, 3].map(() => ({ status: 'passed' as const, tests: 650, passed: 650, failed: 0, timedOut: false }));

test('functional determinism dominates bounded local timing noise', () => {
  const report = evaluateStabilityAssurance({ expectedRuns: 3, expectedTests: 650, coefficientOfVariation: 0.0148, runs });
  assert.equal(report.status, 'PASS'); assert.equal(report.functionalDeterminism, true); assert.equal(report.score, 96.52); assert.equal(report.timingVariationPercent, 1.48);
});

test('failed, timed-out, missing or inventory-drifted runs block', () => {
  assert.equal(evaluateStabilityAssurance({ expectedRuns: 3, expectedTests: 650, coefficientOfVariation: 0.01, runs: runs.slice(0, 2) }).status, 'BLOCK');
  assert.equal(evaluateStabilityAssurance({ expectedRuns: 3, expectedTests: 650, coefficientOfVariation: 0.01, runs: runs.map((row, index) => index === 1 ? { ...row, timedOut: true } : row) }).status, 'BLOCK');
  assert.equal(evaluateStabilityAssurance({ expectedRuns: 3, expectedTests: 650, coefficientOfVariation: 0.01, runs: runs.map((row, index) => index === 1 ? { ...row, tests: 649, passed: 649 } : row) }).status, 'BLOCK');
});

test('material timing variation warns then blocks without fabricating flakes', () => {
  const warning = evaluateStabilityAssurance({ expectedRuns: 3, expectedTests: 650, coefficientOfVariation: 0.04, runs });
  const block = evaluateStabilityAssurance({ expectedRuns: 3, expectedTests: 650, coefficientOfVariation: 0.06, runs });
  assert.equal(warning.status, 'WARN'); assert.equal(warning.functionalDeterminism, true);
  assert.equal(block.status, 'BLOCK'); assert.equal(block.functionalDeterminism, true);
});

test('malformed stability observations fail closed', () => {
  assert.throws(() => evaluateStabilityAssurance({ expectedRuns: 2, expectedTests: 650, coefficientOfVariation: 0.01, runs }), /expectation_invalid/);
  assert.throws(() => evaluateStabilityAssurance({ expectedRuns: 3, expectedTests: 650, coefficientOfVariation: -1, runs }), /variation_invalid/);
});
