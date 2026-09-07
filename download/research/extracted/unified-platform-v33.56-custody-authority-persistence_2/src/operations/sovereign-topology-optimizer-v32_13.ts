import { sha256 } from '../contracts/crypto.js';

export interface InfrastructureOffer {
  readonly offerId: string;
  readonly providerId: string;
  readonly failureDomain: string;
  readonly monthlyCostMicros: number;
  readonly cpuCores: number;
  readonly memoryGiB: number;
  readonly nvmeGiB: number;
  readonly networkGbps: number;
  readonly roles: readonly ('COMPUTE' | 'DATABASE' | 'STORAGE' | 'WITNESS' | 'BACKUP')[];
}

export interface SovereignTopologyRequirement {
  readonly minimumComputeNodes: number;
  readonly minimumDatabaseNodes: number;
  readonly minimumWitnessNodes: number;
  readonly minimumBackupNodes: number;
  readonly minimumCpuCores: number;
  readonly minimumMemoryGiB: number;
  readonly minimumUsableNvmeGiB: number;
  readonly minimumFailureDomains: number;
  readonly minimumProviders: number;
  readonly maximumMonthlyCostMicros: number;
  readonly reservePercent: number;
}

export interface SovereignTopologyPlan {
  readonly status: 'OPTIMAL' | 'NO_FEASIBLE_PLAN';
  readonly selectedOfferIds: readonly string[];
  readonly monthlyCostMicros: number;
  readonly cpuCores: number;
  readonly memoryGiB: number;
  readonly usableNvmeGiB: number;
  readonly providers: readonly string[];
  readonly failureDomains: readonly string[];
  readonly computeNodes: number;
  readonly databaseNodes: number;
  readonly witnessNodes: number;
  readonly backupNodes: number;
  readonly evaluatedCombinations: number;
  readonly rejectedCombinations: number;
  readonly planDigest: string;
}

export function optimizeSovereignTopology(
  offers: readonly InfrastructureOffer[],
  requirement: SovereignTopologyRequirement,
): SovereignTopologyPlan {
  validateRequirement(requirement);
  validateOffers(offers);
  if (offers.length > 24) throw new Error('topology_offer_count_excessive');
  let evaluated = 0, rejected = 0;
  let best: Omit<SovereignTopologyPlan, 'status' | 'evaluatedCombinations' | 'rejectedCombinations' | 'planDigest'> | undefined;
  const count = 1 << offers.length;
  for (let mask = 1; mask < count; mask += 1) {
    const selected: InfrastructureOffer[] = [];
    for (let index = 0; index < offers.length; index += 1) if ((mask & (1 << index)) !== 0) selected.push(offers[index]!);
    evaluated += 1;
    const candidate = summarize(selected, requirement.reservePercent);
    if (!satisfies(candidate, requirement)) { rejected += 1; continue; }
    if (best === undefined || compare(candidate, best) < 0) best = candidate;
  }
  if (best === undefined) {
    const material = { selectedOfferIds: [] as string[], monthlyCostMicros: 0, cpuCores: 0, memoryGiB: 0, usableNvmeGiB: 0, providers: [] as string[], failureDomains: [] as string[], computeNodes: 0, databaseNodes: 0, witnessNodes: 0, backupNodes: 0, evaluatedCombinations: evaluated, rejectedCombinations: rejected };
    return { status: 'NO_FEASIBLE_PLAN', ...material, planDigest: sha256({ status: 'NO_FEASIBLE_PLAN', ...material }) };
  }
  const material = { ...best, evaluatedCombinations: evaluated, rejectedCombinations: rejected };
  return { status: 'OPTIMAL', ...material, planDigest: sha256({ status: 'OPTIMAL', ...material }) };
}

