import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WorkflowService } from '../src/web/workflow-service.js';

test('web workflow service exposes honest infrastructure boundaries', () => {
  const root = mkdtempSync(join(tmpdir(), 'v19-web-health-'));
  const service = new WorkflowService(root, new Date('2026-07-16T12:00:00.000Z'));
  const health = service.health();
  assert.equal(health.status, 'ok');
  assert.equal(health.version, 'v32');
  assert.equal(health.promotionBoundary, 'shadow-only');
  assert.equal(health.infrastructure.postgres, 'environment-blocked');
  assert.equal(health.infrastructure.externalGitMutation, 'disabled');
  assert.match(health.infrastructure.isolation, /untrusted repositories blocked/);
});

test('web workflow service performs intake, execution, independent review and exact rollback', async () => {
  const root = mkdtempSync(join(tmpdir(), 'v19-web-flow-'));
  const service = new WorkflowService(root, new Date('2026-07-16T12:00:00.000Z'));
  const fixture = service.fixture();
  const intake = await service.intake({
    sourceRepository: fixture.repositoryPath,
    objective: fixture.objective,
    targetFile: fixture.targetFile,
    allowedFiles: fixture.allowedFiles,
    exactBefore: fixture.exactBefore,
    exactAfter: fixture.exactAfter,
    testCommand: fixture.testCommand,
    planId: 'web-service-plan',
    idempotencyKey: 'web-service-idempotency',
  });
  assert.equal(intake.status, 'INTAKE_COMPLETE');
  const findings = intake.findings as ReadonlyArray<{ readonly kind: string }>;
  assert.equal(findings.some((finding) => finding.kind === 'PROMPT_INJECTION'), true);

  const sessionId = intake.sessionId as string;
  const executed = await service.execute(sessionId);
  assert.equal(executed.status, 'AWAITING_REVIEW');
  assert.equal((executed.testExecution as { readonly passed: boolean }).passed, true);
  assert.equal(typeof executed.evidenceRoot, 'string');

  const approved = service.review(sessionId, 'independent-reviewer-1');
  assert.equal(approved.status, 'APPROVED_SHADOW');
  assert.equal(typeof approved.passport, 'object');

  const rolledBack = service.rollback(sessionId);
  assert.equal(rolledBack.status, 'ROLLED_BACK');
});


test('web workflow rejects non-allowlisted repositories and cross-tenant input', async () => {
  const root = mkdtempSync(join(tmpdir(), 'v19-web-policy-'));
  const service = new WorkflowService(root, new Date('2026-07-16T12:00:00.000Z'));
  await assert.rejects(service.intake({ sourceRepository: '/tmp/not-allowlisted' }), /repository_not_allowlisted/);
  await assert.rejects(service.intake({ tenantId: 'tenant-2' }), /web_tenant_not_authorized/);
  await assert.rejects(service.intake({ repositoryTrust: 'untrusted' }), /web_repository_trust_not_authorized/);
});
