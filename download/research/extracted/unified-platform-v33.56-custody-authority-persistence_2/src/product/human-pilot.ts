import { sha256 } from '../contracts/crypto.js';

export type PilotTaskId = 'permission-review' | 'evidence-review' | 'incident-response' | 'rollback' | 'recertification';
export interface PilotTask {
  readonly taskId: PilotTaskId;
  readonly instruction: string;
  readonly successCriterion: string;
  readonly stopCondition: string;
  readonly maximumMs: number;
}
export interface PilotProtocol {
  readonly version: '24.0';
  readonly consentRequired: true;
  readonly minimumParticipantsForAggregate: number;
  readonly tasks: readonly PilotTask[];
  readonly forbiddenClaims: readonly string[];
}
export interface PilotObservation {
  readonly participantId: string;
  readonly consented: boolean;
  readonly role: 'builder' | 'reviewer' | 'operator' | 'auditor';
  readonly taskId: PilotTaskId;
  readonly completed: boolean;
  readonly elapsedMs: number;
  readonly criticalErrors: number;
  readonly assistRequests: number;
  readonly comprehensionCorrect: number;
  readonly comprehensionTotal: number;
  readonly stoppedForSafety: boolean;
}
export interface PilotAggregate {
  readonly status: 'insufficient-sample' | 'measured';
  readonly participants: number;
  readonly observations: number;
  readonly completionRate?: number;
  readonly criticalErrorRate?: number;
  readonly medianElapsedMs?: number;
  readonly comprehensionRate?: number;
  readonly taskResults?: readonly { taskId: PilotTaskId; observations: number; pass: boolean; reasons: readonly string[] }[];
  readonly limitations: readonly string[];
}

export function createHumanPilotProtocol(): PilotProtocol {
  return {
    version: '24.0', consentRequired: true, minimumParticipantsForAggregate: 5,
    tasks: [
      { taskId: 'permission-review', instruction: 'Identify requested authority and reject an excessive scope.', successCriterion: 'Reject wildcard scope and name the excessive permission.', stopCondition: 'Participant approves wildcard authority.', maximumMs: 180_000 },
      { taskId: 'evidence-review', instruction: 'Determine whether completion evidence is current and authentic.', successCriterion: 'Detect stale or substituted test evidence.', stopCondition: 'Participant promotes with stale evidence.', maximumMs: 240_000 },
      { taskId: 'incident-response', instruction: 'Restrict an affected capability without stopping an unaffected tenant.', successCriterion: 'Quarantine affected capability and preserve unaffected tenant operations.', stopCondition: 'Participant disables all tenants without cause.', maximumMs: 300_000 },
      { taskId: 'rollback', instruction: 'Restore the exact pre-change artifact digest.', successCriterion: 'Restored digest equals the recorded pre-change digest.', stopCondition: 'Participant accepts a non-matching digest.', maximumMs: 240_000 },
      { taskId: 'recertification', instruction: 'Review remediation and decide whether authority may be restored.', successCriterion: 'Require independent review and regression evidence.', stopCondition: 'Participant permits self-approval.', maximumMs: 300_000 },
    ],
    forbiddenClaims: ['production usability', 'operator confidence', 'human value improvement', 'reduced review time'],
  };
}

export function validateObservation(observation: PilotObservation, protocol = createHumanPilotProtocol()): void {
  if (!observation.consented) throw new Error('pilot_consent_required');
  if (observation.participantId.trim() === '') throw new Error('pilot_participant_required');
  const task = protocol.tasks.find((item) => item.taskId === observation.taskId);
  if (task === undefined) throw new Error('pilot_task_unknown');
  if (!Number.isInteger(observation.elapsedMs) || observation.elapsedMs < 0 || observation.elapsedMs > task.maximumMs * 2) throw new Error('pilot_elapsed_invalid');
  for (const value of [observation.criticalErrors, observation.assistRequests, observation.comprehensionCorrect, observation.comprehensionTotal]) {
    if (!Number.isInteger(value) || value < 0) throw new Error('pilot_count_invalid');
  }
  if (observation.comprehensionCorrect > observation.comprehensionTotal) throw new Error('pilot_comprehension_invalid');
}

export function pseudonymizeObservation(observation: PilotObservation): Omit<PilotObservation, 'participantId'> & { readonly participantRef: string } {
  validateObservation(observation);
  const { participantId, ...rest } = observation;
  return { ...rest, participantRef: sha256(`v24-pilot:${participantId}`).slice(0, 16) };
}

export function aggregatePilot(observations: readonly PilotObservation[], protocol = createHumanPilotProtocol()): PilotAggregate {
  observations.forEach((item) => validateObservation(item, protocol));
  const participants = new Set(observations.map((item) => item.participantId)).size;
  if (participants < protocol.minimumParticipantsForAggregate) {
    return { status: 'insufficient-sample', participants, observations: observations.length, limitations: ['No human-value or time-improvement claim is permitted below the predefined participant minimum.'] };
  }
  const completionRate = ratio(observations.filter((item) => item.completed && !item.stoppedForSafety).length, observations.length);
  const criticalErrorRate = ratio(observations.reduce((sum, item) => sum + item.criticalErrors, 0), observations.length);
  const comprehensionCorrect = observations.reduce((sum, item) => sum + item.comprehensionCorrect, 0);
  const comprehensionTotal = observations.reduce((sum, item) => sum + item.comprehensionTotal, 0);
  const elapsed = observations.map((item) => item.elapsedMs).sort((a, b) => a - b);
  const medianElapsedMs = elapsed.length % 2 === 1 ? elapsed[(elapsed.length - 1) / 2]! : Math.round((elapsed[elapsed.length / 2 - 1]! + elapsed[elapsed.length / 2]!) / 2);
  const taskResults = protocol.tasks.map((task) => {
    const rows = observations.filter((item) => item.taskId === task.taskId);
    const reasons: string[] = [];
    if (rows.length < participants) reasons.push('not_all_participants_observed');
    if (rows.some((item) => item.criticalErrors > 0 || item.stoppedForSafety)) reasons.push('critical_error_or_safety_stop');
    if (rows.some((item) => !item.completed)) reasons.push('incomplete_task');
    if (rows.some((item) => item.comprehensionTotal === 0 || item.comprehensionCorrect / item.comprehensionTotal < 0.8)) reasons.push('comprehension_below_80_percent');
    return { taskId: task.taskId, observations: rows.length, pass: reasons.length === 0, reasons };
  });
  return {
    status: 'measured', participants, observations: observations.length, completionRate, criticalErrorRate, medianElapsedMs,
    comprehensionRate: ratio(comprehensionCorrect, comprehensionTotal), taskResults,
    limitations: ['Results describe only the observed participants, tasks and environment.', 'No confidence percentage is generated.'],
  };
}

function ratio(numerator: number, denominator: number): number { return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4)); }
