import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { KeyRegistry, generateSigningIdentity, sha256, sha256Bytes, signEnvelope } from '../dist/src/contracts/crypto.js';
import {
  EphemeralGitCredentialBrokerV33_10,
  EphemeralWebhookSecretBrokerV33_10,
  ExternalGitProviderAdapterV33_10,
  ExternalGitTransientErrorV33_10,
  ExternalGitWebhookReceiverV33_10,
  LocalReferenceExternalGitProviderV33_10,
  createExternalGitAdapterManifestV33_10,
  createQualifiedChangeBundleV33_10,
  verifyExternalDraftProposalReceiptV33_10,
} from '../dist/src/repository/external-git-provider-qualification-v33_10.js';

const now = new Date('2026-07-21T12:30:00.000Z');
const githubSecret='github-webhook-secret-qualification-123456';
const gitlabSecret=`whsec_${Buffer.from('gitlab-webhook-signing-key-qualification').toString('base64')}`;

function proposalFixture(signer, tenantId='tenant-1'){
  const files=[['src/add.js','export const add=(a,b)=>a+b;\n'],['src/multiply.js','export const multiply=(a,b)=>a*b;\n']];
  const fileDigests=files.map(([targetFile,content])=>({targetFile,beforeDigest:sha256(`before:${targetFile}`),afterDigest:sha256Bytes(Buffer.from(content))}));
  const material={version:'33.9',proposalId:`pr-${signer.keyId}`,tenantId,missionId:'mission-v33.10',changeSessionId:'session-v33.10',sourceRepositoryDigest:sha256('source'),baseCommit:'a'.repeat(40),proposedHeadRef:'sovereign/mission-v33.10/session-v33.10',title:'Correct arithmetic functions',changedFiles:files.map(([path])=>path),fileDigests,patchDigest:sha256('patch'),rollbackDigest:sha256('rollback'),evidenceRoot:sha256('evidence'),actionPassportDigest:sha256('passport'),reviewerId:'independent-reviewer',builderId:'builder-agent',requesterId:'requester-1',createdAt:now.toISOString(),promotionCeiling:'shadow',externalGitMutationExecuted:false,mergeExecuted:false,deploymentExecuted:false,externalEffectsExecuted:0};
  const proposal={...material,proposalDigest:sha256(material)};
  return {signer,envelope:signEnvelope(proposal,signer),files:files.map(([path,content])=>({path,contentBase64:Buffer.from(content).toString('base64'),contentSha256:sha256Bytes(Buffer.from(content)),mode:'100644'}))};
}

async function createFixture(provider,faults=[]){
  const proposal=proposalFixture(generateSigningIdentity(`proposal-${provider}-v33.10`));
  const proposalKeys=new KeyRegistry();proposalKeys.register(proposal.signer.keyId,proposal.signer.publicKey);
  const receiptSigner=generateSigningIdentity(`receipt-${provider}-v33.10`);const receiptKeys=new KeyRegistry();receiptKeys.register(receiptSigner.keyId,receiptSigner.publicKey);
  const credentialBroker=new EphemeralGitCredentialBrokerV33_10();const secretBroker=new EphemeralWebhookSecretBrokerV33_10();
  secretBroker.register('github-secret-ref','GITHUB',githubSecret);secretBroker.register('gitlab-secret-ref','GITLAB',gitlabSecret);
  const receiver=new ExternalGitWebhookReceiverV33_10({secretBroker,githubSecretRef:'github-secret-ref',gitlabSecretRef:'gitlab-secret-ref'});const webhookUrl=await receiver.start();
  const repositoryRef='acme/math';const token=`${provider.toLowerCase()}-qualification-token-1234567890`;
  const server=new LocalReferenceExternalGitProviderV33_10({provider,repositoryRef,targetBranch:'main',expectedToken:token,webhookUrl,webhookSecret:provider==='GITHUB'?githubSecret:gitlabSecret,faults});const apiBaseUrl=await server.start();
  const scopes=provider==='GITHUB'?['contents:write','pull_requests:write']:['api:write_repository'];
  credentialBroker.register({credentialRef:`cred-${provider}`,provider,tenantId:'tenant-1',repositoryRef,subjectId:`bot-${provider}`,scopes,issuedAt:'2026-07-21T12:00:00.000Z',expiresAt:'2026-07-21T13:00:00.000Z',token});
  const manifest=createExternalGitAdapterManifestV33_10({adapterId:`adapter-${provider}`,provider,apiBaseUrl,webhookUrl,credentialRef:`cred-${provider}`,webhookSigningSecretRef:provider==='GITHUB'?'github-secret-ref':'gitlab-secret-ref',repositoryRef,targetBranch:'main',requiredCredentialScopes:scopes,requestTimeoutMs:500,maximumRequestBytes:1024*1024,maximumResponseBytes:256*1024});
  const adapter=new ExternalGitProviderAdapterV33_10({manifest,credentialBroker,proposalKeys,trustedProposalSignerIds:[proposal.signer.keyId],webhookReceiver:receiver,receiptSigner});
  const bundle=createQualifiedChangeBundleV33_10({bundleId:`bundle-${provider}`,tenantId:'tenant-1',idempotencyKey:`idem-${provider}`,proposal:proposal.envelope,files:proposal.files,targetBranch:'main',commitMessage:'Correct arithmetic functions',submittedAt:now.toISOString()});
  return {provider,proposal,receiptSigner,receiptKeys,credentialBroker,receiver,server,manifest,adapter,bundle,token,async stop(){await server.stop();await receiver.stop();}};
}

