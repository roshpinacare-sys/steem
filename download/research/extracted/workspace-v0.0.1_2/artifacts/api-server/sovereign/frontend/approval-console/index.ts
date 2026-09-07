/**
 * TFA Frontend Approval Console — public API.
 *
 * Reactive signals + risk-factor explainability for real-time approval UI.
 * Zero runtime dependencies.
 */

export type {
  ApprovalStatus,
  ConsoleRiskFactor,
  ConsoleRiskAssessment,
  ApprovalConsoleEvent,
  Severity,
  ExplainabilityOutput,
} from "./types.ts";

export type { Unsubscribe, ReadonlySignal, Signal } from "./signals.ts";
export { createSignal, createComputed } from "./signals.ts";

export {
  factorSeverity,
  formatFactor,
  formatExplainability,
  statusFromAssessment,
} from "./explain.ts";

export type {
  SlackPost,
  SlackNotifier,
  SlackNotifierOptions,
} from "./slack.ts";
export {
  defaultSlackFilter,
  formatSlackPayload,
  createSlackNotifier,
} from "./slack.ts";
