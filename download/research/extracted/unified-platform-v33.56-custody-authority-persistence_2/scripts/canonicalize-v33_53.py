from pathlib import Path
import json,re,shutil
R=Path(__file__).resolve().parents[1]
NOW='2026-07-23T20:30:00.000Z'
PHASE='Evidence Intake Operations Persistence Infrastructure Qualification, Independent Stores, Worker Hosts, Lease Clocks, Partition Failover, Overload, and Site-Loss Audit Replay'
STATUS='v33.53-persistence-infrastructure-qualification-local-rehearsal-production-blocked'
CAP='evidence-intake-operations-persistence-infrastructure-qualification-v33.53'
# package
p=json.loads((R/'package.json').read_text())
p['version']='0.43.0'
p['description']='Unified Platform Program v33.53 — Persistence Infrastructure Qualification with Independent Stores, Workers, Lease Clocks, Partition Failover, Overload, and Site-Loss Replay'
p['scripts'].update({
'proof:v33.53':'npm run build && node scripts/evidence-intake-operations-persistence-qualification-proof-v33_53.mjs',
'verify:proof:v33.53':'npm run build && node scripts/verify-evidence-intake-operations-persistence-qualification-v33_53.mjs',
'test:v33.53':'npm run build && node scripts/run-focused-tests-v33_53.mjs',
'test:full:v33.53':'npm run build && python3 scripts/run-full-regression-v33_53.py',
'test:direct:v33.53':'npm run build && python3 scripts/run-direct-v33-regression-v33_53.py',
'truth:v33.53':'node scripts/repository-truth-map-v33_53.mjs',
'architecture:v33.53':'node scripts/architecture-validation-v33_53.mjs',
'validate:v33.53':'python3 scripts/validate-v33_53.py'})
(R/'package.json').write_text(json.dumps(p,indent=2)+'\n')
l=json.loads((R/'package-lock.json').read_text());l['version']='0.43.0';l['packages']['']['version']='0.43.0';(R/'package-lock.json').write_text(json.dumps(l,indent=2)+'\n')
# focused
s=(R/'scripts/run-focused-tests-v33_52.mjs').read_text()
s=s.replace("  'evidence-intake-operations-persistence-v33_52.test.js',\n];","  'evidence-intake-operations-persistence-v33_52.test.js',\n  'evidence-intake-operations-persistence-qualification-v33_53.test.js',\n];")
s=s.replace('release-evidence/v33.52','release-evidence/v33.53').replace('V33_52','V33_53').replace("version: '33.52'","version: '33.53'")
(R/'scripts/run-focused-tests-v33_53.mjs').write_text(s)
# full
s=(R/'scripts/run-full-regression-v33_52.py').read_text()
s=s.replace("'evidence-intake-operations-persistence-v33_52.test.js'}","'evidence-intake-operations-persistence-v33_52.test.js','evidence-intake-operations-persistence-qualification-v33_53.test.js'}")
s=s.replace('v33.52','v33.53').replace('V33_52','V33_53').replace("'33.52'","'33.53'").replace('forty-two-sensitive','forty-three-sensitive')
(R/'scripts/run-full-regression-v33_53.py').write_text(s)
# direct
s=(R/'scripts/run-direct-v33-regression-v33_52.py').read_text().replace('v33.52','v33.53').replace('V33_52','V33_53').replace("'33.52'","'33.53'")
(R/'scripts/run-direct-v33-regression-v33_53.py').write_text(s)
# truth map
s=(R/'scripts/repository-truth-map-v33_52.mjs').read_text()
insert="""  'src/supply-chain/evidence-intake-operations-persistence-qualification-v33_53.ts',
  'tests/evidence-intake-operations-persistence-qualification-v33_53.test.ts',
  'scripts/evidence-intake-operations-persistence-qualification-proof-v33_53.mjs',
  'scripts/queue-store-writer-v33_53.mjs',
  'scripts/overload-worker-v33_53.mjs',
  'scripts/site-recovery-replayer-v33_53.mjs',
  'scripts/verify-evidence-intake-operations-persistence-qualification-v33_53.mjs',
  'scripts/run-focused-tests-v33_53.mjs',
  'scripts/run-full-regression-v33_53.py',
  'scripts/run-direct-v33-regression-v33_53.py',
  'scripts/repository-truth-map-v33_53.mjs',
  'scripts/architecture-validation-v33_53.mjs',
  'scripts/validate-v33_53.py',
  'docs/V33_53_PERSISTENCE_INFRASTRUCTURE_QUALIFICATION.md',
  'CLAUDE_HANDOFF_v33_53.md',
  'V33_53_עדכון_ביצוע_והוכחות.md',
  'pilot-kits/v33.53/persistence-infrastructure-qualification/manifest.json',
  'pilot-kits/v33.53/persistence-infrastructure-qualification/RUNBOOK.md',
  'pilot-kits/v33.53/persistence-infrastructure-qualification/EXTERNAL_EXECUTION_CHECKLIST.md',
  'release-evidence/v33.53/V33_53_EVIDENCE_INTAKE_OPERATIONS_PERSISTENCE_QUALIFICATION_PROOF.json',
  'release-evidence/v33.53/V33_53_INDEPENDENT_VERIFICATION.json',
"""
pos=s.find('\n\n];')
if pos<0: raise SystemExit('truth required terminator missing')
s=s[:pos]+"\n"+insert+s[pos:]
s=s.replace("const out = resolve(process.env.V33_52_RUN_DIR || 'release-evidence/v33.52');","const out = resolve(process.env.V33_53_RUN_DIR || 'release-evidence/v33.53');")
s=s.replace("packageJson.version !== '0.42.0'","packageJson.version !== '0.43.0'")
s=s.replace(r'/v33\.52/i',r'/v33\.53/i')
s=s.replace("version !== '33.52'","version !== '33.53'")
s=s.replace("version: '33.52'","version: '33.53'")
s=s.replace('V33_52_REPOSITORY_TRUTH_MAP.json','V33_53_REPOSITORY_TRUTH_MAP.json')
s=s.replace('REQUIRED_V33_52_COMPONENT_MISSING','REQUIRED_V33_53_COMPONENT_MISSING')
(R/'scripts/repository-truth-map-v33_53.mjs').write_text(s)
# architecture
s=(R/'scripts/architecture-validation-v33_52.mjs').read_text()
needle="  path('evidence-intake-operations-persistence-durable-queues-worker-fencing-crash-recovery-backpressure-and-audit-replay-v33.52',['src/supply-chain/evidence-intake-operations-persistence-v33_52.ts','src/supply-chain/evidence-intake-operations-plane-v33_51.ts','src/contracts/crypto.ts'],['tests/evidence-intake-operations-persistence-v33_52.test.ts'],'signed monotonic queue journal, worker lease fencing, expiry-witness takeover, idempotent replay, hysteretic backlog pressure, three durable replicas, crash recovery and full audit replay with production blocked'),"
add=needle+"\n  path('evidence-intake-operations-persistence-infrastructure-qualification-v33.53',['src/supply-chain/evidence-intake-operations-persistence-qualification-v33_53.ts','src/supply-chain/evidence-intake-operations-persistence-v33_52.ts','src/contracts/crypto.ts'],['tests/evidence-intake-operations-persistence-qualification-v33_53.test.ts'],'three separated queue stores, two worker hosts, independent lease clocks, partition failover, overload backpressure and site-loss audit replay with external and production claims blocked'),"
if needle not in s: raise SystemExit('architecture anchor missing')
s=s.replace(needle,add)
s=s.replace('V33_52_RUN_DIR','V33_53_RUN_DIR').replace("'release-evidence/v33.52'","'release-evidence/v33.53'").replace("version:'33.52'","version:'33.53'").replace('V33_52_ARCHITECTURE_INTEGRITY.json','V33_53_ARCHITECTURE_INTEGRITY.json').replace('release-evidence/v33.52/V33_52_ARCHITECTURE_INTEGRITY.json','release-evidence/v33.53/V33_53_ARCHITECTURE_INTEGRITY.json')
(R/'scripts/architecture-validation-v33_53.mjs').write_text(s)
# governance mirrors version
for base in [R/'governance-state',R/'v33/governance-state']:
 for path in base.glob('*.json'):
  d=json.loads(path.read_text());d['version']='33.53';d['updatedAt']=NOW
  if 'generatedAt' in d:d['generatedAt']=NOW
  path.write_text(json.dumps(d,indent=2)+'\n')
