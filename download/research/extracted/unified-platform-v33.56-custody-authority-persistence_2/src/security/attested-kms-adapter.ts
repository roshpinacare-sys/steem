import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { canonicalJson, sha256 } from '../contracts/crypto.js';
import type { KmsSigningAdapter, PurposeBoundEnvelope, SignatureContext } from './key-lifecycle.js';

export interface KmsSignRequest {
  readonly keyId: string;
  readonly algorithm: 'Ed25519';
  readonly message: string;
  readonly requestDigest: string;
}

export interface KmsSignResponse {
  readonly provider: string;
  readonly keyId: string;
  readonly algorithm: 'Ed25519';
  readonly signature: string;
  readonly attestation: {
    readonly requestDigest: string;
    readonly nonce: string;
    readonly issuedAt: string;
  };
}

export interface KmsTransport {
  sign(request: KmsSignRequest): Promise<KmsSignResponse>;
}

export class AttestedKmsSigningAdapter implements KmsSigningAdapter {
  readonly kind = 'kms' as const;
  readonly #publicKey;

  constructor(
    readonly provider: string,
    readonly keyId: string,
    publicKeyPem: string,
    readonly transport: KmsTransport,
  ) {
    if (provider.trim() === '' || keyId.trim() === '') throw new Error('kms_identity_required');
    this.#publicKey = createPublicKey(publicKeyPem);
  }

  async sign<T>(payload: T, context: Omit<SignatureContext, 'payloadDigest'>): Promise<PurposeBoundEnvelope<T>> {
    const completeContext: SignatureContext = { ...context, payloadDigest: sha256(payload) };
    const message = canonicalJson({ payload, context: completeContext });
    const requestDigest = sha256({ keyId: this.keyId, algorithm: 'Ed25519', message });
    const response = await this.transport.sign({ keyId: this.keyId, algorithm: 'Ed25519', message, requestDigest });
    if (response.provider !== this.provider) throw new Error('kms_provider_mismatch');
    if (response.keyId !== this.keyId) throw new Error('kms_key_substitution');
    if (response.algorithm !== 'Ed25519') throw new Error('kms_algorithm_mismatch');
    if (response.attestation.requestDigest !== requestDigest) throw new Error('kms_request_attestation_mismatch');
    if (response.attestation.nonce !== context.nonce || response.attestation.issuedAt !== context.issuedAt) throw new Error('kms_context_attestation_mismatch');
    const valid = cryptoVerify(null, Buffer.from(message), this.#publicKey, Buffer.from(response.signature, 'base64url'));
    if (!valid) throw new Error('kms_signature_invalid');
    return { payload, context: completeContext, signerKeyId: this.keyId, algorithm: 'Ed25519', signature: response.signature };
  }
}
