#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import signal
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
    ('persistent-evidence-replay-bypass', 'src/platform/evidence-completeness.js', 'if (!consumed)', 'if (false && !consumed)', ['tests/evidence-completeness.test.js'], 'persistent replay ledger blocks the same evidence after gate restart'),
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
    ('governance-version-family-bypass', 'src/governance/consistency.js', "if (!version.startsWith('26.'))", "if (false && !version.startsWith('26.'))", ['tests/governance-consistency.test.js'], 'stale phase and version drift fail closed'),
    ('canonical-undefined-bypass', 'src/contracts/crypto.js', "if (typeof value === 'undefined')\n        throw new Error(`canonical_json_undefined:${path}`);", "if (typeof value === 'undefined')\n        return null;", ['tests/canonical-json-hardening-v25.test.js'], 'canonical JSON rejects values silently erased or rewritten by JSON.stringify'),
    ('canonical-nonfinite-bypass', 'src/contracts/crypto.js', "if (!Number.isFinite(value))\n            throw new Error(`canonical_json_non_finite_number:${path}`);", "if (!Number.isFinite(value))\n            return null;", ['tests/canonical-json-hardening-v25.test.js'], 'canonical JSON rejects values silently erased or rewritten by JSON.stringify'),
    ('binary-hash-domain-bypass', 'src/contracts/crypto.js', "if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer)\n    throw new Error('sha256_binary_requires_sha256Bytes');", "if (false && (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer))\n    throw new Error('sha256_binary_requires_sha256Bytes');", ['tests/canonical-json-hardening-v25.test.js'], 'binary hashing has an explicit domain and structured hashing refuses bytes'),
    ('telemetry-log-retention-bypass', 'src/operations/telemetry.js', 'if (this.#logs.length >= this.#limits.maxLogs)', 'if (false && this.#logs.length >= this.#limits.maxLogs)', ['tests/telemetry-hardening-v25.test.js'], 'telemetry bounds logs and duration samples while reporting drops'),
    ('telemetry-readiness-bypass', 'src/operations/telemetry.js', "d.status === 'blocked') ? 'blocked'", "d.status === 'blocked') ? 'ready'", ['tests/telemetry-hardening-v25.test.js'], 'degraded dependencies produce degraded readiness instead of ready'),
    ('action-resolution-evidence-bypass', 'src/operations/action-ledger.js', "if (input.type === 'RESOLVED' && (input.evidenceDigest === undefined || !/^[a-f0-9]{64}$/.test(input.evidenceDigest)))", "if (false && input.type === 'RESOLVED' && (input.evidenceDigest === undefined || !/^[a-f0-9]{64}$/.test(input.evidenceDigest)))", ['tests/operational-action-ledger-v25.test.js'], 'resolution requires digest-bound completion evidence'),
    ('action-critical-dual-control-bypass', 'src/operations/action-ledger.js', 'const minimum = action.priority === 1 ? 2 : 1;', 'const minimum = 1;', ['tests/operational-action-ledger-v25.test.js'], 'priority-one waiver requires two independent approvers and evidence'),
    ('critical-invariant-monitor-bypass', 'src/validation/invariant-coverage.js', "[(invariant.monitorIds ?? []).length > 0, 'CRITICAL_MONITOR_MISSING'", "[true, 'CRITICAL_MONITOR_MISSING'", ['tests/invariant-coverage-v25.test.js'], 'critical invariant fails when a required control class is missing'),
    ('dependency-install-script-bypass', 'src/supply-chain/dependency-policy.js', 'if (pkg.hasInstallScript === true)', 'if (false && pkg.hasInstallScript === true)', ['tests/supply-chain-portability-v26.test.js'], 'install scripts, git sources and missing integrity are rejected'),
    ('trust-violation-deduplication-bypass', 'src/platform/capability-trust.js', "if (existing !== undefined)", "if (false && existing !== undefined)", ['tests/recertification-persistence-v26.test.js'], 'trust violation ids are idempotent and conflicting reuse fails closed'),
    ('recertification-case-digest-bypass', 'src/platform/recertification-case-store.js', 'if (digest !== sha256(material))', 'if (false && digest !== sha256(material))', ['tests/recertification-persistence-v26.test.js'], 'tampered persisted case is rejected'),
    ('recertification-incident-conflict-bypass', 'src/platform/incident-recertification.js', 'if (persisted.incidentDigest !== incidentDigest)', 'if (false && persisted.incidentDigest !== incidentDigest)', ['tests/recertification-persistence-v26.test.js'], 'same incident id with changed material is rejected'),
    ('agent-canonical-proposal-bypass', 'src/agents/governed-agent.js', 'if (sha256(plan) !== sha256(canonical))', 'if (false && sha256(plan) !== sha256(canonical))', ['tests/governed-agent-binding-v26.test.js'], 'recomputed or substituted proposal and changed approved operation are rejected'),
    ('agent-file-drift-bypass', 'src/agents/governed-agent.js', 'if (sha256(original) !== canonical.expectedFileDigest)', 'if (false && sha256(original) !== canonical.expectedFileDigest)', ['tests/governed-agent-binding-v26.test.js'], 'requester and agent cannot approve and target drift blocks execution'),
    ('domain-raw-admission-bypass', 'src/platform/domain-pack.js', "register(_manifest) { throw new Error('domain_pack_approval_required'); }", 'register(_manifest) { return undefined; }', ['tests/domain-pack-admission-v26.test.js'], 'raw manifest admission is forbidden and approval lineage is retained'),
    ('domain-approval-digest-bypass', 'src/platform/domain-pack.js', 'if (digest !== sha256(material))', 'if (false && digest !== sha256(material))', ['tests/domain-pack-admission-v26.test.js'], 'tampered approval and draft admission fail closed'),
    ('domain-monotonic-version-bypass', 'src/platform/domain-pack.js', 'if (compareSemver(pack.manifest.version, previous.manifest.version) <= 0)', 'if (false && compareSemver(pack.manifest.version, previous.manifest.version) <= 0)', ['tests/domain-pack-admission-v26.test.js'], 'upgrade requires strict semver, predecessor and monotonic version'),
    ('design-integration-reference-bypass', 'src/validation/design-closure.js', 'if (refs.length === 0)', 'if (false && refs.length === 0)', ['tests/design-closure-v26.test.js'], 'implemented but unwired code is blocked'),
    ('design-independent-review-bypass', 'src/validation/design-closure.js', "if (claim.proposerRole.trim() === '' || reviewers.length === 0 || reviewers.includes(claim.proposerRole))", "if (false && (claim.proposerRole.trim() === '' || reviewers.length === 0 || reviewers.includes(claim.proposerRole)))", ['tests/design-closure-v26.test.js'], 'self review and missing references fail closed'),
]


