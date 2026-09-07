#!/usr/bin/env python3
from __future__ import annotations
import json, os, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'release-evidence/v33.41'
OUT.mkdir(parents=True, exist_ok=True)
checks: list[dict] = []

def add(name, ok, detail):
    checks.append({'name': name, 'status': 'passed' if ok else 'failed', 'detail': detail})

def load(rel):
    return json.loads((ROOT / rel).read_text(encoding='utf-8'))

def require(rel):
    ok = (ROOT / rel).is_file()
    add(f'file:{rel}', ok, 'present' if ok else 'missing')
    return ok

required = [
    'src/app/external-provider-onboarding-conformance-v33_41.ts',
    'tests/external-provider-onboarding-conformance-v33_41.test.ts',
    'scripts/external-provider-onboarding-conformance-proof-v33_41.mjs',
    'scripts/verify-external-provider-onboarding-conformance-v33_41.mjs',
    'scripts/run-focused-tests-v33_41.mjs',
    'scripts/run-full-regression-v33_41.py',
    'scripts/run-direct-v33-regression-v33_41.py',
    'scripts/repository-truth-map-v33_41.mjs',
    'scripts/architecture-validation-v33_41.mjs',
    'scripts/validate-v33_41.py',
    'docs/V33_41_EXTERNAL_PROVIDER_ONBOARDING_CONFORMANCE.md',
    'CLAUDE_HANDOFF_v33_41.md',
    'V33_41_עדכון_ביצוע_והוכחות.md',
    'pilot-kits/v33.41/provider-onboarding-conformance/manifest.json',
    'pilot-kits/v33.41/provider-onboarding-conformance/RUNBOOK.md',
    'pilot-kits/v33.41/provider-onboarding-conformance/EXTERNAL_EXECUTION_CHECKLIST.md',
    'pilot-kits/v33.41/provider-onboarding-conformance/TRUST_ROOT_REGISTRATION_TEMPLATE.json',
    'pilot-kits/v33.41/provider-onboarding-conformance/CONFORMANCE_SESSION_TEMPLATE.json',
    'release-evidence/v33.41/V33_41_PROVIDER_ONBOARDING_CONFORMANCE_PROOF.json',
    'release-evidence/v33.41/V33_41_INDEPENDENT_VERIFICATION.json',
    'release-evidence/v33.41/V33_41_FOCUSED_TEST_RECEIPT.json',
    'release-evidence/v33.41/V33_41_FULL_TEST_RESULTS.json',
    'release-evidence/v33.41/V33_41_FULL_TEST_META.json',
    'release-evidence/v33.41/V33_41_DIRECT_V33_RESULTS.json',
    'release-evidence/v33.41/V33_41_REPOSITORY_TRUTH_MAP.json',
    'release-evidence/v33.41/V33_41_ARCHITECTURE_INTEGRITY.json',
]
for rel in required:
    require(rel)

try:
    result = subprocess.run(
        ['node', 'scripts/verify-external-provider-onboarding-conformance-v33_41.mjs'],
        cwd=ROOT, text=True, capture_output=True, timeout=300,
        env={**os.environ, 'TERM': 'dumb'},
    )
    add('independent-proof-verifier', result.returncode == 0,
        result.stdout.strip() if result.returncode == 0 else (result.stderr.strip() or result.stdout.strip()))
except Exception as exc:
    add('independent-proof-verifier', False, str(exc))

focused = OUT / 'V33_41_FOCUSED_TEST_RECEIPT.json'
if focused.is_file():
    x = load('release-evidence/v33.41/V33_41_FOCUSED_TEST_RECEIPT.json'); t = x.get('totals', {})
    add('focused-regression',
        x.get('status') == 'passed' and x.get('testFiles') == 12 and
        t.get('tests') == 415 and t.get('passed') == 415 and t.get('failed') == 0 and
        x.get('retry') is False and x.get('forceExitDisabled') is True, t)

full = OUT / 'V33_41_FULL_TEST_RESULTS.json'
if full.is_file():
    x = load('release-evidence/v33.41/V33_41_FULL_TEST_RESULTS.json'); t = x.get('totals', {})
    add('full-regression',
        x.get('status') == 'passed' and t.get('testFiles') == 226 and
        t.get('tests') == 2240 and t.get('passed') == 2240 and t.get('failed') == 0 and
        x.get('retry') is False and x.get('forceExitDisabled') is True, t)

