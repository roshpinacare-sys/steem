import { sha256 } from '../contracts/crypto.js';

export type CapacitySensitivityV32_13 = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';

export interface CapacitySnapshotV32_13 {
  readonly tenantId: string;
  readonly sequence: number;
  readonly observedAt: string;
  readonly queueDepth: number;
  readonly oldestJobAgeMs: number;
  readonly activeLocalWorkers: number;
  readonly activeBurstNodes: number;
  readonly idleForMs: number;
  readonly workloadSensitivity: CapacitySensitivityV32_13;
  readonly previousPlanDigest: string | null;
}

export interface CapacityPolicyV32_13 {
  readonly tenantId: string;
  readonly maximumLocalWorkers: number;
  readonly maximumBurstNodes: number;
  readonly jobsPerLocalWorker: number;
  readonly minimumLocalWorkersWhenBusy: number;
  readonly idleScaleToZeroMs: number;
  readonly burstQueueThreshold: number;
  readonly maximumBurstHourlyCostMicros: number;
  readonly maximumBurstSensitivity: Exclude<CapacitySensitivityV32_13, 'RESTRICTED'>;
  readonly maximumBurstStartupMs: number;
  readonly allowedProviderIds: readonly string[];
  readonly allowedRegionIds: readonly string[];
}

export interface SovereignBurstOfferV32_13 {
  readonly offerId: string;
  readonly providerId: string;
  readonly regionId: string;
  readonly hourlyCostMicros: number;
  readonly capacityJobsPerNode: number;
  readonly startupMs: number;
  readonly observed: boolean;
  readonly dataSovereign: boolean;
}

export interface CapacityActionV32_13 {
  readonly kind: 'START_LOCAL_WORKERS' | 'STOP_LOCAL_WORKERS' | 'REQUEST_BURST' | 'DRAIN_BURST' | 'HOLD' | 'BLOCK';
  readonly units: number;
  readonly offerId?: string;
  readonly reason: string;
}

export interface CapacityPlanV32_13 {
  readonly version: '32.13';
  readonly tenantId: string;
  readonly sequence: number;
  readonly observedAt: string;
  readonly proposalOnly: true;
  readonly status: 'PLANNED' | 'BLOCKED';
  readonly targetLocalWorkers: number;
  readonly targetBurstNodes: number;
  readonly projectedBurstHourlyCostMicros: number;
  readonly actions: readonly CapacityActionV32_13[];
  readonly previousPlanDigest: string | null;
  readonly planDigest: string;
}

export function planSovereignCapacityV32_13(
  snapshot: CapacitySnapshotV32_13,
  policy: CapacityPolicyV32_13,
  offers: readonly SovereignBurstOfferV32_13[],
): CapacityPlanV32_13 {
  validateSnapshot(snapshot);
  validatePolicy(policy);
  validateOffers(offers);
  if (snapshot.tenantId !== policy.tenantId) throw new Error('capacity_policy_tenant_mismatch');

  let targetLocalWorkers = snapshot.activeLocalWorkers;
  const actions: CapacityActionV32_13[] = [];
  if (snapshot.queueDepth > 0) {
    targetLocalWorkers = Math.min(
      policy.maximumLocalWorkers,
      Math.max(policy.minimumLocalWorkersWhenBusy, Math.ceil(snapshot.queueDepth / policy.jobsPerLocalWorker)),
    );
  } else if (snapshot.idleForMs >= policy.idleScaleToZeroMs) {
    targetLocalWorkers = 0;
  }

  if (targetLocalWorkers > snapshot.activeLocalWorkers) {
    actions.push({ kind: 'START_LOCAL_WORKERS', units: targetLocalWorkers - snapshot.activeLocalWorkers, reason: 'bounded-local-capacity-required' });
  } else if (targetLocalWorkers < snapshot.activeLocalWorkers) {
    actions.push({ kind: 'STOP_LOCAL_WORKERS', units: snapshot.activeLocalWorkers - targetLocalWorkers, reason: 'idle-scale-to-zero-or-capacity-reduction' });
  }

  let targetBurstNodes = snapshot.activeBurstNodes;
  let projectedBurstHourlyCostMicros = 0;
  const localCapacity = targetLocalWorkers * policy.jobsPerLocalWorker;
  const residualQueue = Math.max(0, snapshot.queueDepth - localCapacity);

  if (snapshot.queueDepth === 0 && snapshot.activeBurstNodes > 0) {
    actions.push({ kind: 'DRAIN_BURST', units: snapshot.activeBurstNodes, reason: 'queue-empty-release-paid-capacity' });
    targetBurstNodes = 0;
  } else if (residualQueue >= policy.burstQueueThreshold && snapshot.activeBurstNodes < policy.maximumBurstNodes) {
    const eligible = offers
      .filter((offer) => offer.observed && offer.dataSovereign)
      .filter((offer) => policy.allowedProviderIds.includes(offer.providerId) && policy.allowedRegionIds.includes(offer.regionId))
      .filter((offer) => offer.startupMs <= policy.maximumBurstStartupMs)
      .filter(() => sensitivityRank(snapshot.workloadSensitivity) <= sensitivityRank(policy.maximumBurstSensitivity))
      .sort((left, right) => (left.hourlyCostMicros / left.capacityJobsPerNode) - (right.hourlyCostMicros / right.capacityJobsPerNode)
        || left.hourlyCostMicros - right.hourlyCostMicros
        || left.offerId.localeCompare(right.offerId));
    const selected = eligible[0];
    if (selected === undefined) {
      actions.push({ kind: 'BLOCK', units: 0, reason: 'no-qualified-sovereign-burst-offer' });
    } else {
      const availableSlots = policy.maximumBurstNodes - snapshot.activeBurstNodes;
      const requested = Math.min(availableSlots, Math.ceil(residualQueue / selected.capacityJobsPerNode));
      const cost = requested * selected.hourlyCostMicros;
      if (cost > policy.maximumBurstHourlyCostMicros) {
        actions.push({ kind: 'BLOCK', units: 0, offerId: selected.offerId, reason: 'burst-budget-exceeded' });
      } else {
        actions.push({ kind: 'REQUEST_BURST', units: requested, offerId: selected.offerId, reason: 'qualified-sovereign-overflow-capacity' });
        targetBurstNodes += requested;
        projectedBurstHourlyCostMicros = cost;
      }
    }
  }

  if (actions.length === 0) actions.push({ kind: 'HOLD', units: 0, reason: 'capacity-within-policy-envelope' });
  const status = actions.some((action) => action.kind === 'BLOCK') ? 'BLOCKED' as const : 'PLANNED' as const;
  const material = {
    version: '32.13' as const,
    tenantId: snapshot.tenantId,
    sequence: snapshot.sequence,
    observedAt: snapshot.observedAt,
    proposalOnly: true as const,
    status,
    targetLocalWorkers,
    targetBurstNodes,
    projectedBurstHourlyCostMicros,
    actions,
    previousPlanDigest: snapshot.previousPlanDigest,
  };
  return { ...material, planDigest: sha256(material) };
}

