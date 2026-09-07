#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'release-evidence/v33.31'
checks=[]
def add(name,ok,detail):
    checks.append({'name':name,'status':'passed' if ok else 'failed','detail':detail})
def load(path): return json.loads((ROOT/path).read_text())
def require(path):
    ok=(ROOT/path).is_file(); add(f'file:{path}',ok,'present' if ok else 'missing'); return ok
required=[
 'src/app/external-human-pilot-evidence-import-v33_31.ts',
 'src/app/controlled-human-ux-pilot-v33_30.ts',
 'tests/external-human-pilot-evidence-import-v33_31.test.ts',
 'scripts/external-human-pilot-evidence-import-proof-v33_31.mjs',
 'scripts/verify-external-human-pilot-evidence-import-v33_31.mjs',
 'docs/V33_31_EXTERNAL_HUMAN_PILOT_EVIDENCE_IMPORT.md',
 'pilot-kits/v33.31/external-human-pilot-import/RUNBOOK.md',
 'CLAUDE_HANDOFF_v33_31.md','V33_31_עדכון_ביצוע_והוכחות.md',
 'release-evidence/v33.31/V33_31_EXTERNAL_HUMAN_PILOT_IMPORT_PROOF.json',
 'release-evidence/v33.31/V33_31_SYNTHETIC_IMPORT_RECEIPT.json',
 'release-evidence/v33.31/V33_31_SYNTHETIC_IMPORT_CHECKPOINT.json',
 'release-evidence/v33.31/V33_31_SYNTHETIC_QUALIFICATION_VERDICT.json',
 'release-evidence/v33.31/V33_31_FULL_TEST_RESULTS.json',
 'release-evidence/v33.31/V33_31_DIRECT_V33_RESULTS.json',
 'release-evidence/v33.31/V33_31_REPOSITORY_TRUTH_MAP.json',
 'release-evidence/v33.31/V33_31_ARCHITECTURE_INTEGRITY.json',
]
for path in required: require(path)

try:
    verifier=subprocess.run(['node','scripts/verify-external-human-pilot-evidence-import-v33_31.mjs'],cwd=ROOT,text=True,capture_output=True,timeout=120)
    add('independent-proof-verifier',verifier.returncode==0,verifier.stdout.strip() if verifier.returncode==0 else verifier.stderr.strip())
except Exception as exc: add('independent-proof-verifier',False,str(exc))

