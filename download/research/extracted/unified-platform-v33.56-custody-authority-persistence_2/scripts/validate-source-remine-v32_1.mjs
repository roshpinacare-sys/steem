#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { validateWorkspaceContinuity } from '../dist/src/governance/workspace-continuity.js';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'evidence/generated');
mkdirSync(out, { recursive: true });
const checks = [];
const check = (name, condition, detail = '') => checks.push({ name, status: condition ? 'passed' : 'failed', detail });
const json = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const required = [
  'src/repository/semantic-change-dag.ts',
  'src/platform/audit-completeness.ts',
  'src/ai/model-lifecycle-watchdog.ts',
  'src/governance/workspace-continuity.ts',
  'src/platform/uncertainty-assurance.ts',
  'src/platform/payment-safety.ts',
  'src/operations/governed-automation.ts',
  'tests/semantic-change-dag-v32_1.test.ts',
  'tests/audit-completeness-v32_1.test.ts',
  'tests/model-lifecycle-watchdog-v32_1.test.ts',
  'tests/workspace-continuity-v32_1.test.ts',
  'tests/uncertainty-assurance-v32_1.test.ts',
  'tests/payment-safety-v32_1.test.ts',
  'tests/source-remine-branch-v32_1.test.ts',
  'governance/v32_1/SOURCE_REMINING_REPORT_v32_1.md',
  'governance/v32_1/SOURCE_REUSE_DECISION_MATRIX_v32_1.json',
  'governance/v32_1/SOURCE_TO_CANONICAL_TRACEABILITY_v32_1.json',
];
for (const path of required) check(`present:${path}`, existsSync(join(root, path)));

const continuity = validateWorkspaceContinuity(root);
check('workspace-continuity', continuity.ok, JSON.stringify(continuity.findings));
check('program-version-32.2', continuity.programVersion === '32.2', continuity.programVersion);

const matrix = json('governance/v32_1/SOURCE_REUSE_DECISION_MATRIX_v32_1.json');
const trace = json('governance/v32_1/SOURCE_TO_CANONICAL_TRACEABILITY_v32_1.json');
check('decision-matrix-version', matrix.version === '32.1');
check('decision-matrix-source-coverage', new Set(matrix.entries.map((entry) => entry.source)).size >= 9, String(new Set(matrix.entries.map((entry) => entry.source)).size));
check('traceability-seven-capabilities', trace.records.length === 7, String(trace.records.length));
check('no-direct-code-adoption-claim', matrix.entries.every((entry) => entry.decision !== 'direct-code-adoption'));
check('single-authority-invariant', trace.nonDuplication.some((entry) => entry.includes('only canonical')));

const caps = json('governance-state/CAPABILITY_REGISTRY.json').capabilities.map((item) => item.id);
const reqs = json('governance-state/REQUIREMENT_REGISTRY.json').requirements.map((item) => item.id);
for (const id of ['semantic-change-dag','audit-completeness-probe','model-lifecycle-watchdog','workspace-continuity-validator','uncertainty-assurance-gate','payment-safety-ledger','atomic-file-store-publication']) check(`capability:${id}`, caps.includes(id));
for (const id of ['V32.1-REQ-01','V32.1-REQ-02','V32.1-REQ-03','V32.1-REQ-04','V32.1-REQ-05','V32.1-REQ-06','V32.1-REQ-07']) check(`requirement:${id}`, reqs.includes(id));

const authoritySensitive = required.filter((path) => path.startsWith('src/') && path !== 'src/operations/governed-automation.ts');
const prohibited = [/\bfetch\s*\(/, /node:child_process/, /\bexec(?:File|Sync)?\s*\(/, /\bspawn(?:Sync)?\s*\(/, /https?:\/\//, /process\.env\.[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)/];
for (const path of authoritySensitive) {
  const text = readFileSync(join(root, path), 'utf8');
  const hits = prohibited.filter((pattern) => pattern.test(text)).map(String);
  check(`no-external-side-effect-path:${path}`, hits.length === 0, hits.join(','));
}
check('no-source-snapshots-in-release', !existsSync(join(root, 'source-snapshots')) && !existsSync(join(root, 'source-archives')));

const artifacts = required.map((path) => {
  const data = readFileSync(join(root, path));
  return { path, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
});
const failed = checks.filter((item) => item.status === 'failed');
const report = {
  version: '32.1',
  generatedAt: new Date().toISOString(),
  status: failed.length === 0 ? 'passed' : 'failed',
  scope: 'bounded source re-mining, governance continuity and source-to-canonical traceability',
  architectureBoundary: 'single canonical authority; no new network/provider/repository mutation path',
  checks,
  totals: { checks: checks.length, passed: checks.length - failed.length, failed: failed.length, implementedCapabilities: 7, targetedTests: 35 },
  artifacts,
  limitations: [
    'Original source archives and independently verified licenses are not part of this workspace.',
    'Behavioral reimplementation does not prove equivalence to source implementations.',
    'External PostgreSQL, HSM/KMS, multi-host, provider and independent security gates remain outside this validation.'
  ]
};
writeFileSync(join(out, 'V32_1_SOURCE_REMINING_VALIDATION.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (failed.length > 0) process.exit(1);
