#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
REQUIRED=[
 'src/repository/external-git-provider-qualification-v33_10.ts','tests/external-git-provider-qualification-v33_10.test.ts',
 'scripts/external-git-provider-qualification-proof-v33_10.mjs','scripts/run-full-regression-v33_10.sh','scripts/validate-v33_10.py','scripts/architecture-validation-v32.mjs',
 'docs/V33_10_EXTERNAL_GIT_PROVIDER_QUALIFICATION.md','v33/governance-state/PROOF_GATE_REGISTRY_V33.json','v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json',
 'release-evidence/v33.10/V33_10_EXTERNAL_GIT_PROVIDER_QUALIFICATION_PROOF.json','release-evidence/v33.10/V33_10_PROVIDER_REQUEST_TRACES.json',
 'release-evidence/v33.10/V33_10_FULL_TEST_RESULTS.json','release-evidence/v33.10/V33_10_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.10/V33_10_ARCHITECTURE_INTEGRITY.json',
 'release-evidence/v33.10/V33_10_EXECUTION_LEDGER.md','release-evidence/v33.10/V33_10_RELEASE_MANIFEST.json','CLAUDE_HANDOFF_v33_10.md']
def load(rel):return json.loads((ROOT/rel).read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
errors=[]
for rel in REQUIRED:
 if not (ROOT/rel).is_file():errors.append('missing:'+rel)
if errors:print(json.dumps({'version':'33.10','status':'failed','errors':errors},indent=2));sys.exit(1)
proof=load('release-evidence/v33.10/V33_10_EXTERNAL_GIT_PROVIDER_QUALIFICATION_PROOF.json');traces=load('release-evidence/v33.10/V33_10_PROVIDER_REQUEST_TRACES.json');full=load('release-evidence/v33.10/V33_10_FULL_TEST_RESULTS.json');truth=load('release-evidence/v33.10/V33_10_REPOSITORY_TRUTH_MAP.json');arch=load('release-evidence/v33.10/V33_10_ARCHITECTURE_INTEGRITY.json');gates=load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json');capmap=load('v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json');manifest=load('release-evidence/v33.10/V33_10_RELEASE_MANIFEST.json')
if proof.get('status')!='LOCAL_GITHUB_GITLAB_PROVIDER_QUALIFICATION_PASSED' or proof.get('evidenceClass')!='LOCAL_EXTERNAL_GIT_PROVIDER_QUALIFICATION':errors.append('provider_proof_status_invalid')
for k,v in {'providerCount':2,'githubDraftQualified':True,'gitlabDraftQualified':True,'signedWebhooksVerified':2,'responseLossRetryVerified':True,'branchProtectionChecksVerified':2,'credentialsPersisted':False,'credentialsExposed':False,'externalGitMutations':0,'realPullRequestsCreated':0,'mergesExecuted':0,'deploymentsExecuted':0,'externalEffectsExecuted':0,'g4Status':'in-progress-not-passed','productionPromotion':'blocked','externalQualification':'not_executed'}.items():
 if proof.get(k)!=v:errors.append('provider_metric_invalid:'+k)
rows=traces.get('results',[])
if {r.get('provider') for r in rows}!={'GITHUB','GITLAB'}:errors.append('provider_trace_set_invalid')
for row in rows:
 if not all(row.get(k) is True for k in ['receiptVerified','draft','branchProtectionObserved','webhookSignatureVerified']):errors.append('provider_trace_invalid:'+str(row.get('provider')))
 if row.get('credentialExposed') is not False or row.get('mergeEndpointCalls')!=0 or row.get('deploymentEndpointCalls')!=0 or row.get('externalEffectsExecuted')!=0:errors.append('provider_boundary_invalid:'+str(row.get('provider')))
retry=traces.get('retry',{})
if not all(retry.get(k) is True for k in ['firstAttemptFailedTransiently','retrySucceeded']) or retry.get('draftObjectsCreated')!=1 or retry.get('duplicateSuppressions',0)<6 or retry.get('responseDrops')!=1 or retry.get('webhookCount')!=1 or retry.get('externalEffectsExecuted')!=0:errors.append('retry_proof_invalid')
by={g.get('id'):g for g in gates.get('gates',[])}
if gates.get('version')!='33.10' or by.get('G4',{}).get('status')!='in-progress':errors.append('governance_g4_invalid')
finding=by.get('G4',{}).get('currentFinding','').lower()
for marker in ['github-shaped','gitlab-shaped','g4 remains in progress','no live external credential']:
 if marker not in finding:errors.append('g4_truth_missing:'+marker)
if capmap.get('version')!='33.10':errors.append('capability_map_version_invalid')
caps=set()
for layer in capmap.get('layers',[]):
 if layer.get('layer')=='engineering-pack':caps=set(layer.get('capabilities',[]))
for cap in ['provider-neutral-external-git-adapter','ephemeral-tenant-repository-scoped-git-credential-lease','github-git-data-draft-pr-qualification','gitlab-multi-action-draft-mr-qualification','signed-github-gitlab-webhook-verification','external-git-response-loss-idempotent-retry','branch-protection-observation','local-dual-provider-qualification-proof']:
 if cap not in caps:errors.append('capability_map_missing:'+cap)
if full.get('status')!='passed':errors.append('full_regression_not_passed')
t=full.get('totals',{})
if (t.get('testFiles'),t.get('tests'),t.get('passed'),t.get('failed'))!=(195,1347,1347,0):errors.append('full_regression_totals_invalid')
if full.get('runnerExitCode')!=0 or full.get('timedOut') is not False or full.get('forceExitDisabled') is not True:errors.append('full_runner_invalid')
for field,digest in [('stdoutEvidence','stdoutSha256'),('stderrEvidence','stderrSha256')]:
 p=ROOT/full.get(field,'')
 if not p.is_file() or sha(p)!=full.get(digest):errors.append(field+'_invalid')
sp=ROOT/full.get('stdoutEvidence','')
if sp.is_file():
 text=sp.read_text(errors='replace')
 for marker in ['# tests 1347','# pass 1347','# fail 0']:
  if marker not in text:errors.append('full_marker_missing:'+marker)
ep=ROOT/full.get('exitEvidence','')
if not ep.is_file() or ep.read_text().strip()!='0':errors.append('exit_receipt_invalid')
mp=ROOT/full.get('metaEvidence','')
if not mp.is_file():errors.append('meta_missing')
else:
 meta=json.loads(mp.read_text())
 if meta.get('exitCode')!=0 or meta.get('testFileCount')!=195 or meta.get('stdoutSha256')!=full.get('stdoutSha256'):errors.append('meta_invalid')
if truth.get('status')!='passed' or truth.get('findings')!=[]:errors.append('truth_failed')
inv=truth.get('inventory',{})
if inv.get('sourceModules')!=196 or inv.get('testFiles')!=195:errors.append('truth_inventory_invalid')
if truth.get('boundaries',{}).get('productionPromotion')!='blocked':errors.append('truth_promotion_invalid')
m=arch.get('metrics',{})
if arch.get('status')!='PASS' or arch.get('findings')!=[]:errors.append('architecture_failed')
if (m.get('sourceCycleCount'),m.get('untestedSourceCount'),m.get('capabilityPathCount'),m.get('closedCapabilityPathCount'))!=(0,0,115,115):errors.append('architecture_metrics_invalid')
closure={r.get('capabilityId') for r in arch.get('capabilityClosure',[])};script=(ROOT/'scripts/architecture-validation-v32.mjs').read_text()
for cid in ['github-git-data-draft-pr-qualification-v33.10','gitlab-multi-action-draft-mr-qualification-v33.10']:
 if cid not in closure:errors.append('architecture_path_missing:'+cid)
 if cid not in script:errors.append('architecture_generator_path_missing:'+cid)
if not errors:
 for cmd,label in [(['npm','run','truth-map:v32.18'],'regenerated_truth'),(['npm','run','architecture:v32'],'regenerated_architecture')]:
  p=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True)
  if p.returncode!=0:errors.append(label+'_failed:'+p.stdout[-2500:]+p.stderr[-2500:])
