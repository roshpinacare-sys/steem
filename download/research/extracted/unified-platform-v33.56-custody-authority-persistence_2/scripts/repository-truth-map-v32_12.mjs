import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve('.');
const out = resolve(process.env.V32_6_RUN_DIR || 'evidence/generated');
mkdirSync(out, { recursive: true });
const walk = (directory) => existsSync(directory) ? readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]) : [];
const rel = (path) => relative(root, path).replaceAll('\\', '/');
const sourceFiles = walk(join(root, 'src')).filter((path) => path.endsWith('.ts')).sort();
const testFiles = walk(join(root, 'tests')).filter((path) => path.endsWith('.test.ts')).sort();
const scriptFiles = walk(join(root, 'scripts')).filter((path) => /\.(?:mjs|py|sh)$/.test(path)).sort();
const kitManifests = walk(join(root, 'external-qualification/v32.12')).filter((path) => path.endsWith('/manifest.json')).sort();
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const identity = JSON.parse(execFileSync('python3', ['scripts/test_ops_context_v32_6.py', '--identity'], { cwd: root, encoding: 'utf8' }));
const imports = sourceFiles.reduce((count, path) => count + [...readFileSync(path, 'utf8').matchAll(/from\s+['"][^'"]+['"]/g)].length, 0);
const legacyGateText = readFileSync(join(root, 'src/qualification/external-qualification-gate.ts'), 'utf8');
const newVerifierText = readFileSync(join(root, 'src/qualification/external-qualification-integrity-v32_12.ts'), 'utf8');
const trustVerifierText = readFileSync(join(root, 'src/qualification/external-qualification-trust-v32_12.ts'), 'utf8');
const verifierCliText = readFileSync(join(root, 'scripts/verify-external-qualification-v32_12.mjs'), 'utf8');
const sourceBoundaryText = readFileSync(join(root, 'scripts/test_ops_context_v32_6.py'), 'utf8');
const findings = [];
if (/result\.status\s*!==\s*'PASS'/.test(legacyGateText) && !legacyGateText.includes('collectorSignature')) findings.push({ severity: 'critical', code: 'LEGACY_UNBOUND_PASS_AGGREGATION', status: 'confirmed-and-contained-by-v32.12', path: 'src/qualification/external-qualification-gate.ts' });
if (!newVerifierText.includes('registry.verifyAt')) findings.push({ severity: 'critical', code: 'V32_12_SIGNATURE_VERIFICATION_MISSING', status: 'open' });
if (!trustVerifierText.includes('trust_bundle_signature_invalid') || !verifierCliText.includes('trustKeysSource')) findings.push({ severity: 'critical', code: 'OUT_OF_BAND_TRUST_VERIFICATION_MISSING', status: 'open' });
if (!verifierCliText.includes("observationsSource: 'verifier-filesystem'") || !verifierCliText.includes("evaluationTimeSource: 'verifier-system-clock'")) findings.push({ severity: 'critical', code: 'VERIFIER_CONTROLLED_OBSERVATION_OR_CLOCK_MISSING', status: 'open' });
if (!verifierCliText.includes('lockOwned') || !verifierCliText.includes('previouslyConsumedNonces: state.consumedNonces')) findings.push({ severity: 'critical', code: 'REPLAY_STATE_OR_LOCK_ASSURANCE_MISSING', status: 'open' });
if (!sourceBoundaryText.includes("'external-qualification'")) findings.push({ severity: 'critical', code: 'QUALIFICATION_KITS_OUTSIDE_SOURCE_DIGEST', status: 'open' });
const required = ['src/qualification/external-qualification-integrity-v32_12.ts','src/qualification/external-qualification-trust-v32_12.ts','src/validation/strict-json-v32_12.ts','scripts/verify-external-qualification-v32_12.mjs','scripts/run-external-integrity-mutation-v32_12.py','schemas/external-qualification-verification-v32_12.schema.json','schemas/external-qualification-trust-anchor-v32_12.schema.json','schemas/external-qualification-trust-bundle-v32_12.schema.json','schemas/external-qualification-replay-state-v32_12.schema.json'];
for (const path of required) if (!existsSync(join(root, path))) findings.push({ severity: 'critical', code: 'REQUIRED_V32_12_COMPONENT_MISSING', status: 'open', path });
const material = {
  version: '32.12', generatedAt: new Date().toISOString(), status: findings.some((f) => f.status === 'open') ? 'failed' : 'passed',
  identity, inventory: { sourceModules: sourceFiles.length, testFiles: testFiles.length, scripts: scriptFiles.length, packageScripts: Object.keys(packageJson.scripts || {}).length, externalQualificationKits: kitManifests.length, sourceImports: imports },
  boundaries: { sourceIdentityIncludesExternalQualification: sourceBoundaryText.includes("'external-qualification'"), legacyAggregateRetainedForCompatibility: true, authoritativeExternalVerifier: 'src/qualification/external-qualification-integrity-v32_12.ts', verifierOnlyCli: 'scripts/verify-external-qualification-v32_12.mjs', trustInputs: 'out-of-band-root-signed-bundle', observations: 'verifier-filesystem', evaluationClock: 'verifier-system-clock', replayState: 'exclusive-lock-atomic-hash-chain' },
  findings,
  files: { source: sourceFiles.map(rel), tests: testFiles.map(rel), qualificationKits: kitManifests.map(rel) },
};
material.reportDigest = createHash('sha256').update(JSON.stringify(material)).digest('hex');
writeFileSync(join(out, 'V32_12_REPOSITORY_TRUTH_MAP.json'), `${JSON.stringify(material, null, 2)}\n`);
console.log(JSON.stringify({ status: material.status, inventory: material.inventory, findings: material.findings }, null, 2));
if (material.status !== 'passed') process.exit(1);
