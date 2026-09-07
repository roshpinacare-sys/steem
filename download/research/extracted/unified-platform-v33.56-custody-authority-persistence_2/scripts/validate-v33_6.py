#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
    'CLAUDE_HANDOFF_v33_6.md',
    'src/product/chat-mission.ts',
    'src/product/mission-conversation-v33_2.ts',
    'src/product/device-push-v33_3.ts',
    'src/product/reliable-push-v33_4.ts',
    'src/product/push-adapter-qualification-v33_5.ts',
    'src/product/human-pilot-readiness-v33_6.ts',
    'src/web/pwa-approval-server-v33_6.ts',
    'tests/human-pilot-readiness-v33_6.test.ts',
    'web-v33_6/index.html',
    'web-v33_6/styles.css',
    'web-v33_6/app.js',
    'web-v33_6/manifest.webmanifest',
    'web-v33_6/sw.js',
    'web-v33_6/icon-192.png',
    'web-v33_6/icon-512.png',
    'scripts/human-pilot-readiness-proof-v33_6.mjs',
    'scripts/serve-human-pilot-v33_6.mjs',
    'scripts/architecture-validation-v32.mjs',
    'scripts/validate-v33_6.py',
    'docs/V33_6_HUMAN_PILOT_READINESS_AND_EXTERNAL_PROVIDER_KIT.md',
    'v33/governance-state/CONTRACT_REGISTRY_V33.json',
    'v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json',
    'v33/governance-state/PROOF_GATE_REGISTRY_V33.json',
    'release-evidence/v33.6/V33_6_HUMAN_PILOT_READINESS_PROOF.json',
    'release-evidence/v33.6/V33_6_FULL_TEST_RESULTS.json',
    'release-evidence/v33.6/V33_6_REPOSITORY_TRUTH_MAP.json',
    'release-evidence/v33.6/V33_6_ARCHITECTURE_INTEGRITY.json',
    'release-evidence/v33.6/V33_6_ARCHITECTURE_CAPABILITY_EXPANSION.json',
    'release-evidence/v33.6/V33_6_EXECUTION_LEDGER.md',
    'release-evidence/v33.6/V33_6_RELEASE_MANIFEST.json',
    'evidence/v33.6-regression.cmd.json',
    'evidence/v33.6-regression.stdout',
    'evidence/v33.6-regression.stderr',
    'evidence/v33.6-regression.exit',
    'evidence/v33.6-regression.meta.json',
]
errors: list[str] = []


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(rel: str) -> dict:
    try:
        return json.loads((ROOT / rel).read_text())
    except Exception as exc:
        errors.append(f'invalid_json:{rel}:{exc}')
        return {}


def run_checked(command: list[str], label: str) -> None:
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        errors.append(f'{label}_failed:' + result.stdout[-3000:] + result.stderr[-3000:])


for rel in REQUIRED:
    path = ROOT / rel
    allow_empty = rel == 'evidence/v33.6-regression.stderr'
    if not path.is_file() or (path.stat().st_size == 0 and not allow_empty):
        errors.append(f'missing_or_empty:{rel}')

contracts = load('v33/governance-state/CONTRACT_REGISTRY_V33.json')
capabilities = load('v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json')
gates = load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json')
proof = load('release-evidence/v33.6/V33_6_HUMAN_PILOT_READINESS_PROOF.json')
full_tests = load('release-evidence/v33.6/V33_6_FULL_TEST_RESULTS.json')
truth = load('release-evidence/v33.6/V33_6_REPOSITORY_TRUTH_MAP.json')
architecture = load('release-evidence/v33.6/V33_6_ARCHITECTURE_INTEGRITY.json')
expansion = load('release-evidence/v33.6/V33_6_ARCHITECTURE_CAPABILITY_EXPANSION.json')
release_manifest = load('release-evidence/v33.6/V33_6_RELEASE_MANIFEST.json')

if contracts.get('version') != '33.6':
    errors.append('contract_registry_version_invalid')
contract_ids = {row.get('id') for row in contracts.get('contracts', [])}
for contract_id in {
    'pilot-session-grant-v33.6',
    'pilot-session-revocation-v33.6',
    'pilot-telemetry-event-v33.6',
    'human-pilot-observation-v33.6',
    'human-pilot-readiness-evidence-v33.6',
    'pwa-structural-audit-v33.6',
    'external-provider-qualification-kit-v33.6',
}:
    if contract_id not in contract_ids:
        errors.append(f'v33_6_contract_missing:{contract_id}')

