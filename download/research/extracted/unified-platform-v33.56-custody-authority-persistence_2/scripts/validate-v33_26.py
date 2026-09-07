#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; E=ROOT/'release-evidence/v33.26'; errors=[]
def load(rel): return json.loads((ROOT/rel).read_text())
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def phase(name): print(json.dumps({'phase':name}),flush=True)
required=[
'src/app/scanner-evidence-transparency-v33_26.ts','tests/scanner-evidence-transparency-v33_26.test.ts',
'scripts/scanner-evidence-transparency-proof-v33_26.mjs','scripts/verify-scanner-evidence-transparency-v33_26.mjs',
'scripts/run-full-regression-v33_26.py','scripts/run-direct-v33-regression-v33_26.py','scripts/validate-v33_26.py',
'docs/V33_26_EXTERNAL_SCANNER_EVIDENCE_AND_FEED_TRANSPARENCY.md','CLAUDE_HANDOFF_v33_26.md',
'external-qualification/v33.26/scanner-transparency/README.md','external-qualification/v33.26/scanner-transparency/RUNBOOK.md',
'external-qualification/v33.26/scanner-transparency/trust-policy.json','external-qualification/v33.26/scanner-transparency/receipt.template.json',
'external-qualification/v33.26/scanner-transparency/challenge.template.json','external-qualification/v33.26/scanner-transparency/transparency-policy.json',
'release-evidence/v33.26/V33_26_EXTERNAL_SCANNER_TOOL_PROBE.json','release-evidence/v33.26/V33_26_SYNTHETIC_SCANNER_RECEIPTS.json',
'release-evidence/v33.26/V33_26_IMPORT_RECEIPTS.json','release-evidence/v33.26/V33_26_TRANSPARENCY_ENTRIES.json',
'release-evidence/v33.26/V33_26_TRANSPARENCY_CHECKPOINTS.json','release-evidence/v33.26/V33_26_INCLUSION_PROOFS.json',
'release-evidence/v33.26/V33_26_CONSISTENCY_PROOF.json','release-evidence/v33.26/V33_26_EMERGENCY_REVOCATION.json',
'release-evidence/v33.26/V33_26_EXTERNAL_QUALIFICATION_CHALLENGE.json','release-evidence/v33.26/V33_26_EXTERNAL_QUALIFICATION_VERDICT.json',
'release-evidence/v33.26/V33_26_SCANNER_TRANSPARENCY_TRACE.json','release-evidence/v33.26/V33_26_SCANNER_EVIDENCE_TRANSPARENCY_PROOF.json',
'release-evidence/v33.26/V33_26_EXTERNAL_OPERATOR_KIT_MANIFEST.json','release-evidence/v33.26/V33_26_PROOF_PUBLIC_KEYS.json',
'release-evidence/v33.26/V33_26_FULL_TEST_RESULTS.json','release-evidence/v33.26/V33_26_FULL_TEST_META.json',
'release-evidence/v33.26/V33_26_FULL_TEST_STDOUT.tap','release-evidence/v33.26/V33_26_FULL_TEST_STDERR.log',
'release-evidence/v33.26/V33_26_FULL_TEST_EXIT.txt','release-evidence/v33.26/V33_26_DIRECT_V33_RESULTS.json',
'release-evidence/v33.26/V33_26_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.26/V33_26_ARCHITECTURE_INTEGRITY.json',
'release-evidence/v33.26/V33_26_EXECUTION_LEDGER.md','release-evidence/v33.26/V33_26_RELEASE_MANIFEST.json']
for rel in required:
 if not (ROOT/rel).is_file(): errors.append('missing:'+rel)
if errors:
 print(json.dumps({'version':'33.26','status':'failed','errors':errors},indent=2));sys.exit(1)
