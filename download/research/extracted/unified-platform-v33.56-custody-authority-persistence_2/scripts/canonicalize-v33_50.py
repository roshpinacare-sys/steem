from pathlib import Path
import json, shutil, re
R=Path(__file__).resolve().parents[1]
NOW='2026-07-23T11:30:00.000Z'
PHASE='Ceremony Evidence Intake Portal, Mutual Authentication, Quarantine, Replacement, and Readiness Gate'
STATUS='v33.50-ceremony-evidence-intake-local-rehearsal-production-blocked'
CAP='ceremony-evidence-intake-mutual-auth-quarantine-replacement-and-readiness-v33.50'

# package metadata
p=json.loads((R/'package.json').read_text());p['version']='0.40.0';p['description']='Unified Platform Program v33.50 — Ceremony Evidence Intake Portal, Mutual Authentication, Quarantine, Role Replacement, and Readiness Gate'
p['scripts'].update({
 'proof:v33.50':'npm run build && node scripts/ceremony-evidence-intake-portal-proof-v33_50.mjs',
 'verify:proof:v33.50':'npm run build && node scripts/verify-ceremony-evidence-intake-portal-v33_50.mjs',
 'test:v33.50':'npm run build && node scripts/run-focused-tests-v33_50.mjs',
 'test:full:v33.50':'npm run build && python3 scripts/run-full-regression-v33_50.py',
 'test:direct:v33.50':'npm run build && python3 scripts/run-direct-v33-regression-v33_50.py',
 'truth:v33.50':'node scripts/repository-truth-map-v33_50.mjs',
 'architecture:v33.50':'node scripts/architecture-validation-v33_50.mjs',
 'validate:v33.50':'python3 scripts/validate-v33_50.py'})
(R/'package.json').write_text(json.dumps(p,indent=2)+'\n')
l=json.loads((R/'package-lock.json').read_text());l['version']='0.40.0';l['packages']['']['version']='0.40.0';(R/'package-lock.json').write_text(json.dumps(l,indent=2)+'\n')

# clone runners
for src,dst in [
 ('run-focused-tests-v33_49.mjs','run-focused-tests-v33_50.mjs'),('run-full-regression-v33_49.py','run-full-regression-v33_50.py'),('run-direct-v33-regression-v33_49.py','run-direct-v33-regression-v33_50.py'),('repository-truth-map-v33_49.mjs','repository-truth-map-v33_50.mjs'),('architecture-validation-v33_49.mjs','architecture-validation-v33_50.mjs'),('validate-v33_49.py','validate-v33_50.py')]:
    s=(R/'scripts'/src).read_text()
    s=s.replace('V33_49','V33_50').replace('v33_49','v33_50').replace('v33.49','v33.50').replace("'33.49'","'33.50'").replace('"33.49"','"33.50"')
    (R/'scripts'/dst).write_text(s)

# focused: retain prior file and add new
fp=R/'scripts/run-focused-tests-v33_50.mjs';s=fp.read_text();s=s.replace("  'external-ceremony-executor-v33_50.test.js',", "  'external-ceremony-executor-v33_49.test.js',\n  'ceremony-evidence-intake-portal-v33_50.test.js',")
fp.write_text(s)
# full: retain prior sensitive and add new
fp=R/'scripts/run-full-regression-v33_50.py';s=fp.read_text();s=s.replace("'external-ceremony-executor-v33_50.test.js'}", "'external-ceremony-executor-v33_49.test.js','ceremony-evidence-intake-portal-v33_50.test.js'}")
s=s.replace('thirty-eight-sensitive','forty-sensitive').replace("'version':'33.50'", "'version':'33.50'")
fp.write_text(s)

# truth map: restore historical v33.49 block and append v33.50 block
fp=R/'scripts/repository-truth-map-v33_50.mjs';s=fp.read_text()
newblock="""  'src/supply-chain/ceremony-evidence-intake-portal-v33_50.ts',
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
hist="""  'src/supply-chain/external-ceremony-executor-v33_49.ts',
  'tests/external-ceremony-executor-v33_49.test.ts',
  'scripts/external-ceremony-executor-proof-v33_49.mjs',
  'scripts/verify-external-ceremony-executor-v33_49.mjs',
  'scripts/run-focused-tests-v33_49.mjs',
  'scripts/run-full-regression-v33_49.py',
  'scripts/run-direct-v33-regression-v33_49.py',
  'scripts/repository-truth-map-v33_49.mjs',
  'scripts/architecture-validation-v33_49.mjs',
  'scripts/validate-v33_49.py',
  'docs/V33_49_EXTERNAL_CEREMONY_EXECUTOR.md',
  'CLAUDE_HANDOFF_v33_49.md',
  'V33_49_עדכון_ביצוע_והוכחות.md',
  'pilot-kits/v33.49/external-ceremony-executor/manifest.json',
  'pilot-kits/v33.49/external-ceremony-executor/RUNBOOK.md',
  'pilot-kits/v33.49/external-ceremony-executor/EXTERNAL_EXECUTION_CHECKLIST.md',
  'release-evidence/v33.49/V33_49_EXTERNAL_CEREMONY_EXECUTOR_PROOF.json',
  'release-evidence/v33.49/V33_49_INDEPENDENT_VERIFICATION.json',
