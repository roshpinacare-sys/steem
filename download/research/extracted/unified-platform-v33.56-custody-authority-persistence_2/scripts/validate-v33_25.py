#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, re, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; E=ROOT/'release-evidence/v33.25'; errors=[]
def load(rel): return json.loads((ROOT/rel).read_text())
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def phase(name): print(json.dumps({'phase':name}),flush=True)
required=[
'src/app/signature-supply-scanner-federation-v33_25.ts','tests/signature-supply-scanner-federation-v33_25.test.ts','scripts/scanner-engine-alpha-worker-v33_25.mjs','scripts/scanner-engine-beta-worker-v33_25.mjs','scripts/signature-supply-scanner-federation-proof-v33_25.mjs','scripts/verify-signature-supply-scanner-federation-v33_25.mjs','scripts/run-full-regression-v33_25.py','scripts/run-direct-v33-regression-v33_25.py','scripts/validate-v33_25.py','docs/V33_25_SIGNATURE_SUPPLY_CHAIN_AND_SCANNER_FEDERATION.md','CLAUDE_HANDOFF_v33_25.md','external-qualification/v33.25/scanner-federation/README.md','external-qualification/v33.25/scanner-federation/RUNBOOK.md','external-qualification/v33.25/scanner-federation/federation-policy.json','external-qualification/v33.25/scanner-federation/feed-policy.json','external-qualification/v33.25/scanner-federation/observation.template.json','external-qualification/v33.25/scanner-federation/scripts/probe-engines.sh','external-qualification/v33.25/scanner-federation/scripts/hash-feed-chain.sh','external-qualification/v33.25/scanner-federation/scripts/verify-host-separation.sh','external-qualification/v33.25/scanner-federation/scripts/verify-disagreement-policy.sh',
'release-evidence/v33.25/V33_25_SCANNER_TOOL_PROBE.json','release-evidence/v33.25/V33_25_SIGNATURE_FEED_CHAIN.json','release-evidence/v33.25/V33_25_SIGNATURE_FEED_WITNESS.json','release-evidence/v33.25/V33_25_CLEAN_ALPHA_RECEIPT.json','release-evidence/v33.25/V33_25_CLEAN_BETA_RECEIPT.json','release-evidence/v33.25/V33_25_CLEAN_FEDERATION_VERDICT.json','release-evidence/v33.25/V33_25_MALICIOUS_ALPHA_RECEIPT.json','release-evidence/v33.25/V33_25_MALICIOUS_BETA_RECEIPT.json','release-evidence/v33.25/V33_25_MALICIOUS_FEDERATION_VERDICT.json','release-evidence/v33.25/V33_25_DISAGREEMENT_ALPHA_RECEIPT.json','release-evidence/v33.25/V33_25_DISAGREEMENT_BETA_RECEIPT.json','release-evidence/v33.25/V33_25_DISAGREEMENT_FEDERATION_VERDICT.json','release-evidence/v33.25/V33_25_EXTERNAL_QUALIFICATION_CHALLENGE.json','release-evidence/v33.25/V33_25_SYNTHETIC_OBSERVATIONS.json','release-evidence/v33.25/V33_25_EXTERNAL_QUALIFICATION_VERDICT.json','release-evidence/v33.25/V33_25_SCANNER_FEDERATION_TRACE.json','release-evidence/v33.25/V33_25_SIGNATURE_SUPPLY_SCANNER_FEDERATION_PROOF.json','release-evidence/v33.25/V33_25_EXTERNAL_OPERATOR_KIT_MANIFEST.json','release-evidence/v33.25/V33_25_PROOF_PUBLIC_KEYS.json','release-evidence/v33.25/V33_25_FULL_TEST_RESULTS.json','release-evidence/v33.25/V33_25_FULL_TEST_META.json','release-evidence/v33.25/V33_25_FULL_TEST_STDOUT.tap','release-evidence/v33.25/V33_25_FULL_TEST_STDERR.log','release-evidence/v33.25/V33_25_FULL_TEST_EXIT.txt','release-evidence/v33.25/V33_25_DIRECT_V33_RESULTS.json','release-evidence/v33.25/V33_25_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.25/V33_25_ARCHITECTURE_INTEGRITY.json','release-evidence/v33.25/V33_25_EXECUTION_LEDGER.md','release-evidence/v33.25/V33_25_RELEASE_MANIFEST.json']
for rel in required:
 if not (ROOT/rel).is_file(): errors.append('missing:'+rel)
