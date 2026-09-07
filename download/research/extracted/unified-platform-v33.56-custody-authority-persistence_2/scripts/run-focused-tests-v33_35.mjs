import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve('.');
const out = resolve('release-evidence/v33.35');
mkdirSync(out, { recursive: true });
const files = [
  'dist/tests/controlled-human-ux-pilot-v33_30.test.js',
  'dist/tests/external-human-pilot-evidence-import-v33_31.test.js',
  'dist/tests/federated-human-pilot-checkpoint-v33_32.test.js',
  'dist/tests/federated-checkpoint-continuity-v33_33.test.js',
  'dist/tests/federated-recovery-drill-v33_34.test.js',
  'dist/tests/expired-coordinator-takeover-v33_35.test.js',
];
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, TERM: process.env.TERM || 'dumb' },
  maxBuffer: 32 * 1024 * 1024,
});
const stdout = result.stdout ?? '';
const stderr = result.stderr ?? '';
const number = (name) => Number(stdout.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? -1);
const totals = { tests: number('tests'), passed: number('pass'), failed: number('fail') };
const status = result.status === 0 && totals.tests === 225 && totals.passed === 225 && totals.failed === 0 ? 'passed' : 'failed';
const report = {
  version: '33.35',
  generatedAt: new Date().toISOString(),
  status,
  command: `${process.execPath} --test --test-concurrency=1 ${files.join(' ')}`,
  testFiles: files.length,
  totals,
  retry: false,
  forceExitDisabled: true,
};
writeFileSync(resolve(out, 'V33_35_FOCUSED_TEST_STDOUT.tap'), stdout);
writeFileSync(resolve(out, 'V33_35_FOCUSED_TEST_STDERR.log'), stderr);
writeFileSync(resolve(out, 'V33_35_FOCUSED_TEST_EXIT.txt'), `${result.status ?? -1}\n`);
writeFileSync(resolve(out, 'V33_35_FOCUSED_TEST_RESULTS.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (status !== 'passed') process.exit(1);
