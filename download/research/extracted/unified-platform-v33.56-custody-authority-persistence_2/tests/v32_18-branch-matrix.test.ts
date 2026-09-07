import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileResiliencyPolicyV32_18,
  durableEventDigestV32_18,
  evaluatePostgresContinuityV32_18,
  evaluateWorkloadIdentityV32_18,
  optimizeTailSamplingV32_18,
  replayDurableHistoryV32_18,
  type DurableHistoryEventV32_18,
  type PostgresContinuityObservationV32_18,
  type TraceSummaryV32_18,
  type WorkloadIdentityObservationV32_18,
} from '../src/platform/sovereign-control-plane-v32_18.js';
import { runCncfGoldMineExtractionV32_18 } from '../src/app/cncf-gold-mine-extraction-v32_18.js';

const digest = 'a'.repeat(64);
const traceId = (n: number) => n.toString(16).padStart(32, '0');

const resiliency = () => ({
  operationId: 'orders.write', idempotent: true, idempotencyKeyRequired: false, timeoutMs: 100,
  retry: { maxAttempts: 3, initialDelayMs: 10, maximumDelayMs: 15, multiplier: 2, jitter: 'FULL' as const },
  circuitBreaker: { failureThreshold: 3, recoveryTimeoutMs: 1_000, halfOpenMaxCalls: 1 },
  bulkhead: { maximumConcurrent: 10, maximumQueue: 20 },
});

function event(material: Omit<DurableHistoryEventV32_18, 'eventDigest'>): DurableHistoryEventV32_18 {
  return { ...material, eventDigest: durableEventDigestV32_18(material) };
}
function validHistory(): DurableHistoryEventV32_18[] {
  const first = event({ runId: 'run-a', workflowId: 'wf-a', sequence: 1, stepId: 'collect', state: 'STARTED', payloadDigest: digest, previousEventDigest: null });
  const second = event({ runId: 'run-a', workflowId: 'wf-a', sequence: 2, stepId: 'collect', state: 'COMPLETED', effectId: 'effect-1', payloadDigest: digest, previousEventDigest: first.eventDigest });
  return [first, second];
}
const identity = (): WorkloadIdentityObservationV32_18 => ({
  spiffeId: 'spiffe://example.test/ns/default/sa/app', trustDomain: 'example.test', nodeAttested: true, workloadAttested: true,
  selectors: ['k8s:ns:default', 'k8s:sa:app'], requiredSelectors: ['k8s:sa:app'],
  svidValidFrom: '2026-07-20T23:00:00Z', svidValidUntil: '2026-07-21T01:00:00Z', observedAt: '2026-07-21T00:00:00Z', issuerBundleDigest: digest,
});
const identityPolicy = () => ({ allowedTrustDomains: ['example.test'], requireFederationForForeignDomain: true, maximumSvidLifetimeMs: 7_200_000, maximumClockSkewMs: 1_000 });
const traces = (): TraceSummaryV32_18[] => [
  { traceId: traceId(1), tenantId: 'a', durationMs: 5, error: false, securityRelevant: false, rootService: 'api', estimatedBytes: 100 },
  { traceId: traceId(2), tenantId: 'a', durationMs: 500, error: true, securityRelevant: false, rootService: 'api', estimatedBytes: 100 },
  { traceId: traceId(3), tenantId: 'b', durationMs: 300, error: false, securityRelevant: true, rootService: 'worker', estimatedBytes: 100 },
  { traceId: traceId(4), tenantId: 'b', durationMs: 200, error: false, securityRelevant: false, rootService: 'worker', estimatedBytes: 900 },
];
const samplingPolicy = () => ({ maximumExportBytes: 350, latencyThresholdMs: 250, baselineRate: 0.5, tenantMinimum: 1 });
const postgres = (): PostgresContinuityObservationV32_18 => ({
  observedAt: '2026-07-21T00:00:00Z', primaryLsn: 1_000n, replicaLsns: [990n, 995n], synchronousReplicasRequired: 1, synchronousReplicasObserved: 1,
  lastSuccessfulBackupAt: '2026-07-20T23:30:00Z', firstRecoverableAt: '2026-07-20T20:00:00Z', walArchiveReady: 0, walArchiveFailed: 0,
  restoreProbePassed: true, restoreTargetAt: '2026-07-20T22:00:00Z', restoreCompletedAt: '2026-07-20T22:05:00Z', failoverRtoMs: 50,
});
const postgresPolicy = () => ({ maximumRpoBytes: 20n, maximumBackupAgeMs: 3_600_000, maximumFailoverRtoMs: 100, minimumReplicas: 1 });

