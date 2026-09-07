import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '../src/contracts/crypto.js';
import { planSovereignCapacityV32_13, type CapacityPolicyV32_13, type CapacitySnapshotV32_13, type SovereignBurstOfferV32_13 } from '../src/operations/sovereign-capacity-controller-v32_13.js';

const snapshot = (patch: Partial<CapacitySnapshotV32_13> = {}): CapacitySnapshotV32_13 => ({ tenantId:'tenant-a',sequence:1,observedAt:'2026-07-20T12:00:00.000Z',queueDepth:0,oldestJobAgeMs:0,activeLocalWorkers:0,activeBurstNodes:0,idleForMs:0,workloadSensitivity:'INTERNAL',previousPlanDigest:null,...patch });
const policy = (patch: Partial<CapacityPolicyV32_13> = {}): CapacityPolicyV32_13 => ({ tenantId:'tenant-a',maximumLocalWorkers:8,maximumBurstNodes:3,jobsPerLocalWorker:10,minimumLocalWorkersWhenBusy:1,idleScaleToZeroMs:60_000,burstQueueThreshold:10,maximumBurstHourlyCostMicros:900,maximumBurstSensitivity:'CONFIDENTIAL',maximumBurstStartupMs:30_000,allowedProviderIds:['sovereign-a','sovereign-b'],allowedRegionIds:['eu-1','eu-2'],...patch });
const offers: readonly SovereignBurstOfferV32_13[] = [
  { offerId:'fast-expensive',providerId:'sovereign-a',regionId:'eu-1',hourlyCostMicros:400,capacityJobsPerNode:40,startupMs:5_000,observed:true,dataSovereign:true },
  { offerId:'efficient',providerId:'sovereign-b',regionId:'eu-2',hourlyCostMicros:300,capacityJobsPerNode:50,startupMs:10_000,observed:true,dataSovereign:true },
  { offerId:'unobserved-cheap',providerId:'sovereign-a',regionId:'eu-1',hourlyCostMicros:1,capacityJobsPerNode:100,startupMs:1,observed:false,dataSovereign:true },
];

test('capacity controller scales local workers from zero and holds inside the envelope', () => {
  const start = planSovereignCapacityV32_13(snapshot({ queueDepth:19 }), policy(), offers);
  assert.equal(start.status,'PLANNED'); assert.equal(start.targetLocalWorkers,2); assert.deepEqual(start.actions.map((x)=>x.kind),['START_LOCAL_WORKERS']); assert.equal(start.proposalOnly,true);
  const hold = planSovereignCapacityV32_13(snapshot({ activeLocalWorkers:2,queueDepth:19 }),policy(),offers);
  assert.deepEqual(hold.actions.map((x)=>x.kind),['HOLD']); assert.match(hold.planDigest,/^[0-9a-f]{64}$/);
});

test('idle capacity scales to zero and paid burst nodes are drained', () => {
  const plan = planSovereignCapacityV32_13(snapshot({ activeLocalWorkers:3,activeBurstNodes:2,idleForMs:60_000 }),policy(),offers);
  assert.equal(plan.targetLocalWorkers,0); assert.equal(plan.targetBurstNodes,0);
  assert.deepEqual(plan.actions.map((x)=>x.kind),['STOP_LOCAL_WORKERS','DRAIN_BURST']);
});

test('overflow selects the lowest cost qualified sovereign offer within budget', () => {
  const plan = planSovereignCapacityV32_13(snapshot({ queueDepth:150,activeLocalWorkers:8 }),policy(),offers);
  assert.equal(plan.status,'PLANNED'); assert.equal(plan.actions[0]?.kind,'REQUEST_BURST'); assert.equal(plan.actions[0]?.offerId,'efficient');
  assert.equal(plan.actions[0]?.units,2); assert.equal(plan.projectedBurstHourlyCostMicros,600); assert.equal(plan.targetBurstNodes,2);
});

test('restricted, disallowed, slow, non-sovereign and over-budget burst choices fail closed', () => {
  assert.equal(planSovereignCapacityV32_13(snapshot({ queueDepth:150,activeLocalWorkers:8,workloadSensitivity:'RESTRICTED' }),policy(),offers).status,'BLOCKED');
  assert.equal(planSovereignCapacityV32_13(snapshot({ queueDepth:150,activeLocalWorkers:8 }),policy({ allowedProviderIds:['missing'] }),offers).status,'BLOCKED');
  assert.equal(planSovereignCapacityV32_13(snapshot({ queueDepth:150,activeLocalWorkers:8 }),policy({ maximumBurstStartupMs:2 }),offers).status,'BLOCKED');
  assert.equal(planSovereignCapacityV32_13(snapshot({ queueDepth:150,activeLocalWorkers:8 }),policy({ maximumBurstHourlyCostMicros:500 }),offers).actions[0]?.reason,'burst-budget-exceeded');
  const nonSovereign = offers.map((offer)=>({ ...offer,dataSovereign:false,observed:true }));
  assert.equal(planSovereignCapacityV32_13(snapshot({ queueDepth:150,activeLocalWorkers:8 }),policy(),nonSovereign).status,'BLOCKED');
});

test('capacity plan lineage and all structural boundaries are validated', () => {
  const previous=sha256('previous'); const continued=planSovereignCapacityV32_13(snapshot({sequence:2,previousPlanDigest:previous}),policy(),offers); assert.equal(continued.previousPlanDigest,previous);
  const cases: readonly [CapacitySnapshotV32_13,CapacityPolicyV32_13,readonly SovereignBurstOfferV32_13[],RegExp][] = [
    [snapshot({tenantId:''}),policy(),offers,/snapshot_tenant_required/], [snapshot({sequence:0}),policy(),offers,/snapshot_sequence_invalid/], [snapshot({observedAt:'bad'}),policy(),offers,/snapshot_time_invalid/],
    [snapshot({queueDepth:-1}),policy(),offers,/queue_depth_invalid/], [snapshot({workloadSensitivity:'BAD' as never}),policy(),offers,/sensitivity_invalid/], [snapshot({previousPlanDigest:previous}),policy(),offers,/initial_previous_digest_forbidden/],
    [snapshot({sequence:2}),policy(),offers,/previous_digest_required/], [snapshot(),policy({tenantId:'tenant-b'}),offers,/policy_tenant_mismatch/], [snapshot(),policy({minimumLocalWorkersWhenBusy:9}),offers,/minimum_busy_exceeds_maximum/],
    [snapshot(),policy({allowedProviderIds:[]}),offers,/provider_allowlist_invalid/], [snapshot(),policy(),[offers[0]!,offers[0]!],/offer_duplicate/], [snapshot(),policy(),[{...offers[0]!,hourlyCostMicros:0}],/offer_cost_invalid/],
  ];
  for(const [s,p,o,error] of cases) assert.throws(()=>planSovereignCapacityV32_13(s,p,o),error);
});
