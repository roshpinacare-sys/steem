import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { sha256 } from '../dist/src/contracts/crypto.js';

const OUT='evidence/generated'; mkdirSync(OUT,{recursive:true});
const log=readFileSync(`${OUT}/v31-full-suite.log`,'utf8');
const tests=(names)=>names.map((name)=>({name,passed:testPassed(name)}));
const claims=[
  claim('CLAIM-EVIDENCE-BINDING','A supported model claim is bound to selected trusted evidence rather than a free-form reference.','REJECTED_AND_REPAIRED',[
    'supported model claims must bind to selected trusted evidence, not invented or untrusted references',
  ],['src/ai/governed-model-orchestrator.ts'],['The evidence registry reference proves binding and provenance class, not truth of the claim.']),
  claim('CLAIM-SINGLE-FLIGHT','Concurrent retries for one model request invoke the provider once and reuse one signed receipt.','REJECTED_AND_REPAIRED',[
    'concurrent retries are single-flight and return the same persisted signed receipt',
  ],['src/ai/governed-model-orchestrator.ts','src/persistence/sovereign-file-lease.ts'],['Distributed multi-host single-flight still requires a qualified durable coordination backend.']),
  claim('CLAIM-SOVEREIGN-MEASUREMENT','Platform usage and latency evidence is measured at the sovereign boundary; provider self-report remains diagnostic.','REJECTED_AND_REPAIRED',[
    'platform timing and usage remain sovereign while provider self-report is retained only as diagnostics',
    'actual model latency budget is enforced independently of provider-reported latency',
  ],['src/ai/governed-model-orchestrator.ts'],['Single-host timing is not a production SLO.']),
  claim('CLAIM-LEASE-SAFETY','A live lock cannot be stolen based only on age and a holder cannot delete a replacement lock.','REJECTED_AND_REPAIRED',[
    'live sovereign file lease cannot be stolen merely because its mtime is old',
    'dead stale lease is recovered, but a holder never deletes a replacement lease it does not own',
  ],['src/persistence/sovereign-file-lease.ts'],['File leases are local-host coordination, not distributed consensus.']),
  claim('CLAIM-INDEPENDENT-REVIEW','Campaign completion requires credentialed reviewers from independent organizations with tenant/scope/role authority and no conflict of interest.','REJECTED_AND_REPAIRED',[
    'two credentialed reviewers from distinct organizations satisfy independent review',
    'different reviewer keys from the same organization do not satisfy independence',
    'requester and campaign plan signer cannot approve their own campaign result',
    'signed reviewer credential revocation is credential-bound, issuer-authorized and time-effective',
  ],['src/security/reviewer-trust.ts','src/product/engineering-campaign.ts'],['Organizational independence is policy evidence and still requires real-world issuer governance.']),
  claim('CLAIM-PROVIDER-SOVEREIGNTY','A provider invocation is credentialed, egress-bounded, fully attested, replay-protected and revalidated against current revocation.','PROVISIONALLY_ACCEPTED_LOCAL_PROTOCOL',[
    'sovereign provider boundary verifies credential, full input/output binding and records replay proof',
    'egress policy blocks secrets, untrusted context, unknown sources and disclosure budget before provider invocation',
    'persisted external-provider receipt is revalidated after restart and rejected after credential revocation without a second model call',
  ],['src/ai/provider-sovereignty.ts','src/contracts/replay.ts','src/platform/replay-ledger.ts'],['No live external SOL 5.6 or other provider was contacted or qualified.','Attestation proves identity and binding, not model correctness.']),
  claim('CLAIM-PROMPT-INJECTION','Prompt-injection signals are detected and quarantined.','DOWNGRADED_TO_HEURISTIC_DETECTION_WITH_AUTHORITY_CONTAINMENT',[
    'obfuscated prompt-injection families are quarantined while benign untrusted context remains explicitly tainted',
  ],['src/ai/governed-model-orchestrator.ts'],['Detection is heuristic and cannot prove complete prompt-injection detection.','Primary safety comes from proposal-only authority, tool allowlists and independent review.']),
  claim('CLAIM-ZERO-EXTERNAL-EFFECTS','The governed model workflow executes zero external effects.','REJECTED_AND_REPLACED',[
    'provider attestation binds the exact disclosure digest and receipt separates interaction from mutation',
    'verified provider proof propagates into the signed governed model receipt without granting correctness',
  ],['src/ai/provider-sovereignty.ts','src/ai/governed-model-orchestrator.ts'],['Correct replacement claim: zero external mutations; a remote provider invocation is one disclosed external interaction.']),
];
for(const row of claims){row.tests=tests(row.testNames);row.allTestsPassed=row.tests.every((test)=>test.passed);delete row.testNames;}
const status=claims.every((row)=>row.allTestsPassed)?'passed':'failed';
const report={version:'31.0',status,classification:'adversarial-claim-falsification-and-repair',generatedAt:new Date().toISOString(),claims,summary:{claims:claims.length,tests:claims.flatMap((row)=>row.tests).length,passedClaims:claims.filter((row)=>row.allTestsPassed).length,rejectedOrDowngraded:claims.filter((row)=>/REJECTED|DOWNGRADED/.test(row.verdict)).length,provisionallyAccepted:claims.filter((row)=>row.verdict.startsWith('PROVISIONALLY')).length},limitations:['This report proves local code paths and adversarial tests, not external infrastructure, human value or production readiness.'],digest:''};
const { digest: _ignoredDigest, ...digestMaterial } = report; report.digest=sha256(digestMaterial);
writeFileSync(`${OUT}/V31_CLAIM_FALSIFICATION.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,summary:report.summary,digest:report.digest},null,2));
if(status!=='passed')process.exit(1);

function claim(claimId,statement,verdict,testNames,implementationRefs,limitations){return{claimId,statement,verdict,testNames,implementationRefs,limitations,tests:[],allTestsPassed:false};}
function testPassed(name){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp(`^# Subtest: ${escaped}\\n(?:[\\s\\S]{0,400}?)^ok \\d+ - ${escaped}$`,'m').test(log);}
