/**
 * lib/risk/index.ts — Risk & Approval Policy barrel export.
 */

export {
  RISK_CLASSES,
  MOST_RESTRICTIVE_RISK_CLASS,
  ACTION_RISK_MAP,
  classifyRisk,
  isClassified,
  injectRiskClass,
} from "./action-risk.ts";

export {
  APPROVAL_CLASSES,
  RISK_TO_APPROVAL_MAP,
  resolveApprovalClass,
  createDecisionTrace,
  approvalPolicyRouter,
} from "./approval-policy.ts";

export type { DecisionTrace } from "./approval-policy.ts";

export {
  CODING_ACTION_TYPES,
  CODING_ACTION_RISK_MAP,
  CODING_ACTION_METADATA,
  classifyCodingAction,
  isCodingAction,
  classifyActionServerSide,
  type CodingActionType,
  type CodingActionMeta,
} from "./coding-actions.ts";

export {
  confidenceGate,
  verifyConfidenceGateTrace,
  validateConfig as validateConfidenceGateConfig,
  resolveScore,
  resolveVerdict,
  DEFAULT_CONFIDENCE_CONFIG,
  ConfidenceGateError,
  type ConfidenceGateConfig,
  type ConfidenceVerdict,
  type ConfidenceGateTrace,
} from "./confidence-gate.ts";

export { simulateAction } from "./action-simulator.ts";
export type { SimulationResult, SimulationInput, BlastRadius } from "./action-simulator.ts";

export { scoreContextualRisk, maxApproval } from "./contextual-risk.ts";
export type { RiskContext, RiskSignal, ContextualRiskResult } from "./contextual-risk.ts";

export { assessRisk } from "./risk-intelligence.ts";
export type { RiskAssessment, RiskIntelligenceInput, RiskFactor, ReputationBand } from "./risk-intelligence.ts";

export { injectReputationScore } from "./reputation-policy.ts";
export type { InjectReputationScoreOptions } from "./reputation-policy.ts";

export {
  InMemoryActorBaselineStore,
  injectActorBaseline,
} from "./actor-baseline.ts";
export type {
  ActorBaselineStore,
  ActorBaselineOptions,
  InjectActorBaselineOptions,
} from "./actor-baseline.ts";

export {
  runPolicySimulation,
  compareScenarios,
} from "./policy-simulator.ts";
export type {
  PolicySimulationInput,
  PolicySimulationResult,
  PolicyDecisionRecord,
  ScenarioComparison,
} from "./policy-simulator.ts";

export { scoreRiskDrift } from "./risk-drift.ts";
export type { DriftRecord, DriftFactor, RiskDriftResult } from "./risk-drift.ts";

export { explainDriftCompliance } from "./drift-explain.ts";
export type { DriftExplainInput, DriftComplianceReport, ExplainedFactor } from "./drift-explain.ts";
