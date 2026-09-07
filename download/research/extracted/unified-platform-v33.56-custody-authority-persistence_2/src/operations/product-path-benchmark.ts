import { sha256 } from '../contracts/crypto.js';
export interface ProductPathBudget { readonly pathId: string; readonly maximumP95Ms: number; readonly minimumThroughputPerSecond: number; readonly maximumHeapDeltaBytes: number; readonly minimumSamples: number; }
export interface ProductPathObservation { readonly pathId: string; readonly latencyMs: readonly number[]; readonly throughputPerSecond: number; readonly heapDeltaBytes: number; readonly environment: 'local-single-host' | 'qualified-multi-host'; }
export interface ProductPathBenchmarkReport { readonly status: 'PASS' | 'BLOCK'; readonly metrics: { readonly paths: number; readonly passed: number; readonly localOnly: number }; readonly results: readonly { readonly pathId: string; readonly status: 'PASS' | 'BLOCK'; readonly p95Ms: number | null; readonly reasons: readonly string[]; readonly environment: ProductPathObservation['environment'] }[]; readonly reportDigest: string; }
export function evaluateProductPathBenchmarks(budgets: readonly ProductPathBudget[], observations: readonly ProductPathObservation[]): ProductPathBenchmarkReport {
  const ids = new Set<string>();
  const results = budgets.map((budget) => {
    if (budget.pathId.trim() === '' || ids.has(budget.pathId) || budget.maximumP95Ms <= 0 || budget.minimumThroughputPerSecond <= 0 || budget.maximumHeapDeltaBytes < 0 || budget.minimumSamples < 1) throw new Error('product_path_budget_invalid'); ids.add(budget.pathId);
    const observation = observations.find((item) => item.pathId === budget.pathId);
    if (observation === undefined) return { pathId: budget.pathId, status: 'BLOCK' as const, p95Ms: null, reasons: ['observation_missing'], environment: 'local-single-host' as const };
    const sorted = [...observation.latencyMs].sort((a,b)=>a-b); const p95Ms = sorted.length === 0 ? null : sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)]!;
    const reasons = [
      ...(observation.latencyMs.length < budget.minimumSamples ? ['minimum_samples_not_met'] : []),
      ...(p95Ms !== null && p95Ms > budget.maximumP95Ms ? ['p95_budget_exceeded'] : []),
      ...(observation.throughputPerSecond < budget.minimumThroughputPerSecond ? ['throughput_below_floor'] : []),
      ...(observation.heapDeltaBytes > budget.maximumHeapDeltaBytes ? ['heap_budget_exceeded'] : []),
    ];
    return { pathId: budget.pathId, status: reasons.length === 0 ? 'PASS' as const : 'BLOCK' as const, p95Ms, reasons, environment: observation.environment };
  });
  const metrics = { paths: budgets.length, passed: results.filter((item) => item.status === 'PASS').length, localOnly: results.filter((item) => item.environment !== 'qualified-multi-host').length };
  const material = { status: results.every((item) => item.status === 'PASS') ? 'PASS' as const : 'BLOCK' as const, metrics, results };
  return { ...material, reportDigest: sha256(material) };
}