if not errors:
 rt=load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json');ra=load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
 if rt.get('inventory')!=truth.get('inventory') or rt.get('findings')!=truth.get('findings'):errors.append('regenerated_truth_mismatch')
 for key in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']:
  if ra.get('metrics',{}).get(key)!=m.get(key):errors.append('regenerated_architecture_metric_mismatch:'+key)
 if ra.get('graphDigest')!=arch.get('graphDigest'):errors.append('regenerated_architecture_digest_mismatch')
if not errors:
 tests=['chat-mission-v33_1','mission-conversation-v33_2','device-push-v33_3','reliable-push-v33_4','push-adapter-qualification-v33_5','human-pilot-readiness-v33_6','controlled-pilot-and-market-v33_7','chat-engineering-vertical-v33_8','multi-file-engineering-campaign-v33_9','external-git-provider-qualification-v33_10']
 direct=subprocess.run(['node','--test',*[f'dist/tests/{x}.test.js' for x in tests]],cwd=ROOT,capture_output=True,text=True)
 if direct.returncode!=0:errors.append('direct_v33_failed:'+direct.stdout[-2500:]+direct.stderr[-2500:])
 else:
  vals=[]
  for marker in ['tests','pass','fail']:
   x=re.search(rf'# {marker} (\d+)',direct.stdout);vals.append(int(x.group(1)) if x else None)
  if tuple(vals)!=(180,180,0):errors.append('direct_v33_count_invalid')
