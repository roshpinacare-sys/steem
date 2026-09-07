import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const names = [
  'controlled-human-ux-pilot-v33_30.test.js',
  'external-human-pilot-evidence-import-v33_31.test.js',
  'federated-human-pilot-checkpoint-v33_32.test.js',
  'federated-checkpoint-continuity-v33_33.test.js',
  'federated-recovery-drill-v33_34.test.js',
  'expired-coordinator-takeover-v33_35.test.js',
  'external-https-monitor-qualification-v33_36.test.js',
  'external-qualification-deployment-import-v33_37.test.js',
  'external-qualification-custody-ceremony-v33_38.test.js',
  'external-custody-hsm-threshold-recovery-v33_39.test.js',
  'hsm-interoperability-remote-attestation-v33_40.test.js',
  'external-provider-onboarding-conformance-v33_41.test.js',
  'hermetic-dependency-capsule-v33_42.test.js',
  'dependency-capsule-lifecycle-v33_43.test.js',
  'dependency-update-planner-v33_44.test.js',
  'multi-package-update-transaction-v33_45.test.js',
  'durable-transaction-coordinator-v33_46.test.js',
  'external-coordinator-journal-qualification-v33_47.test.js',
  'external-coordinator-deployment-evidence-import-v33_48.test.js',
  'external-ceremony-executor-v33_49.test.js',
  'ceremony-evidence-intake-portal-v33_50.test.js',
  'evidence-intake-operations-plane-v33_51.test.js',
];
const files = names.map((name) => `dist/tests/${name}`);
const marker = (text, name) => {
  const match = text.match(new RegExp(`^# ${name} (\\d+)\\s*$`, 'm'));
  return match ? Number(match[1]) : null;
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

let combinedOut = '';
let combinedErr = '';
const rows = [];
for (const file of files) {
  const args = ['--test', '--test-concurrency=1', '--test-reporter=tap', file];
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  combinedOut += `\n# --- isolated focused file: ${file} ---\n${stdout}`;
  combinedErr += `\n# --- isolated focused file: ${file} ---\n${stderr}`;
  rows.push({
    file,
    exitCode: result.status ?? 1,
    tests: marker(stdout, 'tests'),
    passed: marker(stdout, 'pass'),
    failed: marker(stdout, 'fail'),
    durationMs: Date.now() - started,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
  });
}

const totals = {
  tests: rows.reduce((sum, row) => sum + (row.tests ?? 0), 0),
  passed: rows.reduce((sum, row) => sum + (row.passed ?? 0), 0),
  failed: rows.reduce((sum, row) => sum + (row.failed ?? 0), 0),
};
const valid = rows.length === files.length
  && rows.every((row) => row.exitCode === 0 && row.failed === 0 && row.tests === row.passed)
  && totals.tests === totals.passed
  && totals.failed === 0;

const outDir = 'release-evidence/v33.51';
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/V33_51_FOCUSED_TEST_STDOUT.tap`, combinedOut);
writeFileSync(`${outDir}/V33_51_FOCUSED_TEST_STDERR.log`, combinedErr);
const receipt = {
  version: '33.51',
  generatedAt: new Date().toISOString(),
  status: valid ? 'passed' : 'failed',
  runner: 'one-node-process-per-focused-test-file-sequential-no-retry',
  command: `${process.execPath} --test --test-concurrency=1 --test-reporter=tap <one file per process>`,
  testFiles: files.length,
  totals,
  retry: false,
  forceExitDisabled: true,
  isolatedProcessPerFile: true,
  stdoutSha256: sha256(combinedOut),
  stderrSha256: sha256(combinedErr),
  files: rows,
};
writeFileSync(`${outDir}/V33_51_FOCUSED_TEST_RECEIPT.json`, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
if (!valid) process.exit(1);
