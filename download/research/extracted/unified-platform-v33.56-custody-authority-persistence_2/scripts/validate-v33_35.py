#!/usr/bin/env python3
from __future__ import annotations
import json, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'release-evidence/v33.35'
checks=[]
def add(name,ok,detail): checks.append({'name':name,'status':'passed' if ok else 'failed','detail':detail})
def load(rel): return json.loads((ROOT/rel).read_text())
def require(rel):
    ok=(ROOT/rel).is_file(); add(f'file:{rel}',ok,'present' if ok else 'missing'); return ok
required=[
 'src/app/expired-coordinator-takeover-v33_35.ts','tests/expired-coordinator-takeover-v33_35.test.ts',
 'scripts/expired-coordinator-takeover-proof-v33_35.mjs','scripts/verify-expired-coordinator-takeover-v33_35.mjs',
 'scripts/v33_35-publication-server.mjs','scripts/v33_35-monitor-worker.mjs','scripts/run-focused-tests-v33_35.mjs',
 'scripts/run-full-regression-v33_35.py','scripts/run-direct-v33-regression-v33_35.py','scripts/repository-truth-map-v33_35.mjs','scripts/architecture-validation-v33_35.mjs','scripts/validate-v33_35.py',
 'docs/V33_35_EXPIRED_COORDINATOR_TAKEOVER.md','CLAUDE_HANDOFF_v33_35.md','V33_35_עדכון_ביצוע_והוכחות.md',
 'pilot-kits/v33.35/expired-coordinator-takeover/manifest.json','pilot-kits/v33.35/expired-coordinator-takeover/RUNBOOK.md','pilot-kits/v33.35/expired-coordinator-takeover/EXPIRY_TAKEOVER_CHECKLIST.md',
 'release-evidence/v33.35/V33_35_EXPIRED_TAKEOVER_PROOF.json','release-evidence/v33.35/V33_35_INDEPENDENT_VERIFICATION.json',
 'release-evidence/v33.35/V33_35_FOCUSED_TEST_RESULTS.json','release-evidence/v33.35/V33_35_FULL_TEST_RESULTS.json','release-evidence/v33.35/V33_35_DIRECT_V33_RESULTS.json',
 'release-evidence/v33.35/V33_35_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.35/V33_35_ARCHITECTURE_INTEGRITY.json'
]
for x in required: require(x)
try:
    r=subprocess.run(['node','scripts/verify-expired-coordinator-takeover-v33_35.mjs'],cwd=ROOT,text=True,capture_output=True,timeout=180,env={**__import__('os').environ,'TERM':'dumb'})
    add('independent-proof-verifier',r.returncode==0,r.stdout.strip() if r.returncode==0 else (r.stderr.strip() or r.stdout.strip()))
except Exception as e: add('independent-proof-verifier',False,str(e))
if (OUT/'V33_35_FOCUSED_TEST_RESULTS.json').is_file():
    x=load('release-evidence/v33.35/V33_35_FOCUSED_TEST_RESULTS.json'); add('focused-regression',x.get('status')=='passed' and x.get('totals')=={'tests':225,'passed':225,'failed':0} and x.get('retry') is False,x.get('totals'))
if (OUT/'V33_35_FULL_TEST_RESULTS.json').is_file():
    x=load('release-evidence/v33.35/V33_35_FULL_TEST_RESULTS.json'); add('full-regression',x.get('status')=='passed' and x.get('totals')=={'testFiles':220,'tests':2050,'passed':2050,'failed':0} and x.get('retry') is False and x.get('forceExitDisabled') is True,x.get('totals'))
if (OUT/'V33_35_DIRECT_V33_RESULTS.json').is_file():
    x=load('release-evidence/v33.35/V33_35_DIRECT_V33_RESULTS.json'); add('direct-v33-regression',x.get('status')=='passed' and x.get('totals')=={'testFiles':35,'tests':883,'passed':883,'failed':0} and x.get('retry') is False,x.get('totals'))
if (OUT/'V33_35_EXPIRED_TAKEOVER_PROOF.json').is_file():
    proof=load('release-evidence/v33.35/V33_35_EXPIRED_TAKEOVER_PROOF.json'); tb=proof.get('truthBoundary',{}); summary=proof.get('summary',{}); execution=proof.get('execution',{})
    add('proof-truth-boundary',tb=={'independentProcessesObserved':True,'networkFetchObserved':True,'externalTopologyObserved':False,'externalWitnessHostsObserved':0,'externalHumanParticipants':0,'productionAuthority':'NONE','externalEffectsExecuted':0,'productionPromotion':'blocked'},tb)
    add('proof-summary',summary=={'predecessorTerm':9,'nextTerm':10,'sequenceStart':401,'sequenceEnd':500,'expiryVoteCount':3,'retrievalCount':3,'gossipCount':3,'signatureCount':16},summary)
    add('proof-execution',execution.get('distinctMonitorProcessCount')==3 and execution.get('networkFetchObserved') is True and execution.get('transport')=='HTTP_LOOPBACK' and execution.get('externalTopologyObserved') is False,execution)
