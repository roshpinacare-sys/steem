import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { EvidenceRecord } from '../src/contracts/canonical.js';
import { SqliteRuntimeStore } from '../src/runtime/sqlite-store.js';

test('local SQLite proof survives cold backup and restore with effects and chains intact', () => {
  const root = mkdtempSync(join(tmpdir(), 'v19-backup-restore-'));
  const livePath = join(root, 'live.db');
  const backupPath = join(root, 'backup.db');
  const restoredPath = join(root, 'restored.db');
  const now = new Date('2026-07-16T12:00:00.000Z');
  const store = new SqliteRuntimeStore(livePath);
  store.createMission({ missionId: 'mission-backup', tenantId: 'tenant-1', subjectId: 'subject-1', builderId: 'builder-1', scope: 'repository:read', effectKey: 'effect-backup', approvalRequired: false }, now);
  const lease = store.acquireLease('mission-backup', 'worker-1', 60_000, now.getTime());
  const outbox = store.prepareOutbox(lease, { value: 1 }, now.getTime());
  assert.ok(outbox);
  store.recordEffect(outbox.outboxId, lease, { result: 'ok' }, new Date(now.getTime() + 1000));
  store.acknowledgeOutbox(outbox.outboxId, lease, new Date(now.getTime() + 2000));
  const evidence: EvidenceRecord = {
    recordId: 'evidence-backup', tenantId: 'tenant-1', kind: 'backup-restore-proof', subject: 'mission-backup', evidenceClass: 'COMPUTED',
    method: 'deterministic-local-test', environment: { runtime: 'node', storage: 'sqlite-local-proof' },
    createdAt: new Date(now.getTime() + 3000).toISOString(), payload: { effectKey: 'effect-backup' }, limitations: ['sqlite-local-proof'],
  };
  store.appendEvidence(evidence);
  assert.equal(store.getMission('mission-backup').state, 'COMPLETED');
  store.close();

  copyFileSync(livePath, backupPath);
  copyFileSync(backupPath, restoredPath);
  const restored = new SqliteRuntimeStore(restoredPath);
  assert.equal(restored.getMission('mission-backup').state, 'COMPLETED');
  assert.equal(restored.countEffects('effect-backup'), 1);
  assert.equal(restored.verifyEventChain('mission-backup').ok, true);
  assert.equal(restored.verifyEvidenceChain('tenant-1').ok, true);
  restored.close();
});
