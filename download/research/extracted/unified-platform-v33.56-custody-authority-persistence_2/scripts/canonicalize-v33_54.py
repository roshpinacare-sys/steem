from pathlib import Path
import json,re
R=Path(__file__).resolve().parents[1]
NOW='2026-07-24T01:30:00.000Z'
PHASE='Persistence Qualification Execution Bundle, Role Enrollment, Dual Audit, External Drill Evidence, and Portable Readiness Import'
STATUS='v33.54-qualification-execution-bundle-local-rehearsal-production-blocked'
CAP='persistence-qualification-execution-bundle-v33.54'
# package
p=json.loads((R/'package.json').read_text());p['version']='0.44.0';p['description']='Unified Platform Program v33.54 — Qualification Execution Bundle with Role Enrollment, Dual Audit, Portable Drill Evidence, and External Readiness Gate';p['scripts'].update({
'proof:v33.54':'npm run build && node scripts/persistence-qualification-execution-bundle-proof-v33_54.mjs',
'verify:proof:v33.54':'npm run build && node scripts/verify-persistence-qualification-execution-bundle-v33_54.mjs',
'test:v33.54':'npm run build && node scripts/run-focused-tests-v33_54.mjs',
'test:full:v33.54':'npm run build && python3 scripts/run-full-regression-v33_54.py',
'test:direct:v33.54':'npm run build && python3 scripts/run-direct-v33-regression-v33_54.py',
'truth:v33.54':'node scripts/repository-truth-map-v33_54.mjs',
'architecture:v33.54':'node scripts/architecture-validation-v33_54.mjs',
'validate:v33.54':'python3 scripts/validate-v33_54.py'})
(R/'package.json').write_text(json.dumps(p,indent=2)+'\n')
l=json.loads((R/'package-lock.json').read_text());l['version']='0.44.0';l['packages']['']['version']='0.44.0';(R/'package-lock.json').write_text(json.dumps(l,indent=2)+'\n')
# focused
s=(R/'scripts/run-focused-tests-v33_53.mjs').read_text();s=s.replace("  'evidence-intake-operations-persistence-qualification-v33_53.test.js',\n];","  'evidence-intake-operations-persistence-qualification-v33_53.test.js',\n  'persistence-qualification-execution-bundle-v33_54.test.js',\n];");s=s.replace('release-evidence/v33.53','release-evidence/v33.54').replace('V33_53','V33_54').replace("version: '33.53'","version: '33.54'");(R/'scripts/run-focused-tests-v33_54.mjs').write_text(s)
# full
s=(R/'scripts/run-full-regression-v33_53.py').read_text();s=s.replace("'evidence-intake-operations-persistence-qualification-v33_53.test.js'}","'evidence-intake-operations-persistence-qualification-v33_53.test.js','persistence-qualification-execution-bundle-v33_54.test.js'}");s=s.replace('v33.53','v33.54').replace('V33_53','V33_54').replace("'33.53'","'33.54'").replace('forty-three-sensitive','forty-four-sensitive');(R/'scripts/run-full-regression-v33_54.py').write_text(s)
# direct
s=(R/'scripts/run-direct-v33-regression-v33_53.py').read_text().replace('v33.53','v33.54').replace('V33_53','V33_54').replace("'33.53'","'33.54'");(R/'scripts/run-direct-v33-regression-v33_54.py').write_text(s)
# truth
s=(R/'scripts/repository-truth-map-v33_53.mjs').read_text();insert="""  'src/supply-chain/persistence-qualification-execution-bundle-v33_54.ts',
  'tests/persistence-qualification-execution-bundle-v33_54.test.ts',
  'scripts/execution-evidence-writer-v33_54.mjs',
  'scripts/persistence-qualification-execution-bundle-proof-v33_54.mjs',
  'scripts/verify-persistence-qualification-execution-bundle-v33_54.mjs',
  'scripts/run-focused-tests-v33_54.mjs',
  'scripts/run-full-regression-v33_54.py',
  'scripts/run-direct-v33-regression-v33_54.py',
  'scripts/repository-truth-map-v33_54.mjs',
  'scripts/architecture-validation-v33_54.mjs',
  'scripts/validate-v33_54.py',
  'docs/V33_54_QUALIFICATION_EXECUTION_BUNDLE.md',
  'CLAUDE_HANDOFF_v33_54.md',
  'V33_54_עדכון_ביצוע_והוכחות.md',
  'pilot-kits/v33.54/qualification-execution-bundle/manifest.json',
  'pilot-kits/v33.54/qualification-execution-bundle/RUNBOOK.md',
  'pilot-kits/v33.54/qualification-execution-bundle/EXTERNAL_EVIDENCE_CHECKLIST.md',
  'release-evidence/v33.54/V33_54_PERSISTENCE_QUALIFICATION_EXECUTION_BUNDLE_PROOF.json',
  'release-evidence/v33.54/V33_54_INDEPENDENT_VERIFICATION.json',
"""
pos=s.find('\n\n];')
if pos<0: raise SystemExit('truth terminator missing')
s=s[:pos]+'\n'+insert+s[pos:]
s=s.replace('V33_53_RUN_DIR','V33_54_RUN_DIR').replace("'release-evidence/v33.53'","'release-evidence/v33.54'").replace("packageJson.version !== '0.43.0'","packageJson.version !== '0.44.0'").replace(r'/v33\.53/i',r'/v33\.54/i').replace("version !== '33.53'","version !== '33.54'").replace("version: '33.53'","version: '33.54'").replace('V33_53_REPOSITORY_TRUTH_MAP.json','V33_54_REPOSITORY_TRUTH_MAP.json').replace('REQUIRED_V33_53_COMPONENT_MISSING','REQUIRED_V33_54_COMPONENT_MISSING');(R/'scripts/repository-truth-map-v33_54.mjs').write_text(s)
# architecture
s=(R/'scripts/architecture-validation-v33_53.mjs').read_text();needle="  path('evidence-intake-operations-persistence-infrastructure-qualification-v33.53',['src/supply-chain/evidence-intake-operations-persistence-qualification-v33_53.ts','src/supply-chain/evidence-intake-operations-persistence-v33_52.ts','src/contracts/crypto.ts'],['tests/evidence-intake-operations-persistence-qualification-v33_53.test.ts'],'three separated queue stores, two worker hosts, independent lease clocks, partition failover, overload backpressure and site-loss audit replay with external and production claims blocked'),";add=needle+"\n  path('persistence-qualification-execution-bundle-v33.54',['src/supply-chain/persistence-qualification-execution-bundle-v33_54.ts','src/supply-chain/evidence-intake-operations-persistence-qualification-v33_53.ts','src/contracts/crypto.ts'],['tests/persistence-qualification-execution-bundle-v33_54.test.ts'],'ten role-bound enrollments and process attestations, dual independent audit per role, three portable drill receipts, exact evidence bundle inventory and fail-closed external readiness'),"
if needle not in s: raise SystemExit('architecture anchor missing')
s=s.replace(needle,add).replace('V33_53_RUN_DIR','V33_54_RUN_DIR').replace("'release-evidence/v33.53'","'release-evidence/v33.54'").replace("version:'33.53'","version:'33.54'").replace('V33_53_ARCHITECTURE_INTEGRITY.json','V33_54_ARCHITECTURE_INTEGRITY.json').replace('release-evidence/v33.53/V33_53_ARCHITECTURE_INTEGRITY.json','release-evidence/v33.54/V33_54_ARCHITECTURE_INTEGRITY.json');(R/'scripts/architecture-validation-v33_54.mjs').write_text(s)
# governance versions
for base in [R/'governance-state',R/'v33/governance-state']:
 for path in base.glob('*.json'):
  d=json.loads(path.read_text());d['version']='33.54';d['updatedAt']=NOW
  if 'generatedAt' in d:d['generatedAt']=NOW
  path.write_text(json.dumps(d,indent=2)+'\n')
