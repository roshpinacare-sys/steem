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
    'CLAUDE_HANDOFF_v33_5.md',
    'src/product/chat-mission.ts',
    'src/product/mission-conversation-v33_2.ts',
    'src/product/device-push-v33_3.ts',
    'src/product/reliable-push-v33_4.ts',
    'src/product/push-adapter-qualification-v33_5.ts',
    'tests/chat-mission-v33_1.test.ts',
    'tests/mission-conversation-v33_2.test.ts',
    'tests/device-push-v33_3.test.ts',
    'tests/reliable-push-v33_4.test.ts',
    'tests/push-adapter-qualification-v33_5.test.ts',
    'scripts/push-adapter-qualification-proof-v33_5.mjs',
    'scripts/architecture-validation-v32.mjs',
    'scripts/validate-v33_5.py',
    'docs/V33_5_PUSH_ADAPTER_QUALIFICATION_AND_MOBILE_SIMULATOR.md',
    'v33/governance-state/CONTRACT_REGISTRY_V33.json',
    'v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json',
    'v33/governance-state/PROOF_GATE_REGISTRY_V33.json',
    'release-evidence/v33.5/V33_5_PUSH_ADAPTER_QUALIFICATION_PROOF.json',
    'release-evidence/v33.5/V33_5_FULL_TEST_RESULTS.json',
    'release-evidence/v33.5/V33_5_REPOSITORY_TRUTH_MAP.json',
    'release-evidence/v33.5/V33_5_ARCHITECTURE_INTEGRITY.json',
    'release-evidence/v33.5/V33_5_ARCHITECTURE_CAPABILITY_EXPANSION.json',
    'release-evidence/v33.5/V33_5_EXECUTION_LEDGER.md',
    'release-evidence/v33.5/V33_5_RELEASE_MANIFEST.json',
    'evidence/v33.5-regression.cmd.json',
    'evidence/v33.5-regression.stdout',
    'evidence/v33.5-regression.stderr',
    'evidence/v33.5-regression.exit',
    'evidence/v33.5-regression.meta.json',
]
errors: list[str] = []
for rel in REQUIRED:
    path = ROOT / rel
    allow_empty = rel == 'evidence/v33.5-regression.stderr'
    if not path.is_file() or (path.stat().st_size == 0 and not allow_empty):
        errors.append(f'missing_or_empty:{rel}')


def load(rel: str) -> dict:
    try:
        return json.loads((ROOT / rel).read_text())
    except Exception as exc:
        errors.append(f'invalid_json:{rel}:{exc}')
        return {}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_checked(command: list[str], label: str) -> None:
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        errors.append(f'{label}_failed:' + result.stdout[-2500:] + result.stderr[-2500:])

contracts = load('v33/governance-state/CONTRACT_REGISTRY_V33.json')
capabilities = load('v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json')
gates = load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json')
proof = load('release-evidence/v33.5/V33_5_PUSH_ADAPTER_QUALIFICATION_PROOF.json')
full_tests = load('release-evidence/v33.5/V33_5_FULL_TEST_RESULTS.json')
truth = load('release-evidence/v33.5/V33_5_REPOSITORY_TRUTH_MAP.json')
architecture = load('release-evidence/v33.5/V33_5_ARCHITECTURE_INTEGRITY.json')
expansion = load('release-evidence/v33.5/V33_5_ARCHITECTURE_CAPABILITY_EXPANSION.json')
release_manifest = load('release-evidence/v33.5/V33_5_RELEASE_MANIFEST.json')

if contracts.get('version') != '33.5':
    errors.append('contract_registry_version_invalid')
contract_ids = {row.get('id') for row in contracts.get('contracts', [])}
required_contracts = {
    'push-adapter-manifest-v33.5',
    'push-webhook-challenge-v33.5',
    'http-push-submission-v33.5',
    'provider-delivery-webhook-v33.5',
    'adapter-qualification-evidence-v33.5',
    'mobile-approval-presentation-v33.5',
}
for contract_id in required_contracts:
    if contract_id not in contract_ids:
        errors.append(f'v33_5_contract_missing:{contract_id}')

