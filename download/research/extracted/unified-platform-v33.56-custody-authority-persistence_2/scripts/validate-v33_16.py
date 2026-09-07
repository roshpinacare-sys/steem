#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; EVIDENCE=ROOT/'release-evidence/v33.16'
REQUIRED=[
'src/app/persistent-adaptive-policy-controller-v33_16.ts','tests/persistent-adaptive-policy-controller-v33_16.test.ts',
'scripts/persistent-adaptive-policy-controller-proof-v33_16.mjs','scripts/verify-persistent-adaptive-policy-controller-v33_16.mjs','scripts/run-full-regression-v33_16.sh','scripts/run-direct-v33-regression-v33_16.sh','scripts/run-direct-v33-regression-v33_16.py','scripts/validate-v33_16.py',
'docs/V33_16_PERSISTENT_ADAPTIVE_POLICY_CONTROLLER.md','CLAUDE_HANDOFF_v33_16.md','v33/governance-state/PROOF_GATE_REGISTRY_V33.json','v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json','v33/governance-state/CONTRACT_REGISTRY_V33.json',
'release-evidence/v33.16/V33_16_PERSISTENT_ADAPTIVE_POLICY_CONTROLLER_PROOF.json','release-evidence/v33.16/V33_16_PERSISTENT_ADAPTIVE_CONTROLLER_TRACE.json','release-evidence/v33.16/V33_16_POLICY_STORE_SNAPSHOT.json',
'release-evidence/v33.16/V33_16_FULL_TEST_RESULTS.json','release-evidence/v33.16/V33_16_FULL_TEST_STDOUT.tap','release-evidence/v33.16/V33_16_FULL_TEST_STDERR.log','release-evidence/v33.16/V33_16_FULL_TEST_EXIT.txt','release-evidence/v33.16/V33_16_FULL_TEST_META.json',
'release-evidence/v33.16/V33_16_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.16/V33_16_ARCHITECTURE_INTEGRITY.json','release-evidence/v33.16/V33_16_EXECUTION_LEDGER.md','release-evidence/v33.16/V33_16_RELEASE_MANIFEST.json']
errors=[]
for rel in REQUIRED:
 if not (ROOT/rel).is_file(): errors.append(f'missing:{rel}')
def load(rel): return json.loads((ROOT/rel).read_text())
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
if errors:
 print(json.dumps({'version':'33.16','status':'failed','errors':errors},indent=2));sys.exit(1)
proof=load('release-evidence/v33.16/V33_16_PERSISTENT_ADAPTIVE_POLICY_CONTROLLER_PROOF.json');trace=load('release-evidence/v33.16/V33_16_PERSISTENT_ADAPTIVE_CONTROLLER_TRACE.json');snapshot=load('release-evidence/v33.16/V33_16_POLICY_STORE_SNAPSHOT.json');full=load('release-evidence/v33.16/V33_16_FULL_TEST_RESULTS.json');truth=load('release-evidence/v33.16/V33_16_REPOSITORY_TRUTH_MAP.json');arch=load('release-evidence/v33.16/V33_16_ARCHITECTURE_INTEGRITY.json');gates=load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json');capmap=load('v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json');contracts=load('v33/governance-state/CONTRACT_REGISTRY_V33.json');manifest=load('release-evidence/v33.16/V33_16_RELEASE_MANIFEST.json')
expected={'status':'PERSISTENT_MULTI_WORKFLOW_ADAPTIVE_CONTROLLER_PROVEN_LOCALLY','evidenceClass':'LOCAL_PERSISTENT_ADAPTIVE_CONTROLLER_CAMPAIGN','workflowClassCount':4,'registeredShortcutCount':6,'activeAfterCampaignCount':4,'revokedAfterCampaignCount':2,'pushApprovalCount':6,'qualifiedRouteCount':10,'cheapestEquivalentSelected':True,'budgetFallbackReason':'BUDGET_REJECTED','conflictFallbackReason':'CONFLICTING_RESULT_DIGESTS','driftRevocationCount':1,'postDriftRoute':'FULL_GOVERNED_WORKFLOW','mismatchDetected':True,'postMismatchRoute':'FULL_GOVERNED_WORKFLOW','authorityExpansionCount':0,'externalEffectsExecuted':0,'persistenceReopenVerified':True,'eventChainLength':46,'productionPromotion':'blocked'}
for k,v in expected.items():
 if proof.get(k)!=v: errors.append(f'proof_metric_invalid:{k}')
