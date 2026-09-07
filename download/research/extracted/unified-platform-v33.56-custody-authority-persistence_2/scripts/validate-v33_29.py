#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
E = ROOT / 'release-evidence/v33.29'
errors: list[str] = []

def load(rel: str):
    return json.loads((ROOT / rel).read_text())

def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def phase(name: str):
    print(json.dumps({'phase': name}), flush=True)

required = [
    'src/app/master-program-scorecard-v33_29.ts',
    'tests/master-program-scorecard-v33_29.test.ts',
    'scripts/master-program-scorecard-proof-v33_29.mjs',
    'scripts/verify-master-program-scorecard-v33_29.mjs',
    'scripts/run-full-regression-v33_29.py',
    'scripts/run-direct-v33-regression-v33_29.py',
    'scripts/validate-v33_29.py',
    'docs/V33_29_MASTER_PROGRAM_SCORECARD_AND_PRODUCT_REBALANCE.md',
    'CLAUDE_HANDOFF_v33_29.md',
    'V33_29_עדכון_ביצוע_והוכחות.md',
    'pilot-kits/v33.29/README.md',
    'pilot-kits/v33.29/CONTROLLED_HUMAN_UX_PILOT.md',
    'pilot-kits/v33.29/REAL_REPOSITORY_30_MISSION_CAMPAIGN.md',
    'pilot-kits/v33.29/BUYER_VALIDATION_AND_PAID_PILOT.md',
    'release-evidence/v33.29/V33_29_PARAMETER_LEDGER.json',
    'release-evidence/v33.29/V33_29_MASTER_PROGRAM_SCORECARD.json',
    'release-evidence/v33.29/V33_29_METRIC_INVENTORY.json',
    'release-evidence/v33.29/V33_29_STRATEGIC_REBALANCE_VERDICT.json',
    'release-evidence/v33.29/V33_29_PRIORITY_EXECUTION_PLAN.json',
    'release-evidence/v33.29/V33_29_MASTER_SCORECARD_PROOF.json',
    'release-evidence/v33.29/V33_29_PROOF_PUBLIC_KEYS.json',
    'release-evidence/v33.29/V33_29_FULL_TEST_RESULTS.json',
    'release-evidence/v33.29/V33_29_FULL_TEST_META.json',
    'release-evidence/v33.29/V33_29_FULL_TEST_STDOUT.tap',
    'release-evidence/v33.29/V33_29_FULL_TEST_STDERR.log',
    'release-evidence/v33.29/V33_29_FULL_TEST_EXIT.txt',
    'release-evidence/v33.29/V33_29_DIRECT_V33_RESULTS.json',
    'release-evidence/v33.29/V33_29_REPOSITORY_TRUTH_MAP.json',
    'release-evidence/v33.29/V33_29_ARCHITECTURE_INTEGRITY.json',
    'release-evidence/v33.29/V33_29_EXECUTION_LEDGER.md',
    'release-evidence/v33.29/V33_29_RELEASE_MANIFEST.json',
]
for rel in required:
    if not (ROOT / rel).is_file():
        errors.append('missing:' + rel)
