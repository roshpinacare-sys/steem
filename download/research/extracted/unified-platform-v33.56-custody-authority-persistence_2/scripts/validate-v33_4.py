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
    'CLAUDE_HANDOFF_v33_4.md',
    'src/product/chat-mission.ts',
    'src/product/mission-conversation-v33_2.ts',
    'src/product/device-push-v33_3.ts',
    'src/product/reliable-push-v33_4.ts',
    'tests/chat-mission-v33_1.test.ts',
    'tests/mission-conversation-v33_2.test.ts',
    'tests/device-push-v33_3.test.ts',
    'tests/reliable-push-v33_4.test.ts',
    'scripts/reliable-push-proof-v33_4.mjs',
    'scripts/architecture-validation-v32.mjs',
    'scripts/validate-v33_4.py',
    'docs/V33_1_CHAT_MISSION_AND_PUSH_CONTRACT.md',
    'docs/V33_2_MISSION_CONTINUITY_AND_APPROVAL_INBOX.md',
    'docs/V33_3_DEVICE_BOUND_PUSH_AND_USER_FLOW.md',
    'docs/V33_4_TRANSPORT_NEUTRAL_RELIABLE_PUSH.md',
    'v33/governance-state/CONTRACT_REGISTRY_V33.json',
    'v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json',
    'v33/governance-state/PROOF_GATE_REGISTRY_V33.json',
    'release-evidence/v33.4/V33_4_RELIABLE_PUSH_PROOF.json',
    'release-evidence/v33.4/V33_4_FULL_TEST_RESULTS.json',
    'release-evidence/v33.4/V33_4_REPOSITORY_TRUTH_MAP.json',
    'release-evidence/v33.4/V33_4_ARCHITECTURE_INTEGRITY.json',
    'release-evidence/v33.4/V33_4_ARCHITECTURE_EVIDENCE_RECONCILIATION.json',
    'release-evidence/v33.4/V33_4_EXECUTION_LEDGER.md',
    'release-evidence/v33.4/V33_4_RELEASE_MANIFEST.json',
    'evidence/v33.4-regression.cmd.json',
    'evidence/v33.4-regression.stdout',
    'evidence/v33.4-regression.exit',
]
errors: list[str] = []
for rel in REQUIRED:
    path = ROOT / rel
    if not path.is_file() or path.stat().st_size == 0:
        errors.append(f'missing_or_empty:{rel}')


def load(rel: str) -> dict:
    try:
        return json.loads((ROOT / rel).read_text())
    except Exception as exc:
        errors.append(f'invalid_json:{rel}:{exc}')
        return {}


def run_checked(command: list[str], label: str) -> None:
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        errors.append(f'{label}_failed:' + result.stdout[-2500:] + result.stderr[-2500:])

contracts = load('v33/governance-state/CONTRACT_REGISTRY_V33.json')
capabilities = load('v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json')
gates = load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json')
proof = load('release-evidence/v33.4/V33_4_RELIABLE_PUSH_PROOF.json')
full_tests = load('release-evidence/v33.4/V33_4_FULL_TEST_RESULTS.json')
truth = load('release-evidence/v33.4/V33_4_REPOSITORY_TRUTH_MAP.json')
architecture = load('release-evidence/v33.4/V33_4_ARCHITECTURE_INTEGRITY.json')
reconciliation = load('release-evidence/v33.4/V33_4_ARCHITECTURE_EVIDENCE_RECONCILIATION.json')
release_manifest = load('release-evidence/v33.4/V33_4_RELEASE_MANIFEST.json')

if contracts.get('version') != '33.4': errors.append('contract_registry_version_invalid')
contract_ids = {row.get('id') for row in contracts.get('contracts', [])}
required_contracts = {
    'transport-neutral-push-request', 'push-provider-receipt', 'push-outbox-item',
    'signed-push-outbox-file', 'device-session-record', 'device-replacement-grant',
    'device-replacement-receipt', 'transport-reliability-evidence',
}
for contract_id in required_contracts:
    if contract_id not in contract_ids:
        errors.append(f'v33_4_contract_missing:{contract_id}')

operator = next((row for row in capabilities.get('layers', []) if row.get('layer') == 'operator-plane'), {})
required_capabilities = {
    'transport-neutral-push-outbox', 'trusted-gateway-admission',
    'provider-signed-acceptance', 'adapter-tenant-scoped-deduplication',
    'signed-outbox-state', 'worker-lease-crash-recovery',
    'loss-duplicate-delay-reorder-fault-simulation', 'device-session-revocation',
    'registrar-bound-device-replacement', 'transport-reliability-evidence',
}
for capability in required_capabilities:
    if capability not in operator.get('capabilities', []):
        errors.append(f'operator_capability_missing:{capability}')
if operator.get('productionAuthority') != 'none; local signed simulated transport, durable decision capture and recovery only':
    errors.append('operator_plane_authority_expanded')

