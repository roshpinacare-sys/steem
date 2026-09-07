#!/usr/bin/env python3
from __future__ import annotations
import json, shutil, subprocess, tempfile, time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence/generated'; OUT.mkdir(parents=True,exist_ok=True)
MUTANTS=[
 ('conflict-planning-bypass','src/product/engineering-campaign.js',"if (deliberation.synthesisState === 'CONFLICT_REVIEW_REQUIRED')","if (false && deliberation.synthesisState === 'CONFLICT_REVIEW_REQUIRED')",'tests/deliberation-campaign-branch-v30.test.js','campaign in-memory store, file identifiers, conflict synthesis and empty campaign branches'),
 ('deliberation-authority-bypass','src/product/engineering-campaign.js',"if (deliberation.externalEffectsExecuted !== 0 || deliberation.executionState !== 'REVIEW_REQUIRED')","if (false && (deliberation.externalEffectsExecuted !== 0 || deliberation.executionState !== 'REVIEW_REQUIRED'))",'tests/deliberation-campaign-branch-v30.test.js','campaign validates malformed inputs, policy proof and forbidden-tool branches'),
 ('review-signature-bypass','src/product/engineering-campaign.js',"if (!registry.verify(attestation))","if (false && !registry.verify(attestation))",'tests/deliberation-campaign-branch-v30.test.js','campaign tracker rejects forged, future and duplicate reviewer attestations'),
 ('dual-review-bypass','src/product/engineering-campaign.js',"if (result.reviewerAttestations.length < 2)","if (false && result.reviewerAttestations.length < 2)",'tests/engineering-campaign-v30.test.js','tracker rejects missing evidence, self-like review count and result substitution'),
 ('snapshot-plan-binding-bypass','src/product/engineering-campaign.js',"if (prior.campaignDigest !== plan.campaignDigest)","if (false && prior.campaignDigest !== plan.campaignDigest)",'tests/deliberation-campaign-branch-v30.test.js','campaign tracker rejects snapshot bound to another plan'),
 ('transactional-snapshot-bypass','src/product/engineering-campaign.js',"return withFileLock(this.#path('lock', campaignId), () => this.putSnapshot(campaignId, update(this.getSnapshot(campaignId))));","return this.putSnapshot(campaignId, update(undefined));",'tests/campaign-concurrency-v30.test.js','concurrent workers preserve both independent campaign results'),
 ('aggregate-budget-bypass','src/ai/governed-deliberation.js',"if (aggregateUsage.inputChars > input.aggregateBudget.maxTotalInputChars\n            || aggregateUsage.outputChars > input.aggregateBudget.maxTotalOutputChars\n            || aggregateUsage.latencyMs > input.aggregateBudget.maxTotalLatencyMs)","if (false && (aggregateUsage.inputChars > input.aggregateBudget.maxTotalInputChars\n            || aggregateUsage.outputChars > input.aggregateBudget.maxTotalOutputChars\n            || aggregateUsage.latencyMs > input.aggregateBudget.maxTotalLatencyMs))",'tests/deliberation-campaign-branch-v30.test.js','council covers role gaps, claim classes, tools and all aggregate budget dimensions'),
 ('receipt-authority-bypass','src/ai/governed-deliberation.js',"if (receipt.status !== 'PROPOSAL_ONLY' || receipt.promotionCeiling !== 'research')","if (false && (receipt.status !== 'PROPOSAL_ONLY' || receipt.promotionCeiling !== 'research'))",'tests/deliberation-campaign-branch-v30.test.js','council validates identity, authority, duplicate and malformed submission branches'),
 ('product-deliberation-signature-bypass','src/app/governed-product-completion.js',"if (!this.deliberationRunner.council.keyRegistry.verify(deliberation))","if (false && !this.deliberationRunner.council.keyRegistry.verify(deliberation))",'tests/product-completion-branch-v30.test.js','product completion rejects invalid deliberation signature and identity mismatch'),
 ('product-identity-bypass','src/app/governed-product-completion.js',"if (deliberation.payload.tenantId !== campaign.payload.tenantId || deliberation.payload.subjectId !== campaign.payload.subjectId)","if (false && (deliberation.payload.tenantId !== campaign.payload.tenantId || deliberation.payload.subjectId !== campaign.payload.subjectId))",'tests/product-completion-branch-v30.test.js','product completion rejects invalid deliberation signature and identity mismatch'),
]
records=[]
for mid,target,old,new,test,marker in MUTANTS:
    start=time.perf_counter(); temp=Path(tempfile.mkdtemp(prefix=f'v30-mut-{mid}-'))
    try:
        shutil.copytree(ROOT/'dist',temp/'dist')
        path=temp/'dist'/target; text=path.read_text(); count=text.count(old)
        if count!=1:
            records.append({'mutantId':mid,'status':'not-created','matchCount':count,'target':target}); continue
        path.write_text(text.replace(old,new,1))
        try:
            p=subprocess.run(['node','--test',f'dist/{test}'],cwd=temp,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=75)
            observed=marker in p.stdout
            status='killed-authentic' if p.returncode!=0 and observed else ('survived' if p.returncode==0 else 'invalid-kill')
            records.append({'mutantId':mid,'target':target,'test':test,'expectedFailureMarker':marker,'markerObserved':observed,'exitCode':p.returncode,'status':status,'durationMs':round((time.perf_counter()-start)*1000,3),'outputTail':p.stdout[-2600:]})
        except subprocess.TimeoutExpired as exc:
            output=(exc.stdout or '') if isinstance(exc.stdout,str) else ''
            records.append({'mutantId':mid,'target':target,'test':test,'expectedFailureMarker':marker,'markerObserved':marker in output,'exitCode':None,'status':'invalid-kill','durationMs':round((time.perf_counter()-start)*1000,3),'outputTail':output[-2600:],'reason':'timeout_is_not_a_kill'})
    finally:
        shutil.rmtree(temp,ignore_errors=True)
passed=len(records)==len(MUTANTS) and all(r['status']=='killed-authentic' for r in records)
report={'version':'30.0','status':'passed' if passed else 'failed','classification':'targeted-governed-deliberation-campaign-product-completion-mutation-with-dedicated-failure-markers','mutantsSpecified':len(MUTANTS),'mutantsKilledAuthentically':sum(r['status']=='killed-authentic' for r in records),'survivors':sum(r['status']=='survived' for r in records),'invalidKills':sum(r['status'] in ('invalid-kill','not-created') for r in records),'records':records,'limitations':['Targeted v30 campaign mutations supplement rather than replace retained v27-v29 security and automation portfolios.','A mutation is accepted only when its dedicated behavioral test title appears in a nonzero test result; timeouts and generic failures are invalid kills.']}
(OUT/'V30_CAMPAIGN_MUTATION_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ('status','mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},indent=2))
raise SystemExit(0 if passed else 1)
