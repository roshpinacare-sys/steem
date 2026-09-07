#!/usr/bin/env python3
from __future__ import annotations
import json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'release-evidence/v33.55';CHECKS=[]
def load(p):return json.loads((ROOT/p).read_text())
def add(n,ok,d=None):CHECKS.append({'name':n,'ok':bool(ok),'detail':d})
required=['src/supply-chain/external-evidence-custody-transport-v33_55.ts','tests/external-evidence-custody-transport-v33_55.test.ts','scripts/custody-crypto-worker-v33_55.mjs','scripts/external-evidence-custody-transport-proof-v33_55.mjs','scripts/verify-external-evidence-custody-transport-v33_55.mjs','scripts/run-focused-tests-v33_55.mjs','scripts/run-full-regression-v33_55.py','scripts/run-direct-v33-regression-v33_55.py','scripts/repository-truth-map-v33_55.mjs','scripts/architecture-validation-v33_55.mjs','scripts/validate-v33_55.py','docs/V33_55_EXTERNAL_EVIDENCE_CUSTODY_TRANSPORT.md','CLAUDE_HANDOFF_v33_55.md','V33_55_עדכון_ביצוע_והוכחות.md','pilot-kits/v33.55/external-evidence-custody-transport/manifest.json','pilot-kits/v33.55/external-evidence-custody-transport/RUNBOOK.md','pilot-kits/v33.55/external-evidence-custody-transport/EXTERNAL_EVIDENCE_CHECKLIST.md','release-evidence/v33.55/V33_55_EXTERNAL_EVIDENCE_CUSTODY_TRANSPORT_PROOF.json','release-evidence/v33.55/V33_55_INDEPENDENT_VERIFICATION.json','release-evidence/v33.55/V33_55_FOCUSED_TEST_RECEIPT.json','release-evidence/v33.55/V33_55_FULL_TEST_RESULTS.json','release-evidence/v33.55/V33_55_FULL_TEST_META.json','release-evidence/v33.55/V33_55_DIRECT_V33_RESULTS.json','release-evidence/v33.55/V33_55_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.55/V33_55_ARCHITECTURE_INTEGRITY.json']
add('required-artifacts',all((ROOT/p).exists() for p in required),[p for p in required if not (ROOT/p).exists()])
try:
 p=load('release-evidence/v33.55/V33_55_EXTERNAL_EVIDENCE_CUSTODY_TRANSPORT_PROOF.json');s=p['summary'];b=p['truthBoundary'];e=p['executionEvidence']
 add('proof-summary',s['newSignatureCount']==34 and s['totalChainSignatureCount']==434 and s['encryptedPackageCount']==10 and s['custodyEventCount']==8 and s['ciphertextFileCount']==10 and s['processCount']==2 and s['threshold']=='2-of-3' and s['aesGcmVerified'],s)
 add('proof-ciphertext-evidence',len(e['ciphertextFiles'])==10 and all(x['fileFsync'] and x['directoryFsync'] and x['readBackVerified'] for x in e['ciphertextFiles']),{'ciphertextFiles':len(e['ciphertextFiles'])})
 add('proof-process-evidence',all(x['fileFsync'] and x['directoryFsync'] and x['readBackVerified'] for x in [e['decryptProcess'],e['recoveryProcess']]),{'decrypt':e['decryptProcess']['processId'],'recovery':e['recoveryProcess']['processId']})
 add('proof-attacks',len(p['attacks'])==11 and all(p['attacks'].values()),p['attacks'])
 add('truth-boundary',b=={'status':'LOCAL_EVIDENCE_CUSTODY_TRANSPORT_REHEARSAL_ONLY','externalTopologyObserved':False,'externalCustodians':0,'externalHumanParticipants':0,'productionAuthority':'NONE','externalEffectsExecuted':0,'g3Blocked':True},b)
except Exception as x:add('proof-readable',False,str(x))
try:
 q=load('release-evidence/v33.55/V33_55_INDEPENDENT_VERIFICATION.json');add('independent-verification',q['status']=='PASS' and q['portableEvidencePathsVerified'] and q['aesGcmVerified'] and q['threshold']=='2-of-3' and q['newSignatureCount']==34 and q['totalChainSignatureCount']==434 and q['encryptedPackageCount']==10 and q['custodyEventCount']==8 and q['ciphertextFilesVerified']==10 and q['processOutputsVerified']==2 and q['truthBoundary']['productionAuthority']=='NONE',q)
