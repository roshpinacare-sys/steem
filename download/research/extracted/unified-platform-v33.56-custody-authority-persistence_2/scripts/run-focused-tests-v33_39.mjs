import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const files = [
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
].map((name) => `dist/tests/${name}`);
const args = ['--test', '--test-concurrency=1', ...files];
const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
const match = (result.stdout ?? '').match(/# tests (\d+)[\s\S]*# pass (\d+)[\s\S]*# fail (\d+)/);
const totals = match ? { tests: Number(match[1]), passed: Number(match[2]), failed: Number(match[3]) } : { tests: 0, passed: 0, failed: result.status === 0 ? 0 : 1 };
const receipt = { version: '33.39', generatedAt: new Date().toISOString(), status: result.status === 0 ? 'passed' : 'failed', command: `${process.execPath} ${args.join(' ')}`, testFiles: files.length, totals, retry: false, forceExitDisabled: true };
mkdirSync('release-evidence/v33.39', { recursive: true });
writeFileSync('release-evidence/v33.39/V33_39_FOCUSED_TEST_RECEIPT.json', JSON.stringify(receipt, null, 2) + '\n');
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(JSON.stringify(receipt, null, 2));
