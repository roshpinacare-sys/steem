#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, re, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
E=ROOT/'release-evidence/v33.21'
errors=[]
def load(path:str): return json.loads((ROOT/path).read_text())
def sha(path:Path): return hashlib.sha256(path.read_bytes()).hexdigest()
def phase(name:str): print(json.dumps({'phase':name}),flush=True)
required=[
 'package.json','CLAUDE_HANDOFF_v33_21.md','docs/V33_21_POSTGRESQL_DURABLE_AUTHORITY_ADAPTER_AND_OPERATOR_KIT.md',
 'src/app/postgres-durable-authority-v33_21.ts','tests/postgres-durable-authority-v33_21.test.ts',
 'scripts/postgres-durable-authority-proof-v33_21.mjs','scripts/verify-postgres-durable-authority-v33_21.mjs','scripts/run-full-regression-v33_21.py','scripts/run-direct-v33-regression-v33_21.py','scripts/validate-v33_21.py','scripts/architecture-validation-v32.mjs',
 'v33/governance-state/CONTRACT_REGISTRY_V33.json','v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json','v33/governance-state/PROOF_GATE_REGISTRY_V33.json',
 'external-qualification/v33.21/postgresql/README.md','external-qualification/v33.21/postgresql/RUNBOOK.md','external-qualification/v33.21/postgresql/operator.env.example','external-qualification/v33.21/postgresql/migration-manifest.json','external-qualification/v33.21/postgresql/verify-controls.sql','external-qualification/v33.21/postgresql/scripts/apply-migrations.sh','external-qualification/v33.21/postgresql/scripts/collect-facts.sh',
 'external-qualification/v33.21/postgresql/migrations/001_v33_21_001.sql','external-qualification/v33.21/postgresql/migrations/002_v33_21_002.sql','external-qualification/v33.21/postgresql/migrations/003_v33_21_003.sql',
 'release-evidence/v33.21/V33_21_POSTGRES_DURABLE_AUTHORITY_PROOF.json','release-evidence/v33.21/V33_21_POSTGRES_ADAPTER_TRACE.json','release-evidence/v33.21/V33_21_POSTGRES_MIGRATION_MANIFEST.json','release-evidence/v33.21/V33_21_EXTERNAL_QUALIFICATION_CHALLENGE.json','release-evidence/v33.21/V33_21_SYNTHETIC_OPERATOR_OBSERVATIONS.json','release-evidence/v33.21/V33_21_POSTGRES_QUALIFICATION_VERDICT.json','release-evidence/v33.21/V33_21_POSTGRES_INFRASTRUCTURE_PROBE.json','release-evidence/v33.21/V33_21_POSTGRES_OPERATOR_KIT_MANIFEST.json','release-evidence/v33.21/V33_21_PROOF_PUBLIC_KEYS.json',
 'release-evidence/v33.21/V33_21_FULL_TEST_RESULTS.json','release-evidence/v33.21/V33_21_FULL_TEST_META.json','release-evidence/v33.21/V33_21_FULL_TEST_STDOUT.tap','release-evidence/v33.21/V33_21_FULL_TEST_STDERR.log','release-evidence/v33.21/V33_21_FULL_TEST_EXIT.txt','release-evidence/v33.21/V33_21_DIRECT_V33_RESULTS.json','release-evidence/v33.21/V33_21_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.21/V33_21_ARCHITECTURE_INTEGRITY.json','release-evidence/v33.21/V33_21_EXECUTION_LEDGER.md','release-evidence/v33.21/V33_21_RELEASE_MANIFEST.json'
]
for item in required:
 if not (ROOT/item).is_file(): errors.append('missing:'+item)
if errors:
 print(json.dumps({'version':'33.21','status':'failed','errors':errors},indent=2));sys.exit(1)
