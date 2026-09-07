#!/usr/bin/env python3
from __future__ import annotations
import json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'release-evidence/v33.51';CHECKS=[]
def load(p):return json.loads((ROOT/p).read_text())
def add(n,ok,d=None):CHECKS.append({'name':n,'ok':bool(ok),'detail':d})
required=['src/supply-chain/evidence-intake-operations-plane-v33_51.ts','tests/evidence-intake-operations-plane-v33_51.test.ts','scripts/evidence-intake-operations-plane-proof-v33_51.mjs','scripts/verify-evidence-intake-operations-plane-v33_51.mjs','scripts/run-focused-tests-v33_51.mjs','scripts/run-full-regression-v33_51.py','scripts/run-direct-v33-regression-v33_51.py','scripts/repository-truth-map-v33_51.mjs','scripts/architecture-validation-v33_51.mjs','scripts/validate-v33_51.py','docs/V33_51_EVIDENCE_INTAKE_OPERATIONS_PLANE.md','CLAUDE_HANDOFF_v33_51.md','V33_51_עדכון_ביצוע_והוכחות.md','pilot-kits/v33.51/evidence-intake-operations-plane/manifest.json','pilot-kits/v33.51/evidence-intake-operations-plane/RUNBOOK.md','pilot-kits/v33.51/evidence-intake-operations-plane/EXTERNAL_EXECUTION_CHECKLIST.md','release-evidence/v33.51/V33_51_EVIDENCE_INTAKE_OPERATIONS_PLANE_PROOF.json','release-evidence/v33.51/V33_51_INDEPENDENT_VERIFICATION.json','release-evidence/v33.51/V33_51_FOCUSED_TEST_RECEIPT.json','release-evidence/v33.51/V33_51_FULL_TEST_RESULTS.json','release-evidence/v33.51/V33_51_FULL_TEST_META.json','release-evidence/v33.51/V33_51_DIRECT_V33_RESULTS.json','release-evidence/v33.51/V33_51_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.51/V33_51_ARCHITECTURE_INTEGRITY.json']
add('required-artifacts',all((ROOT/p).exists() for p in required),[p for p in required if not (ROOT/p).exists()])
try:
 p=load('release-evidence/v33.51/V33_51_EVIDENCE_INTAKE_OPERATIONS_PLANE_PROOF.json');s=p['summary'];b=p['truthBoundary'];c=p['certificate']['payload'];e=p['executionEvidence']
 add('proof-summary',s['newSignatureCount']==73 and s['totalChainSignatureCount']==305 and s['ticketCount']==16 and s['reviewDecisionCount']==33 and s['approvalCount']==16 and s['disputeCount']==1 and s['resubmissionCount']==1 and s['snapshotCount']==4 and s['durableWriteCount']==73 and s['finalAcceptedRoleCount']==16 and s['externalAttestationCount']==0,s)
 add('proof-durable-files',len(e['durableWrites'])==73 and all(x['fsync'] and x['directoryFsync'] and x['readBackVerified'] for x in e['durableWrites']),{'writes':len(e['durableWrites'])})
 add('proof-attacks',len(p['attacks'])==8 and all(p['attacks'].values()),p['attacks'])
 add('proof-certificate',c['status']=='LOCAL_OPERATIONS_COMPLETE_REHEARSAL_ONLY' and c['roleCount']==16 and c['externalAttestationCount']==0 and not c['externalCeremonyObserved'] and c['productionAuthority']=='NONE' and c['externalEffectsExecuted']==0,c)
 add('truth-boundary',b=={'status':'LOCAL_EVIDENCE_INTAKE_OPERATIONS_REHEARSAL_ONLY','externalCeremonyObserved':False,'externalInfrastructureAttestations':0,'externalHumanParticipants':0,'productionAuthority':'NONE','externalEffectsExecuted':0,'g3':'BLOCKED','productionPromotion':'BLOCKED'},b)
except Exception as x:add('proof-readable',False,str(x))
try:
 q=load('release-evidence/v33.51/V33_51_INDEPENDENT_VERIFICATION.json');add('independent-verification',q['status']=='PASS' and q['baseV3350Verified'] and q['newSignatureCount']==73 and q['totalChainSignatureCount']==305 and q['ticketCount']==16 and q['dualControlApprovalCount']==16 and q['snapshotCount']==4 and q['durableWriteCount']==73 and q['verdict']=='LOCAL_OPERATIONS_COMPLETE_REHEARSAL_ONLY',q)