function expectError(code: string, fn: () => unknown) {
  assert.throws(fn, (error: unknown) => error instanceof Error && error.message.startsWith(code));
}

test('v32.18 resiliency branch matrix rejects every unsafe boundary and caps retry delays', () => {
  const base = resiliency();
  expectError('resiliency_operation_id_invalid', () => compileResiliencyPolicyV32_18({ ...base, operationId: 'A' }));
  for (const patch of [
    { timeoutMs: 0 },
    { retry: { ...base.retry, maxAttempts: 1.5 } },
    { circuitBreaker: { ...base.circuitBreaker, failureThreshold: Number.NaN } },
    { bulkhead: { ...base.bulkhead, maximumQueue: -1 } },
  ]) expectError('resiliency_positive_integer_required', () => compileResiliencyPolicyV32_18({ ...base, ...patch }));
  for (const multiplier of [Number.NaN, 0.9, 10.1]) expectError('resiliency_retry_multiplier_invalid', () => compileResiliencyPolicyV32_18({ ...base, retry: { ...base.retry, multiplier } }));
  expectError('resiliency_retry_delay_order_invalid', () => compileResiliencyPolicyV32_18({ ...base, retry: { ...base.retry, initialDelayMs: 20, maximumDelayMs: 10 } }));
  expectError('resiliency_retry_requires_idempotency', () => compileResiliencyPolicyV32_18({ ...base, idempotent: false, idempotencyKeyRequired: false }));
  expectError('resiliency_retry_attempts_excessive', () => compileResiliencyPolicyV32_18({ ...base, retry: { ...base.retry, maxAttempts: 11 } }));
  for (const patch of [
    { timeoutMs: 120_001 },
    { circuitBreaker: { ...base.circuitBreaker, recoveryTimeoutMs: 3_600_001 } },
    { bulkhead: { ...base.bulkhead, maximumConcurrent: 10_001 } },
    { bulkhead: { ...base.bulkhead, maximumQueue: 100_001 } },
  ]) expectError('resiliency_resource_bound_exceeded', () => compileResiliencyPolicyV32_18({ ...base, ...patch }));
  expectError('resiliency_worst_case_duration_exceeded', () => compileResiliencyPolicyV32_18({ ...base, timeoutMs: 70_000, retry: { ...base.retry, maxAttempts: 10, initialDelayMs: 1, maximumDelayMs: 1 } }));
  const compiled = compileResiliencyPolicyV32_18({ ...base, retry: { ...base.retry, maxAttempts: 4 } });
  assert.equal(compiled.retryBudgetMs, 40);
});