phase('load')
proof=load('release-evidence/v33.21/V33_21_POSTGRES_DURABLE_AUTHORITY_PROOF.json')
trace=load('release-evidence/v33.21/V33_21_POSTGRES_ADAPTER_TRACE.json')
migrations=load('release-evidence/v33.21/V33_21_POSTGRES_MIGRATION_MANIFEST.json')
challenge=load('release-evidence/v33.21/V33_21_EXTERNAL_QUALIFICATION_CHALLENGE.json')
observations=load('release-evidence/v33.21/V33_21_SYNTHETIC_OPERATOR_OBSERVATIONS.json')
verdict=load('release-evidence/v33.21/V33_21_POSTGRES_QUALIFICATION_VERDICT.json')
probe=load('release-evidence/v33.21/V33_21_POSTGRES_INFRASTRUCTURE_PROBE.json')
kit=load('release-evidence/v33.21/V33_21_POSTGRES_OPERATOR_KIT_MANIFEST.json')
full=load('release-evidence/v33.21/V33_21_FULL_TEST_RESULTS.json');meta=load('release-evidence/v33.21/V33_21_FULL_TEST_META.json');direct=load('release-evidence/v33.21/V33_21_DIRECT_V33_RESULTS.json');truth=load('release-evidence/v33.21/V33_21_REPOSITORY_TRUTH_MAP.json');arch=load('release-evidence/v33.21/V33_21_ARCHITECTURE_INTEGRITY.json');manifest=load('release-evidence/v33.21/V33_21_RELEASE_MANIFEST.json')
phase('boundaries')
p=proof.get('payload',{})
expected={'status':'POSTGRES_DURABLE_AUTHORITY_ADAPTER_AND_OPERATOR_KIT_PROVEN_LOCALLY','evidenceClass':'LOCAL_POSTGRESQL_CONTRACT_AND_EXTERNAL_OPERATOR_KIT','migrationCount':3,'migrationChainVerified':True,'serializableTransaction':True,'transactionScopedAdvisoryLock':True,'rowLockForUpdate':True,'atomicDecisionAndOutbox':True,'boundedSerializationRetry':True,'embeddedSecrets':0,'operatorKitFileCount':10,'postgresInfrastructureStatus':'UNAVAILABLE_FAIL_CLOSED','livePostgresConnectionAttempted':False,'livePostgresQualified':False,'syntheticObservationCount':2,'syntheticObservationAcceptedCount':0,'qualificationVerdict':'EXTERNAL_QUALIFICATION_REQUIRED','requiredIndependentOperators':2,'requiredIndependentHosts':2,'externalEffectsExecuted':0,'productionAuthority':'NONE','productionPromotion':'blocked'}
for k,v in expected.items():
 if p.get(k)!=v: errors.append('proof:'+k)
if trace.get('payload',{}).get('evidenceClass')!='LOCAL_POSTGRES_CONTRACT_ADAPTER_TRACE' or trace.get('payload',{}).get('released') is not True or trace.get('payload',{}).get('receipt',{}).get('externalEffectsExecuted')!=0: errors.append('trace_invalid')
calls=[x.get('sql') for x in trace.get('payload',{}).get('calls',[])]
required_calls=['BEGIN ISOLATION LEVEL SERIALIZABLE','SELECT pg_try_advisory_xact_lock(hashtextextended($1::text, 0)) AS locked','SELECT governed_authority.process_lease_command_v1($1::jsonb) AS decision','COMMIT']
if any(x not in calls for x in required_calls) or calls[-1:]!=['COMMIT']: errors.append('trace_transaction_invalid')
if migrations.get('version')!='33.21' or len(migrations.get('migrations',[]))!=3 or migrations.get('migrationChainDigest')!=p.get('migrationChainDigest') or migrations.get('productionAuthority')!='NONE': errors.append('migration_manifest_invalid')
if challenge.get('payload',{}).get('syntheticEvidenceAccepted') is not False or challenge.get('payload',{}).get('sameHostEvidenceAccepted') is not False or challenge.get('payload',{}).get('requiredIndependentHosts')!=2 or challenge.get('payload',{}).get('requiredIndependentOperators')!=2: errors.append('challenge_invalid')
if len(observations)!=2 or any(x.get('payload',{}).get('evidenceClass')!='SYNTHETIC_CONTRACT_TEST' for x in observations): errors.append('synthetic_observations_invalid')
if verdict.get('payload',{}).get('status')!='EXTERNAL_QUALIFICATION_REQUIRED' or verdict.get('payload',{}).get('acceptedObservationIds')!=[] or verdict.get('payload',{}).get('productionAuthority')!='NONE': errors.append('synthetic_gate_invalid')
if probe.get('status')!='UNAVAILABLE_FAIL_CLOSED' or probe.get('liveDatabaseConnectionAttempted') is not False or probe.get('productionAuthority')!='NONE': errors.append('postgres_probe_boundary_invalid')
if kit.get('credentialsEmbedded') is not False or kit.get('livePostgresQualified') is not False or kit.get('productionAuthority')!='NONE' or len(kit.get('files',[]))!=10: errors.append('operator_kit_invalid')
phase('secret-scan')
for item in [x for x in required if x.startswith('external-qualification/v33.21/postgresql/')]:
 text=(ROOT/item).read_text(errors='ignore')
 if re.search(r'-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(?:ql)?://[^\s<]+|PGPASSWORD\s*=\s*[^\s#]+',text,re.I): errors.append('secret_material:'+item)