if errors:
 print(json.dumps({'version':'33.25','status':'failed','errors':errors},indent=2));sys.exit(1)
phase('load')
probe=load('release-evidence/v33.25/V33_25_SCANNER_TOOL_PROBE.json'); ledger=load('release-evidence/v33.25/V33_25_SIGNATURE_FEED_CHAIN.json'); witness=load('release-evidence/v33.25/V33_25_SIGNATURE_FEED_WITNESS.json')
clean_a=load('release-evidence/v33.25/V33_25_CLEAN_ALPHA_RECEIPT.json'); clean_b=load('release-evidence/v33.25/V33_25_CLEAN_BETA_RECEIPT.json'); clean_v=load('release-evidence/v33.25/V33_25_CLEAN_FEDERATION_VERDICT.json')
mal_a=load('release-evidence/v33.25/V33_25_MALICIOUS_ALPHA_RECEIPT.json'); mal_b=load('release-evidence/v33.25/V33_25_MALICIOUS_BETA_RECEIPT.json'); mal_v=load('release-evidence/v33.25/V33_25_MALICIOUS_FEDERATION_VERDICT.json')
dis_a=load('release-evidence/v33.25/V33_25_DISAGREEMENT_ALPHA_RECEIPT.json'); dis_b=load('release-evidence/v33.25/V33_25_DISAGREEMENT_BETA_RECEIPT.json'); dis_v=load('release-evidence/v33.25/V33_25_DISAGREEMENT_FEDERATION_VERDICT.json')
challenge=load('release-evidence/v33.25/V33_25_EXTERNAL_QUALIFICATION_CHALLENGE.json'); observations=load('release-evidence/v33.25/V33_25_SYNTHETIC_OBSERVATIONS.json'); verdict=load('release-evidence/v33.25/V33_25_EXTERNAL_QUALIFICATION_VERDICT.json'); trace=load('release-evidence/v33.25/V33_25_SCANNER_FEDERATION_TRACE.json'); proof=load('release-evidence/v33.25/V33_25_SIGNATURE_SUPPLY_SCANNER_FEDERATION_PROOF.json'); kit=load('release-evidence/v33.25/V33_25_EXTERNAL_OPERATOR_KIT_MANIFEST.json')
full=load('release-evidence/v33.25/V33_25_FULL_TEST_RESULTS.json'); meta=load('release-evidence/v33.25/V33_25_FULL_TEST_META.json'); direct=load('release-evidence/v33.25/V33_25_DIRECT_V33_RESULTS.json'); truth=load('release-evidence/v33.25/V33_25_REPOSITORY_TRUTH_MAP.json'); arch=load('release-evidence/v33.25/V33_25_ARCHITECTURE_INTEGRITY.json'); manifest=load('release-evidence/v33.25/V33_25_RELEASE_MANIFEST.json')
phase('boundaries')
p=proof.get('payload',{}); expected={'status':'SIGNATURE_SUPPLY_CHAIN_AND_SCANNER_FEDERATION_PROVEN_LOCALLY','evidenceClass':'LOCAL_SIGNED_FEED_CHAIN_AND_TWO_REFERENCE_SCANNER_FEDERATION','focusedTestsExpected':35,'feedChainDepth':3,'signedFeedUpdatesVerified':True,'rollbackProtectionVerified':True,'feedPoisoningRejected':True,'feedRevocationSupported':True,'separateScannerProcessesVerified':True,'distinctReferenceImplementationsVerified':True,'cleanFederationPassed':True,'malwareFederationRejected':True,'disagreementQuarantined':True,'disagreementPolicy':'FAIL_CLOSED_QUARANTINE','externalClamavQualified':False,'externalYaraQualified':False,'syntheticObservations':2,'syntheticObservationsAccepted':0,'qualificationStatus':'EXTERNAL_SCANNER_FEDERATION_QUALIFICATION_REQUIRED','operatorKitFileCount':9,'productionAuthority':'NONE','externalEffectsExecuted':0,'productionPromotion':'blocked'}
for k,v in expected.items():
 if p.get(k)!=v: errors.append('proof:'+k)
