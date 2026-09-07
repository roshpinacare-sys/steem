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
  exactCacheKey,
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
    requestId: 'request-1', tenantId: 'tenant-a', workloadId: 'analysis', operation: 'summarize', input: 'alpha beta gamma',
    sensitivity: 'INTERNAL', deterministic: false, cacheable: true, semanticReuseAllowed: true, allowAsync: true,
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
function handlers(calls: string[]): FabricHandlers {
  const result = async (name: string) => { calls.push(name); return { result: { provider: name }, evidenceDigest: digest(name) }; };
  return {
    localRules: async () => result('rules'), localModel: async () => result('local-model'), localAsync: async () => result('async'),
    burstNode: async () => result('burst'), externalModel: async () => result('external'),
  };
}

test('router uses the cheapest sovereign route that satisfies quality, latency, sensitivity and cost', () => {
  assert.equal(chooseExecutionTarget(request({ deterministic: true }), policy(), estimate(), undefined), 'LOCAL_RULES');
  assert.equal(chooseExecutionTarget(request(), policy(), estimate(), undefined), 'LOCAL_MODEL');
  assert.equal(chooseExecutionTarget(request({ requiredQuality: 0.95 }), policy(), estimate(), undefined), 'LOCAL_ASYNC');
  assert.equal(chooseExecutionTarget(request({ requiredQuality: 0.95, allowAsync: false }), policy(), estimate(), undefined), 'BURST_NODE');
  assert.equal(chooseExecutionTarget(request({ requiredQuality: 0.95, allowAsync: false }), policy({ allowBurstNode: false }), estimate(), undefined), 'EXTERNAL_MODEL');
  assert.equal(chooseExecutionTarget(request({ requiredQuality: 0.95, allowAsync: false, sensitivity: 'RESTRICTED' }), policy({ allowBurstNode: false }), estimate(), undefined), 'BLOCK');
  assert.equal(chooseExecutionTarget(request({ requiredQuality: 0.95, allowAsync: false }), policy({ allowBurstNode: false }), estimate({ externalCostMicros: 1001 }), undefined), 'BLOCK');
  assert.equal(chooseExecutionTarget(request({ deterministic: true, allowAsync: false }), policy({ allowLocalModel: false, allowBurstNode: false, allowExternalModel: false }), estimate({ localRulesLatencyMs: 501 }), undefined), 'BLOCK');
});

test('router never accepts a policy from another tenant and rejects invalid estimates', () => {
  assert.throws(() => chooseExecutionTarget(request(), policy({ tenantId: 'tenant-b' }), estimate(), undefined), /routing_policy_tenant_mismatch/);
  assert.throws(() => chooseExecutionTarget(request(), policy(), estimate({ externalLatencyMs: -1 }), undefined), /estimate_external_latency_invalid/);
  assert.throws(() => chooseExecutionTarget(request(), policy({ localAsynchronousComputeUnits: 2, localSynchronousComputeUnits: 3 }), estimate(), undefined), /policy_async_below_sync/);
});

test('cache is bound to tenant, policy, authority, source, sensitivity and freshness', () => {
  const cache = new TenantSemanticCache(3); const base = request(); const stored = cache.put(base, { answer: 42 }, digest('evidence'), at);
  assert.equal(stored.resultDigest, digest({ answer: 42 }));
  assert.equal(cache.lookup(base, 0.5, new Date(at.getTime() + 1))?.kind, 'EXACT');
  for (const changed of [
    request({ tenantId: 'tenant-b' }), request({ sourceDigest: digest('source-2') }), request({ policyDigest: digest('policy-2') }),
    request({ authorityDigest: digest('authority-2') }), request({ sensitivity: 'CONFIDENTIAL' }),
  ]) assert.equal(cache.lookup(changed, 0.5, new Date(at.getTime() + 1)), undefined);
  assert.equal(cache.lookup(base, 0.5, new Date(at.getTime() + 60_000)), undefined);
});

test('semantic cache reuses only sufficiently similar non-restricted material inside the exact trust boundary', () => {
  const cache = new TenantSemanticCache(3); cache.put(request({ input: 'alpha beta gamma delta' }), 'cached', digest('evidence'), at);
  const semantic = cache.lookup(request({ requestId: 'request-2', input: 'alpha beta gamma epsilon' }), 0.5, new Date(at.getTime() + 1));
  assert.equal(semantic?.kind, 'SEMANTIC'); assert.ok((semantic?.similarity ?? 0) >= 0.5);
  assert.equal(cache.lookup(request({ input: 'unrelated words only' }), 0.5, new Date(at.getTime() + 1)), undefined);

  const restrictedStored = cache.put(request({ requestId: 'restricted-1', input: 'sealed alpha beta gamma', sensitivity: 'RESTRICTED' }), 'sealed', digest('restricted-evidence'), at);
  assert.deepEqual(restrictedStored.semanticTokens, []);
  assert.equal(cache.lookup(request({ requestId: 'restricted-2', input: 'sealed alpha beta delta', sensitivity: 'RESTRICTED' }), 0.5, new Date(at.getTime() + 1)), undefined);
  assert.deepEqual(semanticTokens('A, a, B!'), ['a', 'b']);
});

