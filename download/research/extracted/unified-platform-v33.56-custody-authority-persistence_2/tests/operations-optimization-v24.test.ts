import assert from 'node:assert/strict';
import test from 'node:test';
import { compareTestRuns, scheduleTestLanes, selectImpactedTests } from '../src/operations/test-optimization.js';
import { buildOperatorActionCenter } from '../src/operations/operator-action-center.js';

const lanes = [
  { id: 'slow', durationMs: 6000, resources: ['sqlite-process'], testFiles: ['slow.test.js'] },
  { id: 'linux-a', durationMs: 4000, resources: ['linux-isolation'], testFiles: ['linux-a.test.js'] },
  { id: 'linux-b', durationMs: 2500, resources: ['linux-isolation'], testFiles: ['linux-b.test.js'] },
  { id: 'web', durationMs: 2200, resources: ['loopback'], testFiles: ['web.test.js'] },
  { id: 'fast', durationMs: 800, testFiles: ['fast.test.js'] },
] as const;

test('resource-aware scheduler shortens the critical path without overlapping exclusive Linux lanes', () => {
  const plan = scheduleTestLanes(lanes, 4);
  assert.ok(plan.makespanMs < plan.serialDurationMs);
  assert.ok(plan.theoreticalSpeedup > 1.5);
  const linux = plan.lanes.filter((lane) => lane.resources?.includes('linux-isolation')).sort((a, b) => a.startMs - b.startMs);
  assert.ok(linux[1]!.startMs >= linux[0]!.finishMs);
});

test('scheduler rejects invalid workers and lanes', () => {
  assert.throws(() => scheduleTestLanes(lanes, 0), /test_worker_count_invalid/);
  assert.throws(() => scheduleTestLanes([{ id: '', durationMs: 1, testFiles: ['x'] }], 1), /test_lane_invalid/);
});

test('impact selection chooses intersecting tests and mandatory sentinels', () => {
  const plan = selectImpactedTests({ tests: { 'tests/a.test.ts': ['src/a.ts', 'src/shared.ts'], 'tests/b.test.ts': ['src/b.ts'] }, changedFiles: ['src/a.ts'], mandatoryTests: ['tests/sentinel.test.ts'] });
  assert.equal(plan.mode, 'impacted');
  assert.deepEqual(plan.selectedTests, ['tests/a.test.ts', 'tests/sentinel.test.ts']);
});

test('impact selection fails closed for unknown source and global configuration changes', () => {
  const tests = { 'tests/a.test.ts': ['src/a.ts'] };
  assert.equal(selectImpactedTests({ tests, changedFiles: ['src/new-unknown.ts'] }).mode, 'full');
  assert.match(selectImpactedTests({ tests, changedFiles: ['package-lock.json'] }).reasons[0]!, /global_invalidator/);
});

test('impact selection permits documentation-only change without widening to full suite', () => {
  const plan = selectImpactedTests({ tests: { 'tests/a.test.ts': ['src/a.ts'] }, changedFiles: ['docs/guide.md'], mandatoryTests: ['tests/sentinel.test.ts'] });
  assert.equal(plan.mode, 'impacted');
  assert.deepEqual(plan.selectedTests, ['tests/sentinel.test.ts']);
});

test('runtime comparison rejects speedups obtained by reducing tests', () => {
  const comparison = compareTestRuns({ baselineMs: 28000, currentMs: 7000, baselineTests: 229, currentTests: 220, failedTests: 0 });
  assert.equal(comparison.status, 'invalid');
  assert.ok(comparison.reasons.includes('test_count_reduced'));
});

test('runtime comparison reports an honest improvement', () => {
  const comparison = compareTestRuns({ baselineMs: 28000, currentMs: 9000, baselineTests: 229, currentTests: 240, failedTests: 0 });
  assert.equal(comparison.status, 'improved');
  assert.ok(comparison.speedup > 3);
});

test('operator action center blocks on failed tests and production dependencies', () => {
  const center = buildOperatorActionCenter({ failedTests: 2, dependencies: [{ id: 'postgres', state: 'blocked', detail: 'No primary/standby qualification.', owner: 'Database Lead' }], risks: [] });
  assert.equal(center.overallState, 'blocked');
  assert.equal(center.actions[0]!.priority, 1);
  assert.ok(center.actions.some((action) => action.id === 'tests-failed' && action.category === 'stop'));
  assert.ok(center.blockedDependencies.includes('postgres'));
});

test('operator action center prioritizes degraded recovery before monitoring risks', () => {
  const center = buildOperatorActionCenter({ dependencies: [{ id: 'artifact-store', state: 'degraded', detail: 'Restore check failed.', owner: 'Recovery Lead', runbook: 'docs/runbook.md' }], risks: [{ id: 'R1', severity: 'low', summary: 'Evidence growth', affectedArea: 'storage' }] });
  assert.equal(center.overallState, 'degraded');
  assert.equal(center.actions[0]!.category, 'repair');
  assert.equal(center.actions.at(-1)!.category, 'monitor');
});

test('operator action center reports ready only when no action is required', () => {
  const center = buildOperatorActionCenter({ dependencies: [{ id: 'local-store', state: 'ready', detail: 'Verified.', owner: 'Runtime Lead' }], risks: [] });
  assert.equal(center.overallState, 'ready');
  assert.equal(center.actions.length, 0);
});
