import { sha256, signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';
import type { GovernedDeliberationRequest, GovernedDeliberationPacket } from '../ai/governed-deliberation.js';
import { GovernedDeliberationRunner } from '../ai/governed-deliberation.js';
import type { CampaignPolicy, GovernedEngineeringCampaign } from '../product/engineering-campaign.js';
import { GovernedEngineeringCampaignPlanner } from '../product/engineering-campaign.js';
import { OperationalActionLedger } from '../operations/action-ledger.js';
import type { OperationalAction } from '../operations/operator-action-center.js';

export interface GovernedProductCompletionRequest {
  readonly requestId: string;
  readonly campaignId: string;
  readonly deliberation: GovernedDeliberationRequest;
  readonly campaignPolicy: CampaignPolicy;
}

export interface ProductCompletionTraceLink {
  readonly from: string;
  readonly relation: 'PRODUCED' | 'PRIORITIZED' | 'DEPENDS_ON' | 'REQUIRES_PROOF' | 'REQUIRES_REVIEW';
  readonly to: string;
}

export interface GovernedProductCompletionBundle {
  readonly bundleId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly deliberation: SignedEnvelope<GovernedDeliberationPacket>;
  readonly campaign: SignedEnvelope<GovernedEngineeringCampaign>;
  readonly actionLedger: ReturnType<OperationalActionLedger['snapshot']>;
  readonly traceability: readonly ProductCompletionTraceLink[];
  readonly metrics: {
    readonly perspectivesUsed: number;
    readonly modelOutputChars: number;
    readonly claimsSupported: number;
    readonly claimsUnsupported: number;
    readonly contradictions: number;
    readonly workNodesConsidered: number;
    readonly campaignItemsSelected: number;
    readonly campaignItemsExcluded: number;
    readonly proofKindsCovered: number;
    readonly modelCallsReusableAfterRestart: number;
    readonly externalInteractionsExecuted: number;
    readonly externalMutationsExecuted: 0;
    /** @deprecated Compatibility alias meaning external mutations only. */
    readonly externalEffectsExecuted: 0;
  };
  readonly executionState: 'REVIEW_REQUIRED';
  readonly promotionCeiling: 'research';
  readonly generatedAt: string;
  readonly limitations: readonly string[];
  readonly bundleDigest: string;
}

export class GovernedProductCompletionCoordinator {
  constructor(
    readonly deliberationRunner: GovernedDeliberationRunner,
    readonly campaignPlanner: GovernedEngineeringCampaignPlanner,
    readonly signer: SigningIdentity,
  ) {}

  async prepare(request: GovernedProductCompletionRequest, now = new Date()): Promise<SignedEnvelope<GovernedProductCompletionBundle>> {
    validateRequest(request, now);
    const deliberation = await this.deliberationRunner.run(request.deliberation, now);
    if (!this.deliberationRunner.council.keyRegistry.verify(deliberation)) throw new Error('product_completion_deliberation_signature_invalid');
    const campaign = this.campaignPlanner.plan({ campaignId: request.campaignId, deliberation, policy: request.campaignPolicy, generatedAt: now.toISOString() });
    if (!this.campaignPlanner.keyRegistry.verify(campaign)) throw new Error('product_completion_campaign_signature_invalid');
    if (deliberation.payload.tenantId !== campaign.payload.tenantId || deliberation.payload.subjectId !== campaign.payload.subjectId) throw new Error('product_completion_identity_mismatch');
    const actions = campaign.payload.items.map(toOperationalAction);
    const ledger = new OperationalActionLedger(actions, now.toISOString());
    const traceability = buildTraceability(deliberation.payload, campaign.payload);
    const metrics = {
      perspectivesUsed: deliberation.payload.perspectiveCount,
      modelOutputChars: deliberation.payload.aggregateUsage.outputChars,
      claimsSupported: deliberation.payload.supportedClaims.length,
      claimsUnsupported: deliberation.payload.unsupportedClaims.length,
      contradictions: deliberation.payload.conflicts.length,
      workNodesConsidered: deliberation.payload.workNodes.length,
      campaignItemsSelected: campaign.payload.items.length,
      campaignItemsExcluded: campaign.payload.excluded.length,
      proofKindsCovered: campaign.payload.proofCoverage.length,
      modelCallsReusableAfterRestart: deliberation.payload.perspectiveCount,
      externalInteractionsExecuted: deliberation.payload.externalInteractionsExecuted,
      externalMutationsExecuted: 0 as const,
      externalEffectsExecuted: 0 as const,
    };
    const limitations = [
      'advanced-model-capability-is-used-for-bounded-perspectives-not-autonomous-authority',
      'campaign-priority-scores-are-deterministic-planning-signals-not-human-value-measurements',
      'all-change-and-test-work-remains-subject-to-independent-review',
      'no-external-mutation-is-executed-by-product-completion-coordinator',
      'external-model-interactions-are-counted-not-hidden',
      'human-pilot-and-external-runtime-qualification-remain-required',
    ];
    const material = {
      bundleId: `product-completion:${sha256({ requestId: request.requestId, campaignDigest: campaign.payload.campaignDigest }).slice(0, 24)}`,
      requestId: request.requestId,
      tenantId: campaign.payload.tenantId,
      subjectId: campaign.payload.subjectId,
      deliberation: structuredClone(deliberation),
      campaign: structuredClone(campaign),
      actionLedger: ledger.snapshot(now),
      traceability,
      metrics,
      executionState: 'REVIEW_REQUIRED' as const,
      promotionCeiling: 'research' as const,
      generatedAt: now.toISOString(),
      limitations,
    };
    const bundle: GovernedProductCompletionBundle = { ...material, bundleDigest: sha256(material) };
    return signEnvelope(bundle, this.signer);
  }
}

function toOperationalAction(item: GovernedEngineeringCampaign['items'][number]): OperationalAction {
  const priority: 1 | 2 | 3 | 4 = item.scores.total >= 55 ? 1 : item.scores.total >= 40 ? 2 : item.scores.total >= 25 ? 3 : 4;
  const category: OperationalAction['category'] = item.kind === 'TEST_PROPOSAL' ? 'verify' : item.kind === 'CHANGE_PROPOSAL' ? 'repair' : item.kind === 'OPERATIONAL_RECOMMENDATION' ? 'monitor' : 'verify';
  return {
    id: item.itemId,
    priority,
    category,
    title: item.summary,
    why: `Selected by governed campaign scoring (${item.scores.total}) with explicit proof and stop conditions.`,
    owner: item.role.toLowerCase(),
    completionEvidence: `Evidence must satisfy ${item.proofObligations.join(',')} and independent review before ${item.itemId} can close.`,
  };
}

function buildTraceability(deliberation: GovernedDeliberationPacket, campaign: GovernedEngineeringCampaign): ProductCompletionTraceLink[] {
  const links: ProductCompletionTraceLink[] = [{ from: `deliberation:${deliberation.packetId}`, relation: 'PRODUCED', to: `campaign:${campaign.campaignId}` }];
  for (const item of campaign.items) {
    links.push({ from: `work:${item.sourceNodeId}`, relation: 'PRIORITIZED', to: `campaign-item:${item.itemId}` });
    links.push({ from: `campaign-item:${item.itemId}`, relation: 'REQUIRES_REVIEW', to: 'review:independent' });
    for (const dependency of item.dependencies) links.push({ from: `campaign-item:${item.itemId}`, relation: 'DEPENDS_ON', to: `work:${dependency}` });
    for (const proof of item.proofObligations) links.push({ from: `campaign-item:${item.itemId}`, relation: 'REQUIRES_PROOF', to: `proof:${proof}` });
  }
  return links.sort((a, b) => `${a.from}:${a.relation}:${a.to}`.localeCompare(`${b.from}:${b.relation}:${b.to}`));
}

function validateRequest(request: GovernedProductCompletionRequest, now: Date): void {
  if (request.requestId.trim() === '' || request.campaignId.trim() === '') throw new Error('product_completion_request_required');
  if (request.requestId !== request.deliberation.deliberationId) throw new Error('product_completion_request_binding_mismatch');
  if (!Number.isFinite(now.getTime())) throw new Error('product_completion_time_invalid');
}
