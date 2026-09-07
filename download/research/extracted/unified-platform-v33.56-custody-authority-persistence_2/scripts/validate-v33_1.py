#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

required = [
    'v33/governance-state/AUTHORITY_CONFLICT_MAP_V33.json',
    'v33/governance-state/CONTRACT_REGISTRY_V33.json',
    'v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json',
    'v33/governance-state/PROOF_GATE_REGISTRY_V33.json',
    'docs/V33_RESEARCH_BOUNDARY.md',
    'docs/V33_DOMAIN_PACK_BOUNDARY.md',
    'docs/V33_1_CANONICAL_CONVERGENCE_DECISION.md',
    'docs/V33_1_CHAT_MISSION_AND_PUSH_CONTRACT.md',
    'src/product/chat-mission.ts',
    'tests/chat-mission-v33_1.test.ts',
    'release-evidence/v33.1/V33_1_CHAT_MISSION_PROOF.json',
    'release-evidence/v33.1/V33_1_FULL_TEST_RESULTS.json',
    'release-evidence/v33.1/V33_1_REPOSITORY_TRUTH_MAP.json',
    'release-evidence/v33.1/V33_1_ARCHITECTURE_INTEGRITY.json',
    'release-evidence/v33.1/V33_1_EXECUTION_LEDGER.md',
]

errors: list[str] = []

for rel in required:
    path = ROOT / rel
    if not path.is_file() or path.stat().st_size == 0:
        errors.append(f'missing_or_empty:{rel}')


def load(rel: str) -> dict:
    try:
        return json.loads((ROOT / rel).read_text())
    except Exception as exc:
        errors.append(f'invalid_json:{rel}:{exc}')
        return {}


auth = load('v33/governance-state/AUTHORITY_CONFLICT_MAP_V33.json')
contracts = load('v33/governance-state/CONTRACT_REGISTRY_V33.json')
capabilities = load('v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json')
gates = load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json')
proof = load('release-evidence/v33.1/V33_1_CHAT_MISSION_PROOF.json')
full_tests = load('release-evidence/v33.1/V33_1_FULL_TEST_RESULTS.json')
truth_map = load('release-evidence/v33.1/V33_1_REPOSITORY_TRUTH_MAP.json')
architecture = load('release-evidence/v33.1/V33_1_ARCHITECTURE_INTEGRITY.json')

if auth.get('unresolvedConflicts') != []:
    errors.append('authority_conflicts_unresolved')

critical = {
    'identity-root',
    'authority-grants',
    'policy-decision',
    'effect-ownership',
    'evidence-vocabulary',
    'promotion',
    'reviewer-trust',
}
rows = {row.get('domain'): row for row in auth.get('domains', [])}
for domain in critical:
    row = rows.get(domain)
    if not row:
        errors.append(f'authority_domain_missing:{domain}')
        continue
    if not row.get('canonicalOwner') or row.get('decision') is None:
        errors.append(f'authority_owner_missing:{domain}')
    if domain in {'identity-root', 'authority-grants', 'effect-ownership', 'promotion'}:
        decision = row.get('decision', '')
        if 'canonical' not in decision and 'one canonical' not in decision:
            errors.append(f'noncanonical_critical_decision:{domain}')

for contract in (row for row in contracts.get('contracts', []) if row.get('reserved')):
    if contract.get('owner') not in {'kernel', 'kernel-pack-boundary'}:
        errors.append(f'reserved_contract_owner_invalid:{contract.get("id")}')

research = next(
    (layer for layer in capabilities.get('layers', []) if layer.get('layer') == 'research-labs'),
    {},
)
if research.get('productionAuthority') != 'none':
    errors.append('research_has_production_authority')

g1 = next((gate for gate in gates.get('gates', []) if gate.get('id') == 'G1'), {})
if g1.get('status') != 'passed':
    errors.append('g1_not_passed')

if proof.get('status') != 'passed':
    errors.append('chat_proof_not_passed')
for key in [
    'lowRiskAutonomousPreparation',
    'highRiskRequiresApproval',
    'pushOptionsComplete',
    'explainDoesNotApprove',
    'approvalScopeBound',
    'noExternalEffects',
    'shadowCeiling',
]:
    if proof.get('assertions', {}).get(key) is not True:
        errors.append(f'chat_assertion_failed:{key}')
if proof.get('productionPromotion') != 'blocked':
    errors.append('chat_proof_promotes_production')

# The complete canonical regression is evidence, not merely a narrow unit lane.
if full_tests.get('status') != 'passed':
    errors.append('full_regression_not_passed')
totals = full_tests.get('totals', {})
if totals.get('tests') != 1173 or totals.get('passed') != 1173 or totals.get('failed') != 0:
    errors.append('full_regression_totals_invalid')
if full_tests.get('runnerExitCode') != 0:
    errors.append('full_regression_nonzero_exit')
if full_tests.get('timedOut') is not False:
    errors.append('full_regression_timed_out')
if full_tests.get('forceExitDisabled') is not True:
    errors.append('full_regression_force_exit_not_disabled')
if full_tests.get('inventory', {}).get('missing') != [] or full_tests.get('inventory', {}).get('extra') != []:
    errors.append('full_regression_inventory_mismatch')

if truth_map.get('status') != 'passed':
    errors.append('repository_truth_map_not_passed')
if truth_map.get('findings') != []:
    errors.append('repository_truth_map_has_findings')
if truth_map.get('boundaries', {}).get('productionPromotion') != 'blocked':
    errors.append('repository_truth_map_promotes_production')

if architecture.get('status') != 'PASS':
    errors.append('architecture_integrity_not_passed')
if architecture.get('findings') != []:
    errors.append('architecture_integrity_has_findings')
metrics = architecture.get('metrics', {})
if metrics.get('sourceCycleCount') != 0:
    errors.append('architecture_source_cycles_present')
if metrics.get('untestedSourceCount') != 0:
    errors.append('architecture_untested_sources_present')
if metrics.get('capabilityPathCount') != metrics.get('closedCapabilityPathCount'):
    errors.append('architecture_capability_paths_not_closed')

# Re-execute the typed shadow contract tests to detect stale proof artifacts.
if not errors:
    run = subprocess.run(
        ['node', '--test', 'dist/tests/chat-mission-v33_1.test.js'],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if run.returncode != 0:
        errors.append('chat_contract_tests_failed:' + run.stdout[-2000:] + run.stderr[-2000:])

manifest = {
    rel: hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()
    for rel in required
    if (ROOT / rel).is_file()
}
result = {
    'version': '33.1',
    'status': 'passed' if not errors else 'failed',
    'gates': {'G0': 'passed', 'G1': 'passed', 'G3': 'prototype-only-not-passed'},
    'chatPrototype': 'shadow-only',
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
    },
    'checkedFiles': required,
    'sha256': manifest,
    'errors': errors,
    'productionPromotion': 'blocked',
    'externalQualification': 'not_executed',
}
out = ROOT / 'release-evidence/v33.1/V33_1_VALIDATION.json'
out.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
sys.exit(0 if not errors else 1)
