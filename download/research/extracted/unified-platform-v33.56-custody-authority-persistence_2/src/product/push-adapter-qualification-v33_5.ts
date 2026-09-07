import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import {
  KeyRegistry,
  type SignedEnvelope,
  type SigningIdentity,
  sha256,
  signEnvelope,
} from '../contracts/crypto.js';
import type { PushApprovalCard } from './chat-mission.js';
import type {
  PushTransportProviderReceipt,
  TransportNeutralPushRequest,
} from './reliable-push-v33_4.js';

export type ReferenceProviderFaultV33_5 =
  | 'NORMAL'
  | 'DROP_AFTER_ACCEPT'
  | 'TIMEOUT'
  | 'HTTP_500'
  | 'REDIRECT'
  | 'PARTIAL_RESPONSE'
  | 'OVERSIZED_RESPONSE'
  | 'TAMPER_RECEIPT';

export interface PushAdapterManifestV33_5 {
  readonly version: '33.5';
  readonly adapterId: string;
  readonly endpointUrl: string;
  readonly webhookUrl: string;
  readonly providerKeyId: string;
  readonly protocol: 'LOCAL_HTTP_JSON_V1';
  readonly requestTimeoutMs: number;
  readonly maximumRequestBytes: number;
  readonly maximumResponseBytes: number;
  readonly environment: 'LOCAL_QUALIFICATION';
  readonly allowRedirects: false;
  readonly externalEffectsExecuted: 0;
  readonly manifestDigest: string;
}

export interface PushWebhookChallengeV33_5 {
  readonly version: '33.5';
  readonly challengeId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly adapterId: string;
  readonly requestDigest: string;
  readonly callbackUrlDigest: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly externalEffectsExecuted: 0;
  readonly challengeDigest: string;
}

export interface HttpPushSubmissionV33_5 {
  readonly version: '33.5';
  readonly request: TransportNeutralPushRequest;
  readonly webhookChallenge: SignedEnvelope<PushWebhookChallengeV33_5>;
  readonly externalEffectsExecuted: 0;
  readonly submissionDigest: string;
}

export interface ProviderDeliveryWebhookV33_5 {
  readonly version: '33.5';
  readonly webhookId: string;
  readonly adapterId: string;
  readonly providerMessageId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly deliveryId: string;
  readonly deliveryDigest: string;
  readonly providerDedupKey: string;
  readonly challengeDigest: string;
  readonly status: 'ACCEPTED_BY_REFERENCE_PROVIDER';
  readonly observedAt: string;
  readonly nonce: string;
  readonly externalEffectsExecuted: 0;
  readonly webhookDigest: string;
}

export interface ReferenceProviderMetricsV33_5 {
  readonly adapterId: string;
  readonly requestCount: number;
  readonly uniqueAcceptances: number;
  readonly duplicateSuppressions: number;
  readonly webhookDeliveries: number;
  readonly responseDrops: number;
  readonly timeouts: number;
  readonly malformedResponses: number;
  readonly redirects: number;
  readonly httpFailures: number;
}

export interface AdapterQualificationEvidenceV33_5 {
  readonly version: '33.5';
  readonly adapterId: string;
  readonly realLocalHttpRoundTrip: boolean;
  readonly providerReceiptVerified: boolean;
  readonly signedWebhookVerified: boolean;
  readonly exactlyOnceAfterResponseLoss: boolean;
  readonly redirectBlocked: boolean;
  readonly ssrfPolicyEnforced: boolean;
  readonly timeoutBounded: boolean;
  readonly oversizedResponseBlocked: boolean;
  readonly malformedResponseBlocked: boolean;
  readonly externalEffectsExecuted: 0;
  readonly evidenceClass: 'LOCAL_HTTP_QUALIFICATION';
  readonly g3Eligible: false;
  readonly evidenceDigest: string;
}

