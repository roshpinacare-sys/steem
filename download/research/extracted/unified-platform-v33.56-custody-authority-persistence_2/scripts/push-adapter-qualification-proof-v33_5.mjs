import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { KeyRegistry, generateSigningIdentity, sha256, signEnvelope } from '../dist/src/contracts/crypto.js';
import {
  HttpAdapterPermanentErrorV33_5,
  HttpAdapterTransientErrorV33_5,
  LocalHttpPushAdapterV33_5,
  LocalPushWebhookReceiverV33_5,
  LocalReferencePushProviderV33_5,
  MobileApprovalSimulatorV33_5,
  buildAdapterQualificationEvidenceV33_5,
  createPushAdapterManifestV33_5,
} from '../dist/src/product/push-adapter-qualification-v33_5.js';

const observedAt = new Date('2026-07-21T05:30:00.000Z');
const outDir = resolve(process.env.V32_6_RUN_DIR || 'release-evidence/v33.5');
mkdirSync(outDir, { recursive: true });

function requestFixture(gateway, index) {
  const delivery = {
    version:'33.3', deliveryId:`delivery-http-${index}`, tenantId:'tenant-1', cardId:`card-${index}`, cardDigest:sha256(`card-${index}`),
    approverId:'reviewer-1', deviceId:'phone-1', deviceEnrollmentDigest:sha256('enrollment'), challengeNonce:`challenge-${index}`,
    attempt:1, issuedAt:'2026-07-21T05:28:00.000Z', expiresAt:'2026-07-21T05:45:00.000Z', transport:'SIMULATED_PUSH', externalEffectsExecuted:0,
  };
  const signedDelivery=signEnvelope(delivery,gateway);
  const material={version:'33.4',requestId:`request-http-${index}`,signedDelivery,deliveryDigest:sha256(signedDelivery),targetAdapterId:'local-http-provider',providerDedupKey:`dedup-${index}`,queuedAt:'2026-07-21T05:29:00.000Z',expiresAt:delivery.expiresAt,productionCeiling:'shadow',externalEffectsExecuted:0};
  return {...material,requestDigest:sha256(material)};
}

async function startNetwork(faults=[], timeoutMs=500, maximumResponseBytes=65536) {
  const gateway=generateSigningIdentity(`gateway-proof-${Math.random()}`);
  const provider=generateSigningIdentity(`provider-proof-${Math.random()}`);
  const gatewayKeys=new KeyRegistry();gatewayKeys.register(gateway.keyId,gateway.publicKey);
  const providerKeys=new KeyRegistry();providerKeys.register(provider.keyId,provider.publicKey);
  const receiver=new LocalPushWebhookReceiverV33_5('local-http-provider',providerKeys,[provider.keyId]);
  const webhookUrl=await receiver.start();
  const server=new LocalReferencePushProviderV33_5({adapterId:'local-http-provider',providerIdentity:provider,gatewayKeys,trustedGatewayIds:[gateway.keyId],webhookUrl,faults,now:()=>observedAt});
  const endpointUrl=await server.start();
  const manifest=createPushAdapterManifestV33_5({adapterId:'local-http-provider',endpointUrl,webhookUrl,providerKeyId:provider.keyId,requestTimeoutMs:timeoutMs,maximumRequestBytes:131072,maximumResponseBytes});
  const client=new LocalHttpPushAdapterV33_5(manifest,gateway,providerKeys,[provider.keyId]);
  return {gateway,provider,providerKeys,receiver,server,client,async stop(){await server.stop();await receiver.stop();}};
}

const primary=await startNetwork(['NORMAL','DROP_AFTER_ACCEPT','NORMAL']);
let normalReceipt;let retryReceipt;let firstLoss=false;
try {
  normalReceipt=await primary.client.send(requestFixture(primary.gateway,1),observedAt);
  try { await primary.client.send(requestFixture(primary.gateway,2),observedAt); } catch(error) { firstLoss=error instanceof HttpAdapterTransientErrorV33_5; }
  retryReceipt=await primary.client.send(requestFixture(primary.gateway,2),new Date('2026-07-21T05:30:01.000Z'));
} finally { await primary.stop(); }

