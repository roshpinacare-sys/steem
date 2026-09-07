import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningIdentity, sha256 } from '../src/contracts/crypto.js';
import { KeyLifecycleRegistry, type TrustSnapshot } from '../src/security/key-lifecycle.js';
import { MonotonicTrustCheckpointStore } from '../src/security/trust-checkpoint-store.js';

const now = new Date('2026-07-17T12:00:00.000Z');

function snapshot(): TrustSnapshot {
  const registry = new KeyLifecycleRegistry();
  const identity = generateSigningIdentity('checkpoint-v28-key');
  registry.register(identity, {
    keyId: identity.keyId, familyId: 'checkpoint-family', purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1',
    notBefore: new Date(now.getTime() - 1_000).toISOString(), notAfter: new Date(now.getTime() + 60_000).toISOString(),
  });
  return registry.snapshot(now);
}

function withDirectory<T>(name: string, operation: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), name));
  try { return operation(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test('checkpoint input validation rejects empty identity, invalid snapshot and filtered approvals', () => withDirectory('checkpoint-input-', (directory) => {
  const store = new MonotonicTrustCheckpointStore(join(directory, 'checkpoint.json'));
  const valid = snapshot();
  assert.throws(() => store.apply({ tenantId: '', channel: 'production', snapshot: valid, approvedBy: ['a', 'b'], createdAt: now }), /checkpoint_identity_required/);
  assert.throws(() => store.apply({ tenantId: 'tenant-1', channel: '', snapshot: valid, approvedBy: ['a', 'b'], createdAt: now }), /checkpoint_identity_required/);
  assert.throws(() => store.apply({ tenantId: 'tenant-1', channel: 'production', snapshot: { ...valid, root: 'bad' }, approvedBy: ['a', 'b'], createdAt: now }), /invalid_trust_snapshot/);
  assert.throws(() => store.apply({ tenantId: 'tenant-1', channel: 'production', snapshot: valid, approvedBy: ['a', 'a', ' '] }), /checkpoint_dual_control_required/);
  const created = store.apply({ tenantId: 'tenant-1', channel: 'production', snapshot: valid, approvedBy: ['b', 'a', 'a', ' '] });
  assert.deepEqual(created.approvedBy, ['a', 'b']);
  assert.ok(Number.isFinite(Date.parse(created.createdAt)));
}));

test('checkpoint file validation rejects schema, array, sequence, chain, digest and anchor defects', () => withDirectory('checkpoint-file-', (directory) => {
  const file = join(directory, 'checkpoint.json');
  const store = new MonotonicTrustCheckpointStore(file);
  store.apply({ tenantId: 'tenant-1', channel: 'production', snapshot: snapshot(), approvedBy: ['a', 'b'], createdAt: now });
  const original = JSON.parse(readFileSync(file, 'utf8')) as { schemaVersion: string; checkpoints: Array<Record<string, unknown>>; anchor: string | null };

  writeFileSync(file, JSON.stringify({ ...original, schemaVersion: '2.0' }));
  assert.throws(() => new MonotonicTrustCheckpointStore(file), /checkpoint_file_invalid/);
  writeFileSync(file, JSON.stringify({ ...original, checkpoints: null }));
  assert.throws(() => new MonotonicTrustCheckpointStore(file), /checkpoint_file_invalid/);

  const sequence = structuredClone(original); sequence.checkpoints[0]!.sequence = 2; writeFileSync(file, JSON.stringify(sequence));
  assert.throws(() => new MonotonicTrustCheckpointStore(file), /checkpoint_chain_invalid/);
  const previous = structuredClone(original); previous.checkpoints[0]!.previousDigest = 'bad'; writeFileSync(file, JSON.stringify(previous));
  assert.throws(() => new MonotonicTrustCheckpointStore(file), /checkpoint_chain_invalid/);
  const digest = structuredClone(original); digest.checkpoints[0]!.digest = 'bad'; writeFileSync(file, JSON.stringify(digest));
  assert.throws(() => new MonotonicTrustCheckpointStore(file), /checkpoint_digest_invalid/);
  writeFileSync(file, JSON.stringify({ ...original, anchor: 'bad' }));
  assert.throws(() => new MonotonicTrustCheckpointStore(file), /checkpoint_anchor_invalid/);
}));

test('same epoch is idempotent, lower epoch rolls back and equal epoch with another root forks', () => withDirectory('checkpoint-order-', (directory) => {
  const file = join(directory, 'checkpoint.json');
  const store = new MonotonicTrustCheckpointStore(file);
  const firstSnapshot = snapshot();
  const first = store.apply({ tenantId: 'tenant-1', channel: 'production', snapshot: firstSnapshot, approvedBy: ['a', 'b'], createdAt: now });
  assert.equal(store.apply({ tenantId: 'tenant-1', channel: 'production', snapshot: firstSnapshot, approvedBy: ['b', 'a'], createdAt: now }).digest, first.digest);

  const lower = { ...firstSnapshot, epoch: firstSnapshot.epoch - 1 };
  const lowerMaterial = { epoch: lower.epoch, generatedAt: lower.generatedAt, keys: lower.keys, revocations: lower.revocations };
  const validLower = { ...lower, root: sha256(lowerMaterial) };
  assert.throws(() => store.apply({ tenantId: 'tenant-1', channel: 'production', snapshot: validLower, approvedBy: ['a', 'b'], createdAt: now }), /trust_rollback_detected/);

  const otherRegistry = new KeyLifecycleRegistry();
  const otherIdentity = generateSigningIdentity('checkpoint-v28-other');
  otherRegistry.register(otherIdentity, { keyId: otherIdentity.keyId, familyId: 'other', purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1', notBefore: new Date(now.getTime()-1000).toISOString(), notAfter: new Date(now.getTime()+60000).toISOString() });
  const fork = otherRegistry.snapshot(now);
  assert.equal(fork.epoch, firstSnapshot.epoch);
  assert.throws(() => store.apply({ tenantId: 'tenant-1', channel: 'production', snapshot: fork, approvedBy: ['a', 'b'], createdAt: now }), /trust_epoch_fork_detected/);
}));

test('invalid stale lock metadata is reclaimed and a live lock fails fast at the deadline', () => withDirectory('checkpoint-lock-', (directory) => {
  const file = join(directory, 'checkpoint.json');
  const store = new MonotonicTrustCheckpointStore(file);
  const lock = `${file}.lock`;
  writeFileSync(lock, JSON.stringify({ pid: 'not-a-pid', createdAt: 'bad' }));
  const old = new Date(Date.now() - 60_000); utimesSync(lock, old, old);
  assert.equal(store.apply({ tenantId: 'tenant-1', channel: 'production', snapshot: snapshot(), approvedBy: ['a', 'b'], createdAt: now }).sequence, 1);

  writeFileSync(lock, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
  const actualNow = Date.now;
  let tick = 0;
  Date.now = () => { tick += 20_000; return tick; };
  try {
    assert.throws(() => store.apply({ tenantId: 'tenant-2', channel: 'production', snapshot: snapshot(), approvedBy: ['a', 'b'], createdAt: now }), /checkpoint_lock_timeout/);
  } finally {
    Date.now = actualNow;
  }
}));
