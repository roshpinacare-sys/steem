#!/usr/bin/env python3
from __future__ import annotations
import json, shutil, subprocess, tempfile, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'evidence/generated'; OUT.mkdir(parents=True,exist_ok=True)
MUTANTS=[
 ('axis-observation-count-bypass','src/validation/excellence-scorecard.js','if (observations.length !== 14)','if (false && observations.length !== 14)','tests/excellence-scorecard-v32_2.test.js','scorecard rejects missing, duplicate and malformed axes'),
 ('axis-blocker-bypass','src/validation/excellence-scorecard.js','observation.blockers.length > 0 ||','false ||','tests/excellence-scorecard-v32_2.test.js','external blockers keep production promotion blocked even with high scores'),
 ('regression-materiality-bypass','src/validation/excellence-scorecard.js','(item.deltaProjectScore ?? 0) < -SCORE_DELTA_MATERIALITY_POINTS || (item.deltaCycleScore ?? 0) < -SCORE_DELTA_MATERIALITY_POINTS','(item.deltaProjectScore ?? 0) < 0 || (item.deltaCycleScore ?? 0) < 0','tests/excellence-scorecard-v32_2.test.js','sub-point score noise is tracked as delta but not a material regression'),
 ('evidence-source-binding-bypass','src/platform/evidence-freshness.js','if (artifact.sourceDigest !== input.currentSourceDigest)','if (false && artifact.sourceDigest !== input.currentSourceDigest)','tests/evidence-freshness-v32_2.test.js','stale, missing, digest and source mismatches are distinguished'),
 ('evidence-artifact-digest-bypass','src/platform/evidence-freshness.js','else if (artifact.actualArtifactDigest !== artifact.recordedArtifactDigest)','else if (false && artifact.actualArtifactDigest !== artifact.recordedArtifactDigest)','tests/evidence-freshness-v32_2.test.js','stale, missing, digest and source mismatches are distinguished'),
 ('complexity-severe-threshold-bypass','src/validation/complexity-budget.js',"const severity = ratio > 1.5 ? 'BLOCK' : 'WARNING';","const severity = false && ratio > 1.5 ? 'BLOCK' : 'WARNING';",'tests/complexity-budget-v32_2.test.js','large excess or broad warning rate blocks'),
 ('complexity-warning-rate-bypass','src/validation/complexity-budget.js','blocks > 0 || warningRatePercent > budget.maximumWarningRatePercent','blocks > 0 || false && warningRatePercent > budget.maximumWarningRatePercent','tests/excellence-branch-matrix-v32_2.test.js','complexity warning-rate block works without severe single finding'),
 ('resilience-critical-open-bypass','src/operations/resilience-coverage.js',"item.critical && item.status === 'OPEN'","false && item.critical && item.status === 'OPEN'",'tests/resilience-coverage-v32_2.test.js','missing or failed critical scenarios block'),
 ('value-evidence-enough-bypass','src/product/value-hypothesis.js','const enough = reasons.length === 0;','const enough = true;','tests/value-hypothesis-v32_2.test.js','modeled value remains pilot-ready and forbids claims'),
 ('value-direction-inversion','src/product/value-hypothesis.js',"item.targetDirection === 'increase' ? item.observedValue >= item.targetValue : item.observedValue <= item.targetValue","item.targetDirection === 'increase' ? item.observedValue <= item.targetValue : item.observedValue >= item.targetValue",'tests/excellence-branch-matrix-v32_2.test.js','increase-direction value target and missing observation branches are exercised'),
 ('performance-regression-bypass','src/operations/performance-budget.js',"status: changePercent > budget.maximumRegressionPercent ? 'BLOCK' : 'PASS'","status: false && changePercent > budget.maximumRegressionPercent ? 'BLOCK' : 'PASS'",'tests/performance-budget-v32_2.test.js','performance regression above budget blocks'),
 ('performance-insufficient-bypass','src/operations/performance-budget.js',"item.status === 'BLOCK' || item.status === 'INSUFFICIENT'","item.status === 'BLOCK' || false && item.status === 'INSUFFICIENT'",'tests/performance-budget-v32_2.test.js','missing or undersampled observations are insufficient and block'),
 ('stability-functional-bypass','src/validation/stability-assurance.js',"if (run.status !== 'passed' || run.timedOut || run.failed !== 0 || run.tests !== input.expectedTests || run.passed !== input.expectedTests)","if (false && (run.status !== 'passed' || run.timedOut || run.failed !== 0 || run.tests !== input.expectedTests || run.passed !== input.expectedTests))",'tests/stability-assurance-v32_2.test.js','failed, timed-out, missing or inventory-drifted runs block'),
]
records=[]
for mid,target,old,new,test,marker in MUTANTS:
    start=time.perf_counter(); temp=Path(tempfile.mkdtemp(prefix=f'v32-2-mut-{mid}-'))
    try:
        shutil.copytree(ROOT/'dist',temp/'dist')
        path=temp/'dist'/target; text=path.read_text(); count=text.count(old)
        if count!=1:
            records.append({'mutantId':mid,'status':'not-created','matchCount':count,'target':target}); continue
        path.write_text(text.replace(old,new,1))
        p=subprocess.run(['node','--test',f'dist/{test}'],cwd=temp,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=60)
        observed=marker in p.stdout
        status='killed-authentic' if p.returncode!=0 and observed else ('survived' if p.returncode==0 else 'invalid-kill')
        records.append({'mutantId':mid,'target':target,'test':test,'expectedFailureMarker':marker,'markerObserved':observed,'exitCode':p.returncode,'status':status,'durationMs':round((time.perf_counter()-start)*1000,3),'outputTail':p.stdout[-2500:]})
    except subprocess.TimeoutExpired as exc:
        output=(exc.stdout or '') if isinstance(exc.stdout,str) else ''
        records.append({'mutantId':mid,'target':target,'test':test,'expectedFailureMarker':marker,'markerObserved':marker in output,'exitCode':None,'status':'invalid-kill','reason':'timeout_is_not_a_kill','outputTail':output[-2500:]})
    finally: shutil.rmtree(temp,ignore_errors=True)
passed=len(records)==len(MUTANTS) and all(r['status']=='killed-authentic' for r in records)
report={'version':'32.2','status':'passed' if passed else 'failed','classification':'targeted-fourteen-axis-excellence-gate-mutation','mutantsSpecified':len(MUTANTS),'mutantsKilledAuthentically':sum(r['status']=='killed-authentic' for r in records),'survivors':sum(r['status']=='survived' for r in records),'invalidKills':sum(r['status'] in ('invalid-kill','not-created') for r in records),'records':records,'limitations':['Targeted mutations supplement retained historical mutation portfolios.','Only dedicated behavioral failure markers count as authentic kills.']}
(OUT/'V32_2_EXCELLENCE_MUTATION_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ('status','mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},indent=2))
raise SystemExit(0 if passed else 1)
