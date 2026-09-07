import { sha256 } from '../contracts/crypto.js';

export type ExcellenceAxisId =
  | 'requirement-fidelity'
  | 'correctness-invariants'
  | 'adversarial-test-depth'
  | 'security-trust-sovereignty'
  | 'durability-concurrency-consistency'
  | 'architecture-modularity'
  | 'evidence-integrity-traceability'
  | 'performance-resource-efficiency'
  | 'stability-determinism'
  | 'operability-recovery'
  | 'portability-supply-chain-isolation'
  | 'product-value-operator-ux'
  | 'external-readiness-scalability'
  | 'engineering-efficiency-change-safety';

export interface ExcellenceAxisDefinition {
  readonly axisId: ExcellenceAxisId;
  readonly weight: number;
  readonly projectFloor: number;
  readonly cycleFloor: number;
  readonly productionFloor: number;
  readonly promotionCritical: boolean;
  readonly description: string;
}

export interface ExcellenceAxisObservation {
  readonly axisId: ExcellenceAxisId;
  readonly projectScore: number;
  readonly cycleScore: number;
  readonly confidence: number;
  readonly evidenceRefs: readonly string[];
  readonly limitations: readonly string[];
  readonly blockers: readonly string[];
}

export interface ExcellenceScorecardInput {
  readonly version: string;
  readonly definitions?: readonly ExcellenceAxisDefinition[];
  readonly observations: readonly ExcellenceAxisObservation[];
  readonly baseline?: readonly ExcellenceAxisObservation[];
}

export interface ExcellenceAxisResult extends ExcellenceAxisObservation {
  readonly weight: number;
  readonly projectFloor: number;
  readonly cycleFloor: number;
  readonly productionFloor: number;
  readonly promotionCritical: boolean;
  readonly projectGap: number;
  readonly cycleGap: number;
  readonly confidenceAdjustedProjectScore: number;
  readonly confidenceAdjustedCycleScore: number;
  readonly deltaProjectScore: number | null;
  readonly deltaCycleScore: number | null;
  readonly status: 'PASS' | 'WATCH' | 'BLOCK';
}

export const SCORE_DELTA_MATERIALITY_POINTS = 1 as const;

export interface ExcellenceScorecardReport {
  readonly version: string;
  readonly status: 'PASS' | 'PASS_WITH_LIMITATIONS' | 'BLOCK';
  readonly readiness: 'INTERNAL_EXCELLENCE_CYCLE' | 'INTEGRATED_PILOT' | 'PRODUCTION_CANDIDATE';
  readonly productionPromotion: 'BLOCKED' | 'ELIGIBLE_FOR_EXTERNAL_REVIEW';
  readonly metrics: {
    readonly axisCount: 14;
    readonly totalWeight: 100;
    readonly projectWeightedScore: number;
    readonly cycleWeightedScore: number;
    readonly confidenceAdjustedProjectScore: number;
    readonly confidenceAdjustedCycleScore: number;
    readonly minimumProjectScore: number;
    readonly minimumCycleScore: number;
    readonly improvementCount: number;
    readonly regressionCount: number;
    readonly blockerCount: number;
    readonly materialityThresholdPoints: 1;
  };
  readonly axes: readonly ExcellenceAxisResult[];
  readonly weakestAxes: readonly ExcellenceAxisId[];
  readonly nextPriorities: readonly { readonly axisId: ExcellenceAxisId; readonly priorityScore: number; readonly reasons: readonly string[] }[];
  readonly limitations: readonly string[];
  readonly reportDigest: string;
}

export const FOURTEEN_AXIS_DEFINITIONS: readonly ExcellenceAxisDefinition[] = [
  axis('requirement-fidelity', 7, 85, 85, 92, true, 'Requirements, governance authority and canonical continuation are current and unambiguous.'),
  axis('correctness-invariants', 10, 90, 90, 96, true, 'Behavioral correctness and safety invariants remain true across normal and hostile paths.'),
  axis('adversarial-test-depth', 9, 88, 88, 95, true, 'Tests include branch, mutation, generative, state-machine, concurrency and falsification depth.'),
  axis('security-trust-sovereignty', 10, 88, 88, 96, true, 'Identity, authority, key lifecycle, tenant and provider trust boundaries fail closed.'),
  axis('durability-concurrency-consistency', 9, 88, 88, 95, true, 'Crash consistency, atomic publication, replay, leases and concurrent writers preserve state.'),
  axis('architecture-modularity', 8, 85, 85, 93, true, 'Layer boundaries, dependency direction, capability closure and non-duplication remain explicit.'),
  axis('evidence-integrity-traceability', 8, 88, 88, 96, true, 'Claims bind to fresh, authentic, complete and source-digest-specific evidence.'),
  axis('performance-resource-efficiency', 6, 75, 80, 90, false, 'Latency, throughput and resource budgets are measured without hiding regressions.'),
  axis('stability-determinism', 6, 88, 88, 95, true, 'Repeated runs remain deterministic, non-flaky and bounded in variance.'),
  axis('operability-recovery', 7, 82, 85, 94, true, 'Operators can diagnose, contain, recover and recertify without unsafe global shutdown.'),
  axis('portability-supply-chain-isolation', 6, 82, 85, 95, true, 'Build, archive, dependencies and isolation remain reproducible and bounded.'),
  axis('product-value-operator-ux', 6, 60, 80, 90, false, 'Capabilities reduce operator effort and errors in measured, consented workflows.'),
  axis('external-readiness-scalability', 5, 35, 70, 92, true, 'Multi-host, PostgreSQL, HSM/KMS, independent review and scale are externally qualified.'),
  axis('engineering-efficiency-change-safety', 3, 80, 85, 92, false, 'Changes are small, reversible, complexity-budgeted and efficiently verified.'),
] as const;

