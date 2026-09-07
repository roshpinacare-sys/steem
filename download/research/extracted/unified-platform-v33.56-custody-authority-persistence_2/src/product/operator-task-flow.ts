import { sha256 } from '../contracts/crypto.js';
export interface OperatorTaskStep { readonly stepId: string; readonly action: string; readonly decisionRequired: boolean; readonly irreversible: boolean; readonly confirmation: boolean; readonly recoveryAvailable: boolean; readonly automated: boolean; }
export interface OperatorTaskFlow { readonly flowId: string; readonly baselineSteps: number; readonly steps: readonly OperatorTaskStep[]; readonly criticalErrorOpportunities: number; }
export interface OperatorTaskFlowReport { readonly status: 'PASS' | 'BLOCK'; readonly metrics: { readonly flows: number; readonly averageStepReductionPercent: number; readonly unguardedIrreversibleActions: number; readonly unrecoverableActions: number; readonly decisionDensityPercent: number }; readonly results: readonly { readonly flowId: string; readonly stepReductionPercent: number; readonly reasons: readonly string[] }[]; readonly reportDigest: string; }
export function evaluateOperatorTaskFlows(flows: readonly OperatorTaskFlow[]): OperatorTaskFlowReport {
  const ids = new Set<string>();
  const results = flows.map((flow) => {
    if (flow.flowId.trim() === '' || ids.has(flow.flowId) || flow.baselineSteps < 1 || flow.criticalErrorOpportunities < 0) throw new Error('operator_flow_invalid'); ids.add(flow.flowId);
    const stepIds = new Set<string>(); for (const step of flow.steps) { if (step.stepId.trim() === '' || step.action.trim() === '' || stepIds.has(step.stepId)) throw new Error('operator_step_invalid'); stepIds.add(step.stepId); }
    const reasons = [
      ...flow.steps.filter((step) => step.irreversible && !step.confirmation).map((step) => `unguarded_irreversible:${step.stepId}`),
      ...flow.steps.filter((step) => step.irreversible && !step.recoveryAvailable).map((step) => `unrecoverable:${step.stepId}`),
      ...(flow.steps.length > flow.baselineSteps ? ['workflow_longer_than_baseline'] : []),
    ];
    const stepReductionPercent = Number((((flow.baselineSteps - flow.steps.length) / flow.baselineSteps) * 100).toFixed(2));
    return { flowId: flow.flowId, stepReductionPercent, reasons };
  });
  const allSteps = flows.flatMap((flow) => flow.steps); const irreversible = allSteps.filter((step) => step.irreversible);
  const metrics = { flows: flows.length, averageStepReductionPercent: flows.length === 0 ? 0 : Number((results.reduce((sum,item)=>sum+item.stepReductionPercent,0)/flows.length).toFixed(2)), unguardedIrreversibleActions: irreversible.filter((step) => !step.confirmation).length, unrecoverableActions: irreversible.filter((step) => !step.recoveryAvailable).length, decisionDensityPercent: allSteps.length === 0 ? 0 : Number(((allSteps.filter((step)=>step.decisionRequired).length/allSteps.length)*100).toFixed(2)) };
  const material = { status: results.every((item) => item.reasons.length === 0) ? 'PASS' as const : 'BLOCK' as const, metrics, results };
  return { ...material, reportDigest: sha256(material) };
}
