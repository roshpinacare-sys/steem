/**
 * lib/eval/index.ts — Eval Harness barrel export.
 */

export type {
  ScorecardName,
  ScorecardResult,
  EvalRunResult,
  GoldenTask,
  PlanFidelityInput,
  ApprovalPrecisionInput,
  EvidenceCompletenessInput,
  ReplayDeterminismInput,
  EconomicInvariantInput,
  AccountSnapshot,
  SafetyScoreInput,
} from "./types.ts";

export {
  scorePlanFidelity,
  scoreApprovalPrecision,
  scoreEvidenceCompleteness,
  scoreReplayDeterminism,
  scoreEconomicInvariant,
  scoreSafety,
} from "./scorecards.ts";

export {
  valueMovingWithEscrowTask,
  readOnlySafePathTask,
  executionWorkflowEvidenceTask,
  deniedIrreversibleTask,
  escrowDisputeReversalTask,
  partialReleaseThenFullTask,
  GOLDEN_TASKS,
  runAllGoldenTasks,
} from "./golden-tasks.ts";