test('v32.18 durable replay branch matrix rejects malformed transitions and reports incomplete or compensated histories', () => {
  assert.equal(replayDurableHistoryV32_18([], []).state, 'REJECTED');
  const good = validHistory();
  const cases: Array<[string, DurableHistoryEventV32_18[], string[]]> = [];
  cases.push(['durable-run-identity-mixed', [good[0]!, event({ runId: 'run-b', workflowId: 'wf-a', sequence: 2, stepId: 'collect', state: 'COMPLETED', effectId: 'effect-1', payloadDigest: digest, previousEventDigest: good[0]!.eventDigest })], ['collect']]);
  cases.push(['durable-workflow-identity-mixed', [good[0]!, event({ runId: 'run-a', workflowId: 'wf-b', sequence: 2, stepId: 'collect', state: 'COMPLETED', effectId: 'effect-1', payloadDigest: digest, previousEventDigest: good[0]!.eventDigest })], ['collect']]);
  cases.push(['durable-sequence-invalid', [{ ...good[0]!, sequence: 2 }], ['collect']]);
  cases.push(['durable-chain-broken', [{ ...good[0]!, previousEventDigest: digest }], ['collect']]);
  cases.push(['durable-event-digest-invalid', [{ ...good[0]!, eventDigest: 'b'.repeat(64) }], ['collect']]);
  cases.push(['durable-payload-digest-invalid', [{ ...good[0]!, payloadDigest: 'bad' }], ['collect']]);
  cases.push(['durable-step-restarted', [good[0]!, event({ runId: 'run-a', workflowId: 'wf-a', sequence: 2, stepId: 'collect', state: 'STARTED', payloadDigest: digest, previousEventDigest: good[0]!.eventDigest })], ['collect']]);
  cases.push(['durable-completion-without-start', [event({ runId: 'run-a', workflowId: 'wf-a', sequence: 1, stepId: 'x', state: 'COMPLETED', payloadDigest: digest, previousEventDigest: null })], ['x']]);
  cases.push(['durable-failure-without-start', [event({ runId: 'run-a', workflowId: 'wf-a', sequence: 1, stepId: 'x', state: 'FAILED', payloadDigest: digest, previousEventDigest: null })], ['x']]);
  cases.push(['durable-compensation-invalid', [event({ runId: 'run-a', workflowId: 'wf-a', sequence: 1, stepId: 'x', state: 'COMPENSATED', payloadDigest: digest, previousEventDigest: null })], ['x']]);
  const third = event({ runId: 'run-a', workflowId: 'wf-a', sequence: 3, stepId: 'other', state: 'STARTED', effectId: 'effect-1', payloadDigest: digest, previousEventDigest: good[1]!.eventDigest });
  cases.push(['durable-effect-reused', [...good, third], ['collect']]);
  cases.push(['durable-required-steps-invalid', good, ['collect', 'collect']]);
  cases.push(['durable-required-steps-invalid', good, ['']]);
  for (const [finding, history, required] of cases) assert.ok(replayDurableHistoryV32_18(history, required).findings.some((x) => x.startsWith(finding)), finding);
  const started = [good[0]!];
  assert.equal(replayDurableHistoryV32_18(started, ['collect']).state, 'INCOMPLETE');
  const failed = event({ runId: 'run-a', workflowId: 'wf-a', sequence: 2, stepId: 'collect', state: 'FAILED', payloadDigest: digest, previousEventDigest: good[0]!.eventDigest });
  const compensated = event({ runId: 'run-a', workflowId: 'wf-a', sequence: 3, stepId: 'collect', state: 'COMPENSATED', payloadDigest: digest, previousEventDigest: failed.eventDigest });
  const report = replayDurableHistoryV32_18([good[0]!, failed, compensated], ['collect']);
  assert.equal(report.state, 'COMPLETED');
  assert.deepEqual(report.compensatedSteps, ['collect']);
});

