from pathlib import Path
import json,re,shutil
R=Path(__file__).resolve().parents[1]
NOW='2026-07-23T16:35:00.000Z'
PHASE='Evidence Intake Operations Persistence, Durable Queues, Worker Fencing, Crash Recovery, Backpressure, and Audit Replay'
STATUS='v33.52-evidence-intake-operations-persistence-local-rehearsal-production-blocked'
CAP='evidence-intake-operations-persistence-durable-queues-worker-fencing-crash-recovery-backpressure-and-audit-replay-v33.52'
# package metadata
p=json.loads((R/'package.json').read_text())
p['version']='0.42.0'
p['description']='Unified Platform Program v33.52 — Durable Evidence Intake Operations Persistence, Worker Fencing, Crash Recovery, Backpressure, and Audit Replay'
p['scripts'].update({
'proof:v33.52':'npm run build && node scripts/evidence-intake-operations-persistence-proof-v33_52.mjs',
'verify:proof:v33.52':'npm run build && node scripts/verify-evidence-intake-operations-persistence-v33_52.mjs',
'test:v33.52':'npm run build && node scripts/run-focused-tests-v33_52.mjs',
'test:full:v33.52':'npm run build && python3 scripts/run-full-regression-v33_52.py',
'test:direct:v33.52':'npm run build && python3 scripts/run-direct-v33-regression-v33_52.py',
'truth:v33.52':'node scripts/repository-truth-map-v33_52.mjs',
'architecture:v33.52':'node scripts/architecture-validation-v33_52.mjs',
'validate:v33.52':'python3 scripts/validate-v33_52.py'})
(R/'package.json').write_text(json.dumps(p,indent=2)+'\n')
l=json.loads((R/'package-lock.json').read_text());l['version']='0.42.0';l['packages']['']['version']='0.42.0';(R/'package-lock.json').write_text(json.dumps(l,indent=2)+'\n')
# clone current runners/maps then repair historical v33.51 references
pairs=[('run-focused-tests-v33_51.mjs','run-focused-tests-v33_52.mjs'),('run-full-regression-v33_51.py','run-full-regression-v33_52.py'),('run-direct-v33-regression-v33_51.py','run-direct-v33-regression-v33_52.py'),('repository-truth-map-v33_51.mjs','repository-truth-map-v33_52.mjs'),('architecture-validation-v33_51.mjs','architecture-validation-v33_52.mjs')]
for src,dst in pairs:
 s=(R/'scripts'/src).read_text().replace('V33_51','V33_52').replace('v33_51','v33_52').replace('v33.51','v33.52').replace("'33.51'","'33.52'").replace('"33.51"','"33.52"')
 (R/'scripts'/dst).write_text(s)