if capabilities.get('version') != '33.6':
    errors.append('capability_map_version_invalid')
operator = next((row for row in capabilities.get('layers', []) if row.get('layer') == 'operator-plane'), {})
for capability in {
    'local-installable-pwa-approval-client',
    'device-bound-short-lived-pilot-session',
    'active-pilot-session-revocation',
    'independent-human-observation-verification',
    'digest-chained-pilot-telemetry',
    'static-pwa-accessibility-audit',
    'apns-fcm-qualification-plan',
    'secret-reference-only-provider-boundary',
}:
    if capability not in operator.get('capabilities', []):
        errors.append(f'operator_capability_missing:{capability}')
expected_authority = 'none; local signed simulation, loopback HTTP qualification and human-pilot readiness only; browser intent is not a canonical decision'
if operator.get('productionAuthority') != expected_authority:
    errors.append('operator_plane_authority_expanded')

if gates.get('version') != '33.6':
    errors.append('proof_gate_registry_version_invalid')
for gate_id, expected in [('G0', 'passed'), ('G1', 'passed'), ('G2', 'not-started'), ('G3', 'in-progress')]:
    gate = next((row for row in gates.get('gates', []) if row.get('id') == gate_id), {})
    if gate.get('status') != expected:
        errors.append(f'{gate_id.lower()}_status_invalid')
g3 = next((row for row in gates.get('gates', []) if row.get('id') == 'G3'), {})
if g3.get('prototypeStatus') != 'installable-local-pwa-and-independent-human-evidence-gate-ready-not-human-or-external-provider-qualified':
    errors.append('g3_prototype_status_invalid')

if proof.get('status') != 'passed':
    errors.append('v33_6_proof_not_passed')
for key in [
    'localPwaRoundTrip', 'pwaStructuralAuditPassed', 'pwaAuditDoesNotClaimHumanAccessibility',
    'selfHumanClaimBlocked', 'csrfBlocked', 'noCanonicalDecision', 'telemetryChainValid',
    'simulatedStepReductionAtLeast70', 'simulatedMedianApprovalsAtMostOne',
    'simulatedCannotPassG3', 'deviceLossRevokesSessions', 'externalProviderKitPrepared',
    'externalProviderNetworkNotExecuted', 'productionBlocked',
]:
    if proof.get('assertions', {}).get(key) is not True:
        errors.append(f'v33_6_assertion_failed:{key}')
if proof.get('pwaAudit', {}).get('evidenceClass') != 'STATIC_STRUCTURAL_AUDIT':
    errors.append('pwa_audit_class_invalid')
if proof.get('pwaAudit', {}).get('humanAccessibilityValidated') is not False:
    errors.append('pwa_audit_false_human_claim')
if proof.get('pwaAudit', {}).get('checks', {}).get('manifestIcons') is not True:
    errors.append('pwa_installability_icon_check_failed')
readiness = proof.get('simulatedReadiness', {})
if readiness.get('humanParticipants') != 0 or readiness.get('g3Eligible') is not False:
    errors.append('simulated_readiness_improperly_promoted')
if readiness.get('stepReductionPct', 0) < 70 or readiness.get('medianApprovals', 99) > 1:
    errors.append('simulated_user_flow_target_not_met')
if proof.get('externalProviderKit', {}).get('externalQualification') != 'not_executed':
    errors.append('external_provider_qualification_misstated')
if any(plan.get('liveCredentialsPresent') or plan.get('externalNetworkExecuted') for plan in proof.get('externalProviderKit', {}).get('providers', [])):
    errors.append('live_provider_boundary_violated')
if proof.get('productionPromotion') != 'blocked':
    errors.append('proof_promotes_production')

if full_tests.get('status') != 'passed':
    errors.append('full_regression_not_passed')
totals = full_tests.get('totals', {})
if totals.get('tests') != 1273 or totals.get('passed') != 1273 or totals.get('failed') != 0:
    errors.append('full_regression_totals_invalid')
if totals.get('testFiles') != 191:
    errors.append('full_regression_file_count_invalid')
if full_tests.get('runnerExitCode') != 0 or full_tests.get('timedOut') is not False or full_tests.get('forceExitDisabled') is not True:
    errors.append('full_regression_runner_invalid')
if full_tests.get('inventory', {}).get('missing') != [] or full_tests.get('inventory', {}).get('extra') != []:
    errors.append('full_regression_inventory_mismatch')
