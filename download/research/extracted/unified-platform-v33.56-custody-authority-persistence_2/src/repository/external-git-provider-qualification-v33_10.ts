import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import {
  KeyRegistry,
  type SignedEnvelope,
  type SigningIdentity,
  canonicalJson,
  sha256,
  sha256Bytes,
  signEnvelope,
} from '../contracts/crypto.js';
import {
  verifyPullRequestProposalV33_9,
  type PullRequestProposalV33_9,
} from './multi-file-engineering-campaign-v33_9.js';

export type ExternalGitProviderV33_10 = 'GITHUB' | 'GITLAB';
export type ReferenceGitFaultV33_10 =
  | 'NORMAL'
  | 'DROP_AFTER_DRAFT_CREATE'
  | 'HTTP_500'
  | 'REDIRECT'
  | 'MALFORMED_RESPONSE'
  | 'OVERSIZED_RESPONSE'
  | 'TAMPER_WEBHOOK';

export interface ExternalGitAdapterManifestV33_10 {
  readonly version: '33.10';
  readonly adapterId: string;
  readonly provider: ExternalGitProviderV33_10;
  readonly apiBaseUrl: string;
  readonly webhookUrl: string;
  readonly credentialRef: string;
  readonly webhookSigningSecretRef: string;
  readonly repositoryRef: string;
  readonly targetBranch: string;
  readonly allowedHeadPrefix: 'sovereign/';
  readonly requiredCredentialScopes: readonly string[];
  readonly requestTimeoutMs: number;
  readonly maximumRequestBytes: number;
  readonly maximumResponseBytes: number;
  readonly environment: 'LOCAL_PROVIDER_QUALIFICATION';
  readonly draftOnly: true;
  readonly branchProtectionRequired: true;
  readonly allowRedirects: false;
  readonly mergeAllowed: false;
  readonly deploymentAllowed: false;
  readonly externalEffectsExecuted: 0;
  readonly manifestDigest: string;
}

export interface GitCredentialLeaseDescriptorV33_10 {
  readonly version: '33.10';
  readonly credentialRef: string;
  readonly provider: ExternalGitProviderV33_10;
  readonly tenantId: string;
  readonly repositoryRef: string;
  readonly subjectId: string;
  readonly scopes: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly descriptorDigest: string;
}

interface GitCredentialLeaseInternalV33_10 {
  readonly descriptor: GitCredentialLeaseDescriptorV33_10;
  readonly token: string;
}

export interface QualifiedFileContentV33_10 {
  readonly path: string;
  readonly contentBase64: string;
  readonly contentSha256: string;
  readonly mode: '100644';
}

export interface QualifiedChangeBundleV33_10 {
  readonly version: '33.10';
  readonly bundleId: string;
  readonly tenantId: string;
  readonly idempotencyKey: string;
  readonly proposal: SignedEnvelope<PullRequestProposalV33_9>;
  readonly files: readonly QualifiedFileContentV33_10[];
  readonly targetBranch: string;
  readonly commitMessage: string;
  readonly submittedAt: string;
  readonly productionCeiling: 'shadow';
  readonly mergeExecuted: false;
  readonly deploymentExecuted: false;
  readonly externalEffectsExecuted: 0;
  readonly bundleDigest: string;
}

export interface ExternalGitWebhookEvidenceV33_10 {
  readonly version: '33.10';
  readonly provider: ExternalGitProviderV33_10;
  readonly deliveryId: string;
  readonly eventName: 'pull_request' | 'Merge Request Hook';
  readonly repositoryRef: string;
  readonly headRef: string;
  readonly targetBranch: string;
  readonly draft: true;
  readonly action: 'opened';
  readonly providerObjectId: string;
  readonly receivedAt: string;
  readonly bodySha256: string;
  readonly signatureVerified: true;
  readonly webhookDigest: string;
}

export interface ExternalDraftProposalReceiptV33_10 {
  readonly version: '33.10';
  readonly receiptId: string;
  readonly adapterId: string;
  readonly provider: ExternalGitProviderV33_10;
  readonly tenantId: string;
  readonly bundleId: string;
  readonly proposalId: string;
  readonly repositoryRef: string;
  readonly targetBranch: string;
  readonly headRef: string;
  readonly commitSha: string;
  readonly providerObjectId: string;
  readonly providerObjectUrl: string;
  readonly draft: true;
  readonly branchProtectionObserved: true;
  readonly providerWebhookDeliveryId: string;
  readonly providerWebhookDigest: string;
  readonly credentialRef: string;
  readonly credentialSubjectId: string;
  readonly requestTraceDigest: string;
  readonly acceptedAt: string;
  readonly evidenceClass: 'LOCAL_EXTERNAL_GIT_PROVIDER_QUALIFICATION';
  readonly localProviderMutationExecuted: true;
  readonly externalGitMutationExecuted: false;
  readonly realPullRequestCreated: false;
  readonly mergeExecuted: false;
  readonly deploymentExecuted: false;
  readonly externalEffectsExecuted: 0;
  readonly g4Eligible: false;
  readonly receiptDigest: string;
}

export interface ReferenceGitProviderMetricsV33_10 {
  readonly provider: ExternalGitProviderV33_10;
  readonly requestCount: number;
  readonly uniqueMutations: number;
  readonly duplicateSuppressions: number;
  readonly draftObjectsCreated: number;
  readonly webhooksSent: number;
  readonly responseDrops: number;
  readonly mergeEndpointCalls: number;
  readonly deploymentEndpointCalls: number;
  readonly trace: readonly { readonly method: string; readonly path: string; readonly idempotencyKey: string }[];
}

export class ExternalGitTransientErrorV33_10 extends Error {}
export class ExternalGitPermanentErrorV33_10 extends Error {}

