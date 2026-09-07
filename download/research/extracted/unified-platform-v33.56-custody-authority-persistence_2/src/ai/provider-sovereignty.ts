import { KeyRegistry, sha256, type SignedEnvelope } from '../contracts/crypto.js';
import type { ProviderAuthorizer } from '../contracts/provider.js';
import type { ReplayLedger } from '../contracts/replay.js';
import type { GovernedModelAdapter, ModelAdapterInput, ModelAdapterOutput, ProviderBoundaryProof } from './governed-model-orchestrator.js';

export interface ProviderExecutionAttestation {
  readonly attestationId: string;
  readonly nonce: string;
  readonly providerId: string;
  readonly providerKeyId: string;
  readonly model: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly requestDigest: string;
  readonly inputDigest: string;
  readonly policyDigest: string;
  readonly outputDigest: string;
  readonly semanticOutputDigest: string;
  readonly disclosureDigest: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly issuedAt: string;
}
export type SignedProviderExecutionAttestation = SignedEnvelope<ProviderExecutionAttestation>;


export interface ProviderEgressPolicy {
  readonly allowedContextSources: readonly string[];
  readonly allowUntrustedContext: boolean;
  readonly maxDisclosedChars: number;
  readonly secretHandling: 'REJECT_DETECTED_SECRETS';
}

export interface AttestedProviderResponse {
  readonly output: ModelAdapterOutput;
  readonly attestation: SignedProviderExecutionAttestation;
}
export interface AttestedProviderAdapter {
  invokeAttested(input: ModelAdapterInput): Promise<AttestedProviderResponse>;
}

export interface VerifiedProviderExecution extends ProviderBoundaryProof {
  readonly credentialDigest: string;
  readonly attestationDigest: string;
  readonly replayKeyDigest: string;
  readonly providerId: string;
  readonly model: string;
  readonly verifiedAt: string;
  readonly status: 'VERIFIED_PROVIDER_ATTESTATION';
  readonly limitation: 'provider-attestation-proves-binding-not-model-correctness';
}

export class SovereignAttestedProviderBoundary implements GovernedModelAdapter {
  #lastVerification?: VerifiedProviderExecution;
  constructor(
    readonly keyRegistry: KeyRegistry,
    readonly providerTrust: ProviderAuthorizer,
    readonly replayLedger: ReplayLedger,
    readonly provider: AttestedProviderAdapter,
    readonly egressPolicy: ProviderEgressPolicy,
    readonly clock: () => Date = () => new Date(),
  ) {}

  async invoke(input: ModelAdapterInput): Promise<ModelAdapterOutput> {
    const disclosureDigest = providerDisclosureDigest(input, this.egressPolicy);
    const response = await this.provider.invokeAttested(structuredClone(input));
    const verified = this.verify(input, response, disclosureDigest, this.clock());
    this.#lastVerification = verified;
    return {
      ...structuredClone(response.output),
      limitations: [...new Set([...response.output.limitations, 'provider-attestation-verified', verified.limitation])].sort(),
      providerBoundaryProof: verified,
    };
  }

  validatePersistedReceipt(receipt: import('./governed-model-orchestrator.js').GovernedModelReceipt, at: Date): void {
    const proof = receipt.providerBoundaryProof;
    if (proof === undefined) throw new Error('provider_replay_proof_required');
    if (!Number.isFinite(at.getTime())) throw new Error('provider_boundary_time_invalid');
    const attestation = proof.signedAttestation as SignedProviderExecutionAttestation;
    if (!this.keyRegistry.verify(attestation)) throw new Error('provider_replay_attestation_signature_invalid');
    if (sha256(attestation) !== proof.attestationDigest) throw new Error('provider_replay_attestation_digest_mismatch');
    const payload = attestation.payload;
    if (payload.providerId !== receipt.provider || payload.model !== receipt.model || payload.requestDigest !== receipt.requestDigest) throw new Error('provider_replay_receipt_binding_invalid');
    if (payload.semanticOutputDigest !== sha256({ output: receipt.output, claims: receipt.claims, workGraph: receipt.workGraph })) throw new Error('provider_replay_semantic_output_mismatch');
    const authorization = this.providerTrust.authorize({ providerId: payload.providerId, providerKeyId: payload.providerKeyId, model: payload.model, tenantId: receipt.tenantId, at: at.toISOString() });
    if (authorization.credentialDigest !== proof.credentialDigest) throw new Error('provider_replay_credential_binding_invalid');
  }

  lastVerification(): VerifiedProviderExecution | undefined {
    return this.#lastVerification === undefined ? undefined : structuredClone(this.#lastVerification);
  }

