import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { KeyRegistry, generateSigningIdentity, sha256, sha256Bytes, signEnvelope } from '../src/contracts/crypto.js';
import {
  EphemeralGitCredentialBrokerV33_10,
  EphemeralWebhookSecretBrokerV33_10,
  ExternalGitPermanentErrorV33_10,
  ExternalGitProviderAdapterV33_10,
  ExternalGitTransientErrorV33_10,
  ExternalGitWebhookReceiverV33_10,
  LocalReferenceExternalGitProviderV33_10,
  createExternalGitAdapterManifestV33_10,
  createQualifiedChangeBundleV33_10,
  verifyExternalDraftProposalReceiptV33_10,
  type ExternalGitProviderV33_10,
  type QualifiedChangeBundleV33_10,
  type ReferenceGitFaultV33_10,
} from '../src/repository/external-git-provider-qualification-v33_10.js';
import type { PullRequestProposalV33_9 } from '../src/repository/multi-file-engineering-campaign-v33_9.js';

const now = new Date('2026-07-21T07:30:00.000Z');
const githubSecret='github-webhook-secret-qualification-123456';
const gitlabSecret=`whsec_${Buffer.from('gitlab-webhook-signing-key-qualification').toString('base64')}`;

function proposalFixture(signer=generateSigningIdentity('proposal-signer'),tenantId='tenant-1'){
  const files=[['src/add.js','export const add=(a,b)=>a+b;\n'],['src/multiply.js','export const multiply=(a,b)=>a*b;\n']] as const;
  const fileDigests=files.map(([targetFile,content])=>({targetFile,beforeDigest:sha256(`before:${targetFile}`),afterDigest:sha256Bytes(Buffer.from(content))}));
  const material={version:'33.9' as const,proposalId:'pr-proposal-1',tenantId,missionId:'mission-1',changeSessionId:'session-1',sourceRepositoryDigest:sha256('source'),baseCommit:'a'.repeat(40),proposedHeadRef:'sovereign/mission-1/session-1',title:'Correct arithmetic functions',changedFiles:files.map(([path])=>path),fileDigests,patchDigest:sha256('patch'),rollbackDigest:sha256('rollback'),evidenceRoot:sha256('evidence'),actionPassportDigest:sha256('passport'),reviewerId:'reviewer-1',builderId:'builder-1',requesterId:'requester-1',createdAt:now.toISOString(),promotionCeiling:'shadow' as const,externalGitMutationExecuted:false as const,mergeExecuted:false as const,deploymentExecuted:false as const,externalEffectsExecuted:0 as const};
  const proposal:PullRequestProposalV33_9={...material,proposalDigest:sha256(material)};
  return {signer,envelope:signEnvelope(proposal,signer),files:files.map(([path,content])=>({path,contentBase64:Buffer.from(content).toString('base64'),contentSha256:sha256Bytes(Buffer.from(content)),mode:'100644' as const}))};
}

