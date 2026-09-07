import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { KeyRegistry, sha256Bytes } from '../dist/src/contracts/crypto.js';
import { verifyCoordinatorDeploymentReadinessV33_48, verifyCoordinatorJournalEvidenceImportV33_48 } from '../dist/src/supply-chain/external-coordinator-deployment-evidence-import-v33_48.js';
const input = resolve(process.argv[2] ?? 'release-evidence/v33.48/V33_48_EXTERNAL_COORDINATOR_DEPLOYMENT_EVIDENCE_IMPORT_PROOF.json');
const output = resolve(process.argv[3] ?? 'release-evidence/v33.48/V33_48_INDEPENDENT_VERIFICATION.json');
const proof = JSON.parse(readFileSync(input, 'utf8'));
const evidenceRoot = dirname(input);
const baseOut = resolve('release-evidence/v33.48/.tmp-v33.47-verification.json');
const baseRun = spawnSync(process.execPath, ['scripts/verify-external-coordinator-journal-qualification-v33_47.mjs', proof.base.proofPath, baseOut], { encoding: 'utf8' });
if (baseRun.status !== 0) throw new Error(`base_verifier_failed:${baseRun.stderr}`);
const baseVerification = JSON.parse(readFileSync(baseOut, 'utf8')); rmSync(baseOut, { force: true });
const publicMap = new Map(proof.publicKeys.map((row) => [row.keyId, row]));
function subset(ids) { const registry = new KeyRegistry(); for (const id of ids) { const row = publicMap.get(id); if (!row) throw new Error(`public_key_missing:${id}`); registry.registerExported(row); } return registry; }
const trust = {
  deploymentAuthorityRegistry: subset(proof.trustedIds.deploymentAuthority), trustedDeploymentAuthorityIds: proof.trustedIds.deploymentAuthority,
  roleRegistry: subset(proof.trustedIds.roles), evidenceAuditorRegistry: subset(proof.trustedIds.auditors), trustedEvidenceAuditorIds: proof.trustedIds.auditors,
  evidenceExporterRegistry: subset(proof.trustedIds.exporter), trustedEvidenceExporterIds: proof.trustedIds.exporter, evidenceImporterRegistry: subset(proof.trustedIds.importer), trustedEvidenceImporterIds: proof.trustedIds.importer,
  recoveryVerifierRegistry: subset(proof.trustedIds.recovery), trustedRecoveryVerifierIds: proof.trustedIds.recovery, trustedExternalEvidenceDigests: [],
};
const readiness = verifyCoordinatorDeploymentReadinessV33_48({ manifest: proof.manifest, acceptances: proof.acceptances, trust, verifiedAt: new Date(proof.readiness.verifiedAt) });
const importedRoot = join(evidenceRoot, proof.executionEvidence.importedRoot);
const fileBytes = Object.fromEntries(proof.bundle.payload.files.map((entry) => [entry.path, readFileSync(join(importedRoot, entry.path))]));
const receipt = verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: proof.base.verdict, manifest: proof.manifest, readiness, challenge: proof.challenge, infrastructureEvidence: proof.infrastructureEvidence, bundle: proof.bundle, fileBytes, recovery: proof.recovery, trust, consumedChallengeDigests: new Set(), importedAt: new Date(proof.importReceipt.importedAt) });
const all = new KeyRegistry(); proof.publicKeys.forEach((row) => all.registerExported(row));
const envelopes = [proof.manifest, ...proof.acceptances, proof.challenge, proof.bundle, proof.recovery];
const checks = {
  version: proof.version === '33.48', baseProofDigest: sha256Bytes(readFileSync(proof.base.proofPath)) === proof.base.proofSha256,
  baseVerifierPassed: baseVerification.status === 'PASS', baseVerdictDigest: proof.base.verdict.verdictDigest === JSON.parse(readFileSync(proof.base.proofPath, 'utf8')).finalVerdict.verdictDigest,
  newSignaturesValid: envelopes.every((envelope) => all.verifyAt(envelope, new Date(proof.importReceipt.importedAt))), newSignatureCount: envelopes.length === 20,
  totalChainSignatureCount: proof.summary.totalChainSignatureCount === 121, readinessRecomputed: readiness.readinessDigest === proof.readiness.readinessDigest,
  importReceiptRecomputed: receipt.receiptDigest === proof.importReceipt.receiptDigest,
  exactInventory: proof.bundle.payload.files.length === proof.executionEvidence.exactInventoryFileCount && proof.bundle.payload.files.every((entry) => sha256Bytes(fileBytes[entry.path]) === entry.sha256 && fileBytes[entry.path].byteLength === entry.byteLength),
  durableWrites: [...proof.executionEvidence.bundleWrites, ...proof.executionEvidence.importedWrites].every((row) => row.fileFsync && row.directoryFsync && row.rereadVerified),
  attacks: Object.values(proof.attacks).every(Boolean),
  truthBoundary: proof.truthBoundary.status === 'LOCAL_EXTERNAL_DEPLOYMENT_IMPORT_REHEARSAL_ONLY' && proof.truthBoundary.externalTopologyObserved === false && proof.truthBoundary.externalHostsObserved === 0 && proof.truthBoundary.externalClockRootsObserved === 0 && proof.truthBoundary.externalStoresObserved === 0 && proof.truthBoundary.externalHumanParticipants === 0 && proof.truthBoundary.productionAuthority === 'NONE' && proof.truthBoundary.externalEffectsExecuted === 0,
};
const status = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL';
const result = { version: '33.48', generatedAt: new Date().toISOString(), status, newSignatureCount: 20, totalChainSignatureCount: 121, requiredRoleCount: readiness.requiredRoleCount, acceptedRoleCount: readiness.acceptedRoleCount, inventoryFileCount: proof.bundle.payload.files.length, finalStatus: receipt.status, productionAuthority: receipt.productionAuthority, checks };
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2)); if (status !== 'PASS') process.exit(1);
