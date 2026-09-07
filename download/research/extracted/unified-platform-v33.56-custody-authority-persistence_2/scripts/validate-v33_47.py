#!/usr/bin/env python3
from __future__ import annotations
import json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'release-evidence/v33.47';CHECKS=[]
def load(p):return json.loads((ROOT/p).read_text())
def add(n,ok,d=None):CHECKS.append({'name':n,'ok':bool(ok),'detail':d})
required=['src/supply-chain/external-coordinator-journal-qualification-v33_47.ts','tests/external-coordinator-journal-qualification-v33_47.test.ts','scripts/v33_47-replica-worker.mjs','scripts/external-coordinator-journal-qualification-proof-v33_47.mjs','scripts/verify-external-coordinator-journal-qualification-v33_47.mjs','scripts/run-focused-tests-v33_47.mjs','scripts/run-full-regression-v33_47.py','scripts/run-direct-v33-regression-v33_47.py','scripts/repository-truth-map-v33_47.mjs','scripts/architecture-validation-v33_47.mjs','scripts/validate-v33_47.py','docs/V33_47_EXTERNAL_COORDINATOR_JOURNAL_QUALIFICATION.md','CLAUDE_HANDOFF_v33_47.md','V33_47_עדכון_ביצוע_והוכחות.md','pilot-kits/v33.47/external-coordinator-journal-qualification/manifest.json','pilot-kits/v33.47/external-coordinator-journal-qualification/RUNBOOK.md','release-evidence/v33.47/V33_47_EXTERNAL_COORDINATOR_JOURNAL_QUALIFICATION_PROOF.json','release-evidence/v33.47/V33_47_INDEPENDENT_VERIFICATION.json','release-evidence/v33.47/V33_47_FOCUSED_TEST_RECEIPT.json','release-evidence/v33.47/V33_47_FULL_TEST_RESULTS.json','release-evidence/v33.47/V33_47_FULL_TEST_META.json','release-evidence/v33.47/V33_47_DIRECT_V33_RESULTS.json','release-evidence/v33.47/V33_47_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.47/V33_47_ARCHITECTURE_INTEGRITY.json']
add('required-artifacts',all((ROOT/p).exists() for p in required),[p for p in required if not (ROOT/p).exists()])
try:
 p=load('release-evidence/v33.47/V33_47_EXTERNAL_COORDINATOR_JOURNAL_QUALIFICATION_PROOF.json');v=p['finalVerdict'];s=p['summary'];e=p['executionEvidence'];b=p['truthBoundary']
 add('proof-summary',s=={'newSignatureCount':18,'totalChainSignatureCount':101,'distinctReplicaProcessCount':7,'initialReplicaCount':3,'postFailoverReplicaCount':3,'partitionObservationCount':2,'siteRecoveryCount':1},s)
 allruns=e['initialReplicas']+e['postFailoverReplicas']+[e['recovery']]
 add('proof-processes',len({x['pid'] for x in allruns})==7 and all(x['fileFsync'] and x['directoryFsync'] for x in allruns),allruns)
 add('proof-bytes',all(x['sha256']==e['journalBytes']['sha256'] and x['byteLength']==e['journalBytes']['byteLength'] for x in allruns),e['journalBytes'])
 add('proof-attacks',len(p['attacks'])==6 and all(p['attacks'].values()),p['attacks'])
 add('proof-verdict',v['status']=='LOCAL_COORDINATOR_JOURNAL_QUALIFICATION_REHEARSAL_ONLY' and v['initialReplicaCount']==3 and v['postFailoverReplicaCount']==3 and v['distinctReplicaProcessesObserved'] is True and v['independentClockQuorumVerified'] is True and v['partitionFailoverVerified'] is True and v['irreversibleFencingVerified'] is True and v['appendOnlyReplicationVerified'] is True and v['siteLossRecoveryVerified'] is True and v['externalTopologyObserved'] is False,v)
 add('truth-boundary',b=={'externalTopologyObserved':False,'externalCoordinatorHostsObserved':False,'externalClockRootsObserved':False,'externalHumanParticipants':0,'productionAuthority':'NONE','externalEffectsExecuted':0} and v['productionAuthority']=='NONE' and v['externalEffectsExecuted']==0,b)
