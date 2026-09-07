#!/usr/bin/env python3
from __future__ import annotations
import json, os, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'release-evidence/v33.39'; OUT.mkdir(parents=True,exist_ok=True)
checks=[]
def add(name,ok,detail): checks.append({'name':name,'status':'passed' if ok else 'failed','detail':detail})
def load(rel): return json.loads((ROOT/rel).read_text(encoding='utf-8'))
def require(rel):
 ok=(ROOT/rel).is_file(); add(f'file:{rel}',ok,'present' if ok else 'missing'); return ok
required=[
'src/app/external-custody-hsm-threshold-recovery-v33_39.ts','tests/external-custody-hsm-threshold-recovery-v33_39.test.ts',
'scripts/external-custody-hsm-threshold-recovery-proof-v33_39.mjs','scripts/verify-external-custody-hsm-threshold-recovery-v33_39.mjs',
'scripts/run-focused-tests-v33_39.mjs','scripts/run-full-regression-v33_39.py','scripts/run-direct-v33-regression-v33_39.py',
'scripts/repository-truth-map-v33_39.mjs','scripts/architecture-validation-v33_39.mjs','scripts/validate-v33_39.py',
'docs/V33_39_HSM_THRESHOLD_CUSTODY_AND_SITE_RECOVERY.md','CLAUDE_HANDOFF_v33_39.md','V33_39_עדכון_ביצוע_והוכחות.md',
'pilot-kits/v33.39/hsm-threshold-site-recovery/manifest.json','pilot-kits/v33.39/hsm-threshold-site-recovery/RUNBOOK.md','pilot-kits/v33.39/hsm-threshold-site-recovery/EXTERNAL_EXECUTION_CHECKLIST.md',
'release-evidence/v33.39/V33_39_HSM_THRESHOLD_RECOVERY_PROOF.json','release-evidence/v33.39/V33_39_INDEPENDENT_VERIFICATION.json',
'release-evidence/v33.39/V33_39_FOCUSED_TEST_RECEIPT.json','release-evidence/v33.39/V33_39_FULL_TEST_RESULTS.json','release-evidence/v33.39/V33_39_FULL_TEST_META.json',
'release-evidence/v33.39/V33_39_DIRECT_V33_RESULTS.json','release-evidence/v33.39/V33_39_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.39/V33_39_ARCHITECTURE_INTEGRITY.json']
for rel in required: require(rel)
try:
 r=subprocess.run(['node','scripts/verify-external-custody-hsm-threshold-recovery-v33_39.mjs'],cwd=ROOT,text=True,capture_output=True,timeout=240,env={**os.environ,'TERM':'dumb'})
 add('independent-proof-verifier',r.returncode==0,r.stdout.strip() if r.returncode==0 else (r.stderr.strip() or r.stdout.strip()))
except Exception as exc: add('independent-proof-verifier',False,str(exc))
if (OUT/'V33_39_FOCUSED_TEST_RECEIPT.json').is_file():
 x=load('release-evidence/v33.39/V33_39_FOCUSED_TEST_RECEIPT.json'); t=x.get('totals',{})
 add('focused-regression',x.get('status')=='passed' and x.get('testFiles')==10 and t.get('tests')==348 and t.get('passed')==348 and t.get('failed')==0 and x.get('retry') is False and x.get('forceExitDisabled') is True,t)
if (OUT/'V33_39_FULL_TEST_RESULTS.json').is_file():
 x=load('release-evidence/v33.39/V33_39_FULL_TEST_RESULTS.json'); t=x.get('totals',{})
 add('full-regression',x.get('status')=='passed' and t.get('testFiles')==224 and t.get('tests')==2173 and t.get('passed')==2173 and t.get('failed')==0 and x.get('retry') is False and x.get('forceExitDisabled') is True,t)
if (OUT/'V33_39_FULL_TEST_META.json').is_file():
 x=load('release-evidence/v33.39/V33_39_FULL_TEST_META.json'); rows=x.get('files',[]); bd=x.get('buildDigest'); rd=x.get('runInputDigest')
 add('regression-input-binding',x.get('exitCode')==0 and x.get('timedOut') is False and len(rows)==224 and isinstance(bd,str) and len(bd)==64 and isinstance(rd,str) and len(rd)==64 and all(r.get('buildDigest')==bd and r.get('runInputDigest')==rd for r in rows),{'buildDigest':bd,'runInputDigest':rd,'receiptCount':len(rows)})
if (OUT/'V33_39_DIRECT_V33_RESULTS.json').is_file():
 x=load('release-evidence/v33.39/V33_39_DIRECT_V33_RESULTS.json'); t=x.get('totals',{})
 add('direct-v33-regression',x.get('status')=='passed' and t.get('testFiles')==39 and t.get('tests')==1006 and t.get('passed')==1006 and t.get('failed')==0 and x.get('retry') is False,t)
