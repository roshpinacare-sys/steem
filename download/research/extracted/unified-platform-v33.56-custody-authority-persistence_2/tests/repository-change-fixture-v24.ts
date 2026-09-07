import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningIdentity } from '../src/contracts/crypto.js';
import { createDisposableDefectRepository, type ExplicitChangePlan } from '../src/repository/change-assurance.js';
import { KeyLifecycleRegistry } from '../src/security/key-lifecycle.js';

export function setupRepositoryChange() {
  const root = mkdtempSync(join(tmpdir(), 'governed-change-test-'));
  const repo = createDisposableDefectRepository(join(root, 'source'));
  const sessions = join(root, 'sessions');
  const plan: ExplicitChangePlan = {
    planId: 'fix-add', idempotencyKey: 'idem-1', tenantId: 'tenant-1', subjectId: 'subject-1', builderId: 'builder-1',
    objective: 'Correct the add function while preserving tests and repository scope.', sourceRepository: repo,
    allowedFiles: ['src/calculator.js'], targetFile: 'src/calculator.js', exactBefore: 'return a - b;', exactAfter: 'return a + b;',
    testCommand: ['node', '--test'], repositoryTrust: 'trusted-fixture', testExecutionBoundary: 'trusted-local-process',
  };
  return { root, repo, sessions, plan };
}

export function passportRegistry(now: Date) {
  const signer = generateSigningIdentity('passport-key');
  const registry = new KeyLifecycleRegistry();
  registry.register(signer, {
    keyId: signer.keyId, familyId: 'passport-family', purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1',
    notBefore: new Date(now.getTime() - 1000).toISOString(), notAfter: new Date(now.getTime() + 3600_000).toISOString(),
  });
  return { signer, registry };
}
