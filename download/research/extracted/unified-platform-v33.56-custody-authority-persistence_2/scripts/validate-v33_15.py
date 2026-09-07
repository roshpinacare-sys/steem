#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'release-evidence/v33.15'
REQUIRED=[
'src/runtime/proof-carrying-adaptive-execution-v33_15.ts',
'tests/proof-carrying-adaptive-execution-v33_15.test.ts',
'scripts/proof-carrying-adaptive-execution-proof-v33_15.mjs',
'scripts/verify-proof-carrying-adaptive-execution-v33_15.mjs',
'scripts/run-full-regression-v33_15.sh',
'scripts/validate-v33_15.py',
'docs/V33_15_PROOF_CARRYING_ADAPTIVE_EXECUTION.md',
'CLAUDE_HANDOFF_v33_15.md',
'v33/governance-state/PROOF_GATE_REGISTRY_V33.json',
'v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json',
'release-evidence/v33.15/V33_15_PROOF_CARRYING_ADAPTIVE_EXECUTION_PROOF.json',
'release-evidence/v33.15/V33_15_ADAPTIVE_EXECUTION_TRACE.json',
'release-evidence/v33.15/V33_15_FULL_TEST_RESULTS.json',
'release-evidence/v33.15/V33_15_FULL_TEST_STDOUT.tap',
'release-evidence/v33.15/V33_15_FULL_TEST_STDERR.log',
'release-evidence/v33.15/V33_15_FULL_TEST_EXIT.txt',
'release-evidence/v33.15/V33_15_FULL_TEST_META.json',
'release-evidence/v33.15/V33_15_REPOSITORY_TRUTH_MAP.json',
'release-evidence/v33.15/V33_15_ARCHITECTURE_INTEGRITY.json',
'release-evidence/v33.15/V33_15_EXECUTION_LEDGER.md',
'release-evidence/v33.15/V33_15_RELEASE_MANIFEST.json',
]
errors=[]
for rel in REQUIRED:
 if not (ROOT/rel).is_file(): errors.append(f'missing:{rel}')
def load(rel): return json.loads((ROOT/rel).read_text())
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
if errors:
 print(json.dumps({'version':'33.15','status':'failed','errors':errors},indent=2));sys.exit(1)
proof=load('release-evidence/v33.15/V33_15_PROOF_CARRYING_ADAPTIVE_EXECUTION_PROOF.json')
trace=load('release-evidence/v33.15/V33_15_ADAPTIVE_EXECUTION_TRACE.json')
full=load('release-evidence/v33.15/V33_15_FULL_TEST_RESULTS.json')
truth=load('release-evidence/v33.15/V33_15_REPOSITORY_TRUTH_MAP.json')
arch=load('release-evidence/v33.15/V33_15_ARCHITECTURE_INTEGRITY.json')
gates=load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json')
capmap=load('v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json')
manifest=load('release-evidence/v33.15/V33_15_RELEASE_MANIFEST.json')
expected={
'status':'LOCAL_SHADOW_SHORTCUT_QUALIFIED_AND_DRIFT_REVOKED',
'evidenceClass':'SIMULATED_LOCAL_SHADOW_CAMPAIGN',
'candidateVerified':True,
'qualificationVerified':True,
'passportVerified':True,
'trainingCount':8,
'holdoutCount':4,
'shadowCount':10,
'shadowMismatchCount':0,
'qualifiedRoutingCount':12,
'authorityExpansionCount':0,
'externalEffectsExecuted':0,
'explicitActivationRequired':True,
'promotionCeiling':'limited-revocable',
'driftReason':'TOOLCHAIN_DRIFT',
'postDriftRoute':'FULL_GOVERNED_WORKFLOW',
'postDriftReason':'REVOKED',
'fallbackRoute':'FULL_GOVERNED_WORKFLOW',
'productionPromotion':'blocked',
}
for k,v in expected.items():
 if proof.get(k)!=v: errors.append(f'proof_metric_invalid:{k}')
