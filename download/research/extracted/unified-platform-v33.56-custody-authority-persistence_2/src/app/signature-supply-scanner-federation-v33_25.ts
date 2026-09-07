import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join, posix, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  KeyRegistry,
  sha256,
  sha256Bytes,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';

export type ScannerEngineIdV33_25 = 'ENGINE_ALPHA' | 'ENGINE_BETA';
export type ExternalScannerEngineV33_25 = 'CLAMAV' | 'YARA';
export type SignatureEncodingV33_25 = 'UTF8_LITERAL' | 'HEX_PREFIX';
export type SignatureEngineScopeV33_25 = ScannerEngineIdV33_25 | 'BOTH';
export type FederationAvailabilityV33_25 = 'AVAILABLE' | 'UNAVAILABLE_FAIL_CLOSED';

export interface ScannerFederationToolProbeV33_25 {
  readonly version: '33.25';
  readonly clamscan: FederationAvailabilityV33_25;
  readonly freshclam: FederationAvailabilityV33_25;
  readonly yara: FederationAvailabilityV33_25;
  readonly yarac: FederationAvailabilityV33_25;
  readonly cosign: FederationAvailabilityV33_25;
  readonly gpg: FederationAvailabilityV33_25;
  readonly externalScannerFederationQualified: false;
  readonly probedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly probeDigest: string;
}

export interface FederatedSignatureRuleV33_25 {
  readonly ruleId: string;
  readonly category: 'MALWARE' | 'SECRET' | 'ACTIVE_CONTENT';
  readonly encoding: SignatureEncodingV33_25;
  readonly engineScope: SignatureEngineScopeV33_25;
  readonly pattern: string;
  readonly critical: boolean;
  readonly ruleDigest: string;
}

export interface ScannerSignatureFeedV33_25 {
  readonly version: '33.25';
  readonly feedId: string;
  readonly publisherOrganizationId: string;
  readonly sequence: number;
  readonly previousFeedDigest: string;
  readonly feedVersion: string;
  readonly sourceClass: 'LOCAL_REFERENCE_FEED' | 'LIVE_EXTERNAL_SIGNED_FEED';
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly minimumEngineVersions: Readonly<Record<ScannerEngineIdV33_25, string>>;
  readonly rules: readonly FederatedSignatureRuleV33_25[];
  readonly criticalRuleIds: readonly string[];
  readonly ruleSetDigest: string;
  readonly externalQualificationEligible: boolean;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly feedDigest: string;
}

export interface ScannerSignatureFeedRevocationV33_25 {
  readonly version: '33.25';
  readonly revocationId: string;
  readonly feedId: string;
  readonly feedDigest: string;
  readonly reason: 'COMPROMISED_PUBLISHER' | 'POISONED_FEED' | 'OPERATOR_REVOKED';
  readonly effectiveAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly revocationDigest: string;
}