const results=[];
for(const provider of ['GITHUB','GITLAB']){
  const f=await createFixture(provider);
  try{
    const receipt=await f.adapter.submit(f.bundle,now);
    const metrics=f.server.metrics();
    results.push({provider,receiptVerified:verifyExternalDraftProposalReceiptV33_10({envelope:receipt,keys:f.receiptKeys,trustedSignerIds:[f.receiptSigner.keyId],at:now}),draft:receipt.payload.draft,branchProtectionObserved:receipt.payload.branchProtectionObserved,webhookCount:f.receiver.list().length,webhookSignatureVerified:f.receiver.list().every((x)=>x.signatureVerified),requestCount:metrics.requestCount,uniqueMutations:metrics.uniqueMutations,draftObjectsCreated:metrics.draftObjectsCreated,mergeEndpointCalls:metrics.mergeEndpointCalls,deploymentEndpointCalls:metrics.deploymentEndpointCalls,trace:metrics.trace,credentialExposed:JSON.stringify({manifest:f.manifest,receipt,metrics}).includes(f.token),externalGitMutationExecuted:receipt.payload.externalGitMutationExecuted,realPullRequestCreated:receipt.payload.realPullRequestCreated,externalEffectsExecuted:receipt.payload.externalEffectsExecuted});
  } finally { await f.stop(); }
}

const retryFixture=await createFixture('GITHUB',['NORMAL','NORMAL','NORMAL','NORMAL','NORMAL','DROP_AFTER_DRAFT_CREATE']);
let firstAttemptFailedTransiently=false;let retryReceipt;try{
  try{await retryFixture.adapter.submit(retryFixture.bundle,now);}catch(error){firstAttemptFailedTransiently=error instanceof ExternalGitTransientErrorV33_10;}
  retryReceipt=await retryFixture.adapter.submit(retryFixture.bundle,new Date('2026-07-21T12:30:01.000Z'));
}finally{await retryFixture.stop();}
const retryMetrics=retryFixture.server.metrics();
const retry={firstAttemptFailedTransiently,retrySucceeded:retryReceipt?.payload.draft===true,draftObjectsCreated:retryMetrics.draftObjectsCreated,duplicateSuppressions:retryMetrics.duplicateSuppressions,responseDrops:retryMetrics.responseDrops,webhookCount:retryFixture.receiver.list().length,externalEffectsExecuted:retryReceipt?.payload.externalEffectsExecuted};

const allProvidersPassed=results.length===2&&results.every((r)=>r.receiptVerified&&r.draft&&r.branchProtectionObserved&&r.webhookCount===1&&r.webhookSignatureVerified&&!r.credentialExposed&&r.draftObjectsCreated===1&&r.mergeEndpointCalls===0&&r.deploymentEndpointCalls===0&&r.externalGitMutationExecuted===false&&r.realPullRequestCreated===false&&r.externalEffectsExecuted===0);
const retryPassed=retry.firstAttemptFailedTransiently&&retry.retrySucceeded&&retry.draftObjectsCreated===1&&retry.duplicateSuppressions>=6&&retry.responseDrops===1&&retry.webhookCount===1&&retry.externalEffectsExecuted===0;
const material={version:'33.10',status:allProvidersPassed&&retryPassed?'LOCAL_GITHUB_GITLAB_PROVIDER_QUALIFICATION_PASSED':'FAILED',evidenceClass:'LOCAL_EXTERNAL_GIT_PROVIDER_QUALIFICATION',providerCount:results.length,githubDraftQualified:results.some((r)=>r.provider==='GITHUB'&&r.receiptVerified),gitlabDraftQualified:results.some((r)=>r.provider==='GITLAB'&&r.receiptVerified),signedWebhooksVerified:results.filter((r)=>r.webhookSignatureVerified).length,responseLossRetryVerified:retryPassed,branchProtectionChecksVerified:results.filter((r)=>r.branchProtectionObserved).length,credentialsPersisted:false,credentialsExposed:false,localReferenceProviderMutations:results.reduce((n,r)=>n+r.uniqueMutations,0)+retryMetrics.uniqueMutations,externalGitMutations:0,realPullRequestsCreated:0,mergesExecuted:0,deploymentsExecuted:0,externalEffectsExecuted:0,g4Status:'in-progress-not-passed',productionPromotion:'blocked',externalQualification:'not_executed',limitations:['loopback-reference-servers-only','no-live-github-or-gitlab-credentials','no-real-draft-pr-or-merge-request','no-public-tls-or-provider-webhook-ingress','no-malicious-repository-campaign','no-independent-external-security-review']};
const proof={...material,proofDigest:sha256({material,results,retry})};
const out='release-evidence/v33.10';mkdirSync(out,{recursive:true});
writeFileSync(`${out}/V33_10_EXTERNAL_GIT_PROVIDER_QUALIFICATION_PROOF.json`,JSON.stringify(proof,null,2)+'\n');
writeFileSync(`${out}/V33_10_PROVIDER_REQUEST_TRACES.json`,JSON.stringify({version:'33.10',results,retry,traceDigest:sha256({results,retry})},null,2)+'\n');
console.log(JSON.stringify(proof,null,2));if(proof.status==='FAILED')process.exit(1);
