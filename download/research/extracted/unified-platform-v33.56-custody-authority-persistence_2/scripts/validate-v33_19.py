#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
E=ROOT/'release-evidence/v33.19'
errors=[]

def load(path:str): return json.loads((ROOT/path).read_text())
def sha(path:Path): return hashlib.sha256(path.read_bytes()).hexdigest()
def phase(name:str): print(json.dumps({'phase':name}),flush=True)
required=[
 'package.json','CLAUDE_HANDOFF_v33_19.md','docs/V33_19_SEPARATE_PROCESS_MTLS_AUTHORITY.md',
 'src/app/separate-process-lease-authority-v33_19.ts','src/cli/lease-authority-daemon-v33_19.ts','tests/separate-process-lease-authority-v33_19.test.ts',
 'scripts/separate-process-lease-authority-proof-v33_19.mjs','scripts/verify-separate-process-lease-authority-v33_19.mjs',
 'scripts/run-full-regression-v33_19.py','scripts/run-direct-v33-regression-v33_19.py','scripts/validate-v33_19.py','scripts/architecture-validation-v32.mjs',
 'v33/governance-state/CONTRACT_REGISTRY_V33.json','v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json','v33/governance-state/PROOF_GATE_REGISTRY_V33.json',
 'release-evidence/v33.19/V33_19_SEPARATE_PROCESS_MTLS_AUTHORITY_PROOF.json','release-evidence/v33.19/V33_19_MTLS_AUTHORITY_TRACE.json',
 'release-evidence/v33.19/V33_19_CREDENTIAL_SNAPSHOT.json','release-evidence/v33.19/V33_19_SUPERVISOR_SNAPSHOT.json','release-evidence/v33.19/V33_19_BACKEND_SERVICE_MANAGER_PROBES.json',
 'release-evidence/v33.19/V33_19_FULL_TEST_RESULTS.json','release-evidence/v33.19/V33_19_FULL_TEST_META.json','release-evidence/v33.19/V33_19_FULL_TEST_STDOUT.tap','release-evidence/v33.19/V33_19_FULL_TEST_STDERR.log','release-evidence/v33.19/V33_19_FULL_TEST_EXIT.txt',
 'release-evidence/v33.19/V33_19_DIRECT_V33_RESULTS.json','release-evidence/v33.19/V33_19_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.19/V33_19_ARCHITECTURE_INTEGRITY.json','release-evidence/v33.19/V33_19_EXECUTION_LEDGER.md','release-evidence/v33.19/V33_19_RELEASE_MANIFEST.json'
]
for item in required:
 if not (ROOT/item).is_file(): errors.append('missing:'+item)
if errors:
 print(json.dumps({'version':'33.19','status':'failed','errors':errors},indent=2));sys.exit(1)
phase('load')
proof=load('release-evidence/v33.19/V33_19_SEPARATE_PROCESS_MTLS_AUTHORITY_PROOF.json')
trace=load('release-evidence/v33.19/V33_19_MTLS_AUTHORITY_TRACE.json')
creds=load('release-evidence/v33.19/V33_19_CREDENTIAL_SNAPSHOT.json')
supervisor=load('release-evidence/v33.19/V33_19_SUPERVISOR_SNAPSHOT.json')
probes=load('release-evidence/v33.19/V33_19_BACKEND_SERVICE_MANAGER_PROBES.json')
full=load('release-evidence/v33.19/V33_19_FULL_TEST_RESULTS.json');meta=load('release-evidence/v33.19/V33_19_FULL_TEST_META.json');direct=load('release-evidence/v33.19/V33_19_DIRECT_V33_RESULTS.json')
truth=load('release-evidence/v33.19/V33_19_REPOSITORY_TRUTH_MAP.json');arch=load('release-evidence/v33.19/V33_19_ARCHITECTURE_INTEGRITY.json');manifest=load('release-evidence/v33.19/V33_19_RELEASE_MANIFEST.json')
phase('boundaries')
expected={'status':'SEPARATE_PROCESS_MTLS_AUTHORITY_PROVEN_LOCALLY','evidenceClass':'LOCAL_SEPARATE_PROCESS_MTLS_AUTHORITY_REFERENCE','authorityDaemonProcessCount':1,'transport':'MUTUAL_TLS_1_3','applicationCommandSignatureRequired':True,'credentialRotationCount':1,'oldCredentialRejectedAfterRotation':True,'liveRevocationCount':1,'revokedCredentialRejectedWithoutRestart':True,'daemonCrashCount':1,'daemonRestartCount':1,'supervisorLifecycleReceiptCount':4,'supervisorReceiptChainValid':True,'fenceBeforeRestart':1,'fenceAfterRestart':2,'externalEffectsExecuted':0,'productionAuthority':'NONE','productionPromotion':'blocked'}
for k,v in expected.items():
 if proof.get(k)!=v: errors.append('proof:'+k)
