import { randomUUID } from 'node:crypto';
import {
  KeyRegistry,
  sha256,
  sha256Bytes,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';

export type ExternalScannerEngineV33_26 = 'CLAMAV' | 'YARA';
export type ExternalEvidenceClassV33_26 =
  | 'SYNTHETIC_CONTRACT_TEST'
  | 'LIVE_EXTERNAL_SCANNER_EVIDENCE';
export type TransparencyEntryKindV33_26 =
  | 'SIGNATURE_FEED_CHECKPOINT'
  | 'SCANNER_RECEIPT'
  | 'EMERGENCY_FEED_REVOCATION';

export interface ExternalScannerArtifactV33_26 {
  readonly name: 'engineLog' | 'commandOutput' | 'packageManifest' | 'signatureDatabaseMetadata';
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface ExternalScannerReceiptV33_26 {
  readonly version: '33.26';
  readonly receiptId: string;
  readonly evidenceClass: ExternalEvidenceClassV33_26;
  readonly engine: ExternalScannerEngineV33_26;
  readonly engineVersion: string;
  readonly signatureDatabaseVersion: string;
  readonly signatureDatabaseUpdatedAt: string;
  readonly operatorOrganizationId: string;
  readonly scannerOrganizationId: string;
  readonly operatorHostId: string;
  readonly scannerHostId: string;
  readonly packageId: string;
  readonly packageDigest: string;
  readonly signatureFeedDigest: string;
  readonly result: 'CLEAN' | 'REJECTED';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly artifacts: readonly ExternalScannerArtifactV33_26[];
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface ExternalScannerEvidenceBundleV33_26 {
  readonly receipt: SignedEnvelope<ExternalScannerReceiptV33_26>;
  readonly artifactBytesByName: Readonly<Record<ExternalScannerArtifactV33_26['name'], Uint8Array>>;
}

export interface ExternalScannerImportReceiptV33_26 {
  readonly version: '33.26';
  readonly importId: string;
  readonly sourceReceiptId: string;
  readonly sourceReceiptDigest: string;
  readonly sourceSignerId: string;
  readonly artifactCount: number;
  readonly exactArtifactBytesVerified: boolean;
  readonly importedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly importDigest: string;
}

export interface ScannerTransparencyEntryV33_26 {
  readonly version: '33.26';
  readonly entryId: string;
  readonly kind: TransparencyEntryKindV33_26;
  readonly subjectId: string;
  readonly subjectDigest: string;
  readonly evidenceClass: ExternalEvidenceClassV33_26 | 'SIGNED_CONTROL_PLANE_EVENT';
  readonly submittedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly entryDigest: string;
}

export interface ScannerTransparencyCheckpointV33_26 {
  readonly version: '33.26';
  readonly logId: string;
  readonly treeSize: number;
  readonly rootHash: string;
  readonly previousCheckpointDigest: string;
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly checkpointDigest: string;
}

export interface ScannerTransparencyInclusionProofV33_26 {
  readonly version: '33.26';
  readonly logId: string;
  readonly leafIndex: number;
  readonly treeSize: number;
  readonly leafHash: string;
  readonly auditPath: readonly string[];
  readonly rootHash: string;
  readonly checkpointDigest: string;
  readonly proofDigest: string;
}

export interface ScannerTransparencyConsistencyProofV33_26 {
  readonly version: '33.26';
  readonly logId: string;
  readonly proofType: 'FULL_PREFIX_CONSISTENCY_WITNESS';
  readonly oldTreeSize: number;
  readonly newTreeSize: number;
  readonly oldRootHash: string;
  readonly newRootHash: string;
  readonly oldCheckpointDigest: string;
  readonly newCheckpointDigest: string;
  readonly prefixLeafHashes: readonly string[];
  readonly appendedLeafHashes: readonly string[];
  readonly proofDigest: string;
}

export interface EmergencyFeedRevocationV33_26 {
  readonly version: '33.26';
  readonly revocationId: string;
  readonly signatureFeedDigest: string;
  readonly reason: 'FEED_COMPROMISED' | 'PUBLISHER_KEY_COMPROMISED' | 'EMERGENCY_OPERATOR_REVOKED';
  readonly effectiveAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly revocationDigest: string;
}

export interface ScannerTransparencyChallengeV33_26 {
  readonly version: '33.26';
  readonly challengeId: string;
  readonly requiredEngines: readonly ['CLAMAV', 'YARA'];
  readonly minimumScannerOrganizations: 2;
  readonly minimumScannerHosts: 2;
  readonly maximumReceiptAgeMs: number;
  readonly maximumSignatureDatabaseAgeMs: number;
  readonly inclusionProofRequired: true;
  readonly consistencyProofRequired: true;
  readonly syntheticEvidenceAccepted: false;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly challengeDigest: string;
}

export interface ExternalScannerTransparencyQualificationVerdictV33_26 {
  readonly version: '33.26';
  readonly verdictId: string;
  readonly status:
    | 'EXTERNAL_SCANNER_TRANSPARENCY_QUALIFIED_FOR_PILOT'
    | 'EXTERNAL_SCANNER_TRANSPARENCY_QUALIFICATION_REQUIRED'
    | 'QUARANTINED_DISAGREEMENT'
    | 'REJECTED';
  readonly acceptedReceiptCount: number;
  readonly syntheticReceiptCount: number;
  readonly distinctEngineCount: number;
  readonly distinctScannerHostCount: number;
  readonly distinctScannerOrganizationCount: number;
  readonly exactPackageAgreement: boolean;
  readonly exactFeedAgreement: boolean;
  readonly receiptsFresh: boolean;
  readonly signatureDatabasesFresh: boolean;
  readonly transparencyInclusionVerified: boolean;
  readonly transparencyConsistencyVerified: boolean;
  readonly emergencyRevocationAbsent: boolean;
  readonly disagreementFailClosed: boolean;
  readonly eligibleForProductionPromotion: false;
  readonly evaluatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

interface ImportedEvidenceRecordV33_26 {
  readonly bundleDigest: string;
  readonly receipt: SignedEnvelope<ExternalScannerReceiptV33_26>;
  readonly importReceipt: SignedEnvelope<ExternalScannerImportReceiptV33_26>;
}

const ZERO_DIGEST = '0'.repeat(64);
const DEFAULT_RECEIPT_AGE_MS = 24 * 60 * 60_000;
const DEFAULT_DATABASE_AGE_MS = 12 * 60 * 60_000;
const MAX_SCAN_DURATION_MS = 2 * 60 * 60_000;

export function createExternalScannerReceiptV33_26(input: {
  readonly signer: SigningIdentity;
  readonly evidenceClass: ExternalEvidenceClassV33_26;
  readonly engine: ExternalScannerEngineV33_26;
  readonly engineVersion: string;
  readonly signatureDatabaseVersion: string;
  readonly signatureDatabaseUpdatedAt: Date;
  readonly operatorOrganizationId: string;
  readonly scannerOrganizationId: string;
  readonly operatorHostId: string;
  readonly scannerHostId: string;
  readonly packageId: string;
  readonly packageDigest: string;
  readonly signatureFeedDigest: string;
  readonly result: 'CLEAN' | 'REJECTED';
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly artifactBytesByName: Readonly<Record<ExternalScannerArtifactV33_26['name'], Uint8Array>>;
  readonly receiptId?: string;
}): ExternalScannerEvidenceBundleV33_26 {
  const started = input.startedAt.getTime();
  const completed = input.completedAt.getTime();
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started || completed - started > MAX_SCAN_DURATION_MS) {
    throw new Error('scanner_receipt_time_invalid');
  }
  requireDigest(input.packageDigest, 'scanner_package_digest_invalid');
  requireDigest(input.signatureFeedDigest, 'scanner_feed_digest_invalid');
  const requiredNames: readonly ExternalScannerArtifactV33_26['name'][] = [
    'engineLog',
    'commandOutput',
    'packageManifest',
    'signatureDatabaseMetadata',
  ];
  const artifacts = requiredNames.map((name) => {
    const bytes = input.artifactBytesByName[name];
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 4 * 1024 * 1024) {
      throw new Error('scanner_artifact_invalid');
    }
    return { name, sizeBytes: bytes.byteLength, sha256: sha256Bytes(bytes) } as const;
  });
  const material = {
    version: '33.26' as const,
    receiptId: nonEmpty(input.receiptId ?? randomUUID(), 'scanner_receipt_id_required'),
    evidenceClass: input.evidenceClass,
    engine: input.engine,
    engineVersion: nonEmpty(input.engineVersion, 'scanner_engine_version_required'),
    signatureDatabaseVersion: nonEmpty(input.signatureDatabaseVersion, 'signature_database_version_required'),
    signatureDatabaseUpdatedAt: input.signatureDatabaseUpdatedAt.toISOString(),
    operatorOrganizationId: nonEmpty(input.operatorOrganizationId, 'operator_organization_required'),
    scannerOrganizationId: nonEmpty(input.scannerOrganizationId, 'scanner_organization_required'),
    operatorHostId: nonEmpty(input.operatorHostId, 'operator_host_required'),
    scannerHostId: nonEmpty(input.scannerHostId, 'scanner_host_required'),
    packageId: nonEmpty(input.packageId, 'scanner_package_id_required'),
    packageDigest: input.packageDigest,
    signatureFeedDigest: input.signatureFeedDigest,
    result: input.result,
    startedAt: input.startedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
    artifacts,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return {
    receipt: signEnvelope({ ...material, receiptDigest: sha256(material) }, input.signer),
    artifactBytesByName: Object.fromEntries(requiredNames.map((name) => [name, new Uint8Array(input.artifactBytesByName[name])])) as Readonly<Record<ExternalScannerArtifactV33_26['name'], Uint8Array>>,
  };
}

export class ExternalScannerEvidenceLedgerV33_26 {
  readonly #records = new Map<string, ImportedEvidenceRecordV33_26>();
  constructor(
    readonly scannerRegistry: KeyRegistry,
    readonly trustedScannerSignerIds: readonly string[],
    readonly importerIdentity: SigningIdentity,
    readonly importerRegistry: KeyRegistry,
    readonly trustedImporterSignerIds: readonly string[],
  ) {
    unique(trustedScannerSignerIds, 'trusted_scanner_signers_invalid');
    unique(trustedImporterSignerIds, 'trusted_importer_signers_invalid');
    if (trustedScannerSignerIds.includes(importerIdentity.keyId)) throw new Error('scanner_importer_role_overlap');
  }

  import(bundle: ExternalScannerEvidenceBundleV33_26, now: Date = new Date()): SignedEnvelope<ExternalScannerImportReceiptV33_26> {
    verifyExternalScannerBundleV33_26(bundle, this.scannerRegistry, this.trustedScannerSignerIds, now);
    const bundleDigest = sha256({ receipt: bundle.receipt, artifacts: bundle.receipt.payload.artifacts });
    const existing = this.#records.get(bundle.receipt.payload.receiptId);
    if (existing !== undefined) {
      if (existing.bundleDigest !== bundleDigest) throw new Error('external_scanner_receipt_replay_conflict');
      return existing.importReceipt;
    }
    const material = {
      version: '33.26' as const,
      importId: randomUUID(),
      sourceReceiptId: bundle.receipt.payload.receiptId,
      sourceReceiptDigest: bundle.receipt.payload.receiptDigest,
      sourceSignerId: bundle.receipt.issuerKeyId,
      artifactCount: bundle.receipt.payload.artifacts.length,
      exactArtifactBytesVerified: true as const,
      importedAt: now.toISOString(),
      productionAuthority: 'NONE' as const,
      externalEffectsExecuted: 0 as const,
    };
    const importReceipt = signEnvelope({ ...material, importDigest: sha256(material) }, this.importerIdentity);
    this.#records.set(bundle.receipt.payload.receiptId, { bundleDigest, receipt: bundle.receipt, importReceipt });
    return importReceipt;
  }

  records(): readonly ImportedEvidenceRecordV33_26[] {
    return [...this.#records.values()];
  }

  verifyImportReceipt(receipt: SignedEnvelope<ExternalScannerImportReceiptV33_26>, now: Date = new Date()): boolean {
    return this.trustedImporterSignerIds.includes(receipt.issuerKeyId)
      && this.importerRegistry.verifyAt(receipt, now)
      && digestFieldValid(receipt.payload, 'importDigest');
  }
}

export class ScannerTransparencyLogV33_26 {
  readonly #entries: SignedEnvelope<ScannerTransparencyEntryV33_26>[] = [];
  readonly #checkpoints: SignedEnvelope<ScannerTransparencyCheckpointV33_26>[] = [];
  readonly #revokedFeedDigests = new Set<string>();

  constructor(
    readonly logId: string,
    readonly entryRegistry: KeyRegistry,
    readonly trustedEntrySignerIds: readonly string[],
    readonly checkpointIdentity: SigningIdentity,
    readonly checkpointRegistry: KeyRegistry,
    readonly trustedCheckpointSignerIds: readonly string[],
  ) {
    nonEmpty(logId, 'transparency_log_id_required');
    unique(trustedEntrySignerIds, 'transparency_entry_signers_invalid');
    unique(trustedCheckpointSignerIds, 'transparency_checkpoint_signers_invalid');
    if (trustedEntrySignerIds.includes(checkpointIdentity.keyId)) throw new Error('transparency_role_overlap');
  }

  append(entry: SignedEnvelope<ScannerTransparencyEntryV33_26>, now: Date = new Date()): SignedEnvelope<ScannerTransparencyCheckpointV33_26> {
    verifyTransparencyEntryV33_26(entry, this.entryRegistry, this.trustedEntrySignerIds, now);
    if (this.#entries.some((item) => item.payload.entryId === entry.payload.entryId)) {
      const existing = this.#entries.find((item) => item.payload.entryId === entry.payload.entryId)!;
      if (existing.payload.entryDigest !== entry.payload.entryDigest) throw new Error('transparency_entry_replay_conflict');
      return this.#checkpoints[this.#checkpoints.length - 1]!;
    }
    this.#entries.push(entry);
    const rootHash = merkleRoot(this.#entries.map(entryLeafHash));
    const previousCheckpointDigest = this.#checkpoints.length === 0
      ? ZERO_DIGEST
      : this.#checkpoints[this.#checkpoints.length - 1]!.payload.checkpointDigest;
    const material = {
      version: '33.26' as const,
      logId: this.logId,
      treeSize: this.#entries.length,
      rootHash,
      previousCheckpointDigest,
      generatedAt: now.toISOString(),
      productionAuthority: 'NONE' as const,
      externalEffectsExecuted: 0 as const,
    };
    const checkpoint = signEnvelope({ ...material, checkpointDigest: sha256(material) }, this.checkpointIdentity);
    this.#checkpoints.push(checkpoint);
    return checkpoint;
  }

  appendFeedCheckpoint(input: {
    readonly signer: SigningIdentity;
    readonly feedId: string;
    readonly feedDigest: string;
    readonly evidenceClass?: ExternalEvidenceClassV33_26 | 'SIGNED_CONTROL_PLANE_EVENT';
    readonly now?: Date;
  }): SignedEnvelope<ScannerTransparencyCheckpointV33_26> {
    return this.append(createTransparencyEntryV33_26({
      signer: input.signer,
      kind: 'SIGNATURE_FEED_CHECKPOINT',
      subjectId: input.feedId,
      subjectDigest: input.feedDigest,
      evidenceClass: input.evidenceClass ?? 'SIGNED_CONTROL_PLANE_EVENT',
      ...(input.now === undefined ? {} : { now: input.now }),
    }), input.now ?? new Date());
  }

  appendScannerReceipt(input: {
    readonly signer: SigningIdentity;
    readonly receipt: SignedEnvelope<ExternalScannerReceiptV33_26>;
    readonly now?: Date;
  }): SignedEnvelope<ScannerTransparencyCheckpointV33_26> {
    return this.append(createTransparencyEntryV33_26({
      signer: input.signer,
      kind: 'SCANNER_RECEIPT',
      subjectId: input.receipt.payload.receiptId,
      subjectDigest: input.receipt.payload.receiptDigest,
      evidenceClass: input.receipt.payload.evidenceClass,
      ...(input.now === undefined ? {} : { now: input.now }),
    }), input.now ?? new Date());
  }

  appendEmergencyRevocation(input: {
    readonly revocation: SignedEnvelope<EmergencyFeedRevocationV33_26>;
    readonly revocationRegistry: KeyRegistry;
    readonly trustedRevokerSignerIds: readonly string[];
    readonly entrySigner: SigningIdentity;
    readonly now?: Date;
  }): SignedEnvelope<ScannerTransparencyCheckpointV33_26> {
    const at = input.now ?? new Date();
    verifyEmergencyRevocationV33_26(input.revocation, input.revocationRegistry, input.trustedRevokerSignerIds, at);
    this.#revokedFeedDigests.add(input.revocation.payload.signatureFeedDigest);
    return this.append(createTransparencyEntryV33_26({
      signer: input.entrySigner,
      kind: 'EMERGENCY_FEED_REVOCATION',
      subjectId: input.revocation.payload.revocationId,
      subjectDigest: input.revocation.payload.revocationDigest,
      evidenceClass: 'SIGNED_CONTROL_PLANE_EVENT',
      now: at,
    }), at);
  }

  checkpoint(treeSize: number = this.#entries.length): SignedEnvelope<ScannerTransparencyCheckpointV33_26> {
    const checkpoint = this.#checkpoints.find((item) => item.payload.treeSize === treeSize);
    if (checkpoint === undefined) throw new Error('transparency_checkpoint_not_found');
    return checkpoint;
  }

  entries(): readonly SignedEnvelope<ScannerTransparencyEntryV33_26>[] { return [...this.#entries]; }
  checkpoints(): readonly SignedEnvelope<ScannerTransparencyCheckpointV33_26>[] { return [...this.#checkpoints]; }
  isFeedRevoked(feedDigest: string): boolean { return this.#revokedFeedDigests.has(feedDigest); }

  inclusionProof(entryId: string, treeSize: number = this.#entries.length): ScannerTransparencyInclusionProofV33_26 {
    if (!Number.isSafeInteger(treeSize) || treeSize < 1 || treeSize > this.#entries.length) throw new Error('transparency_tree_size_invalid');
    const index = this.#entries.slice(0, treeSize).findIndex((entry) => entry.payload.entryId === entryId);
    if (index < 0) throw new Error('transparency_entry_not_found');
    const hashes = this.#entries.slice(0, treeSize).map(entryLeafHash);
    const checkpoint = this.checkpoint(treeSize);
    const material = {
      version: '33.26' as const,
      logId: this.logId,
      leafIndex: index,
      treeSize,
      leafHash: hashes[index]!,
      auditPath: merkleAuditPath(hashes, index),
      rootHash: checkpoint.payload.rootHash,
      checkpointDigest: checkpoint.payload.checkpointDigest,
    };
    return { ...material, proofDigest: sha256(material) };
  }

  consistencyProof(oldTreeSize: number, newTreeSize: number = this.#entries.length): ScannerTransparencyConsistencyProofV33_26 {
    if (!Number.isSafeInteger(oldTreeSize) || !Number.isSafeInteger(newTreeSize) || oldTreeSize < 1 || oldTreeSize > newTreeSize || newTreeSize > this.#entries.length) {
      throw new Error('transparency_consistency_range_invalid');
    }
    const all = this.#entries.slice(0, newTreeSize).map(entryLeafHash);
    const oldCheckpoint = this.checkpoint(oldTreeSize);
    const newCheckpoint = this.checkpoint(newTreeSize);
    const material = {
      version: '33.26' as const,
      logId: this.logId,
      proofType: 'FULL_PREFIX_CONSISTENCY_WITNESS' as const,
      oldTreeSize,
      newTreeSize,
      oldRootHash: oldCheckpoint.payload.rootHash,
      newRootHash: newCheckpoint.payload.rootHash,
      oldCheckpointDigest: oldCheckpoint.payload.checkpointDigest,
      newCheckpointDigest: newCheckpoint.payload.checkpointDigest,
      prefixLeafHashes: all.slice(0, oldTreeSize),
      appendedLeafHashes: all.slice(oldTreeSize),
    };
    return { ...material, proofDigest: sha256(material) };
  }
}

export function createTransparencyEntryV33_26(input: {
  readonly signer: SigningIdentity;
  readonly kind: TransparencyEntryKindV33_26;
  readonly subjectId: string;
  readonly subjectDigest: string;
  readonly evidenceClass: ExternalEvidenceClassV33_26 | 'SIGNED_CONTROL_PLANE_EVENT';
  readonly now?: Date;
  readonly entryId?: string;
}): SignedEnvelope<ScannerTransparencyEntryV33_26> {
  requireDigest(input.subjectDigest, 'transparency_subject_digest_invalid');
  const material = {
    version: '33.26' as const,
    entryId: nonEmpty(input.entryId ?? randomUUID(), 'transparency_entry_id_required'),
    kind: input.kind,
    subjectId: nonEmpty(input.subjectId, 'transparency_subject_id_required'),
    subjectDigest: input.subjectDigest,
    evidenceClass: input.evidenceClass,
    submittedAt: (input.now ?? new Date()).toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, entryDigest: sha256(material) }, input.signer);
}

export function createEmergencyFeedRevocationV33_26(input: {
  readonly signer: SigningIdentity;
  readonly signatureFeedDigest: string;
  readonly reason: EmergencyFeedRevocationV33_26['reason'];
  readonly effectiveAt: Date;
  readonly revocationId?: string;
}): SignedEnvelope<EmergencyFeedRevocationV33_26> {
  requireDigest(input.signatureFeedDigest, 'revocation_feed_digest_invalid');
  const material = {
    version: '33.26' as const,
    revocationId: nonEmpty(input.revocationId ?? randomUUID(), 'revocation_id_required'),
    signatureFeedDigest: input.signatureFeedDigest,
    reason: input.reason,
    effectiveAt: input.effectiveAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, revocationDigest: sha256(material) }, input.signer);
}

export function createScannerTransparencyChallengeV33_26(input: {
  readonly signer: SigningIdentity;
  readonly now?: Date;
  readonly expiresAt?: Date;
  readonly challengeId?: string;
  readonly maximumReceiptAgeMs?: number;
  readonly maximumSignatureDatabaseAgeMs?: number;
}): SignedEnvelope<ScannerTransparencyChallengeV33_26> {
  const now = input.now ?? new Date();
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + 30 * 24 * 60 * 60_000);
  if (expiresAt.getTime() <= now.getTime()) throw new Error('transparency_challenge_expiry_invalid');
  const material = {
    version: '33.26' as const,
    challengeId: nonEmpty(input.challengeId ?? 'external-scanner-transparency-v33.26', 'challenge_id_required'),
    requiredEngines: ['CLAMAV', 'YARA'] as const,
    minimumScannerOrganizations: 2 as const,
    minimumScannerHosts: 2 as const,
    maximumReceiptAgeMs: boundedInteger(input.maximumReceiptAgeMs ?? DEFAULT_RECEIPT_AGE_MS, 60_000, 7 * 24 * 60 * 60_000, 'challenge_receipt_age_invalid'),
    maximumSignatureDatabaseAgeMs: boundedInteger(input.maximumSignatureDatabaseAgeMs ?? DEFAULT_DATABASE_AGE_MS, 60_000, 7 * 24 * 60 * 60_000, 'challenge_database_age_invalid'),
    inclusionProofRequired: true as const,
    consistencyProofRequired: true as const,
    syntheticEvidenceAccepted: false as const,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, challengeDigest: sha256(material) }, input.signer);
}

export function evaluateExternalScannerTransparencyQualificationV33_26(input: {
  readonly challenge: SignedEnvelope<ScannerTransparencyChallengeV33_26>;
  readonly challengeRegistry: KeyRegistry;
  readonly trustedChallengeSignerIds: readonly string[];
  readonly bundles: readonly ExternalScannerEvidenceBundleV33_26[];
  readonly scannerRegistry: KeyRegistry;
  readonly trustedScannerSignerIds: readonly string[];
  readonly transparencyLog: ScannerTransparencyLogV33_26;
  readonly receiptEntryIds: Readonly<Record<string, string>>;
  readonly consistencyProof: ScannerTransparencyConsistencyProofV33_26;
  readonly oldCheckpoint: SignedEnvelope<ScannerTransparencyCheckpointV33_26>;
  readonly newCheckpoint: SignedEnvelope<ScannerTransparencyCheckpointV33_26>;
  readonly checkpointRegistry: KeyRegistry;
  readonly trustedCheckpointSignerIds: readonly string[];
  readonly verifierIdentity: SigningIdentity;
  readonly now?: Date;
}): SignedEnvelope<ExternalScannerTransparencyQualificationVerdictV33_26> {
  const now = input.now ?? new Date();
  verifyChallenge(input.challenge, input.challengeRegistry, input.trustedChallengeSignerIds, now);
  verifyScannerTransparencyCheckpointV33_26(input.oldCheckpoint, input.checkpointRegistry, input.trustedCheckpointSignerIds, now);
  verifyScannerTransparencyCheckpointV33_26(input.newCheckpoint, input.checkpointRegistry, input.trustedCheckpointSignerIds, now);
  if (input.oldCheckpoint.payload.checkpointDigest !== input.consistencyProof.oldCheckpointDigest
    || input.newCheckpoint.payload.checkpointDigest !== input.consistencyProof.newCheckpointDigest
    || input.oldCheckpoint.payload.rootHash !== input.consistencyProof.oldRootHash
    || input.newCheckpoint.payload.rootHash !== input.consistencyProof.newRootHash
    || input.oldCheckpoint.payload.treeSize !== input.consistencyProof.oldTreeSize
    || input.newCheckpoint.payload.treeSize !== input.consistencyProof.newTreeSize) {
    throw new Error('transparency_checkpoint_proof_binding_invalid');
  }
  if (input.trustedScannerSignerIds.includes(input.verifierIdentity.keyId) || input.trustedChallengeSignerIds.includes(input.verifierIdentity.keyId)) {
    throw new Error('transparency_verifier_role_overlap');
  }
  const verified = input.bundles.map((bundle) => {
    verifyExternalScannerBundleV33_26(bundle, input.scannerRegistry, input.trustedScannerSignerIds, now);
    const entryId = input.receiptEntryIds[bundle.receipt.payload.receiptId];
    if (entryId === undefined) throw new Error('transparency_receipt_entry_missing');
    const proof = input.transparencyLog.inclusionProof(entryId);
    if (!verifyScannerTransparencyInclusionProofV33_26(proof)) throw new Error('transparency_inclusion_invalid');
    return { bundle, proof };
  });
  const consistencyVerified = verifyScannerTransparencyConsistencyProofV33_26(input.consistencyProof);
  if (!consistencyVerified) throw new Error('transparency_consistency_invalid');
  const receipts = verified.map((item) => item.bundle.receipt.payload);
  const live = receipts.filter((receipt) => receipt.evidenceClass === 'LIVE_EXTERNAL_SCANNER_EVIDENCE');
  const syntheticReceiptCount = receipts.length - live.length;
  const distinctEngineCount = new Set(live.map((receipt) => receipt.engine)).size;
  const distinctScannerHostCount = new Set(live.map((receipt) => receipt.scannerHostId)).size;
  const distinctScannerOrganizationCount = new Set(live.map((receipt) => receipt.scannerOrganizationId)).size;
  const exactPackageAgreement = live.length > 0 && new Set(live.map((receipt) => `${receipt.packageId}:${receipt.packageDigest}`)).size === 1;
  const exactFeedAgreement = live.length > 0 && new Set(live.map((receipt) => receipt.signatureFeedDigest)).size === 1;
  const receiptsFresh = live.length > 0 && live.every((receipt) => now.getTime() - Date.parse(receipt.completedAt) <= input.challenge.payload.maximumReceiptAgeMs && now.getTime() >= Date.parse(receipt.completedAt));
  const signatureDatabasesFresh = live.length > 0 && live.every((receipt) => now.getTime() - Date.parse(receipt.signatureDatabaseUpdatedAt) <= input.challenge.payload.maximumSignatureDatabaseAgeMs && now.getTime() >= Date.parse(receipt.signatureDatabaseUpdatedAt));
  const emergencyRevocationAbsent = live.every((receipt) => !input.transparencyLog.isFeedRevoked(receipt.signatureFeedDigest));
  const disagreement = live.length >= 2 && new Set(live.map((receipt) => receipt.result)).size > 1;
  const structuralReady = live.length >= 2
    && distinctEngineCount === 2
    && distinctScannerHostCount >= input.challenge.payload.minimumScannerHosts
    && distinctScannerOrganizationCount >= input.challenge.payload.minimumScannerOrganizations
    && exactPackageAgreement
    && exactFeedAgreement
    && receiptsFresh
    && signatureDatabasesFresh
    && emergencyRevocationAbsent
    && verified.every(({ proof }) => verifyScannerTransparencyInclusionProofV33_26(proof))
    && consistencyVerified;
  let status: ExternalScannerTransparencyQualificationVerdictV33_26['status'];
  if (disagreement) status = 'QUARANTINED_DISAGREEMENT';
  else if (structuralReady && live.every((receipt) => receipt.result === 'CLEAN')) status = 'EXTERNAL_SCANNER_TRANSPARENCY_QUALIFIED_FOR_PILOT';
  else if (syntheticReceiptCount > 0 || live.length < 2) status = 'EXTERNAL_SCANNER_TRANSPARENCY_QUALIFICATION_REQUIRED';
  else status = 'REJECTED';
  const material = {
    version: '33.26' as const,
    verdictId: randomUUID(),
    status,
    acceptedReceiptCount: status === 'EXTERNAL_SCANNER_TRANSPARENCY_QUALIFIED_FOR_PILOT' ? live.length : 0,
    syntheticReceiptCount,
    distinctEngineCount,
    distinctScannerHostCount,
    distinctScannerOrganizationCount,
    exactPackageAgreement,
    exactFeedAgreement,
    receiptsFresh,
    signatureDatabasesFresh,
    transparencyInclusionVerified: verified.every(({ proof }) => verifyScannerTransparencyInclusionProofV33_26(proof)),
    transparencyConsistencyVerified: consistencyVerified,
    emergencyRevocationAbsent,
    disagreementFailClosed: !disagreement || status === 'QUARANTINED_DISAGREEMENT',
    eligibleForProductionPromotion: false as const,
    evaluatedAt: now.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, verdictDigest: sha256(material) }, input.verifierIdentity);
}


export function verifyScannerTransparencyCheckpointV33_26(
  checkpoint: SignedEnvelope<ScannerTransparencyCheckpointV33_26>,
  registry: KeyRegistry,
  trustedSignerIds: readonly string[],
  now: Date = new Date(),
): void {
  if (!trustedSignerIds.includes(checkpoint.issuerKeyId) || !registry.verifyAt(checkpoint, now)) throw new Error('transparency_checkpoint_signature_invalid');
  if (!digestFieldValid(checkpoint.payload, 'checkpointDigest')) throw new Error('transparency_checkpoint_digest_invalid');
  if (!isDigest(checkpoint.payload.rootHash) || !isDigest(checkpoint.payload.previousCheckpointDigest)) throw new Error('transparency_checkpoint_hash_invalid');
  if (!Number.isSafeInteger(checkpoint.payload.treeSize) || checkpoint.payload.treeSize < 1) throw new Error('transparency_checkpoint_tree_size_invalid');
  if (checkpoint.payload.productionAuthority !== 'NONE' || checkpoint.payload.externalEffectsExecuted !== 0) throw new Error('transparency_checkpoint_boundary_invalid');
}

export function verifyScannerTransparencyInclusionProofV33_26(proof: ScannerTransparencyInclusionProofV33_26): boolean {
  if (!digestFieldValid(proof, 'proofDigest') || !isDigest(proof.leafHash) || !isDigest(proof.rootHash)) return false;
  if (!Number.isSafeInteger(proof.leafIndex) || !Number.isSafeInteger(proof.treeSize) || proof.leafIndex < 0 || proof.leafIndex >= proof.treeSize) return false;
  let hash = proof.leafHash;
  let index = proof.leafIndex;
  let width = proof.treeSize;
  for (const sibling of proof.auditPath) {
    if (!isDigest(sibling)) return false;
    if (index % 2 === 1) hash = nodeHash(sibling, hash);
    else if (index + 1 < width) hash = nodeHash(hash, sibling);
    else hash = nodeHash(hash, hash);
    index = Math.floor(index / 2);
    width = Math.ceil(width / 2);
  }
  return hash === proof.rootHash;
}

export function verifyScannerTransparencyConsistencyProofV33_26(proof: ScannerTransparencyConsistencyProofV33_26): boolean {
  if (!digestFieldValid(proof, 'proofDigest') || proof.proofType !== 'FULL_PREFIX_CONSISTENCY_WITNESS') return false;
  if (proof.oldTreeSize < 1 || proof.oldTreeSize > proof.newTreeSize) return false;
  if (proof.prefixLeafHashes.length !== proof.oldTreeSize || proof.prefixLeafHashes.length + proof.appendedLeafHashes.length !== proof.newTreeSize) return false;
  if (![...proof.prefixLeafHashes, ...proof.appendedLeafHashes].every(isDigest)) return false;
  return merkleRoot(proof.prefixLeafHashes) === proof.oldRootHash
    && merkleRoot([...proof.prefixLeafHashes, ...proof.appendedLeafHashes]) === proof.newRootHash;
}

export function verifyExternalScannerBundleV33_26(
  bundle: ExternalScannerEvidenceBundleV33_26,
  registry: KeyRegistry,
  trustedSignerIds: readonly string[],
  now: Date = new Date(),
): void {
  const receipt = bundle.receipt;
  if (!trustedSignerIds.includes(receipt.issuerKeyId) || !registry.verifyAt(receipt, now)) throw new Error('external_scanner_receipt_signature_invalid');
  if (!digestFieldValid(receipt.payload, 'receiptDigest')) throw new Error('external_scanner_receipt_digest_invalid');
  if (receipt.payload.productionAuthority !== 'NONE' || receipt.payload.externalEffectsExecuted !== 0) throw new Error('external_scanner_receipt_boundary_invalid');
  if (receipt.payload.artifacts.length !== 4 || new Set(receipt.payload.artifacts.map((item) => item.name)).size !== 4) throw new Error('external_scanner_artifact_manifest_invalid');
  for (const artifact of receipt.payload.artifacts) {
    const bytes = bundle.artifactBytesByName[artifact.name];
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== artifact.sizeBytes || sha256Bytes(bytes) !== artifact.sha256) {
      throw new Error('external_scanner_artifact_bytes_mismatch');
    }
  }
}

function verifyTransparencyEntryV33_26(
  entry: SignedEnvelope<ScannerTransparencyEntryV33_26>,
  registry: KeyRegistry,
  trustedSignerIds: readonly string[],
  now: Date,
): void {
  if (!trustedSignerIds.includes(entry.issuerKeyId) || !registry.verifyAt(entry, now)) throw new Error('transparency_entry_signature_invalid');
  if (!digestFieldValid(entry.payload, 'entryDigest')) throw new Error('transparency_entry_digest_invalid');
  requireDigest(entry.payload.subjectDigest, 'transparency_subject_digest_invalid');
  if (entry.payload.productionAuthority !== 'NONE' || entry.payload.externalEffectsExecuted !== 0) throw new Error('transparency_entry_boundary_invalid');
}

function verifyEmergencyRevocationV33_26(
  revocation: SignedEnvelope<EmergencyFeedRevocationV33_26>,
  registry: KeyRegistry,
  trustedSignerIds: readonly string[],
  now: Date,
): void {
  if (!trustedSignerIds.includes(revocation.issuerKeyId) || !registry.verifyAt(revocation, now)) throw new Error('emergency_revocation_signature_invalid');
  if (!digestFieldValid(revocation.payload, 'revocationDigest')) throw new Error('emergency_revocation_digest_invalid');
  requireDigest(revocation.payload.signatureFeedDigest, 'revocation_feed_digest_invalid');
  if (Date.parse(revocation.payload.effectiveAt) > now.getTime()) throw new Error('emergency_revocation_not_effective');
}

function verifyChallenge(
  challenge: SignedEnvelope<ScannerTransparencyChallengeV33_26>,
  registry: KeyRegistry,
  trustedSignerIds: readonly string[],
  now: Date,
): void {
  if (!trustedSignerIds.includes(challenge.issuerKeyId) || !registry.verifyAt(challenge, now)) throw new Error('transparency_challenge_signature_invalid');
  if (!digestFieldValid(challenge.payload, 'challengeDigest')) throw new Error('transparency_challenge_digest_invalid');
  if (Date.parse(challenge.payload.issuedAt) > now.getTime() || Date.parse(challenge.payload.expiresAt) <= now.getTime()) throw new Error('transparency_challenge_expired');
  if (challenge.payload.syntheticEvidenceAccepted !== false || challenge.payload.productionAuthority !== 'NONE') throw new Error('transparency_challenge_boundary_invalid');
}

function entryLeafHash(entry: SignedEnvelope<ScannerTransparencyEntryV33_26>): string {
  return sha256({ domain: 'V33.26_TRANSPARENCY_LEAF', entry });
}

function merkleRoot(hashes: readonly string[]): string {
  if (hashes.length === 0) return ZERO_DIGEST;
  let level = [...hashes];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(nodeHash(level[i]!, level[i + 1] ?? level[i]!));
    }
    level = next;
  }
  return level[0]!;
}

function merkleAuditPath(hashes: readonly string[], targetIndex: number): readonly string[] {
  let level = [...hashes];
  let index = targetIndex;
  const path: string[] = [];
  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    path.push(level[siblingIndex] ?? level[index]!);
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(nodeHash(level[i]!, level[i + 1] ?? level[i]!));
    index = Math.floor(index / 2);
    level = next;
  }
  return path;
}

function nodeHash(left: string, right: string): string {
  return sha256({ domain: 'V33.26_TRANSPARENCY_NODE', left, right });
}

function digestFieldValid(payload: object, field: string): boolean {
  const record = payload as Record<string, unknown>;
  const digest = record[field];
  if (!isDigest(digest)) return false;
  const material: Record<string, unknown> = { ...record };
  delete material[field];
  return sha256(material) === digest;
}

function requireDigest(value: string, code: string): string {
  if (!isDigest(value)) throw new Error(code);
  return value;
}
function isDigest(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
function nonEmpty(value: string, code: string): string { const normalized = value.trim(); if (normalized === '') throw new Error(code); return normalized; }
function unique(values: readonly string[], code: string): readonly string[] { if (values.length === 0 || new Set(values).size !== values.length) throw new Error(code); return [...values]; }
function boundedInteger(value: number, min: number, max: number, code: string): number { if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(code); return value; }