benefit=proof.get('simulatedBenefit',{})
for k,min_value in [('costReductionPercent',70),('durationReductionPercent',70),('userStepReductionPercent',70)]:
 if not isinstance(benefit.get(k),(int,float)) or benefit[k] < min_value: errors.append(f'simulated_benefit_invalid:{k}')
required_limits={
'SIMULATED_LOCAL_SHADOW_CAMPAIGN_NOT_EXTERNAL_OR_CUSTOMER_EVIDENCE',
'SHORTCUT_ROUTE_DOES_NOT_EXECUTE_EXTERNAL_EFFECTS',
'BENEFIT_ESTIMATE_IS_STRUCTURAL_NOT_HUMAN_OR_PRODUCTION_MEASUREMENT',
'ONE_WORKFLOW_CLASS_ONLY','NO_LIVE_DRIFT_MONITOR_SERVICE','NO_PRODUCTION_PROMOTION'}
if set(proof.get('limitations',[]))!=required_limits: errors.append('proof_limitations_invalid')
if len(trace.get('trainingObservationDigests',[]))!=8 or len(trace.get('holdoutObservationDigests',[]))!=4 or len(trace.get('shadowComparisonDigests',[]))!=10 or len(trace.get('routingDecisionDigests',[]))!=12: errors.append('trace_counts_invalid')
p=subprocess.run(['npm','run','verify:proof:v33.15'],cwd=ROOT,capture_output=True,text=True,timeout=120)
if p.returncode!=0 or '"valid": true' not in p.stdout: errors.append('signed_proof_invalid')
t=full.get('totals',{})
if full.get('status')!='passed' or (t.get('testFiles'),t.get('tests'),t.get('passed'),t.get('failed'))!=(200,1417,1417,0) or full.get('runnerExitCode')!=0 or full.get('timedOut') is not False or full.get('forceExitDisabled') is not True: errors.append('full_regression_invalid')
lanes=full.get('lanes',[])
if len(lanes)!=2 or (lanes[0].get('concurrency'),lanes[0].get('tests'),lanes[0].get('passed'),lanes[0].get('failed'))!=(4,1401,1401,0) or (lanes[1].get('concurrency'),lanes[1].get('tests'),lanes[1].get('passed'),lanes[1].get('failed'))!=(1,16,16,0): errors.append('test_lane_topology_invalid')
for field,digest in [('stdoutEvidence','stdoutSha256'),('stderrEvidence','stderrSha256')]:
 path=ROOT/str(full.get(field,''))
 if not path.is_file() or sha(path)!=full.get(digest): errors.append(f'{field}_invalid')
exitp=ROOT/str(full.get('exitEvidence',''))
if not exitp.is_file() or exitp.read_text().strip()!='0': errors.append('exit_receipt_invalid')
inv=truth.get('inventory',{})
if truth.get('status')!='passed' or truth.get('findings')!=[] or inv.get('sourceModules')!=202 or inv.get('testFiles')!=200: errors.append('truth_map_invalid')
m=arch.get('metrics',{})
if arch.get('status')!='PASS' or arch.get('findings')!=[] or (m.get('sourceCycleCount'),m.get('untestedSourceCount'),m.get('capabilityPathCount'),m.get('closedCapabilityPathCount'))!=(0,0,125,125): errors.append('architecture_invalid')
closures={x.get('capabilityId') for x in arch.get('capabilityClosure',[])}
for cid in ['proof-carrying-shortcut-qualification-v33.15','adaptive-shortcut-drift-revocation-v33.15']:
 if cid not in closures: errors.append(f'architecture_path_missing:{cid}')
if gates.get('version')!='33.15': errors.append('governance_version_invalid')
by={x.get('id'):x for x in gates.get('gates',[])}
if by.get('G6',{}).get('status')!='in-progress': errors.append('governance_status_invalid:G6')
finding=str(by.get('G6',{}).get('currentFinding','')).lower()
for marker in ['training','holdout','shadow','revocation','fallback','not customer','in progress']:
 if marker not in finding: errors.append(f'governance_boundary_missing:{marker}')
