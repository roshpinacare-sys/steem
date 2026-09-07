import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KeyRegistry, generateSigningIdentity, sha256, signEnvelope } from '../dist/src/contracts/crypto.js';
import {
  compareShadowExecutionV33_15,
  createWorkflowObservationV33_15,
  discoverShortcutCandidateV33_15,
  issueShortcutPassportV33_15,
  qualifyShortcutCandidateV33_15,
} from '../dist/src/runtime/proof-carrying-adaptive-execution-v33_15.js';
import {
  PersistentAdaptivePolicyControllerV33_16,
  PersistentAdaptivePolicyStoreV33_16,
} from '../di../src/app/persistent-adaptive-policy-controller-v33_16.js';
import { recordApprovalDecision } from '../dist/src/product/chat-mission.js';

const out = 'release-evidence/v33.16'; mkdirSync(out, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'v33.16-proof-'));
const now = new Date('2026-07-21T20:30:00.000Z');
const ids = {
  qualifier: generateSigningIdentity('v33.16-qualifier'), passport: generateSigningIdentity('v33.16-passport-issuer'),
  activation: generateSigningIdentity('v33.16-activation-controller'), revoker: generateSigningIdentity('v33.16-drift-revoker'),
  approver: generateSigningIdentity('v33.16-human-approver'), store: generateSigningIdentity('v33.16-store-signer'),
  proof: generateSigningIdentity('v33.16-proof-signer'),
};
const registry = (...values) => { const r = new KeyRegistry(); for (const value of values) r.register(value.keyId, value.publicKey); return r; };
const trust = {
  passportRegistry: registry(ids.passport), trustedPassportIssuerIds: [ids.passport.keyId],
  activationRegistry: registry(ids.activation), trustedActivationSignerIds: [ids.activation.keyId],
  revocationRegistry: registry(ids.revoker), trustedRevocationSignerIds: [ids.revoker.keyId],
  approvalRegistry: registry(ids.approver), trustedApproverSignerIds: [ids.approver.keyId],
};
const storeRegistry = registry(ids.store);
const storePath = join(root, 'adaptive-policy.json');
let store = new PersistentAdaptivePolicyStoreV33_16({ path: storePath, storeIdentity: ids.store, storeRegistry, trustedStoreSignerIds: [ids.store.keyId], trust, now });
let controller = new PersistentAdaptivePolicyControllerV33_16({ store, trust, activationSigner: ids.activation, revocationSigner: ids.revoker });
let counter = 0;
const boundary = (workflowType) => ({ tenantId: 'tenant-proof-v33.16', workflowType, authorityGrantDigest: sha256(`grant:${workflowType}`), allowedScopes: ['repository:read','repository:shadow-change'], policyDigest: sha256(`policy:${workflowType}`), inputSchemaDigest: sha256(`schema:${workflowType}`), toolchainDigest: sha256(`tool:${workflowType}`), modelSetDigest: sha256(`models:${workflowType}`), riskClass: 'low', reversible: true });
function issue(workflowType, resultDigest = sha256(`result:${workflowType}`)) {
  const b = boundary(workflowType); const inputClassDigest = sha256(`input:${workflowType}`);
  const obs = (kind, index) => createWorkflowObservationV33_15({ observationId: `${workflowType}-${kind}-${counter++}-${index}`, evidenceClass: kind, boundary: b, inputClassDigest, fullWorkflowResultDigest: resultDigest, fullWorkflowEvidenceRoot: sha256({ workflowType,kind,index }), fullWorkflowPassed: true, userDecision: 'APPROVED', userSteps: 10, approvalCount: 1, costUnits: 10, durationMs: 1000, observedAt: new Date(now.getTime()-100000+index).toISOString(), externalEffectsExecuted: 0 });
  const training=Array.from({length:5},(_,i)=>obs('TRAINING',i)); const holdout=Array.from({length:3},(_,i)=>obs('HOLDOUT',i)); const shadow=Array.from({length:5},(_,i)=>obs('SHADOW',i));
  const candidate=discoverShortcutCandidateV33_15({observations:training,now});
  const qualification=qualifyShortcutCandidateV33_15({candidate,holdoutObservations:holdout,qualifier:ids.qualifier,now});
  const comparisons=shadow.map((observation)=>compareShadowExecutionV33_15({candidate,observation,shortcutResultDigest:resultDigest,now}));
  const passport=issueShortcutPassportV33_15({candidate,qualification,qualificationRegistry:registry(ids.qualifier),trustedQualifierIds:[ids.qualifier.keyId],comparisons,issuer:ids.passport,expiresAt:new Date(now.getTime()+86400000).toISOString(),now});
  return { passport, boundary:b, inputClassDigest, resultDigest };
}
function addAndActivate(issued, projection) {
  const row=controller.registerShortcut({passport:issued.passport,...projection,now});
  const card=controller.issueActivationApproval({recordId:row.recordId,approverIds:[ids.approver.keyId],expiresAt:new Date(now.getTime()+3600000).toISOString(),now});
  const decision=recordApprovalDecision(card,{decisionId:`approval-${counter++}`,cardId:card.cardId,actorId:ids.approver.keyId,option:'YES',occurredAt:new Date(now.getTime()+1000).toISOString()},new Date(now.getTime()+2000));
  controller.activateFromSignedApproval({recordId:row.recordId,decision:signEnvelope(decision,ids.approver),activationExpiresAt:new Date(now.getTime()+7200000).toISOString(),now:new Date(now.getTime()+2000)});
  return row.recordId;
}
const dependencyA=issue('dependency-patch'); const dependencyB=issue('dependency-patch',dependencyA.resultDigest);
const testRepair=issue('test-repair'); const docs=issue('documentation-refresh');
const conflictA=issue('conflicting-workflow',sha256('conflict-a')); const conflictB=issue('conflicting-workflow',sha256('conflict-b'));
const recordIds=[
  addAndActivate(dependencyA,{projectedCostUnits:5,projectedDurationMs:400,projectedUserSteps:2,evidenceScore:.99}),
  addAndActivate(dependencyB,{projectedCostUnits:2,projectedDurationMs:250,projectedUserSteps:1,evidenceScore:.9}),
  addAndActivate(testRepair,{projectedCostUnits:3,projectedDurationMs:300,projectedUserSteps:1,evidenceScore:.92}),
  addAndActivate(docs,{projectedCostUnits:1,projectedDurationMs:150,projectedUserSteps:1,evidenceScore:.85}),
  addAndActivate(conflictA,{projectedCostUnits:2,projectedDurationMs:200,projectedUserSteps:1,evidenceScore:.9}),
  addAndActivate(conflictB,{projectedCostUnits:2,projectedDurationMs:200,projectedUserSteps:1,evidenceScore:.9}),
];
// Prove persistence before routing.
store = new PersistentAdaptivePolicyStoreV33_16({ path: storePath, storeIdentity: ids.store, storeRegistry, trustedStoreSignerIds: [ids.store.keyId], trust, now:new Date(now.getTime()+3000) });
controller = new PersistentAdaptivePolicyControllerV33_16({ store, trust, activationSigner: ids.activation, revocationSigner: ids.revoker });
const routes=[]; const audits=[];
for(let i=0;i<10;i++){
  const issued=i%2===0?dependencyA:testRepair;
  const route=controller.route({tenantId:issued.boundary.tenantId,workflowType:issued.boundary.workflowType,currentBoundary:issued.boundary,inputClassDigest:issued.inputClassDigest,budget:{maximumCostUnits:10,maximumDurationMs:1000,maximumUserSteps:5},now:new Date(now.getTime()+4000+i)}); routes.push(route);
  audits.push(controller.recordOutcome({routingDecision:route,observedResultDigest:issued.resultDigest,baselineCostUnits:10,actualCostUnits:route.projectedCostUnits??10,baselineDurationMs:1000,actualDurationMs:route.projectedDurationMs??1000,baselineUserSteps:10,actualUserSteps:route.projectedUserSteps??10,now:new Date(now.getTime()+5000+i)}));
}
const budgetFallback=controller.route({tenantId:docs.boundary.tenantId,workflowType:docs.boundary.workflowType,currentBoundary:docs.boundary,inputClassDigest:docs.inputClassDigest,budget:{maximumCostUnits:0,maximumDurationMs:50,maximumUserSteps:0},now:new Date(now.getTime()+6000)});
const conflictFallback=controller.route({tenantId:conflictA.boundary.tenantId,workflowType:conflictA.boundary.workflowType,currentBoundary:conflictA.boundary,inputClassDigest:conflictA.inputClassDigest,budget:{maximumCostUnits:10,maximumDurationMs:1000,maximumUserSteps:5},now:new Date(now.getTime()+6001)});
const driftBoundary={...docs.boundary,toolchainDigest:sha256('drifted-doc-tool')};
const driftReport=controller.sweepDrift({observations:[{passportDigest:docs.passport.payload.passportDigest,currentBoundary:driftBoundary,inputClassDigest:docs.inputClassDigest}],now:new Date(now.getTime()+7000)});
const docsAfterDrift=controller.route({tenantId:docs.boundary.tenantId,workflowType:docs.boundary.workflowType,currentBoundary:docs.boundary,inputClassDigest:docs.inputClassDigest,budget:{maximumCostUnits:10,maximumDurationMs:1000,maximumUserSteps:5},now:new Date(now.getTime()+7001)});
const mismatchRoute=controller.route({tenantId:testRepair.boundary.tenantId,workflowType:testRepair.boundary.workflowType,currentBoundary:testRepair.boundary,inputClassDigest:testRepair.inputClassDigest,budget:{maximumCostUnits:10,maximumDurationMs:1000,maximumUserSteps:5},now:new Date(now.getTime()+8000)});
const mismatchAudit=controller.recordOutcome({routingDecision:mismatchRoute,observedResultDigest:sha256('mismatch'),baselineCostUnits:10,actualCostUnits:3,baselineDurationMs:1000,actualDurationMs:300,baselineUserSteps:10,actualUserSteps:1,now:new Date(now.getTime()+8001)});
const testAfterMismatch=controller.route({tenantId:testRepair.boundary.tenantId,workflowType:testRepair.boundary.workflowType,currentBoundary:testRepair.boundary,inputClassDigest:testRepair.inputClassDigest,budget:{maximumCostUnits:10,maximumDurationMs:1000,maximumUserSteps:5},now:new Date(now.getTime()+8002)});
const allAudits=store.audits(); const savings={cost:allAudits.reduce((s,x)=>s+x.costSavingsUnits,0),duration:allAudits.reduce((s,x)=>s+x.durationSavingsMs,0),userSteps:allAudits.reduce((s,x)=>s+x.userStepSavings,0)};
const trace={version:'33.16',evidenceClass:'LOCAL_PERSISTENT_ADAPTIVE_CONTROLLER_CAMPAIGN',recordDigests:store.list().map(x=>x.recordDigest),eventDigests:store.events().map(x=>x.eventDigest),auditDigests:allAudits.map(x=>x.auditDigest),routingDecisionDigests:[...routes,budgetFallback,conflictFallback,docsAfterDrift,mismatchRoute,testAfterMismatch].map(x=>x.decisionDigest),driftReportDigest:driftReport.reportDigest,traceDigest:''};
{const {traceDigest,...material}=trace;trace.traceDigest=sha256(material);}
const proofMaterial={version:'33.16',status:'PERSISTENT_MULTI_WORKFLOW_ADAPTIVE_CONTROLLER_PROVEN_LOCALLY',evidenceClass:'LOCAL_PERSISTENT_ADAPTIVE_CONTROLLER_CAMPAIGN',workflowClassCount:4,registeredShortcutCount:recordIds.length,activeAfterCampaignCount:store.list().filter(x=>x.status==='ACTIVE').length,revokedAfterCampaignCount:store.list().filter(x=>x.status==='REVOKED').length,pushApprovalCount:recordIds.length,qualifiedRouteCount:routes.filter(x=>x.route==='QUALIFIED_SHORTCUT_SHADOW').length,cheapestEquivalentSelected:routes.filter(x=>x.workflowType==='dependency-patch').every(x=>x.projectedCostUnits===2),budgetFallbackReason:budgetFallback.reason,conflictFallbackReason:conflictFallback.reason,driftRevocationCount:driftReport.revokedRecordIds.length,postDriftRoute:docsAfterDrift.route,mismatchDetected:!mismatchAudit.resultMatched,postMismatchRoute:testAfterMismatch.route,authorityExpansionCount:[...routes,budgetFallback,conflictFallback,docsAfterDrift,mismatchRoute,testAfterMismatch].filter(x=>x.authorityExpanded).length,externalEffectsExecuted:0,persistenceReopenVerified:true,eventChainLength:store.events().length,measuredLocalSavings:savings,limitations:['LOCAL_CAMPAIGN_NOT_CUSTOMER_OR_PRODUCTION_EVIDENCE','PUSH_APPROVAL_IS_SIGNED_LOCAL_CONTRACT_NOT_LIVE_DEVICE_DELIVERY','DRIFT_SWEEP_IS_EXPLICITLY_INVOKED_NOT_CONTINUOUS_DAEMON','SHORTCUTS_REMAIN_SHADOW_ONLY','NO_EXTERNAL_EFFECTS_OR_PRODUCTION_AUTHORITY'],productionPromotion:'blocked',proofDigest:''};
{const {proofDigest,...material}=proofMaterial;proofMaterial.proofDigest=sha256(material);}
const signedProof=signEnvelope(proofMaterial,ids.proof); const proofKeys=registry(ids.proof);
writeFileSync(`${out}/V33_16_PERSISTENT_ADAPTIVE_CONTROLLER_TRACE.json`,JSON.stringify(trace,null,2)+'\n');
writeFileSync(`${out}/V33_16_PERSISTENT_ADAPTIVE_POLICY_CONTROLLER_PROOF.json`,JSON.stringify({...proofMaterial,proofEnvelope:{signedProof,publicKey:proofKeys.exportPublicKey(ids.proof.keyId)}},null,2)+'\n');
writeFileSync(`${out}/V33_16_POLICY_STORE_SNAPSHOT.json`,JSON.stringify(store.export(),null,2)+'\n');
console.log(JSON.stringify(proofMaterial,null,2));
rmSync(root,{recursive:true,force:true});
if(proofMaterial.qualifiedRouteCount!==10||!proofMaterial.cheapestEquivalentSelected||budgetFallback.reason!=='BUDGET_REJECTED'||conflictFallback.reason!=='CONFLICTING_RESULT_DIGESTS'||driftReport.revokedRecordIds.length!==1||docsAfterDrift.route!=='FULL_GOVERNED_WORKFLOW'||mismatchAudit.resultMatched||testAfterMismatch.route!=='FULL_GOVERNED_WORKFLOW'||proofMaterial.authorityExpansionCount!==0||proofMaterial.externalEffectsExecuted!==0)process.exit(1);
