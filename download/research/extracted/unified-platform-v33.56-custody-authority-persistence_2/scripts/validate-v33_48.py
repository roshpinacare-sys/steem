#!/usr/bin/env python3
from __future__ import annotations
import json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'release-evidence/v33.48';CHECKS=[]
def load(p):return json.loads((ROOT/p).read_text())
def add(n,ok,d=None):CHECKS.append({'name':n,'ok':bool(ok),'detail':d})
required=['src/supply-chain/external-coordinator-deployment-evidence-import-v33_48.ts','tests/external-coordinator-deployment-evidence-import-v33_48.test.ts','scripts/external-coordinator-deployment-evidence-import-proof-v33_48.mjs','scripts/verify-external-coordinator-deployment-evidence-import-v33_48.mjs','scripts/run-focused-tests-v33_48.mjs','scripts/run-full-regression-v33_48.py','scripts/run-direct-v33-regression-v33_48.py','scripts/repository-truth-map-v33_48.mjs','scripts/architecture-validation-v33_48.mjs','scripts/validate-v33_48.py','docs/V33_48_EXTERNAL_COORDINATOR_DEPLOYMENT_EVIDENCE_IMPORT.md','CLAUDE_HANDOFF_v33_48.md','V33_48_עדכון_ביצוע_והוכחות.md','pilot-kits/v33.48/external-coordinator-deployment-evidence-import/manifest.json','pilot-kits/v33.48/external-coordinator-deployment-evidence-import/RUNBOOK.md','pilot-kits/v33.48/external-coordinator-deployment-evidence-import/EXTERNAL_EXECUTION_CHECKLIST.md','release-evidence/v33.48/V33_48_EXTERNAL_COORDINATOR_DEPLOYMENT_EVIDENCE_IMPORT_PROOF.json','release-evidence/v33.48/V33_48_INDEPENDENT_VERIFICATION.json','release-evidence/v33.48/V33_48_FOCUSED_TEST_RECEIPT.json','release-evidence/v33.48/V33_48_FULL_TEST_RESULTS.json','release-evidence/v33.48/V33_48_FULL_TEST_META.json','release-evidence/v33.48/V33_48_DIRECT_V33_RESULTS.json','release-evidence/v33.48/V33_48_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.48/V33_48_ARCHITECTURE_INTEGRITY.json']
add('required-artifacts',all((ROOT/p).exists() for p in required),[p for p in required if not (ROOT/p).exists()])
try:
 p=load('release-evidence/v33.48/V33_48_EXTERNAL_COORDINATOR_DEPLOYMENT_EVIDENCE_IMPORT_PROOF.json');r=p['importReceipt'];s=p['summary'];e=p['executionEvidence'];b=p['truthBoundary']
 add('proof-summary',s=={'newSignatureCount':20,'totalChainSignatureCount':121,'requiredRoleCount':16,'acceptedRoleCount':16,'inventoryFileCount':12,'infrastructureEvidenceCount':0,'externalHostsObserved':0,'externalClockRootsObserved':0,'externalStoresObserved':0},s)
 add('proof-durable-files',len(e['bundleWrites'])==12 and len(e['importedWrites'])==12 and all(x['fileFsync'] and x['directoryFsync'] and x['rereadVerified'] for x in e['bundleWrites']+e['importedWrites']),{'bundle':len(e['bundleWrites']),'imported':len(e['importedWrites'])})
 add('proof-attacks',len(p['attacks'])==6 and all(p['attacks'].values()),p['attacks'])
 add('proof-receipt',r['status']=='LOCAL_EXTERNAL_DEPLOYMENT_IMPORT_REHEARSAL_ONLY' and r['inventoryFileCount']==12 and r['infrastructureEvidenceCount']==0 and r['exactInventoryVerified'] and r['challengeReplayProtectionVerified'] and r['durableRecoveryVerified'] and r['externalTopologyObserved'] is False and r['productionAuthority']=='NONE',r)
 add('truth-boundary',b=={'status':'LOCAL_EXTERNAL_DEPLOYMENT_IMPORT_REHEARSAL_ONLY','externalTopologyObserved':False,'externalHostsObserved':0,'externalClockRootsObserved':0,'externalStoresObserved':0,'externalHumanParticipants':0,'productionAuthority':'NONE','externalEffectsExecuted':0,'g3':'blocked','productionPromotion':'blocked'},b)
except Exception as x:add('proof-readable',False,str(x))
try:
 q=load('release-evidence/v33.48/V33_48_INDEPENDENT_VERIFICATION.json');add('independent-verification',q['status']=='PASS' and q['newSignatureCount']==20 and q['totalChainSignatureCount']==121 and q['requiredRoleCount']==16 and q['acceptedRoleCount']==16 and q['inventoryFileCount']==12 and q['finalStatus']=='LOCAL_EXTERNAL_DEPLOYMENT_IMPORT_REHEARSAL_ONLY' and all(q['checks'].values()),q)
