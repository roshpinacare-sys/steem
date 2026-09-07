#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, re, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
E=ROOT/'release-evidence/v33.22'
errors=[]
def load(path:str): return json.loads((ROOT/path).read_text())
def sha(path:Path): return hashlib.sha256(path.read_bytes()).hexdigest()
def phase(name:str): print(json.dumps({'phase':name}),flush=True)
required=[
 'src/app/postgres-ha-pitr-evidence-v33_22.ts','tests/postgres-ha-pitr-evidence-v33_22.test.ts','scripts/postgres-ha-pitr-evidence-proof-v33_22.mjs','scripts/verify-postgres-ha-pitr-evidence-v33_22.mjs','scripts/run-full-regression-v33_22.py','scripts/run-direct-v33-regression-v33_22.py','scripts/validate-v33_22.py','docs/V33_22_POSTGRESQL_EXTERNAL_EVIDENCE_IMPORT_AND_HA_PITR_QUALIFICATION.md','CLAUDE_HANDOFF_v33_22.md',
 'external-qualification/v33.22/postgresql-ha-pitr/README.md','external-qualification/v33.22/postgresql-ha-pitr/RUNBOOK.md','external-qualification/v33.22/postgresql-ha-pitr/evidence-policy.json','external-qualification/v33.22/postgresql-ha-pitr/ha-bundle.template.json','external-qualification/v33.22/postgresql-ha-pitr/pitr-bundle.template.json','external-qualification/v33.22/postgresql-ha-pitr/artifact-manifest.template.json','external-qualification/v33.22/postgresql-ha-pitr/scripts/hash-artifacts.sh','external-qualification/v33.22/postgresql-ha-pitr/scripts/check-no-secrets.sh','external-qualification/v33.22/postgresql-ha-pitr/scripts/collect-server-facts.sql','external-qualification/v33.22/postgresql-ha-pitr/scripts/collect-integrity.sql',
 'release-evidence/v33.22/V33_22_POSTGRES_HA_PITR_EVIDENCE_IMPORT_PROOF.json','release-evidence/v33.22/V33_22_HA_PITR_IMPORT_TRACE.json','release-evidence/v33.22/V33_22_EXTERNAL_QUALIFICATION_CHALLENGE.json','release-evidence/v33.22/V33_22_SYNTHETIC_HA_PITR_BUNDLES.json','release-evidence/v33.22/V33_22_EVIDENCE_IMPORT_RECEIPTS.json','release-evidence/v33.22/V33_22_EVIDENCE_IMPORT_LEDGER.json','release-evidence/v33.22/V33_22_HA_PITR_QUALIFICATION_VERDICT.json','release-evidence/v33.22/V33_22_POSTGRES_HA_PITR_INFRASTRUCTURE_PROBE.json','release-evidence/v33.22/V33_22_EXTERNAL_OPERATOR_KIT_MANIFEST.json','release-evidence/v33.22/V33_22_PROOF_PUBLIC_KEYS.json','release-evidence/v33.22/V33_22_FULL_TEST_RESULTS.json','release-evidence/v33.22/V33_22_FULL_TEST_META.json','release-evidence/v33.22/V33_22_FULL_TEST_STDOUT.tap','release-evidence/v33.22/V33_22_FULL_TEST_STDERR.log','release-evidence/v33.22/V33_22_FULL_TEST_EXIT.txt','release-evidence/v33.22/V33_22_DIRECT_V33_RESULTS.json','release-evidence/v33.22/V33_22_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.22/V33_22_ARCHITECTURE_INTEGRITY.json','release-evidence/v33.22/V33_22_EXECUTION_LEDGER.md','release-evidence/v33.22/V33_22_RELEASE_MANIFEST.json'
]
for item in required:
 if not (ROOT/item).is_file(): errors.append('missing:'+item)
if errors:
 print(json.dumps({'version':'33.22','status':'failed','errors':errors},indent=2));sys.exit(1)
