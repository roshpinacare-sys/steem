import type { SignedEnvelope, SigningIdentity } from '../contracts/crypto.js';
import { sha256, signEnvelope } from '../contracts/crypto.js';
import type { AgentPlan } from '../agents/types.js';
import { DeterministicGovernedAgent } from '../agents/governed-agent.js';
import type { GovernedModelReceipt, GovernedModelRequest, ModelWorkNode } from '../ai/governed-model-orchestrator.js';
import { GovernedModelOrchestrator } from '../ai/governed-model-orchestrator.js';
import { buildOperatorActionCenter, type OperationalDependency, type OperationalRisk, type OperatorActionCenter } from '../operations/operator-action-center.js';

export interface EngineeringAssistantRequest {
  readonly requestId: string;
  readonly modelRequest: GovernedModelRequest;
  readonly operationalDependencies: readonly OperationalDependency[];
  readonly operationalRisks: readonly OperationalRisk[];
  readonly failedTests?: number;
  readonly orphanProcesses?: number;
  readonly testRuntimeRegression?: boolean;
}

export interface AssistantTraceLink {
  readonly from: string;
  readonly relation: 'SUPPORTED_BY' | 'PROPOSES' | 'REQUIRES_REVIEW' | 'ADDRESSES';
  readonly to: string;
}

export interface EngineeringReviewPacket {
  readonly packetId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly requesterId: string;
  readonly modelReceiptDigest: string;
  readonly modelReceipt: SignedEnvelope<GovernedModelReceipt>;
  readonly agentPlans: readonly AgentPlan[];
  readonly proposedTests: readonly ModelWorkNode[];
  readonly reviewRequests: readonly ModelWorkNode[];
  readonly operationalRecommendations: readonly ModelWorkNode[];
  readonly claims: GovernedModelReceipt['claims'];
  readonly unsupportedClaims: readonly string[];
  readonly traceability: readonly AssistantTraceLink[];
  readonly actionCenter: OperatorActionCenter;
  readonly executionState: 'REVIEW_REQUIRED';
  readonly promotionCeiling: 'research';
  readonly generatedAt: string;
  readonly limitations: readonly string[];
  readonly packetDigest: string;
}

export class GovernedEngineeringAssistant {
  constructor(
    readonly model: GovernedModelOrchestrator,
    readonly agent: DeterministicGovernedAgent,
    readonly packetSigner: SigningIdentity,
  ) {}

  async prepare(request: EngineeringAssistantRequest, now = new Date()): Promise<SignedEnvelope<EngineeringReviewPacket>> {
    validateAssistantRequest(request);
    if (request.requestId !== request.modelRequest.requestId) throw new Error('assistant_request_binding_mismatch');
    const modelReceipt = await this.model.execute(request.modelRequest, now);
    if (!this.model.keyRegistry.verify(modelReceipt)) throw new Error('assistant_model_receipt_signature_invalid');
    const receipt = modelReceipt.payload;
    if (receipt.tenantId !== request.modelRequest.tenantId || receipt.subjectId !== request.modelRequest.subjectId || receipt.requesterId !== request.modelRequest.requesterId) {
      throw new Error('assistant_model_receipt_identity_mismatch');
    }
    if (receipt.status !== 'PROPOSAL_ONLY' || receipt.promotionCeiling !== 'research') throw new Error('assistant_model_authority_escalation');

    const changeNodes = receipt.workGraph.filter((node) => node.kind === 'CHANGE_PROPOSAL');
    const agentPlans = changeNodes.map((node) => this.agent.propose(changeRequest(receipt, node)));
    const proposedTests = receipt.workGraph.filter((node) => node.kind === 'TEST_PROPOSAL');
    const reviewRequests = receipt.workGraph.filter((node) => node.kind === 'REVIEW_REQUEST');
    const operationalRecommendations = receipt.workGraph.filter((node) => node.kind === 'OPERATIONAL_RECOMMENDATION');
    const actionCenter = buildOperatorActionCenter({
      dependencies: request.operationalDependencies,
      risks: request.operationalRisks,
      ...(request.failedTests === undefined ? {} : { failedTests: request.failedTests }),
      ...(request.orphanProcesses === undefined ? {} : { orphanProcesses: request.orphanProcesses }),
      ...(request.testRuntimeRegression === undefined ? {} : { testRuntimeRegression: request.testRuntimeRegression }),
    });
    const traceability = buildTraceability(receipt, agentPlans, proposedTests, reviewRequests, operationalRecommendations);
    const limitations = [...new Set([
      ...receipt.limitations,
      'assistant-does-not-approve-or-execute-changes',
      'agent-plans-require-independent-review',
      'model-claims-remain-bound-to-declared-evidence',
      'external-infrastructure-qualification-remains-separate',
    ])].sort();
    const material = {
      packetId: `engineering-review:${receipt.requestId}`,
      requestId: receipt.requestId,
      tenantId: receipt.tenantId,
      subjectId: receipt.subjectId,
      requesterId: receipt.requesterId,
      modelReceiptDigest: sha256(modelReceipt),
      modelReceipt: structuredClone(modelReceipt),
      agentPlans: structuredClone(agentPlans),
      proposedTests: structuredClone(proposedTests),
      reviewRequests: structuredClone(reviewRequests),
      operationalRecommendations: structuredClone(operationalRecommendations),
      claims: structuredClone(receipt.claims),
      unsupportedClaims: receipt.claims.filter((claim) => claim.classification !== 'SUPPORTED').map((claim) => claim.claimId).sort(),
      traceability,
      actionCenter,
      executionState: 'REVIEW_REQUIRED' as const,
      promotionCeiling: 'research' as const,
      generatedAt: receipt.finishedAt,
      limitations,
    };
    const packet: EngineeringReviewPacket = { ...material, packetDigest: sha256(material) };
    return signEnvelope(packet, this.packetSigner);
  }
}

