#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'release-evidence/v33.36'
checks: list[dict[str, object]] = []


def add(name: str, ok: bool, detail: object) -> None:
    checks.append({'name': name, 'status': 'passed' if ok else 'failed', 'detail': detail})


def load(rel: str) -> dict:
    return json.loads((ROOT / rel).read_text(encoding='utf-8'))


def require(rel: str) -> bool:
    ok = (ROOT / rel).is_file()
    add(f'file:{rel}', ok, 'present' if ok else 'missing')
    return ok


required = [
    'src/app/external-https-monitor-qualification-v33_36.ts',
    'tests/external-https-monitor-qualification-v33_36.test.ts',
    'scripts/external-https-monitor-qualification-proof-v33_36.mjs',
    'scripts/verify-external-https-monitor-qualification-v33_36.mjs',
    'scripts/v33_36-https-publication-server.mjs',
    'scripts/v33_36-monitor-worker.mjs',
    'scripts/run-focused-tests-v33_36.mjs',
    'scripts/run-full-regression-v33_36.py',
    'scripts/run-direct-v33-regression-v33_36.py',
    'scripts/repository-truth-map-v33_36.mjs',
    'scripts/architecture-validation-v33_36.mjs',
    'scripts/validate-v33_36.py',
    'docs/V33_36_EXTERNAL_HTTPS_MONITOR_QUALIFICATION.md',
    'CLAUDE_HANDOFF_v33_36.md',
    'V33_36_עדכון_ביצוע_והוכחות.md',
    'pilot-kits/v33.36/external-https-monitor-qualification/manifest.json',
    'pilot-kits/v33.36/external-https-monitor-qualification/RUNBOOK.md',
    'pilot-kits/v33.36/external-https-monitor-qualification/EXTERNAL_QUALIFICATION_CHECKLIST.md',
    'release-evidence/v33.36/V33_36_HTTPS_MONITOR_QUALIFICATION_PROOF.json',
    'release-evidence/v33.36/V33_36_INDEPENDENT_VERIFICATION.json',
    'release-evidence/v33.36/V33_36_FOCUSED_TEST_RESULTS.json',
    'release-evidence/v33.36/V33_36_FULL_TEST_RESULTS.json',
    'release-evidence/v33.36/V33_36_FULL_TEST_META.json',
    'release-evidence/v33.36/V33_36_DIRECT_V33_RESULTS.json',
    'release-evidence/v33.36/V33_36_REPOSITORY_TRUTH_MAP.json',
    'release-evidence/v33.36/V33_36_ARCHITECTURE_INTEGRITY.json',
]
for rel in required:
    require(rel)

try:
    result = subprocess.run(
        ['node', 'scripts/verify-external-https-monitor-qualification-v33_36.mjs'],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=180,
        env={**os.environ, 'TERM': 'dumb'},
    )
    add(
        'independent-proof-verifier',
        result.returncode == 0,
        result.stdout.strip() if result.returncode == 0 else (result.stderr.strip() or result.stdout.strip()),
    )
except Exception as exc:
    add('independent-proof-verifier', False, str(exc))

if (OUT / 'V33_36_FOCUSED_TEST_RESULTS.json').is_file():
    item = load('release-evidence/v33.36/V33_36_FOCUSED_TEST_RESULTS.json')
    add(
        'focused-regression',
        item.get('status') == 'passed'
        and item.get('testFiles') == 7
        and item.get('totals') == {'tests': 253, 'passed': 253, 'failed': 0}
        and item.get('retry') is False
        and item.get('forceExitDisabled') is True,
        item.get('totals'),
    )

if (OUT / 'V33_36_FULL_TEST_RESULTS.json').is_file():
    item = load('release-evidence/v33.36/V33_36_FULL_TEST_RESULTS.json')
    add(
        'full-regression',
        item.get('status') == 'passed'
        and item.get('totals') == {'testFiles': 221, 'tests': 2078, 'passed': 2078, 'failed': 0}
        and item.get('retry') is False
        and item.get('forceExitDisabled') is True,
        item.get('totals'),
    )

if (OUT / 'V33_36_FULL_TEST_META.json').is_file():
    item = load('release-evidence/v33.36/V33_36_FULL_TEST_META.json')
    files = item.get('files', [])
    build_digest = item.get('buildDigest')
    input_digest = item.get('runInputDigest')
    add(
        'regression-input-binding',
        item.get('exitCode') == 0
        and item.get('timedOut') is False
        and item.get('retry') is False
        and item.get('forceExitDisabled') is True
        and isinstance(build_digest, str) and len(build_digest) == 64
        and isinstance(input_digest, str) and len(input_digest) == 64
        and len(files) == 221
        and all(row.get('buildDigest') == build_digest and row.get('runInputDigest') == input_digest for row in files),
        {'buildDigest': build_digest, 'runInputDigest': input_digest, 'receiptCount': len(files)},
    )