phase('regression')
ft=full.get('totals',{})
if full.get('version')!='33.21' or full.get('status')!='passed' or (ft.get('testFiles'),ft.get('tests'),ft.get('passed'),ft.get('failed'))!=(206,1539,1539,0) or full.get('runnerExitCode')!=0 or full.get('timedOut') is not False or full.get('retry') is not False or full.get('forceExitDisabled') is not True: errors.append('full_regression_invalid')
if (E/'V33_21_FULL_TEST_EXIT.txt').read_text().strip()!='0': errors.append('full_exit_invalid')
if meta.get('version')!='33.21' or meta.get('testFileCount')!=206 or meta.get('exitCode')!=0 or meta.get('timedOut') is not False or meta.get('retry') is not False: errors.append('full_meta_invalid')
dt=direct.get('totals',{})
if direct.get('version')!='33.21' or direct.get('status')!='passed' or direct.get('independentProcessPerFile') is not True or (dt.get('testFiles'),dt.get('tests'),dt.get('passed'),dt.get('failed'))!=(21,372,372,0): errors.append('direct_v33_invalid')
inv=truth.get('inventory',{});m=arch.get('metrics',{})
if truth.get('status')!='passed' or truth.get('findings') or (inv.get('sourceModules'),inv.get('testFiles'))!=(210,206): errors.append('truth_invalid')
if arch.get('status')!='PASS' or arch.get('findings') or (m.get('sourceCycleCount'),m.get('untestedSourceCount'),m.get('capabilityPathCount'),m.get('closedCapabilityPathCount'))!=(0,0,137,137): errors.append('architecture_invalid')
phase('verify-proof')
r=subprocess.run(['node','scripts/verify-postgres-durable-authority-v33_21.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=90)
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
if manifest.get('version')!='33.21' or manifest.get('externalEffects')!=0 or manifest.get('productionPromotion')!='blocked' or manifest.get('evidenceClass')!='LOCAL_POSTGRESQL_CONTRACT_AND_EXTERNAL_OPERATOR_KIT': errors.append('manifest_boundary_invalid')
result={'version':'33.21','status':'passed' if not errors else 'failed','evidenceClass':p.get('evidenceClass'),'gates':{'G0':'passed','G1':'passed','G2':'in-progress-not-passed','G3':'in-progress-not-passed','G4':'in-progress-not-passed','G5':'in-progress-not-passed','G6':'in-progress-not-passed'},'postgresAuthority':{k:p.get(k) for k in expected},'regression':ft,'directV33':dt,'truthMap':{'sourceModules':inv.get('sourceModules'),'testFiles':inv.get('testFiles'),'findings':len(truth.get('findings',[]))},'architecture':{k:m.get(k) for k in ['sourceCycleCount','untestedSourceCount','capabilityPathCount','closedCapabilityPathCount']},'errors':errors,'productionPromotion':'blocked'}
E.mkdir(parents=True,exist_ok=True);(E/'V33_21_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if not errors else 1)
