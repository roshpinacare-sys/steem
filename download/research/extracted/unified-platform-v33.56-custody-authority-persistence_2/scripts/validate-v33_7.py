#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, re, subprocess, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
REQUIRED=[
 'src/product/controlled-pilot-and-market-v33_7.ts',
 'tests/controlled-pilot-and-market-v33_7.test.ts',
 'scripts/controlled-pilot-market-proof-v33_7.mjs',
 'scripts/run-full-regression-v33_7.sh',
 'docs/V33_7_CONTROLLED_PILOT_PROVIDER_AND_BUYER_VALIDATION.md',
 'pilot-kits/v33.7/CONTROLLED_HUMAN_PILOT_RUNBOOK.md',
 'pilot-kits/v33.7/EXTERNAL_PROVIDER_QUALIFICATION_RUNBOOK.md',
 'pilot-kits/v33.7/BUYER_VALIDATION_RUNBOOK.md',
 'v33/governance-state/PROOF_GATE_REGISTRY_V33.json',
 'v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json',
 'release-evidence/v33.7/V33_7_CONTROLLED_PILOT_PROVIDER_BUYER_PROOF.json',
 'release-evidence/v33.7/V33_7_FULL_TEST_RESULTS.json',
 'release-evidence/v33.7/V33_7_REPOSITORY_TRUTH_MAP.json',
 'release-evidence/v33.7/V33_7_ARCHITECTURE_INTEGRITY.json',
 'release-evidence/v33.7/V33_7_RELEASE_MANIFEST.json',
 'CLAUDE_HANDOFF_v33_7.md',
]

def load(rel:str): return json.loads((ROOT/rel).read_text())
def sha(path:Path): return hashlib.sha256(path.read_bytes()).hexdigest()
def run_checked(cmd:list[str], label:str):
 p=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True)
 if p.returncode!=0: errors.append(f'{label}_failed:'+p.stdout[-2000:]+p.stderr[-2000:])
 return p

errors=[]
for rel in REQUIRED:
 if not (ROOT/rel).is_file(): errors.append('missing:'+rel)
if errors:
 print(json.dumps({'version':'33.7','status':'failed','errors':errors},indent=2));sys.exit(1)

proof=load('release-evidence/v33.7/V33_7_CONTROLLED_PILOT_PROVIDER_BUYER_PROOF.json')
full=load('release-evidence/v33.7/V33_7_FULL_TEST_RESULTS.json')
truth=load('release-evidence/v33.7/V33_7_REPOSITORY_TRUTH_MAP.json')
arch=load('release-evidence/v33.7/V33_7_ARCHITECTURE_INTEGRITY.json')
gates=load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json')
capmap=load('v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json')
manifest=load('release-evidence/v33.7/V33_7_RELEASE_MANIFEST.json')

if proof.get('status')!='READY_FOR_CONTROLLED_EXECUTION': errors.append('proof_status_invalid')
external=proof.get('observedExternalEvidence',{})
if external!={'humanParticipants':0,'credentialledProviderRuns':0,'buyerInterviews':0,'designPartners':0,'paidPilots':0}: errors.append('external_evidence_overclaimed')
if proof.get('gates')!={'G0':'passed','G1':'passed','G2':'in-progress-not-passed','G3':'in-progress-not-passed'}: errors.append('proof_gate_status_invalid')
if proof.get('productionPromotion')!='blocked' or proof.get('externalEffectsExecuted')!=0: errors.append('proof_boundary_invalid')

by_id={g.get('id'):g for g in gates.get('gates',[])}
if gates.get('version')!='33.7' or by_id.get('G2',{}).get('status')!='in-progress' or by_id.get('G3',{}).get('status')!='in-progress': errors.append('governance_gate_state_invalid')
if 'zero interviews' not in by_id.get('G2',{}).get('currentFinding','').lower(): errors.append('g2_truth_statement_missing')
if 'neither activity has been executed' not in by_id.get('G3',{}).get('currentFinding','').lower(): errors.append('g3_truth_statement_missing')
if capmap.get('version')!='33.7': errors.append('capability_map_version_invalid')
required_caps={'controlled-human-pilot-protocol','device-signed-pseudonymous-consent','independent-controlled-pilot-observation','credentialled-apns-fcm-qualification','different-organization-provider-witness','buyer-interview-design-partner-paid-pilot-gate'}
operator_caps=set()
for layer in capmap.get('layers',[]):
 if layer.get('layer')=='operator-plane': operator_caps=set(layer.get('capabilities',[]))
if not required_caps.issubset(operator_caps): errors.append('capability_map_missing_v33_7')

if full.get('status')!='passed': errors.append('full_regression_not_passed')
t=full.get('totals',{})
if (t.get('testFiles'),t.get('tests'),t.get('passed'),t.get('failed'))!=(192,1299,1299,0): errors.append('full_regression_totals_invalid')
if full.get('runnerExitCode')!=0 or full.get('timedOut') is not False or full.get('forceExitDisabled') is not True: errors.append('full_regression_runner_invalid')
for field,digest_field in [('stdoutEvidence','stdoutSha256'),('stderrEvidence','stderrSha256')]:
 path=ROOT/full.get(field,'')
 if not path.is_file() or sha(path)!=full.get(digest_field): errors.append(field+'_invalid')
stdout_path=ROOT/full.get('stdoutEvidence','')
if stdout_path.is_file():
 text=stdout_path.read_text(errors='replace')
 for marker in ['# tests 1299','# pass 1299','# fail 0']:
  if marker not in text: errors.append('full_log_marker_missing:'+marker)
