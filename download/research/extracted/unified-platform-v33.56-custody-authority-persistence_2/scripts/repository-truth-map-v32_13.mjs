import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve('.');
const out = resolve(process.env.V32_6_RUN_DIR || 'evidence/generated');
mkdirSync(out, { recursive: true });
const walk = (directory) => existsSync(directory)
  ? readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)])
  : [];
const rel = (path) => relative(root, path).replaceAll('\\', '/');
const sourceFiles = walk(join(root, 'src')).filter((path) => path.endsWith('.ts')).sort();
const testFiles = walk(join(root, 'tests')).filter((path) => path.endsWith('.test.ts')).sort();
const scriptFiles = walk(join(root, 'scripts')).filter((path) => /\.(?:mjs|py|sh)$/.test(path)).sort();
const infraFiles = walk(join(root, 'infra/sovereign-production-v32_13')).sort();
const kitManifests = walk(join(root, 'external-qualification/v32.12')).filter((path) => path.endsWith('/manifest.json')).sort();
const governanceFiles = walk(join(root, 'governance-state')).filter((path) => path.endsWith('.json')).sort();
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const identity = JSON.parse(execFileSync('python3', ['scripts/test_ops_context_v32_6.py', '--identity'], { cwd: root, encoding: 'utf8' }));
const sourceBoundary = readFileSync(join(root, 'scripts/test_ops_context_v32_6.py'), 'utf8');
const serviceMapPath = join(root, 'infra/sovereign-production-v32_13/service-map.json');
const serviceMap = existsSync(serviceMapPath) ? JSON.parse(readFileSync(serviceMapPath, 'utf8')) : { services: [] };
const required = [
  'src/runtime/sovereign-efficiency-fabric.ts',
  'src/platform/sovereign-service-consolidation-v32_13.ts',
  'src/operations/sovereign-topology-optimizer-v32_13.ts',
  'src/operations/sovereign-capacity-controller-v32_13.ts',
  'scripts/sovereign-efficiency-proof-v32_13.mjs',
  'scripts/run-sovereign-efficiency-mutation-v32_13.py',
  'scripts/plan-sovereign-capacity-v32_13.mjs',
  'scripts/validate-v32_13.py',
  'scripts/validate-v32_13.mjs',
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
  'CLAUDE_HANDOFF_v32_13.md',
  'docs/V32_13_SOVEREIGN_EFFICIENCY_FABRIC.md',
];
const findings = [];
for (const path of required) if (!existsSync(join(root, path))) findings.push({ severity: 'critical', code: 'REQUIRED_V32_13_COMPONENT_MISSING', status: 'open', path });
if (packageJson.version !== '0.22.0' || !/v32\.13/i.test(packageJson.description ?? '')) findings.push({ severity: 'critical', code: 'PACKAGE_VERSION_DRIFT', status: 'open' });
if (lock.version !== packageJson.version || lock.packages?.['']?.version !== packageJson.version) findings.push({ severity: 'critical', code: 'LOCKFILE_VERSION_DRIFT', status: 'open' });
if (!sourceBoundary.includes("'infra'") || !sourceBoundary.includes("'external-qualification'") || !sourceBoundary.includes("glob('CLAUDE_HANDOFF_v*.md')")) findings.push({ severity: 'critical', code: 'TRUSTED_SOURCE_BOUNDARY_INCOMPLETE', status: 'open' });
if (kitManifests.length !== 6) findings.push({ severity: 'critical', code: 'EXTERNAL_KIT_COUNT_DRIFT', status: 'open', observed: kitManifests.length });
if (governanceFiles.some((path) => JSON.parse(readFileSync(path, 'utf8')).version !== '32.13')) findings.push({ severity: 'critical', code: 'GOVERNANCE_VERSION_DRIFT', status: 'open' });
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
  version: '32.13',
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
    sovereignInfraFiles: infraFiles.length,
    sovereignServices: serviceRows.length,
  },
  boundaries: {
    sourceIdentityIncludesInfra: sourceBoundary.includes("'infra'"),
    sourceIdentityIncludesExternalQualification: sourceBoundary.includes("'external-qualification'"),
    sourceIdentityDiscoversVersionedHandoffs: sourceBoundary.includes("glob('CLAUDE_HANDOFF_v*.md')"),
    externalNetworkBoundariesExplicit: [...externalBoundaryIds].sort(),
    productionPromotion: 'blocked',
  },
  serviceMap: serviceRows,
  findings,
  files: { source: sourceFiles.map(rel), tests: testFiles.map(rel), scripts: scriptFiles.map(rel), sovereignInfra: infraFiles.map(rel), qualificationKits: kitManifests.map(rel) },
};
material.reportDigest = createHash('sha256').update(JSON.stringify(material)).digest('hex');
writeFileSync(join(out, 'V32_13_REPOSITORY_TRUTH_MAP.json'), `${JSON.stringify(material, null, 2)}\n`);
console.log(JSON.stringify({ status: material.status, inventory: material.inventory, boundaries: material.boundaries, findings: material.findings }, null, 2));
if (material.status !== 'passed') process.exit(1);