if capabilities.get('version') != '33.5':
    errors.append('capability_map_version_invalid')
operator = next((row for row in capabilities.get('layers', []) if row.get('layer') == 'operator-plane'), {})
required_capabilities = {
    'provider-adapter-contract-kit',
    'local-http-reference-provider',
    'signed-provider-webhook-receiver',
    'loopback-ssrf-boundary',
    'redirect-disabled-http-client',
    'provider-response-size-and-timeout-bounds',
    'local-http-fault-qualification',
    'mobile-approval-presentation-simulator',
    'adapter-qualification-evidence',
}
for capability in required_capabilities:
    if capability not in operator.get('capabilities', []):
        errors.append(f'operator_capability_missing:{capability}')
if operator.get('productionAuthority') != 'none; local signed simulated and loopback-HTTP qualification, durable decision capture and recovery only':
    errors.append('operator_plane_authority_expanded')

if gates.get('version') != '33.5':
    errors.append('proof_gate_registry_version_invalid')
for gate_id, expected in [('G0', 'passed'), ('G1', 'passed'), ('G2', 'not-started'), ('G3', 'in-progress')]:
    gate = next((row for row in gates.get('gates', []) if row.get('id') == gate_id), {})
    if gate.get('status') != expected:
        errors.append(f'{gate_id.lower()}_status_invalid')
g3 = next((row for row in gates.get('gates', []) if row.get('id') == 'G3'), {})
if g3.get('prototypeStatus') != 'loopback-http-signed-provider-and-webhook-qualification-not-real-device-or-human-validated':
    errors.append('g3_prototype_status_invalid')

if proof.get('status') != 'passed':
    errors.append('v33_5_proof_not_passed')
for key in [
    'realLocalHttpRoundTrip', 'providerReceiptVerified', 'signedWebhookVerified',
    'exactlyOnceAfterResponseLoss', 'redirectBlocked', 'ssrfPolicyEnforced',
    'timeoutBounded', 'oversizedResponseBlocked', 'malformedResponseBlocked',
    'mobileScopesPreserved', 'mobileFourActions', 'noExternalEffects',
    'noG3SelfPromotion',
]:
    if proof.get('assertions', {}).get(key) is not True:
        errors.append(f'v33_5_assertion_failed:{key}')
qualification = proof.get('qualificationEvidence', {})
if qualification.get('evidenceClass') != 'LOCAL_HTTP_QUALIFICATION':
    errors.append('qualification_evidence_class_invalid')
if qualification.get('g3Eligible') is not False:
    errors.append('g3_improperly_eligible')
if qualification.get('externalEffectsExecuted') != 0:
    errors.append('external_effect_detected')
if proof.get('productionPromotion') != 'blocked':
    errors.append('proof_promotes_production')
if proof.get('externalQualification') != 'not_executed':
    errors.append('proof_misstates_external_qualification')
if proof.get('mobilePresentation', {}).get('evidenceClass') != 'SIMULATED_PRESENTATION':
    errors.append('mobile_presentation_class_invalid')
if set(proof.get('mobilePresentation', {}).get('actions', [])) != {'YES', 'NO', 'CHANGE_CONDITIONS', 'EXPLAIN'}:
    errors.append('mobile_decision_actions_invalid')

if full_tests.get('status') != 'passed':
    errors.append('full_regression_not_passed')
totals = full_tests.get('totals', {})
if totals.get('tests') != 1247 or totals.get('passed') != 1247 or totals.get('failed') != 0:
    errors.append('full_regression_totals_invalid')
if totals.get('testFiles') != 190:
    errors.append('full_regression_file_count_invalid')
if full_tests.get('runnerExitCode') != 0:
    errors.append('full_regression_nonzero_exit')
if full_tests.get('timedOut') is not False:
    errors.append('full_regression_timed_out')
if full_tests.get('forceExitDisabled') is not True:
    errors.append('full_regression_force_exit_not_disabled')
if full_tests.get('inventory', {}).get('missing') != [] or full_tests.get('inventory', {}).get('extra') != []:
    errors.append('full_regression_inventory_mismatch')