phase('proof-signatures')
verify=subprocess.run(['node','scripts/verify-scanner-evidence-transparency-v33_26.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=180)
if verify.returncode!=0: errors.append('proof_verification_failed:'+verify.stderr[-500:])
phase('load')
proof=load('release-evidence/v33.26/V33_26_SCANNER_EVIDENCE_TRANSPARENCY_PROOF.json')['payload']
trace=load('release-evidence/v33.26/V33_26_SCANNER_TRANSPARENCY_TRACE.json')['payload']
verdict=load('release-evidence/v33.26/V33_26_EXTERNAL_QUALIFICATION_VERDICT.json')['payload']
imports=load('release-evidence/v33.26/V33_26_IMPORT_RECEIPTS.json')
inclusion=load('release-evidence/v33.26/V33_26_INCLUSION_PROOFS.json')
consistency=load('release-evidence/v33.26/V33_26_CONSISTENCY_PROOF.json')
checkpoints=load('release-evidence/v33.26/V33_26_TRANSPARENCY_CHECKPOINTS.json')
full=load('release-evidence/v33.26/V33_26_FULL_TEST_RESULTS.json'); meta=load('release-evidence/v33.26/V33_26_FULL_TEST_META.json')
direct=load('release-evidence/v33.26/V33_26_DIRECT_V33_RESULTS.json'); truth=load('release-evidence/v33.26/V33_26_REPOSITORY_TRUTH_MAP.json'); arch=load('release-evidence/v33.26/V33_26_ARCHITECTURE_INTEGRITY.json'); manifest=load('release-evidence/v33.26/V33_26_RELEASE_MANIFEST.json')
if proof.get('status')!='EXTERNAL_SCANNER_EVIDENCE_IMPORT_AND_FEED_TRANSPARENCY_PROVEN_LOCALLY' or proof.get('focusedTestsExpected')!=39: errors.append('proof_status_invalid')
if proof.get('syntheticReceipts')!=2 or proof.get('syntheticReceiptsAcceptedAsExternal')!=0 or proof.get('externalClamavQualified') or proof.get('externalYaraQualified'): errors.append('proof_external_boundary_invalid')
if proof.get('consistencyProofType')!='FULL_PREFIX_CONSISTENCY_WITNESS' or proof.get('succinctRfc6962ConsistencyClaimed') is not False: errors.append('consistency_claim_invalid')
if proof.get('productionAuthority')!='NONE' or proof.get('externalEffectsExecuted')!=0 or proof.get('productionPromotion')!='blocked': errors.append('proof_production_boundary_invalid')
if verdict.get('status')!='EXTERNAL_SCANNER_TRANSPARENCY_QUALIFICATION_REQUIRED' or verdict.get('acceptedReceiptCount')!=0 or verdict.get('syntheticReceiptCount')!=2 or verdict.get('eligibleForProductionPromotion') is not False: errors.append('qualification_boundary_invalid')
if len(imports)!=2 or not all(x.get('payload',{}).get('exactArtifactBytesVerified') for x in imports): errors.append('exact_byte_import_invalid')
if len(inclusion)!=2 or consistency.get('proofType')!='FULL_PREFIX_CONSISTENCY_WITNESS' or len(checkpoints)!=4: errors.append('transparency_artifact_shape_invalid')
if not trace.get('emergencyRevocationRecorded') or trace.get('liveClamavExecuted') or trace.get('liveYaraExecuted'): errors.append('trace_boundary_invalid')
phase('regression')
ft=full.get('totals',{}); dt=direct.get('totals',{})
if full.get('status')!='passed' or ft!={'testFiles':211,'tests':1706,'passed':1706,'failed':0} or full.get('runnerExitCode')!=0 or full.get('retry') or full.get('forceExitDisabled') is not True: errors.append('full_regression_invalid')
if direct.get('status')!='passed' or dt!={'testFiles':26,'tests':539,'passed':539,'failed':0} or direct.get('retry') or direct.get('forceExit'): errors.append('direct_v33_invalid')
if meta.get('version')!='33.26' or meta.get('testFileCount')!=211 or meta.get('timedOut') or meta.get('retry') or meta.get('forceExitDisabled') is not True: errors.append('regression_meta_invalid')
phase('truth-architecture')
inv=truth.get('inventory',{}); metrics=arch.get('metrics',{})
if inv.get('sourceModules')!=215 or inv.get('testFiles')!=211 or truth.get('findings')!=[]: errors.append('truth_map_invalid')
if metrics.get('sourceCycleCount')!=0 or metrics.get('untestedSourceCount')!=0 or metrics.get('capabilityPathCount')!=147 or metrics.get('closedCapabilityPathCount')!=147 or arch.get('status')!='PASS': errors.append('architecture_invalid')
for name in ['CONTRACT_REGISTRY_V33.json','CANONICAL_CAPABILITY_MAP_V33.json','PROOF_GATE_REGISTRY_V33.json','SOURCE_SYSTEM_REGISTRY_V33.json','VALUE_HYPOTHESIS_REGISTRY_V33.json']:
 if load('v33/governance-state/'+name).get('version')!='33.26': errors.append('governance_version_invalid:'+name)
phase('regeneration')
tr=subprocess.run(['node','scripts/repository-truth-map-v32_18.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=180)
ar=subprocess.run(['node','scripts/architecture-validation-v32.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=180)
if tr.returncode!=0 or ar.returncode!=0: errors.append('regeneration_failed')
else:
 rt=load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json'); ra=load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
 if rt.get('inventory')!=truth.get('inventory') or rt.get('findings')!=truth.get('findings'): errors.append('truth_regeneration_mismatch')
 if ra.get('graphDigest')!=arch.get('graphDigest') or ra.get('metrics')!=arch.get('metrics'): errors.append('architecture_regeneration_mismatch')
phase('manifest')
if manifest.get('version')!='33.26' or manifest.get('evidenceClass')!='LOCAL_SYNTHETIC_SCANNER_EVIDENCE_TRANSPARENCY_GATE' or manifest.get('externalEffects')!=0 or manifest.get('productionPromotion')!='blocked' or not manifest.get('files'): errors.append('manifest_boundary_invalid')
for item in manifest.get('files',[]):
 path=ROOT/str(item.get('path',''))
 if not path.is_file() or path.stat().st_size!=item.get('sizeBytes') or sha(path)!=item.get('sha256'): errors.append('manifest_file_invalid:'+str(item.get('path')))
result={'version':'33.26','status':'passed' if not errors else 'failed','evidenceClass':proof.get('evidenceClass'),'gates':{'G0':'passed','G1':'passed','G2':'in-progress-not-passed','G3':'in-progress-not-passed','G4':'in-progress-not-passed','G5':'in-progress-not-passed','G6':'in-progress-not-passed'},'scannerEvidenceImport':{'receipts':len(imports),'exactBytesVerified':all(x.get('payload',{}).get('exactArtifactBytesVerified') for x in imports)},'transparency':{'checkpointCount':len(checkpoints),'inclusionProofCount':len(inclusion),'consistencyProofType':consistency.get('proofType'),'emergencyRevocationRecorded':trace.get('emergencyRevocationRecorded')},'externalQualification':{'status':verdict.get('status'),'acceptedReceiptCount':verdict.get('acceptedReceiptCount'),'liveClamavExecuted':False,'liveYaraExecuted':False},'regression':ft,'directV33':dt,'truthMap':{'sourceModules':inv.get('sourceModules'),'testFiles':inv.get('testFiles'),'scripts':inv.get('scripts'),'findings':len(truth.get('findings',[]))},'architecture':{k:metrics.get(k) for k in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']},'errors':errors,'productionPromotion':'blocked'}
E.mkdir(parents=True,exist_ok=True);(E/'V33_26_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if not errors else 1)