def load(n):return json.loads((R/'governance-state'/n).read_text())
def save(n,d):
 for base in [R/'governance-state',R/'v33/governance-state']:(base/n).write_text(json.dumps(d,indent=2)+'\n')
ps=load('PROGRAM_STATE.json');ps.update({'phase':PHASE,'status':STATUS,'nextAllowedAction':'Run independently administered qualification execution using real role holders, auditors, public endpoints, external drill evidence and trusted evidence digests.'});ps['completed'] += ['V33.54 qualification execution bundle implemented','Ten role processes and three drill processes exercised locally','Dual audit and portable evidence inventory verified with external readiness blocked'];ps['evidencePaths'] += ['release-evidence/v33.54/V33_54_PERSISTENCE_QUALIFICATION_EXECUTION_BUNDLE_PROOF.json','release-evidence/v33.54/V33_54_INDEPENDENT_VERIFICATION.json'];save('PROGRAM_STATE.json',ps)
na=load('NEXT_ACTION.json');na.update({'actionId':'NA33.54-EXECUTE-EXTERNAL-QUALIFICATION-BUNDLE','title':'Execute External Qualification Bundle','qualificationTargetVersion':'33.54','allowedActions':['Assign ten independently administered execution roles','Issue role-bound enrollment packages and one-time challenges','Collect process attestations over public authenticated endpoints','Obtain two independent auditor approvals per role','Execute real partition, overload and site-loss drills','Seal and import a portable evidence bundle with trusted external digests'],'forbiddenActions':['external mutation','production promotion','reusing enrollment nonce or process identity','accepting fewer than two auditors per role','accepting collocated auditor and role organizations','accepting absolute or traversal evidence paths','claiming external execution from a local v33.53 base verdict','untrusted host execution','claiming external human participation while external human participant count is zero'],'exitCriteria':['Ten external role responses are verified','Twenty independent external audit attestations are verified','Three external drill receipts pass','Portable evidence inventory matches exact files','Base v33.53 verdict is externally qualified','External readiness verdict is independently recomputed']});save('NEXT_ACTION.json',na)
od=load('OPEN_DECISIONS.json');od['decisions'] += [{'id':'OD33.54-ROLE-HOLDERS','status':'open-external','recommendation':'Assign ten role holders across separate organizations, administrators and hosts.'},{'id':'OD33.54-DUAL-AUDITORS','status':'open-external','recommendation':'Assign two independent auditors per role with no role-holder organization overlap.'},{'id':'OD33.54-DRILL-WINDOW','status':'open-external','recommendation':'Schedule real partition, overload and site-loss recovery drills.'},{'id':'OD33.54-EVIDENCE-TRUST','status':'open-external','recommendation':'Approve trusted external evidence digests and public authenticated endpoints.'}];save('OPEN_DECISIONS.json',od)
for name,key,items in [('REQUIREMENT_REGISTRY.json','requirements',[{'id':'V33.54-REQ-01','status':'implemented-local','requirement':'Qualification execution must bind ten unique roles to one-time enrollment challenges and isolated process attestations.'},{'id':'V33.54-REQ-02','status':'implemented-local','requirement':'Each role requires two independent audits and the evidence bundle must contain portable exact-file inventory for all three drills.'}]),('EVIDENCE_REGISTRY.json','records',[{'id':'V33.54-E1','path':'release-evidence/v33.54/V33_54_PERSISTENCE_QUALIFICATION_EXECUTION_BUNDLE_PROOF.json','status':'local-rehearsal','claim':'Ten role processes, twenty dual-audit attestations and three drill processes exercised locally with external readiness blocked.'}]),('CAPABILITY_REGISTRY.json','capabilities',[{'id':CAP,'status':'implemented-and-exercised-local-rehearsal','description':'Role-bound qualification execution bundle with dual audit, drill evidence and portable readiness import.','authority':'local-qualification-execution-rehearsal-only-production-blocked'}]),('ASSUMPTION_REGISTRY.json','assumptions',[{'id':'V33.54-A1','status':'open-external','assumption':'Independent external role holders, auditors and drill operators can provide trusted evidence over public authenticated endpoints.'}]),('CONTRADICTION_REGISTRY.json','contradictions',[{'id':'V33.54-C1','status':'resolved-local','claim':'A complete local execution bundle proves external infrastructure qualification.','resolution':'False. External readiness also requires an externally qualified v33.53 base verdict and trusted external evidence for every role, audit, drill and bundle.'}]),('RISK_REGISTRY.json','risks',[{'id':'V33.54-R1','status':'open-external','risk':'Nonce replay, process reuse, auditor collusion, drill substitution or non-portable evidence could create a false readiness verdict.','mitigation':'Bind one-time challenges, unique process ids, two independent auditors, exact drill digests and relative file inventory.'}]),('SKILL_REGISTRY.json','skills',[{'id':'SK33.54-01','name':'qualification-execution-bundle','source':'v33.54 canonical','status':'implemented-local'}])]:
 d=load(name);d[key]+=items;save(name,d)