interface ChangePayload {
  readonly targetFile: string;
  readonly expectedFileDigest: string;
  readonly exactBefore: string;
  readonly exactAfter: string;
  readonly allowedFiles: readonly string[];
  readonly deniedFiles?: readonly string[];
  readonly requiredTests: readonly string[];
  readonly maxOperations?: number;
}

function changeRequest(receipt: GovernedModelReceipt, node: ModelWorkNode) {
  if (node.requestedTool !== 'change.propose') throw new Error('assistant_change_requires_proposal_tool');
  const payload = parseChangePayload(node.payload);
  return {
    requestId: `${receipt.requestId}:${node.nodeId}`,
    tenantId: receipt.tenantId,
    requesterId: receipt.requesterId,
    agentId: `model:${receipt.provider}/${receipt.model}`,
    objective: node.summary,
    allowedFiles: payload.allowedFiles,
    deniedFiles: payload.deniedFiles ?? [],
    requiredTests: payload.requiredTests,
    targetFile: payload.targetFile,
    expectedFileDigest: payload.expectedFileDigest,
    exactBefore: payload.exactBefore,
    exactAfter: payload.exactAfter,
    context: receipt.droppedContext.map((item) => ({ path: `dropped:${item.contextId}`, content: `reason=${item.reason};digest=${item.digest}` })),
    maxOperations: payload.maxOperations ?? 1,
    noExternalMutation: true,
    noNetwork: true,
  } as const;
}

function parseChangePayload(payload: Readonly<Record<string, unknown>>): ChangePayload {
  const targetFile = requiredString(payload.targetFile, 'assistant_change_target_required');
  const expectedFileDigest = requiredString(payload.expectedFileDigest, 'assistant_change_digest_required');
  if (!/^[a-f0-9]{64}$/.test(expectedFileDigest)) throw new Error('assistant_change_digest_invalid');
  const exactBefore = requiredString(payload.exactBefore, 'assistant_change_before_required');
  const exactAfter = requiredString(payload.exactAfter, 'assistant_change_after_required');
  const allowedFiles = stringArray(payload.allowedFiles, 'assistant_change_allowed_files_required');
  const requiredTests = stringArray(payload.requiredTests, 'assistant_change_tests_required');
  const deniedFiles = payload.deniedFiles === undefined ? undefined : stringArray(payload.deniedFiles, 'assistant_change_denied_files_invalid');
  const maxOperations = payload.maxOperations === undefined ? undefined : Number(payload.maxOperations);
  if (maxOperations !== undefined && (!Number.isInteger(maxOperations) || maxOperations !== 1)) throw new Error('assistant_change_operation_budget_invalid');
  return {
    targetFile, expectedFileDigest, exactBefore, exactAfter, allowedFiles, requiredTests,
    ...(deniedFiles === undefined ? {} : { deniedFiles }),
    ...(maxOperations === undefined ? {} : { maxOperations }),
  };
}

function buildTraceability(
  receipt: GovernedModelReceipt,
  plans: readonly AgentPlan[],
  tests: readonly ModelWorkNode[],
  reviews: readonly ModelWorkNode[],
  operations: readonly ModelWorkNode[],
): AssistantTraceLink[] {
  const links: AssistantTraceLink[] = [];
  for (const claim of receipt.claims) for (const evidence of claim.evidenceRefs) links.push({ from: `claim:${claim.claimId}`, relation: 'SUPPORTED_BY', to: evidence });
  for (const plan of plans) links.push({ from: `model-run:${receipt.requestId}`, relation: 'PROPOSES', to: `agent-plan:${plan.planId}` });
  for (const node of tests) links.push({ from: `work:${node.nodeId}`, relation: 'ADDRESSES', to: `test-proposal:${node.nodeId}` });
  for (const node of reviews) links.push({ from: `work:${node.nodeId}`, relation: 'REQUIRES_REVIEW', to: `review:${node.nodeId}` });
  for (const node of operations) links.push({ from: `work:${node.nodeId}`, relation: 'ADDRESSES', to: `operation:${node.nodeId}` });
  return links.sort((a, b) => `${a.from}:${a.relation}:${a.to}`.localeCompare(`${b.from}:${b.relation}:${b.to}`));
}

function validateAssistantRequest(request: EngineeringAssistantRequest): void {
  if (request.requestId.trim() === '') throw new Error('assistant_request_id_required');
  const ids = new Set<string>();
  for (const dependency of request.operationalDependencies) {
    if (ids.has(`dependency:${dependency.id}`)) throw new Error('assistant_operational_input_duplicate');
    ids.add(`dependency:${dependency.id}`);
  }
  for (const risk of request.operationalRisks) {
    if (ids.has(`risk:${risk.id}`)) throw new Error('assistant_operational_input_duplicate');
    ids.add(`risk:${risk.id}`);
  }
  if ((request.failedTests ?? 0) < 0 || (request.orphanProcesses ?? 0) < 0) throw new Error('assistant_operational_count_invalid');
}
function requiredString(value: unknown, code: string): string { if (typeof value !== 'string' || value.trim() === '') throw new Error(code); return value; }
function stringArray(value: unknown, code: string): string[] { if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim() === '') || new Set(value).size !== value.length) throw new Error(code); return [...value] as string[]; }
