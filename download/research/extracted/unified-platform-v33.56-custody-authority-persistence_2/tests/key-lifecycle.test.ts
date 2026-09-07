import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSigningIdentity, sha256 } from '../src/contracts/crypto.js';
import {
  EnvironmentBlockedSigningAdapter,
  KeyLifecycleRegistry,
  type KeyDescriptor,
} from '../src/security/key-lifecycle.js';

const now = new Date('2026-07-16T12:00:00.000Z');

function descriptor(keyId: string, overrides: Partial<Omit<KeyDescriptor, 'publicKeyPem' | 'fingerprint' | 'status'>> = {}) {
  return {
    keyId,
    familyId: 'family-1',
    purpose: 'action-passport' as const,
    environment: 'test' as const,
    tenantId: 'tenant-1',
    notBefore: new Date(now.getTime() - 60_000).toISOString(),
    notAfter: new Date(now.getTime() + 60 * 60_000).toISOString(),
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    purpose: 'action-passport' as const,
    environment: 'test' as const,
    tenantId: 'tenant-1',
    nonce: 'nonce-1',
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    ...overrides,
  };
}

test('purpose-bound signature verifies only for matching tenant, purpose and environment', () => {
  const registry = new KeyLifecycleRegistry();
  const identity = generateSigningIdentity('passport-key');
  registry.register(identity, descriptor(identity.keyId));
  const envelope = registry.sign({ value: 1 }, identity, context());
  assert.equal(registry.verify(envelope, { purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1' }, now), true);
  assert.equal(registry.verify(envelope, { purpose: 'release-signer', environment: 'test', tenantId: 'tenant-1' }, now), false);
  assert.equal(registry.verify(envelope, { purpose: 'action-passport', environment: 'production', tenantId: 'tenant-1' }, now), false);
  assert.equal(registry.verify(envelope, { purpose: 'action-passport', environment: 'test', tenantId: 'tenant-2' }, now), false);
});

test('signature replay is rejected when nonce consumption is required', () => {
  const registry = new KeyLifecycleRegistry();
  const identity = generateSigningIdentity('passport-key');
  registry.register(identity, descriptor(identity.keyId));
  const envelope = registry.sign({ value: 1 }, identity, context());
  const expectation = { purpose: 'action-passport' as const, environment: 'test' as const, tenantId: 'tenant-1', consumeNonce: true };
  assert.equal(registry.verify(envelope, expectation, now), true);
  assert.equal(registry.verify(envelope, expectation, now), false);
});

test('rotation allows old signatures before retirement and rejects signatures issued after retirement', () => {
  const registry = new KeyLifecycleRegistry();
  const first = generateSigningIdentity('passport-key-1');
  registry.register(first, descriptor(first.keyId));
  const oldEnvelope = registry.sign({ value: 1 }, first, context({ nonce: 'old' }));
  const second = generateSigningIdentity('passport-key-2');
  registry.rotate(first.keyId, second, descriptor(second.keyId), new Date(now.getTime() + 10_000));
  assert.equal(registry.verify(oldEnvelope, { purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1' }, now), true);
  assert.throws(() => registry.sign({ value: 2 }, first, context({ nonce: 'late', issuedAt: new Date(now.getTime() + 20_000).toISOString(), expiresAt: new Date(now.getTime() + 30_000).toISOString() })), /signing_key_not_active|signature_after_retirement/);
  const newEnvelope = registry.sign({ value: 2 }, second, context({ nonce: 'new' }));
  assert.equal(registry.verify(newEnvelope, { purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1' }, now), true);
});

test('high-control revocation requires dual control and immediately invalidates signatures', () => {
  const registry = new KeyLifecycleRegistry();
  const identity = generateSigningIdentity('release-key');
  registry.register(identity, descriptor(identity.keyId, { purpose: 'release-signer' }));
  const envelope = registry.sign({ artifact: 'a' }, identity, context({ purpose: 'release-signer', nonce: 'release' }));
  assert.throws(() => registry.revoke(identity.keyId, { status: 'COMPROMISED', reason: 'test', effectiveAt: now, approvedBy: ['reviewer-1'] }), /dual_control/);
  registry.revoke(identity.keyId, { status: 'COMPROMISED', reason: 'test', effectiveAt: now, approvedBy: ['reviewer-1', 'reviewer-2'] });
  assert.equal(registry.verify(envelope, { purpose: 'release-signer', environment: 'test', tenantId: 'tenant-1' }, now), false);
});

test('trust snapshot detects tampering and supports stale-cache gate', () => {
  const registry = new KeyLifecycleRegistry();
  const identity = generateSigningIdentity('passport-key');
  registry.register(identity, descriptor(identity.keyId));
  const snapshot = registry.snapshot(now);
  assert.equal(KeyLifecycleRegistry.verifySnapshot(snapshot), true);
  assert.equal(KeyLifecycleRegistry.verifySnapshot({ ...snapshot, epoch: snapshot.epoch + 1 }), false);
  const envelope = registry.sign({ value: 1 }, identity, context());
  assert.equal(registry.verify(envelope, { purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1', minimumEpoch: registry.epoch + 1 }, now), false);
});

test('key identifier cannot be rebound to different material', () => {
  const registry = new KeyLifecycleRegistry();
  const first = generateSigningIdentity('shared-key');
  const second = generateSigningIdentity('shared-key');
  registry.register(first, descriptor(first.keyId));
  assert.throws(() => registry.register(second, descriptor(second.keyId)), /key_id_conflict/);
});

test('lost key recovery uses successor and old key remains invalid', () => {
  const registry = new KeyLifecycleRegistry();
  const first = generateSigningIdentity('backup-key-1');
  registry.register(first, descriptor(first.keyId, { purpose: 'backup-recovery' }));
  registry.revoke(first.keyId, { status: 'LOST', reason: 'lost hardware token', effectiveAt: now, approvedBy: ['custodian-1', 'custodian-2'] });
  const second = generateSigningIdentity('backup-key-2');
  registry.register(second, descriptor(second.keyId, { purpose: 'backup-recovery', predecessorKeyId: first.keyId }));
  assert.throws(() => registry.sign({ backup: 1 }, first, context({ purpose: 'backup-recovery', nonce: 'old-backup' })), /signing_key_not_active/);
  const current = registry.sign({ backup: 2 }, second, context({ purpose: 'backup-recovery', nonce: 'new-backup' }));
  assert.equal(registry.verify(current, { purpose: 'backup-recovery', environment: 'test', tenantId: 'tenant-1' }, now), true);
});

test('KMS, HSM and air-gap custody remain explicit environment blockers', async () => {
  const adapter = new EnvironmentBlockedSigningAdapter('hsm', 'no-qualified-hsm');
  await assert.rejects(adapter.sign({ value: 1 }, context()), /environment_blocked:hsm:no-qualified-hsm/);
});


test('trust snapshot can reconstruct an offline verifier and rejects duplicate or malformed keys', () => {
  const registry = new KeyLifecycleRegistry();
  const identity = generateSigningIdentity('offline-passport-key');
  registry.register(identity, descriptor(identity.keyId));
  const envelope = registry.sign({ artifact: 'proof' }, identity, context({ nonce: 'offline' }));
  const snapshot = registry.snapshot(now);
  const offline = KeyLifecycleRegistry.fromSnapshot(snapshot);
  assert.equal(offline.verify(envelope, { purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1' }, now), true);
  const duplicate = { ...snapshot, keys: [...snapshot.keys, snapshot.keys[0]!] };
  const resealed = { ...duplicate, root: sha256({ epoch: duplicate.epoch, generatedAt: duplicate.generatedAt, keys: duplicate.keys, revocations: duplicate.revocations }) };
  assert.equal(KeyLifecycleRegistry.verifySnapshot(resealed), false);
  assert.throws(() => KeyLifecycleRegistry.fromSnapshot(resealed), /invalid_trust_snapshot/);
});