except Exception as x:add('independent-verification',False,str(x))
for name,path,expected in [('focused-regression','release-evidence/v33.51/V33_51_FOCUSED_TEST_RECEIPT.json',{'testFiles':22,'tests':761}),('full-regression','release-evidence/v33.51/V33_51_FULL_TEST_RESULTS.json',{'testFiles':236,'tests':2586}),('direct-v33-regression','release-evidence/v33.51/V33_51_DIRECT_V33_RESULTS.json',{'testFiles':51,'tests':1419})]:
 try:
  d=load(path);tot=d.get('totals',{});ok=d.get('status')=='passed' and tot.get('testFiles',d.get('testFiles'))==expected['testFiles'] and tot.get('tests')==expected['tests'] and tot.get('passed')==expected['tests'] and tot.get('failed')==0;add(name,ok,tot)
 except Exception as x:add(name,False,str(x))
try:
 t=load('release-evidence/v33.51/V33_51_REPOSITORY_TRUTH_MAP.json');inv=t['inventory'];add('repository-truth-map',t['status'] in ('PASS','passed') and inv['sourceModules']==240 and inv['testFiles']==236 and inv['governanceFiles']==11 and t['findings']==[],inv)
except Exception as x:add('repository-truth-map',False,str(x))
try:
 a=load('release-evidence/v33.51/V33_51_ARCHITECTURE_INTEGRITY.json');m=a['metrics'];add('architecture-integrity',a['status']=='PASS' and m['capabilityPathCount']==176 and m['closedCapabilityPathCount']==176 and m['sourceCycleCount']==0 and m['untestedSourceCount']==0 and a['findings']==[],m)
except Exception as x:add('architecture-integrity',False,str(x))
try:
 meta=load('release-evidence/v33.51/V33_51_FULL_TEST_META.json');rows=meta['files'];bd=meta['buildDigest'];rd=meta['runInputDigest'];add('regression-input-binding',meta['exitCode']==0 and len(rows)==236 and all(r['buildDigest']==bd and r['runInputDigest']==rd and r['exitCode']==0 and not r['timedOut'] for r in rows),{'receipts':len(rows),'buildDigest':bd,'runInputDigest':rd})
except Exception as x:add('regression-input-binding',False,str(x))
try:
 p=load('package.json');l=load('package-lock.json');ct=[load(str(x.relative_to(ROOT)))['version'] for x in sorted((ROOT/'governance-state').glob('*.json'))];mt=[load(str(x.relative_to(ROOT)))['version'] for x in sorted((ROOT/'v33/governance-state').glob('*.json'))];txt=(ROOT/'package-lock.json').read_text();add('canonical-metadata',p['version']=='0.41.0' and re.search(r'v33\.51',p['description'],re.I) and l['version']=='0.41.0' and l['packages']['']['version']=='0.41.0' and len(ct)==11 and all(x=='33.51' for x in ct) and all(x=='33.51' for x in mt),{'canonical':len(ct),'mirror':len(mt)});add('offline-lockfile','registry.npmjs.org' not in txt,None)
except Exception as x:add('canonical-metadata',False,str(x))
try:
 st=load('governance-state/PROGRAM_STATE.json');na=load('governance-state/NEXT_ACTION.json');forbidden=' | '.join(na.get('forbiddenActions',[])).lower();add('governance-boundary',st.get('phase')=='Evidence Intake Operations Plane, SLA, Dual-Control Review, Dispute, Resubmission, and Quorum Progression' and st.get('status')=='v33.51-evidence-intake-operations-local-rehearsal-production-blocked' and st.get('executionBoundary',{}).get('productionPromotion')=='blocked' and st.get('executionBoundary',{}).get('externalMutation')=='not-authorized',{'phase':st.get('phase'),'status':st.get('status')});add('next-action-boundary',na.get('qualificationTargetVersion')=='33.51' and all(x in forbidden for x in ['production promotion','single-reviewer approval','overwriting disputed evidence','skipping a quorum progression sequence','twenty-two trusted attestations','untrusted host execution','external human participant count is zero']),na.get('actionId'))
except Exception as x:add('governance-boundary',False,str(x))
status='PASS' if all(x['ok'] for x in CHECKS) else 'FAIL';result={'version':'33.51','status':status,'checkCount':len(CHECKS),'passed':sum(x['ok'] for x in CHECKS),'failed':sum(not x['ok'] for x in CHECKS),'checks':CHECKS};OUT.mkdir(parents=True,exist_ok=True);(OUT/'V33_51_FINAL_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if status=='PASS' else 1)
