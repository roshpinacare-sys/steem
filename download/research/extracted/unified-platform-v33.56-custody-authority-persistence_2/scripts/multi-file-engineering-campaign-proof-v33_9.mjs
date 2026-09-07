import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyRegistry, generateSigningIdentity, sha256 } from '../dist/src/contracts/crypto.js';
import { KeyLifecycleRegistry } from '../dist/src/security/key-lifecycle.js';
import {
  ShadowGitProviderV33_9,
  createDisposableMultiFileRepositoryV33_9,
  createShadowGitSubmissionV33_9,
  prepareMultiFileEngineeringMissionV33_9,
  reviewMultiFileMissionV33_9,
  rollbackMultiFileMissionV33_9,
  verifyPullRequestProposalV33_9,
  verifyShadowGitReceiptV33_9,
} from '../dist/src/repository/multi-file-engineering-campaign-v33_9.js';

const now=new Date('2026-07-21T11:00:00.000Z');
const root=mkdtempSync(join(tmpdir(),'v33-9-campaign-'));
try{
  const repos=[0,1,2].map((variant)=>createDisposableMultiFileRepositoryV33_9(join(root,`repo-${variant}`),variant));
  const objective='Correct addition and multiplication defects with tests, evidence, independent review and rollback.';
  const grant={grantId:'campaign-grant-v33.9',tenantId:'tenant-1',subjectId:'subject-1',scopes:['repository.write'],issuedAt:'2026-07-21T10:00:00.000Z',expiresAt:'2026-07-21T13:00:00.000Z',issuer:'authority-kernel'};
  const policy={policyId:'campaign-policy-v33.9',autoPrepareScopes:['repository.write'],approvalRequiredScopes:[],maxAutoPrepareCostUsd:10,maxAutoPrepareRisk:'MEDIUM',minimumConfidence:0.9,requireApprovalForIrreversible:true,requireApprovalForUnknownReversibility:true,approverIds:['approval-reviewer']};
  const passportSigner=generateSigningIdentity('campaign-passport-v33.9');
  const passportRegistry=new KeyLifecycleRegistry();
  passportRegistry.register(passportSigner,{keyId:passportSigner.keyId,familyId:'campaign-passport-family-v33.9',purpose:'action-passport',environment:'test',tenantId:'tenant-1',notBefore:'2026-07-21T10:00:00.000Z',notAfter:'2026-07-21T13:00:00.000Z'});
  const proposalSigner=generateSigningIdentity('campaign-proposal-v33.9');const proposalKeys=new KeyRegistry();proposalKeys.register(proposalSigner.keyId,proposalSigner.publicKey);
  const providerSigner=generateSigningIdentity('campaign-provider-v33.9');const providerKeys=new KeyRegistry();providerKeys.register(providerSigner.keyId,providerSigner.publicKey);
  const provider=new ShadowGitProviderV33_9({storePath:join(root,'provider-state.json'),providerId:'local-shadow-git',adapterId:'git-shadow-v1',signer:providerSigner,providerKeys,proposalKeys,trustedProposalSignerIds:[proposalSigner.keyId],trustedProviderSignerIds:[providerSigner.keyId]});
  const results=[];
  for(let repoIndex=0;repoIndex<repos.length;repoIndex+=1){
    const repo=repos[repoIndex];
    for(let missionIndex=0;missionIndex<10;missionIndex+=1){
      const missionId=`campaign-r${repoIndex+1}-m${missionIndex+1}`;
      const request={missionId,tenantId:'tenant-1',requesterId:'subject-1',message:'Fix both math defects and prepare a reviewed multi-file pull request proposal.',objective,requestedScopes:['repository.write'],riskLevel:'MEDIUM',reversibility:'REVERSIBLE',estimatedCostUsd:3,confidence:0.96,constraints:['change only explicit files'],prohibitedActions:['git.push','git.merge','production.deploy'],completionCriteria:['tests pass','rollback verified','independent review'],createdAt:'2026-07-21T10:30:00.000Z',expiresAt:'2026-07-21T13:00:00.000Z'};
      const plan={planId:`plan-${missionId}`,idempotencyKey:`idem-${missionId}`,tenantId:'tenant-1',subjectId:'subject-1',builderId:'builder-agent',objective,sourceRepository:repo,allowedFiles:['src/add.js','src/multiply.js'],replacements:[{targetFile:'src/add.js',exactBefore:'a - b',exactAfter:'a + b'},{targetFile:'src/multiply.js',exactBefore:'a + b',exactAfter:'a * b'}],testCommand:['node','--test'],repositoryTrust:'trusted-fixture',testExecutionBoundary:'trusted-local-process'};
      const sessions=join(root,'sessions',missionId);
      const preparation=await prepareMultiFileEngineeringMissionV33_9({request,grant,policy,plan,sessionsRoot:sessions,now});
      const reviewed=reviewMultiFileMissionV33_9({preparation,sessionsRoot:sessions,reviewerId:'independent-reviewer',passportSigner,passportRegistry,proposalSigner,proposalKeys,trustedProposalSignerIds:[proposalSigner.keyId],now});
      const proposalVerified=verifyPullRequestProposalV33_9({envelope:reviewed.pullRequestProposal,proposalKeys,trustedProposalSignerIds:[proposalSigner.keyId],at:now});
      const submission=createShadowGitSubmissionV33_9({requestId:`request-${missionId}`,idempotencyKey:`provider-${missionId}`,tenantId:'tenant-1',requesterId:'subject-1',adapterId:'git-shadow-v1',proposal:reviewed.pullRequestProposal,submittedAt:now.toISOString()});
      const receipt=provider.accept(submission,now);const retry=provider.accept(submission,now);
      const receiptVerified=verifyShadowGitReceiptV33_9({envelope:receipt,providerKeys,trustedProviderSignerIds:[providerSigner.keyId],at:now});
      const rolled=rollbackMultiFileMissionV33_9({sessionsRoot:sessions,sessionId:reviewed.approvedState.sessionId});
      results.push({missionId,repositoryIndex:repoIndex+1,changedFiles:preparation.changedFiles,testPassed:preparation.testPassed,proposalVerified,receiptVerified,idempotentRetry:sha256(receipt)===sha256(retry),rollbackVerified:rolled.status==='ROLLED_BACK'&&rolled.changedFiles.length===0,externalEffectsExecuted:receipt.payload.externalEffectsExecuted});
    }
  }
  const sourceRepositoriesUnchanged=repos.every((repo)=>readFileSync(join(repo,'src','add.js'),'utf8').includes('a - b')&&readFileSync(join(repo,'src','multiply.js'),'utf8').includes('a + b'));
  const allPassed=results.length===30&&results.every((row)=>row.changedFiles.length===2&&row.testPassed&&row.proposalVerified&&row.receiptVerified&&row.idempotentRetry&&row.rollbackVerified&&row.externalEffectsExecuted===0)&&sourceRepositoriesUnchanged;
  const material={version:'33.9',status:allPassed?'LOCAL_MULTI_REPOSITORY_CAMPAIGN_PASSED':'FAILED',repositoryCount:repos.length,missionCount:results.length,multiFileMissions:results.filter((row)=>row.changedFiles.length===2).length,testsPassed:results.filter((row)=>row.testPassed).length,independentlyReviewed:results.length,proposalsVerified:results.filter((row)=>row.proposalVerified).length,shadowProviderReceiptsVerified:results.filter((row)=>row.receiptVerified).length,idempotentRetriesVerified:results.filter((row)=>row.idempotentRetry).length,rollbacksVerified:results.filter((row)=>row.rollbackVerified).length,sourceRepositoriesUnchanged,unauthorizedEffects:0,externalGitMutations:0,realPullRequestsCreated:0,mergesExecuted:0,deploymentsExecuted:0,g4Status:'in-progress-not-passed',evidenceClass:'SIMULATED_LOCAL_CAMPAIGN',limitations:['disposable-local-repositories','trusted-local-process-only','shadow-provider-not-external-git-host','no-malicious-repository-campaign','no-independent-external-security-review']};
  const proof={...material,campaignDigest:sha256({material,results})};
  const out=join(process.cwd(),'release-evidence/v33.9');mkdirSync(out,{recursive:true});writeFileSync(join(out,'V33_9_MULTI_FILE_SHADOW_GIT_CAMPAIGN_PROOF.json'),JSON.stringify(proof,null,2)+'\n');writeFileSync(join(out,'V33_9_CAMPAIGN_MISSION_RESULTS.json'),JSON.stringify({version:'33.9',results,resultsDigest:sha256(results)},null,2)+'\n');console.log(JSON.stringify(proof,null,2));if(!allPassed)process.exit(1);
}finally{rmSync(root,{recursive:true,force:true});}
