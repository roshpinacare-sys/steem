import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve('.');
const out = resolve(process.env.V33_37_RUN_DIR || 'release-evidence/v33.37');
mkdirSync(out, { recursive: true });
const walk = (directory) => existsSync(directory)
  ? readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)])
  : [];
const rel = (path) => relative(root, path).replaceAll('\\', '/');
const sourceFiles = walk(join(root, 'src')).filter((path) => path.endsWith('.ts')).sort();
const testFiles = walk(join(root, 'tests')).filter((path) => path.endsWith('.test.ts')).sort();
const scriptFiles = walk(join(root, 'scripts')).filter((path) => /\.(?:mjs|py|sh)$/.test(path)).sort();
const infraFiles = walk(join(root, 'infra')).sort();
const verifierFiles = walk(join(root, 'verifier-only')).sort();
const benchmarkKitManifests = walk(join(root, 'benchmark-kits')).filter((path) => path.endsWith('/manifest.json')).sort();
const kitManifests = walk(join(root, 'external-qualification/v32.12')).filter((path) => path.endsWith('/manifest.json')).sort();
const governanceFiles = walk(join(root, 'governance-state')).filter((path) => path.endsWith('.json')).sort();
const canonicalGovernanceFiles = ['PROGRAM_STATE.json','NEXT_ACTION.json','OPEN_DECISIONS.json'].map((name) => join(root,'governance-state',name));
const v33GovernanceFiles = walk(join(root,'v33/governance-state')).filter((path) => path.endsWith('.json')).sort();
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const identity = JSON.parse(execFileSync('python3', ['scripts/test_ops_context_v32_6.py', '--identity'], { cwd: root, encoding: 'utf8' }));
const sourceBoundary = readFileSync(join(root, 'scripts/test_ops_context_v32_6.py'), 'utf8');
const serviceMapPath = join(root, 'infra/sovereign-production-v32_13/service-map.json');
const serviceMap = existsSync(serviceMapPath) ? JSON.parse(readFileSync(serviceMapPath, 'utf8')) : { services: [] };
const required = [
  'src/platform/sovereign-control-plane-v32_18.ts',
  'src/app/cncf-gold-mine-extraction-v32_18.ts',
  'verifier-only/v32.18/independent_gold_mine_verifier.py',
  'scripts/cncf-gold-mine-extraction-proof-v32_18.mjs',
  'scripts/run-cncf-gold-mine-mutation-v32_18.py',
  'scripts/validate-v32_18.py',
  'scripts/validate-v32_18.mjs',
  'tests/sovereign-control-plane-v32_18.test.ts',
  'tests/cncf-gold-mine-extraction-v32_18.test.ts',
  'tests/independent-gold-mine-verifier-v32_18.test.ts',
  'tests/v32_18-causal-controls.test.ts',
  'config/sovereign-control-plane-v32_18.json',
  'infra/cncf-sovereign-cell-v32_18/README.md',
  'infra/cncf-sovereign-cell-v32_18/deployment-profile.json',
  'CLAUDE_HANDOFF_v32_18.md',
  'docs/V32_18_CNCF_GOLD_MINE_EXTRACTION.md',
  'src/platform/sovereign-building-blocks-v32_17.ts',
  'src/runtime/portable-building-block-harness-v32_17.ts',
  'src/app/cncf-sovereign-convergence-v32_17.ts',
  'verifier-only/v32.17/independent_cncf_convergence_verifier.py',
  'scripts/cncf-sovereign-convergence-proof-v32_17.mjs',
  'scripts/run-cncf-sovereign-convergence-mutation-v32_17.py',
  'scripts/validate-v32_17.py',
  'scripts/validate-v32_17.mjs',
  'tests/sovereign-building-blocks-v32_17.test.ts',
  'tests/portable-building-block-harness-v32_17.test.ts',
  'tests/cncf-sovereign-convergence-v32_17.test.ts',
  'tests/independent-cncf-verifier-v32_17.test.ts',
  'tests/v32_17-causal-controls.test.ts',
  'config/cncf-sovereign-stack-v32_17.json',
  'infra/cncf-sovereign-cell-v32_17/README.md',
  'infra/cncf-sovereign-cell-v32_17/deployment-profile.json',
  'CLAUDE_HANDOFF_v32_17.md',
  'docs/V32_17_CNCF_SOVEREIGN_CONVERGENCE.md',
  'src/isolation/wasm-runtime-qualification-v32_16.ts',
  'src/benchmark/external-tournament-transport-v32_16.ts',
  'src/qualification/local-process-failover-lab-v32_16.ts',
  'verifier-only/v32.16/independent_runtime_failover_verifier.py',
  'scripts/runtime-external-failover-proof-v32_16.mjs',
  'scripts/run-runtime-external-failover-mutation-v32_16.py',
  'scripts/validate-v32_16.py',
  'scripts/validate-v32_16.mjs',
  'tests/wasm-runtime-qualification-v32_16.test.ts',
  'tests/external-tournament-transport-v32_16.test.ts',
  'tests/local-process-failover-lab-v32_16.test.ts',
  'tests/v32_16-causal-controls.test.ts',
  'CLAUDE_HANDOFF_v32_16.md',
  'docs/V32_16_OBSERVED_RUNTIME_TRANSPORT_FAILOVER.md',
  'src/benchmark/blinded-frontier-tournament-v32_15.ts',
  'src/isolation/proof-carrying-wasm-component-v32_15.ts',
  'src/qualification/multi-host-challenge-v32_15.ts',
  'verifier-only/v32.15/independent_assurance_verifier.py',
  'scripts/frontier-tournament-wasm-proof-v32_15.mjs',
  'scripts/run-frontier-tournament-wasm-mutation-v32_15.py',
  'scripts/validate-v32_15.py',
  'scripts/validate-v32_15.mjs',
  'tests/blinded-frontier-tournament-v32_15.test.ts',
  'tests/proof-carrying-wasm-component-v32_15.test.ts',
  'tests/multi-host-challenge-v32_15.test.ts',
  'tests/independent-assurance-verifier-v32_15.test.ts',
  'tests/v32_15-causal-controls.test.ts',
  'config/frontier-tournament-policy-v32_15.json',
  'config/wasm-component-policy-v32_15.json',
  'benchmark-kits/v32.15/blinded-frontier-tournament/manifest.json',
  'CLAUDE_HANDOFF_v32_15.md',
  'docs/V32_15_BLINDED_FRONTIER_TOURNAMENT_WASM_MULTI_HOST.md',
  'src/ai/frontier-execution-kernel-v32_14.ts',
  'src/binary/proof-carrying-binary-v32_14.ts',
  'src/validation/frontier-comparative-assurance-v32_14.ts',
  'verifier-only/v32.14/independent_binary_verifier.py',
  'scripts/frontier-binary-proof-v32_14.mjs',
  'scripts/run-binary-fuzz-v32_14.mjs',
  'scripts/run-frontier-binary-mutation-v32_14.py',
  'scripts/inspect-binary-v32_14.mjs',
  'tests/frontier-execution-kernel-v32_14.test.ts',
  'tests/proof-carrying-binary-v32_14.test.ts',
  'tests/frontier-comparative-assurance-v32_14.test.ts',
  'tests/independent-binary-verifier-v32_14.test.ts',
  'tests/binary-inspection-cli-v32_14.test.ts',
  'config/binary-inspection-policy-v32_14.json',
  'CLAUDE_HANDOFF_v32_14.md',
  'docs/V32_14_FRONTIER_MODEL_AND_BINARY_INTELLIGENCE.md',
  'src/runtime/sovereign-efficiency-fabric.ts',
  'src/platform/sovereign-service-consolidation-v32_13.ts',
  'src/operations/sovereign-topology-optimizer-v32_13.ts',
  'src/operations/sovereign-capacity-controller-v32_13.ts',
  'scripts/sovereign-efficiency-proof-v32_13.mjs',
  'scripts/run-sovereign-efficiency-mutation-v32_13.py',
  'scripts/plan-sovereign-capacity-v32_13.mjs',
  'scripts/validate-v32_14.py',
  'scripts/validate-v32_14.mjs',
  'tests/sovereign-efficiency-fabric-v32_13.test.ts',
  'tests/sovereign-efficiency-branch-matrix-v32_13.test.ts',
  'tests/sovereign-service-consolidation-v32_13.test.ts',
  'tests/sovereign-topology-optimizer-v32_13.test.ts',
  'tests/sovereign-capacity-controller-v32_13.test.ts',
  'tests/sovereign-capacity-cli-v32_13.test.ts',
  'tests/sovereign-production-kit-v32_13.test.ts',
  'infra/sovereign-production-v32_13/README.md',
  'infra/sovereign-production-v32_13/service-map.json',
  'infra/sovereign-production-v32_13/postgres/001_efficiency_fabric.sql',
  'infra/sovereign-production-v32_13/systemd/sovereign-app.service',
  'infra/sovereign-production-v32_13/systemd/sovereign-capacity-planner.service',
  'infra/sovereign-production-v32_13/systemd/sovereign-capacity-planner.timer',
  'docs/V32_13_SOVEREIGN_EFFICIENCY_FABRIC.md',
  'src/app/external-human-pilot-evidence-import-v33_31.ts',
  'tests/external-human-pilot-evidence-import-v33_31.test.ts',
  'scripts/external-human-pilot-evidence-import-proof-v33_31.mjs',
  'scripts/verify-external-human-pilot-evidence-import-v33_31.mjs',
  'scripts/validate-v33_31.py',
  'scripts/repository-truth-map-v33_31.mjs',
  'CLAUDE_HANDOFF_v33_31.md',
  'docs/V33_31_EXTERNAL_HUMAN_PILOT_EVIDENCE_IMPORT.md',
  'pilot-kits/v33.31/external-human-pilot-import/RUNBOOK.md',
  'src/app/federated-human-pilot-checkpoint-v33_32.ts',
  'tests/federated-human-pilot-checkpoint-v33_32.test.ts',
  'scripts/federated-human-pilot-checkpoint-proof-v33_32.mjs',
  'scripts/verify-federated-human-pilot-checkpoint-v33_32.mjs',
  'scripts/run-full-regression-v33_32.py',
  'scripts/run-direct-v33-regression-v33_32.py',
  'scripts/validate-v33_32.py',
  'scripts/architecture-validation-v33_32.mjs',
  'scripts/repository-truth-map-v33_32.mjs',
  'CLAUDE_HANDOFF_v33_32.md',
  'docs/V33_32_FEDERATED_HUMAN_PILOT_CHECKPOINT.md',
  'pilot-kits/v33.32/federated-human-pilot/manifest.json',
  'pilot-kits/v33.32/federated-human-pilot/RUNBOOK.md',
  'pilot-kits/v33.32/federated-human-pilot/PREFLIGHT_CHECKLIST.md',
  'pilot-kits/v33.32/federated-human-pilot/CONSENT_NOTICE_TEMPLATE.md',
  'pilot-kits/v33.32/federated-human-pilot/WITHDRAWAL_AND_DELETION.md',
  'pilot-kits/v33.32/federated-human-pilot/WITNESS_TOPOLOGY.md',
  'pilot-kits/v33.32/federated-human-pilot/ROLE_ASSIGNMENTS_TEMPLATE.json',
  'src/app/federated-checkpoint-continuity-v33_33.ts',
  'tests/federated-checkpoint-continuity-v33_33.test.ts',
  'scripts/federated-checkpoint-continuity-proof-v33_33.mjs',
  'scripts/verify-federated-checkpoint-continuity-v33_33.mjs',
  'scripts/run-full-regression-v33_34.py',
  'scripts/run-direct-v33-regression-v33_34.py',
  'scripts/validate-v33_34.py',
  'scripts/architecture-validation-v33_34.mjs',
  'scripts/repository-truth-map-v33_34.mjs',
  'CLAUDE_HANDOFF_v33_34.md',
  'docs/V33_33_FEDERATED_CHECKPOINT_CONTINUITY.md',
  'pilot-kits/v33.33/checkpoint-continuity/manifest.json',
  'pilot-kits/v33.33/checkpoint-continuity/RUNBOOK.md',
  'pilot-kits/v33.33/checkpoint-continuity/WITNESS_ROTATION_TEMPLATE.json',
  'pilot-kits/v33.33/checkpoint-continuity/TRANSPARENCY_PINNING.md',
  'src/app/federated-recovery-drill-v33_34.ts',
  'tests/federated-recovery-drill-v33_34.test.ts',
  'scripts/federated-recovery-drill-proof-v33_34.mjs',
  'scripts/verify-federated-recovery-drill-v33_34.mjs',
  'scripts/run-full-regression-v33_34.py',
  'scripts/run-direct-v33-regression-v33_34.py',
  'scripts/validate-v33_34.py',
  'scripts/architecture-validation-v33_34.mjs',
  'scripts/repository-truth-map-v33_34.mjs',
  'CLAUDE_HANDOFF_v33_34.md',
  'docs/V33_34_FEDERATED_RECOVERY_DRILL.md',
  'pilot-kits/v33.34/federated-recovery-drill/manifest.json',
  'pilot-kits/v33.34/federated-recovery-drill/RUNBOOK.md',
  'pilot-kits/v33.34/federated-recovery-drill/RECOVERY_CEREMONY_CHECKLIST.md',
  'src/app/expired-coordinator-takeover-v33_35.ts',
  'src/app/external-https-monitor-qualification-v33_36.ts',
  'tests/external-https-monitor-qualification-v33_36.test.ts',
  'scripts/external-https-monitor-qualification-proof-v33_36.mjs',
  'scripts/verify-external-https-monitor-qualification-v33_36.mjs',
  'scripts/v33_36-https-publication-server.mjs',
  'scripts/v33_36-monitor-worker.mjs',
  'docs/V33_36_EXTERNAL_HTTPS_MONITOR_QUALIFICATION.md',
  'CLAUDE_HANDOFF_v33_36.md',
  'src/app/external-qualification-deployment-import-v33_37.ts',
  'tests/external-qualification-deployment-import-v33_37.test.ts',
  'scripts/external-qualification-deployment-import-proof-v33_37.mjs',
  'scripts/verify-external-qualification-deployment-import-v33_37.mjs',
  'scripts/run-focused-tests-v33_37.mjs',
  'scripts/run-full-regression-v33_37.py',
  'scripts/run-direct-v33-regression-v33_37.py',
  'scripts/repository-truth-map-v33_37.mjs',
  'scripts/architecture-validation-v33_37.mjs',
  'scripts/validate-v33_37.py',
  'docs/V33_37_EXTERNAL_QUALIFICATION_DEPLOYMENT_IMPORT.md',
  'CLAUDE_HANDOFF_v33_37.md',
  'pilot-kits/v33.37/external-qualification-deployment-import/manifest.json',
  'pilot-kits/v33.37/external-qualification-deployment-import/RUNBOOK.md',
  'pilot-kits/v33.37/external-qualification-deployment-import/EXTERNAL_EXECUTION_CHECKLIST.md',
  'tests/expired-coordinator-takeover-v33_35.test.ts',
  'scripts/expired-coordinator-takeover-proof-v33_35.mjs',
  'scripts/verify-expired-coordinator-takeover-v33_35.mjs',
  'scripts/v33_35-publication-server.mjs',
  'scripts/v33_35-monitor-worker.mjs',
  'scripts/run-full-regression-v33_35.py',
  'scripts/run-direct-v33-regression-v33_35.py',
  'scripts/validate-v33_35.py',
  'scripts/architecture-validation-v33_35.mjs',
  'scripts/repository-truth-map-v33_35.mjs',
  'CLAUDE_HANDOFF_v33_35.md',
  'docs/V33_35_EXPIRED_COORDINATOR_TAKEOVER.md',
  'pilot-kits/v33.35/expired-coordinator-takeover/manifest.json',
  'pilot-kits/v33.35/expired-coordinator-takeover/RUNBOOK.md',
  'pilot-kits/v33.35/expired-coordinator-takeover/EXPIRY_TAKEOVER_CHECKLIST.md',
];
const findings = [];
for (const path of required) if (!existsSync(join(root, path))) findings.push({ severity: 'critical', code: 'REQUIRED_V33_35_COMPONENT_MISSING', status: 'open', path });
if (packageJson.version !== '0.28.0' || !/v33\.37/i.test(packageJson.description ?? '')) findings.push({ severity: 'critical', code: 'PACKAGE_VERSION_DRIFT', status: 'open' });
if (lock.version !== packageJson.version || lock.packages?.['']?.version !== packageJson.version) findings.push({ severity: 'critical', code: 'LOCKFILE_VERSION_DRIFT', status: 'open' });
if (!sourceBoundary.includes("'verifier-only'")) findings.push({ severity: 'critical', code: 'INDEPENDENT_VERIFIER_OUTSIDE_SOURCE_IDENTITY', status: 'open' });
if (!sourceBoundary.includes("'infra'") || !sourceBoundary.includes("'external-qualification'") || !sourceBoundary.includes("'benchmark-kits'") || !sourceBoundary.includes("glob('CLAUDE_HANDOFF_v*.md')")) findings.push({ severity: 'critical', code: 'TRUSTED_SOURCE_BOUNDARY_INCOMPLETE', status: 'open' });
if (benchmarkKitManifests.length < 1) findings.push({ severity: 'critical', code: 'BENCHMARK_KIT_COUNT_DRIFT', status: 'open', observed: benchmarkKitManifests.length });
if (kitManifests.length !== 6) findings.push({ severity: 'critical', code: 'EXTERNAL_KIT_COUNT_DRIFT', status: 'open', observed: kitManifests.length });
if (canonicalGovernanceFiles.some((path) => JSON.parse(readFileSync(path, 'utf8')).version !== '33.37')) findings.push({ severity: 'critical', code: 'CANONICAL_GOVERNANCE_VERSION_DRIFT', status: 'open' });
if (v33GovernanceFiles.some((path) => JSON.parse(readFileSync(path, 'utf8')).version !== '33.37')) findings.push({ severity: 'critical', code: 'V33_REGISTRY_VERSION_DRIFT', status: 'open' });
const serviceRows = [
  ...(Array.isArray(serviceMap.nativeServices) ? serviceMap.nativeServices.map((service) => ({ serviceId: service.service, disposition: 'NATIVE', sourcePaths: service.implementation?.startsWith('src/') ? [service.implementation] : [] })) : []),
  ...(Array.isArray(serviceMap.selfHostedStandards) ? serviceMap.selfHostedStandards.map((service) => ({ serviceId: service.service, disposition: 'SELF_HOSTED_STANDARD', sourcePaths: [] })) : []),
];
for (const service of serviceRows) {
  const paths = [...(service.sourcePaths ?? []), ...(service.testPaths ?? []), ...(service.deploymentPaths ?? [])];
  for (const path of paths) if (!existsSync(join(root, path))) findings.push({ severity: 'critical', code: 'SERVICE_MAP_PATH_MISSING', status: 'open', serviceId: service.serviceId, path });
}
const boundaryText = (serviceMap.unavoidableExternalBoundaries ?? []).join(' ').toLowerCase();
const externalBoundaryIds = new Set([
  ...(boundaryText.includes('email') ? ['email'] : []),
  ...(boundaryText.includes('sms') ? ['sms'] : []),
  ...(boundaryText.includes('payment') ? ['payments'] : []),
  ...(boundaryText.includes('edge') ? ['global-edge'] : []),
]);
for (const requiredBoundary of ['email', 'sms', 'payments', 'global-edge']) if (!externalBoundaryIds.has(requiredBoundary)) findings.push({ severity: 'high', code: 'UNAVOIDABLE_EXTERNAL_BOUNDARY_HIDDEN', status: 'open', serviceId: requiredBoundary });
const material = {
  version: '33.37',
  generatedAt: new Date().toISOString(),
  status: findings.some((finding) => finding.status === 'open') ? 'failed' : 'passed',
  identity,
  inventory: {
    sourceModules: sourceFiles.length,
    testFiles: testFiles.length,
    scripts: scriptFiles.length,
    packageScripts: Object.keys(packageJson.scripts || {}).length,
    governanceFiles: governanceFiles.length,
    externalQualificationKits: kitManifests.length,
    frontierBenchmarkKits: benchmarkKitManifests.length,
    sovereignInfraFiles: infraFiles.length,
    independentVerifierFiles: verifierFiles.length,
    sovereignServices: serviceRows.length,
  },
  boundaries: {
    sourceIdentityIncludesInfra: sourceBoundary.includes("'infra'"),
    sourceIdentityIncludesExternalQualification: sourceBoundary.includes("'external-qualification'"),
    sourceIdentityIncludesBenchmarkKits: sourceBoundary.includes("'benchmark-kits'"),
    sourceIdentityDiscoversVersionedHandoffs: sourceBoundary.includes("glob('CLAUDE_HANDOFF_v*.md')"),
    externalNetworkBoundariesExplicit: [...externalBoundaryIds].sort(),
    productionPromotion: 'blocked',
  },
  serviceMap: serviceRows,
  findings,
  files: { source: sourceFiles.map(rel), tests: testFiles.map(rel), scripts: scriptFiles.map(rel), sovereignInfra: infraFiles.map(rel), independentVerifier: verifierFiles.map(rel), qualificationKits: kitManifests.map(rel), benchmarkKits: benchmarkKitManifests.map(rel) },
};
material.reportDigest = createHash('sha256').update(JSON.stringify(material)).digest('hex');
writeFileSync(join(out, 'V33_37_REPOSITORY_TRUTH_MAP.json'), `${JSON.stringify(material, null, 2)}\n`);
console.log(JSON.stringify({ status: material.status, inventory: material.inventory, boundaries: material.boundaries, findings: material.findings }, null, 2));
if (material.status !== 'passed') process.exit(1);
