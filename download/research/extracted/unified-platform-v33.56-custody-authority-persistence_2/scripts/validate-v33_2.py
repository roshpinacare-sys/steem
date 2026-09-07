#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
    'CLAUDE_HANDOFF_v33_2.md',
    'src/product/chat-mission.ts',
    'src/product/mission-conversation-v33_2.ts',
    'tests/chat-mission-v33_1.test.ts',
    'tests/mission-conversation-v33_2.test.ts',
    'scripts/mission-continuity-proof-v33_2.mjs',
    'docs/V33_1_CHAT_MISSION_AND_PUSH_CONTRACT.md',
    'docs/V33_2_MISSION_CONTINUITY_AND_APPROVAL_INBOX.md',
    'v33/governance-state/CONTRACT_REGISTRY_V33.json',
    'v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json',
    'v33/governance-state/PROOF_GATE_REGISTRY_V33.json',
    'release-evidence/v33.2/V33_2_MISSION_CONTINUITY_PROOF.json',
    'release-evidence/v33.2/V33_2_FULL_TEST_RESULTS.json',
    'release-evidence/v33.2/V33_2_REPOSITORY_TRUTH_MAP.json',
    'release-evidence/v33.2/V33_2_ARCHITECTURE_INTEGRITY.json',
    'release-evidence/v33.2/V33_2_EXECUTION_LEDGER.md',
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

contracts = load('v33/governance-state/CONTRACT_REGISTRY_V33.json')
capabilities = load('v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json')
gates = load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json')
proof = load('release-evidence/v33.2/V33_2_MISSION_CONTINUITY_PROOF.json')
full_tests = load('release-evidence/v33.2/V33_2_FULL_TEST_RESULTS.json')
truth = load('release-evidence/v33.2/V33_2_REPOSITORY_TRUTH_MAP.json')
architecture = load('release-evidence/v33.2/V33_2_ARCHITECTURE_INTEGRITY.json')

contract_ids = {row.get('id') for row in contracts.get('contracts', [])}
for contract_id in {'mission-conversation-snapshot', 'approval-inbox-item', 'approval-delivery-receipt'}:
    if contract_id not in contract_ids:
        errors.append(f'v33_2_contract_missing:{contract_id}')
for row in contracts.get('contracts', []):
    if row.get('id') in {'mission-conversation-snapshot', 'approval-inbox-item', 'approval-delivery-receipt'} and row.get('owner') != 'operator-plane':
        errors.append(f'v33_2_contract_owner_invalid:{row.get("id")}')

operator = next((row for row in capabilities.get('layers', []) if row.get('layer') == 'operator-plane'), {})
for capability in {'persistent-mission-conversation', 'approval-inbox', 'delivery-deduplication', 'approval-expiry', 'decision-receipts'}:
    if capability not in operator.get('capabilities', []):
        errors.append(f'operator_capability_missing:{capability}')
if operator.get('productionAuthority') != 'none; decision capture only':
    errors.append('operator_plane_authority_expanded')

g0 = next((row for row in gates.get('gates', []) if row.get('id') == 'G0'), {})
g1 = next((row for row in gates.get('gates', []) if row.get('id') == 'G1'), {})
g3 = next((row for row in gates.get('gates', []) if row.get('id') == 'G3'), {})
if g0.get('status') != 'passed': errors.append('g0_not_passed')
if g1.get('status') != 'passed': errors.append('g1_not_passed')
if g3.get('status') != 'not-started': errors.append('g3_improperly_promoted')
if g3.get('prototypeStatus') != 'continuity-and-local-inbox-implemented-not-human-validated': errors.append('g3_prototype_status_invalid')

if proof.get('status') != 'passed': errors.append('v33_2_proof_not_passed')
for key in [
    'filePersistenceReopened', 'appendIdempotent', 'hashChainBound', 'tenantIsolation',
    'authorityRebindingBlocked', 'duplicateDeliveryIdempotent', 'explanationNonterminal',
    'oneTerminalDecision', 'secondTerminalBlocked', 'noScopeExpansion', 'noExternalEffects',
    'expiredApprovalBlocked',
]:
    if proof.get('assertions', {}).get(key) is not True:
        errors.append(f'v33_2_assertion_failed:{key}')
