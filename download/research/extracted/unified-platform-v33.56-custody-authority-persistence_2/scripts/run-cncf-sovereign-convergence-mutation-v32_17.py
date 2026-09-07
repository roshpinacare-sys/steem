#!/usr/bin/env python3
from __future__ import annotations
import json, os, subprocess, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('V32_6_RUN_DIR',ROOT/'evidence/generated'));OUT.mkdir(parents=True,exist_ok=True)
TEST='dist/tests/v32_17-causal-controls.test.js'
M=[
('policy-digest','dist/src/platform/sovereign-building-blocks-v32_17.js',"if (manifest.policyDigest !== policy.policyDigest)","if (false)",'causal v32.17 policy digest binding'),
('spiffe-trust-domain','dist/src/platform/sovereign-building-blocks-v32_17.js',"if (!policy.allowedTrustDomains.includes(trustDomain))","if (false)",'causal v32.17 SPIFFE trust-domain binding'),
('private-uds','dist/src/platform/sovereign-building-blocks-v32_17.js',"if (policy.requireUnixDomainSocketForPrivateComponents && manifest.endpoint.transport !== 'unix-domain-socket')","if (false)",'causal v32.17 private UDS transport requirement'),
('reviewer-independence','dist/src/platform/sovereign-building-blocks-v32_17.js',"if (policy.requireIndependentReview && (manifest.publisherId === manifest.reviewerId","if (false && (manifest.publisherId === manifest.reviewerId",'causal v32.17 reviewer independence'),
('external-runtime-evidence','dist/src/platform/sovereign-building-blocks-v32_17.js',"if (manifest.evidenceClass === 'OBSERVED_EXTERNAL' && (!manifest.runtimeQualified || manifest.synthetic))","if (false)",'causal v32.17 external runtime evidence'),
('production-trust-gate','dist/src/platform/sovereign-building-blocks-v32_17.js',"const trustValid = policy.production ? validateProductionTrust(manifest, policy, trust, findings) : false;","const trustValid = true;",'causal v32.17 production trust gate'),
('publisher-authorization','dist/src/platform/sovereign-building-blocks-v32_17.js',"if (authorization === undefined || authorization.authority !== 'EXTERNAL_PINNED')","if (authorization === undefined)",'causal v32.17 publisher authorization'),
('authorization-validity','dist/src/platform/sovereign-building-blocks-v32_17.js',"if (!Number.isFinite(from) || !Number.isFinite(until) || from > evaluatedAt || evaluatedAt > until)","if (false)",'causal v32.17 authorization validity'),
('publisher-signature','dist/src/platform/sovereign-building-blocks-v32_17.js',"if (!trust.registry.verifyAt(trust.publisher, publisher.observedAt))","if (false)",'causal v32.17 publisher signature'),
('reviewer-signature','dist/src/platform/sovereign-building-blocks-v32_17.js',"if (!trust.registry.verifyAt(trust.reviewer, reviewer.reviewedAt))","if (false)",'causal v32.17 reviewer signature'),
('publisher-attestation-lineage','dist/src/platform/sovereign-building-blocks-v32_17.js',"if (publisher.schemaVersion !== '32.17' || publisher.role !== 'PUBLISHER' || publisher.componentId !== manifest.componentId || publisher.manifestDigest !== manifestDigest || publisher.binaryDigest !== manifest.binaryDigest || publisher.sourceDigest !== manifest.sourceDigest || publisher.toolchainDigest !== manifest.toolchainDigest || publisher.policyDigest !== policy.policyDigest || publisher.actorId !== manifest.publisherId || publisher.organizationId !== manifest.publisherOrganizationId || publisher.keyFingerprint !== manifest.publisherKeyFingerprint)","if (false)",'causal v32.17 publisher attestation lineage'),
('reviewer-attestation-lineage','dist/src/platform/sovereign-building-blocks-v32_17.js',"if (reviewer.schemaVersion !== '32.17' || reviewer.role !== 'REVIEWER' || reviewer.componentId !== manifest.componentId || reviewer.manifestDigest !== manifestDigest || reviewer.publisherAttestationDigest !== publisherDigest || reviewer.policyDigest !== policy.policyDigest || reviewer.decision !== 'APPROVE' || reviewer.actorId !== manifest.reviewerId || reviewer.organizationId !== manifest.reviewerOrganizationId || reviewer.keyFingerprint !== manifest.reviewerKeyFingerprint)","if (false)",'causal v32.17 reviewer attestation lineage'),
('attestation-time-order','dist/src/platform/sovereign-building-blocks-v32_17.js',"if (!Number.isFinite(observedAt) || !Number.isFinite(reviewedAt) || observedAt > reviewedAt || reviewedAt > evaluatedAt)","if (false)",'causal v32.17 attestation time order'),
('trust-actor-independence','dist/src/platform/sovereign-building-blocks-v32_17.js',"if (trust.authorizations.length !== 2 || publisherAuthorization?.keyId === reviewerAuthorization?.keyId || publisher.actorId === reviewer.actorId || publisher.organizationId === reviewer.organizationId || publisher.keyFingerprint === reviewer.keyFingerprint)","if (false)",'causal v32.17 trust actor independence'),
('required-block-coverage','dist/src/platform/sovereign-building-blocks-v32_17.js',"if (!policy.requiredBlocks.every((block) => covered.has(block)))","if (false)",'causal v32.17 required-block coverage'),
('organization-diversity','dist/src/platform/sovereign-building-blocks-v32_17.js',"if (organizations.size < policy.minimumDistinctOrganizations)","if (false)",'causal v32.17 organization diversity'),
('concentration-ceiling','dist/src/platform/sovereign-building-blocks-v32_17.js',"if (concentration > policy.maximumSingleComponentCoverage)","if (false)",'causal v32.17 concentration ceiling'),
('rejected-component-exclusion','dist/src/platform/sovereign-building-blocks-v32_17.js',"return admission !== undefined && admission.admission !== 'REJECT';","return admission !== undefined;",'causal v32.17 rejected components excluded'),
('failed-conformance','dist/src/runtime/portable-building-block-harness-v32_17.js',"if (reports.some((report) => report.state !== 'PASSED'))","if (false)",'causal v32.17 failed conformance report'),
('trace-equivalence','dist/src/runtime/portable-building-block-harness-v32_17.js',"if (digests.size !== 1)","if (false)",'causal v32.17 conformance trace equivalence'),
('substitution-coverage','dist/src/app/cncf-sovereign-convergence-v32_17.js',"if (vendorSubstitutionCoverage < 1)","if (false)",'causal v32.17 substitution coverage'),
('rejected-convergence-plan','dist/src/app/cncf-sovereign-convergence-v32_17.js',"if (plan.state === 'REJECTED')","if (false)",'causal v32.17 rejected convergence plan'),
('independent-digest','verifier-only/v32.17/independent_cncf_convergence_verifier.py',"if claimed!=digest(material): findings.append('report-digest-invalid')","if False: findings.append('report-digest-invalid')",'causal v32.17 independent verifier digest'),
('independent-substitution','verifier-only/v32.17/independent_cncf_convergence_verifier.py',"if data.get('vendorSubstitutionCoverage')!=1: findings.append('substitution-coverage-invalid')","if False: findings.append('substitution-coverage-invalid')",'causal v32.17 independent verifier substitution'),
('independent-production-overclaim','verifier-only/v32.17/independent_cncf_convergence_verifier.py',"if data.get('productionQualified') is True and 'dapr-runtime-not-executed-in-current-offline-environment' in data.get('limitations',[]): findings.append('production-overclaim')","if False: findings.append('production-overclaim')",'causal v32.17 independent verifier production overclaim'),
]
def run(pattern):
 return subprocess.run(['node','--test',f'--test-name-pattern={pattern}',TEST],cwd=ROOT,text=True,capture_output=True,timeout=40)
