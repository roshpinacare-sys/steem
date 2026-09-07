#!/usr/bin/env python3
from __future__ import annotations
import json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'release-evidence/v33.49';CHECKS=[]
def load(p):return json.loads((ROOT/p).read_text())
def add(n,ok,d=None):CHECKS.append({'name':n,'ok':bool(ok),'detail':d})
required=['src/supply-chain/external-ceremony-executor-v33_49.ts','tests/external-ceremony-executor-v33_49.test.ts','scripts/external-ceremony-executor-proof-v33_49.mjs','scripts/verify-external-ceremony-executor-v33_49.mjs','scripts/run-focused-tests-v33_49.mjs','scripts/run-full-regression-v33_49.py','scripts/run-direct-v33-regression-v33_49.py','scripts/repository-truth-map-v33_49.mjs','scripts/architecture-validation-v33_49.mjs','scripts/validate-v33_49.py','docs/V33_49_EXTERNAL_CEREMONY_EXECUTOR.md','CLAUDE_HANDOFF_v33_49.md','V33_49_עדכון_ביצוע_והוכחות.md','pilot-kits/v33.49/external-ceremony-executor/manifest.json','pilot-kits/v33.49/external-ceremony-executor/RUNBOOK.md','pilot-kits/v33.49/external-ceremony-executor/EXTERNAL_EXECUTION_CHECKLIST.md','release-evidence/v33.49/V33_49_EXTERNAL_CEREMONY_EXECUTOR_PROOF.json','release-evidence/v33.49/V33_49_INDEPENDENT_VERIFICATION.json','release-evidence/v33.49/V33_49_FOCUSED_TEST_RECEIPT.json','release-evidence/v33.49/V33_49_FULL_TEST_RESULTS.json','release-evidence/v33.49/V33_49_FULL_TEST_META.json','release-evidence/v33.49/V33_49_DIRECT_V33_RESULTS.json','release-evidence/v33.49/V33_49_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.49/V33_49_ARCHITECTURE_INTEGRITY.json']
add('required-artifacts',all((ROOT/p).exists() for p in required),[p for p in required if not (ROOT/p).exists()])
try:
 p=load('release-evidence/v33.49/V33_49_EXTERNAL_CEREMONY_EXECUTOR_PROOF.json');s=p['summary'];b=p['truthBoundary'];r=p['importReceipt'];e=p['executionEvidence']
 add('proof-summary',s=={'newSignatureCount':41,'totalChainSignatureCount':162,'requiredRoleCount':16,'enrollmentPackageCount':16,'enrollmentResponseCount':16,'externalAttestationCount':0,'transferFileCount':5,'revocationApprovalCount':3},s)
 add('proof-durable-files',len(e['enrollmentWrites'])==32 and len(e['transferWrites'])==5 and len(e['importedWrites'])==5 and all(x['fileFsync'] and x['directoryFsync'] and x['rereadVerified'] for x in e['enrollmentWrites']+e['transferWrites']+e['importedWrites']),{'enrollment':len(e['enrollmentWrites']),'transfer':len(e['transferWrites']),'imported':len(e['importedWrites'])})
 add('proof-attacks',len(p['attacks'])==6 and all(p['attacks'].values()),p['attacks'])
 add('proof-receipt',r['status']=='LOCAL_EXTERNAL_CEREMONY_EXECUTION_REHEARSAL_ONLY' and r['roleCount']==16 and r['externalAttestationCount']==0 and r['exactTransferInventoryVerified'] and r['replayProtectionVerified'] and not r['externalCeremonyObserved'] and r['productionAuthority']=='NONE',r)
 add('truth-boundary',b=={'status':'LOCAL_EXTERNAL_CEREMONY_EXECUTION_REHEARSAL_ONLY','externalCeremonyObserved':False,'externalHostsObserved':0,'externalClockRootsObserved':0,'externalStoresObserved':0,'externalHumanParticipants':0,'productionAuthority':'NONE','externalEffectsExecuted':0,'g3':'blocked','productionPromotion':'blocked'},b)
except Exception as x:add('proof-readable',False,str(x))
try:
 q=load('release-evidence/v33.49/V33_49_INDEPENDENT_VERIFICATION.json');add('independent-verification',q['status']=='PASS' and q['newSignatureCount']==41 and q['totalChainSignatureCount']==162 and q['enrollmentPackageCount']==16 and q['enrollmentResponseCount']==16 and q['revocationApprovalCount']==3 and q['transferFileCount']==5 and q['finalStatus']=='LOCAL_EXTERNAL_CEREMONY_EXECUTION_REHEARSAL_ONLY' and all(q['checks'].values()),q)
