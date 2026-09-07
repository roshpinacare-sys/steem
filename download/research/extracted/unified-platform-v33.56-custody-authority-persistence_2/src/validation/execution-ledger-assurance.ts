import { isAbsolute, posix } from 'node:path';
import { sha256 } from '../contracts/crypto.js';

export type ExecutionLedgerStatus = 'running' | 'validating' | 'passed' | 'failed' | 'aborted';
export type ExecutionStepStatus = 'passed' | 'failed' | 'timed-out' | 'aborted';

export interface ExecutionArtifactRecord {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface ExecutionStepRecord {
  readonly id: string;
  readonly sequence: number;
  readonly command: readonly string[];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: ExecutionStepStatus;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly artifacts: readonly ExecutionArtifactRecord[];
}

export interface ExecutionLedger {
  readonly version: string;
  readonly runId: string;
  readonly status: ExecutionLedgerStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly sourceDigest: string;
  readonly steps: readonly ExecutionStepRecord[];
}

export interface ExecutionArtifactObservation extends ExecutionArtifactRecord {
  readonly modifiedAt: string;
}

export interface ExecutionLedgerAssuranceInput {
  readonly ledger: ExecutionLedger;
  readonly expectedVersion: string;
  readonly expectedRunId: string;
  readonly expectedSourceDigest: string;
  readonly expectedRunPrefix: string;
  readonly requiredSteps: readonly { readonly id: string; readonly artifacts: readonly string[] }[];
  readonly observations: readonly ExecutionArtifactObservation[];
  readonly now: string;
  readonly maximumClockSkewMs?: number;
  readonly maximumRunAgeMs?: number;
}

export interface ExecutionLedgerAssuranceReport {
  readonly status: 'PASS' | 'BLOCK';
  readonly failures: readonly string[];
  readonly checkedSteps: number;
  readonly checkedArtifacts: number;
  readonly reportDigest: string;
}

export function evaluateExecutionLedger(input: ExecutionLedgerAssuranceInput): ExecutionLedgerAssuranceReport {
  const failures: string[] = [];
  const skew = input.maximumClockSkewMs ?? 5_000;
  const maximumRunAgeMs = input.maximumRunAgeMs ?? 3_600_000;
  const now = parseInstant(input.now, 'now', failures);
  const started = parseInstant(input.ledger.startedAt, 'ledger_started_at', failures);
  const updated = parseInstant(input.ledger.updatedAt, 'ledger_updated_at', failures);

  if (input.ledger.version !== input.expectedVersion) failures.push('ledger_version_mismatch');
  if (input.ledger.runId !== input.expectedRunId) failures.push('ledger_run_id_mismatch');
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(input.ledger.runId)) failures.push('ledger_run_id_invalid');
  if (input.ledger.sourceDigest !== input.expectedSourceDigest) failures.push('ledger_source_digest_mismatch');
  if (!['validating', 'passed'].includes(input.ledger.status)) failures.push('ledger_status_not_finalizable');
  if (started !== undefined && now !== undefined) {
    if (started > now + skew) failures.push('ledger_started_in_future');
    if (now - started > maximumRunAgeMs) failures.push('ledger_run_stale');
  }
  if (started !== undefined && updated !== undefined && updated < started) failures.push('ledger_updated_before_start');
  if (updated !== undefined && now !== undefined && updated > now + skew) failures.push('ledger_updated_in_future');

  const requiredIds = input.requiredSteps.map((row) => row.id);
  const stepIds = input.ledger.steps.map((row) => row.id);
  if (new Set(stepIds).size !== stepIds.length) failures.push('ledger_duplicate_step');
  if (stepIds.length !== requiredIds.length || stepIds.some((id, index) => id !== requiredIds[index])) failures.push('ledger_step_order_or_set_mismatch');

  const observationByPath = new Map<string, ExecutionArtifactObservation>();
  for (const observation of input.observations) {
    if (observationByPath.has(observation.path)) failures.push('observation_duplicate_path');
    observationByPath.set(observation.path, observation);
  }

