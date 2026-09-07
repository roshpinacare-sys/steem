import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  KeyRegistry,
  sha256,
  signEnvelope,
  type ExportedPublicKeyRecord,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';
import {
  CredentialIssuerTrustRegistry,
  type SignedCredentialIssuerGrant,
  type SignedCredentialIssuerGrantRevocation,
} from '../security/credential-issuer-trust.js';
import {
  ReviewerTrustRegistry,
  type SignedReviewerCredential,
  type SignedReviewerCredentialRevocation,
} from '../security/reviewer-trust.js';
import {
  ProviderTrustRegistry,
  type SignedProviderCredential,
  type SignedProviderCredentialRevocation,
} from '../security/provider-trust.js';
import { withSovereignFileLease } from '../persistence/sovereign-file-lease.js';
import {
  sortByDigest,
  sortCredentialRecords,
  sortedUnique,
  validateCredentialTrustBundleIdentity,
  validateCredentialTrustBundleShape,
  validateCredentialTrustCustodianPolicy,
  validateCredentialTrustThreshold,
} from './credential-trust-policy.js';

import type {
  AcceptedProviderCredentialRecord,
  AcceptedReviewerCredentialRecord,
  CredentialTrustAnchor,
  CredentialTrustAnchorRecord,
  CredentialTrustBundle,
  CredentialTrustBundlePayload,
  CredentialTrustBundleSignaturePayload,
  CredentialTrustRootPolicy,
  ImportedCredentialTrustBundle,
  PinnedCredentialTrustRoots,
} from './credential-trust-types.js';
export type {
  AcceptedProviderCredentialRecord,
  AcceptedReviewerCredentialRecord,
  CredentialTrustAnchor,
  CredentialTrustAnchorRecord,
  CredentialTrustBundle,
  CredentialTrustBundlePayload,
  CredentialTrustBundleSignaturePayload,
  CredentialTrustRootPolicy,
  ImportedCredentialTrustBundle,
  PinnedCredentialTrustRoots,
} from './credential-trust-types.js';

