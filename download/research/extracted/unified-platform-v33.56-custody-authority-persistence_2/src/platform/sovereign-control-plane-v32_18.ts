import { sha256 } from '../contracts/crypto.js';

export interface ResiliencyPolicyInputV32_18 {
  readonly operationId: string;
  readonly idempotent: boolean;
  readonly idempotencyKeyRequired: boolean;
  readonly timeoutMs: number;
  readonly retry: { readonly maxAttempts: number; readonly initialDelayMs: number; readonly maximumDelayMs: number; readonly multiplier: number; readonly jitter: 'NONE' | 'FULL' };
  readonly circuitBreaker: { readonly failureThreshold: number; readonly recoveryTimeoutMs: number; readonly halfOpenMaxCalls: number };
  readonly bulkhead: { readonly maximumConcurrent: number; readonly maximumQueue: number };
}
export interface CompiledResiliencyPolicyV32_18 extends ResiliencyPolicyInputV32_18 {
  readonly schemaVersion: '32.18';
  readonly retryBudgetMs: number;
  readonly worstCaseDurationMs: number;
  readonly policyDigest: string;
}
export function compileResiliencyPolicyV32_18(input: ResiliencyPolicyInputV32_18): CompiledResiliencyPolicyV32_18 {
  if (!/^[a-z0-9][a-z0-9._:-]{2,127}$/.test(input.operationId)) throw new Error('resiliency_operation_id_invalid');
  for (const [name, value] of Object.entries({ timeoutMs: input.timeoutMs, maxAttempts: input.retry.maxAttempts, initialDelayMs: input.retry.initialDelayMs, maximumDelayMs: input.retry.maximumDelayMs, failureThreshold: input.circuitBreaker.failureThreshold, recoveryTimeoutMs: input.circuitBreaker.recoveryTimeoutMs, halfOpenMaxCalls: input.circuitBreaker.halfOpenMaxCalls, maximumConcurrent: input.bulkhead.maximumConcurrent, maximumQueue: input.bulkhead.maximumQueue })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`resiliency_positive_integer_required:${name}`);
  }
  if (!Number.isFinite(input.retry.multiplier) || input.retry.multiplier < 1 || input.retry.multiplier > 10) throw new Error('resiliency_retry_multiplier_invalid');
  if (input.retry.initialDelayMs > input.retry.maximumDelayMs) throw new Error('resiliency_retry_delay_order_invalid');
  if (input.retry.maxAttempts > 1 && !input.idempotent && !input.idempotencyKeyRequired) throw new Error('resiliency_retry_requires_idempotency');
  if (input.retry.maxAttempts > 10) throw new Error('resiliency_retry_attempts_excessive');
  if (input.timeoutMs > 120_000 || input.circuitBreaker.recoveryTimeoutMs > 3_600_000 || input.bulkhead.maximumConcurrent > 10_000 || input.bulkhead.maximumQueue > 100_000) throw new Error('resiliency_resource_bound_exceeded');
  let retryBudgetMs = 0;
  let delay = input.retry.initialDelayMs;
  for (let attempt = 1; attempt < input.retry.maxAttempts; attempt += 1) {
    retryBudgetMs += Math.min(input.retry.maximumDelayMs, Math.ceil(delay));
    delay *= input.retry.multiplier;
  }
  const worstCaseDurationMs = input.timeoutMs * input.retry.maxAttempts + retryBudgetMs;
  if (worstCaseDurationMs > 600_000) throw new Error('resiliency_worst_case_duration_exceeded');
  const material = { schemaVersion: '32.18' as const, ...input, retryBudgetMs, worstCaseDurationMs };
  return { ...material, policyDigest: sha256(material) };
}

