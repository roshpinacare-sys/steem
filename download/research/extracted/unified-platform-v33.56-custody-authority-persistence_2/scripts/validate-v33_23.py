#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; E=ROOT/'release-evidence/v33.23'; errors=[]
def load(rel:str): return json.loads((ROOT/rel).read_text())
def sha(p:Path): return hashlib.sha256(p.read_bytes()).hexdigest()
def phase(x): print(json.dumps({'phase':x}),flush=True)
required=[
'src/app/evidence-intake-portal-v33_23.ts','tests/evidence-intake-portal-v33_23.test.ts','scripts/signed-evidence-intake-proof-v33_23.mjs','scripts/verify-signed-evidence-intake-v33_23.mjs','scripts/verify-offline-evidence-package-v33_23.mjs','scripts/run-full-regression-v33_23.py','scripts/run-direct-v33-regression-v33_23.py','scripts/validate-v33_23.py','docs/V33_23_SIGNED_EXTERNAL_EVIDENCE_INTAKE_AND_OFFLINE_VERIFIER.md','CLAUDE_HANDOFF_v33_23.md',
'external-qualification/v33.23/evidence-intake/README.md','external-qualification/v33.23/evidence-intake/RUNBOOK.md','external-qualification/v33.23/evidence-intake/intake-policy.json','external-qualification/v33.23/evidence-intake/trust-policy.template.json','external-qualification/v33.23/evidence-intake/upload-request.template.json','external-qualification/v33.23/evidence-intake/scripts/hash-package.sh','external-qualification/v33.23/evidence-intake/scripts/check-no-secrets.sh','external-qualification/v33.23/evidence-intake/scripts/verify-offline.sh',
'release-evidence/v33.23/V33_23_SIGNED_EVIDENCE_INTAKE_PROOF.json','release-evidence/v33.23/V33_23_INTAKE_TRACE.json','release-evidence/v33.23/V33_23_QUARANTINE_SNAPSHOT.json','release-evidence/v33.23/V33_23_SCAN_REPORTS.json','release-evidence/v33.23/V33_23_INTAKE_RECEIPTS.json','release-evidence/v33.23/V33_23_OFFLINE_PACKAGE.json','release-evidence/v33.23/V33_23_PINNED_TRUST_POLICY.json','release-evidence/v33.23/V33_23_OFFLINE_VERIFICATION_VERDICT.json','release-evidence/v33.23/V33_23_OFFLINE_VERIFIER_REPORT.json','release-evidence/v33.23/V33_23_PORTAL_PROBE.json','release-evidence/v33.23/V33_23_EXTERNAL_OPERATOR_KIT_MANIFEST.json','release-evidence/v33.23/V33_23_PROOF_PUBLIC_KEYS.json',
'release-evidence/v33.23/V33_23_FULL_TEST_RESULTS.json','release-evidence/v33.23/V33_23_FULL_TEST_META.json','release-evidence/v33.23/V33_23_FULL_TEST_STDOUT.tap','release-evidence/v33.23/V33_23_FULL_TEST_STDERR.log','release-evidence/v33.23/V33_23_FULL_TEST_EXIT.txt','release-evidence/v33.23/V33_23_DIRECT_V33_RESULTS.json','release-evidence/v33.23/V33_23_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.23/V33_23_ARCHITECTURE_INTEGRITY.json','release-evidence/v33.23/V33_23_EXECUTION_LEDGER.md','release-evidence/v33.23/V33_23_RELEASE_MANIFEST.json']
for x in required:
 if not (ROOT/x).is_file(): errors.append('missing:'+x)
if errors:
 print(json.dumps({'version':'33.23','status':'failed','errors':errors},indent=2));sys.exit(1)