export function evaluateExcellenceScorecard(input: ExcellenceScorecardInput): ExcellenceScorecardReport {
  if (input.version.trim() === '') throw new Error('excellence_version_required');
  const definitions = input.definitions ?? FOURTEEN_AXIS_DEFINITIONS;
  validateDefinitions(definitions);
  const observations = indexObservations(input.observations, 'current');
  const baseline = input.baseline === undefined ? undefined : indexObservations(input.baseline, 'baseline');
  const axes = definitions.map((definition): ExcellenceAxisResult => {
    const observation = observations.get(definition.axisId);
    if (observation === undefined) throw new Error(`excellence_axis_missing:${definition.axisId}`);
    const baselineObservation = baseline?.get(definition.axisId);
    const projectGap = round(Math.max(0, definition.projectFloor - observation.projectScore));
    const cycleGap = round(Math.max(0, definition.cycleFloor - observation.cycleScore));
    const status: ExcellenceAxisResult['status'] = observation.blockers.length > 0 || (definition.promotionCritical && (projectGap > 0 || cycleGap > 0)) ? 'BLOCK'
      : projectGap > 0 || cycleGap > 0 || observation.confidence < 0.8 || observation.limitations.length > 0 ? 'WATCH' : 'PASS';
    return {
      ...observation,
      weight: definition.weight,
      projectFloor: definition.projectFloor,
      cycleFloor: definition.cycleFloor,
      productionFloor: definition.productionFloor,
      promotionCritical: definition.promotionCritical,
      projectGap,
      cycleGap,
      confidenceAdjustedProjectScore: round(observation.projectScore * observation.confidence),
      confidenceAdjustedCycleScore: round(observation.cycleScore * observation.confidence),
      deltaProjectScore: baselineObservation === undefined ? null : round(observation.projectScore - baselineObservation.projectScore),
      deltaCycleScore: baselineObservation === undefined ? null : round(observation.cycleScore - baselineObservation.cycleScore),
      status,
    };
  });
  const projectWeightedScore = weighted(axes, 'projectScore');
  const cycleWeightedScore = weighted(axes, 'cycleScore');
  const confidenceAdjustedProjectScore = weighted(axes, 'confidenceAdjustedProjectScore');
  const confidenceAdjustedCycleScore = weighted(axes, 'confidenceAdjustedCycleScore');
  const blockers = axes.flatMap((item) => item.blockers.map((blocker) => `${item.axisId}:${blocker}`));
  const regressions = axes.filter((item) => (item.deltaProjectScore ?? 0) < -SCORE_DELTA_MATERIALITY_POINTS || (item.deltaCycleScore ?? 0) < -SCORE_DELTA_MATERIALITY_POINTS);
  const improvements = axes.filter((item) => (item.deltaProjectScore ?? 0) > SCORE_DELTA_MATERIALITY_POINTS || (item.deltaCycleScore ?? 0) > SCORE_DELTA_MATERIALITY_POINTS);
  const productionEligible = blockers.length === 0 && axes.every((item) => item.projectScore >= item.productionFloor && item.cycleScore >= item.productionFloor && item.confidence >= 0.9);
  const criticalBlocked = axes.some((item) => item.status === 'BLOCK');
  const status: ExcellenceScorecardReport['status'] = criticalBlocked ? 'BLOCK' : axes.some((item) => item.status === 'WATCH') ? 'PASS_WITH_LIMITATIONS' : 'PASS';
  const readiness: ExcellenceScorecardReport['readiness'] = productionEligible ? 'PRODUCTION_CANDIDATE' : projectWeightedScore >= 80 && cycleWeightedScore >= 85 ? 'INTEGRATED_PILOT' : 'INTERNAL_EXCELLENCE_CYCLE';
  const nextPriorities = axes.map((item) => {
    const externalPenalty = item.blockers.length * 20;
    const priorityScore = round(item.weight * (Math.max(item.projectGap, item.cycleGap) + (1 - item.confidence) * 20 + externalPenalty));
    const reasons = [
      ...(item.projectGap > 0 ? [`project_floor_gap:${item.projectGap}`] : []),
      ...(item.cycleGap > 0 ? [`cycle_floor_gap:${item.cycleGap}`] : []),
      ...(item.confidence < 0.9 ? [`confidence_below_0.9:${item.confidence}`] : []),
      ...item.blockers.map((value) => `blocker:${value}`),
      ...item.limitations.map((value) => `limitation:${value}`),
    ];
    return { axisId: item.axisId, priorityScore, reasons };
  }).filter((item) => item.reasons.length > 0).sort((a, b) => b.priorityScore - a.priorityScore || a.axisId.localeCompare(b.axisId));
  const weakestAxes = [...axes].sort((a, b) => a.projectScore - b.projectScore || a.cycleScore - b.cycleScore || b.weight - a.weight).slice(0, 4).map((item) => item.axisId);
  const limitations = [...new Set(axes.flatMap((item) => item.limitations))].sort();
  const metrics = {
    axisCount: 14 as const,
    totalWeight: 100 as const,
    projectWeightedScore,
    cycleWeightedScore,
    confidenceAdjustedProjectScore,
    confidenceAdjustedCycleScore,
    minimumProjectScore: Math.min(...axes.map((item) => item.projectScore)),
    minimumCycleScore: Math.min(...axes.map((item) => item.cycleScore)),
    improvementCount: improvements.length,
    regressionCount: regressions.length,
    blockerCount: blockers.length,
    materialityThresholdPoints: SCORE_DELTA_MATERIALITY_POINTS,
  };
  const material = { version: input.version, status, readiness, productionPromotion: productionEligible ? 'ELIGIBLE_FOR_EXTERNAL_REVIEW' as const : 'BLOCKED' as const, metrics, axes, weakestAxes, nextPriorities, limitations };
  return { ...material, reportDigest: sha256(material) };
}