def load(n):return json.loads((R/'governance-state'/n).read_text())
def save(n,d):
 for base in [R/'governance-state',R/'v33/governance-state']:(base/n).write_text(json.dumps(d,indent=2)+'\n')
ps=load('PROGRAM_STATE.json');ps.update({'phase':PHASE,'status':STATUS,'nextAllowedAction':'Run independently administered persistence infrastructure qualification on real queue stores, workers, clocks, partitions, overload and site-loss recovery.'});ps['completed'] += ['V33.53 persistence infrastructure qualification implemented','Three store processes, two overload worker processes and one recovery process exercised locally','Portable evidence paths and fail-closed external qualification verified'];ps['evidencePaths'] += ['release-evidence/v33.53/V33_53_EVIDENCE_INTAKE_OPERATIONS_PERSISTENCE_QUALIFICATION_PROOF.json','release-evidence/v33.53/V33_53_INDEPENDENT_VERIFICATION.json'];save('PROGRAM_STATE.json',ps)
na=load('NEXT_ACTION.json');na.update({'actionId':'NA33.53-EXECUTE-EXTERNAL-PERSISTENCE-QUALIFICATION','title':'Execute External Persistence Infrastructure Qualification','qualificationTargetVersion':'33.53','allowedActions':['Deploy three independently administered append-only queue stores','Deploy two separated worker hosts','Bind two independent lease clock roots','Exercise partition failover and fencing','Generate real overload and hysteresis evidence','Perform site-loss audit replay from surviving stores'],'forbiddenActions':['external mutation','production promotion','using collocated store or worker identities','accepting untrusted clock evidence','premature failover','bypassing overload rejection','accepting split-view store bytes','claiming external qualification from local process evidence','untrusted host execution','claiming external human participation while external human participant count is zero'],'exitCriteria':['Three external stores attest identical bytes','Two external worker hosts remain separated','Two clock roots satisfy skew policy','Partition failover is observed by two independent observers','Overload rejection and hysteresis clear are externally evidenced','Site-loss audit replay completes from two surviving stores']});save('NEXT_ACTION.json',na)
od=load('OPEN_DECISIONS.json');od['decisions'] += [{'id':'OD33.53-QUEUE-STORES','status':'open-external','recommendation':'Assign three independently administered append-only queue stores across separate sites and providers.'},{'id':'OD33.53-WORKER-HOSTS','status':'open-external','recommendation':'Assign two separated worker hosts and administrators.'},{'id':'OD33.53-LEASE-CLOCKS','status':'open-external','recommendation':'Select two independent clock roots and skew policy.'},{'id':'OD33.53-SITE-LOSS-DRILL','status':'open-external','recommendation':'Schedule a real partition, overload and site-loss recovery drill.'}];save('OPEN_DECISIONS.json',od)
for name,key,items in [('REQUIREMENT_REGISTRY.json','requirements',[{'id':'V33.53-REQ-01','status':'implemented-local','requirement':'Persistence qualification must require three separated exact-byte queue stores, two separated workers, two clocks and witnessed partition failover.'},{'id':'V33.53-REQ-02','status':'implemented-local','requirement':'Overload rejection, hysteresis clear and site-loss audit replay must be verified while production and external claims remain fail closed.'}]),('EVIDENCE_REGISTRY.json','records',[{'id':'V33.53-E1','path':'release-evidence/v33.53/V33_53_EVIDENCE_INTAKE_OPERATIONS_PERSISTENCE_QUALIFICATION_PROOF.json','status':'local-rehearsal','claim':'Three store processes, two overload worker processes and one site-recovery process exercised persistence qualification locally.'}]),('CAPABILITY_REGISTRY.json','capabilities',[{'id':CAP,'status':'implemented-and-exercised-local-rehearsal','description':'Persistence infrastructure qualification with separated stores, workers, clocks, partition failover, overload controls and site-loss audit replay.','authority':'local-persistence-infrastructure-qualification-rehearsal-only-production-blocked'}]),('ASSUMPTION_REGISTRY.json','assumptions',[{'id':'V33.53-A1','status':'open-external','assumption':'Independent operators can provide real separated stores, worker hosts, lease clocks and site-loss recovery evidence.'}]),('CONTRADICTION_REGISTRY.json','contradictions',[{'id':'V33.53-C1','status':'resolved-local','claim':'Multiple local processes prove independent external infrastructure.','resolution':'False. Process separation is local rehearsal evidence only; external qualification requires trusted external evidence digests and public endpoints.'}]),('RISK_REGISTRY.json','risks',[{'id':'V33.53-R1','status':'open-external','risk':'Collocated stores, clock skew, split view, premature failover or overload bypass could invalidate persistence qualification.','mitigation':'Require identity separation, exact-byte receipts, two-clock quorum, two partition observers, rejection thresholds, hysteresis and site-loss replay.'}]),('SKILL_REGISTRY.json','skills',[{'id':'SK33.53-01','name':'persistence-infrastructure-qualification','source':'v33.53 canonical','status':'implemented-local'}])]:
 d=load(name);d[key]+=items;save(name,d)
