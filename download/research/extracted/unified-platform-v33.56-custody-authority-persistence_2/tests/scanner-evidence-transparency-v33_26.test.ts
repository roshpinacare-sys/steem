import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
  type SigningIdentity,
} from '../src/contracts/crypto.js';
import {
  ExternalScannerEvidenceLedgerV33_26,
  ScannerTransparencyLogV33_26,
  createEmergencyFeedRevocationV33_26,
  createExternalScannerReceiptV33_26,
  createScannerTransparencyChallengeV33_26,
  createTransparencyEntryV33_26,
  evaluateExternalScannerTransparencyQualificationV33_26,
  verifyExternalScannerBundleV33_26,
  verifyScannerTransparencyCheckpointV33_26,
  verifyScannerTransparencyConsistencyProofV33_26,
  verifyScannerTransparencyInclusionProofV33_26,
  type ExternalEvidenceClassV33_26,
  type ExternalScannerEvidenceBundleV33_26,
} from '../src/app/scanner-evidence-transparency-v33_26.js';

const t0 = new Date('2026-07-22T02:00:00.000Z');
const feedDigest = sha256({ feed: 'v33.26', sequence: 4 });
const packageDigest = sha256({ package: 'qualification-evidence' });

function identities() {
  return {
    clamav: generateSigningIdentity('external-clamav-signer'),
    yara: generateSigningIdentity('external-yara-signer'),
    attacker: generateSigningIdentity('attacker'),
    importer: generateSigningIdentity('evidence-importer'),
    entry: generateSigningIdentity('transparency-entry-signer'),
    checkpoint: generateSigningIdentity('transparency-checkpoint-signer'),
    revoker: generateSigningIdentity('emergency-feed-revoker'),
    challenge: generateSigningIdentity('transparency-challenge-issuer'),
    verifier: generateSigningIdentity('independent-transparency-verifier'),
  };
}
function registry(...ids: readonly SigningIdentity[]): KeyRegistry {
  const result = new KeyRegistry();
  for (const id of ids) result.register(id.keyId, id.publicKey);
  return result;
}
function artifactBytes(label: string) {
  return {
    engineLog: Buffer.from(`${label}:engine-log`),
    commandOutput: Buffer.from(`${label}:command-output`),
    packageManifest: Buffer.from(JSON.stringify({ packageDigest })),
    signatureDatabaseMetadata: Buffer.from(JSON.stringify({ database: `${label}-db` })),
  };
}
function bundle(input: {
  signer: SigningIdentity;
  engine: 'CLAMAV' | 'YARA';
  evidenceClass?: ExternalEvidenceClassV33_26;
  result?: 'CLEAN' | 'REJECTED';
  host?: string;
  organization?: string;
  packageDigestOverride?: string;
  feedDigestOverride?: string;
  completedAt?: Date;
  dbUpdatedAt?: Date;
  receiptId?: string;
}) {
  const completedAt = input.completedAt ?? new Date(t0.getTime() - 60_000);
  return createExternalScannerReceiptV33_26({
    signer: input.signer,
    evidenceClass: input.evidenceClass ?? 'SYNTHETIC_CONTRACT_TEST',
    engine: input.engine,
    engineVersion: input.engine === 'CLAMAV' ? '1.4.3' : '4.5.2',
    signatureDatabaseVersion: input.engine === 'CLAMAV' ? 'main-63-daily-27800' : 'rules-2026.07.22',
    signatureDatabaseUpdatedAt: input.dbUpdatedAt ?? new Date(t0.getTime() - 2 * 60 * 60_000),
    operatorOrganizationId: `${input.engine.toLowerCase()}-operator-org`,
    scannerOrganizationId: input.organization ?? `${input.engine.toLowerCase()}-scanner-org`,
    operatorHostId: `${input.engine.toLowerCase()}-operator-host`,
    scannerHostId: input.host ?? `${input.engine.toLowerCase()}-scanner-host`,
    packageId: 'evidence-package-1',
    packageDigest: input.packageDigestOverride ?? packageDigest,
    signatureFeedDigest: input.feedDigestOverride ?? feedDigest,
    result: input.result ?? 'CLEAN',
    startedAt: new Date(completedAt.getTime() - 30_000),
    completedAt,
    artifactBytesByName: artifactBytes(input.engine.toLowerCase()),
    ...(input.receiptId === undefined ? {} : { receiptId: input.receiptId }),
  });
}
function setupLog(x = identities()) {
  const entryRegistry = registry(x.entry);
  const checkpointRegistry = registry(x.checkpoint);
  const log = new ScannerTransparencyLogV33_26(
    'scanner-transparency-log-v33.26',
    entryRegistry,
    [x.entry.keyId],
    x.checkpoint,
    checkpointRegistry,
    [x.checkpoint.keyId],
  );
  log.appendFeedCheckpoint({ signer: x.entry, feedId: 'feed-v4', feedDigest, now: new Date(t0.getTime() - 3 * 60_000) });
  return { x, log, entryRegistry, checkpointRegistry };
}
function appendBundle(log: ScannerTransparencyLogV33_26, signer: SigningIdentity, b: ExternalScannerEvidenceBundleV33_26, now: Date) {
  log.appendScannerReceipt({ signer, receipt: b.receipt, now });
  return log.entries().at(-1)!.payload.entryId;
}
function qualification(input: {
  evidenceClass?: ExternalEvidenceClassV33_26;
  clamResult?: 'CLEAN' | 'REJECTED';
  yaraResult?: 'CLEAN' | 'REJECTED';
  sameHost?: boolean;
  sameOrg?: boolean;
  staleReceipt?: boolean;
  staleDb?: boolean;
  packageMismatch?: boolean;
  feedMismatch?: boolean;
  revoke?: boolean;
  verifier?: SigningIdentity;
}) {
  const { x, log, checkpointRegistry } = setupLog();
  const evidenceClass = input.evidenceClass ?? 'LIVE_EXTERNAL_SCANNER_EVIDENCE';
  const clam = bundle({ signer: x.clamav, engine: 'CLAMAV', evidenceClass, host: 'host-clam', organization: 'org-clam', ...(input.clamResult === undefined ? {} : { result: input.clamResult }), ...(input.staleReceipt ? { completedAt: new Date(t0.getTime() - 30 * 60 * 60_000) } : {}), ...(input.staleDb ? { dbUpdatedAt: new Date(t0.getTime() - 20 * 60 * 60_000) } : {}) });
  const yara = bundle({ signer: x.yara, engine: 'YARA', evidenceClass, host: input.sameHost ? 'host-clam' : 'host-yara', organization: input.sameOrg ? 'org-clam' : 'org-yara', ...(input.yaraResult === undefined ? {} : { result: input.yaraResult }), ...(input.packageMismatch ? { packageDigestOverride: sha256({ other: 'package' }) } : {}), ...(input.feedMismatch ? { feedDigestOverride: sha256({ other: 'feed' }) } : {}) });
  const oldCheckpoint = log.checkpoint(1);
  const clamEntry = appendBundle(log, x.entry, clam, new Date(t0.getTime() - 50_000));
  const yaraEntry = appendBundle(log, x.entry, yara, new Date(t0.getTime() - 40_000));
  if (input.revoke) {
    const revocation = createEmergencyFeedRevocationV33_26({ signer: x.revoker, signatureFeedDigest: feedDigest, reason: 'FEED_COMPROMISED', effectiveAt: new Date(t0.getTime() - 30_000) });
    log.appendEmergencyRevocation({ revocation, revocationRegistry: registry(x.revoker), trustedRevokerSignerIds: [x.revoker.keyId], entrySigner: x.entry, now: new Date(t0.getTime() - 20_000) });
  }
  const newCheckpoint = log.checkpoint();
  const consistency = log.consistencyProof(1, newCheckpoint.payload.treeSize);
  const challenge = createScannerTransparencyChallengeV33_26({ signer: x.challenge, now: new Date(t0.getTime() - 5 * 60_000), expiresAt: new Date(t0.getTime() + 60 * 60_000) });
  const verdict = evaluateExternalScannerTransparencyQualificationV33_26({
    challenge,
    challengeRegistry: registry(x.challenge),
    trustedChallengeSignerIds: [x.challenge.keyId],
    bundles: [clam, yara],
    scannerRegistry: registry(x.clamav, x.yara),
    trustedScannerSignerIds: [x.clamav.keyId, x.yara.keyId],
    transparencyLog: log,
    receiptEntryIds: { [clam.receipt.payload.receiptId]: clamEntry, [yara.receipt.payload.receiptId]: yaraEntry },
    consistencyProof: consistency,
    oldCheckpoint,
    newCheckpoint,
    checkpointRegistry,
    trustedCheckpointSignerIds: [x.checkpoint.keyId],
    verifierIdentity: input.verifier ?? x.verifier,
    now: t0,
  });
  return { verdict, x, log, clam, yara, oldCheckpoint, newCheckpoint, consistency };
}