function axis(axisId: ExcellenceAxisId, weight: number, projectFloor: number, cycleFloor: number, productionFloor: number, promotionCritical: boolean, description: string): ExcellenceAxisDefinition {
  return { axisId, weight, projectFloor, cycleFloor, productionFloor, promotionCritical, description };
}
function validateDefinitions(definitions: readonly ExcellenceAxisDefinition[]): void {
  if (definitions.length !== 14) throw new Error('excellence_axis_count_must_be_14');
  const ids = new Set<ExcellenceAxisId>();
  let totalWeight = 0;
  for (const item of definitions) {
    if (ids.has(item.axisId)) throw new Error(`excellence_axis_duplicate:${item.axisId}`);
    ids.add(item.axisId);
    if (!Number.isFinite(item.weight) || item.weight <= 0) throw new Error('excellence_weight_invalid');
    for (const score of [item.projectFloor, item.cycleFloor, item.productionFloor]) validateScore(score, 'excellence_floor_invalid');
    if (item.description.trim() === '') throw new Error('excellence_axis_description_required');
    totalWeight += item.weight;
  }
  if (round(totalWeight) !== 100) throw new Error(`excellence_weight_total_invalid:${round(totalWeight)}`);
}
function indexObservations(observations: readonly ExcellenceAxisObservation[], label: string): Map<ExcellenceAxisId, ExcellenceAxisObservation> {
  if (observations.length !== 14) throw new Error(`excellence_${label}_axis_count_must_be_14`);
  const result = new Map<ExcellenceAxisId, ExcellenceAxisObservation>();
  for (const item of observations) {
    if (result.has(item.axisId)) throw new Error(`excellence_${label}_axis_duplicate:${item.axisId}`);
    validateScore(item.projectScore, 'excellence_project_score_invalid');
    validateScore(item.cycleScore, 'excellence_cycle_score_invalid');
    if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) throw new Error('excellence_confidence_invalid');
    if (item.evidenceRefs.length === 0 || item.evidenceRefs.some((value) => value.trim() === '')) throw new Error('excellence_evidence_required');
    if ([...item.limitations, ...item.blockers].some((value) => value.trim() === '')) throw new Error('excellence_reason_invalid');
    result.set(item.axisId, { ...item, evidenceRefs: [...new Set(item.evidenceRefs)].sort(), limitations: [...new Set(item.limitations)].sort(), blockers: [...new Set(item.blockers)].sort() });
  }
  return result;
}
function validateScore(value: number, code: string): void { if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(code); }
function weighted(items: readonly ExcellenceAxisResult[], key: 'projectScore' | 'cycleScore' | 'confidenceAdjustedProjectScore' | 'confidenceAdjustedCycleScore'): number {
  return round(items.reduce((sum, item) => sum + item[key] * item.weight, 0) / 100);
}
function round(value: number): number { return Number(value.toFixed(2)); }
