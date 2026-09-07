#!/usr/bin/env python3
from __future__ import annotations
import json, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'release-evidence/v33.32'
checks=[]
def add(name,ok,detail): checks.append({'name':name,'status':'passed' if ok else 'failed','detail':detail})
def load(path): return json.loads((ROOT/path).read_text())
def require(path):
    ok=(ROOT/path).is_file(); add(f'file:{path}',ok,'present' if ok else 'missing'); return ok
required=[
 'src/app/federated-human-pilot-checkpoint-v33_32.ts',
 'src/app/external-human-pilot-evidence-import-v33_31.ts',
 'src/app/controlled-human-ux-pilot-v33_30.ts',
 'tests/federated-human-pilot-checkpoint-v33_32.test.ts',
 'scripts/federated-human-pilot-checkpoint-proof-v33_32.mjs',
 'scripts/verify-federated-human-pilot-checkpoint-v33_32.mjs',
 'scripts/run-full-regression-v33_32.py','scripts/run-direct-v33-regression-v33_32.py',
 'scripts/repository-truth-map-v33_32.mjs','scripts/architecture-validation-v33_32.mjs',
 'docs/V33_32_FEDERATED_HUMAN_PILOT_CHECKPOINT.md',
 'pilot-kits/v33.32/federated-human-pilot/manifest.json',
 'pilot-kits/v33.32/federated-human-pilot/RUNBOOK.md',
 'pilot-kits/v33.32/federated-human-pilot/PREFLIGHT_CHECKLIST.md',
 'pilot-kits/v33.32/federated-human-pilot/CONSENT_NOTICE_TEMPLATE.md',
 'pilot-kits/v33.32/federated-human-pilot/WITHDRAWAL_AND_DELETION.md',
 'pilot-kits/v33.32/federated-human-pilot/WITNESS_TOPOLOGY.md',
 'pilot-kits/v33.32/federated-human-pilot/ROLE_ASSIGNMENTS_TEMPLATE.json',
 'CLAUDE_HANDOFF_v33_32.md','V33_32_עדכון_ביצוע_והוכחות.md',
 'release-evidence/v33.32/V33_32_FEDERATED_CHECKPOINT_PROOF.json',
 'release-evidence/v33.32/V33_32_WITNESS_POLICY.json',
 'release-evidence/v33.32/V33_32_QUORUM_CERTIFICATE.json',
 'release-evidence/v33.32/V33_32_FEDERATED_ANCHOR.json',
 'release-evidence/v33.32/V33_32_EXECUTION_READINESS.json',
 'release-evidence/v33.32/V33_32_SYNTHETIC_FEDERATED_VERDICT.json',
 'release-evidence/v33.32/V33_32_FOCUSED_TEST_RESULTS.json',
 'release-evidence/v33.32/V33_32_FULL_TEST_RESULTS.json',
 'release-evidence/v33.32/V33_32_DIRECT_V33_RESULTS.json',
 'release-evidence/v33.32/V33_32_REPOSITORY_TRUTH_MAP.json',
 'release-evidence/v33.32/V33_32_ARCHITECTURE_INTEGRITY.json',
]
for path in required: require(path)

try:
    verifier=subprocess.run(['node','scripts/verify-federated-human-pilot-checkpoint-v33_32.mjs'],cwd=ROOT,text=True,capture_output=True,timeout=180)
    add('independent-proof-verifier',verifier.returncode==0,verifier.stdout.strip() if verifier.returncode==0 else (verifier.stderr.strip() or verifier.stdout.strip()))
except Exception as exc: add('independent-proof-verifier',False,str(exc))

if (OUT/'V33_32_FOCUSED_TEST_RESULTS.json').is_file():
    focused=load('release-evidence/v33.32/V33_32_FOCUSED_TEST_RESULTS.json')
    add('focused-regression',focused.get('status')=='passed' and focused.get('totals')=={'tests':118,'passed':118,'failed':0},focused.get('totals'))
if (OUT/'V33_32_FULL_TEST_RESULTS.json').is_file():
    full=load('release-evidence/v33.32/V33_32_FULL_TEST_RESULTS.json')
    add('full-regression',full.get('status')=='passed' and full.get('totals')=={'testFiles':217,'tests':1943,'passed':1943,'failed':0} and full.get('retry') is False and full.get('forceExitDisabled') is True,full.get('totals'))
if (OUT/'V33_32_DIRECT_V33_RESULTS.json').is_file():
    direct=load('release-evidence/v33.32/V33_32_DIRECT_V33_RESULTS.json')
    add('direct-v33-regression',direct.get('status')=='passed' and direct.get('totals')=={'testFiles':32,'tests':776,'passed':776,'failed':0} and direct.get('retry') is False,direct.get('totals'))

