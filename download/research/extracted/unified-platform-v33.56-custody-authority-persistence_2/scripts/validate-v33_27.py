#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];E=ROOT/'release-evidence/v33.27';errors=[]
def load(rel): return json.loads((ROOT/rel).read_text())
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def phase(name): print(json.dumps({'phase':name}),flush=True)
required=[
'src/app/external-transparency-witness-v33_27.ts','tests/external-transparency-witness-v33_27.test.ts',
'scripts/external-transparency-witness-proof-v33_27.mjs','scripts/verify-external-transparency-witness-v33_27.mjs',
'scripts/run-full-regression-v33_27.py','scripts/run-direct-v33-regression-v33_27.py','scripts/validate-v33_27.py',
'docs/V33_27_EXTERNAL_TRANSPARENCY_WITNESS_AND_PARAMETER_LEDGER.md','CLAUDE_HANDOFF_v33_27.md','V33_27_עדכון_ביצוע_והוכחות.md',
'external-qualification/v33.27/witness-gossip/README.md','external-qualification/v33.27/witness-gossip/RUNBOOK.md',
'external-qualification/v33.27/witness-gossip/trust-policy.json','external-qualification/v33.27/witness-gossip/scanner-operator-enrollment.template.json',
'external-qualification/v33.27/witness-gossip/witness-enrollment.template.json','external-qualification/v33.27/witness-gossip/gossip-receipt.template.json',
'external-qualification/v33.27/witness-gossip/challenge.template.json','external-qualification/v33.27/witness-gossip/parameter-ledger-summary.json',
'release-evidence/v33.27/V33_27_PARAMETER_LEDGER.json','release-evidence/v33.27/V33_27_SCANNER_OPERATOR_ENROLLMENTS.json',
'release-evidence/v33.27/V33_27_WITNESS_ENROLLMENTS.json','release-evidence/v33.27/V33_27_WITNESS_OBSERVATIONS.json',
'release-evidence/v33.27/V33_27_GOSSIP_RECEIPTS.json','release-evidence/v33.27/V33_27_SPLIT_VIEW_GOSSIP.json',
'release-evidence/v33.27/V33_27_EXTERNAL_QUALIFICATION_CHALLENGE.json','release-evidence/v33.27/V33_27_EXTERNAL_QUALIFICATION_VERDICT.json',
'release-evidence/v33.27/V33_27_SPLIT_VIEW_VERDICT.json','release-evidence/v33.27/V33_27_WITNESS_GOSSIP_TRACE.json',
'release-evidence/v33.27/V33_27_EXTERNAL_WITNESS_PROOF.json','release-evidence/v33.27/V33_27_EXTERNAL_OPERATOR_KIT_MANIFEST.json',
'release-evidence/v33.27/V33_27_PROOF_PUBLIC_KEYS.json','release-evidence/v33.27/V33_27_FULL_TEST_RESULTS.json',
'release-evidence/v33.27/V33_27_FULL_TEST_META.json','release-evidence/v33.27/V33_27_FULL_TEST_STDOUT.tap',
'release-evidence/v33.27/V33_27_FULL_TEST_STDERR.log','release-evidence/v33.27/V33_27_FULL_TEST_EXIT.txt',
'release-evidence/v33.27/V33_27_DIRECT_V33_RESULTS.json','release-evidence/v33.27/V33_27_REPOSITORY_TRUTH_MAP.json',
'release-evidence/v33.27/V33_27_ARCHITECTURE_INTEGRITY.json','release-evidence/v33.27/V33_27_EXECUTION_LEDGER.md',
'release-evidence/v33.27/V33_27_RELEASE_MANIFEST.json']
for rel in required:
 if not (ROOT/rel).is_file(): errors.append('missing:'+rel)