"""
# cloned current block points to nonexistent external ceremony v33.50; replace it
start=s.find("  'src/supply-chain/external-ceremony-executor-v33_50.ts',")
end=s.find("\n\n];",start)
if start<0 or end<0: raise SystemExit('truth current block not found')
s=s[:start]+hist+newblock+s[end:]
s=s.replace('REQUIRED_V33_50_COMPONENT_MISSING','REQUIRED_V33_50_COMPONENT_MISSING').replace("packageJson.version !== '0.39.0'", "packageJson.version !== '0.40.0'").replace(r'/v33\.49/i',r'/v33\.50/i')
fp.write_text(s)

# architecture: restore 49 path and add 50 path
fp=R/'scripts/architecture-validation-v33_50.mjs';s=fp.read_text()
old="  path('external-ceremony-enrollment-revocation-sealed-transfer-and-import-gate-v33.50',['src/supply-chain/external-ceremony-executor-v33_50.ts','src/supply-chain/external-coordinator-deployment-evidence-import-v33_48.ts','src/contracts/crypto.ts'],['tests/external-ceremony-executor-v33_50.test.ts'],'sixteen role-bound enrollment packages, one-time responses, interrupted-ceremony revocation, sealed evidence transfer and exact import gate with production blocked'),"
rep="  path('external-ceremony-enrollment-revocation-sealed-transfer-and-import-gate-v33.49',['src/supply-chain/external-ceremony-executor-v33_49.ts','src/supply-chain/external-coordinator-deployment-evidence-import-v33_48.ts','src/contracts/crypto.ts'],['tests/external-ceremony-executor-v33_49.test.ts'],'sixteen role-bound enrollment packages, one-time responses, interrupted-ceremony revocation, sealed evidence transfer and exact import gate with production blocked'),\n  path('ceremony-evidence-intake-mutual-auth-quarantine-replacement-and-readiness-v33.50',['src/supply-chain/ceremony-evidence-intake-portal-v33_50.ts','src/supply-chain/external-ceremony-executor-v33_49.ts','src/app/evidence-intake-portal-v33_23.ts','src/contracts/crypto.ts'],['tests/ceremony-evidence-intake-portal-v33_50.test.ts'],'sixteen isolated mutual-authentication channels, exact role roster, malware quarantine, quorum-authorized replacement and fail-closed readiness verdict with production blocked'),"
if old not in s: raise SystemExit('architecture current path missing')
s=s.replace(old,rep)
fp.write_text(s)

# governance all exact versions
for base in [R/'governance-state',R/'v33/governance-state']:
    for path in base.glob('*.json'):
        d=json.loads(path.read_text());d['version']='33.50';d['updatedAt']=NOW
        if 'generatedAt' in d:d['generatedAt']=NOW
        path.write_text(json.dumps(d,indent=2)+'\n')

def load(name): return json.loads((R/'governance-state'/name).read_text())
def save(name,d):
    for base in [R/'governance-state',R/'v33/governance-state']:(base/name).write_text(json.dumps(d,indent=2)+'\n')
ps=load('PROGRAM_STATE.json');ps.update({'phase':PHASE,'status':STATUS,'nextAllowedAction':'Execute independently administered role evidence intake with separate mutual-authentication channels, qualified malware scanners, trusted external attestations and replacement custody.'});ps['completed'] += ['V33.50 ceremony evidence intake portal implemented','Sixteen role-bound mutual-authentication channels and quarantine receipts exercised locally','Three-of-three role replacement approval and readiness recomputation verified'];ps['evidencePaths'] += ['release-evidence/v33.50/V33_50_CEREMONY_EVIDENCE_INTAKE_PORTAL_PROOF.json','release-evidence/v33.50/V33_50_INDEPENDENT_VERIFICATION.json'];save('PROGRAM_STATE.json',ps)
na=load('NEXT_ACTION.json');na.update({'actionId':'NA33.50-EXECUTE-INDEPENDENT-EVIDENCE-INTAKE','title':'Execute Independent Ceremony Evidence Intake','qualificationTargetVersion':'33.50','allowedActions':['Deploy sixteen separately administered mutual-authentication intake channels','Import role evidence into quarantine and run qualified malware scanners','Replace unavailable role holders only with three-custodian authorization','Compute external readiness only after sixteen clean receipts and twenty-two trusted attestations'],'forbiddenActions':['external mutation','production promotion','reusing a mutual-authentication channel for a different submission','accepting malware or secret material','accepting a role response outside the authority-signed roster','relabeling builtin quarantine scans as externally qualified','claiming external readiness with fewer than twenty-two trusted infrastructure attestations','claiming external human participation while external human participant count is zero'],'exitCriteria':['Sixteen role slots are accepted through distinct mutual-authentication channels','Every role evidence set is quarantined and independently malware-scanned','Twenty-two trusted infrastructure attestations and externally qualified scans are verified','Any replacement role holder is authorized by three distinct custodians','Independent verifier recomputes the readiness verdict from original receipts']});save('NEXT_ACTION.json',na)
od=load('OPEN_DECISIONS.json');od['decisions'] += [
 {'id':'OD33.50-INTAKE-ENDPOINTS','status':'open-external','recommendation':'Assign sixteen separately administered mutual-authentication endpoints and client certificates.'},
 {'id':'OD33.50-MALWARE-SCANNERS','status':'open-external','recommendation':'Select externally qualified malware scanners and publish their signed attestation roots.'},
 {'id':'OD33.50-ROLE-REPLACEMENT','status':'open-external','recommendation':'Assign three independent replacement custodians and a separate replacement authority.'},
 {'id':'OD33.50-ATTESTATION-QUORUM','status':'open-external','recommendation':'Collect and independently verify twenty-two provider-backed infrastructure attestations before readiness.'}];save('OPEN_DECISIONS.json',od)
# append registries
req=load('REQUIREMENT_REGISTRY.json');req['requirements'] += [{'id':'V33.50-REQ-01','status':'implemented-local','requirement':'Every ceremony role must submit through a fresh mutually authenticated channel, exact authority-signed roster binding and malware quarantine.'},{'id':'V33.50-REQ-02','status':'implemented-local','requirement':'External readiness requires sixteen clean role receipts, twenty-two trusted infrastructure attestations and quorum-authorized replacement for any unavailable role holder.'}];save('REQUIREMENT_REGISTRY.json',req)
ev=load('EVIDENCE_REGISTRY.json');ev['records'].append({'id':'V33.50-E1','path':'release-evidence/v33.50/V33_50_CEREMONY_EVIDENCE_INTAKE_PORTAL_PROOF.json','status':'local-rehearsal','claim':'Sixteen mutual-authentication channels, quarantine scans, role replacement and readiness recomputation are exercised locally without external readiness claims.'});save('EVIDENCE_REGISTRY.json',ev)
cap=load('CAPABILITY_REGISTRY.json');cap['capabilities'].append({'id':CAP,'status':'implemented-and-exercised-local-rehearsal','description':'Authority-roster-bound mutual authentication, exact evidence intake, malware quarantine, quorum role replacement and fail-closed external readiness gate.','authority':'local-intake-rehearsal-only-production-blocked'});save('CAPABILITY_REGISTRY.json',cap)
asu=load('ASSUMPTION_REGISTRY.json');asu['assumptions'].append({'id':'V33.50-A1','status':'open-external','assumption':'Independent role owners can submit evidence over separately administered mutual-authentication channels and qualified scanners can provide trustworthy clean verdicts.'});save('ASSUMPTION_REGISTRY.json',asu)
con=load('CONTRADICTION_REGISTRY.json');con['contradictions'].append({'id':'V33.50-C1','status':'resolved-local','claim':'Sixteen quarantined local submissions prove an external ceremony is ready.','resolution':'False. V33.50 requires externally qualified malware scans and exactly twenty-two trusted infrastructure attestations before external readiness can be asserted.'});save('CONTRADICTION_REGISTRY.json',con)
risk=load('RISK_REGISTRY.json');risk['risks'].append({'id':'V33.50-R1','status':'open-external','risk':'Local mutual-authentication fixtures and builtin scans could be mislabeled as independently administered external intake.','mitigation':'Keep external readiness false until qualified scanner attestations, twenty-two infrastructure attestations and independent role ownership are verified.'});save('RISK_REGISTRY.json',risk)
sk=load('SKILL_REGISTRY.json');sk['skills'].append({'id':'SK33.50-01','name':'ceremony-evidence-intake-portal','source':'v33.50 canonical','status':'implemented-local'});save('SKILL_REGISTRY.json',sk)
tr=load('TRACEABILITY_GRAPH.json');tr['links'] += [{'id':'TRACE-V33.50-REQ-01','requirement':'V33.50-REQ-01','capability':CAP,'test':'tests/ceremony-evidence-intake-portal-v33_50.test.ts','evidence':'V33.50-E1'},{'id':'TRACE-V33.50-REQ-02','requirement':'V33.50-REQ-02','capability':CAP,'test':'tests/ceremony-evidence-intake-portal-v33_50.test.ts','evidence':'V33.50-E1'}];save('TRACEABILITY_GRAPH.json',tr)

# governance contracts/tests
path=R/'src/governance/contracts.ts';s=path.read_text().replace("export const V33_PHASE = 'External Ceremony Executor, Role Enrollment, Revocation, Sealed Evidence Transfer, and Exact Import Gate' as const;",f"export const V33_PHASE = '{PHASE}' as const;");path.write_text(s)
path=R/'src/governance/consistency.ts';s=path.read_text().replace("version === '33.49' ? V33_PHASE", "version === '33.50' ? V33_PHASE");path.write_text(s)
for rel in ['tests/governance-consistency.test.ts','tests/workspace-continuity-v32_1.test.ts','tests/release-metadata-v32_11.test.ts']:
    path=R/rel;s=path.read_text().replace('33.49','33.50').replace('v33.49','v33.50').replace('0.39.0','0.40.0').replace('validate:v33.49','validate:v33.50').replace('validate-v33_49.py','validate-v33_50.py');path.write_text(s)

# docs and kit
(R/'docs').mkdir(exist_ok=True)
(R/'docs/V33_50_CEREMONY_EVIDENCE_INTAKE_PORTAL.md').write_text(f"""# V33.50 Ceremony Evidence Intake Portal\n\nV33.50 adds authority-roster-bound mutual authentication, per-role quarantine, malware scanning, three-custodian role replacement and a fail-closed readiness verdict.\n\n## Proven locally\n\n- 16 isolated role channels and 16 quarantine receipts.\n- Exact artifact bytes, paths, media types and SHA-256 values.\n- Builtin malware and secret detection.\n- Three-of-three replacement approval for one unavailable role.\n- Independent recomputation of the local readiness verdict.\n\n## Not proven\n\nNo external host, scanner, infrastructure attestation or human participant was observed. Production authority remains NONE and G3 remains blocked.\n""")
(R/'CLAUDE_HANDOFF_v33_50.md').write_text(f"# Claude Handoff v33.50\n\nCanonical phase: {PHASE}.\n\nContinue only from the v33.50 package. Preserve the authority-signed 16-response roster, one-submission channels, quarantine scans, replacement quorum, and production/G3 blocks.\n")
(R/'V33_50_עדכון_ביצוע_והוכחות.md').write_text("# v33.50 — עדכון ביצוע והוכחות\n\nנוסף שער קליטת ראיות לטקס עם 16 ערוצי אימות הדדי, quarantine, סריקות malware, החלפת בעל תפקיד בקוורום ושער readiness חסום כברירת מחדל. לא נצפו ראיות חיצוניות אמיתיות.\n")
kit=R/'pilot-kits/v33.50/ceremony-evidence-intake-portal';kit.mkdir(parents=True,exist_ok=True)
(kit/'manifest.json').write_text(json.dumps({'version':'33.50','kitId':'ceremony-evidence-intake-portal','status':'LOCAL_REHEARSAL_ONLY','requiredRoles':16,'requiredExternalInfrastructureAttestations':22,'productionAuthority':'NONE'},indent=2)+'\n')
(kit/'RUNBOOK.md').write_text('# V33.50 Intake Runbook\n\n1. Verify the v33.49 ceremony receipt and the 16 authorized enrollment responses.\n2. Issue one mutually authenticated channel per role.\n3. Quarantine exact bytes and run malware scanning.\n4. Replace a missing role only with three independent approvals.\n5. Compute readiness independently; do not set external readiness without 22 trusted attestations.\n')
(kit/'EXTERNAL_EXECUTION_CHECKLIST.md').write_text('# External execution checklist\n\n- [ ] 16 separately administered channels\n- [ ] 16 authority-roster-bound submissions\n- [ ] externally qualified clean malware scans\n- [ ] 22 trusted infrastructure attestations\n- [ ] replacement quorum where applicable\n- [ ] independent readiness recomputation\n- [ ] production authority remains NONE until separately authorized\n')

# root authority docs light update
for rel in ['CLAUDE.md','MASTER_DIRECTIVE.md','PROGRAM_CHARTER.md','README.md']:
    path=R/rel;s=path.read_text();s=re.sub(r'v33\.49', 'v33.50', s, count=1, flags=re.I);path.write_text(s)
print('canonicalized v33.50')