stdout_path = ROOT / full_tests.get('stdoutEvidence', '')
stderr_path = ROOT / full_tests.get('stderrEvidence', '')
exit_path = ROOT / full_tests.get('exitEvidence', '')
meta_path = ROOT / full_tests.get('metaEvidence', '')
if stdout_path.is_file():
    if sha256(stdout_path) != full_tests.get('stdoutSha256'):
        errors.append('full_regression_stdout_digest_invalid')
    text = stdout_path.read_text(errors='replace')
    for marker in ['# tests 1247', '# pass 1247', '# fail 0']:
        if marker not in text:
            errors.append(f'full_regression_log_marker_missing:{marker}')
else:
    errors.append('full_regression_stdout_missing')
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
if truth.get('inventory', {}).get('sourceModules') != 190 or truth.get('inventory', {}).get('testFiles') != 190:
    errors.append('repository_truth_inventory_invalid')

metrics = architecture.get('metrics', {})
if architecture.get('status') != 'PASS' or architecture.get('findings') != []:
    errors.append('architecture_integrity_failed')
if metrics.get('sourceCycleCount') != 0:
    errors.append('architecture_source_cycles_present')
if metrics.get('untestedSourceCount') != 0:
    errors.append('architecture_untested_sources_present')
if metrics.get('capabilityPathCount') != 104 or metrics.get('closedCapabilityPathCount') != 104:
    errors.append('architecture_capability_path_count_invalid')
expected_v33_paths = {
    'chat-mission-compilation-and-approval-v33.1',
    'mission-continuity-and-approval-inbox-v33.2',
    'device-bound-push-decision-v33.3',
    'transport-neutral-reliable-push-v33.4',
    'local-http-push-adapter-qualification-v33.5',
}
expected_late_paths = {
    'observed-wasm-runtime-qualification',
    'independent-tournament-transport-observation',
    'local-process-failover-execution',
    'sovereign-component-admission-v32.17',
    'portable-building-block-conformance-v32.17',
    'cncf-sovereign-convergence-v32.17',
    'sovereign-control-plane-v32.18',
    'cncf-gold-mine-extraction-v32.18',
}
closure_ids = {row.get('capabilityId') for row in architecture.get('capabilityClosure', [])}
for capability_id in expected_v33_paths | expected_late_paths:
    if capability_id not in closure_ids:
        errors.append(f'architecture_path_missing:{capability_id}')
script_text = (ROOT / 'scripts/architecture-validation-v32.mjs').read_text()
for capability_id in expected_v33_paths | expected_late_paths:
    if capability_id not in script_text:
        errors.append(f'architecture_generator_path_missing:{capability_id}')

if expansion.get('status') != 'expanded-and-reproducible':
    errors.append('architecture_expansion_status_invalid')
if expansion.get('baseline', {}).get('capabilityPathCount') != 99:
    errors.append('architecture_expansion_baseline_invalid')
if expansion.get('current', {}).get('capabilityPathCount') != 104:
    errors.append('architecture_expansion_current_invalid')
if set(expansion.get('current', {}).get('addedPaths', [])) != expected_v33_paths:
    errors.append('architecture_expansion_added_paths_invalid')
for key in ['allAddedPathsHaveSource', 'allAddedPathsHaveTests', 'generatorContainsAllPaths', 'staleEvidenceCannotPassValidator']:
    if expansion.get('invariants', {}).get(key) is not True:
        errors.append(f'architecture_expansion_invariant_failed:{key}')
if expansion.get('productionPromotion') != 'blocked':
    errors.append('architecture_expansion_promotes_production')

# Regenerate current truth and architecture from packaged source. Stale artifacts must not pass.
if not errors:
    run_checked(['npm', 'run', 'truth-map:v32.18'], 'regenerated_truth_map')
    run_checked(['npm', 'run', 'architecture:v32'], 'regenerated_architecture')
