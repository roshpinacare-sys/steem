import { sha256 } from '../contracts/crypto.js';
export interface PortabilityTarget { readonly targetId: string; readonly operatingSystem: 'linux' | 'windows' | 'macos'; readonly architecture: 'x64' | 'arm64'; readonly runtime: string; readonly build: 'PASS' | 'FAIL' | 'NOT_RUN'; readonly tests: 'PASS' | 'FAIL' | 'NOT_RUN'; readonly archiveSelfTest: 'PASS' | 'FAIL' | 'NOT_RUN'; readonly observed: boolean; }
export interface PortabilityMatrixReport { readonly status: 'PASS' | 'BLOCK'; readonly metrics: { readonly targets: number; readonly observedTargets: number; readonly passedObservedTargets: number; readonly plannedTargets: number }; readonly results: readonly { readonly targetId: string; readonly qualified: boolean; readonly reasons: readonly string[] }[]; readonly reportDigest: string; }
export function evaluatePortabilityMatrix(targets: readonly PortabilityTarget[]): PortabilityMatrixReport {
  const ids = new Set<string>();
  const results = targets.map((target) => {
    if (target.targetId.trim() === '' || target.runtime.trim() === '' || ids.has(target.targetId)) throw new Error('portability_target_invalid'); ids.add(target.targetId);
    const reasons = [
      ...(target.build !== 'PASS' ? [`build_${target.build.toLowerCase()}`] : []),
      ...(target.tests !== 'PASS' ? [`tests_${target.tests.toLowerCase()}`] : []),
      ...(target.archiveSelfTest !== 'PASS' ? [`archive_${target.archiveSelfTest.toLowerCase()}`] : []),
      ...(!target.observed ? ['not_observed'] : []),
    ];
    return { targetId: target.targetId, qualified: reasons.length === 0, reasons };
  });
  const observed = targets.filter((item) => item.observed); const observedResults = results.filter((_,index)=>targets[index]!.observed);
  const metrics = { targets: targets.length, observedTargets: observed.length, passedObservedTargets: observedResults.filter((item) => item.qualified).length, plannedTargets: targets.length - observed.length };
  const material = { status: observed.length > 0 && observedResults.every((item) => item.qualified) ? 'PASS' as const : 'BLOCK' as const, metrics, results };
  return { ...material, reportDigest: sha256(material) };
}
