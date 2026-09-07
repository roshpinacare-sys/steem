import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { authorityAllows, type EvidenceRecord, type SignedAuthorityGrant } from '../contracts/canonical.js';
import {
  KeyRegistry, sha256, signEnvelope, type SignedEnvelope, type SigningIdentity,
} from '../contracts/crypto.js';
import { withSovereignFileLeaseAsync } from '../persistence/sovereign-file-lease.js';

export const MODEL_PURPOSES = ['ANALYZE', 'DESIGN', 'REVIEW', 'REPAIR_PROPOSAL', 'OPERATIONS'] as const;
export type ModelPurpose = (typeof MODEL_PURPOSES)[number];
export const MODEL_TOOLS = ['repository.read', 'evidence.read', 'tests.propose', 'change.propose', 'operations.recommend'] as const;
export type ModelTool = (typeof MODEL_TOOLS)[number];
export type ModelContextTrust = 'TRUSTED' | 'UNTRUSTED';
export type ModelWorkKind = 'ANALYSIS' | 'TEST_PROPOSAL' | 'CHANGE_PROPOSAL' | 'REVIEW_REQUEST' | 'OPERATIONAL_RECOMMENDATION';

export interface ModelContextItem {
  readonly contextId: string;
  readonly source: string;
  readonly trust: ModelContextTrust;
  readonly priority: number;
  readonly content: string;
  readonly evidenceRefs?: readonly string[];
}
export interface ModelExecutionBudget {
  readonly maxContextChars: number;
  readonly maxOutputChars: number;
  readonly maxClaims: number;
  readonly maxGraphNodes: number;
  readonly maxToolProposals: number;
  readonly maxLatencyMs: number;
}
export interface GovernedModelRequest {
  readonly requestId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly requesterId: string;
  readonly purpose: ModelPurpose;
  readonly objective: string;
  readonly authority: SignedAuthorityGrant;
  readonly allowedTools: readonly ModelTool[];
  readonly context: readonly ModelContextItem[];
  readonly budget: ModelExecutionBudget;
  readonly createdAt: string;
}
export interface ModelClaim {
  readonly claimId: string;
  readonly statement: string;
  readonly classification: 'SUPPORTED' | 'UNSUPPORTED' | 'HYPOTHESIS';
  readonly evidenceRefs: readonly string[];
}
export interface ModelWorkNode {
  readonly nodeId: string;
  readonly kind: ModelWorkKind;
  readonly summary: string;
  readonly dependsOn: readonly string[];
  readonly requestedTool?: ModelTool;
  readonly payload: Readonly<Record<string, unknown>>;
}
export interface ModelAdapterInput {
  readonly requestDigest: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly purpose: ModelPurpose;
  readonly objective: string;
  readonly allowedTools: readonly ModelTool[];
  readonly context: readonly ModelContextItem[];
  readonly budget: ModelExecutionBudget;
}
export interface ProviderBoundaryProof {
  readonly credentialDigest: string;
  readonly attestationDigest: string;
  readonly replayKeyDigest: string;
  readonly disclosureDigest: string;
  readonly externalInteractionsExecuted: 1;
  readonly externalMutationsExecuted: 0;
  readonly providerId: string;
  readonly model: string;
  readonly verifiedAt: string;
  readonly status: 'VERIFIED_PROVIDER_ATTESTATION';
  readonly limitation: 'provider-attestation-proves-binding-not-model-correctness';
  readonly signedAttestation: SignedEnvelope<unknown>;
}
export interface ModelAdapterOutput {
  readonly provider: string;
  readonly model: string;
  readonly output: string;
  readonly claims: readonly ModelClaim[];
  readonly workGraph: readonly ModelWorkNode[];
  readonly usage: { readonly inputChars: number; readonly outputChars: number; readonly latencyMs: number };
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly limitations: readonly string[];
  readonly providerBoundaryProof?: ProviderBoundaryProof;
}
export interface GovernedModelAdapter {
  invoke(input: ModelAdapterInput): Promise<ModelAdapterOutput>;
  validatePersistedReceipt?(receipt: GovernedModelReceipt, at: Date): void;
}
export interface DroppedModelContext { readonly contextId: string; readonly reason: 'PROMPT_INJECTION' | 'CONTEXT_BUDGET'; readonly digest: string; }
export interface ProviderReportedExecution {
  readonly usage: ModelAdapterOutput['usage'];
  readonly startedAt: string;
  readonly finishedAt: string;
}
export interface GovernedModelReceipt {
  readonly receiptId: string;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly requesterId: string;
  readonly purpose: ModelPurpose;
  readonly provider: string;
  readonly model: string;
  readonly selectedContextIds: readonly string[];
  readonly trustedEvidenceRefs: readonly string[];
  readonly untrustedContextIds: readonly string[];
  readonly droppedContext: readonly DroppedModelContext[];
  readonly contextDigest: string;
  readonly output: string;
  readonly outputDigest: string;
  readonly claims: readonly ModelClaim[];
  readonly workGraph: readonly ModelWorkNode[];
  readonly workGraphDigest: string;
  readonly usage: ModelAdapterOutput['usage'];
  readonly providerReport: ProviderReportedExecution;
  readonly providerBoundaryProof?: ProviderBoundaryProof;
  readonly externalInteractionsExecuted: 0 | 1;
  readonly externalMutationsExecuted: 0;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: 'PROPOSAL_ONLY';
  readonly promotionCeiling: 'research';
  readonly limitations: readonly string[];
  readonly evidence: EvidenceRecord;
}
export interface StoredModelRun {
  readonly version: 1;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly signedReceipt: SignedEnvelope<GovernedModelReceipt>;
  readonly digest: string;
}
export interface ModelRunStore {
  get(requestId: string): StoredModelRun | undefined;
  put(run: Omit<StoredModelRun, 'version' | 'digest'>): StoredModelRun;
  runExclusive<T>(requestId: string, operation: () => Promise<T>, timeoutMs?: number): Promise<T>;
}