except Exception as x:add('proof-readable',False,str(x))
try:
 q=load('release-evidence/v33.47/V33_47_INDEPENDENT_VERIFICATION.json');add('independent-verification',q['status']=='PASS' and q['newSignatureCount']==18 and q['totalChainSignatureCount']==101 and q['distinctReplicaProcessCount']==7 and q['finalStatus']=='LOCAL_COORDINATOR_JOURNAL_QUALIFICATION_REHEARSAL_ONLY' and all(q['checks'].values()),q)
except Exception as x:add('independent-verification',False,str(x))
for name,path,expected in [('focused-regression','release-evidence/v33.47/V33_47_FOCUSED_TEST_RECEIPT.json',{'testFiles':18,'tests':614}),('full-regression','release-evidence/v33.47/V33_47_FULL_TEST_RESULTS.json',{'testFiles':232,'tests':2439}),('direct-v33-regression','release-evidence/v33.47/V33_47_DIRECT_V33_RESULTS.json',{'testFiles':47,'tests':1272})]:
 try:
  d=load(path);tot=d.get('totals',{});ok=d.get('status')=='passed' and tot.get('testFiles',d.get('testFiles'))==expected['testFiles'] and tot.get('tests')==expected['tests'] and tot.get('passed')==expected['tests'] and tot.get('failed')==0
  add(name,ok,tot)
 except Exception as x:add(name,False,str(x))
try:
 t=load('release-evidence/v33.47/V33_47_REPOSITORY_TRUTH_MAP.json');inv=t['inventory'];add('repository-truth-map',t['status'] in ('PASS','passed') and inv['sourceModules']==236 and inv['testFiles']==232 and inv['governanceFiles']==11 and t['findings']==[],inv)
except Exception as x:add('repository-truth-map',False,str(x))
try:
 a=load('release-evidence/v33.47/V33_47_ARCHITECTURE_INTEGRITY.json');m=a['metrics'];add('architecture-integrity',a['status']=='PASS' and m['capabilityPathCount']==172 and m['closedCapabilityPathCount']==172 and m['sourceCycleCount']==0 and m['untestedSourceCount']==0 and a['findings']==[],m)
except Exception as x:add('architecture-integrity',False,str(x))
try:
 meta=load('release-evidence/v33.47/V33_47_FULL_TEST_META.json');rows=meta['files'];bd=meta['buildDigest'];rd=meta['runInputDigest'];add('regression-input-binding',meta['exitCode']==0 and len(rows)==232 and all(r['buildDigest']==bd and r['runInputDigest']==rd and r['exitCode']==0 and not r['timedOut'] for r in rows),{'receipts':len(rows),'buildDigest':bd,'runInputDigest':rd})
except Exception as x:add('regression-input-binding',False,str(x))
try:
 p=load('package.json');l=load('package-lock.json');ct=[load(str(x.relative_to(ROOT)))['version'] for x in sorted((ROOT/'governance-state').glob('*.json'))];mt=[load(str(x.relative_to(ROOT)))['version'] for x in sorted((ROOT/'v33/governance-state').glob('*.json'))];txt=(ROOT/'package-lock.json').read_text();add('canonical-metadata',p['version']=='0.37.0' and re.search(r'v33\.47',p['description'],re.I) and l['version']=='0.37.0' and l['packages']['']['version']=='0.37.0' and len(ct)==11 and all(x=='33.47' for x in ct) and all(x=='33.47' for x in mt),{'canonical':len(ct),'mirror':len(mt)});add('offline-lockfile','registry.npmjs.org' not in txt,None)
except Exception as x:add('canonical-metadata',False,str(x))
status='PASS' if all(x['ok'] for x in CHECKS) else 'FAIL';r={'version':'33.47','status':status,'checkCount':len(CHECKS),'passed':sum(x['ok'] for x in CHECKS),'failed':sum(not x['ok'] for x in CHECKS),'checks':CHECKS};OUT.mkdir(parents=True,exist_ok=True);(OUT/'V33_47_FINAL_VALIDATION.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2));sys.exit(0 if status=='PASS' else 1)