except Exception as x:add('independent-verification',False,str(x))
for name,path,expected in [('focused-regression','release-evidence/v33.48/V33_48_FOCUSED_TEST_RECEIPT.json',{'testFiles':19,'tests':652}),('full-regression','release-evidence/v33.48/V33_48_FULL_TEST_RESULTS.json',{'testFiles':233,'tests':2477}),('direct-v33-regression','release-evidence/v33.48/V33_48_DIRECT_V33_RESULTS.json',{'testFiles':48,'tests':1310})]:
 try:
  d=load(path);tot=d.get('totals',{});ok=d.get('status')=='passed' and tot.get('testFiles',d.get('testFiles'))==expected['testFiles'] and tot.get('tests')==expected['tests'] and tot.get('passed')==expected['tests'] and tot.get('failed')==0
  add(name,ok,tot)
 except Exception as x:add(name,False,str(x))
try:
 t=load('release-evidence/v33.48/V33_48_REPOSITORY_TRUTH_MAP.json');inv=t['inventory'];add('repository-truth-map',t['status'] in ('PASS','passed') and inv['sourceModules']==237 and inv['testFiles']==233 and inv['governanceFiles']==11 and t['findings']==[],inv)
except Exception as x:add('repository-truth-map',False,str(x))
try:
 a=load('release-evidence/v33.48/V33_48_ARCHITECTURE_INTEGRITY.json');m=a['metrics'];add('architecture-integrity',a['status']=='PASS' and m['capabilityPathCount']==173 and m['closedCapabilityPathCount']==173 and m['sourceCycleCount']==0 and m['untestedSourceCount']==0 and a['findings']==[],m)
except Exception as x:add('architecture-integrity',False,str(x))
try:
 meta=load('release-evidence/v33.48/V33_48_FULL_TEST_META.json');rows=meta['files'];bd=meta['buildDigest'];rd=meta['runInputDigest'];add('regression-input-binding',meta['exitCode']==0 and len(rows)==233 and all(r['buildDigest']==bd and r['runInputDigest']==rd and r['exitCode']==0 and not r['timedOut'] for r in rows),{'receipts':len(rows),'buildDigest':bd,'runInputDigest':rd})
except Exception as x:add('regression-input-binding',False,str(x))
try:
 p=load('package.json');l=load('package-lock.json');ct=[load(str(x.relative_to(ROOT)))['version'] for x in sorted((ROOT/'governance-state').glob('*.json'))];mt=[load(str(x.relative_to(ROOT)))['version'] for x in sorted((ROOT/'v33/governance-state').glob('*.json'))];txt=(ROOT/'package-lock.json').read_text();add('canonical-metadata',p['version']=='0.38.0' and re.search(r'v33\.48',p['description'],re.I) and l['version']=='0.38.0' and l['packages']['']['version']=='0.38.0' and len(ct)==11 and all(x=='33.48' for x in ct) and all(x=='33.48' for x in mt),{'canonical':len(ct),'mirror':len(mt)});add('offline-lockfile','registry.npmjs.org' not in txt,None)
except Exception as x:add('canonical-metadata',False,str(x))
try:
 st=load('governance-state/PROGRAM_STATE.json');na=load('governance-state/NEXT_ACTION.json');forbidden=' | '.join(na.get('forbiddenActions',[])).lower();add('governance-boundary',st.get('phase')=='External Coordinator Deployment Kit, Exact Evidence Import, Durable Store Recovery, and External Qualification Gate' and st.get('status')=='v33.48-external-coordinator-deployment-import-local-rehearsal-production-blocked' and st.get('executionBoundary',{}).get('productionPromotion')=='blocked' and st.get('executionBoundary',{}).get('externalMutation')=='not-authorized',{'phase':st.get('phase'),'status':st.get('status')});add('next-action-boundary',na.get('qualificationTargetVersion')=='33.48' and all(x in forbidden for x in ['production promotion','reusing an import challenge','relabeling local rehearsal evidence','two auditors','external human participant count is zero']),na.get('actionId'))
except Exception as x:add('governance-boundary',False,str(x))
status='PASS' if all(x['ok'] for x in CHECKS) else 'FAIL';result={'version':'33.48','status':status,'checkCount':len(CHECKS),'passed':sum(x['ok'] for x in CHECKS),'failed':sum(not x['ok'] for x in CHECKS),'checks':CHECKS};OUT.mkdir(parents=True,exist_ok=True);(OUT/'V33_48_FINAL_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if status=='PASS' else 1)