if not errors:
    regenerated_truth = load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json')
    regenerated_architecture = load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
    if regenerated_truth.get('status') != 'passed' or regenerated_truth.get('findings') != []:
        errors.append('regenerated_truth_invalid')
    if regenerated_truth.get('inventory') != truth.get('inventory'):
        errors.append('regenerated_truth_inventory_mismatch')
    rmetrics = regenerated_architecture.get('metrics', {})
    if regenerated_architecture.get('status') != 'PASS' or regenerated_architecture.get('findings') != []:
        errors.append('regenerated_architecture_invalid')
    for key in ['sourceCycleCount', 'untestedSourceCount', 'capabilityPathCount', 'closedCapabilityPathCount']:
        if rmetrics.get(key) != metrics.get(key):
            errors.append(f'regenerated_architecture_metric_mismatch:{key}')
    if regenerated_architecture.get('graphDigest') != architecture.get('graphDigest'):
        errors.append('regenerated_architecture_graph_digest_mismatch')

if release_manifest.get('version') != '33.5':
    errors.append('release_manifest_version_invalid')
if release_manifest.get('status') != 'release-candidate-shadow-only':
    errors.append('release_manifest_status_invalid')
if release_manifest.get('productionPromotion') != 'blocked':
    errors.append('release_manifest_promotes_production')
if release_manifest.get('externalQualification') != 'not_executed':
    errors.append('release_manifest_misstates_external_qualification')
for entry in release_manifest.get('files', []):
    relpath = entry.get('path', '')
    path = ROOT / relpath
    if not path.is_file():
        errors.append(f'release_manifest_missing:{relpath}')
        continue
    if sha256(path) != entry.get('sha256'):
        errors.append(f'release_manifest_digest_mismatch:{relpath}')
    if path.stat().st_size != entry.get('sizeBytes'):
        errors.append(f'release_manifest_size_mismatch:{relpath}')

if not errors:
    direct = subprocess.run([
        'node', '--test',
        'dist/tests/chat-mission-v33_1.test.js',
        'dist/tests/mission-conversation-v33_2.test.js',
        'dist/tests/device-push-v33_3.test.js',
        'dist/tests/reliable-push-v33_4.test.js',
        'dist/tests/push-adapter-qualification-v33_5.test.js',
    ], cwd=ROOT, capture_output=True, text=True)
    if direct.returncode != 0:
        errors.append('v33_5_direct_tests_failed:' + direct.stdout[-3000:] + direct.stderr[-3000:])
    else:
        match = re.search(r'# tests (\d+)', direct.stdout)
        passed = re.search(r'# pass (\d+)', direct.stdout)
        failed = re.search(r'# fail (\d+)', direct.stdout)
        if not match or not passed or not failed or int(match.group(1)) != 80 or int(passed.group(1)) != 80 or int(failed.group(1)) != 0:
            errors.append('v33_5_direct_test_count_invalid')

manifest = {rel: sha256(ROOT / rel) for rel in REQUIRED if (ROOT / rel).is_file()}
result = {
    'version': '33.5',
    'status': 'passed' if not errors else 'failed',
    'gates': {'G0': 'passed', 'G1': 'passed', 'G2': 'not-started', 'G3': 'in-progress-not-passed'},
    'prototype': 'real-loopback-http-provider-signed-receipt-and-webhook-mobile-presentation-simulator-shadow-only',
    'qualificationEvidence': {
        'class': qualification.get('evidenceClass'),
        'adapterId': qualification.get('adapterId'),
        'realLocalHttpRoundTrip': qualification.get('realLocalHttpRoundTrip'),
        'exactlyOnceAfterResponseLoss': qualification.get('exactlyOnceAfterResponseLoss'),
        'g3Eligible': qualification.get('g3Eligible'),
        'externalEffectsExecuted': qualification.get('externalEffectsExecuted'),
    },
    'regression': {
        'testFiles': totals.get('testFiles'),
        'tests': totals.get('tests'),
        'passed': totals.get('passed'),
        'failed': totals.get('failed'),
        'runnerExitCode': full_tests.get('runnerExitCode'),
        'timedOut': full_tests.get('timedOut'),
        'forceExitDisabled': full_tests.get('forceExitDisabled'),
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
out = ROOT / 'release-evidence/v33.5/V33_5_VALIDATION.json'
out.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
sys.exit(0 if not errors else 1)