export function createCredentialTrustBundle(input: {
  readonly bundleId: string;
  readonly generatedAt: string;
  readonly predecessorBundleDigest?: string;
  readonly rootPolicy: CredentialTrustRootPolicy;
  readonly rootSigners: readonly SigningIdentity[];
  readonly keyRegistry: KeyRegistry;
  readonly issuerTrust: CredentialIssuerTrustRegistry;
  readonly reviewerTrust: ReviewerTrustRegistry;
  readonly providerTrust: ProviderTrustRegistry;
}): CredentialTrustBundle {
  validateCredentialTrustBundleIdentity(input.bundleId, input.generatedAt, input.predecessorBundleDigest);
  const trustedRootKeyIds = sortedUnique(input.rootPolicy.trustedRootKeyIds, 'credential_trust_root_policy_invalid');
  validateCredentialTrustThreshold(input.rootPolicy.threshold, trustedRootKeyIds.length);
  const custodians = validateCredentialTrustCustodianPolicy(trustedRootKeyIds, input.rootPolicy.custodianIdsByRootKeyId);
  const signersById = new Map(input.rootSigners.map((signer) => [signer.keyId, signer]));
  if (signersById.size !== input.rootSigners.length) throw new Error('credential_trust_root_signer_duplicate');
  if ([...signersById.keys()].some((keyId) => !trustedRootKeyIds.includes(keyId))) throw new Error('credential_trust_root_signer_not_authorized');
  if (signersById.size < input.rootPolicy.threshold) throw new Error('credential_trust_root_signature_threshold_not_met');
  if (new Set([...signersById.keys()].map((keyId) => custodians[keyId]!)).size < input.rootPolicy.threshold) throw new Error('credential_trust_root_custodian_threshold_not_met');
  for (const rootKeyId of trustedRootKeyIds) {
    if (input.keyRegistry.fingerprint(rootKeyId) === undefined) throw new Error('credential_trust_root_not_registered');
    if (input.keyRegistry.isRevoked(rootKeyId)) throw new Error('credential_trust_root_revoked');
  }
  const payload: CredentialTrustBundlePayload = {
    version: 1,
    bundleId: input.bundleId,
    generatedAt: new Date(input.generatedAt).toISOString(),
    ...(input.predecessorBundleDigest === undefined ? {} : { predecessorBundleDigest: input.predecessorBundleDigest }),
    rootPolicy: { trustedRootKeyIds, custodianIdsByRootKeyId: custodians, threshold: input.rootPolicy.threshold },
    publicKeys: input.keyRegistry.listPublicKeys(),
    issuerGrants: sortByDigest(input.issuerTrust.listGrants()),
    issuerGrantRevocations: sortByDigest(input.issuerTrust.listRevocations()),
    reviewerCredentials: sortCredentialRecords(input.reviewerTrust.listCredentialRecords()),
    reviewerCredentialRevocations: sortByDigest(input.reviewerTrust.listRevocations()),
    providerCredentials: sortCredentialRecords(input.providerTrust.listCredentialRecords()),
    providerCredentialRevocations: sortByDigest(input.providerTrust.listRevocations()),
    limitations: [
      'bundle-signatures-prove-authorized-publication-not-credential-truth',
      'external-root-pins-remain-required',
      'distributed-consensus-and-hsm-custody-are-not-proven',
      'file-anchor-detects-single-store-rollback-not-joint-storage-rollback',
    ],
  };
  const payloadDigest = sha256(payload);
  const signaturePayload: CredentialTrustBundleSignaturePayload = {
    bundleId: payload.bundleId,
    payloadDigest,
    generatedAt: payload.generatedAt,
    ...(payload.predecessorBundleDigest === undefined ? {} : { predecessorBundleDigest: payload.predecessorBundleDigest }),
  };
  const rootSignatures = [...signersById.values()]
    .map((identity) => signEnvelope(signaturePayload, identity))
    .sort((a, b) => a.issuerKeyId.localeCompare(b.issuerKeyId));
  return { payload, rootSignatures };
}

