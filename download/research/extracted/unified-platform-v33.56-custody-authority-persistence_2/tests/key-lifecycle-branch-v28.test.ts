import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSigningIdentity, sha256, type SigningIdentity } from '../src/contracts/crypto.js';
import {
  KeyLifecycleRegistry,
  type KeyDescriptor,
  type PurposeBoundEnvelope,
  type TrustSnapshot,
} from '../src/security/key-lifecycle.js';

const now = new Date('2026-07-17T12:00:00.000Z');
const before = new Date(now.getTime() - 60_000).toISOString();
const after = new Date(now.getTime() + 60 * 60_000).toISOString();

function input(identity: SigningIdentity, purpose: KeyDescriptor['purpose'], familyId: string, tenantId: string | undefined = 'tenant-1') {
  return {
    keyId: identity.keyId,
    familyId,
    purpose,
    environment: 'test' as const,
    ...(tenantId === undefined ? {} : { tenantId }),
    notBefore: before,
    notAfter: after,
  };
}

function context(purpose: KeyDescriptor['purpose'], nonce: string, issuedAt = now.toISOString(), expiresAt = new Date(now.getTime() + 60_000).toISOString(), tenantId: string | undefined = 'tenant-1') {
  return {
    purpose,
    environment: 'test' as const,
    ...(tenantId === undefined ? {} : { tenantId }),
    nonce,
    issuedAt,
    expiresAt,
  };
}

function reseal(snapshot: TrustSnapshot, patch: Partial<Omit<TrustSnapshot, 'root'>>): TrustSnapshot {
  const material = {
    epoch: patch.epoch ?? snapshot.epoch,
    generatedAt: patch.generatedAt ?? snapshot.generatedAt,
    keys: patch.keys ?? snapshot.keys,
    revocations: patch.revocations ?? snapshot.revocations,
  };
  return { ...material, root: sha256(material) };
}

test('registration is idempotent only for identical material and validates identity and descriptor state', () => {
  const registry = new KeyLifecycleRegistry();
  const identity = generateSigningIdentity('branch-key');
  const descriptor = input(identity, 'action-passport', 'family-1');
  const first = registry.register(identity, descriptor);
  const second = registry.register(identity, descriptor);
  assert.deepEqual(second, first);
  assert.throws(() => registry.register(identity, { ...descriptor, familyId: 'family-2' }), /key_descriptor_conflict/);
  assert.throws(() => registry.register(identity, { ...descriptor, keyId: 'other-id' }), /identity_key_id_mismatch/);
  assert.throws(() => registry.register(identity, { ...descriptor, keyId: '' }), /key_identity_required/);
  assert.throws(() => registry.register(identity, { ...descriptor, familyId: '' }), /key_identity_required/);
  assert.throws(() => registry.register(identity, { ...descriptor, purpose: 'invalid' as never }), /invalid_key_purpose/);
  assert.throws(() => registry.register(identity, { ...descriptor, notBefore: 'bad' }), /invalid_key_validity/);
  assert.throws(() => registry.register(identity, { ...descriptor, notAfter: descriptor.notBefore }), /invalid_key_validity/);
});

test('rotation rejects every incompatible lineage dimension', () => {
  const previous = generateSigningIdentity('rotate-old');
  const next = generateSigningIdentity('rotate-new');
  const registry = new KeyLifecycleRegistry();
  registry.register(previous, input(previous, 'action-passport', 'family-1'));
  assert.throws(() => registry.rotate(previous.keyId, next, input(next, 'action-passport', 'family-2'), now), /rotation_family_mismatch/);
  assert.throws(() => registry.rotate(previous.keyId, next, input(next, 'release-signer', 'family-1'), now), /rotation_purpose_mismatch/);
  assert.throws(() => registry.rotate(previous.keyId, next, { ...input(next, 'action-passport', 'family-1'), environment: 'production' }, now), /rotation_environment_mismatch/);
  assert.throws(() => registry.rotate(previous.keyId, next, input(next, 'action-passport', 'family-1', 'tenant-2'), now), /rotation_tenant_mismatch/);
  const rotated = registry.rotate(previous.keyId, next, input(next, 'action-passport', 'family-1'), now);
  assert.equal(rotated.predecessorKeyId, previous.keyId);
});

