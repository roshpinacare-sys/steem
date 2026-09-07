#!/usr/bin/env python3
from __future__ import annotations
import json, re, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'release-evidence/v33.33'
checks=[]
def add(name,ok,detail): checks.append({'name':name,'status':'passed' if ok else 'failed','detail':detail})
def load(rel): return json.loads((ROOT/rel).read_text())
def require(rel):
    ok=(ROOT/rel).is_file(); add(f'file:{rel}',ok,'present' if ok else 'missing'); return ok
required=[
 'src/app/federated-checkpoint-continuity-v33_33.ts','tests/federated-checkpoint-continuity-v33_33.test.ts',
 'scripts/federated-checkpoint-continuity-proof-v33_33.mjs','scripts/verify-federated-checkpoint-continuity-v33_33.mjs',
 'scripts/run-full-regression-v33_33.py','scripts/run-direct-v33-regression-v33_33.py',
 'scripts/repository-truth-map-v33_33.mjs','scripts/architecture-validation-v33_33.mjs','scripts/validate-v33_33.py',
 'docs/V33_33_FEDERATED_CHECKPOINT_CONTINUITY.md','CLAUDE_HANDOFF_v33_33.md','V33_33_עדכון_ביצוע_והוכחות.md',
 'pilot-kits/v33.33/checkpoint-continuity/manifest.json','pilot-kits/v33.33/checkpoint-continuity/RUNBOOK.md',
 'pilot-kits/v33.33/checkpoint-continuity/WITNESS_ROTATION_TEMPLATE.json','pilot-kits/v33.33/checkpoint-continuity/TRANSPARENCY_PINNING.md',
 'release-evidence/v33.33/V33_33_CONTINUITY_PROOF.json','release-evidence/v33.33/V33_33_INDEPENDENT_VERIFICATION.json',
 'release-evidence/v33.33/V33_33_FOCUSED_TEST_RESULTS.json','release-evidence/v33.33/V33_33_FULL_TEST_RESULTS.json',
 'release-evidence/v33.33/V33_33_DIRECT_V33_RESULTS.json','release-evidence/v33.33/V33_33_REPOSITORY_TRUTH_MAP.json',
 'release-evidence/v33.33/V33_33_ARCHITECTURE_INTEGRITY.json'
]
for x in required: require(x)

try:
    r=subprocess.run(['node','scripts/verify-federated-checkpoint-continuity-v33_33.mjs'],cwd=ROOT,text=True,capture_output=True,timeout=180)
    add('independent-proof-verifier',r.returncode==0,r.stdout.strip() if r.returncode==0 else (r.stderr.strip() or r.stdout.strip()))
except Exception as e: add('independent-proof-verifier',False,str(e))

if (OUT/'V33_33_FOCUSED_TEST_RESULTS.json').is_file():
    x=load('release-evidence/v33.33/V33_33_FOCUSED_TEST_RESULTS.json'); add('focused-regression',x.get('status')=='passed' and x.get('totals')=={'tests':157,'passed':157,'failed':0},x.get('totals'))
if (OUT/'V33_33_FULL_TEST_RESULTS.json').is_file():
    x=load('release-evidence/v33.33/V33_33_FULL_TEST_RESULTS.json'); add('full-regression',x.get('status')=='passed' and x.get('totals')=={'testFiles':218,'tests':1982,'passed':1982,'failed':0} and x.get('retry') is False and x.get('forceExitDisabled') is True,x.get('totals'))
if (OUT/'V33_33_DIRECT_V33_RESULTS.json').is_file():
    x=load('release-evidence/v33.33/V33_33_DIRECT_V33_RESULTS.json'); add('direct-v33-regression',x.get('status')=='passed' and x.get('totals')=={'testFiles':33,'tests':815,'passed':815,'failed':0} and x.get('retry') is False,x.get('totals'))

if (OUT/'V33_33_CONTINUITY_PROOF.json').is_file():
    proof=load('release-evidence/v33.33/V33_33_CONTINUITY_PROOF.json')
    tb=proof.get('truthBoundary',{})
    add('proof-truth-boundary',tb=={'proofClass':'SYNTHETIC_LOCAL_PROTOCOL_PROOF','externalTopologyObserved':False,'externalHumanParticipants':0,'productionAuthority':'NONE','externalEffectsExecuted':0},tb)
    summary=proof.get('summary',{})
    expected={'fromEpoch':1,'toEpoch':2,'sequenceFloor':0,'retainedWitnesses':3,'replacedWitnesses':2,'oldWitnessQuorum':3,'activatedNextWitnesses':5,'leaseTerm':1,'leaseSequenceStart':1,'transparencyLogSize':4,'monitorQuorum':2,'signatureCount':25}
    add('proof-summary',summary==expected,summary)
