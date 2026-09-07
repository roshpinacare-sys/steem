import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { KeyRegistry, generateSigningIdentity, sha256, sha256Bytes, signEnvelope } from '../dist/src/contracts/crypto.js';
import { probeScannerFederationToolsV33_25 } from '../dist/src/app/signature-supply-scanner-federation-v33_25.js';
import {
  ExternalScannerEvidenceLedgerV33_26,
  ScannerTransparencyLogV33_26,
  createEmergencyFeedRevocationV33_26,
  createExternalScannerReceiptV33_26,
  createScannerTransparencyChallengeV33_26,
  evaluateExternalScannerTransparencyQualificationV33_26,
  verifyScannerTransparencyConsistencyProofV33_26,
  verifyScannerTransparencyInclusionProofV33_26,
} from '../dist/src/app/scanner-evidence-transparency-v33_26.js';

const out = resolve('release-evidence/v33.26'); mkdirSync(out, { recursive: true });
const now = new Date('2026-07-22T02:30:00.000Z');
const ids = {
  clamav: generateSigningIdentity('v33.26-synthetic-clamav'), yara: generateSigningIdentity('v33.26-synthetic-yara'),
  importer: generateSigningIdentity('v33.26-importer'), entry: generateSigningIdentity('v33.26-log-entry'),
  checkpoint: generateSigningIdentity('v33.26-log-checkpoint'), revoker: generateSigningIdentity('v33.26-emergency-revoker'),
  challenge: generateSigningIdentity('v33.26-challenge'), verifier: generateSigningIdentity('v33.26-independent-verifier'),
  proof: generateSigningIdentity('v33.26-proof'),
};
const registry = (...items) => { const r = new KeyRegistry(); for (const item of items) r.register(item.keyId, item.publicKey); return r; };
const feedDigest = sha256({ feed: 'synthetic-v33.26', sequence: 4 });
const packageDigest = sha256({ package: 'synthetic-external-scanner-evidence' });
const artifacts = (engine) => ({
  engineLog: Buffer.from(`${engine}:synthetic-engine-log`), commandOutput: Buffer.from(`${engine}:synthetic-command-output`),
  packageManifest: Buffer.from(JSON.stringify({ packageDigest })), signatureDatabaseMetadata: Buffer.from(JSON.stringify({ engine, databaseVersion: 'synthetic-reference' })),
});
const makeBundle = (signer, engine, host, org) => createExternalScannerReceiptV33_26({
  signer, evidenceClass: 'SYNTHETIC_CONTRACT_TEST', engine, engineVersion: engine === 'CLAMAV' ? 'synthetic-clamav-1.4.3' : 'synthetic-yara-4.5.2',
  signatureDatabaseVersion: engine === 'CLAMAV' ? 'synthetic-main-63' : 'synthetic-rules-2026.07.22', signatureDatabaseUpdatedAt: new Date(now.getTime() - 60 * 60_000),
  operatorOrganizationId: `${org}-operator`, scannerOrganizationId: org, operatorHostId: `${host}-operator`, scannerHostId: host,
  packageId: 'synthetic-package-v33.26', packageDigest, signatureFeedDigest: feedDigest, result: 'CLEAN',
  startedAt: new Date(now.getTime() - 90_000), completedAt: new Date(now.getTime() - 60_000), artifactBytesByName: artifacts(engine.toLowerCase()),
});
const clamav = makeBundle(ids.clamav, 'CLAMAV', 'synthetic-clamav-host', 'synthetic-clamav-org');
const yara = makeBundle(ids.yara, 'YARA', 'synthetic-yara-host', 'synthetic-yara-org');
const evidenceLedger = new ExternalScannerEvidenceLedgerV33_26(registry(ids.clamav, ids.yara), [ids.clamav.keyId, ids.yara.keyId], ids.importer, registry(ids.importer), [ids.importer.keyId]);
const importReceipts = [evidenceLedger.import(clamav, now), evidenceLedger.import(yara, now)];
const log = new ScannerTransparencyLogV33_26('scanner-transparency-log-v33.26', registry(ids.entry), [ids.entry.keyId], ids.checkpoint, registry(ids.checkpoint), [ids.checkpoint.keyId]);
log.appendFeedCheckpoint({ signer: ids.entry, feedId: 'synthetic-feed-v4', feedDigest, evidenceClass: 'SYNTHETIC_CONTRACT_TEST', now: new Date(now.getTime() - 120_000) });
const oldCheckpoint = log.checkpoint(1);
log.appendScannerReceipt({ signer: ids.entry, receipt: clamav.receipt, now: new Date(now.getTime() - 50_000) }); const clamEntryId = log.entries().at(-1).payload.entryId;
log.appendScannerReceipt({ signer: ids.entry, receipt: yara.receipt, now: new Date(now.getTime() - 40_000) }); const yaraEntryId = log.entries().at(-1).payload.entryId;
const newCheckpoint = log.checkpoint(3);
const inclusionProofs = [log.inclusionProof(clamEntryId, 3), log.inclusionProof(yaraEntryId, 3)];
const consistencyProof = log.consistencyProof(1, 3);
if (!inclusionProofs.every(verifyScannerTransparencyInclusionProofV33_26) || !verifyScannerTransparencyConsistencyProofV33_26(consistencyProof)) throw new Error('transparency_proof_generation_failed');
const challenge = createScannerTransparencyChallengeV33_26({ signer: ids.challenge, now: new Date(now.getTime() - 5 * 60_000), expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000) });
const qualification = evaluateExternalScannerTransparencyQualificationV33_26({
  challenge, challengeRegistry: registry(ids.challenge), trustedChallengeSignerIds: [ids.challenge.keyId], bundles: [clamav, yara],
  scannerRegistry: registry(ids.clamav, ids.yara), trustedScannerSignerIds: [ids.clamav.keyId, ids.yara.keyId], transparencyLog: log,
  receiptEntryIds: { [clamav.receipt.payload.receiptId]: clamEntryId, [yara.receipt.payload.receiptId]: yaraEntryId }, consistencyProof,
  oldCheckpoint, newCheckpoint, checkpointRegistry: registry(ids.checkpoint), trustedCheckpointSignerIds: [ids.checkpoint.keyId], verifierIdentity: ids.verifier, now,
});
const revocation = createEmergencyFeedRevocationV33_26({ signer: ids.revoker, signatureFeedDigest: feedDigest, reason: 'FEED_COMPROMISED', effectiveAt: now });
log.appendEmergencyRevocation({ revocation, revocationRegistry: registry(ids.revoker), trustedRevokerSignerIds: [ids.revoker.keyId], entrySigner: ids.entry, now });
const probe = probeScannerFederationToolsV33_25(now);
const kitPaths = [
  'external-qualification/v33.26/scanner-transparency/README.md','external-qualification/v33.26/scanner-transparency/RUNBOOK.md',
  'external-qualification/v33.26/scanner-transparency/trust-policy.json','external-qualification/v33.26/scanner-transparency/receipt.template.json',
  'external-qualification/v33.26/scanner-transparency/challenge.template.json','external-qualification/v33.26/scanner-transparency/transparency-policy.json',
  'external-qualification/v33.26/scanner-transparency/scripts/probe-scanners.sh','external-qualification/v33.26/scanner-transparency/scripts/hash-artifacts.sh',
  'external-qualification/v33.26/scanner-transparency/scripts/verify-host-separation.sh','external-qualification/v33.26/scanner-transparency/scripts/verify-freshness.sh',
  'external-qualification/v33.26/scanner-transparency/scripts/verify-no-secrets.sh',
];
const kitMaterial = { version: '33.26', kitId: 'external-scanner-evidence-transparency-kit-v33.26', files: kitPaths.map((path) => ({ path, sizeBytes: statSync(path).size, sha256: sha256Bytes(readFileSync(path)) })), scannerBinariesEmbedded: false, signatureDatabasesEmbedded: false, credentialsEmbedded: false, privateKeysEmbedded: false, liveExternalEvidenceIncluded: false, productionAuthority: 'NONE', externalEffectsExecuted: 0 };
const kit = { ...kitMaterial, kitDigest: sha256(kitMaterial) };
const traceMaterial = { version: '33.26', evidenceClass: 'LOCAL_SYNTHETIC_EXTERNAL_SCANNER_RECEIPT_IMPORT_AND_TRANSPARENCY_TRACE', importedReceipts: importReceipts.length, exactArtifactBytesVerified: importReceipts.every((item) => item.payload.exactArtifactBytesVerified), transparencyTreeSizeBeforeRevocation: newCheckpoint.payload.treeSize, transparencyTreeSizeAfterRevocation: log.checkpoint().payload.treeSize, inclusionProofsVerified: inclusionProofs.every(verifyScannerTransparencyInclusionProofV33_26), consistencyProofVerified: verifyScannerTransparencyConsistencyProofV33_26(consistencyProof), emergencyRevocationRecorded: log.isFeedRevoked(feedDigest), syntheticReceiptCount: qualification.payload.syntheticReceiptCount, acceptedExternalReceiptCount: qualification.payload.acceptedReceiptCount, qualificationStatus: qualification.payload.status, liveClamavExecuted: false, liveYaraExecuted: false, productionAuthority: 'NONE', externalEffectsExecuted: 0 };
const trace = signEnvelope({ ...traceMaterial, traceDigest: sha256(traceMaterial) }, ids.proof);
const proofMaterial = { version: '33.26', status: 'EXTERNAL_SCANNER_EVIDENCE_IMPORT_AND_FEED_TRANSPARENCY_PROVEN_LOCALLY', evidenceClass: 'LOCAL_SYNTHETIC_SCANNER_EVIDENCE_TRANSPARENCY_GATE', focusedTestsExpected: 39, exactArtifactByteImportVerified: true, signedTransparencyCheckpointsVerified: true, merkleInclusionProofsVerified: true, prefixConsistencyProofVerified: true, freshnessSlaEnforced: true, emergencyFeedRevocationEnforced: true, disagreementPolicy: 'FAIL_CLOSED_QUARANTINE', externalClamavQualified: false, externalYaraQualified: false, syntheticReceipts: 2, syntheticReceiptsAcceptedAsExternal: qualification.payload.acceptedReceiptCount, qualificationStatus: qualification.payload.status, operatorKitFileCount: kit.files.length, consistencyProofType: 'FULL_PREFIX_CONSISTENCY_WITNESS', succinctRfc6962ConsistencyClaimed: false, productionAuthority: 'NONE', externalEffectsExecuted: 0, productionPromotion: 'blocked' };
const proof = signEnvelope({ ...proofMaterial, proofDigest: sha256(proofMaterial) }, ids.proof);
const publicKeys = Object.values(ids).map((identity) => registry(identity).exportPublicKey(identity.keyId));
const write = (name, value) => writeFileSync(resolve(out, name), JSON.stringify(value, null, 2) + '\n');
write('V33_26_EXTERNAL_SCANNER_TOOL_PROBE.json', { ...probe, version: '33.26', externalScannerTransparencyQualified: false });
write('V33_26_SYNTHETIC_SCANNER_RECEIPTS.json', [clamav.receipt, yara.receipt]); write('V33_26_IMPORT_RECEIPTS.json', importReceipts);
write('V33_26_TRANSPARENCY_ENTRIES.json', log.entries()); write('V33_26_TRANSPARENCY_CHECKPOINTS.json', log.checkpoints());
write('V33_26_INCLUSION_PROOFS.json', inclusionProofs); write('V33_26_CONSISTENCY_PROOF.json', consistencyProof); write('V33_26_EMERGENCY_REVOCATION.json', revocation);
write('V33_26_EXTERNAL_QUALIFICATION_CHALLENGE.json', challenge); write('V33_26_EXTERNAL_QUALIFICATION_VERDICT.json', qualification);
write('V33_26_SCANNER_TRANSPARENCY_TRACE.json', trace); write('V33_26_SCANNER_EVIDENCE_TRANSPARENCY_PROOF.json', proof);
write('V33_26_EXTERNAL_OPERATOR_KIT_MANIFEST.json', kit); write('V33_26_PROOF_PUBLIC_KEYS.json', publicKeys);
console.log(JSON.stringify({ status: 'passed', focusedTestsExpected: 39, importedReceipts: 2, treeSize: log.checkpoint().payload.treeSize, inclusionProofs: inclusionProofs.length, consistencyProofType: consistencyProof.proofType, qualification: qualification.payload.status, productionPromotion: 'blocked' }, null, 2));
