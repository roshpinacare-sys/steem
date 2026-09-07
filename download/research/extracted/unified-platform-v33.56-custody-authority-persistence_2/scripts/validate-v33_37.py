#!/usr/bin/env python3
from __future__ import annotations
import json, os, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'release-evidence/v33.37'; OUT.mkdir(parents=True,exist_ok=True)
checks=[]
def add(name,ok,detail): checks.append({'name':name,'status':'passed' if ok else 'failed','detail':detail})
def load(rel): return json.loads((ROOT/rel).read_text(encoding='utf-8'))
def require(rel):
 ok=(ROOT/rel).is_file(); add(f'file:{rel}',ok,'present' if ok else 'missing'); return ok
required=[
'src/app/external-qualification-deployment-import-v33_37.ts','tests/external-qualification-deployment-import-v33_37.test.ts',
'scripts/external-qualification-deployment-import-proof-v33_37.mjs','scripts/verify-external-qualification-deployment-import-v33_37.mjs',
'scripts/run-focused-tests-v33_37.mjs','scripts/run-full-regression-v33_37.py','scripts/run-direct-v33-regression-v33_37.py',
'scripts/repository-truth-map-v33_37.mjs','scripts/architecture-validation-v33_37.mjs','scripts/validate-v33_37.py',
'docs/V33_37_EXTERNAL_QUALIFICATION_DEPLOYMENT_IMPORT.md','CLAUDE_HANDOFF_v33_37.md','V33_37_עדכון_ביצוע_והוכחות.md',
'pilot-kits/v33.37/external-qualification-deployment-import/manifest.json','pilot-kits/v33.37/external-qualification-deployment-import/RUNBOOK.md',
'pilot-kits/v33.37/external-qualification-deployment-import/EXTERNAL_EXECUTION_CHECKLIST.md',
'release-evidence/v33.37/V33_37_EXTERNAL_DEPLOYMENT_IMPORT_PROOF.json','release-evidence/v33.37/V33_37_INDEPENDENT_VERIFICATION.json',
'release-evidence/v33.37/V33_37_FOCUSED_TEST_RECEIPT.json','release-evidence/v33.37/V33_37_FULL_TEST_RESULTS.json',
'release-evidence/v33.37/V33_37_FULL_TEST_META.json','release-evidence/v33.37/V33_37_DIRECT_V33_RESULTS.json',
'release-evidence/v33.37/V33_37_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.37/V33_37_ARCHITECTURE_INTEGRITY.json']
for rel in required: require(rel)
try:
 r=subprocess.run(['node','scripts/verify-external-qualification-deployment-import-v33_37.mjs'],cwd=ROOT,text=True,capture_output=True,timeout=180,env={**os.environ,'TERM':'dumb'})
 add('independent-proof-verifier',r.returncode==0,r.stdout.strip() if r.returncode==0 else (r.stderr.strip() or r.stdout.strip()))
except Exception as exc: add('independent-proof-verifier',False,str(exc))
if (OUT/'V33_37_FOCUSED_TEST_RECEIPT.json').is_file():
 x=load('release-evidence/v33.37/V33_37_FOCUSED_TEST_RECEIPT.json'); t=x.get('totals',{})
 add('focused-regression',x.get('status')=='passed' and x.get('testFiles')==8 and t.get('tests')==t.get('passed') and t.get('failed')==0 and x.get('retry') is False and x.get('forceExitDisabled') is True,t)
if (OUT/'V33_37_FULL_TEST_RESULTS.json').is_file():
 x=load('release-evidence/v33.37/V33_37_FULL_TEST_RESULTS.json'); t=x.get('totals',{})
 add('full-regression',x.get('status')=='passed' and t.get('testFiles')==222 and t.get('tests')==t.get('passed') and t.get('failed')==0 and x.get('retry') is False and x.get('forceExitDisabled') is True,t)
if (OUT/'V33_37_FULL_TEST_META.json').is_file():
 x=load('release-evidence/v33.37/V33_37_FULL_TEST_META.json'); rows=x.get('files',[]); bd=x.get('buildDigest'); rd=x.get('runInputDigest')
 add('regression-input-binding',x.get('exitCode')==0 and x.get('timedOut') is False and len(rows)==222 and isinstance(bd,str) and len(bd)==64 and isinstance(rd,str) and len(rd)==64 and all(r.get('buildDigest')==bd and r.get('runInputDigest')==rd for r in rows),{'buildDigest':bd,'runInputDigest':rd,'receiptCount':len(rows)})
if (OUT/'V33_37_DIRECT_V33_RESULTS.json').is_file():
 x=load('release-evidence/v33.37/V33_37_DIRECT_V33_RESULTS.json'); t=x.get('totals',{})
 add('direct-v33-regression',x.get('status')=='passed' and t.get('testFiles')==37 and t.get('tests')==t.get('passed') and t.get('failed')==0 and x.get('retry') is False,t)
