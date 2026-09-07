import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { intakeChangePlan } from '../src/repository/change-assurance.js';
import { setupRepositoryChange } from './repository-change-fixture-v24.js';

test('intake detects prompt injection and unpinned dependency without following either', async () => {
  const { sessions, plan } = setupRepositoryChange();
  const state = await intakeChangePlan(plan, sessions);
  assert.equal(state.status, 'INTAKE_COMPLETE');
  assert.equal(state.intakeFindings.some((item) => item.kind === 'PROMPT_INJECTION'), true);
  assert.equal(state.intakeFindings.some((item) => item.kind === 'DEPENDENCY_RISK'), true);
});

test('idempotency conflict and unauthorized diff are rejected', async () => {
  const { sessions, plan } = setupRepositoryChange();
  await intakeChangePlan(plan, sessions);
  await assert.rejects(intakeChangePlan({ ...plan, exactAfter: 'return a * b;' }, sessions), /idempotency_payload_conflict/);
  await assert.rejects(intakeChangePlan({ ...plan, idempotencyKey: 'idem-bad', allowedFiles: ['README.md'] }, sessions), /target_not_allowed/);
});

test('exact replacement refuses ambiguous source and source repository must remain clean', async () => {
  const { sessions, plan, repo } = setupRepositoryChange();
  writeFileSync(join(repo, 'src/calculator.js'), 'export function add(a,b){ return a - b; return a - b; }');
  await assert.rejects(intakeChangePlan({ ...plan, idempotencyKey: 'dirty' }, sessions), /source_repository_not_clean/);
});

test('untrusted repositories and non-allowlisted local commands are blocked before execution', async () => {
  const { sessions, plan } = setupRepositoryChange();
  await assert.rejects(intakeChangePlan({ ...plan, idempotencyKey: 'untrusted', repositoryTrust: 'untrusted', testExecutionBoundary: 'qualified-isolation-required' }, sessions), /untrusted_repository_requires_qualified_isolation/);
  await assert.rejects(intakeChangePlan({ ...plan, idempotencyKey: 'command', testCommand: ['bash', '-c', 'cat /etc/passwd'] }, sessions), /local_test_command_not_allowlisted/);
});
