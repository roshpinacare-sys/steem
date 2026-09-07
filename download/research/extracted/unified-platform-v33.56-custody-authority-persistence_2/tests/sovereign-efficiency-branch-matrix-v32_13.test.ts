import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '../src/contracts/crypto.js';
import {
  SingleFlightCoordinator,
  SovereignAdmissionController,
  SovereignCostLedger,
  SovereignEfficiencyFabric,
  TenantSemanticCache,
  chooseExecutionTarget,
  semanticTokens,
  type ExecutionEstimate,
  type FabricHandlers,
  type SovereignRoutingPolicy,
  type SovereignWorkRequest,
} from '../src/runtime/sovereign-efficiency-fabric.js';

const digest = (value: unknown): string => sha256(value);
const at = new Date('2026-07-20T12:00:00.000Z');
function request(patch: Partial<SovereignWorkRequest> = {}): SovereignWorkRequest {
  return {
    requestId: 'branch-request', tenantId: 'tenant-a', workloadId: 'analysis', operation: 'branch', input: 'alpha beta',
    sensitivity: 'INTERNAL', deterministic: false, cacheable: false, semanticReuseAllowed: true, allowAsync: true,
    freshnessMs: 60_000, requiredQuality: 0.7, estimatedComputeUnits: 2, latencyBudgetMs: 500,
    sourceDigest: digest('source'), policyDigest: digest('policy'), authorityDigest: digest('authority'), ...patch,
  };
}
function policy(patch: Partial<SovereignRoutingPolicy> = {}): SovereignRoutingPolicy {
  return {
    tenantId: 'tenant-a', allowLocalModel: true, allowBurstNode: true, allowExternalModel: true,
    maximumExternalSensitivity: 'INTERNAL', maximumExternalCostMicros: 1000, localModelMaximumQuality: 0.85,
    localSynchronousComputeUnits: 4, localAsynchronousComputeUnits: 20, cacheSimilarityFloor: 0.6, ...patch,
  };
}
function estimate(patch: Partial<ExecutionEstimate> = {}): ExecutionEstimate {
  return {
    externalCostMicros: 500, localModelQuality: 0.8, localRulesLatencyMs: 5, localModelLatencyMs: 100,
    asyncAdmissionLatencyMs: 10, burstLatencyMs: 200, externalLatencyMs: 250, burstAvailable: true, ...patch,
  };
}
function fabric(calls: string[], evidenceDigest = digest('evidence')): SovereignEfficiencyFabric {
  const run = (name: string) => async () => { calls.push(name); return { result: name, evidenceDigest }; };
  const handlers: FabricHandlers = {
    localRules: run('rules'), localModel: run('model'), localAsync: run('async'), burstNode: run('burst'), externalModel: run('external'),
  };
  return new SovereignEfficiencyFabric(new TenantSemanticCache(4), new SovereignAdmissionController(8, 4), new SingleFlightCoordinator(), new SovereignCostLedger(), handlers);
}

test('cost ledger covers empty, local and external accounting plus all public validation boundaries', () => {
  const ledger = new SovereignCostLedger();
  assert.deepEqual(ledger.summary(), { operations: 0, cacheHits: 0, deduplicatedOperations: 0, externalOperations: 0, localOperations: 0, externalCostMicros: 0, savedExternalCostMicros: 0, savingsRate: 0, chainValid: true });
  ledger.append({ occurredAt: at.toISOString(), tenantId: 'tenant-a', workloadId: 'work', route: 'LOCAL_RULES', cacheHit: false, deduplicated: false, externalCostMicros: 0, savedExternalCostMicros: 500, computeUnits: 1 });
  ledger.append({ occurredAt: at.toISOString(), tenantId: 'tenant-a', workloadId: 'work', route: 'EXTERNAL_MODEL', cacheHit: false, deduplicated: false, externalCostMicros: 500, savedExternalCostMicros: 0, computeUnits: 1 });
  assert.equal(ledger.list().length, 2); assert.equal(ledger.summary().savingsRate, 0.5); assert.equal(ledger.verify(), true);
  const base = { occurredAt: at.toISOString(), tenantId: 'tenant-a', workloadId: 'work', route: 'LOCAL_RULES' as const, cacheHit: false, deduplicated: false, externalCostMicros: 0, savedExternalCostMicros: 1, computeUnits: 1 };
  for (const [patch, code] of [
    [{ tenantId: '' }, /cost_tenant_required/], [{ workloadId: '' }, /cost_workload_required/], [{ externalCostMicros: -1 }, /cost_external_invalid/],
    [{ savedExternalCostMicros: -1 }, /cost_saved_invalid/], [{ computeUnits: 0 }, /cost_compute_units_invalid/], [{ occurredAt: 'bad' }, /cost_time_invalid/],
  ] as const) assert.throws(() => ledger.append({ ...base, ...patch }), code);
});

