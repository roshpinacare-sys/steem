#!/usr/bin/env python3
from __future__ import annotations
import json, re, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'release-evidence/v33.46';CHECKS=[]
def load(p):return json.loads((ROOT/p).read_text())
def add(n,ok,d=None):CHECKS.append({'name':n,'ok':bool(ok),'detail':d})
required=['src/supply-chain/durable-transaction-coordinator-v33_46.ts','tests/durable-transaction-coordinator-v33_46.test.ts','scripts/v33_46-coordinator-process-worker.mjs','scripts/durable-transaction-coordinator-proof-v33_46.mjs','scripts/verify-durable-transaction-coordinator-v33_46.mjs','scripts/run-focused-tests-v33_46.mjs','scripts/run-full-regression-v33_46.py','scripts/run-direct-v33-regression-v33_46.py','scripts/repository-truth-map-v33_46.mjs','scripts/architecture-validation-v33_46.mjs','scripts/validate-v33_46.py','docs/V33_46_DURABLE_TRANSACTION_COORDINATOR.md','CLAUDE_HANDOFF_v33_46.md','V33_46_עדכון_ביצוע_והוכחות.md','pilot-kits/v33.46/durable-transaction-coordinator/manifest.json','pilot-kits/v33.46/durable-transaction-coordinator/RUNBOOK.md','release-evidence/v33.46/V33_46_DURABLE_TRANSACTION_COORDINATOR_PROOF.json','release-evidence/v33.46/V33_46_INDEPENDENT_VERIFICATION.json','release-evidence/v33.46/V33_46_FOCUSED_TEST_RECEIPT.json','release-evidence/v33.46/V33_46_FULL_TEST_RESULTS.json','release-evidence/v33.46/V33_46_FULL_TEST_META.json','release-evidence/v33.46/V33_46_DIRECT_V33_RESULTS.json','release-evidence/v33.46/V33_46_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.46/V33_46_ARCHITECTURE_INTEGRITY.json']
add('required-artifacts',all((ROOT/p).exists() for p in required),[p for p in required if not (ROOT/p).exists()])
try:
 p=load('release-evidence/v33.46/V33_46_DURABLE_TRANSACTION_COORDINATOR_PROOF.json');v=p['finalVerdict'];s=p['summary'];e=p['executionEvidence'];b=p['truthBoundary']
 add('proof-summary',s=={'newSignatureCount':25,'totalChainSignatureCount':83,'journalEntryCount':9,'takeoverCount':2,'replayReceiptCount':2,'recoveryCount':2,'distinctCoordinatorProcessCount':3},s)
 add('proof-processes',e['distinctProcessCount']==3 and len({x['pid'] for x in e['coordinatorProcesses']})==3 and len({x['term'] for x in e['coordinatorProcesses']})==3,e['coordinatorProcesses'])
 add('proof-durability',e['journal']['fileFsync'] is True and e['journal']['directoryFsync'] is True and e['journal']['sha256']==e['journal']['rereadSha256'],e['journal'])
 add('proof-attacks',len(p['attacks'])==7 and all(p['attacks'].values()),p['attacks'])
 add('proof-verdict',v['status']=='LOCAL_DURABLE_TRANSACTION_COORDINATOR_FAILOVER_PROVEN' and v['journalEntryCount']==9 and v['takeoverCount']==2 and v['replayReceiptCount']==2 and v['crashRecoveryCount']==2 and v['monotonicJournalProven'] is True and v['irreversibleFencingProven'] is True and v['idempotentReplayProven'] is True and v['timeoutCompensationProven'] is True and v['multiProcessFailoverProven'] is True and v['updatePromoted'] is False,v)
 add('truth-boundary',b=={'externalCoordinatorHostsObserved':False,'externalHumanParticipants':0,'productionAuthority':'NONE','externalEffectsExecuted':0} and v['productionAuthority']=='NONE' and v['externalEffectsExecuted']==0,b)