if probe.get('externalScannerFederationQualified') is not False or probe.get('productionAuthority')!='NONE' or probe.get('externalEffectsExecuted')!=0: errors.append('probe_boundary_invalid')
lp=ledger.get('payload',{}); wp=witness.get('payload',{}); feeds=lp.get('feeds',[])
if len(feeds)!=3 or lp.get('highestSequence')!=3 or wp.get('highestSequence')!=3 or lp.get('latestFeedDigest')!=wp.get('latestFeedDigest') or lp.get('productionAuthority')!='NONE' or lp.get('externalEffectsExecuted')!=0: errors.append('feed_ledger_invalid')
prior='0'*64
critical={'EICAR_TEST_FILE','PE_EXECUTABLE_MAGIC','ELF_EXECUTABLE_MAGIC','PRIVATE_KEY_MATERIAL'}
for i,env in enumerate(feeds,1):
 fp=env.get('payload',{}); ids={r.get('ruleId') for r in fp.get('rules',[])}
 if fp.get('sequence')!=i or fp.get('previousFeedDigest')!=prior or fp.get('sourceClass')!='LOCAL_REFERENCE_FEED' or fp.get('externalQualificationEligible') is not False or not critical.issubset(ids): errors.append('feed_chain_invalid:'+str(i))
 prior=fp.get('feedDigest')
if wp.get('latestFeedDigest')!=prior: errors.append('feed_witness_digest_invalid')
for a,b,v,status in [(clean_a,clean_b,clean_v,'FEDERATION_PASSED'),(mal_a,mal_b,mal_v,'FEDERATION_REJECTED'),(dis_a,dis_b,dis_v,'FEDERATION_QUARANTINED')]:
 ap=a.get('payload',{});bp=b.get('payload',{});vp=v.get('payload',{})
 if ap.get('workerPid')==ap.get('parentPid') or bp.get('workerPid')==bp.get('parentPid') or ap.get('implementationDigest')==bp.get('implementationDigest') or vp.get('status')!=status or vp.get('disagreementPolicy')!='FAIL_CLOSED_QUARANTINE' or vp.get('externalScannerFederationEligible') is not False or vp.get('productionAuthority')!='NONE' or vp.get('externalEffectsExecuted')!=0: errors.append('federation_invalid:'+status)