if manifest.get('version')!='33.10' or manifest.get('status')!='release-candidate-shadow-only':errors.append('manifest_status_invalid')
if manifest.get('productionPromotion')!='blocked' or manifest.get('externalQualification')!='not_executed' or manifest.get('gates',{}).get('G4')!='in-progress-not-passed':errors.append('manifest_boundary_invalid')
for row in manifest.get('files',[]):
 p=ROOT/row.get('path','')
 if not p.is_file():errors.append('manifest_missing:'+row.get('path',''))
 elif p.stat().st_size!=row.get('sizeBytes') or sha(p)!=row.get('sha256'):errors.append('manifest_integrity_invalid:'+row.get('path',''))
result={'version':'33.10','status':'passed' if not errors else 'failed','gates':{'G0':'passed','G1':'passed','G2':'in-progress-not-passed','G3':'in-progress-not-passed','G4':'in-progress-not-passed'},'prototype':'local-github-gitlab-draft-provider-qualification','providerQualification':{k:proof.get(k) for k in ['providerCount','githubDraftQualified','gitlabDraftQualified','signedWebhooksVerified','responseLossRetryVerified','externalGitMutations','realPullRequestsCreated','externalEffectsExecuted','evidenceClass']},'regression':{'testFiles':t.get('testFiles'),'tests':t.get('tests'),'passed':t.get('passed'),'failed':t.get('failed'),'runnerExitCode':full.get('runnerExitCode')},'architecture':{'sourceCycleCount':m.get('sourceCycleCount'),'untestedSourceCount':m.get('untestedSourceCount'),'capabilityPathCount':m.get('capabilityPathCount'),'closedCapabilityPathCount':m.get('closedCapabilityPathCount')},'errors':errors,'liveGitProviderCalled':False,'externalGitMutationExecuted':False,'externalEffectsExecuted':0,'productionPromotion':'blocked','externalQualification':'not_executed'}
(ROOT/'release-evidence/v33.10/V33_10_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if not errors else 1)