test('cache validation, default paths, object tokenization, same-result replacement and time boundaries are explicit', () => {
  assert.throws(() => new TenantSemanticCache(0), /cache_capacity_invalid/);
  const cache = new TenantSemanticCache(2); const base = request({ cacheable: true, input: { Alpha: 1 } });
  const stored = cache.put(base, { ok: true }, digest('evidence'), at);
  assert.deepEqual(stored.semanticTokens, ['1', 'alpha']);
  assert.equal(cache.size(), 1); assert.equal(cache.put(base, { ok: true }, digest('evidence'), at).resultDigest, stored.resultDigest);
  assert.throws(() => cache.lookup(base, -0.1, at), /cache_similarity_floor_invalid/);
  assert.throws(() => cache.lookup(base, 0.5, new Date(Number.NaN)), /cache_time_invalid/);
  assert.throws(() => cache.put(base, true, 'bad', at), /cache_evidence_digest_invalid/);
  assert.throws(() => cache.put(base, true, digest('evidence'), new Date(Number.NaN)), /cache_time_invalid/);
  assert.equal(cache.lookup(request({ requestId: 'no-semantic', cacheable: true, semanticReuseAllowed: false, input: 'near alpha' }), 0.1, at), undefined);
  assert.deepEqual(semanticTokens(undefined), []); assert.deepEqual(semanticTokens({ B: 2 }), ['2', 'b']);
});

test('admission validation and partial release preserve exact global and tenant accounting', () => {
  assert.throws(() => new SovereignAdmissionController(1, 2), /admission_tenant_exceeds_global/);
  assert.throws(() => new SovereignAdmissionController(0, 0), /admission_global_units_invalid/);
  const admission = new SovereignAdmissionController(4, 3);
  assert.throws(() => admission.acquire('', 1), /admission_tenant_required/);
  assert.throws(() => admission.acquire('tenant-a', 0), /admission_units_invalid/);
  assert.throws(() => admission.acquire('tenant-a', 4), /request_exceeds_tenant_capacity/);
  const first = admission.acquire('tenant-a', 1); const second = admission.acquire('tenant-a', 1);
  admission.release(first); assert.deepEqual(admission.snapshot(), { globalActive: 1, tenantActive: { 'tenant-a': 1 }, activeLeases: 1 });
  admission.release(second); assert.equal(admission.snapshot().globalActive, 0);
});

test('single-flight validates identity and cleans a rejected operation', async () => {
  const single = new SingleFlightCoordinator();
  await assert.rejects(single.run('', digest('request'), async () => ({ result: 'x', evidenceDigest: digest('x') })), /singleflight_key_required/);
  await assert.rejects(single.run('key', 'bad', async () => ({ result: 'x', evidenceDigest: digest('x') })), /singleflight_request_digest_invalid/);
  await assert.rejects(single.run('key', digest('request'), async () => { throw new Error('operation_failed'); }), /operation_failed/);
  assert.equal(single.active, 0); assert.equal(single.joins, 0);
});

test('fabric executes local rules, local async, burst and external handlers with route-specific cost semantics', async () => {
  const calls: string[] = []; const runner = fabric(calls);
  const rules = await runner.execute(request({ requestId: 'rules', deterministic: true }), policy(), estimate(), at);
  const asyncResult = await runner.execute(request({ requestId: 'async', requiredQuality: 0.95 }), policy(), estimate(), at);
  const burst = await runner.execute(request({ requestId: 'burst', requiredQuality: 0.95, allowAsync: false }), policy(), estimate(), at);
  const external = await runner.execute(request({ requestId: 'external', requiredQuality: 0.95, allowAsync: false }), policy({ allowBurstNode: false }), estimate(), at);
  assert.deepEqual(calls, ['rules', 'async', 'burst', 'external']);
  assert.deepEqual([rules.target, asyncResult.target, burst.target, external.target], ['LOCAL_RULES', 'LOCAL_ASYNC', 'BURST_NODE', 'EXTERNAL_MODEL']);
  assert.equal(rules.savedExternalCostMicros, 500); assert.equal(external.savedExternalCostMicros, 0);
  assert.equal(runner.costs.summary().externalCostMicros, 500); assert.equal(runner.costs.summary().savedExternalCostMicros, 1500);
});

