import { sha256 } from '../contracts/crypto.js';
export interface QualificationExecutionGate { readonly gateId: string; readonly prerequisiteGateIds: readonly string[]; readonly collectorId: string; readonly reviewerId: string; readonly commandRef: string; readonly evidencePath: string; readonly rollbackRef: string; readonly estimatedMinutes: number; }
export interface QualificationExecutionPlanReport { readonly status: 'READY' | 'BLOCK'; readonly metrics: { readonly gates: number; readonly waves: number; readonly totalEstimatedMinutes: number; readonly independentlyReviewed: number }; readonly waves: readonly (readonly string[])[]; readonly findings: readonly string[]; readonly reportDigest: string; }
export function buildQualificationExecutionPlan(gates: readonly QualificationExecutionGate[]): QualificationExecutionPlanReport {
  const map = new Map<string, QualificationExecutionGate>(); const findings: string[] = [];
  for (const gate of gates) { if (gate.gateId.trim() === '' || map.has(gate.gateId) || gate.commandRef.trim() === '' || gate.evidencePath.trim() === '' || gate.rollbackRef.trim() === '' || gate.estimatedMinutes < 1) throw new Error('qualification_execution_gate_invalid'); map.set(gate.gateId, gate); if (gate.collectorId === gate.reviewerId) findings.push(`collector_reviewer_conflict:${gate.gateId}`); }
  for (const gate of gates) for (const dep of gate.prerequisiteGateIds) if (!map.has(dep)) findings.push(`prerequisite_missing:${gate.gateId}:${dep}`);
  const pending = new Set(gates.map((gate) => gate.gateId)); const done = new Set<string>(); const waves: string[][] = [];
  while (pending.size > 0) {
    const wave = [...pending].filter((id) => map.get(id)!.prerequisiteGateIds.every((dep) => done.has(dep))).sort();
    if (wave.length === 0) { findings.push('qualification_dependency_cycle'); break; }
    waves.push(wave); for (const id of wave) { pending.delete(id); done.add(id); }
  }
  const metrics = { gates: gates.length, waves: waves.length, totalEstimatedMinutes: gates.reduce((sum,gate)=>sum+gate.estimatedMinutes,0), independentlyReviewed: gates.filter((gate)=>gate.collectorId!==gate.reviewerId).length };
  const material = { status: findings.length === 0 && done.size === gates.length ? 'READY' as const : 'BLOCK' as const, metrics, waves, findings: [...new Set(findings)].sort() };
  return { ...material, reportDigest: sha256(material) };
}
