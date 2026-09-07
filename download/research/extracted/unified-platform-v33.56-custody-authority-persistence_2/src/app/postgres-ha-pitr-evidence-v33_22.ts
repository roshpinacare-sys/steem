import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  KeyRegistry,
  sha256,
  sha256Bytes,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';
import { postgresMigrationChainDigestV33_21 } from './postgres-durable-authority-v33_21.js';

export type PostgresHaPitrEvidenceClassV33_22 =
  | 'SYNTHETIC_CONTRACT_TEST'
  | 'LIVE_EXTERNAL_POSTGRESQL_HA_PITR_BUNDLE';

export type PostgresHaPitrOperatorRoleV33_22 = 'HA_OPERATOR' | 'PITR_OPERATOR';

export type PostgresHaPitrArtifactKindV33_22 =
  | 'SERVER_FACTS'
  | 'TLS_SESSION'
  | 'FAILOVER_TRANSCRIPT'
  | 'FENCE_TRACE'
  | 'OUTBOX_TRACE'
  | 'BACKUP_MANIFEST'
  | 'RESTORE_TRANSCRIPT'
  | 'PITR_RECOVERY_TRACE'
  | 'WITNESS_TRACE'
  | 'RPO_RTO_MEASUREMENT';

export interface PostgresHaPitrArtifactInputV33_22 {
  readonly path: string;
  readonly kind: PostgresHaPitrArtifactKindV33_22;
  readonly mediaType: 'application/json' | 'text/plain' | 'application/sql' | 'application/octet-stream';
  readonly bytes: Uint8Array;
  readonly collectedAt: string;
}

export interface PostgresHaPitrArtifactRecordV33_22 {
  readonly path: string;
  readonly kind: PostgresHaPitrArtifactKindV33_22;
  readonly mediaType: PostgresHaPitrArtifactInputV33_22['mediaType'];
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly collectedAt: string;
}

export interface PostgresHaFailoverReceiptV33_22 {
  readonly version: '33.22';
  readonly kind: 'HA_FAILOVER';
  readonly sourceTimelineId: number;
  readonly promotedTimelineId: number;
  readonly baselineFenceToken: number;
  readonly postFailoverFenceToken: number;
  readonly singleWriterCount: 1;
  readonly oldPrimaryWriteRejected: boolean;
  readonly outboxGapCount: number;
  readonly outboxDuplicateCount: number;
  readonly rtoMs: number;
  readonly rpoMs: number;
  readonly tlsVerifyFull: boolean;
  readonly noEmbeddedSecrets: boolean;
  readonly recordedAt: string;
  readonly receiptDigest: string;
}

export interface PostgresPitrRecoveryReceiptV33_22 {
  readonly version: '33.22';
  readonly kind: 'PITR_RECOVERY';
  readonly sourceTimelineId: number;
  readonly recoveryTimelineId: number;
  readonly sourceFenceToken: number;
  readonly restoredFenceToken: number;
  readonly backupManifestVerified: boolean;
  readonly restoreIsolated: boolean;
  readonly recoveryTargetAt: string;
  readonly recoveryReachedAt: string;
  readonly recoveryTargetReached: boolean;
  readonly witnessRollbackRejected: boolean;
  readonly outboxGapCount: number;
  readonly outboxDuplicateCount: number;
  readonly rtoMs: number;
  readonly rpoMs: number;
  readonly tlsVerifyFull: boolean;
  readonly noEmbeddedSecrets: boolean;
  readonly recordedAt: string;
  readonly receiptDigest: string;
}

export type PostgresHaPitrOperationalReceiptV33_22 =
  | PostgresHaFailoverReceiptV33_22
  | PostgresPitrRecoveryReceiptV33_22;

export type PostgresHaPitrOperationalReceiptInputV33_22 =
  | Omit<PostgresHaFailoverReceiptV33_22, 'version' | 'receiptDigest'>
  | Omit<PostgresPitrRecoveryReceiptV33_22, 'version' | 'receiptDigest'>;

export interface PostgresHaPitrChallengeV33_22 {
  readonly version: '33.22';
  readonly challengeId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly migrationChainDigest: string;
  readonly minimumServerVersionNum: number;
  readonly maximumRtoMs: number;
  readonly maximumRpoMs: number;
  readonly requiredIndependentOperators: 2;
  readonly requiredIndependentHosts: 2;
  readonly requiredRoles: readonly ['HA_OPERATOR', 'PITR_OPERATOR'];
  readonly requiredArtifactKinds: Readonly<Record<PostgresHaPitrOperatorRoleV33_22, readonly PostgresHaPitrArtifactKindV33_22[]>>;
  readonly syntheticEvidenceAccepted: false;
  readonly sameHostEvidenceAccepted: false;
  readonly maximumArtifactCountPerBundle: number;
  readonly maximumArtifactBytesPerBundle: number;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly challengeDigest: string;
}

export interface PostgresHaPitrEvidenceBundleV33_22 {
  readonly version: '33.22';
  readonly bundleId: string;
  readonly challengeId: string;
  readonly evidenceClass: PostgresHaPitrEvidenceClassV33_22;
  readonly operatorRole: PostgresHaPitrOperatorRoleV33_22;
  readonly operatorOrganizationId: string;
  readonly operatorSignerId: string;
  readonly operatorHostId: string;
  readonly sourceHostId: string;
  readonly targetHostId: string;
  readonly sourceClusterId: string;
  readonly sourceDatabaseSystemIdentifier: string;
  readonly serverVersionNum: number;
  readonly migrationChainDigest: string;
  readonly operationalReceipt: PostgresHaPitrOperationalReceiptV33_22;
  readonly artifactManifest: readonly PostgresHaPitrArtifactRecordV33_22[];
  readonly artifactManifestDigest: string;
  readonly totalArtifactBytes: number;
  readonly collectedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly bundleDigest: string;
}