test('cache rejects conflicts, non-cacheable writes and evicts least recently used entries per tenant only', () => {
  const cache = new TenantSemanticCache(2);
  const one = request({ input: 'one' }); const two = request({ input: 'two' }); const three = request({ input: 'three' });
  cache.put(one, 1, digest('e1'), at); cache.put(two, 2, digest('e2'), at); cache.lookup(one, 1, new Date(at.getTime() + 1)); cache.put(three, 3, digest('e3'), at);
  assert.equal(cache.lookup(two, 1, new Date(at.getTime() + 2)), undefined); assert.equal(cache.size('tenant-a'), 2);
  cache.put(request({ tenantId: 'tenant-b', input: 'other' }), 4, digest('e4'), at); assert.equal(cache.size('tenant-b'), 1);
  assert.throws(() => cache.put(one, 99, digest('e1'), at), /cache_exact_key_conflict/);
  assert.throws(() => cache.put(request({ cacheable: false }), 1, digest('e'), at), /cache_request_not_cacheable/);
});

test('admission control provides hard global and tenant isolation with tamper-resistant release', () => {
  const admission = new SovereignAdmissionController(4, 3); const a = admission.acquire('tenant-a', 2); const b = admission.acquire('tenant-b', 2);
  assert.throws(() => admission.acquire('tenant-a', 2), /tenant_saturated/);
  assert.throws(() => admission.acquire('tenant-c', 1), /global_saturated/);
  assert.throws(() => admission.release({ ...a, units: 1 }), /lease_mismatch/);
  admission.release(a); admission.release(b); assert.deepEqual(admission.snapshot(), { globalActive: 0, tenantActive: {}, activeLeases: 0 });
  assert.throws(() => admission.release(a), /lease_unknown/);
});

test('single-flight executes identical concurrent work once and rejects key equivocation', async () => {
  const single = new SingleFlightCoordinator(); let release!: () => void; let calls = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const operation = async () => { calls += 1; await gate; return { result: 'ok', evidenceDigest: digest('ok') }; };
  const first = single.run('same', digest('request'), operation); const second = single.run('same', digest('request'), operation);
  await assert.rejects(single.run('same', digest('different'), operation), /singleflight_key_conflict/);
  release(); const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1); assert.equal(a.deduplicated, false); assert.equal(b.deduplicated, true); assert.equal(single.active, 0); assert.equal(single.joins, 1);
});

test('fabric integrates local routing, exact cache reuse and auditable savings', async () => {
  const calls: string[] = []; const ledger = new SovereignCostLedger();
  const fabric = new SovereignEfficiencyFabric(new TenantSemanticCache(5), new SovereignAdmissionController(10, 5), new SingleFlightCoordinator(), ledger, handlers(calls));
  const first = await fabric.execute(request(), policy(), estimate(), at); assert.equal(first.target, 'LOCAL_MODEL'); assert.equal(first.savedExternalCostMicros, 500);
  const second = await fabric.execute(request({ requestId: 'request-2' }), policy(), estimate(), new Date(at.getTime() + 10));
  assert.equal(second.target, 'CACHE_EXACT'); assert.equal(second.cacheHit, true); assert.deepEqual(calls, ['local-model']);
  assert.deepEqual(ledger.summary(), { operations: 2, cacheHits: 1, deduplicatedOperations: 0, externalOperations: 0, localOperations: 2, externalCostMicros: 0, savedExternalCostMicros: 1000, savingsRate: 1, chainValid: true });
});

test('fabric deduplicates concurrent equivalent requests across request identifiers', async () => {
  let resolve!: () => void; const gate = new Promise<void>((done) => { resolve = done; }); let calls = 0;
  const h = handlers([]); const delayed: FabricHandlers = { ...h, localModel: async () => { calls += 1; await gate; return { result: 'same', evidenceDigest: digest('same') }; } };
  const fabric = new SovereignEfficiencyFabric(new TenantSemanticCache(5), new SovereignAdmissionController(2, 2), new SingleFlightCoordinator(), new SovereignCostLedger(), delayed);
  const first = fabric.execute(request({ requestId: 'a', cacheable: false }), policy(), estimate(), at);
  const second = fabric.execute(request({ requestId: 'b', cacheable: false }), policy(), estimate(), at);
  resolve(); const results = await Promise.all([first, second]); assert.equal(calls, 1); assert.equal(results.filter((item) => item.deduplicated).length, 1);
});

test('fabric fails closed when no route is allowed and releases admission after handler failure', async () => {
  const admission = new SovereignAdmissionController(3, 3); const bad = handlers([]); const h: FabricHandlers = { ...bad, localModel: async () => { throw new Error('model_failed'); } };
  const fabric = new SovereignEfficiencyFabric(new TenantSemanticCache(2), admission, new SingleFlightCoordinator(), new SovereignCostLedger(), h);
  await assert.rejects(fabric.execute(request(), policy(), estimate(), at), /model_failed/); assert.equal(admission.snapshot().globalActive, 0);
  await assert.rejects(fabric.execute(request({ requiredQuality: 1, allowAsync: false, sensitivity: 'RESTRICTED' }), policy({ allowBurstNode: false }), estimate(), at), /sovereign_execution_blocked/);
});

test('cache key excludes request identity but binds operational and trust material', () => {
  assert.equal(exactCacheKey(request({ requestId: 'one' })), exactCacheKey(request({ requestId: 'two' })));
  assert.notEqual(exactCacheKey(request()), exactCacheKey(request({ input: 'changed' })));
});