test('valid external scanner receipt binds four exact artifacts', () => { const x = identities(); const b = bundle({ signer: x.clamav, engine: 'CLAMAV' }); assert.equal(b.receipt.payload.artifacts.length, 4); assert.equal(b.receipt.payload.productionAuthority, 'NONE'); });
test('empty scanner artifact is rejected', () => { const x = identities(); const bytes = artifactBytes('x'); bytes.engineLog = Buffer.alloc(0); assert.throws(() => createExternalScannerReceiptV33_26({ signer: x.clamav, evidenceClass: 'SYNTHETIC_CONTRACT_TEST', engine: 'CLAMAV', engineVersion: '1', signatureDatabaseVersion: '1', signatureDatabaseUpdatedAt: t0, operatorOrganizationId: 'o', scannerOrganizationId: 's', operatorHostId: 'oh', scannerHostId: 'sh', packageId: 'p', packageDigest, signatureFeedDigest: feedDigest, result: 'CLEAN', startedAt: t0, completedAt: new Date(t0.getTime()+1), artifactBytesByName: bytes }), /scanner_artifact_invalid/); });
test('invalid package digest is rejected', () => { const x = identities(); assert.throws(() => bundle({ signer: x.clamav, engine: 'CLAMAV', packageDigestOverride: 'bad' }), /scanner_package_digest_invalid/); });
test('scan duration over two hours is rejected', () => { const x = identities(); const bytes = artifactBytes('x'); assert.throws(() => createExternalScannerReceiptV33_26({ signer: x.clamav, evidenceClass: 'SYNTHETIC_CONTRACT_TEST', engine: 'CLAMAV', engineVersion: '1', signatureDatabaseVersion: '1', signatureDatabaseUpdatedAt: t0, operatorOrganizationId: 'o', scannerOrganizationId: 's', operatorHostId: 'oh', scannerHostId: 'sh', packageId: 'p', packageDigest, signatureFeedDigest: feedDigest, result: 'CLEAN', startedAt: t0, completedAt: new Date(t0.getTime()+3*60*60_000), artifactBytesByName: bytes }), /scanner_receipt_time_invalid/); });
test('artifact byte tampering is rejected', () => { const x = identities(); const b: any = bundle({ signer: x.clamav, engine: 'CLAMAV' }); b.artifactBytesByName.engineLog = Buffer.from('tampered'); assert.throws(() => verifyExternalScannerBundleV33_26(b, registry(x.clamav), [x.clamav.keyId], t0), /external_scanner_artifact_bytes_mismatch/); });
test('untrusted scanner signer is rejected', () => { const x = identities(); const b = bundle({ signer: x.attacker, engine: 'CLAMAV' }); assert.throws(() => verifyExternalScannerBundleV33_26(b, registry(x.clamav), [x.clamav.keyId], t0), /external_scanner_receipt_signature_invalid/); });
test('evidence ledger imports and signs receipt', () => { const x = identities(); const l = new ExternalScannerEvidenceLedgerV33_26(registry(x.clamav), [x.clamav.keyId], x.importer, registry(x.importer), [x.importer.keyId]); const r = l.import(bundle({ signer: x.clamav, engine: 'CLAMAV' }), t0); assert.equal(r.payload.exactArtifactBytesVerified, true); assert.equal(l.verifyImportReceipt(r, t0), true); });
test('identical evidence replay is idempotent', () => { const x = identities(); const l = new ExternalScannerEvidenceLedgerV33_26(registry(x.clamav), [x.clamav.keyId], x.importer, registry(x.importer), [x.importer.keyId]); const b = bundle({ signer: x.clamav, engine: 'CLAMAV', receiptId: 'fixed' }); assert.equal(l.import(b, t0).payload.importId, l.import(b, t0).payload.importId); assert.equal(l.records().length, 1); });
test('same receipt id with changed bundle is rejected', () => { const x = identities(); const l = new ExternalScannerEvidenceLedgerV33_26(registry(x.clamav), [x.clamav.keyId], x.importer, registry(x.importer), [x.importer.keyId]); l.import(bundle({ signer: x.clamav, engine: 'CLAMAV', receiptId: 'fixed' }), t0); assert.throws(() => l.import(bundle({ signer: x.clamav, engine: 'CLAMAV', receiptId: 'fixed', result: 'REJECTED' }), t0), /external_scanner_receipt_replay_conflict/); });
test('scanner and importer role overlap is rejected', () => { const x = identities(); assert.throws(() => new ExternalScannerEvidenceLedgerV33_26(registry(x.clamav), [x.clamav.keyId], x.clamav, registry(x.clamav), [x.clamav.keyId]), /scanner_importer_role_overlap/); });
test('feed checkpoint creates signed tree size one', () => { const { log, checkpointRegistry, x } = setupLog(); const cp = log.checkpoint(); assert.equal(cp.payload.treeSize, 1); verifyScannerTransparencyCheckpointV33_26(cp, checkpointRegistry, [x.checkpoint.keyId], t0); });
test('checkpoint chain links previous digest', () => { const { log, x } = setupLog(); const b = bundle({ signer: x.clamav, engine: 'CLAMAV' }); const first = log.checkpoint(); appendBundle(log, x.entry, b, t0); assert.equal(log.checkpoint().payload.previousCheckpointDigest, first.payload.checkpointDigest); });
test('inclusion proof verifies for first leaf', () => { const { log } = setupLog(); assert.equal(verifyScannerTransparencyInclusionProofV33_26(log.inclusionProof(log.entries()[0]!.payload.entryId)), true); });
test('inclusion proof verifies for odd last leaf', () => { const { log, x } = setupLog(); appendBundle(log, x.entry, bundle({ signer: x.clamav, engine: 'CLAMAV' }), t0); const id = appendBundle(log, x.entry, bundle({ signer: x.yara, engine: 'YARA' }), t0); assert.equal(verifyScannerTransparencyInclusionProofV33_26(log.inclusionProof(id)), true); });
test('tampered inclusion proof is rejected', () => { const { log } = setupLog(); const p: any = structuredClone(log.inclusionProof(log.entries()[0]!.payload.entryId)); p.auditPath = ['f'.repeat(64)]; assert.equal(verifyScannerTransparencyInclusionProofV33_26(p), false); });
test('prefix consistency proof verifies', () => { const { log, x } = setupLog(); appendBundle(log, x.entry, bundle({ signer: x.clamav, engine: 'CLAMAV' }), t0); appendBundle(log, x.entry, bundle({ signer: x.yara, engine: 'YARA' }), t0); assert.equal(verifyScannerTransparencyConsistencyProofV33_26(log.consistencyProof(1, 3)), true); });
test('tampered consistency proof is rejected', () => { const { log, x } = setupLog(); appendBundle(log, x.entry, bundle({ signer: x.clamav, engine: 'CLAMAV' }), t0); const p: any = structuredClone(log.consistencyProof(1, 2)); p.appendedLeafHashes[0] = 'f'.repeat(64); assert.equal(verifyScannerTransparencyConsistencyProofV33_26(p), false); });
test('invalid consistency range is rejected', () => { const { log } = setupLog(); assert.throws(() => log.consistencyProof(2, 1), /transparency_consistency_range_invalid/); });
test('untrusted transparency entry is rejected', () => { const { log, x } = setupLog(); const e = createTransparencyEntryV33_26({ signer: x.attacker, kind: 'SCANNER_RECEIPT', subjectId: 'x', subjectDigest: packageDigest, evidenceClass: 'SYNTHETIC_CONTRACT_TEST', now: t0 }); assert.throws(() => log.append(e, t0), /transparency_entry_signature_invalid/); });
test('identical transparency entry replay is idempotent', () => { const { log, x } = setupLog(); const e = createTransparencyEntryV33_26({ signer: x.entry, kind: 'SCANNER_RECEIPT', subjectId: 'x', subjectDigest: packageDigest, evidenceClass: 'SYNTHETIC_CONTRACT_TEST', now: t0, entryId: 'fixed-entry' }); const a = log.append(e, t0); const b = log.append(e, t0); assert.equal(a.payload.checkpointDigest, b.payload.checkpointDigest); assert.equal(log.entries().length, 2); });
test('conflicting transparency replay is rejected', () => { const { log, x } = setupLog(); const a = createTransparencyEntryV33_26({ signer: x.entry, kind: 'SCANNER_RECEIPT', subjectId: 'x', subjectDigest: packageDigest, evidenceClass: 'SYNTHETIC_CONTRACT_TEST', now: t0, entryId: 'fixed-entry' }); const b = createTransparencyEntryV33_26({ signer: x.entry, kind: 'SCANNER_RECEIPT', subjectId: 'x', subjectDigest: feedDigest, evidenceClass: 'SYNTHETIC_CONTRACT_TEST', now: t0, entryId: 'fixed-entry' }); log.append(a, t0); assert.throws(() => log.append(b, t0), /transparency_entry_replay_conflict/); });
test('future emergency revocation is rejected', () => { const { log, x } = setupLog(); const r = createEmergencyFeedRevocationV33_26({ signer: x.revoker, signatureFeedDigest: feedDigest, reason: 'FEED_COMPROMISED', effectiveAt: new Date(t0.getTime()+60_000) }); assert.throws(() => log.appendEmergencyRevocation({ revocation: r, revocationRegistry: registry(x.revoker), trustedRevokerSignerIds: [x.revoker.keyId], entrySigner: x.entry, now: t0 }), /emergency_revocation_not_effective/); });
test('effective emergency revocation is recorded', () => { const { log, x } = setupLog(); const r = createEmergencyFeedRevocationV33_26({ signer: x.revoker, signatureFeedDigest: feedDigest, reason: 'FEED_COMPROMISED', effectiveAt: new Date(t0.getTime()-1) }); log.appendEmergencyRevocation({ revocation: r, revocationRegistry: registry(x.revoker), trustedRevokerSignerIds: [x.revoker.keyId], entrySigner: x.entry, now: t0 }); assert.equal(log.isFeedRevoked(feedDigest), true); });
test('challenge has hard freshness and synthetic boundaries', () => { const x = identities(); const c = createScannerTransparencyChallengeV33_26({ signer: x.challenge, now: t0 }); assert.equal(c.payload.syntheticEvidenceAccepted, false); assert.equal(c.payload.inclusionProofRequired, true); });
test('challenge cannot expire before issuance', () => { const x = identities(); assert.throws(() => createScannerTransparencyChallengeV33_26({ signer: x.challenge, now: t0, expiresAt: new Date(t0.getTime()-1) }), /transparency_challenge_expiry_invalid/); });
test('expired challenge is rejected by qualification', () => { const q = qualification({}); const expired = createScannerTransparencyChallengeV33_26({ signer: q.x.challenge, now: new Date(t0.getTime()-60_000), expiresAt: new Date(t0.getTime()-1) }); assert.throws(() => evaluateExternalScannerTransparencyQualificationV33_26({ challenge: expired, challengeRegistry: registry(q.x.challenge), trustedChallengeSignerIds: [q.x.challenge.keyId], bundles: [q.clam, q.yara], scannerRegistry: registry(q.x.clamav,q.x.yara), trustedScannerSignerIds:[q.x.clamav.keyId,q.x.yara.keyId], transparencyLog:q.log, receiptEntryIds:{ [q.clam.receipt.payload.receiptId]:q.log.entries()[1]!.payload.entryId,[q.yara.receipt.payload.receiptId]:q.log.entries()[2]!.payload.entryId}, consistencyProof:q.consistency, oldCheckpoint:q.oldCheckpoint,newCheckpoint:q.newCheckpoint,checkpointRegistry:registry(q.x.checkpoint),trustedCheckpointSignerIds:[q.x.checkpoint.keyId],verifierIdentity:q.x.verifier,now:t0 }), /transparency_challenge_expired/); });
test('synthetic receipts never qualify', () => { const { verdict } = qualification({ evidenceClass: 'SYNTHETIC_CONTRACT_TEST' }); assert.equal(verdict.payload.status, 'EXTERNAL_SCANNER_TRANSPARENCY_QUALIFICATION_REQUIRED'); assert.equal(verdict.payload.acceptedReceiptCount, 0); });
test('two fresh separated live scanner receipts qualify only for pilot', () => { const { verdict } = qualification({}); assert.equal(verdict.payload.status, 'EXTERNAL_SCANNER_TRANSPARENCY_QUALIFIED_FOR_PILOT'); assert.equal(verdict.payload.acceptedReceiptCount, 2); assert.equal(verdict.payload.eligibleForProductionPromotion, false); });
test('same scanner host is rejected', () => { assert.equal(qualification({ sameHost: true }).verdict.payload.status, 'REJECTED'); });
test('same scanner organization is rejected', () => { assert.equal(qualification({ sameOrg: true }).verdict.payload.status, 'REJECTED'); });
test('stale receipt is rejected', () => { const v = qualification({ staleReceipt: true }).verdict.payload; assert.equal(v.status, 'REJECTED'); assert.equal(v.receiptsFresh, false); });
test('stale signature database is rejected', () => { const v = qualification({ staleDb: true }).verdict.payload; assert.equal(v.status, 'REJECTED'); assert.equal(v.signatureDatabasesFresh, false); });
test('package disagreement is rejected', () => { const v = qualification({ packageMismatch: true }).verdict.payload; assert.equal(v.status, 'REJECTED'); assert.equal(v.exactPackageAgreement, false); });
test('feed disagreement is rejected', () => { const v = qualification({ feedMismatch: true }).verdict.payload; assert.equal(v.status, 'REJECTED'); assert.equal(v.exactFeedAgreement, false); });
test('scanner disagreement is quarantined fail closed', () => { const v = qualification({ yaraResult: 'REJECTED' }).verdict.payload; assert.equal(v.status, 'QUARANTINED_DISAGREEMENT'); assert.equal(v.disagreementFailClosed, true); });
test('emergency feed revocation blocks qualification', () => { const v = qualification({ revoke: true }).verdict.payload; assert.equal(v.status, 'REJECTED'); assert.equal(v.emergencyRevocationAbsent, false); });
test('verifier cannot be a scanner signer', () => { const x = identities(); assert.throws(() => qualification({ verifier: x.clamav }), /transparency_verifier_role_overlap/); });
test('missing receipt transparency entry is rejected', () => { const q = qualification({}); const challenge = createScannerTransparencyChallengeV33_26({ signer:q.x.challenge,now:new Date(t0.getTime()-60_000),expiresAt:new Date(t0.getTime()+60_000) }); assert.throws(() => evaluateExternalScannerTransparencyQualificationV33_26({ challenge,challengeRegistry:registry(q.x.challenge),trustedChallengeSignerIds:[q.x.challenge.keyId],bundles:[q.clam,q.yara],scannerRegistry:registry(q.x.clamav,q.x.yara),trustedScannerSignerIds:[q.x.clamav.keyId,q.x.yara.keyId],transparencyLog:q.log,receiptEntryIds:{},consistencyProof:q.consistency,oldCheckpoint:q.oldCheckpoint,newCheckpoint:q.newCheckpoint,checkpointRegistry:registry(q.x.checkpoint),trustedCheckpointSignerIds:[q.x.checkpoint.keyId],verifierIdentity:q.x.verifier,now:t0 }), /transparency_receipt_entry_missing/); });
test('checkpoint tampering is rejected before qualification', () => { const q = qualification({}); const bad: any = structuredClone(q.newCheckpoint); bad.payload.rootHash = 'f'.repeat(64); assert.throws(() => verifyScannerTransparencyCheckpointV33_26(bad, registry(q.x.checkpoint), [q.x.checkpoint.keyId], t0), /transparency_checkpoint_signature_invalid/); });