if capmap.get('version')!='33.15': errors.append('capability_map_version_invalid')
research=set(next((x.get('capabilities',[]) for x in capmap.get('layers',[]) if x.get('layer')=='research-labs'),[]))
for cap in ['proof-carrying-shortcut-candidate','separate-training-holdout-shadow-evidence','independent-shortcut-qualification','signed-shortcut-passport','explicit-limited-revocable-activation','authority-and-scope-preserving-routing','automatic-drift-revocation','full-governed-workflow-fallback']:
 if cap not in research: errors.append(f'capability_missing:{cap}')
prod=next((x.get('productionAuthority','') for x in capmap.get('layers',[]) if x.get('layer')=='research-labs'),'')
if not all(x in prod for x in ['none','no external effects','no production']): errors.append('research_production_authority_invalid')
if not errors:
 for cmd in [['npm','run','truth-map:v32.18'],['npm','run','architecture:v32']]:
  p=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,timeout=180)
  if p.returncode!=0: errors.append('regeneration_failed:'+p.stdout[-800:]+p.stderr[-800:])
if not errors:
 rt=load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json');ra=load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
 if rt.get('inventory')!=truth.get('inventory') or rt.get('findings')!=truth.get('findings'): errors.append('truth_regeneration_mismatch')
 if ra.get('graphDigest')!=arch.get('graphDigest'): errors.append('architecture_regeneration_mismatch')
if not errors:
 names=['chat-mission-v33_1','mission-conversation-v33_2','device-push-v33_3','reliable-push-v33_4','push-adapter-qualification-v33_5','human-pilot-readiness-v33_6','controlled-pilot-and-market-v33_7','chat-engineering-vertical-v33_8','multi-file-engineering-campaign-v33_9','external-git-provider-qualification-v33_10','malicious-repository-admission-v33_11','qualified-hostile-code-isolation-v33_12','qualified-isolation-orchestration-v33_13','external-isolation-qualification-v33_14','proof-carrying-adaptive-execution-v33_15']
 p=subprocess.run(['node','--test','--test-concurrency=2',*[f'dist/tests/{n}.test.js' for n in names]],cwd=ROOT,capture_output=True,text=True,timeout=420)
 vals=[]
 for marker in ['tests','pass','fail']:
  q=re.search(rf'# {marker} (\d+)',p.stdout);vals.append(int(q.group(1)) if q else None)
 if p.returncode!=0 or tuple(vals)!=(250,250,0): errors.append(f'direct_v33_regression_invalid:{vals}:{p.returncode}')
if manifest.get('version')!='33.15' or manifest.get('status')!='release-candidate-local-adaptive-shadow-only' or manifest.get('productionPromotion')!='blocked' or manifest.get('externalEffects')!=0 or manifest.get('evidenceClass')!='SIMULATED_LOCAL_SHADOW_CAMPAIGN' or manifest.get('gates',{}).get('G6')!='in-progress-not-passed': errors.append('release_manifest_boundary_invalid')
for item in manifest.get('files',[]):
 path=ROOT/str(item.get('path',''))
 if not path.is_file() or path.stat().st_size!=item.get('sizeBytes') or sha(path)!=item.get('sha256'): errors.append(f"release_manifest_integrity_invalid:{item.get('path','')}")
result={'version':'33.15','status':'passed' if not errors else 'failed','gates':{'G0':'passed','G1':'passed','G2':'in-progress-not-passed','G3':'in-progress-not-passed','G4':'in-progress-not-passed','G5':'in-progress-not-passed','G6':'in-progress-not-passed'},'adaptiveExecution':{k:proof.get(k) for k in ['trainingCount','holdoutCount','shadowCount','shadowMismatchCount','qualifiedRoutingCount','authorityExpansionCount','externalEffectsExecuted','driftReason','postDriftRoute','postDriftReason']},'simulatedBenefit':benefit,'regression':t,'testLanes':lanes,'truthMap':{'sourceModules':inv.get('sourceModules'),'testFiles':inv.get('testFiles'),'findings':len(truth.get('findings',[]))},'architecture':{k:m.get(k) for k in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']},'errors':errors,'productionPromotion':'blocked'}
EVIDENCE.mkdir(parents=True,exist_ok=True);(EVIDENCE/'V33_15_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if not errors else 1)