exit_path=ROOT/full.get('exitEvidence','')
if not exit_path.is_file() or exit_path.read_text().strip()!='0': errors.append('full_exit_receipt_invalid')
meta_path=ROOT/full.get('metaEvidence','')
if not meta_path.is_file(): errors.append('full_meta_missing')
else:
 meta=json.loads(meta_path.read_text())
 if meta.get('exitCode')!=0 or meta.get('stdoutSha256')!=full.get('stdoutSha256'): errors.append('full_meta_invalid')

if truth.get('status')!='passed' or truth.get('findings')!=[]: errors.append('truth_map_failed')
inv=truth.get('inventory',{})
if inv.get('sourceModules')!=193 or inv.get('testFiles')!=192: errors.append('truth_inventory_invalid')
if truth.get('boundaries',{}).get('productionPromotion')!='blocked': errors.append('truth_promotes_production')

m=arch.get('metrics',{})
if arch.get('status')!='PASS' or arch.get('findings')!=[]: errors.append('architecture_failed')
if (m.get('sourceCycleCount'),m.get('untestedSourceCount'),m.get('capabilityPathCount'),m.get('closedCapabilityPathCount'))!=(0,0,110,110): errors.append('architecture_metrics_invalid')
expected={
 'controlled-human-pilot-protocol-v33.7',
 'credentialled-provider-independent-qualification-v33.7',
 'buyer-design-partner-validation-v33.7',
}
closure={r.get('capabilityId') for r in arch.get('capabilityClosure',[])}
script_text=(ROOT/'scripts/architecture-validation-v32.mjs').read_text()
for cid in expected:
 if cid not in closure: errors.append('architecture_path_missing:'+cid)
 if cid not in script_text: errors.append('architecture_generator_path_missing:'+cid)

# Regenerate source-derived maps. Stale artifacts cannot pass.
if not errors:
 run_checked(['npm','run','truth-map:v32.18'],'regenerated_truth')
 run_checked(['npm','run','architecture:v32'],'regenerated_architecture')
if not errors:
 rt=load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json'); ra=load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
 if rt.get('inventory')!=truth.get('inventory') or rt.get('findings')!=truth.get('findings'): errors.append('regenerated_truth_mismatch')
 for key in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']:
  if ra.get('metrics',{}).get(key)!=m.get(key): errors.append('regenerated_architecture_metric_mismatch:'+key)
 if ra.get('graphDigest')!=arch.get('graphDigest'): errors.append('regenerated_architecture_digest_mismatch')

# Direct V33 regression is counted independently.
if not errors:
 direct=subprocess.run(['node','--test','dist/tests/chat-mission-v33_1.test.js','dist/tests/mission-conversation-v33_2.test.js','dist/tests/device-push-v33_3.test.js','dist/tests/reliable-push-v33_4.test.js','dist/tests/push-adapter-qualification-v33_5.test.js','dist/tests/human-pilot-readiness-v33_6.test.js','dist/tests/controlled-pilot-and-market-v33_7.test.js'],cwd=ROOT,capture_output=True,text=True)
 if direct.returncode!=0: errors.append('direct_v33_tests_failed:'+direct.stdout[-2000:]+direct.stderr[-2000:])
 else:
  mt=re.search(r'# tests (\d+)',direct.stdout); mp=re.search(r'# pass (\d+)',direct.stdout); mf=re.search(r'# fail (\d+)',direct.stdout)
  if not mt or not mp or not mf or (int(mt.group(1)),int(mp.group(1)),int(mf.group(1)))!=(132,132,0): errors.append('direct_v33_test_count_invalid')

if manifest.get('version')!='33.7' or manifest.get('status')!='release-candidate-shadow-only': errors.append('release_manifest_status_invalid')
if manifest.get('productionPromotion')!='blocked' or manifest.get('externalQualification')!='not_executed': errors.append('release_manifest_boundary_invalid')
for row in manifest.get('files',[]):
 path=ROOT/row.get('path','')
 if not path.is_file(): errors.append('manifest_missing:'+row.get('path',''))
 elif sha(path)!=row.get('sha256') or path.stat().st_size!=row.get('sizeBytes'): errors.append('manifest_integrity_invalid:'+row.get('path',''))

result={'version':'33.7','status':'passed' if not errors else 'failed','gates':{'G0':'passed','G1':'passed','G2':'in-progress-not-passed','G3':'in-progress-not-passed'},'prototype':'controlled-human-pilot-credentialled-provider-and-buyer-validation-contracts-ready-not-executed','externalEvidence':external,'regression':{'testFiles':t.get('testFiles'),'tests':t.get('tests'),'passed':t.get('passed'),'failed':t.get('failed'),'runnerExitCode':full.get('runnerExitCode')},'architecture':{'sourceCycleCount':m.get('sourceCycleCount'),'untestedSourceCount':m.get('untestedSourceCount'),'capabilityPathCount':m.get('capabilityPathCount'),'closedCapabilityPathCount':m.get('closedCapabilityPathCount')},'checkedFiles':REQUIRED,'sha256':{rel:sha(ROOT/rel) for rel in REQUIRED if (ROOT/rel).is_file()},'errors':errors,'productionPromotion':'blocked','externalQualification':'not_executed'}
(ROOT/'release-evidence/v33.7/V33_7_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
sys.exit(0 if not errors else 1)
