import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExcellenceScorecard, FOURTEEN_AXIS_DEFINITIONS, type ExcellenceAxisObservation } from '../src/validation/excellence-scorecard.js';

function observations(project = 92, cycle = 93): ExcellenceAxisObservation[] {
  return FOURTEEN_AXIS_DEFINITIONS.map((item) => ({ axisId: item.axisId, projectScore: project, cycleScore: cycle, confidence: 0.95, evidenceRefs: [`evidence:${item.axisId}`], limitations: [], blockers: [] }));
}

test('14-axis scorecard produces weighted tracked results and digest', () => {
  const baseline = observations(80, 80); const current = observations(92, 94);
  const report = evaluateExcellenceScorecard({ version: '32.2', observations: current, baseline });
  assert.equal(report.metrics.axisCount, 14); assert.equal(report.metrics.totalWeight, 100);
  assert.equal(report.metrics.improvementCount, 14); assert.equal(report.metrics.regressionCount, 0);
  assert.match(report.reportDigest, /^[0-9a-f]{64}$/); assert.equal(report.axes.length, 14);
});


test('sub-point score noise is tracked as delta but not a material regression', () => {
  const baseline = observations(90, 90);
  const current = baseline.map((item, index) => index === 0 ? { ...item, projectScore: 89.25, cycleScore: 89.5 } : item);
  const report = evaluateExcellenceScorecard({ version: '32.2', observations: current, baseline });
  assert.equal(report.axes[0]!.deltaProjectScore, -0.75);
  assert.equal(report.axes[0]!.deltaCycleScore, -0.5);
  assert.equal(report.metrics.materialityThresholdPoints, 1);
  assert.equal(report.metrics.regressionCount, 0);
});

test('external blockers keep production promotion blocked even with high scores', () => {
  const current = observations(99, 99); const external = current.find((item) => item.axisId === 'external-readiness-scalability')!;
  const modified = current.map((item) => item === external ? { ...item, blockers: ['postgres_not_qualified'] } : item);
  const report = evaluateExcellenceScorecard({ version: '32.2', observations: modified });
  assert.equal(report.productionPromotion, 'BLOCKED'); assert.equal(report.status, 'BLOCK'); assert.ok(report.nextPriorities[0]!.reasons.some((item) => item.includes('postgres_not_qualified')));
});

test('regressions and weakest axes are explicit', () => {
  const baseline = observations(90, 90); const current = observations(90, 90).map((item) => item.axisId === 'product-value-operator-ux' ? { ...item, projectScore: 40, cycleScore: 75, confidence: 0.5, limitations: ['human_pilot_absent'] } : item);
  const report = evaluateExcellenceScorecard({ version: '32.2', observations: current, baseline });
  assert.equal(report.metrics.regressionCount, 1); assert.equal(report.weakestAxes[0], 'product-value-operator-ux'); assert.equal(report.readiness, 'INTEGRATED_PILOT');
});

test('scorecard rejects missing, duplicate and malformed axes', () => {
  const current = observations();
  assert.throws(() => evaluateExcellenceScorecard({ version: '', observations: current }), /version_required/);
  assert.throws(() => evaluateExcellenceScorecard({ version: 'x', observations: current.slice(1) }), /axis_count/);
  assert.throws(() => evaluateExcellenceScorecard({ version: 'x', observations: [...current.slice(0, 13), current[0]!] }), /axis_duplicate/);
  assert.throws(() => evaluateExcellenceScorecard({ version: 'x', observations: current.map((item, index) => index === 0 ? { ...item, confidence: 2 } : item) }), /confidence_invalid/);
});
