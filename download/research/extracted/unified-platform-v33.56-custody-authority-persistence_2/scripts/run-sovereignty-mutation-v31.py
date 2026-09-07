#!/usr/bin/env python3
from __future__ import annotations
import json, shutil, subprocess, tempfile, time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence/generated'; OUT.mkdir(parents=True,exist_ok=True)
MUTANTS=[
 ('claim-evidence-binding-bypass','src/ai/governed-model-orchestrator.js',"if (claim.evidenceRefs.some((ref) => !allEvidenceRefs.has(ref)))","if (false && claim.evidenceRefs.some((ref) => !allEvidenceRefs.has(ref)))",'tests/claim-falsification-v31.test.js','supported model claims must bind to selected trusted evidence, not invented or untrusted references'),
 ('trusted-evidence-bypass','src/ai/governed-model-orchestrator.js',"if (claim.classification === 'SUPPORTED' && claim.evidenceRefs.some((ref) => !trustedEvidenceRefs.has(ref)))","if (false && claim.classification === 'SUPPORTED' && claim.evidenceRefs.some((ref) => !trustedEvidenceRefs.has(ref)))",'tests/claim-falsification-v31.test.js','supported model claims must bind to selected trusted evidence, not invented or untrusted references'),
 ('initial-provider-proof-validator-bypass','src/ai/governed-model-orchestrator.js',"if (output.providerBoundaryProof !== undefined && this.adapter.validatePersistedReceipt === undefined)","if (false && output.providerBoundaryProof !== undefined && this.adapter.validatePersistedReceipt === undefined)",'tests/provider-sovereignty-v31.test.js','self-asserted provider proof from an adapter without canonical revalidation is rejected before receipt signing'),
 ('persisted-provider-revalidation-bypass','src/ai/governed-model-orchestrator.js',"this.adapter.validatePersistedReceipt(prior.signedReceipt.payload, now);","void prior.signedReceipt.payload;",'tests/provider-sovereignty-v31.test.js','persisted external-provider receipt is revalidated after restart and rejected after credential revocation without a second model call'),
 ('platform-timing-sovereignty-bypass','src/ai/governed-model-orchestrator.js',"const platformLatencyMs = Number(Math.max(0, performance.now() - monotonicStart).toFixed(3));","const platformLatencyMs = output.usage.latencyMs;",'tests/claim-falsification-v31.test.js','platform timing and usage remain sovereign while provider self-report is retained only as diagnostics'),
 ('live-lease-theft-bypass','src/persistence/sovereign-file-lease.js',"if (record !== undefined && leaseOwnerAlive(record))\n        return;","if (false && record !== undefined && leaseOwnerAlive(record))\n        return;",'tests/claim-falsification-v31.test.js','live sovereign file lease cannot be stolen merely because its mtime is old'),
 ('reviewer-organization-independence-bypass','src/product/engineering-campaign.js',"if (organizations.size < 2)","if (false && organizations.size < 2)",'tests/reviewer-sovereignty-v31.test.js','different reviewer keys from the same organization do not satisfy independence'),
 ('reviewer-credential-binding-bypass','src/product/engineering-campaign.js',"if (payload.reviewerOrganizationId !== authorized.organizationId || payload.reviewerCredentialDigest !== authorized.credentialDigest)","if (false && (payload.reviewerOrganizationId !== authorized.organizationId || payload.reviewerCredentialDigest !== authorized.credentialDigest))",'tests/reviewer-sovereignty-v31.test.js','attestation organization and credential digest are bound to the credential'),
 ('provider-secret-egress-bypass','src/ai/provider-sovereignty.js',"if (looksLikeSecret(item.content))\n            throw new Error('provider_egress_secret_detected');","if (false && looksLikeSecret(item.content))\n            throw new Error('provider_egress_secret_detected');",'tests/provider-sovereignty-v31.test.js','egress policy blocks secrets, untrusted context, unknown sources and disclosure budget before provider invocation'),
 ('provider-output-digest-bypass','src/ai/provider-sovereignty.js',"if (payload.outputDigest !== sha256(response.output))","if (false && payload.outputDigest !== sha256(response.output))",'tests/provider-sovereignty-v31.test.js','provider boundary rejects signature, provider/model, tenant, request, input, policy and output substitution'),
 ('provider-revocation-bypass','src/ai/provider-sovereignty.js',"if (revocation !== undefined && at >= Date.parse(revocation.payload.revokedAt))","if (false && revocation !== undefined && at >= Date.parse(revocation.payload.revokedAt))",'tests/provider-sovereignty-v31.test.js','signed provider credential revocation is credential-bound and blocks later provider use'),
 ('provider-replay-semantic-binding-bypass','src/ai/provider-sovereignty.js',"if (payload.semanticOutputDigest !== sha256({ output: receipt.output, claims: receipt.claims, workGraph: receipt.workGraph }))","if (false && payload.semanticOutputDigest !== sha256({ output: receipt.output, claims: receipt.claims, workGraph: receipt.workGraph }))",'tests/sovereignty-edge-matrix-v31.test.js','provider boundary covers no-verification, invalid clock, identity, semantic digest, disclosure and persisted replay branches'),
 ('deliberation-external-interaction-accounting-bypass','src/ai/governed-deliberation.js',"const externalInteractionsExecuted = receipts.reduce((sum, receipt) => sum + receipt.externalInteractionsExecuted, 0);","const externalInteractionsExecuted = 0;",'tests/external-provider-product-accounting-v31.test.js','external provider interactions are counted through deliberation, campaign and product while mutations remain zero'),
 ('external-mutation-gate-bypass','src/ai/governed-deliberation.js',"if (receipt.status !== 'PROPOSAL_ONLY' || receipt.promotionCeiling !== 'research' || receipt.externalMutationsExecuted !== 0)","if (receipt.status !== 'PROPOSAL_ONLY' || receipt.promotionCeiling !== 'research' || false && receipt.externalMutationsExecuted !== 0)",'tests/external-provider-product-accounting-v31.test.js','deliberation rejects any model receipt that reports an external mutation'),
]
records=[]
for mid,target,old,new,test,marker in MUTANTS:
    start=time.perf_counter(); temp=Path(tempfile.mkdtemp(prefix=f'v31-mut-{mid}-'))
    try:
        shutil.copytree(ROOT/'dist',temp/'dist')
        path=temp/'dist'/target; text=path.read_text(); count=text.count(old)
        if count!=1:
            records.append({'mutantId':mid,'status':'not-created','matchCount':count,'target':target}); continue
        path.write_text(text.replace(old,new,1))
        try:
            p=subprocess.run(['node','--test',f'dist/{test}'],cwd=temp,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=90)
            observed=marker in p.stdout
            status='killed-authentic' if p.returncode!=0 and observed else ('survived' if p.returncode==0 else 'invalid-kill')
            records.append({'mutantId':mid,'target':target,'test':test,'expectedFailureMarker':marker,'markerObserved':observed,'exitCode':p.returncode,'status':status,'durationMs':round((time.perf_counter()-start)*1000,3),'outputTail':p.stdout[-3000:]})
        except subprocess.TimeoutExpired as exc:
            output=(exc.stdout or '') if isinstance(exc.stdout,str) else ''
            records.append({'mutantId':mid,'target':target,'test':test,'expectedFailureMarker':marker,'markerObserved':marker in output,'exitCode':None,'status':'invalid-kill','durationMs':round((time.perf_counter()-start)*1000,3),'outputTail':output[-3000:],'reason':'timeout_is_not_a_kill'})
    finally: shutil.rmtree(temp,ignore_errors=True)
passed=len(records)==len(MUTANTS) and all(r['status']=='killed-authentic' for r in records)
report={'version':'31.0','status':'passed' if passed else 'failed','classification':'targeted-sovereignty-claim-falsification-mutation-with-dedicated-failure-markers','mutantsSpecified':len(MUTANTS),'mutantsKilledAuthentically':sum(r['status']=='killed-authentic' for r in records),'survivors':sum(r['status']=='survived' for r in records),'invalidKills':sum(r['status'] in ('invalid-kill','not-created') for r in records),'records':records,'limitations':['Targeted v31 sovereignty mutations supplement rather than replace retained v22-v30 mutation portfolios.','A mutation is accepted only when its dedicated behavioral test title appears in a nonzero test result; timeouts and generic failures are invalid kills.']}
(OUT/'V31_SOVEREIGNTY_MUTATION_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ('status','mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},indent=2))
raise SystemExit(0 if passed else 1)
