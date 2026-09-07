#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'release-evidence/v33.17'
REQUIRED=[
 'src/app/continuous-adaptive-control-service-v33_17.ts',
 'tests/continuous-adaptive-control-service-v33_17.test.ts',
 'scripts/continuous-adaptive-control-service-proof-v33_17.mjs',
 'scripts/verify-continuous-adaptive-control-service-v33_17.mjs',
 'scripts/run-full-regression-v33_17.py','scripts/run-full-regression-v33_17.sh',
 'scripts/run-direct-v33-regression-v33_17.py','scripts/run-direct-v33-regression-v33_17.sh',
 'scripts/validate-v33_17.py','docs/V33_17_CONTINUOUS_ADAPTIVE_CONTROL_SERVICE.md','CLAUDE_HANDOFF_v33_17.md',
 'v33/governance-state/PROOF_GATE_REGISTRY_V33.json','v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json','v33/governance-state/CONTRACT_REGISTRY_V33.json',
 'release-evidence/v33.17/V33_17_CONTINUOUS_ADAPTIVE_CONTROL_SERVICE_PROOF.json',
 'release-evidence/v33.17/V33_17_CONTINUOUS_CONTROL_TRACE.json','release-evidence/v33.17/V33_17_CONTROL_STORE_SNAPSHOT.json',
 'release-evidence/v33.17/V33_17_FULL_TEST_RESULTS.json','release-evidence/v33.17/V33_17_FULL_TEST_STDOUT.tap',
 'release-evidence/v33.17/V33_17_FULL_TEST_STDERR.log','release-evidence/v33.17/V33_17_FULL_TEST_EXIT.txt',
 'release-evidence/v33.17/V33_17_FULL_TEST_META.json','release-evidence/v33.17/V33_17_REPOSITORY_TRUTH_MAP.json',
 'release-evidence/v33.17/V33_17_ARCHITECTURE_INTEGRITY.json','release-evidence/v33.17/V33_17_DIRECT_V33_RESULTS.json','release-evidence/v33.17/V33_17_EXECUTION_LEDGER.md',
 'release-evidence/v33.17/V33_17_RELEASE_MANIFEST.json'
]
errors=[]
def phase(name): print(json.dumps({'phase':name}),flush=True)
def load(rel:str): return json.loads((ROOT/rel).read_text())
def sha(path:Path): return hashlib.sha256(path.read_bytes()).hexdigest()
for rel in REQUIRED:
 if not (ROOT/rel).is_file(): errors.append('missing:'+rel)
