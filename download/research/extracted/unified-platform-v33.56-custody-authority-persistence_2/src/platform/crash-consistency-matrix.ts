import { sha256 } from '../contracts/crypto.js';
export type CrashPoint = 'before-private-write' | 'after-private-fsync' | 'after-atomic-publish' | 'after-ack';
export interface CrashScenarioEvidence { readonly scenarioId: string; readonly crashPoint: CrashPoint; readonly recoveredState: 'prior' | 'committed' | 'partial' | 'lost'; readonly duplicateSideEffect: boolean; readonly testRef: string; }
export interface CrashConsistencyReport { readonly status: 'PASS' | 'BLOCK'; readonly metrics: { readonly scenarios: number; readonly crashPointsCovered: number; readonly duplicates: number; readonly unsafeRecoveries: number }; readonly findings: readonly string[]; readonly reportDigest: string; }
export function evaluateCrashConsistency(evidence: readonly CrashScenarioEvidence[]): CrashConsistencyReport {
  const required: readonly CrashPoint[] = ['before-private-write','after-private-fsync','after-atomic-publish','after-ack'];
  const ids = new Set<string>();
  const findings: string[] = [];
  for (const row of evidence) {
    if (row.scenarioId.trim() === '' || row.testRef.trim() === '' || ids.has(row.scenarioId)) throw new Error('crash_scenario_invalid'); ids.add(row.scenarioId);
    if (row.recoveredState === 'partial' || row.recoveredState === 'lost') findings.push(`unsafe_recovery:${row.scenarioId}`);
    if (row.duplicateSideEffect) findings.push(`duplicate_side_effect:${row.scenarioId}`);
    if ((row.crashPoint === 'before-private-write' || row.crashPoint === 'after-private-fsync') && row.recoveredState !== 'prior') findings.push(`prepublish_state_invalid:${row.scenarioId}`);
    if ((row.crashPoint === 'after-atomic-publish' || row.crashPoint === 'after-ack') && row.recoveredState !== 'committed') findings.push(`postpublish_state_invalid:${row.scenarioId}`);
  }
  const covered = new Set(evidence.map((row) => row.crashPoint));
  for (const point of required) if (!covered.has(point)) findings.push(`crash_point_missing:${point}`);
  const metrics = { scenarios: evidence.length, crashPointsCovered: covered.size, duplicates: evidence.filter((row) => row.duplicateSideEffect).length, unsafeRecoveries: evidence.filter((row) => row.recoveredState === 'partial' || row.recoveredState === 'lost').length };
  const material = { status: findings.length === 0 ? 'PASS' as const : 'BLOCK' as const, metrics, findings: [...new Set(findings)].sort() };
  return { ...material, reportDigest: sha256(material) };
}