if (OUT / 'V33_36_DIRECT_V33_RESULTS.json').is_file():
    item = load('release-evidence/v33.36/V33_36_DIRECT_V33_RESULTS.json')
    add(
        'direct-v33-regression',
        item.get('status') == 'passed'
        and item.get('totals') == {'testFiles': 36, 'tests': 911, 'passed': 911, 'failed': 0}
        and item.get('retry') is False,
        item.get('totals'),
    )

if (OUT / 'V33_36_HTTPS_MONITOR_QUALIFICATION_PROOF.json').is_file():
    proof = load('release-evidence/v33.36/V33_36_HTTPS_MONITOR_QUALIFICATION_PROOF.json')
    boundary = proof.get('truthBoundary', {})
    summary = proof.get('summary', {})
    execution = proof.get('execution', {})
    add(
        'proof-truth-boundary',
        boundary == {
            'externalTopologyObserved': False,
            'externalHostEvidenceCount': 0,
            'externalTimeSourcesObserved': 0,
            'externalHumanParticipants': 0,
            'productionAuthority': 'NONE',
            'externalEffectsExecuted': 0,
            'productionPromotion': 'blocked',
        },
        boundary,
    )
    add(
        'proof-summary',
        summary == {
            'monitorSetVersionBefore': 1,
            'monitorSetVersionAfter': 2,
            'initialMonitorCount': 3,
            'activeMonitorCount': 3,
            'timeAttestationCount': 3,
            'signatureCount': 14,
        },
        summary,
    )
    add(
        'proof-local-https-execution',
        execution.get('distinctMonitorProcessCount') == 3
        and execution.get('networkFetchObserved') is True
        and execution.get('transport') == 'HTTPS_PINNED_LOCAL'
        and execution.get('tlsProtocol') == 'TLSv1.3'
        and execution.get('durableFsyncObserved') is True
        and execution.get('monitorReplacementObserved') is True
        and execution.get('splitViewDetected') is True,
        execution,
    )

if (OUT / 'V33_36_INDEPENDENT_VERIFICATION.json').is_file():
    item = load('release-evidence/v33.36/V33_36_INDEPENDENT_VERIFICATION.json')
    add(
        'independent-signatures',
        item.get('status') == 'PASS'
        and item.get('signatureCount') == 14
        and item.get('monitorSetVersion') == 2
        and item.get('httpsPinned') is True
        and item.get('durableRetentionVerified') is True
        and item.get('monitorReplacementVerified') is True
        and item.get('networkFetchObserved') is True
        and item.get('externalTopologyObserved') is False
        and item.get('externalHumanParticipants') == 0
        and item.get('productionAuthority') == 'NONE'
        and item.get('productionPromotion') == 'blocked',
        item,
    )

if (OUT / 'V33_36_REPOSITORY_TRUTH_MAP.json').is_file():
    item = load('release-evidence/v33.36/V33_36_REPOSITORY_TRUTH_MAP.json')
    inventory = item.get('inventory', {})
    add(
        'repository-truth-map',
        item.get('status') == 'passed'
        and inventory.get('sourceModules') == 225
        and inventory.get('testFiles') == 221
        and item.get('boundaries', {}).get('productionPromotion') == 'blocked'
        and item.get('findings') == [],
        inventory,
    )

if (OUT / 'V33_36_ARCHITECTURE_INTEGRITY.json').is_file():
    item = load('release-evidence/v33.36/V33_36_ARCHITECTURE_INTEGRITY.json')
    metrics = item.get('metrics', {})
    add(
        'architecture-integrity',
        item.get('status') == 'PASS'
        and metrics.get('sourceCycleCount') == 0
        and metrics.get('untestedSourceCount') == 0
        and metrics.get('capabilityPathCount') == metrics.get('closedCapabilityPathCount') == 161
        and item.get('findings') == [],
        metrics,
    )

states: list[tuple[str, object]] = []
for base in ['governance-state', 'v33/governance-state']:
    for path in sorted((ROOT / base).glob('*.json')):
        states.append((str(path.relative_to(ROOT)), json.loads(path.read_text(encoding='utf-8')).get('version')))
add('canonical-governance-version', all(version == '33.36' for _, version in states), states)