if errors:
 phase('result-write')
 result={'version':'33.17','status':'failed','errors':errors,'productionPromotion':'blocked'}
 EVIDENCE.mkdir(parents=True,exist_ok=True);(EVIDENCE/'V33_17_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result,indent=2));sys.exit(1)
phase('load-evidence');proof=load('release-evidence/v33.17/V33_17_CONTINUOUS_ADAPTIVE_CONTROL_SERVICE_PROOF.json')
trace=load('release-evidence/v33.17/V33_17_CONTINUOUS_CONTROL_TRACE.json')
snapshot=load('release-evidence/v33.17/V33_17_CONTROL_STORE_SNAPSHOT.json')
full=load('release-evidence/v33.17/V33_17_FULL_TEST_RESULTS.json')
truth=load('release-evidence/v33.17/V33_17_REPOSITORY_TRUTH_MAP.json')
arch=load('release-evidence/v33.17/V33_17_ARCHITECTURE_INTEGRITY.json')
gates=load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json')
capmap=load('v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json')
contracts=load('v33/governance-state/CONTRACT_REGISTRY_V33.json')
manifest=load('release-evidence/v33.17/V33_17_RELEASE_MANIFEST.json')
expected={
 'status':'CONTINUOUS_ADAPTIVE_CONTROL_SERVICE_PROVEN_LOCALLY','evidenceClass':'LOCAL_ACCELERATED_CONTINUOUS_CONTROL_SOAK',
 'virtualSoakDurationSeconds':90,'completedCycleCount':90,'validSignedReceiptCount':90,'uniqueCycleCount':90,
 'uniqueScheduleSlotCount':90,'crashRecoveryCount':1,'crashObserved':True,'staleFenceRejected':True,
 'secondControllerRejected':True,'fenceTransitions':3,'serviceRestartCount':1,'leaseRenewalCount':8,
 'driftRevocationCount':1,'fallbackReceiptCount':90,'authorityExpansionCount':0,'externalEffectsExecuted':0,
 'eventChainLength':194,'productionPromotion':'blocked'}
for k,v in expected.items():
 if proof.get(k)!=v: errors.append('proof_metric_invalid:'+k)
limits={
 'LOCAL_ACCELERATED_SOAK_NOT_REAL_TIME_DAEMON_EVIDENCE','SINGLE_HOST_FILE_STORE_NOT_DISTRIBUTED_CONSENSUS',
 'LOCAL_WALL_CLOCK_WITH_ROLLBACK_REJECTION_NOT_EXTERNAL_MONOTONIC_WITNESS','SIGNED_LOCAL_SCHEDULER_NOT_EXTERNAL_ORCHESTRATOR',
 'SHORTCUTS_REMAIN_SHADOW_ONLY','NO_EXTERNAL_EFFECTS_OR_PRODUCTION_AUTHORITY'}
if set(proof.get('limitations',[]))!=limits: errors.append('proof_limitations_invalid')
if len(trace.get('receiptDigests',[]))!=90 or len(trace.get('cycleDigests',[]))!=90: errors.append('trace_counts_invalid')
if snapshot.get('version')!='33.17' or snapshot.get('externalEffectsExecuted')!=0: errors.append('snapshot_invalid')
phase('verify-proof-start');p=subprocess.run(['npm','run','verify:proof:v33.17'],cwd=ROOT,capture_output=True,text=True,timeout=180)
phase('verify-proof-done');
if p.returncode!=0 or '"valid": true' not in p.stdout: errors.append('signed_proof_invalid')
t=full.get('totals',{})
if full.get('status')!='passed' or (t.get('testFiles'),t.get('tests'),t.get('passed'),t.get('failed'))!=(202,1455,1455,0): errors.append('full_regression_invalid')
if full.get('runnerExitCode')!=0 or full.get('timedOut') is not False or full.get('forceExitDisabled') is not True or full.get('retry') is not False: errors.append('full_runner_contract_invalid')
if full.get('topology')!='one-node-process-per-test-file-four-parallel-workers-seven-sensitive-sequential': errors.append('full_topology_invalid')
for field,digest in [('stdoutEvidence','stdoutSha256'),('stderrEvidence','stderrSha256')]:
 path=ROOT/str(full.get(field,''))
 if not path.is_file() or sha(path)!=full.get(digest): errors.append(field+'_invalid')
exitp=ROOT/str(full.get('exitEvidence',''))
if not exitp.is_file() or exitp.read_text().strip()!='0': errors.append('exit_receipt_invalid')
meta=load('release-evidence/v33.17/V33_17_FULL_TEST_META.json')
files=meta.get('files',[])
if meta.get('testFileCount')!=202 or len(files)!=202 or any(x.get('exitCode')!=0 or x.get('timedOut') for x in files): errors.append('per_file_exit_evidence_invalid')
inv=truth.get('inventory',{})
if truth.get('status')!='passed' or truth.get('findings')!=[] or inv.get('sourceModules')!=204 or inv.get('testFiles')!=202: errors.append('truth_map_invalid')
m=arch.get('metrics',{})
if arch.get('status')!='PASS' or arch.get('findings')!=[] or (m.get('sourceCycleCount'),m.get('untestedSourceCount'),m.get('capabilityPathCount'),m.get('closedCapabilityPathCount'))!=(0,0,129,129): errors.append('architecture_invalid')
closures={x.get('capabilityId') for x in arch.get('capabilityClosure',[])}
for cid in ['continuous-adaptive-control-service-v33.17','leased-fenced-crash-recoverable-adaptive-controller-v33.17']:
 if cid not in closures: errors.append('architecture_path_missing:'+cid)
if gates.get('version')!='33.17': errors.append('governance_version_invalid')
by={x.get('id'):x for x in gates.get('gates',[])}; g6=by.get('G6',{}); finding=str(g6.get('currentFinding','')).lower()
if g6.get('status')!='in-progress': errors.append('governance_status_invalid:G6')
for marker in ['signed local scheduler','single active controller','monotonic fencing','crash recovery','90-cycle','shadow-only','no external effects','in progress']:
 if marker not in finding: errors.append('governance_boundary_missing:'+marker)
if capmap.get('version')!='33.17': errors.append('capability_map_version_invalid')
research=set(next((x.get('capabilities',[]) for x in capmap.get('layers',[]) if x.get('layer')=='research-labs'),[]))
for cap in ['signed-continuous-adaptive-scheduler','leased-fenced-single-active-controller','crash-recoverable-drift-control-service','signed-cycle-receipts-and-full-fallback']:
 if cap not in research: errors.append('capability_missing:'+cap)
prod=next((x.get('productionAuthority','') for x in capmap.get('layers',[]) if x.get('layer')=='research-labs'),'').lower()
for marker in ['none','no production authority','shadow','signed human approval','no external effects']:
 if marker not in prod: errors.append('research_production_authority_missing:'+marker)
if contracts.get('version')!='33.17': errors.append('contract_registry_version_invalid')
contract_ids={x.get('id') for x in contracts.get('contracts',[])}
for cid in ['adaptive-control-lease-v33.17','adaptive-control-schedule-v33.17','adaptive-control-cycle-receipt-v33.17','adaptive-control-snapshot-v33.17']:
 if cid not in contract_ids: errors.append('contract_missing:'+cid)
# Regenerate source-derived evidence.
if not errors:
 phase('regeneration-start')
 for cmd in [['npm','run','truth-map:v32.18'],['npm','run','architecture:v32']]:
  p=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,timeout=300)
  if p.returncode!=0: errors.append('regeneration_failed:'+p.stdout[-500:]+p.stderr[-500:])