tr=load('TRACEABILITY_GRAPH.json');tr['links'] += [{'id':'TRACE-V33.54-REQ-01','requirement':'V33.54-REQ-01','capability':CAP,'test':'tests/persistence-qualification-execution-bundle-v33_54.test.ts','evidence':'V33.54-E1'},{'id':'TRACE-V33.54-REQ-02','requirement':'V33.54-REQ-02','capability':CAP,'test':'tests/persistence-qualification-execution-bundle-v33_54.test.ts','evidence':'V33.54-E1'}];save('TRACEABILITY_GRAPH.json',tr)
# governance code/tests
path=R/'src/governance/contracts.ts';s=path.read_text();s=re.sub(r"export const V33_PHASE = '.*?' as const;",f"export const V33_PHASE = '{PHASE}' as const;",s);path.write_text(s)
path=R/'src/governance/consistency.ts';s=path.read_text().replace("version === '33.53' ? V33_PHASE","version === '33.54' ? V33_PHASE");path.write_text(s)
for rel in ['tests/governance-consistency.test.ts','tests/workspace-continuity-v32_1.test.ts']:
 path=R/rel;s=path.read_text().replace('33.53','33.54').replace('v33.53','v33.54');path.write_text(s)
path=R/'tests/release-metadata-v32_11.test.ts';s=path.read_text().replace('canonical v33.53','canonical v33.54').replace("'0.43.0'","'0.44.0'").replace('/v33\\.53/i','/v33\\.54/i').replace("['validate:v33.53']","['validate:v33.54']").replace('validate-v33_53.py','validate-v33_54.py');path.write_text(s)
# docs
(R/'docs/V33_54_QUALIFICATION_EXECUTION_BUNDLE.md').write_text('# V33.54 Qualification Execution Bundle\n\nV33.54 binds ten infrastructure roles to one-time enrollment challenges, isolated process evidence, two independent auditors per role, three drill receipts and a portable exact-file evidence bundle. External readiness remains fail closed unless the v33.53 base verdict and all imported evidence are externally qualified.\n')
(R/'CLAUDE_HANDOFF_v33_54.md').write_text(f'# Claude Handoff v33.54\n\nCanonical phase: {PHASE}.\n\nContinue only from the v33.54 package. Preserve v33.53 verdict binding, ten role enrollments, unique processes, dual audit, portable evidence paths, trusted external digest requirements, G3 block and production authority NONE.\n')
(R/'V33_54_עדכון_ביצוע_והוכחות.md').write_text('# v33.54 — עדכון ביצוע והוכחות\n\nנוספה חבילת execution qualification: עשרה תפקידי תשתית, enrollment חד-פעמי, process attestations, שתי ביקורות עצמאיות לכל תפקיד, שלושה drills וחבילת evidence ניידת. readiness חיצוני נשאר חסום ללא בסיס v33.53 חיצוני וראיות אמיתיות.\n')
kit=R/'pilot-kits/v33.54/qualification-execution-bundle';kit.mkdir(parents=True,exist_ok=True)
(kit/'manifest.json').write_text(json.dumps({'version':'33.54','kitId':'qualification-execution-bundle','status':'LOCAL_REHEARSAL_ONLY','roleCount':10,'auditorQuorumPerRole':2,'drillCount':3,'productionAuthority':'NONE'},indent=2)+'\n')
(kit/'RUNBOOK.md').write_text('# V33.54 Runbook\n\n1. Verify v33.53 proof and base verdict.\n2. Assign ten separated role holders.\n3. Issue one-time enrollment packages.\n4. Collect isolated process attestations.\n5. Obtain two independent audits per role.\n6. Execute partition, overload and site-loss drills.\n7. Seal a relative-path exact-file evidence bundle.\n8. Import only trusted external evidence.\n9. Keep production and G3 blocked.\n')
(kit/'EXTERNAL_EVIDENCE_CHECKLIST.md').write_text('# External evidence checklist\n\n- [ ] v33.53 base verdict externally qualified\n- [ ] ten public authenticated role endpoints\n- [ ] unique role keys, organizations, administrators and hosts\n- [ ] twenty independent auditor attestations\n- [ ] partition drill evidence\n- [ ] overload/backpressure drill evidence\n- [ ] site-loss recovery drill evidence\n- [ ] portable relative-path inventory with exact SHA-256\n- [ ] trusted external evidence digests\n- [ ] production authority remains NONE\n')
# root markers
for rel in ['CLAUDE.md','MASTER_DIRECTIVE.md','PROGRAM_CHARTER.md','README.md']:
 path=R/rel;s=path.read_text();s=re.sub(r'v33\.53','v33.54',s,count=1,flags=re.I);path.write_text(s)
# artifact script and manifest version
path=R/'scripts/validate-artifacts.mjs';s=path.read_text().replace("version: '33.53'","version: '33.54'");path.write_text(s)
am=R/'evidence/generated/artifact-manifest.json'
if am.exists():
 d=json.loads(am.read_text());d['version']='33.54';am.write_text(json.dumps(d,indent=2)+'\n')
print('canonicalized v33.54')