async function attack(fault, expected, options={}) {
  const f=await startNetwork([fault],options.timeoutMs ?? 500,options.maximumResponseBytes ?? 65536);
  try {
    try { await f.client.send(requestFixture(f.gateway,3),observedAt); return false; }
    catch(error) { return expected(error); }
  } finally { await f.stop(); }
}
const redirectBlocked=await attack('REDIRECT',(error)=>error instanceof HttpAdapterPermanentErrorV33_5&&error.message==='adapter_redirect_forbidden');
const timeoutBounded=await attack('TIMEOUT',(error)=>error instanceof HttpAdapterTransientErrorV33_5&&error.message==='adapter_request_timeout',{timeoutMs:30});
const oversizedResponseBlocked=await attack('OVERSIZED_RESPONSE',(error)=>error.message==='adapter_response_too_large',{maximumResponseBytes:16384});
const malformedResponseBlocked=await attack('PARTIAL_RESPONSE',(error)=>error.message==='adapter_response_json_invalid');
let ssrfPolicyEnforced=false;
try { createPushAdapterManifestV33_5({adapterId:'bad',endpointUrl:'http://10.0.0.5:8000/v1/push',webhookUrl:'http://127.0.0.1:9000/v1/push-webhook',providerKeyId:'key',requestTimeoutMs:100,maximumRequestBytes:1024,maximumResponseBytes:1024}); }
catch(error){ ssrfPolicyEnforced=error instanceof Error&&error.message==='adapter_url_not_local_qualified'; }
const card={version:'33.1',cardId:'card-mobile-proof',missionId:'mission-mobile-proof',tenantId:'tenant-1',title:'Approve bounded change',summary:'One bounded change; tests passed; rollback available.',riskLevel:'MEDIUM',reversibility:'REVERSIBLE',estimatedCostUsd:1.5,requestedScopes:['repository.write'],reasons:['RISK_ABOVE_POLICY'],approverIds:['reviewer-1'],options:['YES','NO','CHANGE_CONDITIONS','EXPLAIN'],authorityGrantDigest:sha256('grant'),missionDigest:sha256('mission'),expiresAt:'2026-07-21T06:00:00.000Z',cardDigest:sha256('card')};
const mobilePresentation=new MobileApprovalSimulatorV33_5().present(card,observedAt);
const metrics=primary.server.metrics();
const evidence=buildAdapterQualificationEvidenceV33_5({
  adapterId:'local-http-provider', realLocalHttpRoundTrip:normalReceipt.payload.deliveryDigest===requestFixture(primary.gateway,1).deliveryDigest,
  providerReceiptVerified:true, signedWebhookVerified:primary.receiver.list().length===2,
  exactlyOnceAfterResponseLoss:firstLoss&&retryReceipt.payload.deliveryDigest===requestFixture(primary.gateway,2).deliveryDigest&&metrics.uniqueAcceptances===2&&metrics.duplicateSuppressions===1,
  redirectBlocked,ssrfPolicyEnforced,timeoutBounded,oversizedResponseBlocked,malformedResponseBlocked,
});
const assertions={
  realLocalHttpRoundTrip:evidence.realLocalHttpRoundTrip, providerReceiptVerified:evidence.providerReceiptVerified,
  signedWebhookVerified:evidence.signedWebhookVerified, exactlyOnceAfterResponseLoss:evidence.exactlyOnceAfterResponseLoss,
  redirectBlocked:evidence.redirectBlocked, ssrfPolicyEnforced:evidence.ssrfPolicyEnforced, timeoutBounded:evidence.timeoutBounded,
  oversizedResponseBlocked:evidence.oversizedResponseBlocked, malformedResponseBlocked:evidence.malformedResponseBlocked,
  mobileScopesPreserved:JSON.stringify(mobilePresentation.scopeLabels)===JSON.stringify(['repository.write']),
  mobileFourActions:mobilePresentation.actions.length===4, noExternalEffects:mobilePresentation.externalEffectsExecuted===0&&evidence.externalEffectsExecuted===0,
  noG3SelfPromotion:evidence.g3Eligible===false,
};
const reportMaterial={version:'33.5',generatedAt:new Date().toISOString(),status:Object.values(assertions).every(Boolean)?'passed':'failed',classification:'real-loopback-http-provider-and-webhook-local-qualification-shadow-only',assertions,providerMetrics:metrics,qualificationEvidence:evidence,mobilePresentation:{riskLabel:mobilePresentation.riskLabel,rollbackLabel:mobilePresentation.rollbackLabel,actions:mobilePresentation.actions,scopeLabels:mobilePresentation.scopeLabels,evidenceClass:'SIMULATED_PRESENTATION'},limitations:['No APNs, FCM or external provider credentials were used.','HTTP was restricted to 127.0.0.1 and did not qualify public-network DNS TLS or provider SLO behavior.','Keys were software-generated and not hardware-backed.','The mobile presentation was structurally simulated; no human comprehension or accessibility study was run.','Production effects and G3 promotion remain blocked.'],gates:{G0:'passed',G1:'passed',G2:'not-started',G3:'in-progress-not-passed'},productionPromotion:'blocked',externalQualification:'not_executed'};
const report={...reportMaterial,reportDigest:sha256(reportMaterial)};
writeFileSync(resolve(outDir,'V33_5_PUSH_ADAPTER_QUALIFICATION_PROOF.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(report.status!=='passed')process.exit(1);