export interface MobileApprovalPresentationV33_5 {
  readonly version: '33.5';
  readonly cardId: string;
  readonly tenantId: string;
  readonly title: string;
  readonly summary: string;
  readonly riskLabel: string;
  readonly costLabel: string;
  readonly scopeLabels: readonly string[];
  readonly rollbackLabel: string;
  readonly actions: readonly ['YES', 'NO', 'CHANGE_CONDITIONS', 'EXPLAIN'];
  readonly expiresAt: string;
  readonly authorityGrantDigest: string;
  readonly cardDigest: string;
  readonly externalEffectsExecuted: 0;
  readonly presentationDigest: string;
}

export class HttpAdapterTransientErrorV33_5 extends Error {}
export class HttpAdapterPermanentErrorV33_5 extends Error {}

export function createPushAdapterManifestV33_5(input: Omit<PushAdapterManifestV33_5, 'version' | 'protocol' | 'environment' | 'allowRedirects' | 'externalEffectsExecuted' | 'manifestDigest'>): PushAdapterManifestV33_5 {
  const endpointUrl = validateLoopbackUrl(input.endpointUrl, '/v1/push');
  const webhookUrl = validateLoopbackUrl(input.webhookUrl, '/v1/push-webhook');
  positiveInteger(input.requestTimeoutMs, 'adapter_timeout_invalid');
  positiveInteger(input.maximumRequestBytes, 'adapter_request_limit_invalid');
  positiveInteger(input.maximumResponseBytes, 'adapter_response_limit_invalid');
  if (input.maximumRequestBytes > 1024 * 1024 || input.maximumResponseBytes > 1024 * 1024) throw new Error('adapter_body_limit_excessive');
  const material = {
    version: '33.5' as const,
    adapterId: text(input.adapterId, 'adapter_id_required'),
    endpointUrl,
    webhookUrl,
    providerKeyId: text(input.providerKeyId, 'provider_key_id_required'),
    protocol: 'LOCAL_HTTP_JSON_V1' as const,
    requestTimeoutMs: input.requestTimeoutMs,
    maximumRequestBytes: input.maximumRequestBytes,
    maximumResponseBytes: input.maximumResponseBytes,
    environment: 'LOCAL_QUALIFICATION' as const,
    allowRedirects: false as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, manifestDigest: sha256(material) };
}

export class LocalPushWebhookReceiverV33_5 {
  readonly #adapterId: string;
  readonly #providerKeys: KeyRegistry;
  readonly #trustedProviderIds: ReadonlySet<string>;
  readonly #maximumRequestBytes: number;
  readonly #accepted = new Map<string, SignedEnvelope<ProviderDeliveryWebhookV33_5>>();
  readonly #nonceOwners = new Map<string, string>();
  #server: Server | undefined;
  #url: string | undefined;