meta = OUT / 'V33_41_FULL_TEST_META.json'
if meta.is_file():
    x = load('release-evidence/v33.41/V33_41_FULL_TEST_META.json'); rows = x.get('files', [])
    bd = x.get('buildDigest'); rd = x.get('runInputDigest')
    add('regression-input-binding',
        x.get('exitCode') == 0 and x.get('timedOut') is False and len(rows) == 226 and
        isinstance(bd, str) and len(bd) == 64 and isinstance(rd, str) and len(rd) == 64 and
        all(r.get('buildDigest') == bd and r.get('runInputDigest') == rd for r in rows),
        {'buildDigest': bd, 'runInputDigest': rd, 'receiptCount': len(rows)})

direct = OUT / 'V33_41_DIRECT_V33_RESULTS.json'
if direct.is_file():
    x = load('release-evidence/v33.41/V33_41_DIRECT_V33_RESULTS.json'); t = x.get('totals', {})
    add('direct-v33-regression',
        x.get('status') == 'passed' and t.get('testFiles') == 41 and
        t.get('tests') == 1073 and t.get('passed') == 1073 and t.get('failed') == 0 and
        x.get('retry') is False, t)

proof_path = OUT / 'V33_41_PROVIDER_ONBOARDING_CONFORMANCE_PROOF.json'
if proof_path.is_file():
    p = load('release-evidence/v33.41/V33_41_PROVIDER_ONBOARDING_CONFORMANCE_PROOF.json')
    boundary = p.get('truthBoundary', {}); summary = p.get('summary', {}); final = p.get('finalVerdict', {})
    add('proof-boundary',
        boundary.get('executionClass') == 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL' and
        boundary.get('externalTrustRootsObserved') is False and
        boundary.get('externalHardwareSessionsObserved') is False and
        boundary.get('publicCheckpointObserved') is False and
        boundary.get('externalRoleOwnersObserved') == 0 and
        boundary.get('externalHumanParticipants') == 0 and
        boundary.get('productionAuthority') == 'NONE' and boundary.get('externalEffectsExecuted') == 0 and
        boundary.get('g3') == 'blocked' and boundary.get('productionPromotion') == 'blocked', boundary)
    add('proof-summary',
        summary.get('providerCount') == 4 and summary.get('trustRootCount') == 4 and
        summary.get('conformanceReceiptCount') == 4 and summary.get('verifiedSignatureCount') == 26 and
        summary.get('newSignatureCount') == 20 and summary.get('monitorReceiptCount') == 3, summary)
    attacks = p.get('attacks', {})
    add('proof-attacks', len(attacks) == 6 and all(attacks.values()), attacks)
    add('proof-final-verdict',
        final.get('status') == 'LOCAL_PROVIDER_ONBOARDING_CONFORMANCE_REHEARSAL_ONLY' and
        final.get('trustRootCount') == 4 and final.get('conformanceReceiptCount') == 4 and
        final.get('monitorReceiptCount') == 3 and final.get('externalTrustRootsObserved') is False and
        final.get('externalHardwareSessionsObserved') is False and final.get('publicCheckpointObserved') is False and
        final.get('externalHumanParticipants') == 0 and final.get('productionAuthority') == 'NONE' and
        final.get('externalEffectsExecuted') == 0, final)

verification_path = OUT / 'V33_41_INDEPENDENT_VERIFICATION.json'
if verification_path.is_file():
    x = load('release-evidence/v33.41/V33_41_INDEPENDENT_VERIFICATION.json')
    add('independent-verification',
        x.get('status') == 'PASS' and x.get('signatureCount') == 26 and x.get('newSignatureCount') == 20 and
        x.get('providerCount') == 4 and
        x.get('finalStatus') == 'LOCAL_PROVIDER_ONBOARDING_CONFORMANCE_REHEARSAL_ONLY' and
        x.get('externalTrustRootsObserved') is False and x.get('externalHardwareSessionsObserved') is False and
        x.get('publicCheckpointObserved') is False and x.get('externalHumanParticipants') == 0 and
        x.get('productionAuthority') == 'NONE' and all(x.get('checks', {}).values()), x)

