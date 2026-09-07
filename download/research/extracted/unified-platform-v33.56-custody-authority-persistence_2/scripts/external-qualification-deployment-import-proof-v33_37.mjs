import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
} from '../dist/src/contracts/crypto.js';
import {
  createDeploymentRoleAcceptanceV33_37,
  createDurableReceiptRecoveryAttestationV33_37,
  createExternalQualificationDeploymentManifestV33_37,
  createExternalQualificationEvidenceBundleV33_37,
  createExternalQualificationImportChallengeV33_37,
  verifyDeploymentReadinessV33_37,
  verifyExternalQualificationEvidenceImportV33_37,
} from '../dist/src/app/external-qualification-deployment-import-v33_37.js';

const output = resolve(process.argv[2] ?? 'release-evidence/v33.37/V33_37_EXTERNAL_DEPLOYMENT_IMPORT_PROOF.json');
const evidenceRoot = dirname(output);
const bundleRoot = resolve(evidenceRoot, 'import-bundle');
rmSync(bundleRoot, { recursive: true, force: true });
mkdirSync(bundleRoot, { recursive: true });
const at = (value) => new Date(value);
const registry = (...identities) => { const result = new KeyRegistry(); for (const identity of identities) result.register(identity.keyId, identity.publicKey); return result; };
const exported = (identity) => registry(identity).exportPublicKey(identity.keyId);
const actor = (identity, name) => { const keys = registry(identity); return { keyId: identity.keyId, keyFingerprint: keys.fingerprint(identity.keyId), organizationId: `${name}-org`, hostId: `${name}-host`, administratorId: `${name}-admin` }; };

