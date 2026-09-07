import assert from 'node:assert/strict';
import { sign as cryptoSign } from 'node:crypto';
import test from 'node:test';
import { canonicalJson, generateSigningIdentity, sha256 } from '../src/contracts/crypto.js';
import { AttestedKmsSigningAdapter, type KmsSignRequest, type KmsSignResponse, type KmsTransport } from '../src/security/attested-kms-adapter.js';

const context = { purpose: 'action-passport' as const, environment: 'test' as const, tenantId: 'tenant-1', nonce: 'nonce-v28', issuedAt: '2026-07-17T10:00:00.000Z', expiresAt: '2026-07-17T10:05:00.000Z' };

function fixture() {
  const identity = generateSigningIdentity('kms-v28');
  const publicPem = identity.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const valid = async (request: KmsSignRequest): Promise<KmsSignResponse> => ({
    provider: 'kms-provider', keyId: request.keyId, algorithm: 'Ed25519',
    signature: cryptoSign(null, Buffer.from(request.message), identity.privateKey).toString('base64url'),
    attestation: { requestDigest: request.requestDigest, nonce: context.nonce, issuedAt: context.issuedAt },
  });
  return { identity, publicPem, valid };
}

test('KMS adapter requires nonblank provider and key identity', () => {
  const { publicPem, valid } = fixture();
  const transport: KmsTransport = { sign: valid };
  assert.throws(() => new AttestedKmsSigningAdapter(' ', 'key', publicPem, transport), /kms_identity_required/);
  assert.throws(() => new AttestedKmsSigningAdapter('provider', ' ', publicPem, transport), /kms_identity_required/);
});

test('KMS adapter rejects algorithm and each context-attestation substitution independently', async () => {
  const { identity, publicPem, valid } = fixture();
  const cases: Array<[string, (response: KmsSignResponse) => KmsSignResponse, RegExp]> = [
    ['algorithm', (response) => ({ ...response, algorithm: 'RSA' as never }), /kms_algorithm_mismatch/],
    ['nonce', (response) => ({ ...response, attestation: { ...response.attestation, nonce: 'other' } }), /kms_context_attestation_mismatch/],
    ['issued-at', (response) => ({ ...response, attestation: { ...response.attestation, issuedAt: '2026-07-17T10:00:01.000Z' } }), /kms_context_attestation_mismatch/],
  ];
  for (const [, mutate, pattern] of cases) {
    const transport: KmsTransport = { async sign(request) { return mutate(await valid(request)); } };
    await assert.rejects(new AttestedKmsSigningAdapter('kms-provider', identity.keyId, publicPem, transport).sign({ action: 'propose' }, context), pattern);
  }
});

test('KMS request digest commits key, algorithm and canonical message', async () => {
  const { identity, publicPem } = fixture();
  let captured: KmsSignRequest | undefined;
  const transport: KmsTransport = { async sign(request) {
    captured = request;
    return {
      provider: 'kms-provider', keyId: request.keyId, algorithm: 'Ed25519',
      signature: cryptoSign(null, Buffer.from(request.message), identity.privateKey).toString('base64url'),
      attestation: { requestDigest: request.requestDigest, nonce: context.nonce, issuedAt: context.issuedAt },
    };
  } };
  const payload = { z: 1, a: 'ordered' };
  const envelope = await new AttestedKmsSigningAdapter('kms-provider', identity.keyId, publicPem, transport).sign(payload, context);
  assert.ok(captured);
  const expectedMessage = canonicalJson({ payload, context: { ...context, payloadDigest: sha256(payload) } });
  assert.equal(captured.message, expectedMessage);
  assert.equal(captured.requestDigest, sha256({ keyId: identity.keyId, algorithm: 'Ed25519', message: expectedMessage }));
  assert.equal(envelope.context.payloadDigest, sha256(payload));
});