stdout_path = ROOT / full_tests.get('stdoutEvidence', '')
stderr_path = ROOT / full_tests.get('stderrEvidence', '')
exit_path = ROOT / full_tests.get('exitEvidence', '')
meta_path = ROOT / full_tests.get('metaEvidence', '')
if not stdout_path.is_file() or sha256(stdout_path) != full_tests.get('stdoutSha256'):
    errors.append('full_regression_stdout_digest_invalid')
else:
    text = stdout_path.read_text(errors='replace')
    for marker in ['# tests 1273', '# pass 1273', '# fail 0']:
        if marker not in text:
            errors.append(f'full_regression_log_marker_missing:{marker}')
if not stderr_path.is_file() or sha256(stderr_path) != full_tests.get('stderrSha256'):
    errors.append('full_regression_stderr_digest_invalid')
if not exit_path.is_file() or exit_path.read_text().strip() != '0':
    errors.append('full_regression_exit_receipt_invalid')
if meta_path.is_file():
    meta = load(full_tests.get('metaEvidence', ''))
    if meta.get('exitCode') != 0 or meta.get('stdoutSha256') != full_tests.get('stdoutSha256'):
        errors.append('full_regression_meta_invalid')
else:
    errors.append('full_regression_meta_missing')

if truth.get('status') != 'passed' or truth.get('findings') != []:
    errors.append('repository_truth_map_failed')
if truth.get('boundaries', {}).get('productionPromotion') != 'blocked':
    errors.append('repository_truth_map_promotes_production')
if truth.get('inventory', {}).get('sourceModules') != 192 or truth.get('inventory', {}).get('testFiles') != 191:
    errors.append('repository_truth_inventory_invalid')

metrics = architecture.get('metrics', {})
if architecture.get('status') != 'PASS' or architecture.get('findings') != []:
    errors.append('architecture_integrity_failed')
if metrics.get('sourceCycleCount') != 0 or metrics.get('untestedSourceCount') != 0:
    errors.append('architecture_closure_invalid')
if metrics.get('capabilityPathCount') != 107 or metrics.get('closedCapabilityPathCount') != 107:
    errors.append('architecture_capability_path_count_invalid')
expected_v33_paths = {
    'chat-mission-compilation-and-approval-v33.1',
    'mission-continuity-and-approval-inbox-v33.2',
    'device-bound-push-decision-v33.3',
    'transport-neutral-reliable-push-v33.4',
    'local-http-push-adapter-qualification-v33.5',
    'human-pilot-session-and-independent-observation-v33.6',
    'local-pwa-approval-pilot-v33.6',
    'external-push-provider-qualification-kit-v33.6',
}
closure_ids = {row.get('capabilityId') for row in architecture.get('capabilityClosure', [])}
script_text = (ROOT / 'scripts/architecture-validation-v32.mjs').read_text()
for capability_id in expected_v33_paths:
    if capability_id not in closure_ids:
        errors.append(f'architecture_path_missing:{capability_id}')
    if capability_id not in script_text:
        errors.append(f'architecture_generator_path_missing:{capability_id}')

if expansion.get('status') != 'expanded-and-reproducible':
    errors.append('architecture_expansion_status_invalid')
if expansion.get('baseline', {}).get('capabilityPathCount') != 104:
    errors.append('architecture_expansion_baseline_invalid')
if expansion.get('current', {}).get('capabilityPathCount') != 107:
    errors.append('architecture_expansion_current_invalid')
expected_added = {
    'human-pilot-session-and-independent-observation-v33.6',
    'local-pwa-approval-pilot-v33.6',
    'external-push-provider-qualification-kit-v33.6',
}
if set(expansion.get('current', {}).get('addedPaths', [])) != expected_added:
    errors.append('architecture_expansion_added_paths_invalid')
for key in ['allAddedPathsHaveSource', 'allAddedPathsHaveTests', 'generatorContainsAllPaths', 'staleEvidenceCannotPassValidator']:
    if expansion.get('invariants', {}).get(key) is not True:
        errors.append(f'architecture_expansion_invariant_failed:{key}')
if expansion.get('productionPromotion') != 'blocked':
    errors.append('architecture_expansion_promotes_production')

# Recreate maps from packaged source. A stale green artifact cannot satisfy this validator.
if not errors:
    run_checked(['npm', 'run', 'truth-map:v32.18'], 'regenerated_truth_map')
    run_checked(['npm', 'run', 'architecture:v32'], 'regenerated_architecture')
