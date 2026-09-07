import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { KeyRegistry, generateSigningIdentity, sha256, sha256Bytes } from '../dist/src/contracts/crypto.js';
import {
  createAppendOnlyStoreRecoveryAttestationV33_48,
  createCoordinatorDeploymentRoleAcceptanceV33_48,
  createCoordinatorEvidenceImportChallengeV33_48,
  createCoordinatorExternalDeploymentManifestV33_48,
  createCoordinatorJournalEvidenceBundleV33_48,
  verifyCoordinatorDeploymentReadinessV33_48,
  verifyCoordinatorJournalEvidenceImportV33_48,
} from '../dist/src/supply-chain/external-coordinator-deployment-evidence-import-v33_48.js';

const OUT = resolve(process.argv[2] ?? 'release-evidence/v33.48/V33_48_EXTERNAL_COORDINATOR_DEPLOYMENT_EVIDENCE_IMPORT_PROOF.json');
const BASE = resolve('release-evidence/v33.47/V33_47_EXTERNAL_COORDINATOR_JOURNAL_QUALIFICATION_PROOF.json');
const evidenceRoot = dirname(OUT);
const bundleRoot = join(evidenceRoot, 'deployment-evidence-bundle');
const importedRoot = join(evidenceRoot, 'imported-evidence');
rmSync(bundleRoot, { recursive: true, force: true });
rmSync(importedRoot, { recursive: true, force: true });
mkdirSync(bundleRoot, { recursive: true });
mkdirSync(importedRoot, { recursive: true });
const baseProof = JSON.parse(readFileSync(BASE, 'utf8'));
const baseVerdict = baseProof.finalVerdict;
const at = (offsetMs) => new Date(Date.parse('2026-07-23T02:00:00.000Z') + offsetMs);
const registry = (...identities) => { const result = new KeyRegistry(); identities.forEach((identity) => result.register(identity.keyId, identity.publicKey)); return result; };
const descriptor = (identity, name) => { const keys = registry(identity); return { keyId: identity.keyId, keyFingerprint: keys.fingerprint(identity.keyId), organizationId: `${name}-org`, hostId: `${name}.example.com`, administratorId: `${name}-admin` }; };
const exportKey = (identity) => registry(identity).exportPublicKey(identity.keyId);
const durableWrite = (root, path, bytes) => {
  const target = join(root, path); mkdirSync(dirname(target), { recursive: true });
  const fd = openSync(target, 'w'); try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  const directoryFd = openSync(dirname(target), 'r'); try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
  const reread = readFileSync(target); if (!reread.equals(Buffer.from(bytes))) throw new Error(`durable_reread_mismatch:${path}`);
  return { path, byteLength: reread.length, sha256: sha256Bytes(reread), fileFsync: true, directoryFsync: true, rereadVerified: true };
};

