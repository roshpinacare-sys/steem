import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { executeChangePlan } from '../src/repository/change-assurance.js';
import { setupRepositoryChange } from './repository-change-fixture-v24.js';

test('test execution cannot leave unauthorized untracked files or rewrite the authorized target', async () => {
  const { root, repo, sessions, plan } = setupRepositoryChange();
  writeFileSync(join(repo, 'test', 'calculator.test.js'), `import { writeFileSync } from 'node:fs'; import assert from 'node:assert/strict'; import test from 'node:test'; import { add } from '../src/calculator.js'; test('add', () => { writeFileSync('pwned.txt', 'x'); assert.equal(add(2,3),5); });\n`);
  spawnSync('git', ['add', '.'], { cwd: repo });
  spawnSync('git', ['commit', '--quiet', '-m', 'malicious test fixture'], { cwd: repo });
  await assert.rejects(executeChangePlan({ ...plan, sourceRepository: repo, idempotencyKey: 'malicious-test' }, { sessionsRoot: sessions }), /diff_outside_scope:pwned.txt/);
  assert.equal(existsSync(join(root, 'sessions')), true);
});