full=load('release-evidence/v33.31/V33_31_FULL_TEST_RESULTS.json')
add('full-regression',full.get('status')=='passed' and full.get('totals')=={'testFiles':216,'tests':1899,'passed':1899,'failed':0},full.get('totals'))
direct=load('release-evidence/v33.31/V33_31_DIRECT_V33_RESULTS.json')
add('direct-v33-regression',direct.get('status')=='passed' and direct.get('totals')=={'testFiles':31,'tests':732,'passed':732,'failed':0},direct.get('totals'))
proof=load('release-evidence/v33.31/V33_31_EXTERNAL_HUMAN_PILOT_IMPORT_PROOF.json')['payload']
add('proof-boundary',proof.get('humanPilotPassed') is False and proof.get('externalHumanParticipants')==0 and proof.get('syntheticReferenceParticipants')==5 and proof.get('productionPromotion')=='blocked',{'synthetic':proof.get('syntheticReferenceParticipants'),'external':proof.get('externalHumanParticipants'),'humanPilotPassed':proof.get('humanPilotPassed'),'production':proof.get('productionPromotion')})
add('proof-attacks',proof.get('attackCount')==4 and all(v!='SURVIVED' for v in proof.get('attacks',{}).values()),proof.get('attacks'))
receipt=load('release-evidence/v33.31/V33_31_SYNTHETIC_IMPORT_RECEIPT.json')['payload']
verdict=load('release-evidence/v33.31/V33_31_SYNTHETIC_QUALIFICATION_VERDICT.json')['payload']
add('synthetic-is-not-external',receipt.get('evidenceClass')=='SYNTHETIC_REFERENCE' and receipt.get('status')=='SYNTHETIC_REFERENCE_NOT_EXTERNAL' and receipt.get('externalHumanParticipants')==0,receipt.get('status'))
add('g3-remains-blocked',verdict.get('humanPilotPassed') is False and verdict.get('status')=='HUMAN_UX_PILOT_REQUIRED' and 'external_human_observation_required' in verdict.get('blockers',[]),{'status':verdict.get('status'),'blockers':verdict.get('blockers')})
truth=load('release-evidence/v33.31/V33_31_REPOSITORY_TRUTH_MAP.json')
inv=truth.get('inventory',{})
add('repository-truth-map',truth.get('status')=='passed' and inv.get('sourceModules')==220 and inv.get('testFiles')==216 and truth.get('boundaries',{}).get('productionPromotion')=='blocked',inv)
arch=load('release-evidence/v33.31/V33_31_ARCHITECTURE_INTEGRITY.json')
metrics=arch.get('metrics',{})
add('architecture-integrity',arch.get('status')=='PASS' and metrics.get('sourceCycleCount')==0 and metrics.get('untestedSourceCount')==0 and metrics.get('capabilityPathCount')==metrics.get('closedCapabilityPathCount')==156,metrics)
state=load('governance-state/PROGRAM_STATE.json'); action=load('governance-state/NEXT_ACTION.json'); decisions=load('governance-state/OPEN_DECISIONS.json')
add('canonical-governance-version',state.get('version')==action.get('version')==decisions.get('version')=='33.31' and action.get('qualificationTargetVersion')=='33.31',{'state':state.get('version'),'action':action.get('version'),'decisions':decisions.get('version'),'target':action.get('qualificationTargetVersion')})
add('canonical-governance-boundary',state.get('executionBoundary',{}).get('externalMutation')=='not-authorized' and state.get('executionBoundary',{}).get('productionPromotion')=='blocked' and state.get('readiness')=='Integrated Pilot',state.get('executionBoundary'))
gates=load('v33/governance-state/PROOF_GATE_REGISTRY_V33.json')
g3=next((g for g in gates.get('gates',[]) if g.get('id')=='G3'),{})
add('g3-registry',gates.get('version')=='33.31' and g3.get('status')=='in-progress' and 'external human participant count remains zero' in g3.get('currentFinding',''),{'version':gates.get('version'),'status':g3.get('status')})
source=(ROOT/'src/app/controlled-human-ux-pilot-v33_30.ts').read_text()
add('v33.30-label-shortcut-closed',"external_evidence_provenance_required" in source and "humanPilotPassed = false" in source,'v33.30 requires v33.31 provenance and cannot authoritatively pass')
contracts=(ROOT/'src/app/external-human-pilot-evidence-import-v33_31.ts').read_text()
for token in ['respondExternalHumanPilotRoleChallengeV33_31','external_import_challenge_replay','external_artifact_digest_or_size_invalid','SYNTHETIC_REFERENCE','LIVE_EXTERNAL']:
    add(f'v33.31-token:{token}',token in contracts,'present' if token in contracts else 'missing')

ok=all(x['status']=='passed' for x in checks)
report={'version':'33.31','generatedAt':'2026-07-22T11:45:00.000Z','status':'passed' if ok else 'failed','checksPassed':sum(x['status']=='passed' for x in checks),'checksFailed':sum(x['status']=='failed' for x in checks),'checks':checks,'claims':{'focusedTests':74,'fullTests':1899,'directV33Tests':732,'syntheticReferenceParticipants':5,'externalHumanParticipants':0,'humanPilotPassed':False,'productionPromotion':'blocked'}}
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'V33_31_VALIDATION.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'status':report['status'],'checksPassed':report['checksPassed'],'checksFailed':report['checksFailed'],'claims':report['claims']},indent=2))
sys.exit(0 if ok else 1)
