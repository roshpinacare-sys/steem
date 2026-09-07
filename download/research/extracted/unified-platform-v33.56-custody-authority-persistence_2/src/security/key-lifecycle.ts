import {
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import { canonicalJson, sha256, type SigningIdentity } from '../contracts/crypto.js';

export const KEY_PURPOSES = [
  'user-identity',
  'service-identity',
  'capability-publisher',
  'release-signer',
  'action-passport',
  'evidence-attestation',
  'device-identity',
  'airgap-handoff',
  'payment-provider',
  'backup-recovery',
  'break-glass',
] as const;
export type KeyPurpose = (typeof KEY_PURPOSES)[number];
export type KeyEnvironment = 'development' | 'test' | 'staging' | 'production' | 'airgap';
export type KeyStatus = 'ACTIVE' | 'RETIRED' | 'REVOKED' | 'COMPROMISED' | 'LOST';

export interface KeyDescriptor {
  readonly keyId: string;
  readonly familyId: string;
  readonly purpose: KeyPurpose;
  readonly environment: KeyEnvironment;
  readonly tenantId?: string;
  readonly publicKeyPem: string;
  readonly fingerprint: string;
  readonly notBefore: string;
  readonly notAfter: string;
  readonly status: KeyStatus;
  readonly predecessorKeyId?: string;
  readonly retiredAt?: string;
}

export interface SignatureContext {
  readonly purpose: KeyPurpose;
  readonly environment: KeyEnvironment;
  readonly tenantId?: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly payloadDigest: string;
}

export interface PurposeBoundEnvelope<T> {
  readonly payload: T;
  readonly context: SignatureContext;
  readonly signerKeyId: string;
  readonly algorithm: 'Ed25519';
  readonly signature: string;
}

export interface RevocationRecord {
  readonly sequence: number;
  readonly keyId: string;
  readonly reason: string;
  readonly status: Extract<KeyStatus, 'REVOKED' | 'COMPROMISED' | 'LOST'>;
  readonly effectiveAt: string;
  readonly approvedBy: readonly string[];
  readonly previousDigest: string | null;
  readonly digest: string;
}

export interface TrustSnapshot {
  readonly epoch: number;
  readonly generatedAt: string;
  readonly keys: readonly KeyDescriptor[];
  readonly revocations: readonly RevocationRecord[];
  readonly root: string;
}

export interface VerificationExpectation {
  readonly purpose: KeyPurpose;
  readonly environment: KeyEnvironment;
  readonly tenantId?: string;
  readonly minimumEpoch?: number;
  readonly consumeNonce?: boolean;
}

const HIGH_CONTROL_PURPOSES = new Set<KeyPurpose>([
  'release-signer', 'payment-provider', 'backup-recovery', 'break-glass',
]);

export class KeyLifecycleRegistry {
  readonly #descriptors = new Map<string, KeyDescriptor>();
  readonly #publicKeys = new Map<string, KeyObject>();
  readonly #revocations: RevocationRecord[] = [];
  readonly #consumedNonces = new Set<string>();
  #epoch = 0;

  register(identity: SigningIdentity, input: Omit<KeyDescriptor, 'publicKeyPem' | 'fingerprint' | 'status'> & { readonly status?: KeyStatus }): KeyDescriptor {
    const publicKeyPem = identity.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const descriptor: KeyDescriptor = {
      ...input,
      publicKeyPem,
      fingerprint: sha256(publicKeyPem),
      status: input.status ?? 'ACTIVE',
    };
    validateDescriptor(descriptor);
    if (identity.keyId !== descriptor.keyId) throw new Error('identity_key_id_mismatch');
    const existing = this.#descriptors.get(descriptor.keyId);
    if (existing !== undefined && existing.fingerprint !== descriptor.fingerprint) throw new Error('key_id_conflict');
    if (existing !== undefined && canonicalJson(existing) !== canonicalJson(descriptor)) throw new Error('key_descriptor_conflict');
    this.#descriptors.set(descriptor.keyId, structuredClone(descriptor));
    this.#publicKeys.set(descriptor.keyId, identity.publicKey);
    this.#epoch += 1;
    return structuredClone(descriptor);
  }

  rotate(previousKeyId: string, nextIdentity: SigningIdentity, input: Omit<KeyDescriptor, 'publicKeyPem' | 'fingerprint' | 'status' | 'predecessorKeyId'>, retiredAt: Date): KeyDescriptor {
    const previous = this.#require(previousKeyId);
    if (previous.familyId !== input.familyId) throw new Error('rotation_family_mismatch');
    if (previous.purpose !== input.purpose) throw new Error('rotation_purpose_mismatch');
    if (previous.environment !== input.environment) throw new Error('rotation_environment_mismatch');
    if (previous.tenantId !== input.tenantId) throw new Error('rotation_tenant_mismatch');
    const next = this.register(nextIdentity, { ...input, predecessorKeyId: previousKeyId });
    this.#descriptors.set(previousKeyId, { ...previous, status: 'RETIRED', retiredAt: retiredAt.toISOString() });
    this.#epoch += 1;
    return next;
  }

  revoke(keyId: string, input: {
    readonly status: Extract<KeyStatus, 'REVOKED' | 'COMPROMISED' | 'LOST'>;
    readonly reason: string;
    readonly effectiveAt: Date;
    readonly approvedBy: readonly string[];
  }): RevocationRecord {
    const current = this.#require(keyId);
    if (input.reason.trim() === '') throw new Error('revocation_reason_required');
    const approvals = [...new Set(input.approvedBy.filter((value) => value.trim() !== ''))];
    const required = HIGH_CONTROL_PURPOSES.has(current.purpose) ? 2 : 1;
    if (approvals.length < required) throw new Error('revocation_dual_control_required');
    const previousDigest = this.#revocations.at(-1)?.digest ?? null;
    const material = {
      sequence: this.#revocations.length + 1,
      keyId,
      reason: input.reason,
      status: input.status,
      effectiveAt: input.effectiveAt.toISOString(),
      approvedBy: approvals.sort(),
      previousDigest,
    };
    const record: RevocationRecord = { ...material, digest: sha256(material) };
    this.#revocations.push(record);
    this.#descriptors.set(keyId, { ...current, status: input.status });
    this.#epoch += 1;
    return structuredClone(record);
  }

  sign<T>(payload: T, identity: SigningIdentity, context: Omit<SignatureContext, 'payloadDigest'>): PurposeBoundEnvelope<T> {
    const descriptor = this.#require(identity.keyId);
    const payloadDigest = sha256(payload);
    const completeContext: SignatureContext = { ...context, payloadDigest };
    this.#validateContext(descriptor, completeContext, new Date(context.issuedAt));
    if (descriptor.status !== 'ACTIVE') throw new Error('signing_key_not_active');
    const signature = cryptoSign(
      null,
      Buffer.from(canonicalJson({ payload, context: completeContext })),
      identity.privateKey,
    ).toString('base64url');
    return { payload, context: completeContext, signerKeyId: identity.keyId, algorithm: 'Ed25519', signature };
  }

  verify<T>(envelope: PurposeBoundEnvelope<T>, expectation: VerificationExpectation, now = new Date()): boolean {
    try {
      if (expectation.minimumEpoch !== undefined && this.#epoch < expectation.minimumEpoch) throw new Error('stale_trust_state');
      if (envelope.algorithm !== 'Ed25519') return false;
      const descriptor = this.#require(envelope.signerKeyId);
      this.#validateContext(descriptor, envelope.context, now);
      if (envelope.context.purpose !== expectation.purpose) throw new Error('wrong_signature_purpose');
      if (envelope.context.environment !== expectation.environment) throw new Error('cross_environment_signature');
      if (expectation.tenantId !== undefined && envelope.context.tenantId !== expectation.tenantId) throw new Error('wrong_signature_tenant');
      if (envelope.context.payloadDigest !== sha256(envelope.payload)) throw new Error('signature_payload_digest_mismatch');
      if (descriptor.status !== 'ACTIVE' && descriptor.status !== 'RETIRED') throw new Error('signing_key_untrusted');
      const revocation = this.#revocations.find((item) => item.keyId === descriptor.keyId && Date.parse(item.effectiveAt) <= now.getTime());
      if (revocation !== undefined) throw new Error('signing_key_revoked');
      if (expectation.consumeNonce === true) {
        const nonceKey = `${envelope.signerKeyId}:${envelope.context.nonce}`;
        if (this.#consumedNonces.has(nonceKey)) throw new Error('signature_replay');
        this.#consumedNonces.add(nonceKey);
      }
      const publicKey = this.#publicKeys.get(envelope.signerKeyId) ?? createPublicKey(descriptor.publicKeyPem);
      return cryptoVerify(
        null,
        Buffer.from(canonicalJson({ payload: envelope.payload, context: envelope.context })),
        publicKey,
        Buffer.from(envelope.signature, 'base64url'),
      );
    } catch {
      return false;
    }
  }

  snapshot(now = new Date()): TrustSnapshot {
    const keys = [...this.#descriptors.values()].sort((a, b) => a.keyId.localeCompare(b.keyId));
    const revocations = this.#revocations.map((item) => structuredClone(item));
    const material = { epoch: this.#epoch, generatedAt: now.toISOString(), keys, revocations };
    return { ...structuredClone(material), root: sha256(material) };
  }

  static verifySnapshot(snapshot: TrustSnapshot): boolean {
    try {
      if (!Number.isInteger(snapshot.epoch) || snapshot.epoch < 0) return false;
      if (!Number.isFinite(Date.parse(snapshot.generatedAt))) return false;
      if (snapshot.root !== sha256({ epoch: snapshot.epoch, generatedAt: snapshot.generatedAt, keys: snapshot.keys, revocations: snapshot.revocations })) return false;
      const keyIds = new Set<string>();
      for (const descriptor of snapshot.keys) {
        validateDescriptor(descriptor);
        if (keyIds.has(descriptor.keyId)) return false;
        keyIds.add(descriptor.keyId);
      }
      let previous: string | null = null;
      for (let index = 0; index < snapshot.revocations.length; index += 1) {
        const record = snapshot.revocations[index];
        if (record === undefined || record.sequence !== index + 1 || !keyIds.has(record.keyId)) return false;
        if (record.reason.trim() === '' || record.approvedBy.length === 0 || !Number.isFinite(Date.parse(record.effectiveAt))) return false;
        const { digest, ...material } = record;
        if (material.previousDigest !== previous || digest !== sha256(material)) return false;
        previous = digest;
      }
      return true;
    } catch {
      return false;
    }
  }

  static fromSnapshot(snapshot: TrustSnapshot): KeyLifecycleRegistry {
    if (!KeyLifecycleRegistry.verifySnapshot(snapshot)) throw new Error('invalid_trust_snapshot');
    const registry = new KeyLifecycleRegistry();
    for (const descriptor of snapshot.keys) {
      registry.#descriptors.set(descriptor.keyId, structuredClone(descriptor));
      registry.#publicKeys.set(descriptor.keyId, createPublicKey(descriptor.publicKeyPem));
    }
    for (const record of snapshot.revocations) registry.#revocations.push(structuredClone(record));
    registry.#epoch = snapshot.epoch;
    return registry;
  }

  get epoch(): number { return this.#epoch; }

  #require(keyId: string): KeyDescriptor {
    const descriptor = this.#descriptors.get(keyId);
    if (descriptor === undefined) throw new Error('key_not_found');
    return descriptor;
  }

  #validateContext(descriptor: KeyDescriptor, context: SignatureContext, now: Date): void {
    if (context.nonce.trim() === '') throw new Error('signature_nonce_required');
    if (context.purpose !== descriptor.purpose) throw new Error('wrong_signature_purpose');
    if (context.environment !== descriptor.environment) throw new Error('cross_environment_signature');
    if (descriptor.tenantId !== undefined && context.tenantId !== descriptor.tenantId) throw new Error('wrong_signature_tenant');
    const issued = Date.parse(context.issuedAt);
    const expires = Date.parse(context.expiresAt);
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) throw new Error('invalid_signature_window');
    if (now.getTime() < issued || now.getTime() >= expires) throw new Error('signature_expired_or_not_yet_valid');
    if (issued < Date.parse(descriptor.notBefore) || issued >= Date.parse(descriptor.notAfter)) throw new Error('signature_outside_key_validity');
    if (descriptor.retiredAt !== undefined && issued >= Date.parse(descriptor.retiredAt)) throw new Error('signature_after_retirement');
  }
}

export interface KmsSigningAdapter {
  readonly kind: 'local-test' | 'kms' | 'hsm' | 'airgap';
  sign<T>(payload: T, context: Omit<SignatureContext, 'payloadDigest'>): Promise<PurposeBoundEnvelope<T>>;
}

export class EnvironmentBlockedSigningAdapter implements KmsSigningAdapter {
  constructor(readonly kind: 'kms' | 'hsm' | 'airgap', readonly blocker: string) {}
  async sign<T>(_payload: T, _context: Omit<SignatureContext, 'payloadDigest'>): Promise<PurposeBoundEnvelope<T>> {
    throw new Error(`environment_blocked:${this.kind}:${this.blocker}`);
  }
}

function validateDescriptor(descriptor: KeyDescriptor): void {
  if (descriptor.keyId.trim() === '' || descriptor.familyId.trim() === '') throw new Error('key_identity_required');
  if (!KEY_PURPOSES.includes(descriptor.purpose)) throw new Error('invalid_key_purpose');
  const before = Date.parse(descriptor.notBefore);
  const after = Date.parse(descriptor.notAfter);
  if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before) throw new Error('invalid_key_validity');
  if (descriptor.fingerprint !== sha256(descriptor.publicKeyPem)) throw new Error('public_key_fingerprint_mismatch');
}