tr=load('TRACEABILITY_GRAPH.json');tr['links'] += [{'id':'TRACE-V33.53-REQ-01','requirement':'V33.53-REQ-01','capability':CAP,'test':'tests/evidence-intake-operations-persistence-qualification-v33_53.test.ts','evidence':'V33.53-E1'},{'id':'TRACE-V33.53-REQ-02','requirement':'V33.53-REQ-02','capability':CAP,'test':'tests/evidence-intake-operations-persistence-qualification-v33_53.test.ts','evidence':'V33.53-E1'}];save('TRACEABILITY_GRAPH.json',tr)
# governance code/tests
path=R/'src/governance/contracts.ts';s=path.read_text();s=re.sub(r"export const V33_PHASE = '.*?' as const;",f"export const V33_PHASE = '{PHASE}' as const;",s);path.write_text(s)
path=R/'src/governance/consistency.ts';s=path.read_text().replace("version === '33.52' ? V33_PHASE","version === '33.53' ? V33_PHASE");path.write_text(s)
for rel in ['tests/governance-consistency.test.ts','tests/workspace-continuity-v32_1.test.ts','tests/release-metadata-v32_11.test.ts']:
 path=R/rel;s=path.read_text().replace('33.52','33.53').replace('v33.52','v33.53').replace('0.42.0','0.43.0').replace('validate-v33_52.py','validate-v33_53.py');path.write_text(s)
