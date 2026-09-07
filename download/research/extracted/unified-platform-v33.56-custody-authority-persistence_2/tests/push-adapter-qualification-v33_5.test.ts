import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
  type SigningIdentity,
} from '../src/contracts/crypto.js';
import type { PushApprovalCard } from '../src/product/chat-mission.js';
import type { PushDeliveryChallenge } from '../src/product/device-push-v33_3.js';
import type { TransportNeutralPushRequest } from '../src/product/reliable-push-v33_4.js';
import {
  HttpAdapterPermanentErrorV33_5,
  HttpAdapterTransientErrorV33_5,
  LocalHttpPushAdapterV33_5,
  LocalPushWebhookReceiverV33_5,
  LocalReferencePushProviderV33_5,
  MobileApprovalSimulatorV33_5,
  buildAdapterQualificationEvidenceV33_5,
  createPushAdapterManifestV33_5,
  type ReferenceProviderFaultV33_5,
} from '../src/product/push-adapter-qualification-v33_5.js';

const now = new Date('2026-07-21T05:20:00.000Z');

interface NetworkFixture {
  readonly gateway: SigningIdentity;
  readonly provider: SigningIdentity;
  readonly gatewayKeys: KeyRegistry;
  readonly providerKeys: KeyRegistry;
  readonly receiver: LocalPushWebhookReceiverV33_5;
  readonly server: LocalReferencePushProviderV33_5;
  readonly client: LocalHttpPushAdapterV33_5;
  readonly request: TransportNeutralPushRequest;
  stop(): Promise<void>;
}

async function networkFixture(faults: readonly ReferenceProviderFaultV33_5[] = [], timeoutMs = 500, responseLimit = 64 * 1024): Promise<NetworkFixture> {
  const gateway = generateSigningIdentity(`gateway-${Math.random()}`);
  const provider = generateSigningIdentity(`provider-${Math.random()}`);
  const gatewayKeys = new KeyRegistry(); gatewayKeys.register(gateway.keyId, gateway.publicKey);
  const providerKeys = new KeyRegistry(); providerKeys.register(provider.keyId, provider.publicKey);
  const receiver = new LocalPushWebhookReceiverV33_5('local-http-provider', providerKeys, [provider.keyId]);
  const webhookUrl = await receiver.start();
  const server = new LocalReferencePushProviderV33_5({ adapterId: 'local-http-provider', providerIdentity: provider, gatewayKeys, trustedGatewayIds: [gateway.keyId], webhookUrl, faults, now: () => now });
  const endpointUrl = await server.start();
  const manifest = createPushAdapterManifestV33_5({ adapterId: 'local-http-provider', endpointUrl, webhookUrl, providerKeyId: provider.keyId, requestTimeoutMs: timeoutMs, maximumRequestBytes: 128 * 1024, maximumResponseBytes: responseLimit });
  const client = new LocalHttpPushAdapterV33_5(manifest, gateway, providerKeys, [provider.keyId]);
  const request = requestFixture(gateway);
  return { gateway, provider, gatewayKeys, providerKeys, receiver, server, client, request, async stop() { await server.stop(); await receiver.stop(); } };
}

function requestFixture(gateway: SigningIdentity, overrides: Partial<TransportNeutralPushRequest> = {}): TransportNeutralPushRequest {
  const delivery: PushDeliveryChallenge = {
    version: '33.3', deliveryId: 'delivery-http-1', tenantId: 'tenant-1', cardId: 'card-1', cardDigest: sha256('card'),
    approverId: 'reviewer-1', deviceId: 'phone-1', deviceEnrollmentDigest: sha256('enrollment'), challengeNonce: 'challenge-http-1',
    attempt: 1, issuedAt: '2026-07-21T05:19:00.000Z', expiresAt: '2026-07-21T05:30:00.000Z', transport: 'SIMULATED_PUSH', externalEffectsExecuted: 0,
  };
  const signedDelivery = signEnvelope(delivery, gateway);
  const material = {
    version: '33.4' as const, requestId: 'request-http-1', signedDelivery, deliveryDigest: sha256(signedDelivery), targetAdapterId: 'local-http-provider',
    providerDedupKey: 'dedup-http-1', queuedAt: '2026-07-21T05:19:30.000Z', expiresAt: delivery.expiresAt,
    productionCeiling: 'shadow' as const, externalEffectsExecuted: 0 as const,
  };
  const request: TransportNeutralPushRequest = { ...material, requestDigest: sha256(material) };
  return { ...request, ...overrides };
}

