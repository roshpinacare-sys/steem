import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ContentAddressedArtifactStore } from '../src/artifacts/content-addressed-store.js';
import { generateSigningIdentity } from '../src/contracts/crypto.js';
import { approveChangeSession, createDisposableDefectRepository, executeChangePlan } from '../src/repository/change-assurance.js';
import { archiveChangeSession } from '../src/repository/session-archiver.js';
import { KeyLifecycleRegistry } from '../src/security/key-lifecycle.js';

const now = new Date('2026-07-17T00:00:00Z');

test('approved change package archives into tenant-bound immutable artifacts and survives restore', async () => {
  const root = mkdtempSync(join(tmpdir(), 'v20-session-archive-'));
  const repository = createDisposableDefectRepository(join(root, 'repository'));
  const sessionsRoot = join(root, 'sessions');
  const plan = {
    planId: 'archive-plan', idempotencyKey: 'archive-idem', tenantId: 'tenant-1', subjectId: 'operator-1', builderId: 'builder-1',
    objective: 'Fix addition', sourceRepository: repository, allowedFiles: ['src/calculator.js'], targetFile: 'src/calculator.js',
    exactBefore: 'return a - b;', exactAfter: 'return a + b;', testCommand: ['node', '--test'] as const,
    repositoryTrust: 'trusted-fixture' as const, testExecutionBoundary: 'trusted-local-process' as const,
  };
  const executed = await executeChangePlan(plan, { sessionsRoot });
  const signer = generateSigningIdentity('archive-passport-key');
  const registry = new KeyLifecycleRegistry();
  registry.register(signer, { keyId: signer.keyId, familyId: 'archive-family', purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1', notBefore: new Date(now.getTime() - 1000).toISOString(), notAfter: new Date(now.getTime() + 86_400_000).toISOString() });
  approveChangeSession({ sessionsRoot, sessionId: executed.sessionId, reviewerId: 'reviewer-1', passportSigner: signer, keyRegistry: registry, now });
  const artifactStore = new ContentAddressedArtifactStore(join(root, 'artifacts'));
  const archived = archiveChangeSession({ sessionsRoot, sessionId: executed.sessionId, artifactStore, now });
  assert.ok(archived.artifactRecords.length >= 9);
  assert.equal(archived.archiveRoot.length, 64);
  for (const record of archived.artifactRecords) assert.equal(artifactStore.verify('tenant-1', record.recordId).ok, true);
  const backup = artifactStore.createBackup(join(root, 'artifact-backup'));
  const restored = ContentAddressedArtifactStore.restoreFromBackup(join(root, 'artifact-backup'), join(root, 'artifact-restored'));
  assert.equal(restored.list('tenant-1').length, archived.artifactRecords.length);
  assert.ok(backup.fileCount > archived.artifactRecords.length);
});
