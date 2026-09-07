// Client-safe event definitions (no server imports). Mirrors run_events rows
// sent over SSE and consumed by the timeline + canvas graph builder.

export type RunEventType =
  | "run.started"
  | "model.routed"
  | "memory.selected"
  | "runner.mode"
  | "recovery.checkpoint"
  | "plan.created"
  | "step.started"
  | "assistant.delta"
  | "assistant.message"
  | "tool.call"
  | "tool.result"
  | "approval.requested"
  | "approval.resolved"
  | "step.completed"
  | "step.failed"
  | "artifact.created"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "run.interrupted";

export interface ClientRunEvent {
  id: number;
  seq: number;
  type: RunEventType;
  payload: unknown;
}

export const TERMINAL_EVENT_TYPES: RunEventType[] = [
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.interrupted",
];
