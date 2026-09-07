import { sha256 } from '../contracts/crypto.js';
import { nearestRank, type EvidenceEnvironment } from './slo-qualification.js';

export interface PerformanceMetricBudget {
  readonly metric: string;
  readonly direction: 'lower-is-better' | 'higher-is-better';
  readonly maximumRegressionPercent: number;
  readonly minimumSamples: number;
  readonly percentile: 50 | 95 | 99;
}
export interface PerformanceMetricObservation { readonly metric: string; readonly baseline: readonly number[]; readonly current: readonly number[]; readonly environment: EvidenceEnvironment; }
export interface PerformanceBudgetReport {
  readonly status: 'PASS' | 'BLOCK';
  readonly results: readonly { readonly metric: string; readonly status: 'PASS' | 'BLOCK' | 'INSUFFICIENT'; readonly baselineValue: number | null; readonly currentValue: number | null; readonly changePercent: number | null; readonly environment: EvidenceEnvironment; readonly reasons: readonly string[] }[];
  readonly reportDigest: string;
}
export function evaluatePerformanceBudgets(budgets: readonly PerformanceMetricBudget[], observations: readonly PerformanceMetricObservation[]): PerformanceBudgetReport {
  const metrics = new Set<string>();
  const results = budgets.map((budget) => {
    if (budget.metric.trim() === '' || metrics.has(budget.metric) || !Number.isFinite(budget.maximumRegressionPercent) || budget.maximumRegressionPercent < 0 || !Number.isInteger(budget.minimumSamples) || budget.minimumSamples < 1) throw new Error('performance_budget_invalid');
    metrics.add(budget.metric);
    const observation = observations.find((item) => item.metric === budget.metric);
    if (observation === undefined) return { metric: budget.metric, status: 'INSUFFICIENT' as const, baselineValue: null, currentValue: null, changePercent: null, environment: 'simulation' as const, reasons: ['observation_missing'] };
    if (observation.baseline.length < budget.minimumSamples || observation.current.length < budget.minimumSamples) return { metric: budget.metric, status: 'INSUFFICIENT' as const, baselineValue: observation.baseline.length ? nearestRank(observation.baseline, budget.percentile) : null, currentValue: observation.current.length ? nearestRank(observation.current, budget.percentile) : null, changePercent: null, environment: observation.environment, reasons: ['minimum_sample_count_not_met'] };
    const baselineValue = nearestRank(observation.baseline, budget.percentile); const currentValue = nearestRank(observation.current, budget.percentile);
    const raw = budget.direction === 'lower-is-better' ? ((currentValue - baselineValue) / Math.max(baselineValue, Number.EPSILON)) * 100 : ((baselineValue - currentValue) / Math.max(Math.abs(baselineValue), Number.EPSILON)) * 100;
    const changePercent = Number(raw.toFixed(2));
    const reasons = [
      ...(changePercent > budget.maximumRegressionPercent ? ['regression_budget_exceeded'] : []),
      ...(observation.environment !== 'qualified-multi-host' ? ['environment_not_qualified_multi_host'] : []),
    ];
    return { metric: budget.metric, status: changePercent > budget.maximumRegressionPercent ? 'BLOCK' as const : 'PASS' as const, baselineValue, currentValue, changePercent, environment: observation.environment, reasons };
  });
  const material = { status: results.some((item) => item.status === 'BLOCK' || item.status === 'INSUFFICIENT') ? 'BLOCK' as const : 'PASS' as const, results };
  return { ...material, reportDigest: sha256(material) };
}
