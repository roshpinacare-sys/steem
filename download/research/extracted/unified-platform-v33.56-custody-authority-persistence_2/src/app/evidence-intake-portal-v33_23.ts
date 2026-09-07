import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, join, posix, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  KeyRegistry,
  sha256,
  sha256Bytes,
  signEnvelope,
  type ExportedPublicKeyRecord,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';
import type {
  PostgresHaPitrArtifactRecordV33_22,
  PostgresHaPitrBundlePackageV33_22,
  PostgresHaPitrChallengeV33_22,
  PostgresHaPitrEvidenceBundleV33_22,
  PostgresHaPitrEvidenceClassV33_22,
  PostgresHaPitrOperatorRoleV33_22,
} from './postgres-ha-pitr-evidence-v33_22.js';

export type IntakeScanFindingKindV33_23 =
  | 'MALWARE_SIGNATURE'
  | 'SECRET_MATERIAL'
  | 'ACTIVE_CONTENT'
  | 'MEDIA_TYPE_MISMATCH'
  | 'BINARY_CONTENT_REJECTED';

export interface EvidenceIntakeSessionV33_23 {
  readonly version: '33.23';
  readonly sessionId: string;
  readonly challengeId: string;
  readonly operatorSignerId: string;
  readonly operatorRole: PostgresHaPitrOperatorRoleV33_22;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly maximumArtifactCount: number;
  readonly maximumTotalBytes: number;
  readonly allowedMediaTypes: readonly ['application/json', 'text/plain', 'application/sql', 'application/octet-stream'];
  readonly oneBundleOnly: true;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly sessionDigest: string;
}

export interface IntakeScanFindingV33_23 {
  readonly path: string;
  readonly kind: IntakeScanFindingKindV33_23;
  readonly ruleId: string;
  readonly detailDigest: string;
}

export interface EvidenceArtifactScanV33_23 {
  readonly path: string;
  readonly expectedSha256: string;
  readonly observedSha256: string;
  readonly sizeBytes: number;
  readonly mediaType: PostgresHaPitrArtifactRecordV33_22['mediaType'];
  readonly detectedType: 'JSON' | 'TEXT' | 'SQL' | 'BINARY' | 'ELF' | 'PE' | 'MACHO' | 'ZIP' | 'OLE' | 'SCRIPT';
  readonly executableBit: false;
  readonly findings: readonly IntakeScanFindingV33_23[];
  readonly artifactScanDigest: string;
}

export interface EvidenceScanReportV33_23 {
  readonly version: '33.23';
  readonly scanId: string;
  readonly sessionId: string;
  readonly bundleId: string;
  readonly bundleDigest: string;
  readonly status: 'BUILTIN_SCAN_PASSED' | 'REJECTED';
  readonly builtinScannerVersion: '33.23.1';
  readonly externalMalwareScanner: 'CLAMAV_AVAILABLE_NOT_EXECUTED' | 'CLAMAV_UNAVAILABLE';
  readonly externalMalwareQualification: 'EXTERNAL_MALWARE_SCAN_REQUIRED';
  readonly artifactScans: readonly EvidenceArtifactScanV33_23[];
  readonly findingCount: number;
  readonly scannedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly reportDigest: string;
}

