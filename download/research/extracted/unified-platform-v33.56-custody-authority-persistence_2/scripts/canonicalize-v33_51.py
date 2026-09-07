from pathlib import Path
import json,re
R=Path(__file__).resolve().parents[1]
NOW='2026-07-23T14:45:00.000Z'
PHASE='Evidence Intake Operations Plane, SLA, Dual-Control Review, Dispute, Resubmission, and Quorum Progression'
STATUS='v33.51-evidence-intake-operations-local-rehearsal-production-blocked'
CAP='evidence-intake-operations-sla-dual-control-dispute-resubmission-and-readiness-v33.51'
# package
p=json.loads((R/'package.json').read_text());p['version']='0.41.0';p['description']='Unified Platform Program v33.51 — Evidence Intake Operations Plane, SLA, Dual-Control Review, Dispute, Resubmission, Quorum Progression, and Readiness Certificate'
p['scripts'].update({
'proof:v33.51':'npm run build && node scripts/evidence-intake-operations-plane-proof-v33_51.mjs',
'verify:proof:v33.51':'npm run build && node scripts/verify-evidence-intake-operations-plane-v33_51.mjs',
'test:v33.51':'npm run build && node scripts/run-focused-tests-v33_51.mjs',
'test:full:v33.51':'npm run build && python3 scripts/run-full-regression-v33_51.py',
'test:direct:v33.51':'npm run build && python3 scripts/run-direct-v33-regression-v33_51.py',
'truth:v33.51':'node scripts/repository-truth-map-v33_51.mjs',
'architecture:v33.51':'node scripts/architecture-validation-v33_51.mjs',
'validate:v33.51':'python3 scripts/validate-v33_51.py'})
(R/'package.json').write_text(json.dumps(p,indent=2)+'\n')
l=json.loads((R/'package-lock.json').read_text());l['version']='0.41.0';l['packages']['']['version']='0.41.0';(R/'package-lock.json').write_text(json.dumps(l,indent=2)+'\n')
# clone runners
pairs=[('run-focused-tests-v33_50.mjs','run-focused-tests-v33_51.mjs'),('run-full-regression-v33_50.py','run-full-regression-v33_51.py'),('run-direct-v33-regression-v33_50.py','run-direct-v33-regression-v33_51.py'),('repository-truth-map-v33_50.mjs','repository-truth-map-v33_51.mjs'),('architecture-validation-v33_50.mjs','architecture-validation-v33_51.mjs')]
for src,dst in pairs:
 s=(R/'scripts'/src).read_text().replace('V33_50','V33_51').replace('v33_50','v33_51').replace('v33.50','v33.51').replace("'33.50'","'33.51'").replace('"33.50"','"33.51"')
 (R/'scripts'/dst).write_text(s)
