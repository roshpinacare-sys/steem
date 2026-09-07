/**
 * Pure lifecycle guards for runtime state. This module intentionally has no
 * database or server imports so it can be evaluated in unit tests, scripts,
 * browser tooling, and recovery utilities.
 */

export const RUN_STATES = [
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;

export type RunLifecycleState = (typeof RUN_STATES)[number];

export const STEP_STATES = [
  "pending",
  "running",
  "retrying",
  "completed",
  "failed",
  "skipped",
  "blocked",
] as const;

export type StepLifecycleState = (typeof STEP_STATES)[number];

export const APPROVAL_STATES = [
  "pending",
  "approved",
  "rejected",
  "expired",
] as const;

export type ApprovalLifecycleState = (typeof APPROVAL_STATES)[number];

const RUN_TRANSITIONS: Readonly<Record<RunLifecycleState, readonly RunLifecycleState[]>> = {
  queued: ["running", "cancelled", "failed"],
  running: [
    "awaiting_approval",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ],
  awaiting_approval: ["running", "failed", "cancelled", "interrupted"],
  completed: [],
  failed: [],
  cancelled: [],
  interrupted: [],
};

const STEP_TRANSITIONS: Readonly<Record<StepLifecycleState, readonly StepLifecycleState[]>> = {
  pending: ["running", "skipped", "blocked"],
  running: ["retrying", "completed", "failed", "blocked"],
  retrying: ["running", "failed", "blocked"],
  completed: [],
  failed: [],
  skipped: [],
  blocked: [],
};

const APPROVAL_TRANSITIONS: Readonly<
  Record<ApprovalLifecycleState, readonly ApprovalLifecycleState[]>
> = {
  pending: ["approved", "rejected", "expired"],
  approved: [],
  rejected: [],
  expired: [],
};

export interface TransitionViolation {
  machine: "run" | "step" | "approval";
  from: string;
  to: string;
  allowed: readonly string[];
}

export class InvalidLifecycleTransitionError extends Error {
  readonly violation: TransitionViolation;

  constructor(violation: TransitionViolation) {
    super(
      `Illegal ${violation.machine} transition: ${violation.from} -> ${violation.to}. ` +
        `Allowed: ${violation.allowed.length ? violation.allowed.join(", ") : "none"}.`,
    );
    this.name = "InvalidLifecycleTransitionError";
    this.violation = violation;
  }
}

export function canTransitionRun(
  from: RunLifecycleState,
  to: RunLifecycleState,
): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function canTransitionStep(
  from: StepLifecycleState,
  to: StepLifecycleState,
): boolean {
  return STEP_TRANSITIONS[from].includes(to);
}

export function canTransitionApproval(
  from: ApprovalLifecycleState,
  to: ApprovalLifecycleState,
): boolean {
  return APPROVAL_TRANSITIONS[from].includes(to);
}

export function assertRunTransition(
  from: RunLifecycleState,
  to: RunLifecycleState,
): void {
  if (!canTransitionRun(from, to)) {
    throw new InvalidLifecycleTransitionError({
      machine: "run",
      from,
      to,
      allowed: RUN_TRANSITIONS[from],
    });
  }
}

export function assertStepTransition(
  from: StepLifecycleState,
  to: StepLifecycleState,
): void {
  if (!canTransitionStep(from, to)) {
    throw new InvalidLifecycleTransitionError({
      machine: "step",
      from,
      to,
      allowed: STEP_TRANSITIONS[from],
    });
  }
}

export function assertApprovalTransition(
  from: ApprovalLifecycleState,
  to: ApprovalLifecycleState,
): void {
  if (!canTransitionApproval(from, to)) {
    throw new InvalidLifecycleTransitionError({
      machine: "approval",
      from,
      to,
      allowed: APPROVAL_TRANSITIONS[from],
    });
  }
}

export function isTerminalRunState(state: RunLifecycleState): boolean {
  return RUN_TRANSITIONS[state].length === 0;
}

export function isTerminalStepState(state: StepLifecycleState): boolean {
  return STEP_TRANSITIONS[state].length === 0;
}

export function isTerminalApprovalState(state: ApprovalLifecycleState): boolean {
  return APPROVAL_TRANSITIONS[state].length === 0;
}

export function allowedRunTransitions(
  state: RunLifecycleState,
): readonly RunLifecycleState[] {
  return RUN_TRANSITIONS[state];
}

export function allowedStepTransitions(
  state: StepLifecycleState,
): readonly StepLifecycleState[] {
  return STEP_TRANSITIONS[state];
}

export function allowedApprovalTransitions(
  state: ApprovalLifecycleState,
): readonly ApprovalLifecycleState[] {
  return APPROVAL_TRANSITIONS[state];
}
