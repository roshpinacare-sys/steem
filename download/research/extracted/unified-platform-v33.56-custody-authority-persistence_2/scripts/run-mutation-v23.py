#!/usr/bin/env python3
from __future__ import annotations
import json, shutil, subprocess, tempfile, time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence/generated'; OUT.mkdir(parents=True,exist_ok=True)
# Each mutant includes a failure marker that must appear in TAP output. A non-zero
# process exit alone is not accepted as a kill because missing fixtures or runner
# failures would create false mutation evidence.
MUTANTS=[
 ('authority-check-bypass','src/platform/evidence-completeness.js','if (!authorityAllows(input.authority.payload, {','if (false && !authorityAllows(input.authority.payload, {',['tests/evidence-completeness.test.js'],'AUTHORITY_DENIED'),
 ('self-review-bypass','src/platform/evidence-completeness.js','if (reviewers.includes(input.builderId))','if (false && reviewers.includes(input.builderId))',['tests/evidence-completeness.test.js'],'SELF_APPROVAL'),
 ('test-manifest-bypass','src/platform/evidence-completeness.js','if (payload.testManifestDigest !== input.expectedTestManifestDigest)','if (false && payload.testManifestDigest !== input.expectedTestManifestDigest)',['tests/evidence-completeness.test.js'],'TEST_MANIFEST_MISMATCH'),
 ('evidence-replay-bypass','src/platform/evidence-completeness.js','if (input.consumeReplayKey !== false && this.#consumed.has(replayKey))','if (false && input.consumeReplayKey !== false && this.#consumed.has(replayKey))',['tests/evidence-completeness.test.js'],'evidence root can be consumed only once'),
 ('critical-trust-not-revoked','src/platform/capability-trust.js',"const status = severity === 'CRITICAL' ? 'REVOKED'","const status = severity === 'CRITICAL' ? 'TRUSTED'",['tests/capability-trust.test.js','tests/property-invariants-v22.test.js'],'high violation quarantines and critical violation revokes'),
 ('runtime-self-approval-bypass','src/runtime/sqlite-store.js','if (mission.builderId === reviewerId)','if (false && mission.builderId === reviewerId)',['tests/durable.test.js','tests/model-based-v22.test.js'],'approval wait creates no outbox and resumes after independent review'),
 ('idempotency-conflict-bypass','src/runtime/sqlite-store.js','if (receipt.payloadDigest !== payloadDigest)','if (false && receipt.payloadDigest !== payloadDigest)',['tests/durable.test.js'],'idempotency key cannot be reused with different payload'),
 ('runner-authorization-bypass','src/platform/test-execution-provenance.js','if (attestation.issuerKeyId !== claim.runnerId || !expected.authorizedRunnerIds.includes(claim.runnerId))','if (false && (attestation.issuerKeyId !== claim.runnerId || !expected.authorizedRunnerIds.includes(claim.runnerId)))',['tests/test-execution-provenance.test.js'],'RUNNER_UNAUTHORIZED'),
 ('postgres-outbox-substitution-bypass','src/runtime/postgres-store.js','if (sha256(outbox.payload) !== canonicalDigest)','if (false && sha256(outbox.payload) !== canonicalDigest)',['tests/postgres-hardening-v23.test.js'],'completion rejects caller-supplied outbox substitution'),
 ('postgres-claim-owner-bypass','src/runtime/postgres-store.js','if (canonical.claimed_by !== lease.workerId)','if (false && canonical.claimed_by !== lease.workerId)',['tests/postgres-hardening-v23.test.js'],'completion rejects stolen, expired and corrupted canonical claims'),
 ('trust-rollback-bypass','src/security/trust-checkpoint-store.js','if (input.snapshot.epoch < latest.epoch)','if (false && input.snapshot.epoch < latest.epoch)',['tests/key-custody-rollback-v23.test.js'],'monotonic trust checkpoint rejects lower-epoch rollback'),
 ('trust-fork-bypass','src/security/trust-checkpoint-store.js','if (input.snapshot.root !== latest.trustRoot)','if (false && input.snapshot.root !== latest.trustRoot)',['tests/key-custody-rollback-v23.test.js'],'monotonic trust checkpoint rejects a same-epoch fork'),
 ('kms-provider-substitution-bypass','src/security/attested-kms-adapter.js','if (response.provider !== this.provider)','if (false && response.provider !== this.provider)',['tests/key-custody-rollback-v23.test.js'],'attested KMS protocol rejects provider, key, attestation and signature substitution'),
 ('wasm-host-import-bypass','src/isolation/wasm-capability-runner.js','if (allowed.some((item) => !supportedImports.has(item)))','if (false && allowed.some((item) => !supportedImports.has(item)))',['tests/wasm-hardening-v23.test.js'],'capability_host_import_forbidden'),
]
records=[]
for mid,target,old,new,tests,marker in MUTANTS:
    started=time.perf_counter(); td=Path(tempfile.mkdtemp(prefix='v23-mutant-'))
    try:
        shutil.copytree(ROOT/'dist',td/'dist')
        # Static/runtime fixtures are copied so a mutant can be killed only by the
        # intended behavior assertion, never by an absent migration or WASM file.
        for relative in ['infra','isolation']:
            source=ROOT/relative
            if source.exists(): shutil.copytree(source,td/relative)
        path=td/'dist'/target; text=path.read_text(); count=text.count(old)
        if count!=1:
            records.append({'mutantId':mid,'status':'not-created','reason':f'expected one match, found {count}','target':target,'expectedFailureMarker':marker}); continue
        path.write_text(text.replace(old,new,1))
        cmd=['node','--test','--test-concurrency=1','--test-force-exit',*[f'dist/{t}' for t in tests]]
        try:
            result=subprocess.run(cmd,cwd=td,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=55)
            intended = result.returncode != 0 and marker in result.stdout
            status='killed-authentic' if intended else ('survived' if result.returncode==0 else 'invalid-kill')
            records.append({'mutantId':mid,'status':status,'target':target,'tests':tests,'expectedFailureMarker':marker,'markerObserved':marker in result.stdout,'exitCode':result.returncode,'durationMs':round((time.perf_counter()-started)*1000,3),'outputTail':result.stdout[-3500:]})
        except subprocess.TimeoutExpired as exc:
            output=(exc.stdout or '') if isinstance(exc.stdout,str) else ''
            records.append({'mutantId':mid,'status':'invalid-kill','reason':'timeout-not-accepted-as-kill','target':target,'tests':tests,'expectedFailureMarker':marker,'markerObserved':marker in output,'exitCode':124,'durationMs':round((time.perf_counter()-started)*1000,3),'outputTail':output[-3500:]})
    finally: shutil.rmtree(td,ignore_errors=True)
created=[r for r in records if r['status']!='not-created']
authentic=sum(r['status']=='killed-authentic' for r in created)
survived=sum(r['status']=='survived' for r in created)
invalid=sum(r['status']=='invalid-kill' for r in created)
report={'version':'23.0','status':'passed' if created and authentic==len(created) and survived==0 and invalid==0 else 'failed','classification':'executed-source-level-critical-logic-mutation-with-authentic-kill-markers','mutantsCreated':len(created),'mutantsKilledAuthentically':authentic,'mutantsSurvived':survived,'invalidKills':invalid,'mutationScorePercent':round(100*authentic/len(created),2) if created else 0,'records':records,'authenticityRule':'A mutant is killed only when its dedicated behavior-failure marker is present; generic non-zero exits and timeouts are invalid kills.','limitations':['Targeted deterministic mutants, not exhaustive mutation of all source lines.','Equivalent-mutant analysis was manual for the selected operators.']}
(OUT/'V23_MUTATION_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['status','mutantsCreated','mutantsKilledAuthentically','mutantsSurvived','invalidKills','mutationScorePercent']},indent=2))
raise SystemExit(0 if report['status']=='passed' else 1)