if errors:
    result = {'version': '33.29', 'status': 'failed', 'errors': errors, 'productionPromotion': 'blocked'}
    E.mkdir(parents=True, exist_ok=True)
    (E / 'V33_29_VALIDATION.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2)); sys.exit(1)

phase('proof-signatures')
v = subprocess.run(['node', 'scripts/verify-master-program-scorecard-v33_29.mjs'], cwd=ROOT, capture_output=True, text=True, timeout=180)
if v.returncode:
    errors.append('proof_verification_failed:' + v.stderr[-500:])

proof = load('release-evidence/v33.29/V33_29_MASTER_SCORECARD_PROOF.json')['payload']
score = load('release-evidence/v33.29/V33_29_MASTER_PROGRAM_SCORECARD.json')['payload']
ledger = load('release-evidence/v33.29/V33_29_PARAMETER_LEDGER.json')['payload']
verdict = load('release-evidence/v33.29/V33_29_STRATEGIC_REBALANCE_VERDICT.json')['payload']
plan = load('release-evidence/v33.29/V33_29_PRIORITY_EXECUTION_PLAN.json')['payload']
full = load('release-evidence/v33.29/V33_29_FULL_TEST_RESULTS.json')
meta = load('release-evidence/v33.29/V33_29_FULL_TEST_META.json')
direct = load('release-evidence/v33.29/V33_29_DIRECT_V33_RESULTS.json')
truth = load('release-evidence/v33.29/V33_29_REPOSITORY_TRUTH_MAP.json')
arch = load('release-evidence/v33.29/V33_29_ARCHITECTURE_INTEGRITY.json')
manifest = load('release-evidence/v33.29/V33_29_RELEASE_MANIFEST.json')

expected_layers = {'coreAxes':14,'complementaryMetrics':8,'proofGates':9,'valueHypotheses':9,'programParameters':14}
expected_normalized = {'localStrong':28,'localPartial':19,'localWeak':7,'externalPassed':2,'externalPartial':2,'externalPendingOrBlocked':36,'notStarted':2}
expected_gates = {'passed':2,'inProgress':5,'notStarted':2}
expected_hypotheses = {'proven':0,'partialLocal':5,'unproven':4}
expected_parameters = {'preserved':8,'strengthened':3,'externalPending':3}
expected_priority = [
    'G3_CONTROLLED_HUMAN_UX_PILOT',
    'G4_REAL_REPOSITORY_30_MISSION_CAMPAIGN',
    'G2_BUYER_INTERVIEWS_DESIGN_PARTNERS_PAID_PILOTS',
    'G5_ONLY_EXTERNAL_TRUST_CONTROLS_THAT_DIRECTLY_UNBLOCK_THE_PILOT',
]
if proof.get('status') != 'MASTER_SCORECARD_AND_PRODUCT_MARKET_REBALANCE_GATE_PROVEN_LOCALLY' or proof.get('focusedTestsExpected') != 32:
    errors.append('proof_status_invalid')
if score.get('metricCount') != 54 or score.get('layerCounts') != expected_layers:
    errors.append('master_metric_inventory_invalid')
if score.get('normalizedStatus') != expected_normalized:
    errors.append('normalized_status_invalid')
if score.get('proofGateStatus') != expected_gates or proof.get('proofGateStatus') != expected_gates:
    errors.append('proof_gate_status_invalid')
if score.get('valueHypothesisStatus') != expected_hypotheses or proof.get('valueHypothesisStatus') != expected_hypotheses:
    errors.append('value_hypothesis_status_invalid')
if score.get('parameterStatus') != expected_parameters:
    errors.append('parameter_scorecard_status_invalid')
if score.get('historicalScorecardStatus') != 'HISTORICAL_BASELINE_ONLY_RESCORING_REQUIRED':
    errors.append('historical_scorecard_boundary_invalid')
if any(metric.get('currentNumericScoreAvailable') is not False for metric in score.get('metrics', [])):
    errors.append('current_numeric_score_asserted')
if len(score.get('metrics', [])) != 54 or len(load('release-evidence/v33.29/V33_29_METRIC_INVENTORY.json')) != 54:
    errors.append('metric_file_count_invalid')
if (ledger.get('parameterCount'), ledger.get('preservedParameterCount'), ledger.get('strengthenedParameterCount'), ledger.get('externalEvidencePendingParameterCount')) != (14,8,3,3):
    errors.append('parameter_ledger_invalid')
if verdict.get('status') != 'LOCAL_ASSURANCE_STRONG_EXTERNAL_PRODUCT_MARKET_CRITICAL_GAP':
    errors.append('strategic_verdict_invalid')
if verdict.get('directionAssessment') != 'TECHNICAL_DIRECTION_CORRECT_PORTFOLIO_BALANCE_REQUIRES_PIVOT_TO_EXTERNAL_PRODUCT_PROOF':
    errors.append('direction_assessment_invalid')
if verdict.get('requiredPriorityOrder') != expected_priority or plan.get('priorityOrder') != expected_priority:
    errors.append('priority_order_invalid')
if verdict.get('localSecurityFeatureExpansionAllowed') is not False or verdict.get('exceptionRule') != 'ONLY_WHEN_A_DOCUMENTED_G2_G3_OR_G4_PILOT_BLOCKER_REQUIRES_IT':
    errors.append('overengineering_guard_invalid')
if plan.get('hardStops') != ['NO_NEW_LOCAL_TRUST_FEATURE_UNLESS_IT_UNBLOCKS_G2_G3_OR_G4','NO_PRODUCTION_PROMOTION','NO_SYNTHETIC_EVIDENCE_COUNTED_AS_EXTERNAL']:
    errors.append('priority_hard_stops_invalid')
if plan.get('nextMeasuredTargets') != {'humanPilotParticipants':5,'qualifiedRepositories':3,'qualifiedMissions':30,'buyerInterviews':15,'urgentFundedConfirmations':5,'designPartners':3,'paidPilots':2}:
    errors.append('next_measured_targets_invalid')
external = score.get('externalProgress', {})
if set(external.values()) != {0} or proof.get('externalProgress') != external:
    errors.append('fabricated_external_progress')
if any(x.get('localMaturity') == 'STRONG' and x.get('externalMaturity') == 'PASSED' for x in score.get('metrics', []) if x.get('layer') == 'VALUE_HYPOTHESIS'):
    errors.append('value_hypothesis_external_pass_invalid')

# Corrected historical truth: G6 must point to adaptive execution and VH-05 must remain local-only.
gates = {g['id']: g for g in load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json')['gates']}
hypotheses = {h['id']: h for h in load('v33/governance-state/VALUE_HYPOTHESIS_REGISTRY_V33.json')['hypotheses']}
g6 = gates.get('G6', {})
g6_refs = g6.get('prototypeEvidenceRefs', [])
if g6.get('status') != 'in-progress' or not all(any(v in ref for ref in g6_refs) for v in ['v33_15','v33_16','v33_17']) or any('postgres' in ref.lower() for ref in g6_refs):
    errors.append('g6_adaptive_execution_mapping_invalid')
if hypotheses.get('VH-05', {}).get('status') != 'partially-supported-local-reference':
    errors.append('vh05_status_invalid')

# Pilot kit targets must remain concrete and external.
ux = (ROOT/'pilot-kits/v33.29/CONTROLLED_HUMAN_UX_PILOT.md').read_text()
repo = (ROOT/'pilot-kits/v33.29/REAL_REPOSITORY_30_MISSION_CAMPAIGN.md').read_text()
buyer = (ROOT/'pilot-kits/v33.29/BUYER_VALIDATION_AND_PAID_PILOT.md').read_text()
for phrase in ['70% fewer','no more than one approval','under ten seconds','Zero learned authority expansion']:
    if phrase not in ux: errors.append('ux_pilot_threshold_missing:' + phrase)
for phrase in ['Three repositories','Ten governed missions per repository','30 completed missions','100% evidence closure']:
    if phrase not in repo: errors.append('repository_campaign_threshold_missing:' + phrase)
for phrase in ['Fifteen structured buyer interviews','Five confirmations','Three design partners','Two paid pilots']:
    if phrase not in buyer: errors.append('buyer_validation_threshold_missing:' + phrase)

ft = full.get('totals', {}); dt = direct.get('totals', {})
if full.get('version') != '33.29' or full.get('status') != 'passed' or ft != {'testFiles':214,'tests':1825,'passed':1825,'failed':0} or full.get('runnerExitCode') != 0 or full.get('retry') or full.get('forceExitDisabled') is not True:
    errors.append('full_regression_invalid')
if direct.get('version') != '33.29' or direct.get('status') != 'passed' or dt != {'testFiles':29,'tests':658,'passed':658,'failed':0} or direct.get('retry') or direct.get('forceExit'):
    errors.append('direct_v33_invalid')
if meta.get('version') != '33.29' or meta.get('testFileCount') != 214 or meta.get('timedOut') or meta.get('retry') or meta.get('forceExitDisabled') is not True:
    errors.append('regression_meta_invalid')
inv = truth.get('inventory', {}); m = arch.get('metrics', {})
if inv.get('sourceModules') != 218 or inv.get('testFiles') != 214 or truth.get('findings') != []:
    errors.append('truth_map_invalid')
if arch.get('status') != 'PASS' or m.get('sourceCycleCount') != 0 or m.get('untestedSourceCount') != 0 or m.get('capabilityPathCount') != 153 or m.get('closedCapabilityPathCount') != 153:
    errors.append('architecture_invalid')
for name in ['CONTRACT_REGISTRY_V33.json','CANONICAL_CAPABILITY_MAP_V33.json','PROOF_GATE_REGISTRY_V33.json','SOURCE_SYSTEM_REGISTRY_V33.json','VALUE_HYPOTHESIS_REGISTRY_V33.json']:
    if load('v33/governance-state/' + name).get('version') != '33.29':
        errors.append('governance_version_invalid:' + name)

phase('regeneration')
tr = subprocess.run(['node','scripts/repository-truth-map-v32_18.mjs'], cwd=ROOT, capture_output=True, text=True, timeout=180)
ar = subprocess.run(['node','scripts/architecture-validation-v32.mjs'], cwd=ROOT, capture_output=True, text=True, timeout=180)
if tr.returncode or ar.returncode:
    errors.append('regeneration_failed')
else:
    rt = load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json')
    ra = load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
    if rt.get('inventory') != truth.get('inventory') or rt.get('findings') != truth.get('findings'):
        errors.append('truth_regeneration_mismatch')
    if ra.get('graphDigest') != arch.get('graphDigest') or ra.get('metrics') != arch.get('metrics'):
        errors.append('architecture_regeneration_mismatch')

if manifest.get('version') != '33.29' or manifest.get('evidenceClass') != 'LOCAL_MASTER_SCORECARD_AND_PRODUCT_MARKET_REBALANCE_GATE' or manifest.get('externalEffects') != 0 or manifest.get('productionPromotion') != 'blocked':
    errors.append('manifest_boundary_invalid')
if manifest.get('metricInventory') != {'total':54,'coreAxes':14,'complementaryMetrics':8,'proofGates':9,'valueHypotheses':9,'programParameters':14}:
    errors.append('manifest_metric_inventory_invalid')
for item in manifest.get('files', []):
    p = ROOT / str(item.get('path', ''))
    if not p.is_file() or p.stat().st_size != item.get('sizeBytes') or sha(p) != item.get('sha256'):
        errors.append('manifest_file_invalid:' + str(item.get('path')))

if proof.get('productionAuthority') != 'NONE' or proof.get('externalEffectsExecuted') != 0 or proof.get('productionPromotion') != 'blocked' or verdict.get('productionAuthority') != 'NONE' or verdict.get('externalEffectsExecuted') != 0:
    errors.append('production_boundary_invalid')

result = {
    'version':'33.29',
    'status':'passed' if not errors else 'failed',
    'evidenceClass':'LOCAL_MASTER_SCORECARD_AND_PRODUCT_MARKET_REBALANCE_GATE',
    'masterScorecard':{
        'metrics':score.get('metricCount'),
        'layers':score.get('layerCounts'),
        'localMaturity':score.get('normalizedStatus'),
        'proofGates':score.get('proofGateStatus'),
        'valueHypotheses':score.get('valueHypothesisStatus'),
        'historicalNumericScore':'stale_baseline_only',
    },
    'parameterLedger':{'count':14,'preserved':8,'strengthened':3,'externalEvidencePending':3},
    'strategicVerdict':verdict.get('status'),
    'priorityOrder':expected_priority,
    'externalProgress':external,
    'regression':ft,
    'directV33':dt,
    'truthMap':{'sourceModules':inv.get('sourceModules'),'testFiles':inv.get('testFiles'),'scripts':inv.get('scripts'),'findings':len(truth.get('findings', []))},
    'architecture':{k:m.get(k) for k in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']},
    'errors':errors,
    'productionPromotion':'blocked',
}
E.mkdir(parents=True, exist_ok=True)
(E/'V33_29_VALIDATION.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
sys.exit(0 if not errors else 1)