export class InMemoryModelRunStore implements ModelRunStore {
  readonly #runs = new Map<string, StoredModelRun>();
  readonly #tails = new Map<string, Promise<void>>();
  get(requestId: string): StoredModelRun | undefined {
    const row = this.#runs.get(requestId);
    return row === undefined ? undefined : structuredClone(row);
  }
  put(run: Omit<StoredModelRun, 'version' | 'digest'>): StoredModelRun {
    const row = modelRunRecord(run);
    const prior = this.#runs.get(run.requestId);
    if (prior !== undefined && prior.digest !== row.digest) throw new Error('model_run_request_conflict');
    this.#runs.set(run.requestId, row);
    return structuredClone(row);
  }
  async runExclusive<T>(requestId: string, operation: () => Promise<T>): Promise<T> {
    if (requestId.trim() === '') throw new Error('model_request_id_required');
    const previous = this.#tails.get(requestId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.#tails.set(requestId, tail);
    await previous;
    try { return await operation(); }
    finally { release(); if (this.#tails.get(requestId) === tail) this.#tails.delete(requestId); }
  }
}

export class FileModelRunStore implements ModelRunStore {
  readonly #root: string;
  constructor(root: string) {
    if (root.trim() === '') throw new Error('model_run_store_root_required');
    this.#root = resolve(root);
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    fsyncDirectory(this.#root);
  }
  get(requestId: string): StoredModelRun | undefined {
    const path = this.#path(requestId);
    if (!existsSync(path)) return undefined;
    const row = JSON.parse(readFileSync(path, 'utf8')) as StoredModelRun;
    verifyModelRunRecord(row);
    if (row.requestId !== requestId) throw new Error('model_run_store_key_mismatch');
    return structuredClone(row);
  }
  put(run: Omit<StoredModelRun, 'version' | 'digest'>): StoredModelRun {
    const row = modelRunRecord(run);
    const path = this.#path(run.requestId);
    const prior = this.get(run.requestId);
    if (prior !== undefined) {
      if (prior.digest !== row.digest) throw new Error('model_run_request_conflict');
      return prior;
    }
    atomicReplace(path, `${JSON.stringify(row, null, 2)}\n`);
    fsyncDirectory(this.#root);
    return structuredClone(row);
  }
  async runExclusive<T>(requestId: string, operation: () => Promise<T>, timeoutMs = 5_000): Promise<T> {
    return withSovereignFileLeaseAsync(this.#lockPath(requestId), operation, { timeoutMs, staleAfterMs: Math.max(30_000, timeoutMs * 2) });
  }
  #lockPath(requestId: string): string { return join(this.#root, `${sha256({ requestId })}.lock`); }
  #path(requestId: string): string {
    if (requestId.trim() === '') throw new Error('model_request_id_required');
    return join(this.#root, `${sha256({ requestId })}.json`);
  }
}

export class GovernedModelOrchestrator {
  constructor(
    readonly keyRegistry: KeyRegistry,
    readonly receiptSigner: SigningIdentity,
    readonly adapter: GovernedModelAdapter,
    readonly store: ModelRunStore = new InMemoryModelRunStore(),
  ) {}

  async execute(request: GovernedModelRequest, now = new Date()): Promise<SignedEnvelope<GovernedModelReceipt>> {
    validateRequest(request);
    if (!this.keyRegistry.verify(request.authority)) throw new Error('model_authority_signature_invalid');
    const scope = purposeScope(request.purpose);
    if (!authorityAllows(request.authority.payload, { tenantId: request.tenantId, subjectId: request.subjectId, scope }, now)) throw new Error('model_authority_denied');
    const requestCreatedAt = Date.parse(request.createdAt);
    const authorityIssuedAt = Date.parse(request.authority.payload.issuedAt);
    if (requestCreatedAt < authorityIssuedAt || requestCreatedAt > now.getTime() + 300_000) throw new Error('model_request_time_outside_authority_window');
    const requestDigest = sha256(request);
    return this.store.runExclusive(request.requestId, async () => {
      const prior = this.store.get(request.requestId);
      if (prior !== undefined) {
        if (prior.requestDigest !== requestDigest) throw new Error('model_run_request_conflict');
        if (!this.keyRegistry.verify(prior.signedReceipt)) throw new Error('model_run_receipt_signature_invalid');
        if (prior.signedReceipt.payload.providerBoundaryProof !== undefined) {
          if (this.adapter.validatePersistedReceipt === undefined) throw new Error('model_provider_replay_validator_required');
          this.adapter.validatePersistedReceipt(prior.signedReceipt.payload, now);
        }
        return structuredClone(prior.signedReceipt);
      }
      const selection = selectContext(request.context, request.budget.maxContextChars);
      const input: ModelAdapterInput = {
        requestDigest, tenantId: request.tenantId, subjectId: request.subjectId, purpose: request.purpose, objective: request.objective,
        allowedTools: [...request.allowedTools].sort(), context: selection.selected, budget: request.budget,
      };
      const platformStartedAt = now.toISOString();
      const monotonicStart = performance.now();
      const output = await invokeWithTimeout(this.adapter, structuredClone(input), request.budget.maxLatencyMs);
      if (output.providerBoundaryProof !== undefined && this.adapter.validatePersistedReceipt === undefined) throw new Error('model_provider_boundary_validator_required');
      const platformLatencyMs = Number(Math.max(0, performance.now() - monotonicStart).toFixed(3));
      const platformFinishedAt = new Date(now.getTime() + platformLatencyMs).toISOString();
      validateAdapterOutput(output, input, selection.selected);
      const contextDigest = sha256(selection.selected.map((item) => ({ ...item, contentDigest: sha256(item.content) })));
      const workGraphDigest = sha256(output.workGraph);
      const trustedEvidenceRefs = [...new Set(selection.selected.filter((item) => item.trust === 'TRUSTED').flatMap((item) => item.evidenceRefs ?? []))].sort();
      const platformUsage = { inputChars: selection.selected.reduce((sum, item) => sum + item.content.length, 0), outputChars: output.output.length, latencyMs: platformLatencyMs };
      const providerReport: ProviderReportedExecution = { usage: structuredClone(output.usage), startedAt: output.startedAt, finishedAt: output.finishedAt };
      const receiptMaterial = {
        receiptId: randomUUID(), requestId: request.requestId, requestDigest, tenantId: request.tenantId, subjectId: request.subjectId,
        requesterId: request.requesterId, purpose: request.purpose, provider: output.provider, model: output.model,
        selectedContextIds: selection.selected.map((item) => item.contextId), trustedEvidenceRefs, untrustedContextIds: selection.selected.filter((item) => item.trust === 'UNTRUSTED').map((item) => item.contextId).sort(), droppedContext: selection.dropped,
        contextDigest, output: output.output, outputDigest: sha256(output.output), claims: structuredClone(output.claims), workGraph: structuredClone(output.workGraph), workGraphDigest,
        usage: platformUsage, providerReport, ...(output.providerBoundaryProof === undefined ? {} : { providerBoundaryProof: structuredClone(output.providerBoundaryProof) }), externalInteractionsExecuted: output.providerBoundaryProof === undefined ? 0 as const : 1 as const, externalMutationsExecuted: 0 as const, startedAt: platformStartedAt, finishedAt: platformFinishedAt, status: 'PROPOSAL_ONLY' as const, promotionCeiling: 'research' as const,
        limitations: [...new Set([...output.limitations, 'model-output-is-not-authority', 'tool-nodes-are-proposals-not-effects', 'independent-review-required-before-change', 'provider-reported-timing-and-usage-are-diagnostic-only', 'supported-claims-require-selected-trusted-evidence', 'prompt-injection-detection-is-heuristic-and-authority-containment-remains-primary'])].sort(),
      };
      const evidence: EvidenceRecord = {
        recordId: `model-run:${request.requestId}`, tenantId: request.tenantId, kind: 'governed-model-execution', subject: request.subjectId,
        payload: { requestDigest, contextDigest, outputDigest: receiptMaterial.outputDigest, workGraphDigest, provider: output.provider, model: output.model, platformUsage, providerReport, ...(output.providerBoundaryProof === undefined ? {} : { providerBoundaryProof: output.providerBoundaryProof }), externalInteractionsExecuted: output.providerBoundaryProof === undefined ? 0 : 1, externalMutationsExecuted: 0, selectedContextCount: selection.selected.length, untrustedContextCount: selection.selected.filter((item) => item.trust === 'UNTRUSTED').length, droppedContextCount: selection.dropped.length, trustedEvidenceRefs, proposalOnly: true },
        evidenceClass: 'COMPUTED', method: 'canonical.governedModelOrchestrator.v31', environment: { runtime: 'node', provider: output.provider, model: output.model }, createdAt: platformFinishedAt, limitations: receiptMaterial.limitations,
      };
      const receipt: GovernedModelReceipt = { ...receiptMaterial, evidence };
      const signedReceipt = signEnvelope(receipt, this.receiptSigner);
      this.store.put({ requestId: request.requestId, requestDigest, signedReceipt });
      return signedReceipt;
    }, request.budget.maxLatencyMs + 5_000);
  }
}

function validateRequest(request: GovernedModelRequest): void {
  for (const [value, code] of [
    [request.requestId, 'model_request_id_required'], [request.tenantId, 'model_tenant_id_required'],
    [request.subjectId, 'model_subject_id_required'], [request.requesterId, 'model_requester_id_required'],
    [request.objective, 'model_objective_required'],
  ] as const) if (value.trim() === '') throw new Error(code);
  if (!MODEL_PURPOSES.includes(request.purpose)) throw new Error('model_purpose_invalid');
  if (!Number.isFinite(Date.parse(request.createdAt))) throw new Error('model_request_time_invalid');
  if (request.allowedTools.length === 0 || new Set(request.allowedTools).size !== request.allowedTools.length) throw new Error('model_tools_invalid');
  if (request.allowedTools.some((tool) => !MODEL_TOOLS.includes(tool))) throw new Error('model_tool_forbidden');
  validateBudget(request.budget);
  const contextIds = new Set<string>();
  for (const item of request.context) {
    if (item.contextId.trim() === '' || item.source.trim() === '' || item.content.trim() === '') throw new Error('model_context_invalid');
    if (contextIds.has(item.contextId)) throw new Error('model_context_duplicate');
    contextIds.add(item.contextId);
    if (!Number.isFinite(item.priority)) throw new Error('model_context_priority_invalid');
    if (item.evidenceRefs !== undefined && (new Set(item.evidenceRefs).size !== item.evidenceRefs.length || item.evidenceRefs.some((ref) => ref.trim() === ''))) throw new Error('model_context_evidence_invalid');
  }
}
function validateBudget(budget: ModelExecutionBudget): void {
  const values = Object.values(budget);
  if (values.some((value) => !Number.isInteger(value) || value <= 0)) throw new Error('model_budget_invalid');
  if (budget.maxContextChars > 2_000_000 || budget.maxOutputChars > 500_000 || budget.maxGraphNodes > 500 || budget.maxToolProposals > 100 || budget.maxLatencyMs > 3_600_000) {
    throw new Error('model_budget_excessive');
  }
}
function selectContext(context: readonly ModelContextItem[], maxChars: number): { selected: ModelContextItem[]; dropped: DroppedModelContext[] } {
  const selected: ModelContextItem[] = [];
  const dropped: DroppedModelContext[] = [];
  let used = 0;
  for (const item of [...context].sort((a, b) => b.priority - a.priority || a.contextId.localeCompare(b.contextId))) {
    if (item.trust === 'UNTRUSTED' && looksLikePromptInjection(item.content)) {
      dropped.push({ contextId: item.contextId, reason: 'PROMPT_INJECTION', digest: sha256(item.content) });
    } else if (used + item.content.length > maxChars) {
      dropped.push({ contextId: item.contextId, reason: 'CONTEXT_BUDGET', digest: sha256(item.content) });
    } else {
      selected.push(structuredClone(item)); used += item.content.length;
    }
  }
  return { selected, dropped };
}
function validateAdapterOutput(output: ModelAdapterOutput, input: ModelAdapterInput, selectedContext: readonly ModelContextItem[]): void {
  if (output.provider.trim() === '' || output.model.trim() === '' || output.output.trim() === '') throw new Error('model_output_identity_or_content_required');
  const started = Date.parse(output.startedAt); const finished = Date.parse(output.finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) throw new Error('model_output_time_invalid');
  if (!Number.isInteger(output.usage.inputChars) || output.usage.inputChars < 0 || output.usage.outputChars !== output.output.length || output.usage.latencyMs !== finished - started) throw new Error('model_usage_invalid');
  if (output.usage.inputChars > input.budget.maxContextChars || output.usage.outputChars > input.budget.maxOutputChars || output.usage.latencyMs > input.budget.maxLatencyMs) throw new Error('model_budget_exceeded');
  if (output.claims.length > input.budget.maxClaims) throw new Error('model_claim_budget_exceeded');
  const claimIds = new Set<string>();
  const allEvidenceRefs = new Set(selectedContext.flatMap((item) => item.evidenceRefs ?? []));
  const trustedEvidenceRefs = new Set(selectedContext.filter((item) => item.trust === 'TRUSTED').flatMap((item) => item.evidenceRefs ?? []));
  for (const claim of output.claims) {
    if (claim.claimId.trim() === '' || claim.statement.trim() === '' || claimIds.has(claim.claimId)) throw new Error('model_claim_invalid');
    claimIds.add(claim.claimId);
    if (new Set(claim.evidenceRefs).size !== claim.evidenceRefs.length || claim.evidenceRefs.some((ref) => ref.trim() === '')) throw new Error('model_claim_evidence_invalid');
    if (claim.evidenceRefs.some((ref) => !allEvidenceRefs.has(ref))) throw new Error('model_claim_evidence_unbound');
    if (claim.classification === 'SUPPORTED' && claim.evidenceRefs.length === 0) throw new Error('model_supported_claim_missing_evidence');
    if (claim.classification === 'SUPPORTED' && claim.evidenceRefs.some((ref) => !trustedEvidenceRefs.has(ref))) throw new Error('model_supported_claim_requires_trusted_evidence');
  }
  validateWorkGraph(output.workGraph, input.allowedTools, input.budget);
}
function validateWorkGraph(nodes: readonly ModelWorkNode[], allowedTools: readonly ModelTool[], budget: ModelExecutionBudget): void {
  if (nodes.length === 0 || nodes.length > budget.maxGraphNodes) throw new Error('model_work_graph_size_invalid');
  const ids = new Set<string>(); let toolCount = 0;
  for (const node of nodes) {
    if (node.nodeId.trim() === '' || node.summary.trim() === '' || ids.has(node.nodeId)) throw new Error('model_work_node_invalid');
    ids.add(node.nodeId);
    if (node.requestedTool !== undefined) {
      toolCount += 1;
      if (!allowedTools.includes(node.requestedTool)) throw new Error('model_work_tool_not_allowed');
      if (node.kind === 'CHANGE_PROPOSAL' && node.requestedTool !== 'change.propose') throw new Error('model_change_node_requires_proposal_tool');
    }
  }
  if (toolCount > budget.maxToolProposals) throw new Error('model_tool_proposal_budget_exceeded');
  for (const node of nodes) for (const dependency of node.dependsOn) if (!ids.has(dependency) || dependency === node.nodeId) throw new Error('model_work_dependency_invalid');
  const state = new Map<string, 'visiting' | 'done'>();
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const visit = (id: string): void => {
    if (state.get(id) === 'visiting') throw new Error('model_work_graph_cycle');
    if (state.get(id) === 'done') return;
    state.set(id, 'visiting');
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    state.set(id, 'done');
  };
  for (const id of ids) visit(id);
}

async function invokeWithTimeout(adapter: GovernedModelAdapter, input: ModelAdapterInput, timeoutMs: number): Promise<ModelAdapterOutput> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('model_execution_timeout')), timeoutMs); });
  try { return await Promise.race([adapter.invoke(input), timeout]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
function purposeScope(purpose: ModelPurpose): string { return `model.${purpose.toLowerCase()}`; }
function looksLikePromptInjection(content: string): boolean {
  const normalized = content.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').toLowerCase();
  const words = normalized.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const compact = words.replace(/\s+/g, '');
  return /(ignore (all |the )?(previous|prior) instructions|reveal (the )?(system|developer) prompt|disable .*test|exfiltrat|upload .*secret|override .*policy|execute .*production|bypass .*review|grant .*authority)/i.test(words)
    || /(ignore(all|the)?(previous|prior)instructions|reveal(the)?(system|developer)prompt|disable(any|all)?tests?|exfiltrat|upload(any)?secrets?|override(any)?policy|execute(any)?production|bypass(any)?review|grant(any)?authority)/i.test(compact);
}
function modelRunRecord(run: Omit<StoredModelRun, 'version' | 'digest'>): StoredModelRun {
  const material = { version: 1 as const, ...structuredClone(run) };
  return { ...material, digest: sha256(material) };
}
function verifyModelRunRecord(row: StoredModelRun): void {
  const { digest, ...material } = row;
  if (row.version !== 1 || digest !== sha256(material)) throw new Error('model_run_store_tampered');
}
function atomicReplace(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
}
function fsyncDirectory(path: string): void { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
