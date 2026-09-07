import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { KeyRegistry } from '../dist/src/contracts/crypto.js';
import { verifyDeploymentReadinessV33_37, verifyExternalQualificationEvidenceImportV33_37 } from '../dist/src/app/external-qualification-deployment-import-v33_37.js';
const input = resolve(process.argv[2] ?? 'release-evidence/v33.37/V33_37_EXTERNAL_DEPLOYMENT_IMPORT_PROOF.json');
const output = resolve(process.argv[3] ?? 'release-evidence/v33.37/V33_37_INDEPENDENT_VERIFICATION.json');
const proof = JSON.parse(readFileSync(input, 'utf8'));
const registry = (rows) => { const result = new KeyRegistry(); for (const row of rows) result.registerExported(row); return result; };
const roleRegistry = registry(proof.keys.roles);
const byId = new Map(proof.keys.roles.map((row) => [row.keyId, row]));
const manifest = proof.manifest.payload;
const trust = {
  deploymentAuthorityRegistry: registry([proof.keys.deploymentAuthority]), trustedDeploymentAuthorityIds: [proof.keys.deploymentAuthority.keyId],
  roleRegistry,
  evidenceExporterRegistry: registry([byId.get(manifest.evidenceExporter.keyId)]), trustedEvidenceExporterIds: [manifest.evidenceExporter.keyId],
  evidenceImporterRegistry: registry([byId.get(manifest.evidenceImporter.keyId)]), trustedEvidenceImporterIds: [manifest.evidenceImporter.keyId],
  recoveryVerifierRegistry: registry([byId.get(manifest.recoveryVerifier.keyId)]), trustedRecoveryVerifierIds: [manifest.recoveryVerifier.keyId],
};
const readiness = verifyDeploymentReadinessV33_37({ manifest: proof.manifest, acceptances: proof.acceptances, trust, verifiedAt: new Date('2026-07-22T19:00:00.000Z') });
if (proof.bundleRoot !== 'import-bundle') throw new Error('v33_37_bundle_root_invalid');
const evidenceRoot = dirname(input);
const root = resolve(evidenceRoot, proof.bundleRoot);
const fileBytes = {};
for (const entry of proof.bundle.payload.files) {
  const path = resolve(root, entry.path);
  if (!(path === root || path.startsWith(root + sep))) throw new Error('v33_37_bundle_path_escape');
  fileBytes[entry.path] = readFileSync(path);
}
const importReceipt = verifyExternalQualificationEvidenceImportV33_37({ manifest: proof.manifest, readiness, challenge: proof.challenge, bundle: proof.bundle, fileBytes, recovery: proof.recovery, trust, consumedChallengeDigests: new Set(), importedAt: new Date('2026-07-22T19:04:00.000Z') });
const signatureCount = 1 + proof.acceptances.length + 1 + 1 + 1;
const status = readiness.status === 'READY_FOR_EXTERNAL_EXECUTION' && importReceipt.status === 'LOCAL_IMPORT_REHEARSAL_ONLY' && importReceipt.externalTopologyObserved === false && signatureCount === 15 && Object.values(proof.attacks).every(Boolean) ? 'PASS' : 'FAIL';
const report = { version: '33.37', generatedAt: new Date().toISOString(), status, signatureCount, requiredRoleCount: readiness.requiredRoleCount, acceptedRoleCount: readiness.acceptedRoleCount, verifiedFileCount: importReceipt.verifiedFileCount, exactInventoryVerified: importReceipt.exactInventoryVerified, recoveryVerified: importReceipt.recoveryVerified, externalTopologyObserved: importReceipt.externalTopologyObserved, externalHumanParticipants: importReceipt.externalHumanParticipants, productionAuthority: importReceipt.productionAuthority, productionPromotion: 'blocked' };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (status !== 'PASS') process.exit(1);