phase('load')
proof=load('release-evidence/v33.22/V33_22_POSTGRES_HA_PITR_EVIDENCE_IMPORT_PROOF.json')
trace=load('release-evidence/v33.22/V33_22_HA_PITR_IMPORT_TRACE.json')
challenge=load('release-evidence/v33.22/V33_22_EXTERNAL_QUALIFICATION_CHALLENGE.json')
bundles=load('release-evidence/v33.22/V33_22_SYNTHETIC_HA_PITR_BUNDLES.json')
receipts=load('release-evidence/v33.22/V33_22_EVIDENCE_IMPORT_RECEIPTS.json')
ledger=load('release-evidence/v33.22/V33_22_EVIDENCE_IMPORT_LEDGER.json')
verdict=load('release-evidence/v33.22/V33_22_HA_PITR_QUALIFICATION_VERDICT.json')
probe=load('release-evidence/v33.22/V33_22_POSTGRES_HA_PITR_INFRASTRUCTURE_PROBE.json')
kit=load('release-evidence/v33.22/V33_22_EXTERNAL_OPERATOR_KIT_MANIFEST.json')
full=load('release-evidence/v33.22/V33_22_FULL_TEST_RESULTS.json');meta=load('release-evidence/v33.22/V33_22_FULL_TEST_META.json');direct=load('release-evidence/v33.22/V33_22_DIRECT_V33_RESULTS.json');truth=load('release-evidence/v33.22/V33_22_REPOSITORY_TRUTH_MAP.json');arch=load('release-evidence/v33.22/V33_22_ARCHITECTURE_INTEGRITY.json');manifest=load('release-evidence/v33.22/V33_22_RELEASE_MANIFEST.json')
phase('boundaries')
p=proof.get('payload',{})
expected={'status':'POSTGRES_HA_PITR_EVIDENCE_IMPORT_AND_GATE_PROVEN_LOCALLY','evidenceClass':'LOCAL_SYNTHETIC_HA_PITR_IMPORT_GATE','syntheticBundleCount':2,'syntheticBundleImportedCount':2,'syntheticBundleEligibleCount':0,'syntheticBundleAcceptedCount':0,'artifactCount':13,'artifactBytesVerified':True,'replayIdempotent':True,'tamperedArtifactRejected':True,'ledgerEventCount':2,'requiredIndependentOperators':2,'requiredIndependentHosts':2,'qualificationVerdict':'EXTERNAL_HA_PITR_QUALIFICATION_REQUIRED','liveExternalEvidenceImported':0,'liveHaPitrQualified':False,'failoverExecuted':False,'backupExecuted':False,'restoreExecuted':False,'pitrExecuted':False,'operatorKitFileCount':10,'externalEffectsExecuted':0,'productionAuthority':'NONE','productionPromotion':'blocked'}
for k,v in expected.items():
 if p.get(k)!=v: errors.append('proof:'+k)
if p.get('requiredRoles')!=['HA_OPERATOR','PITR_OPERATOR']: errors.append('proof:requiredRoles')
t=trace.get('payload',{})
if t.get('evidenceClass')!='LOCAL_SYNTHETIC_HA_PITR_IMPORT_TRACE' or t.get('artifactBytesVerified') is not True or t.get('replayIdempotent') is not True or t.get('tamperedArtifactRejected') is not True or t.get('ledgerEventCount')!=2 or t.get('qualificationVerdict')!='EXTERNAL_HA_PITR_QUALIFICATION_REQUIRED' or t.get('acceptedBundleCount')!=0 or t.get('externalEffectsExecuted')!=0: errors.append('trace_invalid')
c=challenge.get('payload',{})
if c.get('syntheticEvidenceAccepted') is not False or c.get('sameHostEvidenceAccepted') is not False or c.get('requiredIndependentOperators')!=2 or c.get('requiredIndependentHosts')!=2 or c.get('requiredRoles')!=['HA_OPERATOR','PITR_OPERATOR'] or c.get('productionAuthority')!='NONE': errors.append('challenge_invalid')
if len(bundles)!=2 or any(x.get('envelope',{}).get('payload',{}).get('evidenceClass')!='SYNTHETIC_CONTRACT_TEST' for x in bundles): errors.append('synthetic_bundles_invalid')
if len(receipts)!=2 or any(x.get('payload',{}).get('eligibleForExternalQualification') is not False for x in receipts): errors.append('import_receipts_invalid')
if ledger.get('payload',{}).get('version')!='33.22' or len(ledger.get('payload',{}).get('imports',[]))!=2 or len(ledger.get('payload',{}).get('events',[]))!=2 or ledger.get('payload',{}).get('productionAuthority')!='NONE': errors.append('ledger_invalid')
if verdict.get('payload',{}).get('status')!='EXTERNAL_HA_PITR_QUALIFICATION_REQUIRED' or verdict.get('payload',{}).get('acceptedBundleIds')!=[] or verdict.get('payload',{}).get('productionAuthority')!='NONE': errors.append('synthetic_gate_invalid')
if probe.get('liveDatabaseConnectionAttempted') is not False or any(probe.get(k) is not False for k in ['failoverExecuted','backupExecuted','restoreExecuted','pitrExecuted']) or probe.get('productionAuthority')!='NONE': errors.append('infrastructure_boundary_invalid')
if kit.get('credentialsEmbedded') is not False or kit.get('livePostgresOperationsExecuted') is not False or kit.get('liveExternalEvidenceImported') is not False or kit.get('productionAuthority')!='NONE' or len(kit.get('files',[]))!=10: errors.append('operator_kit_invalid')
phase('secret-scan')
for item in [x for x in required if x.startswith('external-qualification/v33.22/postgresql-ha-pitr/')]:
 text=(ROOT/item).read_text(errors='ignore')
 if re.search(r'-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(?:ql)?://[^\s<]+|PGPASSWORD\s*=\s*[^\s#]+|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}',text,re.I): errors.append('secret_material:'+item)