# focused: retain v33.51 and add v33.52
path=R/'scripts/run-focused-tests-v33_52.mjs';s=path.read_text()
s=s.replace("  'evidence-intake-operations-plane-v33_52.test.js',", "  'evidence-intake-operations-plane-v33_51.test.js',\n  'evidence-intake-operations-persistence-v33_52.test.js',")
path.write_text(s)
# full sensitive: retain v33.51 + add v33.52
path=R/'scripts/run-full-regression-v33_52.py';s=path.read_text()
s=s.replace("'evidence-intake-operations-plane-v33_52.test.js'}", "'evidence-intake-operations-plane-v33_51.test.js','evidence-intake-operations-persistence-v33_52.test.js'}")
path.write_text(s)
# truth map: replace incorrectly transformed v33.51 block with historical + new v33.52
path=R/'scripts/repository-truth-map-v33_52.mjs';s=path.read_text()
start=s.find("  'src/supply-chain/evidence-intake-operations-plane-v33_52.ts',")
end=s.find("\n\n];",start)
if start<0 or end<0: raise SystemExit('truth v33.51 transformed block missing')
hist="""  'src/supply-chain/evidence-intake-operations-plane-v33_51.ts',
  'tests/evidence-intake-operations-plane-v33_51.test.ts',
  'scripts/evidence-intake-operations-plane-proof-v33_51.mjs',
  'scripts/verify-evidence-intake-operations-plane-v33_51.mjs',
  'scripts/run-focused-tests-v33_51.mjs',
  'scripts/run-full-regression-v33_51.py',
  'scripts/run-direct-v33-regression-v33_51.py',
  'scripts/repository-truth-map-v33_51.mjs',
  'scripts/architecture-validation-v33_51.mjs',
  'scripts/validate-v33_51.py',
  'docs/V33_51_EVIDENCE_INTAKE_OPERATIONS_PLANE.md',
  'CLAUDE_HANDOFF_v33_51.md',
  'V33_51_עדכון_ביצוע_והוכחות.md',
  'pilot-kits/v33.51/evidence-intake-operations-plane/manifest.json',
  'pilot-kits/v33.51/evidence-intake-operations-plane/RUNBOOK.md',
  'pilot-kits/v33.51/evidence-intake-operations-plane/EXTERNAL_EXECUTION_CHECKLIST.md',
  'release-evidence/v33.51/V33_51_EVIDENCE_INTAKE_OPERATIONS_PLANE_PROOF.json',
  'release-evidence/v33.51/V33_51_INDEPENDENT_VERIFICATION.json',
"""
new="""  'src/supply-chain/evidence-intake-operations-persistence-v33_52.ts',
  'tests/evidence-intake-operations-persistence-v33_52.test.ts',
  'scripts/evidence-intake-operations-persistence-proof-v33_52.mjs',
  'scripts/journal-replica-writer-v33_52.mjs',
  'scripts/verify-evidence-intake-operations-persistence-v33_52.mjs',
  'scripts/run-focused-tests-v33_52.mjs',
  'scripts/run-full-regression-v33_52.py',
  'scripts/run-direct-v33-regression-v33_52.py',
  'scripts/repository-truth-map-v33_52.mjs',
  'scripts/architecture-validation-v33_52.mjs',
  'scripts/validate-v33_52.py',
  'docs/V33_52_EVIDENCE_INTAKE_OPERATIONS_PERSISTENCE.md',
  'CLAUDE_HANDOFF_v33_52.md',
  'V33_52_עדכון_ביצוע_והוכחות.md',
  'pilot-kits/v33.52/evidence-intake-operations-persistence/manifest.json',
  'pilot-kits/v33.52/evidence-intake-operations-persistence/RUNBOOK.md',
  'pilot-kits/v33.52/evidence-intake-operations-persistence/EXTERNAL_EXECUTION_CHECKLIST.md',
  'release-evidence/v33.52/V33_52_EVIDENCE_INTAKE_OPERATIONS_PERSISTENCE_PROOF.json',
  'release-evidence/v33.52/V33_52_INDEPENDENT_VERIFICATION.json',
"""
s=s[:start]+hist+new+s[end:]
s=s.replace("packageJson.version !== '0.41.0'", "packageJson.version !== '0.42.0'").replace(r'/v33\.51/i',r'/v33\.52/i')
path.write_text(s)
# architecture: restore historical v33.51 path and add new v33.52 path
path=R/'scripts/architecture-validation-v33_52.mjs';s=path.read_text()
old="  path('evidence-intake-operations-sla-dual-control-dispute-resubmission-and-readiness-v33.52',['src/supply-chain/evidence-intake-operations-plane-v33_52.ts','src/supply-chain/ceremony-evidence-intake-portal-v33_50.ts','src/contracts/crypto.ts'],['tests/evidence-intake-operations-plane-v33_52.test.ts'],'organization-isolated queues, SLA deadlines, dual-control review, dispute and resubmission, monotonic quorum snapshots and fail-closed readiness certificate with production blocked'),"
rep="  path('evidence-intake-operations-sla-dual-control-dispute-resubmission-and-readiness-v33.51',['src/supply-chain/evidence-intake-operations-plane-v33_51.ts','src/supply-chain/ceremony-evidence-intake-portal-v33_50.ts','src/contracts/crypto.ts'],['tests/evidence-intake-operations-plane-v33_51.test.ts'],'organization-isolated queues, SLA deadlines, dual-control review, dispute and resubmission, monotonic quorum snapshots and fail-closed readiness certificate with production blocked'),\n  path('evidence-intake-operations-persistence-durable-queues-worker-fencing-crash-recovery-backpressure-and-audit-replay-v33.52',['src/supply-chain/evidence-intake-operations-persistence-v33_52.ts','src/supply-chain/evidence-intake-operations-plane-v33_51.ts','src/contracts/crypto.ts'],['tests/evidence-intake-operations-persistence-v33_52.test.ts'],'signed monotonic queue journal, worker lease fencing, expiry-witness takeover, idempotent replay, hysteretic backlog pressure, three durable replicas, crash recovery and full audit replay with production blocked'),"
if old not in s: raise SystemExit('architecture transformed v33.51 path missing')
s=s.replace(old,rep);path.write_text(s)
# governance exact version mirrors
for base in [R/'governance-state',R/'v33/governance-state']:
 for path in base.glob('*.json'):
  d=json.loads(path.read_text());d['version']='33.52';d['updatedAt']=NOW
  if 'generatedAt' in d:d['generatedAt']=NOW
  path.write_text(json.dumps(d,indent=2)+'\n')
