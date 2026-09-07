#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
E=ROOT/'release-evidence/v33.20'
errors=[]
def load(path:str): return json.loads((ROOT/path).read_text())
def sha(path:Path): return hashlib.sha256(path.read_bytes()).hexdigest()
def phase(name:str): print(json.dumps({'phase':name}),flush=True)
required=[
 'package.json','CLAUDE_HANDOFF_v33_20.md','docs/V33_20_EXTERNAL_DURABLE_AUTHORITY_AND_ENTERPRISE_IDENTITY.md',
 'src/app/external-durable-authority-v33_20.ts','src/cli/durable-lease-authority-daemon-v33_20.ts','tests/external-durable-authority-v33_20.test.ts',
 'scripts/external-durable-authority-proof-v33_20.mjs','scripts/verify-external-durable-authority-v33_20.mjs','scripts/run-full-regression-v33_20.py','scripts/run-direct-v33-regression-v33_20.py','scripts/validate-v33_20.py','scripts/architecture-validation-v32.mjs',
 'v33/governance-state/CONTRACT_REGISTRY_V33.json','v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json','v33/governance-state/PROOF_GATE_REGISTRY_V33.json',
 'release-evidence/v33.20/V33_20_EXTERNAL_DURABLE_AUTHORITY_PROOF.json','release-evidence/v33.20/V33_20_DURABLE_AUTHORITY_TRACE.json','release-evidence/v33.20/V33_20_DURABLE_AUTHORITY_SNAPSHOT.json','release-evidence/v33.20/V33_20_ENTERPRISE_IDENTITY_SNAPSHOT.json','release-evidence/v33.20/V33_20_INFRASTRUCTURE_PROBES.json','release-evidence/v33.20/V33_20_EXTERNAL_QUALIFICATION_CHALLENGE.json',
 'release-evidence/v33.20/V33_20_FULL_TEST_RESULTS.json','release-evidence/v33.20/V33_20_FULL_TEST_META.json','release-evidence/v33.20/V33_20_FULL_TEST_STDOUT.tap','release-evidence/v33.20/V33_20_FULL_TEST_STDERR.log','release-evidence/v33.20/V33_20_FULL_TEST_EXIT.txt','release-evidence/v33.20/V33_20_DIRECT_V33_RESULTS.json','release-evidence/v33.20/V33_20_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.20/V33_20_ARCHITECTURE_INTEGRITY.json','release-evidence/v33.20/V33_20_EXECUTION_LEDGER.md','release-evidence/v33.20/V33_20_RELEASE_MANIFEST.json'
]
for item in required:
 if not (ROOT/item).is_file(): errors.append('missing:'+item)
if errors:
 print(json.dumps({'version':'33.20','status':'failed','errors':errors},indent=2));sys.exit(1)
phase('load')
proof=load('release-evidence/v33.20/V33_20_EXTERNAL_DURABLE_AUTHORITY_PROOF.json');trace=load('release-evidence/v33.20/V33_20_DURABLE_AUTHORITY_TRACE.json');snapshot=load('release-evidence/v33.20/V33_20_DURABLE_AUTHORITY_SNAPSHOT.json');identities=load('release-evidence/v33.20/V33_20_ENTERPRISE_IDENTITY_SNAPSHOT.json');probes=load('release-evidence/v33.20/V33_20_INFRASTRUCTURE_PROBES.json');challenge=load('release-evidence/v33.20/V33_20_EXTERNAL_QUALIFICATION_CHALLENGE.json')
full=load('release-evidence/v33.20/V33_20_FULL_TEST_RESULTS.json');meta=load('release-evidence/v33.20/V33_20_FULL_TEST_META.json');direct=load('release-evidence/v33.20/V33_20_DIRECT_V33_RESULTS.json');truth=load('release-evidence/v33.20/V33_20_REPOSITORY_TRUTH_MAP.json');arch=load('release-evidence/v33.20/V33_20_ARCHITECTURE_INTEGRITY.json');manifest=load('release-evidence/v33.20/V33_20_RELEASE_MANIFEST.json')
phase('boundaries')
expected={'status':'EXTERNAL_DURABLE_AUTHORITY_REFERENCE_PROVEN_LOCALLY','evidenceClass':'LOCAL_SUPERVISORD_TWO_DAEMON_SQLITE_WAL_REFERENCE','managedAuthorityDaemonCount':2,'serviceManager':'SUPERVISORD','serviceManagerRestartProven':True,'sharedDurableBackend':'SQLITE_WAL','separateDurableWitness':'SEPARATE_SQLITE_WAL_REFERENCE','controllerRaceSingleWinner':True,'fenceBeforeRestart':1,'fenceAfterRestart':2,'enterpriseIdentityProvider':'LOCAL_ENTERPRISE_PKI_REFERENCE','workloadUriSanRequired':True,'enterpriseIdentityRotationCount':1,'oldIdentityRejectedAfterRotation':True,'authorityIntegrityVerified':True,'externalQualificationAccepted':False,'externalEffectsExecuted':0,'productionAuthority':'NONE','productionPromotion':'blocked'}
for k,v in expected.items():
 if proof.get(k)!=v: errors.append('proof:'+k)
