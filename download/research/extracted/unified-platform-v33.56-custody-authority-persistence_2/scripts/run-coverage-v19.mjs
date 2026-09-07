import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const testsRoot = resolve('dist/tests');
const excluded = new Set([
  'wasm-capability-runner.test.js',
  'wasm-isolation.test.js',
  'web-server.test.js',
  'linux-isolation.test.js',
  'multiprocess.test.js',
  'web-workflow.test.js',
  'repository-change.test.js',
]);
const files = readdirSync(testsRoot)
  .filter((name) => name.endsWith('.test.js') && !excluded.has(name))
  .sort()
  .map((name) => join(testsRoot, name));

const result = spawnSync('timeout', ['--signal=KILL', '120s', process.execPath, '--test', '--test-concurrency=1', '--test-force-exit', '--experimental-test-coverage', ...files], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  env: { ...process.env, NODE_OPTIONS: '' },
});
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
mkdirSync('evidence/generated', { recursive: true });
writeFileSync('evidence/generated/v19-coverage.log', output);
process.stdout.write(output);
const timedOut = result.status === 124 || result.status === 137 || result.signal === 'SIGKILL';
const metadata = {
  status: result.status === 0 && !timedOut ? 'passed' : timedOut ? 'timed-out' : 'failed',
  scope: 'stable in-process, contract, and local-database test subset',
  includedTestFiles: files.map((file) => file.split('/').at(-1)),
  excludedTestFiles: [...excluded],
  reason: 'Node 22 experimental coverage can retain handles for intentionally terminated workers, HTTP servers, namespaces, and child processes. Correctness for excluded tests is verified by the full sharded suite; this report measures only the stable coverage subset.',
  exitCode: result.status,
  signal: result.signal,
};
writeFileSync('evidence/generated/v19-coverage-scope.json', `${JSON.stringify(metadata, null, 2)}\n`);
if (metadata.status !== 'passed') process.exit(1);