function validateSnapshot(snapshot: CapacitySnapshotV32_13): void {
  nonEmpty(snapshot.tenantId, 'capacity_snapshot_tenant_required');
  positiveInteger(snapshot.sequence, 'capacity_snapshot_sequence_invalid');
  if (!Number.isFinite(Date.parse(snapshot.observedAt))) throw new Error('capacity_snapshot_time_invalid');
  for (const [value, code] of [
    [snapshot.queueDepth, 'capacity_queue_depth_invalid'],
    [snapshot.oldestJobAgeMs, 'capacity_oldest_job_age_invalid'],
    [snapshot.activeLocalWorkers, 'capacity_active_local_invalid'],
    [snapshot.activeBurstNodes, 'capacity_active_burst_invalid'],
    [snapshot.idleForMs, 'capacity_idle_time_invalid'],
  ] as const) nonNegativeInteger(value, code);
  if (!['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'].includes(snapshot.workloadSensitivity)) throw new Error('capacity_sensitivity_invalid');
  if (snapshot.sequence === 1 && snapshot.previousPlanDigest !== null) throw new Error('capacity_initial_previous_digest_forbidden');
  if (snapshot.sequence > 1 && (snapshot.previousPlanDigest === null || !digest(snapshot.previousPlanDigest))) throw new Error('capacity_previous_digest_required');
}

function validatePolicy(policy: CapacityPolicyV32_13): void {
  nonEmpty(policy.tenantId, 'capacity_policy_tenant_required');
  positiveInteger(policy.maximumLocalWorkers, 'capacity_maximum_local_invalid');
  nonNegativeInteger(policy.maximumBurstNodes, 'capacity_maximum_burst_invalid');
  positiveInteger(policy.jobsPerLocalWorker, 'capacity_jobs_per_worker_invalid');
  positiveInteger(policy.minimumLocalWorkersWhenBusy, 'capacity_minimum_busy_invalid');
  if (policy.minimumLocalWorkersWhenBusy > policy.maximumLocalWorkers) throw new Error('capacity_minimum_busy_exceeds_maximum');
  positiveInteger(policy.idleScaleToZeroMs, 'capacity_idle_scale_invalid');
  positiveInteger(policy.burstQueueThreshold, 'capacity_burst_threshold_invalid');
  nonNegativeInteger(policy.maximumBurstHourlyCostMicros, 'capacity_burst_budget_invalid');
  positiveInteger(policy.maximumBurstStartupMs, 'capacity_burst_startup_invalid');
  if (!['PUBLIC', 'INTERNAL', 'CONFIDENTIAL'].includes(policy.maximumBurstSensitivity)) throw new Error('capacity_burst_sensitivity_invalid');
  uniqueNonEmpty(policy.allowedProviderIds, 'capacity_provider_allowlist_invalid');
  uniqueNonEmpty(policy.allowedRegionIds, 'capacity_region_allowlist_invalid');
}

function validateOffers(offers: readonly SovereignBurstOfferV32_13[]): void {
  const ids = new Set<string>();
  for (const offer of offers) {
    for (const [value, code] of [[offer.offerId, 'capacity_offer_id_required'], [offer.providerId, 'capacity_offer_provider_required'], [offer.regionId, 'capacity_offer_region_required']] as const) nonEmpty(value, code);
    if (ids.has(offer.offerId)) throw new Error('capacity_offer_duplicate');
    ids.add(offer.offerId);
    positiveInteger(offer.hourlyCostMicros, 'capacity_offer_cost_invalid');
    positiveInteger(offer.capacityJobsPerNode, 'capacity_offer_capacity_invalid');
    nonNegativeInteger(offer.startupMs, 'capacity_offer_startup_invalid');
  }
}

function uniqueNonEmpty(values: readonly string[], code: string): void {
  if (values.length === 0 || values.some((value) => value.trim() === '') || new Set(values).size !== values.length) throw new Error(code);
}
function sensitivityRank(value: CapacitySensitivityV32_13): number { return ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'].indexOf(value); }
function nonEmpty(value: string, code: string): void { if (value.trim() === '') throw new Error(code); }
function positiveInteger(value: number, code: string): void { if (!Number.isInteger(value) || value <= 0) throw new Error(code); }
function nonNegativeInteger(value: number, code: string): void { if (!Number.isInteger(value) || value < 0) throw new Error(code); }
function digest(value: string): boolean { return /^[0-9a-f]{64}$/.test(value); }