export type DurableStepStateV32_18 = 'STARTED' | 'COMPLETED' | 'FAILED' | 'COMPENSATED';
export interface DurableHistoryEventV32_18 {
  readonly runId: string;
  readonly workflowId: string;
  readonly sequence: number;
  readonly stepId: string;
  readonly state: DurableStepStateV32_18;
  readonly effectId?: string;
  readonly payloadDigest: string;
  readonly previousEventDigest: string | null;
  readonly eventDigest: string;
}
export interface DurableReplayReportV32_18 {
  readonly schemaVersion: '32.18';
  readonly state: 'REJECTED' | 'INCOMPLETE' | 'COMPLETED';
  readonly runId: string | null;
  readonly workflowId: string | null;
  readonly events: number;
  readonly completedSteps: readonly string[];
  readonly compensatedSteps: readonly string[];
  readonly findings: readonly string[];
  readonly historyDigest: string;
  readonly reportDigest: string;
}
export function durableEventDigestV32_18(event: Omit<DurableHistoryEventV32_18, 'eventDigest'>): string { return sha256(event); }
export function replayDurableHistoryV32_18(events: readonly DurableHistoryEventV32_18[], requiredSteps: readonly string[]): DurableReplayReportV32_18 {
  const findings: string[] = [];
  if (events.length === 0) findings.push('durable-history-empty');
  const runIds = new Set(events.map((event) => event.runId));
  const workflowIds = new Set(events.map((event) => event.workflowId));
  if (runIds.size > 1) findings.push('durable-run-identity-mixed');
  if (workflowIds.size > 1) findings.push('durable-workflow-identity-mixed');
  const effectOwners = new Map<string, string>();
  const stepStates = new Map<string, DurableStepStateV32_18>();
  let previous: string | null = null;
  events.forEach((event, index) => {
    if (event.sequence !== index + 1) findings.push(`durable-sequence-invalid:${event.sequence}`);
    if (event.previousEventDigest !== previous) findings.push(`durable-chain-broken:${event.sequence}`);
    const { eventDigest: _ignored, ...material } = event;
    if (durableEventDigestV32_18(material) !== event.eventDigest) findings.push(`durable-event-digest-invalid:${event.sequence}`);
    if (!/^[0-9a-f]{64}$/.test(event.payloadDigest)) findings.push(`durable-payload-digest-invalid:${event.sequence}`);
    const prior = stepStates.get(event.stepId);
    if (event.state === 'STARTED' && prior !== undefined) findings.push(`durable-step-restarted:${event.stepId}`);
    if (event.state === 'COMPLETED' && prior !== 'STARTED') findings.push(`durable-completion-without-start:${event.stepId}`);
    if (event.state === 'FAILED' && prior !== 'STARTED') findings.push(`durable-failure-without-start:${event.stepId}`);
    if (event.state === 'COMPENSATED' && prior !== 'COMPLETED' && prior !== 'FAILED') findings.push(`durable-compensation-invalid:${event.stepId}`);
    if (event.effectId !== undefined) {
      const owner = effectOwners.get(event.effectId);
      if (owner !== undefined && owner !== event.stepId) findings.push(`durable-effect-reused:${event.effectId}`);
      else effectOwners.set(event.effectId, event.stepId);
    }
    stepStates.set(event.stepId, event.state);
    previous = event.eventDigest;
  });
  const required = new Set(requiredSteps);
  if (required.size !== requiredSteps.length || requiredSteps.some((step) => step.trim() === '')) findings.push('durable-required-steps-invalid');
  const completedSteps = [...stepStates].filter(([, state]) => state === 'COMPLETED').map(([step]) => step).sort();
  const compensatedSteps = [...stepStates].filter(([, state]) => state === 'COMPENSATED').map(([step]) => step).sort();
  const terminal = [...stepStates.values()].every((state) => state === 'COMPLETED' || state === 'COMPENSATED');
  const allRequired = requiredSteps.every((step) => stepStates.get(step) === 'COMPLETED' || stepStates.get(step) === 'COMPENSATED');
  const state: DurableReplayReportV32_18['state'] = findings.length > 0 ? 'REJECTED' : terminal && allRequired ? 'COMPLETED' : 'INCOMPLETE';
  const historyDigest = sha256(events.map((event) => event.eventDigest));
  const material = { schemaVersion: '32.18' as const, state, runId: runIds.size === 1 ? events[0]?.runId ?? null : null, workflowId: workflowIds.size === 1 ? events[0]?.workflowId ?? null : null, events: events.length, completedSteps, compensatedSteps, findings: findings.sort(), historyDigest };
  return { ...material, reportDigest: sha256(material) };
}

