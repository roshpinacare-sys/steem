import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateExecutionLedger, type ExecutionLedgerAssuranceInput } from '../src/validation/execution-ledger-assurance.js';

const runId = 'v32.11-test';
const prefix = `evidence/runs/${runId}`;
const t = (offset: number) => new Date(Date.parse('2026-07-19T09:00:00Z') + offset).toISOString();
const artifact = (name: string, digest = 'a'.repeat(64)) => ({ path: `${prefix}/${name}`, sha256: digest, bytes: 10 });

function fixture(): ExecutionLedgerAssuranceInput {
  const first = artifact('A.json');
  const second = artifact('B.json', 'b'.repeat(64));
  return {
    expectedVersion: '32.11', expectedRunId: runId, expectedSourceDigest: 'c'.repeat(64), expectedRunPrefix: prefix,
    now: t(30_000), maximumRunAgeMs: 60_000,
    requiredSteps: [{ id: 'tests', artifacts: ['A.json'] }, { id: 'quality', artifacts: ['B.json'] }],
    ledger: {
      version: '32.11', runId, status: 'validating', startedAt: t(0), updatedAt: t(20_000), sourceDigest: 'c'.repeat(64),
      steps: [
        { id: 'tests', sequence: 1, command: ['node', '--test'], startedAt: t(1_000), finishedAt: t(8_000), status: 'passed', exitCode: 0, timedOut: false, artifacts: [first] },
        { id: 'quality', sequence: 2, command: ['node', 'quality.mjs'], startedAt: t(9_000), finishedAt: t(18_000), status: 'passed', exitCode: 0, timedOut: false, artifacts: [second] },
      ],
    },
    observations: [{ ...first, modifiedAt: t(7_000) }, { ...second, modifiedAt: t(17_000) }],
  };
}

const failures = (input: ExecutionLedgerAssuranceInput) => evaluateExecutionLedger(input).failures;

test('fresh ordered run-scoped evidence ledger passes', () => {
  const report = evaluateExecutionLedger(fixture());
  assert.equal(report.status, 'PASS', JSON.stringify(report.failures));
  assert.match(report.reportDigest, /^[0-9a-f]{64}$/);
});

test('wrong run identity and stale source identity fail closed', () => {
  const base = fixture();
  const report = evaluateExecutionLedger({ ...base, expectedRunId: 'other', expectedSourceDigest: 'd'.repeat(64) });
  assert.ok(report.failures.includes('ledger_run_id_mismatch'));
  assert.ok(report.failures.includes('ledger_source_digest_mismatch'));
});

test('running failed and aborted ledgers cannot be finalized', () => {
  for (const status of ['running', 'failed', 'aborted'] as const) {
    const base = fixture();
    assert.ok(failures({ ...base, ledger: { ...base.ledger, status } }).includes('ledger_status_not_finalizable'));
  }
});

test('missing reordered and duplicated steps are rejected', () => {
  const base = fixture();
  const reversed = [...base.ledger.steps].reverse();
  assert.ok(failures({ ...base, ledger: { ...base.ledger, steps: reversed } }).includes('ledger_step_order_or_set_mismatch'));
  const duplicated = [base.ledger.steps[0]!, { ...base.ledger.steps[0]!, sequence: 2 }];
  const duplicateFailures = failures({ ...base, ledger: { ...base.ledger, steps: duplicated } });
  assert.ok(duplicateFailures.includes('ledger_duplicate_step'));
});

test('timeout nonzero exit and failed step are rejected independently', () => {
  const base = fixture();
  const broken = { ...base.ledger.steps[0]!, status: 'failed' as const, exitCode: 2, timedOut: true };
  assert.ok(failures({ ...base, ledger: { ...base.ledger, steps: [broken, base.ledger.steps[1]!] } }).includes('step_not_passed:tests'));
});

test('artifact digest size and missing observation mismatch are rejected', () => {
  const base = fixture();
  const changed = base.observations.map((row, index) => index === 0 ? { ...row, sha256: 'f'.repeat(64), bytes: 11 } : row);
  const mismatch = failures({ ...base, observations: changed });
  assert.ok(mismatch.some((row) => row.startsWith('artifact_digest_or_size_mismatch:')));
  assert.ok(failures({ ...base, observations: base.observations.slice(1) }).some((row) => row.startsWith('artifact_observation_missing:')));
});

test('path traversal absolute paths and backslashes are rejected', () => {
  for (const path of ['../A.json', '/tmp/A.json', `${prefix}\\A.json`]) {
    const base = fixture();
    const bad = { ...base.ledger.steps[0]!.artifacts[0]!, path };
    const ledger = { ...base.ledger, steps: [{ ...base.ledger.steps[0]!, artifacts: [bad] }, base.ledger.steps[1]!] };
    const observations = [{ ...bad, modifiedAt: t(7_000) }, base.observations[1]!];
    assert.ok(failures({ ...base, ledger, observations }).some((row) => row.startsWith('artifact_path_unsafe:')));
  }
});