export function createExternalGitAdapterManifestV33_10(input: {
  readonly adapterId: string;
  readonly provider: ExternalGitProviderV33_10;
  readonly apiBaseUrl: string;
  readonly webhookUrl: string;
  readonly credentialRef: string;
  readonly webhookSigningSecretRef: string;
  readonly repositoryRef: string;
  readonly targetBranch: string;
  readonly requiredCredentialScopes: readonly string[];
  readonly requestTimeoutMs: number;
  readonly maximumRequestBytes: number;
  readonly maximumResponseBytes: number;
}): ExternalGitAdapterManifestV33_10 {
  const apiBaseUrl = validateLoopbackBaseUrl(input.apiBaseUrl);
  const webhookUrl = validateLoopbackWebhookUrl(input.webhookUrl);
  const scopes = uniqueNonEmpty(input.requiredCredentialScopes, 'external_git_scopes_invalid');
  if (scopes.length === 0) throw new Error('external_git_scopes_required');
  positiveInt(input.requestTimeoutMs, 'external_git_timeout_invalid');
  positiveInt(input.maximumRequestBytes, 'external_git_request_limit_invalid');
  positiveInt(input.maximumResponseBytes, 'external_git_response_limit_invalid');
  if (input.maximumRequestBytes > 2 * 1024 * 1024 || input.maximumResponseBytes > 2 * 1024 * 1024) throw new Error('external_git_body_limit_excessive');
  validateRepositoryRef(input.provider, input.repositoryRef);
  validateBranch(input.targetBranch, 'external_git_target_branch_invalid');
  const material = {
    version: '33.10' as const,
    adapterId: required(input.adapterId, 'external_git_adapter_id_required'),
    provider: input.provider,
    apiBaseUrl,
    webhookUrl,
    credentialRef: required(input.credentialRef, 'external_git_credential_ref_required'),
    webhookSigningSecretRef: required(input.webhookSigningSecretRef, 'external_git_webhook_secret_ref_required'),
    repositoryRef: input.repositoryRef,
    targetBranch: input.targetBranch,
    allowedHeadPrefix: 'sovereign/' as const,
    requiredCredentialScopes: scopes,
    requestTimeoutMs: input.requestTimeoutMs,
    maximumRequestBytes: input.maximumRequestBytes,
    maximumResponseBytes: input.maximumResponseBytes,
    environment: 'LOCAL_PROVIDER_QUALIFICATION' as const,
    draftOnly: true as const,
    branchProtectionRequired: true as const,
    allowRedirects: false as const,
    mergeAllowed: false as const,
    deploymentAllowed: false as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, manifestDigest: sha256(material) };
}

export class EphemeralGitCredentialBrokerV33_10 {
  readonly #leases = new Map<string, GitCredentialLeaseInternalV33_10>();

  register(input: {
    readonly credentialRef: string;
    readonly provider: ExternalGitProviderV33_10;
    readonly tenantId: string;
    readonly repositoryRef: string;
    readonly subjectId: string;
    readonly scopes: readonly string[];
    readonly issuedAt: string;
    readonly expiresAt: string;
    readonly token: string;
  }): GitCredentialLeaseDescriptorV33_10 {
    const issuedAt = parseIso(input.issuedAt, 'external_git_credential_issued_invalid');
    const expiresAt = parseIso(input.expiresAt, 'external_git_credential_expiry_invalid');
    if (expiresAt <= issuedAt) throw new Error('external_git_credential_window_invalid');
    const token = required(input.token, 'external_git_token_required');
    if (token.length < 24) throw new Error('external_git_token_too_short');
    const material = {
      version: '33.10' as const,
      credentialRef: required(input.credentialRef, 'external_git_credential_ref_required'),
      provider: input.provider,
      tenantId: required(input.tenantId, 'external_git_tenant_required'),
      repositoryRef: required(input.repositoryRef, 'external_git_repository_required'),
      subjectId: required(input.subjectId, 'external_git_subject_required'),
      scopes: uniqueNonEmpty(input.scopes, 'external_git_scopes_invalid'),
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    };
    const descriptor: GitCredentialLeaseDescriptorV33_10 = { ...material, descriptorDigest: sha256(material) };
    const prior = this.#leases.get(descriptor.credentialRef);
    if (prior !== undefined && sha256(prior.descriptor) !== sha256(descriptor)) throw new Error('external_git_credential_ref_conflict');
    this.#leases.set(descriptor.credentialRef, { descriptor, token });
    return structuredClone(descriptor);
  }

  revokeAt(credentialRef: string, at: string): GitCredentialLeaseDescriptorV33_10 {
    const row = this.#required(credentialRef);
    const revokedAt = new Date(parseIso(at, 'external_git_credential_revocation_invalid')).toISOString();
    if (Date.parse(revokedAt) < Date.parse(row.descriptor.issuedAt)) throw new Error('external_git_credential_revocation_before_issue');
    if (row.descriptor.revokedAt !== undefined && row.descriptor.revokedAt !== revokedAt) throw new Error('external_git_credential_revocation_conflict');
    const { descriptorDigest: _, ...base } = row.descriptor;
    const material = { ...base, revokedAt };
    const descriptor: GitCredentialLeaseDescriptorV33_10 = { ...material, descriptorDigest: sha256(material) };
    this.#leases.set(credentialRef, { descriptor, token: row.token });
    return structuredClone(descriptor);
  }

  resolve(input: {
    readonly credentialRef: string;
    readonly provider: ExternalGitProviderV33_10;
    readonly tenantId: string;
    readonly repositoryRef: string;
    readonly requiredScopes: readonly string[];
    readonly at: Date;
  }): { readonly token: string; readonly descriptor: GitCredentialLeaseDescriptorV33_10 } {
    validDate(input.at);
    const row = this.#required(input.credentialRef);
    const d = row.descriptor;
    const { descriptorDigest, ...material } = d;
    if (sha256(material) !== descriptorDigest) throw new Error('external_git_credential_descriptor_tampered');
    if (d.provider !== input.provider || d.tenantId !== input.tenantId || d.repositoryRef !== input.repositoryRef) throw new Error('external_git_credential_binding_invalid');
    const now = input.at.getTime();
    if (now < Date.parse(d.issuedAt) || now >= Date.parse(d.expiresAt)) throw new Error('external_git_credential_not_active');
    if (d.revokedAt !== undefined && now >= Date.parse(d.revokedAt)) throw new Error('external_git_credential_revoked');
    for (const scope of input.requiredScopes) if (!d.scopes.includes(scope)) throw new Error(`external_git_credential_scope_missing:${scope}`);
    return { token: row.token, descriptor: structuredClone(d) };
  }

  listDescriptors(): readonly GitCredentialLeaseDescriptorV33_10[] {
    return [...this.#leases.values()].map((row) => structuredClone(row.descriptor)).sort((a, b) => a.credentialRef.localeCompare(b.credentialRef));
  }

  #required(ref: string): GitCredentialLeaseInternalV33_10 {
    const row = this.#leases.get(required(ref, 'external_git_credential_ref_required'));
    if (row === undefined) throw new Error('external_git_credential_not_found');
    return row;
  }
}

export class EphemeralWebhookSecretBrokerV33_10 {
  readonly #secrets = new Map<string, { provider: ExternalGitProviderV33_10; secret: string }>();
  register(ref: string, provider: ExternalGitProviderV33_10, secret: string): void {
    const key = required(ref, 'external_git_webhook_secret_ref_required');
    const value = required(secret, 'external_git_webhook_secret_required');
    if (provider === 'GITLAB' && !value.startsWith('whsec_')) throw new Error('gitlab_webhook_signing_token_invalid');
    if (provider === 'GITHUB' && value.length < 24) throw new Error('github_webhook_secret_too_short');
    const prior = this.#secrets.get(key);
    if (prior !== undefined && (prior.provider !== provider || prior.secret !== value)) throw new Error('external_git_webhook_secret_ref_conflict');
    this.#secrets.set(key, { provider, secret: value });
  }
  resolve(ref: string, provider: ExternalGitProviderV33_10): string {
    const row = this.#secrets.get(required(ref, 'external_git_webhook_secret_ref_required'));
    if (row === undefined || row.provider !== provider) throw new Error('external_git_webhook_secret_binding_invalid');
    return row.secret;
  }
}