def load(n):return json.loads((R/'governance-state'/n).read_text())
def save(n,d):
 for base in [R/'governance-state',R/'v33/governance-state']:(base/n).write_text(json.dumps(d,indent=2)+'\n')
ps=load('PROGRAM_STATE.json');ps.update({'phase':PHASE,'status':STATUS,'nextAllowedAction':'Run independently administered durable evidence-intake operations with replicated journals, worker fencing, crash recovery, pressure controls and audit replay.'});ps['completed'] += ['V33.52 durable evidence intake operations persistence implemented','Worker lease fencing, expiry-witness takeover and idempotent replay exercised locally','Three-replica journal durability, crash recovery, backlog hysteresis and full audit replay verified'];ps['evidencePaths'] += ['release-evidence/v33.52/V33_52_EVIDENCE_INTAKE_OPERATIONS_PERSISTENCE_PROOF.json','release-evidence/v33.52/V33_52_INDEPENDENT_VERIFICATION.json'];save('PROGRAM_STATE.json',ps)
na=load('NEXT_ACTION.json');na.update({'actionId':'NA33.52-EXECUTE-EXTERNAL-DURABLE-OPERATIONS','title':'Execute External Durable Intake Operations','qualificationTargetVersion':'33.52','allowedActions':['Deploy three independently administered append-only queue replicas','Assign fenced workers and three lease-expiry witnesses','Exercise crash recovery during review, dispute and resubmission','Apply backlog pressure and hysteresis thresholds','Replay the complete signed journal into an independent audit verdict'],'forbiddenActions':['external mutation','production promotion','accepting an expired worker lease','reusing a fenced lease term','committing a duplicate operation outside idempotent replay','dropping or forking the queue journal','bypassing backlog pressure','claiming external readiness without twenty-two trusted attestations','untrusted host execution','claiming external human participation while external human participant count is zero'],'exitCriteria':['Three independent replicas confirm identical journal bytes','Worker takeover is witnessed by three independent expiry witnesses','Crash recovery preserves the signed journal prefix','Idempotent resubmission produces no duplicate state transition','Independent audit replay recomputes the final local verdict','Twenty-two trusted external attestations remain required for external readiness']});save('NEXT_ACTION.json',na)
od=load('OPEN_DECISIONS.json');od['decisions'] += [
{'id':'OD33.52-REPLICA-OPERATORS','status':'open-external','recommendation':'Assign three independently administered append-only journal replica operators.'},
{'id':'OD33.52-WORKER-LEASE-AUTHORITY','status':'open-external','recommendation':'Assign worker lease authority and three independent expiry witnesses.'},
{'id':'OD33.52-PRESSURE-POLICY','status':'open-external','recommendation':'Approve queue high/low watermarks, oldest-item age and SLA escalation thresholds.'},
{'id':'OD33.52-AUDIT-REPLAYER','status':'open-external','recommendation':'Assign an independent audit replay operator and recovery authority.'}];save('OPEN_DECISIONS.json',od)
for name,key,items in [
('REQUIREMENT_REGISTRY.json','requirements',[{'id':'V33.52-REQ-01','status':'implemented-local','requirement':'Every queue mutation must be signed, sequence-linked, fenced by a valid worker lease, idempotent and replicated as exact bytes to three separated durable stores.'},{'id':'V33.52-REQ-02','status':'implemented-local','requirement':'Crash recovery and audit replay must preserve the journal prefix, enforce pressure hysteresis and keep external readiness and production authority blocked.'}]),
('EVIDENCE_REGISTRY.json','records',[{'id':'V33.52-E1','path':'release-evidence/v33.52/V33_52_EVIDENCE_INTAKE_OPERATIONS_PERSISTENCE_PROOF.json','status':'local-rehearsal','claim':'Signed durable queue journal, fenced worker takeover, idempotent replay, backlog hysteresis, three replicas and crash recovery were exercised locally.'}]),
('CAPABILITY_REGISTRY.json','capabilities',[{'id':CAP,'status':'implemented-and-exercised-local-rehearsal','description':'Durable evidence-intake operations with signed journal, worker fencing, idempotent replay, pressure controls, three replicas, crash recovery and audit replay.','authority':'local-operations-persistence-rehearsal-only-production-blocked'}]),
('ASSUMPTION_REGISTRY.json','assumptions',[{'id':'V33.52-A1','status':'open-external','assumption':'Independent operators can provide three durable replicas, lease-expiry witnesses and an audit replay authority.'}]),
('CONTRADICTION_REGISTRY.json','contradictions',[{'id':'V33.52-C1','status':'resolved-local','claim':'A locally replicated journal proves external operations persistence.','resolution':'False. All replicas and workers are local rehearsal identities; external topology, humans and attestations remain zero.'}]),
('RISK_REGISTRY.json','risks',[{'id':'V33.52-R1','status':'open-external','risk':'Stale workers, split journal replicas or overloaded queues could create duplicate or divergent operations.','mitigation':'Use lease fencing, witness-qualified takeover, exact-byte replica receipts, idempotency keys, pressure hysteresis and full audit replay.'}]),
('SKILL_REGISTRY.json','skills',[{'id':'SK33.52-01','name':'evidence-intake-operations-persistence','source':'v33.52 canonical','status':'implemented-local'}])]:
 d=load(name);d[key]+=items;save(name,d)