phase('load')
proof=load('release-evidence/v33.23/V33_23_SIGNED_EVIDENCE_INTAKE_PROOF.json');trace=load('release-evidence/v33.23/V33_23_INTAKE_TRACE.json');snapshot=load('release-evidence/v33.23/V33_23_QUARANTINE_SNAPSHOT.json');scans=load('release-evidence/v33.23/V33_23_SCAN_REPORTS.json');receipts=load('release-evidence/v33.23/V33_23_INTAKE_RECEIPTS.json');offline=load('release-evidence/v33.23/V33_23_OFFLINE_PACKAGE.json');policy=load('release-evidence/v33.23/V33_23_PINNED_TRUST_POLICY.json');verdict=load('release-evidence/v33.23/V33_23_OFFLINE_VERIFICATION_VERDICT.json');cli=load('release-evidence/v33.23/V33_23_OFFLINE_VERIFIER_REPORT.json');probe=load('release-evidence/v33.23/V33_23_PORTAL_PROBE.json');kit=load('release-evidence/v33.23/V33_23_EXTERNAL_OPERATOR_KIT_MANIFEST.json');full=load('release-evidence/v33.23/V33_23_FULL_TEST_RESULTS.json');meta=load('release-evidence/v33.23/V33_23_FULL_TEST_META.json');direct=load('release-evidence/v33.23/V33_23_DIRECT_V33_RESULTS.json');truth=load('release-evidence/v33.23/V33_23_REPOSITORY_TRUTH_MAP.json');arch=load('release-evidence/v33.23/V33_23_ARCHITECTURE_INTEGRITY.json');manifest=load('release-evidence/v33.23/V33_23_RELEASE_MANIFEST.json')
phase('boundaries')
p=proof.get('payload',{}); expected={'status':'SIGNED_EVIDENCE_INTAKE_AND_OFFLINE_VERIFIER_PROVEN_LOCALLY','evidenceClass':'LOCAL_LOOPBACK_QUARANTINE_AND_OFFLINE_VERIFICATION','loopbackPortalRoundTrip':True,'cleanBundleCount':1,'rejectedBundleCount':1,'quarantineRecordCount':2,'quarantineEventCount':2,'artifactCount':12,'cleanArtifactBytesVerified':True,'malwareSignatureRejected':True,'offlinePackageEncoded':True,'offlinePackagePublicKeyCount':6,'pinnedTrustPolicyVerified':True,'offlineVerdictStatus':'OFFLINE_VERIFIED_SYNTHETIC_NOT_EXTERNAL','offlineEligibleForExternalQualification':False,'externalMalwareScannerExecuted':False,'externalMalwareScanRequired':True,'publicIngressConfigured':False,'automaticArchiveExtraction':False,'liveExternalEvidenceImported':0,'operatorKitFileCount':8,'externalEffectsExecuted':0,'productionAuthority':'NONE','productionPromotion':'blocked'}
for k,v in expected.items():
 if p.get(k)!=v: errors.append('proof:'+k)
t=trace.get('payload',{})
if t.get('evidenceClass')!='LOCAL_LOOPBACK_QUARANTINE_AND_OFFLINE_VERIFICATION_TRACE' or t.get('quarantineRecordCount')!=2 or t.get('quarantineEventCount')!=2 or t.get('scanFindingCount',0)<1 or t.get('offlineCliStatus')!='passed' or t.get('networkAccessAttemptedByOfflineVerifier') is not False or t.get('externalEffectsExecuted')!=0 or t.get('productionAuthority')!='NONE': errors.append('trace_invalid')
if snapshot.get('version')!='33.23' or len(snapshot.get('records',[]))!=2 or len(snapshot.get('events',[]))!=2 or snapshot.get('productionAuthority')!='NONE' or snapshot.get('externalEffectsExecuted')!=0: errors.append('snapshot_invalid')
if len(scans)!=2 or {x.get('payload',{}).get('status') for x in scans}!={'BUILTIN_SCAN_PASSED','REJECTED'} or sum(x.get('payload',{}).get('findingCount',0) for x in scans)<1: errors.append('scans_invalid')
for x in scans:
 q=x.get('payload',{})
 if q.get('externalMalwareQualification')!='EXTERNAL_MALWARE_SCAN_REQUIRED' or q.get('productionAuthority')!='NONE' or q.get('externalEffectsExecuted')!=0: errors.append('scan_boundary_invalid')
if len(receipts)!=2 or sum(1 for x in receipts if x.get('payload',{}).get('eligibleForOfflineVerification'))!=1 or any(x.get('payload',{}).get('eligibleForExternalQualification') is not False for x in receipts): errors.append('receipts_invalid')
v=verdict.get('payload',{})
if v.get('status')!='OFFLINE_VERIFIED_SYNTHETIC_NOT_EXTERNAL' or v.get('artifactBytesVerified') is not True or v.get('builtinScanVerified') is not True or v.get('externalMalwareScanStillRequired') is not True or v.get('eligibleForEvidenceImport') is not True or v.get('eligibleForExternalQualification') is not False or v.get('networkAccessAttempted') is not False or v.get('productionAuthority')!='NONE': errors.append('offline_verdict_invalid')
if cli.get('status')!='passed' or cli.get('artifactBytesVerified') is not True or cli.get('builtinScanVerified') is not True or cli.get('externalMalwareScanStillRequired') is not True or cli.get('networkAccessAttempted') is not False or cli.get('ephemeralLocalVerifier') is not True or cli.get('qualificationAuthority') is not False or cli.get('productionAuthority')!='NONE': errors.append('offline_cli_invalid')
if policy.get('syntheticEvidenceAcceptedForExternalQualification') is not False or policy.get('externalMalwareScanRequired') is not True or policy.get('productionAuthority')!='NONE' or len(policy.get('roles',{}))!=6: errors.append('pinned_policy_invalid')
if probe.get('bindAddress')!='127.0.0.1' or probe.get('loopbackRoundTrip') is not True or probe.get('publicIngressConfigured') is not False or probe.get('automaticArchiveExtraction') is not False or probe.get('externalEffectsExecuted')!=0: errors.append('portal_probe_invalid')
if kit.get('credentialsEmbedded') is not False or kit.get('privateKeysEmbedded') is not False or kit.get('publicIngressConfigured') is not False or kit.get('automaticArchiveExtraction') is not False or kit.get('externalMalwareScannerExecuted') is not False or kit.get('productionAuthority')!='NONE' or len(kit.get('files',[]))!=8: errors.append('operator_kit_invalid')
phase('secret-scan')
for x in [y for y in required if y.startswith('external-qualification/v33.23/evidence-intake/')]:
 text=(ROOT/x).read_text(errors='ignore')
 if re.search(r'-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(?:ql)?://[^\s<]+|PGPASSWORD\s*=\s*[^\s#]+|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}',text,re.I): errors.append('secret_material:'+x)