if clean_a['payload'].get('status')!='PASSED' or clean_b['payload'].get('status')!='PASSED' or mal_a['payload'].get('status')!='REJECTED' or mal_b['payload'].get('status')!='REJECTED' or dis_a['payload'].get('status')==dis_b['payload'].get('status') or dis_v['payload'].get('disagreementCount',0)<1: errors.append('engine_result_matrix_invalid')
vp=verdict.get('payload',{})
if len(observations)!=2 or any(x.get('payload',{}).get('evidenceClass')!='SYNTHETIC_CONTRACT_TEST' for x in observations) or vp.get('status')!='EXTERNAL_SCANNER_FEDERATION_QUALIFICATION_REQUIRED' or vp.get('acceptedObservationCount')!=0 or vp.get('syntheticObservationCount')!=2 or vp.get('eligibleForProductionPromotion') is not False: errors.append('external_qualification_boundary_invalid')
cp=challenge.get('payload',{})
if cp.get('requiredEngines')!=['CLAMAV','YARA'] or cp.get('minimumFeedChainDepth')!=3 or cp.get('disagreementPolicy')!='FAIL_CLOSED_QUARANTINE' or cp.get('syntheticEvidenceAccepted') is not False: errors.append('challenge_invalid')
tp=trace.get('payload',{})
if tp.get('rollbackRejected') is not True or tp.get('poisoningRejected') is not True or tp.get('cleanStatus')!='FEDERATION_PASSED' or tp.get('maliciousStatus')!='FEDERATION_REJECTED' or tp.get('disagreementStatus')!='FEDERATION_QUARANTINED' or tp.get('liveClamavExecuted') is not False or tp.get('liveYaraExecuted') is not False: errors.append('trace_invalid')
phase('operator-kit')
files=kit.get('files',[])
if len(files)!=9 or kit.get('scannerBinariesEmbedded') is not False or kit.get('signatureDatabasesEmbedded') is not False or kit.get('credentialsEmbedded') is not False or kit.get('privateKeysEmbedded') is not False or kit.get('liveExternalEvidenceIncluded') is not False: errors.append('operator_kit_invalid')
secret=re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|postgres(?:ql)?://[^\s<]+',re.I)
for item in files:
 path=ROOT/str(item.get('path',''))
 if not path.is_file() or path.stat().st_size!=item.get('sizeBytes') or sha(path)!=item.get('sha256'): errors.append('operator_kit_file_invalid:'+str(item.get('path')))
 elif secret.search(path.read_text(errors='ignore')): errors.append('operator_kit_secret:'+str(item.get('path')))
phase('regression')
ft=full.get('totals',{});dt=direct.get('totals',{})
if full.get('version')!='33.25' or full.get('status')!='passed' or (ft.get('testFiles'),ft.get('tests'),ft.get('passed'),ft.get('failed'))!=(210,1667,1667,0) or full.get('runnerExitCode')!=0 or full.get('timedOut') is not False or full.get('retry') is not False or full.get('forceExitDisabled') is not True or full.get('sensitiveFileCount')!=15: errors.append('full_regression_invalid')
if 'fifteen stateful' not in full.get('testTopologyReason',''): errors.append('full_topology_invalid')
if (E/'V33_25_FULL_TEST_EXIT.txt').read_text().strip()!='0': errors.append('full_exit_invalid')
if meta.get('version')!='33.25' or meta.get('testFileCount')!=210 or meta.get('exitCode')!=0 or meta.get('retry') is not False or meta.get('forceExitDisabled') is not True or meta.get('topology')!=full.get('topology'): errors.append('full_meta_invalid')
if sha(E/'V33_25_FULL_TEST_STDOUT.tap')!=full.get('stdoutSha256') or sha(E/'V33_25_FULL_TEST_STDERR.log')!=full.get('stderrSha256'): errors.append('full_output_hash_invalid')
if direct.get('version')!='33.25' or direct.get('status')!='passed' or direct.get('independentProcessPerFile') is not True or direct.get('retry') is not False or direct.get('forceExit') is not False or (dt.get('testFiles'),dt.get('tests'),dt.get('passed'),dt.get('failed'))!=(25,500,500,0): errors.append('direct_v33_invalid')
inv=truth.get('inventory',{}); metrics=arch.get('metrics',{})
if truth.get('status')!='passed' or truth.get('findings') or (inv.get('sourceModules'),inv.get('testFiles'))!=(214,210): errors.append('truth_invalid')
if arch.get('status')!='PASS' or arch.get('findings') or (metrics.get('sourceCycleCount'),metrics.get('untestedSourceCount'),metrics.get('capabilityPathCount'),metrics.get('closedCapabilityPathCount'))!=(0,0,145,145): errors.append('architecture_invalid')
phase('governance')
for name in ['AUTHORITY_CONFLICT_MAP_V33.json','CANONICAL_CAPABILITY_MAP_V33.json','CONTRACT_REGISTRY_V33.json','PROOF_GATE_REGISTRY_V33.json','SOURCE_SYSTEM_REGISTRY_V33.json','VALUE_HYPOTHESIS_REGISTRY_V33.json']:
 if load('v33/governance-state/'+name).get('version')!='33.25': errors.append('governance_version:'+name)