tr=load('TRACEABILITY_GRAPH.json');tr['links'] += [{'id':'TRACE-V33.52-REQ-01','requirement':'V33.52-REQ-01','capability':CAP,'test':'tests/evidence-intake-operations-persistence-v33_52.test.ts','evidence':'V33.52-E1'},{'id':'TRACE-V33.52-REQ-02','requirement':'V33.52-REQ-02','capability':CAP,'test':'tests/evidence-intake-operations-persistence-v33_52.test.ts','evidence':'V33.52-E1'}];save('TRACEABILITY_GRAPH.json',tr)
# governance contracts/tests
path=R/'src/governance/contracts.ts';s=path.read_text();s=re.sub(r"export const V33_PHASE = '.*?' as const;",f"export const V33_PHASE = '{PHASE}' as const;",s);path.write_text(s)
path=R/'src/governance/consistency.ts';s=path.read_text().replace("version === '33.51' ? V33_PHASE", "version === '33.52' ? V33_PHASE");path.write_text(s)
for rel in ['tests/governance-consistency.test.ts','tests/workspace-continuity-v32_1.test.ts','tests/release-metadata-v32_11.test.ts']:
 path=R/rel;s=path.read_text().replace('33.51','33.52').replace('v33.51','v33.52').replace('0.41.0','0.42.0').replace('validate-v33_51.py','validate-v33_52.py');path.write_text(s)
