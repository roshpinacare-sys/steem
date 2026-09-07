import { sha256 } from '../contracts/crypto.js';
export type AdversarialTechnique = 'boundary' | 'mutation' | 'concurrency' | 'replay' | 'tamper' | 'timeout' | 'resource-exhaustion' | 'state-machine';
export interface AdversarialTarget { readonly targetId: string; readonly criticality: 'normal' | 'critical'; readonly coveredTechniques: readonly AdversarialTechnique[]; readonly testRefs: readonly string[]; }
export interface AdversarialPlanReport { readonly status: 'PASS' | 'BLOCK'; readonly metrics: { readonly targets: number; readonly fullyCovered: number; readonly requiredScenarios: number; readonly coveredScenarios: number; readonly coveragePercent: number }; readonly results: readonly { readonly targetId: string; readonly missingTechniques: readonly AdversarialTechnique[]; readonly status: 'COVERED' | 'OPEN' }[]; readonly reportDigest: string; }
const NORMAL: readonly AdversarialTechnique[] = ['boundary','mutation','state-machine'];
const CRITICAL: readonly AdversarialTechnique[] = ['boundary','mutation','concurrency','replay','tamper','timeout','resource-exhaustion','state-machine'];
export function planAdversarialCoverage(targets: readonly AdversarialTarget[]): AdversarialPlanReport {
  const ids = new Set<string>();
  const results = targets.map((target) => {
    if (target.targetId.trim() === '' || ids.has(target.targetId)) throw new Error('adversarial_target_invalid');
    ids.add(target.targetId);
    const covered = new Set(target.coveredTechniques);
    if (covered.size !== target.coveredTechniques.length || target.testRefs.some((value) => value.trim() === '')) throw new Error('adversarial_coverage_invalid');
    const required = target.criticality === 'critical' ? CRITICAL : NORMAL;
    const missingTechniques = required.filter((technique) => !covered.has(technique));
    return { targetId: target.targetId, missingTechniques, status: missingTechniques.length === 0 && target.testRefs.length > 0 ? 'COVERED' as const : 'OPEN' as const };
  });
  const requiredScenarios = targets.reduce((sum, target) => sum + (target.criticality === 'critical' ? CRITICAL.length : NORMAL.length), 0);
  const coveredScenarios = targets.reduce((sum, target) => { const required = target.criticality === 'critical' ? CRITICAL : NORMAL; const covered = new Set(target.coveredTechniques); return sum + required.filter((item) => covered.has(item)).length; }, 0);
  const metrics = { targets: targets.length, fullyCovered: results.filter((item) => item.status === 'COVERED').length, requiredScenarios, coveredScenarios, coveragePercent: requiredScenarios === 0 ? 0 : Number(((coveredScenarios / requiredScenarios) * 100).toFixed(2)) };
  const material = { status: results.every((item) => item.status === 'COVERED') ? 'PASS' as const : 'BLOCK' as const, metrics, results };
  return { ...material, reportDigest: sha256(material) };
}