test('cache route classification and malformed execution evidence remain fail closed', async () => {
  const fakeExact = { kind: 'EXACT', entry: {}, similarity: 1 } as never;
  const fakeSemantic = { kind: 'SEMANTIC', entry: {}, similarity: 0.8 } as never;
  assert.equal(chooseExecutionTarget(request(), policy(), estimate(), fakeExact), 'CACHE_EXACT');
  assert.equal(chooseExecutionTarget(request(), policy(), estimate(), fakeSemantic), 'CACHE_SEMANTIC');
  await assert.rejects(fabric([], 'bad').execute(request(), policy(), estimate(), at), /execution_evidence_digest_invalid/);
  await assert.rejects(fabric([]).execute(request(), policy({ cacheSimilarityFloor: 2 }), estimate(), at), /policy_similarity_floor_invalid/);
  await assert.rejects(fabric([]).execute(request(), policy(), estimate(), new Date(Number.NaN)), /execution_time_invalid/);
});

test('request, policy and estimate validators reject every malformed field family', () => {
  const requestCases: readonly [Partial<SovereignWorkRequest>, RegExp][] = [
    [{ requestId: '' }, /request_id_required/], [{ tenantId: '' }, /request_tenant_required/], [{ workloadId: '' }, /request_workload_required/], [{ operation: '' }, /request_operation_required/],
    [{ sensitivity: 'SECRET' as never }, /request_sensitivity_invalid/], [{ freshnessMs: 0 }, /request_freshness_invalid/], [{ requiredQuality: 2 }, /request_quality_invalid/],
    [{ estimatedComputeUnits: 0 }, /request_compute_units_invalid/], [{ latencyBudgetMs: 0 }, /request_latency_budget_invalid/], [{ sourceDigest: 'bad' }, /request_source_digest_invalid/],
    [{ policyDigest: 'bad' }, /request_policy_digest_invalid/], [{ authorityDigest: 'bad' }, /request_authority_digest_invalid/],
  ];
  for (const [patch, code] of requestCases) assert.throws(() => chooseExecutionTarget(request(patch), policy(), estimate(), undefined), code);
  const policyCases: readonly [Partial<SovereignRoutingPolicy>, RegExp][] = [
    [{ tenantId: '' }, /policy_tenant_required/], [{ maximumExternalSensitivity: 'RESTRICTED' as never }, /policy_external_sensitivity_invalid/],
    [{ maximumExternalCostMicros: -1 }, /policy_external_cost_invalid/], [{ localModelMaximumQuality: 2 }, /policy_local_quality_invalid/],
    [{ localSynchronousComputeUnits: 0 }, /policy_sync_units_invalid/], [{ localAsynchronousComputeUnits: 0 }, /policy_async_units_invalid/], [{ cacheSimilarityFloor: -1 }, /policy_similarity_floor_invalid/],
  ];
  for (const [patch, code] of policyCases) assert.throws(() => chooseExecutionTarget(request(), policy(patch), estimate(), undefined), code);
  const estimateCases: readonly [Partial<ExecutionEstimate>, RegExp][] = [
    [{ externalCostMicros: -1 }, /estimate_external_cost_invalid/], [{ localModelQuality: 2 }, /estimate_local_quality_invalid/], [{ localRulesLatencyMs: -1 }, /estimate_rules_latency_invalid/],
    [{ localModelLatencyMs: -1 }, /estimate_local_latency_invalid/], [{ asyncAdmissionLatencyMs: -1 }, /estimate_async_latency_invalid/], [{ burstLatencyMs: -1 }, /estimate_burst_latency_invalid/], [{ externalLatencyMs: -1 }, /estimate_external_latency_invalid/],
  ];
  for (const [patch, code] of estimateCases) assert.throws(() => chooseExecutionTarget(request(), policy(), estimate(patch), undefined), code);
});
