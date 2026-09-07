import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateSigningIdentity } from '../src/contracts/crypto.js';
import { EncryptedKeyStore } from '../src/security/encrypted-keystore.js';
import { KeyLifecycleRegistry } from '../src/security/key-lifecycle.js';

const password = 'correct horse battery staple v20';
const now = new Date('2026-07-17T00:00:00.000Z');

function descriptor(keyId: string) {
  return {
    keyId,
    familyId: 'passport-family',
    purpose: 'action-passport' as const,
    environment: 'test' as const,
    tenantId: 'tenant-1',
    notBefore: new Date(now.getTime() - 1_000).toISOString(),
    notAfter: new Date(now.getTime() + 86_400_000).toISOString(),
  };
}

test('encrypted keystore persists a signing identity and trust snapshot across restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'v20-keystore-'));
  const path = join(root, 'keys.enc.json');
  const identity = generateSigningIdentity('passport-v20');
  const registry = new KeyLifecycleRegistry();
  registry.register(identity, descriptor(identity.keyId));
  const envelope = registry.sign({ proof: 'persistent' }, identity, {
    purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1', nonce: 'restart-proof',
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(),
  });
  const store = EncryptedKeyStore.create(path, password, now);
  store.addIdentity(identity, now);
  store.setSecret('session.hmac', 'a'.repeat(64), now);
  store.setTrustSnapshot(registry.snapshot(now), now);

  const reopened = EncryptedKeyStore.open(path, password);
  const restoredIdentity = reopened.getIdentity(identity.keyId);
  assert.equal(restoredIdentity.keyId, identity.keyId);
  assert.equal(reopened.getSecret('session.hmac'), 'a'.repeat(64));
  const offline = KeyLifecycleRegistry.fromSnapshot(reopened.getTrustSnapshot());
  assert.equal(offline.verify(envelope, { purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1' }, now), true);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('wrong passphrase and ciphertext tampering fail closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'v20-keystore-tamper-'));
  const path = join(root, 'keys.enc.json');
  EncryptedKeyStore.create(path, password, now);
  assert.throws(() => EncryptedKeyStore.open(path, 'this is definitely the wrong passphrase'), /keystore_decryption_failed/);
  const envelope = JSON.parse(readFileSync(path, 'utf8')) as { ciphertext: string };
  envelope.ciphertext = `${envelope.ciphertext.slice(0, -2)}AA`;
  writeFileSync(path, JSON.stringify(envelope), { mode: 0o600 });
  assert.throws(() => EncryptedKeyStore.open(path, password), /keystore_decryption_failed/);
});

test('open rejects overly broad file permissions', () => {
  const root = mkdtempSync(join(tmpdir(), 'v20-keystore-mode-'));
  const path = join(root, 'keys.enc.json');
  EncryptedKeyStore.create(path, password, now);
  chmodSync(path, 0o644);
  assert.throws(() => EncryptedKeyStore.open(path, password), /keystore_permissions_too_open/);
});

test('backup and restore preserve encrypted key material and trust root', () => {
  const root = mkdtempSync(join(tmpdir(), 'v20-keystore-backup-'));
  const path = join(root, 'live.enc.json');
  const backup = join(root, 'backup.enc.json');
  const identity = generateSigningIdentity('backup-passport-v20');
  const registry = new KeyLifecycleRegistry();
  registry.register(identity, descriptor(identity.keyId));
  const store = EncryptedKeyStore.create(path, password, now);
  store.addIdentity(identity, now);
  store.setTrustSnapshot(registry.snapshot(now), now);
  const backupDigest = store.backupTo(backup);
  const restored = EncryptedKeyStore.open(backup, password);
  assert.equal(restored.metadata.trustRoot, registry.snapshot(now).root);
  assert.equal(typeof backupDigest, 'string');
  assert.equal(backupDigest.length, 64);
});

test('revocation snapshot survives restart and invalidates earlier signatures', () => {
  const root = mkdtempSync(join(tmpdir(), 'v20-keystore-revoke-'));
  const path = join(root, 'keys.enc.json');
  const identity = generateSigningIdentity('revoked-passport-v20');
  const registry = new KeyLifecycleRegistry();
  registry.register(identity, descriptor(identity.keyId));
  const envelope = registry.sign({ proof: 'before-revocation' }, identity, {
    purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1', nonce: 'before-revoke',
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(),
  });
  registry.revoke(identity.keyId, { status: 'REVOKED', reason: 'test compromise', effectiveAt: now, approvedBy: ['security-1'] });
  const store = EncryptedKeyStore.create(path, password, now);
  store.addIdentity(identity, now);
  store.setTrustSnapshot(registry.snapshot(now), now);
  const restored = KeyLifecycleRegistry.fromSnapshot(EncryptedKeyStore.open(path, password).getTrustSnapshot());
  assert.equal(restored.verify(envelope, { purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1' }, now), false);
});
