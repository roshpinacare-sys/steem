#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; E=ROOT/'release-evidence/v33.18'; errors=[]
def load(rel): return json.loads((ROOT/rel).read_text())
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def phase(x): print(json.dumps({'phase':x}),flush=True)
required=[
'src/app/distributed-lease-authority-v33_18.ts','tests/distributed-lease-authority-v33_18.test.ts','scripts/distributed-lease-client-v33_18.mjs','scripts/distributed-lease-authority-proof-v33_18.mjs','scripts/verify-distributed-lease-authority-v33_18.mjs','scripts/run-full-regression-v33_18.py','scripts/run-direct-v33-regression-v33_18.py','docs/V33_18_DISTRIBUTED_LEASE_AUTHORITY_QUALIFICATION.md','CLAUDE_HANDOFF_v33_18.md',
'release-evidence/v33.18/V33_18_DISTRIBUTED_LEASE_AUTHORITY_PROOF.json','release-evidence/v33.18/V33_18_DISTRIBUTED_LEASE_TRACE.json','release-evidence/v33.18/V33_18_LEASE_AUTHORITY_SNAPSHOT.json','release-evidence/v33.18/V33_18_BACKEND_PROBES.json','release-evidence/v33.18/V33_18_FULL_TEST_RESULTS.json','release-evidence/v33.18/V33_18_FULL_TEST_META.json','release-evidence/v33.18/V33_18_FULL_TEST_STDOUT.tap','release-evidence/v33.18/V33_18_FULL_TEST_STDERR.log','release-evidence/v33.18/V33_18_FULL_TEST_EXIT.txt','release-evidence/v33.18/V33_18_DIRECT_V33_RESULTS.json','release-evidence/v33.18/V33_18_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.18/V33_18_ARCHITECTURE_INTEGRITY.json','release-evidence/v33.18/V33_18_EXECUTION_LEDGER.md','release-evidence/v33.18/V33_18_RELEASE_MANIFEST.json']
for rel in required:
 if not (ROOT/rel).is_file(): errors.append('missing:'+rel)
phase('load')
proof=load('release-evidence/v33.18/V33_18_DISTRIBUTED_LEASE_AUTHORITY_PROOF.json'); trace=load('release-evidence/v33.18/V33_18_DISTRIBUTED_LEASE_TRACE.json'); snapshot=load('release-evidence/v33.18/V33_18_LEASE_AUTHORITY_SNAPSHOT.json'); probes=load('release-evidence/v33.18/V33_18_BACKEND_PROBES.json'); full=load('release-evidence/v33.18/V33_18_FULL_TEST_RESULTS.json'); meta=load('release-evidence/v33.18/V33_18_FULL_TEST_META.json'); direct=load('release-evidence/v33.18/V33_18_DIRECT_V33_RESULTS.json'); truth=load('release-evidence/v33.18/V33_18_REPOSITORY_TRUTH_MAP.json'); arch=load('release-evidence/v33.18/V33_18_ARCHITECTURE_INTEGRITY.json'); manifest=load('release-evidence/v33.18/V33_18_RELEASE_MANIFEST.json')
expected={'controllerProcessCount':2,'raceWinnerCount':1,'takeoverCount':12,'staleFenceRejectionCount':12,'partitionFailureObserved':True,'authorityRestartCount':2,'rollbackRejectedByMonotonicWitness':True,'finalFenceToken':13,'externalEffectsExecuted':0,'productionAuthority':'NONE','productionPromotion':'blocked'}
for k,v in expected.items():
 if proof.get(k)!=v: errors.append('proof:'+k)
