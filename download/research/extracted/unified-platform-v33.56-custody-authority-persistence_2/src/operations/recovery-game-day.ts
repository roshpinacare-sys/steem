import { sha256 } from '../contracts/crypto.js';
export interface RecoveryScenario { readonly scenarioId: string; readonly detected: boolean; readonly contained: boolean; readonly recovered: boolean; readonly recertified: boolean; readonly detectionMinutes: number; readonly recoveryMinutes: number; readonly rtoMinutes: number; readonly evidenceRefs: readonly string[]; }
export interface RecoveryGameDayReport { readonly status: 'PASS' | 'BLOCK'; readonly metrics: { readonly scenarios: number; readonly passed: number; readonly worstDetectionMinutes: number; readonly worstRecoveryMinutes: number }; readonly results: readonly { readonly scenarioId: string; readonly status: 'PASS' | 'BLOCK'; readonly reasons: readonly string[] }[]; readonly reportDigest: string; }
export function evaluateRecoveryGameDay(scenarios: readonly RecoveryScenario[]): RecoveryGameDayReport {
  const ids = new Set<string>();
  const results = scenarios.map((scenario) => {
    if (scenario.scenarioId.trim() === '' || ids.has(scenario.scenarioId) || scenario.detectionMinutes < 0 || scenario.recoveryMinutes < 0 || scenario.rtoMinutes <= 0) throw new Error('recovery_scenario_invalid'); ids.add(scenario.scenarioId);
    const reasons = [
      ...(!scenario.detected ? ['not_detected'] : []), ...(!scenario.contained ? ['not_contained'] : []), ...(!scenario.recovered ? ['not_recovered'] : []), ...(!scenario.recertified ? ['not_recertified'] : []),
      ...(scenario.recoveryMinutes > scenario.rtoMinutes ? ['rto_exceeded'] : []), ...(scenario.evidenceRefs.length === 0 ? ['evidence_missing'] : []),
    ];
    return { scenarioId: scenario.scenarioId, status: reasons.length === 0 ? 'PASS' as const : 'BLOCK' as const, reasons };
  });
  const metrics = { scenarios: scenarios.length, passed: results.filter((item) => item.status === 'PASS').length, worstDetectionMinutes: Math.max(0, ...scenarios.map((item) => item.detectionMinutes)), worstRecoveryMinutes: Math.max(0, ...scenarios.map((item) => item.recoveryMinutes)) };
  const material = { status: results.every((item) => item.status === 'PASS') ? 'PASS' as const : 'BLOCK' as const, metrics, results };
  return { ...material, reportDigest: sha256(material) };
}