# docs and kit
(R/'docs/V33_52_EVIDENCE_INTAKE_OPERATIONS_PERSISTENCE.md').write_text('# V33.52 Evidence Intake Operations Persistence\n\nV33.52 adds a signed monotonic operations journal, worker leases and fencing, three-witness takeover, idempotent replay, backlog pressure hysteresis, three exact-byte durable replicas, crash recovery and full audit replay.\n\nNo external operator, topology, attestation or production authority was observed.\n')
(R/'CLAUDE_HANDOFF_v33_52.md').write_text(f'# Claude Handoff v33.52\n\nCanonical phase: {PHASE}.\n\nContinue only from the v33.52 package. Preserve v33.51 receipt bindings, monotonic journal sequences, worker fencing, idempotency, exact-byte replication, crash recovery and all production/G3 blocks.\n')
(R/'V33_52_עדכון_ביצוע_והוכחות.md').write_text('# v33.52 — עדכון ביצוע והוכחות\n\nנוספה שכבת persistence מלאה לתפעול קליטת הראיות: journal חתום ומונוטוני, worker leases ו-fencing, takeover בעדות שלושה גורמים, replay idempotent, בקרת עומס היסטרטית, שלושה replicas, crash recovery ו-audit replay מלא. לא נצפתה תשתית חיצונית אמיתית.\n')
kit=R/'pilot-kits/v33.52/evidence-intake-operations-persistence';kit.mkdir(parents=True,exist_ok=True)
(kit/'manifest.json').write_text(json.dumps({'version':'33.52','kitId':'evidence-intake-operations-persistence','status':'LOCAL_REHEARSAL_ONLY','replicaQuorum':3,'leaseExpiryWitnessQuorum':3,'pressureSnapshotMinimum':3,'productionAuthority':'NONE'},indent=2)+'\n')
(kit/'RUNBOOK.md').write_text('# V33.52 Persistence Runbook\n\n1. Verify the v33.51 readiness certificate and operations policy signatures.\n2. Create a fenced worker lease for allowed queue operations.\n3. Commit every operation to the signed sequence-linked journal using an idempotency key.\n4. Require three expiry witnesses before worker takeover.\n5. Apply high/low watermark hysteresis and oldest-item pressure thresholds.\n6. Replicate exact journal bytes to three separated stores and verify readback.\n7. Recover from the signed journal prefix and recompute the audit verdict.\n8. Keep external readiness, G3 and production authority blocked.\n')
(kit/'EXTERNAL_EXECUTION_CHECKLIST.md').write_text('# External execution checklist\n\n- [ ] three independently administered append-only replicas\n- [ ] fenced worker lease authority\n- [ ] three independent expiry witnesses\n- [ ] approved high/low pressure thresholds\n- [ ] crash drills during review, dispute and resubmission\n- [ ] idempotent replay verification\n- [ ] independent audit replay\n- [ ] 22 trusted attestations remain required for external readiness\n- [ ] production authority remains NONE\n')
# root current marker only
for rel in ['CLAUDE.md','MASTER_DIRECTIVE.md','PROGRAM_CHARTER.md','README.md']:
 path=R/rel;s=path.read_text();s=re.sub(r'v33\.51','v33.52',s,count=1,flags=re.I);path.write_text(s)
print('canonicalized v33.52')