def utc() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_mutant(spec: tuple) -> dict:
    mutant_id, target, old, new, tests, marker = spec
    started = time.perf_counter()
    temp_root = Path(tempfile.mkdtemp(prefix=f'v26-mutant-{mutant_id}-'))
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
            return {'mutantId': mutant_id, 'status': 'not-created', 'reason': f'expected one match, found {count}', 'target': target, 'expectedFailureMarker': marker, 'sourceDigest': source_digest}
        path.write_text(text.replace(old, new, 1), encoding='utf-8')
        mutant_digest = digest(path)
        command = ['node', '--test', '--test-concurrency=1', *[f'dist/{test}' for test in tests]]
        process = subprocess.Popen(command, cwd=temp_root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            output, _ = process.communicate(timeout=55)
        except subprocess.TimeoutExpired:
            try: os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError: pass
            try: output, _ = process.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                try: os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                output, _ = process.communicate()
            return {'mutantId': mutant_id, 'status': 'invalid-kill', 'reason': 'timeout-not-accepted-as-kill', 'target': target, 'tests': tests, 'expectedFailureMarker': marker, 'markerObserved': marker in (output or ''), 'exitCode': 124, 'durationMs': round((time.perf_counter()-started)*1000,3), 'sourceDigest': source_digest, 'mutantDigest': mutant_digest, 'outputTail': (output or '')[-3500:]}
        marker_observed = marker in output
        intended = process.returncode != 0 and marker_observed
        status = 'killed-authentic' if intended else ('survived' if process.returncode == 0 else 'invalid-kill')
        return {'mutantId': mutant_id, 'status': status, 'target': target, 'tests': tests, 'command': command, 'expectedFailureMarker': marker, 'markerObserved': marker_observed, 'exitCode': process.returncode, 'durationMs': round((time.perf_counter()-started)*1000,3), 'sourceDigest': source_digest, 'mutantDigest': mutant_digest, 'outputTail': output[-3500:]}
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)