export function createQualifiedChangeBundleV33_10(input: Omit<QualifiedChangeBundleV33_10, 'version' | 'productionCeiling' | 'mergeExecuted' | 'deploymentExecuted' | 'externalEffectsExecuted' | 'bundleDigest'>): QualifiedChangeBundleV33_10 {
  const material = {
    version: '33.10' as const,
    bundleId: required(input.bundleId, 'external_git_bundle_id_required'),
    tenantId: required(input.tenantId, 'external_git_tenant_required'),
    idempotencyKey: required(input.idempotencyKey, 'external_git_idempotency_required'),
    proposal: input.proposal,
    files: input.files.map((row) => ({ ...row })),
    targetBranch: input.targetBranch,
    commitMessage: required(input.commitMessage, 'external_git_commit_message_required'),
    submittedAt: new Date(parseIso(input.submittedAt, 'external_git_submitted_at_invalid')).toISOString(),
    productionCeiling: 'shadow' as const,
    mergeExecuted: false as const,
    deploymentExecuted: false as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, bundleDigest: sha256(material) };
}

export class ExternalGitWebhookReceiverV33_10 {
  readonly #secretBroker: EphemeralWebhookSecretBrokerV33_10;
  readonly #secretRefs: Readonly<Record<ExternalGitProviderV33_10, string>>;
  readonly #maxBody: number;
  readonly #events = new Map<string, ExternalGitWebhookEvidenceV33_10>();
  #server: Server | undefined;
  #url: string | undefined;

  constructor(input: {
    readonly secretBroker: EphemeralWebhookSecretBrokerV33_10;
    readonly githubSecretRef: string;
    readonly gitlabSecretRef: string;
    readonly maximumRequestBytes?: number;
  }) {
    this.#secretBroker = input.secretBroker;
    this.#secretRefs = { GITHUB: input.githubSecretRef, GITLAB: input.gitlabSecretRef };
    this.#maxBody = input.maximumRequestBytes ?? 256 * 1024;
  }