phase('regeneration-done')
if not errors:
 rt=load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json'); ra=load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
 if rt.get('inventory')!=truth.get('inventory') or rt.get('findings')!=truth.get('findings'): errors.append('truth_regeneration_mismatch')
 if ra.get('graphDigest')!=arch.get('graphDigest'): errors.append('architecture_regeneration_mismatch')
# Direct V33 evidence is derived from the same authoritative per-file process receipts.
direct=load('release-evidence/v33.17/V33_17_DIRECT_V33_RESULTS.json'); dt=direct.get('totals',{})
if direct.get('status')!='passed' or direct.get('independentProcessPerFile') is not True or direct.get('retry') is not False or direct.get('forceExit') is not False or (dt.get('testFiles'),dt.get('tests'),dt.get('passed'),dt.get('failed'))!=(17,288,288,0): errors.append('direct_v33_results_invalid')
phase('manifest-check-start')
# Manifest covers every listed file and is not self-referential.
for item in manifest.get('files',[]):
 path=ROOT/str(item.get('path',''))
 if not path.is_file() or path.stat().st_size!=item.get('sizeBytes') or sha(path)!=item.get('sha256'): errors.append('manifest_file_invalid:'+str(item.get('path')))
if manifest.get('version')!='33.17' or manifest.get('externalEffects')!=0 or manifest.get('productionPromotion')!='blocked': errors.append('manifest_boundary_invalid')
phase('result-write')
result={
 'version':'33.17','status':'passed' if not errors else 'failed','evidenceClass':proof.get('evidenceClass'),
 'gates':{'G0':'passed','G1':'passed','G2':'in-progress-not-passed','G3':'in-progress-not-passed','G4':'in-progress-not-passed','G5':'in-progress-not-passed','G6':'in-progress-not-passed'},
 'continuousControl':{k:proof.get(k) for k in ['completedCycleCount','validSignedReceiptCount','crashRecoveryCount','staleFenceRejected','secondControllerRejected','fenceTransitions','serviceRestartCount','leaseRenewalCount','driftRevocationCount','fallbackReceiptCount','authorityExpansionCount','externalEffectsExecuted','eventChainLength']},
 'regression':t,'directV33':{'testFiles':17,'tests':288,'passed':288,'failed':0},
 'truthMap':{'sourceModules':inv.get('sourceModules'),'testFiles':inv.get('testFiles'),'findings':len(truth.get('findings',[]))},
 'architecture':{k:m.get(k) for k in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']},
 'errors':errors,'productionPromotion':'blocked'}
EVIDENCE.mkdir(parents=True,exist_ok=True);(EVIDENCE/'V33_17_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2));sys.exit(0 if not errors else 1)
