import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelLifecycleWatchdog, type ModelLifecycleRecord } from '../src/ai/model-lifecycle-watchdog.js';

const records: ModelLifecycleRecord[] = [
  { modelId: 'stable', providerId: 'provider', status: 'ACTIVE', allowedPurposes: ['code-review'], evidenceRef: 'registry:stable' },
  { modelId: 'legacy', providerId: 'provider', status: 'DEPRECATED', allowedPurposes: ['code-review'], replacementModelId: 'stable', evidenceRef: 'registry:legacy' },
  { modelId: 'retired', providerId: 'provider', status: 'RETIRED', allowedPurposes: ['code-review'], evidenceRef: 'registry:retired' },
  { modelId: 'scheduled', providerId: 'provider', status: 'ACTIVE', allowedPurposes: ['code-review'], deprecatedAt: '2026-07-20T00:00:00Z', retiresAt: '2026-08-01T00:00:00Z', replacementModelId: 'stable', evidenceRef: 'registry:scheduled' },
];

const request = { modelId: 'stable', providerId: 'provider', purpose: 'code-review', environment: 'production' as const };

test('active allowed model is permitted', () => {
  assert.equal(new ModelLifecycleWatchdog(records).evaluate(request, new Date('2026-07-18T00:00:00Z')).status, 'ALLOW');
});

test('deprecated model warns with replacement while retired model blocks', () => {
  const watchdog = new ModelLifecycleWatchdog(records);
  const deprecated = watchdog.evaluate({ ...request, modelId: 'legacy' });
  assert.equal(deprecated.status, 'WARN');
  assert.equal(deprecated.replacementModelId, 'stable');
  assert.equal(watchdog.evaluate({ ...request, modelId: 'retired' }).status, 'BLOCK');
});

test('time-effective lifecycle changes are enforced', () => {
  const watchdog = new ModelLifecycleWatchdog(records);
  assert.equal(watchdog.evaluate({ ...request, modelId: 'scheduled' }, new Date('2026-07-19T00:00:00Z')).status, 'ALLOW');
  assert.equal(watchdog.evaluate({ ...request, modelId: 'scheduled' }, new Date('2026-07-21T00:00:00Z')).status, 'WARN');
  assert.equal(watchdog.evaluate({ ...request, modelId: 'scheduled' }, new Date('2026-08-02T00:00:00Z')).status, 'BLOCK');
});

test('unknown model and unauthorized purpose fail closed', () => {
  const watchdog = new ModelLifecycleWatchdog(records);
  assert.equal(watchdog.evaluate({ ...request, modelId: 'missing' }).status, 'BLOCK');
  assert.ok(watchdog.evaluate({ ...request, purpose: 'payments' }).reasons.includes('PURPOSE_NOT_ALLOWED'));
});

test('invalid lifecycle records are rejected', () => {
  assert.throws(() => new ModelLifecycleWatchdog([{ ...records[0]!, replacementModelId: 'stable' }]), /self_replacement/);
  assert.throws(() => new ModelLifecycleWatchdog([{ ...records[3]!, deprecatedAt: '2026-09-01T00:00:00Z' }]), /window_invalid/);
});