export interface EvidenceIntakeReceiptV33_23 {
  readonly version: '33.23';
  readonly intakeId: string;
  readonly sessionId: string;
  readonly challengeId: string;
  readonly bundleId: string;
  readonly bundleDigest: string;
  readonly evidenceClass: PostgresHaPitrEvidenceClassV33_22;
  readonly operatorRole: PostgresHaPitrOperatorRoleV33_22;
  readonly operatorSignerId: string;
  readonly artifactCount: number;
  readonly artifactBytes: number;
  readonly scanReportDigest: string;
  readonly quarantineStatus: 'SCAN_PASSED_QUARANTINED' | 'REJECTED_QUARANTINED';
  readonly eligibleForOfflineVerification: boolean;
  readonly eligibleForExternalQualification: boolean;
  readonly acceptedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface QuarantineEventV33_23 {
  readonly version: '33.23';
  readonly sequence: number;
  readonly eventId: string;
  readonly eventType: 'BUNDLE_QUARANTINED';
  readonly bundleId: string;
  readonly bundleDigest: string;
  readonly receiptDigest: string;
  readonly scanReportDigest: string;
  readonly status: EvidenceIntakeReceiptV33_23['quarantineStatus'];
  readonly occurredAt: string;
  readonly previousEventDigest: string;
  readonly eventDigest: string;
}

export interface QuarantineRecordV33_23 {
  readonly session: SignedEnvelope<EvidenceIntakeSessionV33_23>;
  readonly challenge: SignedEnvelope<PostgresHaPitrChallengeV33_22>;
  readonly bundle: SignedEnvelope<PostgresHaPitrEvidenceBundleV33_22>;
  readonly scanReport: SignedEnvelope<EvidenceScanReportV33_23>;
  readonly intakeReceipt: SignedEnvelope<EvidenceIntakeReceiptV33_23>;
  readonly artifactObjectNames: Readonly<Record<string, string>>;
}

export interface QuarantineSnapshotV33_23 {
  readonly version: '33.23';
  readonly records: readonly QuarantineRecordV33_23[];
  readonly events: readonly QuarantineEventV33_23[];
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export interface OfflineEvidencePackageManifestV33_23 {
  readonly version: '33.23';
  readonly packageId: string;
  readonly sessionId: string;
  readonly challengeId: string;
  readonly bundleId: string;
  readonly bundleDigest: string;
  readonly evidenceClass: PostgresHaPitrEvidenceClassV33_22;
  readonly artifactManifest: readonly PostgresHaPitrArtifactRecordV33_22[];
  readonly scanReportDigest: string;
  readonly intakeReceiptDigest: string;
  readonly exportedAt: string;
  readonly networkAccessRequired: false;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly packageDigest: string;
}

export interface EncodedOfflineEvidencePackageV33_23 {
  readonly manifest: OfflineEvidencePackageV33_23['manifest'];
  readonly session: OfflineEvidencePackageV33_23['session'];
  readonly challenge: OfflineEvidencePackageV33_23['challenge'];
  readonly bundle: OfflineEvidencePackageV33_23['bundle'];
  readonly scanReport: OfflineEvidencePackageV33_23['scanReport'];
  readonly intakeReceipt: OfflineEvidencePackageV33_23['intakeReceipt'];
  readonly artifactBytesBase64ByPath: Readonly<Record<string, string>>;
  readonly publicKeys: readonly ExportedPublicKeyRecord[];
}

export interface OfflineEvidencePackageV33_23 {
  readonly manifest: SignedEnvelope<OfflineEvidencePackageManifestV33_23>;
  readonly session: SignedEnvelope<EvidenceIntakeSessionV33_23>;
  readonly challenge: SignedEnvelope<PostgresHaPitrChallengeV33_22>;
  readonly bundle: SignedEnvelope<PostgresHaPitrEvidenceBundleV33_22>;
  readonly scanReport: SignedEnvelope<EvidenceScanReportV33_23>;
  readonly intakeReceipt: SignedEnvelope<EvidenceIntakeReceiptV33_23>;
  readonly artifactBytesByPath: Readonly<Record<string, Uint8Array>>;
  readonly publicKeys: readonly ExportedPublicKeyRecord[];
}

export interface OfflineEvidenceVerificationVerdictV33_23 {
  readonly version: '33.23';
  readonly verdictId: string;
  readonly packageId: string;
  readonly bundleId: string;
  readonly status: 'OFFLINE_VERIFIED_FOR_EVIDENCE_IMPORT' | 'OFFLINE_VERIFIED_SYNTHETIC_NOT_EXTERNAL' | 'REJECTED';
  readonly artifactCount: number;
  readonly artifactBytesVerified: boolean;
  readonly builtinScanVerified: boolean;
  readonly externalMalwareScanStillRequired: true;
  readonly eligibleForEvidenceImport: boolean;
  readonly eligibleForExternalQualification: boolean;
  readonly networkAccessAttempted: false;
  readonly verifiedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

export interface EvidenceIntakeTrustV33_23 {
  readonly sessionRegistry: KeyRegistry;
  readonly trustedSessionSignerIds: readonly string[];
  readonly challengeRegistry: KeyRegistry;
  readonly trustedChallengeSignerIds: readonly string[];
  readonly operatorRegistry: KeyRegistry;
  readonly trustedOperatorSignerIds: readonly string[];
  readonly scannerRegistry: KeyRegistry;
  readonly trustedScannerSignerIds: readonly string[];
  readonly portalRegistry: KeyRegistry;
  readonly trustedPortalSignerIds: readonly string[];
  readonly exporterRegistry: KeyRegistry;
  readonly trustedExporterSignerIds: readonly string[];
  readonly verifierRegistry: KeyRegistry;
  readonly trustedVerifierSignerIds: readonly string[];
}

export function issueEvidenceIntakeSessionV33_23(input: {
  readonly signer: SigningIdentity;
  readonly challenge: SignedEnvelope<PostgresHaPitrChallengeV33_22>;
  readonly operatorSignerId: string;
  readonly operatorRole: PostgresHaPitrOperatorRoleV33_22;
  readonly now?: Date;
  readonly expiresInMs?: number;
  readonly maximumArtifactCount?: number;
  readonly maximumTotalBytes?: number;
}): SignedEnvelope<EvidenceIntakeSessionV33_23> {
  const now = input.now ?? new Date();
  const expiresInMs = boundedInteger(input.expiresInMs ?? 30 * 60_000, 60_000, 24 * 60 * 60_000, 'intake_session_expiry_invalid');
  const material = {
    version: '33.23' as const,
    sessionId: `evidence-intake-session-${randomUUID()}`,
    challengeId: nonEmpty(input.challenge.payload.challengeId, 'challenge_id_required'),
    operatorSignerId: nonEmpty(input.operatorSignerId, 'operator_signer_required'),
    operatorRole: input.operatorRole,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + expiresInMs).toISOString(),
    maximumArtifactCount: boundedInteger(input.maximumArtifactCount ?? 64, 1, 256, 'maximum_artifact_count_invalid'),
    maximumTotalBytes: boundedInteger(input.maximumTotalBytes ?? 16 * 1024 * 1024, 1_024, 64 * 1024 * 1024, 'maximum_total_bytes_invalid'),
    allowedMediaTypes: ['application/json', 'text/plain', 'application/sql', 'application/octet-stream'] as const,
    oneBundleOnly: true as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, sessionDigest: sha256(material) }, input.signer);
}

export class EvidenceIntakePortalV33_23 {
  readonly #root: string;
  readonly #snapshotPath: string;
  readonly #lockPath: string;
  readonly #sessionTrust: EvidenceIntakeTrustV33_23;
  readonly #scannerIdentity: SigningIdentity;
  readonly #portalIdentity: SigningIdentity;
  readonly #storeIdentity: SigningIdentity;
  readonly #storeRegistry: KeyRegistry;
  readonly #trustedStoreSignerIds: readonly string[];
  readonly #exporterIdentity: SigningIdentity;
  #snapshot: QuarantineSnapshotV33_23;