if proof.get('productionPromotion') != 'blocked': errors.append('v33_2_proof_promotes_production')

if full_tests.get('status') != 'passed': errors.append('full_regression_not_passed')
totals = full_tests.get('totals', {})
if totals.get('tests') != 1185 or totals.get('passed') != 1185 or totals.get('failed') != 0:
    errors.append('full_regression_totals_invalid')
if totals.get('testFiles') != 187: errors.append('full_regression_file_count_invalid')
if full_tests.get('runnerExitCode') != 0: errors.append('full_regression_nonzero_exit')
if full_tests.get('timedOut') is not False: errors.append('full_regression_timed_out')
if full_tests.get('forceExitDisabled') is not True: errors.append('full_regression_force_exit_not_disabled')
if full_tests.get('inventory', {}).get('missing') != [] or full_tests.get('inventory', {}).get('extra') != []: errors.append('full_regression_inventory_mismatch')

if truth.get('status') != 'passed' or truth.get('findings') != []: errors.append('repository_truth_map_failed')
if truth.get('boundaries', {}).get('productionPromotion') != 'blocked': errors.append('repository_truth_map_promotes_production')
if truth.get('inventory', {}).get('sourceModules') != 187 or truth.get('inventory', {}).get('testFiles') != 187: errors.append('repository_truth_inventory_invalid')

metrics = architecture.get('metrics', {})
if architecture.get('status') != 'PASS' or architecture.get('findings') != []: errors.append('architecture_integrity_failed')
if metrics.get('sourceCycleCount') != 0: errors.append('architecture_source_cycles_present')
if metrics.get('untestedSourceCount') != 0: errors.append('architecture_untested_sources_present')
if metrics.get('capabilityPathCount') != metrics.get('closedCapabilityPathCount'): errors.append('architecture_capability_paths_open')

if not errors:
    run = subprocess.run(
        ['node', '--test', 'dist/tests/chat-mission-v33_1.test.js', 'dist/tests/mission-conversation-v33_2.test.js'],
        cwd=ROOT, capture_output=True, text=True,
    )
    if run.returncode != 0:
        errors.append('v33_2_direct_tests_failed:' + run.stdout[-3000:] + run.stderr[-3000:])

manifest = {rel: hashlib.sha256((ROOT / rel).read_bytes()).hexdigest() for rel in REQUIRED if (ROOT / rel).is_file()}
result = {
    'version': '33.2',
    'status': 'passed' if not errors else 'failed',
    'gates': {'G0': 'passed', 'G1': 'passed', 'G2': 'not-started', 'G3': 'prototype-only-not-passed'},
    'prototype': 'persistent-conversation-and-local-approval-inbox-shadow-only',
    'regression': {
        'testFiles': totals.get('testFiles'), 'tests': totals.get('tests'), 'passed': totals.get('passed'), 'failed': totals.get('failed'),
        'runnerExitCode': full_tests.get('runnerExitCode'), 'timedOut': full_tests.get('timedOut'), 'forceExitDisabled': full_tests.get('forceExitDisabled'),
    },
    'architecture': {
        'sourceCycleCount': metrics.get('sourceCycleCount'), 'untestedSourceCount': metrics.get('untestedSourceCount'),
        'capabilityPathCount': metrics.get('capabilityPathCount'), 'closedCapabilityPathCount': metrics.get('closedCapabilityPathCount'),
    },
    'checkedFiles': REQUIRED,
    'sha256': manifest,
    'errors': errors,
    'productionPromotion': 'blocked',
    'externalQualification': 'not_executed',
  }
out = ROOT / 'release-evidence/v33.2/V33_2_VALIDATION.json'
out.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
sys.exit(0 if not errors else 1)
