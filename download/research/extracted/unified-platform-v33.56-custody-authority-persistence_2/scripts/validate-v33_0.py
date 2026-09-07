#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
required=[
 'docs/V33_CONVERGENCE_CONSTITUTION.md',
 'docs/V33_EVIDENCE_BACKED_ROADMAP.md',
 'v33/governance-state/SOURCE_SYSTEM_REGISTRY_V33.json',
 'v33/governance-state/PROOF_GATE_REGISTRY_V33.json',
 'v33/governance-state/VALUE_HYPOTHESIS_REGISTRY_V33.json',
 'release-evidence/v33.0/V33_0_BASELINE_VALIDATION.json',
 'release-evidence/v33.0/V33_0_G0_CLOSURE.json',
 'docs/V33_0_TEST_RUNNER_LIVENESS_BLOCKER.md',
 'release-evidence/v33.0/V33_0_EXECUTION_LEDGER.md',
 'release-evidence/v33.0/V33_0_FULL_TEST_TAP.log',
 'evidence/generated/v33-g0-reruns/run-1-results.json',
 'evidence/generated/v33-g0-reruns/run-2-results.json',
 'evidence/generated/v33-g0-reruns/run-3-results.json',
 'evidence/runs/v33-g0-authoritative-2/V32_18_EXECUTION_COMPLETION.json',
 'evidence/runs/v33-g0-authoritative-2/V32_18_FINAL_VALIDATION.json',
]
errors=[]
for rel in required:
 p=ROOT/rel
 if not p.is_file() or p.stat().st_size==0: errors.append(f'missing_or_empty:{rel}')

def load(rel:str):
 try:return json.loads((ROOT/rel).read_text())
 except Exception as exc: errors.append(f'invalid_json:{rel}:{exc}');return {}
source=load('v33/governance-state/SOURCE_SYSTEM_REGISTRY_V33.json')
gates=load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json')
values=load('v33/governance-state/VALUE_HYPOTHESIS_REGISTRY_V33.json')
baseline=load('release-evidence/v33.0/V33_0_BASELINE_VALIDATION.json')
closure=load('release-evidence/v33.0/V33_0_G0_CLOSURE.json')
completion=load('evidence/runs/v33-g0-authoritative-2/V32_18_EXECUTION_COMPLETION.json')
final=load('evidence/runs/v33-g0-authoritative-2/V32_18_FINAL_VALIDATION.json')
if source.get('canonicalKernel')!='unified-platform-v32.18': errors.append('canonical_kernel_changed')
canonical=[s for s in source.get('systems',[]) if s.get('productionAuthority','').startswith('canonical')]
if len(canonical)!=1: errors.append(f'canonical_authority_count:{len(canonical)}')
for s in source.get('systems',[]):
 if s.get('id')=='srs-v8.2' and s.get('productionAuthority')!='none': errors.append('srs_has_production_authority')
ids=[g.get('id') for g in gates.get('gates',[])]
if ids!=gates.get('promotionOrder'): errors.append('gate_order_mismatch')
g0=next((g for g in gates.get('gates',[]) if g.get('id')=='G0'),{})
if g0.get('status')!='passed': errors.append('truth_gate_not_passed')
if baseline.get('status')!='passed': errors.append('baseline_not_passed')
ct=baseline.get('canonicalTests',{})
if ct.get('runnerControlStatus')!='passed' or ct.get('consecutiveCleanRuns')!=3 or ct.get('forceExitDisabled') is not True:
 errors.append('runner_closure_invalid')
for i in range(1,4):
 d=load(f'evidence/generated/v33-g0-reruns/run-{i}-results.json')
 if not (d.get('status')=='passed' and d.get('runnerExitCode')==0 and d.get('timedOut') is False and d.get('forceExitDisabled') is True):
  errors.append(f'canonical_rerun_{i}_invalid')
 totals=d.get('totals',{})
 if totals.get('tests')!=1167 or totals.get('passed')!=1167 or totals.get('failed')!=0:
  errors.append(f'canonical_rerun_{i}_inventory_invalid')
if closure.get('status')!='passed' or closure.get('gate')!='G0': errors.append('g0_closure_invalid')
if completion.get('status')!='passed' or completion.get('stepsPassed')!=24: errors.append('v32_18_authoritative_completion_invalid')
if final.get('status')!='passed': errors.append('v32_18_final_validation_invalid')
if final.get('results',{}).get('tests',{}).get('total')!=1167: errors.append('final_test_inventory_invalid')
if final.get('results',{}).get('architecture',{}).get('sourceCycles')!=0: errors.append('source_cycle_regression')
if any(path.name.endswith('_V33.json') for path in (ROOT/'governance-state').glob('*.json')):
 errors.append('v33_overlay_inside_historical_governance_namespace')
for h in values.get('hypotheses',[]):
 if not h.get('killCriteria'): errors.append(f'missing_kill_criteria:{h.get("id")}')
manifest={rel:hashlib.sha256((ROOT/rel).read_bytes()).hexdigest() for rel in required if (ROOT/rel).is_file()}
result={'version':'33.0','status':'passed' if not errors else 'failed','gate':'G0','checkedFiles':required,'sha256':manifest,'errors':errors,'productionPromotion':'blocked'}
out=ROOT/'release-evidence/v33.0/V33_0_GOVERNANCE_VALIDATION.json'
out.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
sys.exit(0 if not errors else 1)
