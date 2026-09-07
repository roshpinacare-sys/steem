#!/usr/bin/env python3
from __future__ import annotations
import json, shutil, subprocess, tempfile, time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence/generated'; OUT.mkdir(parents=True,exist_ok=True)
MUTANTS=[
 ('authority-check-bypass','src/platform/evidence-completeness.js','if (!authorityAllows(input.authority.payload, {','if (false && !authorityAllows(input.authority.payload, {',['tests/evidence-completeness.test.js']),
 ('self-review-bypass','src/platform/evidence-completeness.js','if (reviewers.includes(input.builderId))','if (false && reviewers.includes(input.builderId))',['tests/evidence-completeness.test.js']),
 ('test-manifest-bypass','src/platform/evidence-completeness.js','if (payload.testManifestDigest !== input.expectedTestManifestDigest)','if (false && payload.testManifestDigest !== input.expectedTestManifestDigest)',['tests/evidence-completeness.test.js']),
 ('evidence-replay-bypass','src/platform/evidence-completeness.js','if (input.consumeReplayKey !== false && this.#consumed.has(replayKey))','if (false && input.consumeReplayKey !== false && this.#consumed.has(replayKey))',['tests/evidence-completeness.test.js']),
 ('critical-trust-not-revoked','src/platform/capability-trust.js',"const status = severity === 'CRITICAL' ? 'REVOKED'","const status = severity === 'CRITICAL' ? 'TRUSTED'",['tests/capability-trust.test.js','tests/property-invariants-v22.test.js']),
 ('high-trust-not-quarantined','src/platform/capability-trust.js',": severity === 'HIGH' ? 'QUARANTINED'",": severity === 'HIGH' ? 'TRUSTED'",['tests/capability-trust.test.js']),
 ('runtime-self-approval-bypass','src/runtime/sqlite-store.js','if (mission.builderId === reviewerId)','if (false && mission.builderId === reviewerId)',['tests/durable.test.js','tests/model-based-v22.test.js']),
 ('idempotency-conflict-bypass','src/runtime/sqlite-store.js','if (receipt.payloadDigest !== payloadDigest)','if (false && receipt.payloadDigest !== payloadDigest)',['tests/durable.test.js']),
 ('runner-authorization-bypass','src/platform/test-execution-provenance.js','if (attestation.issuerKeyId !== claim.runnerId || !expected.authorizedRunnerIds.includes(claim.runnerId))','if (false && (attestation.issuerKeyId !== claim.runnerId || !expected.authorizedRunnerIds.includes(claim.runnerId)))',['tests/test-execution-provenance.test.js']),
]
records=[]
for mid,target,old,new,tests in MUTANTS:
    started=time.perf_counter(); td=Path(tempfile.mkdtemp(prefix='v22-mutant-'))
    try:
        shutil.copytree(ROOT/'dist',td/'dist')
        path=td/'dist'/target
        text=path.read_text()
        count=text.count(old)
        if count!=1:
            records.append({'mutantId':mid,'status':'not-created','reason':f'expected one match, found {count}','target':target}); continue
        path.write_text(text.replace(old,new,1))
        cmd=['node','--test','--test-concurrency=1','--test-force-exit',*[f'dist/{t}' for t in tests]]
        try:
            result=subprocess.run(cmd,cwd=td,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=45)
            status='killed' if result.returncode!=0 else 'survived'
            records.append({'mutantId':mid,'status':status,'target':target,'tests':tests,'exitCode':result.returncode,'durationMs':round((time.perf_counter()-started)*1000,3),'outputTail':result.stdout[-3000:]})
        except subprocess.TimeoutExpired as exc:
            records.append({'mutantId':mid,'status':'killed','target':target,'tests':tests,'exitCode':124,'durationMs':round((time.perf_counter()-started)*1000,3),'outputTail':(exc.stdout or '')[-3000:] if isinstance(exc.stdout,str) else ''})
    finally:
        shutil.rmtree(td,ignore_errors=True)
created=[r for r in records if r['status']!='not-created']; killed=sum(r['status']=='killed' for r in created); survived=sum(r['status']=='survived' for r in created)
report={'version':'22.0','status':'passed' if created and survived==0 and killed==len(created) else 'failed','classification':'executed-source-level-critical-logic-mutation','mutantsCreated':len(created),'mutantsKilled':killed,'mutantsSurvived':survived,'mutationScorePercent':round(100*killed/len(created),2) if created else 0,'records':records,'limitations':['Targeted deterministic mutants, not exhaustive mutation of all source lines.','Equivalent-mutant analysis was manual for the selected operators.']}
(OUT/'V22_MUTATION_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['status','mutantsCreated','mutantsKilled','mutantsSurvived','mutationScorePercent']},indent=2))
raise SystemExit(0 if report['status']=='passed' else 1)