limits={'LOCAL_CAMPAIGN_NOT_CUSTOMER_OR_PRODUCTION_EVIDENCE','PUSH_APPROVAL_IS_SIGNED_LOCAL_CONTRACT_NOT_LIVE_DEVICE_DELIVERY','DRIFT_SWEEP_IS_EXPLICITLY_INVOKED_NOT_CONTINUOUS_DAEMON','SHORTCUTS_REMAIN_SHADOW_ONLY','NO_EXTERNAL_EFFECTS_OR_PRODUCTION_AUTHORITY'}
if set(proof.get('limitations',[]))!=limits: errors.append('proof_limitations_invalid')
savings=proof.get('measuredLocalSavings',{})
if not all(isinstance(savings.get(k),(int,float)) and savings[k]>0 for k in ['cost','duration','userSteps']): errors.append('measured_savings_invalid')
if len(trace.get('recordDigests',[]))!=6 or len(trace.get('eventDigests',[]))!=46 or len(trace.get('auditDigests',[]))!=11: errors.append('trace_counts_invalid')
if snapshot.get('version')!='33.16' or len(snapshot.get('records',[]))!=6 or len(snapshot.get('audits',[]))!=11 or len(snapshot.get('events',[]))!=46 or snapshot.get('externalEffectsExecuted')!=0: errors.append('snapshot_invalid')
p=subprocess.run(['npm','run','verify:proof:v33.16'],cwd=ROOT,capture_output=True,text=True,timeout=120)
if p.returncode!=0 or '"valid": true' not in p.stdout: errors.append('signed_proof_invalid')
t=full.get('totals',{})
if full.get('status')!='passed' or (t.get('testFiles'),t.get('tests'),t.get('passed'),t.get('failed'))!=(201,1435,1435,0) or full.get('runnerExitCode')!=0 or full.get('timedOut') is not False or full.get('forceExitDisabled') is not True: errors.append('full_regression_invalid')
lanes=full.get('lanes',[])
if len(lanes)!=4 or (lanes[0].get('name'),lanes[0].get('testFiles'),lanes[0].get('tests'),lanes[0].get('passed'),lanes[0].get('failed'))!=('legacy-core',198,1383,1383,0) or (lanes[1].get('name'),lanes[1].get('testFiles'),lanes[1].get('tests'),lanes[1].get('passed'),lanes[1].get('failed'))!=('git-fixture-v33.9',1,18,18,0) or (lanes[2].get('name'),lanes[2].get('testFiles'),lanes[2].get('tests'),lanes[2].get('passed'),lanes[2].get('failed'))!=('adaptive-v33.15',1,16,16,0) or (lanes[3].get('name'),lanes[3].get('testFiles'),lanes[3].get('tests'),lanes[3].get('passed'),lanes[3].get('failed'))!=('controller-v33.16',1,18,18,0): errors.append('test_lane_topology_invalid')
for field,digest in [('stdoutEvidence','stdoutSha256'),('stderrEvidence','stderrSha256')]:
 path=ROOT/str(full.get(field,''))
 if not path.is_file() or sha(path)!=full.get(digest): errors.append(f'{field}_invalid')
exitp=ROOT/str(full.get('exitEvidence',''))
if not exitp.is_file() or exitp.read_text().strip()!='0': errors.append('exit_receipt_invalid')
inv=truth.get('inventory',{})
if truth.get('status')!='passed' or truth.get('findings')!=[] or inv.get('sourceModules')!=203 or inv.get('testFiles')!=201: errors.append('truth_map_invalid')
m=arch.get('metrics',{})
if arch.get('status')!='PASS' or arch.get('findings')!=[] or (m.get('sourceCycleCount'),m.get('untestedSourceCount'),m.get('capabilityPathCount'),m.get('closedCapabilityPathCount'))!=(0,0,127,127): errors.append('architecture_invalid')
closures={x.get('capabilityId') for x in arch.get('capabilityClosure',[])}
for cid in ['persistent-adaptive-policy-controller-v33.16','budgeted-conflict-aware-adaptive-routing-v33.16']:
 if cid not in closures: errors.append(f'architecture_path_missing:{cid}')
if gates.get('version')!='33.16': errors.append('governance_version_invalid')
by={x.get('id'):x for x in gates.get('gates',[])}; finding=str(by.get('G6',{}).get('currentFinding','')).lower()
if by.get('G6',{}).get('status')!='in-progress': errors.append('governance_status_invalid:G6')
for marker in ['persistent','four','signed human approval','budget','conflicting','drift','mismatch','shadow-only','in progress']:
 if marker not in finding: errors.append(f'governance_boundary_missing:{marker}')
