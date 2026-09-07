import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { sign as cryptoSign } from 'node:crypto';
import test from 'node:test';
import { AttestedKmsSigningAdapter, type KmsSignRequest, type KmsSignResponse, type KmsTransport } from '../src/security/attested-kms-adapter.js';
import { canonicalJson, generateSigningIdentity, sha256 } from '../src/contracts/crypto.js';
import { KeyLifecycleRegistry, type KeyDescriptor, type TrustSnapshot } from '../src/security/key-lifecycle.js';
import { MonotonicTrustCheckpointStore } from '../src/security/trust-checkpoint-store.js';

const now = new Date('2026-07-17T10:00:00.000Z');
function descriptor(keyId: string): Omit<KeyDescriptor, 'publicKeyPem' | 'fingerprint' | 'status'> {
  return { keyId, familyId: 'family-kms', purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1', notBefore: '2026-07-17T09:00:00.000Z', notAfter: '2026-07-18T09:00:00.000Z' };
}
function context() {
  return { purpose: 'action-passport' as const, environment: 'test' as const, tenantId: 'tenant-1', nonce: 'kms-nonce-1', issuedAt: now.toISOString(), expiresAt: '2026-07-17T10:05:00.000Z' };
}
function snapshotWith(keys: number): TrustSnapshot {
  const registry = new KeyLifecycleRegistry();
  for (let index = 0; index < keys; index += 1) {
    const id = generateSigningIdentity(`checkpoint-key-${keys}-${index}`);
    registry.register(id, descriptor(id.keyId));
  }
  return registry.snapshot(now);
}
function runWorker(args: readonly string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/src/cli/trust-checkpoint-worker.js', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      reject(new Error(`trust_checkpoint_worker_timeout:${stderr}`));
    }, 15_000);
    timeout.unref();
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

