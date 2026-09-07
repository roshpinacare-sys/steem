import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExcellenceScorecard, FOURTEEN_AXIS_DEFINITIONS } from '../src/validation/excellence-scorecard.js';
import { evaluateEvidenceFreshness } from '../src/platform/evidence-freshness.js';
import { evaluateComplexityBudget } from '../src/validation/complexity-budget.js';
import { evaluateResilienceCoverage } from '../src/operations/resilience-coverage.js';
import { evaluateValueHypotheses } from '../src/product/value-hypothesis.js';
import { evaluatePerformanceBudgets } from '../src/operations/performance-budget.js';
const digest = 'a'.repeat(64);

test('scorecard watch and production-eligible branches are exercised', () => {
  const watch = FOURTEEN_AXIS_DEFINITIONS.map((item) => ({ axisId: item.axisId, projectScore: 100, cycleScore: 100, confidence: item.axisId === 'performance-resource-efficiency' ? 0.7 : 1, evidenceRefs: ['e'], limitations: item.axisId === 'performance-resource-efficiency' ? ['local_only'] : [], blockers: [] }));
  assert.equal(evaluateExcellenceScorecard({ version: 'x', observations: watch }).status, 'PASS_WITH_LIMITATIONS');
  const perfect = watch.map((item) => ({ ...item, confidence: 1, limitations: [] }));
  const report = evaluateExcellenceScorecard({ version: 'x', observations: perfect }); assert.equal(report.productionPromotion, 'ELIGIBLE_FOR_EXTERNAL_REVIEW'); assert.equal(report.readiness, 'PRODUCTION_CANDIDATE');
});

test('evidence future time and malformed artifact digests fail closed', () => {
  const report = evaluateEvidenceFreshness({ currentSourceDigest: digest, evaluatedAt: '2026-01-01T00:00:00Z', artifacts: [{ evidenceId: 'x', path: 'x', producedAt: '2027-01-01T00:00:00Z', sourceDigest: digest, recordedArtifactDigest: 'bad', actualArtifactDigest: 'bad', maxAgeMs: 1, requiredForPromotion: true }] });
  assert.equal(report.status, 'BLOCK'); assert.ok(report.findings.some((item) => item.code === 'EVIDENCE_TIME_INVALID'));
});

test('complexity warning-rate block works without severe single finding', () => {
  const report = evaluateComplexityBudget([{ path: 'a', sourceLines: 101, importCount: 1, exportedSymbolCount: 1, decisionPointCount: 1, maximumFunctionLines: 1 }, { path: 'b', sourceLines: 101, importCount: 1, exportedSymbolCount: 1, decisionPointCount: 1, maximumFunctionLines: 1 }], { maximumSourceLines: 100, maximumImports: 10, maximumExportedSymbols: 10, maximumDecisionPoints: 10, maximumFunctionLines: 10, maximumWarningRatePercent: 50 });
  assert.equal(report.status, 'BLOCK'); assert.equal(report.totals.blocks, 0);
});

test('non-critical open resilience capability does not block overall report', () => { const report = evaluateResilienceCoverage([{ capabilityId: 'optional', critical: false, requiredFailureModes: ['dependency-unavailable'] }], []); assert.equal(report.status, 'PASS'); assert.equal(report.capabilityResults[0]!.status, 'OPEN'); });
test('increase-direction value target and missing observation branches are exercised', () => { const base = { hypothesisId: 'x', capabilityId: 'x', operatorProblem: 'x', baselineMetric: 'x', targetDirection: 'increase' as const, targetValue: 5, measurementProtocolRef: 'p', minimumHumanParticipants: 1, minimumRuns: 1, evidenceState: 'MEASURED_HUMAN' as const, participants: 1, runs: 1, observedValue: 6, provenanceRefs: ['e'] }; assert.equal(evaluateValueHypotheses([base]).status, 'VALUE_DEMONSTRATED'); assert.equal(evaluateValueHypotheses([{ ...base, observedValue: undefined }]).results[0]!.claimAllowed, false); });
test('performance budget validates duplicate and negative definitions', () => { assert.throws(() => evaluatePerformanceBudgets([{ metric: 'x', direction: 'lower-is-better', maximumRegressionPercent: 1, minimumSamples: 1, percentile: 50 }, { metric: 'x', direction: 'lower-is-better', maximumRegressionPercent: 1, minimumSamples: 1, percentile: 50 }], []), /budget_invalid/); assert.throws(() => evaluatePerformanceBudgets([{ metric: 'x', direction: 'lower-is-better', maximumRegressionPercent: -1, minimumSamples: 1, percentile: 50 }], []), /budget_invalid/); });
