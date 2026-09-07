#!/usr/bin/env python3
from __future__ import annotations
import json, shutil, subprocess, tempfile, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'evidence/generated'; OUT.mkdir(parents=True,exist_ok=True)
MUTANTS=[
 ('observed-evidence-bypass','src/qualification/external-evidence.js',"if (envelope.evidenceClass !== 'OBSERVED')","if (false && envelope.evidenceClass !== 'OBSERVED')",'tests/external-qualification-branch-v32_3.test.js','simulated or self-reviewed evidence is rejected'),
 ('independent-reviewer-bypass','src/qualification/external-evidence.js','if (envelope.collectorId === envelope.independentReviewerId)','if (false && envelope.collectorId === envelope.independentReviewerId)','tests/external-qualification-branch-v32_3.test.js','simulated or self-reviewed evidence is rejected'),
 ('signature-verification-bypass','src/qualification/external-evidence.js','if (!envelope.signature.verified)','if (false && !envelope.signature.verified)','tests/external-qualification-branch-v32_3.test.js','simulated or self-reviewed evidence is rejected'),
 ('hsm-private-key-bypass','src/qualification/hsm-kms-qualification.js','if (evidence.privateKeyMaterialEnteredProcess)','if (false && evidence.privateKeyMaterialEnteredProcess)','tests/external-qualification-v32_3.test.js','aggregate gate remains blocked when any one external gate is not qualified'),
 ('hsm-custodian-threshold-bypass','src/qualification/hsm-kms-qualification.js','evidence.independentCustodianCount < evidence.threshold','false && evidence.independentCustodianCount < evidence.threshold','tests/external-qualification-branch-v32_3.test.js','HSM/KMS qualification fails closed across identity, control, threshold and custody failures'),
 ('witness-rollback-bypass','src/qualification/monotonic-witness-qualification.js','if (!evidence.rollbackAttemptRejected)','if (false && !evidence.rollbackAttemptRejected)','tests/external-qualification-branch-v32_3.test.js','witness chain rejects short, non-monotonic, unsigned and tampered receipts'),
 ('witness-tamper-bypass','src/qualification/monotonic-witness-qualification.js','if (receiptDigest !== witnessReceiptDigest(material))','if (false && receiptDigest !== witnessReceiptDigest(material))','tests/external-qualification-branch-v32_3.test.js','witness chain rejects short, non-monotonic, unsigned and tampered receipts'),
 ('postgres-tenant-leak-bypass','src/qualification/postgres-ha-qualification.js','if (evidence.crossTenantLeaksObserved !== 0)','if (false && evidence.crossTenantLeaksObserved !== 0)','tests/external-qualification-branch-v32_3.test.js','PostgreSQL qualification rejects weak topology, leakage and missing recovery controls'),
 ('postgres-failover-bypass','src/qualification/postgres-ha-qualification.js',"[evidence.failoverDuringCommitObserved, 'POSTGRES_FAILOVER_UNOBSERVED']","[true, 'POSTGRES_FAILOVER_UNOBSERVED']",'tests/external-qualification-branch-v32_3.test.js','PostgreSQL qualification rejects weak topology, leakage and missing recovery controls'),
 ('human-synthetic-bypass','src/qualification/human-pilot-qualification.js','if (evidence.outcomes.some((row) => row.synthetic))','if (false && evidence.outcomes.some((row) => row.synthetic))','tests/external-qualification-branch-v32_3.test.js','human pilot rejects protocol-after-start, low sample, no consent and synthetic outcomes'),
 ('review-independence-bypass','src/qualification/independent-review-qualification.js','if (review.reviewerOrganization === review.subjectOrganization || review.conflictOfInterestDeclared)','if (false && (review.reviewerOrganization === review.subjectOrganization || review.conflictOfInterestDeclared))','tests/external-qualification-branch-v32_3.test.js','independent review rejects missing scope, conflicts, unsigned qualified verdict and open findings'),
 ('multihost-splitbrain-bypass','src/qualification/multi-host-slo-qualification.js','if (evidence.splitBrainObserved)','if (false && evidence.splitBrainObserved)','tests/external-qualification-branch-v32_3.test.js','multi-host SLO rejects weak sample, breached thresholds, split brain and stale authorization'),
 ('aggregate-gate-bypass','src/qualification/external-qualification-gate.js',"const status = blockedGateIds.length === 0 ? 'QUALIFIED' : 'BLOCKED';","const status = 'QUALIFIED';",'tests/external-qualification-v32_3.test.js','aggregate gate remains blocked when any one external gate is not qualified'),
]
records=[]
for mid,target,old,new,test,marker in MUTANTS:
    start=time.perf_counter(); temp=Path(tempfile.mkdtemp(prefix=f'v32-3-mut-{mid}-'))
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
report={'version':'32.3','status':'passed' if passed else 'failed','classification':'targeted-external-qualification-evidence-acceptance-mutation','mutantsSpecified':len(MUTANTS),'mutantsKilledAuthentically':sum(r['status']=='killed-authentic' for r in records),'survivors':sum(r['status']=='survived' for r in records),'invalidKills':sum(r['status'] in ('invalid-kill','not-created') for r in records),'records':records,'limitations':['Targeted mutations validate the external qualification acceptance boundary; they do not substitute for real external execution.','Only dedicated behavioral failure markers count as authentic kills.']}
(OUT/'V32_3_EXTERNAL_QUALIFICATION_MUTATION_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ('status','mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},indent=2))
raise SystemExit(0 if passed else 1)
