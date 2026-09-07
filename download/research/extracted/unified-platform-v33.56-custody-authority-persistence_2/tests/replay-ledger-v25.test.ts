import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sha256 } from '../src/contracts/crypto.js';
import { FileReplayLedger, InMemoryReplayLedger } from '../src/platform/replay-ledger.js';
const base = { replayKey: 'root:mission:1', tenantId: 'tenant-1', subjectId: 'subject-1', evidenceRoot: 'a'.repeat(64), consumedAt: '2026-07-17T10:00:00.000Z' } as const;

test('in-memory replay ledger consumes a key exactly once', () => {
  const ledger = new InMemoryReplayLedger();
  assert.equal(ledger.tryConsume(base), true);
  assert.equal(ledger.tryConsume(base), false);
  assert.equal(ledger.has(base.replayKey), true);
});

test('file replay ledger preserves consumption across restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'replay-v25-'));
  assert.equal(new FileReplayLedger(root).tryConsume(base), true);
  const restarted = new FileReplayLedger(root);
  assert.equal(restarted.has(base.replayKey), true);
  assert.equal(restarted.tryConsume(base), false);
  assert.deepEqual((restarted.read(base.replayKey) as { tenantRef: string }).tenantRef.length, 24);
});

test('incomplete replay metadata fails closed after a crash', () => {
  const root = mkdtempSync(join(tmpdir(), 'replay-v25-incomplete-'));
  const entry = sha256({ domain: 'evidence-replay-ledger-v1', replayKey: base.replayKey });
  mkdirSync(join(root, entry));
  const ledger = new FileReplayLedger(root);
  assert.equal(ledger.tryConsume(base), false);
  assert.deepEqual(ledger.read(base.replayKey), { status: 'consumed-metadata-incomplete' });
});

test('tenant and subject are recorded as privacy-preserving references', () => {
  const root = mkdtempSync(join(tmpdir(), 'replay-v25-privacy-'));
  const ledger = new FileReplayLedger(root);
  assert.equal(ledger.tryConsume({ ...base, consumerId: 'runner-sensitive-name' }), true);
  const record = ledger.read(base.replayKey) as Record<string, unknown>;
  assert.match(String(record.tenantRef), /^[a-f0-9]{24}$/);
  assert.match(String(record.subjectRef), /^[a-f0-9]{24}$/);
  assert.match(String(record.consumerRef), /^[a-f0-9]{24}$/);
  assert.equal(JSON.stringify(record).includes('tenant-1'), false);
  assert.equal(JSON.stringify(record).includes('subject-1'), false);
});

test('eight concurrent processes permit exactly one replay consumption', () => {
  const root = mkdtempSync(join(tmpdir(), 'replay-v25-concurrent-'));
  const worker = join(process.cwd(), 'dist/src/cli/replay-consume-worker.js');
  const commands = Array.from({ length: 8 }, (_, index) => `node ${JSON.stringify(worker)} ${JSON.stringify(root)} ${JSON.stringify(`shared-${index < 8 ? 'key' : index}`)}`);
  const script = commands.map((command) => `${command} &`).join('\n') + '\nwait\n';
  const output = execFileSync('bash', ['-lc', script], { encoding: 'utf8' });
  assert.equal(output.match(/CONSUMED/g)?.length ?? 0, 1);
  assert.equal(output.match(/REPLAY/g)?.length ?? 0, 7);
});

test('replay ledger rejects malformed identities, roots, times and keys', () => {
  const ledger = new InMemoryReplayLedger();
  assert.throws(() => ledger.tryConsume({ ...base, replayKey: '' }), /replay_key_invalid/);
  assert.throws(() => ledger.tryConsume({ ...base, tenantId: '' }), /identity_invalid/);
  assert.throws(() => ledger.tryConsume({ ...base, evidenceRoot: 'bad' }), /identity_invalid/);
  assert.throws(() => ledger.tryConsume({ ...base, consumedAt: 'bad' }), /time_invalid/);
  assert.throws(() => ledger.tryConsume({ ...base, consumerId: '' }), /consumer_invalid/);
});
