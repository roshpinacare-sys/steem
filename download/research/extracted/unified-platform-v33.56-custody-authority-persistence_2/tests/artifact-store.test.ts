import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ContentAddressedArtifactStore } from '../src/artifacts/content-addressed-store.js';

function storeRoot(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('content-addressed store preserves immutable bytes and tenant-bound metadata', () => {
  const store = new ContentAddressedArtifactStore(storeRoot('v20-artifacts-'));
  const first = store.put({ tenantId: 'tenant-1', kind: 'change-patch', mediaType: 'text/x-diff', bytes: Buffer.from('patch-v1'), metadata: { missionId: 'mission-1' } });
  const second = store.put({ tenantId: 'tenant-1', kind: 'rollback-patch', mediaType: 'text/x-diff', bytes: Buffer.from('patch-v1'), metadata: { missionId: 'mission-1' } });
  assert.equal(first.blobDigest, second.blobDigest);
  assert.notEqual(first.recordId, second.recordId);
  assert.equal(store.read('tenant-1', first.recordId).toString(), 'patch-v1');
  assert.equal(store.verify('tenant-1', first.recordId).ok, true);
  assert.throws(() => store.get('tenant-2', first.recordId), /artifact_record_not_found/);
});

test('blob and metadata tampering are detected', () => {
  process.env.NODE_ENV = 'test';
  const store = new ContentAddressedArtifactStore(storeRoot('v20-artifacts-tamper-'));
  const record = store.put({ tenantId: 'tenant-1', kind: 'evidence', mediaType: 'application/json', bytes: Buffer.from('{}') });
  store.unsafeTamperBlobForTest(record, Buffer.from('tampered'));
  assert.equal(store.verify('tenant-1', record.recordId).ok, false);

  const store2 = new ContentAddressedArtifactStore(storeRoot('v20-artifacts-record-tamper-'));
  const record2 = store2.put({ tenantId: 'tenant-1', kind: 'evidence', mediaType: 'application/json', bytes: Buffer.from('{}') });
  store2.unsafeTamperRecordForTest('tenant-1', record2.recordId);
  assert.equal(store2.verify('tenant-1', record2.recordId).ok, false);
});

test('legal hold prevents revocation and ordinary artifact can be revoked', () => {
  const store = new ContentAddressedArtifactStore(storeRoot('v20-artifacts-hold-'));
  const held = store.put({ tenantId: 'tenant-1', kind: 'audit', mediaType: 'application/json', bytes: Buffer.from('{}'), retention: 'legal-hold' });
  assert.throws(() => store.revoke('tenant-1', held.recordId, 'cleanup'), /legal_hold/);
  const ordinary = store.put({ tenantId: 'tenant-1', kind: 'temporary', mediaType: 'text/plain', bytes: Buffer.from('temporary') });
  const revoked = store.revoke('tenant-1', ordinary.recordId, 'superseded', new Date('2026-07-17T00:00:00Z'));
  assert.equal(revoked.revocationReason, 'superseded');
  assert.equal(store.verify('tenant-1', ordinary.recordId).ok, true);
});

test('backup and restore preserve artifact digests and reject tampered backup', () => {
  const liveRoot = storeRoot('v20-artifacts-live-');
  const backupRoot = storeRoot('v20-artifacts-backup-parent-') + '/backup';
  const restoreRoot = storeRoot('v20-artifacts-restore-parent-') + '/restored';
  const store = new ContentAddressedArtifactStore(liveRoot);
  const record = store.put({ tenantId: 'tenant-1', kind: 'passport', mediaType: 'application/json', bytes: Buffer.from('{"status":"shadow"}') });
  const backup = store.createBackup(backupRoot);
  assert.ok(backup.fileCount >= 2);
  const restored = ContentAddressedArtifactStore.restoreFromBackup(backupRoot, restoreRoot);
  assert.equal(restored.read('tenant-1', record.recordId).toString(), '{"status":"shadow"}');
  assert.equal(restored.verify('tenant-1', record.recordId).ok, true);
});

test('supersession must reference an artifact in the same tenant', () => {
  const store = new ContentAddressedArtifactStore(storeRoot('v20-artifacts-supercede-'));
  const first = store.put({ tenantId: 'tenant-1', kind: 'report', mediaType: 'text/plain', bytes: Buffer.from('v1') });
  const next = store.put({ tenantId: 'tenant-1', kind: 'report', mediaType: 'text/plain', bytes: Buffer.from('v2'), supersedesRecordId: first.recordId });
  assert.equal(next.supersedesRecordId, first.recordId);
  assert.throws(() => store.put({ tenantId: 'tenant-2', kind: 'report', mediaType: 'text/plain', bytes: Buffer.from('v3'), supersedesRecordId: first.recordId }), /artifact_record_not_found/);
});
