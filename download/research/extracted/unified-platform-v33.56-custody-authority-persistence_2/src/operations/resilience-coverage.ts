import { sha256 } from '../contracts/crypto.js';

export type ResilienceFailureMode = 'crash-before-commit' | 'crash-after-commit' | 'concurrent-duplicate' | 'stale-or-tampered-evidence' | 'dependency-unavailable' | 'rollback-or-replay';
export interface ResilienceCapabilityRequirement { readonly capabilityId: string; readonly critical: boolean; readonly requiredFailureModes: readonly ResilienceFailureMode[]; }
export interface ResilienceScenarioEvidence { readonly capabilityId: string; readonly failureMode: ResilienceFailureMode; readonly testRef: string; readonly outcome: 'PASS' | 'FAIL'; readonly environment: 'simulation' | 'local-single-host' | 'qualified-multi-host'; readonly evidenceRef: string; }
export interface ResilienceCoverageReport {
  readonly status: 'PASS' | 'BLOCK';
  readonly metrics: { readonly capabilities: number; readonly requiredScenarios: number; readonly coveredScenarios: number; readonly coveragePercent: number; readonly qualifiedMultiHostPercent: number };
  readonly capabilityResults: readonly { readonly capabilityId: string; readonly critical: boolean; readonly status: 'COVERED' | 'OPEN'; readonly missingFailureModes: readonly ResilienceFailureMode[]; readonly failedFailureModes: readonly ResilienceFailureMode[]; readonly localOnlyFailureModes: readonly ResilienceFailureMode[] }[];
  readonly reportDigest: string;
}
export function evaluateResilienceCoverage(requirements: readonly ResilienceCapabilityRequirement[], evidence: readonly ResilienceScenarioEvidence[]): ResilienceCoverageReport {
  const ids = new Set<string>();
  for (const item of requirements) {
    if (item.capabilityId.trim() === '' || ids.has(item.capabilityId) || item.requiredFailureModes.length === 0 || new Set(item.requiredFailureModes).size !== item.requiredFailureModes.length) throw new Error('resilience_requirement_invalid');
    ids.add(item.capabilityId);
  }
  for (const item of evidence) if (item.capabilityId.trim() === '' || item.testRef.trim() === '' || item.evidenceRef.trim() === '') throw new Error('resilience_evidence_invalid');
  const capabilityResults = requirements.map((requirement) => {
    const rows = evidence.filter((item) => item.capabilityId === requirement.capabilityId);
    const missingFailureModes = requirement.requiredFailureModes.filter((mode) => !rows.some((item) => item.failureMode === mode));
    const failedFailureModes = requirement.requiredFailureModes.filter((mode) => rows.some((item) => item.failureMode === mode && item.outcome === 'FAIL'));
    const localOnlyFailureModes = requirement.requiredFailureModes.filter((mode) => rows.some((item) => item.failureMode === mode && item.outcome === 'PASS') && !rows.some((item) => item.failureMode === mode && item.outcome === 'PASS' && item.environment === 'qualified-multi-host'));
    return { capabilityId: requirement.capabilityId, critical: requirement.critical, status: missingFailureModes.length === 0 && failedFailureModes.length === 0 ? 'COVERED' as const : 'OPEN' as const, missingFailureModes, failedFailureModes, localOnlyFailureModes };
  });
  const requiredScenarios = requirements.reduce((sum, item) => sum + item.requiredFailureModes.length, 0);
  const coveredScenarios = requirements.reduce((sum, requirement) => sum + requirement.requiredFailureModes.filter((mode) => evidence.some((item) => item.capabilityId === requirement.capabilityId && item.failureMode === mode && item.outcome === 'PASS')).length, 0);
  const qualified = requirements.reduce((sum, requirement) => sum + requirement.requiredFailureModes.filter((mode) => evidence.some((item) => item.capabilityId === requirement.capabilityId && item.failureMode === mode && item.outcome === 'PASS' && item.environment === 'qualified-multi-host')).length, 0);
  const metrics = { capabilities: requirements.length, requiredScenarios, coveredScenarios, coveragePercent: percent(coveredScenarios, requiredScenarios), qualifiedMultiHostPercent: percent(qualified, requiredScenarios) };
  const status = capabilityResults.some((item) => item.critical && item.status === 'OPEN') ? 'BLOCK' as const : 'PASS' as const;
  const material = { status, metrics, capabilityResults };
  return { ...material, reportDigest: sha256(material) };
}
function percent(numerator: number, denominator: number): number { return denominator === 0 ? 0 : Number(((numerator / denominator) * 100).toFixed(2)); }
