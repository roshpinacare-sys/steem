from pathlib import Path
import json,re
R=Path(__file__).resolve().parents[1]
NOW='2026-07-24T05:00:00.000Z'
PHASE='External Evidence Custody, Per-Role Encryption, Monotonic Chain of Custody, Dual-Control Decryption, Revocation, Offline Transfer, and Custodian-Loss Recovery'
STATUS='v33.55-external-evidence-custody-transport-local-rehearsal-production-blocked'
CAP='external-evidence-custody-transport-v33.55'
p=json.loads((R/'package.json').read_text());p['version']='0.45.0';p['description']='Unified Platform Program v33.55 — External Evidence Custody and Transport with AES-GCM, 2-of-3 Recovery, Dual Control, Revocation, and Offline Transfer';p['scripts'].update({
'proof:v33.55':'npm run build && node scripts/external-evidence-custody-transport-proof-v33_55.mjs',
'verify:proof:v33.55':'npm run build && node scripts/verify-external-evidence-custody-transport-v33_55.mjs',
'test:v33.55':'npm run build && node scripts/run-focused-tests-v33_55.mjs',
'test:full:v33.55':'npm run build && python3 scripts/run-full-regression-v33_55.py',
'test:direct:v33.55':'npm run build && python3 scripts/run-direct-v33-regression-v33_55.py',
'truth:v33.55':'node scripts/repository-truth-map-v33_55.mjs',
'architecture:v33.55':'node scripts/architecture-validation-v33_55.mjs',
'validate:v33.55':'python3 scripts/validate-v33_55.py'})
(R/'package.json').write_text(json.dumps(p,indent=2)+'\n')
l=json.loads((R/'package-lock.json').read_text());l['version']='0.45.0';l['packages']['']['version']='0.45.0';(R/'package-lock.json').write_text(json.dumps(l,indent=2)+'\n')
# focused
s=(R/'scripts/run-focused-tests-v33_54.mjs').read_text();s=s.replace("  'persistence-qualification-execution-bundle-v33_54.test.js',\n];","  'persistence-qualification-execution-bundle-v33_54.test.js',\n  'external-evidence-custody-transport-v33_55.test.js',\n];");s=s.replace('release-evidence/v33.54','release-evidence/v33.55').replace('V33_54','V33_55').replace("version: '33.54'","version: '33.55'");(R/'scripts/run-focused-tests-v33_55.mjs').write_text(s)
# full
s=(R/'scripts/run-full-regression-v33_54.py').read_text();s=s.replace("'persistence-qualification-execution-bundle-v33_54.test.js'}","'persistence-qualification-execution-bundle-v33_54.test.js','external-evidence-custody-transport-v33_55.test.js'}");s=s.replace('v33.54','v33.55').replace('V33_54','V33_55').replace("'33.54'","'33.55'").replace('forty-four-sensitive','forty-five-sensitive');(R/'scripts/run-full-regression-v33_55.py').write_text(s)
s=(R/'scripts/run-direct-v33-regression-v33_54.py').read_text().replace('v33.54','v33.55').replace('V33_54','V33_55').replace("'33.54'","'33.55'");(R/'scripts/run-direct-v33-regression-v33_55.py').write_text(s)
# truth
s=(R/'scripts/repository-truth-map-v33_54.mjs').read_text();insert="""  'src/supply-chain/external-evidence-custody-transport-v33_55.ts',
  'tests/external-evidence-custody-transport-v33_55.test.ts',
  'scripts/custody-crypto-worker-v33_55.mjs',
  'scripts/external-evidence-custody-transport-proof-v33_55.mjs',
  'scripts/verify-external-evidence-custody-transport-v33_55.mjs',
  'scripts/run-focused-tests-v33_55.mjs',
  'scripts/run-full-regression-v33_55.py',
  'scripts/run-direct-v33-regression-v33_55.py',
  'scripts/repository-truth-map-v33_55.mjs',
  'scripts/architecture-validation-v33_55.mjs',
  'scripts/validate-v33_55.py',
  'docs/V33_55_EXTERNAL_EVIDENCE_CUSTODY_TRANSPORT.md',
  'CLAUDE_HANDOFF_v33_55.md',
  'V33_55_עדכון_ביצוע_והוכחות.md',
  'pilot-kits/v33.55/external-evidence-custody-transport/manifest.json',
  'pilot-kits/v33.55/external-evidence-custody-transport/RUNBOOK.md',
  'pilot-kits/v33.55/external-evidence-custody-transport/EXTERNAL_EVIDENCE_CHECKLIST.md',
  'release-evidence/v33.55/V33_55_EXTERNAL_EVIDENCE_CUSTODY_TRANSPORT_PROOF.json',
  'release-evidence/v33.55/V33_55_INDEPENDENT_VERIFICATION.json',
"""
pos=s.find('\n\n];')
if pos<0: raise SystemExit('truth terminator missing')
s=s[:pos]+'\n'+insert+s[pos:]
s=s.replace('V33_54_RUN_DIR','V33_55_RUN_DIR').replace("'release-evidence/v33.54'","'release-evidence/v33.55'").replace("packageJson.version !== '0.44.0'","packageJson.version !== '0.45.0'").replace(r'/v33\.54/i',r'/v33\.55/i').replace("version !== '33.54'","version !== '33.55'").replace("version: '33.54'","version: '33.55'").replace('V33_54_REPOSITORY_TRUTH_MAP.json','V33_55_REPOSITORY_TRUTH_MAP.json').replace('REQUIRED_V33_54_COMPONENT_MISSING','REQUIRED_V33_55_COMPONENT_MISSING');(R/'scripts/repository-truth-map-v33_55.mjs').write_text(s)
# architecture
s=(R/'scripts/architecture-validation-v33_54.mjs').read_text();needle="  path('persistence-qualification-execution-bundle-v33.54',['src/supply-chain/persistence-qualification-execution-bundle-v33_54.ts','src/supply-chain/evidence-intake-operations-persistence-qualification-v33_53.ts','src/contracts/crypto.ts'],['tests/persistence-qualification-execution-bundle-v33_54.test.ts'],'ten role-bound enrollments and process attestations, dual independent audit per role, three portable drill receipts, exact evidence bundle inventory and fail-closed external readiness'),";add=needle+"\n  path('external-evidence-custody-transport-v33.55',['src/supply-chain/external-evidence-custody-transport-v33_55.ts','src/supply-chain/persistence-qualification-execution-bundle-v33_54.ts','src/contracts/crypto.ts'],['tests/external-evidence-custody-transport-v33_55.test.ts'],'AES-256-GCM per-role evidence encryption, 2-of-3 threshold recovery, monotonic custody ledger, dual-control decryption, quarantine, revocation, offline transfer and fail-closed external readiness'),"
if needle not in s: raise SystemExit('architecture anchor missing')
s=s.replace(needle,add).replace('V33_54_RUN_DIR','V33_55_RUN_DIR').replace("'release-evidence/v33.54'","'release-evidence/v33.55'").replace("version:'33.54'","version:'33.55'").replace('V33_54_ARCHITECTURE_INTEGRITY.json','V33_55_ARCHITECTURE_INTEGRITY.json').replace('release-evidence/v33.54/V33_54_ARCHITECTURE_INTEGRITY.json','release-evidence/v33.55/V33_55_ARCHITECTURE_INTEGRITY.json');(R/'scripts/architecture-validation-v33_55.mjs').write_text(s)
# governance
for base in [R/'governance-state',R/'v33/governance-state']:
 for path in base.glob('*.json'):
  d=json.loads(path.read_text());d['version']='33.55';d['updatedAt']=NOW
  if 'generatedAt' in d:d['generatedAt']=NOW
  path.write_text(json.dumps(d,indent=2)+'\n')
