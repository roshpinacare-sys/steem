#!/usr/bin/env python3
from __future__ import annotations
import json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'release-evidence/v33.50';CHECKS=[]
def load(p):return json.loads((ROOT/p).read_text())
def add(n,ok,d=None):CHECKS.append({'name':n,'ok':bool(ok),'detail':d})
required=['src/supply-chain/ceremony-evidence-intake-portal-v33_50.ts','tests/ceremony-evidence-intake-portal-v33_50.test.ts','scripts/ceremony-evidence-intake-portal-proof-v33_50.mjs','scripts/verify-ceremony-evidence-intake-portal-v33_50.mjs','scripts/run-focused-tests-v33_50.mjs','scripts/run-full-regression-v33_50.py','scripts/run-direct-v33-regression-v33_50.py','scripts/repository-truth-map-v33_50.mjs','scripts/architecture-validation-v33_50.mjs','scripts/validate-v33_50.py','docs/V33_50_CEREMONY_EVIDENCE_INTAKE_PORTAL.md','CLAUDE_HANDOFF_v33_50.md','V33_50_עדכון_ביצוע_והוכחות.md','pilot-kits/v33.50/ceremony-evidence-intake-portal/manifest.json','pilot-kits/v33.50/ceremony-evidence-intake-portal/RUNBOOK.md','pilot-kits/v33.50/ceremony-evidence-intake-portal/EXTERNAL_EXECUTION_CHECKLIST.md','release-evidence/v33.50/V33_50_CEREMONY_EVIDENCE_INTAKE_PORTAL_PROOF.json','release-evidence/v33.50/V33_50_INDEPENDENT_VERIFICATION.json','release-evidence/v33.50/V33_50_FOCUSED_TEST_RECEIPT.json','release-evidence/v33.50/V33_50_FULL_TEST_RESULTS.json','release-evidence/v33.50/V33_50_FULL_TEST_META.json','release-evidence/v33.50/V33_50_DIRECT_V33_RESULTS.json','release-evidence/v33.50/V33_50_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.50/V33_50_ARCHITECTURE_INTEGRITY.json']
add('required-artifacts',all((ROOT/p).exists() for p in required),[p for p in required if not (ROOT/p).exists()])
try:
 p=load('release-evidence/v33.50/V33_50_CEREMONY_EVIDENCE_INTAKE_PORTAL_PROOF.json');s=p['summary'];b=p['truthBoundary'];v=p['verdict'];e=p['executionEvidence']
 add('proof-summary',s=={'newSignatureCount':70,'totalChainSignatureCount':232,'roleCount':16,'channelCount':16,'submissionCount':16,'scanCount':16,'receiptCount':16,'replacementApprovalCount':3,'replacementCertificateCount':1,'externalAttestationCount':0,'externallyQualifiedScanCount':0,'durableWriteCount':82},s)
 add('proof-durable-files',e['roleDirectoryCount']==16 and e['quarantinedFileCount']==16 and len(e['durableWrites'])==82 and all(x['fileFsync'] and x['directoryFsync'] and x['rereadVerified'] for x in e['durableWrites']),{'writes':len(e['durableWrites'])})
 add('proof-attacks',len(p['attacks'])==7 and all(p['attacks'].values()),p['attacks'])
 add('proof-verdict',v['payload']['status']=='LOCAL_CEREMONY_INTAKE_COMPLETE_REHEARSAL_ONLY' and v['payload']['roleCount']==16 and v['payload']['externalAttestationCount']==0 and v['payload']['externallyQualifiedScanCount']==0 and not v['payload']['externalCeremonyObserved'] and v['payload']['productionAuthority']=='NONE',v['payload'])
 add('truth-boundary',b=={'status':'LOCAL_CEREMONY_EVIDENCE_INTAKE_REHEARSAL_ONLY','externalCeremonyObserved':False,'externalHostsObserved':0,'externalClockRootsObserved':0,'externalStoresObserved':0,'externalInfrastructureAttestations':0,'externalHumanParticipants':0,'productionAuthority':'NONE','externalEffectsExecuted':0,'g3':'blocked','productionPromotion':'blocked'},b)
except Exception as x:add('proof-readable',False,str(x))
try:
 q=load('release-evidence/v33.50/V33_50_INDEPENDENT_VERIFICATION.json');add('independent-verification',q['status']=='PASS' and q['newSignatureCount']==70 and q['totalChainSignatureCount']==232 and q['roleCount']==16 and q['channelCount']==16 and q['quarantineReceiptCount']==16 and q['replacementApprovalCount']==3 and q['durableWriteCount']==82 and q['finalStatus']=='LOCAL_CEREMONY_INTAKE_COMPLETE_REHEARSAL_ONLY' and all(q['checks'].values()),q)