export interface WorkloadIdentityObservationV32_18 {
  readonly spiffeId: string;
  readonly trustDomain: string;
  readonly nodeAttested: boolean;
  readonly workloadAttested: boolean;
  readonly selectors: readonly string[];
  readonly requiredSelectors: readonly string[];
  readonly svidValidFrom: string;
  readonly svidValidUntil: string;
  readonly observedAt: string;
  readonly issuerBundleDigest: string;
  readonly federatedBundleDigest?: string;
}
export interface IdentityFederationPolicyV32_18 { readonly allowedTrustDomains: readonly string[]; readonly requireFederationForForeignDomain: boolean; readonly maximumSvidLifetimeMs: number; readonly maximumClockSkewMs: number; }
export function evaluateWorkloadIdentityV32_18(observation: WorkloadIdentityObservationV32_18, policy: IdentityFederationPolicyV32_18): { readonly state: 'REJECTED' | 'ACCEPTED'; readonly findings: readonly string[]; readonly reportDigest: string } {
  const findings: string[] = [];
  if (observation.spiffeId !== `spiffe://${observation.trustDomain}/${observation.spiffeId.split('/').slice(3).join('/')}` || !/^spiffe:\/\/[a-z0-9.-]+\/[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/.test(observation.spiffeId)) findings.push('identity-spiffe-id-invalid');
  if (!policy.allowedTrustDomains.includes(observation.trustDomain)) findings.push('identity-trust-domain-denied');
  if (!observation.nodeAttested) findings.push('identity-node-attestation-missing');
  if (!observation.workloadAttested) findings.push('identity-workload-attestation-missing');
  const selectors = new Set(observation.selectors);
  if (selectors.size !== observation.selectors.length || observation.requiredSelectors.some((selector) => !selectors.has(selector))) findings.push('identity-selector-binding-invalid');
  const validFrom = Date.parse(observation.svidValidFrom); const validUntil = Date.parse(observation.svidValidUntil); const observedAt = Date.parse(observation.observedAt);
  if (![validFrom, validUntil, observedAt].every(Number.isFinite) || validFrom >= validUntil) findings.push('identity-time-invalid');
  else {
    if (validUntil - validFrom > policy.maximumSvidLifetimeMs) findings.push('identity-svid-lifetime-exceeded');
    if (observedAt + policy.maximumClockSkewMs < validFrom || observedAt - policy.maximumClockSkewMs > validUntil) findings.push('identity-svid-not-current');
  }
  if (!/^[0-9a-f]{64}$/.test(observation.issuerBundleDigest)) findings.push('identity-issuer-bundle-invalid');
  const foreign = policy.allowedTrustDomains[0] !== observation.trustDomain;
  if (foreign && policy.requireFederationForForeignDomain && !/^[0-9a-f]{64}$/.test(observation.federatedBundleDigest ?? '')) findings.push('identity-federation-bundle-missing');
  const material = { state: findings.length === 0 ? 'ACCEPTED' as const : 'REJECTED' as const, findings: findings.sort() };
  return { ...material, reportDigest: sha256(material) };
}

export interface TraceSummaryV32_18 { readonly traceId: string; readonly tenantId: string; readonly durationMs: number; readonly error: boolean; readonly securityRelevant: boolean; readonly rootService: string; readonly estimatedBytes: number; }
export interface TailSamplingPolicyV32_18 { readonly maximumExportBytes: number; readonly latencyThresholdMs: number; readonly baselineRate: number; readonly tenantMinimum: number; }
export interface TailSamplingReportV32_18 { readonly selectedTraceIds: readonly string[]; readonly mandatoryTraceIds: readonly string[]; readonly exportedBytes: number; readonly droppedBytes: number; readonly budgetExceeded: boolean; readonly reportDigest: string; }
export function optimizeTailSamplingV32_18(traces: readonly TraceSummaryV32_18[], policy: TailSamplingPolicyV32_18): TailSamplingReportV32_18 {
  if (!Number.isSafeInteger(policy.maximumExportBytes) || policy.maximumExportBytes <= 0 || !Number.isFinite(policy.latencyThresholdMs) || policy.latencyThresholdMs <= 0 || !Number.isFinite(policy.baselineRate) || policy.baselineRate < 0 || policy.baselineRate > 1 || !Number.isSafeInteger(policy.tenantMinimum) || policy.tenantMinimum < 0) throw new Error('tail_sampling_policy_invalid');
  const ids = new Set<string>(); const tenants = new Map<string, TraceSummaryV32_18[]>();
  for (const trace of traces) {
    if (!/^[0-9a-f]{32}$/.test(trace.traceId) || ids.has(trace.traceId) || trace.tenantId.trim() === '' || !Number.isFinite(trace.durationMs) || trace.durationMs < 0 || !Number.isSafeInteger(trace.estimatedBytes) || trace.estimatedBytes <= 0) throw new Error('tail_sampling_trace_invalid');
    ids.add(trace.traceId); const list = tenants.get(trace.tenantId) ?? []; list.push(trace); tenants.set(trace.tenantId, list);
  }
  const mandatory = traces.filter((trace) => trace.error || trace.securityRelevant || trace.durationMs >= policy.latencyThresholdMs).sort(compareTrace);
  const selected = new Map(mandatory.map((trace) => [trace.traceId, trace]));
  for (const list of tenants.values()) {
    for (const trace of [...list].sort(compareTrace).slice(0, policy.tenantMinimum)) selected.set(trace.traceId, trace);
  }
  const optional = traces.filter((trace) => !selected.has(trace.traceId)).sort(compareTrace);
  const baselineTarget = Math.ceil(traces.length * policy.baselineRate);
  for (const trace of optional) {
    if (selected.size >= baselineTarget) break;
    selected.set(trace.traceId, trace);
  }
  let exportedBytes = [...selected.values()].reduce((sum, trace) => sum + trace.estimatedBytes, 0);
  if (exportedBytes <= policy.maximumExportBytes) {
    for (const trace of optional) {
      if (selected.has(trace.traceId)) continue;
      if (exportedBytes + trace.estimatedBytes > policy.maximumExportBytes) continue;
      selected.set(trace.traceId, trace); exportedBytes += trace.estimatedBytes;
    }
  }
  const mandatoryBytes = mandatory.reduce((sum, trace) => sum + trace.estimatedBytes, 0);
  const budgetExceeded = mandatoryBytes > policy.maximumExportBytes;
  const selectedTraceIds = [...selected.keys()].sort(); const mandatoryTraceIds = mandatory.map((trace) => trace.traceId).sort();
  const droppedBytes = traces.reduce((sum, trace) => sum + trace.estimatedBytes, 0) - exportedBytes;
  const material = { selectedTraceIds, mandatoryTraceIds, exportedBytes, droppedBytes, budgetExceeded };
  return { ...material, reportDigest: sha256(material) };
}
function compareTrace(a: TraceSummaryV32_18, b: TraceSummaryV32_18): number { return Number(b.securityRelevant) - Number(a.securityRelevant) || Number(b.error) - Number(a.error) || b.durationMs - a.durationMs || a.traceId.localeCompare(b.traceId); }

export interface PostgresContinuityObservationV32_18 { readonly observedAt: string; readonly primaryLsn: bigint; readonly replicaLsns: readonly bigint[]; readonly synchronousReplicasRequired: number; readonly synchronousReplicasObserved: number; readonly lastSuccessfulBackupAt: string; readonly firstRecoverableAt: string; readonly walArchiveReady: number; readonly walArchiveFailed: number; readonly restoreProbePassed: boolean; readonly restoreTargetAt: string; readonly restoreCompletedAt: string; readonly failoverRtoMs: number; }
export interface PostgresContinuityPolicyV32_18 { readonly maximumRpoBytes: bigint; readonly maximumBackupAgeMs: number; readonly maximumFailoverRtoMs: number; readonly minimumReplicas: number; }
export function evaluatePostgresContinuityV32_18(observation: PostgresContinuityObservationV32_18, policy: PostgresContinuityPolicyV32_18): { readonly state: 'REJECTED' | 'QUALIFIED'; readonly maximumReplicaLagBytes: string; readonly findings: readonly string[]; readonly reportDigest: string } {
  const findings: string[] = [];
  if (observation.primaryLsn < 0n || observation.replicaLsns.length < policy.minimumReplicas || observation.replicaLsns.some((lsn) => lsn < 0n || lsn > observation.primaryLsn)) findings.push('postgres-replication-observation-invalid');
  const lags = observation.replicaLsns.map((lsn) => observation.primaryLsn - lsn); const maximumLag = lags.length === 0 ? observation.primaryLsn : lags.reduce((a, b) => a > b ? a : b);
  if (maximumLag > policy.maximumRpoBytes) findings.push('postgres-rpo-exceeded');
  if (observation.synchronousReplicasObserved < observation.synchronousReplicasRequired || observation.synchronousReplicasRequired < 1) findings.push('postgres-synchronous-replica-shortfall');
  const observedAt = Date.parse(observation.observedAt); const backupAt = Date.parse(observation.lastSuccessfulBackupAt); const firstRecoverable = Date.parse(observation.firstRecoverableAt); const restoreTarget = Date.parse(observation.restoreTargetAt); const restoreCompleted = Date.parse(observation.restoreCompletedAt);
  if (![observedAt, backupAt, firstRecoverable, restoreTarget, restoreCompleted].every(Number.isFinite) || firstRecoverable > restoreTarget || restoreTarget > restoreCompleted || restoreCompleted > observedAt) findings.push('postgres-continuity-time-invalid');
  else if (observedAt - backupAt > policy.maximumBackupAgeMs) findings.push('postgres-backup-stale');
  if (observation.walArchiveFailed > 0 || observation.walArchiveReady < 0) findings.push('postgres-wal-archive-unhealthy');
  if (!observation.restoreProbePassed) findings.push('postgres-restore-probe-failed');
  if (!Number.isFinite(observation.failoverRtoMs) || observation.failoverRtoMs < 0 || observation.failoverRtoMs > policy.maximumFailoverRtoMs) findings.push('postgres-failover-rto-exceeded');
  const material = { state: findings.length === 0 ? 'QUALIFIED' as const : 'REJECTED' as const, maximumReplicaLagBytes: maximumLag.toString(), findings: findings.sort() };
  return { ...material, reportDigest: sha256(material) };
}