STATE = ROOT / '.mutation-v26-state.json'

def atomic_state(payload: dict) -> None:
    temp = STATE.with_suffix(f'.tmp-{os.getpid()}')
    temp.write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')
    os.replace(temp, STATE)

def suite_digest() -> str:
    h = hashlib.sha256()
    h.update(json.dumps(MUTANTS, sort_keys=True).encode())
    for target in sorted({spec[1] for spec in MUTANTS}):
        path = ROOT / 'dist' / target
        h.update(target.encode()); h.update(path.read_bytes())
    return h.hexdigest()

def reusable_records(current_digest: str) -> dict[str, dict]:
    try:
        state = json.loads(STATE.read_text())
    except Exception:
        return {}
    if state.get('suiteDigest') != current_digest:
        return {}
    allowed = {spec[0] for spec in MUTANTS}
    return {r['mutantId']: r for r in state.get('records', []) if r.get('mutantId') in allowed and r.get('status') == 'killed-authentic'}

def main() -> int:
    started_at = utc()
    digest_value = suite_digest()
    reused = reusable_records(digest_value)
    records: list[dict] = list(reused.values())
    pending = [spec for spec in MUTANTS if spec[0] not in reused]
    atomic_state({'version':'26.0','suiteDigest':digest_value,'status':'in-progress','records':records,'pending':[s[0] for s in pending]})
    with ThreadPoolExecutor(max_workers=8, thread_name_prefix='v26-mutant') as pool:
        futures = {pool.submit(run_mutant, spec): spec[0] for spec in pending}
        for future in as_completed(futures):
            try:
                records.append(future.result())
            except Exception as error:
                records.append({'mutantId': futures[future], 'status': 'invalid-kill', 'reason': f'harness_exception:{error}'})
            atomic_state({'version':'26.0','suiteDigest':digest_value,'status':'in-progress','records':records,'pending':[s[0] for s in pending if s[0] not in {r.get('mutantId') for r in records}]})
    records.sort(key=lambda item: item['mutantId'])
    created = [record for record in records if record['status'] != 'not-created']
    authentic = sum(record['status'] == 'killed-authentic' for record in created)
    survived = sum(record['status'] == 'survived' for record in created)
    invalid = sum(record['status'] == 'invalid-kill' for record in created)
    report = {
        'version': '26.0',
        'ownerRole': 'Mutation Testing and Test Authenticity Leads',
        'status': 'passed' if len(created) == len(MUTANTS) and authentic == len(created) and survived == 0 and invalid == 0 else 'failed',
        'classification': 'executed-source-level-critical-logic-mutation-with-authentic-kill-markers',
        'startedAt': started_at,
        'finishedAt': utc(),
        'parallelWorkers': 8,
        'resumedAuthenticKills': len(reused),
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
    (OUT / 'V26_MUTATION_RESULTS.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    STATE.unlink(missing_ok=True)
    print(json.dumps({key: report[key] for key in ('status', 'mutantsCreated', 'mutantsKilledAuthentically', 'mutantsSurvived', 'invalidKills', 'mutationScorePercent')}, indent=2))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
