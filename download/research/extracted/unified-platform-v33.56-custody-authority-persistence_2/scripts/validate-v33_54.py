#!/usr/bin/env python3
from __future__ import annotations
import json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'release-evidence/v33.54';CHECKS=[]
def load(p):return json.loads((ROOT/p).read_text())
def add(n,ok,d=None):CHECKS.append({'name':n,'ok':bool(ok),'detail':d})
required=['src/supply-chain/persistence-qualification-execution-bundle-v33_54.ts','tests/persistence-qualification-execution-bundle-v33_54.test.ts','scripts/execution-evidence-writer-v33_54.mjs','scripts/persistence-qualification-execution-bundle-proof-v33_54.mjs','scripts/verify-persistence-qualification-execution-bundle-v33_54.mjs','scripts/run-focused-tests-v33_54.mjs','scripts/run-full-regression-v33_54.py','scripts/run-direct-v33-regression-v33_54.py','scripts/repository-truth-map-v33_54.mjs','scripts/architecture-validation-v33_54.mjs','scripts/validate-v33_54.py','docs/V33_54_QUALIFICATION_EXECUTION_BUNDLE.md','CLAUDE_HANDOFF_v33_54.md','V33_54_עדכון_ביצוע_והוכחות.md','pilot-kits/v33.54/qualification-execution-bundle/manifest.json','pilot-kits/v33.54/qualification-execution-bundle/RUNBOOK.md','pilot-kits/v33.54/qualification-execution-bundle/EXTERNAL_EVIDENCE_CHECKLIST.md','release-evidence/v33.54/V33_54_PERSISTENCE_QUALIFICATION_EXECUTION_BUNDLE_PROOF.json','release-evidence/v33.54/V33_54_INDEPENDENT_VERIFICATION.json','release-evidence/v33.54/V33_54_FOCUSED_TEST_RECEIPT.json','release-evidence/v33.54/V33_54_FULL_TEST_RESULTS.json','release-evidence/v33.54/V33_54_FULL_TEST_META.json','release-evidence/v33.54/V33_54_DIRECT_V33_RESULTS.json','release-evidence/v33.54/V33_54_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.54/V33_54_ARCHITECTURE_INTEGRITY.json']
add('required-artifacts',all((ROOT/p).exists() for p in required),[p for p in required if not (ROOT/p).exists()])
try:
 p=load('release-evidence/v33.54/V33_54_PERSISTENCE_QUALIFICATION_EXECUTION_BUNDLE_PROOF.json');s=p['summary'];b=p['truthBoundary'];e=p['executionEvidence']
 add('proof-summary',s['newSignatureCount']==48 and s['totalChainSignatureCount']==400 and s['enrollmentCount']==10 and s['responseCount']==10 and s['auditCount']==20 and s['drillCount']==3 and s['processAttestationCount']==2 and s['roleProcessCount']==10 and s['drillProcessCount']==3 and s['signedArtifactWriteCount']==48,s)
 add('proof-process-evidence',len(e['processEvidence'])==10 and len(e['drillProcessEvidence'])==3 and e['signedArtifactWriteCount']==48 and all(x['fileFsync'] and x['directoryFsync'] and x['readBackVerified'] for x in e['processEvidence']+e['drillProcessEvidence']),{'roles':len(e['processEvidence']),'drills':len(e['drillProcessEvidence']),'writes':e['signedArtifactWriteCount']})
 add('proof-attacks',len(p['attacks'])==8 and all(p['attacks'].values()),p['attacks'])
 add('truth-boundary',b=={'status':'LOCAL_QUALIFICATION_EXECUTION_REHEARSAL_ONLY','externalTopologyObserved':False,'externalInfrastructureAttestations':0,'externalHumanParticipants':0,'productionAuthority':'NONE','externalEffectsExecuted':0,'g3':'BLOCKED','productionPromotion':'BLOCKED'},b)
except Exception as x:add('proof-readable',False,str(x))
try:
 q=load('release-evidence/v33.54/V33_54_INDEPENDENT_VERIFICATION.json');add('independent-verification',q['status']=='PASS' and q['portableEvidencePathsVerified'] and q['newSignatureCount']==48 and q['totalChainSignatureCount']==400 and q['roleProcessCount']==10 and q['drillProcessCount']==3 and q['processEvidenceFilesVerified']==13 and q['truthBoundary']['productionAuthority']=='NONE',q)
