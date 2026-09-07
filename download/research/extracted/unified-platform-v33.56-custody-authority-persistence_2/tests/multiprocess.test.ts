import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createHarness } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const raceWorker = join(here, '..', 'src', 'cli', 'race-worker.js');
const crashWorker = join(here, '..', 'src', 'cli', 'crash-worker.js');

function runChild(script: string, args: readonly string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('multi-process lease race yields one active outbox', async () => {
  const h = createHarness();
  try {
    h.engine.createAuthorizedMission(h.signedGrant, {
      missionId: 'm-race', tenantId: 'tenant-1', subjectId: 'subject-1', builderId: 'builder-1',
      scope: 'repository.read', effectKey: 'effect:m-race', approvalRequired: false,
    }, h.now);
    h.store.close();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) => runChild(raceWorker, [h.dbPath, 'm-race', `worker-${index}`, String(h.now.getTime())])),
    );
    const parsed = results.map((result) => {
      if (result.stdout.trim() === '') return { ok: false, error: `empty_worker_output:${result.code}:${result.stderr}` };
      return JSON.parse(result.stdout) as { ok: boolean; error?: string };
    });
    assert.equal(parsed.filter((item) => item.ok).length, 1);
    const reopened = new (await import('../src/runtime/sqlite-store.js')).SqliteRuntimeStore(h.dbPath);
    try {
      assert.equal(reopened.listPendingOutbox().length, 1);
    } finally { reopened.close(); }
  } finally {
    try { h.store.close(); } catch { /* already closed */ }
  }
});

test('process crash after effect is recovered without duplicate', async () => {
  const h = createHarness();
  try {
    h.engine.createAuthorizedMission(h.signedGrant, {
      missionId: 'm-process-crash', tenantId: 'tenant-1', subjectId: 'subject-1', builderId: 'builder-1',
      scope: 'repository.read', effectKey: 'effect:m-process-crash', approvalRequired: false,
    }, h.now);
    const lease = h.engine.acquire('m-process-crash', 'worker-crash', 30_000, h.now.getTime());
    const outbox = h.engine.prepare(lease, { operation: 'read' }, h.now.getTime());
    if (outbox === null) throw new Error('outbox_expected');
    h.store.close();
    const crashed = await runChild(crashWorker, [
      h.dbPath, outbox.outboxId, lease.missionId, lease.workerId, String(lease.fenceToken), String(h.now.getTime()),
    ]);
    assert.equal(crashed.code, 17);
    const { SqliteRuntimeStore } = await import('../src/runtime/sqlite-store.js');
    const reopened = new SqliteRuntimeStore(h.dbPath);
    try {
      assert.equal(reopened.countEffects('effect:m-process-crash'), 1);
      reopened.acknowledgeOutbox(outbox.outboxId, lease, h.now);
      assert.equal(reopened.countEffects('effect:m-process-crash'), 1);
      assert.equal(reopened.getMission('m-process-crash').state, 'COMPLETED');
    } finally { reopened.close(); }
  } finally {
    try { h.store.close(); } catch { /* already closed */ }
  }
});