const authority = generateSigningIdentity('proof-v3337-deployment-authority');
const publisher = generateSigningIdentity('proof-v3337-publisher');
const monitors = [1, 2, 3].map((n) => generateSigningIdentity(`proof-v3337-monitor-${n}`));
const auditors = [1, 2].map((n) => generateSigningIdentity(`proof-v3337-auditor-${n}`));
const timeSources = [1, 2].map((n) => generateSigningIdentity(`proof-v3337-time-${n}`));
const exporter = generateSigningIdentity('proof-v3337-exporter');
const importer = generateSigningIdentity('proof-v3337-importer');
const recoveryVerifier = generateSigningIdentity('proof-v3337-recovery-verifier');
const roleIdentities = [publisher, ...monitors, ...auditors, ...timeSources, exporter, importer, recoveryVerifier];
const descriptors = new Map(roleIdentities.map((identity) => [identity.keyId, actor(identity, identity.keyId)]));
const manifest = createExternalQualificationDeploymentManifestV33_37({
  deploymentAuthority: authority,
  deploymentAuthorityDescriptor: actor(authority, 'deployment-authority'),
  deploymentId: 'v3337-external-qualification-deployment-kit',
  campaignId: 'v3337-local-import-rehearsal',
  artifactId: 'v3337-qualification-artifact',
  artifactDigest: sha256({ artifact: 'v3337-local-import-rehearsal' }),
  publisher: descriptors.get(publisher.keyId),
  monitors: monitors.map((identity) => descriptors.get(identity.keyId)),
  topologyAuditors: auditors.map((identity) => descriptors.get(identity.keyId)),
  timeSources: timeSources.map((identity) => descriptors.get(identity.keyId)),
  evidenceExporter: descriptors.get(exporter.keyId),
  evidenceImporter: descriptors.get(importer.keyId),
  recoveryVerifier: descriptors.get(recoveryVerifier.keyId),
  allowedDnsNames: ['publisher.example.com'],
  providerEvidencePolicyDigest: sha256({ policy: 'two-independent-auditors-plus-provider-evidence' }),
  issuedAt: at('2026-07-22T18:00:00.000Z'),
  expiresAt: at('2026-08-22T18:00:00.000Z'),
});
const assignments = [
  ['PUBLISHER', publisher],
  ...monitors.map((identity) => ['MONITOR', identity]),
  ...auditors.map((identity) => ['TOPOLOGY_AUDITOR', identity]),
  ...timeSources.map((identity) => ['TIME_SOURCE', identity]),
  ['EVIDENCE_EXPORTER', exporter],
  ['EVIDENCE_IMPORTER', importer],
  ['RECOVERY_VERIFIER', recoveryVerifier],
];
const acceptances = assignments.map(([role, identity], index) => createDeploymentRoleAcceptanceV33_37({
  actor: identity,
  actorDescriptor: descriptors.get(identity.keyId),
  role,
  manifestDigest: manifest.payload.manifestDigest,
  acceptedAt: new Date(Date.parse('2026-07-22T18:10:00.000Z') + index * 60_000),
}));
const trust = {
  deploymentAuthorityRegistry: registry(authority), trustedDeploymentAuthorityIds: [authority.keyId],
  roleRegistry: registry(...roleIdentities),
  evidenceExporterRegistry: registry(exporter), trustedEvidenceExporterIds: [exporter.keyId],
  evidenceImporterRegistry: registry(importer), trustedEvidenceImporterIds: [importer.keyId],
  recoveryVerifierRegistry: registry(recoveryVerifier), trustedRecoveryVerifierIds: [recoveryVerifier.keyId],
};
const readiness = verifyDeploymentReadinessV33_37({ manifest, acceptances, trust, verifiedAt: at('2026-07-22T19:00:00.000Z') });
const challenge = createExternalQualificationImportChallengeV33_37({ importer, manifestDigest: manifest.payload.manifestDigest, nonce: new Uint8Array(32).fill(37), issuedAt: at('2026-07-22T19:01:00.000Z'), expiresAt: at('2026-07-22T20:01:00.000Z') });
const fileRows = {
  'qualification/v33_36-verdict.json': { bytes: Buffer.from(JSON.stringify({ version: '33.36', status: 'LOCAL_HTTPS_MONITOR_REHEARSAL_ONLY', externalTopologyObserved: false, productionAuthority: 'NONE' }, null, 2) + '\n'), mediaType: 'application/json' },
  'receipts/monitor-1-durable.bin': { bytes: Buffer.from('v33.37 durable receipt recovery rehearsal\n'), mediaType: 'application/octet-stream' },
  'runbook/operator-checklist.json': { bytes: Buffer.from(JSON.stringify({ externalExecutionPerformed: false, dnsProvisioned: false, externalHostsObserved: 0, nextAction: 'execute with independent external operators' }, null, 2) + '\n'), mediaType: 'application/json' },
};
for (const [path, row] of Object.entries(fileRows)) { const target = resolve(bundleRoot, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, row.bytes); }
const bundle = createExternalQualificationEvidenceBundleV33_37({
  exporter,
  exporterDescriptor: descriptors.get(exporter.keyId),
  manifestDigest: manifest.payload.manifestDigest,
  challengeDigest: challenge.payload.challengeDigest,
  executionClass: 'LOCAL_REHEARSAL',
  qualificationStatus: 'LOCAL_HTTPS_MONITOR_REHEARSAL_ONLY',
  externalTopologyObserved: false,
  qualificationVerdictDigest: sha256({ version: '33.36', status: 'LOCAL_HTTPS_MONITOR_REHEARSAL_ONLY' }),
  files: fileRows,
  exportedAt: at('2026-07-22T19:02:00.000Z'),
});
const recovered = bundle.payload.files.find((row) => row.path === 'receipts/monitor-1-durable.bin');
const recovery = createDurableReceiptRecoveryAttestationV33_37({
  recoveryVerifier,
  manifestDigest: manifest.payload.manifestDigest,
  bundleDigest: bundle.payload.bundleDigest,
  durableReceiptPath: recovered.path,
  inventoryFileDigest: recovered.sha256,
  restoredBytes: fileRows[recovered.path].bytes,
  restoredAt: at('2026-07-22T19:03:00.000Z'),
});
const consumed = new Set();
const importReceipt = verifyExternalQualificationEvidenceImportV33_37({ manifest, readiness, challenge, bundle, fileBytes: Object.fromEntries(Object.entries(fileRows).map(([path, row]) => [path, row.bytes])), recovery, trust, consumedChallengeDigests: consumed, importedAt: at('2026-07-22T19:04:00.000Z') });
const attacks = {};
try { verifyExternalQualificationEvidenceImportV33_37({ manifest, readiness, challenge, bundle, fileBytes: Object.fromEntries(Object.entries(fileRows).map(([path, row]) => [path, row.bytes])), recovery, trust, consumedChallengeDigests: consumed, importedAt: at('2026-07-22T19:05:00.000Z') }); attacks.challengeReplayBlocked = false; } catch { attacks.challengeReplayBlocked = true; }
try { verifyExternalQualificationEvidenceImportV33_37({ manifest, readiness, challenge, bundle, fileBytes: { ...Object.fromEntries(Object.entries(fileRows).map(([path, row]) => [path, row.bytes])), 'extra.txt': Buffer.from('extra') }, recovery, trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-22T19:04:00.000Z') }); attacks.extraFileBlocked = false; } catch { attacks.extraFileBlocked = true; }
const relabelled = { ...bundle, payload: { ...bundle.payload, executionClass: 'LIVE_EXTERNAL', qualificationStatus: 'EXTERNAL_MONITOR_QUALIFIED', externalTopologyObserved: true } };
try { verifyExternalQualificationEvidenceImportV33_37({ manifest, readiness, challenge, bundle: relabelled, fileBytes: Object.fromEntries(Object.entries(fileRows).map(([path, row]) => [path, row.bytes])), recovery, trust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-22T19:04:00.000Z') }); attacks.relabelBlocked = false; } catch { attacks.relabelBlocked = true; }
const keys = { deploymentAuthority: exported(authority), roles: roleIdentities.map(exported) };
const signatureCount = 1 + acceptances.length + 1 + 1 + 1;
const proof = {
  version: '33.37',
  generatedAt: new Date().toISOString(),
  manifest,
  acceptances,
  readiness,
  challenge,
  bundle,
  recovery,
  importReceipt,
  bundleRoot: 'import-bundle',
  keys,
  attacks,
  summary: { requiredRoleCount: readiness.requiredRoleCount, acceptedRoleCount: readiness.acceptedRoleCount, inventoryFileCount: bundle.payload.files.length, signatureCount },
  truthBoundary: { executionClass: 'LOCAL_REHEARSAL', externalTopologyObserved: false, externalHostsObserved: 0, externalHumanParticipants: 0, productionAuthority: 'NONE', externalEffectsExecuted: 0, g3: 'blocked', productionPromotion: 'blocked' },
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PASS', output, signatureCount, readiness: readiness.status, importStatus: importReceipt.status, attacks }, null, 2));