const authority = generateSigningIdentity('proof-v3348-deployment-authority');
const hosts = [1, 2, 3, 4].map((n) => generateSigningIdentity(`proof-v3348-host-${n}`));
const clocks = [1, 2].map((n) => generateSigningIdentity(`proof-v3348-clock-${n}`));
const stores = [1, 2, 3].map((n) => generateSigningIdentity(`proof-v3348-store-${n}`));
const observers = [1, 2].map((n) => generateSigningIdentity(`proof-v3348-observer-${n}`));
const auditors = [1, 2].map((n) => generateSigningIdentity(`proof-v3348-auditor-${n}`));
const exporter = generateSigningIdentity('proof-v3348-exporter');
const importer = generateSigningIdentity('proof-v3348-importer');
const recoveryVerifier = generateSigningIdentity('proof-v3348-recovery-verifier');
const roleIdentities = [...hosts, ...clocks, ...stores, ...observers, ...auditors, exporter, importer, recoveryVerifier];
const descriptors = new Map(roleIdentities.map((identity) => [identity.keyId, descriptor(identity, identity.keyId)]));
const manifest = createCoordinatorExternalDeploymentManifestV33_48({
  deploymentAuthority: authority,
  deploymentAuthorityDescriptor: descriptor(authority, 'proof-v3348-authority'),
  deploymentId: 'v3348-external-coordinator-deployment-kit', campaignId: 'v3348-local-import-rehearsal', artifactId: 'v3348-coordinator-journal-evidence',
  artifactDigest: sha256({ artifact: 'v3348-external-coordinator-deployment-kit' }), baseQualificationVerdictDigest: baseVerdict.verdictDigest,
  coordinatorHosts: hosts.map((identity) => descriptors.get(identity.keyId)), clockRoots: clocks.map((identity) => descriptors.get(identity.keyId)), appendOnlyStores: stores.map((identity) => descriptors.get(identity.keyId)), partitionObservers: observers.map((identity) => descriptors.get(identity.keyId)), topologyAuditors: auditors.map((identity) => descriptors.get(identity.keyId)),
  evidenceExporter: descriptors.get(exporter.keyId), evidenceImporter: descriptors.get(importer.keyId), recoveryVerifier: descriptors.get(recoveryVerifier.keyId),
  allowedDnsNames: [...hosts, ...clocks, ...stores, ...observers].map((identity) => descriptors.get(identity.keyId).hostId),
  evidencePolicyDigest: sha256({ policy: 'two-independent-topology-auditors-per-infrastructure-role' }), issuedAt: at(0), expiresAt: at(31 * 24 * 60 * 60 * 1000),
});
const assignments = [
  ...hosts.map((identity, index) => ['COORDINATOR_HOST', index + 1, identity]),
  ...clocks.map((identity, index) => ['CLOCK_ROOT', index + 1, identity]),
  ...stores.map((identity, index) => ['APPEND_ONLY_STORE', index + 1, identity]),
  ...observers.map((identity, index) => ['PARTITION_OBSERVER', index + 1, identity]),
  ...auditors.map((identity, index) => ['TOPOLOGY_AUDITOR', index + 1, identity]),
  ['EVIDENCE_EXPORTER', 1, exporter], ['EVIDENCE_IMPORTER', 1, importer], ['RECOVERY_VERIFIER', 1, recoveryVerifier],
];
const acceptances = assignments.map(([role, ordinal, identity], index) => createCoordinatorDeploymentRoleAcceptanceV33_48({ actor: identity, actorDescriptor: descriptors.get(identity.keyId), role, ordinal, manifestDigest: manifest.payload.manifestDigest, acceptedAt: at(10_000 + index * 1000) }));
const trust = {
  deploymentAuthorityRegistry: registry(authority), trustedDeploymentAuthorityIds: [authority.keyId], roleRegistry: registry(...roleIdentities),
  evidenceAuditorRegistry: registry(...auditors), trustedEvidenceAuditorIds: auditors.map((identity) => identity.keyId), evidenceExporterRegistry: registry(exporter), trustedEvidenceExporterIds: [exporter.keyId], evidenceImporterRegistry: registry(importer), trustedEvidenceImporterIds: [importer.keyId], recoveryVerifierRegistry: registry(recoveryVerifier), trustedRecoveryVerifierIds: [recoveryVerifier.keyId], trustedExternalEvidenceDigests: [],
};
const readiness = verifyCoordinatorDeploymentReadinessV33_48({ manifest, acceptances, trust, verifiedAt: at(60_000) });
const challenge = createCoordinatorEvidenceImportChallengeV33_48({ importer, manifestDigest: manifest.payload.manifestDigest, nonce: new Uint8Array(32).fill(48), issuedAt: at(61_000), expiresAt: at(121_000) });
const files = {
  'qualification/v33_47-verdict.json': { bytes: Buffer.from(JSON.stringify(baseVerdict, null, 2) + '\n'), mediaType: 'application/json' },
  'hosts/host-1.json': { bytes: Buffer.from('{"externalObserved":false,"host":1}\n'), mediaType: 'application/json' },
  'hosts/host-2.json': { bytes: Buffer.from('{"externalObserved":false,"host":2}\n'), mediaType: 'application/json' },
  'hosts/host-3.json': { bytes: Buffer.from('{"externalObserved":false,"host":3}\n'), mediaType: 'application/json' },
  'hosts/host-4.json': { bytes: Buffer.from('{"externalObserved":false,"host":4}\n'), mediaType: 'application/json' },
  'clocks/root-1.json': { bytes: Buffer.from('{"externalObserved":false,"clockRoot":1}\n'), mediaType: 'application/json' },
  'clocks/root-2.json': { bytes: Buffer.from('{"externalObserved":false,"clockRoot":2}\n'), mediaType: 'application/json' },
  'stores/store-1-receipt.bin': { bytes: Buffer.from('v33.48 append-only store 1 local rehearsal\n'), mediaType: 'application/octet-stream' },
  'stores/store-2-receipt.bin': { bytes: Buffer.from('v33.48 append-only store 2 local rehearsal\n'), mediaType: 'application/octet-stream' },
  'stores/store-3-receipt.bin': { bytes: Buffer.from('v33.48 append-only store 3 local rehearsal\n'), mediaType: 'application/octet-stream' },
  'partition/failover.json': { bytes: Buffer.from('{"externalPartitionObserved":false,"failoverExecuted":false}\n'), mediaType: 'application/json' },
  'recovery/site-loss.json': { bytes: Buffer.from('{"externalSiteLossObserved":false,"recoveryExecuted":false}\n'), mediaType: 'application/json' },
};
const bundleWrites = Object.entries(files).map(([path, row]) => durableWrite(bundleRoot, path, row.bytes));
const bundle = createCoordinatorJournalEvidenceBundleV33_48({ exporter, manifestDigest: manifest.payload.manifestDigest, challengeDigest: challenge.payload.challengeDigest, baseQualificationVerdictDigest: baseVerdict.verdictDigest, executionClass: 'LOCAL_REHEARSAL', qualificationStatus: 'LOCAL_COORDINATOR_JOURNAL_QUALIFICATION_REHEARSAL_ONLY', externalTopologyObserved: false, externalCoordinatorHostCount: 0, externalClockRootCount: 0, externalAppendOnlyStoreCount: 0, externalPartitionObserverCount: 0, infrastructureEvidence: [], files, exportedAt: at(62_000) });
const importedWrites = bundle.payload.files.map((entry) => durableWrite(importedRoot, entry.path, readFileSync(join(bundleRoot, entry.path))));
const importedBytes = Object.fromEntries(bundle.payload.files.map((entry) => [entry.path, readFileSync(join(importedRoot, entry.path))]));
const storeEntry = bundle.payload.files.find((entry) => entry.path === 'stores/store-1-receipt.bin');
const recovery = createAppendOnlyStoreRecoveryAttestationV33_48({ recoveryVerifier, manifestDigest: manifest.payload.manifestDigest, bundleDigest: bundle.payload.bundleDigest, durableStoreEvidencePath: storeEntry.path, inventoryFileDigest: storeEntry.sha256, restoredBytes: importedBytes[storeEntry.path], fileFsync: true, directoryFsync: true, rereadVerified: true, restoredAt: at(63_000) });
const consumed = new Set();
const importReceipt = verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict, manifest, readiness, challenge, infrastructureEvidence: [], bundle, fileBytes: importedBytes, recovery, trust, consumedChallengeDigests: consumed, importedAt: at(64_000) });
const attack = (fn) => { try { fn(); return false; } catch { return true; } };
const attacks = {
  challengeReplayBlocked: attack(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict, manifest, readiness, challenge, infrastructureEvidence: [], bundle, fileBytes: importedBytes, recovery, trust, consumedChallengeDigests: consumed, importedAt: at(65_000) })),
  extraFileBlocked: attack(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict, manifest, readiness, challenge, infrastructureEvidence: [], bundle, fileBytes: { ...importedBytes, 'extra.txt': Buffer.from('extra') }, recovery, trust, consumedChallengeDigests: new Set(), importedAt: at(64_000) })),
  externalRelabelBlocked: attack(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict, manifest, readiness, challenge, infrastructureEvidence: [], bundle: { ...bundle, payload: { ...bundle.payload, executionClass: 'LIVE_EXTERNAL', qualificationStatus: 'EXTERNAL_COORDINATOR_JOURNAL_QUALIFIED', externalTopologyObserved: true, externalCoordinatorHostCount: 4, externalClockRootCount: 2, externalAppendOnlyStoreCount: 3, externalPartitionObserverCount: 2 } }, fileBytes: importedBytes, recovery, trust, consumedChallengeDigests: new Set(), importedAt: at(64_000) })),
  missingAcceptanceBlocked: attack(() => verifyCoordinatorDeploymentReadinessV33_48({ manifest, acceptances: acceptances.slice(0, -1), trust, verifiedAt: at(60_000) })),
  recoveryMismatchBlocked: attack(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict, manifest, readiness, challenge, infrastructureEvidence: [], bundle, fileBytes: { ...importedBytes, [storeEntry.path]: Buffer.from('tampered') }, recovery, trust, consumedChallengeDigests: new Set(), importedAt: at(64_000) })),
  productionAuthorityBlocked: attack(() => verifyCoordinatorJournalEvidenceImportV33_48({ baseVerdict: { ...baseVerdict, productionAuthority: 'PRODUCTION' }, manifest, readiness, challenge, infrastructureEvidence: [], bundle, fileBytes: importedBytes, recovery, trust, consumedChallengeDigests: new Set(), importedAt: at(64_000) })),
};
const identities = [authority, ...roleIdentities];
const proof = {
  version: '33.48', generatedAt: new Date().toISOString(),
  base: { proofPath: relative(process.cwd(), BASE), proofSha256: sha256Bytes(readFileSync(BASE)), verdict: baseVerdict },
  publicKeys: identities.map(exportKey), trustedIds: { deploymentAuthority: [authority.keyId], roles: roleIdentities.map((identity) => identity.keyId), auditors: auditors.map((identity) => identity.keyId), exporter: [exporter.keyId], importer: [importer.keyId], recovery: [recoveryVerifier.keyId] },
  manifest, acceptances, readiness, challenge, infrastructureEvidence: [], bundle, recovery, importReceipt,
  executionEvidence: { bundleRoot: relative(evidenceRoot, bundleRoot), importedRoot: relative(evidenceRoot, importedRoot), bundleWrites, importedWrites, exactInventoryFileCount: bundle.payload.files.length },
  attacks,
  summary: { newSignatureCount: 20, totalChainSignatureCount: 121, requiredRoleCount: 16, acceptedRoleCount: 16, inventoryFileCount: bundle.payload.files.length, infrastructureEvidenceCount: 0, externalHostsObserved: 0, externalClockRootsObserved: 0, externalStoresObserved: 0 },
  truthBoundary: { status: 'LOCAL_EXTERNAL_DEPLOYMENT_IMPORT_REHEARSAL_ONLY', externalTopologyObserved: false, externalHostsObserved: 0, externalClockRootsObserved: 0, externalStoresObserved: 0, externalHumanParticipants: 0, productionAuthority: 'NONE', externalEffectsExecuted: 0, g3: 'blocked', productionPromotion: 'blocked' },
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ status: importReceipt.status, signatures: proof.summary.newSignatureCount, files: proof.summary.inventoryFileCount, attacks: Object.values(attacks).filter(Boolean).length, output: OUT }, null, 2));