  constructor(input: {
    readonly root: string;
    readonly trust: EvidenceIntakeTrustV33_23;
    readonly scannerIdentity: SigningIdentity;
    readonly portalIdentity: SigningIdentity;
    readonly storeIdentity: SigningIdentity;
    readonly storeRegistry: KeyRegistry;
    readonly trustedStoreSignerIds: readonly string[];
    readonly exporterIdentity: SigningIdentity;
    readonly now?: Date;
  }) {
    this.#root = resolve(nonEmpty(input.root, 'quarantine_root_required'));
    this.#snapshotPath = join(this.#root, 'quarantine-snapshot.json');
    this.#lockPath = `${this.#snapshotPath}.lock`;
    this.#sessionTrust = input.trust;
    this.#scannerIdentity = input.scannerIdentity;
    this.#portalIdentity = input.portalIdentity;
    this.#storeIdentity = input.storeIdentity;
    this.#storeRegistry = input.storeRegistry;
    this.#trustedStoreSignerIds = unique(input.trustedStoreSignerIds, 'duplicate_store_signer');
    this.#exporterIdentity = input.exporterIdentity;
    enforceIdentityRoles(input);
    mkdirSync(join(this.#root, 'objects'), { recursive: true, mode: 0o700 });
    const now = input.now ?? new Date();
    this.#snapshot = existsSync(this.#snapshotPath) ? this.#read(now) : createSnapshot([], [], now);
    if (!existsSync(this.#snapshotPath)) this.#persist(now);
  }

  intake(input: {
    readonly session: SignedEnvelope<EvidenceIntakeSessionV33_23>;
    readonly challenge: SignedEnvelope<PostgresHaPitrChallengeV33_22>;
    readonly bundlePackage: PostgresHaPitrBundlePackageV33_22;
    readonly now?: Date;
  }): SignedEnvelope<EvidenceIntakeReceiptV33_23> {
    const now = input.now ?? new Date();
    verifySession(input.session, input.challenge, input.bundlePackage, this.#sessionTrust, now);
    verifyBundleBytes(input.session.payload, input.challenge, input.bundlePackage, this.#sessionTrust, now);
    const lock = acquireLock(this.#lockPath);
    try {
      if (existsSync(this.#snapshotPath)) this.#snapshot = this.#read(now);
      const bundle = input.bundlePackage.envelope.payload;
      const sameSession = this.#snapshot.records.find((record) => record.session.payload.sessionId === input.session.payload.sessionId);
      if (sameSession !== undefined) {
        if (sameSession.bundle.payload.bundleDigest !== bundle.bundleDigest) throw new Error('intake_session_bundle_conflict');
        return structuredClone(sameSession.intakeReceipt);
      }
      const sameBundle = this.#snapshot.records.find((record) => record.bundle.payload.bundleId === bundle.bundleId);
      if (sameBundle !== undefined) {
        if (sameBundle.bundle.payload.bundleDigest !== bundle.bundleDigest) throw new Error('intake_bundle_id_conflict');
        return structuredClone(sameBundle.intakeReceipt);
      }
      const artifactObjectNames: Record<string, string> = {};
      const scans: EvidenceArtifactScanV33_23[] = [];
      try {
        for (const artifact of bundle.artifactManifest) {
          const bytes = input.bundlePackage.artifactBytesByPath[artifact.path]!;
          const objectName = `${artifact.sha256}.evidence`;
          const objectPath = join(this.#root, 'objects', objectName);
          if (!existsSync(objectPath)) atomicReplaceBytes(objectPath, bytes);
          else { const existing = readFileSync(objectPath); if (existing.byteLength !== artifact.sizeBytes || sha256Bytes(existing) !== artifact.sha256) throw new Error('quarantine_existing_object_tampered'); }
          const mode = statSync(objectPath).mode & 0o777;
          if (mode !== 0o600) throw new Error('quarantine_object_mode_invalid');
          artifactObjectNames[artifact.path] = objectName;
          scans.push(scanArtifact(artifact, bytes));
        }
      } catch (error) {
        throw error;
      }
      const findingCount = scans.reduce((total, scan) => total + scan.findings.length, 0);
      const status = findingCount === 0 ? 'BUILTIN_SCAN_PASSED' as const : 'REJECTED' as const;
      const clamav = spawnSync('bash', ['-lc', 'command -v clamscan || true'], { encoding: 'utf8' }).stdout.trim() === ''
        ? 'CLAMAV_UNAVAILABLE' as const : 'CLAMAV_AVAILABLE_NOT_EXECUTED' as const;
      const scanMaterial = {
        version: '33.23' as const,
        scanId: `evidence-scan-${randomUUID()}`,
        sessionId: input.session.payload.sessionId,
        bundleId: bundle.bundleId,
        bundleDigest: bundle.bundleDigest,
        status,
        builtinScannerVersion: '33.23.1' as const,
        externalMalwareScanner: clamav,
        externalMalwareQualification: 'EXTERNAL_MALWARE_SCAN_REQUIRED' as const,
        artifactScans: scans,
        findingCount,
        scannedAt: now.toISOString(),
        productionAuthority: 'NONE' as const,
        externalEffectsExecuted: 0 as const,
      };
      const scanReport = signEnvelope({ ...scanMaterial, reportDigest: sha256(scanMaterial) }, this.#scannerIdentity);
      const receiptMaterial = {
        version: '33.23' as const,
        intakeId: `evidence-intake-${randomUUID()}`,
        sessionId: input.session.payload.sessionId,
        challengeId: bundle.challengeId,
        bundleId: bundle.bundleId,
        bundleDigest: bundle.bundleDigest,
        evidenceClass: bundle.evidenceClass,
        operatorRole: bundle.operatorRole,
        operatorSignerId: input.bundlePackage.envelope.issuerKeyId,
        artifactCount: bundle.artifactManifest.length,
        artifactBytes: bundle.totalArtifactBytes,
        scanReportDigest: scanReport.payload.reportDigest,
        quarantineStatus: status === 'BUILTIN_SCAN_PASSED' ? 'SCAN_PASSED_QUARANTINED' as const : 'REJECTED_QUARANTINED' as const,
        eligibleForOfflineVerification: status === 'BUILTIN_SCAN_PASSED',
        eligibleForExternalQualification: status === 'BUILTIN_SCAN_PASSED' && bundle.evidenceClass === 'LIVE_EXTERNAL_POSTGRESQL_HA_PITR_BUNDLE',
        acceptedAt: now.toISOString(),
        productionAuthority: 'NONE' as const,
        externalEffectsExecuted: 0 as const,
      };
      const intakeReceipt = signEnvelope({ ...receiptMaterial, receiptDigest: sha256(receiptMaterial) }, this.#portalIdentity);
      const record: QuarantineRecordV33_23 = {
        session: input.session,
        challenge: input.challenge,
        bundle: input.bundlePackage.envelope,
        scanReport,
        intakeReceipt,
        artifactObjectNames,
      };
      const event = appendEvent(this.#snapshot.events, record, now);
      this.#snapshot = createSnapshot([...this.#snapshot.records, record].sort((a, b) => a.bundle.payload.bundleId.localeCompare(b.bundle.payload.bundleId)), [...this.#snapshot.events, event], now);
      this.#persist(now);
      return structuredClone(intakeReceipt);
    } finally {
      releaseLock(lock, this.#lockPath);
    }
  }

  exportOfflinePackage(bundleId: string, now: Date = new Date()): OfflineEvidencePackageV33_23 {
    const record = this.#snapshot.records.find((item) => item.bundle.payload.bundleId === bundleId);
    if (record === undefined) throw new Error('quarantine_bundle_not_found');
    if (!record.intakeReceipt.payload.eligibleForOfflineVerification) throw new Error('quarantine_bundle_scan_rejected');
    const artifactBytesByPath: Record<string, Uint8Array> = {};
    for (const artifact of record.bundle.payload.artifactManifest) {
      const objectName = record.artifactObjectNames[artifact.path];
      if (objectName === undefined || objectName !== `${artifact.sha256}.evidence`) throw new Error('quarantine_object_binding_invalid');
      const objectPath = join(this.#root, 'objects', objectName);
      if (!existsSync(objectPath) || lstatSync(objectPath).isSymbolicLink()) throw new Error('quarantine_object_missing');
      const bytes = readFileSync(objectPath);
      if (bytes.byteLength !== artifact.sizeBytes || sha256Bytes(bytes) !== artifact.sha256) throw new Error('quarantine_object_tampered');
      artifactBytesByPath[artifact.path] = bytes;
    }
    const material = {
      version: '33.23' as const,
      packageId: `offline-evidence-package-${randomUUID()}`,
      sessionId: record.session.payload.sessionId,
      challengeId: record.challenge.payload.challengeId,
      bundleId: record.bundle.payload.bundleId,
      bundleDigest: record.bundle.payload.bundleDigest,
      evidenceClass: record.bundle.payload.evidenceClass,
      artifactManifest: record.bundle.payload.artifactManifest,
      scanReportDigest: record.scanReport.payload.reportDigest,
      intakeReceiptDigest: record.intakeReceipt.payload.receiptDigest,
      exportedAt: now.toISOString(),
      networkAccessRequired: false as const,
      productionAuthority: 'NONE' as const,
      externalEffectsExecuted: 0 as const,
    };
    const manifest = signEnvelope({ ...material, packageDigest: sha256(material) }, this.#exporterIdentity);
    const keyIds = [
      record.session.issuerKeyId,
      record.challenge.issuerKeyId,
      record.bundle.issuerKeyId,
      record.scanReport.issuerKeyId,
      record.intakeReceipt.issuerKeyId,
      manifest.issuerKeyId,
    ];
    const publicKeys = exportTrustedKeys(this.#sessionTrust, keyIds);
    return { manifest, ...record, artifactBytesByPath, publicKeys };
  }

  exportSnapshot(): QuarantineSnapshotV33_23 { return structuredClone(this.#snapshot); }

  #read(now: Date): QuarantineSnapshotV33_23 {
    let envelope: SignedEnvelope<QuarantineSnapshotV33_23>;
    try { envelope = JSON.parse(readFileSync(this.#snapshotPath, 'utf8')) as SignedEnvelope<QuarantineSnapshotV33_23>; }
    catch { throw new Error('quarantine_snapshot_parse_invalid'); }
    if (!this.#trustedStoreSignerIds.includes(envelope.issuerKeyId) || !this.#storeRegistry.verifyAt(envelope, envelope.payload.generatedAt)) throw new Error('quarantine_snapshot_signature_invalid');
    verifySnapshot(envelope.payload, this.#sessionTrust, now);
    return structuredClone(envelope.payload);
  }

  #persist(now: Date): void {
    this.#snapshot = createSnapshot(this.#snapshot.records, this.#snapshot.events, now);
    atomicReplaceText(this.#snapshotPath, `${JSON.stringify(signEnvelope(this.#snapshot, this.#storeIdentity), null, 2)}\n`);
  }
}

export function encodeOfflineEvidencePackageV33_23(pkg: OfflineEvidencePackageV33_23): EncodedOfflineEvidencePackageV33_23 {
  return {
    manifest: pkg.manifest,
    session: pkg.session,
    challenge: pkg.challenge,
    bundle: pkg.bundle,
    scanReport: pkg.scanReport,
    intakeReceipt: pkg.intakeReceipt,
    artifactBytesBase64ByPath: Object.fromEntries(Object.entries(pkg.artifactBytesByPath).sort(([a],[b])=>a.localeCompare(b)).map(([path, value]) => [path, Buffer.from(value).toString('base64')])),
    publicKeys: pkg.publicKeys,
  };
}

export function decodeOfflineEvidencePackageV33_23(value: EncodedOfflineEvidencePackageV33_23): OfflineEvidencePackageV33_23 {
  const artifactBytesByPath: Record<string, Uint8Array> = {};
  for (const [path, encoded] of Object.entries(value.artifactBytesBase64ByPath)) {
    safePath(path);
    if (typeof encoded !== 'string' || encoded === '' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('offline_artifact_base64_invalid');
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.toString('base64') !== encoded) throw new Error('offline_artifact_base64_invalid');
    artifactBytesByPath[path] = decoded;
  }
  return { manifest:value.manifest, session:value.session, challenge:value.challenge, bundle:value.bundle, scanReport:value.scanReport, intakeReceipt:value.intakeReceipt, artifactBytesByPath, publicKeys:value.publicKeys };
}

export function verifyOfflineEvidencePackageV33_23(input: {
  readonly package: OfflineEvidencePackageV33_23;
  readonly trust: EvidenceIntakeTrustV33_23;
  readonly verifier: SigningIdentity;
  readonly now?: Date;
}): SignedEnvelope<OfflineEvidenceVerificationVerdictV33_23> {
  const now = input.now ?? new Date();
  const pkg = input.package;
  if (!input.trust.trustedVerifierSignerIds.includes(input.verifier.keyId) || input.trust.verifierRegistry.fingerprint(input.verifier.keyId) === undefined) throw new Error('offline_verifier_untrusted');
  const roleIds = [pkg.manifest.issuerKeyId, pkg.session.issuerKeyId, pkg.challenge.issuerKeyId, pkg.bundle.issuerKeyId, pkg.scanReport.issuerKeyId, pkg.intakeReceipt.issuerKeyId];
  if (roleIds.includes(input.verifier.keyId)) throw new Error('offline_verifier_role_separation');
  verifySession(pkg.session, pkg.challenge, { envelope: pkg.bundle, artifactBytesByPath: pkg.artifactBytesByPath }, input.trust, now);
  verifyBundleBytes(pkg.session.payload, pkg.challenge, { envelope: pkg.bundle, artifactBytesByPath: pkg.artifactBytesByPath }, input.trust, now);
  if (!input.trust.trustedScannerSignerIds.includes(pkg.scanReport.issuerKeyId) || !input.trust.scannerRegistry.verifyAt(pkg.scanReport, pkg.scanReport.payload.scannedAt)) throw new Error('offline_scan_report_invalid');
  if (!input.trust.trustedPortalSignerIds.includes(pkg.intakeReceipt.issuerKeyId) || !input.trust.portalRegistry.verifyAt(pkg.intakeReceipt, pkg.intakeReceipt.payload.acceptedAt)) throw new Error('offline_intake_receipt_invalid');
  if (!input.trust.trustedExporterSignerIds.includes(pkg.manifest.issuerKeyId) || !input.trust.exporterRegistry.verifyAt(pkg.manifest, pkg.manifest.payload.exportedAt)) throw new Error('offline_manifest_signature_invalid');
  verifyDigest(pkg.scanReport.payload, 'reportDigest', 'offline_scan_report_digest_invalid');
  verifyDigest(pkg.intakeReceipt.payload, 'receiptDigest', 'offline_intake_receipt_digest_invalid');
  verifyDigest(pkg.manifest.payload, 'packageDigest', 'offline_manifest_digest_invalid');
  if (pkg.manifest.payload.bundleDigest !== pkg.bundle.payload.bundleDigest || pkg.manifest.payload.bundleId !== pkg.bundle.payload.bundleId || pkg.manifest.payload.sessionId !== pkg.session.payload.sessionId || pkg.manifest.payload.challengeId !== pkg.challenge.payload.challengeId) throw new Error('offline_package_binding_invalid');
  if (pkg.manifest.payload.scanReportDigest !== pkg.scanReport.payload.reportDigest || pkg.manifest.payload.intakeReceiptDigest !== pkg.intakeReceipt.payload.receiptDigest) throw new Error('offline_receipt_binding_invalid');
  if (pkg.scanReport.payload.status !== 'BUILTIN_SCAN_PASSED' || pkg.scanReport.payload.findingCount !== 0 || pkg.intakeReceipt.payload.quarantineStatus !== 'SCAN_PASSED_QUARANTINED') throw new Error('offline_package_not_scan_clean');
  const rescans = pkg.bundle.payload.artifactManifest.map((artifact) => scanArtifact(artifact, pkg.artifactBytesByPath[artifact.path]!));
  if (rescans.some((scan) => scan.findings.length > 0)) throw new Error('offline_rescan_rejected');
  const synthetic = pkg.bundle.payload.evidenceClass === 'SYNTHETIC_CONTRACT_TEST';
  const material = {
    version: '33.23' as const,
    verdictId: `offline-evidence-verdict-${randomUUID()}`,
    packageId: pkg.manifest.payload.packageId,
    bundleId: pkg.bundle.payload.bundleId,
    status: synthetic ? 'OFFLINE_VERIFIED_SYNTHETIC_NOT_EXTERNAL' as const : 'OFFLINE_VERIFIED_FOR_EVIDENCE_IMPORT' as const,
    artifactCount: pkg.bundle.payload.artifactManifest.length,
    artifactBytesVerified: true,
    builtinScanVerified: true,
    externalMalwareScanStillRequired: true as const,
    eligibleForEvidenceImport: true,
    eligibleForExternalQualification: !synthetic && pkg.intakeReceipt.payload.eligibleForExternalQualification,
    networkAccessAttempted: false as const,
    verifiedAt: now.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, verdictDigest: sha256(material) }, input.verifier);
}

export async function startLoopbackEvidenceIntakeServerV33_23(input: {
  readonly portal: EvidenceIntakePortalV33_23;
  readonly host?: string;
  readonly port?: number;
  readonly maximumBodyBytes?: number;
}): Promise<{ readonly server: Server; readonly origin: string; close(): Promise<void> }> {
  const host = input.host ?? '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('intake_server_loopback_only');
  const maximumBodyBytes = boundedInteger(input.maximumBodyBytes ?? 20 * 1024 * 1024, 1_024, 64 * 1024 * 1024, 'intake_body_limit_invalid');
  const server = createServer(async (request, response) => {
    try { await routeIntakeRequest(input.portal, request, response, maximumBodyBytes); }
    catch (error) { json(response, 400, { status: 'rejected', error: error instanceof Error ? error.message : 'unknown_error' }); }
  });
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(input.port ?? 0, host, () => { server.off('error', rejectPromise); resolvePromise(); });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('intake_server_address_invalid');
  return {
    server,
    origin: `http://${host}:${address.port}`,
    close: () => new Promise<void>((resolvePromise, rejectPromise) => server.close((error) => error ? rejectPromise(error) : resolvePromise())),
  };
}

async function routeIntakeRequest(portal: EvidenceIntakePortalV33_23, request: IncomingMessage, response: ServerResponse, maximumBodyBytes: number): Promise<void> {
  if (request.method === 'GET' && request.url === '/health') { json(response, 200, { status: 'ok', version: '33.23', productionAuthority: 'NONE' }); return; }
  if (request.method !== 'POST' || request.url !== '/v1/evidence/intake') { json(response, 404, { status: 'not_found' }); return; }
  const body = await readBody(request, maximumBodyBytes);
  let parsed: any;
  try { parsed = JSON.parse(body.toString('utf8')); } catch { throw new Error('intake_http_json_invalid'); }
  const artifactBytesByPath: Record<string, Uint8Array> = {};
  for (const [path, encoded] of Object.entries(parsed.artifactBytesBase64ByPath ?? {})) {
    if (typeof encoded !== 'string') throw new Error('intake_http_artifact_encoding_invalid');
    artifactBytesByPath[path] = Buffer.from(encoded, 'base64');
  }
  const receipt = portal.intake({ session: parsed.session, challenge: parsed.challenge, bundlePackage: { envelope: parsed.bundle, artifactBytesByPath } });
  json(response, 201, receipt);
}

function scanArtifact(artifact: PostgresHaPitrArtifactRecordV33_22, bytes: Uint8Array): EvidenceArtifactScanV33_23 {
  const findings: IntakeScanFindingV33_23[] = [];
  const buffer = Buffer.from(bytes);
  const detectedType = detectType(buffer, artifact.mediaType);
  const text = isProbablyText(buffer) ? buffer.toString('utf8') : '';
  const add = (kind: IntakeScanFindingKindV33_23, ruleId: string, detail: string) => findings.push({ path: artifact.path, kind, ruleId, detailDigest: sha256({ ruleId, detail }) });
  if (buffer.includes(Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'))) add('MALWARE_SIGNATURE', 'EICAR_TEST_STRING', 'known-antivirus-test-signature');
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(text)) add('SECRET_MATERIAL', 'PEM_PRIVATE_KEY', 'private-key-material');
  if (/\bAKIA[0-9A-Z]{16}\b/.test(text)) add('SECRET_MATERIAL', 'AWS_ACCESS_KEY', 'aws-access-key-pattern');
  if (/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/.test(text)) add('SECRET_MATERIAL', 'GITHUB_TOKEN', 'github-token-pattern');
  if (/postgres(?:ql)?:\/\/[^\s/:]+:[^\s@]+@/i.test(text) || /\bPGPASSWORD\s*=\s*\S+/i.test(text)) add('SECRET_MATERIAL', 'POSTGRES_CREDENTIAL', 'database-credential-pattern');
  if (/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(text)) add('SECRET_MATERIAL', 'JWT_TOKEN', 'jwt-pattern');
  if (/eval\s*\(\s*base64_decode|<\?php|powershell\s+-enc|curl\s+[^\n|]*\|\s*(?:sh|bash)/i.test(text)) add('MALWARE_SIGNATURE', 'SUSPICIOUS_PAYLOAD', 'webshell-or-download-execute-pattern');
  if (['ELF', 'PE', 'MACHO', 'ZIP', 'OLE', 'SCRIPT'].includes(detectedType)) add('ACTIVE_CONTENT', `ACTIVE_${detectedType}`, 'active-or-container-content-disallowed');
  if (artifact.mediaType === 'application/json') {
    try { JSON.parse(text); } catch { add('MEDIA_TYPE_MISMATCH', 'JSON_PARSE_FAILED', 'declared-json-is-not-valid-json'); }
  }
  if ((artifact.mediaType === 'text/plain' || artifact.mediaType === 'application/sql') && !isProbablyText(buffer)) add('MEDIA_TYPE_MISMATCH', 'TEXT_BINARY_MISMATCH', 'declared-text-contains-binary-data');
  if (artifact.mediaType === 'application/octet-stream' && detectedType === 'BINARY') add('BINARY_CONTENT_REJECTED', 'OPAQUE_BINARY_NOT_ALLOWED', 'opaque-binary-evidence-requires-external-review');
  const material = {
    path: artifact.path,
    expectedSha256: artifact.sha256,
    observedSha256: sha256Bytes(bytes),
    sizeBytes: bytes.byteLength,
    mediaType: artifact.mediaType,
    detectedType,
    executableBit: false as const,
    findings: findings.sort((a, b) => `${a.kind}:${a.ruleId}`.localeCompare(`${b.kind}:${b.ruleId}`)),
  };
  return { ...material, artifactScanDigest: sha256(material) };
}

function verifySession(session: SignedEnvelope<EvidenceIntakeSessionV33_23>, challenge: SignedEnvelope<PostgresHaPitrChallengeV33_22>, bundlePackage: PostgresHaPitrBundlePackageV33_22, trust: EvidenceIntakeTrustV33_23, now: Date): void {
  if (!trust.trustedSessionSignerIds.includes(session.issuerKeyId) || !trust.sessionRegistry.verifyAt(session, session.payload.issuedAt)) throw new Error('intake_session_signature_invalid');
  verifyDigest(session.payload, 'sessionDigest', 'intake_session_digest_invalid');
  if (Date.parse(session.payload.issuedAt) > now.getTime() || Date.parse(session.payload.expiresAt) < now.getTime()) throw new Error('intake_session_expired');
  if (!trust.trustedChallengeSignerIds.includes(challenge.issuerKeyId) || !trust.challengeRegistry.verifyAt(challenge, challenge.payload.issuedAt)) throw new Error('intake_challenge_signature_invalid');
  verifyDigest(challenge.payload, 'challengeDigest', 'intake_challenge_digest_invalid');
  if (challenge.payload.productionAuthority !== 'NONE' || challenge.payload.externalEffectsExecuted !== 0 || challenge.payload.syntheticEvidenceAccepted || challenge.payload.sameHostEvidenceAccepted) throw new Error('intake_challenge_boundary_invalid');
  if (Date.parse(challenge.payload.expiresAt) < now.getTime()) throw new Error('intake_challenge_expired');
  if (session.payload.challengeId !== challenge.payload.challengeId || bundlePackage.envelope.payload.challengeId !== challenge.payload.challengeId) throw new Error('intake_challenge_binding_invalid');
  if (session.payload.operatorSignerId !== bundlePackage.envelope.issuerKeyId || session.payload.operatorRole !== bundlePackage.envelope.payload.operatorRole) throw new Error('intake_operator_binding_invalid');
}

function verifyBundleBytes(session: EvidenceIntakeSessionV33_23, challenge: SignedEnvelope<PostgresHaPitrChallengeV33_22>, bundlePackage: PostgresHaPitrBundlePackageV33_22, trust: EvidenceIntakeTrustV33_23, now: Date): void {
  const envelope = bundlePackage.envelope;
  if (!trust.trustedOperatorSignerIds.includes(envelope.issuerKeyId) || !trust.operatorRegistry.verifyAt(envelope, envelope.payload.collectedAt)) throw new Error('intake_bundle_signature_invalid');
  if (envelope.payload.operatorSignerId !== envelope.issuerKeyId || envelope.payload.version !== '33.22' || envelope.payload.productionAuthority !== 'NONE' || envelope.payload.externalEffectsExecuted !== 0) throw new Error('intake_bundle_boundary_invalid');
  if (envelope.payload.migrationChainDigest !== challenge.payload.migrationChainDigest || envelope.payload.serverVersionNum < challenge.payload.minimumServerVersionNum) throw new Error('intake_bundle_postgres_boundary_invalid');
  if (Date.parse(envelope.payload.collectedAt) < Date.parse(challenge.payload.issuedAt)) throw new Error('intake_bundle_time_invalid');
  verifyDigest(envelope.payload.operationalReceipt, 'receiptDigest', 'intake_operational_receipt_digest_invalid');
  verifyDigest(envelope.payload, 'bundleDigest', 'intake_bundle_digest_invalid');
  const manifestMaterial = envelope.payload.artifactManifest.map((artifact) => ({ ...artifact })).sort((a, b) => a.path.localeCompare(b.path));
  if (sha256(manifestMaterial) !== envelope.payload.artifactManifestDigest) throw new Error('intake_artifact_manifest_digest_invalid');
  if (envelope.payload.artifactManifest.length > session.maximumArtifactCount || envelope.payload.totalArtifactBytes > session.maximumTotalBytes) throw new Error('intake_session_budget_exceeded');
  if (envelope.payload.artifactManifest.length > challenge.payload.maximumArtifactCountPerBundle || envelope.payload.totalArtifactBytes > challenge.payload.maximumArtifactBytesPerBundle) throw new Error('intake_challenge_budget_exceeded');
  const paths = Object.keys(bundlePackage.artifactBytesByPath).sort();
  const manifestPaths = envelope.payload.artifactManifest.map((artifact) => artifact.path).sort();
  if (JSON.stringify(paths) !== JSON.stringify(manifestPaths)) throw new Error('intake_artifact_set_mismatch');
  let total = 0;
  const seen = new Set<string>();
  for (const artifact of envelope.payload.artifactManifest) {
    safePath(artifact.path);
    if (seen.has(artifact.path)) throw new Error('intake_artifact_duplicate_path');
    seen.add(artifact.path);
    if (!session.allowedMediaTypes.includes(artifact.mediaType)) throw new Error('intake_media_type_not_allowed');
    const bytes = bundlePackage.artifactBytesByPath[artifact.path];
    if (bytes === undefined || bytes.byteLength !== artifact.sizeBytes) throw new Error('intake_artifact_size_invalid');
    if (sha256Bytes(bytes) !== artifact.sha256) throw new Error('intake_artifact_digest_invalid');
    total += bytes.byteLength;
  }
  if (total !== envelope.payload.totalArtifactBytes) throw new Error('intake_total_bytes_invalid');
  if (Date.parse(envelope.payload.collectedAt) > now.getTime() + 5 * 60_000) throw new Error('intake_bundle_time_invalid');
}


function verifyBundleEnvelope(challenge: SignedEnvelope<PostgresHaPitrChallengeV33_22>, envelope: SignedEnvelope<PostgresHaPitrEvidenceBundleV33_22>, trust: EvidenceIntakeTrustV33_23): void {
  if (!trust.trustedOperatorSignerIds.includes(envelope.issuerKeyId) || !trust.operatorRegistry.verifyAt(envelope, envelope.payload.collectedAt)) throw new Error('quarantine_bundle_signature_invalid');
  if (envelope.payload.operatorSignerId !== envelope.issuerKeyId || envelope.payload.challengeId !== challenge.payload.challengeId) throw new Error('quarantine_bundle_binding_invalid');
  verifyDigest(envelope.payload, 'bundleDigest', 'quarantine_bundle_digest_invalid');
  verifyDigest(envelope.payload.operationalReceipt, 'receiptDigest', 'quarantine_operational_receipt_digest_invalid');
  if (sha256(envelope.payload.artifactManifest) !== envelope.payload.artifactManifestDigest) throw new Error('quarantine_manifest_digest_invalid');
}

function verifySnapshot(snapshot: QuarantineSnapshotV33_23, trust: EvidenceIntakeTrustV33_23, now: Date): void {
  verifyDigest(snapshot, 'snapshotDigest', 'quarantine_snapshot_digest_invalid');
  let previous = sha256('evidence-intake-quarantine-genesis-v33.23');
  for (let index = 0; index < snapshot.events.length; index += 1) {
    const event = snapshot.events[index]!;
    verifyDigest(event, 'eventDigest', 'quarantine_event_digest_invalid');
    if (event.sequence !== index + 1 || event.previousEventDigest !== previous) throw new Error('quarantine_event_chain_invalid');
    previous = event.eventDigest;
  }
  const ids = new Set<string>();
  const sessions = new Set<string>();
  for (const record of snapshot.records) {
    if (ids.has(record.bundle.payload.bundleId)) throw new Error('quarantine_duplicate_bundle');
    if (sessions.has(record.session.payload.sessionId)) throw new Error('quarantine_duplicate_session');
    ids.add(record.bundle.payload.bundleId); sessions.add(record.session.payload.sessionId);
    const historical = new Date(record.intakeReceipt.payload.acceptedAt);
    verifySession(record.session, record.challenge, { envelope: record.bundle, artifactBytesByPath: {} }, trust, historical);
    verifyBundleEnvelope(record.challenge, record.bundle, trust);
    if (!trust.trustedScannerSignerIds.includes(record.scanReport.issuerKeyId) || !trust.scannerRegistry.verifyAt(record.scanReport, record.scanReport.payload.scannedAt)) throw new Error('quarantine_scan_signature_invalid');
    if (!trust.trustedPortalSignerIds.includes(record.intakeReceipt.issuerKeyId) || !trust.portalRegistry.verifyAt(record.intakeReceipt, record.intakeReceipt.payload.acceptedAt)) throw new Error('quarantine_receipt_signature_invalid');
    verifyDigest(record.scanReport.payload, 'reportDigest', 'quarantine_scan_digest_invalid');
    for (const scan of record.scanReport.payload.artifactScans) verifyDigest(scan, 'artifactScanDigest', 'quarantine_artifact_scan_digest_invalid');
    if (record.scanReport.payload.findingCount !== record.scanReport.payload.artifactScans.reduce((sum,scan)=>sum+scan.findings.length,0)) throw new Error('quarantine_scan_finding_count_invalid');
    verifyDigest(record.intakeReceipt.payload, 'receiptDigest', 'quarantine_receipt_digest_invalid');
    if (record.scanReport.payload.bundleDigest !== record.bundle.payload.bundleDigest || record.intakeReceipt.payload.bundleDigest !== record.bundle.payload.bundleDigest || record.scanReport.payload.reportDigest !== record.intakeReceipt.payload.scanReportDigest || record.session.payload.sessionId !== record.intakeReceipt.payload.sessionId) throw new Error('quarantine_record_binding_invalid');
    for (const artifact of record.bundle.payload.artifactManifest) if (record.artifactObjectNames[artifact.path] !== `${artifact.sha256}.evidence`) throw new Error('quarantine_object_binding_invalid');
  }
  if (snapshot.events.length !== snapshot.records.length) throw new Error('quarantine_event_record_count_invalid');
  for (const event of snapshot.events) { const record=snapshot.records.find((item)=>item.bundle.payload.bundleId===event.bundleId); if (record===undefined || event.bundleDigest!==record.bundle.payload.bundleDigest || event.receiptDigest!==record.intakeReceipt.payload.receiptDigest || event.scanReportDigest!==record.scanReport.payload.reportDigest || event.status!==record.intakeReceipt.payload.quarantineStatus) throw new Error('quarantine_event_record_binding_invalid'); }
}

function createSnapshot(records: readonly QuarantineRecordV33_23[], events: readonly QuarantineEventV33_23[], now: Date): QuarantineSnapshotV33_23 {
  const material = { version: '33.23' as const, records: structuredClone(records), events: structuredClone(events), generatedAt: now.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return { ...material, snapshotDigest: sha256(material) };
}

function appendEvent(events: readonly QuarantineEventV33_23[], record: QuarantineRecordV33_23, now: Date): QuarantineEventV33_23 {
  const material = {
    version: '33.23' as const,
    sequence: events.length + 1,
    eventId: `quarantine-event-${randomUUID()}`,
    eventType: 'BUNDLE_QUARANTINED' as const,
    bundleId: record.bundle.payload.bundleId,
    bundleDigest: record.bundle.payload.bundleDigest,
    receiptDigest: record.intakeReceipt.payload.receiptDigest,
    scanReportDigest: record.scanReport.payload.reportDigest,
    status: record.intakeReceipt.payload.quarantineStatus,
    occurredAt: now.toISOString(),
    previousEventDigest: events.at(-1)?.eventDigest ?? sha256('evidence-intake-quarantine-genesis-v33.23'),
  };
  return { ...material, eventDigest: sha256(material) };
}

function enforceIdentityRoles(input: { scannerIdentity: SigningIdentity; portalIdentity: SigningIdentity; storeIdentity: SigningIdentity; exporterIdentity: SigningIdentity }): void {
  const ids = [input.scannerIdentity.keyId, input.portalIdentity.keyId, input.storeIdentity.keyId, input.exporterIdentity.keyId];
  if (new Set(ids).size !== ids.length) throw new Error('intake_identity_role_separation');
}

function exportTrustedKeys(trust: EvidenceIntakeTrustV33_23, keyIds: readonly string[]): readonly ExportedPublicKeyRecord[] {
  const registries = [trust.sessionRegistry, trust.challengeRegistry, trust.operatorRegistry, trust.scannerRegistry, trust.portalRegistry, trust.exporterRegistry, trust.verifierRegistry];
  const result = new Map<string, ExportedPublicKeyRecord>();
  for (const keyId of keyIds) {
    for (const registry of registries) {
      if (registry.fingerprint(keyId) !== undefined) { result.set(keyId, registry.exportPublicKey(keyId)); break; }
    }
  }
  if (result.size !== new Set(keyIds).size) throw new Error('offline_public_key_export_incomplete');
  return [...result.values()].sort((a, b) => a.keyId.localeCompare(b.keyId));
}

function detectType(bytes: Buffer, mediaType: string): EvidenceArtifactScanV33_23['detectedType'] {
  if (bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return 'ELF';
  if (bytes.subarray(0, 2).equals(Buffer.from('MZ'))) return 'PE';
  const magic = bytes.subarray(0, 4).toString('hex');
  if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'].includes(magic)) return 'MACHO';
  if (bytes.subarray(0, 2).equals(Buffer.from('PK'))) return 'ZIP';
  if (bytes.subarray(0, 8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))) return 'OLE';
  if (bytes.subarray(0, 2).toString() === '#!') return 'SCRIPT';
  if (mediaType === 'application/json') return 'JSON';
  if (mediaType === 'application/sql') return 'SQL';
  return isProbablyText(bytes) ? 'TEXT' : 'BINARY';
}

function isProbablyText(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  let controls = 0;
  for (const byte of bytes) if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) controls += 1;
  return bytes.length === 0 || controls / bytes.length < 0.01;
}

function safePath(path: string): string {
  if (path.trim() === '' || path.includes('\\') || path.startsWith('/') || path.includes('\0')) throw new Error('intake_artifact_path_invalid');
  const normalized = posix.normalize(path);
  if (normalized !== path || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || path.split('/').some((part) => part === '' || part === '.' || part === '..')) throw new Error('intake_artifact_path_invalid');
  return path;
}

function verifyDigest<T extends object>(value: T, field: keyof T, error: string): void {
  const copy = { ...(value as any) };
  const expected = copy[field as string];
  delete copy[field as string];
  if (typeof expected !== 'string' || sha256(copy) !== expected) throw new Error(error);
}

function acquireLock(path: string): number {
  try { return openSync(path, 'wx', 0o600); } catch { throw new Error('quarantine_store_locked'); }
}
function releaseLock(fd: number, path: string): void { try { closeSync(fd); } finally { try { unlinkSync(path); } catch {} } }
function atomicReplaceText(path: string, text: string): void { atomicReplaceBytes(path, Buffer.from(text)); }
function atomicReplaceBytes(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
}
function unique(values: readonly string[], error: string): readonly string[] { const filtered = values.map((value) => nonEmpty(value, error)); if (new Set(filtered).size !== filtered.length) throw new Error(error); return filtered; }
function nonEmpty(value: string, error: string): string { const result = value.trim(); if (result === '') throw new Error(error); return result; }
function boundedInteger(value: number, min: number, max: number, error: string): number { if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(error); return value; }
function json(response: ServerResponse, status: number, body: unknown): void { const bytes = Buffer.from(JSON.stringify(body)); response.writeHead(status, { 'content-type': 'application/json', 'content-length': bytes.byteLength, 'cache-control': 'no-store' }); response.end(bytes); }
async function readBody(request: IncomingMessage, maximumBodyBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let total = 0;
  for await (const chunk of request) { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); total += bytes.byteLength; if (total > maximumBodyBytes) throw new Error('intake_http_body_too_large'); chunks.push(bytes); }
  return Buffer.concat(chunks);
}
