#!/usr/bin/env python3
from __future__ import annotations
import json, os, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'release-evidence/v33.38'; OUT.mkdir(parents=True,exist_ok=True)
checks=[]
def add(name,ok,detail): checks.append({'name':name,'status':'passed' if ok else 'failed','detail':detail})
def load(rel): return json.loads((ROOT/rel).read_text(encoding='utf-8'))
def require(rel):
 ok=(ROOT/rel).is_file(); add(f'file:{rel}',ok,'present' if ok else 'missing'); return ok
required=[
'src/app/external-qualification-custody-ceremony-v33_38.ts','tests/external-qualification-custody-ceremony-v33_38.test.ts',
'scripts/external-qualification-custody-ceremony-proof-v33_38.mjs','scripts/verify-external-qualification-custody-ceremony-v33_38.mjs',
'scripts/run-focused-tests-v33_38.mjs','scripts/run-full-regression-v33_38.py','scripts/run-direct-v33-regression-v33_38.py',
'scripts/repository-truth-map-v33_38.mjs','scripts/architecture-validation-v33_38.mjs','scripts/validate-v33_38.py',
'docs/V33_38_EXTERNAL_CUSTODY_CEREMONY_AND_RECEIPT_TRANSPARENCY.md','CLAUDE_HANDOFF_v33_38.md','V33_38_עדכון_ביצוע_והוכחות.md',
'pilot-kits/v33.38/external-custody-ceremony/manifest.json','pilot-kits/v33.38/external-custody-ceremony/RUNBOOK.md','pilot-kits/v33.38/external-custody-ceremony/EXTERNAL_EXECUTION_CHECKLIST.md',
'release-evidence/v33.38/V33_38_CUSTODY_CEREMONY_PROOF.json','release-evidence/v33.38/V33_38_INDEPENDENT_VERIFICATION.json',
'release-evidence/v33.38/V33_38_FOCUSED_TEST_RECEIPT.json','release-evidence/v33.38/V33_38_FULL_TEST_RESULTS.json','release-evidence/v33.38/V33_38_FULL_TEST_META.json','release-evidence/v33.38/V33_38_DIRECT_V33_RESULTS.json','release-evidence/v33.38/V33_38_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.38/V33_38_ARCHITECTURE_INTEGRITY.json']
for rel in required: require(rel)
try:
 r=subprocess.run(['node','scripts/verify-external-qualification-custody-ceremony-v33_38.mjs'],cwd=ROOT,text=True,capture_output=True,timeout=180,env={**os.environ,'TERM':'dumb'})
 add('independent-proof-verifier',r.returncode==0,r.stdout.strip() if r.returncode==0 else (r.stderr.strip() or r.stdout.strip()))
except Exception as exc: add('independent-proof-verifier',False,str(exc))
if (OUT/'V33_38_FOCUSED_TEST_RECEIPT.json').is_file():
 x=load('release-evidence/v33.38/V33_38_FOCUSED_TEST_RECEIPT.json'); t=x.get('totals',{})
 add('focused-regression',x.get('status')=='passed' and x.get('testFiles')==9 and t.get('tests')==316 and t.get('passed')==316 and t.get('failed')==0 and x.get('retry') is False and x.get('forceExitDisabled') is True,t)
if (OUT/'V33_38_FULL_TEST_RESULTS.json').is_file():
 x=load('release-evidence/v33.38/V33_38_FULL_TEST_RESULTS.json'); t=x.get('totals',{})
 add('full-regression',x.get('status')=='passed' and t.get('testFiles')==223 and t.get('tests')==2141 and t.get('passed')==2141 and t.get('failed')==0 and x.get('retry') is False and x.get('forceExitDisabled') is True,t)
if (OUT/'V33_38_FULL_TEST_META.json').is_file():
 x=load('release-evidence/v33.38/V33_38_FULL_TEST_META.json'); rows=x.get('files',[]); bd=x.get('buildDigest'); rd=x.get('runInputDigest')
 add('regression-input-binding',x.get('exitCode')==0 and x.get('timedOut') is False and len(rows)==223 and isinstance(bd,str) and len(bd)==64 and isinstance(rd,str) and len(rd)==64 and all(r.get('buildDigest')==bd and r.get('runInputDigest')==rd for r in rows),{'buildDigest':bd,'runInputDigest':rd,'receiptCount':len(rows)})
if (OUT/'V33_38_DIRECT_V33_RESULTS.json').is_file():
 x=load('release-evidence/v33.38/V33_38_DIRECT_V33_RESULTS.json'); t=x.get('totals',{})
 add('direct-v33-regression',x.get('status')=='passed' and t.get('testFiles')==38 and t.get('tests')==974 and t.get('passed')==974 and t.get('failed')==0 and x.get('retry') is False,t)