except Exception as x:add('independent-verification',False,str(x))
for name,path,expected in [('focused-regression','release-evidence/v33.50/V33_50_FOCUSED_TEST_RECEIPT.json',{'testFiles':21,'tests':724}),('full-regression','release-evidence/v33.50/V33_50_FULL_TEST_RESULTS.json',{'testFiles':235,'tests':2549}),('direct-v33-regression','release-evidence/v33.50/V33_50_DIRECT_V33_RESULTS.json',{'testFiles':50,'tests':1382})]:
 try:
  d=load(path);tot=d.get('totals',{});ok=d.get('status')=='passed' and tot.get('testFiles',d.get('testFiles'))==expected['testFiles'] and tot.get('tests')==expected['tests'] and tot.get('passed')==expected['tests'] and tot.get('failed')==0;add(name,ok,tot)
 except Exception as x:add(name,False,str(x))
try:
 t=load('release-evidence/v33.50/V33_50_REPOSITORY_TRUTH_MAP.json');inv=t['inventory'];add('repository-truth-map',t['status'] in ('PASS','passed') and inv['sourceModules']==239 and inv['testFiles']==235 and inv['governanceFiles']==11 and t['findings']==[],inv)
except Exception as x:add('repository-truth-map',False,str(x))
try:
 a=load('release-evidence/v33.50/V33_50_ARCHITECTURE_INTEGRITY.json');m=a['metrics'];add('architecture-integrity',a['status']=='PASS' and m['capabilityPathCount']==175 and m['closedCapabilityPathCount']==175 and m['sourceCycleCount']==0 and m['untestedSourceCount']==0 and a['findings']==[],m)
except Exception as x:add('architecture-integrity',False,str(x))
try:
 meta=load('release-evidence/v33.50/V33_50_FULL_TEST_META.json');rows=meta['files'];bd=meta['buildDigest'];rd=meta['runInputDigest'];add('regression-input-binding',meta['exitCode']==0 and len(rows)==235 and all(r['buildDigest']==bd and r['runInputDigest']==rd and r['exitCode']==0 and not r['timedOut'] for r in rows),{'receipts':len(rows),'buildDigest':bd,'runInputDigest':rd})
except Exception as x:add('regression-input-binding',False,str(x))
try:
 p=load('package.json');l=load('package-lock.json');ct=[load(str(x.relative_to(ROOT)))['version'] for x in sorted((ROOT/'governance-state').glob('*.json'))];mt=[load(str(x.relative_to(ROOT)))['version'] for x in sorted((ROOT/'v33/governance-state').glob('*.json'))];txt=(ROOT/'package-lock.json').read_text();add('canonical-metadata',p['version']=='0.40.0' and re.search(r'v33\.50',p['description'],re.I) and l['version']=='0.40.0' and l['packages']['']['version']=='0.40.0' and len(ct)==11 and all(x=='33.50' for x in ct) and all(x=='33.50' for x in mt),{'canonical':len(ct),'mirror':len(mt)});add('offline-lockfile','registry.npmjs.org' not in txt,None)
except Exception as x:add('canonical-metadata',False,str(x))
try:
 st=load('governance-state/PROGRAM_STATE.json');na=load('governance-state/NEXT_ACTION.json');forbidden=' | '.join(na.get('forbiddenActions',[])).lower();add('governance-boundary',st.get('phase')=='Ceremony Evidence Intake Portal, Mutual Authentication, Quarantine, Replacement, and Readiness Gate' and st.get('status')=='v33.50-ceremony-evidence-intake-local-rehearsal-production-blocked' and st.get('executionBoundary',{}).get('productionPromotion')=='blocked' and st.get('executionBoundary',{}).get('externalMutation')=='not-authorized',{'phase':st.get('phase'),'status':st.get('status')});add('next-action-boundary',na.get('qualificationTargetVersion')=='33.50' and all(x in forbidden for x in ['production promotion','reusing a mutual-authentication channel','accepting malware','outside the authority-signed roster','externally qualified','fewer than twenty-two trusted infrastructure attestations','external human participant count is zero']),na.get('actionId'))
except Exception as x:add('governance-boundary',False,str(x))
status='PASS' if all(x['ok'] for x in CHECKS) else 'FAIL';result={'version':'33.50','status':status,'checkCount':len(CHECKS),'passed':sum(x['ok'] for x in CHECKS),'failed':sum(not x['ok'] for x in CHECKS),'checks':CHECKS};OUT.mkdir(parents=True,exist_ok=True);(OUT/'V33_50_FINAL_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if status=='PASS' else 1)
