import { randomUUID } from 'node:crypto';
import { sha256 } from '../contracts/crypto.js';

export type DataSensitivity = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
export type ExecutionTarget =
  | 'CACHE_EXACT'
  | 'CACHE_SEMANTIC'
  | 'LOCAL_RULES'
  | 'LOCAL_MODEL'
  | 'LOCAL_ASYNC'
  | 'BURST_NODE'
  | 'EXTERNAL_MODEL'
  | 'BLOCK';

export interface SovereignWorkRequest {
  readonly requestId: string;
  readonly tenantId: string;
  readonly workloadId: string;
  readonly operation: string;
  readonly input: unknown;
  readonly sensitivity: DataSensitivity;
  readonly deterministic: boolean;
  readonly cacheable: boolean;
  readonly semanticReuseAllowed: boolean;
  readonly allowAsync: boolean;
  readonly freshnessMs: number;
  readonly requiredQuality: number;
  readonly estimatedComputeUnits: number;
  readonly latencyBudgetMs: number;
  readonly sourceDigest: string;
  readonly policyDigest: string;
  readonly authorityDigest: string;
}

export interface SovereignRoutingPolicy {
  readonly tenantId: string;
  readonly allowLocalModel: boolean;
  readonly allowBurstNode: boolean;
  readonly allowExternalModel: boolean;
  readonly maximumExternalSensitivity: Exclude<DataSensitivity, 'RESTRICTED'>;
  readonly maximumExternalCostMicros: number;
  readonly localModelMaximumQuality: number;
  readonly localSynchronousComputeUnits: number;
  readonly localAsynchronousComputeUnits: number;
  readonly cacheSimilarityFloor: number;
}

export interface ExecutionEstimate {
  readonly externalCostMicros: number;
  readonly localModelQuality: number;
  readonly localRulesLatencyMs: number;
  readonly localModelLatencyMs: number;
  readonly asyncAdmissionLatencyMs: number;
  readonly burstLatencyMs: number;
  readonly externalLatencyMs: number;
  readonly burstAvailable: boolean;
}

export interface CachedExecution {
  readonly cacheId: string;
  readonly tenantId: string;
  readonly workloadId: string;
  readonly operation: string;
  readonly exactKey: string;
  readonly semanticTokens: readonly string[];
  readonly sensitivity: DataSensitivity;
  readonly sourceDigest: string;
  readonly policyDigest: string;
  readonly authorityDigest: string;
  readonly result: unknown;
  readonly resultDigest: string;
  readonly evidenceDigest: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastAccessSequence: number;
}

export interface CacheLookup {
  readonly kind: 'EXACT' | 'SEMANTIC';
  readonly entry: CachedExecution;
  readonly similarity: number;
}

export interface ExecutionOutcome {
  readonly requestId: string;
  readonly tenantId: string;
  readonly target: Exclude<ExecutionTarget, 'BLOCK'>;
  readonly result: unknown;
  readonly resultDigest: string;
  readonly evidenceDigest: string;
  readonly cacheHit: boolean;
  readonly deduplicated: boolean;
  readonly savedExternalCostMicros: number;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface FabricHandlers {
  readonly localRules: (request: SovereignWorkRequest) => Promise<HandlerResult>;
  readonly localModel: (request: SovereignWorkRequest) => Promise<HandlerResult>;
  readonly localAsync: (request: SovereignWorkRequest) => Promise<HandlerResult>;
  readonly burstNode: (request: SovereignWorkRequest) => Promise<HandlerResult>;
  readonly externalModel: (request: SovereignWorkRequest) => Promise<HandlerResult>;
}

export interface HandlerResult {
  readonly result: unknown;
  readonly evidenceDigest: string;
}

interface CostEventMaterial {
  readonly sequence: number;
  readonly occurredAt: string;
  readonly tenantId: string;
  readonly workloadId: string;
  readonly route: Exclude<ExecutionTarget, 'BLOCK'>;
  readonly cacheHit: boolean;
  readonly deduplicated: boolean;
  readonly externalCostMicros: number;
  readonly savedExternalCostMicros: number;
  readonly computeUnits: number;
  readonly previousDigest: string | null;
}

export interface CostEvent extends CostEventMaterial { readonly digest: string; }

export interface CostSummary {
  readonly operations: number;
  readonly cacheHits: number;
  readonly deduplicatedOperations: number;
  readonly externalOperations: number;
  readonly localOperations: number;
  readonly externalCostMicros: number;
  readonly savedExternalCostMicros: number;
  readonly savingsRate: number;
  readonly chainValid: boolean;
}

export class SovereignCostLedger {
  readonly #events: CostEvent[] = [];