phase('regression')
ft=full.get('totals',{})
if full.get('version')!='33.22' or full.get('status')!='passed' or (ft.get('testFiles'),ft.get('tests'),ft.get('passed'),ft.get('failed'))!=(207,1566,1566,0) or full.get('runnerExitCode')!=0 or full.get('timedOut') is not False or full.get('retry') is not False or full.get('forceExitDisabled') is not True: errors.append('full_regression_invalid')
if (E/'V33_22_FULL_TEST_EXIT.txt').read_text().strip()!='0': errors.append('full_exit_invalid')
if meta.get('version')!='33.22' or meta.get('testFileCount')!=207 or meta.get('exitCode')!=0 or meta.get('timedOut') is not False or meta.get('retry') is not False: errors.append('full_meta_invalid')
dt=direct.get('totals',{})
if direct.get('version')!='33.22' or direct.get('status')!='passed' or direct.get('independentProcessPerFile') is not True or (dt.get('testFiles'),dt.get('tests'),dt.get('passed'),dt.get('failed'))!=(22,399,399,0): errors.append('direct_v33_invalid')
inv=truth.get('inventory',{});m=arch.get('metrics',{})
if truth.get('status')!='passed' or truth.get('findings') or (inv.get('sourceModules'),inv.get('testFiles'))!=(211,207): errors.append('truth_invalid')
if arch.get('status')!='PASS' or arch.get('findings') or (m.get('sourceCycleCount'),m.get('untestedSourceCount'),m.get('capabilityPathCount'),m.get('closedCapabilityPathCount'))!=(0,0,139,139): errors.append('architecture_invalid')
phase('verify-proof')
r=subprocess.run(['node','scripts/verify-postgres-ha-pitr-evidence-v33_22.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=90)
if r.returncode!=0: errors.append('proof_verifier_failed:'+r.stderr[-300:])
phase('regenerate')
r=subprocess.run(['node','scripts/repository-truth-map-v32_18.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=120);a=subprocess.run(['node','scripts/architecture-validation-v32.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=120)
if r.returncode or a.returncode: errors.append('regeneration_failed')
else:
 rt=load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json');ra=load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
 if rt.get('inventory')!=truth.get('inventory') or rt.get('findings')!=truth.get('findings'): errors.append('truth_regeneration_mismatch')
 if ra.get('graphDigest')!=arch.get('graphDigest'): errors.append('architecture_regeneration_mismatch')
phase('manifest')
for item in manifest.get('files',[]):
 path=ROOT/str(item.get('path',''))
 if not path.is_file() or path.stat().st_size!=item.get('sizeBytes') or sha(path)!=item.get('sha256'): errors.append('manifest_file_invalid:'+str(item.get('path')))
if manifest.get('version')!='33.22' or manifest.get('externalEffects')!=0 or manifest.get('productionPromotion')!='blocked' or manifest.get('evidenceClass')!='LOCAL_SYNTHETIC_HA_PITR_IMPORT_GATE': errors.append('manifest_boundary_invalid')
result={'version':'33.22','status':'passed' if not errors else 'failed','evidenceClass':p.get('evidenceClass'),'gates':{'G0':'passed','G1':'passed','G2':'in-progress-not-passed','G3':'in-progress-not-passed','G4':'in-progress-not-passed','G5':'in-progress-not-passed','G6':'in-progress-not-passed'},'postgresHaPitr':{k:p.get(k) for k in expected},'regression':ft,'directV33':dt,'truthMap':{'sourceModules':inv.get('sourceModules'),'testFiles':inv.get('testFiles'),'findings':len(truth.get('findings',[]))},'architecture':{k:m.get(k) for k in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']},'errors':errors,'productionPromotion':'blocked'}
E.mkdir(parents=True,exist_ok=True);(E/'V33_22_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if not errors else 1)
