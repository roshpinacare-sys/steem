#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'evidence' / 'generated'
OUT.mkdir(parents=True, exist_ok=True)

# Every mutant has a dedicated behavior marker. A timeout, missing fixture, generic
# runner error, or non-zero exit without that marker is never counted as a kill.
MUTANTS = [
    ('authority-check-bypass', 'src/platform/evidence-completeness.js', 'if (!authorityAllows(input.authority.payload, {', 'if (false && !authorityAllows(input.authority.payload, {', ['tests/evidence-completeness.test.js'], 'AUTHORITY_DENIED'),
    ('self-review-bypass', 'src/platform/evidence-completeness.js', 'if (reviewers.includes(input.builderId))', 'if (false && reviewers.includes(input.builderId))', ['tests/evidence-completeness.test.js'], 'SELF_APPROVAL'),
    ('test-manifest-bypass', 'src/platform/evidence-completeness.js', 'if (payload.testManifestDigest !== input.expectedTestManifestDigest)', 'if (false && payload.testManifestDigest !== input.expectedTestManifestDigest)', ['tests/evidence-completeness.test.js'], 'TEST_MANIFEST_MISMATCH'),
    ('evidence-replay-bypass', 'src/platform/evidence-completeness.js', 'if (input.consumeReplayKey !== false && this.#consumed.has(replayKey))', 'if (false && input.consumeReplayKey !== false && this.#consumed.has(replayKey))', ['tests/evidence-completeness.test.js'], 'evidence root can be consumed only once'),
    ('critical-trust-not-revoked', 'src/platform/capability-trust.js', "const status = severity === 'CRITICAL' ? 'REVOKED'", "const status = severity === 'CRITICAL' ? 'TRUSTED'", ['tests/capability-trust.test.js', 'tests/property-invariants-v22.test.js'], 'high violation quarantines and critical violation revokes'),
    ('runtime-self-approval-bypass', 'src/runtime/sqlite-store.js', 'if (mission.builderId === reviewerId)', 'if (false && mission.builderId === reviewerId)', ['tests/durable.test.js', 'tests/model-based-v22.test.js'], 'approval wait creates no outbox and resumes after independent review'),
    ('idempotency-conflict-bypass', 'src/runtime/sqlite-store.js', 'if (receipt.payloadDigest !== payloadDigest)', 'if (false && receipt.payloadDigest !== payloadDigest)', ['tests/durable.test.js'], 'idempotency key cannot be reused with different payload'),
    ('runner-authorization-bypass', 'src/platform/test-execution-provenance.js', 'if (attestation.issuerKeyId !== claim.runnerId || !expected.authorizedRunnerIds.includes(claim.runnerId))', 'if (false && (attestation.issuerKeyId !== claim.runnerId || !expected.authorizedRunnerIds.includes(claim.runnerId)))', ['tests/test-execution-provenance.test.js'], 'RUNNER_UNAUTHORIZED'),
    ('postgres-outbox-substitution-bypass', 'src/runtime/postgres-store.js', 'if (sha256(outbox.payload) !== canonicalDigest)', 'if (false && sha256(outbox.payload) !== canonicalDigest)', ['tests/postgres-hardening-v23.test.js'], 'completion rejects caller-supplied outbox substitution'),
    ('postgres-claim-owner-bypass', 'src/runtime/postgres-store.js', 'if (canonical.claimed_by !== lease.workerId)', 'if (false && canonical.claimed_by !== lease.workerId)', ['tests/postgres-hardening-v23.test.js'], 'completion rejects stolen, expired and corrupted canonical claims'),
    ('trust-rollback-bypass', 'src/security/trust-checkpoint-store.js', 'if (input.snapshot.epoch < latest.epoch)', 'if (false && input.snapshot.epoch < latest.epoch)', ['tests/key-custody-rollback-v23.test.js'], 'monotonic trust checkpoint rejects lower-epoch rollback'),
    ('trust-fork-bypass', 'src/security/trust-checkpoint-store.js', 'if (input.snapshot.root !== latest.trustRoot)', 'if (false && input.snapshot.root !== latest.trustRoot)', ['tests/key-custody-rollback-v23.test.js'], 'monotonic trust checkpoint rejects a same-epoch fork'),
    ('kms-provider-substitution-bypass', 'src/security/attested-kms-adapter.js', 'if (response.provider !== this.provider)', 'if (false && response.provider !== this.provider)', ['tests/key-custody-rollback-v23.test.js'], 'attested KMS protocol rejects provider, key, attestation and signature substitution'),
    ('wasm-host-import-bypass', 'src/isolation/wasm-capability-runner.js', 'if (allowed.some((item) => !supportedImports.has(item)))', 'if (false && allowed.some((item) => !supportedImports.has(item)))', ['tests/wasm-hardening-v23.test.js'], 'capability_host_import_forbidden'),
    ('test-count-reduction-bypass', 'src/operations/test-optimization.js', 'if (input.currentTests < input.baselineTests)', 'if (false && input.currentTests < input.baselineTests)', ['tests/operations-optimization-v24.test.js'], 'runtime comparison rejects speedups obtained by reducing tests'),
    ('unknown-change-full-suite-bypass', 'src/operations/test-optimization.js', 'if (unknownFiles.length > 0)', 'if (false && unknownFiles.length > 0)', ['tests/operations-optimization-v24.test.js'], 'impact selection fails closed for unknown source and global configuration changes'),
    ('failed-tests-stop-action-bypass', 'src/operations/operator-action-center.js', 'if (failedTests > 0)', 'if (false && failedTests > 0)', ['tests/operations-optimization-v24.test.js'], 'operator action center blocks on failed tests and production dependencies'),
    ('governance-version-family-bypass', 'src/governance/consistency.js', "if (!version.startsWith('24.'))", "if (false && !version.startsWith('24.'))", ['tests/governance-consistency.test.js'], 'stale phase and version drift fail closed'),
]


