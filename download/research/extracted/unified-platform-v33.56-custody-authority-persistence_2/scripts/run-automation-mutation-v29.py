#!/usr/bin/env python3
from __future__ import annotations
import json, shutil, subprocess, tempfile, time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence/generated'; OUT.mkdir(parents=True,exist_ok=True)
MUTANTS=[
 ('dual-review-bypass','src/operations/governed-automation.js',"if (reviewers.length < 2 || reviewers.includes(input.createdBy))","if (false && (reviewers.length < 2 || reviewers.includes(input.createdBy)))",'tests/governed-automation-v29.test.js','activation rejects self approval, weak quorum, duplicate actions and unsafe budgets'),
 ('proposal-only-action-bypass','src/operations/governed-automation.js',"payload, state: 'PROPOSAL_ONLY', externalMutation: false","payload, state: 'PROPOSAL_ONLY', externalMutation: true",'tests/governed-automation-v29.test.js','dual-reviewed automation produces signed proposal-only actions and modeled value signals'),
 ('persisted-signature-bypass','src/operations/governed-automation.js',"if (!this.keyRegistry.verify(prior.signedRun))","if (false && !this.keyRegistry.verify(prior.signedRun))",'tests/governed-automation-v29.test.js','revoked automation signer invalidates persisted replay rather than silently reusing it'),
 ('event-substitution-bypass','src/operations/governed-automation.js',"if (prior.eventDigest !== eventDigest)","if (false && prior.eventDigest !== eventDigest)",'tests/governed-automation-v29.test.js','file store survives restart, detects event substitution and rejects tampering'),
 ('assistant-required-bypass','src/app/governed-value-delivery.js',"if (request.assistantRequest === undefined)","if (false && request.assistantRequest === undefined)",'tests/value-delivery-integration-v29.test.js','review-requiring automation cannot run without assistant input or with cross-tenant binding'),
 ('unsolicited-assistant-bypass','src/app/governed-value-delivery.js',"else if (request.assistantRequest !== undefined)","else if (false && request.assistantRequest !== undefined)",'tests/value-delivery-integration-v29.test.js','automation without review action rejects unsolicited model invocation'),
 ('external-effect-count-bypass','src/app/governed-value-delivery.js',"externalEffectsExecuted: 0,","externalEffectsExecuted: 1,",'tests/value-delivery-integration-v29.test.js','event-to-automation-to-AI-to-agent-to-operations integration produces one signed review bundle without effects'),
 ('modeled-value-masquerade','src/operations/value-realization.js',"observation.measurementKind === 'MEASURED_LOCAL' && metrics.completionRatePercent >= 80 && benefits.length >= 2 ? 'VALUE_DEMONSTRATED'","metrics.completionRatePercent >= 80 && benefits.length >= 2 ? 'VALUE_DEMONSTRATED'",'tests/value-realization-v29.test.js','modeled benefit remains promising and never masquerades as human measurement'),
 ('bundle-signature-verification-bypass','src/app/governed-value-delivery.js',"if (!this.automation.keyRegistry.verify(automationRun))","if (false && !this.automation.keyRegistry.verify(automationRun))",'tests/value-delivery-integration-v29.test.js','coordinator rejects invalid request binding, time and unregistered review signer'),
]
records=[]
for mid,target,old,new,test,marker in MUTANTS:
    start=time.perf_counter(); temp=Path(tempfile.mkdtemp(prefix=f'v29-mut-{mid}-'))
    try:
        shutil.copytree(ROOT/'dist',temp/'dist')
        path=temp/'dist'/target; text=path.read_text(); count=text.count(old)
        if count!=1:
            records.append({'mutantId':mid,'status':'not-created','matchCount':count,'target':target}); continue
        path.write_text(text.replace(old,new,1))
        try:
            p=subprocess.run(['node','--test',f'dist/{test}'],cwd=temp,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=60)
            observed=marker in p.stdout
            status='killed-authentic' if p.returncode!=0 and observed else ('survived' if p.returncode==0 else 'invalid-kill')
            records.append({'mutantId':mid,'target':target,'test':test,'expectedFailureMarker':marker,'markerObserved':observed,'exitCode':p.returncode,'status':status,'durationMs':round((time.perf_counter()-start)*1000,3),'outputTail':p.stdout[-2400:]})
        except subprocess.TimeoutExpired as exc:
            output=(exc.stdout or '') if isinstance(exc.stdout,str) else ''
            records.append({'mutantId':mid,'target':target,'test':test,'expectedFailureMarker':marker,'markerObserved':marker in output,'exitCode':None,'status':'invalid-kill','durationMs':round((time.perf_counter()-start)*1000,3),'outputTail':output[-2400:],'reason':'timeout_is_not_a_kill'})
    finally:
        shutil.rmtree(temp,ignore_errors=True)
passed=len(records)==len(MUTANTS) and all(r['status']=='killed-authentic' for r in records)
report={'version':'29.0','status':'passed' if passed else 'failed','classification':'targeted-governed-automation-and-value-mutation-with-dedicated-failure-markers','mutantsSpecified':len(MUTANTS),'mutantsKilledAuthentically':sum(r['status']=='killed-authentic' for r in records),'survivors':sum(r['status']=='survived' for r in records),'invalidKills':sum(r['status'] in ('invalid-kill','not-created') for r in records),'records':records,'limitations':['Targeted v29 automation/value mutations supplement rather than replace the retained v27 and v28 security mutation portfolios.','A mutation is accepted only when its dedicated behavioral test title appears in a nonzero test result; timeout and generic process failure are invalid kills.']}
(OUT/'V29_AUTOMATION_MUTATION_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ('status','mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},indent=2))
raise SystemExit(0 if passed else 1)