async function fixture(provider:ExternalGitProviderV33_10,faults:readonly ReferenceGitFaultV33_10[]=[]){
  const proposal=proposalFixture();const proposalKeys=new KeyRegistry();proposalKeys.register(proposal.signer.keyId,proposal.signer.publicKey);
  const receiptSigner=generateSigningIdentity(`receipt-${provider}`);const receiptKeys=new KeyRegistry();receiptKeys.register(receiptSigner.keyId,receiptSigner.publicKey);
  const credentialBroker=new EphemeralGitCredentialBrokerV33_10();const secretBroker=new EphemeralWebhookSecretBrokerV33_10();
  secretBroker.register('github-secret-ref','GITHUB',githubSecret);secretBroker.register('gitlab-secret-ref','GITLAB',gitlabSecret);
  const receiver=new ExternalGitWebhookReceiverV33_10({secretBroker,githubSecretRef:'github-secret-ref',gitlabSecretRef:'gitlab-secret-ref'});const webhookUrl=await receiver.start();
  const repositoryRef=provider==='GITHUB'?'acme/math':'acme/math';const token=`${provider.toLowerCase()}-qualification-token-1234567890`;
  const server=new LocalReferenceExternalGitProviderV33_10({provider,repositoryRef,targetBranch:'main',expectedToken:token,webhookUrl,webhookSecret:provider==='GITHUB'?githubSecret:gitlabSecret,faults});const apiBaseUrl=await server.start();
  const scopes=provider==='GITHUB'?['contents:write','pull_requests:write']:['api:write_repository'];
  credentialBroker.register({credentialRef:`cred-${provider}`,provider,tenantId:'tenant-1',repositoryRef,subjectId:`bot-${provider}`,scopes,issuedAt:'2026-07-21T07:00:00.000Z',expiresAt:'2026-07-21T08:00:00.000Z',token});
  const manifest=createExternalGitAdapterManifestV33_10({adapterId:`adapter-${provider}`,provider,apiBaseUrl,webhookUrl,credentialRef:`cred-${provider}`,webhookSigningSecretRef:provider==='GITHUB'?'github-secret-ref':'gitlab-secret-ref',repositoryRef,targetBranch:'main',requiredCredentialScopes:scopes,requestTimeoutMs:500,maximumRequestBytes:1024*1024,maximumResponseBytes:256*1024});
  const adapter=new ExternalGitProviderAdapterV33_10({manifest,credentialBroker,proposalKeys,trustedProposalSignerIds:[proposal.signer.keyId],webhookReceiver:receiver,receiptSigner});
  const bundle=createQualifiedChangeBundleV33_10({bundleId:`bundle-${provider}`,tenantId:'tenant-1',idempotencyKey:`idem-${provider}`,proposal:proposal.envelope,files:proposal.files,targetBranch:'main',commitMessage:'Correct arithmetic functions',submittedAt:now.toISOString()});
  return{provider,proposal,proposalKeys,receiptSigner,receiptKeys,credentialBroker,secretBroker,receiver,server,manifest,adapter,bundle,async stop(){await server.stop();await receiver.stop();}};
}

test('manifest is loopback-only, draft-only and contains references rather than credentials', async()=>{const f=await fixture('GITHUB');try{const text=JSON.stringify(f.manifest);assert.equal(text.includes('qualification-token'),false);assert.equal(f.manifest.draftOnly,true);assert.equal(f.manifest.mergeAllowed,false);assert.throws(()=>createExternalGitAdapterManifestV33_10({...f.manifest,apiBaseUrl:'https://api.github.com',webhookUrl:f.manifest.webhookUrl} as never),/external_git_api_not_local_qualified/);}finally{await f.stop();}});

test('credential broker exposes descriptors only and enforces tenant repository scope expiry and revocation',()=>{const b=new EphemeralGitCredentialBrokerV33_10();b.register({credentialRef:'c',provider:'GITHUB',tenantId:'t',repositoryRef:'o/r',subjectId:'s',scopes:['contents:write'],issuedAt:'2026-07-21T07:00:00.000Z',expiresAt:'2026-07-21T08:00:00.000Z',token:'secret-token-value-1234567890'});assert.equal(JSON.stringify(b.listDescriptors()).includes('secret-token'),false);assert.throws(()=>b.resolve({credentialRef:'c',provider:'GITHUB',tenantId:'other',repositoryRef:'o/r',requiredScopes:['contents:write'],at:now}),/binding_invalid/);assert.throws(()=>b.resolve({credentialRef:'c',provider:'GITHUB',tenantId:'t',repositoryRef:'o/r',requiredScopes:['pull_requests:write'],at:now}),/scope_missing/);b.revokeAt('c','2026-07-21T07:20:00.000Z');assert.throws(()=>b.resolve({credentialRef:'c',provider:'GITHUB',tenantId:'t',repositoryRef:'o/r',requiredScopes:['contents:write'],at:now}),/credential_revoked/);});

