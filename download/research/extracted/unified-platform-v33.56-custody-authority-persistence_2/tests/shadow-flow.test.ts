import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { runRepositoryShadowCommitment } from '../src/app/shadow-commitment.js';
import { createHarness } from './helpers.js';


test('end-to-end read-only commitment produces verified shadow passport', async () => {
  const h = createHarness();
  try {
    const repository = join(h.directory, 'repo');
    mkdirSync(repository);
    writeFileSync(join(repository, 'a.txt'), 'alpha');
    writeFileSync(join(repository, 'b.txt'), 'beta');
    const result = await runRepositoryShadowCommitment({
      engine: h.engine,
      signedGrant: h.signedGrant,
      repositoryRoot: repository,
      tenantId: 'tenant-1',
      subjectId: 'subject-1',
      builderId: 'builder-1',
      reviewerId: 'reviewer-1',
      workerId: 'worker-1',
      passportSigner: h.reviewer,
      now: h.now,
    });
    assert.equal(result.inventory.fileCount, 2);
    assert.equal(result.decision.toState, 'shadow');
    assert.equal(h.registry.verify(result.passport), true);
    assert.equal(h.store.verifyEventChain(result.missionId).ok, true);
    assert.equal(h.store.verifyEvidenceChain('tenant-1').ok, true);
  } finally { h.store.close(); }
});

test('tenant mismatch prevents mission creation', async () => {
  const h = createHarness();
  try {
    await assert.rejects(runRepositoryShadowCommitment({
      engine: h.engine,
      signedGrant: h.signedGrant,
      repositoryRoot: h.directory,
      tenantId: 'tenant-2',
      subjectId: 'subject-1',
      builderId: 'builder-1',
      reviewerId: 'reviewer-1',
      workerId: 'worker-1',
      passportSigner: h.reviewer,
      now: h.now,
    }), /authority_denied/);
  } finally { h.store.close(); }
});

test('repository capability rejects symlinks', async () => {
  const h = createHarness();
  try {
    const repository = join(h.directory, 'repo-symlink');
    mkdirSync(repository);
    const { symlinkSync } = await import('node:fs');
    symlinkSync('/etc/passwd', join(repository, 'escape'));
    await assert.rejects(runRepositoryShadowCommitment({
      engine: h.engine,
      signedGrant: h.signedGrant,
      repositoryRoot: repository,
      tenantId: 'tenant-1', subjectId: 'subject-1', builderId: 'builder-1', reviewerId: 'reviewer-1',
      workerId: 'worker-1', passportSigner: h.reviewer, now: h.now,
    }), /symlink_rejected/);
  } finally { h.store.close(); }
});
