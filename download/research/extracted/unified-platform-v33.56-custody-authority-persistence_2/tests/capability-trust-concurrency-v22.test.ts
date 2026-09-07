import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { capabilityRef, PersistentCapabilityTrustStore } from '../src/platform/capability-trust.js';

function root(): string { return mkdtempSync(join(tmpdir(), 'cap-trust-concurrency-v22-')); }
function register(directory: string): string {
  const store = new PersistentCapabilityTrustStore(directory);
  store.register({
    tenantId: 'tenant-concurrent', capabilityId: 'worker', version: '1.0.0', publisherId: 'publisher',
    originalScopes: ['repository.read', 'repository.write', 'evidence.emit'],
  }, new Date('2026-07-17T12:00:00.000Z'));
  return capabilityRef('worker', '1.0.0');
}
function runWorker(directory: string, capability: string, index: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const worker = fileURLToPath(new URL('../src/cli/trust-violation-worker.js', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, directory, 'tenant-concurrent', capability, `v-${index}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('eight processes serialize trust violations without sequence or anchor corruption', async () => {
  const directory = root();
  const capability = register(directory);
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => runWorker(directory, capability, index + 1)));
  assert.deepEqual(results.map((result) => result.code), Array(8).fill(0), results.map((result) => result.stderr).join('\n'));
  const reopened = new PersistentCapabilityTrustStore(directory);
  assert.deepEqual(reopened.verify(), { ok: true, count: 9, root: reopened.verify().root });
  const state = reopened.get('tenant-concurrent', capability);
  assert.equal(state.violationCount, 8);
  assert.equal(state.status, 'RESTRICTED');
  assert.deepEqual(state.allowedScopes, ['evidence.emit', 'repository.read']);
  const events = readFileSync(join(directory, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { sequence: number; digest: string });
  assert.deepEqual(events.map((event) => event.sequence), Array.from({ length: 9 }, (_, index) => index + 1));
  assert.equal(new Set(events.map((event) => event.digest)).size, 9);
});

test('pending journal repairs a crash after event fsync but before anchor replacement', () => {
  const directory = root();
  const capability = register(directory);
  const store = new PersistentCapabilityTrustStore(directory);
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  process.env.V22_TRUST_CRASH_POINT = 'after-event';
  try {
    assert.throws(() => store.recordViolation('tenant-concurrent', capability, {
      violationId: 'crash-1', kind: 'POLICY', severity: 'LOW', evidenceRef: 'evidence-crash',
      observedAt: '2026-07-17T12:01:00.000Z', message: 'injected crash',
    }), /injected_trust_crash_after_event/);
  } finally {
    delete process.env.V22_TRUST_CRASH_POINT;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
  }
  const recovered = new PersistentCapabilityTrustStore(directory);
  assert.equal(recovered.verify().ok, true);
  assert.equal(recovered.get('tenant-concurrent', capability).violationCount, 1);
  assert.equal(recovered.events('tenant-concurrent', capability).length, 2);
});

test('dead-owner lock is recovered but a live-owner lock fails closed', { timeout: 2_000 }, () => {
  const directory = root();
  writeFileSync(join(directory, '.write.lock'), JSON.stringify({ pid: 999999999, acquiredAt: '2026-07-17T00:00:00.000Z' }));
  const recovered = new PersistentCapabilityTrustStore(directory);
  assert.equal(recovered.verify().ok, true);

  const live = root();
  writeFileSync(join(live, '.write.lock'), JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
  const previous = process.env.V22_TRUST_LOCK_TIMEOUT_MS;
  process.env.V22_TRUST_LOCK_TIMEOUT_MS = '50';
  try { assert.throws(() => new PersistentCapabilityTrustStore(live), /write_lock_timeout/); }
  finally { if (previous === undefined) delete process.env.V22_TRUST_LOCK_TIMEOUT_MS; else process.env.V22_TRUST_LOCK_TIMEOUT_MS = previous; }
});