function summarize(selected: readonly InfrastructureOffer[], reservePercent: number): Omit<SovereignTopologyPlan, 'status' | 'evaluatedCombinations' | 'rejectedCombinations' | 'planDigest'> {
  const reserveFactor = (100 - reservePercent) / 100;
  return {
    selectedOfferIds: selected.map((item) => item.offerId).sort(),
    monthlyCostMicros: selected.reduce((sum, item) => sum + item.monthlyCostMicros, 0),
    cpuCores: Math.floor(selected.filter(hasRole('COMPUTE')).reduce((sum, item) => sum + item.cpuCores, 0) * reserveFactor),
    memoryGiB: Math.floor(selected.filter(hasRole('COMPUTE')).reduce((sum, item) => sum + item.memoryGiB, 0) * reserveFactor),
    usableNvmeGiB: Math.floor(selected.filter((item) => item.roles.includes('STORAGE')).reduce((sum, item) => sum + item.nvmeGiB, 0) / Math.max(1, selected.filter((item) => item.roles.includes('STORAGE')).length)),
    providers: [...new Set(selected.map((item) => item.providerId))].sort(),
    failureDomains: [...new Set(selected.map((item) => item.failureDomain))].sort(),
    computeNodes: selected.filter((item) => item.roles.includes('COMPUTE')).length,
    databaseNodes: selected.filter((item) => item.roles.includes('DATABASE')).length,
    witnessNodes: selected.filter((item) => item.roles.includes('WITNESS')).length,
    backupNodes: selected.filter((item) => item.roles.includes('BACKUP')).length,
  };
}

function hasRole(role: InfrastructureOffer['roles'][number]): (item: InfrastructureOffer) => boolean { return (item) => item.roles.includes(role); }
function satisfies(candidate: ReturnType<typeof summarize>, requirement: SovereignTopologyRequirement): boolean {
  return candidate.monthlyCostMicros <= requirement.maximumMonthlyCostMicros
    && candidate.computeNodes >= requirement.minimumComputeNodes
    && candidate.databaseNodes >= requirement.minimumDatabaseNodes
    && candidate.witnessNodes >= requirement.minimumWitnessNodes
    && candidate.backupNodes >= requirement.minimumBackupNodes
    && candidate.cpuCores >= requirement.minimumCpuCores
    && candidate.memoryGiB >= requirement.minimumMemoryGiB
    && candidate.usableNvmeGiB >= requirement.minimumUsableNvmeGiB
    && candidate.failureDomains.length >= requirement.minimumFailureDomains
    && candidate.providers.length >= requirement.minimumProviders;
}
function compare(left: ReturnType<typeof summarize>, right: ReturnType<typeof summarize>): number {
  return left.monthlyCostMicros - right.monthlyCostMicros
    || left.selectedOfferIds.length - right.selectedOfferIds.length
    || right.cpuCores - left.cpuCores
    || right.memoryGiB - left.memoryGiB
    || left.selectedOfferIds.join(',').localeCompare(right.selectedOfferIds.join(','));
}
function validateOffers(offers: readonly InfrastructureOffer[]): void {
  const ids = new Set<string>();
  for (const offer of offers) {
    if (offer.offerId.trim() === '' || offer.providerId.trim() === '' || offer.failureDomain.trim() === '') throw new Error('topology_offer_identity_invalid');
    if (ids.has(offer.offerId)) throw new Error('topology_offer_duplicate'); ids.add(offer.offerId);
    for (const value of [offer.monthlyCostMicros, offer.cpuCores, offer.memoryGiB, offer.nvmeGiB, offer.networkGbps]) if (!Number.isInteger(value) || value < 0) throw new Error('topology_offer_capacity_invalid');
    if (offer.monthlyCostMicros === 0 || offer.roles.length === 0 || new Set(offer.roles).size !== offer.roles.length) throw new Error('topology_offer_roles_invalid');
  }
}
function validateRequirement(requirement: SovereignTopologyRequirement): void {
  for (const value of [requirement.minimumComputeNodes, requirement.minimumDatabaseNodes, requirement.minimumWitnessNodes, requirement.minimumBackupNodes, requirement.minimumCpuCores, requirement.minimumMemoryGiB, requirement.minimumUsableNvmeGiB, requirement.minimumFailureDomains, requirement.minimumProviders, requirement.maximumMonthlyCostMicros]) if (!Number.isInteger(value) || value < 0) throw new Error('topology_requirement_invalid');
  if (requirement.minimumComputeNodes < 2 || requirement.minimumDatabaseNodes < 2 || requirement.minimumWitnessNodes < 1 || requirement.minimumBackupNodes < 1 || requirement.maximumMonthlyCostMicros === 0) throw new Error('topology_resilience_floor_invalid');
  if (!Number.isInteger(requirement.reservePercent) || requirement.reservePercent < 0 || requirement.reservePercent >= 100) throw new Error('topology_reserve_invalid');
}