if trace.get('evidenceClass')!='LOCAL_SEPARATE_PROCESS_MTLS_AUTHORITY_REFERENCE' or len(trace.get('events',[]))!=4: errors.append('trace_invalid')
credential_items=creds.get('credentials',[])
if creds.get('version')!='33.19' or creds.get('productionAuthority')!='NONE' or len(credential_items)!=3: errors.append('credential_snapshot_invalid')
else:
 statuses=sorted(x.get('payload',{}).get('status') for x in credential_items)
 if statuses!=['ACTIVE','REVOKED','REVOKED']: errors.append('credential_statuses_invalid')
if supervisor.get('version')!='33.19' or supervisor.get('restartGeneration')!=2 or len(supervisor.get('receipts',[]))!=4 or supervisor.get('productionAuthority')!='NONE': errors.append('supervisor_snapshot_invalid')
backends=probes.get('backends',[]); managers=probes.get('serviceManagers',[])
if len(backends)!=3 or any(x.get('status')!='UNAVAILABLE_FAIL_CLOSED' or x.get('productionAuthority')!='NONE' for x in backends): errors.append('backend_probe_boundary_invalid')
if not any(x.get('serviceManager')=='LOCAL_PROCESS_SUPERVISOR' and x.get('status')=='LOCAL_REFERENCE_AVAILABLE' for x in managers): errors.append('local_supervisor_probe_missing')
if not any(x.get('serviceManager')=='SYSTEMD' and x.get('status')=='UNAVAILABLE_FAIL_CLOSED' for x in managers): errors.append('systemd_probe_boundary_invalid')
ft=full.get('totals',{})
if full.get('version')!='33.19' or full.get('status')!='passed' or (ft.get('testFiles'),ft.get('tests'),ft.get('passed'),ft.get('failed'))!=(204,1492,1492,0) or full.get('runnerExitCode')!=0 or full.get('timedOut') is not False or full.get('retry') is not False or full.get('forceExitDisabled') is not True: errors.append('full_regression_invalid')
if (E/'V33_19_FULL_TEST_EXIT.txt').read_text().strip()!='0': errors.append('full_exit_invalid')
if meta.get('version')!='33.19' or meta.get('testFileCount')!=204 or meta.get('exitCode')!=0 or meta.get('timedOut') is not False: errors.append('full_meta_invalid')
dt=direct.get('totals',{})
if direct.get('version')!='33.19' or direct.get('status')!='passed' or direct.get('independentProcessPerFile') is not True or (dt.get('testFiles'),dt.get('tests'),dt.get('passed'),dt.get('failed'))!=(19,325,325,0): errors.append('direct_v33_invalid')
inv=truth.get('inventory',{});m=arch.get('metrics',{})
if truth.get('status')!='passed' or truth.get('findings') or (inv.get('sourceModules'),inv.get('testFiles'))!=(207,204): errors.append('truth_invalid')
if arch.get('status')!='PASS' or arch.get('findings') or (m.get('sourceCycleCount'),m.get('untestedSourceCount'),m.get('capabilityPathCount'),m.get('closedCapabilityPathCount'))!=(0,0,133,133): errors.append('architecture_invalid')
phase('verify-proof')
p=subprocess.run(['node','scripts/verify-separate-process-lease-authority-v33_19.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=60)
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
if manifest.get('version')!='33.19' or manifest.get('externalEffects')!=0 or manifest.get('productionPromotion')!='blocked': errors.append('manifest_boundary_invalid')
result={'version':'33.19','status':'passed' if not errors else 'failed','evidenceClass':proof.get('evidenceClass'),'gates':{'G0':'passed','G1':'passed','G2':'in-progress-not-passed','G3':'in-progress-not-passed','G4':'in-progress-not-passed','G5':'in-progress-not-passed','G6':'in-progress-not-passed'},'mtlsAuthority':{k:proof.get(k) for k in expected},'regression':ft,'directV33':dt,'truthMap':{'sourceModules':inv.get('sourceModules'),'testFiles':inv.get('testFiles'),'findings':len(truth.get('findings',[]))},'architecture':{k:m.get(k) for k in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']},'errors':errors,'productionPromotion':'blocked'}
E.mkdir(parents=True,exist_ok=True);(E/'V33_19_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if not errors else 1)