if (OUT/'V33_33_INDEPENDENT_VERIFICATION.json').is_file():
    x=load('release-evidence/v33.33/V33_33_INDEPENDENT_VERIFICATION.json')
    add('independent-signatures',x.get('status')=='PASS' and x.get('verified',{}).get('signatureCount')==25 and x.get('verified',{}).get('logEntries')==4,x.get('verified'))

if (OUT/'V33_33_REPOSITORY_TRUTH_MAP.json').is_file():
    x=load('release-evidence/v33.33/V33_33_REPOSITORY_TRUTH_MAP.json'); inv=x.get('inventory',{})
    add('repository-truth-map',x.get('status')=='passed' and inv.get('sourceModules')==222 and inv.get('testFiles')==218 and x.get('boundaries',{}).get('productionPromotion')=='blocked',inv)
if (OUT/'V33_33_ARCHITECTURE_INTEGRITY.json').is_file():
    x=load('release-evidence/v33.33/V33_33_ARCHITECTURE_INTEGRITY.json'); m=x.get('metrics',{})
    add('architecture-integrity',x.get('status')=='PASS' and m.get('sourceCycleCount')==0 and m.get('untestedSourceCount')==0 and m.get('capabilityPathCount')==m.get('closedCapabilityPathCount')==158,m)

# Canonical governance
states=[]
for base in ['governance-state','v33/governance-state']:
    for p in sorted((ROOT/base).glob('*.json')):
        d=json.loads(p.read_text()); states.append((str(p.relative_to(ROOT)),d.get('version')))
add('canonical-governance-version',all(v=='33.33' for _,v in states),states)
st=load('governance-state/PROGRAM_STATE.json'); na=load('governance-state/NEXT_ACTION.json'); od=load('governance-state/OPEN_DECISIONS.json')
add('canonical-boundary',st.get('readiness')=='Integrated Pilot' and st.get('executionBoundary',{}).get('externalMutation')=='not-authorized' and st.get('executionBoundary',{}).get('productionPromotion')=='blocked',st.get('executionBoundary'))
add('next-action-boundary',na.get('qualificationTargetVersion')=='33.33' and 'production promotion' in na.get('forbiddenActions',[]) and any('external human participant count is zero' in x for x in na.get('forbiddenActions',[])),na.get('actionId'))
ids={x.get('id'):x.get('status') for x in od.get('decisions',[])}
add('continuity-open-decisions',all(x in ids for x in ['OD33.33-ROTATION-AUTHORITY','OD33.33-COORDINATOR-LEASE-HOSTS','OD33.33-TRANSPARENCY-MONITORS','OD33.33-PUBLIC-PIN-CHANNEL','OD33.33-WITNESS-LOSS-POLICY']),{k:v for k,v in ids.items() if str(k).startswith('OD33.33')})

gates=load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json'); g3=next((x for x in gates.get('gates',[]) if x.get('id')=='G3'),{})
add('g3-remains-blocked',g3.get('status')=='in-progress' and 'external human participant count remains zero' in g3.get('currentFinding',''),{'status':g3.get('status'),'finding':g3.get('currentFinding')})

# Source controls and strict-build repair
source=(ROOT/'src/app/federated-checkpoint-continuity-v33_33.ts').read_text()
for token in ['verifyEpochRotationV33_33','v33_33_rotation_recovery_limit_exceeded','verifyCoordinatorLeaseV33_33','detectCoordinatorSplitBrainV33_33','verifyTransparencyPinV33_33','detectTransparencySplitViewV33_33','previousLease','previousPin','externalTopologyObserved: false',"productionAuthority: 'NONE'"]:
    add(f'continuity-token:{token}',token in source,'present' if token in source else 'missing')
wasm=(ROOT/'src/isolation/wasm-runtime-qualification-v32_16.ts').read_text()
add('strict-build-error-normalization',"error instanceof Error ? error.message : String(error)" in wasm,'unknown worker errors normalized before message access')

ok=all(x['status']=='passed' for x in checks)
report={'version':'33.33','generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'status':'passed' if ok else 'failed','checksPassed':sum(x['status']=='passed' for x in checks),'checksFailed':sum(x['status']=='failed' for x in checks),'checks':checks,'claims':{'focusedTests':157,'fullTests':1982,'directV33Tests':815,'sourceModules':222,'testFiles':218,'capabilityPaths':158,'signatureCount':25,'externalHumanParticipants':0,'externalTopologyObserved':False,'productionAuthority':'NONE','productionPromotion':'blocked'}}
OUT.mkdir(parents=True,exist_ok=True); (OUT/'V33_33_VALIDATION.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'status':report['status'],'checksPassed':report['checksPassed'],'checksFailed':report['checksFailed'],'failed':[x for x in checks if x['status']=='failed'],'claims':report['claims']},indent=2,ensure_ascii=False))
sys.exit(0 if ok else 1)