test('revocation validates reason, approval cardinality and chain linkage for low and high control keys', () => {
  const registry = new KeyLifecycleRegistry();
  const low = generateSigningIdentity('low-control');
  const high = generateSigningIdentity('high-control');
  registry.register(low, input(low, 'action-passport', 'low-family'));
  registry.register(high, input(high, 'release-signer', 'high-family'));
  assert.throws(() => registry.revoke(low.keyId, { status: 'REVOKED', reason: ' ', effectiveAt: now, approvedBy: ['a'] }), /revocation_reason_required/);
  assert.throws(() => registry.revoke(low.keyId, { status: 'REVOKED', reason: 'reason', effectiveAt: now, approvedBy: [' ', ''] }), /revocation_dual_control_required/);
  const first = registry.revoke(low.keyId, { status: 'REVOKED', reason: 'reason', effectiveAt: new Date(now.getTime() + 10_000), approvedBy: ['a', 'a', ' '] });
  assert.equal(first.previousDigest, null);
  assert.throws(() => registry.revoke(high.keyId, { status: 'COMPROMISED', reason: 'reason', effectiveAt: now, approvedBy: ['a', 'a', ' '] }), /revocation_dual_control_required/);
  const second = registry.revoke(high.keyId, { status: 'COMPROMISED', reason: 'reason', effectiveAt: now, approvedBy: ['b', 'a'] });
  assert.equal(second.previousDigest, first.digest);
  assert.deepEqual(second.approvedBy, ['a', 'b']);
});

test('signature context rejects malformed, mismatched, expired and out-of-validity requests', () => {
  const registry = new KeyLifecycleRegistry();
  const identity = generateSigningIdentity('context-key');
  registry.register(identity, input(identity, 'action-passport', 'family'));
  assert.throws(() => registry.sign({ value: 1 }, identity, context('action-passport', ' ')), /signature_nonce_required/);
  assert.throws(() => registry.sign({ value: 1 }, identity, context('release-signer', 'x')), /wrong_signature_purpose/);
  assert.throws(() => registry.sign({ value: 1 }, identity, { ...context('action-passport', 'x'), environment: 'production' }), /cross_environment_signature/);
  assert.throws(() => registry.sign({ value: 1 }, identity, context('action-passport', 'x', now.toISOString(), new Date(now.getTime() + 1_000).toISOString(), 'tenant-2')), /wrong_signature_tenant/);
  assert.throws(() => registry.sign({ value: 1 }, identity, context('action-passport', 'x', 'bad', 'bad')), /invalid_signature_window/);
  assert.throws(() => registry.sign({ value: 1 }, identity, context('action-passport', 'x', now.toISOString(), now.toISOString())), /invalid_signature_window/);

  const narrow = generateSigningIdentity('narrow-key');
  registry.register(narrow, {
    ...input(narrow, 'action-passport', 'narrow-family'),
    notBefore: new Date(now.getTime() + 10_000).toISOString(),
    notAfter: new Date(now.getTime() + 20_000).toISOString(),
  });
  assert.throws(() => registry.sign({ value: 1 }, narrow, context('action-passport', 'narrow')), /signature_outside_key_validity/);
});