for gate_id, expected in [('G0', 'passed'), ('G1', 'passed'), ('G3', 'in-progress')]:
    gate = next((row for row in gates.get('gates', []) if row.get('id') == gate_id), {})
    if gate.get('status') != expected:
        errors.append(f'{gate_id.lower()}_status_invalid')
g3 = next((row for row in gates.get('gates', []) if row.get('id') == 'G3'), {})
if g3.get('prototypeStatus') != 'transport-neutral-signed-durable-push-fault-injection-not-human-validated':
    errors.append('g3_prototype_status_invalid')

if proof.get('status') != 'passed': errors.append('v33_4_proof_not_passed')
for key in [
    'responseLossRecoveredExactlyOnce', 'duplicateSuppressed', 'dropRetried',
    'delayRetried', 'permanentFailureBounded', 'crashLeaseRecovered',
    'signedOutboxTamperingBlocked', 'oldSessionInvalidated',
    'replacementBoundToSameUser', 'oldDeviceRevoked', 'newDeviceActive',
    'noExternalEffects', 'noG3SelfPromotion',
]:
    if proof.get('assertions', {}).get(key) is not True:
        errors.append(f'v33_4_assertion_failed:{key}')
rel = proof.get('reliabilityEvidence', {})
if rel.get('evidenceClass') != 'SIMULATED_FAULT_INJECTION': errors.append('reliability_evidence_class_invalid')
if rel.get('g3Eligible') is not False: errors.append('g3_improperly_eligible')
if rel.get('externalEffectsExecuted') != 0: errors.append('external_effect_detected')
if proof.get('productionPromotion') != 'blocked': errors.append('proof_promotes_production')

if full_tests.get('status') != 'passed': errors.append('full_regression_not_passed')
totals = full_tests.get('totals', {})
if totals.get('tests') != 1230 or totals.get('passed') != 1230 or totals.get('failed') != 0:
    errors.append('full_regression_totals_invalid')
if totals.get('testFiles') != 189: errors.append('full_regression_file_count_invalid')
if full_tests.get('runnerExitCode') != 0: errors.append('full_regression_nonzero_exit')
if full_tests.get('timedOut') is not False: errors.append('full_regression_timed_out')
if full_tests.get('forceExitDisabled') is not True: errors.append('full_regression_force_exit_not_disabled')
if full_tests.get('inventory', {}).get('missing') != [] or full_tests.get('inventory', {}).get('extra') != []:
    errors.append('full_regression_inventory_mismatch')
stdout_path = ROOT / full_tests.get('stdoutEvidence', '')
exit_path = ROOT / full_tests.get('exitEvidence', '')
if stdout_path.is_file():
    stdout_digest = hashlib.sha256(stdout_path.read_bytes()).hexdigest()
    if stdout_digest != full_tests.get('stdoutSha256'): errors.append('full_regression_stdout_digest_invalid')
    text = stdout_path.read_text(errors='replace')
    for marker in ['# tests 1230', '# pass 1230', '# fail 0']:
        if marker not in text: errors.append(f'full_regression_log_marker_missing:{marker}')
else: errors.append('full_regression_stdout_missing')
if not exit_path.is_file() or exit_path.read_text().strip() != '0': errors.append('full_regression_exit_receipt_invalid')

if truth.get('status') != 'passed' or truth.get('findings') != []: errors.append('repository_truth_map_failed')
if truth.get('boundaries', {}).get('productionPromotion') != 'blocked': errors.append('repository_truth_map_promotes_production')
if truth.get('inventory', {}).get('sourceModules') != 189 or truth.get('inventory', {}).get('testFiles') != 189:
    errors.append('repository_truth_inventory_invalid')

metrics = architecture.get('metrics', {})
if architecture.get('status') != 'PASS' or architecture.get('findings') != []: errors.append('architecture_integrity_failed')
if metrics.get('sourceCycleCount') != 0: errors.append('architecture_source_cycles_present')
if metrics.get('untestedSourceCount') != 0: errors.append('architecture_untested_sources_present')
if metrics.get('capabilityPathCount') != 99 or metrics.get('closedCapabilityPathCount') != 99:
    errors.append('architecture_capability_path_count_invalid')
expected_late_paths = {
    'observed-wasm-runtime-qualification', 'independent-tournament-transport-observation',
    'local-process-failover-execution', 'sovereign-component-admission-v32.17',
    'portable-building-block-conformance-v32.17', 'cncf-sovereign-convergence-v32.17',
    'sovereign-control-plane-v32.18', 'cncf-gold-mine-extraction-v32.18',
}
closure_ids = {row.get('capabilityId') for row in architecture.get('capabilityClosure', [])}
for capability_id in expected_late_paths:
    if capability_id not in closure_ids: errors.append(f'architecture_late_path_missing:{capability_id}')
