import { sha256 } from '../contracts/crypto.js';
export type StrategicGateStatus = 'PASS' | 'BLOCK' | 'NOT_EXECUTED';
interface Gate { readonly status: StrategicGateStatus; readonly reportDigest: string; }
export interface StrategicUpgradeInput {
  readonly workflowSecurity: Gate;
  readonly toolIntake: Gate;
  readonly sarifSecurity: Gate;
  readonly attestation: Gate;
  readonly policy: Gate;
  readonly formalModel: Gate;
  readonly fuzz: Gate;
  readonly claimRoast: Gate;
  readonly externalBlockers: readonly string[];
}
export function evaluateStrategicUpgrade(input: StrategicUpgradeInput): {
  status: 'PASS_WITH_EXTERNAL_BLOCKERS' | 'READY_WITH_UNEXECUTED_GATES' | 'BLOCK';
  disposition: 'READY_FOR_BOUNDED_TOOL_EXECUTION' | 'READY_FOR_EXTERNAL_TOOL_EXECUTION' | 'BLOCKED';
  productionPromotion: 'BLOCKED'; failures: readonly string[]; unexecuted: readonly string[]; inputDigests: readonly string[]; externalBlockers: readonly string[]; decisionDigest: string;
} {
  const gates: readonly [string, Gate][] = [
    ['workflow_security', input.workflowSecurity], ['tool_intake', input.toolIntake], ['sarif_security', input.sarifSecurity], ['attestation', input.attestation], ['policy', input.policy],
    ['formal_model', input.formalModel], ['fuzz', input.fuzz], ['claim_roast', input.claimRoast],
  ];
  const failures = gates.filter(([, gate]) => gate.status === 'BLOCK').map(([name]) => `${name}_blocked`);
  const unexecuted = gates.filter(([, gate]) => gate.status === 'NOT_EXECUTED').map(([name]) => name);
  const status = failures.length ? 'BLOCK' as const : unexecuted.length ? 'READY_WITH_UNEXECUTED_GATES' as const : 'PASS_WITH_EXTERNAL_BLOCKERS' as const;
  const disposition = failures.length ? 'BLOCKED' as const : unexecuted.length ? 'READY_FOR_EXTERNAL_TOOL_EXECUTION' as const : 'READY_FOR_BOUNDED_TOOL_EXECUTION' as const;
  const material = { status, disposition, productionPromotion: 'BLOCKED' as const, failures, unexecuted, inputDigests: gates.map(([, gate]) => gate.reportDigest).sort(), externalBlockers: [...new Set(input.externalBlockers.map((value) => value.trim()).filter(Boolean))].sort() };
  return { ...material, decisionDigest: sha256(material) };
}