test('v32.18 identity branch matrix rejects malformed, stale, unattested and unfederated SVIDs', () => {
  const base = identity(); const policy = identityPolicy();
  const checks: Array<[string, WorkloadIdentityObservationV32_18, ReturnType<typeof identityPolicy>]> = [
    ['identity-spiffe-id-invalid', { ...base, spiffeId: 'https://example.test/app' }, policy],
    ['identity-trust-domain-denied', { ...base, trustDomain: 'denied.test', spiffeId: 'spiffe://denied.test/app' }, policy],
    ['identity-node-attestation-missing', { ...base, nodeAttested: false }, policy],
    ['identity-workload-attestation-missing', { ...base, workloadAttested: false }, policy],
    ['identity-selector-binding-invalid', { ...base, selectors: ['dup', 'dup'], requiredSelectors: ['dup'] }, policy],
    ['identity-selector-binding-invalid', { ...base, requiredSelectors: ['missing'] }, policy],
    ['identity-time-invalid', { ...base, svidValidFrom: 'bad' }, policy],
    ['identity-time-invalid', { ...base, svidValidFrom: base.svidValidUntil }, policy],
    ['identity-svid-lifetime-exceeded', base, { ...policy, maximumSvidLifetimeMs: 10 }],
    ['identity-svid-not-current', { ...base, observedAt: '2026-07-22T00:00:00Z' }, policy],
    ['identity-issuer-bundle-invalid', { ...base, issuerBundleDigest: 'bad' }, policy],
    ['identity-federation-bundle-missing', { ...base, trustDomain: 'foreign.test', spiffeId: 'spiffe://foreign.test/app' }, { ...policy, allowedTrustDomains: ['example.test', 'foreign.test'] }],
  ];
  for (const [finding, observation, selectedPolicy] of checks) assert.ok(evaluateWorkloadIdentityV32_18(observation, selectedPolicy).findings.includes(finding), finding);
  const foreign = { ...base, trustDomain: 'foreign.test', spiffeId: 'spiffe://foreign.test/app', federatedBundleDigest: 'b'.repeat(64) };
  assert.equal(evaluateWorkloadIdentityV32_18(foreign, { ...policy, allowedTrustDomains: ['example.test', 'foreign.test'] }).state, 'ACCEPTED');
  assert.equal(evaluateWorkloadIdentityV32_18(base, policy).state, 'ACCEPTED');
});

test('v32.18 tail sampling branch matrix validates policy and traces and preserves mandatory evidence', () => {
  const base = samplingPolicy();
  for (const patch of [
    { maximumExportBytes: 0 }, { latencyThresholdMs: Number.NaN }, { latencyThresholdMs: 0 }, { baselineRate: -0.1 }, { baselineRate: 1.1 }, { tenantMinimum: -1 }, { tenantMinimum: 0.5 },
  ]) expectError('tail_sampling_policy_invalid', () => optimizeTailSamplingV32_18([], { ...base, ...patch }));
  const valid = traces()[0]!;
  for (const bad of [
    { ...valid, traceId: 'bad' },
    { ...valid, tenantId: ' ' },
    { ...valid, durationMs: Number.NaN },
    { ...valid, durationMs: -1 },
    { ...valid, estimatedBytes: 0 },
    { ...valid, estimatedBytes: 1.5 },
  ]) expectError('tail_sampling_trace_invalid', () => optimizeTailSamplingV32_18([bad], base));
  expectError('tail_sampling_trace_invalid', () => optimizeTailSamplingV32_18([valid, valid], base));
  const report = optimizeTailSamplingV32_18(traces(), base);
  assert.deepEqual(report.mandatoryTraceIds, [traceId(2), traceId(3)]);
  assert.ok(report.selectedTraceIds.includes(traceId(1)));
  assert.ok(!report.selectedTraceIds.includes(traceId(4)));
  assert.equal(report.budgetExceeded, false);
  const exceeded = optimizeTailSamplingV32_18(traces(), { ...base, maximumExportBytes: 150 });
  assert.equal(exceeded.budgetExceeded, true);
  const empty = optimizeTailSamplingV32_18([], { ...base, tenantMinimum: 0, baselineRate: 0 });
  assert.deepEqual(empty.selectedTraceIds, []);
});

