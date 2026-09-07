import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '../src/contracts/crypto.js';
import { TelemetryRegistry } from '../src/operations/telemetry.js';
const at = '2026-07-17T10:00:00.000Z';

test('telemetry bounds logs and duration samples while reporting drops', () => {
  const registry = new TelemetryRegistry({ maxLogs: 2, maxSamplesPerMetric: 2 });
  for (const value of [1, 2, 3]) registry.observe('task.duration_ms', value);
  for (const event of ['ONE', 'TWO', 'THREE']) registry.log({ timestamp: at, level: 'INFO', event, traceId: event, attributes: {} });
  const snapshot = registry.snapshot();
  assert.equal(snapshot.histograms['task.duration_ms']?.count, 2);
  assert.equal(snapshot.histograms['task.duration_ms']?.min, 2);
  assert.equal(snapshot.logs.length, 2);
  assert.deepEqual(snapshot.dropped, { durationSamples: 1, logs: 1 });
});

test('telemetry redacts secrets in keys and values', () => {
  const registry = new TelemetryRegistry();
  const record = registry.log({ timestamp: at, level: 'WARN', event: 'AUTH', traceId: 'trace-1', tenantId: 'tenant-private', attributes: { authorization: 'Bearer top-secret', note: 'token=abcdefghijklmnopqrstuvwxyz', pem: '-----BEGIN PRIVATE KEY-----' } });
  assert.equal(record.attributes.authorization, '[REDACTED]');
  assert.equal(record.attributes.note, '[REDACTED]');
  assert.equal(record.attributes.pem, '[REDACTED]');
  assert.equal(JSON.stringify(record).includes('tenant-private'), false);
});

test('telemetry enforces metric cardinality and attribute budgets', () => {
  const registry = new TelemetryRegistry({ maxMetricSeries: 2, maxAttributesPerLog: 1 });
  registry.increment('one.metric'); registry.gauge('two.metric', 1);
  assert.throws(() => registry.observe('three.metric', 1), /cardinality_exceeded/);
  assert.throws(() => registry.log({ timestamp: at, level: 'INFO', event: 'X', traceId: 't', attributes: { a: 1, b: 2 } }), /attribute_count_exceeded/);
});

test('degraded dependencies produce degraded readiness instead of ready', () => {
  const registry = new TelemetryRegistry();
  assert.equal(registry.snapshot([{ name: 'cache', status: 'degraded', detail: 'lagging' }]).readiness, 'degraded');
  assert.equal(registry.snapshot([{ name: 'db', status: 'blocked', detail: 'offline' }, { name: 'cache', status: 'degraded', detail: 'lagging' }]).readiness, 'blocked');
});

test('telemetry rejects duplicate or malformed dependency health records', () => {
  const registry = new TelemetryRegistry();
  assert.throws(() => registry.snapshot([{ name: '', status: 'ready', detail: 'ok' }]), /health_dependency_invalid/);
  assert.throws(() => registry.snapshot([{ name: 'db', status: 'ready', detail: 'ok' }, { name: 'db', status: 'blocked', detail: 'down' }]), /health_dependency_duplicate/);
});

test('telemetry snapshot is digest-bound and returned copies cannot mutate the registry', () => {
  const registry = new TelemetryRegistry(); registry.increment('mission.completed');
  const snapshot = registry.snapshot();
  const { snapshotDigest, ...material } = snapshot;
  assert.equal(snapshotDigest, sha256(material));
  (snapshot.counters as Record<string, number>)['mission.completed'] = 999;
  assert.equal(registry.snapshot().counters['mission.completed'], 1);
});

test('telemetry validates retention limits and truncates long values deterministically', () => {
  assert.throws(() => new TelemetryRegistry({ maxLogs: 0 }), /telemetry_limit_invalid/);
  const registry = new TelemetryRegistry({ maxAttributeValueLength: 8 });
  const first = registry.log({ timestamp: at, level: 'INFO', event: 'LONG', traceId: 't1', attributes: { value: 'abcdefghijk' } });
  const second = registry.log({ timestamp: at, level: 'INFO', event: 'LONG', traceId: 't2', attributes: { value: 'abcdefghijk' } });
  assert.equal(first.attributes.value, 'abcde...');
  assert.equal(first.attributes.value, second.attributes.value);
});
