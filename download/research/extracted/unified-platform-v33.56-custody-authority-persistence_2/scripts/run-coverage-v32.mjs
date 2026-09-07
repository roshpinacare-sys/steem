import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const outputDir = resolve(process.env.V32_6_RUN_DIR || 'evidence/generated');
const testsRoot = resolve('dist/tests');
const excluded = new Set([
  'wasm-capability-runner.test.js','wasm-isolation.test.js','wasm-hardening-v23.test.js','web-server.test.js','linux-isolation.test.js','linux-isolation-v23.test.js','multiprocess.test.js','web-workflow.test.js','private-pilot-server.test.js','private-server-config.test.js','repository-change-intake-v24.test.js','repository-change-execution-v24.test.js','repository-change-review-v24.test.js','repository-change-adversarial-v24.test.js','session-archiver.test.js','replay-ledger-v26.test.js','supply-chain-portability-v26.test.js',
]);
const files = readdirSync(testsRoot).filter((name) => name.endsWith('.test.js') && !excluded.has(name)).sort().map((name) => join(testsRoot, name));
mkdirSync(outputDir, { recursive: true });
const logPath = join(outputDir, 'v32-coverage.log');
const logFd = openSync(logPath, 'w');
const timeoutMs = 240_000;
let timedOut = false;
let signal = null;
let exitCode = null;
const child = spawn(process.execPath, ['--test', '--test-concurrency=3', '--test-reporter=tap', '--experimental-test-coverage', ...files], {
  cwd: process.cwd(),
  detached: process.platform !== 'win32',
  stdio: ['ignore', logFd, logFd],
  env: { ...process.env, NODE_OPTIONS: '', NODE_ENV: 'test', LD_PRELOAD: '' },
});
const killGroup = (name) => {
  signal = name;
  try {
    if (process.platform === 'win32') child.kill(name);
    else process.kill(-child.pid, name);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
};
const timer = setTimeout(() => { timedOut = true; killGroup('SIGTERM'); }, timeoutMs);
timer.unref();
const hardKill = setTimeout(() => { if (timedOut && exitCode === null) killGroup('SIGKILL'); }, timeoutMs + 3_000);
hardKill.unref();
await new Promise((resolveClose, reject) => {
  child.once('error', reject);
  child.once('close', (code, observedSignal) => { exitCode = code; signal = observedSignal ?? signal; resolveClose(); });
});
clearTimeout(timer); clearTimeout(hardKill); closeSync(logFd);
const output = readFileSync(logPath, 'utf8');
process.stdout.write(output);
const metadata = {
  version: '32.17',
  status: exitCode === 0 && !timedOut ? 'passed' : timedOut ? 'timed-out' : 'failed',
  scope: 'stable in-process contracts plus CNCF sovereign convergence, signed component admission, portable contracts, sovereign-efficiency routing, capacity, topology, governance, evidence, trust, artifact and security branch matrices',
  includedTestFiles: files.map((file) => file.split('/').at(-1)),
  excludedTestFiles: [...excluded].sort(),
  reason: 'External process, HTTP, namespace, WebAssembly worker, repository execution, replay multiprocessing and archive subprocess lanes execute in the complete correctness suite but are excluded from Node in-process coverage.',
  exitCode, signal, timedOut, testConcurrency: 3, forceExitDisabled: true,
  outputTransport: 'direct-file-descriptor-with-process-group-lifecycle-and-cancelled-timeouts',
};
writeFileSync(join(outputDir, 'V32_COVERAGE_SCOPE.json'), `${JSON.stringify(metadata, null, 2)}\n`);
if (metadata.status !== 'passed') process.exit(1);
const report = spawnSync(process.execPath, ['scripts/coverage-report-v32.mjs'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: '', NODE_ENV: 'test', V32_6_RUN_DIR: outputDir } });
process.stdout.write(report.stdout ?? ''); process.stderr.write(report.stderr ?? '');
if (report.status !== 0) process.exit(report.status ?? 1);