export function verifyAndImportCredentialTrustBundle(
  bundle: CredentialTrustBundle,
  pinnedRoots: PinnedCredentialTrustRoots,
): ImportedCredentialTrustBundle {
  validateCredentialTrustBundleShape(bundle);
  validateCredentialTrustThreshold(pinnedRoots.threshold, pinnedRoots.fingerprints.size);
  if (pinnedRoots.custodianIds.size !== pinnedRoots.fingerprints.size) throw new Error('credential_trust_root_custodian_pin_invalid');
  const expectedRootIds = [...pinnedRoots.fingerprints.keys()].sort();
  if (sha256(expectedRootIds) !== sha256([...bundle.payload.rootPolicy.trustedRootKeyIds].sort()) || bundle.payload.rootPolicy.threshold !== pinnedRoots.threshold) throw new Error('credential_trust_root_policy_pin_mismatch');
  const pinnedCustodians = Object.fromEntries(expectedRootIds.map((keyId) => [keyId, pinnedRoots.custodianIds.get(keyId)]));
  if (Object.values(pinnedCustodians).some((value) => typeof value !== 'string' || value.trim() === '') || sha256(pinnedCustodians) !== sha256(bundle.payload.rootPolicy.custodianIdsByRootKeyId)) throw new Error('credential_trust_root_custodian_pin_mismatch');

  const preRevocationRegistry = new KeyRegistry();
  const keyIds = new Set<string>();
  for (const record of bundle.payload.publicKeys) {
    if (keyIds.has(record.keyId)) throw new Error('credential_trust_public_key_duplicate');
    keyIds.add(record.keyId);
    preRevocationRegistry.registerExported({ ...record, revoked: false });
  }
  for (const [rootKeyId, pinnedFingerprint] of pinnedRoots.fingerprints) {
    if (!/^[0-9a-f]{64}$/.test(pinnedFingerprint) || preRevocationRegistry.fingerprint(rootKeyId) !== pinnedFingerprint) throw new Error('credential_trust_root_fingerprint_mismatch');
    const rootRecord = bundle.payload.publicKeys.find((record) => record.keyId === rootKeyId);
    if (rootRecord?.revoked !== false) throw new Error('credential_trust_root_revoked');
  }

  const payloadDigest = sha256(bundle.payload);
  const expectedSignaturePayload: CredentialTrustBundleSignaturePayload = {
    bundleId: bundle.payload.bundleId,
    payloadDigest,
    generatedAt: bundle.payload.generatedAt,
    ...(bundle.payload.predecessorBundleDigest === undefined ? {} : { predecessorBundleDigest: bundle.payload.predecessorBundleDigest }),
  };
  const validRootSigners = new Set<string>();
  const validRootCustodians = new Set<string>();
  for (const signature of bundle.rootSignatures) {
    if (!expectedRootIds.includes(signature.issuerKeyId)) throw new Error('credential_trust_signature_root_not_pinned');
    if (sha256(signature.payload) !== sha256(expectedSignaturePayload) || !preRevocationRegistry.verify(signature)) throw new Error('credential_trust_signature_invalid');
    if (validRootSigners.has(signature.issuerKeyId)) throw new Error('credential_trust_signature_duplicate');
    validRootSigners.add(signature.issuerKeyId);
    validRootCustodians.add(bundle.payload.rootPolicy.custodianIdsByRootKeyId[signature.issuerKeyId]!);
  }
  if (validRootSigners.size < pinnedRoots.threshold) throw new Error('credential_trust_signature_threshold_not_met');
  if (validRootCustodians.size < pinnedRoots.threshold) throw new Error('credential_trust_root_custodian_threshold_not_met');

  const keyRegistry = new KeyRegistry();
  for (const record of bundle.payload.publicKeys) keyRegistry.registerExported(record);
  const roots = new Set(bundle.payload.rootPolicy.trustedRootKeyIds);
  const issuerTrust = new CredentialIssuerTrustRegistry(keyRegistry, roots);
  for (const grant of bundle.payload.issuerGrants) issuerTrust.registerGrant(grant);
  for (const revocation of bundle.payload.issuerGrantRevocations) issuerTrust.registerRevocation(revocation);
  let acceptanceTime = bundle.payload.generatedAt;
  const importClock = () => new Date(acceptanceTime);
  const reviewerTrust = new ReviewerTrustRegistry(keyRegistry, issuerTrust, importClock);
  for (const record of bundle.payload.reviewerCredentials) { acceptanceTime = record.acceptedAt; reviewerTrust.register(record.credential); }
  for (const revocation of bundle.payload.reviewerCredentialRevocations) reviewerTrust.registerRevocation(revocation);
  const providerTrust = new ProviderTrustRegistry(keyRegistry, issuerTrust, importClock);
  for (const record of bundle.payload.providerCredentials) { acceptanceTime = record.acceptedAt; providerTrust.register(record.credential); }
  for (const revocation of bundle.payload.providerCredentialRevocations) providerTrust.registerRevocation(revocation);
  return { keyRegistry, issuerTrust, reviewerTrust, providerTrust, bundleDigest: credentialTrustBundleDigest(bundle), payloadDigest };
}

export function credentialTrustBundleDigest(bundle: CredentialTrustBundle): string {
  return sha256({ payload: bundle.payload, rootSignatures: [...bundle.rootSignatures].sort((a, b) => a.issuerKeyId.localeCompare(b.issuerKeyId)) });
}

interface CredentialTrustAnchorFile {
  readonly schemaVersion: '1.0';
  readonly records: readonly CredentialTrustAnchorRecord[];
  readonly anchor: string | null;
}

