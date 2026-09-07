#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, re, subprocess, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
REQUIRED=[
 'src/repository/chat-engineering-vertical-v33_8.ts',
 'tests/chat-engineering-vertical-v33_8.test.ts',
 'scripts/chat-engineering-vertical-proof-v33_8.mjs',
 'scripts/run-full-regression-v33_8.sh',
 'scripts/validate-v33_8.py',
 'scripts/architecture-validation-v32.mjs',
 'docs/V33_8_CHAT_TO_REVIEWED_PR_PROPOSAL.md',
 'v33/governance-state/PROOF_GATE_REGISTRY_V33.json',
 'v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json',
 'release-evidence/v33.8/V33_8_CHAT_ENGINEERING_VERTICAL_PROOF.json',
 'release-evidence/v33.8/V33_8_FULL_TEST_RESULTS.json',
 'release-evidence/v33.8/V33_8_REPOSITORY_TRUTH_MAP.json',
 'release-evidence/v33.8/V33_8_ARCHITECTURE_INTEGRITY.json',
 'release-evidence/v33.8/V33_8_EXECUTION_LEDGER.md',
 'release-evidence/v33.8/V33_8_RELEASE_MANIFEST.json',
 'CLAUDE_HANDOFF_v33_8.md',
]

def load(rel:str): return json.loads((ROOT/rel).read_text())
def sha(path:Path): return hashlib.sha256(path.read_bytes()).hexdigest()
def run_checked(cmd:list[str], label:str):
 p=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True)
 if p.returncode!=0: errors.append(f'{label}_failed:'+p.stdout[-2500:]+p.stderr[-2500:])
 return p

errors=[]
for rel in REQUIRED:
 if not (ROOT/rel).is_file(): errors.append('missing:'+rel)
if errors:
 print(json.dumps({'version':'33.8','status':'failed','errors':errors},indent=2));sys.exit(1)

proof=load('release-evidence/v33.8/V33_8_CHAT_ENGINEERING_VERTICAL_PROOF.json')
full=load('release-evidence/v33.8/V33_8_FULL_TEST_RESULTS.json')
truth=load('release-evidence/v33.8/V33_8_REPOSITORY_TRUTH_MAP.json')
arch=load('release-evidence/v33.8/V33_8_ARCHITECTURE_INTEGRITY.json')
gates=load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json')
capmap=load('v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json')
manifest=load('release-evidence/v33.8/V33_8_RELEASE_MANIFEST.json')

if proof.get('status')!='LOCAL_VERTICAL_SLICE_PASSED': errors.append('proof_status_invalid')
for key,expected in {
 'testPassed':True,'actionPassportPresent':True,'pullRequestProposalVerified':True,
 'sourceRepositoryUnchanged':True,'rollbackVerified':True,
 'externalGitMutationExecuted':False,'mergeExecuted':False,'deploymentExecuted':False,
 'externalEffectsExecuted':0,'g4Status':'in-progress-not-passed'
}.items():
 if proof.get(key)!=expected: errors.append('proof_boundary_invalid:'+key)
if proof.get('changedFiles')!=['src/calculator.js']: errors.append('proof_changed_files_invalid')
limitations=set(proof.get('limitations',[]))
for item in ['single-explicit-file-change','no-external-git-provider','no-real-pull-request-created','three-repository-thirty-mission-campaign-not-executed']:
 if item not in limitations: errors.append('proof_limitation_missing:'+item)

by_id={g.get('id'):g for g in gates.get('gates',[])}
if gates.get('version')!='33.8' or by_id.get('G4',{}).get('status')!='in-progress': errors.append('governance_g4_state_invalid')
finding=by_id.get('G4',{}).get('currentFinding','').lower()
for marker in ['one trusted local repository mission','no external pr','three-repository campaign']:
 if marker not in finding: errors.append('g4_truth_statement_missing:'+marker)
if capmap.get('version')!='33.8': errors.append('capability_map_version_invalid')
engineering_caps=set()
for layer in capmap.get('layers',[]):
 if layer.get('layer')=='engineering-pack': engineering_caps=set(layer.get('capabilities',[]))
for cap in ['pull-request-proposal','chat-engineering-mission-binding','approval-gated-local-change-preparation','independent-reviewed-pr-proposal','exact-engineering-rollback']:
 if cap not in engineering_caps: errors.append('capability_map_missing:'+cap)

if full.get('status')!='passed': errors.append('full_regression_not_passed')
t=full.get('totals',{})
if (t.get('testFiles'),t.get('tests'),t.get('passed'),t.get('failed'))!=(193,1312,1312,0): errors.append('full_regression_totals_invalid')
if full.get('runnerExitCode')!=0 or full.get('timedOut') is not False or full.get('forceExitDisabled') is not True: errors.append('full_regression_runner_invalid')
for field,digest_field in [('stdoutEvidence','stdoutSha256'),('stderrEvidence','stderrSha256')]:
 path=ROOT/full.get(field,'')
 if not path.is_file() or sha(path)!=full.get(digest_field): errors.append(field+'_invalid')
stdout_path=ROOT/full.get('stdoutEvidence','')
if stdout_path.is_file():
 text=stdout_path.read_text(errors='replace')
 for marker in ['# tests 1312','# pass 1312','# fail 0']:
  if marker not in text: errors.append('full_log_marker_missing:'+marker)