except Exception as x:add('independent-verification',False,str(x))
for name,path,expected in [('focused-regression','release-evidence/v33.54/V33_54_FOCUSED_TEST_RECEIPT.json',{'testFiles':25,'tests':886}),('full-regression','release-evidence/v33.54/V33_54_FULL_TEST_RESULTS.json',{'testFiles':239,'tests':2711}),('direct-v33-regression','release-evidence/v33.54/V33_54_DIRECT_V33_RESULTS.json',{'testFiles':54,'tests':1544})]:
 try:
  d=load(path);tot=d.get('totals',{});ok=d.get('status')=='passed' and tot.get('testFiles',d.get('testFiles'))==expected['testFiles'] and tot.get('tests')==expected['tests'] and tot.get('passed')==expected['tests'] and tot.get('failed')==0;add(name,ok,tot)
 except Exception as x:add(name,False,str(x))
try:
 t=load('release-evidence/v33.54/V33_54_REPOSITORY_TRUTH_MAP.json');inv=t['inventory'];add('repository-truth-map',t['status'] in ('PASS','passed') and inv['sourceModules']==243 and inv['testFiles']==239 and inv['governanceFiles']==11 and t['findings']==[],inv)
except Exception as x:add('repository-truth-map',False,str(x))
try:
 a=load('release-evidence/v33.54/V33_54_ARCHITECTURE_INTEGRITY.json');m=a['metrics'];add('architecture-integrity',a['status']=='PASS' and m['capabilityPathCount']==179 and m['closedCapabilityPathCount']==179 and m['sourceCycleCount']==0 and m['untestedSourceCount']==0 and a['findings']==[],m)
except Exception as x:add('architecture-integrity',False,str(x))
try:
 meta=load('release-evidence/v33.54/V33_54_FULL_TEST_META.json');rows=meta['files'];bd=meta['buildDigest'];rd=meta['runInputDigest'];add('regression-input-binding',meta['exitCode']==0 and len(rows)==239 and all(r['buildDigest']==bd and r['runInputDigest']==rd and r['exitCode']==0 and not r['timedOut'] for r in rows),{'receipts':len(rows),'buildDigest':bd,'runInputDigest':rd})
except Exception as x:add('regression-input-binding',False,str(x))
try:
 p=load('package.json');l=load('package-lock.json');ct=[load(str(x.relative_to(ROOT)))['version'] for x in sorted((ROOT/'governance-state').glob('*.json'))];mt=[load(str(x.relative_to(ROOT)))['version'] for x in sorted((ROOT/'v33/governance-state').glob('*.json'))];txt=(ROOT/'package-lock.json').read_text();add('canonical-metadata',p['version']=='0.44.0' and re.search(r'v33\.54',p['description'],re.I) and l['version']=='0.44.0' and l['packages']['']['version']=='0.44.0' and len(ct)==11 and all(x=='33.54' for x in ct) and all(x=='33.54' for x in mt),{'canonical':len(ct),'mirror':len(mt)});add('offline-lockfile','registry.npmjs.org' not in txt,None)
except Exception as x:add('canonical-metadata',False,str(x))
try:
 st=load('governance-state/PROGRAM_STATE.json');na=load('governance-state/NEXT_ACTION.json');forbidden=' | '.join(na.get('forbiddenActions',[])).lower();add('governance-boundary',st.get('phase')=='Persistence Qualification Execution Bundle, Role Enrollment, Dual Audit, External Drill Evidence, and Portable Readiness Import' and st.get('status')=='v33.54-qualification-execution-bundle-local-rehearsal-production-blocked' and st.get('executionBoundary',{}).get('productionPromotion')=='blocked' and st.get('executionBoundary',{}).get('externalMutation')=='not-authorized',{'phase':st.get('phase'),'status':st.get('status')});add('next-action-boundary',na.get('qualificationTargetVersion')=='33.54' and all(x in forbidden for x in ['production promotion','reusing enrollment nonce','fewer than two auditors','collocated auditor','absolute or traversal','local v33.53 base verdict','untrusted host execution','external human participant count is zero']),na.get('actionId'))
except Exception as x:add('governance-boundary',False,str(x))
status='PASS' if all(x['ok'] for x in CHECKS) else 'FAIL';result={'version':'33.54','status':status,'checkCount':len(CHECKS),'passed':sum(x['ok'] for x in CHECKS),'failed':sum(not x['ok'] for x in CHECKS),'checks':CHECKS};OUT.mkdir(parents=True,exist_ok=True);(OUT/'V33_54_FINAL_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if status=='PASS' else 1)
