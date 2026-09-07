#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'release-evidence/v33.14'
REQUIRED=[
'src/isolation/external-isolation-qualification-v33_14.ts','tests/external-isolation-qualification-v33_14.test.ts','scripts/external-isolation-qualification-proof-v33_14.mjs','scripts/run-full-regression-v33_14.sh','scripts/validate-v33_14.py','docs/V33_14_EXTERNAL_ISOLATION_QUALIFICATION_KIT.md','external-qualification/v33.14/README.md','CLAUDE_HANDOFF_v33_14.md','v33/governance-state/PROOF_GATE_REGISTRY_V33.json','v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json','release-evidence/v33.14/V33_14_EXTERNAL_ISOLATION_QUALIFICATION_PROOF.json','release-evidence/v33.14/V33_14_EXTERNAL_QUALIFICATION_TRACE.json','release-evidence/v33.14/V33_14_EXTERNAL_QUALIFICATION_CHALLENGE.json','release-evidence/v33.14/V33_14_FULL_TEST_RESULTS.json','release-evidence/v33.14/V33_14_FULL_TEST_STDOUT.tap','release-evidence/v33.14/V33_14_FULL_TEST_STDERR.log','release-evidence/v33.14/V33_14_FULL_TEST_EXIT.txt','release-evidence/v33.14/V33_14_FULL_TEST_META.json','release-evidence/v33.14/V33_14_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.14/V33_14_ARCHITECTURE_INTEGRITY.json','release-evidence/v33.14/V33_14_EXECUTION_LEDGER.md','release-evidence/v33.14/V33_14_RELEASE_MANIFEST.json']
errors=[]
for rel in REQUIRED:
 if not (ROOT/rel).is_file(): errors.append(f'missing:{rel}')
def load(rel): return json.loads((ROOT/rel).read_text())
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
if errors:
 print(json.dumps({'version':'33.14','status':'failed','errors':errors},indent=2));sys.exit(1)
proof=load('release-evidence/v33.14/V33_14_EXTERNAL_ISOLATION_QUALIFICATION_PROOF.json')
full=load('release-evidence/v33.14/V33_14_FULL_TEST_RESULTS.json')
truth=load('release-evidence/v33.14/V33_14_REPOSITORY_TRUTH_MAP.json')
arch=load('release-evidence/v33.14/V33_14_ARCHITECTURE_INTEGRITY.json')
gates=load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json')
capmap=load('v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json')
manifest=load('release-evidence/v33.14/V33_14_RELEASE_MANIFEST.json')
expected={'status':'EXECUTED_LOCAL_PROBES_AND_EXTERNAL_KIT_READY','evidenceClass':'LOCAL_EXECUTED_CONTROLS_AND_SYNTHETIC_CONTRACT_TEST','controlAttestationVerified':True,'openat2State':'VERIFIED_UNAVAILABLE','seccompState':'VERIFIED_UNAVAILABLE','cgroupV2State':'VERIFIED_UNAVAILABLE','secondRuntimeEvidenceVerified':True,'secondRuntimeState':'SPECIALIZED_REFERENCE_QUALIFIED','secondRuntimeScope':'PORTABLE_WASM_CHALLENGES_ONLY','generalRepositorySecondRuntimeQualified':False,'emptyExternalVerdictVerified':True,'emptyExternalVerdictStatus':'EXTERNAL_QUALIFICATION_REQUIRED','syntheticExternalVerdictVerified':True,'syntheticExternalVerdictStatus':'EXTERNAL_QUALIFICATION_REQUIRED','syntheticObservationsExcluded':True,'requiredDistinctHosts':2,'requiredDistinctOrganizations':2,'requiredDistinctRuntimeImplementations':2,'externalObservedEvidenceCount':0,'externalQualification':'not_executed','promotionCeiling':'research','productionPromotion':'blocked'}
for k,v in expected.items():
 if proof.get(k)!=v: errors.append(f'proof_metric_invalid:{k}')
required_limits={'OPENAT2_EXECUTED_PROBE_NOT_AVAILABLE_ON_CURRENT_KERNEL','SECCOMP_EXECUTED_PROBE_NOT_AVAILABLE_ON_CURRENT_HOST','CGROUP_V2_DELEGATION_NOT_AVAILABLE','WASM_SECOND_RUNTIME_IS_SPECIALIZED_NOT_GENERAL_REPOSITORY_RUNTIME','NO_SECOND_EXTERNAL_HOST','NO_EXTERNAL_INDEPENDENT_WITNESS','SYNTHETIC_CONTRACT_TESTS_DO_NOT_QUALIFY_EXTERNAL_GATE'}
if set(proof.get('limitations',[]))!=required_limits: errors.append('proof_limitations_invalid')
t=full.get('totals',{})
if full.get('status')!='passed' or (t.get('testFiles'),t.get('tests'),t.get('passed'),t.get('failed'))!=(199,1401,1401,0) or full.get('runnerExitCode')!=0 or full.get('timedOut') is not False or full.get('forceExitDisabled') is not True: errors.append('full_regression_invalid')
for field,digest in [('stdoutEvidence','stdoutSha256'),('stderrEvidence','stderrSha256')]:
 p=ROOT/str(full.get(field,''))
 if not p.is_file() or sha(p)!=full.get(digest): errors.append(f'{field}_invalid')