if (OUT/'V33_39_HSM_THRESHOLD_RECOVERY_PROOF.json').is_file():
 p=load('release-evidence/v33.39/V33_39_HSM_THRESHOLD_RECOVERY_PROOF.json'); b=p.get('truthBoundary',{}); s=p.get('summary',{})
 add('proof-boundary',b.get('executionClass')=='LOCAL_REHEARSAL' and b.get('externalTopologyObserved') is False and b.get('externalHardwareObserved') is False and b.get('externalRoleOwnersObserved')==0 and b.get('externalHumanParticipants')==0 and b.get('productionAuthority')=='NONE' and b.get('externalEffectsExecuted')==0 and b.get('g3')=='blocked' and b.get('productionPromotion')=='blocked',b)
 add('proof-summary',s.get('hardwareAttestationCount')==11 and s.get('thresholdCertificateCount')==3 and s.get('retrievalReceiptCount')==3 and s.get('revocationReceiptCount')==3 and s.get('signatureCount')==33,s)
 add('proof-attacks',len(p.get('attacks',{}))==5 and all(p.get('attacks',{}).values()),p.get('attacks'))
if (OUT/'V33_39_INDEPENDENT_VERIFICATION.json').is_file():
 x=load('release-evidence/v33.39/V33_39_INDEPENDENT_VERIFICATION.json')
 add('independent-verification',x.get('status')=='PASS' and x.get('signatureCount')==33 and x.get('hardwareAttestationCount')==11 and x.get('thresholdCertificateCount')==3 and x.get('retrievalReceiptCount')==3 and x.get('revocationReceiptCount')==3 and x.get('finalStatus')=='LOCAL_HSM_THRESHOLD_RECOVERY_REHEARSAL_ONLY' and x.get('externalTopologyObserved') is False and x.get('externalHardwareObserved') is False and x.get('externalHumanParticipants')==0 and x.get('productionAuthority')=='NONE' and all(x.get('checks',{}).values()),x)
if (OUT/'V33_39_REPOSITORY_TRUTH_MAP.json').is_file():
 x=load('release-evidence/v33.39/V33_39_REPOSITORY_TRUTH_MAP.json'); inv=x.get('inventory',{})
 add('repository-truth-map',x.get('status')=='passed' and inv.get('sourceModules')==228 and inv.get('testFiles')==224 and x.get('findings')==[] and x.get('boundaries',{}).get('productionPromotion')=='blocked',inv)
if (OUT/'V33_39_ARCHITECTURE_INTEGRITY.json').is_file():
 x=load('release-evidence/v33.39/V33_39_ARCHITECTURE_INTEGRITY.json'); m=x.get('metrics',{})
 add('architecture-integrity',x.get('status')=='PASS' and m.get('sourceCycleCount')==0 and m.get('untestedSourceCount')==0 and m.get('capabilityPathCount')==m.get('closedCapabilityPathCount') and m.get('capabilityPathCount',0)>=163 and x.get('findings')==[],m)
states=[]
for base in ['governance-state','v33/governance-state']:
 for path in sorted((ROOT/base).glob('*.json')): states.append((str(path.relative_to(ROOT)),json.loads(path.read_text()).get('version')))
add('canonical-governance-version',all(v=='33.39' for _,v in states),states)
state=load('governance-state/PROGRAM_STATE.json'); action=load('governance-state/NEXT_ACTION.json'); decisions=load('governance-state/OPEN_DECISIONS.json')
add('canonical-boundary',state.get('phase')=='HSM Threshold Custody and Site Recovery' and state.get('status')=='v33.39-local-hsm-threshold-recovery-rehearsal-production-blocked' and state.get('executionBoundary',{}).get('externalMutation')=='not-authorized' and state.get('executionBoundary',{}).get('productionPromotion')=='blocked',{'phase':state.get('phase'),'status':state.get('status')})
forbidden=' | '.join(action.get('forbiddenActions',[])).lower()
add('next-action-boundary',action.get('qualificationTargetVersion')=='33.39' and all(token in forbidden for token in ['production promotion','external mutation','exporting private key material','lowering the three-of-five threshold','resurrecting a revoked key','external human participant count is zero']),action.get('actionId'))
ids={d.get('id'):d.get('status') for d in decisions.get('decisions',[])}
needed=['OD33.39-HSM-PROVIDERS','OD33.39-THRESHOLD-CUSTODIANS','OD33.39-PUBLIC-CHECKPOINT','OD33.39-REVOCATION-PROPAGATION','OD33.39-RECOVERY-SITE']
add('external-decisions-open',all(ids.get(i)=='open-external' for i in needed),{i:ids.get(i) for i in needed})
status='passed' if all(c['status']=='passed' for c in checks) else 'failed'
report={'version':'33.39','generatedAt':datetime.now(timezone.utc).isoformat(),'status':status,'checks':checks,'summary':{'total':len(checks),'passed':sum(c['status']=='passed' for c in checks),'failed':sum(c['status']=='failed' for c in checks)},'truthBoundary':{'externalTopologyObserved':False,'externalHardwareObserved':False,'externalRoleOwnersObserved':0,'externalHumanParticipants':0,'productionAuthority':'NONE','externalEffectsExecuted':0,'productionPromotion':'blocked'}}
(OUT/'V33_39_FINAL_VALIDATION.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
print(json.dumps(report['summary']|{'status':status},indent=2)); sys.exit(0 if status=='passed' else 1)
