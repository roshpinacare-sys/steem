import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { KeyRegistry, sha256, signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';
import type { DeliberationRole, GovernedDeliberationPacket, NamespacedWorkNode } from '../ai/governed-deliberation.js';
import type { ReviewerAuthorizer, ReviewerRole } from '../contracts/reviewer.js';
import { withSovereignFileLease } from '../persistence/sovereign-file-lease.js';

export const CAMPAIGN_PROOF_KINDS = ['CODE', 'TEST', 'MUTATION', 'REVIEW', 'ROLLBACK', 'MONITOR', 'VALUE', 'RECOVERY'] as const;
export type CampaignProofKind = (typeof CAMPAIGN_PROOF_KINDS)[number];
export type CampaignItemStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'REJECTED';

export interface CampaignPolicy {
  readonly maxItems: number;
  readonly maxTotalEffort: number;
  readonly maxParallelism: number;
  readonly minimumScore: number;
  readonly requiredProofKinds: readonly CampaignProofKind[];
  readonly forbiddenTools: readonly string[];
}

export interface CampaignWorkItem {
  readonly itemId: string;
  readonly sourceNodeId: string;
  readonly role: DeliberationRole;
  readonly kind: NamespacedWorkNode['kind'];
  readonly summary: string;
  readonly requestedTool?: NamespacedWorkNode['requestedTool'];
  readonly dependencies: readonly string[];
  readonly scores: {
    readonly userValue: number;
    readonly riskReduction: number;
    readonly reuse: number;
    readonly evidenceUrgency: number;
    readonly effort: number;
    readonly complexity: number;
    readonly total: number;
  };
  readonly proofObligations: readonly CampaignProofKind[];
  readonly stopConditions: readonly string[];
  readonly reviewRequired: true;
  readonly state: 'PROPOSAL_ONLY';
}

export interface CampaignStage {
  readonly stage: number;
  readonly itemIds: readonly string[];
  readonly totalEffort: number;
}

export interface ExcludedCampaignItem {
  readonly sourceNodeId: string;
  readonly reason: 'BELOW_MINIMUM_SCORE' | 'EFFORT_BUDGET' | 'ITEM_LIMIT' | 'FORBIDDEN_TOOL' | 'DEPENDENCY_NOT_SELECTED';
}

export interface GovernedEngineeringCampaign {
  readonly campaignId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly requesterId: string;
  readonly deliberationPacketDigest: string;
  readonly planningInputDigest: string;
  readonly deliberationState: GovernedDeliberationPacket['synthesisState'];
  readonly items: readonly CampaignWorkItem[];
  readonly stages: readonly CampaignStage[];
  readonly excluded: readonly ExcludedCampaignItem[];
  readonly totalEffort: number;
  readonly aggregateScore: number;
  readonly proofCoverage: readonly CampaignProofKind[];
  readonly missingProofKinds: readonly CampaignProofKind[];
  readonly nextPermittedItemIds: readonly string[];
  readonly executionState: 'REVIEW_REQUIRED';
  readonly promotionCeiling: 'research';
  readonly externalInteractionsExecuted: number;
  readonly externalMutationsExecuted: 0;
  /** @deprecated Compatibility alias meaning external mutations only. */
  readonly externalEffectsExecuted: 0;
  readonly generatedAt: string;
  readonly limitations: readonly string[];
  readonly campaignDigest: string;
}

export interface CampaignResultAttestation {
  readonly campaignId: string;
  readonly itemId: string;
  readonly status: Exclude<CampaignItemStatus, 'PENDING'>;
  readonly evidenceDigest: string;
  readonly reviewerId: string;
  readonly reviewerRole: ReviewerRole;
  readonly reviewerOrganizationId: string;
  readonly reviewerCredentialDigest: string;
  readonly reviewedAt: string;
}

export interface CampaignItemResult {
  readonly resultId: string;
  readonly campaignId: string;
  readonly itemId: string;
  readonly status: Exclude<CampaignItemStatus, 'PENDING'>;
  readonly evidenceRefs: readonly string[];
  readonly reviewerAttestations: readonly SignedEnvelope<CampaignResultAttestation>[];
  readonly actualEffort: number;
  readonly completedAt: string;
  readonly limitations: readonly string[];
}

export interface CampaignSnapshot {
  readonly version: 1;
  readonly campaignDigest: string;
  readonly results: readonly CampaignItemResult[];
  readonly itemStates: Readonly<Record<string, CampaignItemStatus>>;
  readonly nextPermittedItemIds: readonly string[];
  readonly progressPercent: number;
  readonly campaignState: 'ACTIVE' | 'BLOCKED' | 'COMPLETED' | 'REVIEW_REQUIRED';
  readonly lastUpdatedAt: string;
  readonly digest: string;
}

export interface CampaignStore {
  getPlan(campaignId: string): SignedEnvelope<GovernedEngineeringCampaign> | undefined;
  putPlan(plan: SignedEnvelope<GovernedEngineeringCampaign>): void;
  getSnapshot(campaignId: string): CampaignSnapshot | undefined;
  putSnapshot(campaignId: string, snapshot: Omit<CampaignSnapshot, 'version' | 'digest'>): CampaignSnapshot;
  updateSnapshot(campaignId: string, update: (current: CampaignSnapshot | undefined) => Omit<CampaignSnapshot, 'version' | 'digest'>): CampaignSnapshot;
}

export class InMemoryCampaignStore implements CampaignStore {
  readonly #plans = new Map<string, SignedEnvelope<GovernedEngineeringCampaign>>();
  readonly #snapshots = new Map<string, CampaignSnapshot>();
  getPlan(campaignId: string): SignedEnvelope<GovernedEngineeringCampaign> | undefined { const row = this.#plans.get(campaignId); return row === undefined ? undefined : structuredClone(row); }
  putPlan(plan: SignedEnvelope<GovernedEngineeringCampaign>): void {
    const prior = this.#plans.get(plan.payload.campaignId);
    if (prior !== undefined && sha256(prior) !== sha256(plan)) throw new Error('campaign_plan_conflict');
    this.#plans.set(plan.payload.campaignId, structuredClone(plan));
  }
  getSnapshot(campaignId: string): CampaignSnapshot | undefined { const row = this.#snapshots.get(campaignId); return row === undefined ? undefined : structuredClone(row); }
  putSnapshot(campaignId: string, snapshot: Omit<CampaignSnapshot, 'version' | 'digest'>): CampaignSnapshot {
    const row = snapshotRecord(snapshot);
    const prior = this.#snapshots.get(campaignId);
    if (prior !== undefined && prior.digest === row.digest) return structuredClone(prior);
    this.#snapshots.set(campaignId, row);
    return structuredClone(row);
  }
  updateSnapshot(campaignId: string, update: (current: CampaignSnapshot | undefined) => Omit<CampaignSnapshot, 'version' | 'digest'>): CampaignSnapshot {
    return this.putSnapshot(campaignId, update(this.getSnapshot(campaignId)));
  }
}

export class FileCampaignStore implements CampaignStore {
  readonly #root: string;
  constructor(root: string) {
    if (root.trim() === '') throw new Error('campaign_store_root_required');
    this.#root = resolve(root);
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    fsyncDirectory(this.#root);
  }
  getPlan(campaignId: string): SignedEnvelope<GovernedEngineeringCampaign> | undefined {
    const path = this.#path('plan', campaignId);
    if (!existsSync(path)) return undefined;
    const plan = JSON.parse(readFileSync(path, 'utf8')) as SignedEnvelope<GovernedEngineeringCampaign>;
    verifyCampaign(plan.payload);
    if (plan.payload.campaignId !== campaignId) throw new Error('campaign_plan_key_mismatch');
    return structuredClone(plan);
  }
  putPlan(plan: SignedEnvelope<GovernedEngineeringCampaign>): void {
    verifyCampaign(plan.payload);
    withSovereignFileLease(this.#path('lock', `plan:${plan.payload.campaignId}`), () => {
      const path = this.#path('plan', plan.payload.campaignId);
      if (existsSync(path)) {
        const prior = this.getPlan(plan.payload.campaignId)!;
        if (sha256(prior) !== sha256(plan)) throw new Error('campaign_plan_conflict');
        return;
      }
      atomicReplace(path, `${JSON.stringify(plan, null, 2)}\n`);
      fsyncDirectory(this.#root);
    });
  }
  getSnapshot(campaignId: string): CampaignSnapshot | undefined {
    const path = this.#path('state', campaignId);
    if (!existsSync(path)) return undefined;
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as CampaignSnapshot;
    verifySnapshot(snapshot);
    return structuredClone(snapshot);
  }
  putSnapshot(campaignId: string, snapshot: Omit<CampaignSnapshot, 'version' | 'digest'>): CampaignSnapshot {
    const row = snapshotRecord(snapshot);
    atomicReplace(this.#path('state', campaignId), `${JSON.stringify(row, null, 2)}\n`);
    fsyncDirectory(this.#root);
    return structuredClone(row);
  }
  updateSnapshot(campaignId: string, update: (current: CampaignSnapshot | undefined) => Omit<CampaignSnapshot, 'version' | 'digest'>): CampaignSnapshot {
    return withSovereignFileLease(this.#path('lock', campaignId), () => this.putSnapshot(campaignId, update(this.getSnapshot(campaignId))));
  }
  #path(kind: 'plan' | 'state' | 'lock', campaignId: string): string {
    if (campaignId.trim() === '') throw new Error('campaign_id_required');
    return join(this.#root, `${kind}-${sha256({ campaignId })}.json`);
  }
}

export class GovernedEngineeringCampaignPlanner {
  constructor(
    readonly keyRegistry: KeyRegistry,
    readonly signer: SigningIdentity,
    readonly store: CampaignStore = new InMemoryCampaignStore(),
  ) {}

  plan(input: {
    readonly campaignId: string;
    readonly deliberation: SignedEnvelope<GovernedDeliberationPacket>;
    readonly policy: CampaignPolicy;
    readonly generatedAt: string;
  }): SignedEnvelope<GovernedEngineeringCampaign> {
    validatePolicy(input.policy);
    if (input.campaignId.trim() === '' || !Number.isFinite(Date.parse(input.generatedAt))) throw new Error('campaign_input_invalid');
    if (!this.keyRegistry.verify(input.deliberation)) throw new Error('campaign_deliberation_signature_invalid');
    const deliberation = input.deliberation.payload;
    if (deliberation.externalMutationsExecuted !== 0 || deliberation.executionState !== 'REVIEW_REQUIRED') throw new Error('campaign_deliberation_authority_escalation');
    const prior = this.store.getPlan(input.campaignId);
    const inputDigest = sha256({ campaignId: input.campaignId, deliberationDigest: sha256(input.deliberation), policy: input.policy, generatedAt: input.generatedAt });
    if (prior !== undefined) {
      if (prior.payload.campaignDigest !== sha256({ ...stripCampaignDigest(prior.payload) })) throw new Error('campaign_plan_tampered');
      if (prior.payload.planningInputDigest === inputDigest) return structuredClone(prior);
      throw new Error('campaign_plan_conflict');
    }
    if (deliberation.synthesisState === 'ROLE_COVERAGE_INCOMPLETE') throw new Error('campaign_role_coverage_incomplete');
    if (deliberation.synthesisState === 'CONFLICT_REVIEW_REQUIRED') throw new Error('campaign_conflict_review_required');
    const candidates = deliberation.workNodes.map(toCampaignItem);
    const bySource = new Map(candidates.map((item) => [item.sourceNodeId, item]));
    const excluded: ExcludedCampaignItem[] = [];
    const selected = new Map<string, CampaignWorkItem>();
    let totalEffort = 0;
    const ordered = [...candidates].sort((a, b) => b.scores.total - a.scores.total || a.itemId.localeCompare(b.itemId));
    const add = (item: CampaignWorkItem, stack = new Set<string>()): boolean => {
      if (selected.has(item.itemId)) return true;
      if (stack.has(item.itemId)) throw new Error('campaign_dependency_cycle');
      if (item.requestedTool !== undefined && input.policy.forbiddenTools.includes(item.requestedTool)) { excluded.push({ sourceNodeId: item.sourceNodeId, reason: 'FORBIDDEN_TOOL' }); return false; }
      if (item.scores.total < input.policy.minimumScore) { excluded.push({ sourceNodeId: item.sourceNodeId, reason: 'BELOW_MINIMUM_SCORE' }); return false; }
      if (selected.size >= input.policy.maxItems) { excluded.push({ sourceNodeId: item.sourceNodeId, reason: 'ITEM_LIMIT' }); return false; }
      const nextStack = new Set(stack); nextStack.add(item.itemId);
      for (const dependency of item.dependencies) {
        const dependencyItem = bySource.get(dependency);
        if (dependencyItem === undefined || !add(dependencyItem, nextStack)) { excluded.push({ sourceNodeId: item.sourceNodeId, reason: 'DEPENDENCY_NOT_SELECTED' }); return false; }
      }
      if (totalEffort + item.scores.effort > input.policy.maxTotalEffort) { excluded.push({ sourceNodeId: item.sourceNodeId, reason: 'EFFORT_BUDGET' }); return false; }
      selected.set(item.itemId, item); totalEffort += item.scores.effort; return true;
    };
    for (const item of ordered) add(item);
    const items = [...selected.values()].sort((a, b) => a.itemId.localeCompare(b.itemId));
    const stages = buildStages(items, input.policy.maxParallelism);
    const proofCoverage = [...new Set(items.flatMap((item) => item.proofObligations))].sort();
    const missingProofKinds = input.policy.requiredProofKinds.filter((kind) => !proofCoverage.includes(kind)).sort();
    const nextPermittedItemIds = items.filter((item) => item.dependencies.length === 0).map((item) => item.itemId).sort();
    const limitations = [
      'campaign-items-are-proposals-not-executions',
      'human-review-required-before-agent-approval',
      'scores-are-deterministic-prioritization-not-business-value-measurement',
      ...(missingProofKinds.length > 0 ? ['campaign-does-not-yet-cover-all-required-proof-kinds'] : []),
    ].sort();
    const material = {
      campaignId: input.campaignId,
      tenantId: deliberation.tenantId,
      subjectId: deliberation.subjectId,
      requesterId: deliberation.requesterId,
      deliberationPacketDigest: sha256(input.deliberation),
      planningInputDigest: inputDigest,
      deliberationState: deliberation.synthesisState,
      items,
      stages,
      excluded: dedupeExcluded(excluded),
      totalEffort,
      aggregateScore: items.reduce((sum, item) => sum + item.scores.total, 0),
      proofCoverage,
      missingProofKinds,
      nextPermittedItemIds,
      executionState: 'REVIEW_REQUIRED' as const,
      promotionCeiling: 'research' as const,
      externalInteractionsExecuted: deliberation.externalInteractionsExecuted,
      externalMutationsExecuted: 0 as const,
      externalEffectsExecuted: 0 as const,
      generatedAt: input.generatedAt,
      limitations,
    };
    const campaign: GovernedEngineeringCampaign = { ...material, campaignDigest: sha256(material) };
    const signed = signEnvelope(campaign, this.signer);
    this.store.putPlan(signed);
    this.store.putSnapshot(input.campaignId, initialSnapshot(campaign));
    return signed;
  }
}

export class GovernedCampaignTracker {
  constructor(readonly keyRegistry: KeyRegistry, readonly reviewerTrust: ReviewerAuthorizer, readonly store: CampaignStore) {}

  record(campaignId: string, result: CampaignItemResult): CampaignSnapshot {
    const planEnvelope = this.store.getPlan(campaignId);
    if (planEnvelope === undefined) throw new Error('campaign_plan_not_found');
    if (!this.keyRegistry.verify(planEnvelope)) throw new Error('campaign_plan_signature_invalid');
    const plan = planEnvelope.payload;
    verifyCampaign(plan);
    validateResult(result, planEnvelope, this.keyRegistry, this.reviewerTrust);
    return this.store.updateSnapshot(campaignId, (current) => {
      const prior = current ?? snapshotRecord(initialSnapshot(plan));
      if (prior.campaignDigest !== plan.campaignDigest) throw new Error('campaign_snapshot_plan_mismatch');
      const existing = prior.results.find((row) => row.itemId === result.itemId);
      if (existing !== undefined) {
        if (sha256(existing) !== sha256(result)) throw new Error('campaign_result_conflict');
        return stripSnapshot(prior);
      }
      const item = plan.items.find((candidate) => candidate.itemId === result.itemId)!;
      const states = { ...prior.itemStates };
      if (item.dependencies.some((dependency) => states[dependencyItemId(dependency)] !== 'SUCCEEDED')) throw new Error('campaign_dependency_not_satisfied');
      states[result.itemId] = result.status;
      const results = [...prior.results, structuredClone(result)].sort((a, b) => a.itemId.localeCompare(b.itemId));
      const nextPermittedItemIds = plan.items.filter((candidate) => states[candidate.itemId] === 'PENDING' && candidate.dependencies.every((dependency) => states[dependencyItemId(dependency)] === 'SUCCEEDED')).map((candidate) => candidate.itemId).sort();
      const completed = Object.values(states).filter((state) => state !== 'PENDING').length;
      const campaignState: CampaignSnapshot['campaignState'] = Object.values(states).every((state) => state === 'SUCCEEDED') ? 'COMPLETED'
        : Object.values(states).some((state) => state === 'FAILED' || state === 'REJECTED') ? 'REVIEW_REQUIRED'
          : nextPermittedItemIds.length === 0 && completed < plan.items.length ? 'BLOCKED' : 'ACTIVE';
      return {
        campaignDigest: plan.campaignDigest,
        results,
        itemStates: states,
        nextPermittedItemIds,
        progressPercent: plan.items.length === 0 ? 0 : Number(((completed / plan.items.length) * 100).toFixed(2)),
        campaignState,
        lastUpdatedAt: result.completedAt,
      };
    });
  }
}

function toCampaignItem(node: NamespacedWorkNode): CampaignWorkItem {
  const userValue = score(node.payload.userValue, defaultScore(node.kind, 'value'));
  const riskReduction = score(node.payload.riskReduction, defaultScore(node.kind, 'risk'));
  const reuse = score(node.payload.reuse, 5);
  const evidenceUrgency = score(node.payload.evidenceUrgency, node.kind === 'TEST_PROPOSAL' ? 8 : 6);
  const effort = score(node.payload.effort, node.kind === 'CHANGE_PROPOSAL' ? 6 : 3, 1, 10);
  const complexity = score(node.payload.complexity, node.kind === 'CHANGE_PROPOSAL' ? 6 : 3, 1, 10);
  const total = 3 * userValue + 3 * riskReduction + 2 * evidenceUrgency + reuse - 2 * effort - complexity;
  const proofObligations = parseProofKinds(node.payload.proofObligations, defaultProofs(node.kind));
  const stopConditions = parseStringArray(node.payload.stopConditions, defaultStopConditions(node.kind));
  return {
    itemId: dependencyItemId(node.nodeId),
    sourceNodeId: node.nodeId,
    role: node.role,
    kind: node.kind,
    summary: node.summary,
    ...(node.requestedTool === undefined ? {} : { requestedTool: node.requestedTool }),
    dependencies: [...node.dependsOn].sort(),
    scores: { userValue, riskReduction, reuse, evidenceUrgency, effort, complexity, total },
    proofObligations,
    stopConditions,
    reviewRequired: true,
    state: 'PROPOSAL_ONLY',
  };
}

function buildStages(items: readonly CampaignWorkItem[], maxParallelism: number): CampaignStage[] {
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const stageById = new Map<string, number>();
  const visit = (item: CampaignWorkItem, stack = new Set<string>()): number => {
    const prior = stageById.get(item.itemId); if (prior !== undefined) return prior;
    if (stack.has(item.itemId)) throw new Error('campaign_dependency_cycle');
    const next = new Set(stack); next.add(item.itemId);
    const stage = item.dependencies.length === 0 ? 0 : 1 + Math.max(...item.dependencies.map((dependency) => {
      const dependencyItem = byId.get(dependencyItemId(dependency));
      if (dependencyItem === undefined) throw new Error('campaign_dependency_missing');
      return visit(dependencyItem, next);
    }));
    stageById.set(item.itemId, stage); return stage;
  };
  for (const item of items) visit(item);
  const grouped = new Map<number, CampaignWorkItem[]>();
  for (const item of items) { const stage = stageById.get(item.itemId)!; const group = grouped.get(stage) ?? []; group.push(item); grouped.set(stage, group); }
  const result: CampaignStage[] = [];
  let sequence = 0;
  for (const baseStage of [...grouped.keys()].sort((a, b) => a - b)) {
    const group = grouped.get(baseStage)!.sort((a, b) => b.scores.total - a.scores.total || a.itemId.localeCompare(b.itemId));
    for (let index = 0; index < group.length; index += maxParallelism) {
      const wave = group.slice(index, index + maxParallelism);
      result.push({ stage: sequence, itemIds: wave.map((item) => item.itemId).sort(), totalEffort: wave.reduce((sum, item) => sum + item.scores.effort, 0) });
      sequence += 1;
    }
  }
  return result;
}

function validatePolicy(policy: CampaignPolicy): void {
  if (![policy.maxItems, policy.maxTotalEffort, policy.maxParallelism].every((value) => Number.isInteger(value) && value > 0) || !Number.isFinite(policy.minimumScore)) throw new Error('campaign_policy_invalid');
  if (policy.maxItems > 500 || policy.maxTotalEffort > 5_000 || policy.maxParallelism > 32) throw new Error('campaign_policy_excessive');
  if (policy.requiredProofKinds.length === 0 || new Set(policy.requiredProofKinds).size !== policy.requiredProofKinds.length || policy.requiredProofKinds.some((kind) => !CAMPAIGN_PROOF_KINDS.includes(kind))) throw new Error('campaign_proof_policy_invalid');
  if (new Set(policy.forbiddenTools).size !== policy.forbiddenTools.length || policy.forbiddenTools.some((tool) => tool.trim() === '')) throw new Error('campaign_forbidden_tools_invalid');
}
function validateResult(result: CampaignItemResult, planEnvelope: SignedEnvelope<GovernedEngineeringCampaign>, registry: KeyRegistry, reviewerTrust: ReviewerAuthorizer): void {
  const plan = planEnvelope.payload;
  const completedAt = Date.parse(result.completedAt);
  if (result.resultId.trim() === '' || result.campaignId !== plan.campaignId || !Number.isFinite(completedAt)) throw new Error('campaign_result_invalid');
  const item = plan.items.find((candidate) => candidate.itemId === result.itemId);
  if (item === undefined) throw new Error('campaign_result_item_invalid');
  if (!Number.isFinite(result.actualEffort) || result.actualEffort < 0) throw new Error('campaign_result_effort_invalid');
  if (result.status === 'SUCCEEDED' && result.evidenceRefs.length === 0) throw new Error('campaign_success_evidence_required');
  if (result.evidenceRefs.some((ref) => ref.trim() === '') || result.limitations.some((value) => value.trim() === '')) throw new Error('campaign_result_content_invalid');
  if (result.reviewerAttestations.length < 2) throw new Error('campaign_result_dual_review_required');
  const evidenceDigest = sha256([...result.evidenceRefs].sort());
  const reviewers = new Set<string>(); const organizations = new Set<string>();
  for (const attestation of result.reviewerAttestations) {
    if (!registry.verify(attestation)) throw new Error('campaign_result_attestation_signature_invalid');
    const payload = attestation.payload;
    if (payload.reviewerId !== attestation.issuerKeyId || payload.campaignId !== result.campaignId || payload.itemId !== result.itemId || payload.status !== result.status || payload.evidenceDigest !== evidenceDigest) throw new Error('campaign_result_attestation_binding_invalid');
    const reviewedAt = Date.parse(payload.reviewedAt);
    if (!Number.isFinite(reviewedAt) || reviewedAt > completedAt) throw new Error('campaign_result_attestation_time_invalid');
    if (payload.reviewerId === plan.requesterId || payload.reviewerId === planEnvelope.issuerKeyId) throw new Error('campaign_result_reviewer_conflict_of_interest');
    const authorized = reviewerTrust.authorize({ reviewerKeyId: payload.reviewerId, tenantId: plan.tenantId, scope: 'campaign.review', role: payload.reviewerRole, at: payload.reviewedAt });
    if (payload.reviewerOrganizationId !== authorized.organizationId || payload.reviewerCredentialDigest !== authorized.credentialDigest) throw new Error('campaign_result_reviewer_credential_binding_invalid');
    if (reviewers.has(payload.reviewerId)) throw new Error('campaign_result_dual_review_required');
    reviewers.add(payload.reviewerId); organizations.add(authorized.organizationId);
  }
  if (organizations.size < 2) throw new Error('campaign_result_independent_organization_required');
}
function initialSnapshot(plan: GovernedEngineeringCampaign): Omit<CampaignSnapshot, 'version' | 'digest'> {
  return {
    campaignDigest: plan.campaignDigest,
    results: [],
    itemStates: Object.fromEntries(plan.items.map((item) => [item.itemId, 'PENDING' as const])),
    nextPermittedItemIds: plan.nextPermittedItemIds,
    progressPercent: 0,
    campaignState: plan.items.length === 0 ? 'BLOCKED' : 'ACTIVE',
    lastUpdatedAt: plan.generatedAt,
  };
}
function snapshotRecord(input: Omit<CampaignSnapshot, 'version' | 'digest'>): CampaignSnapshot { const material = { version: 1 as const, ...structuredClone(input) }; return { ...material, digest: sha256(material) }; }
function verifySnapshot(row: CampaignSnapshot): void { const { digest, ...material } = row; if (row.version !== 1 || digest !== sha256(material)) throw new Error('campaign_snapshot_tampered'); }
function verifyCampaign(campaign: GovernedEngineeringCampaign): void { const { campaignDigest, ...material } = campaign; if (campaignDigest !== sha256(material) || campaign.executionState !== 'REVIEW_REQUIRED' || campaign.externalMutationsExecuted !== 0) throw new Error('campaign_plan_tampered'); }
function stripCampaignDigest(campaign: GovernedEngineeringCampaign): Omit<GovernedEngineeringCampaign, 'campaignDigest'> { const { campaignDigest: _ignored, ...material } = campaign; return material; }
function dependencyItemId(sourceNodeId: string): string { return `campaign-item:${sha256({ sourceNodeId }).slice(0, 24)}`; }
function score(value: unknown, fallback: number, minimum = 0, maximum = 10): number { const candidate = value === undefined ? fallback : Number(value); if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) throw new Error('campaign_score_invalid'); return candidate; }
function defaultScore(kind: NamespacedWorkNode['kind'], dimension: 'value' | 'risk'): number {
  const values = { ANALYSIS: 4, TEST_PROPOSAL: 7, CHANGE_PROPOSAL: 8, REVIEW_REQUEST: 6, OPERATIONAL_RECOMMENDATION: 7 } as const;
  const risks = { ANALYSIS: 4, TEST_PROPOSAL: 8, CHANGE_PROPOSAL: 7, REVIEW_REQUEST: 7, OPERATIONAL_RECOMMENDATION: 8 } as const;
  return dimension === 'value' ? values[kind] : risks[kind];
}
function defaultProofs(kind: NamespacedWorkNode['kind']): CampaignProofKind[] {
  const mapping: Record<NamespacedWorkNode['kind'], CampaignProofKind[]> = {
    ANALYSIS: ['REVIEW'], TEST_PROPOSAL: ['TEST', 'MUTATION'], CHANGE_PROPOSAL: ['CODE', 'TEST', 'ROLLBACK', 'REVIEW'], REVIEW_REQUEST: ['REVIEW'], OPERATIONAL_RECOMMENDATION: ['MONITOR', 'RECOVERY'],
  };
  return mapping[kind];
}
function defaultStopConditions(kind: NamespacedWorkNode['kind']): string[] {
  return kind === 'CHANGE_PROPOSAL' ? ['tenant-boundary-failure', 'test-regression', 'rollback-digest-mismatch'] : ['unsupported-claim', 'evidence-substitution', 'complexity-without-value'];
}
function parseProofKinds(value: unknown, fallback: CampaignProofKind[]): CampaignProofKind[] { if (value === undefined) return [...fallback]; if (!Array.isArray(value) || value.length === 0 || value.some((kind) => typeof kind !== 'string' || !CAMPAIGN_PROOF_KINDS.includes(kind as CampaignProofKind))) throw new Error('campaign_proof_obligation_invalid'); return [...new Set(value as CampaignProofKind[])].sort(); }
function parseStringArray(value: unknown, fallback: string[]): string[] { if (value === undefined) return [...fallback]; if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== 'string' || entry.trim() === '')) throw new Error('campaign_string_array_invalid'); return [...new Set(value as string[])].sort(); }
function dedupeExcluded(rows: readonly ExcludedCampaignItem[]): ExcludedCampaignItem[] { const map = new Map(rows.map((row) => [`${row.sourceNodeId}:${row.reason}`, row])); return [...map.values()].sort((a, b) => `${a.sourceNodeId}:${a.reason}`.localeCompare(`${b.sourceNodeId}:${b.reason}`)); }
function stripSnapshot(snapshot: CampaignSnapshot): Omit<CampaignSnapshot, 'version' | 'digest'> { const { version: _version, digest: _digest, ...material } = snapshot; return material; }
function atomicReplace(path: string, content: string): void { mkdirSync(dirname(path), { recursive: true }); const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`; const fd = openSync(temporary, 'wx', 0o600); try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); } renameSync(temporary, path); }
function fsyncDirectory(path: string): void { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