  verify(input: ModelAdapterInput, response: AttestedProviderResponse, disclosureDigest: string, now: Date): VerifiedProviderExecution {
    if (!Number.isFinite(now.getTime())) throw new Error('provider_boundary_time_invalid');
    if (!this.keyRegistry.verify(response.attestation)) throw new Error('provider_attestation_signature_invalid');
    const payload = response.attestation.payload;
    if (payload.providerKeyId !== response.attestation.issuerKeyId) throw new Error('provider_attestation_issuer_mismatch');
    for (const value of [payload.attestationId, payload.nonce, payload.providerId, payload.providerKeyId, payload.model, payload.tenantId, payload.subjectId]) if (value.trim() === '') throw new Error('provider_attestation_identity_invalid');
    const startedAt = Date.parse(payload.startedAt); const finishedAt = Date.parse(payload.finishedAt); const issuedAt = Date.parse(payload.issuedAt);
    if (![startedAt, finishedAt, issuedAt].every(Number.isFinite) || finishedAt < startedAt || issuedAt < finishedAt || issuedAt > now.getTime() + 300_000) throw new Error('provider_attestation_time_invalid');
    const authorization = this.providerTrust.authorize({ providerId: payload.providerId, providerKeyId: payload.providerKeyId, model: payload.model, tenantId: payload.tenantId, at: payload.issuedAt });
    if (payload.providerId !== response.output.provider || payload.model !== response.output.model) throw new Error('provider_output_identity_mismatch');
    if (payload.tenantId !== input.tenantId || payload.subjectId !== input.subjectId || payload.requestDigest !== input.requestDigest) throw new Error('provider_request_binding_invalid');
    if (payload.inputDigest !== sha256(input)) throw new Error('provider_input_digest_mismatch');
    const policyDigest = sha256({ purpose: input.purpose, allowedTools: [...input.allowedTools].sort(), budget: input.budget });
    if (payload.policyDigest !== policyDigest) throw new Error('provider_policy_digest_mismatch');
    if (payload.outputDigest !== sha256(response.output)) throw new Error('provider_output_digest_mismatch');
    if (payload.semanticOutputDigest !== sha256({ output: response.output.output, claims: response.output.claims, workGraph: response.output.workGraph })) throw new Error('provider_semantic_output_digest_mismatch');
    if (payload.disclosureDigest !== disclosureDigest) throw new Error('provider_disclosure_digest_mismatch');
    const replayKey = `provider-attestation:${payload.providerId}:${payload.nonce}`;
    const attestationDigest = sha256(response.attestation);
    if (!this.replayLedger.tryConsume({ replayKey, tenantId: input.tenantId, subjectId: input.subjectId, evidenceRoot: attestationDigest, consumedAt: now.toISOString(), consumerId: 'sovereign-provider-boundary' })) throw new Error('provider_attestation_replay');
    return {
      credentialDigest: authorization.credentialDigest,
      attestationDigest,
      replayKeyDigest: sha256({ replayKey }),
      disclosureDigest,
      externalInteractionsExecuted: 1,
      externalMutationsExecuted: 0,
      providerId: payload.providerId,
      model: payload.model,
      verifiedAt: now.toISOString(),
      status: 'VERIFIED_PROVIDER_ATTESTATION',
      limitation: 'provider-attestation-proves-binding-not-model-correctness',
      signedAttestation: structuredClone(response.attestation) as SignedEnvelope<unknown>,
    };
  }
}


export function providerDisclosureDigest(input: ModelAdapterInput, policy: ProviderEgressPolicy): string {
  if (!Number.isInteger(policy.maxDisclosedChars) || policy.maxDisclosedChars < 0 || policy.allowedContextSources.length === 0 || new Set(policy.allowedContextSources).size !== policy.allowedContextSources.length || policy.allowedContextSources.some((source) => source.trim() === '') || policy.secretHandling !== 'REJECT_DETECTED_SECRETS') throw new Error('provider_egress_policy_invalid');
  const disclosedChars = input.objective.length + input.context.reduce((sum, item) => sum + item.content.length, 0);
  if (disclosedChars > policy.maxDisclosedChars) throw new Error('provider_egress_budget_exceeded');
  for (const item of input.context) {
    if (!policy.allowedContextSources.includes(item.source)) throw new Error('provider_egress_source_not_allowed');
    if (item.trust === 'UNTRUSTED' && !policy.allowUntrustedContext) throw new Error('provider_egress_untrusted_context_denied');
    if (looksLikeSecret(item.content)) throw new Error('provider_egress_secret_detected');
  }
  if (looksLikeSecret(input.objective)) throw new Error('provider_egress_secret_detected');
  return sha256({
    tenantId: input.tenantId,
    subjectId: input.subjectId,
    objectiveDigest: sha256(input.objective),
    context: input.context.map((item) => ({ contextId: item.contextId, source: item.source, trust: item.trust, contentDigest: sha256(item.content) })),
    disclosedChars,
    policy,
  });
}
function looksLikeSecret(value: string): boolean {
  return /(-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|password|secret|token)\s*[:=]\s*[^\s]{6,}|AKIA[0-9A-Z]{16})/i.test(value);
}
