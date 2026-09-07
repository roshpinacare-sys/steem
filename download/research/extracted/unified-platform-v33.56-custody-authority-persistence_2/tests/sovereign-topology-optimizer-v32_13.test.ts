import assert from 'node:assert/strict';
import test from 'node:test';
import { optimizeSovereignTopology, type InfrastructureOffer, type SovereignTopologyRequirement } from '../src/operations/sovereign-topology-optimizer-v32_13.js';

const offers: readonly InfrastructureOffer[] = [
  { offerId: 'large-a', providerId: 'provider-main', failureDomain: 'dc-a', monthlyCostMicros: 50_000_000, cpuCores: 16, memoryGiB: 64, nvmeGiB: 2000, networkGbps: 1, roles: ['COMPUTE','DATABASE','STORAGE'] },
  { offerId: 'large-b', providerId: 'provider-main', failureDomain: 'dc-b', monthlyCostMicros: 50_000_000, cpuCores: 16, memoryGiB: 64, nvmeGiB: 2000, networkGbps: 1, roles: ['COMPUTE','DATABASE','STORAGE'] },
  { offerId: 'large-c', providerId: 'provider-main', failureDomain: 'dc-c', monthlyCostMicros: 50_000_000, cpuCores: 16, memoryGiB: 64, nvmeGiB: 2000, networkGbps: 1, roles: ['COMPUTE','DATABASE','STORAGE','WITNESS'] },
  { offerId: 'witness-external', providerId: 'provider-independent', failureDomain: 'dc-x', monthlyCostMicros: 5_000_000, cpuCores: 2, memoryGiB: 4, nvmeGiB: 80, networkGbps: 1, roles: ['WITNESS'] },
  { offerId: 'backup-external', providerId: 'provider-independent', failureDomain: 'dc-y', monthlyCostMicros: 8_000_000, cpuCores: 2, memoryGiB: 4, nvmeGiB: 4000, networkGbps: 1, roles: ['BACKUP'] },
  { offerId: 'small-compute', providerId: 'provider-main', failureDomain: 'dc-b', monthlyCostMicros: 25_000_000, cpuCores: 8, memoryGiB: 16, nvmeGiB: 500, networkGbps: 1, roles: ['COMPUTE','DATABASE','STORAGE'] },
];
const requirement: SovereignTopologyRequirement = { minimumComputeNodes: 2, minimumDatabaseNodes: 2, minimumWitnessNodes: 1, minimumBackupNodes: 1, minimumCpuCores: 24, minimumMemoryGiB: 96, minimumUsableNvmeGiB: 1500, minimumFailureDomains: 4, minimumProviders: 2, maximumMonthlyCostMicros: 200_000_000, reservePercent: 20 };

test('exact optimizer selects two strong nodes plus small independent witness and backup instead of a third strong node', () => {
  const plan = optimizeSovereignTopology(offers, requirement);
  assert.equal(plan.status, 'OPTIMAL');
  assert.deepEqual(plan.selectedOfferIds, ['backup-external','large-a','large-b','witness-external']);
  assert.equal(plan.monthlyCostMicros, 113_000_000); assert.equal(plan.computeNodes, 2); assert.equal(plan.databaseNodes, 2);
  assert.equal(plan.providers.length, 2); assert.equal(plan.failureDomains.length, 4); assert.equal(plan.cpuCores, 25); assert.equal(plan.memoryGiB, 102);
  assert.match(plan.planDigest, /^[0-9a-f]{64}$/);
});

test('optimizer fails closed when provider independence or reserved capacity cannot be met', () => {
  const singleProvider = offers.map((item) => ({ ...item, providerId: 'provider-main' }));
  const noIndependent = optimizeSovereignTopology(singleProvider, requirement);
  assert.equal(noIndependent.status, 'NO_FEASIBLE_PLAN');
  const providerRelaxed = optimizeSovereignTopology(singleProvider, { ...requirement, minimumProviders: 1 });
  assert.equal(providerRelaxed.status, 'OPTIMAL');

  const tooMuchReserve = optimizeSovereignTopology(offers, { ...requirement, reservePercent: 75 });
  assert.equal(tooMuchReserve.status, 'NO_FEASIBLE_PLAN');
});

test('optimizer rejects duplicate offers, malformed capacities and weakened resilience floors', () => {
  assert.throws(() => optimizeSovereignTopology([...offers, offers[0]!], requirement), /offer_duplicate/);
  assert.throws(() => optimizeSovereignTopology([{ ...offers[0]!, cpuCores: -1 }], requirement), /offer_capacity_invalid/);
  assert.throws(() => optimizeSovereignTopology(offers, { ...requirement, minimumComputeNodes: 1 }), /resilience_floor_invalid/);
  assert.throws(() => optimizeSovereignTopology(offers, { ...requirement, reservePercent: 100 }), /reserve_invalid/);
});

test('optimizer rejects blank offer identities, zero-cost role sets, duplicate roles and negative requirements', () => {
  assert.throws(() => optimizeSovereignTopology([{ ...offers[0]!, offerId: ' ' }], requirement), /offer_identity_invalid/);
  assert.throws(() => optimizeSovereignTopology([{ ...offers[0]!, monthlyCostMicros: 0 }], requirement), /offer_roles_invalid/);
  assert.throws(() => optimizeSovereignTopology([{ ...offers[0]!, roles: ['COMPUTE', 'COMPUTE'] }], requirement), /offer_roles_invalid/);
  assert.throws(() => optimizeSovereignTopology(offers, { ...requirement, minimumCpuCores: -1 }), /requirement_invalid/);
  assert.throws(() => optimizeSovereignTopology(offers, { ...requirement, reservePercent: -1 }), /reserve_invalid/);
});
