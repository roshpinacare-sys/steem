#!/usr/bin/env python3
from __future__ import annotations
import json, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'release-evidence/v33.34'
checks=[]
def add(name,ok,detail): checks.append({'name':name,'status':'passed' if ok else 'failed','detail':detail})
def load(rel): return json.loads((ROOT/rel).read_text())
def require(rel):
    ok=(ROOT/rel).is_file(); add(f'file:{rel}',ok,'present' if ok else 'missing'); return ok
required=[
 'src/app/federated-recovery-drill-v33_34.ts','tests/federated-recovery-drill-v33_34.test.ts',
 'scripts/federated-recovery-drill-proof-v33_34.mjs','scripts/verify-federated-recovery-drill-v33_34.mjs',
 'scripts/run-full-regression-v33_34.py','scripts/run-direct-v33-regression-v33_34.py','scripts/repository-truth-map-v33_34.mjs','scripts/architecture-validation-v33_34.mjs','scripts/validate-v33_34.py',
 'docs/V33_34_FEDERATED_RECOVERY_DRILL.md','CLAUDE_HANDOFF_v33_34.md','V33_34_עדכון_ביצוע_והוכחות.md',
 'pilot-kits/v33.34/federated-recovery-drill/manifest.json','pilot-kits/v33.34/federated-recovery-drill/RUNBOOK.md','pilot-kits/v33.34/federated-recovery-drill/RECOVERY_CEREMONY_CHECKLIST.md',
 'release-evidence/v33.34/V33_34_RECOVERY_DRILL_PROOF.json','release-evidence/v33.34/V33_34_INDEPENDENT_VERIFICATION.json',
 'release-evidence/v33.34/V33_34_FOCUSED_TEST_RESULTS.json','release-evidence/v33.34/V33_34_FULL_TEST_RESULTS.json','release-evidence/v33.34/V33_34_DIRECT_V33_RESULTS.json',
 'release-evidence/v33.34/V33_34_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.34/V33_34_ARCHITECTURE_INTEGRITY.json'
]
for x in required: require(x)
try:
    r=subprocess.run(['node','scripts/verify-federated-recovery-drill-v33_34.mjs'],cwd=ROOT,text=True,capture_output=True,timeout=180)
    add('independent-proof-verifier',r.returncode==0,r.stdout.strip() if r.returncode==0 else (r.stderr.strip() or r.stdout.strip()))
except Exception as e: add('independent-proof-verifier',False,str(e))
if (OUT/'V33_34_FOCUSED_TEST_RESULTS.json').is_file():
    x=load('release-evidence/v33.34/V33_34_FOCUSED_TEST_RESULTS.json'); add('focused-regression',x.get('status')=='passed' and x.get('totals')=={'tests':192,'passed':192,'failed':0},x.get('totals'))
if (OUT/'V33_34_FULL_TEST_RESULTS.json').is_file():
    x=load('release-evidence/v33.34/V33_34_FULL_TEST_RESULTS.json'); add('full-regression',x.get('status')=='passed' and x.get('totals')=={'testFiles':219,'tests':2017,'passed':2017,'failed':0} and x.get('retry') is False and x.get('forceExitDisabled') is True,x.get('totals'))
if (OUT/'V33_34_DIRECT_V33_RESULTS.json').is_file():
    x=load('release-evidence/v33.34/V33_34_DIRECT_V33_RESULTS.json'); add('direct-v33-regression',x.get('status')=='passed' and x.get('totals')=={'testFiles':34,'tests':850,'passed':850,'failed':0} and x.get('retry') is False,x.get('totals'))
if (OUT/'V33_34_RECOVERY_DRILL_PROOF.json').is_file():
    proof=load('release-evidence/v33.34/V33_34_RECOVERY_DRILL_PROOF.json'); tb=proof.get('truthBoundary',{}); summary=proof.get('summary',{})
    add('proof-truth-boundary',tb=={'proofClass':'SYNTHETIC_LOCAL_RECOVERY_REHEARSAL','externalTopologyObserved':False,'externalHumanParticipants':0,'productionAuthority':'NONE','externalEffectsExecuted':0},tb)
    add('proof-summary',summary=={'initialEpoch':2,'finalEpoch':4,'sequenceFloor':0,'firstUnavailableWitnesses':2,'secondUnavailableWitnesses':1,'handoffCutoverSequence':50,'replacementLeaseStart':51,'signatureCount':32},summary)