except Exception as x:add('proof-readable',False,str(x))
try:
 q=load('release-evidence/v33.46/V33_46_INDEPENDENT_VERIFICATION.json');add('independent-verification',q['status']=='PASS' and q['newSignatureCount']==25 and q['totalChainSignatureCount']==83 and q['distinctCoordinatorProcessCount']==3 and q['finalStatus']=='LOCAL_DURABLE_TRANSACTION_COORDINATOR_FAILOVER_PROVEN' and all(q['checks'].values()),q)
except Exception as x:add('independent-verification',False,str(x))
for name,path,expected in [('focused-regression','release-evidence/v33.46/V33_46_FOCUSED_TEST_RECEIPT.json',{'testFiles':17,'tests':581}),('full-regression','release-evidence/v33.46/V33_46_FULL_TEST_RESULTS.json',{'testFiles':231,'tests':2406}),('direct-v33-regression','release-evidence/v33.46/V33_46_DIRECT_V33_RESULTS.json',{'testFiles':46,'tests':1239})]:
 try:
  d=load(path);tot=d.get('totals',{});ok=d.get('status')=='passed' and tot.get('testFiles',d.get('testFiles'))==expected['testFiles'] and tot.get('tests')==expected['tests'] and tot.get('passed')==expected['tests'] and tot.get('failed')==0
  add(name,ok,tot)
 except Exception as x:add(name,False,str(x))
try:
 t=load('release-evidence/v33.46/V33_46_REPOSITORY_TRUTH_MAP.json');inv=t['inventory'];add('repository-truth-map',t['status'] in ('PASS','passed') and inv['sourceModules']==235 and inv['testFiles']==231 and inv['governanceFiles']==11 and t['findings']==[],inv)
except Exception as x:add('repository-truth-map',False,str(x))
try:
 a=load('release-evidence/v33.46/V33_46_ARCHITECTURE_INTEGRITY.json');m=a['metrics'];add('architecture-integrity',a['status']=='PASS' and m['capabilityPathCount']==171 and m['closedCapabilityPathCount']==171 and m['sourceCycleCount']==0 and m['untestedSourceCount']==0 and a['findings']==[],m)
except Exception as x:add('architecture-integrity',False,str(x))
try:
 meta=load('release-evidence/v33.46/V33_46_FULL_TEST_META.json');rows=meta['files'];bd=meta['buildDigest'];rd=meta['runInputDigest'];add('regression-input-binding',meta['exitCode']==0 and len(rows)==231 and all(r['buildDigest']==bd and r['runInputDigest']==rd and r['exitCode']==0 and not r['timedOut'] for r in rows),{'receipts':len(rows),'buildDigest':bd,'runInputDigest':rd})
except Exception as x:add('regression-input-binding',False,str(x))
try:
 p=load('package.json');l=load('package-lock.json');ct=[load(str(x.relative_to(ROOT)))['version'] for x in sorted((ROOT/'governance-state').glob('*.json'))];mt=[load(str(x.relative_to(ROOT)))['version'] for x in sorted((ROOT/'v33/governance-state').glob('*.json'))];txt=(ROOT/'package-lock.json').read_text();add('canonical-metadata',p['version']=='0.36.0' and re.search(r'v33\.46',p['description'],re.I) and l['version']=='0.36.0' and l['packages']['']['version']=='0.36.0' and len(ct)==11 and all(x=='33.46' for x in ct) and all(x=='33.46' for x in mt),{'canonical':len(ct),'mirror':len(mt)});add('offline-lockfile','registry.npmjs.org' not in txt,None)
except Exception as x:add('canonical-metadata',False,str(x))
status='PASS' if all(x['ok'] for x in CHECKS) else 'FAIL';r={'version':'33.46','status':status,'checkCount':len(CHECKS),'passed':sum(x['ok'] for x in CHECKS),'failed':sum(not x['ok'] for x in CHECKS),'checks':CHECKS};OUT.mkdir(parents=True,exist_ok=True);(OUT/'V33_46_FINAL_VALIDATION.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2));sys.exit(0 if status=='PASS' else 1)
