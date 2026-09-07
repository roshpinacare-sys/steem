#!/usr/bin/env python3
from __future__ import annotations
import json, os, signal, shutil, subprocess, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_ops_context_v32_6 as ctx

ROOT = ctx.ROOT
OUT = ctx.run_dir()
FABRIC_TEST = 'dist/tests/sovereign-efficiency-fabric-v32_13.test.js'
CONSOLIDATION_TEST = 'dist/tests/sovereign-service-consolidation-v32_13.test.js'
TOPOLOGY_TEST = 'dist/tests/sovereign-topology-optimizer-v32_13.test.js'
CAPACITY_TEST = 'dist/tests/sovereign-capacity-controller-v32_13.test.js'
FABRIC_TARGET = 'dist/src/runtime/sovereign-efficiency-fabric.js'
CONSOLIDATION_TARGET = 'dist/src/platform/sovereign-service-consolidation-v32_13.js'
TOPOLOGY_TARGET = 'dist/src/operations/sovereign-topology-optimizer-v32_13.js'
CAPACITY_TARGET = 'dist/src/operations/sovereign-capacity-controller-v32_13.js'

MUTANTS = [
    (FABRIC_TARGET, FABRIC_TEST, 'cache-tenant-binding-bypass',
     'return entry.tenantId === request.tenantId', 'return true',
     'cache is bound to tenant, policy, authority, source, sensitivity and freshness'),
    (FABRIC_TARGET, FABRIC_TEST, 'cache-authority-binding-bypass',
     '&& entry.authorityDigest === request.authorityDigest', '&& true',
     'cache is bound to tenant, policy, authority, source, sensitivity and freshness'),
    (FABRIC_TARGET, FABRIC_TEST, 'cache-freshness-bypass',
     '&& now.getTime() < Date.parse(entry.expiresAt);', '&& true;',
     'cache is bound to tenant, policy, authority, source, sensitivity and freshness'),
    (FABRIC_TARGET, FABRIC_TEST, 'restricted-semantic-cache-bypass',
     ["if (!request.semanticReuseAllowed || request.sensitivity === 'RESTRICTED')", "semanticTokens: request.semanticReuseAllowed && request.sensitivity !== 'RESTRICTED' ?"],
     ['if (!request.semanticReuseAllowed)', 'semanticTokens: request.semanticReuseAllowed ?'],
     'semantic cache reuses only sufficiently similar non-restricted material inside the exact trust boundary'),
    (FABRIC_TARGET, FABRIC_TEST, 'external-sensitivity-bypass',
     'const sensitivityAllowed = sensitivityRank(request.sensitivity) <= sensitivityRank(policy.maximumExternalSensitivity);',
     'const sensitivityAllowed = true;',
     'router uses the cheapest sovereign route that satisfies quality, latency, sensitivity and cost'),
    (FABRIC_TARGET, FABRIC_TEST, 'external-cost-bypass',
     '&& estimate.externalCostMicros <= policy.maximumExternalCostMicros', '&& true',
     'router uses the cheapest sovereign route that satisfies quality, latency, sensitivity and cost'),
    (FABRIC_TARGET, FABRIC_TEST, 'global-admission-bypass',
     'if (this.#globalActive + units > this.globalUnits)', 'if (false)',
     'admission control provides hard global and tenant isolation with tamper-resistant release'),
    (FABRIC_TARGET, FABRIC_TEST, 'singleflight-equivocation-bypass',
     'if (existing.requestDigest !== requestDigest)', 'if (false)',
     'single-flight executes identical concurrent work once and rejects key equivocation'),
    (TOPOLOGY_TARGET, TOPOLOGY_TEST, 'provider-independence-bypass',
     '&& candidate.providers.length >= requirement.minimumProviders;', '&& true;',
     'optimizer fails closed when provider independence or reserved capacity cannot be met'),
    (TOPOLOGY_TARGET, TOPOLOGY_TEST, 'capacity-reserve-bypass',
     'const reserveFactor = (100 - reservePercent) / 100;', 'const reserveFactor = 1;',
     'optimizer fails closed when provider independence or reserved capacity cannot be met'),
    (CONSOLIDATION_TARGET, CONSOLIDATION_TEST, 'payment-boundary-dishonesty',
     "new Set(['email', 'sms', 'payments', 'global-edge'])", "new Set(['email', 'sms', 'global-edge'])",
     'consolidation eliminates per-user services while preserving honest external and qualification boundaries'),
    (CAPACITY_TARGET, CAPACITY_TEST, 'burst-observation-sovereignty-bypass',
     '.filter((offer) => offer.observed && offer.dataSovereign)', '.filter(() => true)',
     'restricted, disallowed, slow, non-sovereign and over-budget burst choices fail closed'),
    (CAPACITY_TARGET, CAPACITY_TEST, 'burst-sensitivity-bypass',
     '.filter(() => sensitivityRank(snapshot.workloadSensitivity) <= sensitivityRank(policy.maximumBurstSensitivity))', '.filter(() => true)',
     'restricted, disallowed, slow, non-sovereign and over-budget burst choices fail closed'),
    (CAPACITY_TARGET, CAPACITY_TEST, 'burst-budget-bypass',
     'if (cost > policy.maximumBurstHourlyCostMicros)', 'if (false)',
     'restricted, disallowed, slow, non-sovereign and over-budget burst choices fail closed'),
    (CAPACITY_TARGET, CAPACITY_TEST, 'scale-to-zero-bypass',
     'else if (snapshot.idleForMs >= policy.idleScaleToZeroMs)', 'else if (false)',
     'idle capacity scales to zero and paid burst nodes are drained'),
]