# focused retain 50 + add 51
path=R/'scripts/run-focused-tests-v33_51.mjs';s=path.read_text();s=s.replace("  'ceremony-evidence-intake-portal-v33_51.test.js',", "  'ceremony-evidence-intake-portal-v33_50.test.js',\n  'evidence-intake-operations-plane-v33_51.test.js',")
path.write_text(s)
# full sensitive retain 50 + add 51
path=R/'scripts/run-full-regression-v33_51.py';s=path.read_text();s=s.replace("'ceremony-evidence-intake-portal-v33_51.test.js'}", "'ceremony-evidence-intake-portal-v33_50.test.js','evidence-intake-operations-plane-v33_51.test.js'}")
path.write_text(s)
# truth restore v50 block and add v51 block
path=R/'scripts/repository-truth-map-v33_51.mjs';s=path.read_text()
start=s.find("  'src/supply-chain/ceremony-evidence-intake-portal-v33_51.ts',")
end=s.find("\n\n];",start)
if start<0 or end<0: raise SystemExit('truth block missing')
hist="""  'src/supply-chain/ceremony-evidence-intake-portal-v33_50.ts',
  'tests/ceremony-evidence-intake-portal-v33_50.test.ts',
  'scripts/ceremony-evidence-intake-portal-proof-v33_50.mjs',
  'scripts/verify-ceremony-evidence-intake-portal-v33_50.mjs',
  'scripts/run-focused-tests-v33_50.mjs',
  'scripts/run-full-regression-v33_50.py',
  'scripts/run-direct-v33-regression-v33_50.py',
  'scripts/repository-truth-map-v33_50.mjs',
  'scripts/architecture-validation-v33_50.mjs',
  'scripts/validate-v33_50.py',
  'docs/V33_50_CEREMONY_EVIDENCE_INTAKE_PORTAL.md',
  'CLAUDE_HANDOFF_v33_50.md',
  'V33_50_עדכון_ביצוע_והוכחות.md',
  'pilot-kits/v33.50/ceremony-evidence-intake-portal/manifest.json',
  'pilot-kits/v33.50/ceremony-evidence-intake-portal/RUNBOOK.md',
  'pilot-kits/v33.50/ceremony-evidence-intake-portal/EXTERNAL_EXECUTION_CHECKLIST.md',
  'release-evidence/v33.50/V33_50_CEREMONY_EVIDENCE_INTAKE_PORTAL_PROOF.json',
  'release-evidence/v33.50/V33_50_INDEPENDENT_VERIFICATION.json',
"""
new="""  'src/supply-chain/evidence-intake-operations-plane-v33_51.ts',
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
s=s[:start]+hist+new+s[end:]
s=s.replace("packageJson.version !== '0.40.0'", "packageJson.version !== '0.41.0'").replace(r'/v33\.50/i',r'/v33\.51/i')
path.write_text(s)
# architecture retain 50 path and add 51
path=R/'scripts/architecture-validation-v33_51.mjs';s=path.read_text()
old="  path('ceremony-evidence-intake-mutual-auth-quarantine-replacement-and-readiness-v33.51',['src/supply-chain/ceremony-evidence-intake-portal-v33_51.ts','src/supply-chain/external-ceremony-executor-v33_49.ts','src/app/evidence-intake-portal-v33_23.ts','src/contracts/crypto.ts'],['tests/ceremony-evidence-intake-portal-v33_51.test.ts'],'sixteen isolated mutual-authentication channels, exact role roster, malware quarantine, quorum-authorized replacement and fail-closed readiness verdict with production blocked'),"
rep="  path('ceremony-evidence-intake-mutual-auth-quarantine-replacement-and-readiness-v33.50',['src/supply-chain/ceremony-evidence-intake-portal-v33_50.ts','src/supply-chain/external-ceremony-executor-v33_49.ts','src/app/evidence-intake-portal-v33_23.ts','src/contracts/crypto.ts'],['tests/ceremony-evidence-intake-portal-v33_50.test.ts'],'sixteen isolated mutual-authentication channels, exact role roster, malware quarantine, quorum-authorized replacement and fail-closed readiness verdict with production blocked'),\n  path('evidence-intake-operations-sla-dual-control-dispute-resubmission-and-readiness-v33.51',['src/supply-chain/evidence-intake-operations-plane-v33_51.ts','src/supply-chain/ceremony-evidence-intake-portal-v33_50.ts','src/contracts/crypto.ts'],['tests/evidence-intake-operations-plane-v33_51.test.ts'],'organization-isolated queues, SLA deadlines, dual-control review, dispute and resubmission, monotonic quorum snapshots and fail-closed readiness certificate with production blocked'),"
if old not in s: raise SystemExit('arch path missing')
s=s.replace(old,rep);path.write_text(s)
# governance exact versions
for base in [R/'governance-state',R/'v33/governance-state']:
 for path in base.glob('*.json'):
  d=json.loads(path.read_text());d['version']='33.51';d['updatedAt']=NOW
  if 'generatedAt' in d:d['generatedAt']=NOW
  path.write_text(json.dumps(d,indent=2)+'\n')
def load(n):return json.loads((R/'governance-state'/n).read_text())
def save(n,d):
 for base in [R/'governance-state',R/'v33/governance-state']:(base/n).write_text(json.dumps(d,indent=2)+'\n')
ps=load('PROGRAM_STATE.json');ps.update({'phase':PHASE,'status':STATUS,'nextAllowedAction':'Run independently administered evidence intake operations with organization-isolated queues, dual-control review, dispute resolution and external attestation collection.'});ps['completed'] += ['V33.51 evidence intake operations plane implemented','Sixteen queue tickets and dual-control approvals exercised locally','Dispute, resubmission, four-step quorum progression and readiness recomputation verified'];ps['evidencePaths'] += ['release-evidence/v33.51/V33_51_EVIDENCE_INTAKE_OPERATIONS_PLANE_PROOF.json','release-evidence/v33.51/V33_51_INDEPENDENT_VERIFICATION.json'];save('PROGRAM_STATE.json',ps)
na=load('NEXT_ACTION.json');na.update({'actionId':'NA33.51-EXECUTE-EXTERNAL-INTAKE-OPERATIONS','title':'Execute External Evidence Intake Operations','qualificationTargetVersion':'33.51','allowedActions':['Operate one organization-isolated queue for each ceremony role','Enforce SLA and dual-control review for every quarantined receipt','Resolve disputes only through revision-linked resubmission','Append monotonic quorum progression snapshots','Issue external readiness only after sixteen approvals and twenty-two trusted attestations'],'forbiddenActions':['external mutation','production promotion','accepting a ticket after SLA without a new revision','single-reviewer approval','overwriting disputed evidence','skipping a quorum progression sequence','claiming external readiness without twenty-two trusted attestations','untrusted host execution','claiming external human participation while external human participant count is zero'],'exitCriteria':['Sixteen role slots have dual-control approvals','All disputes are closed through revision-linked resubmission','Four monotonic quorum snapshots are independently verified','Twenty-two trusted infrastructure attestations are present for external readiness','Independent verifier recomputes the readiness certificate']});save('NEXT_ACTION.json',na)
od=load('OPEN_DECISIONS.json');od['decisions'] += [
{'id':'OD33.51-QUEUE-OWNERS','status':'open-external','recommendation':'Assign separately administered queue owners for all participating organizations.'},
{'id':'OD33.51-DUAL-CONTROL-REVIEWERS','status':'open-external','recommendation':'Assign two independent reviewers per role with distinct organization, administrator and host identities.'},
{'id':'OD33.51-DISPUTE-AUTHORITY','status':'open-external','recommendation':'Define dispute and resubmission authorities, SLA windows and escalation policy.'},
{'id':'OD33.51-READINESS-SIGNER','status':'open-external','recommendation':'Assign an independent readiness certificate signer after twenty-two attestations are verified.'}];save('OPEN_DECISIONS.json',od)
for name,key,items in [
('REQUIREMENT_REGISTRY.json','requirements',[{'id':'V33.51-REQ-01','status':'implemented-local','requirement':'Every quarantined role receipt must enter an organization-isolated queue and receive two independent signed review decisions before approval.'},{'id':'V33.51-REQ-02','status':'implemented-local','requirement':'Disputes require revision-linked resubmission and readiness requires four monotonic quorum snapshots, sixteen approvals and twenty-two external attestations.'}]),
('EVIDENCE_REGISTRY.json','records',[{'id':'V33.51-E1','path':'release-evidence/v33.51/V33_51_EVIDENCE_INTAKE_OPERATIONS_PLANE_PROOF.json','status':'local-rehearsal','claim':'Sixteen queue tickets, dual-control reviews, dispute/resubmission and four-step quorum progression are exercised locally without external readiness claims.'}]),
('CAPABILITY_REGISTRY.json','capabilities',[{'id':CAP,'status':'implemented-and-exercised-local-rehearsal','description':'Organization-isolated evidence queues, SLA enforcement, dual-control review, revision-linked disputes, monotonic quorum progression and fail-closed readiness certificate.','authority':'local-operations-rehearsal-only-production-blocked'}]),
('ASSUMPTION_REGISTRY.json','assumptions',[{'id':'V33.51-A1','status':'open-external','assumption':'Independent organizations can staff separate queue owners and dual-control reviewers within the configured SLA.'}]),
('CONTRADICTION_REGISTRY.json','contradictions',[{'id':'V33.51-C1','status':'resolved-local','claim':'Completing the local operations queue proves external readiness.','resolution':'False. The readiness certificate remains local unless the v33.50 base verdict is external and the final snapshot contains exactly twenty-two trusted attestations.'}]),
('RISK_REGISTRY.json','risks',[{'id':'V33.51-R1','status':'open-external','risk':'Queue state or reviewer collusion could be mistaken for independently verified external evidence.','mitigation':'Bind approvals to original v33.50 receipt signatures, require reviewer separation and keep external readiness false without twenty-two attestations.'}]),
('SKILL_REGISTRY.json','skills',[{'id':'SK33.51-01','name':'evidence-intake-operations-plane','source':'v33.51 canonical','status':'implemented-local'}])]:
 d=load(name);d[key]+=items;save(name,d)
tr=load('TRACEABILITY_GRAPH.json');tr['links'] += [{'id':'TRACE-V33.51-REQ-01','requirement':'V33.51-REQ-01','capability':CAP,'test':'tests/evidence-intake-operations-plane-v33_51.test.ts','evidence':'V33.51-E1'},{'id':'TRACE-V33.51-REQ-02','requirement':'V33.51-REQ-02','capability':CAP,'test':'tests/evidence-intake-operations-plane-v33_51.test.ts','evidence':'V33.51-E1'}];save('TRACEABILITY_GRAPH.json',tr)
# contracts/tests
path=R/'src/governance/contracts.ts';s=path.read_text().replace("export const V33_PHASE = 'Ceremony Evidence Intake Portal, Mutual Authentication, Quarantine, Replacement, and Readiness Gate' as const;",f"export const V33_PHASE = '{PHASE}' as const;");path.write_text(s)
path=R/'src/governance/consistency.ts';s=path.read_text().replace("version === '33.50' ? V33_PHASE", "version === '33.51' ? V33_PHASE");path.write_text(s)
for rel in ['tests/governance-consistency.test.ts','tests/workspace-continuity-v32_1.test.ts','tests/release-metadata-v32_11.test.ts']:
 path=R/rel;s=path.read_text().replace('33.50','33.51').replace('v33.50','v33.51').replace('0.40.0','0.41.0').replace('validate-v33_50.py','validate-v33_51.py');path.write_text(s)
# docs/kit
(R/'docs/V33_51_EVIDENCE_INTAKE_OPERATIONS_PLANE.md').write_text('# V33.51 Evidence Intake Operations Plane\n\nV33.51 adds organization-isolated queue tickets, SLA enforcement, dual-control review, dispute and revision-linked resubmission, four-step quorum progression, and a fail-closed readiness certificate.\n\nNo external organization, reviewer, attestation or production authority was observed.\n')
(R/'CLAUDE_HANDOFF_v33_51.md').write_text(f'# Claude Handoff v33.51\n\nCanonical phase: {PHASE}.\n\nContinue only from the v33.51 package. Preserve v33.50 receipt signature binding, dual-control review separation, monotonic snapshot progression and production/G3 blocks.\n')
(R/'V33_51_עדכון_ביצוע_והוכחות.md').write_text('# v33.51 — עדכון ביצוע והוכחות\n\nנוספה שכבת תפעול לקליטת ראיות: תורים מבודדים, SLA, ביקורת כפולה, dispute/resubmission, ledger מונוטוני ותעודת readiness חסומה כברירת מחדל. לא נצפו ראיות חיצוניות אמיתיות.\n')
kit=R/'pilot-kits/v33.51/evidence-intake-operations-plane';kit.mkdir(parents=True,exist_ok=True)
(kit/'manifest.json').write_text(json.dumps({'version':'33.51','kitId':'evidence-intake-operations-plane','status':'LOCAL_REHEARSAL_ONLY','requiredRoles':16,'dualControlReviewQuorum':2,'requiredSnapshots':4,'requiredExternalAttestations':22,'productionAuthority':'NONE'},indent=2)+'\n')
(kit/'RUNBOOK.md').write_text('# V33.51 Operations Runbook\n\n1. Verify v33.50 policy, readiness verdict, and quarantine receipt signatures.\n2. Queue one ticket per role and enforce the review SLA.\n3. Require two separated ACCEPT decisions for approval.\n4. Open disputes only from signed REJECT decisions and resubmit as a new revision.\n5. Append four monotonic quorum snapshots.\n6. Keep external readiness false without the external v33.50 verdict and 22 attestations.\n')
(kit/'EXTERNAL_EXECUTION_CHECKLIST.md').write_text('# External execution checklist\n\n- [ ] 16 organization-isolated queues\n- [ ] two independent reviewers per role\n- [ ] SLA and escalation ownership\n- [ ] revision-linked dispute/resubmission workflow\n- [ ] four monotonic snapshots\n- [ ] 22 trusted external attestations\n- [ ] independent readiness certificate signer\n- [ ] production authority remains NONE\n')
# root first current marker
for rel in ['CLAUDE.md','MASTER_DIRECTIVE.md','PROGRAM_CHARTER.md','README.md']:
 path=R/rel;s=path.read_text();s=re.sub(r'v33\.50','v33.51',s,count=1,flags=re.I);path.write_text(s)
print('canonicalized v33.51')