export interface SignatureFeedLedgerSnapshotV33_25 {
  readonly version: '33.25';
  readonly ledgerId: string;
  readonly feeds: readonly SignedEnvelope<ScannerSignatureFeedV33_25>[];
  readonly revocations: readonly SignedEnvelope<ScannerSignatureFeedRevocationV33_25>[];
  readonly highestSequence: number;
  readonly latestFeedDigest: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export interface SignatureFeedWitnessV33_25 {
  readonly version: '33.25';
  readonly ledgerId: string;
  readonly highestSequence: number;
  readonly latestFeedDigest: string;
  readonly witnessedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly witnessDigest: string;
}

export interface FederatedArtifactRecordV33_25 {
  readonly path: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface FederatedArtifactPackageManifestV33_25 {
  readonly version: '33.25';
  readonly packageId: string;
  readonly evidenceClass: 'SYNTHETIC_CONTRACT_TEST' | 'LIVE_EXTERNAL_EVIDENCE';
  readonly artifacts: readonly FederatedArtifactRecordV33_25[];
  readonly createdAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly packageDigest: string;
}

export interface FederatedArtifactPackageV33_25 {
  readonly manifest: SignedEnvelope<FederatedArtifactPackageManifestV33_25>;
  readonly artifactBytesByPath: Readonly<Record<string, Uint8Array>>;
}

export interface ScannerArtifactResultV33_25 {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly matchedRuleIds: readonly string[];
  readonly status: 'CLEAN' | 'REJECTED';
  readonly resultDigest: string;
}

export interface ScannerEngineReceiptV33_25 {
  readonly version: '33.25';
  readonly scanId: string;
  readonly engine: ScannerEngineIdV33_25;
  readonly engineVersion: string;
  readonly implementationDigest: string;
  readonly workerPid: number;
  readonly parentPid: number;
  readonly separateProcessVerified: boolean;
  readonly packageId: string;
  readonly packageDigest: string;
  readonly feedId: string;
  readonly feedSequence: number;
  readonly feedDigest: string;
  readonly artifactResults: readonly ScannerArtifactResultV33_25[];
  readonly findingCount: number;
  readonly status: 'PASSED' | 'REJECTED';
  readonly scannedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface ScannerFederationVerdictV33_25 {
  readonly version: '33.25';
  readonly federationVerdictId: string;
  readonly packageId: string;
  readonly packageDigest: string;
  readonly feedId: string;
  readonly feedSequence: number;
  readonly feedDigest: string;
  readonly engineReceiptDigests: Readonly<Record<ScannerEngineIdV33_25, string>>;
  readonly distinctEngineSigners: boolean;
  readonly distinctImplementations: boolean;
  readonly exactArtifactDigestAgreement: boolean;
  readonly disagreementCount: number;
  readonly disagreementPolicy: 'FAIL_CLOSED_QUARANTINE';
  readonly status: 'FEDERATION_PASSED' | 'FEDERATION_REJECTED' | 'FEDERATION_QUARANTINED';
  readonly externalScannerFederationEligible: false;
  readonly evaluatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

export interface FederatedScanResultV33_25 {
  readonly alpha: SignedEnvelope<ScannerEngineReceiptV33_25>;
  readonly beta: SignedEnvelope<ScannerEngineReceiptV33_25>;
  readonly verdict: SignedEnvelope<ScannerFederationVerdictV33_25>;
}

export interface ExternalScannerFederationObservationV33_25 {
  readonly version: '33.25';
  readonly observationId: string;
  readonly evidenceClass: 'SYNTHETIC_CONTRACT_TEST' | 'LIVE_EXTERNAL_SCANNER_FEDERATION_EVIDENCE';
  readonly operatorOrganizationId: string;
  readonly operatorHostId: string;
  readonly clamavHostId: string;
  readonly yaraHostId: string;
  readonly clamavOrganizationId: string;
  readonly yaraOrganizationId: string;
  readonly feedPublisherOrganizationId: string;
  readonly engines: readonly ['CLAMAV', 'YARA'];
  readonly engineImplementationDigests: Readonly<Record<ExternalScannerEngineV33_25, string>>;
  readonly feedChainDepth: number;
  readonly feedExternallySigned: boolean;
  readonly feedFresh: boolean;
  readonly feedRollbackProtected: boolean;
  readonly signatureUpdateTransportAuthenticated: boolean;
  readonly disagreementPolicyFailClosed: boolean;
  readonly scanPassed: boolean;
  readonly independentVerifierSignerId: string;
  readonly artifactDigests: Readonly<Record<'clamavReceipt' | 'yaraReceipt' | 'feedChain' | 'feedWitness' | 'federationVerdict', string>>;
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly observationDigest: string;
}

export interface ExternalScannerFederationQualificationVerdictV33_25 {
  readonly version: '33.25';
  readonly verdictId: string;
  readonly status: 'EXTERNAL_SCANNER_FEDERATION_QUALIFIED' | 'EXTERNAL_SCANNER_FEDERATION_QUALIFICATION_REQUIRED' | 'REJECTED';
  readonly acceptedObservationCount: number;
  readonly syntheticObservationCount: number;
  readonly uniqueOperatorOrganizationCount: number;
  readonly uniqueScannerHostCount: number;
  readonly independentEngineOrganizationsVerified: boolean;
  readonly signedFreshFeedChainVerified: boolean;
  readonly rollbackProtectionVerified: boolean;
  readonly eligibleForProductionPromotion: false;
  readonly evaluatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

const ZERO_DIGEST = '0'.repeat(64);
const MAX_FEED_LIFETIME_MS = 7 * 24 * 60 * 60_000;
const MAX_FEED_AGE_MS = 48 * 60 * 60_000;
const CRITICAL_RULES = [
  criticalRule('EICAR_TEST_FILE', 'MALWARE', 'UTF8_LITERAL', 'BOTH', 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),
  criticalRule('PE_EXECUTABLE_MAGIC', 'ACTIVE_CONTENT', 'HEX_PREFIX', 'BOTH', '4d5a'),
  criticalRule('ELF_EXECUTABLE_MAGIC', 'ACTIVE_CONTENT', 'HEX_PREFIX', 'BOTH', '7f454c46'),
  criticalRule('PRIVATE_KEY_MATERIAL', 'SECRET', 'UTF8_LITERAL', 'BOTH', '-----BEGIN PRIVATE KEY-----'),
] as const;

export function probeScannerFederationToolsV33_25(now: Date = new Date()): ScannerFederationToolProbeV33_25 {
  const command = (name: string): FederationAvailabilityV33_25 => {
    const result = spawnSync('bash', ['-lc', `command -v ${name} >/dev/null 2>&1`], { stdio: 'ignore' });
    return result.status === 0 ? 'AVAILABLE' : 'UNAVAILABLE_FAIL_CLOSED';
  };
  const material = {
    version: '33.25' as const,
    clamscan: command('clamscan'), freshclam: command('freshclam'), yara: command('yara'), yarac: command('yarac'),
    cosign: command('cosign'), gpg: command('gpg'),
    externalScannerFederationQualified: false as const,
    probedAt: now.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return { ...material, probeDigest: sha256(material) };
}

export function createGenesisSignatureFeedV33_25(input: {
  readonly signer: SigningIdentity;
  readonly publisherOrganizationId: string;
  readonly now?: Date;
  readonly expiresInMs?: number;
  readonly sourceClass?: ScannerSignatureFeedV33_25['sourceClass'];
  readonly additionalRules?: readonly Omit<FederatedSignatureRuleV33_25, 'ruleDigest' | 'critical'>[];
}): SignedEnvelope<ScannerSignatureFeedV33_25> {
  return createFeed({ ...input, sequence: 1, previousFeedDigest: ZERO_DIGEST, feedVersion: '33.25-feed-1' });
}

export function createSignatureFeedUpdateV33_25(input: {
  readonly previous: SignedEnvelope<ScannerSignatureFeedV33_25>;
  readonly signer: SigningIdentity;
  readonly publisherOrganizationId: string;
  readonly now?: Date;
  readonly expiresInMs?: number;
  readonly sourceClass?: ScannerSignatureFeedV33_25['sourceClass'];
  readonly additionalRules?: readonly Omit<FederatedSignatureRuleV33_25, 'ruleDigest' | 'critical'>[];
}): SignedEnvelope<ScannerSignatureFeedV33_25> {
  const prior = input.previous.payload;
  return createFeed({
    signer: input.signer,
    publisherOrganizationId: input.publisherOrganizationId,
    sourceClass: input.sourceClass ?? prior.sourceClass,
    sequence: prior.sequence + 1,
    previousFeedDigest: prior.feedDigest,
    feedVersion: `33.25-feed-${prior.sequence + 1}`,
    feedId: prior.feedId,
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.expiresInMs === undefined ? {} : { expiresInMs: input.expiresInMs }),
    ...(input.additionalRules === undefined ? {} : { additionalRules: input.additionalRules }),
  });
}

export function createSignatureFeedRevocationV33_25(input: {
  readonly feed: SignedEnvelope<ScannerSignatureFeedV33_25>;
  readonly signer: SigningIdentity;
  readonly reason: ScannerSignatureFeedRevocationV33_25['reason'];
  readonly effectiveAt?: Date;
}): SignedEnvelope<ScannerSignatureFeedRevocationV33_25> {
  const effectiveAt = input.effectiveAt ?? new Date();
  const material = {
    version: '33.25' as const,
    revocationId: `scanner-feed-revocation-${randomUUID()}`,
    feedId: input.feed.payload.feedId,
    feedDigest: input.feed.payload.feedDigest,
    reason: input.reason,
    effectiveAt: effectiveAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, revocationDigest: sha256(material) }, input.signer);
}

export class SignatureFeedLedgerV33_25 {
  readonly #root: string;
  readonly #snapshotPath: string;
  readonly #witnessPath: string;
  readonly #storeIdentity: SigningIdentity;
  readonly #storeRegistry: KeyRegistry;
  readonly #trustedStoreSignerIds: readonly string[];
  readonly #witnessIdentity: SigningIdentity;
  readonly #witnessRegistry: KeyRegistry;
  readonly #trustedWitnessSignerIds: readonly string[];
  readonly #publisherRegistry: KeyRegistry;
  readonly #trustedPublisherSignerIds: readonly string[];
  readonly #revokerRegistry: KeyRegistry;
  readonly #trustedRevokerSignerIds: readonly string[];
  #snapshot: SignedEnvelope<SignatureFeedLedgerSnapshotV33_25>;
  #witness: SignedEnvelope<SignatureFeedWitnessV33_25>;

  constructor(input: {
    readonly root: string;
    readonly storeIdentity: SigningIdentity;
    readonly storeRegistry: KeyRegistry;
    readonly trustedStoreSignerIds: readonly string[];
    readonly witnessIdentity: SigningIdentity;
    readonly witnessRegistry: KeyRegistry;
    readonly trustedWitnessSignerIds: readonly string[];
    readonly publisherRegistry: KeyRegistry;
    readonly trustedPublisherSignerIds: readonly string[];
    readonly revokerRegistry: KeyRegistry;
    readonly trustedRevokerSignerIds: readonly string[];
    readonly now?: Date;
  }) {
    this.#root = resolve(nonEmpty(input.root, 'feed_ledger_root_required'));
    this.#snapshotPath = join(this.#root, 'signature-feed-ledger.json');
    this.#witnessPath = join(this.#root, 'signature-feed-witness.json');
    this.#storeIdentity = input.storeIdentity;
    this.#storeRegistry = input.storeRegistry;
    this.#trustedStoreSignerIds = unique(input.trustedStoreSignerIds, 'duplicate_store_signer');
    this.#witnessIdentity = input.witnessIdentity;
    this.#witnessRegistry = input.witnessRegistry;
    this.#trustedWitnessSignerIds = unique(input.trustedWitnessSignerIds, 'duplicate_witness_signer');
    this.#publisherRegistry = input.publisherRegistry;
    this.#trustedPublisherSignerIds = unique(input.trustedPublisherSignerIds, 'duplicate_publisher_signer');
    this.#revokerRegistry = input.revokerRegistry;
    this.#trustedRevokerSignerIds = unique(input.trustedRevokerSignerIds, 'duplicate_revoker_signer');
    enforceRoleSeparation(input);
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    const now = input.now ?? new Date();
    if (existsSync(this.#snapshotPath) || existsSync(this.#witnessPath)) {
      if (!existsSync(this.#snapshotPath) || !existsSync(this.#witnessPath)) throw new Error('feed_ledger_partial_state');
      this.#snapshot = this.#readSnapshot(now);
      this.#witness = this.#readWitness(now);
      this.#verifyState(now);
    } else {
      const ledgerId = `signature-feed-ledger-${randomUUID()}`;
      this.#snapshot = signSnapshot({ ledgerId, feeds: [], revocations: [], createdAt: now.toISOString(), updatedAt: now.toISOString() }, this.#storeIdentity);
      this.#witness = signWitness({ ledgerId, highestSequence: 0, latestFeedDigest: ZERO_DIGEST, witnessedAt: now.toISOString() }, this.#witnessIdentity);
      this.#persist();
    }
  }

  append(feed: SignedEnvelope<ScannerSignatureFeedV33_25>, now: Date = new Date()): SignedEnvelope<SignatureFeedLedgerSnapshotV33_25> {
    this.#refresh(now);
    const existing = this.#snapshot.payload.feeds.find((entry) => entry.payload.sequence === feed.payload.sequence);
    if (existing !== undefined) {
      if (existing.payload.feedDigest !== feed.payload.feedDigest) throw new Error('signature_feed_sequence_conflict');
      return structuredClone(this.#snapshot);
    }
    const latest = this.#snapshot.payload.feeds.at(-1);
    verifyFeedEnvelope(feed, this.#publisherRegistry, this.#trustedPublisherSignerIds, now, latest);
    const feeds = [...this.#snapshot.payload.feeds, structuredClone(feed)];
    const updated = signSnapshot({
      ledgerId: this.#snapshot.payload.ledgerId,
      feeds,
      revocations: this.#snapshot.payload.revocations,
      createdAt: this.#snapshot.payload.createdAt,
      updatedAt: now.toISOString(),
    }, this.#storeIdentity);
    const witness = signWitness({ ledgerId: updated.payload.ledgerId, highestSequence: feed.payload.sequence, latestFeedDigest: feed.payload.feedDigest, witnessedAt: now.toISOString() }, this.#witnessIdentity);
    this.#snapshot = updated;
    this.#witness = witness;
    this.#persist();
    return structuredClone(this.#snapshot);
  }

  revoke(revocation: SignedEnvelope<ScannerSignatureFeedRevocationV33_25>, now: Date = new Date()): SignedEnvelope<SignatureFeedLedgerSnapshotV33_25> {
    this.#refresh(now);
    if (!this.#trustedRevokerSignerIds.includes(revocation.issuerKeyId) || !this.#revokerRegistry.verifyAt(revocation, revocation.payload.effectiveAt)) throw new Error('signature_feed_revocation_signature_invalid');
    verifyDigestField(revocation.payload, 'revocationDigest', 'signature_feed_revocation_digest_invalid');
    if (!this.#snapshot.payload.feeds.some((feed) => feed.payload.feedId === revocation.payload.feedId && feed.payload.feedDigest === revocation.payload.feedDigest)) throw new Error('signature_feed_revocation_target_missing');
    const prior = this.#snapshot.payload.revocations.find((entry) => entry.payload.feedDigest === revocation.payload.feedDigest);
    if (prior !== undefined) {
      if (prior.payload.revocationDigest !== revocation.payload.revocationDigest) throw new Error('signature_feed_revocation_conflict');
      return structuredClone(this.#snapshot);
    }
    this.#snapshot = signSnapshot({
      ledgerId: this.#snapshot.payload.ledgerId,
      feeds: this.#snapshot.payload.feeds,
      revocations: [...this.#snapshot.payload.revocations, structuredClone(revocation)],
      createdAt: this.#snapshot.payload.createdAt,
      updatedAt: now.toISOString(),
    }, this.#storeIdentity);
    this.#persist();
    return structuredClone(this.#snapshot);
  }

  assertUsable(feed: SignedEnvelope<ScannerSignatureFeedV33_25>, now: Date = new Date()): void {
    this.#refresh(now);
    const latest = this.#snapshot.payload.feeds.at(-1);
    if (latest === undefined || latest.payload.feedDigest !== feed.payload.feedDigest) throw new Error('signature_feed_not_latest');
    verifyFeedEnvelope(feed, this.#publisherRegistry, this.#trustedPublisherSignerIds, now, this.#snapshot.payload.feeds.at(-2));
    if (this.#snapshot.payload.revocations.some((entry) => entry.payload.feedDigest === feed.payload.feedDigest && Date.parse(entry.payload.effectiveAt) <= now.getTime())) throw new Error('signature_feed_revoked');
    if (this.#witness.payload.highestSequence !== feed.payload.sequence || this.#witness.payload.latestFeedDigest !== feed.payload.feedDigest) throw new Error('signature_feed_witness_mismatch');
  }

  snapshot(): SignedEnvelope<SignatureFeedLedgerSnapshotV33_25> { return structuredClone(this.#snapshot); }
  witness(): SignedEnvelope<SignatureFeedWitnessV33_25> { return structuredClone(this.#witness); }

  #refresh(now: Date): void {
    this.#snapshot = this.#readSnapshot(now);
    this.#witness = this.#readWitness(now);
    this.#verifyState(now);
  }

  #readSnapshot(now: Date): SignedEnvelope<SignatureFeedLedgerSnapshotV33_25> {
    const envelope = parseJson<SignedEnvelope<SignatureFeedLedgerSnapshotV33_25>>(this.#snapshotPath, 'signature_feed_snapshot_invalid');
    if (!this.#trustedStoreSignerIds.includes(envelope.issuerKeyId) || !this.#storeRegistry.verifyAt(envelope, now)) throw new Error('signature_feed_snapshot_signature_invalid');
    verifyDigestField(envelope.payload, 'snapshotDigest', 'signature_feed_snapshot_digest_invalid');
    return envelope;
  }

  #readWitness(now: Date): SignedEnvelope<SignatureFeedWitnessV33_25> {
    const envelope = parseJson<SignedEnvelope<SignatureFeedWitnessV33_25>>(this.#witnessPath, 'signature_feed_witness_invalid');
    if (!this.#trustedWitnessSignerIds.includes(envelope.issuerKeyId) || !this.#witnessRegistry.verifyAt(envelope, now)) throw new Error('signature_feed_witness_signature_invalid');
    verifyDigestField(envelope.payload, 'witnessDigest', 'signature_feed_witness_digest_invalid');
    return envelope;
  }

  #verifyState(now: Date): void {
    if (this.#snapshot.payload.ledgerId !== this.#witness.payload.ledgerId) throw new Error('signature_feed_ledger_witness_binding_invalid');
    let previous: SignedEnvelope<ScannerSignatureFeedV33_25> | undefined;
    for (const feed of this.#snapshot.payload.feeds) {
      verifyFeedEnvelope(feed, this.#publisherRegistry, this.#trustedPublisherSignerIds, now, previous, false);
      previous = feed;
    }
    for (const revocation of this.#snapshot.payload.revocations) {
      if (!this.#trustedRevokerSignerIds.includes(revocation.issuerKeyId) || !this.#revokerRegistry.verifyAt(revocation, revocation.payload.effectiveAt)) throw new Error('signature_feed_revocation_signature_invalid');
      verifyDigestField(revocation.payload, 'revocationDigest', 'signature_feed_revocation_digest_invalid');
    }
    const latest = this.#snapshot.payload.feeds.at(-1);
    const highestSequence = latest?.payload.sequence ?? 0;
    const latestFeedDigest = latest?.payload.feedDigest ?? ZERO_DIGEST;
    if (this.#snapshot.payload.highestSequence !== highestSequence || this.#snapshot.payload.latestFeedDigest !== latestFeedDigest) throw new Error('signature_feed_snapshot_summary_invalid');
    if (this.#witness.payload.highestSequence !== highestSequence || this.#witness.payload.latestFeedDigest !== latestFeedDigest) throw new Error('signature_feed_rollback_detected');
  }

  #persist(): void {
    atomicJson(this.#snapshotPath, this.#snapshot);
    atomicJson(this.#witnessPath, this.#witness);
  }
}

export function createFederatedArtifactPackageV33_25(input: {
  readonly signer: SigningIdentity;
  readonly artifacts: Readonly<Record<string, { readonly mediaType: string; readonly bytes: Uint8Array }>>;
  readonly evidenceClass?: FederatedArtifactPackageManifestV33_25['evidenceClass'];
  readonly now?: Date;
}): FederatedArtifactPackageV33_25 {
  const now = input.now ?? new Date();
  const paths = Object.keys(input.artifacts).sort();
  if (paths.length === 0 || paths.length > 64) throw new Error('federated_package_artifact_count_invalid');
  const bytesByPath: Record<string, Uint8Array> = {};
  const artifacts = paths.map((path) => {
    safePath(path);
    const record = input.artifacts[path];
    if (record === undefined || record.bytes.byteLength === 0 || record.bytes.byteLength > 8 * 1024 * 1024) throw new Error('federated_package_artifact_invalid');
    bytesByPath[path] = new Uint8Array(record.bytes);
    return { path, mediaType: nonEmpty(record.mediaType, 'artifact_media_type_required'), sizeBytes: record.bytes.byteLength, sha256: sha256Bytes(record.bytes) };
  });
  const material = {
    version: '33.25' as const,
    packageId: `federated-scan-package-${randomUUID()}`,
    evidenceClass: input.evidenceClass ?? 'SYNTHETIC_CONTRACT_TEST' as const,
    artifacts,
    createdAt: now.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { manifest: signEnvelope({ ...material, packageDigest: sha256(material) }, input.signer), artifactBytesByPath: bytesByPath };
}

export function runFederatedScannerV33_25(input: {
  readonly package: FederatedArtifactPackageV33_25;
  readonly packageRegistry: KeyRegistry;
  readonly trustedPackageSignerIds: readonly string[];
  readonly feed: SignedEnvelope<ScannerSignatureFeedV33_25>;
  readonly ledger: SignatureFeedLedgerV33_25;
  readonly alphaIdentity: SigningIdentity;
  readonly betaIdentity: SigningIdentity;
  readonly federationIdentity: SigningIdentity;
  readonly now?: Date;
  readonly alphaWorkerPath?: string;
  readonly betaWorkerPath?: string;
}): FederatedScanResultV33_25 {
  const now = input.now ?? new Date();
  verifyPackage(input.package, input.packageRegistry, input.trustedPackageSignerIds, now);
  input.ledger.assertUsable(input.feed, now);
  if (new Set([input.alphaIdentity.keyId, input.betaIdentity.keyId, input.federationIdentity.keyId]).size !== 3) throw new Error('scanner_federation_role_separation_invalid');
  const alphaWorkerPath = resolve(input.alphaWorkerPath ?? 'scripts/scanner-engine-alpha-worker-v33_25.mjs');
  const betaWorkerPath = resolve(input.betaWorkerPath ?? 'scripts/scanner-engine-beta-worker-v33_25.mjs');
  if (alphaWorkerPath === betaWorkerPath) throw new Error('scanner_federation_implementation_not_independent');
  const alpha = runEngine('ENGINE_ALPHA', alphaWorkerPath, input.alphaIdentity);
  const beta = runEngine('ENGINE_BETA', betaWorkerPath, input.betaIdentity);
  const exactArtifactDigestAgreement = alpha.payload.artifactResults.length === beta.payload.artifactResults.length && alpha.payload.artifactResults.every((entry, index) => {
    const peer = beta.payload.artifactResults[index];
    return peer !== undefined && entry.path === peer.path && entry.sha256 === peer.sha256 && entry.sizeBytes === peer.sizeBytes;
  });
  if (!exactArtifactDigestAgreement) throw new Error('scanner_federation_artifact_digest_mismatch');
  const disagreementCount = alpha.payload.artifactResults.reduce((count, entry, index) => count + (entry.status === beta.payload.artifactResults[index]!.status ? 0 : 1), 0);
  const bothPassed = alpha.payload.status === 'PASSED' && beta.payload.status === 'PASSED';
  const bothRejected = alpha.payload.status === 'REJECTED' && beta.payload.status === 'REJECTED' && disagreementCount === 0;
  const status = disagreementCount > 0 ? 'FEDERATION_QUARANTINED' as const : bothPassed ? 'FEDERATION_PASSED' as const : bothRejected ? 'FEDERATION_REJECTED' as const : 'FEDERATION_QUARANTINED' as const;
  const material = {
    version: '33.25' as const,
    federationVerdictId: `scanner-federation-verdict-${randomUUID()}`,
    packageId: input.package.manifest.payload.packageId,
    packageDigest: input.package.manifest.payload.packageDigest,
    feedId: input.feed.payload.feedId,
    feedSequence: input.feed.payload.sequence,
    feedDigest: input.feed.payload.feedDigest,
    engineReceiptDigests: { ENGINE_ALPHA: alpha.payload.receiptDigest, ENGINE_BETA: beta.payload.receiptDigest },
    distinctEngineSigners: true,
    distinctImplementations: alpha.payload.implementationDigest !== beta.payload.implementationDigest,
    exactArtifactDigestAgreement,
    disagreementCount,
    disagreementPolicy: 'FAIL_CLOSED_QUARANTINE' as const,
    status,
    externalScannerFederationEligible: false as const,
    evaluatedAt: now.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  if (!material.distinctImplementations) throw new Error('scanner_federation_implementation_not_independent');
  return { alpha, beta, verdict: signEnvelope({ ...material, verdictDigest: sha256(material) }, input.federationIdentity) };

  function runEngine(engine: ScannerEngineIdV33_25, workerPath: string, identity: SigningIdentity): SignedEnvelope<ScannerEngineReceiptV33_25> {
    if (!existsSync(workerPath)) throw new Error('scanner_worker_missing');
    const temp = mkdtempSync(join(tmpdir(), `v3325-${engine.toLowerCase()}-`));
    try {
      const requestPath = join(temp, 'request.json');
      const resultPath = join(temp, 'result.json');
      const artifacts = input.package.manifest.payload.artifacts.map((artifact) => ({ ...artifact, bytesBase64: Buffer.from(input.package.artifactBytesByPath[artifact.path]!).toString('base64') }));
      writeFileSync(requestPath, JSON.stringify({ engine, artifacts, rules: input.feed.payload.rules }));
      const child = spawnSync(process.execPath, [workerPath, requestPath, resultPath], { encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH ?? '', HOME: temp, NODE_OPTIONS: '' } });
      if (child.error !== undefined || child.status !== 0 || !existsSync(resultPath)) throw new Error('scanner_worker_failed');
      const output = parseJson<WorkerOutput>(resultPath, 'scanner_worker_output_invalid');
      if (output.engine !== engine || output.workerPid === process.pid || output.parentPid !== process.pid || output.engineVersion.trim() === '') throw new Error('scanner_worker_identity_invalid');
      const artifactResults = output.results.map((result) => {
        const materialResult = { ...result, matchedRuleIds: [...result.matchedRuleIds].sort() };
        return { ...materialResult, resultDigest: sha256(materialResult) };
      }).sort((a, b) => a.path.localeCompare(b.path));
      if (artifactResults.length !== input.package.manifest.payload.artifacts.length) throw new Error('scanner_worker_result_count_invalid');
      const status = artifactResults.some((entry) => entry.status === 'REJECTED') ? 'REJECTED' as const : 'PASSED' as const;
      const materialReceipt = {
        version: '33.25' as const,
        scanId: `federated-engine-scan-${randomUUID()}`,
        engine,
        engineVersion: output.engineVersion,
        implementationDigest: sha256Bytes(readFileSync(workerPath)),
        workerPid: output.workerPid,
        parentPid: output.parentPid,
        separateProcessVerified: true,
        packageId: input.package.manifest.payload.packageId,
        packageDigest: input.package.manifest.payload.packageDigest,
        feedId: input.feed.payload.feedId,
        feedSequence: input.feed.payload.sequence,
        feedDigest: input.feed.payload.feedDigest,
        artifactResults,
        findingCount: artifactResults.reduce((sum, entry) => sum + entry.matchedRuleIds.length, 0),
        status,
        scannedAt: now.toISOString(),
        productionAuthority: 'NONE' as const,
        externalEffectsExecuted: 0 as const,
      };
      return signEnvelope({ ...materialReceipt, receiptDigest: sha256(materialReceipt) }, identity);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }
}

export function createExternalScannerFederationObservationV33_25(input: {
  readonly signer: SigningIdentity;
  readonly verifierSignerId: string;
  readonly evidenceClass?: ExternalScannerFederationObservationV33_25['evidenceClass'];
  readonly operatorOrganizationId: string;
  readonly operatorHostId: string;
  readonly clamavHostId: string;
  readonly yaraHostId: string;
  readonly clamavOrganizationId: string;
  readonly yaraOrganizationId: string;
  readonly feedPublisherOrganizationId: string;
  readonly feedChainDepth?: number;
  readonly feedExternallySigned?: boolean;
  readonly feedFresh?: boolean;
  readonly feedRollbackProtected?: boolean;
  readonly signatureUpdateTransportAuthenticated?: boolean;
  readonly disagreementPolicyFailClosed?: boolean;
  readonly scanPassed?: boolean;
  readonly artifactDigests?: ExternalScannerFederationObservationV33_25['artifactDigests'];
  readonly observedAt?: Date;
}): SignedEnvelope<ExternalScannerFederationObservationV33_25> {
  const observedAt = input.observedAt ?? new Date();
  const material = {
    version: '33.25' as const,
    observationId: `external-scanner-federation-observation-${randomUUID()}`,
    evidenceClass: input.evidenceClass ?? 'LIVE_EXTERNAL_SCANNER_FEDERATION_EVIDENCE' as const,
    operatorOrganizationId: nonEmpty(input.operatorOrganizationId, 'operator_organization_required'),
    operatorHostId: nonEmpty(input.operatorHostId, 'operator_host_required'),
    clamavHostId: nonEmpty(input.clamavHostId, 'clamav_host_required'),
    yaraHostId: nonEmpty(input.yaraHostId, 'yara_host_required'),
    clamavOrganizationId: nonEmpty(input.clamavOrganizationId, 'clamav_organization_required'),
    yaraOrganizationId: nonEmpty(input.yaraOrganizationId, 'yara_organization_required'),
    feedPublisherOrganizationId: nonEmpty(input.feedPublisherOrganizationId, 'feed_publisher_organization_required'),
    engines: ['CLAMAV', 'YARA'] as const,
    engineImplementationDigests: { CLAMAV: 'a'.repeat(64), YARA: 'b'.repeat(64) },
    feedChainDepth: input.feedChainDepth ?? 3,
    feedExternallySigned: input.feedExternallySigned ?? true,
    feedFresh: input.feedFresh ?? true,
    feedRollbackProtected: input.feedRollbackProtected ?? true,
    signatureUpdateTransportAuthenticated: input.signatureUpdateTransportAuthenticated ?? true,
    disagreementPolicyFailClosed: input.disagreementPolicyFailClosed ?? true,
    scanPassed: input.scanPassed ?? true,
    independentVerifierSignerId: nonEmpty(input.verifierSignerId, 'independent_verifier_required'),
    artifactDigests: input.artifactDigests ?? { clamavReceipt: '1'.repeat(64), yaraReceipt: '2'.repeat(64), feedChain: '3'.repeat(64), feedWitness: '4'.repeat(64), federationVerdict: '5'.repeat(64) },
    observedAt: observedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, observationDigest: sha256(material) }, input.signer);
}

export function evaluateExternalScannerFederationQualificationV33_25(input: {
  readonly observations: readonly SignedEnvelope<ExternalScannerFederationObservationV33_25>[];
  readonly observationRegistry: KeyRegistry;
  readonly trustedOperatorSignerIds: readonly string[];
  readonly verifierIdentity: SigningIdentity;
  readonly now?: Date;
}): SignedEnvelope<ExternalScannerFederationQualificationVerdictV33_25> {
  const now = input.now ?? new Date();
  const trusted = unique(input.trustedOperatorSignerIds, 'duplicate_operator_signer');
  const accepted: ExternalScannerFederationObservationV33_25[] = [];
  let syntheticObservationCount = 0;
  for (const envelope of input.observations) {
    const observation = envelope.payload;
    if (!trusted.includes(envelope.issuerKeyId) || !input.observationRegistry.verifyAt(envelope, observation.observedAt)) throw new Error('scanner_federation_observation_signature_invalid');
    verifyDigestField(observation, 'observationDigest', 'scanner_federation_observation_digest_invalid');
    if (envelope.issuerKeyId === input.verifierIdentity.keyId || observation.independentVerifierSignerId !== input.verifierIdentity.keyId) throw new Error('scanner_federation_observation_role_boundary_invalid');
    for (const digest of Object.values(observation.artifactDigests)) if (!isDigest(digest)) throw new Error('scanner_federation_observation_artifact_digest_invalid');
    if (!isDigest(observation.engineImplementationDigests.CLAMAV) || !isDigest(observation.engineImplementationDigests.YARA) || observation.engineImplementationDigests.CLAMAV === observation.engineImplementationDigests.YARA) throw new Error('scanner_federation_engine_digest_invalid');
    if (observation.evidenceClass === 'SYNTHETIC_CONTRACT_TEST') { syntheticObservationCount += 1; continue; }
    const orgs = new Set([observation.clamavOrganizationId, observation.yaraOrganizationId, observation.feedPublisherOrganizationId]);
    const hosts = new Set([observation.operatorHostId, observation.clamavHostId, observation.yaraHostId]);
    if (orgs.size !== 3 || hosts.size !== 3 || observation.feedChainDepth < 3 || !observation.feedExternallySigned || !observation.feedFresh || !observation.feedRollbackProtected || !observation.signatureUpdateTransportAuthenticated || !observation.disagreementPolicyFailClosed || !observation.scanPassed) continue;
    accepted.push(observation);
  }
  const uniqueOperatorOrganizationCount = new Set(accepted.map((entry) => entry.operatorOrganizationId)).size;
  const uniqueScannerHostCount = new Set(accepted.flatMap((entry) => [entry.clamavHostId, entry.yaraHostId])).size;
  const qualified = accepted.length >= 2 && uniqueOperatorOrganizationCount >= 2 && uniqueScannerHostCount >= 4;
  const material = {
    version: '33.25' as const,
    verdictId: `external-scanner-federation-verdict-${randomUUID()}`,
    status: qualified ? 'EXTERNAL_SCANNER_FEDERATION_QUALIFIED' as const : 'EXTERNAL_SCANNER_FEDERATION_QUALIFICATION_REQUIRED' as const,
    acceptedObservationCount: accepted.length,
    syntheticObservationCount,
    uniqueOperatorOrganizationCount,
    uniqueScannerHostCount,
    independentEngineOrganizationsVerified: accepted.length > 0 && accepted.every((entry) => entry.clamavOrganizationId !== entry.yaraOrganizationId),
    signedFreshFeedChainVerified: accepted.length > 0 && accepted.every((entry) => entry.feedExternallySigned && entry.feedFresh && entry.feedChainDepth >= 3),
    rollbackProtectionVerified: accepted.length > 0 && accepted.every((entry) => entry.feedRollbackProtected),
    eligibleForProductionPromotion: false as const,
    evaluatedAt: now.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, verdictDigest: sha256(material) }, input.verifierIdentity);
}

function createFeed(input: {
  readonly signer: SigningIdentity;
  readonly publisherOrganizationId: string;
  readonly sequence: number;
  readonly previousFeedDigest: string;
  readonly feedVersion: string;
  readonly feedId?: string;
  readonly now?: Date;
  readonly expiresInMs?: number;
  readonly sourceClass?: ScannerSignatureFeedV33_25['sourceClass'];
  readonly additionalRules?: readonly Omit<FederatedSignatureRuleV33_25, 'ruleDigest' | 'critical'>[];
}): SignedEnvelope<ScannerSignatureFeedV33_25> {
  const now = input.now ?? new Date();
  const expiresInMs = boundedInteger(input.expiresInMs ?? 24 * 60 * 60_000, 60_000, MAX_FEED_LIFETIME_MS, 'signature_feed_expiry_invalid');
  const additional = (input.additionalRules ?? []).map((entry) => makeRule({ ...entry, critical: false }));
  const rules = [...CRITICAL_RULES.map((entry) => ({ ...entry })), ...additional].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  if (new Set(rules.map((entry) => entry.ruleId)).size !== rules.length) throw new Error('signature_feed_duplicate_rule');
  const material = {
    version: '33.25' as const,
    feedId: input.feedId ?? `scanner-signature-feed-${randomUUID()}`,
    publisherOrganizationId: nonEmpty(input.publisherOrganizationId, 'publisher_organization_required'),
    sequence: boundedInteger(input.sequence, 1, Number.MAX_SAFE_INTEGER, 'signature_feed_sequence_invalid'),
    previousFeedDigest: requireDigest(input.previousFeedDigest, 'signature_feed_previous_digest_invalid'),
    feedVersion: nonEmpty(input.feedVersion, 'signature_feed_version_required'),
    sourceClass: input.sourceClass ?? 'LOCAL_REFERENCE_FEED' as const,
    generatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + expiresInMs).toISOString(),
    minimumEngineVersions: { ENGINE_ALPHA: '33.25-alpha-1', ENGINE_BETA: '33.25-beta-1' },
    rules,
    criticalRuleIds: CRITICAL_RULES.map((entry) => entry.ruleId).sort(),
    ruleSetDigest: sha256(rules),
    externalQualificationEligible: (input.sourceClass ?? 'LOCAL_REFERENCE_FEED') === 'LIVE_EXTERNAL_SIGNED_FEED',
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, feedDigest: sha256(material) }, input.signer);
}

function verifyFeedEnvelope(
  feed: SignedEnvelope<ScannerSignatureFeedV33_25>,
  registry: KeyRegistry,
  trustedSignerIds: readonly string[],
  now: Date,
  previous?: SignedEnvelope<ScannerSignatureFeedV33_25>,
  requireFresh = true,
): void {
  const payload = feed.payload;
  if (!trustedSignerIds.includes(feed.issuerKeyId) || !registry.verifyAt(feed, payload.generatedAt)) throw new Error('signature_feed_signature_invalid');
  verifyDigestField(payload, 'feedDigest', 'signature_feed_digest_invalid');
  if (payload.ruleSetDigest !== sha256(payload.rules)) throw new Error('signature_feed_ruleset_digest_invalid');
  if (payload.productionAuthority !== 'NONE' || payload.externalEffectsExecuted !== 0) throw new Error('signature_feed_authority_boundary_invalid');
  if (payload.externalQualificationEligible !== (payload.sourceClass === 'LIVE_EXTERNAL_SIGNED_FEED')) throw new Error('signature_feed_qualification_flag_invalid');
  const generated = Date.parse(payload.generatedAt); const expires = Date.parse(payload.expiresAt);
  if (!Number.isFinite(generated) || !Number.isFinite(expires) || expires <= generated || expires - generated > MAX_FEED_LIFETIME_MS) throw new Error('signature_feed_time_invalid');
  if (generated > now.getTime() + 60_000) throw new Error('signature_feed_from_future');
  if (requireFresh && (expires <= now.getTime() || now.getTime() - generated > MAX_FEED_AGE_MS)) throw new Error('signature_feed_stale');
  if (previous === undefined) {
    if (payload.sequence !== 1 || payload.previousFeedDigest !== ZERO_DIGEST) throw new Error('signature_feed_genesis_invalid');
  } else {
    if (payload.sequence !== previous.payload.sequence + 1 || payload.previousFeedDigest !== previous.payload.feedDigest) throw new Error('signature_feed_chain_invalid');
    if (payload.feedId !== previous.payload.feedId || payload.publisherOrganizationId !== previous.payload.publisherOrganizationId || feed.issuerKeyId !== previous.issuerKeyId) throw new Error('signature_feed_publisher_continuity_invalid');
    if (Date.parse(payload.generatedAt) <= Date.parse(previous.payload.generatedAt)) throw new Error('signature_feed_time_nonmonotonic');
  }
  if (new Set(payload.rules.map((entry) => entry.ruleId)).size !== payload.rules.length) throw new Error('signature_feed_duplicate_rule');
  for (const rule of payload.rules) {
    if (rule.ruleDigest !== sha256({ ruleId: rule.ruleId, category: rule.category, encoding: rule.encoding, engineScope: rule.engineScope, pattern: rule.pattern, critical: rule.critical })) throw new Error('signature_feed_rule_digest_invalid');
    if (rule.pattern.length === 0 || rule.pattern.length > 4096) throw new Error('signature_feed_rule_pattern_invalid');
  }
  for (const pinned of CRITICAL_RULES) {
    const actual = payload.rules.find((entry) => entry.ruleId === pinned.ruleId);
    if (actual === undefined || actual.ruleDigest !== pinned.ruleDigest || !actual.critical) throw new Error('signature_feed_critical_rule_poisoning');
  }
  if (sha256([...payload.criticalRuleIds].sort()) !== sha256(CRITICAL_RULES.map((entry) => entry.ruleId).sort())) throw new Error('signature_feed_critical_rule_index_invalid');
}

function verifyPackage(pkg: FederatedArtifactPackageV33_25, registry: KeyRegistry, trustedSignerIds: readonly string[], now: Date): void {
  const manifest = pkg.manifest;
  if (!trustedSignerIds.includes(manifest.issuerKeyId) || !registry.verifyAt(manifest, manifest.payload.createdAt)) throw new Error('federated_package_signature_invalid');
  verifyDigestField(manifest.payload, 'packageDigest', 'federated_package_digest_invalid');
  if (manifest.payload.productionAuthority !== 'NONE' || manifest.payload.externalEffectsExecuted !== 0) throw new Error('federated_package_authority_boundary_invalid');
  if (Date.parse(manifest.payload.createdAt) > now.getTime() + 60_000) throw new Error('federated_package_from_future');
  if (Object.keys(pkg.artifactBytesByPath).length !== manifest.payload.artifacts.length) throw new Error('federated_package_file_set_invalid');
  for (const artifact of manifest.payload.artifacts) {
    safePath(artifact.path);
    const bytes = pkg.artifactBytesByPath[artifact.path];
    if (bytes === undefined || bytes.byteLength !== artifact.sizeBytes || sha256Bytes(bytes) !== artifact.sha256) throw new Error('federated_package_bytes_invalid');
  }
}

function signSnapshot(input: { readonly ledgerId: string; readonly feeds: readonly SignedEnvelope<ScannerSignatureFeedV33_25>[]; readonly revocations: readonly SignedEnvelope<ScannerSignatureFeedRevocationV33_25>[]; readonly createdAt: string; readonly updatedAt: string }, signer: SigningIdentity): SignedEnvelope<SignatureFeedLedgerSnapshotV33_25> {
  const latest = input.feeds.at(-1);
  const material = { version: '33.25' as const, ...input, highestSequence: latest?.payload.sequence ?? 0, latestFeedDigest: latest?.payload.feedDigest ?? ZERO_DIGEST, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return signEnvelope({ ...material, snapshotDigest: sha256(material) }, signer);
}
function signWitness(input: { readonly ledgerId: string; readonly highestSequence: number; readonly latestFeedDigest: string; readonly witnessedAt: string }, signer: SigningIdentity): SignedEnvelope<SignatureFeedWitnessV33_25> {
  const material = { version: '33.25' as const, ...input, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return signEnvelope({ ...material, witnessDigest: sha256(material) }, signer);
}
function enforceRoleSeparation(input: { readonly storeIdentity: SigningIdentity; readonly witnessIdentity: SigningIdentity; readonly trustedPublisherSignerIds: readonly string[]; readonly trustedRevokerSignerIds: readonly string[] }): void {
  if (input.storeIdentity.keyId === input.witnessIdentity.keyId || input.trustedPublisherSignerIds.includes(input.storeIdentity.keyId) || input.trustedPublisherSignerIds.includes(input.witnessIdentity.keyId) || input.trustedRevokerSignerIds.includes(input.storeIdentity.keyId) || input.trustedRevokerSignerIds.includes(input.witnessIdentity.keyId)) throw new Error('signature_feed_role_separation_invalid');
}
function criticalRule(ruleId: string, category: FederatedSignatureRuleV33_25['category'], encoding: SignatureEncodingV33_25, engineScope: SignatureEngineScopeV33_25, pattern: string): FederatedSignatureRuleV33_25 { return makeRule({ ruleId, category, encoding, engineScope, pattern, critical: true }); }
function makeRule(input: Omit<FederatedSignatureRuleV33_25, 'ruleDigest'>): FederatedSignatureRuleV33_25 {
  const material = { ruleId: nonEmpty(input.ruleId, 'signature_rule_id_required'), category: input.category, encoding: input.encoding, engineScope: input.engineScope, pattern: nonEmpty(input.pattern, 'signature_rule_pattern_required'), critical: input.critical };
  return { ...material, ruleDigest: sha256(material) };
}
function atomicJson(path: string, value: unknown): void { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); const temp = `${path}.${process.pid}.${randomUUID()}.tmp`; writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); renameSync(temp, path); }
function parseJson<T>(path: string, code: string): T { try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { throw new Error(code); } }
function verifyDigestField(payload: object, field: string, code: string): void { const record = payload as Record<string, unknown>; const value = record[field]; if (typeof value !== 'string' || !isDigest(value)) throw new Error(code); const material: Record<string, unknown> = { ...record }; delete material[field]; if (sha256(material) !== value) throw new Error(code); }
function requireDigest(value: string, code: string): string { if (!isDigest(value)) throw new Error(code); return value; }
function isDigest(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
function nonEmpty(value: string, code: string): string { const normalized = value.trim(); if (normalized === '') throw new Error(code); return normalized; }
function unique(values: readonly string[], code: string): readonly string[] { if (values.length === 0 || new Set(values).size !== values.length) throw new Error(code); return [...values]; }
function boundedInteger(value: number, min: number, max: number, code: string): number { if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(code); return value; }
function safePath(value: string): string { if (value === '' || value.includes('\\') || value.startsWith('/') || value.includes('\0')) throw new Error('artifact_path_invalid'); const normalized = posix.normalize(value); if (normalized !== value || normalized === '..' || normalized.startsWith('../')) throw new Error('artifact_path_invalid'); return value; }

interface WorkerOutput {
  readonly engine: ScannerEngineIdV33_25;
  readonly engineVersion: string;
  readonly workerPid: number;
  readonly parentPid: number;
  readonly results: readonly { readonly path: string; readonly sizeBytes: number; readonly sha256: string; readonly matchedRuleIds: readonly string[]; readonly status: 'CLEAN' | 'REJECTED' }[];
}