def load(n):return json.loads((R/'governance-state'/n).read_text())
def save(n,d):
 for base in [R/'governance-state',R/'v33/governance-state']:(base/n).write_text(json.dumps(d,indent=2)+'\n')
ps=load('PROGRAM_STATE.json');ps.update({'phase':PHASE,'status':STATUS,'nextAllowedAction':'Run independently administered custody and offline transfer using real custodians, hardware-backed encryption, dual-control decryption and external evidence digests.'});ps['completed'] += ['V33.55 external evidence custody and transport implemented','Ten evidence packages encrypted with AES-256-GCM and 2-of-3 key recovery exercised locally','Monotonic custody ledger, dual-control decryption, revocation, quarantine and offline transfer verified'];ps['evidencePaths'] += ['release-evidence/v33.55/V33_55_EXTERNAL_EVIDENCE_CUSTODY_TRANSPORT_PROOF.json','release-evidence/v33.55/V33_55_INDEPENDENT_VERIFICATION.json'];save('PROGRAM_STATE.json',ps)
na=load('NEXT_ACTION.json');na.update({'actionId':'NA33.55-EXECUTE-EXTERNAL-CUSTODY-TRANSPORT','title':'Execute External Evidence Custody and Transport','qualificationTargetVersion':'33.55','allowedActions':['Assign three independent custodians and dual-control decrypt controllers','Encrypt every execution-role evidence package with hardware-backed keys','Execute an offline transfer ceremony with independent witnesses','Import into quarantine and perform independent malware and secret scanning','Exercise irreversible revocation of an exposed package','Reconstruct evidence after loss of one custodian'],'forbiddenActions':['external mutation','production promotion','persisting raw private keys or unencrypted key shares','decrypting with fewer than two controllers','accepting fewer than two threshold shares','accepting fewer than three revocation votes','accepting a forked or truncated custody ledger','accepting absolute or traversal output paths','claiming external custody from a local v33.54 base verdict','untrusted host execution','claiming external human participation while external human participant count is zero'],'exitCriteria':['Ten externally encrypted packages are verified','Three independent custodians are attested','Offline transfer and quarantine receipts are verified','Dual-control decrypt receipt is verified','Revocation certificate is verified','Custodian-loss recovery receipt is verified','External custody verdict is independently recomputed']});save('NEXT_ACTION.json',na)
od=load('OPEN_DECISIONS.json');od['decisions'] += [{'id':'OD33.55-CUSTODIANS','status':'open-external','recommendation':'Assign three independent custodians using hardware-backed key material.'},{'id':'OD33.55-OFFLINE-MEDIA','status':'open-external','recommendation':'Select controlled offline media and witness procedure.'},{'id':'OD33.55-DECRYPT-CONTROL','status':'open-external','recommendation':'Assign two independent decrypt controllers and approval expiry policy.'},{'id':'OD33.55-REVOCATION','status':'open-external','recommendation':'Approve irreversible revocation and evidence destruction procedures.'}];save('OPEN_DECISIONS.json',od)
for name,key,items in [('REQUIREMENT_REGISTRY.json','requirements',[{'id':'V33.55-REQ-01','status':'implemented-local','requirement':'Each execution-role evidence package must be encrypted independently with AES-256-GCM and 2-of-3 threshold recovery.'},{'id':'V33.55-REQ-02','status':'implemented-local','requirement':'Custody transfer, quarantine, decryption, revocation and recovery must be bound to one monotonic signed ledger.'}]),('EVIDENCE_REGISTRY.json','records',[{'id':'V33.55-E1','path':'release-evidence/v33.55/V33_55_EXTERNAL_EVIDENCE_CUSTODY_TRANSPORT_PROOF.json','status':'local-rehearsal','claim':'Ten encrypted packages, offline transfer, quarantine, dual-control decrypt, revocation and custodian-loss recovery exercised locally.'}]),('CAPABILITY_REGISTRY.json','capabilities',[{'id':CAP,'status':'implemented-and-exercised-local-rehearsal','description':'Per-role encrypted evidence custody with threshold recovery, offline transfer, revocation and dual-control decryption.','authority':'local-evidence-custody-transport-rehearsal-only-production-blocked'}]),('ASSUMPTION_REGISTRY.json','assumptions',[{'id':'V33.55-A1','status':'open-external','assumption':'Independent external custodians and decrypt controllers can use hardware-backed key material and air-gapped media.'}]),('CONTRADICTION_REGISTRY.json','contradictions',[{'id':'V33.55-C1','status':'resolved-local','claim':'Local AES-GCM encryption and offline file copies prove external custody.','resolution':'False. External status requires an externally verified v33.54 base verdict, independent custodians and trusted external evidence digests.'}]),('RISK_REGISTRY.json','risks',[{'id':'V33.55-R1','status':'open-external','risk':'Share exposure, custody-ledger fork, controller collusion, infected media or revocation bypass could expose evidence.','mitigation':'Use 2-of-3 shares, monotonic ledger, dual control, quarantine scanning and irreversible quorum revocation.'}]),('SKILL_REGISTRY.json','skills',[{'id':'SK33.55-01','name':'external-evidence-custody-transport','source':'v33.55 canonical','status':'implemented-local'}])]:
 d=load(name);d[key]+=items;save(name,d)