gates=load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json');g5=next(x for x in gates['gates'] if x['id']=='G5')
if g5.get('status')!='in-progress' or 'live-clamav-yara-qualification-not-executed' not in g5.get('prototypeStatus',''): errors.append('g5_boundary_invalid')
phase('verify-proof')
proc=subprocess.run(['node','scripts/verify-signature-supply-scanner-federation-v33_25.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=120)
if proc.returncode!=0: errors.append('proof_verifier_failed:'+(proc.stderr or proc.stdout)[-500:])
else:
 try:
  out=json.loads(proc.stdout)
  if out.get('status')!='passed' or out.get('signaturesVerified',0)<20 or out.get('externalFederationQualified') is not False or out.get('productionAuthority')!='NONE': errors.append('proof_verifier_boundary_invalid')
 except Exception: errors.append('proof_verifier_output_invalid')
phase('regenerate')
tr=subprocess.run(['node','scripts/repository-truth-map-v32_18.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=180); ar=subprocess.run(['node','scripts/architecture-validation-v32.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=180)
if tr.returncode!=0 or ar.returncode!=0: errors.append('regeneration_failed')
else:
 rt=load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json');ra=load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
 if rt.get('inventory')!=truth.get('inventory') or rt.get('findings')!=truth.get('findings'): errors.append('truth_regeneration_mismatch')
 if ra.get('graphDigest')!=arch.get('graphDigest') or ra.get('metrics')!=arch.get('metrics'): errors.append('architecture_regeneration_mismatch')
phase('manifest')
if manifest.get('version')!='33.25' or manifest.get('evidenceClass')!='LOCAL_SIGNED_FEED_CHAIN_AND_TWO_REFERENCE_SCANNER_FEDERATION' or manifest.get('externalEffects')!=0 or manifest.get('productionPromotion')!='blocked' or not manifest.get('files'): errors.append('manifest_boundary_invalid')
for item in manifest.get('files',[]):
 path=ROOT/str(item.get('path',''))
 if not path.is_file() or path.stat().st_size!=item.get('sizeBytes') or sha(path)!=item.get('sha256'): errors.append('manifest_file_invalid:'+str(item.get('path')))
result={'version':'33.25','status':'passed' if not errors else 'failed','evidenceClass':p.get('evidenceClass'),'gates':{'G0':'passed','G1':'passed','G2':'in-progress-not-passed','G3':'in-progress-not-passed','G4':'in-progress-not-passed','G5':'in-progress-not-passed','G6':'in-progress-not-passed'},'signatureSupplyChain':{'feedChainDepth':p.get('feedChainDepth'),'rollbackProtectionVerified':p.get('rollbackProtectionVerified'),'feedPoisoningRejected':p.get('feedPoisoningRejected')},'scannerFederation':{'clean':clean_v['payload'].get('status'),'malicious':mal_v['payload'].get('status'),'disagreement':dis_v['payload'].get('status'),'externalQualified':False},'regression':ft,'directV33':dt,'truthMap':{'sourceModules':inv.get('sourceModules'),'testFiles':inv.get('testFiles'),'scripts':inv.get('scripts'),'findings':len(truth.get('findings',[]))},'architecture':{k:metrics.get(k) for k in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']},'errors':errors,'productionPromotion':'blocked'}
E.mkdir(parents=True,exist_ok=True);(E/'V33_25_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if not errors else 1)