exit_path=ROOT/full.get('exitEvidence','')
if not exit_path.is_file() or exit_path.read_text().strip()!='0': errors.append('full_exit_receipt_invalid')
meta_path=ROOT/full.get('metaEvidence','')
if not meta_path.is_file(): errors.append('full_meta_missing')
else:
 meta=json.loads(meta_path.read_text())
 if meta.get('exitCode')!=0 or meta.get('stdoutSha256')!=full.get('stdoutSha256') or meta.get('testFileCount')!=193: errors.append('full_meta_invalid')

if truth.get('status')!='passed' or truth.get('findings')!=[]: errors.append('truth_map_failed')
inv=truth.get('inventory',{})
if inv.get('sourceModules')!=194 or inv.get('testFiles')!=193: errors.append('truth_inventory_invalid')
if truth.get('boundaries',{}).get('productionPromotion')!='blocked': errors.append('truth_promotes_production')

m=arch.get('metrics',{})
if arch.get('status')!='PASS' or arch.get('findings')!=[]: errors.append('architecture_failed')
if (m.get('sourceCycleCount'),m.get('untestedSourceCount'),m.get('capabilityPathCount'),m.get('closedCapabilityPathCount'))!=(0,0,111,111): errors.append('architecture_metrics_invalid')
cap_id='chat-to-reviewed-pr-proposal-v33.8'
closure={r.get('capabilityId') for r in arch.get('capabilityClosure',[])}
script_text=(ROOT/'scripts/architecture-validation-v32.mjs').read_text()
if cap_id not in closure: errors.append('architecture_path_missing:'+cap_id)
if cap_id not in script_text: errors.append('architecture_generator_path_missing:'+cap_id)

# Recreate source-derived maps so stale evidence cannot pass.
if not errors:
 run_checked(['npm','run','truth-map:v32.18'],'regenerated_truth')
 run_checked(['npm','run','architecture:v32'],'regenerated_architecture')
if not errors:
 rt=load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json'); ra=load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
 if rt.get('inventory')!=truth.get('inventory') or rt.get('findings')!=truth.get('findings'): errors.append('regenerated_truth_mismatch')
 for key in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']:
  if ra.get('metrics',{}).get(key)!=m.get(key): errors.append('regenerated_architecture_metric_mismatch:'+key)
 if ra.get('graphDigest')!=arch.get('graphDigest'): errors.append('regenerated_architecture_digest_mismatch')

if not errors:
 direct=subprocess.run(['node','--test',
  'dist/tests/chat-mission-v33_1.test.js','dist/tests/mission-conversation-v33_2.test.js',
  'dist/tests/device-push-v33_3.test.js','dist/tests/reliable-push-v33_4.test.js',
  'dist/tests/push-adapter-qualification-v33_5.test.js','dist/tests/human-pilot-readiness-v33_6.test.js',
  'dist/tests/controlled-pilot-and-market-v33_7.test.js','dist/tests/chat-engineering-vertical-v33_8.test.js'],cwd=ROOT,capture_output=True,text=True)
 if direct.returncode!=0: errors.append('direct_v33_tests_failed:'+direct.stdout[-2500:]+direct.stderr[-2500:])
 else:
  mt=re.search(r'# tests (\d+)',direct.stdout); mp=re.search(r'# pass (\d+)',direct.stdout); mf=re.search(r'# fail (\d+)',direct.stdout)
  if not mt or not mp or not mf or (int(mt.group(1)),int(mp.group(1)),int(mf.group(1)))!=(145,145,0): errors.append('direct_v33_test_count_invalid')

if manifest.get('version')!='33.8' or manifest.get('status')!='release-candidate-shadow-only': errors.append('release_manifest_status_invalid')
if manifest.get('productionPromotion')!='blocked' or manifest.get('externalQualification')!='not_executed': errors.append('release_manifest_boundary_invalid')
if manifest.get('gates',{}).get('G4')!='in-progress-not-passed': errors.append('release_manifest_g4_invalid')
for row in manifest.get('files',[]):
 path=ROOT/row.get('path','')
 if not path.is_file(): errors.append('manifest_missing:'+row.get('path',''))
 elif sha(path)!=row.get('sha256') or path.stat().st_size!=row.get('sizeBytes'): errors.append('manifest_integrity_invalid:'+row.get('path',''))

result={'version':'33.8','status':'passed' if not errors else 'failed','gates':{'G0':'passed','G1':'passed','G2':'in-progress-not-passed','G3':'in-progress-not-passed','G4':'in-progress-not-passed'},'prototype':'chat-to-isolated-tested-independently-reviewed-signed-pr-proposal-local-shadow-slice','regression':{'testFiles':t.get('testFiles'),'tests':t.get('tests'),'passed':t.get('passed'),'failed':t.get('failed'),'runnerExitCode':full.get('runnerExitCode')},'architecture':{'sourceCycleCount':m.get('sourceCycleCount'),'untestedSourceCount':m.get('untestedSourceCount'),'capabilityPathCount':m.get('capabilityPathCount'),'closedCapabilityPathCount':m.get('closedCapabilityPathCount')},'checkedFiles':REQUIRED,'sha256':{rel:sha(ROOT/rel) for rel in REQUIRED if (ROOT/rel).is_file()},'errors':errors,'externalGitMutationExecuted':False,'externalEffectsExecuted':0,'productionPromotion':'blocked','externalQualification':'not_executed'}
(ROOT/'release-evidence/v33.8/V33_8_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
sys.exit(0 if not errors else 1)