  constructor(adapterId: string, providerKeys: KeyRegistry, trustedProviderIds: readonly string[], maximumRequestBytes = 64 * 1024) {
    this.#adapterId = text(adapterId, 'adapter_id_required');
    this.#providerKeys = providerKeys;
    this.#trustedProviderIds = new Set(unique(trustedProviderIds, 'trusted_provider_invalid'));
    this.#maximumRequestBytes = positiveInteger(maximumRequestBytes, 'webhook_body_limit_invalid');
    if (this.#trustedProviderIds.size === 0) throw new Error('trusted_provider_required');
  }

  async start(): Promise<string> {
    if (this.#server !== undefined) throw new Error('webhook_receiver_already_started');
    this.#server = createServer((req, res) => { void this.#handle(req, res); });
    this.#server.listen(0, '127.0.0.1');
    await once(this.#server, 'listening');
    const address = this.#server.address();
    if (address === null || typeof address === 'string') throw new Error('webhook_receiver_address_invalid');
    this.#url = `http://127.0.0.1:${address.port}/v1/push-webhook`;
    return this.#url;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    this.#url = undefined;
    if (server === undefined) return;
    server.close();
    await once(server, 'close');
  }

  url(): string {
    if (this.#url === undefined) throw new Error('webhook_receiver_not_started');
    return this.#url;
  }

  get(webhookId: string): SignedEnvelope<ProviderDeliveryWebhookV33_5> | undefined {
    const row = this.#accepted.get(text(webhookId, 'webhook_id_required'));
    return row === undefined ? undefined : structuredClone(row);
  }

  list(): readonly SignedEnvelope<ProviderDeliveryWebhookV33_5>[] {
    return [...this.#accepted.values()].sort((a, b) => a.payload.webhookId.localeCompare(b.payload.webhookId)).map((row) => structuredClone(row));
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method !== 'POST' || req.url !== '/v1/push-webhook') return respond(res, 404, { error: 'not_found' });
      requireJsonContentType(req);
      const envelope = await readJsonBody<SignedEnvelope<ProviderDeliveryWebhookV33_5>>(req, this.#maximumRequestBytes);
      const payload = envelope.payload;
      validateWebhook(payload, this.#adapterId);
      if (!this.#trustedProviderIds.has(envelope.issuerKeyId) || !this.#providerKeys.verifyAt(envelope, payload.observedAt)) throw new Error('webhook_signature_invalid');
      const existing = this.#accepted.get(payload.webhookId);
      if (existing !== undefined) {
        if (sha256(existing) !== sha256(envelope)) throw new Error('webhook_id_conflict');
        return respond(res, 202, { status: 'duplicate-accepted', webhookDigest: payload.webhookDigest });
      }
      const nonceOwner = this.#nonceOwners.get(payload.nonce);
      if (nonceOwner !== undefined && nonceOwner !== payload.webhookDigest) throw new Error('webhook_nonce_replay');
      this.#accepted.set(payload.webhookId, structuredClone(envelope));
      this.#nonceOwners.set(payload.nonce, payload.webhookDigest);
      return respond(res, 202, { status: 'accepted', webhookDigest: payload.webhookDigest });
    } catch (error) {
      return respond(res, 400, { error: errorCode(error) });
    }
  }
}

export class LocalReferencePushProviderV33_5 {
  readonly adapterId: string;
  readonly #providerIdentity: SigningIdentity;
  readonly #gatewayKeys: KeyRegistry;
  readonly #trustedGatewayIds: ReadonlySet<string>;
  readonly #webhookUrl: string;
  readonly #webhookUrlDigest: string;
  readonly #maximumRequestBytes: number;
  readonly #faults: ReferenceProviderFaultV33_5[];
  readonly #now: () => Date;
  readonly #accepted = new Map<string, { receipt: SignedEnvelope<PushTransportProviderReceipt>; webhook: SignedEnvelope<ProviderDeliveryWebhookV33_5> }>();
  #server: Server | undefined;
  #url: string | undefined;
  #requestCount = 0;
  #duplicateSuppressions = 0;
  #webhookDeliveries = 0;
  #responseDrops = 0;
  #timeouts = 0;
  #malformedResponses = 0;
  #redirects = 0;
  #httpFailures = 0;

  constructor(input: {
    readonly adapterId: string;
    readonly providerIdentity: SigningIdentity;
    readonly gatewayKeys: KeyRegistry;
    readonly trustedGatewayIds: readonly string[];
    readonly webhookUrl: string;
    readonly maximumRequestBytes?: number;
    readonly faults?: readonly ReferenceProviderFaultV33_5[];
    readonly now?: () => Date;
  }) {
    this.adapterId = text(input.adapterId, 'adapter_id_required');
    this.#providerIdentity = input.providerIdentity;
    this.#gatewayKeys = input.gatewayKeys;
    this.#trustedGatewayIds = new Set(unique(input.trustedGatewayIds, 'trusted_gateway_invalid'));
    if (this.#trustedGatewayIds.size === 0) throw new Error('trusted_gateway_required');
    this.#webhookUrl = validateLoopbackUrl(input.webhookUrl, '/v1/push-webhook');
    this.#webhookUrlDigest = sha256(this.#webhookUrl);
    this.#maximumRequestBytes = positiveInteger(input.maximumRequestBytes ?? 128 * 1024, 'provider_body_limit_invalid');
    this.#faults = [...(input.faults ?? [])];
    this.#now = input.now ?? (() => new Date());
  }

  async start(): Promise<string> {
    if (this.#server !== undefined) throw new Error('reference_provider_already_started');
    this.#server = createServer((req, res) => { void this.#handle(req, res); });
    this.#server.listen(0, '127.0.0.1');
    await once(this.#server, 'listening');
    const address = this.#server.address();
    if (address === null || typeof address === 'string') throw new Error('reference_provider_address_invalid');
    this.#url = `http://127.0.0.1:${address.port}/v1/push`;
    return this.#url;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    this.#url = undefined;
    if (server === undefined) return;
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }

  metrics(): ReferenceProviderMetricsV33_5 {
    return {
      adapterId: this.adapterId,
      requestCount: this.#requestCount,
      uniqueAcceptances: this.#accepted.size,
      duplicateSuppressions: this.#duplicateSuppressions,
      webhookDeliveries: this.#webhookDeliveries,
      responseDrops: this.#responseDrops,
      timeouts: this.#timeouts,
      malformedResponses: this.#malformedResponses,
      redirects: this.#redirects,
      httpFailures: this.#httpFailures,
    };
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST' || req.url !== '/v1/push') return respond(res, 404, { error: 'not_found' });
    this.#requestCount += 1;
    const fault = this.#faults.shift() ?? 'NORMAL';
    if (fault === 'REDIRECT') {
      this.#redirects += 1;
      res.writeHead(307, { location: 'http://127.0.0.1:1/forbidden' }); res.end(); return;
    }
    if (fault === 'HTTP_500') {
      this.#httpFailures += 1;
      return respond(res, 500, { error: 'reference_provider_temporary_failure' });
    }
    if (fault === 'TIMEOUT') {
      this.#timeouts += 1;
      await sleep(250);
    }
    try {
      requireJsonContentType(req);
      const submission = await readJsonBody<HttpPushSubmissionV33_5>(req, this.#maximumRequestBytes);
      const observedNow = this.#now();
      validateSubmission(submission, this.adapterId, this.#webhookUrlDigest, this.#gatewayKeys, this.#trustedGatewayIds, observedNow);
      const accepted = this.#accept(submission, observedNow);
      await postWebhook(this.#webhookUrl, accepted.webhook, 64 * 1024, 1_000);
      this.#webhookDeliveries += 1;
      if (fault === 'DROP_AFTER_ACCEPT') {
        this.#responseDrops += 1;
        req.socket.destroy();
        return;
      }
      if (fault === 'PARTIAL_RESPONSE') {
        this.#malformedResponses += 1;
        res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"payload":'); return;
      }
      if (fault === 'OVERSIZED_RESPONSE') {
        this.#malformedResponses += 1;
        return respond(res, 200, { receipt: accepted.receipt, padding: 'x'.repeat(200_000) });
      }
      if (fault === 'TAMPER_RECEIPT') {
        this.#malformedResponses += 1;
        const tampered = structuredClone(accepted.receipt);
        (tampered.payload as { providerMessageId: string }).providerMessageId = 'tampered-message';
        return respond(res, 200, tampered);
      }
      return respond(res, 200, accepted.receipt);
    } catch (error) {
      return respond(res, 400, { error: errorCode(error) });
    }
  }

  #accept(submission: HttpPushSubmissionV33_5, now: Date): { receipt: SignedEnvelope<PushTransportProviderReceipt>; webhook: SignedEnvelope<ProviderDeliveryWebhookV33_5> } {
    const request = submission.request;
    const tenantId = request.signedDelivery.payload.tenantId;
    const acceptanceKey = `${this.adapterId}::${tenantId}::${request.providerDedupKey}`;
    const prior = this.#accepted.get(acceptanceKey);
    if (prior !== undefined) {
      if (prior.receipt.payload.deliveryDigest !== request.deliveryDigest) throw new Error('provider_dedup_collision');
      this.#duplicateSuppressions += 1;
      return structuredClone(prior);
    }
    const receiptMaterial = {
      version: '33.4' as const,
      adapterId: this.adapterId,
      providerMessageId: `http-${sha256({ acceptanceKey, deliveryDigest: request.deliveryDigest }).slice(0, 24)}`,
      tenantId,
      deviceId: request.signedDelivery.payload.deviceId,
      deliveryId: request.signedDelivery.payload.deliveryId,
      providerDedupKey: request.providerDedupKey,
      deliveryDigest: request.deliveryDigest,
      acceptedAt: now.toISOString(),
      externalEffectsExecuted: 0 as const,
    };
    const receipt = signEnvelope<PushTransportProviderReceipt>({ ...receiptMaterial, receiptDigest: sha256(receiptMaterial) }, this.#providerIdentity);
    const challenge = submission.webhookChallenge.payload;
    const webhookMaterial = {
      version: '33.5' as const,
      webhookId: `webhook-${sha256({ requestId: request.requestId, challenge: challenge.challengeDigest }).slice(0, 24)}`,
      adapterId: this.adapterId,
      providerMessageId: receipt.payload.providerMessageId,
      requestId: request.requestId,
      tenantId,
      deviceId: request.signedDelivery.payload.deviceId,
      deliveryId: request.signedDelivery.payload.deliveryId,
      deliveryDigest: request.deliveryDigest,
      providerDedupKey: request.providerDedupKey,
      challengeDigest: challenge.challengeDigest,
      status: 'ACCEPTED_BY_REFERENCE_PROVIDER' as const,
      observedAt: now.toISOString(),
      nonce: challenge.nonce,
      externalEffectsExecuted: 0 as const,
    };
    const webhook = signEnvelope<ProviderDeliveryWebhookV33_5>({ ...webhookMaterial, webhookDigest: sha256(webhookMaterial) }, this.#providerIdentity);
    const accepted = { receipt, webhook };
    this.#accepted.set(acceptanceKey, accepted);
    return structuredClone(accepted);
  }
}

export class LocalHttpPushAdapterV33_5 {
  readonly manifest: PushAdapterManifestV33_5;
  readonly #gatewayIdentity: SigningIdentity;
  readonly #providerKeys: KeyRegistry;
  readonly #trustedProviderIds: ReadonlySet<string>;

  constructor(manifest: PushAdapterManifestV33_5, gatewayIdentity: SigningIdentity, providerKeys: KeyRegistry, trustedProviderIds: readonly string[]) {
    verifyManifest(manifest);
    this.manifest = structuredClone(manifest);
    this.#gatewayIdentity = gatewayIdentity;
    this.#providerKeys = providerKeys;
    this.#trustedProviderIds = new Set(unique(trustedProviderIds, 'trusted_provider_invalid'));
    if (this.#trustedProviderIds.size === 0) throw new Error('trusted_provider_required');
  }

  async send(request: TransportNeutralPushRequest, now = new Date()): Promise<SignedEnvelope<PushTransportProviderReceipt>> {
    validateTransportRequest(request, this.manifest.adapterId);
    const callbackUrlDigest = sha256(this.manifest.webhookUrl);
    const challengeMaterial = {
      version: '33.5' as const,
      challengeId: `challenge-${request.requestId}`,
      requestId: request.requestId,
      tenantId: request.signedDelivery.payload.tenantId,
      adapterId: this.manifest.adapterId,
      requestDigest: request.requestDigest,
      callbackUrlDigest,
      nonce: `webhook-${request.requestId}-${request.deliveryDigest.slice(0, 16)}`,
      issuedAt: request.queuedAt,
      expiresAt: request.expiresAt,
      externalEffectsExecuted: 0 as const,
    };
    const webhookChallenge = signEnvelope<PushWebhookChallengeV33_5>({ ...challengeMaterial, challengeDigest: sha256(challengeMaterial) }, this.#gatewayIdentity);
    const submissionMaterial = { version: '33.5' as const, request, webhookChallenge, externalEffectsExecuted: 0 as const };
    const submission: HttpPushSubmissionV33_5 = { ...submissionMaterial, submissionDigest: sha256(submissionMaterial) };
    const body = Buffer.from(JSON.stringify(submission));
    if (body.byteLength > this.manifest.maximumRequestBytes) throw new HttpAdapterPermanentErrorV33_5('adapter_request_too_large');
    let response: HttpResponseV33_5;
    try {
      response = await postJson(this.manifest.endpointUrl, body, this.manifest.maximumResponseBytes, this.manifest.requestTimeoutMs);
    } catch (error) {
      if (error instanceof HttpAdapterPermanentErrorV33_5) throw error;
      throw new HttpAdapterTransientErrorV33_5(errorCode(error));
    }
    if (response.statusCode >= 300 && response.statusCode < 400) throw new HttpAdapterPermanentErrorV33_5('adapter_redirect_forbidden');
    if (response.statusCode >= 500) throw new HttpAdapterTransientErrorV33_5('adapter_provider_unavailable');
    if (response.statusCode !== 200) throw new HttpAdapterPermanentErrorV33_5(`adapter_http_status_${response.statusCode}`);
    let envelope: SignedEnvelope<PushTransportProviderReceipt>;
    try { envelope = JSON.parse(response.body.toString()) as SignedEnvelope<PushTransportProviderReceipt>; }
    catch { throw new HttpAdapterPermanentErrorV33_5('adapter_response_json_invalid'); }
    const payload = envelope.payload;
    validateProviderReceipt(payload, request, this.manifest.adapterId, now);
    if (!this.#trustedProviderIds.has(envelope.issuerKeyId) || envelope.issuerKeyId !== this.manifest.providerKeyId || !this.#providerKeys.verifyAt(envelope, payload.acceptedAt)) {
      throw new HttpAdapterPermanentErrorV33_5('adapter_provider_signature_invalid');
    }
    return structuredClone(envelope);
  }
}

export class MobileApprovalSimulatorV33_5 {
  present(card: PushApprovalCard, now = new Date()): MobileApprovalPresentationV33_5 {
    if (Date.parse(card.expiresAt) <= now.getTime()) throw new Error('mobile_approval_card_expired');
    if (card.options.join('|') !== 'YES|NO|CHANGE_CONDITIONS|EXPLAIN') throw new Error('mobile_approval_actions_invalid');
    if (card.requestedScopes.length === 0 || new Set(card.requestedScopes).size !== card.requestedScopes.length) throw new Error('mobile_approval_scopes_invalid');
    const material = {
      version: '33.5' as const,
      cardId: card.cardId,
      tenantId: card.tenantId,
      title: text(card.title, 'mobile_approval_title_required'),
      summary: text(card.summary, 'mobile_approval_summary_required'),
      riskLabel: `${card.riskLevel} · ${card.reversibility}`,
      costLabel: `$${card.estimatedCostUsd.toFixed(2)} estimated`,
      scopeLabels: Object.freeze([...card.requestedScopes]),
      rollbackLabel: card.reversibility === 'REVERSIBLE' ? 'Rollback available' : card.reversibility === 'IRREVERSIBLE' ? 'No automatic rollback' : 'Rollback not yet proven',
      actions: ['YES', 'NO', 'CHANGE_CONDITIONS', 'EXPLAIN'] as const,
      expiresAt: card.expiresAt,
      authorityGrantDigest: card.authorityGrantDigest,
      cardDigest: card.cardDigest,
      externalEffectsExecuted: 0 as const,
    };
    return { ...material, presentationDigest: sha256(material) };
  }
}

export function buildAdapterQualificationEvidenceV33_5(input: Omit<AdapterQualificationEvidenceV33_5, 'version' | 'externalEffectsExecuted' | 'evidenceClass' | 'g3Eligible' | 'evidenceDigest'>): AdapterQualificationEvidenceV33_5 {
  const material = {
    version: '33.5' as const,
    ...input,
    externalEffectsExecuted: 0 as const,
    evidenceClass: 'LOCAL_HTTP_QUALIFICATION' as const,
    g3Eligible: false as const,
  };
  return { ...material, evidenceDigest: sha256(material) };
}

interface HttpResponseV33_5 { readonly statusCode: number; readonly body: Buffer; }

async function postWebhook(url: string, envelope: SignedEnvelope<ProviderDeliveryWebhookV33_5>, maximumResponseBytes: number, timeoutMs: number): Promise<void> {
  const response = await postJson(url, Buffer.from(JSON.stringify(envelope)), maximumResponseBytes, timeoutMs);
  if (response.statusCode !== 202) throw new Error('webhook_receiver_rejected');
}

function postJson(urlText: string, body: Buffer, maximumResponseBytes: number, timeoutMs: number): Promise<HttpResponseV33_5> {
  const url = new URL(urlText);
  return new Promise((resolvePromise, rejectPromise) => {
    const req = httpRequest({
      protocol: url.protocol, hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(body.byteLength), connection: 'close' },
    }, (res) => {
      const statusCode = res.statusCode ?? 0;
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > maximumResponseBytes) {
          req.destroy(new HttpAdapterPermanentErrorV33_5('adapter_response_too_large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolvePromise({ statusCode, body: Buffer.concat(chunks) }));
      res.on('error', rejectPromise);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new HttpAdapterTransientErrorV33_5('adapter_request_timeout')));
    req.on('error', rejectPromise);
    req.end(body);
  });
}

function validateSubmission(submission: HttpPushSubmissionV33_5, adapterId: string, callbackUrlDigest: string, gatewayKeys: KeyRegistry, trustedGatewayIds: ReadonlySet<string>, now: Date): void {
  if (submission.version !== '33.5' || submission.externalEffectsExecuted !== 0) throw new Error('submission_invalid');
  const { submissionDigest, ...submissionMaterial } = submission;
  if (sha256(submissionMaterial) !== submissionDigest) throw new Error('submission_digest_invalid');
  validateTransportRequest(submission.request, adapterId);
  const envelope = submission.webhookChallenge;
  const challenge = envelope.payload;
  const { challengeDigest, ...challengeMaterial } = challenge;
  if (challenge.version !== '33.5' || challenge.externalEffectsExecuted !== 0 || sha256(challengeMaterial) !== challengeDigest) throw new Error('webhook_challenge_invalid');
  if (!trustedGatewayIds.has(envelope.issuerKeyId) || !gatewayKeys.verifyAt(envelope, challenge.issuedAt) || !gatewayKeys.verifyAt(submission.request.signedDelivery, submission.request.signedDelivery.payload.issuedAt)) throw new Error('webhook_challenge_signature_invalid');
  if (envelope.issuerKeyId !== submission.request.signedDelivery.issuerKeyId) throw new Error('webhook_challenge_gateway_mismatch');
  if (challenge.requestId !== submission.request.requestId || challenge.tenantId !== submission.request.signedDelivery.payload.tenantId || challenge.adapterId !== adapterId || challenge.requestDigest !== submission.request.requestDigest || challenge.callbackUrlDigest !== callbackUrlDigest) throw new Error('webhook_challenge_binding_invalid');
  if (Date.parse(challenge.issuedAt) > now.getTime() || now.getTime() >= Date.parse(challenge.expiresAt)) throw new Error('webhook_challenge_window_invalid');
}

function validateTransportRequest(request: TransportNeutralPushRequest, adapterId: string): void {
  if (request.version !== '33.4' || request.productionCeiling !== 'shadow' || request.externalEffectsExecuted !== 0 || request.targetAdapterId !== adapterId) throw new Error('transport_request_invalid');
  const { requestDigest, ...requestMaterial } = request;
  if (sha256(requestMaterial) !== requestDigest || sha256(request.signedDelivery) !== request.deliveryDigest) throw new Error('transport_request_digest_invalid');
}

function validateProviderReceipt(receipt: PushTransportProviderReceipt, request: TransportNeutralPushRequest, adapterId: string, now: Date): void {
  const { receiptDigest, ...material } = receipt;
  if (receipt.version !== '33.4' || receipt.externalEffectsExecuted !== 0 || sha256(material) !== receiptDigest) throw new HttpAdapterPermanentErrorV33_5('adapter_provider_receipt_digest_invalid');
  if (receipt.adapterId !== adapterId || receipt.adapterId !== request.targetAdapterId || receipt.tenantId !== request.signedDelivery.payload.tenantId || receipt.deviceId !== request.signedDelivery.payload.deviceId || receipt.deliveryId !== request.signedDelivery.payload.deliveryId || receipt.deliveryDigest !== request.deliveryDigest || receipt.providerDedupKey !== request.providerDedupKey) throw new HttpAdapterPermanentErrorV33_5('adapter_provider_receipt_binding_invalid');
  const acceptedAt = Date.parse(receipt.acceptedAt);
  if (!Number.isFinite(acceptedAt) || acceptedAt > now.getTime() + 5_000 || acceptedAt >= Date.parse(request.expiresAt)) throw new HttpAdapterPermanentErrorV33_5('adapter_provider_receipt_time_invalid');
}

function validateWebhook(webhook: ProviderDeliveryWebhookV33_5, adapterId: string): void {
  const { webhookDigest, ...material } = webhook;
  if (webhook.version !== '33.5' || webhook.externalEffectsExecuted !== 0 || webhook.adapterId !== adapterId || webhook.status !== 'ACCEPTED_BY_REFERENCE_PROVIDER' || sha256(material) !== webhookDigest) throw new Error('webhook_payload_invalid');
  if (!Number.isFinite(Date.parse(webhook.observedAt))) throw new Error('webhook_time_invalid');
}

function verifyManifest(manifest: PushAdapterManifestV33_5): void {
  const { manifestDigest, ...material } = manifest;
  if (manifest.version !== '33.5' || manifest.protocol !== 'LOCAL_HTTP_JSON_V1' || manifest.environment !== 'LOCAL_QUALIFICATION' || manifest.allowRedirects !== false || manifest.externalEffectsExecuted !== 0 || sha256(material) !== manifestDigest) throw new Error('adapter_manifest_invalid');
  validateLoopbackUrl(manifest.endpointUrl, '/v1/push');
  validateLoopbackUrl(manifest.webhookUrl, '/v1/push-webhook');
}

function validateLoopbackUrl(value: string, expectedPath: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('adapter_url_invalid'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || url.pathname !== expectedPath || url.port === '') throw new Error('adapter_url_not_local_qualified');
  const port = Number(url.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('adapter_url_port_invalid');
  return url.toString();
}

async function readJsonBody<T>(req: IncomingMessage, maximumBytes: number): Promise<T> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maximumBytes) throw new Error('http_body_too_large');
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T; }
  catch { throw new Error('http_json_invalid'); }
}

function requireJsonContentType(req: IncomingMessage): void {
  const value = req.headers['content-type'];
  if (typeof value !== 'string' || value.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') throw new Error('http_content_type_invalid');
}

function respond(res: ServerResponse, statusCode: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(statusCode, { 'content-type': 'application/json', 'content-length': String(body.byteLength), connection: 'close' });
  res.end(body);
}

function text(value: string, code: string): string {
  const normalized = value.trim();
  if (normalized === '') throw new Error(code);
  return normalized;
}

function unique(values: readonly string[], code: string): string[] {
  const normalized = values.map((value) => text(value, code));
  if (new Set(normalized).size !== normalized.length) throw new Error(code);
  return normalized;
}

function positiveInteger(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code);
  return value;
}

function errorCode(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown_error';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