if (OUT/'V33_34_INDEPENDENT_VERIFICATION.json').is_file():
    x=load('release-evidence/v33.34/V33_34_INDEPENDENT_VERIFICATION.json'); add('independent-signatures',x.get('status')=='PASS' and x.get('signatureCount')==32 and x.get('finalEpoch')==4 and x.get('networkFetchObserved') is False,x)
if (OUT/'V33_34_REPOSITORY_TRUTH_MAP.json').is_file():
    x=load('release-evidence/v33.34/V33_34_REPOSITORY_TRUTH_MAP.json'); inv=x.get('inventory',{}); add('repository-truth-map',x.get('status')=='passed' and inv.get('sourceModules')==223 and inv.get('testFiles')==219 and x.get('boundaries',{}).get('productionPromotion')=='blocked',inv)
if (OUT/'V33_34_ARCHITECTURE_INTEGRITY.json').is_file():
    x=load('release-evidence/v33.34/V33_34_ARCHITECTURE_INTEGRITY.json'); m=x.get('metrics',{}); add('architecture-integrity',x.get('status')=='PASS' and m.get('sourceCycleCount')==0 and m.get('untestedSourceCount')==0 and m.get('capabilityPathCount')==m.get('closedCapabilityPathCount')==159,m)
states=[]
for base in ['governance-state','v33/governance-state']:
    for p in sorted((ROOT/base).glob('*.json')): states.append((str(p.relative_to(ROOT)),json.loads(p.read_text()).get('version')))
add('canonical-governance-version',all(v=='33.34' for _,v in states),states)
st=load('governance-state/PROGRAM_STATE.json'); na=load('governance-state/NEXT_ACTION.json'); od=load('governance-state/OPEN_DECISIONS.json')
add('canonical-boundary',st.get('readiness')=='Integrated Pilot' and st.get('executionBoundary',{}).get('externalMutation')=='not-authorized' and st.get('executionBoundary',{}).get('productionPromotion')=='blocked',st.get('executionBoundary'))
add('next-action-boundary',na.get('qualificationTargetVersion')=='33.34' and 'production promotion' in na.get('forbiddenActions',[]) and any('external human participant count is zero' in x for x in na.get('forbiddenActions',[])),na.get('actionId'))
ids={x.get('id'):x.get('status') for x in od.get('decisions',[])}
add('recovery-open-decisions',all(x in ids for x in ['OD33.34-RECOVERY-HOSTS','OD33.34-EXPIRY-TAKEOVER','OD33.34-EXTERNAL-PUBLICATION','OD33.34-RECEIPT-RETENTION']),{k:v for k,v in ids.items() if str(k).startswith('OD33.34')})
gates=load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json'); g3=next((x for x in gates.get('gates',[]) if x.get('id')=='G3'),{})
add('g3-remains-blocked',g3.get('status')=='in-progress' and 'external human participant count remains zero' in g3.get('currentFinding',''),{'status':g3.get('status'),'finding':g3.get('currentFinding')})
source=(ROOT/'src/app/federated-recovery-drill-v33_34.ts').read_text()
for token in ['verifyRecoveryEpochV33_34','v33_34_unavailable_witness_quorum_lost','verifyCoordinatorHandoffV33_34','detectCoordinatorHandoffConflictsV33_34','verifyRecoveryPublicationV33_34','networkFetchObserved: false','externalTopologyObserved: false',"productionAuthority: 'NONE'"]:
    add(f'recovery-token:{token}',token in source,'present' if token in source else 'missing')
ok=all(x['status']=='passed' for x in checks)
report={'version':'33.34','generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'status':'passed' if ok else 'failed','checksPassed':sum(x['status']=='passed' for x in checks),'checksFailed':sum(x['status']=='failed' for x in checks),'checks':checks,'claims':{'focusedTests':192,'fullTests':2017,'directV33Tests':850,'sourceModules':223,'testFiles':219,'capabilityPaths':159,'signatureCount':32,'externalHumanParticipants':0,'externalTopologyObserved':False,'networkFetchObserved':False,'productionAuthority':'NONE','productionPromotion':'blocked'}}
OUT.mkdir(parents=True,exist_ok=True); (OUT/'V33_34_VALIDATION.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'status':report['status'],'checksPassed':report['checksPassed'],'checksFailed':report['checksFailed'],'failed':[x for x in checks if x['status']=='failed'],'claims':report['claims']},indent=2,ensure_ascii=False))
sys.exit(0 if ok else 1)