if trace.get('evidenceClass')!='LOCAL_SUPERVISORD_TWO_DAEMON_SQLITE_WAL_REFERENCE' or len(trace.get('events',[]))!=6 or not trace.get('observerPublicKey'): errors.append('trace_invalid')
if snapshot.get('version')!='33.20' or snapshot.get('backend')!='SQLITE_WAL' or snapshot.get('fenceCounter')!=2 or len(snapshot.get('decisions',[]))!=3 or len(snapshot.get('outbox',[]))!=3 or len(snapshot.get('witnessReceipts',[]))!=1 or snapshot.get('productionAuthority')!='NONE': errors.append('authority_snapshot_invalid')
identity_items=identities.get('identities',[])
if identities.get('version')!='33.20' or identities.get('productionAuthority')!='NONE' or len(identity_items)!=3: errors.append('identity_snapshot_invalid')
else:
 statuses=sorted(x.get('payload',{}).get('status') for x in identity_items)
 if statuses!=['ACTIVE','ACTIVE','REVOKED']: errors.append('identity_statuses_invalid')
 if any(x.get('payload',{}).get('identityProvider')!='LOCAL_ENTERPRISE_PKI_REFERENCE' or x.get('payload',{}).get('spiffeSpireQualification')!='EXTERNAL_QUALIFICATION_REQUIRED' for x in identity_items): errors.append('identity_provider_boundary_invalid')
probe_by={x.get('component'):x for x in probes}
for component in ['SQLITE_WAL','SUPERVISORD']:
 if probe_by.get(component,{}).get('status')!='LOCAL_REFERENCE_QUALIFIED': errors.append('local_probe_missing:'+component)
for component in ['POSTGRESQL','ETCD','CONSUL','SYSTEMD','SPIFFE_SPIRE','NETEM']:
 if probe_by.get(component,{}).get('status')!='UNAVAILABLE_FAIL_CLOSED' or probe_by.get(component,{}).get('productionAuthority')!='NONE': errors.append('external_probe_boundary_invalid:'+component)
if challenge.get('version')!='33.20' or challenge.get('requiredIndependentHosts')!=2 or challenge.get('syntheticOrSingleHostEvidenceAccepted') is not False or challenge.get('productionAuthority')!='NONE': errors.append('external_challenge_invalid')
ft=full.get('totals',{})
if full.get('version')!='33.20' or full.get('status')!='passed' or (ft.get('testFiles'),ft.get('tests'),ft.get('passed'),ft.get('failed'))!=(205,1514,1514,0) or full.get('runnerExitCode')!=0 or full.get('timedOut') is not False or full.get('retry') is not False or full.get('forceExitDisabled') is not True: errors.append('full_regression_invalid')
if (E/'V33_20_FULL_TEST_EXIT.txt').read_text().strip()!='0': errors.append('full_exit_invalid')
if meta.get('version')!='33.20' or meta.get('testFileCount')!=205 or meta.get('exitCode')!=0 or meta.get('timedOut') is not False or meta.get('retry') is not False: errors.append('full_meta_invalid')
dt=direct.get('totals',{})
if direct.get('version')!='33.20' or direct.get('status')!='passed' or direct.get('independentProcessPerFile') is not True or (dt.get('testFiles'),dt.get('tests'),dt.get('passed'),dt.get('failed'))!=(20,347,347,0): errors.append('direct_v33_invalid')
inv=truth.get('inventory',{});m=arch.get('metrics',{})
if truth.get('status')!='passed' or truth.get('findings') or (inv.get('sourceModules'),inv.get('testFiles'))!=(209,205): errors.append('truth_invalid')
if arch.get('status')!='PASS' or arch.get('findings') or (m.get('sourceCycleCount'),m.get('untestedSourceCount'),m.get('capabilityPathCount'),m.get('closedCapabilityPathCount'))!=(0,0,135,135): errors.append('architecture_invalid')
phase('verify-proof')
p=subprocess.run(['node','scripts/verify-external-durable-authority-v33_20.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=90)
if p.returncode!=0: errors.append('proof_verifier_failed:'+p.stderr[-300:])
phase('regenerate')
p=subprocess.run(['node','scripts/repository-truth-map-v32_18.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=120);q=subprocess.run(['node','scripts/architecture-validation-v32.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=120)
if p.returncode or q.returncode: errors.append('regeneration_failed')
else:
 rt=load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json');ra=load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
 if rt.get('inventory')!=truth.get('inventory') or rt.get('findings')!=truth.get('findings'): errors.append('truth_regeneration_mismatch')
 if ra.get('graphDigest')!=arch.get('graphDigest'): errors.append('architecture_regeneration_mismatch')
phase('manifest')
for item in manifest.get('files',[]):
 path=ROOT/str(item.get('path',''))
 if not path.is_file() or path.stat().st_size!=item.get('sizeBytes') or sha(path)!=item.get('sha256'): errors.append('manifest_file_invalid:'+str(item.get('path')))
if manifest.get('version')!='33.20' or manifest.get('externalEffects')!=0 or manifest.get('productionPromotion')!='blocked' or manifest.get('evidenceClass')!='LOCAL_SUPERVISORD_TWO_DAEMON_SQLITE_WAL_REFERENCE': errors.append('manifest_boundary_invalid')
result={'version':'33.20','status':'passed' if not errors else 'failed','evidenceClass':proof.get('evidenceClass'),'gates':{'G0':'passed','G1':'passed','G2':'in-progress-not-passed','G3':'in-progress-not-passed','G4':'in-progress-not-passed','G5':'in-progress-not-passed','G6':'in-progress-not-passed'},'durableAuthority':{k:proof.get(k) for k in expected},'regression':ft,'directV33':dt,'truthMap':{'sourceModules':inv.get('sourceModules'),'testFiles':inv.get('testFiles'),'findings':len(truth.get('findings',[]))},'architecture':{k:m.get(k) for k in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']},'errors':errors,'productionPromotion':'blocked'}
E.mkdir(parents=True,exist_ok=True);(E/'V33_20_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if not errors else 1)