def utc() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

def sandbox() -> Path:
    directory = Path(tempfile.mkdtemp(prefix='v32-13-sovereign-mut-'))
    shutil.copytree(ROOT / 'dist', directory / 'dist')
    return directory

def execute(directory: Path, test_path: str, marker: str | None = None, label: str = 'baseline') -> SimpleNamespace:
    tap = directory / f'{label}.tap.log'
    command = ['node', '--test', *([f'--test-name-pattern={marker}'] if marker else []), test_path]
    environment = {**os.environ, 'NODE_ENV': 'test', 'NODE_OPTIONS': ''}
    with tap.open('w') as stream:
        process = subprocess.Popen(command, cwd=directory, stdout=stream, stderr=subprocess.STDOUT,
                                   start_new_session=True, env=environment)
    try:
        return_code = process.wait(timeout=35)
        timed_out = False
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        return_code = process.wait(timeout=3)
    return SimpleNamespace(returncode=return_code, stdout=tap.read_text(errors='replace'), timed_out=timed_out)

directory = sandbox()
records: list[dict] = []
try:
    baselines = [(FABRIC_TEST, 'fabric'), (CONSOLIDATION_TEST, 'consolidation'), (TOPOLOGY_TEST, 'topology'), (CAPACITY_TEST, 'capacity')]
    baseline_runs = [execute(directory, test, label=f'{label}-baseline') for test, label in baselines]
    baseline_ok = all(run.returncode == 0 and not run.timed_out for run in baseline_runs)
    baseline = {
        'status': 'passed' if baseline_ok else 'failed',
        'results': [{'exitCode': run.returncode, 'timedOut': run.timed_out,
                     'outputTail': run.stdout[-1800:]} for run in baseline_runs],
    }
    print(json.dumps({'baseline': baseline['status']}), flush=True)
    if baseline_ok:
        for target, test_path, mutant_id, old, new, marker in MUTANTS:
            path = directory / target
            current = path.read_text()
            olds = old if isinstance(old, list) else [old]
            news = new if isinstance(new, list) else [new]
            match_counts = [current.count(value) for value in olds]
            if len(olds) != len(news) or any(count != 1 for count in match_counts):
                record = {'mutantId': mutant_id, 'target': target, 'status': 'not-created', 'matchCounts': match_counts}
            else:
                mutated = current
                for old_value, new_value in zip(olds, news):
                    mutated = mutated.replace(old_value, new_value, 1)
                path.write_text(mutated)
                run = execute(directory, test_path, marker, mutant_id)
                marker_observed = marker in run.stdout
                if run.timed_out:
                    status = 'invalid-kill'
                elif run.returncode != 0 and marker_observed:
                    status = 'killed-authentic'
                elif run.returncode == 0:
                    status = 'survived'
                else:
                    status = 'invalid-kill'
                record = {
                    'mutantId': mutant_id,
                    'target': target,
                    'status': status,
                    'markerObserved': marker_observed,
                    'exitCode': run.returncode,
                    'timedOut': run.timed_out,
                    'outputTail': run.stdout[-1800:],
                }
                path.write_text(current)
            records.append(record)
            print(json.dumps({'mutantId': mutant_id, 'status': record['status']}), flush=True)
finally:
    shutil.rmtree(directory, ignore_errors=True)

passed = baseline['status'] == 'passed' and len(records) == len(MUTANTS) and all(record['status'] == 'killed-authentic' for record in records)
report = {
    'version': '32.13',
    'runId': OUT.name,
    'generatedAt': utc(),
    'status': 'passed' if passed else 'failed',
    **ctx.execution_identity(),
    'baseline': baseline,
    'mutantsSpecified': len(MUTANTS),
    'mutantsKilledAuthentically': sum(record['status'] == 'killed-authentic' for record in records),
    'survivors': sum(record['status'] == 'survived' for record in records),
    'invalidKills': sum(record['status'] in ('invalid-kill', 'not-created') for record in records),
    'records': records,
}
ctx.atomic_write_json(OUT / 'V32_13_SOVEREIGN_EFFICIENCY_MUTATION_RESULTS.json', report)
print(json.dumps({key: report[key] for key in ('status', 'mutantsSpecified', 'mutantsKilledAuthentically', 'survivors', 'invalidKills')}, indent=2))
raise SystemExit(0 if passed else 1)