test('artifact predating its producing step is rejected as stale', () => {
  const base = fixture();
  const observations = [{ ...base.observations[0]!, modifiedAt: t(-10_000) }, base.observations[1]!];
  assert.ok(failures({ ...base, observations }).some((row) => row.startsWith('artifact_stale_before_step:')));
});

test('future and over-age execution ledgers are rejected', () => {
  const base = fixture();
  assert.ok(failures({ ...base, now: t(-6_000) }).includes('ledger_started_in_future'));
  assert.ok(failures({ ...base, now: t(120_000), maximumRunAgeMs: 60_000 }).includes('ledger_run_stale'));
});

test('unledgered artifacts are rejected rather than silently accepted', () => {
  const base = fixture();
  const extra = { ...artifact('EXTRA.json', 'e'.repeat(64)), modifiedAt: t(12_000) };
  assert.ok(failures({ ...base, observations: [...base.observations, extra] }).some((row) => row.startsWith('unledgered_artifact:')));
});

test('invalid ledger metadata and timestamp relations are rejected', () => {
  const base = fixture();
  const ledger = { ...base.ledger, version: '32.10', runId: 'bad run id', startedAt: 'not-a-time', updatedAt: t(40_000) };
  const report = evaluateExecutionLedger({ ...base, ledger, maximumClockSkewMs: 0 });
  assert.ok(report.failures.includes('ledger_version_mismatch'));
  assert.ok(report.failures.includes('ledger_run_id_mismatch'));
  assert.ok(report.failures.includes('ledger_run_id_invalid'));
  assert.ok(report.failures.includes('ledger_started_at_invalid'));
  assert.ok(report.failures.includes('ledger_updated_in_future'));
  const reversed = { ...base.ledger, updatedAt: t(-1_000) };
  assert.ok(failures({ ...base, ledger: reversed, maximumClockSkewMs: 0 }).includes('ledger_updated_before_start'));
});

test('malformed commands sequences and step time ordering are rejected', () => {
  const base = fixture();
  const reversedFirst = { ...base.ledger.steps[0]!, sequence: 9, command: [], startedAt: t(-10_000), finishedAt: t(-20_000) };
  const reversedReport = evaluateExecutionLedger({ ...base, ledger: { ...base.ledger, steps: [reversedFirst, base.ledger.steps[1]!] }, maximumClockSkewMs: 0 });
  for (const prefix of ['step_sequence_invalid:tests', 'step_command_invalid:tests', 'step_time_reversed:tests', 'step_predates_run:tests']) {
    assert.ok(reversedReport.failures.includes(prefix), `${prefix}: ${JSON.stringify(reversedReport.failures)}`);
  }
  const overlappingSecond = { ...base.ledger.steps[1]!, startedAt: t(5_000), finishedAt: t(40_000) };
  const overlapReport = evaluateExecutionLedger({ ...base, ledger: { ...base.ledger, steps: [base.ledger.steps[0]!, overlappingSecond] }, maximumClockSkewMs: 0 });
  assert.ok(overlapReport.failures.includes('step_overlap_or_reorder:quality'));
  assert.ok(overlapReport.failures.includes('step_finishes_in_future:quality'));
});

test('artifact inventory schema duplication and late modification fail closed', () => {
  const base = fixture();
  const original = base.ledger.steps[0]!.artifacts[0]!;
  const malformed = { ...original, sha256: 'not-a-digest', bytes: -1 };
  const duplicate = { ...original };
  const first = { ...base.ledger.steps[0]!, artifacts: [malformed, duplicate] };
  const observations = [base.observations[0]!, { ...base.observations[0]! }, { ...base.observations[1]!, modifiedAt: t(25_000) }];
  const report = evaluateExecutionLedger({ ...base, ledger: { ...base.ledger, steps: [first, base.ledger.steps[1]!] }, observations, maximumClockSkewMs: 0 });
  assert.ok(report.failures.includes('observation_duplicate_path'));
  assert.ok(report.failures.includes('step_artifact_set_mismatch:tests'));
  assert.ok(report.failures.some((row) => row.startsWith('artifact_record_invalid:')));
  assert.ok(report.failures.some((row) => row.startsWith('artifact_recorded_twice:')));
  assert.ok(report.failures.some((row) => row.startsWith('artifact_modified_after_step:')));
});

test('noncanonical and empty artifact paths plus invalid modification times are rejected', () => {
  for (const path of ['', `${prefix}//A.json`]) {
    const base = fixture();
    const bad = { ...base.ledger.steps[0]!.artifacts[0]!, path };
    const ledger = { ...base.ledger, steps: [{ ...base.ledger.steps[0]!, artifacts: [bad] }, base.ledger.steps[1]!] };
    const observations = [{ ...bad, modifiedAt: 'invalid-time' }, base.observations[1]!];
    const report = evaluateExecutionLedger({ ...base, ledger, observations });
    assert.ok(report.failures.some((row) => row.startsWith('artifact_path_unsafe:')));
    assert.ok(report.failures.some((row) => row.includes('artifact_modified_at:') && row.endsWith('_invalid')));
  }
});