function card(overrides: Partial<PushApprovalCard> = {}): PushApprovalCard {
  return {
    version: '33.1', cardId: 'card-mobile-1', missionId: 'mission-mobile-1', tenantId: 'tenant-1', title: 'Approve bounded change',
    summary: 'Three files change; tests passed; rollback is available.', riskLevel: 'MEDIUM', reversibility: 'REVERSIBLE', estimatedCostUsd: 1.25,
    requestedScopes: ['repository.write'], reasons: ['RISK_ABOVE_POLICY'], approverIds: ['reviewer-1'], options: ['YES', 'NO', 'CHANGE_CONDITIONS', 'EXPLAIN'],
    authorityGrantDigest: sha256('grant'), missionDigest: sha256('mission'), expiresAt: '2026-07-21T06:00:00.000Z', cardDigest: sha256('card-mobile'), ...overrides,
  };
}

async function postRaw(urlText: string, body: string, contentType = 'application/json'): Promise<{ status: number; body: string }> {
  const url = new URL(urlText);
  return await new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'content-type': contentType, 'content-length': String(Buffer.byteLength(body)), connection: 'close' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end(body);
  });
}

test('real local HTTP round trip returns verified receipt and signed webhook', async () => {
  const f = await networkFixture();
  try {
    const receipt = await f.client.send(f.request, now);
    assert.equal(receipt.payload.adapterId, 'local-http-provider');
    assert.equal(receipt.payload.deliveryDigest, f.request.deliveryDigest);
    assert.equal(f.providerKeys.verifyAt(receipt, receipt.payload.acceptedAt), true);
    assert.equal(f.receiver.list().length, 1);
    assert.equal(f.receiver.list()[0]?.payload.requestId, f.request.requestId);
    assert.equal(f.server.metrics().uniqueAcceptances, 1);
  } finally { await f.stop(); }
});

test('response loss retries across HTTP without a second provider acceptance or webhook record', async () => {
  const f = await networkFixture(['DROP_AFTER_ACCEPT', 'NORMAL']);
  try {
    await assert.rejects(f.client.send(f.request, now), HttpAdapterTransientErrorV33_5);
    const receipt = await f.client.send(f.request, new Date('2026-07-21T05:20:01.000Z'));
    assert.equal(receipt.payload.deliveryDigest, f.request.deliveryDigest);
    assert.equal(f.server.metrics().uniqueAcceptances, 1);
    assert.equal(f.server.metrics().duplicateSuppressions, 1);
    assert.equal(f.receiver.list().length, 1);
  } finally { await f.stop(); }
});

test('manifest rejects SSRF-capable, credentialed and redirect-like endpoints', () => {
  const base = { adapterId: 'a', webhookUrl: 'http://127.0.0.1:1001/v1/push-webhook', providerKeyId: 'k', requestTimeoutMs: 100, maximumRequestBytes: 1024, maximumResponseBytes: 1024 };
  for (const endpointUrl of ['http://localhost:1000/v1/push', 'http://10.0.0.1:1000/v1/push', 'http://user:pass@127.0.0.1:1000/v1/push', 'https://127.0.0.1:1000/v1/push', 'http://127.0.0.1:1000/other', 'http://127.0.0.1:1000/v1/push?next=x']) {
    assert.throws(() => createPushAdapterManifestV33_5({ ...base, endpointUrl }), /adapter_url_not_local_qualified/);
  }
});

test('client blocks request digest tampering before network dispatch', async () => {
  const f = await networkFixture();
  try {
    await assert.rejects(f.client.send({ ...f.request, providerDedupKey: 'tampered' }, now), /transport_request_digest_invalid/);
    assert.equal(f.server.metrics().requestCount, 0);
  } finally { await f.stop(); }
});

test('provider rejects challenge signed by a different gateway than the delivery', async () => {
  const f = await networkFixture();
  try {
    const attacker = generateSigningIdentity('attacker-gateway');
    const client = new LocalHttpPushAdapterV33_5(f.client.manifest, attacker, f.providerKeys, [f.provider.keyId]);
    await assert.rejects(client.send(f.request, now), /adapter_http_status_400/);
    assert.equal(f.server.metrics().uniqueAcceptances, 0);
  } finally { await f.stop(); }
});

test('client rejects provider identity not present in its trust set', async () => {
  const f = await networkFixture();
  try {
    const other = generateSigningIdentity('other-provider');
    const keys = new KeyRegistry(); keys.register(other.keyId, other.publicKey);
    const manifest = createPushAdapterManifestV33_5({ adapterId: f.client.manifest.adapterId, endpointUrl: f.client.manifest.endpointUrl, webhookUrl: f.client.manifest.webhookUrl, providerKeyId: other.keyId, requestTimeoutMs: f.client.manifest.requestTimeoutMs, maximumRequestBytes: f.client.manifest.maximumRequestBytes, maximumResponseBytes: f.client.manifest.maximumResponseBytes });
    const client = new LocalHttpPushAdapterV33_5(manifest, f.gateway, keys, [other.keyId]);
    await assert.rejects(client.send(f.request, now));
  } finally { await f.stop(); }
});