except Exception as x:add('independent-verification',False,str(x))
for name,path,expected in [('focused-regression','release-evidence/v33.49/V33_49_FOCUSED_TEST_RECEIPT.json',{'testFiles':20,'tests':687}),('full-regression','release-evidence/v33.49/V33_49_FULL_TEST_RESULTS.json',{'testFiles':234,'tests':2512}),('direct-v33-regression','release-evidence/v33.49/V33_49_DIRECT_V33_RESULTS.json',{'testFiles':49,'tests':1345})]:
 try:
  d=load(path);tot=d.get('totals',{});ok=d.get('status')=='passed' and tot.get('testFiles',d.get('testFiles'))==expected['testFiles'] and tot.get('tests')==expected['tests'] and tot.get('passed')==expected['tests'] and tot.get('failed')==0;add(name,ok,tot)
 except Exception as x:add(name,False,str(x))
try:
 t=load('release-evidence/v33.49/V33_49_REPOSITORY_TRUTH_MAP.json');inv=t['inventory'];add('repository-truth-map',t['status'] in ('PASS','passed') and inv['sourceModules']==238 and inv['testFiles']==234 and inv['governanceFiles']==11 and t['findings']==[],inv)
except Exception as x:add('repository-truth-map',False,str(x))
try:
 a=load('release-evidence/v33.49/V33_49_ARCHITECTURE_INTEGRITY.json');m=a['metrics'];add('architecture-integrity',a['status']=='PASS' and m['capabilityPathCount']==174 and m['closedCapabilityPathCount']==174 and m['sourceCycleCount']==0 and m['untestedSourceCount']==0 and a['findings']==[],m)
except Exception as x:add('architecture-integrity',False,str(x))
try:
 meta=load('release-evidence/v33.49/V33_49_FULL_TEST_META.json');rows=meta['files'];bd=meta['buildDigest'];rd=meta['runInputDigest'];add('regression-input-binding',meta['exitCode']==0 and len(rows)==234 and all(r['buildDigest']==bd and r['runInputDigest']==rd and r['exitCode']==0 and not r['timedOut'] for r in rows),{'receipts':len(rows),'buildDigest':bd,'runInputDigest':rd})
except Exception as x:add('regression-input-binding',False,str(x))
try:
 p=load('package.json');l=load('package-lock.json');ct=[load(str(x.relative_to(ROOT)))['version'] for x in sorted((ROOT/'governance-state').glob('*.json'))];mt=[load(str(x.relative_to(ROOT)))['version'] for x in sorted((ROOT/'v33/governance-state').glob('*.json'))];txt=(ROOT/'package-lock.json').read_text();add('canonical-metadata',p['version']=='0.39.0' and re.search(r'v33\.49',p['description'],re.I) and l['version']=='0.39.0' and l['packages']['']['version']=='0.39.0' and len(ct)==11 and all(x=='33.49' for x in ct) and all(x=='33.49' for x in mt),{'canonical':len(ct),'mirror':len(mt)});add('offline-lockfile','registry.npmjs.org' not in txt,None)
except Exception as x:add('canonical-metadata',False,str(x))
try:
 st=load('governance-state/PROGRAM_STATE.json');na=load('governance-state/NEXT_ACTION.json');forbidden=' | '.join(na.get('forbiddenActions',[])).lower();add('governance-boundary',st.get('phase')=='External Ceremony Executor, Role Enrollment, Revocation, Sealed Evidence Transfer, and Exact Import Gate' and st.get('status')=='v33.49-external-ceremony-executor-local-rehearsal-production-blocked' and st.get('executionBoundary',{}).get('productionPromotion')=='blocked' and st.get('executionBoundary',{}).get('externalMutation')=='not-authorized',{'phase':st.get('phase'),'status':st.get('status')});add('next-action-boundary',na.get('qualificationTargetVersion')=='33.49' and all(x in forbidden for x in ['production promotion','reusing an enrollment package','reusing an import challenge','relabeling local rehearsal evidence','twenty-two external infrastructure attestations','external human participant count is zero']),na.get('actionId'))
except Exception as x:add('governance-boundary',False,str(x))
status='PASS' if all(x['ok'] for x in CHECKS) else 'FAIL';result={'version':'33.49','status':status,'checkCount':len(CHECKS),'passed':sum(x['ok'] for x in CHECKS),'failed':sum(not x['ok'] for x in CHECKS),'checks':CHECKS};OUT.mkdir(parents=True,exist_ok=True);(OUT/'V33_49_FINAL_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if status=='PASS' else 1)