if (OUT/'V33_35_INDEPENDENT_VERIFICATION.json').is_file():
    x=load('release-evidence/v33.35/V33_35_INDEPENDENT_VERIFICATION.json'); add('independent-signatures',x.get('status')=='PASS' and x.get('signatureCount')==16 and x.get('predecessorTerm')==9 and x.get('nextTerm')==10 and x.get('sequenceStart')==401 and x.get('distinctMonitorProcessCount')==3 and x.get('networkFetchObserved') is True and x.get('externalTopologyObserved') is False,x)
if (OUT/'V33_35_REPOSITORY_TRUTH_MAP.json').is_file():
    x=load('release-evidence/v33.35/V33_35_REPOSITORY_TRUTH_MAP.json'); inv=x.get('inventory',{}); add('repository-truth-map',x.get('status')=='passed' and inv.get('sourceModules')==224 and inv.get('testFiles')==220 and x.get('boundaries',{}).get('productionPromotion')=='blocked',inv)
if (OUT/'V33_35_ARCHITECTURE_INTEGRITY.json').is_file():
    x=load('release-evidence/v33.35/V33_35_ARCHITECTURE_INTEGRITY.json'); m=x.get('metrics',{}); add('architecture-integrity',x.get('status')=='PASS' and m.get('sourceCycleCount')==0 and m.get('untestedSourceCount')==0 and m.get('capabilityPathCount')==m.get('closedCapabilityPathCount')==160,m)
states=[]
for base in ['governance-state','v33/governance-state']:
    for p in sorted((ROOT/base).glob('*.json')): states.append((str(p.relative_to(ROOT)),json.loads(p.read_text()).get('version')))
add('canonical-governance-version',all(v=='33.35' for _,v in states),states)
st=load('governance-state/PROGRAM_STATE.json'); na=load('governance-state/NEXT_ACTION.json'); od=load('governance-state/OPEN_DECISIONS.json')
add('canonical-boundary',st.get('readiness')=='Integrated Pilot' and st.get('phase')=='Expired Coordinator Takeover and Multi-Process Retrieval Qualification' and st.get('executionBoundary',{}).get('externalMutation')=='not-authorized' and st.get('executionBoundary',{}).get('productionPromotion')=='blocked',st.get('executionBoundary'))
forbidden=' | '.join(na.get('forbiddenActions',[])).lower()
add('next-action-boundary',na.get('qualificationTargetVersion')=='33.35' and 'production promotion' in forbidden and 'external human participant count is zero' in forbidden and 'claiming external topology from loopback' in forbidden,na.get('actionId'))
ids={x.get('id'):x.get('status') for x in od.get('decisions',[])}
add('external-host-open-decisions',all(x in ids for x in ['OD33.35-EXTERNAL-HOSTS','OD33.35-CLOCK-ROOT','OD33.35-DURABLE-RETENTION','OD33.35-MONITOR-REPLACEMENT']),{k:v for k,v in ids.items() if str(k).startswith('OD33.35')})
gates=load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json'); g3=next((x for x in gates.get('gates',[]) if x.get('id')=='G3'),{})
add('g3-remains-blocked',g3.get('status')=='in-progress' and 'external human participant count remains zero' in g3.get('currentFinding',''),{'status':g3.get('status'),'finding':g3.get('currentFinding')})
source=(ROOT/'src/app/expired-coordinator-takeover-v33_35.ts').read_text()
for token in ['verifyExpiredCoordinatorTakeoverV33_35','detectExpiredTakeoverConflictsV33_35','verifyCoordinatorActionAgainstTakeoverV33_35','verifyRetrievalAndGossipV33_35','detectMonitorSplitViewV33_35','networkFetchObserved: true','externalTopologyObserved: input.transport === \'HTTPS_EXTERNAL\'',"productionAuthority: 'NONE'"]:
    add(f'takeover-token:{token}',token in source,'present' if token in source else 'missing')
ok=all(x['status']=='passed' for x in checks)
report={'version':'33.35','generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'status':'passed' if ok else 'failed','checksPassed':sum(x['status']=='passed' for x in checks),'checksFailed':sum(x['status']=='failed' for x in checks),'checks':checks,'claims':{'focusedTests':225,'fullTests':2050,'directV33Tests':883,'sourceModules':224,'testFiles':220,'capabilityPaths':160,'signatureCount':16,'distinctMonitorProcesses':3,'networkFetchObserved':True,'transport':'HTTP_LOOPBACK','externalWitnessHostsObserved':0,'externalHumanParticipants':0,'externalTopologyObserved':False,'productionAuthority':'NONE','productionPromotion':'blocked'}}
OUT.mkdir(parents=True,exist_ok=True); (OUT/'V33_35_VALIDATION.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'status':report['status'],'checksPassed':report['checksPassed'],'checksFailed':report['checksFailed'],'failed':[x for x in checks if x['status']=='failed'],'claims':report['claims']},indent=2,ensure_ascii=False))
sys.exit(0 if ok else 1)
