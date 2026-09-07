import { KeyRegistry, sha256, type ExportedPublicKeyRecord, type SignedEnvelope } from '../contracts/crypto.js';
import {
  computeExternalQualificationPolicyDigestV32_12,
  REQUIRED_EXTERNAL_GATE_IDS,
  type ExternalQualificationPolicyV32_12,
  type QualificationKeyAuthorizationV32_12,
  type QualificationPurposeV32_12,
} from './external-qualification-integrity-v32_12.js';

export interface ExternalQualificationTrustAnchorV32_12 {
  readonly schemaVersion: '32.12';
  readonly trustAnchorId: string;
  readonly rootKeys: readonly ExportedPublicKeyRecord[];
  readonly allowedTrustBundleSignerKeyIds: readonly string[];
}

export interface AuthorizedQualificationKeyV32_12 extends QualificationKeyAuthorizationV32_12 {
  readonly publicKey: ExportedPublicKeyRecord;
}

export interface ExternalQualificationTrustBundlePayloadV32_12 {
  readonly schemaVersion: '32.12';
  readonly trustBundleId: string;
  readonly purpose: QualificationPurposeV32_12;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly policy: ExternalQualificationPolicyV32_12;
  readonly authorizedKeys: readonly AuthorizedQualificationKeyV32_12[];
}

export type SignedExternalQualificationTrustBundleV32_12 = SignedEnvelope<ExternalQualificationTrustBundlePayloadV32_12>;

export interface VerifiedExternalQualificationTrustV32_12 {
  readonly purpose: QualificationPurposeV32_12;
  readonly policy: ExternalQualificationPolicyV32_12;
  readonly keyRegistry: KeyRegistry;
  readonly authorizations: readonly QualificationKeyAuthorizationV32_12[];
  readonly trustAnchorId: string;
  readonly trustBundleId: string;
  readonly trustBundleSignerKeyId: string;
  readonly trustBundleSignerFingerprint: string;
  readonly trustBundleDigest: string;
}

export function verifyExternalQualificationTrustBundleV32_12(
  anchor: ExternalQualificationTrustAnchorV32_12,
  bundle: SignedExternalQualificationTrustBundleV32_12,
  evaluatedAt: string,
): VerifiedExternalQualificationTrustV32_12 {
  const evaluatedAtMs = canonicalInstant(evaluatedAt, 'trust_evaluated_at');
  if (anchor.schemaVersion !== '32.12' || !identifier(anchor.trustAnchorId) || anchor.rootKeys.length === 0) throw new Error('trust_anchor_invalid');
  if (new Set(anchor.allowedTrustBundleSignerKeyIds).size !== anchor.allowedTrustBundleSignerKeyIds.length || anchor.allowedTrustBundleSignerKeyIds.length === 0) throw new Error('trust_anchor_signer_set_invalid');
  const rootRegistry = new KeyRegistry();
  for (const root of anchor.rootKeys) rootRegistry.registerExported(root);
  if (!anchor.allowedTrustBundleSignerKeyIds.includes(bundle.issuerKeyId)) throw new Error('trust_bundle_signer_not_allowed');
  if (!rootRegistry.verifyAt(bundle, evaluatedAt)) throw new Error('trust_bundle_signature_invalid');
  const signerFingerprint = rootRegistry.fingerprint(bundle.issuerKeyId);
  if (signerFingerprint === undefined) throw new Error('trust_bundle_signer_unknown');

  const payload = bundle.payload;
  if (payload.schemaVersion !== '32.12' || !identifier(payload.trustBundleId)) throw new Error('trust_bundle_identity_invalid');
  const issuedAt = canonicalInstant(payload.issuedAt, 'trust_bundle_issued_at');
  const expiresAt = canonicalInstant(payload.expiresAt, 'trust_bundle_expires_at');
  if (issuedAt >= expiresAt) throw new Error('trust_bundle_interval_invalid');
  if (evaluatedAtMs < issuedAt) throw new Error('trust_bundle_not_yet_valid');
  if (evaluatedAtMs > expiresAt) throw new Error('trust_bundle_expired');
  if (computeExternalQualificationPolicyDigestV32_12(payload.policy) !== payload.policy.policyDigest) throw new Error('trust_bundle_policy_digest_mismatch');

  const keyRegistry = new KeyRegistry();
  const authorizations: QualificationKeyAuthorizationV32_12[] = [];
  const seen = new Set<string>();
  for (const entry of payload.authorizedKeys) {
    const unique = `${entry.role}:${entry.keyId}`;
    if (seen.has(unique)) throw new Error('trust_bundle_authorization_duplicate');
    seen.add(unique);
    if (entry.publicKey.keyId !== entry.keyId || entry.publicKey.fingerprint !== entry.keyFingerprint) throw new Error('trust_bundle_authorized_key_identity_mismatch');
    if (anchor.allowedTrustBundleSignerKeyIds.includes(entry.keyId)) throw new Error('trust_bundle_root_key_cannot_be_actor');
    if (!identifier(entry.actorId) || !identifier(entry.organizationId) || entry.allowedGateIds.length === 0 || entry.allowedGateIds.some((gateId) => !REQUIRED_EXTERNAL_GATE_IDS.includes(gateId))) throw new Error('trust_bundle_authorization_invalid');
    const validFrom = canonicalInstant(entry.credentialValidFrom, 'trust_authorization_valid_from');
    const validUntil = canonicalInstant(entry.credentialValidUntil, 'trust_authorization_valid_until');
    if (validFrom >= validUntil) throw new Error('trust_bundle_authorization_interval_invalid');
    keyRegistry.registerExported(entry.publicKey);
    authorizations.push({
      role: entry.role,
      actorId: entry.actorId,
      keyId: entry.keyId,
      keyFingerprint: entry.keyFingerprint,
      organizationId: entry.organizationId,
      allowedGateIds: entry.allowedGateIds,
      credentialValidFrom: entry.credentialValidFrom,
      credentialValidUntil: entry.credentialValidUntil,
    });
  }
  for (const gateId of payload.policy.requiredGateIds) {
    const roles = new Map(authorizations.filter((entry) => entry.allowedGateIds.includes(gateId)).map((entry) => [entry.role, entry]));
    for (const role of ['collector', 'reviewer', 'witness'] as const) if (!roles.has(role)) throw new Error(`trust_bundle_missing_${role}_authorization:${gateId}`);
    if (payload.purpose === 'production') {
      const organizations = new Set([...roles.values()].map((entry) => entry.organizationId));
      if (organizations.size !== 3) throw new Error(`trust_bundle_organization_independence_missing:${gateId}`);
    }
  }
  return {
    purpose: payload.purpose,
    policy: payload.policy,
    keyRegistry,
    authorizations,
    trustAnchorId: anchor.trustAnchorId,
    trustBundleId: payload.trustBundleId,
    trustBundleSignerKeyId: bundle.issuerKeyId,
    trustBundleSignerFingerprint: signerFingerprint,
    trustBundleDigest: sha256(payload),
  };
}

function canonicalInstant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(`${label}_invalid`);
  return parsed;
}
function identifier(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/.test(value); }