state = load('governance-state/PROGRAM_STATE.json')
next_action = load('governance-state/NEXT_ACTION.json')
decisions = load('governance-state/OPEN_DECISIONS.json')
add(
    'canonical-boundary',
    state.get('readiness') == 'Integrated Pilot'
    and state.get('phase') == 'Pinned HTTPS Monitor Qualification and Partition-Safe Replacement'
    and state.get('status') == 'v33.36-local-pinned-https-monitor-qualification-production-blocked'
    and state.get('executionBoundary', {}).get('externalMutation') == 'not-authorized'
    and state.get('executionBoundary', {}).get('productionPromotion') == 'blocked',
    {'phase': state.get('phase'), 'status': state.get('status'), 'boundary': state.get('executionBoundary')},
)

forbidden = ' | '.join(next_action.get('forbiddenActions', [])).lower()
add(
    'next-action-boundary',
    next_action.get('qualificationTargetVersion') == '33.36'
    and 'production promotion' in forbidden
    and 'external human participant count is zero' in forbidden
    and 'claiming external topology from local https loopback' in forbidden
    and 'fabricating external hosts time sources auditors participants or observations' in forbidden,
    next_action.get('actionId'),
)

ids = {item.get('id'): item.get('status') for item in decisions.get('decisions', [])}
required_decisions = [
    'OD33.36-EXTERNAL-PUBLISHER',
    'OD33.36-TOPOLOGY-AUDITORS',
    'OD33.36-TIME-SOURCES',
    'OD33.36-DURABLE-STORE',
]
add(
    'external-qualification-open-decisions',
    all(item in ids for item in required_decisions),
    {key: value for key, value in ids.items() if str(key).startswith('OD33.36')},
)

gates = load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json')
g3 = next((item for item in gates.get('gates', []) if item.get('id') == 'G3'), {})
add(
    'g3-remains-blocked',
    g3.get('status') == 'in-progress'
    and 'external human participant count remains zero' in g3.get('currentFinding', '')
    and 'No independently administered external host' in g3.get('currentFinding', ''),
    {'status': g3.get('status'), 'finding': g3.get('currentFinding')},
)

kit = load('pilot-kits/v33.36/external-https-monitor-qualification/manifest.json')
add(
    'qualification-kit-boundary',
    kit.get('version') == '33.36'
    and kit.get('minimumMonitorQuorum') == 3
    and kit.get('minimumTimeQuorum') == 2
    and kit.get('minimumTopologyAuditorQuorum') == 2
    and kit.get('productionAuthority') == 'NONE'
    and kit.get('productionPromotion') == 'blocked',
    kit,
)

source = (ROOT / 'src/app/external-https-monitor-qualification-v33_36.ts').read_text(encoding='utf-8')
source_tokens = [
    'verifyHttpsMonitorQualificationV33_36',
    'detectMonitorSplitViewV33_36',
    'LOCAL_HTTPS_MONITOR_REHEARSAL_ONLY',
    'EXTERNAL_MONITOR_QUALIFIED',
    "publication.topology === 'INDEPENDENT_EXTERNAL_ATTESTED'",
    'auditorQuorumVerified',
    'networkFetchObserved: true as const',
    "productionAuthority: 'NONE' as const",
]
for token in source_tokens:
    add(f'qualification-token:{token}', token in source, 'present' if token in source else 'missing')

ok = all(item['status'] == 'passed' for item in checks)
report = {
    'version': '33.36',
    'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
    'status': 'passed' if ok else 'failed',
    'checksPassed': sum(item['status'] == 'passed' for item in checks),
    'checksFailed': sum(item['status'] == 'failed' for item in checks),
    'checks': checks,
    'claims': {
        'focusedTests': 253,
        'fullTests': 2078,
        'directV33Tests': 911,
        'sourceModules': 225,
        'testFiles': 221,
        'capabilityPaths': 161,
        'signatureCount': 14,
        'distinctMonitorProcesses': 3,
        'networkFetchObserved': True,
        'transport': 'HTTPS_PINNED_LOCAL',
        'tlsProtocol': 'TLSv1.3',
        'durableFsyncObserved': True,
        'monitorReplacementObserved': True,
        'splitViewDetected': True,
        'externalHostEvidenceCount': 0,
        'externalTimeSourcesObserved': 0,
        'externalHumanParticipants': 0,
        'externalTopologyObserved': False,
        'productionAuthority': 'NONE',
        'productionPromotion': 'blocked',
    },
}
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'V33_36_VALIDATION.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(json.dumps({
    'status': report['status'],
    'checksPassed': report['checksPassed'],
    'checksFailed': report['checksFailed'],
    'failed': [item for item in checks if item['status'] == 'failed'],
    'claims': report['claims'],
}, indent=2, ensure_ascii=False))
sys.exit(0 if ok else 1)