test('verification fails closed for algorithm, key, digest, signature, epoch and status branches', () => {
  const registry = new KeyLifecycleRegistry();
  const identity = generateSigningIdentity('verify-key');
  registry.register(identity, input(identity, 'action-passport', 'family'));
  const envelope = registry.sign({ value: 1 }, identity, context('action-passport', 'verify'));
  const expectation = { purpose: 'action-passport' as const, environment: 'test' as const, tenantId: 'tenant-1' };
  assert.equal(registry.verify({ ...envelope, algorithm: 'RSA' as never }, expectation, now), false);
  assert.equal(registry.verify({ ...envelope, signerKeyId: 'missing' }, expectation, now), false);
  assert.equal(registry.verify({ ...envelope, payload: { value: 2 } }, expectation, now), false);
  assert.equal(registry.verify({ ...envelope, signature: Buffer.alloc(64).toString('base64url') }, expectation, now), false);
  assert.equal(registry.verify(envelope, { ...expectation, minimumEpoch: registry.epoch + 1 }, now), false);
  assert.equal(registry.verify(envelope, { purpose: 'action-passport', environment: 'test' }, now), true);
  assert.equal(registry.verify(envelope, expectation, new Date(now.getTime() - 1)), false);
  assert.equal(registry.verify(envelope, expectation, new Date(now.getTime() + 60_000)), false);

  registry.revoke(identity.keyId, { status: 'REVOKED', reason: 'future', effectiveAt: new Date(now.getTime() + 10_000), approvedBy: ['a'] });
  assert.equal(registry.verify(envelope, expectation, now), false);
});

test('snapshot verifier rejects malformed roots, descriptors and every revocation-chain defect', () => {
  const registry = new KeyLifecycleRegistry();
  const identity = generateSigningIdentity('snapshot-key');
  registry.register(identity, input(identity, 'action-passport', 'family'));
  registry.revoke(identity.keyId, { status: 'REVOKED', reason: 'revoked', effectiveAt: now, approvedBy: ['a'] });
  const snapshot = registry.snapshot(now);
  assert.equal(KeyLifecycleRegistry.verifySnapshot({ ...snapshot, epoch: -1 }), false);
  assert.equal(KeyLifecycleRegistry.verifySnapshot({ ...snapshot, epoch: 1.5 }), false);
  assert.equal(KeyLifecycleRegistry.verifySnapshot({ ...snapshot, generatedAt: 'bad' }), false);
  assert.equal(KeyLifecycleRegistry.verifySnapshot({ ...snapshot, root: 'bad' }), false);

  const badKey = { ...snapshot.keys[0]!, fingerprint: 'bad' };
  assert.equal(KeyLifecycleRegistry.verifySnapshot(reseal(snapshot, { keys: [badKey] })), false);
  assert.equal(KeyLifecycleRegistry.verifySnapshot(reseal(snapshot, { keys: [snapshot.keys[0]!, snapshot.keys[0]!] })), false);

  const record = snapshot.revocations[0]!;
  assert.equal(KeyLifecycleRegistry.verifySnapshot(reseal(snapshot, { revocations: [{ ...record, sequence: 2 }] })), false);
  assert.equal(KeyLifecycleRegistry.verifySnapshot(reseal(snapshot, { revocations: [{ ...record, keyId: 'unknown' }] })), false);
  assert.equal(KeyLifecycleRegistry.verifySnapshot(reseal(snapshot, { revocations: [{ ...record, reason: '' }] })), false);
  assert.equal(KeyLifecycleRegistry.verifySnapshot(reseal(snapshot, { revocations: [{ ...record, approvedBy: [] }] })), false);
  assert.equal(KeyLifecycleRegistry.verifySnapshot(reseal(snapshot, { revocations: [{ ...record, effectiveAt: 'bad' }] })), false);
  assert.equal(KeyLifecycleRegistry.verifySnapshot(reseal(snapshot, { revocations: [{ ...record, previousDigest: 'bad' }] })), false);
  assert.equal(KeyLifecycleRegistry.verifySnapshot(reseal(snapshot, { revocations: [{ ...record, digest: 'bad' }] })), false);
});

test('snapshot reconstruction uses embedded public keys and rejects an unknown signing identity', () => {
  const registry = new KeyLifecycleRegistry();
  const identity = generateSigningIdentity('offline-key');
  registry.register(identity, input(identity, 'action-passport', 'family'));
  const envelope = registry.sign({ value: 1 }, identity, context('action-passport', 'offline'));
  const offline = KeyLifecycleRegistry.fromSnapshot(registry.snapshot(now));
  assert.equal(offline.verify(envelope, { purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1' }, now), true);
  const unknown = generateSigningIdentity('unknown-key');
  assert.throws(() => registry.sign({ value: 1 }, unknown, context('action-passport', 'unknown')), /key_not_found/);
});
