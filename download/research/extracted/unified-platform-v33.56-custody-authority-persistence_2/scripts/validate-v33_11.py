#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
REQ=['src/repository/malicious-repository-admission-v33_11.ts','tests/malicious-repository-admission-v33_11.test.ts','scripts/malicious-repository-admission-proof-v33_11.mjs','scripts/run-full-regression-v33_11.sh','scripts/validate-v33_11.py','docs/V33_11_MALICIOUS_REPOSITORY_ADMISSION.md','CLAUDE_HANDOFF_v33_11.md','v33/governance-state/PROOF_GATE_REGISTRY_V33.json','v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json','release-evidence/v33.11/V33_11_MALICIOUS_REPOSITORY_ADMISSION_PROOF.json','release-evidence/v33.11/V33_11_MALICIOUS_CORPUS_RESULTS.json','release-evidence/v33.11/V33_11_FULL_TEST_RESULTS.json','release-evidence/v33.11/V33_11_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.11/V33_11_ARCHITECTURE_INTEGRITY.json','release-evidence/v33.11/V33_11_EXECUTION_LEDGER.md','release-evidence/v33.11/V33_11_RELEASE_MANIFEST.json']
def load(r):return json.loads((ROOT/r).read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
e=[]
for r in REQ:
 if not (ROOT/r).is_file():e.append('missing:'+r)
if e:print(json.dumps({'version':'33.11','status':'failed','errors':e},indent=2));sys.exit(1)
proof=load('release-evidence/v33.11/V33_11_MALICIOUS_REPOSITORY_ADMISSION_PROOF.json');rows=load('release-evidence/v33.11/V33_11_MALICIOUS_CORPUS_RESULTS.json').get('results',[]);full=load('release-evidence/v33.11/V33_11_FULL_TEST_RESULTS.json');truth=load('release-evidence/v33.11/V33_11_REPOSITORY_TRUTH_MAP.json');arch=load('release-evidence/v33.11/V33_11_ARCHITECTURE_INTEGRITY.json');gates=load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json');caps=load('v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json');manifest=load('release-evidence/v33.11/V33_11_RELEASE_MANIFEST.json')
if proof.get('status')!='LOCAL_MALICIOUS_REPOSITORY_ADMISSION_CAMPAIGN_PASSED' or proof.get('evidenceClass')!='LOCAL_MALICIOUS_REPOSITORY_ADMISSION':e.append('proof_status_invalid')
for k,v in {'repositoryCount':20,'quarantinedRepositories':20,'signedReportsVerified':20,'sourceRepositoriesUnchanged':20,'findingKindsCovered':11,'commandsExecuted':0,'hooksExecuted':0,'filesModified':0,'externalEffectsExecuted':0,'qualifiedIsolationExecuted':False,'maliciousCodeExecuted':False,'g4Status':'in-progress-not-passed','productionPromotion':'blocked'}.items():
 if proof.get(k)!=v:e.append('proof_metric_invalid:'+k)
if len(rows)!=20:e.append('corpus_count_invalid')
for r in rows:
 if r.get('decision')!='QUARANTINE' or r.get('blockingFindingCount',0)<=0 or not r.get('signatureVerified') or not r.get('sourceUnchanged') or any(r.get(k)!=0 for k in ['commandsExecuted','hooksExecuted','filesModified','externalEffectsExecuted']):e.append('corpus_row_invalid:'+str(r.get('repositoryId')))
by={g.get('id'):g for g in gates.get('gates',[])}
if gates.get('version')!='33.11' or by.get('G4',{}).get('status')!='in-progress':e.append('governance_invalid')
f=by.get('G4',{}).get('currentFinding','').lower()
for m in ['twenty synthetic malicious repositories','zero execution','g4 remains in progress']:
 if m not in f:e.append('g4_truth_missing:'+m)
if caps.get('version')!='33.11':e.append('capmap_version_invalid')
eng=set(next((x.get('capabilities',[]) for x in caps.get('layers',[]) if x.get('layer')=='engineering-pack'),[]))
for c in ['signed-repository-admission-report','symlink-hook-submodule-quarantine','prompt-injection-secret-lifecycle-detection','native-binary-separate-qualification','bounded-repository-scan-budget','twenty-repository-malicious-corpus-campaign']:
 if c not in eng:e.append('capability_missing:'+c)
t=full.get('totals',{})
if full.get('status')!='passed' or (t.get('testFiles'),t.get('tests'),t.get('passed'),t.get('failed'))!=(196,1362,1362,0) or full.get('runnerExitCode')!=0 or full.get('timedOut') is not False or full.get('forceExitDisabled') is not True:e.append('regression_invalid')
for field,dig in [('stdoutEvidence','stdoutSha256'),('stderrEvidence','stderrSha256')]:
 p=ROOT/full.get(field,'')
 if not p.is_file() or sha(p)!=full.get(dig):e.append(field+'_invalid')
if not (ROOT/full.get('exitEvidence','')).is_file() or (ROOT/full.get('exitEvidence','')).read_text().strip()!='0':e.append('exit_receipt_invalid')
if truth.get('status')!='passed' or truth.get('findings')!=[] or truth.get('inventory',{}).get('sourceModules')!=197 or truth.get('inventory',{}).get('testFiles')!=196:e.append('truth_invalid')
m=arch.get('metrics',{})
if arch.get('status')!='PASS' or arch.get('findings')!=[] or (m.get('sourceCycleCount'),m.get('untestedSourceCount'),m.get('capabilityPathCount'),m.get('closedCapabilityPathCount'))!=(0,0,117,117):e.append('architecture_invalid')
closure={x.get('capabilityId') for x in arch.get('capabilityClosure',[])}
for c in ['repository-admission-firewall-v33.11','malicious-repository-corpus-v33.11']:
 if c not in closure:e.append('arch_path_missing:'+c)
if not e:
 for cmd in [['npm','run','truth-map:v32.18'],['npm','run','architecture:v32']]:
  p=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True)
  if p.returncode:e.append('regeneration_failed:'+p.stdout[-1200:]+p.stderr[-1200:])
