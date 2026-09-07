#!/usr/bin/env python3
from __future__ import annotations
import json, os, re, signal, statistics, subprocess, time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'evidence/generated'
OUT.mkdir(parents=True, exist_ok=True)


def utc() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def count_tap(text: str, label: str) -> int:
    matches = re.findall(rf'^# {re.escape(label)} (\d+)$', text, re.M)
    return int(matches[-1]) if matches else 0


def test_inventory() -> tuple[list[str], list[str], list[str]]:
    source = sorted(path.stem.removesuffix('.test') for path in (ROOT / 'tests').glob('*.test.ts'))
    compiled = sorted(path.stem.removesuffix('.test') for path in (ROOT / 'dist/tests').glob('*.test.js'))
    missing = sorted(set(source) - set(compiled))
    extra = sorted(set(compiled) - set(source))
    if missing or extra:
        raise RuntimeError(f'test_inventory_mismatch:missing={missing}:extra={extra}')
    return source, missing, extra


def terminate_group(process: subprocess.Popen[object]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        return
    process.wait(timeout=5)


def run_once(index: int, files: list[str]) -> dict:
    log = OUT / f'v32-stability-run-{index}.tap.log'
    started_at = utc()
    started = time.perf_counter()
    cmd = ['node', '--test', '--test-concurrency=4', '--test-reporter=tap', *files]
    timed_out = False
    process: subprocess.Popen[object] | None = None
    with log.open('w', encoding='utf-8') as stream:
        process = subprocess.Popen(
            cmd,
            cwd=ROOT,
            env={**os.environ, 'NODE_ENV': 'test', 'NODE_OPTIONS': '', 'V32_STABILITY_ITERATION': str(index)},
            stdout=stream,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            process.wait(timeout=300)
        except subprocess.TimeoutExpired:
            timed_out = True
            terminate_group(process)
    assert process is not None
    text = log.read_text(encoding='utf-8', errors='replace')
    tests = count_tap(text, 'tests')
    passed = count_tap(text, 'pass')
    failed = count_tap(text, 'fail')
    status = 'passed' if process.returncode == 0 and not timed_out and tests == passed and failed == 0 and tests > 0 else 'failed'
    return {
        'iteration': index,
        'status': status,
        'startedAt': started_at,
        'exitCode': process.returncode,
        'timedOut': timed_out,
        'durationMs': round((time.perf_counter() - started) * 1000, 3),
        'testWallMs': round((time.perf_counter() - started) * 1000, 3),
        'tests': tests,
        'passed': passed,
        'failed': failed,
        'log': str(log.relative_to(ROOT)),
        'logSha256': __import__('hashlib').sha256(log.read_bytes()).hexdigest(),
    }


def main() -> int:
    source, missing, extra = test_inventory()
    files = [f'dist/tests/{name}.test.js' for name in source]
    started_at = utc()
    warmup = run_once(0, files)
    print(json.dumps({'warmup': True, 'status': warmup['status'], 'tests': warmup['tests'], 'failed': warmup['failed'], 'wallMs': warmup['testWallMs']}, indent=2), flush=True)
    runs: list[dict] = []
    if warmup['status'] == 'passed':
        for index in range(1, 4):
            run = run_once(index, files)
            runs.append(run)
            print(json.dumps({'iteration': index, 'status': run['status'], 'tests': run['tests'], 'failed': run['failed'], 'wallMs': run['testWallMs']}, indent=2), flush=True)
            if run['status'] != 'passed':
                break
    walls = [float(run['testWallMs']) for run in runs if isinstance(run.get('testWallMs'), (int, float))]
    mean = statistics.fmean(walls) if walls else 0.0
    std = statistics.pstdev(walls) if len(walls) > 1 else 0.0
    passed = (
        warmup['status'] == 'passed'
        and len(runs) == 3
        and all(run['status'] == 'passed' and run['tests'] >= 654 and run['failed'] == 0 for run in runs)
        and len({run['tests'] for run in runs}) == 1
    )
    report = {
        'version': '32.5',
        'ownerRole': 'Flakiness and Stability Investigator',
        'status': 'passed' if passed else 'failed',
        'startedAt': started_at,
        'inventory': {'sourceTestFiles': len(source), 'compiledTestFiles': len(source), 'missing': missing, 'extra': extra},
        'warmup': warmup,
        'runs': runs,
        'statistics': {
            'medianWallMs': round(statistics.median(walls), 3) if walls else None,
            'meanWallMs': round(mean, 3) if walls else None,
            'minWallMs': round(min(walls), 3) if walls else None,
            'maxWallMs': round(max(walls), 3) if walls else None,
            'coefficientOfVariation': round(std / mean, 4) if mean else None,
        },
        'flakeCount': sum(run['status'] != 'passed' for run in runs),
        'forceExitDisabled': True,
        'sharedResultFileEliminated': True,
        'limitations': [
            'One unscored warm-up plus three measured local executions reduces cold-cache distortion but does not establish long-term flake probability across operating systems and hardware.',
            'The stability harness executes Node TAP directly to avoid nested-runner handle leaks and shared-result races.',
        ],
    }
    (OUT / 'V32_STABILITY_REPORT.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': report['status'], 'runs': [{'tests': r['tests'], 'failed': r['failed'], 'wallMs': r['testWallMs']} for r in runs], 'statistics': report['statistics']}, indent=2))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
