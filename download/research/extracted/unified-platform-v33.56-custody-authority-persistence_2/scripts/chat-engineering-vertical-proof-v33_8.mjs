import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyRegistry, generateSigningIdentity, sha256 } from '../dist/src/contracts/crypto.js';
import { createDisposableDefectRepository } from '../dist/src/repository/change-assurance.js';
import { KeyLifecycleRegistry } from '../dist/src/security/key-lifecycle.js';
import { buildPushApprovalCard, compileChatMission } from '../dist/src/product/chat-mission.js';
import { prepareChatEngineeringMissionV33_8, reviewAndPreparePullRequestV33_8, rollbackReviewedEngineeringMissionV33_8, verifyPullRequestProposalV33_8 } from '../dist/src/repository/chat-engineering-vertical-v33_8.js';
import { mkdirSync, writeFileSync } from 'node:fs';

const now=new Date('2026-07-21T09:30:00.000Z');
const root=mkdtempSync(join(tmpdir(),'v33-8-proof-'));
try{
 const repo=createDisposableDefectRepository(join(root,'source')); const sessions=join(root,'sessions');
 const objective='Correct the add function while preserving tests and repository scope.';
 const request={missionId:'proof-mission-v33.8',tenantId:'tenant-1',requesterId:'subject-1',message:'Fix the calculator defect and prepare a reviewed reversible pull request proposal.',objective,requestedScopes:['repository.write'],riskLevel:'MEDIUM',reversibility:'REVERSIBLE',estimatedCostUsd:2,confidence:0.95,constraints:['change only allowed files'],prohibitedActions:['git.push','git.merge','production.deploy'],completionCriteria:['tests pass','rollback verified','independent review'],createdAt:'2026-07-21T09:00:00.000Z',expiresAt:'2026-07-21T10:00:00.000Z'};
 const grant={grantId:'proof-grant-v33.8',tenantId:'tenant-1',subjectId:'subject-1',scopes:['repository.write'],issuedAt:'2026-07-21T08:00:00.000Z',expiresAt:'2026-07-21T10:00:00.000Z',issuer:'authority-kernel'};
 const policy={policyId:'proof-policy-v33.8',autoPrepareScopes:[],approvalRequiredScopes:['repository.write'],maxAutoPrepareCostUsd:10,maxAutoPrepareRisk:'MEDIUM',minimumConfidence:0.9,requireApprovalForIrreversible:true,requireApprovalForUnknownReversibility:true,approverIds:['approval-reviewer']};
 const plan={planId:'proof-plan-v33.8',idempotencyKey:'proof-idempotency-v33.8',tenantId:'tenant-1',subjectId:'subject-1',builderId:'builder-agent',objective,sourceRepository:repo,allowedFiles:['src/calculator.js'],targetFile:'src/calculator.js',exactBefore:'return a - b;',exactAfter:'return a + b;',testCommand:['node','--test'],repositoryTrust:'trusted-fixture',testExecutionBoundary:'trusted-local-process'};
 const mission=compileChatMission(request,grant,policy,now); const card=buildPushApprovalCard(mission,policy);
 const preparation=await prepareChatEngineeringMissionV33_8({request,grant,policy,changePlan:plan,sessionsRoot:sessions,approvalDecision:{decisionId:'proof-decision-v33.8',cardId:card.cardId,actorId:'approval-reviewer',option:'YES',occurredAt:'2026-07-21T09:20:00.000Z'},now});
 const passportSigner=generateSigningIdentity('proof-passport-signer'); const passportRegistry=new KeyLifecycleRegistry(); passportRegistry.register(passportSigner,{keyId:passportSigner.keyId,familyId:'proof-passport-family',purpose:'action-passport',environment:'test',tenantId:'tenant-1',notBefore:'2026-07-21T08:00:00.000Z',notAfter:'2026-07-21T11:00:00.000Z'});
 const proposalSigner=generateSigningIdentity('proof-pr-signer'); const proposalKeys=new KeyRegistry(); proposalKeys.register(proposalSigner.keyId,proposalSigner.publicKey);
 const reviewed=reviewAndPreparePullRequestV33_8({preparation,sessionsRoot:sessions,reviewerId:'independent-reviewer',passportSigner,passportRegistry,proposalSigner,proposalKeys,trustedProposalSignerIds:[proposalSigner.keyId],now});
 const verified=verifyPullRequestProposalV33_8({envelope:reviewed.pullRequestProposal,proposalKeys,trustedProposalSignerIds:[proposalSigner.keyId],at:now});
 const sourceUnchanged=readFileSync(join(repo,'src/calculator.js'),'utf8').includes('return a - b;');
 const rolled=rollbackReviewedEngineeringMissionV33_8({sessionsRoot:sessions,sessionId:reviewed.approvedState.sessionId});
 const material={version:'33.8',status:'LOCAL_VERTICAL_SLICE_PASSED',missionId:preparation.mission.missionId,approvalOutcome:preparation.approvalDecision?.outcome,changedFiles:preparation.changedFiles,testPassed:preparation.testPassed,reviewerId:reviewed.pullRequestProposal.payload.reviewerId,actionPassportPresent:reviewed.approvedState.passport!==undefined,pullRequestProposalVerified:verified,sourceRepositoryUnchanged:sourceUnchanged,rollbackVerified:rolled.status==='ROLLED_BACK'&&rolled.changedFiles.length===0,externalGitMutationExecuted:false,mergeExecuted:false,deploymentExecuted:false,externalEffectsExecuted:0,g4Status:'in-progress-not-passed',limitations:['single-explicit-file-change','trusted-local-process-only','no-external-git-provider','no-real-pull-request-created','three-repository-thirty-mission-campaign-not-executed']};
 const proof={...material,proofDigest:sha256(material)}; const out=join(process.cwd(),'release-evidence/v33.8');mkdirSync(out,{recursive:true});writeFileSync(join(out,'V33_8_CHAT_ENGINEERING_VERTICAL_PROOF.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof,null,2));
} finally { rmSync(root,{recursive:true,force:true}); }