test('GitHub official-shaped flow creates blobs tree commit ref and draft PR with verified webhook',async()=>{const f=await fixture('GITHUB');try{const receipt=await f.adapter.submit(f.bundle,now);assert.equal(verifyExternalDraftProposalReceiptV33_10({envelope:receipt,keys:f.receiptKeys,trustedSignerIds:[f.receiptSigner.keyId],at:now}),true);assert.equal(receipt.payload.draft,true);assert.equal(receipt.payload.realPullRequestCreated,false);assert.equal(f.receiver.list().length,1);const paths=f.server.metrics().trace.map((r)=>r.path);assert.deepEqual(paths,[`/repos/acme/math/branches/main`,`/repos/acme/math/git/blobs`,`/repos/acme/math/git/blobs`,`/repos/acme/math/git/trees`,`/repos/acme/math/git/commits`,`/repos/acme/math/git/refs`,`/repos/acme/math/pulls`]);assert.equal(f.server.metrics().mergeEndpointCalls,0);assert.equal(f.server.metrics().deploymentEndpointCalls,0);}finally{await f.stop();}});

test('GitLab official-shaped flow creates one multi-action commit and Draft merge request with Standard Webhook signature',async()=>{const f=await fixture('GITLAB');try{const receipt=await f.adapter.submit(f.bundle,now);assert.equal(verifyExternalDraftProposalReceiptV33_10({envelope:receipt,keys:f.receiptKeys,trustedSignerIds:[f.receiptSigner.keyId],at:now}),true);assert.equal(f.receiver.list()[0]?.eventName,'Merge Request Hook');const paths=f.server.metrics().trace.map((r)=>r.path);assert.deepEqual(paths,[`/api/v4/projects/acme%2Fmath/repository/branches/main`,`/api/v4/projects/acme%2Fmath/repository/commits`,`/api/v4/projects/acme%2Fmath/merge_requests`]);}finally{await f.stop();}});

test('response loss after draft creation is retryable and provider suppresses duplicate mutations',async()=>{const f=await fixture('GITHUB',['NORMAL','NORMAL','NORMAL','NORMAL','NORMAL','DROP_AFTER_DRAFT_CREATE']);try{await assert.rejects(f.adapter.submit(f.bundle,now),(e)=>e instanceof ExternalGitTransientErrorV33_10);const retry=await f.adapter.submit(f.bundle,new Date('2026-07-21T07:30:01.000Z'));assert.equal(retry.payload.draft,true);const m=f.server.metrics();assert.equal(m.draftObjectsCreated,1);assert.ok(m.duplicateSuppressions>=6);assert.equal(f.receiver.list().length,1);}finally{await f.stop();}});

test('tampered GitHub webhook prevents qualification even when provider object was created locally',async()=>{const f=await fixture('GITHUB',['NORMAL','NORMAL','NORMAL','NORMAL','NORMAL','TAMPER_WEBHOOK']);try{await assert.rejects(f.adapter.submit(f.bundle,now),/external_git_http_400|webhook_timeout/);assert.equal(f.receiver.list().length,0);}finally{await f.stop();}});

test('tampered GitLab webhook prevents qualification',async()=>{const f=await fixture('GITLAB',['NORMAL','TAMPER_WEBHOOK']);try{await assert.rejects(f.adapter.submit(f.bundle,now),/external_git_http_400|webhook_timeout/);assert.equal(f.receiver.list().length,0);}finally{await f.stop();}});

test('redirect is blocked and never followed',async()=>{const f=await fixture('GITHUB',['REDIRECT']);try{await assert.rejects(f.adapter.submit(f.bundle,now),(e)=>e instanceof ExternalGitPermanentErrorV33_10&&e.message==='external_git_redirect_forbidden');}finally{await f.stop();}});

test('provider HTTP 500 is classified transient',async()=>{const f=await fixture('GITHUB',['HTTP_500']);try{await assert.rejects(f.adapter.submit(f.bundle,now),(e)=>e instanceof ExternalGitTransientErrorV33_10&&e.message==='external_git_http_500');}finally{await f.stop();}});