proof=load('release-evidence/v33.32/V33_32_FEDERATED_CHECKPOINT_PROOF.json')['payload']
add('proof-boundary',proof.get('externalHumanParticipants')==0 and proof.get('syntheticReferenceParticipants')==5 and proof.get('humanPilotPassed') is False and proof.get('productionAuthority')=='NONE' and proof.get('externalEffectsExecuted')==0 and proof.get('productionPromotion')=='blocked',{'synthetic':proof.get('syntheticReferenceParticipants'),'external':proof.get('externalHumanParticipants'),'humanPilotPassed':proof.get('humanPilotPassed'),'production':proof.get('productionPromotion')})
attacks=proof.get('attacks',{})
add('proof-attacks',len(attacks)==5 and all(str(v).startswith('KILLED') for v in attacks.values()),attacks)
add('program-invariants',proof.get('metricInventoryCount')==54 and proof.get('parameterCount')==14,{'metrics':proof.get('metricInventoryCount'),'parameters':proof.get('parameterCount')})
readiness=load('release-evidence/v33.32/V33_32_EXECUTION_READINESS.json')
add('execution-kit-structural-only',readiness.get('status')=='STRUCTURALLY_READY_EXTERNAL_EXECUTION_NOT_PERFORMED' and readiness.get('structuralChecksPassed') is True and readiness.get('externalExecutionPerformed') is False and readiness.get('externalHumanParticipants')==0 and len(readiness.get('blockers',[]))>=4,{'status':readiness.get('status'),'blockers':readiness.get('blockers')})
verdict=load('release-evidence/v33.32/V33_32_SYNTHETIC_FEDERATED_VERDICT.json')['payload']
add('synthetic-remains-blocked',verdict.get('witnessQuorumVerified') is True and verdict.get('externalProvenanceVerified') is False and verdict.get('externalHumanParticipants')==0 and verdict.get('humanPilotPassed') is False and verdict.get('status')=='HUMAN_UX_PILOT_REQUIRED',{'status':verdict.get('status'),'blockers':verdict.get('blockers')})
cert=load('release-evidence/v33.32/V33_32_QUORUM_CERTIFICATE.json')['payload']
add('three-of-five-quorum',cert.get('quorumRequired')==3 and len(cert.get('witnessVoteDigests',[]))==3 and len(set(cert.get('witnessOrganizationIds',[])))==3 and len(set(cert.get('witnessHostIds',[])))==3,{'quorum':cert.get('quorumRequired'),'votes':len(cert.get('witnessVoteDigests',[]))})

if (OUT/'V33_32_REPOSITORY_TRUTH_MAP.json').is_file():
    truth=load('release-evidence/v33.32/V33_32_REPOSITORY_TRUTH_MAP.json'); inv=truth.get('inventory',{})
    add('repository-truth-map',truth.get('status')=='passed' and inv.get('sourceModules')==221 and inv.get('testFiles')==217 and truth.get('boundaries',{}).get('productionPromotion')=='blocked',inv)
arch=load('release-evidence/v33.32/V33_32_ARCHITECTURE_INTEGRITY.json'); metrics=arch.get('metrics',{})
add('architecture-integrity',arch.get('status')=='PASS' and metrics.get('sourceCycleCount')==0 and metrics.get('untestedSourceCount')==0 and metrics.get('capabilityPathCount')==metrics.get('closedCapabilityPathCount')==157,metrics)

state=load('governance-state/PROGRAM_STATE.json'); action=load('governance-state/NEXT_ACTION.json'); decisions=load('governance-state/OPEN_DECISIONS.json')
add('canonical-governance-version',state.get('version')==action.get('version')==decisions.get('version')=='33.32',{'state':state.get('version'),'action':action.get('version'),'decisions':decisions.get('version')})
add('canonical-governance-boundary',state.get('executionBoundary',{}).get('externalMutation')=='not-authorized' and state.get('executionBoundary',{}).get('productionPromotion')=='blocked' and state.get('readiness')=='Integrated Pilot',state.get('executionBoundary'))
ids={x.get('id') for x in (decisions.get('decisions') or decisions.get('items') or [])}
add('v33.32-open-decisions',{'OD33.32-WITNESS-HOSTS','OD33.32-PILOT-ROLE-OWNERS','OD33.32-PRIVACY-APPROVAL','OD33.32-EPOCH-ROTATION'} <= ids,sorted(x for x in ids if str(x).startswith('OD33.32')))
gates=load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json'); g3=next((g for g in gates.get('gates',[]) if g.get('id')=='G3'),{})
add('g3-registry',gates.get('version')=='33.32' and g3.get('status')=='in-progress' and 'external human participant count remains zero' in g3.get('currentFinding',''),{'version':gates.get('version'),'status':g3.get('status'),'finding':g3.get('currentFinding')})

source=(ROOT/'src/app/federated-human-pilot-checkpoint-v33_32.ts').read_text()
for token in ['verifyFederatedCheckpointTransitionV33_32','v33_32_witness_quorum_not_met','v33_32_checkpoint_non_monotonic','detectFederatedCheckpointEquivocationV33_32','STRUCTURALLY_READY_EXTERNAL_EXECUTION_NOT_PERFORMED','productionAuthority: \'NONE\'']:
    add(f'v33.32-token:{token}',token in source,'present' if token in source else 'missing')

ok=all(x['status']=='passed' for x in checks)
report={'version':'33.32','generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'status':'passed' if ok else 'failed','checksPassed':sum(x['status']=='passed' for x in checks),'checksFailed':sum(x['status']=='failed' for x in checks),'checks':checks,'claims':{'focusedTests':118,'fullTests':1943,'directV33Tests':776,'capabilityPaths':157,'metricInventoryCount':54,'parameterCount':14,'syntheticReferenceParticipants':5,'externalHumanParticipants':0,'humanPilotPassed':False,'productionPromotion':'blocked'}}
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'V33_32_VALIDATION.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'status':report['status'],'checksPassed':report['checksPassed'],'checksFailed':report['checksFailed'],'claims':report['claims']},indent=2,ensure_ascii=False))
sys.exit(0 if ok else 1)