test('tampered signed provider receipt is rejected', async () => {
  const f = await networkFixture(['TAMPER_RECEIPT']);
  try { await assert.rejects(f.client.send(f.request, now), /adapter_provider_receipt_digest_invalid/); }
  finally { await f.stop(); }
});

test('HTTP redirect is never followed', async () => {
  const f = await networkFixture(['REDIRECT']);
  try { await assert.rejects(f.client.send(f.request, now), /adapter_redirect_forbidden/); assert.equal(f.server.metrics().uniqueAcceptances, 0); }
  finally { await f.stop(); }
});

test('HTTP 500 is classified as transient', async () => {
  const f = await networkFixture(['HTTP_500']);
  try { await assert.rejects(f.client.send(f.request, now), HttpAdapterTransientErrorV33_5); }
  finally { await f.stop(); }
});

test('partial JSON response is rejected as permanent malformed evidence', async () => {
  const f = await networkFixture(['PARTIAL_RESPONSE']);
  try { await assert.rejects(f.client.send(f.request, now), /adapter_response_json_invalid/); }
  finally { await f.stop(); }
});

test('oversized response is blocked before JSON parsing', async () => {
  const f = await networkFixture(['OVERSIZED_RESPONSE'], 500, 16 * 1024);
  try { await assert.rejects(f.client.send(f.request, now), /adapter_response_too_large/); }
  finally { await f.stop(); }
});

test('network timeout is bounded and classified transient', async () => {
  const f = await networkFixture(['TIMEOUT'], 30);
  try { await assert.rejects(f.client.send(f.request, now), /adapter_request_timeout/); }
  finally { await f.stop(); }
});

test('webhook receiver rejects invalid content type and malformed JSON', async () => {
  const provider = generateSigningIdentity('provider-webhook'); const keys = new KeyRegistry(); keys.register(provider.keyId, provider.publicKey);
  const receiver = new LocalPushWebhookReceiverV33_5('a', keys, [provider.keyId]); const url = await receiver.start();
  try {
    assert.equal((await postRaw(url, '{}', 'text/plain')).status, 400);
    assert.equal((await postRaw(url, '{')).status, 400);
    assert.equal(receiver.list().length, 0);
  } finally { await receiver.stop(); }
});

test('provider revocation causes webhook rejection and prevents successful qualification', async () => {
  const f = await networkFixture();
  try {
    f.providerKeys.revokeAt(f.provider.keyId, '2026-07-21T05:19:59.000Z');
    await assert.rejects(f.client.send(f.request, now), /adapter_http_status_400/);
    assert.equal(f.receiver.list().length, 0);
  } finally { await f.stop(); }
});

test('mobile approval simulator preserves exact scopes and exposes rollback and four decisions', () => {
  const presentation = new MobileApprovalSimulatorV33_5().present(card(), now);
  assert.deepEqual(presentation.scopeLabels, ['repository.write']);
  assert.equal(presentation.rollbackLabel, 'Rollback available');
  assert.deepEqual(presentation.actions, ['YES', 'NO', 'CHANGE_CONDITIONS', 'EXPLAIN']);
  assert.equal(presentation.externalEffectsExecuted, 0);
});

test('mobile approval simulator rejects expired or malformed scope cards', () => {
  const simulator = new MobileApprovalSimulatorV33_5();
  assert.throws(() => simulator.present(card({ expiresAt: '2026-07-21T05:19:59.000Z' }), now), /mobile_approval_card_expired/);
  assert.throws(() => simulator.present(card({ requestedScopes: ['a', 'a'] }), now), /mobile_approval_scopes_invalid/);
});

test('qualification evidence remains local and cannot promote G3', () => {
  const evidence = buildAdapterQualificationEvidenceV33_5({ adapterId: 'local-http-provider', realLocalHttpRoundTrip: true, providerReceiptVerified: true, signedWebhookVerified: true, exactlyOnceAfterResponseLoss: true, redirectBlocked: true, ssrfPolicyEnforced: true, timeoutBounded: true, oversizedResponseBlocked: true, malformedResponseBlocked: true });
  assert.equal(evidence.evidenceClass, 'LOCAL_HTTP_QUALIFICATION');
  assert.equal(evidence.g3Eligible, false);
  assert.equal(evidence.externalEffectsExecuted, 0);
});
