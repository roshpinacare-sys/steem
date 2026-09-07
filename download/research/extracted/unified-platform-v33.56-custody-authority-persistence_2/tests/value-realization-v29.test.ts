import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkflowValueReport } from '../src/operations/value-realization.js';
const baseline = { manualSteps: 12, manualDecisionPoints: 8, medianMinutes: 30, errorOpportunities: 6 };

test('measured local workflow demonstrates value with transparent metrics', () => {
  const report = buildWorkflowValueReport(baseline, { sampleSize: 10, operatorSteps: 5, operatorDecisionPoints: 3, medianMinutes: 12, invalidActionsBlocked: 4, evidenceGapsDetected: 3, operatorOverrides: 1, completedRuns: 9, provenanceRefs: ['evidence:pilot-1'], measurementKind: 'MEASURED_LOCAL' });
  assert.equal(report.status, 'VALUE_DEMONSTRATED'); assert.equal(report.metrics.stepReductionPercent, 58.33); assert.equal(report.metrics.timeReductionPercent, 60);
  assert.equal(report.metrics.completionRatePercent, 90); assert.ok(report.benefits.includes('invalid_actions_prevented')); assert.match(report.reportDigest, /^[a-f0-9]{64}$/);
});

test('modeled benefit remains promising and never masquerades as human measurement', () => {
  const report = buildWorkflowValueReport(baseline, { sampleSize: 5, operatorSteps: 4, operatorDecisionPoints: 2, medianMinutes: 10, invalidActionsBlocked: 2, evidenceGapsDetected: 2, operatorOverrides: 0, completedRuns: 5, provenanceRefs: ['simulation:v29'], measurementKind: 'MODELED' });
  assert.equal(report.status, 'PROMISING'); assert.ok(report.cautions.includes('modeled_results_are_not_human_pilot_measurements'));
});

test('small or ungrounded samples are classified as insufficient evidence', () => {
  const report = buildWorkflowValueReport(baseline, { sampleSize: 2, operatorSteps: 4, operatorDecisionPoints: 2, medianMinutes: 10, invalidActionsBlocked: 1, evidenceGapsDetected: 1, operatorOverrides: 0, completedRuns: 2, provenanceRefs: [], measurementKind: 'MEASURED_LOCAL' });
  assert.equal(report.status, 'INSUFFICIENT_EVIDENCE'); assert.ok(report.cautions.includes('sample_size_below_five'));
});

test('workflow regressions are reported instead of hidden by prevented actions', () => {
  const report = buildWorkflowValueReport(baseline, { sampleSize: 8, operatorSteps: 14, operatorDecisionPoints: 9, medianMinutes: 40, invalidActionsBlocked: 8, evidenceGapsDetected: 5, operatorOverrides: 3, completedRuns: 7, provenanceRefs: ['evidence:regression'], measurementKind: 'MEASURED_LOCAL' });
  assert.equal(report.status, 'REGRESSED'); assert.ok(report.cautions.includes('workflow_time_regressed'));
});

test('invalid baselines, counts and provenance fail closed', () => {
  assert.throws(() => buildWorkflowValueReport({ ...baseline, manualSteps: 0 }, { sampleSize: 3, operatorSteps: 1, operatorDecisionPoints: 1, medianMinutes: 1, invalidActionsBlocked: 0, evidenceGapsDetected: 0, operatorOverrides: 0, completedRuns: 3, provenanceRefs: ['x'], measurementKind: 'MEASURED_LOCAL' }), /baseline_invalid/);
  assert.throws(() => buildWorkflowValueReport(baseline, { sampleSize: 3, operatorSteps: 1, operatorDecisionPoints: 1, medianMinutes: 1, invalidActionsBlocked: 0, evidenceGapsDetected: 0, operatorOverrides: 4, completedRuns: 3, provenanceRefs: ['x'], measurementKind: 'MEASURED_LOCAL' }), /counts_invalid/);
  assert.throws(() => buildWorkflowValueReport(baseline, { sampleSize: 3, operatorSteps: 1, operatorDecisionPoints: 1, medianMinutes: 1, invalidActionsBlocked: 0, evidenceGapsDetected: 0, operatorOverrides: 0, completedRuns: 3, provenanceRefs: [''], measurementKind: 'MEASURED_LOCAL' }), /provenance_invalid/);
});

test('measured workflow with neutral improvement remains promising and reports override caution', () => {
  const report = buildWorkflowValueReport(baseline, { sampleSize: 8, operatorSteps: 12, operatorDecisionPoints: 8, medianMinutes: 30, invalidActionsBlocked: 0, evidenceGapsDetected: 0, operatorOverrides: 3, completedRuns: 6, provenanceRefs: ['evidence:neutral'], measurementKind: 'MEASURED_LOCAL' });
  assert.equal(report.status, 'PROMISING'); assert.equal(report.metrics.stepReductionPercent, 0); assert.ok(report.cautions.includes('operator_override_rate_above_25_percent'));
});

test('zero operator work produces finite ratios without divide-by-zero artifacts', () => {
  const report = buildWorkflowValueReport(baseline, { sampleSize: 1, operatorSteps: 0, operatorDecisionPoints: 0, medianMinutes: 0, invalidActionsBlocked: 0, evidenceGapsDetected: 0, operatorOverrides: 0, completedRuns: 0, provenanceRefs: ['model:zero'], measurementKind: 'MODELED' });
  assert.equal(report.metrics.stepReductionPercent, 100); assert.equal(report.metrics.completionRatePercent, 0); assert.equal(report.status, 'INSUFFICIENT_EVIDENCE');
});
