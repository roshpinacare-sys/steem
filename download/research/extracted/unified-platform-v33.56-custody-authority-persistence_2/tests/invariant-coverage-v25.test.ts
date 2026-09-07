import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateInvariantCoverage, type InvariantAssetInventory, type InvariantDefinition } from '../src/validation/invariant-coverage.js';
const inventory: InvariantAssetInventory = { testFiles: ['tests/core.test.ts', 'tests/adversarial.test.ts', 'tests/orphan.test.ts'], mutantIds: ['MUT-1'], monitorIds: ['monitor-1'], incidentClasses: ['INCIDENT-1'], evidenceRefs: ['evidence/core.json', 'evidence/orphan.json'] };
const critical: InvariantDefinition = { id: 'tenant-boundary', statement: 'Cross-tenant access is always rejected.', criticality: 'critical', owner: 'Security Lead', testFiles: ['tests/core.test.ts'], adversarialTests: ['tests/adversarial.test.ts'], mutantIds: ['MUT-1'], monitorIds: ['monitor-1'], incidentClasses: ['INCIDENT-1'], evidenceRefs: ['evidence/core.json'] };

test('critical invariant passes only with test, adversarial control, monitor and evidence', () => {
  const report = evaluateInvariantCoverage([critical], inventory);
  assert.equal(report.status, 'passed');
  assert.equal(report.coveragePercent, 100);
  assert.equal(report.rows[0]?.status, 'covered');
});

test('critical invariant fails when a required control class is missing', () => {
  const report = evaluateInvariantCoverage([{ ...critical, adversarialTests: [], mutantIds: [], monitorIds: [], evidenceRefs: [] }], inventory);
  assert.equal(report.status, 'failed');
  assert.ok(report.findings.some((finding) => finding.code === 'CRITICAL_ADVERSARIAL_MISSING'));
  assert.ok(report.findings.some((finding) => finding.code === 'CRITICAL_MONITOR_MISSING'));
  assert.ok(report.findings.some((finding) => finding.code === 'CRITICAL_EVIDENCE_MISSING'));
});

test('missing referenced assets fail closed instead of counting declared links', () => {
  const report = evaluateInvariantCoverage([{ ...critical, testFiles: ['tests/missing.test.ts'] }], inventory);
  assert.equal(report.status, 'failed');
  assert.ok(report.findings.some((finding) => finding.code === 'INVARIANT_REFERENCE_MISSING'));
});

test('duplicate invariant identifiers and duplicate references are rejected', () => {
  const duplicateRef = { ...critical, testFiles: ['tests/core.test.ts', 'tests/core.test.ts'] };
  const report = evaluateInvariantCoverage([duplicateRef, critical], inventory);
  assert.equal(report.status, 'failed');
  assert.ok(report.findings.some((finding) => finding.code === 'INVARIANT_ID_INVALID'));
  assert.ok(report.findings.some((finding) => finding.code === 'INVARIANT_REFERENCE_INVALID'));
});

test('high and medium invariants use proportionate requirements', () => {
  const high: InvariantDefinition = { id: 'durable-recovery', statement: 'Recovery preserves state.', criticality: 'high', owner: 'Runtime Lead', testFiles: ['tests/core.test.ts'], monitorIds: ['monitor-1'], evidenceRefs: ['evidence/core.json'] };
  const medium: InvariantDefinition = { id: 'operator-copy', statement: 'Operator labels remain clear.', criticality: 'medium', owner: 'Product Lead', testFiles: ['tests/core.test.ts'], evidenceRefs: [] };
  const report = evaluateInvariantCoverage([high, medium], inventory);
  assert.equal(report.status, 'passed');
  assert.equal(report.fullyCovered, 2);
});

test('orphan assets are reported for coverage refinement without failing valid invariants', () => {
  const report = evaluateInvariantCoverage([critical], inventory);
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.orphanAssets.testFiles, ['tests/orphan.test.ts']);
  assert.deepEqual(report.orphanAssets.evidenceRefs, ['evidence/orphan.json']);
});