export interface PostgresHaPitrBundlePackageV33_22 {
  readonly envelope: SignedEnvelope<PostgresHaPitrEvidenceBundleV33_22>;
  readonly artifactBytesByPath: Readonly<Record<string, Uint8Array>>;
}

export interface PostgresEvidenceImportReceiptV33_22 {
  readonly version: '33.22';
  readonly importId: string;
  readonly bundleId: string;
  readonly bundleDigest: string;
  readonly challengeId: string;
  readonly operatorSignerId: string;
  readonly evidenceClass: PostgresHaPitrEvidenceClassV33_22;
  readonly operatorRole: PostgresHaPitrOperatorRoleV33_22;
  readonly artifactCount: number;
  readonly artifactBytes: number;
  readonly artifactManifestDigest: string;
  readonly eligibleForExternalQualification: boolean;
  readonly importedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface PostgresEvidenceImportEventV33_22 {
  readonly version: '33.22';
  readonly eventId: string;
  readonly sequence: number;
  readonly eventType: 'BUNDLE_IMPORTED';
  readonly bundleId: string;
  readonly bundleDigest: string;
  readonly receiptDigest: string;
  readonly occurredAt: string;
  readonly previousEventDigest: string;
  readonly externalEffectsExecuted: 0;
  readonly eventDigest: string;
}

export interface ImportedPostgresEvidenceBundleV33_22 {
  readonly bundle: SignedEnvelope<PostgresHaPitrEvidenceBundleV33_22>;
  readonly importReceipt: SignedEnvelope<PostgresEvidenceImportReceiptV33_22>;
}

export interface PostgresEvidenceImportSnapshotV33_22 {
  readonly version: '33.22';
  readonly imports: readonly ImportedPostgresEvidenceBundleV33_22[];
  readonly events: readonly PostgresEvidenceImportEventV33_22[];
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export interface PostgresHaPitrQualificationVerdictV33_22 {
  readonly version: '33.22';
  readonly verdictId: string;
  readonly challengeId: string;
  readonly status: 'EXTERNAL_HA_PITR_QUALIFICATION_REQUIRED' | 'QUALIFIED_FOR_EXTERNAL_HA_PITR_PILOT';
  readonly acceptedBundleIds: readonly string[];
  readonly rejectedBundleIds: readonly string[];
  readonly distinctOperatorOrganizations: number;
  readonly distinctOperatorHosts: number;
  readonly rolesSatisfied: readonly PostgresHaPitrOperatorRoleV33_22[];
  readonly sourceClusterId: string | null;
  readonly sourceDatabaseSystemIdentifier: string | null;
  readonly maximumObservedFenceToken: number;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

export interface PostgresHaPitrTrustV33_22 {
  readonly challengeRegistry: KeyRegistry;
  readonly trustedChallengeSignerIds: readonly string[];
  readonly operatorRegistry: KeyRegistry;
  readonly trustedOperatorSignerIds: readonly string[];
  readonly importerRegistry: KeyRegistry;
  readonly trustedImporterSignerIds: readonly string[];
  readonly verifierRegistry: KeyRegistry;
  readonly trustedVerifierSignerIds: readonly string[];
}

const REQUIRED_ARTIFACTS: PostgresHaPitrChallengeV33_22['requiredArtifactKinds'] = {
  HA_OPERATOR: [
    'SERVER_FACTS',
    'TLS_SESSION',
    'FAILOVER_TRANSCRIPT',
    'FENCE_TRACE',
    'OUTBOX_TRACE',
    'RPO_RTO_MEASUREMENT',
  ],
  PITR_OPERATOR: [
    'SERVER_FACTS',
    'TLS_SESSION',
    'BACKUP_MANIFEST',
    'RESTORE_TRANSCRIPT',
    'PITR_RECOVERY_TRACE',
    'WITNESS_TRACE',
    'RPO_RTO_MEASUREMENT',
  ],
};

export function issuePostgresHaPitrChallengeV33_22(input: {
  readonly signer: SigningIdentity;
  readonly now?: Date;
  readonly expiresInMs?: number;
  readonly maximumRtoMs?: number;
  readonly maximumRpoMs?: number;
}): SignedEnvelope<PostgresHaPitrChallengeV33_22> {
  const now = input.now ?? new Date();
  const expiresInMs = boundedInteger(input.expiresInMs ?? 14 * 24 * 60 * 60 * 1_000, 60_000, 45 * 24 * 60 * 60 * 1_000, 'ha_pitr_challenge_expiry_invalid');
  const material = {
    version: '33.22' as const,
    challengeId: `postgres-ha-pitr-challenge-${randomUUID()}`,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + expiresInMs).toISOString(),
    migrationChainDigest: postgresMigrationChainDigestV33_21(),
    minimumServerVersionNum: 150000,
    maximumRtoMs: boundedInteger(input.maximumRtoMs ?? 300_000, 1_000, 3_600_000, 'maximum_rto_invalid'),
    maximumRpoMs: boundedInteger(input.maximumRpoMs ?? 60_000, 0, 3_600_000, 'maximum_rpo_invalid'),
    requiredIndependentOperators: 2 as const,
    requiredIndependentHosts: 2 as const,
    requiredRoles: ['HA_OPERATOR', 'PITR_OPERATOR'] as const,
    requiredArtifactKinds: structuredClone(REQUIRED_ARTIFACTS),
    syntheticEvidenceAccepted: false as const,
    sameHostEvidenceAccepted: false as const,
    maximumArtifactCountPerBundle: 20,
    maximumArtifactBytesPerBundle: 20 * 1024 * 1024,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, challengeDigest: sha256(material) }, input.signer);
}

export function issuePostgresHaPitrEvidenceBundleV33_22(input: {
  readonly challenge: SignedEnvelope<PostgresHaPitrChallengeV33_22>;
  readonly signer: SigningIdentity;
  readonly evidenceClass: PostgresHaPitrEvidenceClassV33_22;
  readonly operatorRole: PostgresHaPitrOperatorRoleV33_22;
  readonly operatorOrganizationId: string;
  readonly operatorHostId: string;
  readonly sourceHostId: string;
  readonly targetHostId: string;
  readonly sourceClusterId: string;
  readonly sourceDatabaseSystemIdentifier: string;
  readonly serverVersionNum: number;
  readonly operationalReceipt: PostgresHaPitrOperationalReceiptInputV33_22;
  readonly artifacts: readonly PostgresHaPitrArtifactInputV33_22[];
  readonly now?: Date;
}): PostgresHaPitrBundlePackageV33_22 {
  const now = input.now ?? new Date();
  const challenge = input.challenge.payload;
  verifyChallengePayload(challenge);
  if (input.operationalReceipt.kind === 'HA_FAILOVER' && input.operatorRole !== 'HA_OPERATOR') throw new Error('ha_pitr_role_receipt_mismatch');
  if (input.operationalReceipt.kind === 'PITR_RECOVERY' && input.operatorRole !== 'PITR_OPERATOR') throw new Error('ha_pitr_role_receipt_mismatch');
  const operationalReceipt = buildOperationalReceipt(input.operationalReceipt);
  verifyOperationalReceipt(operationalReceipt, challenge);
  const manifest = buildArtifactManifest(input.artifacts, challenge);
  verifyRequiredArtifactKinds(input.operatorRole, manifest, challenge);
  const artifactBytesByPath: Record<string, Uint8Array> = {};
  for (const artifact of input.artifacts) artifactBytesByPath[artifact.path] = new Uint8Array(artifact.bytes);
  const totalArtifactBytes = manifest.reduce((sum, item) => sum + item.sizeBytes, 0);
  const material = {
    version: '33.22' as const,
    bundleId: `postgres-ha-pitr-bundle-${randomUUID()}`,
    challengeId: challenge.challengeId,
    evidenceClass: input.evidenceClass,
    operatorRole: input.operatorRole,
    operatorOrganizationId: nonEmpty(input.operatorOrganizationId, 'operator_organization_required'),
    operatorSignerId: input.signer.keyId,
    operatorHostId: nonEmpty(input.operatorHostId, 'operator_host_required'),
    sourceHostId: nonEmpty(input.sourceHostId, 'source_host_required'),
    targetHostId: nonEmpty(input.targetHostId, 'target_host_required'),
    sourceClusterId: nonEmpty(input.sourceClusterId, 'source_cluster_required'),
    sourceDatabaseSystemIdentifier: nonEmpty(input.sourceDatabaseSystemIdentifier, 'database_system_identifier_required'),
    serverVersionNum: boundedInteger(input.serverVersionNum, 1, 99_999_999, 'server_version_invalid'),
    migrationChainDigest: challenge.migrationChainDigest,
    operationalReceipt,
    artifactManifest: manifest,
    artifactManifestDigest: sha256(manifest),
    totalArtifactBytes,
    collectedAt: now.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return {
    envelope: signEnvelope({ ...material, bundleDigest: sha256(material) }, input.signer),
    artifactBytesByPath,
  };
}

export class PostgresEvidenceImportLedgerV33_22 {
  readonly #path: string;
  readonly #lockPath: string;
  readonly #storeIdentity: SigningIdentity;
  readonly #storeRegistry: KeyRegistry;
  readonly #trustedStoreSignerIds: readonly string[];
  readonly #importerIdentity: SigningIdentity;
  readonly #trust: PostgresHaPitrTrustV33_22;
  #snapshot: PostgresEvidenceImportSnapshotV33_22;

  constructor(input: {
    readonly path: string;
    readonly storeIdentity: SigningIdentity;
    readonly storeRegistry: KeyRegistry;
    readonly trustedStoreSignerIds: readonly string[];
    readonly importerIdentity: SigningIdentity;
    readonly trust: PostgresHaPitrTrustV33_22;
    readonly now?: Date;
  }) {
    this.#path = resolve(nonEmpty(input.path, 'evidence_ledger_path_required'));
    this.#lockPath = `${this.#path}.lock`;
    this.#storeIdentity = input.storeIdentity;
    this.#storeRegistry = input.storeRegistry;
    this.#trustedStoreSignerIds = unique(input.trustedStoreSignerIds, 'duplicate_store_signer');
    this.#importerIdentity = input.importerIdentity;
    this.#trust = input.trust;
    if (!this.#trust.trustedImporterSignerIds.includes(input.importerIdentity.keyId)) throw new Error('evidence_importer_untrusted');
    enforceRoleSeparation(input.importerIdentity.keyId, this.#trust, []);
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    const now = input.now ?? new Date();
    this.#snapshot = existsSync(this.#path) ? this.#read(now) : createSnapshot([], [], now);
    if (!existsSync(this.#path)) this.#persist(now);
  }

  import(input: {
    readonly challenge: SignedEnvelope<PostgresHaPitrChallengeV33_22>;
    readonly bundlePackage: PostgresHaPitrBundlePackageV33_22;
    readonly now?: Date;
  }): SignedEnvelope<PostgresEvidenceImportReceiptV33_22> {
    const now = input.now ?? new Date();
    verifyChallengeEnvelope(input.challenge, this.#trust, now);
    verifyBundlePackage(input.challenge, input.bundlePackage, this.#trust, now);
    return this.#mutate((snapshot) => {
      const bundle = input.bundlePackage.envelope;
      const sameId = snapshot.imports.find((item) => item.bundle.payload.bundleId === bundle.payload.bundleId);
      if (sameId !== undefined) {
        if (sameId.bundle.payload.bundleDigest !== bundle.payload.bundleDigest) throw new Error('evidence_bundle_id_conflict');
        return { snapshot, value: sameId.importReceipt };
      }
      if (snapshot.imports.some((item) => item.bundle.payload.bundleDigest === bundle.payload.bundleDigest)) throw new Error('evidence_bundle_digest_replay');
      const receiptMaterial = {
        version: '33.22' as const,
        importId: `postgres-evidence-import-${randomUUID()}`,
        bundleId: bundle.payload.bundleId,
        bundleDigest: bundle.payload.bundleDigest,
        challengeId: bundle.payload.challengeId,
        operatorSignerId: bundle.issuerKeyId,
        evidenceClass: bundle.payload.evidenceClass,
        operatorRole: bundle.payload.operatorRole,
        artifactCount: bundle.payload.artifactManifest.length,
        artifactBytes: bundle.payload.totalArtifactBytes,
        artifactManifestDigest: bundle.payload.artifactManifestDigest,
        eligibleForExternalQualification: bundle.payload.evidenceClass === 'LIVE_EXTERNAL_POSTGRESQL_HA_PITR_BUNDLE',
        importedAt: now.toISOString(),
        productionAuthority: 'NONE' as const,
        externalEffectsExecuted: 0 as const,
      };
      const receipt = signEnvelope({ ...receiptMaterial, receiptDigest: sha256(receiptMaterial) }, this.#importerIdentity);
      const event = appendEvent(snapshot.events, bundle.payload, receipt.payload, now);
      const imports = [...snapshot.imports, { bundle, importReceipt: receipt }].sort((a, b) => a.bundle.payload.bundleId.localeCompare(b.bundle.payload.bundleId));
      return { snapshot: createSnapshot(imports, [...snapshot.events, event], now), value: receipt };
    }, now);
  }

  list(): readonly ImportedPostgresEvidenceBundleV33_22[] { return structuredClone(this.#snapshot.imports); }
  export(): PostgresEvidenceImportSnapshotV33_22 { return structuredClone(this.#snapshot); }

  #read(now: Date): PostgresEvidenceImportSnapshotV33_22 {
    let envelope: SignedEnvelope<PostgresEvidenceImportSnapshotV33_22>;
    try { envelope = JSON.parse(readFileSync(this.#path, 'utf8')) as SignedEnvelope<PostgresEvidenceImportSnapshotV33_22>; }
    catch { throw new Error('evidence_ledger_parse_invalid'); }
    if (!this.#trustedStoreSignerIds.includes(envelope.issuerKeyId) || !this.#storeRegistry.verifyAt(envelope, envelope.payload.generatedAt)) throw new Error('evidence_ledger_signature_invalid');
    verifySnapshot(envelope.payload, this.#trust, now);
    return structuredClone(envelope.payload);
  }

  #mutate<T>(fn: (snapshot: PostgresEvidenceImportSnapshotV33_22) => { snapshot: PostgresEvidenceImportSnapshotV33_22; value: T }, now: Date): T {
    const lock = acquireLock(this.#lockPath);
    try {
      if (existsSync(this.#path)) this.#snapshot = this.#read(now);
      const result = fn(structuredClone(this.#snapshot));
      verifySnapshot(result.snapshot, this.#trust, now);
      this.#snapshot = result.snapshot;
      this.#persist(now);
      return structuredClone(result.value);
    } finally { releaseLock(lock, this.#lockPath); }
  }

  #persist(now: Date): void {
    this.#snapshot = createSnapshot(this.#snapshot.imports, this.#snapshot.events, now);
    atomicReplace(this.#path, `${JSON.stringify(signEnvelope(this.#snapshot, this.#storeIdentity), null, 2)}\n`);
  }
}

export function evaluatePostgresHaPitrQualificationV33_22(input: {
  readonly challenge: SignedEnvelope<PostgresHaPitrChallengeV33_22>;
  readonly importedBundles: readonly ImportedPostgresEvidenceBundleV33_22[];
  readonly trust: PostgresHaPitrTrustV33_22;
  readonly verifier: SigningIdentity;
  readonly now?: Date;
}): SignedEnvelope<PostgresHaPitrQualificationVerdictV33_22> {
  const now = input.now ?? new Date();
  verifyChallengeEnvelope(input.challenge, input.trust, now);
  if (!input.trust.trustedVerifierSignerIds.includes(input.verifier.keyId) || input.trust.verifierRegistry.fingerprint(input.verifier.keyId) === undefined) throw new Error('ha_pitr_verifier_untrusted');
  enforceRoleSeparation(input.verifier.keyId, input.trust, input.importedBundles.map((item) => item.bundle.issuerKeyId));
  const accepted: ImportedPostgresEvidenceBundleV33_22[] = [];
  const rejected: string[] = [];
  const organizations = new Set<string>();
  const hosts = new Set<string>();
  const signers = new Set<string>();
  const roles = new Set<PostgresHaPitrOperatorRoleV33_22>();
  let sourceClusterId: string | null = null;
  let sourceDatabaseSystemIdentifier: string | null = null;
  for (const item of input.importedBundles) {
    let valid = true;
    const bundle = item.bundle.payload;
    try {
      verifyImportedItem(item, input.challenge, input.trust, now);
      if (bundle.evidenceClass !== 'LIVE_EXTERNAL_POSTGRESQL_HA_PITR_BUNDLE') valid = false;
      if (!item.importReceipt.payload.eligibleForExternalQualification) valid = false;
      if (signers.has(item.bundle.issuerKeyId) || organizations.has(bundle.operatorOrganizationId) || hosts.has(bundle.operatorHostId) || roles.has(bundle.operatorRole)) valid = false;
      if (sourceClusterId !== null && sourceClusterId !== bundle.sourceClusterId) valid = false;
      if (sourceDatabaseSystemIdentifier !== null && sourceDatabaseSystemIdentifier !== bundle.sourceDatabaseSystemIdentifier) valid = false;
    } catch {
      valid = false;
    }
    if (!valid) {
      rejected.push(bundle.bundleId);
      continue;
    }
    sourceClusterId ??= bundle.sourceClusterId;
    sourceDatabaseSystemIdentifier ??= bundle.sourceDatabaseSystemIdentifier;
    signers.add(item.bundle.issuerKeyId);
    organizations.add(bundle.operatorOrganizationId);
    hosts.add(bundle.operatorHostId);
    roles.add(bundle.operatorRole);
    accepted.push(item);
  }
  const ha = accepted.find((item) => item.bundle.payload.operatorRole === 'HA_OPERATOR');
  const pitr = accepted.find((item) => item.bundle.payload.operatorRole === 'PITR_OPERATOR');
  let crossBundleValid = ha !== undefined && pitr !== undefined;
  if (ha !== undefined && pitr !== undefined) {
    const haReceipt = ha.bundle.payload.operationalReceipt;
    const pitrReceipt = pitr.bundle.payload.operationalReceipt;
    crossBundleValid = haReceipt.kind === 'HA_FAILOVER'
      && pitrReceipt.kind === 'PITR_RECOVERY'
      && pitrReceipt.sourceFenceToken >= haReceipt.postFailoverFenceToken
      && pitrReceipt.restoredFenceToken >= pitrReceipt.sourceFenceToken
      && pitrReceipt.recoveryTimelineId > pitrReceipt.sourceTimelineId
      && ha.bundle.payload.targetHostId !== pitr.bundle.payload.targetHostId;
  }
  const qualified = crossBundleValid
    && accepted.length === 2
    && organizations.size >= input.challenge.payload.requiredIndependentOperators
    && hosts.size >= input.challenge.payload.requiredIndependentHosts
    && input.challenge.payload.requiredRoles.every((role) => roles.has(role));
  const maximumObservedFenceToken = accepted.reduce((maximum, item) => {
    const receipt = item.bundle.payload.operationalReceipt;
    return Math.max(maximum, receipt.kind === 'HA_FAILOVER' ? receipt.postFailoverFenceToken : receipt.restoredFenceToken);
  }, 0);
  const material = {
    version: '33.22' as const,
    verdictId: `postgres-ha-pitr-verdict-${randomUUID()}`,
    challengeId: input.challenge.payload.challengeId,
    status: qualified ? 'QUALIFIED_FOR_EXTERNAL_HA_PITR_PILOT' as const : 'EXTERNAL_HA_PITR_QUALIFICATION_REQUIRED' as const,
    acceptedBundleIds: accepted.map((item) => item.bundle.payload.bundleId).sort(),
    rejectedBundleIds: rejected.sort(),
    distinctOperatorOrganizations: organizations.size,
    distinctOperatorHosts: hosts.size,
    rolesSatisfied: [...roles].sort(),
    sourceClusterId,
    sourceDatabaseSystemIdentifier,
    maximumObservedFenceToken,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, verdictDigest: sha256(material) }, input.verifier);
}

function buildOperationalReceipt(input: PostgresHaPitrOperationalReceiptInputV33_22): PostgresHaPitrOperationalReceiptV33_22 {
  const material = { version: '33.22' as const, ...structuredClone(input) } as Omit<PostgresHaPitrOperationalReceiptV33_22, 'receiptDigest'>;
  return { ...material, receiptDigest: sha256(material) } as PostgresHaPitrOperationalReceiptV33_22;
}

function buildArtifactManifest(artifacts: readonly PostgresHaPitrArtifactInputV33_22[], challenge: PostgresHaPitrChallengeV33_22): readonly PostgresHaPitrArtifactRecordV33_22[] {
  if (artifacts.length === 0 || artifacts.length > challenge.maximumArtifactCountPerBundle) throw new Error('ha_pitr_artifact_count_invalid');
  const paths = new Set<string>();
  let total = 0;
  const rows = artifacts.map((artifact) => {
    const path = safeRelativePath(artifact.path);
    if (paths.has(path)) throw new Error('ha_pitr_artifact_path_duplicate');
    paths.add(path);
    if (!(artifact.bytes instanceof Uint8Array)) throw new Error('ha_pitr_artifact_bytes_invalid');
    const sizeBytes = artifact.bytes.byteLength;
    if (sizeBytes <= 0) throw new Error('ha_pitr_artifact_empty');
    total += sizeBytes;
    instant(artifact.collectedAt, 'ha_pitr_artifact_time_invalid');
    return { path, kind: artifact.kind, mediaType: artifact.mediaType, sizeBytes, sha256: sha256Bytes(artifact.bytes), collectedAt: artifact.collectedAt };
  }).sort((a, b) => a.path.localeCompare(b.path));
  if (total > challenge.maximumArtifactBytesPerBundle) throw new Error('ha_pitr_artifact_bytes_exceeded');
  return rows;
}

function verifyRequiredArtifactKinds(role: PostgresHaPitrOperatorRoleV33_22, manifest: readonly PostgresHaPitrArtifactRecordV33_22[], challenge: PostgresHaPitrChallengeV33_22): void {
  const kinds = new Set(manifest.map((item) => item.kind));
  if (challenge.requiredArtifactKinds[role].some((kind) => !kinds.has(kind))) throw new Error('ha_pitr_required_artifact_missing');
}

function verifyChallengeEnvelope(envelope: SignedEnvelope<PostgresHaPitrChallengeV33_22>, trust: PostgresHaPitrTrustV33_22, now: Date): void {
  if (!trust.trustedChallengeSignerIds.includes(envelope.issuerKeyId) || !trust.challengeRegistry.verifyAt(envelope, envelope.payload.issuedAt)) throw new Error('ha_pitr_challenge_untrusted');
  verifyChallengePayload(envelope.payload);
  if (now.getTime() < instant(envelope.payload.issuedAt, 'ha_pitr_challenge_time_invalid') || now.getTime() >= instant(envelope.payload.expiresAt, 'ha_pitr_challenge_time_invalid')) throw new Error('ha_pitr_challenge_expired');
}

function verifyChallengePayload(challenge: PostgresHaPitrChallengeV33_22): void {
  const { challengeDigest, ...material } = challenge;
  if (challenge.version !== '33.22' || challenge.productionAuthority !== 'NONE' || challenge.externalEffectsExecuted !== 0 || challenge.syntheticEvidenceAccepted || challenge.sameHostEvidenceAccepted || sha256(material) !== challengeDigest) throw new Error('ha_pitr_challenge_invalid');
}

function verifyBundlePackage(challengeEnvelope: SignedEnvelope<PostgresHaPitrChallengeV33_22>, packageValue: PostgresHaPitrBundlePackageV33_22, trust: PostgresHaPitrTrustV33_22, now: Date): void {
  const envelope = packageValue.envelope;
  const bundle = envelope.payload;
  if (!trust.trustedOperatorSignerIds.includes(envelope.issuerKeyId) || !trust.operatorRegistry.verifyAt(envelope, bundle.collectedAt)) throw new Error('ha_pitr_operator_untrusted');
  if (bundle.operatorSignerId !== envelope.issuerKeyId || bundle.challengeId !== challengeEnvelope.payload.challengeId) throw new Error('ha_pitr_bundle_binding_invalid');
  const { bundleDigest, ...material } = bundle;
  if (bundle.version !== '33.22' || sha256(material) !== bundleDigest || bundle.productionAuthority !== 'NONE' || bundle.externalEffectsExecuted !== 0) throw new Error('ha_pitr_bundle_invalid');
  if (bundle.migrationChainDigest !== challengeEnvelope.payload.migrationChainDigest || bundle.serverVersionNum < challengeEnvelope.payload.minimumServerVersionNum) throw new Error('ha_pitr_bundle_postgres_boundary_invalid');
  const collectedAt = instant(bundle.collectedAt, 'ha_pitr_bundle_time_invalid');
  if (collectedAt < instant(challengeEnvelope.payload.issuedAt, 'ha_pitr_challenge_time_invalid') || collectedAt > now.getTime()) throw new Error('ha_pitr_bundle_time_invalid');
  verifyOperationalReceipt(bundle.operationalReceipt, challengeEnvelope.payload);
  verifyArtifactPayloads(bundle, packageValue.artifactBytesByPath, challengeEnvelope.payload);
  if (bundle.operatorHostId === bundle.sourceHostId && bundle.operatorRole === 'PITR_OPERATOR') throw new Error('ha_pitr_operator_source_host_separation_required');
  if (bundle.sourceHostId === bundle.targetHostId) throw new Error('ha_pitr_source_target_host_separation_required');
}

function verifyArtifactPayloads(bundle: PostgresHaPitrEvidenceBundleV33_22, bytesByPath: Readonly<Record<string, Uint8Array>>, challenge: PostgresHaPitrChallengeV33_22): void {
  if (sha256(bundle.artifactManifest) !== bundle.artifactManifestDigest) throw new Error('ha_pitr_manifest_digest_invalid');
  if (bundle.artifactManifest.reduce((sum, row) => sum + row.sizeBytes, 0) !== bundle.totalArtifactBytes || bundle.totalArtifactBytes > challenge.maximumArtifactBytesPerBundle) throw new Error('ha_pitr_manifest_size_invalid');
  const expectedPaths = new Set(bundle.artifactManifest.map((item) => item.path));
  if (Object.keys(bytesByPath).length !== expectedPaths.size || Object.keys(bytesByPath).some((path) => !expectedPaths.has(path))) throw new Error('ha_pitr_artifact_set_invalid');
  for (const record of bundle.artifactManifest) {
    safeRelativePath(record.path);
    const bytes = bytesByPath[record.path];
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== record.sizeBytes || sha256Bytes(bytes) !== record.sha256) throw new Error('ha_pitr_artifact_digest_invalid');
  }
  verifyRequiredArtifactKinds(bundle.operatorRole, bundle.artifactManifest, challenge);
}

function verifyOperationalReceipt(receipt: PostgresHaPitrOperationalReceiptV33_22, challenge: PostgresHaPitrChallengeV33_22): void {
  const { receiptDigest, ...material } = receipt;
  if (receipt.version !== '33.22' || sha256(material) !== receiptDigest) throw new Error('ha_pitr_operational_receipt_invalid');
  if (!receipt.tlsVerifyFull || !receipt.noEmbeddedSecrets || receipt.outboxGapCount !== 0 || receipt.outboxDuplicateCount !== 0 || receipt.rtoMs < 0 || receipt.rtoMs > challenge.maximumRtoMs || receipt.rpoMs < 0 || receipt.rpoMs > challenge.maximumRpoMs) throw new Error('ha_pitr_operational_control_failed');
  instant(receipt.recordedAt, 'ha_pitr_receipt_time_invalid');
  if (receipt.kind === 'HA_FAILOVER') {
    if (receipt.sourceTimelineId < 1 || receipt.promotedTimelineId <= receipt.sourceTimelineId || receipt.baselineFenceToken < 0 || receipt.postFailoverFenceToken <= receipt.baselineFenceToken || receipt.singleWriterCount !== 1 || !receipt.oldPrimaryWriteRejected) throw new Error('ha_pitr_failover_receipt_invalid');
  } else {
    if (receipt.sourceTimelineId < 1 || receipt.recoveryTimelineId <= receipt.sourceTimelineId || receipt.sourceFenceToken < 0 || receipt.restoredFenceToken < receipt.sourceFenceToken || !receipt.backupManifestVerified || !receipt.restoreIsolated || !receipt.recoveryTargetReached || !receipt.witnessRollbackRejected) throw new Error('ha_pitr_recovery_receipt_invalid');
    const target = instant(receipt.recoveryTargetAt, 'ha_pitr_recovery_time_invalid');
    const reached = instant(receipt.recoveryReachedAt, 'ha_pitr_recovery_time_invalid');
    if (reached < target) throw new Error('ha_pitr_recovery_time_invalid');
  }
}

function verifyImportedItem(item: ImportedPostgresEvidenceBundleV33_22, challenge: SignedEnvelope<PostgresHaPitrChallengeV33_22>, trust: PostgresHaPitrTrustV33_22, now: Date): void {
  const bundle = item.bundle.payload;
  if (!trust.trustedOperatorSignerIds.includes(item.bundle.issuerKeyId) || !trust.operatorRegistry.verifyAt(item.bundle, bundle.collectedAt)) throw new Error('ha_pitr_operator_untrusted');
  const receipt = item.importReceipt.payload;
  if (!trust.trustedImporterSignerIds.includes(item.importReceipt.issuerKeyId) || !trust.importerRegistry.verifyAt(item.importReceipt, receipt.importedAt)) throw new Error('ha_pitr_import_receipt_untrusted');
  const { receiptDigest, ...receiptMaterial } = receipt;
  if (sha256(receiptMaterial) !== receiptDigest || receipt.bundleId !== bundle.bundleId || receipt.bundleDigest !== bundle.bundleDigest || receipt.challengeId !== challenge.payload.challengeId || receipt.operatorSignerId !== item.bundle.issuerKeyId || receipt.artifactManifestDigest !== bundle.artifactManifestDigest || receipt.artifactCount !== bundle.artifactManifest.length || receipt.artifactBytes !== bundle.totalArtifactBytes || receipt.productionAuthority !== 'NONE' || receipt.externalEffectsExecuted !== 0) throw new Error('ha_pitr_import_receipt_invalid');
  const { bundleDigest, ...bundleMaterial } = bundle;
  if (sha256(bundleMaterial) !== bundleDigest || bundle.challengeId !== challenge.payload.challengeId || bundle.productionAuthority !== 'NONE' || bundle.externalEffectsExecuted !== 0) throw new Error('ha_pitr_bundle_invalid');
  verifyOperationalReceipt(bundle.operationalReceipt, challenge.payload);
  if (instant(receipt.importedAt, 'ha_pitr_import_time_invalid') > now.getTime()) throw new Error('ha_pitr_import_time_invalid');
}

function enforceRoleSeparation(identityKeyId: string, trust: PostgresHaPitrTrustV33_22, operatorSignerIds: readonly string[]): void {
  if (trust.trustedChallengeSignerIds.includes(identityKeyId) || trust.trustedOperatorSignerIds.includes(identityKeyId) || operatorSignerIds.includes(identityKeyId)) throw new Error('ha_pitr_role_separation_required');
  const importerVerifierOverlap = trust.trustedImporterSignerIds.filter((key) => trust.trustedVerifierSignerIds.includes(key));
  if (importerVerifierOverlap.length > 0) throw new Error('ha_pitr_importer_verifier_separation_required');
}

function createSnapshot(imports: readonly ImportedPostgresEvidenceBundleV33_22[], events: readonly PostgresEvidenceImportEventV33_22[], now: Date): PostgresEvidenceImportSnapshotV33_22 {
  const generatedAt = now.toISOString();
  const material = { version: '33.22' as const, imports: [...imports].sort((a, b) => a.bundle.payload.bundleId.localeCompare(b.bundle.payload.bundleId)), events: [...events].sort((a, b) => a.sequence - b.sequence), generatedAt, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return { ...material, snapshotDigest: sha256(material) };
}

function verifySnapshot(snapshot: PostgresEvidenceImportSnapshotV33_22, trust: PostgresHaPitrTrustV33_22, now: Date): void {
  const { snapshotDigest, ...material } = snapshot;
  if (snapshot.version !== '33.22' || snapshot.productionAuthority !== 'NONE' || snapshot.externalEffectsExecuted !== 0 || sha256(material) !== snapshotDigest) throw new Error('evidence_ledger_snapshot_invalid');
  const bundleIds = new Set<string>();
  const bundleDigests = new Set<string>();
  for (const item of snapshot.imports) {
    if (bundleIds.has(item.bundle.payload.bundleId) || bundleDigests.has(item.bundle.payload.bundleDigest)) throw new Error('evidence_ledger_duplicate_bundle');
    bundleIds.add(item.bundle.payload.bundleId);
    bundleDigests.add(item.bundle.payload.bundleDigest);
    const bundle = item.bundle.payload;
    const receipt = item.importReceipt.payload;
    const { bundleDigest, ...bundleMaterial } = bundle;
    const { receiptDigest, ...receiptMaterial } = receipt;
    if (!trust.trustedOperatorSignerIds.includes(item.bundle.issuerKeyId) || !trust.operatorRegistry.verifyAt(item.bundle, bundle.collectedAt) || !trust.trustedImporterSignerIds.includes(item.importReceipt.issuerKeyId) || !trust.importerRegistry.verifyAt(item.importReceipt, receipt.importedAt)) throw new Error('evidence_ledger_import_invalid');
    if (sha256(bundleMaterial) !== bundleDigest || sha256(receiptMaterial) !== receiptDigest || bundle.operatorSignerId !== item.bundle.issuerKeyId || receipt.bundleId !== bundle.bundleId || receipt.bundleDigest !== bundle.bundleDigest || receipt.challengeId !== bundle.challengeId || receipt.operatorSignerId !== item.bundle.issuerKeyId || receipt.artifactManifestDigest !== bundle.artifactManifestDigest || receipt.artifactCount !== bundle.artifactManifest.length || receipt.artifactBytes !== bundle.totalArtifactBytes || instant(receipt.importedAt, 'ha_pitr_import_time_invalid') > now.getTime()) throw new Error('evidence_ledger_import_invalid');
  }
  if (snapshot.events.length !== snapshot.imports.length) throw new Error('evidence_ledger_event_count_invalid');
  let previous = sha256('postgres-ha-pitr-evidence-ledger-genesis-v33.22');
  snapshot.events.forEach((event, index) => {
    const { eventDigest, ...eventMaterial } = event;
    const imported = snapshot.imports.find((item) => item.bundle.payload.bundleId === event.bundleId);
    if (event.sequence !== index + 1 || event.previousEventDigest !== previous || event.externalEffectsExecuted !== 0 || sha256(eventMaterial) !== eventDigest || imported === undefined || imported.bundle.payload.bundleDigest !== event.bundleDigest || imported.importReceipt.payload.receiptDigest !== event.receiptDigest) throw new Error('evidence_ledger_event_chain_invalid');
    previous = event.eventDigest;
  });
}

function appendEvent(events: readonly PostgresEvidenceImportEventV33_22[], bundle: PostgresHaPitrEvidenceBundleV33_22, receipt: PostgresEvidenceImportReceiptV33_22, now: Date): PostgresEvidenceImportEventV33_22 {
  const material = {
    version: '33.22' as const,
    eventId: `postgres-evidence-event-${randomUUID()}`,
    sequence: events.length + 1,
    eventType: 'BUNDLE_IMPORTED' as const,
    bundleId: bundle.bundleId,
    bundleDigest: bundle.bundleDigest,
    receiptDigest: receipt.receiptDigest,
    occurredAt: now.toISOString(),
    previousEventDigest: events.at(-1)?.eventDigest ?? sha256('postgres-ha-pitr-evidence-ledger-genesis-v33.22'),
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, eventDigest: sha256(material) };
}

function safeRelativePath(value: string): string {
  const path = value.trim();
  if (path === '' || path.includes('\\') || path.startsWith('/') || path.includes('\0') || posix.normalize(path) !== path || path === '.' || path.startsWith('../') || path.includes('/../') || path.length > 240) throw new Error('ha_pitr_artifact_path_invalid');
  return path;
}

function unique(values: readonly string[], code: string): readonly string[] {
  const normalized = values.map((value) => nonEmpty(value, code));
  if (new Set(normalized).size !== normalized.length) throw new Error(code);
  return [...normalized].sort();
}

function nonEmpty(value: string, code: string): string { const normalized = value.trim(); if (normalized === '') throw new Error(code); return normalized; }
function boundedInteger(value: number, minimum: number, maximum: number, code: string): number { if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(code); return value; }
function instant(value: string, code: string): number { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error(code); return parsed; }
function acquireLock(path: string): number { try { return openSync(path, 'wx', 0o600); } catch { throw new Error('evidence_ledger_locked'); } }
function releaseLock(fd: number, path: string): void { closeSync(fd); try { unlinkSync(path); } catch { /* best effort */ } }
function atomicReplace(path: string, contents: string): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, contents, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
  try { renameSync(temporary, path); } catch (error) { try { unlinkSync(temporary); } catch { /* best effort */ } throw error; }
}