test('attested KMS protocol signs externally and returns a cryptographically verified envelope', async () => {
  const identity = generateSigningIdentity('kms-key-1');
  const publicPem = identity.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const transport: KmsTransport = { async sign(request: KmsSignRequest): Promise<KmsSignResponse> {
    return {
      provider: 'rehearsal-kms', keyId: request.keyId, algorithm: 'Ed25519',
      signature: cryptoSign(null, Buffer.from(request.message), identity.privateKey).toString('base64url'),
      attestation: { requestDigest: request.requestDigest, nonce: context().nonce, issuedAt: context().issuedAt },
    };
  } };
  const adapter = new AttestedKmsSigningAdapter('rehearsal-kms', identity.keyId, publicPem, transport);
  const envelope = await adapter.sign({ action: 'promote', artifact: 'sha256:abc' }, context());
  const registry = new KeyLifecycleRegistry();
  registry.register(identity, descriptor(identity.keyId));
  assert.equal(registry.verify(envelope, { purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1' }, now), true);
});

test('attested KMS protocol rejects provider, key, attestation and signature substitution', async () => {
  const identity = generateSigningIdentity('kms-key-2');
  const publicPem = identity.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const base = async (request: KmsSignRequest): Promise<KmsSignResponse> => ({
    provider: 'rehearsal-kms', keyId: request.keyId, algorithm: 'Ed25519',
    signature: cryptoSign(null, Buffer.from(request.message), identity.privateKey).toString('base64url'),
    attestation: { requestDigest: request.requestDigest, nonce: context().nonce, issuedAt: context().issuedAt },
  });
  const cases: Array<[Partial<KmsSignResponse>, RegExp]> = [
    [{ provider: 'evil-kms' }, /kms_provider_mismatch/],
    [{ keyId: 'other-key' }, /kms_key_substitution/],
    [{ attestation: { requestDigest: 'bad', nonce: context().nonce, issuedAt: context().issuedAt } }, /kms_request_attestation_mismatch/],
    [{ signature: Buffer.alloc(64).toString('base64url') }, /kms_signature_invalid/],
  ];
  for (const [override, pattern] of cases) {
    const transport: KmsTransport = { async sign(request) { return { ...(await base(request)), ...override }; } };
    await assert.rejects(new AttestedKmsSigningAdapter('rehearsal-kms', identity.keyId, publicPem, transport).sign({ action: 'x' }, context()), pattern);
  }
});

test('monotonic trust checkpoint persists across restart and is idempotent for the same snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trust-checkpoint-'));
  try {
    const file = join(dir, 'checkpoint.json');
    const snapshot = snapshotWith(1);
    const first = new MonotonicTrustCheckpointStore(file).apply({ tenantId: 'tenant-1', channel: 'production', snapshot, approvedBy: ['a','b'], createdAt: now });
    const second = new MonotonicTrustCheckpointStore(file).apply({ tenantId: 'tenant-1', channel: 'production', snapshot, approvedBy: ['b','a'], createdAt: now });
    assert.equal(second.digest, first.digest);
    assert.deepEqual(new MonotonicTrustCheckpointStore(file).verify(), { ok: true, count: 1, anchor: first.digest });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('monotonic trust checkpoint rejects lower-epoch rollback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trust-rollback-'));
  try {
    const file = join(dir, 'checkpoint.json');
    const store = new MonotonicTrustCheckpointStore(file);
    const epoch1 = snapshotWith(1);
    const epoch2 = snapshotWith(2);
    store.apply({ tenantId: 'tenant-1', channel: 'production', snapshot: epoch2, approvedBy: ['a','b'], createdAt: now });
    assert.throws(() => store.apply({ tenantId: 'tenant-1', channel: 'production', snapshot: epoch1, approvedBy: ['a','b'], createdAt: now }), /trust_rollback_detected/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('monotonic trust checkpoint rejects a same-epoch fork', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trust-fork-'));
  try {
    const file = join(dir, 'checkpoint.json');
    const store = new MonotonicTrustCheckpointStore(file);
    const epoch2 = snapshotWith(2);
    store.apply({ tenantId: 'tenant-1', channel: 'production', snapshot: epoch2, approvedBy: ['a','b'], createdAt: now });
    const fork = snapshotWith(2);
    assert.notEqual(fork.root, epoch2.root);
    assert.throws(() => store.apply({ tenantId: 'tenant-1', channel: 'production', snapshot: fork, approvedBy: ['a','b'], createdAt: now }), /trust_epoch_fork_detected/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('monotonic trust checkpoint requires dual control', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trust-dual-control-'));
  try {
    const file = join(dir, 'checkpoint.json');
    assert.throws(() => new MonotonicTrustCheckpointStore(file).apply({ tenantId: 'tenant-1', channel: 'production', snapshot: snapshotWith(1), approvedBy: ['a'], createdAt: now }), /checkpoint_dual_control_required/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('trust checkpoint detects file tampering and anchor rollback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trust-tamper-'));
  try {
    const file = join(dir, 'checkpoint.json');
    const store = new MonotonicTrustCheckpointStore(file);
    store.apply({ tenantId: 'tenant-1', channel: 'production', snapshot: snapshotWith(1), approvedBy: ['a','b'], createdAt: now });
    const state = JSON.parse(readFileSync(file, 'utf8')) as { checkpoints: Array<Record<string, unknown>>; anchor: string | null; schemaVersion: string };
    state.checkpoints[0]!.trustRoot = 'tampered';
    writeFileSync(file, `${JSON.stringify(state)}\n`);
    assert.throws(() => new MonotonicTrustCheckpointStore(file), /checkpoint_digest_invalid/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('eight processes applying the same trust snapshot produce one checkpoint', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trust-multiprocess-'));
  try {
    const file = join(dir, 'checkpoint.json');
    const snapshotFile = join(dir, 'snapshot.json');
    writeFileSync(snapshotFile, `${canonicalJson(snapshotWith(1))}\n`);
    const results = await Promise.all(Array.from({ length: 8 }, () => runWorker([file, snapshotFile, 'tenant-1', 'production'])));
    assert.deepEqual(results.map((item) => item.code), Array(8).fill(0), results.map((item) => item.stderr).join('\n'));
    assert.equal(new MonotonicTrustCheckpointStore(file).list().length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('checkpoint material is chained to full snapshot digest, not root alone', () => {
  const snapshot = snapshotWith(1);
  const expected = sha256(snapshot);
  const dir = mkdtempSync(join(tmpdir(), 'trust-digest-'));
  try {
    const checkpoint = new MonotonicTrustCheckpointStore(join(dir, 'checkpoint.json')).apply({ tenantId: 'tenant-1', channel: 'staging', snapshot, approvedBy: ['a','b'], createdAt: now });
    assert.equal(checkpoint.snapshotDigest, expected);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('stale checkpoint lock from a crashed process is recovered without deleting a live lock', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trust-stale-lock-'));
  try {
    const file = join(dir, 'checkpoint.json');
    const store = new MonotonicTrustCheckpointStore(file);
    writeFileSync(`${file}.lock`, `${JSON.stringify({ pid: 99999999, createdAt: '2020-01-01T00:00:00.000Z' })}\n`);
    const old = new Date(Date.now() - 60_000);
    const { utimesSync } = await import('node:fs');
    utimesSync(`${file}.lock`, old, old);
    const checkpoint = store.apply({ tenantId: 'tenant-1', channel: 'production', snapshot: snapshotWith(1), approvedBy: ['a','b'], createdAt: now });
    assert.equal(checkpoint.sequence, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
