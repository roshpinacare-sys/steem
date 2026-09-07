import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { evaluateExecutionLedger } from '../dist/src/validation/execution-ledger-assurance.js';
import { loadGovernanceBundle, validateGovernanceBundle } from '../dist/src/governance/consistency.js';

const root=resolve('.');
const out=resolve(process.env.V32_6_RUN_DIR||(process.env.V32_6_RUN_ID?join('evidence/runs',process.env.V32_6_RUN_ID):'evidence/generated'));
const runId=basename(out);
const identity=JSON.parse(execFileSync('python3',['scripts/test_ops_context_v32_6.py','--identity'],{cwd:root,encoding:'utf8'}));
const ledger=JSON.parse(readFileSync(join(out,'V32_11_EXECUTION_LEDGER.json'),'utf8'));
const requiredSteps=[
  {id:'clean-build',artifacts:['V32_11_BUILD_IDENTITY.json']},
  {id:'full-regression',artifacts:['V32_6_FULL_TEST_RESULTS.json']},
  {id:'local-assurance-mutation-v32.10',artifacts:['V32_10_LOCAL_ASSURANCE_MUTATION_RESULTS.json']},
  {id:'execution-ledger-mutation-v32.11',artifacts:['V32_11_EXECUTION_LEDGER_MUTATION_RESULTS.json']},
  {id:'coverage',artifacts:['V32_COVERAGE_REPORT.json']},
  {id:'test-quality',artifacts:['V32_TEST_QUALITY_AUDIT.json']},
  {id:'architecture',artifacts:['V32_ARCHITECTURE_INTEGRITY.json']},
  {id:'local-assurance',artifacts:['V32_10_LOCAL_ASSURANCE_SUMMARY.json']},
  {id:'external-prerequisites',artifacts:['V32_10_EXTERNAL_PREREQUISITES.json']},
  {id:'prior-final-validation',artifacts:['V32_10_FINAL_VALIDATION.json']},
];
const observations=ledger.steps.flatMap((step)=>step.artifacts.map((artifact)=>{
  const absolute=resolve(root,artifact.path);const bytes=readFileSync(absolute);const stat=statSync(absolute);
  return {path:artifact.path,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,modifiedAt:stat.mtime.toISOString()};
}));
const ledgerAssurance=evaluateExecutionLedger({ledger,expectedVersion:'32.11',expectedRunId:runId,expectedSourceDigest:identity.sourceDigest,expectedRunPrefix:`evidence/runs/${runId}`,requiredSteps,observations,now:new Date().toISOString(),maximumRunAgeMs:3_600_000});
const governance=validateGovernanceBundle(loadGovernanceBundle(resolve(root,'governance-state')),root);
const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const prior=JSON.parse(readFileSync(join(out,'V32_10_FINAL_VALIDATION.json'),'utf8'));
const mutation=JSON.parse(readFileSync(join(out,'V32_11_EXECUTION_LEDGER_MUTATION_RESULTS.json'),'utf8'));
const full=JSON.parse(readFileSync(join(out,'V32_6_FULL_TEST_RESULTS.json'),'utf8'));
const assertions={
  ledgerFreshAndCoherent:ledgerAssurance.status==='PASS',
  exactGovernanceLineage:governance.ok&&governance.version==='32.11',
  releaseMetadataCurrent:pkg.version==='0.20.0'&&/v32\.11/i.test(pkg.description??'')&&!/v32\.9/i.test(pkg.description??''),
  priorAssuranceStillPassed:prior.status==='passed'&&prior.sourceDigest===identity.sourceDigest&&prior.compiledArtifactDigest===identity.compiledArtifactDigest,
  fullRegressionExpanded:full.status==='passed'&&full.failed===0&&full.tests>=890,
  executionLedgerMutationsAuthentic:mutation.status==='passed'&&mutation.mutantsSpecified===9&&mutation.mutantsKilledAuthentically===mutation.mutantsSpecified&&mutation.survivors===0&&mutation.invalidKills===0,
  productionStillBlocked:prior.productionPromotion==='blocked',
};
const status=Object.values(assertions).every(Boolean)?'passed':'failed';
const report={version:'32.11',runId,generatedAt:new Date().toISOString(),status,classification:'release-lineage-and-execution-freshness-assurance',...identity,assertions,ledgerAssurance,governanceFindings:governance.findings,results:{tests:{total:full.tests,passed:full.passed,failed:full.failed},executionLedgerMutations:mutation.mutantsKilledAuthentically,stepsBound:ledgerAssurance.checkedSteps,artifactsBound:ledgerAssurance.checkedArtifacts},readiness:'Validated Integrated Pilot',productionPromotion:'blocked',externalQualification:'not executed',limitations:['The ledger is local trusted-runner evidence and does not create independent external truth.','Filesystem modification times complement artifact hashes and clean-run orchestration; they are not a remote transparency service.','External infrastructure, human and independent review gates remain blocked.']};
writeFileSync(join(out,'V32_11_FINAL_VALIDATION.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(status!=='passed')process.exit(1);