phase('regression')
ft=full.get('totals',{})
if full.get('version')!='33.23' or full.get('status')!='passed' or (ft.get('testFiles'),ft.get('tests'),ft.get('passed'),ft.get('failed'))!=(208,1601,1601,0) or full.get('runnerExitCode')!=0 or full.get('timedOut') is not False or full.get('retry') is not False or full.get('forceExitDisabled') is not True: errors.append('full_regression_invalid')
if (E/'V33_23_FULL_TEST_EXIT.txt').read_text().strip()!='0': errors.append('full_exit_invalid')
if meta.get('version')!='33.23' or meta.get('testFileCount')!=208 or meta.get('exitCode')!=0 or meta.get('timedOut') is not False or meta.get('retry') is not False or meta.get('forceExitDisabled') is not True: errors.append('full_meta_invalid')
dt=direct.get('totals',{})
if direct.get('version')!='33.23' or direct.get('status')!='passed' or direct.get('independentProcessPerFile') is not True or (dt.get('testFiles'),dt.get('tests'),dt.get('passed'),dt.get('failed'))!=(23,434,434,0): errors.append('direct_v33_invalid')
inv=truth.get('inventory',{}); m=arch.get('metrics',{})
if truth.get('status')!='passed' or truth.get('findings') or (inv.get('sourceModules'),inv.get('testFiles'))!=(212,208): errors.append('truth_invalid')
if arch.get('status')!='PASS' or arch.get('findings') or (m.get('sourceCycleCount'),m.get('untestedSourceCount'),m.get('capabilityPathCount'),m.get('closedCapabilityPathCount'))!=(0,0,141,141): errors.append('architecture_invalid')
phase('verify-proof')
r=subprocess.run(['node','scripts/verify-signed-evidence-intake-v33_23.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=120)
if r.returncode!=0: errors.append('proof_verifier_failed:'+(r.stderr or r.stdout)[-400:])
r=subprocess.run(['node','scripts/verify-offline-evidence-package-v33_23.mjs','release-evidence/v33.23/V33_23_OFFLINE_PACKAGE.json','release-evidence/v33.23/V33_23_PINNED_TRUST_POLICY.json'],cwd=ROOT,capture_output=True,text=True,timeout=120)
if r.returncode!=0: errors.append('offline_verifier_failed:'+(r.stderr or r.stdout)[-400:])
phase('regenerate')
r=subprocess.run(['node','scripts/repository-truth-map-v32_18.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=180); a=subprocess.run(['node','scripts/architecture-validation-v32.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=180)
if r.returncode or a.returncode: errors.append('regeneration_failed')
else:
 rt=load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json');ra=load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
 if rt.get('inventory')!=truth.get('inventory') or rt.get('findings')!=truth.get('findings'): errors.append('truth_regeneration_mismatch')
 if ra.get('graphDigest')!=arch.get('graphDigest') or ra.get('metrics')!=arch.get('metrics'): errors.append('architecture_regeneration_mismatch')
phase('manifest')
for x in manifest.get('files',[]):
 path=ROOT/str(x.get('path',''))
 if not path.is_file() or path.stat().st_size!=x.get('sizeBytes') or sha(path)!=x.get('sha256'): errors.append('manifest_file_invalid:'+str(x.get('path')))
if manifest.get('version')!='33.23' or manifest.get('externalEffects')!=0 or manifest.get('productionPromotion')!='blocked' or manifest.get('evidenceClass')!='LOCAL_LOOPBACK_QUARANTINE_AND_OFFLINE_VERIFICATION': errors.append('manifest_boundary_invalid')
result={'version':'33.23','status':'passed' if not errors else 'failed','evidenceClass':p.get('evidenceClass'),'gates':{'G0':'passed','G1':'passed','G2':'in-progress-not-passed','G3':'in-progress-not-passed','G4':'in-progress-not-passed','G5':'in-progress-not-passed','G6':'in-progress-not-passed'},'evidenceIntake':{k:p.get(k) for k in expected},'regression':ft,'directV33':dt,'truthMap':{'sourceModules':inv.get('sourceModules'),'testFiles':inv.get('testFiles'),'findings':len(truth.get('findings',[]))},'architecture':{k:m.get(k) for k in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']},'errors':errors,'productionPromotion':'blocked'}
E.mkdir(parents=True,exist_ok=True);(E/'V33_23_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if not errors else 1)
