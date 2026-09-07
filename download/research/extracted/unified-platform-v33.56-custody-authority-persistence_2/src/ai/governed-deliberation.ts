import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EvidenceRecord, SignedAuthorityGrant } from '../contracts/canonical.js';
import { KeyRegistry, sha256, signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';
import {
  GovernedModelOrchestrator,
  type GovernedModelReceipt,
  type ModelContextItem,
  type ModelExecutionBudget,
  type ModelPurpose,
  type ModelTool,
  type ModelWorkKind,
  type ModelWorkNode,
} from './governed-model-orchestrator.js';

export const DELIBERATION_ROLES = ['ARCHITECTURE', 'SECURITY', 'TEST', 'PRODUCT', 'OPERATIONS'] as const;
export type DeliberationRole = (typeof DELIBERATION_ROLES)[number];

export interface DeliberationRoleRequest {
  readonly role: DeliberationRole;
  readonly perspectiveId: string;
  readonly purpose: ModelPurpose;
  readonly objective: string;
  readonly allowedTools: readonly ModelTool[];
}

export interface GovernedDeliberationRequest {
  readonly deliberationId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly requesterId: string;
  readonly authority: SignedAuthorityGrant;
  readonly context: readonly ModelContextItem[];
  readonly perRoleBudget: ModelExecutionBudget;
  readonly aggregateBudget: {
    readonly maxRoles: number;
    readonly maxTotalInputChars: number;
    readonly maxTotalOutputChars: number;
    readonly maxTotalLatencyMs: number;
  };
  readonly roles: readonly DeliberationRoleRequest[];
  readonly createdAt: string;
}

export interface DeliberationSubmission {
  readonly role: DeliberationRole;
  readonly perspectiveId: string;
  readonly receipt: SignedEnvelope<GovernedModelReceipt>;
}

export interface NamespacedWorkNode extends ModelWorkNode {
  readonly role: DeliberationRole;
  readonly perspectiveId: string;
  readonly sourceRequestId: string;
}

export interface DeliberationConflict {
  readonly conflictKey: string;
  readonly claimIds: readonly string[];
  readonly roles: readonly DeliberationRole[];
  readonly variants: readonly {
    readonly statement: string;
    readonly classification: 'SUPPORTED' | 'UNSUPPORTED' | 'HYPOTHESIS';
    readonly evidenceRefs: readonly string[];
  }[];
}

export interface GovernedDeliberationPacket {
  readonly packetId: string;
  readonly deliberationId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly requesterId: string;
  readonly perspectiveCount: number;
  readonly roleCoverage: readonly DeliberationRole[];
  readonly missingRoles: readonly DeliberationRole[];
  readonly receiptDigests: readonly string[];
  readonly supportedClaims: readonly string[];
  readonly unsupportedClaims: readonly string[];
  readonly hypotheses: readonly string[];
  readonly conflicts: readonly DeliberationConflict[];
  readonly workNodes: readonly NamespacedWorkNode[];
  readonly workKindCoverage: readonly ModelWorkKind[];
  readonly toolCoverage: readonly ModelTool[];
  readonly aggregateUsage: {
    readonly inputChars: number;
    readonly outputChars: number;
    readonly latencyMs: number;
  };
  readonly synthesisState: 'READY_FOR_CAMPAIGN' | 'CONFLICT_REVIEW_REQUIRED' | 'ROLE_COVERAGE_INCOMPLETE';
  readonly executionState: 'REVIEW_REQUIRED';
  readonly promotionCeiling: 'research';
  readonly externalInteractionsExecuted: number;
  readonly externalMutationsExecuted: 0;
  /** @deprecated Compatibility alias meaning external mutations only. */
  readonly externalEffectsExecuted: 0;
  readonly generatedAt: string;
  readonly limitations: readonly string[];
  readonly evidence: EvidenceRecord;
  readonly packetDigest: string;
}

export interface StoredDeliberation {
  readonly version: 1;
  readonly deliberationId: string;
  readonly requestDigest: string;
  readonly signedPacket: SignedEnvelope<GovernedDeliberationPacket>;
  readonly digest: string;
}

export interface DeliberationStore {
  get(deliberationId: string): StoredDeliberation | undefined;
  put(row: Omit<StoredDeliberation, 'version' | 'digest'>): StoredDeliberation;
}

export class InMemoryDeliberationStore implements DeliberationStore {
  readonly #rows = new Map<string, StoredDeliberation>();
  get(deliberationId: string): StoredDeliberation | undefined {
    const row = this.#rows.get(deliberationId);
    return row === undefined ? undefined : structuredClone(row);
  }
  put(input: Omit<StoredDeliberation, 'version' | 'digest'>): StoredDeliberation {
    const row = deliberationRecord(input);
    const prior = this.#rows.get(input.deliberationId);
    if (prior !== undefined && prior.digest !== row.digest) throw new Error('deliberation_store_conflict');
    this.#rows.set(input.deliberationId, row);
    return structuredClone(row);
  }
}

export class FileDeliberationStore implements DeliberationStore {
  readonly #root: string;
  constructor(root: string) {
    if (root.trim() === '') throw new Error('deliberation_store_root_required');
    this.#root = resolve(root);
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    fsyncDirectory(this.#root);
  }
  get(deliberationId: string): StoredDeliberation | undefined {
    const path = this.#path(deliberationId);
    if (!existsSync(path)) return undefined;
    const row = JSON.parse(readFileSync(path, 'utf8')) as StoredDeliberation;
    verifyDeliberationRecord(row);
    if (row.deliberationId !== deliberationId) throw new Error('deliberation_store_key_mismatch');
    return structuredClone(row);
  }
  put(input: Omit<StoredDeliberation, 'version' | 'digest'>): StoredDeliberation {
    const row = deliberationRecord(input);
    const path = this.#path(input.deliberationId);
    const prior = this.get(input.deliberationId);
    if (prior !== undefined) {
      if (prior.digest !== row.digest) throw new Error('deliberation_store_conflict');
      return prior;
    }
    atomicReplace(path, `${JSON.stringify(row, null, 2)}\n`);
    fsyncDirectory(this.#root);
    return structuredClone(row);
  }
  #path(deliberationId: string): string {
    if (deliberationId.trim() === '') throw new Error('deliberation_id_required');
    return join(this.#root, `${sha256({ deliberationId })}.json`);
  }
}

export class GovernedDeliberationCouncil {
  constructor(
    readonly keyRegistry: KeyRegistry,
    readonly signer: SigningIdentity,
    readonly store: DeliberationStore = new InMemoryDeliberationStore(),
  ) {}

  synthesize(input: {
    readonly deliberationId: string;
    readonly tenantId: string;
    readonly subjectId: string;
    readonly requesterId: string;
    readonly requiredRoles: readonly DeliberationRole[];
    readonly submissions: readonly DeliberationSubmission[];
    readonly aggregateBudget: GovernedDeliberationRequest['aggregateBudget'];
    readonly generatedAt: string;
  }): SignedEnvelope<GovernedDeliberationPacket> {
    validateCouncilInput(input);
    const requestDigest = sha256(input);
    const prior = this.store.get(input.deliberationId);
    if (prior !== undefined) {
      if (prior.requestDigest !== requestDigest) throw new Error('deliberation_request_conflict');
      if (!this.keyRegistry.verify(prior.signedPacket)) throw new Error('deliberation_packet_signature_invalid');
      return structuredClone(prior.signedPacket);
    }

    const receipts: GovernedModelReceipt[] = [];
    for (const submission of input.submissions) {
      if (!this.keyRegistry.verify(submission.receipt)) throw new Error('deliberation_model_receipt_signature_invalid');
      const receipt = submission.receipt.payload;
      if (receipt.tenantId !== input.tenantId || receipt.subjectId !== input.subjectId || receipt.requesterId !== input.requesterId) {
        throw new Error('deliberation_receipt_identity_mismatch');
      }
      if (receipt.status !== 'PROPOSAL_ONLY' || receipt.promotionCeiling !== 'research' || receipt.externalMutationsExecuted !== 0) throw new Error('deliberation_authority_escalation');
      receipts.push(receipt);
    }

    const aggregateUsage = receipts.reduce((sum, receipt) => ({
      inputChars: sum.inputChars + receipt.usage.inputChars,
      outputChars: sum.outputChars + receipt.usage.outputChars,
      latencyMs: sum.latencyMs + receipt.usage.latencyMs,
    }), { inputChars: 0, outputChars: 0, latencyMs: 0 });
    const externalInteractionsExecuted = receipts.reduce((sum, receipt) => sum + receipt.externalInteractionsExecuted, 0);
    const externalMutationsExecuted = receipts.reduce((sum, receipt) => sum + receipt.externalMutationsExecuted, 0);
    if (aggregateUsage.inputChars > input.aggregateBudget.maxTotalInputChars
      || aggregateUsage.outputChars > input.aggregateBudget.maxTotalOutputChars
      || aggregateUsage.latencyMs > input.aggregateBudget.maxTotalLatencyMs) throw new Error('deliberation_aggregate_budget_exceeded');

    const roleCoverage = [...new Set(input.submissions.map((submission) => submission.role))].sort();
    const missingRoles = input.requiredRoles.filter((role) => !roleCoverage.includes(role)).sort();
    const claims = input.submissions.flatMap((submission, index) => receipts[index]!.claims.map((claim) => ({ role: submission.role, claim })));
    const conflicts = findConflicts(claims);
    const supportedClaims = claims.filter(({ claim }) => claim.classification === 'SUPPORTED').map(({ claim }) => claim.claimId).sort();
    const unsupportedClaims = claims.filter(({ claim }) => claim.classification === 'UNSUPPORTED').map(({ claim }) => claim.claimId).sort();
    const hypotheses = claims.filter(({ claim }) => claim.classification === 'HYPOTHESIS').map(({ claim }) => claim.claimId).sort();
    const workNodes = namespaceWorkNodes(input.submissions, receipts);
    const workKindCoverage = [...new Set(workNodes.map((node) => node.kind))].sort();
    const toolCoverage = [...new Set(workNodes.flatMap((node) => node.requestedTool === undefined ? [] : [node.requestedTool]))].sort();
    const synthesisState: GovernedDeliberationPacket['synthesisState'] = missingRoles.length > 0 ? 'ROLE_COVERAGE_INCOMPLETE'
      : conflicts.length > 0 ? 'CONFLICT_REVIEW_REQUIRED' : 'READY_FOR_CAMPAIGN';
    const limitations = [
      'perspective-diversity-is-not-independent-human-review',
      'model-receipts-remain-proposals-not-authority',
      'contradictions-must-be-resolved-before-execution',
      'campaign-planning-does-not-authorize-external-mutations',
      'external-provider-interactions-are-counted-and-disclosure-bound',
    ];
    const material = {
      packetId: `deliberation:${sha256({ deliberationId: input.deliberationId, requestDigest }).slice(0, 24)}`,
      deliberationId: input.deliberationId,
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      requesterId: input.requesterId,
      perspectiveCount: input.submissions.length,
      roleCoverage,
      missingRoles,
      receiptDigests: input.submissions.map((submission) => sha256(submission.receipt)).sort(),
      supportedClaims,
      unsupportedClaims,
      hypotheses,
      conflicts,
      workNodes,
      workKindCoverage,
      toolCoverage,
      aggregateUsage,
      synthesisState,
      executionState: 'REVIEW_REQUIRED' as const,
      promotionCeiling: 'research' as const,
      externalInteractionsExecuted,
      externalMutationsExecuted: 0 as const,
      externalEffectsExecuted: 0 as const,
      generatedAt: input.generatedAt,
      limitations,
    };
    const evidence: EvidenceRecord = {
      recordId: `deliberation-evidence:${input.deliberationId}`,
      tenantId: input.tenantId,
      kind: 'governed-multi-perspective-deliberation',
      subject: input.subjectId,
      payload: {
        requestDigest,
        receiptDigests: material.receiptDigests,
        conflictCount: conflicts.length,
        roleCoverage,
        workNodeCount: workNodes.length,
        proposalOnly: true,
        externalInteractionsExecuted,
        externalMutationsExecuted: 0,
      },
      evidenceClass: 'COMPUTED',
      method: 'canonical.governedDeliberationCouncil.v31',
      environment: { runtime: 'node', perspectiveCount: input.submissions.length },
      createdAt: input.generatedAt,
      limitations,
    };
    const packet: GovernedDeliberationPacket = { ...material, evidence, packetDigest: sha256({ ...material, evidence }) };
    const signedPacket = signEnvelope(packet, this.signer);
    this.store.put({ deliberationId: input.deliberationId, requestDigest, signedPacket });
    return signedPacket;
  }
}

export class GovernedDeliberationRunner {
  constructor(readonly model: GovernedModelOrchestrator, readonly council: GovernedDeliberationCouncil) {}

  async run(request: GovernedDeliberationRequest, now = new Date()): Promise<SignedEnvelope<GovernedDeliberationPacket>> {
    validateRunRequest(request, now);
    const submissions: DeliberationSubmission[] = [];
    for (const role of request.roles) {
      const receipt = await this.model.execute({
        requestId: `${request.deliberationId}:${role.role.toLowerCase()}`,
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        requesterId: request.requesterId,
        purpose: role.purpose,
        objective: `[${role.role}] ${role.objective}`,
        authority: request.authority,
        allowedTools: role.allowedTools,
        context: [
          {
            contextId: `system-perspective:${role.role}`,
            source: 'canonical-deliberation-role',
            trust: 'TRUSTED',
            priority: Number.MAX_SAFE_INTEGER,
            content: roleInstruction(role.role),
          },
          ...request.context,
        ],
        budget: request.perRoleBudget,
        createdAt: request.createdAt,
      }, now);
      submissions.push({ role: role.role, perspectiveId: role.perspectiveId, receipt });
    }
    return this.council.synthesize({
      deliberationId: request.deliberationId,
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      requesterId: request.requesterId,
      requiredRoles: request.roles.map((role) => role.role),
      submissions,
      aggregateBudget: request.aggregateBudget,
      generatedAt: now.toISOString(),
    });
  }
}

function validateRunRequest(request: GovernedDeliberationRequest, now: Date): void {
  for (const [value, code] of [[request.deliberationId, 'deliberation_id_required'], [request.tenantId, 'deliberation_tenant_required'], [request.subjectId, 'deliberation_subject_required'], [request.requesterId, 'deliberation_requester_required']] as const) {
    if (value.trim() === '') throw new Error(code);
  }
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(Date.parse(request.createdAt))) throw new Error('deliberation_time_invalid');
  if (request.roles.length < 2 || request.roles.length > request.aggregateBudget.maxRoles) throw new Error('deliberation_role_count_invalid');
  const roles = request.roles.map((role) => role.role);
  const perspectives = request.roles.map((role) => role.perspectiveId);
  if (new Set(roles).size !== roles.length || new Set(perspectives).size !== perspectives.length) throw new Error('deliberation_role_or_perspective_duplicate');
  for (const role of request.roles) {
    if (!DELIBERATION_ROLES.includes(role.role) || role.perspectiveId.trim() === '' || role.objective.trim() === '' || role.allowedTools.length === 0) throw new Error('deliberation_role_invalid');
  }
  const aggregateValues = Object.values(request.aggregateBudget);
  if (aggregateValues.some((value) => !Number.isInteger(value) || value <= 0)) throw new Error('deliberation_budget_invalid');
}

function validateCouncilInput(input: {
  readonly deliberationId: string; readonly tenantId: string; readonly subjectId: string; readonly requesterId: string;
  readonly requiredRoles: readonly DeliberationRole[]; readonly submissions: readonly DeliberationSubmission[];
  readonly aggregateBudget: GovernedDeliberationRequest['aggregateBudget']; readonly generatedAt: string;
}): void {
  if ([input.deliberationId, input.tenantId, input.subjectId, input.requesterId].some((value) => value.trim() === '')) throw new Error('deliberation_input_required');
  if (!Number.isFinite(Date.parse(input.generatedAt))) throw new Error('deliberation_generated_time_invalid');
  if (input.requiredRoles.length < 2 || new Set(input.requiredRoles).size !== input.requiredRoles.length || input.requiredRoles.some((role) => !DELIBERATION_ROLES.includes(role))) throw new Error('deliberation_required_roles_invalid');
  if (input.submissions.length === 0 || input.submissions.length > input.aggregateBudget.maxRoles) throw new Error('deliberation_submissions_invalid');
  const roles = input.submissions.map((submission) => submission.role);
  const perspectives = input.submissions.map((submission) => submission.perspectiveId);
  const requests = input.submissions.map((submission) => submission.receipt.payload.requestId);
  if (new Set(roles).size !== roles.length || new Set(perspectives).size !== perspectives.length || new Set(requests).size !== requests.length) throw new Error('deliberation_submission_duplicate');
  if (input.submissions.some((submission) => !DELIBERATION_ROLES.includes(submission.role) || submission.perspectiveId.trim() === '')) throw new Error('deliberation_submission_invalid');
}

function findConflicts(entries: readonly { role: DeliberationRole; claim: GovernedModelReceipt['claims'][number] }[]): DeliberationConflict[] {
  const groups = new Map<string, { role: DeliberationRole; claim: GovernedModelReceipt['claims'][number] }[]>();
  for (const entry of entries) {
    const key = entry.claim.claimId;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  const conflicts: DeliberationConflict[] = [];
  for (const [key, group] of groups) {
    const variants = new Map<string, DeliberationConflict['variants'][number]>();
    for (const { claim } of group) {
      const variant = { statement: claim.statement, classification: claim.classification, evidenceRefs: [...claim.evidenceRefs].sort() };
      const semanticKey = sha256({ statement: claim.statement, classification: claim.classification });
      const existing = variants.get(semanticKey);
      variants.set(semanticKey, existing === undefined ? variant : { ...existing, evidenceRefs: [...new Set([...existing.evidenceRefs, ...variant.evidenceRefs])].sort() });
    }
    if (variants.size > 1) conflicts.push({ conflictKey: key, claimIds: [...new Set(group.map(({ claim }) => claim.claimId))].sort(), roles: [...new Set(group.map(({ role }) => role))].sort(), variants: [...variants.values()].sort((a, b) => a.statement.localeCompare(b.statement)) });
  }
  return conflicts.sort((a, b) => a.conflictKey.localeCompare(b.conflictKey));
}

function namespaceWorkNodes(submissions: readonly DeliberationSubmission[], receipts: readonly GovernedModelReceipt[]): NamespacedWorkNode[] {
  const result: NamespacedWorkNode[] = [];
  for (let index = 0; index < submissions.length; index += 1) {
    const submission = submissions[index]!;
    const receipt = receipts[index]!;
    const prefix = `${submission.role.toLowerCase()}:${receipt.requestId}:`;
    for (const node of receipt.workGraph) result.push({
      ...structuredClone(node),
      nodeId: `${prefix}${node.nodeId}`,
      dependsOn: node.dependsOn.map((dependency) => `${prefix}${dependency}`).sort(),
      role: submission.role,
      perspectiveId: submission.perspectiveId,
      sourceRequestId: receipt.requestId,
    });
  }
  return result.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

function roleInstruction(role: DeliberationRole): string {
  const instructions: Record<DeliberationRole, string> = {
    ARCHITECTURE: 'Analyze boundaries, contracts, coupling, scalability, failure domains, migration and simpler alternatives. Produce proposal-only work with explicit proof obligations.',
    SECURITY: 'Attack authority, tenant isolation, evidence authenticity, replay, key custody, supply chain and untrusted execution. Propose tests and mitigations without executing effects.',
    TEST: 'Falsify claims using property, mutation, fuzz, state-machine, concurrency, crash, recovery and authenticity tests. Prefer high-risk branches over test count.',
    PRODUCT: 'Evaluate urgent user value, workflow friction, adoption, time-to-value, commercial differentiation and stop conditions. Separate modeled value from measured value.',
    OPERATIONS: 'Evaluate observability, incident response, rollback, recertification, SLOs, capacity, cost and operator runbooks. Keep all recommendations review-only.',
  };
  return instructions[role];
}

function deliberationRecord(input: Omit<StoredDeliberation, 'version' | 'digest'>): StoredDeliberation {
  const material = { version: 1 as const, ...structuredClone(input) };
  return { ...material, digest: sha256(material) };
}
function verifyDeliberationRecord(row: StoredDeliberation): void {
  const { digest, ...material } = row;
  if (row.version !== 1 || digest !== sha256(material)) throw new Error('deliberation_store_tampered');
}
function atomicReplace(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
}
function fsyncDirectory(path: string): void { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
