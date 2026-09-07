import { sha256 } from '../contracts/crypto.js';
import type { IntegrationContractEvidence } from './integration-contract-assurance.js';

export type IntegrationFault = 'timeout' | 'duplicate' | 'reorder' | 'tamper' | 'partial-write' | 'dependency-unavailable' | 'tenant-confusion';
export type FaultDisposition = 'BLOCK' | 'RETRY' | 'ROLLBACK' | 'DEGRADE' | 'COMPLETE';

export interface IntegrationFaultScenario {
  readonly scenarioId: string;
  readonly edgeId: string;
  readonly fault: IntegrationFault;
  readonly expectedDisposition: FaultDisposition;
  readonly observedDisposition: FaultDisposition;
  readonly residualSideEffects: number;
  readonly replaySafe: boolean;
  readonly tenantLeak: boolean;
  readonly durationMs: number;
  readonly evidenceRef: string;
}

export interface IntegrationFaultCampaignReport {
  readonly status: 'PASS' | 'BLOCK';
  readonly metrics: {
    readonly edges: number;
    readonly scenarios: number;
    readonly requiredScenarios: number;
    readonly matchedScenarios: number;
    readonly missingScenarios: number;
    readonly unsafeSideEffects: number;
    readonly tenantLeaks: number;
  };
  readonly results: readonly { readonly edgeId: string; readonly status: 'CLOSED' | 'OPEN'; readonly missingFaults: readonly IntegrationFault[]; readonly findings: readonly string[] }[];
  readonly reportDigest: string;
}

const REQUIRED: Readonly<Record<IntegrationContractEvidence['criticality'], readonly IntegrationFault[]>> = {
  normal: ['timeout', 'dependency-unavailable'],
  high: ['timeout', 'duplicate', 'reorder', 'dependency-unavailable'],
  critical: ['timeout', 'duplicate', 'reorder', 'tamper', 'partial-write', 'dependency-unavailable', 'tenant-confusion'],
};

/** Evaluates observed integration failures; it does not execute external faults. */
export function evaluateIntegrationFaultCampaign(
  contracts: readonly IntegrationContractEvidence[],
  scenarios: readonly IntegrationFaultScenario[],
): IntegrationFaultCampaignReport {
  const contractIds = new Set<string>();
  for (const contract of contracts) {
    if (contract.edgeId.trim() === '' || contractIds.has(contract.edgeId)) throw new Error(`fault_contract_identity_invalid:${contract.edgeId}`);
    contractIds.add(contract.edgeId);
  }
  const scenarioIds = new Set<string>();
  const normalized = scenarios.map((row) => {
    if (row.scenarioId.trim() === '' || scenarioIds.has(row.scenarioId)) throw new Error(`fault_scenario_identity_invalid:${row.scenarioId}`);
    scenarioIds.add(row.scenarioId);
    if (!contractIds.has(row.edgeId)) throw new Error(`fault_edge_unknown:${row.edgeId}`);
    if (!Number.isFinite(row.durationMs) || row.durationMs < 0 || !Number.isSafeInteger(row.residualSideEffects) || row.residualSideEffects < 0 || row.evidenceRef.trim() === '') throw new Error(`fault_scenario_invalid:${row.scenarioId}`);
    return { ...row, scenarioId: row.scenarioId.trim(), edgeId: row.edgeId.trim(), evidenceRef: row.evidenceRef.trim() };
  });

  const results = [...contracts].sort((a, b) => a.edgeId.localeCompare(b.edgeId)).map((contract) => {
    const rows = normalized.filter((row) => row.edgeId === contract.edgeId);
    const required = REQUIRED[contract.criticality];
    const present = new Set(rows.map((row) => row.fault));
    const missingFaults = required.filter((fault) => !present.has(fault));
    const findings: string[] = [];
    for (const row of rows) {
      if (row.expectedDisposition !== row.observedDisposition) findings.push(`disposition_mismatch:${row.scenarioId}`);
      if ((row.observedDisposition === 'BLOCK' || row.observedDisposition === 'ROLLBACK') && row.residualSideEffects !== 0) findings.push(`residual_side_effect:${row.scenarioId}`);
      if ((row.fault === 'duplicate' || row.fault === 'reorder') && !row.replaySafe) findings.push(`replay_unsafe:${row.scenarioId}`);
      if (row.tenantLeak) findings.push(`tenant_leak:${row.scenarioId}`);
      if (row.fault === 'tenant-confusion' && !contract.crossTenant && row.observedDisposition !== 'BLOCK') findings.push(`tenant_confusion_not_blocked:${row.scenarioId}`);
    }
    return { edgeId: contract.edgeId, status: missingFaults.length === 0 && findings.length === 0 ? 'CLOSED' as const : 'OPEN' as const, missingFaults, findings: findings.sort() };
  });

  const requiredScenarios = contracts.reduce((sum, row) => sum + REQUIRED[row.criticality].length, 0);
  const matchedScenarios = normalized.filter((row) => row.expectedDisposition === row.observedDisposition).length;
  const material = {
    status: results.every((row) => row.status === 'CLOSED') ? 'PASS' as const : 'BLOCK' as const,
    metrics: {
      edges: contracts.length,
      scenarios: normalized.length,
      requiredScenarios,
      matchedScenarios,
      missingScenarios: results.reduce((sum, row) => sum + row.missingFaults.length, 0),
      unsafeSideEffects: normalized.filter((row) => (row.observedDisposition === 'BLOCK' || row.observedDisposition === 'ROLLBACK') && row.residualSideEffects !== 0).length,
      tenantLeaks: normalized.filter((row) => row.tenantLeak).length,
    },
    results,
  };
  return { ...material, reportDigest: sha256(material) };
}