script_text = (ROOT / 'scripts/architecture-validation-v32.mjs').read_text()
for capability_id in expected_late_paths:
    if capability_id not in script_text: errors.append(f'architecture_generator_path_missing:{capability_id}')

if reconciliation.get('status') != 'reconciled-and-corrected': errors.append('architecture_reconciliation_invalid')
if reconciliation.get('correction', {}).get('explicitPathsAdded') != 8: errors.append('architecture_reconciliation_path_count_invalid')
if reconciliation.get('correction', {}).get('currentCapabilityPathCount') != 99: errors.append('architecture_reconciliation_current_count_invalid')
if set(reconciliation.get('missingFromRetainedGenerator', [])) != expected_late_paths:
    errors.append('architecture_reconciliation_missing_set_invalid')
if reconciliation.get('productionPromotion') != 'blocked': errors.append('architecture_reconciliation_promotes_production')

# Regenerate current truth and architecture from the packaged source. This prevents stale evidence from passing.
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
        if rmetrics.get(key) != metrics.get(key): errors.append(f'regenerated_architecture_metric_mismatch:{key}')
    if regenerated_architecture.get('graphDigest') != architecture.get('graphDigest'):
        errors.append('regenerated_architecture_graph_digest_mismatch')

if release_manifest.get('version') != '33.4': errors.append('release_manifest_version_invalid')
if release_manifest.get('status') != 'release-candidate-shadow-only': errors.append('release_manifest_status_invalid')
if release_manifest.get('productionPromotion') != 'blocked': errors.append('release_manifest_promotes_production')
for entry in release_manifest.get('files', []):
    relpath = entry.get('path', '')
    path = ROOT / relpath
    if not path.is_file():
        errors.append(f'release_manifest_missing:{relpath}')
        continue
    if hashlib.sha256(path.read_bytes()).hexdigest() != entry.get('sha256'):
        errors.append(f'release_manifest_digest_mismatch:{relpath}')

if not errors:
    direct = subprocess.run([
        'node', '--test',
        'dist/tests/chat-mission-v33_1.test.js',
        'dist/tests/mission-conversation-v33_2.test.js',
        'dist/tests/device-push-v33_3.test.js',
        'dist/tests/reliable-push-v33_4.test.js',
    ], cwd=ROOT, capture_output=True, text=True)
    if direct.returncode != 0:
        errors.append('v33_4_direct_tests_failed:' + direct.stdout[-3000:] + direct.stderr[-3000:])
    else:
        match = re.search(r'# tests (\d+)', direct.stdout)
        passed = re.search(r'# pass (\d+)', direct.stdout)
        if not match or not passed or int(match.group(1)) != 63 or int(passed.group(1)) != 63:
            errors.append('v33_4_direct_test_count_invalid')

manifest = {rel: hashlib.sha256((ROOT / rel).read_bytes()).hexdigest() for rel in REQUIRED if (ROOT / rel).is_file()}
result = {
    'version': '33.4',
    'status': 'passed' if not errors else 'failed',
    'gates': {'G0': 'passed', 'G1': 'passed', 'G2': 'not-started', 'G3': 'in-progress-not-passed'},
    'prototype': 'transport-neutral-signed-durable-push-fault-injection-and-device-recovery-shadow-only',
    'reliabilityEvidence': {
        'class': rel.get('evidenceClass'), 'requests': rel.get('requests'),
        'accepted': rel.get('accepted'), 'deadLetter': rel.get('deadLetter'),
        'attempts': rel.get('attempts'), 'crashRecoveries': rel.get('crashRecoveries'),
        'uniqueProviderAcceptances': rel.get('uniqueProviderAcceptances'),
        'g3Eligible': rel.get('g3Eligible'),
    },
    'regression': {
        'testFiles': totals.get('testFiles'), 'tests': totals.get('tests'),
        'passed': totals.get('passed'), 'failed': totals.get('failed'),
        'runnerExitCode': full_tests.get('runnerExitCode'),
        'timedOut': full_tests.get('timedOut'),
        'forceExitDisabled': full_tests.get('forceExitDisabled'),
    },
    'architecture': {
        'sourceCycleCount': metrics.get('sourceCycleCount'),
        'untestedSourceCount': metrics.get('untestedSourceCount'),
        'capabilityPathCount': metrics.get('capabilityPathCount'),
        'closedCapabilityPathCount': metrics.get('closedCapabilityPathCount'),
        'historicalEvidenceReconciled': reconciliation.get('status'),
    },
    'checkedFiles': REQUIRED,
    'sha256': manifest,
    'errors': errors,
    'productionPromotion': 'blocked',
    'externalQualification': 'not_executed',
}
out = ROOT / 'release-evidence/v33.4/V33_4_VALIDATION.json'
out.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
sys.exit(0 if not errors else 1)