if errors: print(json.dumps({'version':'33.27','status':'failed','errors':errors},indent=2));sys.exit(1)
phase('proof-signatures')
verify=subprocess.run(['node','scripts/verify-external-transparency-witness-v33_27.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=180)
if verify.returncode!=0: errors.append('proof_verification_failed:'+verify.stderr[-500:])
phase('load')
proof=load('release-evidence/v33.27/V33_27_EXTERNAL_WITNESS_PROOF.json')['payload']; ledger=load('release-evidence/v33.27/V33_27_PARAMETER_LEDGER.json')['payload']
verdict=load('release-evidence/v33.27/V33_27_EXTERNAL_QUALIFICATION_VERDICT.json')['payload']; split=load('release-evidence/v33.27/V33_27_SPLIT_VIEW_VERDICT.json')['payload']
trace=load('release-evidence/v33.27/V33_27_WITNESS_GOSSIP_TRACE.json')['payload']; gossip=load('release-evidence/v33.27/V33_27_GOSSIP_RECEIPTS.json')
operators=load('release-evidence/v33.27/V33_27_SCANNER_OPERATOR_ENROLLMENTS.json'); witnesses=load('release-evidence/v33.27/V33_27_WITNESS_ENROLLMENTS.json')
full=load('release-evidence/v33.27/V33_27_FULL_TEST_RESULTS.json');meta=load('release-evidence/v33.27/V33_27_FULL_TEST_META.json');direct=load('release-evidence/v33.27/V33_27_DIRECT_V33_RESULTS.json')
truth=load('release-evidence/v33.27/V33_27_REPOSITORY_TRUTH_MAP.json');arch=load('release-evidence/v33.27/V33_27_ARCHITECTURE_INTEGRITY.json');manifest=load('release-evidence/v33.27/V33_27_RELEASE_MANIFEST.json')
if proof.get('status')!='PARAMETER_LEDGER_OPERATOR_INTAKE_AND_SPLIT_VIEW_GOSSIP_PROVEN_LOCALLY' or proof.get('focusedTestsExpected')!=41: errors.append('proof_status_invalid')
if proof.get('parameterCount')!=14 or proof.get('preservedParameters')!=8 or proof.get('strengthenedParameters')!=3 or proof.get('externalEvidencePendingParameters')!=3: errors.append('proof_parameter_counts_invalid')
if ledger.get('parameterCount')!=14 or len(ledger.get('parameters',[]))!=14: errors.append('parameter_ledger_count_invalid')
statuses=[x.get('status') for x in ledger.get('parameters',[])]
if statuses.count('PRESERVED')!=8 or statuses.count('STRENGTHENED')!=3 or statuses.count('EXTERNAL_EVIDENCE_PENDING')!=3: errors.append('parameter_ledger_status_invalid')
pending={x.get('id') for x in ledger.get('parameters',[]) if x.get('status')=='EXTERNAL_EVIDENCE_PENDING'}
if pending!={'UX_REDUCTION_AND_COMPREHENSION_TARGETS','ENGINEERING_PRODUCT_PROOF_TARGETS','CATEGORY_AND_BUYER_PROOF_TARGETS'}: errors.append('parameter_external_pending_invalid')
if verdict.get('status')!='EXTERNAL_WITNESS_AND_SCANNER_OPERATOR_QUALIFICATION_REQUIRED' or verdict.get('liveScannerReceiptCount')!=0 or verdict.get('liveWitnessObservationCount')!=0: errors.append('external_boundary_invalid')
if split.get('status')!='SPLIT_VIEW_DETECTED_QUARANTINE' or split.get('splitViewDetected') is not True: errors.append('split_view_gate_invalid')
if len(gossip)!=2 or not all(x.get('payload',{}).get('status')=='CONSISTENT' for x in gossip): errors.append('gossip_invalid')
if len(operators)!=2 or len(witnesses)!=2 or trace.get('splitViewsDetected')!=1: errors.append('campaign_shape_invalid')
if proof.get('productionAuthority')!='NONE' or proof.get('externalEffectsExecuted')!=0 or proof.get('productionPromotion')!='blocked': errors.append('production_boundary_invalid')
phase('regression')
ft=full.get('totals',{});dt=direct.get('totals',{})
if full.get('version')!='33.27' or full.get('status')!='passed' or ft!={'testFiles':212,'tests':1747,'passed':1747,'failed':0} or full.get('runnerExitCode')!=0 or full.get('retry') or full.get('forceExitDisabled') is not True: errors.append('full_regression_invalid')
if direct.get('version')!='33.27' or direct.get('status')!='passed' or dt!={'testFiles':27,'tests':580,'passed':580,'failed':0} or direct.get('retry') or direct.get('forceExit'): errors.append('direct_v33_invalid')
if meta.get('version')!='33.27' or meta.get('testFileCount')!=212 or meta.get('timedOut') or meta.get('retry') or meta.get('forceExitDisabled') is not True: errors.append('regression_meta_invalid')
phase('truth-architecture')
inv=truth.get('inventory',{});metrics=arch.get('metrics',{})
if inv.get('sourceModules')!=216 or inv.get('testFiles')!=212 or truth.get('findings')!=[]: errors.append('truth_map_invalid')
if metrics.get('sourceCycleCount')!=0 or metrics.get('untestedSourceCount')!=0 or metrics.get('capabilityPathCount')!=149 or metrics.get('closedCapabilityPathCount')!=149 or arch.get('status')!='PASS': errors.append('architecture_invalid')
for name in ['CONTRACT_REGISTRY_V33.json','CANONICAL_CAPABILITY_MAP_V33.json','PROOF_GATE_REGISTRY_V33.json','SOURCE_SYSTEM_REGISTRY_V33.json','VALUE_HYPOTHESIS_REGISTRY_V33.json']:
 if load('v33/governance-state/'+name).get('version')!='33.27': errors.append('governance_version_invalid:'+name)
phase('regeneration')
tr=subprocess.run(['node','scripts/repository-truth-map-v32_18.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=180);ar=subprocess.run(['node','scripts/architecture-validation-v32.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=180)
if tr.returncode!=0 or ar.returncode!=0: errors.append('regeneration_failed')
else:
 rt=load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json');ra=load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
 if rt.get('inventory')!=truth.get('inventory') or rt.get('findings')!=truth.get('findings'): errors.append('truth_regeneration_mismatch')
 if ra.get('graphDigest')!=arch.get('graphDigest') or ra.get('metrics')!=arch.get('metrics'): errors.append('architecture_regeneration_mismatch')
phase('manifest')
if manifest.get('version')!='33.27' or manifest.get('evidenceClass')!='LOCAL_SYNTHETIC_EXTERNAL_WITNESS_GOSSIP_GATE' or manifest.get('externalEffects')!=0 or manifest.get('productionPromotion')!='blocked' or not manifest.get('files'): errors.append('manifest_boundary_invalid')
for item in manifest.get('files',[]):
 path=ROOT/str(item.get('path',''))
 if not path.is_file() or path.stat().st_size!=item.get('sizeBytes') or sha(path)!=item.get('sha256'): errors.append('manifest_file_invalid:'+str(item.get('path')))
result={'version':'33.27','status':'passed' if not errors else 'failed','evidenceClass':proof.get('evidenceClass'),'parameterLedger':{'count':14,'preserved':statuses.count('PRESERVED'),'strengthened':statuses.count('STRENGTHENED'),'externalEvidencePending':statuses.count('EXTERNAL_EVIDENCE_PENDING')},'externalQualification':{'status':verdict.get('status'),'acceptedScannerReceipts':verdict.get('liveScannerReceiptCount'),'acceptedWitnessObservations':verdict.get('liveWitnessObservationCount'),'splitViewCampaignStatus':split.get('status')},'regression':ft,'directV33':dt,'truthMap':{'sourceModules':inv.get('sourceModules'),'testFiles':inv.get('testFiles'),'scripts':inv.get('scripts'),'findings':len(truth.get('findings',[]))},'architecture':{k:metrics.get(k) for k in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']},'errors':errors,'productionPromotion':'blocked'}
E.mkdir(parents=True,exist_ok=True);(E/'V33_27_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if not errors else 1)