  append(input: Omit<CostEventMaterial, 'sequence' | 'previousDigest'>): CostEvent {
    validateNonEmpty(input.tenantId, 'cost_tenant_required');
    validateNonEmpty(input.workloadId, 'cost_workload_required');
    validateNonNegativeInteger(input.externalCostMicros, 'cost_external_invalid');
    validateNonNegativeInteger(input.savedExternalCostMicros, 'cost_saved_invalid');
    validatePositiveInteger(input.computeUnits, 'cost_compute_units_invalid');
    if (!Number.isFinite(Date.parse(input.occurredAt))) throw new Error('cost_time_invalid');
    const material: CostEventMaterial = {
      ...input,
      sequence: this.#events.length + 1,
      previousDigest: this.#events.at(-1)?.digest ?? null,
    };
    const event: CostEvent = { ...material, digest: sha256(material) };
    this.#events.push(event);
    return structuredClone(event);
  }

  list(): readonly CostEvent[] { return structuredClone(this.#events); }

  verify(): boolean {
    let previous: string | null = null;
    for (const event of this.#events) {
      const { digest, ...material } = event;
      if (material.previousDigest !== previous || digest !== sha256(material)) return false;
      previous = digest;
    }
    return true;
  }

  summary(): CostSummary {
    const externalCostMicros = this.#events.reduce((sum, item) => sum + item.externalCostMicros, 0);
    const savedExternalCostMicros = this.#events.reduce((sum, item) => sum + item.savedExternalCostMicros, 0);
    const denominator = externalCostMicros + savedExternalCostMicros;
    return {
      operations: this.#events.length,
      cacheHits: this.#events.filter((item) => item.cacheHit).length,
      deduplicatedOperations: this.#events.filter((item) => item.deduplicated).length,
      externalOperations: this.#events.filter((item) => item.route === 'EXTERNAL_MODEL').length,
      localOperations: this.#events.filter((item) => item.route !== 'EXTERNAL_MODEL').length,
      externalCostMicros,
      savedExternalCostMicros,
      savingsRate: denominator === 0 ? 0 : Number((savedExternalCostMicros / denominator).toFixed(6)),
      chainValid: this.verify(),
    };
  }
}

export class TenantSemanticCache {
  readonly #entries = new Map<string, CachedExecution>();
  #sequence = 0;

  constructor(readonly maximumEntriesPerTenant: number) {
    validatePositiveInteger(maximumEntriesPerTenant, 'cache_capacity_invalid');
  }

  lookup(request: SovereignWorkRequest, similarityFloor: number, now = new Date()): CacheLookup | undefined {
    validateRequest(request);
    validateRatio(similarityFloor, 'cache_similarity_floor_invalid');
    if (!Number.isFinite(now.getTime())) throw new Error('cache_time_invalid');
    const exactKey = exactCacheKey(request);
    const exact = this.#entries.get(exactKey);
    if (exact !== undefined && this.#eligible(exact, request, now)) {
      const updated = { ...exact, lastAccessSequence: ++this.#sequence };
      this.#entries.set(exactKey, updated);
      return { kind: 'EXACT', entry: structuredClone(updated), similarity: 1 };
    }
    if (!request.semanticReuseAllowed || request.sensitivity === 'RESTRICTED') return undefined;
    const requestTokens = semanticTokens(request.input);
    if (requestTokens.length === 0) return undefined;
    let best: CachedExecution | undefined;
    let bestScore = -1;
    for (const entry of this.#entries.values()) {
      if (!this.#eligible(entry, request, now) || entry.semanticTokens.length === 0) continue;
      const score = jaccard(requestTokens, entry.semanticTokens);
      if (score > bestScore || (score === bestScore && best !== undefined && entry.cacheId.localeCompare(best.cacheId) < 0)) {
        best = entry;
        bestScore = score;
      }
    }
    if (best === undefined || bestScore < similarityFloor) return undefined;
    const updated = { ...best, lastAccessSequence: ++this.#sequence };
    this.#entries.set(best.exactKey, updated);
    return { kind: 'SEMANTIC', entry: structuredClone(updated), similarity: Number(bestScore.toFixed(6)) };
  }

  put(request: SovereignWorkRequest, result: unknown, evidenceDigest: string, now = new Date()): CachedExecution {
    validateRequest(request);
    if (!request.cacheable) throw new Error('cache_request_not_cacheable');
    validateDigest(evidenceDigest, 'cache_evidence_digest_invalid');
    if (!Number.isFinite(now.getTime())) throw new Error('cache_time_invalid');
    const exactKey = exactCacheKey(request);
    const entry: CachedExecution = {
      cacheId: `cache-${randomUUID()}`,
      tenantId: request.tenantId,
      workloadId: request.workloadId,
      operation: request.operation,
      exactKey,
      semanticTokens: request.semanticReuseAllowed && request.sensitivity !== 'RESTRICTED' ? semanticTokens(request.input) : [],
      sensitivity: request.sensitivity,
      sourceDigest: request.sourceDigest,
      policyDigest: request.policyDigest,
      authorityDigest: request.authorityDigest,
      result: structuredClone(result),
      resultDigest: sha256(result),
      evidenceDigest,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + request.freshnessMs).toISOString(),
      lastAccessSequence: ++this.#sequence,
    };
    const existing = this.#entries.get(exactKey);
    if (existing !== undefined && existing.resultDigest !== entry.resultDigest) throw new Error('cache_exact_key_conflict');
    this.#entries.set(exactKey, entry);
    this.#evict(request.tenantId);
    return structuredClone(entry);
  }

  size(tenantId?: string): number {
    return tenantId === undefined ? this.#entries.size : [...this.#entries.values()].filter((item) => item.tenantId === tenantId).length;
  }

  #eligible(entry: CachedExecution, request: SovereignWorkRequest, now: Date): boolean {
    return entry.tenantId === request.tenantId
      && entry.workloadId === request.workloadId
      && entry.operation === request.operation
      && entry.sensitivity === request.sensitivity
      && entry.sourceDigest === request.sourceDigest
      && entry.policyDigest === request.policyDigest
      && entry.authorityDigest === request.authorityDigest
      && now.getTime() < Date.parse(entry.expiresAt);
  }

  #evict(tenantId: string): void {
    const tenantEntries = [...this.#entries.values()].filter((item) => item.tenantId === tenantId);
    while (tenantEntries.length > this.maximumEntriesPerTenant) {
      tenantEntries.sort((a, b) => a.lastAccessSequence - b.lastAccessSequence || a.cacheId.localeCompare(b.cacheId));
      const victim = tenantEntries.shift();
      if (victim !== undefined) this.#entries.delete(victim.exactKey);
    }
  }
}

export interface AdmissionLease { readonly leaseId: string; readonly tenantId: string; readonly units: number; }

export class SovereignAdmissionController {
  readonly #tenantActive = new Map<string, number>();
  readonly #leases = new Map<string, AdmissionLease>();
  #globalActive = 0;

  constructor(readonly globalUnits: number, readonly tenantUnits: number) {
    validatePositiveInteger(globalUnits, 'admission_global_units_invalid');
    validatePositiveInteger(tenantUnits, 'admission_tenant_units_invalid');
    if (tenantUnits > globalUnits) throw new Error('admission_tenant_exceeds_global');
  }

  acquire(tenantId: string, units: number): AdmissionLease {
    validateNonEmpty(tenantId, 'admission_tenant_required');
    validatePositiveInteger(units, 'admission_units_invalid');
    if (units > this.tenantUnits) throw new Error('admission_request_exceeds_tenant_capacity');
    const tenantActive = this.#tenantActive.get(tenantId) ?? 0;
    if (tenantActive + units > this.tenantUnits) throw new Error('admission_tenant_saturated');
    if (this.#globalActive + units > this.globalUnits) throw new Error('admission_global_saturated');
    const lease: AdmissionLease = { leaseId: `admission-${randomUUID()}`, tenantId, units };
    this.#leases.set(lease.leaseId, lease);
    this.#tenantActive.set(tenantId, tenantActive + units);
    this.#globalActive += units;
    return lease;
  }

  release(lease: AdmissionLease): void {
    const current = this.#leases.get(lease.leaseId);
    if (current === undefined) throw new Error('admission_lease_unknown');
    if (sha256(current) !== sha256(lease)) throw new Error('admission_lease_mismatch');
    this.#leases.delete(lease.leaseId);
    const next = (this.#tenantActive.get(lease.tenantId) ?? 0) - lease.units;
    if (next < 0) throw new Error('admission_accounting_corrupt');
    if (next === 0) this.#tenantActive.delete(lease.tenantId); else this.#tenantActive.set(lease.tenantId, next);
    this.#globalActive -= lease.units;
  }

  snapshot(): { readonly globalActive: number; readonly tenantActive: Readonly<Record<string, number>>; readonly activeLeases: number } {
    return { globalActive: this.#globalActive, tenantActive: Object.fromEntries([...this.#tenantActive.entries()].sort()), activeLeases: this.#leases.size };
  }
}

interface InFlight { readonly requestDigest: string; readonly promise: Promise<HandlerResult>; }

export class SingleFlightCoordinator {
  readonly #inFlight = new Map<string, InFlight>();
  #joins = 0;

  async run(key: string, requestDigest: string, operation: () => Promise<HandlerResult>): Promise<{ readonly value: HandlerResult; readonly deduplicated: boolean }> {
    validateNonEmpty(key, 'singleflight_key_required');
    validateDigest(requestDigest, 'singleflight_request_digest_invalid');
    const existing = this.#inFlight.get(key);
    if (existing !== undefined) {
      if (existing.requestDigest !== requestDigest) throw new Error('singleflight_key_conflict');
      this.#joins += 1;
      return { value: structuredClone(await existing.promise), deduplicated: true };
    }
    const promise = operation();
    this.#inFlight.set(key, { requestDigest, promise });
    try { return { value: structuredClone(await promise), deduplicated: false }; }
    finally {
      const current = this.#inFlight.get(key);
      if (current?.promise === promise) this.#inFlight.delete(key);
    }
  }

  get active(): number { return this.#inFlight.size; }
  get joins(): number { return this.#joins; }
}

export function chooseExecutionTarget(
  request: SovereignWorkRequest,
  policy: SovereignRoutingPolicy,
  estimate: ExecutionEstimate,
  cache: CacheLookup | undefined,
): ExecutionTarget {
  validateRequest(request);
  validatePolicy(policy);
  validateEstimate(estimate);
  if (policy.tenantId !== request.tenantId) throw new Error('routing_policy_tenant_mismatch');
  if (cache !== undefined) return cache.kind === 'EXACT' ? 'CACHE_EXACT' : 'CACHE_SEMANTIC';
  if (request.deterministic && estimate.localRulesLatencyMs <= request.latencyBudgetMs) return 'LOCAL_RULES';
  if (policy.allowLocalModel && request.requiredQuality <= policy.localModelMaximumQuality && estimate.localModelQuality >= request.requiredQuality && request.estimatedComputeUnits <= policy.localSynchronousComputeUnits && estimate.localModelLatencyMs <= request.latencyBudgetMs) return 'LOCAL_MODEL';
  if (request.allowAsync && request.estimatedComputeUnits <= policy.localAsynchronousComputeUnits && estimate.asyncAdmissionLatencyMs <= request.latencyBudgetMs) return 'LOCAL_ASYNC';
  if (policy.allowBurstNode && estimate.burstAvailable && estimate.burstLatencyMs <= request.latencyBudgetMs) return 'BURST_NODE';
  const sensitivityAllowed = sensitivityRank(request.sensitivity) <= sensitivityRank(policy.maximumExternalSensitivity);
  if (policy.allowExternalModel && sensitivityAllowed && estimate.externalCostMicros <= policy.maximumExternalCostMicros && estimate.externalLatencyMs <= request.latencyBudgetMs) return 'EXTERNAL_MODEL';
  return 'BLOCK';
}

export class SovereignEfficiencyFabric {
  constructor(
    readonly cache: TenantSemanticCache,
    readonly admission: SovereignAdmissionController,
    readonly singleFlight: SingleFlightCoordinator,
    readonly costs: SovereignCostLedger,
    readonly handlers: FabricHandlers,
  ) {}

  async execute(request: SovereignWorkRequest, policy: SovereignRoutingPolicy, estimate: ExecutionEstimate, now = new Date()): Promise<ExecutionOutcome> {
    validateRequest(request);
    validatePolicy(policy);
    validateEstimate(estimate);
    if (!Number.isFinite(now.getTime())) throw new Error('execution_time_invalid');
    const cache = request.cacheable ? this.cache.lookup(request, policy.cacheSimilarityFloor, now) : undefined;
    const target = chooseExecutionTarget(request, policy, estimate, cache);
    if (target === 'BLOCK') throw new Error('sovereign_execution_blocked');
    const startedAt = now.toISOString();
    if (cache !== undefined) {
      const finishedAt = new Date(now.getTime()).toISOString();
      const outcome: ExecutionOutcome = {
        requestId: request.requestId,
        tenantId: request.tenantId,
        target,
        result: structuredClone(cache.entry.result),
        resultDigest: cache.entry.resultDigest,
        evidenceDigest: cache.entry.evidenceDigest,
        cacheHit: true,
        deduplicated: false,
        savedExternalCostMicros: estimate.externalCostMicros,
        startedAt,
        finishedAt,
      };
      this.#record(request, outcome, estimate);
      return outcome;
    }
    if (target === 'CACHE_EXACT' || target === 'CACHE_SEMANTIC') throw new Error('cache_route_without_entry');
    const { requestId: _requestId, ...workMaterial } = request;
    const requestDigest = sha256(workMaterial);
    const key = sha256({ tenantId: request.tenantId, workloadId: request.workloadId, operation: request.operation, requestDigest });
    const handler = this.#handler(target);
    const admissionUnits = target === 'LOCAL_RULES' || target === 'LOCAL_MODEL' ? request.estimatedComputeUnits : 1;
    const { value, deduplicated } = await this.singleFlight.run(key, requestDigest, async () => {
      const lease = this.admission.acquire(request.tenantId, admissionUnits);
      try { return await handler(structuredClone(request)); }
      finally { this.admission.release(lease); }
    });
    validateDigest(value.evidenceDigest, 'execution_evidence_digest_invalid');
    const finishedAt = new Date().toISOString();
    const resultDigest = sha256(value.result);
    if (request.cacheable) this.cache.put(request, value.result, value.evidenceDigest, new Date(finishedAt));
    const outcome: ExecutionOutcome = {
      requestId: request.requestId,
      tenantId: request.tenantId,
      target,
      result: structuredClone(value.result),
      resultDigest,
      evidenceDigest: value.evidenceDigest,
      cacheHit: false,
      deduplicated,
      savedExternalCostMicros: target === 'EXTERNAL_MODEL' ? 0 : estimate.externalCostMicros,
      startedAt,
      finishedAt,
    };
    this.#record(request, outcome, estimate);
    return outcome;
  }

  #handler(target: Exclude<ExecutionTarget, 'BLOCK' | 'CACHE_EXACT' | 'CACHE_SEMANTIC'>): (request: SovereignWorkRequest) => Promise<HandlerResult> {
    if (target === 'LOCAL_RULES') return this.handlers.localRules;
    if (target === 'LOCAL_MODEL') return this.handlers.localModel;
    if (target === 'LOCAL_ASYNC') return this.handlers.localAsync;
    if (target === 'BURST_NODE') return this.handlers.burstNode;
    return this.handlers.externalModel;
  }

  #record(request: SovereignWorkRequest, outcome: ExecutionOutcome, estimate: ExecutionEstimate): void {
    this.costs.append({
      occurredAt: outcome.finishedAt,
      tenantId: request.tenantId,
      workloadId: request.workloadId,
      route: outcome.target,
      cacheHit: outcome.cacheHit,
      deduplicated: outcome.deduplicated,
      externalCostMicros: outcome.target === 'EXTERNAL_MODEL' ? estimate.externalCostMicros : 0,
      savedExternalCostMicros: outcome.savedExternalCostMicros,
      computeUnits: request.estimatedComputeUnits,
    });
  }
}

export function exactCacheKey(request: SovereignWorkRequest): string {
  return sha256({
    tenantId: request.tenantId,
    workloadId: request.workloadId,
    operation: request.operation,
    input: request.input,
    sensitivity: request.sensitivity,
    sourceDigest: request.sourceDigest,
    policyDigest: request.policyDigest,
    authorityDigest: request.authorityDigest,
  });
}

export function semanticTokens(input: unknown): readonly string[] {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  if (text === undefined) return [];
  return [...new Set(text.normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) ?? [])].sort();
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left), b = new Set(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function validateRequest(request: SovereignWorkRequest): void {
  for (const [value, code] of [[request.requestId, 'request_id_required'], [request.tenantId, 'request_tenant_required'], [request.workloadId, 'request_workload_required'], [request.operation, 'request_operation_required']] as const) validateNonEmpty(value, code);
  if (!['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'].includes(request.sensitivity)) throw new Error('request_sensitivity_invalid');
  validatePositiveInteger(request.freshnessMs, 'request_freshness_invalid');
  validateRatio(request.requiredQuality, 'request_quality_invalid');
  validatePositiveInteger(request.estimatedComputeUnits, 'request_compute_units_invalid');
  validatePositiveInteger(request.latencyBudgetMs, 'request_latency_budget_invalid');
  validateDigest(request.sourceDigest, 'request_source_digest_invalid');
  validateDigest(request.policyDigest, 'request_policy_digest_invalid');
  validateDigest(request.authorityDigest, 'request_authority_digest_invalid');
  sha256(request.input);
}

function validatePolicy(policy: SovereignRoutingPolicy): void {
  validateNonEmpty(policy.tenantId, 'policy_tenant_required');
  if (!['PUBLIC', 'INTERNAL', 'CONFIDENTIAL'].includes(policy.maximumExternalSensitivity)) throw new Error('policy_external_sensitivity_invalid');
  validateNonNegativeInteger(policy.maximumExternalCostMicros, 'policy_external_cost_invalid');
  validateRatio(policy.localModelMaximumQuality, 'policy_local_quality_invalid');
  validatePositiveInteger(policy.localSynchronousComputeUnits, 'policy_sync_units_invalid');
  validatePositiveInteger(policy.localAsynchronousComputeUnits, 'policy_async_units_invalid');
  if (policy.localAsynchronousComputeUnits < policy.localSynchronousComputeUnits) throw new Error('policy_async_below_sync');
  validateRatio(policy.cacheSimilarityFloor, 'policy_similarity_floor_invalid');
}

function validateEstimate(estimate: ExecutionEstimate): void {
  validateNonNegativeInteger(estimate.externalCostMicros, 'estimate_external_cost_invalid');
  validateRatio(estimate.localModelQuality, 'estimate_local_quality_invalid');
  for (const [value, code] of [
    [estimate.localRulesLatencyMs, 'estimate_rules_latency_invalid'],
    [estimate.localModelLatencyMs, 'estimate_local_latency_invalid'],
    [estimate.asyncAdmissionLatencyMs, 'estimate_async_latency_invalid'],
    [estimate.burstLatencyMs, 'estimate_burst_latency_invalid'],
    [estimate.externalLatencyMs, 'estimate_external_latency_invalid'],
  ] as const) validateNonNegativeInteger(value, code);
}

function validateNonEmpty(value: string, code: string): void { if (value.trim() === '') throw new Error(code); }
function validatePositiveInteger(value: number, code: string): void { if (!Number.isInteger(value) || value <= 0) throw new Error(code); }
function validateNonNegativeInteger(value: number, code: string): void { if (!Number.isInteger(value) || value < 0) throw new Error(code); }
function validateRatio(value: number, code: string): void { if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(code); }
function validateDigest(value: string, code: string): void { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(code); }
function sensitivityRank(value: DataSensitivity): number { return ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'].indexOf(value); }