if proof.get('durableOutboxEventCount',0)<25 or proof.get('durableOutboxAcknowledgementCount')!=proof.get('durableOutboxEventCount'): errors.append('outbox_proof_invalid')
if trace.get('finalFenceToken')!=13 or len(trace.get('events',[]))!=13: errors.append('trace_invalid')
if snapshot.get('fenceCounter')!=13 or snapshot.get('productionAuthority')!='NONE' or snapshot.get('externalEffectsExecuted')!=0: errors.append('snapshot_invalid')
if len(probes)!=3 or any(x.get('status')!='UNAVAILABLE_FAIL_CLOSED' or x.get('productionAuthority')!='NONE' for x in probes): errors.append('backend_probe_boundary_invalid')
ft=full.get('totals',{})
if full.get('status')!='passed' or (ft.get('testFiles'),ft.get('tests'),ft.get('passed'),ft.get('failed'))!=(203,1475,1475,0) or full.get('runnerExitCode')!=0 or full.get('timedOut') is not False or full.get('retry') is not False or full.get('forceExitDisabled') is not True: errors.append('full_regression_invalid')
if (ROOT/'release-evidence/v33.18/V33_18_FULL_TEST_EXIT.txt').read_text().strip()!='0': errors.append('full_exit_invalid')
if meta.get('testFileCount')!=203 or meta.get('exitCode')!=0 or meta.get('timedOut') is not False: errors.append('full_meta_invalid')
dt=direct.get('totals',{})
if direct.get('status')!='passed' or direct.get('independentProcessPerFile') is not True or (dt.get('testFiles'),dt.get('tests'),dt.get('passed'),dt.get('failed'))!=(18,308,308,0): errors.append('direct_v33_invalid')
inv=truth.get('inventory',{});m=arch.get('metrics',{})
if truth.get('status')!='passed' or truth.get('findings') or (inv.get('sourceModules'),inv.get('testFiles'))!=(205,203): errors.append('truth_invalid')
if arch.get('status')!='PASS' or arch.get('findings') or (m.get('sourceCycleCount'),m.get('untestedSourceCount'),m.get('capabilityPathCount'),m.get('closedCapabilityPathCount'))!=(0,0,131,131): errors.append('architecture_invalid')
phase('verify-proof')
p=subprocess.run(['node','scripts/verify-distributed-lease-authority-v33_18.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=60)
if p.returncode!=0: errors.append('proof_verifier_failed')
phase('regenerate')
p=subprocess.run(['node','scripts/repository-truth-map-v32_18.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=120)
q=subprocess.run(['node','scripts/architecture-validation-v32.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=120)
if p.returncode or q.returncode: errors.append('regeneration_failed')
else:
 rt=load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json');ra=load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
 if rt.get('inventory')!=truth.get('inventory') or rt.get('findings')!=truth.get('findings'): errors.append('truth_regeneration_mismatch')
 if ra.get('graphDigest')!=arch.get('graphDigest'): errors.append('architecture_regeneration_mismatch')
phase('manifest')
for item in manifest.get('files',[]):
 path=ROOT/str(item.get('path',''))
 if not path.is_file() or path.stat().st_size!=item.get('sizeBytes') or sha(path)!=item.get('sha256'): errors.append('manifest_file_invalid:'+str(item.get('path')))
if manifest.get('version')!='33.18' or manifest.get('externalEffects')!=0 or manifest.get('productionPromotion')!='blocked': errors.append('manifest_boundary_invalid')
result={'version':'33.18','status':'passed' if not errors else 'failed','evidenceClass':proof.get('evidenceClass'),'gates':{'G0':'passed','G1':'passed','G2':'in-progress-not-passed','G3':'in-progress-not-passed','G4':'in-progress-not-passed','G5':'in-progress-not-passed','G6':'in-progress-not-passed'},'distributedLease':{k:proof.get(k) for k in expected}|{'durableOutboxEventCount':proof.get('durableOutboxEventCount'),'durableOutboxAcknowledgementCount':proof.get('durableOutboxAcknowledgementCount')},'regression':ft,'directV33':dt,'truthMap':{'sourceModules':inv.get('sourceModules'),'testFiles':inv.get('testFiles'),'findings':len(truth.get('findings',[]))},'architecture':{k:m.get(k) for k in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']},'errors':errors,'productionPromotion':'blocked'}
E.mkdir(parents=True,exist_ok=True);(E/'V33_18_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if not errors else 1)
