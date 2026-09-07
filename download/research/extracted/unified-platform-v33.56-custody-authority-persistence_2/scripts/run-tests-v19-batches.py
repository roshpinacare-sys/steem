#!/usr/bin/env python3
from __future__ import annotations
import json, os, re, signal, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'evidence' / 'generated' / 'test-batches'
OUT.mkdir(parents=True, exist_ok=True)

batches: list[tuple[str, list[str]]] = [
    ('core', [
        'dist/tests/adapters.test.js','dist/tests/backup-restore.test.js','dist/tests/contracts.test.js',
        'dist/tests/digital-thread.test.js','dist/tests/durable.test.js','dist/tests/failure-knowledge.test.js',
        'dist/tests/integrated-engineering-commitment.test.js','dist/tests/key-lifecycle.test.js',
        'dist/tests/postgres-contract.test.js','dist/tests/shadow-flow.test.js',
        'dist/tests/standards-adapters.test.js','dist/tests/system-contracts.test.js',
    ]),
    ('process', ['dist/tests/multiprocess.test.js']),
    ('repository', ['dist/tests/repository-change.test.js']),
    ('wasm', ['dist/tests/wasm-capability-runner.test.js','dist/tests/wasm-isolation.test.js']),
    ('linux', ['dist/tests/linux-isolation.test.js']),
    ('web', ['dist/tests/web-server.test.js','dist/tests/web-workflow.test.js']),
]

def count(text: str, label: str) -> int:
    match = re.findall(rf'^# {re.escape(label)} (\d+)$', text, re.MULTILINE)
    return int(match[-1]) if match else 0

def kill_group(process: subprocess.Popen[str]) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        try: os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        process.wait(timeout=3)

records: list[dict[str, object]] = []
for name, files in batches:
    command = [sys.executable] if False else [process_exec := os.environ.get('NODE_BINARY', 'node')]
    command += ['--test','--test-concurrency=1','--test-force-exit',*files]
    log = OUT / f'{name}.log'
    with log.open('w', encoding='utf-8') as stream:
        process = subprocess.Popen(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT, text=True, start_new_session=True)
        timed_out = False
        completed_summary = False
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            return_code = process.poll()
            stream.flush()
            current = log.read_text(encoding='utf-8', errors='replace') if log.exists() else ''
            tests_now, passed_now, failed_now = count(current,'tests'), count(current,'pass'), count(current,'fail')
            if tests_now > 0 and tests_now == passed_now and failed_now == 0:
                completed_summary = True
                if return_code is None:
                    time.sleep(0.2)
                    kill_group(process)
                break
            if return_code is not None:
                break
            time.sleep(0.1)
        else:
            timed_out = True
            kill_group(process)
        if process.poll() is None: kill_group(process)
    output = log.read_text(encoding='utf-8', errors='replace')
    tests, passed, failed = count(output,'tests'), count(output,'pass'), count(output,'fail')
    complete_pass = tests > 0 and tests == passed and failed == 0
    status = 'passed' if complete_pass and not timed_out and process.returncode == 0 else 'passed-with-forced-cleanup' if complete_pass else 'failed'
    record = {'batch':name,'tests':tests,'passed':passed,'failed':failed,'runnerExitCode':process.returncode,'timedOut':timed_out,'status':status,'path':str(log.relative_to(ROOT))}
    records.append(record)
    print(json.dumps(record), flush=True)
    if status == 'failed':
        print(output[-8000:], file=sys.stderr)
        break

report = {
    'status':'passed' if len(records)==len(batches) and all(r['failed']==0 and r['tests']==r['passed'] for r in records) else 'failed',
    'runner':'six process-group-supervised serial batches',
    'batches':records,
    'totals':{'tests':sum(int(r['tests']) for r in records),'passed':sum(int(r['passed']) for r in records),'failed':sum(int(r['failed']) for r in records)},
    'forcedCleanupBatches':[r['batch'] for r in records if r['status']=='passed-with-forced-cleanup'],
    'reason':'Each lane runs in a new process group. A complete all-pass TAP result is required; descendants holding pipes are terminated and recorded instead of stalling later lanes.',
}
(ROOT/'evidence/generated/v19-test-results.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report['totals']), flush=True)
raise SystemExit(0 if report['status']=='passed' else 1)
