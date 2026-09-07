import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { evaluateExecutionLedger } from '../dist/src/validation/execution-ledger-assurance.js';
import { loadGovernanceBundle, validateGovernanceBundle } from '../dist/src/governance/consistency.js';

const root = resolve('.');
const out = resolve(process.env.V32_6_RUN_DIR || (process.env.V32_6_RUN_ID ? join('evidence/runs', process.env.V32_6_RUN_ID) : 'evidence/generated'));
const runId = basename(out);
const identity = JSON.parse(execFileSync('python3', ['scripts/test_ops_context_v32_6.py', '--identity'], { cwd: root, encoding: 'utf8' }));
const read = (name) => JSON.parse(readFileSync(join(out, name), 'utf8'));
const ledger = read('V32_12_EXECUTION_LEDGER.json');
const requiredSteps = [
  { id: 'repository-truth-map', artifacts: ['V32_12_REPOSITORY_TRUTH_MAP.json'] },
  { id: 'clean-build', artifacts: ['V32_12_BUILD_IDENTITY.json'] },
  { id: 'full-regression', artifacts: ['V32_6_FULL_TEST_RESULTS.json'] },
  { id: 'local-assurance-mutation-v32.10', artifacts: ['V32_10_LOCAL_ASSURANCE_MUTATION_RESULTS.json'] },
  { id: 'execution-ledger-mutation-v32.11', artifacts: ['V32_11_EXECUTION_LEDGER_MUTATION_RESULTS.json'] },
  { id: 'external-integrity-mutation-v32.12', artifacts: ['V32_12_EXTERNAL_INTEGRITY_MUTATION_RESULTS.json'] },
  { id: 'coverage', artifacts: ['V32_COVERAGE_REPORT.json'] },
  { id: 'test-quality', artifacts: ['V32_TEST_QUALITY_AUDIT.json'] },
  { id: 'architecture', artifacts: ['V32_ARCHITECTURE_INTEGRITY.json'] },
  { id: 'external-readiness', artifacts: ['V32_12_EXTERNAL_QUALIFICATION_READINESS.json'] },
];
const observations = ledger.steps.flatMap((step) => step.artifacts.map((artifact) => {
  const absolute = resolve(root, artifact.path);
  const bytes = readFileSync(absolute);
  const stat = statSync(absolute);
  return { path: artifact.path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, modifiedAt: stat.mtime.toISOString() };
}));
const ledgerAssurance = evaluateExecutionLedger({
  ledger,
  expectedVersion: '32.12',
  expectedRunId: runId,
  expectedSourceDigest: identity.sourceDigest,
  expectedRunPrefix: `evidence/runs/${runId}`,
  requiredSteps,
  observations,
  now: new Date().toISOString(),
  maximumRunAgeMs: 3_600_000,
});
const governance = validateGovernanceBundle(loadGovernanceBundle(resolve(root, 'governance-state')), root);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const full = read('V32_6_FULL_TEST_RESULTS.json');
const mutation10 = read('V32_10_LOCAL_ASSURANCE_MUTATION_RESULTS.json');
const mutation11 = read('V32_11_EXECUTION_LEDGER_MUTATION_RESULTS.json');
const externalMutation = read('V32_12_EXTERNAL_INTEGRITY_MUTATION_RESULTS.json');
const coverage = read('V32_COVERAGE_REPORT.json');
const quality = read('V32_TEST_QUALITY_AUDIT.json');
const architecture = read('V32_ARCHITECTURE_INTEGRITY.json');
const truth = read('V32_12_REPOSITORY_TRUTH_MAP.json');
const readiness = read('V32_12_EXTERNAL_QUALIFICATION_READINESS.json');
const mutationPass = (report, expected) => report.status === 'passed' && report.mutantsSpecified === expected && report.mutantsKilledAuthentically === expected && report.survivors === 0 && report.invalidKills === 0;
const coverageSummary = coverage.current ?? coverage.coverage?.total ?? coverage.total ?? coverage.summary ?? {};
const coverageField = { lines: 'linePercent', branches: 'branchPercent', functions: 'functionPercent' };
const percentage = (key) => Number(coverageSummary[coverageField[key]] ?? coverageSummary[key]?.pct ?? coverageSummary[key] ?? 0);
const assertions = {
  ledgerFreshAndCoherent: ledgerAssurance.status === 'PASS',
  exactGovernanceLineage: governance.ok && governance.version === '32.12',
  releaseMetadataCurrent: pkg.version === '0.21.0' && /v32\.12/i.test(pkg.description ?? '') && !/v32\.11 release/i.test(pkg.description ?? ''),
  fullRegressionExpanded: full.status === 'passed' && full.failed === 0 && full.tests >= 925,
  localAssuranceMutationsAuthentic: mutationPass(mutation10, 12),
  executionLedgerMutationsAuthentic: mutationPass(mutation11, 9),
  externalIntegrityMutationsAuthentic: mutationPass(externalMutation, 24),
  coverageThresholdsPreserved: coverage.status === 'passed' && percentage('lines') >= 99 && percentage('branches') >= 96 && percentage('functions') >= 98.5,
  testQualityPassed: quality.status === 'passed',
  architecturePassed: architecture.status === 'PASS',
  truthMapPassed: truth.status === 'passed' && truth.inventory?.externalQualificationKits === 6 && truth.boundaries?.sourceIdentityIncludesExternalQualification === true && !truth.findings?.some((finding) => finding.status === 'open'),
  externalReadinessHonest: readiness.status === 'READY' && readiness.gatesReady === 6 && readiness.gatesTotal === 6 && readiness.externalQualification === 'not_executed' && readiness.productionPromotion === 'blocked' && readiness.gates.every((gate) => gate.productionQualified === false),
  productionStillBlocked: governance.bundle?.programState?.executionBoundary?.productionPromotion === 'blocked' || readiness.productionPromotion === 'blocked',
};
const status = Object.values(assertions).every(Boolean) ? 'passed' : 'failed';
const report = {
  version: '32.12', runId, generatedAt: new Date().toISOString(), status,
  classification: 'external-qualification-execution-readiness-and-adversarial-evidence-integrity',
  ...identity,
  assertions,
  ledgerAssurance,
  governanceFindings: governance.findings,
  results: {
    tests: { total: full.tests, passed: full.passed, failed: full.failed, skipped: full.skipped ?? 0 },
    mutations: { localAssurance: 12, executionLedger: 9, externalIntegrity: 24, total: 45 },
    coverage: { lines: percentage('lines'), branches: percentage('branches'), functions: percentage('functions') },
    stepsBound: ledgerAssurance.checkedSteps,
    artifactsBound: ledgerAssurance.checkedArtifacts,
    qualificationKits: readiness.gatesReady,
  },
  readiness: 'External Qualification Ready — Integrated Pilot',
  productionPromotion: 'blocked',
  externalQualification: 'not_executed',
  proofClasses: {
    currentExecution: ['clean build', 'full regression', 'three mutation campaigns', 'coverage', 'test quality', 'architecture', 'repository truth map', 'external readiness'],
    syntheticOnly: ['collector-reviewer-witness fixtures', 'signature chains using test keys', 'negative controls for unavailable external infrastructure'],
    notExecuted: readiness.gates.map((gate) => gate.gateId),
  },
  limitations: [
    'The six external infrastructure, human and independent-auditor qualifications were not executed in this local run.',
    'Synthetic fixtures and dry-runs cannot satisfy production policy.',
    'The local hash-chained replay state detects tampering but cannot by itself prevent a privileged cross-host rollback to an older valid state; an external monotonic witness or equivalently protected monotonic storage remains required.',
    'Production promotion remains blocked until independently governed external evidence is verified and a separate authorized human decision is recorded.',
  ],
};
writeFileSync(join(out, 'V32_12_FINAL_VALIDATION.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (status !== 'passed') process.exit(1);