if not e:
 rt=load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json');ra=load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
 if rt.get('inventory')!=truth.get('inventory') or rt.get('findings')!=truth.get('findings'):e.append('truth_regeneration_mismatch')
 if ra.get('graphDigest')!=arch.get('graphDigest'):e.append('architecture_regeneration_mismatch')
if not e:
 names=['chat-mission-v33_1','mission-conversation-v33_2','device-push-v33_3','reliable-push-v33_4','push-adapter-qualification-v33_5','human-pilot-readiness-v33_6','controlled-pilot-and-market-v33_7','chat-engineering-vertical-v33_8','multi-file-engineering-campaign-v33_9','external-git-provider-qualification-v33_10','malicious-repository-admission-v33_11']
 p=subprocess.run(['node','--test',*[f'dist/tests/{n}.test.js' for n in names]],cwd=ROOT,capture_output=True,text=True)
 vals=[]
 for marker in ['tests','pass','fail']:
  x=re.search(rf'# {marker} (\d+)',p.stdout);vals.append(int(x.group(1)) if x else None)
 if p.returncode or tuple(vals)!=(195,195,0):e.append('direct_v33_invalid')
if manifest.get('version')!='33.11' or manifest.get('status')!='release-candidate-shadow-only' or manifest.get('productionPromotion')!='blocked' or manifest.get('externalQualification')!='not_executed':e.append('manifest_boundary_invalid')
for row in manifest.get('files',[]):
 p=ROOT/row.get('path','')
 if not p.is_file() or p.stat().st_size!=row.get('sizeBytes') or sha(p)!=row.get('sha256'):e.append('manifest_integrity_invalid:'+row.get('path',''))
res={'version':'33.11','status':'passed' if not e else 'failed','gates':{'G0':'passed','G1':'passed','G2':'in-progress-not-passed','G3':'in-progress-not-passed','G4':'in-progress-not-passed'},'campaign':{k:proof.get(k) for k in ['repositoryCount','quarantinedRepositories','signedReportsVerified','sourceRepositoriesUnchanged','findingKindsCovered','commandsExecuted','hooksExecuted','externalEffectsExecuted','evidenceClass']},'regression':t,'architecture':{k:m.get(k) for k in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']},'errors':e,'qualifiedIsolationExecuted':False,'productionPromotion':'blocked','externalQualification':'not_executed'}
(ROOT/'release-evidence/v33.11/V33_11_VALIDATION.json').write_text(json.dumps(res,indent=2)+'\n');print(json.dumps(res,indent=2));sys.exit(0 if not e else 1)