base=subprocess.run(['node','--test',TEST],cwd=ROOT,text=True,capture_output=True,timeout=90)
if base.returncode!=0: raise SystemExit('baseline failed:'+base.stdout+base.stderr)
rows=[]
for name,rel,old,new,test_name in M:
 path=ROOT/rel;original=path.read_text();count=original.count(old)
 if count!=1:
  rows.append({'name':name,'status':'invalid','reason':f'pattern-count:{count}','causalTest':test_name});continue
 path.write_text(original.replace(old,new,1));started=time.monotonic()
 try: result=run(test_name)
 except Exception as exc: result=None;rows.append({'name':name,'status':'invalid','reason':f'runner:{exc}','causalTest':test_name})
 finally: path.write_text(original)
 if result is not None:
  output=result.stdout+result.stderr;marker=f'not ok 1 - {test_name}';killed=result.returncode!=0 and marker in output
  rows.append({'name':name,'status':'killed' if killed else 'survived','returnCode':result.returncode,'durationMs':round((time.monotonic()-started)*1000,3),'causalTest':test_name,'failureObserved':marker in output,'outputTail':output[-1200:]})
report={'version':'32.17','total':len(M),'killed':sum(r['status']=='killed' for r in rows),'survived':sum(r['status']=='survived' for r in rows),'invalid':sum(r['status']=='invalid' for r in rows),'baselinePassed':True,'mutants':rows}
report['status']='passed' if report['killed']==len(M) else 'failed'
(OUT/'V32_17_CNCF_SOVEREIGN_CONVERGENCE_MUTATION_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['status','total','killed','survived','invalid']},indent=2))
if report['status']!='passed':
 for row in rows:
  if row['status']!='killed': print(json.dumps(row,indent=2))
raise SystemExit(0 if report['status']=='passed' else 1)