  async start(): Promise<string> {
    if (this.#server !== undefined) throw new Error('external_git_webhook_receiver_started');
    this.#server = createServer((req, res) => { void this.#handle(req, res); });
    this.#server.listen(0, '127.0.0.1');
    await once(this.#server, 'listening');
    const address = this.#server.address();
    if (address === null || typeof address === 'string') throw new Error('external_git_webhook_address_invalid');
    this.#url = `http://127.0.0.1:${address.port}/v1/git-provider-webhook`;
    return this.#url;
  }

  async stop(): Promise<void> {
    const server = this.#server; this.#server = undefined; this.#url = undefined;
    if (server === undefined) return;
    server.close(); await once(server, 'close');
  }

  url(): string { if (this.#url === undefined) throw new Error('external_git_webhook_receiver_not_started'); return this.#url; }
  list(): readonly ExternalGitWebhookEvidenceV33_10[] { return [...this.#events.values()].sort((a, b) => a.deliveryId.localeCompare(b.deliveryId)).map((row) => structuredClone(row)); }
  get(deliveryId: string): ExternalGitWebhookEvidenceV33_10 | undefined { const row = this.#events.get(deliveryId); return row === undefined ? undefined : structuredClone(row); }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method !== 'POST' || req.url !== '/v1/git-provider-webhook') return respond(res, 404, { error: 'not_found' });
      const raw = await readRawBody(req, this.#maxBody);
      const provider = header(req, 'x-git-provider') as ExternalGitProviderV33_10;
      if (provider !== 'GITHUB' && provider !== 'GITLAB') throw new Error('external_git_webhook_provider_invalid');
      const secret = this.#secretBroker.resolve(this.#secretRefs[provider], provider);
      let deliveryId: string;
      let eventName: 'pull_request' | 'Merge Request Hook';
      if (provider === 'GITHUB') {
        deliveryId = header(req, 'x-github-delivery');
        eventName = header(req, 'x-github-event') as 'pull_request';
        if (eventName !== 'pull_request') throw new Error('github_webhook_event_invalid');
        verifyGitHubHmac(secret, raw, header(req, 'x-hub-signature-256'));
      } else {
        deliveryId = header(req, 'webhook-id');
        eventName = header(req, 'x-gitlab-event') as 'Merge Request Hook';
        if (eventName !== 'Merge Request Hook') throw new Error('gitlab_webhook_event_invalid');
        const timestamp = header(req, 'webhook-timestamp');
        const parsed = Number(timestamp);
        if (!Number.isInteger(parsed) || Math.abs(Date.now() / 1000 - parsed) > 10 * 60) throw new Error('gitlab_webhook_timestamp_invalid');
        verifyGitLabStandardWebhook(secret, deliveryId, timestamp, raw, header(req, 'webhook-signature'));
      }
      const body = parseJson(raw);
      const normalized = normalizeWebhook(provider, deliveryId, eventName, body);
      const existing = this.#events.get(deliveryId);
      if (existing !== undefined) {
        if (existing.webhookDigest !== normalized.webhookDigest) throw new Error('external_git_webhook_delivery_conflict');
        return respond(res, 202, { status: 'duplicate', webhookDigest: existing.webhookDigest });
      }
      this.#events.set(deliveryId, normalized);
      return respond(res, 202, { status: 'accepted', webhookDigest: normalized.webhookDigest });
    } catch (error) {
      return respond(res, 400, { error: errorCode(error) });
    }
  }
}

interface ReferenceProviderRecordV33_10 { readonly bodyDigest: string; readonly status: number; readonly response: unknown; }

export class LocalReferenceExternalGitProviderV33_10 {
  readonly provider: ExternalGitProviderV33_10;
  readonly #repositoryRef: string;
  readonly #targetBranch: string;
  readonly #expectedToken: string;
  readonly #webhookUrl: string;
  readonly #webhookSecret: string;
  readonly #faults: ReferenceGitFaultV33_10[];
  readonly #records = new Map<string, ReferenceProviderRecordV33_10>();
  readonly #trace: { method: string; path: string; idempotencyKey: string }[] = [];
  #server: Server | undefined;
  #url: string | undefined;
  #requestCount = 0; #uniqueMutations = 0; #duplicates = 0; #drafts = 0; #webhooks = 0; #drops = 0; #mergeCalls = 0; #deploymentCalls = 0;

  constructor(input: {
    readonly provider: ExternalGitProviderV33_10;
    readonly repositoryRef: string;
    readonly targetBranch: string;
    readonly expectedToken: string;
    readonly webhookUrl: string;
    readonly webhookSecret: string;
    readonly faults?: readonly ReferenceGitFaultV33_10[];
  }) {
    this.provider = input.provider; validateRepositoryRef(input.provider, input.repositoryRef); validateBranch(input.targetBranch, 'external_git_target_branch_invalid');
    this.#repositoryRef = input.repositoryRef; this.#targetBranch = input.targetBranch; this.#expectedToken = input.expectedToken;
    this.#webhookUrl = validateLoopbackWebhookUrl(input.webhookUrl); this.#webhookSecret = input.webhookSecret; this.#faults = [...(input.faults ?? [])];
  }

  async start(): Promise<string> {
    if (this.#server !== undefined) throw new Error('reference_git_provider_started');
    this.#server = createServer((req, res) => { void this.#handle(req, res); }); this.#server.listen(0, '127.0.0.1'); await once(this.#server, 'listening');
    const address = this.#server.address(); if (address === null || typeof address === 'string') throw new Error('reference_git_provider_address_invalid');
    this.#url = `http://127.0.0.1:${address.port}`; return this.#url;
  }
  async stop(): Promise<void> { const server = this.#server; this.#server = undefined; this.#url = undefined; if (server === undefined) return; server.close(); await once(server, 'close'); }
  url(): string { if (this.#url === undefined) throw new Error('reference_git_provider_not_started'); return this.#url; }
  metrics(): ReferenceGitProviderMetricsV33_10 { return { provider:this.provider,requestCount:this.#requestCount,uniqueMutations:this.#uniqueMutations,duplicateSuppressions:this.#duplicates,draftObjectsCreated:this.#drafts,webhooksSent:this.#webhooks,responseDrops:this.#drops,mergeEndpointCalls:this.#mergeCalls,deploymentEndpointCalls:this.#deploymentCalls,trace:this.#trace.map((row)=>({...row})) }; }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.#requestCount += 1;
    try {
      const path = req.url ?? '/'; const method = req.method ?? 'GET';
      if (/merge|deploy/i.test(path) && method !== 'POST') { /* route names can contain merge_requests */ }
      if (/\/merge$|\/merges$|\/deployments/.test(path)) { if (/deploy/.test(path)) this.#deploymentCalls += 1; else this.#mergeCalls += 1; return respond(res, 405, { error:'forbidden_endpoint' }); }
      this.#verifyAuth(req);
      const idempotencyKey = header(req, 'x-sovereign-idempotency-key');
      this.#trace.push({ method, path, idempotencyKey });
      if (method === 'GET') return this.#handleGet(path, idempotencyKey, res);
      if (method !== 'POST') return respond(res, 405, { error: 'method_not_allowed' });
      const raw = await readRawBody(req, 2 * 1024 * 1024); const body = parseJson(raw); const fault = this.#faults.shift() ?? 'NORMAL';
      if (fault === 'HTTP_500') return respond(res, 500, { error: 'injected_failure' });
      if (fault === 'REDIRECT') { res.writeHead(302, { location: 'http://127.0.0.1:9/forbidden' }); res.end(); return; }
      if (fault === 'MALFORMED_RESPONSE') { res.writeHead(201, {'content-type':'application/json'}); res.end('{'); return; }
      if (fault === 'OVERSIZED_RESPONSE') { res.writeHead(201, {'content-type':'application/json'}); res.end(JSON.stringify({data:'x'.repeat(3*1024*1024)})); return; }
      const operationKey = `${method}:${path}:${idempotencyKey}`; const bodyDigest = sha256(body); const existing = this.#records.get(operationKey);
      if (existing !== undefined) {
        if (existing.bodyDigest !== bodyDigest) return respond(res, 409, { error:'idempotency_payload_conflict' });
        this.#duplicates += 1; return respond(res, existing.status, existing.response);
      }
      const output = await this.#mutate(path, body, fault === 'TAMPER_WEBHOOK');
      this.#records.set(operationKey, { bodyDigest, status:201, response:output }); this.#uniqueMutations += 1;
      const isDraftCreate = this.provider === 'GITHUB' ? path.endsWith('/pulls') : path.endsWith('/merge_requests');
      if (isDraftCreate) {
        this.#drafts += 1;
        if (fault === 'DROP_AFTER_DRAFT_CREATE') { this.#drops += 1; req.socket.destroy(); return; }
      }
      return respond(res, 201, output);
    } catch (error) { return respond(res, 400, { error:errorCode(error) }); }
  }

  #verifyAuth(req: IncomingMessage): void {
    const auth = this.provider === 'GITHUB' ? header(req,'authorization') : header(req,'private-token');
    const expected = this.provider === 'GITHUB' ? `Bearer ${this.#expectedToken}` : this.#expectedToken;
    if (!safeEqual(auth, expected)) throw new Error('reference_git_auth_invalid');
  }

  #handleGet(path: string, idempotencyKey: string, res: ServerResponse): void {
    if (idempotencyKey.trim() === '') throw new Error('external_git_idempotency_required');
    if (this.provider === 'GITHUB') {
      const expected = `/repos/${this.#repositoryRef}/branches/${encodeURIComponent(this.#targetBranch)}`;
      if (path !== expected) return respond(res,404,{error:'not_found'});
      return respond(res,200,{name:this.#targetBranch,protected:true,commit:{sha:'a'.repeat(40)}});
    }
    const expected = `/api/v4/projects/${encodeURIComponent(this.#repositoryRef)}/repository/branches/${encodeURIComponent(this.#targetBranch)}`;
    if (path !== expected) return respond(res,404,{error:'not_found'});
    return respond(res,200,{name:this.#targetBranch,protected:true,commit:{id:'b'.repeat(40)}});
  }

  async #mutate(path: string, body: Record<string, unknown>, tamperWebhook: boolean): Promise<Record<string, unknown>> {
    if (this.provider === 'GITHUB') return this.#mutateGitHub(path, body, tamperWebhook);
    return this.#mutateGitLab(path, body, tamperWebhook);
  }

  async #mutateGitHub(path: string, body: Record<string, unknown>, tamperWebhook: boolean): Promise<Record<string, unknown>> {
    const prefix = `/repos/${this.#repositoryRef}`;
    if (path === `${prefix}/git/blobs`) return { sha: sha256(body).slice(0,40), url:`${this.url()}${path}/blob` };
    if (path === `${prefix}/git/trees`) return { sha: sha256({tree:body}).slice(0,40), url:`${this.url()}${path}/tree` };
    if (path === `${prefix}/git/commits`) return { sha: sha256({commit:body}).slice(0,40), url:`${this.url()}${path}/commit` };
    if (path === `${prefix}/git/refs`) {
      const ref = String(body.ref ?? ''); if (!ref.startsWith('refs/heads/sovereign/')) throw new Error('reference_git_head_ref_invalid');
      return { ref, object:{sha:String(body.sha ?? '')}, url:`${this.url()}${path}/ref` };
    }
    if (path === `${prefix}/pulls`) {
      if (body.draft !== true || String(body.head ?? '').startsWith('sovereign/') === false || body.base !== this.#targetBranch) throw new Error('reference_git_draft_boundary_invalid');
      const number = this.#drafts + 1; const deliveryId = randomUUID(); const commitSha = sha256({head:body.head}).slice(0,40);
      const payload={action:'opened',number,pull_request:{number,draft:true,state:'open',html_url:`https://github.invalid/${this.#repositoryRef}/pull/${number}`,head:{ref:body.head,sha:commitSha},base:{ref:body.base}},repository:{full_name:this.#repositoryRef}};
      await this.#sendWebhook('GITHUB',deliveryId,payload,tamperWebhook);
      return { number, url:`${this.url()}${path}/${number}`, html_url:payload.pull_request.html_url, draft:true, state:'open', head:{ref:body.head,sha:commitSha}, base:{ref:body.base}, webhook_delivery_id:deliveryId };
    }
    throw new Error('reference_git_route_invalid');
  }

  async #mutateGitLab(path: string, body: Record<string, unknown>, tamperWebhook: boolean): Promise<Record<string, unknown>> {
    const prefix = `/api/v4/projects/${encodeURIComponent(this.#repositoryRef)}`;
    if (path === `${prefix}/repository/commits`) {
      const branch=String(body.branch??''); if(!branch.startsWith('sovereign/'))throw new Error('reference_git_head_ref_invalid');
      if(!Array.isArray(body.actions)||body.actions.length<2)throw new Error('reference_git_actions_invalid');
      return {id:sha256({commit:body}).slice(0,40),short_id:sha256(body).slice(0,8),web_url:`https://gitlab.invalid/${this.#repositoryRef}/-/commit/${sha256(body).slice(0,40)}`};
    }
    if(path===`${prefix}/merge_requests`){
      const title=String(body.title??'');const source=String(body.source_branch??'');const target=String(body.target_branch??'');
      if(!title.startsWith('Draft: ')||!source.startsWith('sovereign/')||target!==this.#targetBranch)throw new Error('reference_git_draft_boundary_invalid');
      const iid=this.#drafts+1;const deliveryId=randomUUID();const commitSha=sha256({source}).slice(0,40);
      const payload={object_kind:'merge_request',event_type:'merge_request',project:{path_with_namespace:this.#repositoryRef},object_attributes:{iid,action:'open',state:'opened',draft:true,title,source_branch:source,target_branch:target,last_commit:{id:commitSha},url:`https://gitlab.invalid/${this.#repositoryRef}/-/merge_requests/${iid}`}};
      await this.#sendWebhook('GITLAB',deliveryId,payload,tamperWebhook);
      return {iid,id:iid,web_url:payload.object_attributes.url,draft:true,state:'opened',source_branch:source,target_branch:target,sha:commitSha,webhook_delivery_id:deliveryId};
    }
    throw new Error('reference_git_route_invalid');
  }

  async #sendWebhook(provider:ExternalGitProviderV33_10,deliveryId:string,payload:unknown,tamper:boolean):Promise<void>{
    const body=Buffer.from(JSON.stringify(payload));const url=new URL(this.#webhookUrl);const headers:Record<string,string>={'content-type':'application/json','content-length':String(body.length),'x-git-provider':provider};
    if(provider==='GITHUB'){
      const signature=`sha256=${createHmac('sha256',this.#webhookSecret).update(body).digest('hex')}`;
      headers['x-github-delivery']=deliveryId;headers['x-github-event']='pull_request';headers['x-hub-signature-256']=tamper?`${signature.slice(0,-1)}0`:signature;
    }else{
      const timestamp=String(Math.floor(Date.now()/1000));const rawKey=decodeGitLabSigningToken(this.#webhookSecret);const signature=`v1,${createHmac('sha256',rawKey).update(`${deliveryId}.${timestamp}.${body.toString('utf8')}`).digest('base64')}`;
      headers['webhook-id']=deliveryId;headers['webhook-timestamp']=timestamp;headers['webhook-signature']=tamper?`${signature.slice(0,-2)}AA`:signature;headers['x-gitlab-event']='Merge Request Hook';
    }
    await sendRaw(url,body,headers,1000,64*1024);this.#webhooks+=1;
  }
}

export class ExternalGitProviderAdapterV33_10 {
  readonly #manifest: ExternalGitAdapterManifestV33_10;
  readonly #credentialBroker: EphemeralGitCredentialBrokerV33_10;
  readonly #proposalKeys: KeyRegistry;
  readonly #trustedProposalSignerIds: readonly string[];
  readonly #webhookReceiver: ExternalGitWebhookReceiverV33_10;
  readonly #receiptSigner: SigningIdentity;

  constructor(input:{readonly manifest:ExternalGitAdapterManifestV33_10;readonly credentialBroker:EphemeralGitCredentialBrokerV33_10;readonly proposalKeys:KeyRegistry;readonly trustedProposalSignerIds:readonly string[];readonly webhookReceiver:ExternalGitWebhookReceiverV33_10;readonly receiptSigner:SigningIdentity}){
    verifyManifest(input.manifest);this.#manifest=input.manifest;this.#credentialBroker=input.credentialBroker;this.#proposalKeys=input.proposalKeys;this.#trustedProposalSignerIds=[...input.trustedProposalSignerIds];this.#webhookReceiver=input.webhookReceiver;this.#receiptSigner=input.receiptSigner;
  }

  async submit(bundle:QualifiedChangeBundleV33_10,now=new Date()):Promise<SignedEnvelope<ExternalDraftProposalReceiptV33_10>>{
    validDate(now);this.#verifyBundle(bundle,now);
    const credential=this.#credentialBroker.resolve({credentialRef:this.#manifest.credentialRef,provider:this.#manifest.provider,tenantId:bundle.tenantId,repositoryRef:this.#manifest.repositoryRef,requiredScopes:this.#manifest.requiredCredentialScopes,at:now});
    const trace:{method:string;path:string;requestDigest:string;responseDigest:string}[]=[];
    const api=new ProviderApiClient(this.#manifest,credential.token,bundle.idempotencyKey,trace);
    const branch=await api.get(this.#branchPath());
    if(branch.protected!==true)throw new ExternalGitPermanentErrorV33_10('external_git_target_branch_unprotected');
    let commitSha:string;let object:Record<string,unknown>;
    if(this.#manifest.provider==='GITHUB'){
      const blobs: {path:string;sha:string}[]=[];
      for(const file of bundle.files){const response=await api.post(`/repos/${this.#manifest.repositoryRef}/git/blobs`,{content:file.contentBase64,encoding:'base64'},`blob:${file.path}`);blobs.push({path:file.path,sha:stringField(response,'sha','github_blob_sha_invalid')});}
      const tree=await api.post(`/repos/${this.#manifest.repositoryRef}/git/trees`,{base_tree:bundle.proposal.payload.baseCommit,tree:blobs.map((row)=>({path:row.path,mode:'100644',type:'blob',sha:row.sha}))},'tree');
      const commit=await api.post(`/repos/${this.#manifest.repositoryRef}/git/commits`,{message:bundle.commitMessage,tree:stringField(tree,'sha','github_tree_sha_invalid'),parents:[bundle.proposal.payload.baseCommit]},'commit');commitSha=stringField(commit,'sha','github_commit_sha_invalid');
      await api.post(`/repos/${this.#manifest.repositoryRef}/git/refs`,{ref:`refs/heads/${bundle.proposal.payload.proposedHeadRef}`,sha:commitSha},'ref');
      object=await api.post(`/repos/${this.#manifest.repositoryRef}/pulls`,{title:bundle.proposal.payload.title,body:`Evidence root: ${bundle.proposal.payload.evidenceRoot}`,head:bundle.proposal.payload.proposedHeadRef,base:this.#manifest.targetBranch,draft:true},'draft');
      if(object.draft!==true||object.state!=='open')throw new ExternalGitPermanentErrorV33_10('github_draft_response_invalid');
    }else{
      const commit=await api.post(`/api/v4/projects/${encodeURIComponent(this.#manifest.repositoryRef)}/repository/commits`,{branch:bundle.proposal.payload.proposedHeadRef,start_sha:bundle.proposal.payload.baseCommit,commit_message:bundle.commitMessage,actions:bundle.files.map((file)=>({action:'update',file_path:file.path,content:file.contentBase64,encoding:'base64'}))},'commit');commitSha=stringField(commit,'id','gitlab_commit_sha_invalid');
      object=await api.post(`/api/v4/projects/${encodeURIComponent(this.#manifest.repositoryRef)}/merge_requests`,{source_branch:bundle.proposal.payload.proposedHeadRef,target_branch:this.#manifest.targetBranch,title:`Draft: ${bundle.proposal.payload.title}`,description:`Evidence root: ${bundle.proposal.payload.evidenceRoot}`,remove_source_branch:false,squash:false},'draft');
      if(object.draft!==true||object.state!=='opened')throw new ExternalGitPermanentErrorV33_10('gitlab_draft_response_invalid');
    }
    const deliveryId=stringField(object,'webhook_delivery_id','external_git_webhook_delivery_missing');
    const webhook=await waitForWebhook(this.#webhookReceiver,deliveryId,1000);
    if(webhook.provider!==this.#manifest.provider||webhook.repositoryRef!==this.#manifest.repositoryRef||webhook.headRef!==bundle.proposal.payload.proposedHeadRef||webhook.targetBranch!==this.#manifest.targetBranch||webhook.draft!==true)throw new ExternalGitPermanentErrorV33_10('external_git_webhook_binding_invalid');
    const providerObjectId=this.#manifest.provider==='GITHUB'?String(numberField(object,'number','github_pr_number_invalid')):String(numberField(object,'iid','gitlab_mr_iid_invalid'));
    const providerObjectUrl=optionalStringField(object,'html_url')??stringField(object,'web_url','provider_object_url_invalid');
    const material={version:'33.10' as const,receiptId:`external-git-receipt-${bundle.bundleId}`,adapterId:this.#manifest.adapterId,provider:this.#manifest.provider,tenantId:bundle.tenantId,bundleId:bundle.bundleId,proposalId:bundle.proposal.payload.proposalId,repositoryRef:this.#manifest.repositoryRef,targetBranch:this.#manifest.targetBranch,headRef:bundle.proposal.payload.proposedHeadRef,commitSha,providerObjectId,providerObjectUrl,draft:true as const,branchProtectionObserved:true as const,providerWebhookDeliveryId:deliveryId,providerWebhookDigest:webhook.webhookDigest,credentialRef:credential.descriptor.credentialRef,credentialSubjectId:credential.descriptor.subjectId,requestTraceDigest:sha256(trace),acceptedAt:now.toISOString(),evidenceClass:'LOCAL_EXTERNAL_GIT_PROVIDER_QUALIFICATION' as const,localProviderMutationExecuted:true as const,externalGitMutationExecuted:false as const,realPullRequestCreated:false as const,mergeExecuted:false as const,deploymentExecuted:false as const,externalEffectsExecuted:0 as const,g4Eligible:false as const};
    return signEnvelope({...material,receiptDigest:sha256(material)},this.#receiptSigner);
  }

  #branchPath():string{return this.#manifest.provider==='GITHUB'?`/repos/${this.#manifest.repositoryRef}/branches/${encodeURIComponent(this.#manifest.targetBranch)}`:`/api/v4/projects/${encodeURIComponent(this.#manifest.repositoryRef)}/repository/branches/${encodeURIComponent(this.#manifest.targetBranch)}`;}
  #verifyBundle(bundle:QualifiedChangeBundleV33_10,now:Date):void{
    const {bundleDigest,...material}=bundle;if(sha256(material)!==bundleDigest)throw new Error('external_git_bundle_digest_invalid');
    if(bundle.tenantId!==bundle.proposal.payload.tenantId)throw new Error('external_git_bundle_tenant_mismatch');
    if(bundle.targetBranch!==this.#manifest.targetBranch)throw new Error('external_git_target_branch_mismatch');
    if(!verifyPullRequestProposalV33_9({envelope:bundle.proposal,proposalKeys:this.#proposalKeys,trustedProposalSignerIds:this.#trustedProposalSignerIds,at:now}))throw new Error('external_git_proposal_invalid');
    if(!bundle.proposal.payload.proposedHeadRef.startsWith(this.#manifest.allowedHeadPrefix))throw new Error('external_git_head_prefix_invalid');
    validateBranch(bundle.proposal.payload.proposedHeadRef,'external_git_head_branch_invalid');
    if(bundle.files.length!==bundle.proposal.payload.changedFiles.length||bundle.files.length<2||bundle.files.length>8)throw new Error('external_git_file_count_invalid');
    const byPath=new Map(bundle.proposal.payload.fileDigests.map((row)=>[row.targetFile,row.afterDigest]));
    const seen=new Set<string>();
    for(const file of bundle.files){validateRelativePath(file.path);if(seen.has(file.path))throw new Error('external_git_duplicate_file');seen.add(file.path);if(!bundle.proposal.payload.changedFiles.includes(file.path))throw new Error('external_git_file_not_proposed');const bytes=decodeBase64Strict(file.contentBase64);if(bytes.length>512*1024)throw new Error('external_git_file_too_large');if(sha256Bytes(bytes)!==file.contentSha256||byPath.get(file.path)!==file.contentSha256)throw new Error('external_git_file_digest_invalid');}
    if(sha256([...seen].sort())!==sha256([...bundle.proposal.payload.changedFiles].sort()))throw new Error('external_git_changed_file_set_invalid');
    if(bundle.productionCeiling!=='shadow'||bundle.mergeExecuted||bundle.deploymentExecuted||bundle.externalEffectsExecuted!==0)throw new Error('external_git_bundle_boundary_invalid');
  }
}

class ProviderApiClient {
  readonly #manifest:ExternalGitAdapterManifestV33_10;readonly #token:string;readonly #baseKey:string;readonly #trace:{method:string;path:string;requestDigest:string;responseDigest:string}[];
  constructor(manifest:ExternalGitAdapterManifestV33_10,token:string,baseKey:string,trace:{method:string;path:string;requestDigest:string;responseDigest:string}[]){this.#manifest=manifest;this.#token=token;this.#baseKey=baseKey;this.#trace=trace;}
  async get(path:string):Promise<Record<string,unknown>>{return this.#send('GET',path,undefined,`get:${path}`);}
  async post(path:string,body:Record<string,unknown>,operation:string):Promise<Record<string,unknown>>{return this.#send('POST',path,body,operation);}
  async #send(method:'GET'|'POST',path:string,body:Record<string,unknown>|undefined,operation:string):Promise<Record<string,unknown>>{
    const url=new URL(path,this.#manifest.apiBaseUrl);if(url.origin!==new URL(this.#manifest.apiBaseUrl).origin)throw new ExternalGitPermanentErrorV33_10('external_git_origin_escape');
    const raw=body===undefined?Buffer.alloc(0):Buffer.from(JSON.stringify(body));if(raw.length>this.#manifest.maximumRequestBytes)throw new ExternalGitPermanentErrorV33_10('external_git_request_too_large');
    const headers:Record<string,string>={'accept':'application/json','x-sovereign-idempotency-key':`${this.#baseKey}:${sha256(operation).slice(0,16)}`};
    if(method==='POST'){headers['content-type']='application/json';headers['content-length']=String(raw.length);}
    if(this.#manifest.provider==='GITHUB'){headers.authorization=`Bearer ${this.#token}`;headers['x-github-api-version']='2026-03-10';headers['user-agent']='sovereign-v33.10-qualification';}else headers['private-token']=this.#token;
    let response:HttpResult;try{response=await sendRaw(url,raw,headers,this.#manifest.requestTimeoutMs,this.#manifest.maximumResponseBytes,method);}catch(error){if(error instanceof ExternalGitPermanentErrorV33_10)throw error;throw new ExternalGitTransientErrorV33_10(errorCode(error));}
    if(response.status>=300&&response.status<400)throw new ExternalGitPermanentErrorV33_10('external_git_redirect_forbidden');
    if(response.status>=500)throw new ExternalGitTransientErrorV33_10(`external_git_http_${response.status}`);
    if(response.status<200||response.status>=300)throw new ExternalGitPermanentErrorV33_10(`external_git_http_${response.status}`);
    let parsed:Record<string,unknown>;try{parsed=parseJson(response.body);}catch{throw new ExternalGitPermanentErrorV33_10('external_git_response_json_invalid');}
    this.#trace.push({method,path,requestDigest:sha256(body??{}),responseDigest:sha256(parsed)});return parsed;
  }
}

export function verifyExternalDraftProposalReceiptV33_10(input:{readonly envelope:SignedEnvelope<ExternalDraftProposalReceiptV33_10>;readonly keys:KeyRegistry;readonly trustedSignerIds:readonly string[];readonly at?:Date}):boolean{
  const at=input.at??new Date();validDate(at);if(!input.trustedSignerIds.includes(input.envelope.issuerKeyId)||!input.keys.verifyAt(input.envelope,at))return false;
  const r=input.envelope.payload;const{receiptDigest,...material}=r;if(sha256(material)!==receiptDigest)return false;
  return r.draft&&r.branchProtectionObserved&&r.evidenceClass==='LOCAL_EXTERNAL_GIT_PROVIDER_QUALIFICATION'&&r.localProviderMutationExecuted&&r.externalGitMutationExecuted===false&&r.realPullRequestCreated===false&&r.mergeExecuted===false&&r.deploymentExecuted===false&&r.externalEffectsExecuted===0&&r.g4Eligible===false;
}

interface HttpResult{readonly status:number;readonly headers:Readonly<Record<string,string|string[]|undefined>>;readonly body:Buffer;}
async function sendRaw(url:URL,body:Buffer,headers:Record<string,string>,timeoutMs:number,maxBytes:number,method='POST'):Promise<HttpResult>{
  if(url.hostname!=='127.0.0.1'&&url.hostname!=='localhost')throw new ExternalGitPermanentErrorV33_10('external_git_non_loopback_forbidden');
  return new Promise((resolvePromise,reject)=>{const req=httpRequest(url,{method,headers},(res)=>{const chunks:Buffer[]=[];let size=0;res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>maxBytes){req.destroy(new ExternalGitPermanentErrorV33_10('external_git_response_too_large'));return;}chunks.push(chunk);});res.on('end',()=>resolvePromise({status:res.statusCode??0,headers:res.headers,body:Buffer.concat(chunks)}));});req.setTimeout(timeoutMs,()=>req.destroy(new ExternalGitTransientErrorV33_10('external_git_request_timeout')));req.on('error',reject);if(body.length>0)req.write(body);req.end();});
}
async function readRawBody(req:IncomingMessage,max:number):Promise<Buffer>{const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=b.length;if(size>max)throw new Error('external_git_body_too_large');chunks.push(b);}return Buffer.concat(chunks);}
function parseJson(raw:Buffer):Record<string,unknown>{const value=JSON.parse(raw.toString('utf8')) as unknown;if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error('external_git_json_object_required');return value as Record<string,unknown>;}
function respond(res:ServerResponse,status:number,body:unknown):void{const raw=Buffer.from(JSON.stringify(body));res.writeHead(status,{'content-type':'application/json','content-length':String(raw.length)});res.end(raw);}
function header(req:IncomingMessage,name:string):string{const value=req.headers[name.toLowerCase()];if(Array.isArray(value))return value[0]??'';return value??'';}
function verifyGitHubHmac(secret:string,body:Buffer,received:string):void{const expected=`sha256=${createHmac('sha256',secret).update(body).digest('hex')}`;if(!safeEqual(received,expected))throw new Error('github_webhook_signature_invalid');}
function verifyGitLabStandardWebhook(token:string,id:string,timestamp:string,body:Buffer,received:string):void{const key=decodeGitLabSigningToken(token);const expected=`v1,${createHmac('sha256',key).update(`${id}.${timestamp}.${body.toString('utf8')}`).digest('base64')}`;const matches=received.split(' ').some((candidate)=>safeEqual(candidate,expected));if(!matches)throw new Error('gitlab_webhook_signature_invalid');}
function decodeGitLabSigningToken(token:string):Buffer{if(!token.startsWith('whsec_'))throw new Error('gitlab_webhook_signing_token_invalid');const raw=Buffer.from(token.slice(6),'base64');if(raw.length<24)throw new Error('gitlab_webhook_signing_token_invalid');return raw;}
function safeEqual(a:string,b:string):boolean{const left=Buffer.from(a);const right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
function normalizeWebhook(provider:ExternalGitProviderV33_10,deliveryId:string,eventName:'pull_request'|'Merge Request Hook',body:Record<string,unknown>):ExternalGitWebhookEvidenceV33_10{
  let repositoryRef:string;let headRef:string;let targetBranch:string;let draft:boolean;let action:string;let providerObjectId:string;
  if(provider==='GITHUB'){
    const pr=objectField(body,'pull_request','github_webhook_pr_invalid');const repo=objectField(body,'repository','github_webhook_repo_invalid');repositoryRef=stringField(repo,'full_name','github_webhook_repo_invalid');headRef=stringField(objectField(pr,'head','github_webhook_head_invalid'),'ref','github_webhook_head_invalid');targetBranch=stringField(objectField(pr,'base','github_webhook_base_invalid'),'ref','github_webhook_base_invalid');draft=pr.draft===true;action=String(body.action??'');providerObjectId=String(numberField(pr,'number','github_webhook_number_invalid'));
  }else{
    const attrs=objectField(body,'object_attributes','gitlab_webhook_object_invalid');const project=objectField(body,'project','gitlab_webhook_project_invalid');repositoryRef=stringField(project,'path_with_namespace','gitlab_webhook_project_invalid');headRef=stringField(attrs,'source_branch','gitlab_webhook_source_invalid');targetBranch=stringField(attrs,'target_branch','gitlab_webhook_target_invalid');draft=attrs.draft===true;action=String(attrs.action??'')==='open'?'opened':String(attrs.action??'');providerObjectId=String(numberField(attrs,'iid','gitlab_webhook_iid_invalid'));
  }
  if(deliveryId.trim()===''||!draft||action!=='opened')throw new Error('external_git_webhook_boundary_invalid');
  const material={version:'33.10' as const,provider,deliveryId,eventName,repositoryRef,headRef,targetBranch,draft:true as const,action:'opened' as const,providerObjectId,receivedAt:new Date().toISOString(),bodySha256:sha256Bytes(Buffer.from(JSON.stringify(body))),signatureVerified:true as const};return{...material,webhookDigest:sha256(material)};
}
async function waitForWebhook(receiver:ExternalGitWebhookReceiverV33_10,deliveryId:string,timeoutMs:number):Promise<ExternalGitWebhookEvidenceV33_10>{const end=Date.now()+timeoutMs;while(Date.now()<end){const row=receiver.get(deliveryId);if(row!==undefined)return row;await new Promise((resolvePromise)=>setTimeout(resolvePromise,5));}throw new ExternalGitTransientErrorV33_10('external_git_webhook_timeout');}
function verifyManifest(manifest:ExternalGitAdapterManifestV33_10):void{const{manifestDigest,...material}=manifest;if(sha256(material)!==manifestDigest)throw new Error('external_git_manifest_digest_invalid');if(manifest.environment!=='LOCAL_PROVIDER_QUALIFICATION'||!manifest.draftOnly||!manifest.branchProtectionRequired||manifest.allowRedirects||manifest.mergeAllowed||manifest.deploymentAllowed||manifest.externalEffectsExecuted!==0)throw new Error('external_git_manifest_boundary_invalid');validateLoopbackBaseUrl(manifest.apiBaseUrl);validateLoopbackWebhookUrl(manifest.webhookUrl);}
function validateLoopbackBaseUrl(value:string):string{const url=new URL(value);if(url.protocol!=='http:'||(url.hostname!=='127.0.0.1'&&url.hostname!=='localhost')||url.username!==''||url.password!==''||url.search!==''||url.hash!=='')throw new Error('external_git_api_not_local_qualified');url.pathname=url.pathname.replace(/\/$/,'');return url.toString().replace(/\/$/,'');}
function validateLoopbackWebhookUrl(value:string):string{const url=new URL(value);if(url.protocol!=='http:'||(url.hostname!=='127.0.0.1'&&url.hostname!=='localhost')||url.pathname!=='/v1/git-provider-webhook'||url.username!==''||url.password!==''||url.search!==''||url.hash!=='')throw new Error('external_git_webhook_not_local_qualified');return url.toString();}
function validateRepositoryRef(provider:ExternalGitProviderV33_10,value:string):void{const v=required(value,'external_git_repository_required');if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v))throw new Error(provider==='GITHUB'?'github_repository_ref_invalid':'gitlab_project_ref_invalid');}
function validateBranch(value:string,code:string):void{if(value.trim()===''||value.length>160||value.startsWith('/')||value.endsWith('/')||value.includes('..')||value.includes('\\')||/[~^:?*\[\]\s]/.test(value))throw new Error(code);}
function validateRelativePath(path:string):void{if(path.trim()===''||path.startsWith('/')||path.includes('\0')||path.includes('\\')||path.split('/').includes('..'))throw new Error('external_git_file_path_invalid');}
function decodeBase64Strict(value:string):Buffer{if(value.trim()===''||!/^[A-Za-z0-9+/]*={0,2}$/.test(value)||value.length%4!==0)throw new Error('external_git_content_base64_invalid');const bytes=Buffer.from(value,'base64');if(bytes.toString('base64')!==value)throw new Error('external_git_content_base64_invalid');return bytes;}
function uniqueNonEmpty(values:readonly string[],code:string):readonly string[]{const normalized=values.map((value)=>required(value,code));if(new Set(normalized).size!==normalized.length)throw new Error(code);return [...normalized].sort();}
function required(value:string,code:string):string{if(value.trim()==='')throw new Error(code);return value;}
function positiveInt(value:number,code:string):number{if(!Number.isInteger(value)||value<=0)throw new Error(code);return value;}
function parseIso(value:string,code:string):number{const parsed=Date.parse(value);if(!Number.isFinite(parsed)||new Date(parsed).toISOString()!==value)throw new Error(code);return parsed;}
function validDate(value:Date):void{if(Number.isNaN(value.getTime()))throw new Error('invalid_date');}
function objectField(value:Record<string,unknown>,key:string,code:string):Record<string,unknown>{const field=value[key];if(field===null||typeof field!=='object'||Array.isArray(field))throw new Error(code);return field as Record<string,unknown>;}
function stringField(value:Record<string,unknown>,key:string,code='external_git_string_field_invalid'):string{const field=value[key];if(typeof field!=='string'||field.trim()==='')throw new Error(code);return field;}
function optionalStringField(value:Record<string,unknown>,key:string):string|undefined{const field=value[key];if(field===undefined)return undefined;if(typeof field!=='string'||field.trim()==='')throw new Error('external_git_string_field_invalid');return field;}
function numberField(value:Record<string,unknown>,key:string,code:string):number{const field=value[key];if(!Number.isInteger(field)||Number(field)<=0)throw new Error(code);return Number(field);}
function errorCode(error:unknown):string{return error instanceof Error?error.message:String(error);}