export class FileCredentialTrustAnchor implements CredentialTrustAnchor {
  readonly #path: string;
  readonly #leasePath: string;
  constructor(path: string) {
    if (path.trim() === '') throw new Error('credential_trust_anchor_path_required');
    this.#path = resolve(path);
    this.#leasePath = `${this.#path}.lock`;
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    if (!existsSync(this.#path)) atomicWriteJson(this.#path, { schemaVersion: '1.0', records: [], anchor: null } satisfies CredentialTrustAnchorFile);
    rejectSymlink(this.#path);
    this.#readAndVerify();
  }
  current(): CredentialTrustAnchorRecord | undefined {
    const records = this.#readAndVerify().records;
    return records.length === 0 ? undefined : structuredClone(records[records.length - 1]!);
  }
  assertCurrent(bundleDigest: string | undefined): void {
    const current = this.current();
    if (current === undefined ? bundleDigest !== undefined : current.bundleDigest !== bundleDigest) throw new Error('credential_trust_anchor_mismatch');
  }
  advance(input: { readonly bundleDigest: string; readonly bundleId: string; readonly generatedAt: string; readonly predecessorBundleDigest?: string }): CredentialTrustAnchorRecord {
    if (!/^[0-9a-f]{64}$/.test(input.bundleDigest) || input.bundleId.trim() === '' || !Number.isFinite(Date.parse(input.generatedAt))) throw new Error('credential_trust_anchor_input_invalid');
    return withSovereignFileLease(this.#leasePath, () => {
      const state = this.#readAndVerify();
      const current = state.records[state.records.length - 1];
      if (current !== undefined) {
        if (current.bundleDigest === input.bundleDigest) return structuredClone(current);
        if (input.predecessorBundleDigest !== current.bundleDigest) throw new Error('credential_trust_anchor_predecessor_mismatch');
        if (Date.parse(input.generatedAt) <= Date.parse(current.generatedAt)) throw new Error('credential_trust_anchor_time_not_monotonic');
      } else if (input.predecessorBundleDigest !== undefined) throw new Error('credential_trust_anchor_predecessor_missing');
      const material = {
        sequence: state.records.length + 1,
        bundleDigest: input.bundleDigest,
        bundleId: input.bundleId,
        generatedAt: input.generatedAt,
        ...(input.predecessorBundleDigest === undefined ? {} : { predecessorBundleDigest: input.predecessorBundleDigest }),
        previousAnchorDigest: state.anchor,
      };
      const record: CredentialTrustAnchorRecord = { ...material, anchorDigest: sha256(material) };
      atomicWriteJson(this.#path, { schemaVersion: '1.0', records: [...state.records, record], anchor: record.anchorDigest } satisfies CredentialTrustAnchorFile);
      return structuredClone(record);
    });
  }
  #readAndVerify(): CredentialTrustAnchorFile {
    rejectSymlink(this.#path);
    let state: CredentialTrustAnchorFile;
    try { state = JSON.parse(readFileSync(this.#path, 'utf8')) as CredentialTrustAnchorFile; }
    catch { throw new Error('credential_trust_anchor_corrupt'); }
    if (state.schemaVersion !== '1.0' || !Array.isArray(state.records)) throw new Error('credential_trust_anchor_invalid');
    let previous: string | null = null;
    for (let index = 0; index < state.records.length; index += 1) {
      const record = state.records[index];
      if (record === undefined || record.sequence !== index + 1 || record.previousAnchorDigest !== previous) throw new Error('credential_trust_anchor_chain_invalid');
      const { anchorDigest, ...material } = record;
      if (anchorDigest !== sha256(material)) throw new Error('credential_trust_anchor_digest_invalid');
      previous = anchorDigest;
    }
    if (state.anchor !== previous) throw new Error('credential_trust_anchor_head_invalid');
    return state;
  }
}

interface CredentialTrustPendingTransition {
  readonly version: 1;
  readonly priorBundleDigest?: string;
  readonly nextBundleDigest: string;
  readonly bundleId: string;
  readonly generatedAt: string;
  readonly bundle: CredentialTrustBundle;
  readonly intentDigest: string;
}

export class FileCredentialTrustBundleStore {
  readonly #path: string;
  readonly #leasePath: string;
  readonly #pendingPath: string;
  constructor(path: string, readonly pinnedRoots: PinnedCredentialTrustRoots, readonly anchor?: CredentialTrustAnchor) {
    if (path.trim() === '') throw new Error('credential_trust_store_path_required');
    this.#path = resolve(path);
    this.#leasePath = `${this.#path}.lock`;
    this.#pendingPath = `${this.#path}.pending`;
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
  }

  save(bundle: CredentialTrustBundle): string {
    const imported = verifyAndImportCredentialTrustBundle(bundle, this.pinnedRoots);
    return withSovereignFileLease(this.#leasePath, () => {
      this.#recoverPendingLocked();
      let priorDigest: string | undefined;
      if (existsSync(this.#path)) {
        rejectSymlink(this.#path);
        const prior = this.#readAndVerify();
        verifyAndImportCredentialTrustBundle(prior, this.pinnedRoots);
        priorDigest = credentialTrustBundleDigest(prior);
        const nextDigest = imported.bundleDigest;
        this.anchor?.assertCurrent(priorDigest);
        if (priorDigest === nextDigest) return nextDigest;
        if (bundle.payload.predecessorBundleDigest !== priorDigest) throw new Error('credential_trust_bundle_predecessor_mismatch');
        if (Date.parse(bundle.payload.generatedAt) <= Date.parse(prior.payload.generatedAt)) throw new Error('credential_trust_bundle_time_not_monotonic');
        if (bundle.payload.bundleId === prior.payload.bundleId) throw new Error('credential_trust_bundle_id_conflict');
      } else {
        this.anchor?.assertCurrent(undefined);
        if (bundle.payload.predecessorBundleDigest !== undefined) throw new Error('credential_trust_bundle_predecessor_missing');
      }
      if (this.anchor !== undefined) {
        const intentMaterial = { version: 1 as const, ...(priorDigest === undefined ? {} : { priorBundleDigest: priorDigest }), nextBundleDigest: imported.bundleDigest, bundleId: bundle.payload.bundleId, generatedAt: bundle.payload.generatedAt, bundle };
        atomicWriteJson(this.#pendingPath, { ...intentMaterial, intentDigest: sha256(intentMaterial) } satisfies CredentialTrustPendingTransition);
      }
      atomicWriteJson(this.#path, bundle);
      this.anchor?.advance({ bundleDigest: imported.bundleDigest, bundleId: bundle.payload.bundleId, generatedAt: bundle.payload.generatedAt, ...(priorDigest === undefined ? {} : { predecessorBundleDigest: priorDigest }) });
      this.#clearPending();
      return imported.bundleDigest;
    });
  }

  load(): ImportedCredentialTrustBundle {
    return withSovereignFileLease(this.#leasePath, () => {
      this.#recoverPendingLocked();
      if (!existsSync(this.#path)) throw new Error('credential_trust_bundle_not_found');
      rejectSymlink(this.#path);
      const imported = verifyAndImportCredentialTrustBundle(this.#readAndVerify(), this.pinnedRoots);
      this.anchor?.assertCurrent(imported.bundleDigest);
      return imported;
    });
  }

  readBundle(): CredentialTrustBundle {
    return withSovereignFileLease(this.#leasePath, () => {
      this.#recoverPendingLocked();
      if (!existsSync(this.#path)) throw new Error('credential_trust_bundle_not_found');
      rejectSymlink(this.#path);
      const bundle = this.#readAndVerify();
      const imported = verifyAndImportCredentialTrustBundle(bundle, this.pinnedRoots);
      this.anchor?.assertCurrent(imported.bundleDigest);
      return structuredClone(bundle);
    });
  }

  #recoverPendingLocked(): void {
    if (!existsSync(this.#pendingPath)) return;
    if (this.anchor === undefined) throw new Error('credential_trust_pending_without_anchor');
    rejectSymlink(this.#pendingPath);
    let pending: CredentialTrustPendingTransition;
    try { pending = JSON.parse(readFileSync(this.#pendingPath, 'utf8')) as CredentialTrustPendingTransition; }
    catch { throw new Error('credential_trust_pending_corrupt'); }
    if (pending.version !== 1 || !/^[0-9a-f]{64}$/.test(pending.nextBundleDigest) || pending.bundleId.trim() === '' || !Number.isFinite(Date.parse(pending.generatedAt))) throw new Error('credential_trust_pending_invalid');
    const { intentDigest, ...intentMaterial } = pending;
    if (intentDigest !== sha256(intentMaterial) || credentialTrustBundleDigest(pending.bundle) !== pending.nextBundleDigest || pending.bundle.payload.bundleId !== pending.bundleId || pending.bundle.payload.generatedAt !== pending.generatedAt || pending.bundle.payload.predecessorBundleDigest !== pending.priorBundleDigest) throw new Error('credential_trust_pending_digest_invalid');
    verifyAndImportCredentialTrustBundle(pending.bundle, this.pinnedRoots);
    const anchored = this.anchor.current();
    const anchoredDigest = anchored?.bundleDigest;
    let fileDigest: string | undefined;
    if (existsSync(this.#path)) { rejectSymlink(this.#path); const fileBundle = this.#readAndVerify(); verifyAndImportCredentialTrustBundle(fileBundle, this.pinnedRoots); fileDigest = credentialTrustBundleDigest(fileBundle); }
    if (fileDigest === pending.nextBundleDigest) {
      if (anchoredDigest === pending.nextBundleDigest) { this.#clearPending(); return; }
      if (anchoredDigest !== pending.priorBundleDigest) throw new Error('credential_trust_pending_anchor_conflict');
      this.anchor.advance({ bundleDigest: pending.nextBundleDigest, bundleId: pending.bundleId, generatedAt: pending.generatedAt, ...(pending.priorBundleDigest === undefined ? {} : { predecessorBundleDigest: pending.priorBundleDigest }) });
      this.#clearPending(); return;
    }
    if (fileDigest === pending.priorBundleDigest && anchoredDigest === pending.priorBundleDigest) { this.#clearPending(); return; }
    if (fileDigest === undefined && pending.priorBundleDigest === undefined && anchoredDigest === undefined) { this.#clearPending(); return; }
    throw new Error('credential_trust_pending_state_conflict');
  }

  #clearPending(): void {
    if (!existsSync(this.#pendingPath)) return;
    try { unlinkSync(this.#pendingPath); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const directoryDescriptor = openSync(dirname(this.#pendingPath), 'r');
    try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
  }

  rollbackProtection(): 'API_CHAIN_ONLY' | 'INDEPENDENT_FILE_ANCHOR' {
    return this.anchor === undefined ? 'API_CHAIN_ONLY' : 'INDEPENDENT_FILE_ANCHOR';
  }

  #readAndVerify(): CredentialTrustBundle {
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(this.#path, 'utf8')); }
    catch { throw new Error('credential_trust_bundle_corrupt'); }
    validateCredentialTrustBundleShape(parsed as CredentialTrustBundle);
    return parsed as CredentialTrustBundle;
  }
}

function rejectSymlink(path: string): void { if (lstatSync(path).isSymbolicLink()) throw new Error('credential_trust_store_symlink_forbidden'); }
function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  const descriptor = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  try {
    renameSync(temporary, path);
    const directoryDescriptor = openSync(dirname(path), 'r');
    try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
}