test('v32.18 PostgreSQL continuity branch matrix rejects every unsafe observation', () => {
  const base = postgres(); const policy = postgresPolicy();
  const checks: Array<[string, PostgresContinuityObservationV32_18, ReturnType<typeof postgresPolicy>]> = [
    ['postgres-replication-observation-invalid', { ...base, primaryLsn: -1n }, policy],
    ['postgres-replication-observation-invalid', { ...base, replicaLsns: [] }, policy],
    ['postgres-replication-observation-invalid', { ...base, replicaLsns: [1_001n] }, policy],
    ['postgres-rpo-exceeded', { ...base, replicaLsns: [900n] }, policy],
    ['postgres-synchronous-replica-shortfall', { ...base, synchronousReplicasObserved: 0 }, policy],
    ['postgres-synchronous-replica-shortfall', { ...base, synchronousReplicasRequired: 0 }, policy],
    ['postgres-continuity-time-invalid', { ...base, observedAt: 'bad' }, policy],
    ['postgres-continuity-time-invalid', { ...base, firstRecoverableAt: '2026-07-20T23:00:00Z', restoreTargetAt: '2026-07-20T22:00:00Z' }, policy],
    ['postgres-continuity-time-invalid', { ...base, restoreTargetAt: '2026-07-20T22:10:00Z', restoreCompletedAt: '2026-07-20T22:05:00Z' }, policy],
    ['postgres-continuity-time-invalid', { ...base, restoreCompletedAt: '2026-07-21T01:00:00Z' }, policy],
    ['postgres-backup-stale', { ...base, lastSuccessfulBackupAt: '2026-07-20T20:00:00Z' }, policy],
    ['postgres-wal-archive-unhealthy', { ...base, walArchiveFailed: 1 }, policy],
    ['postgres-wal-archive-unhealthy', { ...base, walArchiveReady: -1 }, policy],
    ['postgres-restore-probe-failed', { ...base, restoreProbePassed: false }, policy],
    ['postgres-failover-rto-exceeded', { ...base, failoverRtoMs: Number.NaN }, policy],
    ['postgres-failover-rto-exceeded', { ...base, failoverRtoMs: -1 }, policy],
    ['postgres-failover-rto-exceeded', { ...base, failoverRtoMs: 101 }, policy],
  ];
  for (const [finding, observation, selectedPolicy] of checks) assert.ok(evaluatePostgresContinuityV32_18(observation, selectedPolicy).findings.includes(finding), finding);
  const noReplica = evaluatePostgresContinuityV32_18({ ...base, replicaLsns: [] }, { ...policy, minimumReplicas: 0, maximumRpoBytes: 2_000n });
  assert.equal(noReplica.maximumReplicaLagBytes, '1000');
  assert.equal(evaluatePostgresContinuityV32_18(base, policy).state, 'QUALIFIED');
});

test('v32.18 integrated extraction aggregates each failure class and clamps reduction rates', async () => {
  const common = {
    resiliency: resiliency(), durableHistory: validHistory(), requiredSteps: ['collect'], identity: identity(), identityPolicy: identityPolicy(), traces: traces(), samplingPolicy: samplingPolicy(), postgres: postgres(), postgresPolicy: postgresPolicy(), baselineTelemetryBytes: 1_000, baselineOperationalUnits: 10,
  };
  const pass = await runCncfGoldMineExtractionV32_18(common);
  assert.equal(pass.state, 'DRY_RUN_PASSED');
  assert.equal(pass.productionQualified, false);
  assert.equal(pass.operationalReductionRate, 0.5);
  for (const bad of [
    { ...common, durableHistory: validHistory().slice(0, 1) },
    { ...common, identity: { ...identity(), nodeAttested: false } },
    { ...common, samplingPolicy: { ...samplingPolicy(), maximumExportBytes: 50 } },
    { ...common, postgres: { ...postgres(), restoreProbePassed: false } },
  ]) assert.equal((await runCncfGoldMineExtractionV32_18(bad)).state, 'FAILED');
  const clamped = await runCncfGoldMineExtractionV32_18({ ...common, baselineTelemetryBytes: 50 });
  assert.equal(clamped.telemetryReductionRate, 0);
  await assert.rejects(runCncfGoldMineExtractionV32_18({ ...common, baselineTelemetryBytes: 0 }), /gold_mine_baseline_invalid/);
  await assert.rejects(runCncfGoldMineExtractionV32_18({ ...common, baselineOperationalUnits: 4 }), /gold_mine_baseline_invalid/);
});