if (OUT/'V33_37_EXTERNAL_DEPLOYMENT_IMPORT_PROOF.json').is_file():
 p=load('release-evidence/v33.37/V33_37_EXTERNAL_DEPLOYMENT_IMPORT_PROOF.json'); b=p.get('truthBoundary',{}); s=p.get('summary',{})
 add('proof-boundary',b=={'executionClass':'LOCAL_REHEARSAL','externalTopologyObserved':False,'externalHostsObserved':0,'externalHumanParticipants':0,'productionAuthority':'NONE','externalEffectsExecuted':0,'g3':'blocked','productionPromotion':'blocked'},b)
 add('proof-summary',s.get('requiredRoleCount')==11 and s.get('acceptedRoleCount')==11 and s.get('inventoryFileCount')==3 and s.get('signatureCount')==15,s)
 add('proof-attacks',all(p.get('attacks',{}).values()) and len(p.get('attacks',{}))==3,p.get('attacks'))
if (OUT/'V33_37_INDEPENDENT_VERIFICATION.json').is_file():
 x=load('release-evidence/v33.37/V33_37_INDEPENDENT_VERIFICATION.json')
 add('independent-verification',x.get('status')=='PASS' and x.get('signatureCount')==15 and x.get('requiredRoleCount')==x.get('acceptedRoleCount')==11 and x.get('verifiedFileCount')==3 and x.get('exactInventoryVerified') is True and x.get('recoveryVerified') is True and x.get('externalTopologyObserved') is False and x.get('productionAuthority')=='NONE',x)
if (OUT/'V33_37_REPOSITORY_TRUTH_MAP.json').is_file():
 x=load('release-evidence/v33.37/V33_37_REPOSITORY_TRUTH_MAP.json'); inv=x.get('inventory',{})
 add('repository-truth-map',x.get('status')=='passed' and inv.get('sourceModules')==226 and inv.get('testFiles')==222 and x.get('findings')==[] and x.get('boundaries',{}).get('productionPromotion')=='blocked',inv)
if (OUT/'V33_37_ARCHITECTURE_INTEGRITY.json').is_file():
 x=load('release-evidence/v33.37/V33_37_ARCHITECTURE_INTEGRITY.json'); m=x.get('metrics',{})
 add('architecture-integrity',x.get('status')=='PASS' and m.get('sourceCycleCount')==0 and m.get('untestedSourceCount')==0 and m.get('capabilityPathCount')==m.get('closedCapabilityPathCount')==162 and x.get('findings')==[],m)
states=[]
for base in ['governance-state','v33/governance-state']:
 for path in sorted((ROOT/base).glob('*.json')): states.append((str(path.relative_to(ROOT)),json.loads(path.read_text()).get('version')))
add('canonical-governance-version',all(v=='33.37' for _,v in states),states)
state=load('governance-state/PROGRAM_STATE.json'); action=load('governance-state/NEXT_ACTION.json'); decisions=load('governance-state/OPEN_DECISIONS.json')
add('canonical-boundary',state.get('phase')=='External Qualification Deployment and Exact Evidence Import' and state.get('status')=='v33.37-external-deployment-kit-local-import-rehearsal-production-blocked' and state.get('readiness')=='Integrated Pilot' and state.get('executionBoundary',{}).get('externalMutation')=='not-authorized' and state.get('executionBoundary',{}).get('productionPromotion')=='blocked',{'phase':state.get('phase'),'status':state.get('status')})
forbidden=' | '.join(action.get('forbiddenActions',[])).lower()
add('next-action-boundary',action.get('qualificationTargetVersion')=='33.37' and all(token in forbidden for token in ['production promotion','reusing an import challenge','relabeling local rehearsal evidence','external human participant count is zero']),action.get('actionId'))
ids={d.get('id'):d.get('status') for d in decisions.get('decisions',[])}
needed=['OD33.37-ROLE-OWNERS','OD33.37-PUBLIC-DNS-TLS','OD33.37-PROVIDER-EVIDENCE','OD33.37-RECEIPT-BACKUP','OD33.37-IMPORT-CEREMONY']
add('external-decisions-open',all(ids.get(i)=='open-external' for i in needed),{i:ids.get(i) for i in needed})
status='passed' if all(c['status']=='passed' for c in checks) else 'failed'
report={'version':'33.37','generatedAt':datetime.now(timezone.utc).isoformat(),'status':status,'checks':checks,'summary':{'total':len(checks),'passed':sum(c['status']=='passed' for c in checks),'failed':sum(c['status']=='failed' for c in checks)},'truthBoundary':{'externalTopologyObserved':False,'externalHostsObserved':0,'externalHumanParticipants':0,'productionAuthority':'NONE','externalEffectsExecuted':0,'productionPromotion':'blocked'}}
(OUT/'V33_37_FINAL_VALIDATION.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
print(json.dumps(report['summary']|{'status':status},indent=2)); sys.exit(0 if status=='passed' else 1)