def utc() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_mutant(spec: tuple) -> dict:
    mutant_id, target, old, new, tests, marker = spec
    started = time.perf_counter()
    temp_root = Path(tempfile.mkdtemp(prefix=f'v24-mutant-{mutant_id}-'))
    try:
        shutil.copytree(ROOT / 'dist', temp_root / 'dist')
        for relative in ('infra', 'isolation'):
            source = ROOT / relative
            if source.exists():
                shutil.copytree(source, temp_root / relative)
        path = temp_root / 'dist' / target
        source_digest = digest(path)
        text = path.read_text(encoding='utf-8')
        count = text.count(old)
        if count != 1:
            return {
                'mutantId': mutant_id,
                'status': 'not-created',
                'reason': f'expected one match, found {count}',
                'target': target,
                'expectedFailureMarker': marker,
                'sourceDigest': source_digest,
            }
        path.write_text(text.replace(old, new, 1), encoding='utf-8')
        mutant_digest = digest(path)
        command = ['node', '--test', '--test-concurrency=1', *[f'dist/{test}' for test in tests]]
        try:
            result = subprocess.run(
                command,
                cwd=temp_root,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=55,
                start_new_session=True,
            )
            marker_observed = marker in result.stdout
            intended = result.returncode != 0 and marker_observed
            status = 'killed-authentic' if intended else ('survived' if result.returncode == 0 else 'invalid-kill')
            return {
                'mutantId': mutant_id,
                'status': status,
                'target': target,
                'tests': tests,
                'command': command,
                'expectedFailureMarker': marker,
                'markerObserved': marker_observed,
                'exitCode': result.returncode,
                'durationMs': round((time.perf_counter() - started) * 1000, 3),
                'sourceDigest': source_digest,
                'mutantDigest': mutant_digest,
                'outputTail': result.stdout[-3500:],
            }
        except subprocess.TimeoutExpired as exc:
            output = exc.stdout if isinstance(exc.stdout, str) else ''
            return {
                'mutantId': mutant_id,
                'status': 'invalid-kill',
                'reason': 'timeout-not-accepted-as-kill',
                'target': target,
                'tests': tests,
                'expectedFailureMarker': marker,
                'markerObserved': marker in output,
                'exitCode': 124,
                'durationMs': round((time.perf_counter() - started) * 1000, 3),
                'sourceDigest': source_digest,
                'mutantDigest': mutant_digest,
                'outputTail': output[-3500:],
            }
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)


def main() -> int:
    started_at = utc()
    records: list[dict] = []
    with ThreadPoolExecutor(max_workers=4, thread_name_prefix='v24-mutant') as pool:
        futures = {pool.submit(run_mutant, spec): spec[0] for spec in MUTANTS}
        for future in as_completed(futures):
            try:
                records.append(future.result())
            except Exception as error:
                records.append({'mutantId': futures[future], 'status': 'invalid-kill', 'reason': f'harness_exception:{error}'})
    records.sort(key=lambda item: item['mutantId'])
    created = [record for record in records if record['status'] != 'not-created']
    authentic = sum(record['status'] == 'killed-authentic' for record in created)
    survived = sum(record['status'] == 'survived' for record in created)
    invalid = sum(record['status'] == 'invalid-kill' for record in created)
    report = {
        'version': '24.0',
        'ownerRole': 'Mutation Testing and Test Authenticity Leads',
        'status': 'passed' if len(created) == len(MUTANTS) and authentic == len(created) and survived == 0 and invalid == 0 else 'failed',
        'classification': 'executed-source-level-critical-logic-mutation-with-authentic-kill-markers',
        'startedAt': started_at,
        'finishedAt': utc(),
        'parallelWorkers': 4,
        'forceExitDisabled': True,
        'mutantsSpecified': len(MUTANTS),
        'mutantsCreated': len(created),
        'mutantsKilledAuthentically': authentic,
        'mutantsSurvived': survived,
        'invalidKills': invalid,
        'mutationScorePercent': round(100 * authentic / len(created), 2) if created else 0,
        'records': records,
        'authenticityRule': 'A mutant is killed only when its dedicated behavior-failure marker is present; generic non-zero exits, missing fixtures, harness exceptions, and timeouts are invalid kills.',
        'limitations': [
            'Targeted deterministic mutants, not exhaustive mutation of every source line.',
            'Equivalent-mutant analysis was manual for the selected operators.',
            'Parallel execution improves turnaround but does not weaken isolated temporary workspaces or marker requirements.',
        ],
    }
    (OUT / 'V24_MUTATION_RESULTS.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('status', 'mutantsCreated', 'mutantsKilledAuthentically', 'mutantsSurvived', 'invalidKills', 'mutationScorePercent')}, indent=2))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