except Exception as x:add('independent-verification',False,str(x))
for name,path,expected in [('focused-regression','release-evidence/v33.55/V33_55_FOCUSED_TEST_RECEIPT.json',{'testFiles':26,'tests':930}),('full-regression','release-evidence/v33.55/V33_55_FULL_TEST_RESULTS.json',{'testFiles':240,'tests':2755}),('direct-v33-regression','release-evidence/v33.55/V33_55_DIRECT_V33_RESULTS.json',{'testFiles':55,'tests':1588})]:
 try:
  d=load(path);tot=d.get('totals',{});count=len(d.get('files',[])) if name=='focused-regression' else tot.get('testFiles',d.get('testFiles'));ok=d.get('status')=='passed' and count==expected['testFiles'] and tot.get('tests')==expected['tests'] and tot.get('passed')==expected['tests'] and tot.get('failed')==0;add(name,ok,tot)
 except Exception as x:add(name,False,str(x))
try:
 t=load('release-evidence/v33.55/V33_55_REPOSITORY_TRUTH_MAP.json');inv=t['inventory'];add('repository-truth-map',t['status'] in ('PASS','passed') and inv['sourceModules']==244 and inv['testFiles']==240 and inv['governanceFiles']==11 and t['findings']==[],inv)
except Exception as x:add('repository-truth-map',False,str(x))
try:
 a=load('release-evidence/v33.55/V33_55_ARCHITECTURE_INTEGRITY.json');m=a['metrics'];add('architecture-integrity',a['status']=='PASS' and m['capabilityPathCount']==180 and m['closedCapabilityPathCount']==180 and m['sourceCycleCount']==0 and m['untestedSourceCount']==0 and a['findings']==[],m)
except Exception as x:add('architecture-integrity',False,str(x))
try:
 meta=load('release-evidence/v33.55/V33_55_FULL_TEST_META.json');rows=meta['files'];bd=meta['buildDigest'];rd=meta['runInputDigest'];add('regression-input-binding',meta['exitCode']==0 and len(rows)==240 and all(r['buildDigest']==bd and r['runInputDigest']==rd and r['exitCode']==0 and not r['timedOut'] for r in rows),{'receipts':len(rows),'buildDigest':bd,'runInputDigest':rd})
except Exception as x:add('regression-input-binding',False,str(x))
try:
 p=load('package.json');l=load('package-lock.json');ct=[load(str(x.relative_to(ROOT)))['version'] for x in sorted((ROOT/'governance-state').glob('*.json'))];mt=[load(str(x.relative_to(ROOT)))['version'] for x in sorted((ROOT/'v33/governance-state').glob('*.json'))];txt=(ROOT/'package-lock.json').read_text();add('canonical-metadata',p['version']=='0.45.0' and re.search(r'v33\.55',p['description'],re.I) and l['version']=='0.45.0' and l['packages']['']['version']=='0.45.0' and len(ct)==11 and all(x=='33.55' for x in ct) and all(x=='33.55' for x in mt),{'canonical':len(ct),'mirror':len(mt)});add('offline-lockfile','registry.npmjs.org' not in txt,None)
except Exception as x:add('canonical-metadata',False,str(x))
try:
 st=load('governance-state/PROGRAM_STATE.json');na=load('governance-state/NEXT_ACTION.json');forbidden=' | '.join(na.get('forbiddenActions',[])).lower();add('governance-boundary',st.get('phase')=='External Evidence Custody, Per-Role Encryption, Monotonic Chain of Custody, Dual-Control Decryption, Revocation, Offline Transfer, and Custodian-Loss Recovery' and st.get('status')=='v33.55-external-evidence-custody-transport-local-rehearsal-production-blocked' and st.get('executionBoundary',{}).get('productionPromotion')=='blocked' and st.get('executionBoundary',{}).get('externalMutation')=='not-authorized',{'phase':st.get('phase'),'status':st.get('status')});add('next-action-boundary',na.get('qualificationTargetVersion')=='33.55' and all(x in forbidden for x in ['production promotion','raw private keys','fewer than two controllers','fewer than two threshold shares','three revocation votes','forked or truncated','absolute or traversal','local v33.54 base verdict','untrusted host execution','external human participant count is zero']),na.get('actionId'))
except Exception as x:add('governance-boundary',False,str(x))
status='PASS' if all(x['ok'] for x in CHECKS) else 'FAIL';result={'version':'33.55','status':status,'checkCount':len(CHECKS),'passed':sum(x['ok'] for x in CHECKS),'failed':sum(not x['ok'] for x in CHECKS),'checks':CHECKS};OUT.mkdir(parents=True,exist_ok=True);(OUT/'V33_55_FINAL_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if status=='PASS' else 1)