  const recordedPaths = new Set<string>();
  for (const [index, step] of input.ledger.steps.entries()) {
    if (step.sequence !== index + 1) failures.push(`step_sequence_invalid:${step.id}`);
    if (step.command.length === 0 || step.command.some((part) => part.trim() === '')) failures.push(`step_command_invalid:${step.id}`);
    if (step.status !== 'passed' || step.exitCode !== 0 || step.timedOut) failures.push(`step_not_passed:${step.id}`);
    const stepStarted = parseInstant(step.startedAt, `step_started_at:${step.id}`, failures);
    const stepFinished = parseInstant(step.finishedAt, `step_finished_at:${step.id}`, failures);
    if (stepStarted !== undefined && stepFinished !== undefined && stepFinished < stepStarted) failures.push(`step_time_reversed:${step.id}`);
    if (started !== undefined && stepStarted !== undefined && stepStarted < started - skew) failures.push(`step_predates_run:${step.id}`);
    if (now !== undefined && stepFinished !== undefined && stepFinished > now + skew) failures.push(`step_finishes_in_future:${step.id}`);
    if (index > 0) {
      const priorFinished = Date.parse(input.ledger.steps[index - 1]!.finishedAt);
      if (Number.isFinite(priorFinished) && stepStarted !== undefined && stepStarted < priorFinished - skew) failures.push(`step_overlap_or_reorder:${step.id}`);
    }

    const expected = input.requiredSteps[index];
    if (expected === undefined || expected.id !== step.id) continue;
    const actualNames = step.artifacts.map((artifact) => posix.basename(artifact.path)).sort();
    const expectedNames = [...expected.artifacts].sort();
    if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) failures.push(`step_artifact_set_mismatch:${step.id}`);

    for (const artifact of step.artifacts) {
      if (!safeArtifactPath(artifact.path, input.expectedRunPrefix)) failures.push(`artifact_path_unsafe:${artifact.path}`);
      if (!/^[0-9a-f]{64}$/.test(artifact.sha256) || !Number.isInteger(artifact.bytes) || artifact.bytes < 0) failures.push(`artifact_record_invalid:${artifact.path}`);
      if (recordedPaths.has(artifact.path)) failures.push(`artifact_recorded_twice:${artifact.path}`);
      recordedPaths.add(artifact.path);
      const observed = observationByPath.get(artifact.path);
      if (observed === undefined) { failures.push(`artifact_observation_missing:${artifact.path}`); continue; }
      if (observed.sha256 !== artifact.sha256 || observed.bytes !== artifact.bytes) failures.push(`artifact_digest_or_size_mismatch:${artifact.path}`);
      const modified = parseInstant(observed.modifiedAt, `artifact_modified_at:${artifact.path}`, failures);
      if (modified !== undefined && stepStarted !== undefined && modified < stepStarted - skew) failures.push(`artifact_stale_before_step:${artifact.path}`);
      if (modified !== undefined && stepFinished !== undefined && modified > stepFinished + skew) failures.push(`artifact_modified_after_step:${artifact.path}`);
    }
  }

  for (const path of observationByPath.keys()) if (!recordedPaths.has(path)) failures.push(`unledgered_artifact:${path}`);
  const uniqueFailures = [...new Set(failures)].sort();
  const material = { status: uniqueFailures.length === 0 ? 'PASS' as const : 'BLOCK' as const, failures: uniqueFailures, checkedSteps: input.ledger.steps.length, checkedArtifacts: recordedPaths.size };
  return { ...material, reportDigest: sha256(material) };
}

function safeArtifactPath(path: string, expectedPrefix: string): boolean {
  if (path.trim() === '' || isAbsolute(path) || path.includes('\\')) return false;
  const normalized = posix.normalize(path);
  const prefix = expectedPrefix.endsWith('/') ? expectedPrefix : `${expectedPrefix}/`;
  return normalized === path && !normalized.startsWith('../') && !normalized.includes('/../') && normalized.startsWith(prefix);
}

function parseInstant(value: string, label: string, failures: string[]): number | undefined {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) { failures.push(`${label}_invalid`); return undefined; }
  return parsed;
}