test('malformed and oversized responses fail closed',async()=>{const malformed=await fixture('GITHUB',['MALFORMED_RESPONSE']);try{await assert.rejects(malformed.adapter.submit(malformed.bundle,now),/response_json_invalid/);}finally{await malformed.stop();}const oversized=await fixture('GITHUB',['OVERSIZED_RESPONSE']);try{await assert.rejects(oversized.adapter.submit(oversized.bundle,now),/response_too_large/);}finally{await oversized.stop();}});

test('tampered proposal or bundle digest is rejected before any provider request',async()=>{const f=await fixture('GITHUB');try{const bad={...f.bundle,bundleDigest:'0'.repeat(64)};await assert.rejects(f.adapter.submit(bad,now),/bundle_digest_invalid/);assert.equal(f.server.metrics().requestCount,0);}finally{await f.stop();}});

test('file content must match the after digest in reviewed proposal',async()=>{const f=await fixture('GITHUB');try{const files=[...f.bundle.files];files[0]={...files[0]!,contentBase64:Buffer.from('evil').toString('base64'),contentSha256:sha256Bytes(Buffer.from('evil'))};const changed=createQualifiedChangeBundleV33_10({...f.bundle,files});await assert.rejects(f.adapter.submit(changed,now),/file_digest_invalid/);assert.equal(f.server.metrics().requestCount,0);}finally{await f.stop();}});

test('path traversal duplicate files and head refs outside sovereign prefix are rejected',async()=>{const f=await fixture('GITHUB');try{const traversal=createQualifiedChangeBundleV33_10({...f.bundle,files:[{...f.bundle.files[0]!,path:'../escape'},f.bundle.files[1]!]});await assert.rejects(f.adapter.submit(traversal,now),/file_path_invalid|file_not_proposed/);const {proposalDigest:_,...base}=f.bundle.proposal.payload;const material={...base,proposedHeadRef:'feature/unbounded'};const envelope=signEnvelope({...material,proposalDigest:sha256(material)},f.proposal.signer);const badHead=createQualifiedChangeBundleV33_10({...f.bundle,proposal:envelope});await assert.rejects(f.adapter.submit(badHead,now),/head_prefix_invalid/);}finally{await f.stop();}});

test('receipt and provider metrics never expose credential token',async()=>{const f=await fixture('GITHUB');try{const r=await f.adapter.submit(f.bundle,now);const text=JSON.stringify({receipt:r,metrics:f.server.metrics(),manifest:f.manifest});assert.equal(text.includes('github-qualification-token'),false);assert.equal(r.payload.credentialRef,'cred-GITHUB');}finally{await f.stop();}});

test('credential revocation blocks submission before provider mutation',async()=>{const f=await fixture('GITHUB');try{f.credentialBroker.revokeAt('cred-GITHUB','2026-07-21T07:29:00.000Z');await assert.rejects(f.adapter.submit(f.bundle,now),/credential_revoked/);assert.equal(f.server.metrics().requestCount,0);}finally{await f.stop();}});

test('wrong tenant cannot reuse a credential or reviewed proposal',async()=>{const f=await fixture('GITHUB');try{const changed=createQualifiedChangeBundleV33_10({...f.bundle,tenantId:'tenant-2'});await assert.rejects(f.adapter.submit(changed,now),/bundle_tenant_mismatch/);}finally{await f.stop();}});

test('receipt cannot self-promote G4 or claim a real external pull request',async()=>{const f=await fixture('GITHUB');try{const r=await f.adapter.submit(f.bundle,now);assert.equal(r.payload.g4Eligible,false);assert.equal(r.payload.evidenceClass,'LOCAL_EXTERNAL_GIT_PROVIDER_QUALIFICATION');assert.equal(r.payload.externalGitMutationExecuted,false);assert.equal(r.payload.externalEffectsExecuted,0);}finally{await f.stop();}});