exitp=ROOT/str(full.get('exitEvidence',''))
if not exitp.is_file() or exitp.read_text().strip()!='0': errors.append('exit_receipt_invalid')
inv=truth.get('inventory',{})
if truth.get('status')!='passed' or truth.get('findings')!=[] or inv.get('sourceModules')!=201 or inv.get('testFiles')!=199: errors.append('truth_map_invalid')
m=arch.get('metrics',{})
if arch.get('status')!='PASS' or arch.get('findings')!=[] or (m.get('sourceCycleCount'),m.get('untestedSourceCount'),m.get('capabilityPathCount'),m.get('closedCapabilityPathCount'))!=(0,0,123,123): errors.append('architecture_invalid')
closures={x.get('capabilityId') for x in arch.get('capabilityClosure',[])}
for cid in ['executed-isolation-control-probes-v33.14','external-isolation-qualification-kit-v33.14']:
 if cid not in closures: errors.append(f'architecture_path_missing:{cid}')
if gates.get('version')!='33.14': errors.append('governance_version_invalid')
by={x.get('id'):x for x in gates.get('gates',[])}
for gid in ('G4','G5'):
 if by.get(gid,{}).get('status')!='in-progress': errors.append(f'governance_status_invalid:{gid}')
findings=' '.join(str(by.get(g,{}).get('currentFinding','')).lower() for g in ('G4','G5'))
for marker in ['openat2','seccomp','cgroup v2','wasm','two','production remains blocked']:
 if marker not in findings: errors.append(f'governance_boundary_missing:{marker}')
if capmap.get('version')!='33.14': errors.append('capability_map_version_invalid')
eng=set(next((x.get('capabilities',[]) for x in capmap.get('layers',[]) if x.get('layer')=='engineering-pack'),[]))
for cap in ['executed-openat2-seccomp-cgroup-control-probes','signed-executed-host-control-attestation','specialized-portable-wasm-second-runtime','two-host-two-organization-two-runtime-external-challenge','independent-external-isolation-observation-contract','synthetic-evidence-exclusion-from-external-qualification']:
 if cap not in eng: errors.append(f'capability_missing:{cap}')
if not errors:
 for cmd in [['npm','run','truth-map:v32.18'],['npm','run','architecture:v32']]:
  p=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True)
  if p.returncode!=0: errors.append('regeneration_failed:'+p.stdout[-800:]+p.stderr[-800:])
if not errors:
 rt=load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json');ra=load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
 if rt.get('inventory')!=truth.get('inventory') or rt.get('findings')!=truth.get('findings'): errors.append('truth_regeneration_mismatch')
 if ra.get('graphDigest')!=arch.get('graphDigest'): errors.append('architecture_regeneration_mismatch')
if not errors:
 names=['chat-mission-v33_1','mission-conversation-v33_2','device-push-v33_3','reliable-push-v33_4','push-adapter-qualification-v33_5','human-pilot-readiness-v33_6','controlled-pilot-and-market-v33_7','chat-engineering-vertical-v33_8','multi-file-engineering-campaign-v33_9','external-git-provider-qualification-v33_10','malicious-repository-admission-v33_11','qualified-hostile-code-isolation-v33_12','qualified-isolation-orchestration-v33_13','external-isolation-qualification-v33_14']
 p=subprocess.run(['node','--test','--test-concurrency=2',*[f'dist/tests/{n}.test.js' for n in names]],cwd=ROOT,capture_output=True,text=True,timeout=420)
 vals=[]
 for marker in ['tests','pass','fail']:
  q=re.search(rf'# {marker} (\d+)',p.stdout);vals.append(int(q.group(1)) if q else None)
 if p.returncode!=0 or tuple(vals)!=(234,234,0): errors.append(f'direct_v33_regression_invalid:{vals}:{p.returncode}')
if manifest.get('version')!='33.14' or manifest.get('status')!='release-candidate-external-kit-only' or manifest.get('productionPromotion')!='blocked' or manifest.get('externalQualification')!='not_executed' or manifest.get('externalObservedEvidenceCount')!=0 or manifest.get('generalRepositorySecondRuntimeQualified') is not False: errors.append('release_manifest_boundary_invalid')
for item in manifest.get('files',[]):
 p=ROOT/str(item.get('path',''))
 if not p.is_file() or p.stat().st_size!=item.get('sizeBytes') or sha(p)!=item.get('sha256'): errors.append(f"release_manifest_integrity_invalid:{item.get('path','')}")
result={'version':'33.14','status':'passed' if not errors else 'failed','gates':{'G0':'passed','G1':'passed','G2':'in-progress-not-passed','G3':'in-progress-not-passed','G4':'in-progress-not-passed','G5':'in-progress-not-passed'},'executedControls':{k:proof.get(k) for k in ['openat2State','seccompState','cgroupV2State','secondRuntimeState','secondRuntimeScope']},'externalQualification':{'status':proof.get('emptyExternalVerdictStatus'),'observedEvidenceCount':proof.get('externalObservedEvidenceCount'),'syntheticExcluded':proof.get('syntheticObservationsExcluded')},'regression':t,'truthMap':{'sourceModules':inv.get('sourceModules'),'testFiles':inv.get('testFiles'),'findings':len(truth.get('findings',[]))},'architecture':{k:m.get(k) for k in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']},'errors':errors,'productionPromotion':'blocked'}
EVIDENCE.mkdir(parents=True,exist_ok=True);(EVIDENCE/'V33_14_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if not errors else 1)
