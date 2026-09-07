import assert from 'node:assert/strict';
import test from 'node:test';
import { TelemetryRegistry } from '../src/operations/telemetry.js';

test('telemetry records tenant-safe logs, counters, gauges and duration statistics', () => {
  const telemetry = new TelemetryRegistry();
  telemetry.increment('mission.completed');
  telemetry.increment('mission.completed', 2);
  telemetry.gauge('outbox.backlog', 3);
  for (const value of [10, 20, 30, 40, 100]) telemetry.observe('mission.duration_ms', value);
  const record = telemetry.log({
    timestamp: '2026-07-17T00:00:00Z', level: 'INFO', event: 'MISSION_COMPLETED', traceId: 'trace-1', tenantId: 'tenant-1', missionId: 'mission-1',
    attributes: { status: 'completed', secretToken: 'should-not-leak', retries: 1 },
  });
  assert.match(record.tenantRef ?? '', /^tenant:[a-f0-9]{12}$/);
  assert.equal(record.attributes.secretToken, '[REDACTED]');
  const snapshot = telemetry.snapshot([{ name: 'postgresql', status: 'blocked', detail: 'environment unavailable' }]);
  assert.equal(snapshot.counters['mission.completed'], 3);
  assert.equal(snapshot.histograms['mission.duration_ms']?.p95, 100);
  assert.equal(snapshot.readiness, 'blocked');
});

test('telemetry rejects invalid or non-finite metrics', () => {
  const telemetry = new TelemetryRegistry();
  assert.throws(() => telemetry.increment('x'), /invalid_metric_name/);
  assert.throws(() => telemetry.gauge('valid.metric', Number.NaN), /invalid_metric_value/);
  assert.throws(() => telemetry.observe('valid.duration', -1), /negative_duration/);
});