# docs/kit
(R/'docs/V33_53_PERSISTENCE_INFRASTRUCTURE_QUALIFICATION.md').write_text('# V33.53 Persistence Infrastructure Qualification\n\nV33.53 qualifies three queue stores, two worker hosts, two lease clocks, partition failover, overload backpressure and site-loss audit replay. Local multiprocess evidence does not qualify external infrastructure.\n')
(R/'CLAUDE_HANDOFF_v33_53.md').write_text(f'# Claude Handoff v33.53\n\nCanonical phase: {PHASE}.\n\nContinue only from the v33.53 package. Preserve v33.52 audit verdict bindings, exact-byte store receipts, worker and clock separation, partition fencing, overload rejection, site-loss replay and all production/G3 blocks.\n')
(R/'V33_53_עדכון_ביצוע_והוכחות.md').write_text('# v33.53 — עדכון ביצוע והוכחות\n\nנוספה שכבת qualification לתשתית persistence: שלושה queue stores, שני worker hosts, שני lease clocks, failover בזמן partition, overload והיסטרזיס, ושחזור site-loss עם audit replay. כל הראיות המקומיות מסומנות rehearsal בלבד.\n')
kit=R/'pilot-kits/v33.53/persistence-infrastructure-qualification';kit.mkdir(parents=True,exist_ok=True)
(kit/'manifest.json').write_text(json.dumps({'version':'33.53','kitId':'persistence-infrastructure-qualification','status':'LOCAL_REHEARSAL_ONLY','storeCount':3,'workerCount':2,'clockCount':2,'partitionObserverQuorum':2,'productionAuthority':'NONE'},indent=2)+'\n')
(kit/'RUNBOOK.md').write_text('# V33.53 Qualification Runbook\n\n1. Verify v33.52 audit proof and verdict.\n2. Enroll three separated append-only queue stores.\n3. Enroll two separated worker hosts and two independent clocks.\n4. Replicate exact journal bytes to all stores.\n5. Exercise partition failover with two observers.\n6. Run overload rejection and hysteresis clear.\n7. Lose one site and replay the audit from two surviving stores.\n8. Keep external qualification, G3 and production blocked unless trusted external evidence is imported.\n')
(kit/'EXTERNAL_EXECUTION_CHECKLIST.md').write_text('# External execution checklist\n\n- [ ] three stores across distinct organizations, administrators, hosts, sites and providers\n- [ ] two separated worker hosts\n- [ ] two independent clock roots\n- [ ] two independent partition observers\n- [ ] exact-byte replication before and after failover\n- [ ] measured overload rejection and hysteresis clear\n- [ ] site-loss replay from two surviving stores\n- [ ] trusted external evidence digests and public endpoints\n- [ ] production authority remains NONE\n')
# root markers
for rel in ['CLAUDE.md','MASTER_DIRECTIVE.md','PROGRAM_CHARTER.md','README.md']:
 path=R/rel;s=path.read_text();s=re.sub(r'v33\.52','v33.53',s,count=1,flags=re.I);path.write_text(s)
# artifact manifest version
am=R/'evidence/generated/artifact-manifest.json'
if am.exists():
 d=json.loads(am.read_text());d['version']='33.53';am.write_text(json.dumps(d,indent=2)+'\n')
print('canonicalized v33.53')