if (OUT/'V33_38_CUSTODY_CEREMONY_PROOF.json').is_file():
 p=load('release-evidence/v33.38/V33_38_CUSTODY_CEREMONY_PROOF.json'); b=p.get('truthBoundary',{}); s=p.get('summary',{})
 add('proof-boundary',b.get('executionClass')=='LOCAL_REHEARSAL' and b.get('externalTopologyObserved') is False and b.get('externalRoleOwnersObserved')==0 and b.get('externalHumanParticipants')==0 and b.get('productionAuthority')=='NONE' and b.get('externalEffectsExecuted')==0 and b.get('productionPromotion')=='blocked',b)
 add('proof-summary',s.get('roleCount')==11 and s.get('provisioningReceiptCount')==11 and s.get('transparencyEventCount')==14 and s.get('signatureCount')==60,s)
 add('proof-attacks',all(p.get('attacks',{}).values()) and len(p.get('attacks',{}))==4,p.get('attacks'))
if (OUT/'V33_38_INDEPENDENT_VERIFICATION.json').is_file():
 x=load('release-evidence/v33.38/V33_38_INDEPENDENT_VERIFICATION.json')
 add('independent-verification',x.get('status')=='PASS' and x.get('signatureCount')==60 and x.get('roleCount')==11 and x.get('transparencyEventCount')==14 and x.get('finalStatus')=='LOCAL_CUSTODY_IMPORT_REHEARSAL_ONLY' and x.get('externalTopologyObserved') is False and x.get('externalHumanParticipants')==0 and x.get('productionAuthority')=='NONE' and all(x.get('checks',{}).values()),x)
if (OUT/'V33_38_REPOSITORY_TRUTH_MAP.json').is_file():
 x=load('release-evidence/v33.38/V33_38_REPOSITORY_TRUTH_MAP.json'); inv=x.get('inventory',{})
 add('repository-truth-map',x.get('status')=='passed' and inv.get('sourceModules')==227 and inv.get('testFiles')==223 and x.get('findings')==[] and x.get('boundaries',{}).get('productionPromotion')=='blocked',inv)
if (OUT/'V33_38_ARCHITECTURE_INTEGRITY.json').is_file():
 x=load('release-evidence/v33.38/V33_38_ARCHITECTURE_INTEGRITY.json'); m=x.get('metrics',{})
 add('architecture-integrity',x.get('status')=='PASS' and m.get('sourceCycleCount')==0 and m.get('untestedSourceCount')==0 and m.get('capabilityPathCount')==m.get('closedCapabilityPathCount')==163 and x.get('findings')==[],m)
states=[]
for base in ['governance-state','v33/governance-state']:
 for path in sorted((ROOT/base).glob('*.json')): states.append((str(path.relative_to(ROOT)),json.loads(path.read_text()).get('version')))
add('canonical-governance-version',all(v=='33.38' for _,v in states),states)
state=load('governance-state/PROGRAM_STATE.json'); action=load('governance-state/NEXT_ACTION.json'); decisions=load('governance-state/OPEN_DECISIONS.json')
add('canonical-boundary',state.get('phase')=='External Custody Ceremony and Receipt Transparency' and state.get('status')=='v33.38-local-custody-ceremony-rehearsal-production-blocked' and state.get('executionBoundary',{}).get('externalMutation')=='not-authorized' and state.get('executionBoundary',{}).get('productionPromotion')=='blocked',{'phase':state.get('phase'),'status':state.get('status')})
forbidden=' | '.join(action.get('forbiddenActions',[])).lower()
add('next-action-boundary',action.get('qualificationTargetVersion')=='33.38' and all(token in forbidden for token in ['production promotion','external mutation','reusing a provisioning challenge','resurrecting a revoked key','external human participant count is zero']),action.get('actionId'))
ids={d.get('id'):d.get('status') for d in decisions.get('decisions',[])}
needed=['OD33.38-ROLE-PROVISIONING','OD33.38-CEREMONY-WITNESSES','OD33.38-KEY-CUSTODY','OD33.38-TRANSPARENCY-PUBLISHING','OD33.38-ROTATION-RECOVERY']
add('external-decisions-open',all(ids.get(i)=='open-external' for i in needed),{i:ids.get(i) for i in needed})
status='passed' if all(c['status']=='passed' for c in checks) else 'failed'
report={'version':'33.38','generatedAt':datetime.now(timezone.utc).isoformat(),'status':status,'checks':checks,'summary':{'total':len(checks),'passed':sum(c['status']=='passed' for c in checks),'failed':sum(c['status']=='failed' for c in checks)},'truthBoundary':{'externalTopologyObserved':False,'externalRoleOwnersObserved':0,'externalHumanParticipants':0,'productionAuthority':'NONE','externalEffectsExecuted':0,'productionPromotion':'blocked'}}
(OUT/'V33_38_FINAL_VALIDATION.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
print(json.dumps(report['summary']|{'status':status},indent=2)); sys.exit(0 if status=='passed' else 1)