truth_path = OUT / 'V33_41_REPOSITORY_TRUTH_MAP.json'
if truth_path.is_file():
    x = load('release-evidence/v33.41/V33_41_REPOSITORY_TRUTH_MAP.json'); inv = x.get('inventory', {})
    add('repository-truth-map',
        x.get('status') == 'passed' and inv.get('sourceModules') == 230 and inv.get('testFiles') == 226 and
        x.get('findings') == [] and x.get('boundaries', {}).get('productionPromotion') == 'blocked', inv)

arch_path = OUT / 'V33_41_ARCHITECTURE_INTEGRITY.json'
if arch_path.is_file():
    x = load('release-evidence/v33.41/V33_41_ARCHITECTURE_INTEGRITY.json'); m = x.get('metrics', {})
    add('architecture-integrity',
        x.get('status') == 'PASS' and m.get('sourceCycleCount') == 0 and m.get('untestedSourceCount') == 0 and
        m.get('capabilityPathCount') == m.get('closedCapabilityPathCount') and
        m.get('capabilityPathCount') == 166 and x.get('findings') == [], m)

states = []
for base in ['governance-state', 'v33/governance-state']:
    for path in sorted((ROOT / base).glob('*.json')):
        states.append((str(path.relative_to(ROOT)), json.loads(path.read_text()).get('version')))
add('canonical-governance-version', all(v == '33.41' for _, v in states), states)

state = load('governance-state/PROGRAM_STATE.json')
action = load('governance-state/NEXT_ACTION.json')
decisions = load('governance-state/OPEN_DECISIONS.json')
add('canonical-boundary',
    state.get('phase') == 'External Provider Onboarding, Conformance and Safe Replacement' and
    state.get('status') == 'v33.41-local-provider-onboarding-conformance-rehearsal-production-blocked' and
    state.get('executionBoundary', {}).get('externalMutation') == 'not-authorized' and
    state.get('executionBoundary', {}).get('productionPromotion') == 'blocked',
    {'phase': state.get('phase'), 'status': state.get('status')})

forbidden = ' | '.join(action.get('forbiddenActions', [])).lower()
required_forbidden = [
    'production promotion', 'external mutation', 'exporting private key material',
    'self-attesting', 'replacing a provider before effective revocation', 'three-of-five',
    'five-provider', 'relabeling local provider onboarding rehearsal',
    'external human participant', 'untrusted repository host execution',
]
add('next-action-boundary',
    action.get('qualificationTargetVersion') == '33.41' and all(token in forbidden for token in required_forbidden),
    action.get('actionId'))

ids = {d.get('id'): d.get('status') for d in decisions.get('decisions', [])}
needed = [
    'OD33.41-TRUST-ROOTS', 'OD33.41-CONFORMANCE-LABS', 'OD33.41-REVOCATION-SLO',
    'OD33.41-PROVIDER-REPLACEMENT', 'OD33.41-PUBLIC-CHECKPOINT-RECOVERY',
]
add('external-decisions-open', all(ids.get(i) == 'open-external' for i in needed), {i: ids.get(i) for i in needed})

status = 'passed' if all(c['status'] == 'passed' for c in checks) else 'failed'
report = {
    'version': '33.41',
    'generatedAt': datetime.now(timezone.utc).isoformat(),
    'status': status,
    'checks': checks,
    'summary': {
        'total': len(checks),
        'passed': sum(c['status'] == 'passed' for c in checks),
        'failed': sum(c['status'] == 'failed' for c in checks),
    },
    'truthBoundary': {
        'externalTrustRootsObserved': False,
        'externalHardwareSessionsObserved': False,
        'publicCheckpointObserved': False,
        'externalRoleOwnersObserved': 0,
        'externalHumanParticipants': 0,
        'productionAuthority': 'NONE',
        'externalEffectsExecuted': 0,
        'productionPromotion': 'blocked',
    },
}
(OUT / 'V33_41_FINAL_VALIDATION.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
print(json.dumps(report['summary'] | {'status': status}, indent=2))
sys.exit(0 if status == 'passed' else 1)
