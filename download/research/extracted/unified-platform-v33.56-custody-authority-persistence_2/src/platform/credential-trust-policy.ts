import { sha256 } from '../contracts/crypto.js';
import type { CredentialTrustBundle } from './credential-trust-types.js';

export function validateCredentialTrustBundleShape(bundle: CredentialTrustBundle): void {
  if (bundle === null || typeof bundle !== 'object' || bundle.payload?.version !== 1 || !Array.isArray(bundle.rootSignatures)) {
    throw new Error('credential_trust_bundle_invalid');
  }
  validateCredentialTrustBundleIdentity(bundle.payload.bundleId, bundle.payload.generatedAt, bundle.payload.predecessorBundleDigest);
  const roots = sortedUnique(bundle.payload.rootPolicy.trustedRootKeyIds, 'credential_trust_root_policy_invalid');
  if (sha256(roots) !== sha256(bundle.payload.rootPolicy.trustedRootKeyIds)) throw new Error('credential_trust_root_policy_not_canonical');
  validateCredentialTrustThreshold(bundle.payload.rootPolicy.threshold, roots.length);
  validateCredentialTrustCustodianPolicy(roots, bundle.payload.rootPolicy.custodianIdsByRootKeyId);
  const arrays = [
    bundle.payload.publicKeys,
    bundle.payload.issuerGrants,
    bundle.payload.issuerGrantRevocations,
    bundle.payload.reviewerCredentials,
    bundle.payload.reviewerCredentialRevocations,
    bundle.payload.providerCredentials,
    bundle.payload.providerCredentialRevocations,
    bundle.payload.limitations,
  ];
  if (arrays.some((list) => !Array.isArray(list))) throw new Error('credential_trust_bundle_invalid');
  if (bundle.payload.limitations.length === 0 || bundle.payload.limitations.some((value) => typeof value !== 'string' || value.trim() === '')) {
    throw new Error('credential_trust_bundle_limitations_required');
  }
  for (const record of [...bundle.payload.reviewerCredentials, ...bundle.payload.providerCredentials]) {
    if (!Number.isFinite(Date.parse(record.acceptedAt))) throw new Error('credential_trust_acceptance_time_invalid');
  }
}

export function validateCredentialTrustBundleIdentity(bundleId: string, generatedAt: string, predecessor?: string): void {
  if (bundleId.trim() === '' || !Number.isFinite(Date.parse(generatedAt))) throw new Error('credential_trust_bundle_identity_invalid');
  if (predecessor !== undefined && !/^[0-9a-f]{64}$/.test(predecessor)) throw new Error('credential_trust_bundle_predecessor_invalid');
}

export function validateCredentialTrustCustodianPolicy(rootKeyIds: readonly string[], input: Readonly<Record<string, string>>): Record<string, string> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('credential_trust_root_custodian_policy_invalid');
  const keys = Object.keys(input).sort();
  if (sha256(keys) !== sha256([...rootKeyIds].sort())) throw new Error('credential_trust_root_custodian_policy_invalid');
  const result: Record<string, string> = {};
  for (const keyId of [...rootKeyIds].sort()) {
    const custodianId = input[keyId];
    if (typeof custodianId !== 'string' || custodianId.trim() === '') throw new Error('credential_trust_root_custodian_policy_invalid');
    result[keyId] = custodianId;
  }
  return result;
}

export function validateCredentialTrustThreshold(threshold: number, rootCount: number): void {
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > rootCount) throw new Error('credential_trust_root_threshold_invalid');
}

export function sortedUnique(values: readonly string[], code: string): string[] {
  if (values.length === 0 || values.some((value) => value.trim() === '') || new Set(values).size !== values.length) throw new Error(code);
  return [...values].sort();
}

export function sortByDigest<T>(values: readonly T[]): readonly T[] {
  return [...values].sort((a, b) => sha256(a).localeCompare(sha256(b))).map((value) => structuredClone(value));
}

export function sortCredentialRecords<T extends { readonly credential: unknown }>(values: readonly T[]): readonly T[] {
  return [...values].sort((a, b) => sha256(a.credential).localeCompare(sha256(b.credential))).map((value) => structuredClone(value));
}
