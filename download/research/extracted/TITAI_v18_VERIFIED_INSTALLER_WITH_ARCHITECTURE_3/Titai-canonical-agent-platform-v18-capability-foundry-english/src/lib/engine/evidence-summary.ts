import type { ClientRunEvent, RunEventType } from "./event-types";

export type EvidenceState =
  | "live"
  | "evidence_complete"
  | "evidence_incomplete"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface EvidenceGap {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
  eventId?: number;
}

export interface RunEvidenceSummary {
  state: EvidenceState;
  coverage: number;
  reconstructable: boolean;
  eventCount: number;
  sequenceIntegrity: boolean;
  plannedSteps: number;
  completedSteps: number;
  failedSteps: number;
  toolCalls: number;
  resolvedToolCalls: number;
  approvalsRequested: number;
  approvalsResolved: number;
  artifactsCreated: number;
  modelRoutingRecorded: boolean;
  governedMemoryRecorded: boolean;
  runnerModeRecorded: boolean;
  recoveryCheckpoints: number;
  terminalEvent?: RunEventType;
  gaps: EvidenceGap[];
}

export function summarizeRunEvidence(
  events: ClientRunEvent[],
): RunEvidenceSummary {
  const ordered = [...events].sort((a, b) => a.seq - b.seq || a.id - b.id);
  const gaps: EvidenceGap[] = [];
  let sequenceIntegrity = true;

  if (ordered.length > 0 && ordered[0].seq !== 0) {
    sequenceIntegrity = false;
    gaps.push({
      code: "event-sequence-origin",
      severity: "critical",
      message: `Event sequence begins at ${ordered[0].seq} instead of 0.`,
      eventId: ordered[0].id,
    });
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (current.seq !== previous.seq + 1) {
      sequenceIntegrity = false;
      gaps.push({
        code: "event-sequence-gap",
        severity: "critical",
        message: `Event sequence jumps from ${previous.seq} to ${current.seq}.`,
        eventId: current.id,
      });
    }
  }

  const startEvents = ordered.filter((event) => event.type === "run.started");
  if (startEvents.length === 0) {
    gaps.push({
      code: "missing-run-start",
      severity: "critical",
      message: "No run.started event is available.",
    });
  }
  if (startEvents.length > 1) {
    gaps.push({
      code: "duplicate-run-start",
      severity: "warning",
      message: `The event log contains ${startEvents.length} run.started events.`,
    });
  }

  const plannedStepIds = new Set<string>();
  const planEvents = ordered.filter((event) => event.type === "plan.created");
  for (const event of planEvents) {
    const payload = asRecord(event.payload);
    const steps = Array.isArray(payload.steps) ? payload.steps : [];
    for (const step of steps) {
      const row = asRecord(step);
      if (row.id) plannedStepIds.add(String(row.id));
    }
  }
  if (planEvents.length === 0 && startEvents.length > 0) {
    gaps.push({
      code: "missing-plan",
      severity: "warning",
      message: "The run started but no plan.created event is available.",
    });
  }

  const completedStepIds = new Set<string>();
  const failedStepIds = new Set<string>();
  const toolCalls = new Map<string, ClientRunEvent>();
  const toolResults = new Set<string>();
  const approvals = new Map<string, ClientRunEvent>();
  const resolvedApprovals = new Set<string>();
  let artifactsCreated = 0;
  let modelRoutingRecorded = false;
  let governedMemoryRecorded = false;
  let runnerModeRecorded = false;
  let recoveryCheckpoints = 0;
  const terminalEvents: ClientRunEvent[] = [];

  for (const event of ordered) {
    const payload = asRecord(event.payload);
    switch (event.type) {
      case "step.completed":
        completedStepIds.add(String(payload.stepId));
        break;
      case "step.failed":
        failedStepIds.add(String(payload.stepId));
        break;
      case "tool.call":
        toolCalls.set(String(payload.toolCallId), event);
        break;
      case "tool.result":
        toolResults.add(String(payload.toolCallId));
        break;
      case "approval.requested":
        approvals.set(String(payload.approvalId), event);
        break;
      case "approval.resolved":
        resolvedApprovals.add(String(payload.approvalId));
        break;
      case "artifact.created":
        artifactsCreated += 1;
        break;
      case "model.routed":
        modelRoutingRecorded = true;
        break;
      case "memory.selected":
        governedMemoryRecorded = true;
        break;
      case "runner.mode":
        runnerModeRecorded = true;
        break;
      case "recovery.checkpoint":
        recoveryCheckpoints += 1;
        break;
      case "run.completed":
      case "run.failed":
      case "run.cancelled":
      case "run.interrupted":
        terminalEvents.push(event);
        break;
    }
  }

  for (const [id, event] of toolCalls) {
    if (!toolResults.has(id)) {
      gaps.push({
        code: "unresolved-tool-call",
        severity: "critical",
        message: `Tool call ${id} has no matching tool.result event.`,
        eventId: event.id,
      });
    }
  }

  for (const id of toolResults) {
    if (!toolCalls.has(id)) {
      gaps.push({
        code: "orphan-tool-result",
        severity: "critical",
        message: `Tool result ${id} has no matching tool.call event.`,
      });
    }
  }

  for (const [id, event] of approvals) {
    if (!resolvedApprovals.has(id)) {
      gaps.push({
        code: "unresolved-approval",
        severity: "warning",
        message: `Approval ${id} is still unresolved.`,
        eventId: event.id,
      });
    }
  }

  for (const id of resolvedApprovals) {
    if (!approvals.has(id)) {
      gaps.push({
        code: "orphan-approval-resolution",
        severity: "critical",
        message: `Approval resolution ${id} has no matching request event.`,
      });
    }
  }

  if (terminalEvents.length > 1) {
    gaps.push({
      code: "multiple-terminal-events",
      severity: "critical",
      message: `The event log contains ${terminalEvents.length} terminal events.`,
    });
  }

  const terminalEvent = terminalEvents.at(-1)?.type;
  if (terminalEvent === "run.completed") {
    for (const stepId of plannedStepIds) {
      if (!completedStepIds.has(stepId)) {
        gaps.push({
          code: "completed-run-with-incomplete-step",
          severity: "critical",
          message: `Run completed without completion evidence for step ${stepId}.`,
        });
      }
    }
  }

  const checks = [
    startEvents.length === 1,
    planEvents.length >= 1,
    sequenceIntegrity,
    sameSet(new Set(toolCalls.keys()), toolResults),
    sameSet(new Set(approvals.keys()), resolvedApprovals),
    terminalEvents.length <= 1,
    terminalEvent !== "run.completed" || plannedStepIds.size === completedStepIds.size,
  ];
  const coverage = Math.round(
    (checks.filter(Boolean).length / checks.length) * 100,
  );

  const criticalGap = gaps.some((gap) => gap.severity === "critical");
  const state = deriveState(terminalEvent, criticalGap, gaps.length > 0);

  return {
    state,
    coverage,
    reconstructable:
      sequenceIntegrity &&
      startEvents.length === 1 &&
      sameSet(new Set(toolCalls.keys()), toolResults) &&
      sameSet(new Set(approvals.keys()), resolvedApprovals) &&
      terminalEvents.length <= 1,
    eventCount: ordered.length,
    sequenceIntegrity,
    plannedSteps: plannedStepIds.size,
    completedSteps: completedStepIds.size,
    failedSteps: failedStepIds.size,
    toolCalls: toolCalls.size,
    resolvedToolCalls: toolResults.size,
    approvalsRequested: approvals.size,
    approvalsResolved: resolvedApprovals.size,
    artifactsCreated,
    modelRoutingRecorded,
    governedMemoryRecorded,
    runnerModeRecorded,
    recoveryCheckpoints,
    terminalEvent,
    gaps,
  };
}

function deriveState(
  terminalEvent: RunEventType | undefined,
  criticalGap: boolean,
  hasAnyGap: boolean,
): EvidenceState {
  if (!terminalEvent) return "live";
  if (terminalEvent === "run.failed") return "failed";
  if (terminalEvent === "run.cancelled") return "cancelled";
  if (terminalEvent === "run.interrupted") return "interrupted";
  return criticalGap || hasAnyGap ? "evidence_incomplete" : "evidence_complete";
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
