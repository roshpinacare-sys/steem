#!/usr/bin/env python3
from __future__ import annotations
import json, shutil, subprocess, tempfile, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'evidence/generated'; OUT.mkdir(parents=True,exist_ok=True)
TEST='tests/fourteen-axis-optimization-v32_4.test.js'
MUTANTS=[
 ('requirement-rollback-bypass','src/governance/change-impact-gate.js',"if ((item.criticality === 'high' || item.criticality === 'critical') && (item.rollbackRef === undefined || item.rollbackRef.trim() === ''))","if (false && (item.criticality === 'high' || item.criticality === 'critical') && (item.rollbackRef === undefined || item.rollbackRef.trim() === ''))",'requirement fidelity change gate blocks missing proof and conflicts'),
 ('monotonic-regression-bypass','src/validation/invariant-model-checker.js','if (!Number.isFinite(row.monotonicValue) || row.monotonicValue <= monotonic)','if (!Number.isFinite(row.monotonicValue) || false && row.monotonicValue <= monotonic)','invariant checker catches duplicate, regression and illegal transition'),
 ('critical-adversarial-downgrade','src/validation/adversarial-test-planner.js',"const required = target.criticality === 'critical' ? CRITICAL : NORMAL;\n        const missingTechniques","const required = NORMAL;\n        const missingTechniques",'adversarial planner exposes missing techniques and malformed targets'),
 ('wildcard-blast-radius-bypass','src/security/trust-blast-radius.js',"const wildcardGrantCount = active.filter((grant) => grant.tenantIds.includes('*') || grant.scopes.includes('*')).length;","const wildcardGrantCount = active.filter(() => false).length;",'trust blast radius blocks wildcard and non-revocable concentration'),
 ('partial-recovery-bypass','src/platform/crash-consistency-matrix.js',"if (row.recoveredState === 'partial' || row.recoveredState === 'lost')","if (false && (row.recoveredState === 'partial' || row.recoveredState === 'lost'))",'crash consistency matrix catches partial, duplicates and missing points'),
 ('architecture-cycle-bypass','src/validation/architecture-entropy.js',"...(input.cycles > 0 ? [`cycles:${input.cycles}`] : []),","...(false && input.cycles > 0 ? [`cycles:${input.cycles}`] : []),",'architecture entropy blocks cycles, violations and duplicate authority'),
 ('stale-evidence-bypass','src/platform/claim-evidence-closure.js','if (!item.current)','if (false && !item.current)','claim evidence closure rejects cycles, stale and missing evidence'),
 ('p95-budget-bypass','src/operations/product-path-benchmark.js',"...(p95Ms !== null && p95Ms > budget.maximumP95Ms ? ['p95_budget_exceeded'] : []),","...(false && p95Ms !== null && p95Ms > budget.maximumP95Ms ? ['p95_budget_exceeded'] : []),",'product path benchmark blocks missing and exceeded observations'),
 ('reproducibility-field-bypass','src/validation/reproducibility-capsule.js','if (expected[key] !== actual[key])','if (false && expected[key] !== actual[key])','reproducibility capsule identifies field runtime and environment drift'),
 ('recertification-bypass','src/operations/recovery-game-day.js',"...(!scenario.recertified ? ['not_recertified'] : []),","...(false && !scenario.recertified ? ['not_recertified'] : []),",'recovery game day blocks missing controls and RTO breach'),
 ('portability-build-bypass','src/supply-chain/portability-matrix.js',"...(target.build !== 'PASS' ? [`build_${target.build.toLowerCase()}`] : []),","...(false && target.build !== 'PASS' ? [`build_${target.build.toLowerCase()}`] : []),",'portability matrix blocks failed observed target and malformed identity'),
 ('irreversible-confirmation-bypass','src/product/operator-task-flow.js','flow.steps.filter((step) => step.irreversible && !step.confirmation)','flow.steps.filter((step) => false && step.irreversible && !step.confirmation)','operator flow blocks unguarded irreversible actions and expansion'),
 ('review-independence-bypass','src/qualification/qualification-execution-plan.js','if (gate.collectorId === gate.reviewerId)','if (false && gate.collectorId === gate.reviewerId)','qualification execution plan blocks conflicts missing prerequisites and cycles'),
 ('full-suite-escalation-bypass','src/validation/change-verification-plan.js','if (fullSuiteRequired)','if (false && fullSuiteRequired)','change verification plan maps impact and forces full suite for critical change'),
]
records=[]
for mid,target,old,new,marker in MUTANTS:
    start=time.perf_counter(); temp=Path(tempfile.mkdtemp(prefix=f'v32-4-mut-{mid}-'))
    try:
        shutil.copytree(ROOT/'dist',temp/'dist'); path=temp/'dist'/target; text=path.read_text(); count=text.count(old)
        if count!=1: records.append({'mutantId':mid,'status':'not-created','matchCount':count,'target':target}); continue
        path.write_text(text.replace(old,new,1))
        p=subprocess.run(['node','--test',f'dist/{TEST}'],cwd=temp,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=60)
        observed=marker in p.stdout
        status='killed-authentic' if p.returncode!=0 and observed else ('survived' if p.returncode==0 else 'invalid-kill')
        records.append({'mutantId':mid,'target':target,'test':TEST,'expectedFailureMarker':marker,'markerObserved':observed,'exitCode':p.returncode,'status':status,'durationMs':round((time.perf_counter()-start)*1000,3),'outputTail':p.stdout[-2200:]})
    except subprocess.TimeoutExpired as exc:
        output=(exc.stdout or '') if isinstance(exc.stdout,str) else ''
        records.append({'mutantId':mid,'target':target,'test':TEST,'expectedFailureMarker':marker,'markerObserved':marker in output,'exitCode':None,'status':'invalid-kill','reason':'timeout_is_not_a_kill','outputTail':output[-2200:]})
    finally: shutil.rmtree(temp,ignore_errors=True)
passed=len(records)==len(MUTANTS) and all(r['status']=='killed-authentic' for r in records)
report={'version':'32.4','status':'passed' if passed else 'failed','classification':'one-authentic-targeted-mutation-per-excellence-axis','mutantsSpecified':len(MUTANTS),'mutantsKilledAuthentically':sum(r['status']=='killed-authentic' for r in records),'survivors':sum(r['status']=='survived' for r in records),'invalidKills':sum(r['status'] in ('invalid-kill','not-created') for r in records),'records':records,'limitations':['This is a risk-distributed mutation portfolio, not exhaustive mutation of every statement.','Only dedicated behavioral failure markers count as authentic kills.']}
(OUT/'V32_4_ALL_AXIS_MUTATION_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ('status','mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},indent=2))
raise SystemExit(0 if passed else 1)