tr=load('TRACEABILITY_GRAPH.json');tr['links'] += [{'id':'TRACE-V33.55-REQ-01','requirement':'V33.55-REQ-01','capability':CAP,'test':'tests/external-evidence-custody-transport-v33_55.test.ts','evidence':'V33.55-E1'},{'id':'TRACE-V33.55-REQ-02','requirement':'V33.55-REQ-02','capability':CAP,'test':'tests/external-evidence-custody-transport-v33_55.test.ts','evidence':'V33.55-E1'}];save('TRACEABILITY_GRAPH.json',tr)
path=R/'src/governance/contracts.ts';s=path.read_text();s=re.sub(r"export const V33_PHASE = '.*?' as const;",f"export const V33_PHASE = '{PHASE}' as const;",s);path.write_text(s)
path=R/'src/governance/consistency.ts';s=path.read_text().replace("version === '33.54' ? V33_PHASE","version === '33.55' ? V33_PHASE");path.write_text(s)
for rel in ['tests/governance-consistency.test.ts','tests/workspace-continuity-v32_1.test.ts']:
 path=R/rel;s=path.read_text().replace('33.54','33.55').replace('v33.54','v33.55');path.write_text(s)
path=R/'tests/release-metadata-v32_11.test.ts';s=path.read_text().replace('canonical v33.54','canonical v33.55').replace("'0.44.0'","'0.45.0'").replace('/v33\\.54/i','/v33\\.55/i').replace("['validate:v33.54']","['validate:v33.55']").replace('validate-v33_54.py','validate-v33_55.py');path.write_text(s)
(R/'docs/V33_55_EXTERNAL_EVIDENCE_CUSTODY_TRANSPORT.md').write_text('# V33.55 External Evidence Custody and Transport\n\nV33.55 encrypts ten role evidence packages independently with AES-256-GCM, splits each data key 2-of-3, records a monotonic custody ledger, requires dual-control decryption, supports irreversible revocation, quarantine import, offline transfer and one-custodian-loss reconstruction. External readiness remains fail closed.\n')
(R/'CLAUDE_HANDOFF_v33_55.md').write_text(f'# Claude Handoff v33.55\n\nCanonical phase: {PHASE}.\n\nContinue only from the v33.55 package. Preserve per-role encryption, threshold recovery, monotonic custody ledger, dual control, quarantine, revocation, portable paths, G3 block and production authority NONE.\n')
(R/'V33_55_עדכון_ביצוע_והוכחות.md').write_text('# v33.55 — עדכון ביצוע והוכחות\n\nנוספה שכבת custody ו-transport: הצפנת AES-GCM נפרדת לעשרה תפקידים, שחזור 2-מתוך-3, ledger מונוטוני, dual-control decrypt, quarantine, revocation והעברה offline. readiness חיצוני נשאר חסום.\n')
kit=R/'pilot-kits/v33.55/external-evidence-custody-transport';kit.mkdir(parents=True,exist_ok=True)
(kit/'manifest.json').write_text(json.dumps({'version':'33.55','kitId':'external-evidence-custody-transport','status':'LOCAL_REHEARSAL_ONLY','encryptedPackageCount':10,'shareCount':3,'threshold':2,'dualControlCount':2,'productionAuthority':'NONE'},indent=2)+'\n')
(kit/'RUNBOOK.md').write_text('# V33.55 Runbook\n\n1. Verify v33.54 proof and base verdict.\n2. Assign three independent custodians.\n3. Encrypt each role evidence package separately.\n4. Store only commitments and ciphertext in the evidence bundle.\n5. Execute offline transfer with two witnesses.\n6. Import to quarantine and scan.\n7. Require two controllers and two shares for decryption.\n8. Exercise revocation and one-custodian-loss recovery.\n9. Keep production and G3 blocked.\n')
(kit/'EXTERNAL_EVIDENCE_CHECKLIST.md').write_text('# External evidence checklist\n\n- [ ] v33.54 base verdict externally verified\n- [ ] ten independently encrypted evidence packages\n- [ ] three hardware-backed custodians\n- [ ] two independent decrypt controllers\n- [ ] witnessed offline media transfer\n- [ ] quarantine malware and private-key scan\n- [ ] irreversible revocation quorum\n- [ ] one-custodian-loss recovery drill\n- [ ] portable relative evidence paths\n- [ ] production authority remains NONE\n')
for rel in ['CLAUDE.md','MASTER_DIRECTIVE.md','PROGRAM_CHARTER.md','README.md']:
 path=R/rel;s=path.read_text();s=re.sub(r'v33\.54','v33.55',s,count=1,flags=re.I);path.write_text(s)
path=R/'scripts/validate-artifacts.mjs';s=path.read_text().replace("version: '33.54'","version: '33.55'");path.write_text(s)
am=R/'evidence/generated/artifact-manifest.json'
if am.exists():
 d=json.loads(am.read_text());d['version']='33.55';am.write_text(json.dumps(d,indent=2)+'\n')
print('canonicalized v33.55')