if capmap.get('version')!='33.16': errors.append('capability_map_version_invalid')
research=set(next((x.get('capabilities',[]) for x in capmap.get('layers',[]) if x.get('layer')=='research-labs'),[]))
for cap in ['persistent-signed-shortcut-policy-store','multi-workflow-adaptive-controller','human-push-approval-before-shortcut-activation','budgeted-cheapest-equivalent-shortcut-selection','conflicting-result-fail-closed-routing','continuous-drift-sweep-and-immediate-revocation','measured-local-savings-audit']:
 if cap not in research: errors.append(f'capability_missing:{cap}')
prod=next((x.get('productionAuthority','') for x in capmap.get('layers',[]) if x.get('layer')=='research-labs'),'')
if not all(x in prod for x in ['none','signed human approval','no external effects','no production']): errors.append('research_production_authority_invalid')
if contracts.get('version')!='33.16': errors.append('contract_registry_version_invalid')
contract_ids={x.get('id') for x in contracts.get('contracts',[])}
for cid in ['adaptive-policy-record-v33.16','adaptive-policy-snapshot-v33.16','adaptive-routing-decision-v33.16','adaptive-execution-audit-v33.16']:
 if cid not in contract_ids: errors.append(f'contract_missing:{cid}')
if not errors:
 for cmd in [['npm','run','truth-map:v32.18'],['npm','run','architecture:v32']]:
  p=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,timeout=240)
  if p.returncode!=0: errors.append('regeneration_failed:'+p.stdout[-800:]+p.stderr[-800:])
if not errors:
 rt=load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json');ra=load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
 if rt.get('inventory')!=truth.get('inventory') or rt.get('findings')!=truth.get('findings'): errors.append('truth_regeneration_mismatch')
 if ra.get('graphDigest')!=arch.get('graphDigest'): errors.append('architecture_regeneration_mismatch')
if not errors:
 p=subprocess.run(['bash','scripts/run-direct-v33-regression-v33_16.sh'],cwd=ROOT,capture_output=True,text=True,timeout=900)
 direct_path=ROOT/'.cache/v33.16-direct/V33_16_DIRECT_V33_RESULTS.json'
 if p.returncode!=0 or not direct_path.is_file(): errors.append(f'direct_v33_regression_failed:{p.returncode}:{p.stdout[-500:]}:{p.stderr[-500:]}')
 else:
  direct=json.loads(direct_path.read_text());dt=direct.get('totals',{})
  if direct.get('status')!='passed' or (dt.get('testFiles'),dt.get('tests'),dt.get('passed'),dt.get('failed'))!=(16,268,268,0) or direct.get('retry') is not False or direct.get('forceExit') is not False: errors.append('direct_v33_regression_invalid')
if manifest.get('version')!='33.16' or manifest.get('status')!='release-candidate-local-persistent-adaptive-shadow-only' or manifest.get('productionPromotion')!='blocked' or manifest.get('externalEffects')!=0 or manifest.get('evidenceClass')!='LOCAL_PERSISTENT_ADAPTIVE_CONTROLLER_CAMPAIGN' or manifest.get('gates',{}).get('G6')!='in-progress-not-passed': errors.append('release_manifest_boundary_invalid')
for item in manifest.get('files',[]):
 path=ROOT/str(item.get('path',''))
 if not path.is_file() or path.stat().st_size!=item.get('sizeBytes') or sha(path)!=item.get('sha256'): errors.append(f"release_manifest_integrity_invalid:{item.get('path','')}")
result={'version':'33.16','status':'passed' if not errors else 'failed','gates':{'G0':'passed','G1':'passed','G2':'in-progress-not-passed','G3':'in-progress-not-passed','G4':'in-progress-not-passed','G5':'in-progress-not-passed','G6':'in-progress-not-passed'},'adaptiveController':{k:proof.get(k) for k in ['workflowClassCount','registeredShortcutCount','activeAfterCampaignCount','revokedAfterCampaignCount','pushApprovalCount','qualifiedRouteCount','budgetFallbackReason','conflictFallbackReason','driftRevocationCount','postDriftRoute','mismatchDetected','postMismatchRoute','authorityExpansionCount','externalEffectsExecuted','eventChainLength']},'measuredLocalSavings':savings,'regression':t,'testLanes':lanes,'truthMap':{'sourceModules':inv.get('sourceModules'),'testFiles':inv.get('testFiles'),'findings':len(truth.get('findings',[]))},'architecture':{k:m.get(k) for k in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']},'errors':errors,'productionPromotion':'blocked'}
EVIDENCE.mkdir(parents=True,exist_ok=True);(EVIDENCE/'V33_16_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if not errors else 1)
