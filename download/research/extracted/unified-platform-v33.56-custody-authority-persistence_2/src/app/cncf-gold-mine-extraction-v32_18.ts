import { sha256 } from '../contracts/crypto.js';
import { compileResiliencyPolicyV32_18, evaluatePostgresContinuityV32_18, evaluateWorkloadIdentityV32_18, optimizeTailSamplingV32_18, replayDurableHistoryV32_18, type DurableHistoryEventV32_18, type IdentityFederationPolicyV32_18, type PostgresContinuityObservationV32_18, type PostgresContinuityPolicyV32_18, type ResiliencyPolicyInputV32_18, type TailSamplingPolicyV32_18, type TraceSummaryV32_18, type WorkloadIdentityObservationV32_18 } from '../platform/sovereign-control-plane-v32_18.js';
export interface GoldMineExtractionInputV32_18 { readonly resiliency: ResiliencyPolicyInputV32_18; readonly durableHistory: readonly DurableHistoryEventV32_18[]; readonly requiredSteps: readonly string[]; readonly identity: WorkloadIdentityObservationV32_18; readonly identityPolicy: IdentityFederationPolicyV32_18; readonly traces: readonly TraceSummaryV32_18[]; readonly samplingPolicy: TailSamplingPolicyV32_18; readonly postgres: PostgresContinuityObservationV32_18; readonly postgresPolicy: PostgresContinuityPolicyV32_18; readonly baselineTelemetryBytes: number; readonly baselineOperationalUnits: number; }
export async function runCncfGoldMineExtractionV32_18(input: GoldMineExtractionInputV32_18) {
  if (!Number.isSafeInteger(input.baselineTelemetryBytes) || input.baselineTelemetryBytes <= 0 || !Number.isSafeInteger(input.baselineOperationalUnits) || input.baselineOperationalUnits < 5) throw new Error('gold_mine_baseline_invalid');
  const resiliency = compileResiliencyPolicyV32_18(input.resiliency);
  const durable = replayDurableHistoryV32_18(input.durableHistory, input.requiredSteps);
  const identity = evaluateWorkloadIdentityV32_18(input.identity, input.identityPolicy);
  const telemetry = optimizeTailSamplingV32_18(input.traces, input.samplingPolicy);
  const postgres = evaluatePostgresContinuityV32_18(input.postgres, input.postgresPolicy);
  const findings: string[] = [];
  if (durable.state !== 'COMPLETED') findings.push('gold-mine-durable-execution-not-complete');
  if (identity.state !== 'ACCEPTED') findings.push('gold-mine-identity-not-accepted');
  if (telemetry.budgetExceeded) findings.push('gold-mine-telemetry-mandatory-budget-exceeded');
  if (postgres.state !== 'QUALIFIED') findings.push('gold-mine-postgres-continuity-not-qualified');
  const telemetryReductionRate = Number((Math.max(0, input.baselineTelemetryBytes - telemetry.exportedBytes) / input.baselineTelemetryBytes).toFixed(6));
  const sovereignPrimitives = 5;
  const operationalReductionRate = Number(((input.baselineOperationalUnits - sovereignPrimitives) / input.baselineOperationalUnits).toFixed(6));
  const state = findings.length === 0 ? 'DRY_RUN_PASSED' as const : 'FAILED' as const;
  const material = { schemaVersion: '32.18' as const, state, productionQualified: false, extractedCapabilities: ['resiliency-compiler','durable-history-replay','federated-workload-identity','cost-aware-tail-sampling','postgres-continuity-evaluator'] as const, telemetryReductionRate, operationalReductionRate, findings: findings.sort(), limitations: ['dapr-daemon-not-executed','spire-federation-not-executed','otel-collector-not-executed','cloudnativepg-cluster-not-executed','all-local-results-are-dry-run'], evidence: { resiliencyDigest: resiliency.policyDigest, durableDigest: durable.reportDigest, identityDigest: identity.reportDigest, telemetryDigest: telemetry.reportDigest, postgresDigest: postgres.reportDigest } };
  return { ...material, reportDigest: sha256(material) };
}
