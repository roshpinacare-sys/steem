import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';

const args = process.argv.slice(2);
function arg(name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
  return resolve(args[index + 1]);
}
const zipPath = arg('--zip');
const evidencePath = arg('--evidence');
const outPath = arg('--out');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const zipHash = sha256(readFileSync(zipPath));
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
const temp = mkdtempSync(join(tmpdir(), 'titai-v16-verifier-'));
let manifestVerification;
try {
  execFileSync('unzip', ['-q', zipPath, '-d', temp], { stdio: 'pipe' });
  const manifestPath = join(temp, 'docs/roast/RELEASE_MANIFEST.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entries = manifest.files ?? manifest.entries ?? [];
  const failures = [];
  for (const entry of entries) {
    const rel = entry.path ?? entry.file;
    const expected = entry.sha256;
    const filePath = join(temp, rel);
    try {
      const actual = sha256(readFileSync(filePath));
      if (actual !== expected) failures.push({ path: rel, expected, actual });
    } catch (error) {
      failures.push({ path: rel, error: String(error) });
    }
  }
  manifestVerification = { passed: failures.length === 0, entries: entries.length, failures };
} finally {
  rmSync(temp, { recursive: true, force: true });
}

const mandatory = [
  'realLocalModelBenchmark',
  'cleanOfflineInstall',
  'processNetworkEvidence',
  'operatingSystemKeyCustody',
  'browserAccessibility',
  'multiNodeExecution',
  'hardwareEnergyMeasurement',
  'fullSuiteCleanExit',
  'productionBuild',
];
const blockers = [];
for (const id of mandatory) {
  const gate = evidence.gates?.[id];
  if (!gate || gate.status !== 'passed') blockers.push({ id, status: gate?.status ?? 'missing', reason: gate?.reason ?? 'mandatory evidence not passed' });
}
if (!manifestVerification.passed) blockers.push({ id: 'zipManifestIntegrity', status: 'failed', reason: 'release manifest mismatch' });

const decision = {
  schemaVersion: 1,
  project: 'TITAI',
  release: 'v16-operational-sovereignty',
  verifierRole: 'independent-release-verifier',
  verifierExecution: 'separate-process-evidence-only',
  generatedAt: new Date().toISOString(),
  finalZipSha256: zipHash,
  evidenceSha256: sha256(readFileSync(evidencePath)),
  manifestVerification,
  decision: blockers.length === 0 ? 'ACCEPTED' : 'REJECTED',
  sovereigntyClassification: blockers.length === 0 ? 'SOVEREIGN CONTROLLED PILOT' : 'SOVEREIGN DEVELOPMENT MODE',
  standardClassification: blockers.length === 0 ? 'CONTROLLED INTERNAL PILOT' : 'DEVELOPMENT ONLY',
  blockers,
  limitations: evidence.limitations ?? [],
};
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const canonical = Buffer.from(JSON.stringify(decision));
const signature = sign(null, canonical, privateKey).toString('base64');
const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
const result = {
  ...decision,
  verifierIdentity: `v16-verifier-${sha256(publicKeyDer).slice(0, 16)}`,
  signatureAlgorithm: 'Ed25519',
  publicKeySpkiBase64: publicKeyDer.toString('base64'),
  signatureBase64: signature,
};
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outPath, decision: result.decision, blockers: blockers.length, finalZipSha256: zipHash }, null, 2));
process.exit(blockers.length === 0 ? 0 : 2);
