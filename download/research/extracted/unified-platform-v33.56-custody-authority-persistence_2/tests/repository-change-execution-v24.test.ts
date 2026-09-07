import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { executeChangePlan, rollbackChangeSession } from '../src/repository/change-assurance.js';
import { setupRepositoryChange } from './repository-change-fixture-v24.js';

test('governed change produces patch, passing tests, evidence and rollback package', async () => {
  const { sessions, plan } = setupRepositoryChange();
  const state = await executeChangePlan(plan, { sessionsRoot: sessions });
  assert.equal(state.status, 'AWAITING_REVIEW');
  assert.deepEqual(state.changedFiles, ['src/calculator.js']);
  assert.equal(state.testExecution?.passed, true);
  assert.equal(existsSync(join(state.artifactDirectory, 'change.patch')), true);
  assert.equal(existsSync(join(state.artifactDirectory, 'rollback.patch')), true);
  assert.match(readFileSync(join(state.artifactDirectory, 'change.patch'), 'utf8'), /return a \+ b/);
});

test('rollback restores exact base tree', async () => {
  const { sessions, plan } = setupRepositoryChange();
  const state = await executeChangePlan(plan, { sessionsRoot: sessions });
  const rolledBack = rollbackChangeSession(sessions, state.sessionId);
  assert.equal(rolledBack.status, 'ROLLED_BACK');
  assert.match(readFileSync(join(rolledBack.workspace, 'src/calculator.js'), 'utf8'), /return a - b/);
});

test('crash after modification resumes without duplicate modification', async () => {
  const { sessions, plan } = setupRepositoryChange();
  await assert.rejects(executeChangePlan(plan, { sessionsRoot: sessions, injectCrashAfterModification: true }), /injected_crash/);
  const state = await executeChangePlan(plan, { sessionsRoot: sessions });
  assert.equal(state.status, 'AWAITING_REVIEW');
  assert.equal(readFileSync(join(state.workspace, 'src/calculator.js'), 'utf8').split('return a + b;').length - 1, 1);
});

test('crash after tests resumes packaging without rerunning unsafe changes', async () => {
  const { sessions, plan } = setupRepositoryChange();
  await assert.rejects(executeChangePlan(plan, { sessionsRoot: sessions, injectCrashAfterTests: true }), /injected_crash/);
  const state = await executeChangePlan(plan, { sessionsRoot: sessions });
  assert.equal(state.status, 'AWAITING_REVIEW');
  assert.equal(state.testExecution?.passed, true);
});