if not errors:
    regenerated_truth = load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json')
    regenerated_architecture = load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
    if regenerated_truth.get('inventory') != truth.get('inventory') or regenerated_truth.get('findings') != truth.get('findings'):
        errors.append('regenerated_truth_mismatch')
    regenerated_metrics = regenerated_architecture.get('metrics', {})
    for key in ['sourceCycleCount', 'untestedSourceCount', 'capabilityPathCount', 'closedCapabilityPathCount']:
        if regenerated_metrics.get(key) != metrics.get(key):
            errors.append(f'regenerated_architecture_metric_mismatch:{key}')
    if regenerated_architecture.get('graphDigest') != architecture.get('graphDigest'):
        errors.append('regenerated_architecture_graph_digest_mismatch')

if release_manifest.get('version') != '33.6' or release_manifest.get('status') != 'release-candidate-shadow-only':
    errors.append('release_manifest_status_invalid')
if release_manifest.get('productionPromotion') != 'blocked' or release_manifest.get('externalQualification') != 'not_executed':
    errors.append('release_manifest_boundary_invalid')
for entry in release_manifest.get('files', []):
    relpath = entry.get('path', '')
    path = ROOT / relpath
    if not path.is_file():
        errors.append(f'release_manifest_missing:{relpath}')
    elif sha256(path) != entry.get('sha256') or path.stat().st_size != entry.get('sizeBytes'):
        errors.append(f'release_manifest_integrity_invalid:{relpath}')

if not errors:
    direct = subprocess.run([
        'node', '--test',
        'dist/tests/chat-mission-v33_1.test.js',
        'dist/tests/mission-conversation-v33_2.test.js',
        'dist/tests/device-push-v33_3.test.js',
        'dist/tests/reliable-push-v33_4.test.js',
        'dist/tests/push-adapter-qualification-v33_5.test.js',
        'dist/tests/human-pilot-readiness-v33_6.test.js',
    ], cwd=ROOT, capture_output=True, text=True)
    if direct.returncode != 0:
        errors.append('v33_6_direct_tests_failed:' + direct.stdout[-3000:] + direct.stderr[-3000:])
    else:
        tests = re.search(r'# tests (\d+)', direct.stdout)
        passed = re.search(r'# pass (\d+)', direct.stdout)
        failed = re.search(r'# fail (\d+)', direct.stdout)
        if not tests or not passed or not failed or (int(tests.group(1)), int(passed.group(1)), int(failed.group(1))) != (106, 106, 0):
            errors.append('v33_6_direct_test_count_invalid')

manifest = {rel: sha256(ROOT / rel) for rel in REQUIRED if (ROOT / rel).is_file()}
result = {
    'version': '33.6',
    'status': 'passed' if not errors else 'failed',
    'gates': {'G0': 'passed', 'G1': 'passed', 'G2': 'not-started', 'G3': 'in-progress-not-passed'},
    'prototype': 'installable-local-pwa-device-bound-session-independent-human-observation-gate-and-external-provider-qualification-kit-shadow-only',
    'humanEvidence': {
        'observedParticipants': readiness.get('humanParticipants'),
        'g3Eligible': readiness.get('g3Eligible'),
        'structuralStepReductionPct': readiness.get('stepReductionPct'),
        'medianApprovals': readiness.get('medianApprovals'),
        'accessibilityClass': proof.get('pwaAudit', {}).get('evidenceClass'),
    },
    'regression': {
        'testFiles': totals.get('testFiles'), 'tests': totals.get('tests'), 'passed': totals.get('passed'),
        'failed': totals.get('failed'), 'runnerExitCode': full_tests.get('runnerExitCode'),
        'timedOut': full_tests.get('timedOut'), 'forceExitDisabled': full_tests.get('forceExitDisabled'),
    },
    'architecture': {
        'sourceCycleCount': metrics.get('sourceCycleCount'),
        'untestedSourceCount': metrics.get('untestedSourceCount'),
        'capabilityPathCount': metrics.get('capabilityPathCount'),
        'closedCapabilityPathCount': metrics.get('closedCapabilityPathCount'),
        'v33PathsIncluded': sorted(expected_v33_paths),
    },
    'checkedFiles': REQUIRED,
    'sha256': manifest,
    'errors': errors,
    'productionPromotion': 'blocked',
    'externalQualification': 'not_executed',
}
out = ROOT / 'release-evidence/v33.6/V33_6_VALIDATION.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
sys.exit(0 if not errors else 1)
