import { mkdirSync, writeFileSync } from 'node:fs';
import { compileChatMission, buildPushApprovalCard, recordApprovalDecision } from '../dist/src/product/chat-mission.js';
import { sha256 } from '../dist/src/contracts/crypto.js';

const now = new Date('2026-07-21T04:00:00.000Z');
const grant = {
  grantId:'grant-proof-v33.1',tenantId:'tenant-proof',subjectId:'operator-proof',workspaceId:'workspace-proof',
  scopes:['repository.read','repository.change.prepare','production.deploy'],issuedAt:'2026-07-21T03:00:00.000Z',expiresAt:'2026-07-21T08:00:00.000Z',issuer:'canonical-authority',
};
const policy = {
  policyId:'policy-proof-v33.1',autoPrepareScopes:['repository.read','repository.change.prepare'],approvalRequiredScopes:['production.deploy'],
  maxAutoPrepareCostUsd:5,maxAutoPrepareRisk:'MEDIUM',minimumConfidence:0.8,requireApprovalForIrreversible:true,requireApprovalForUnknownReversibility:true,approverIds:['reviewer-proof'],
};
const base = {
  missionId:'mission-proof-low',tenantId:'tenant-proof',requesterId:'operator-proof',workspaceId:'workspace-proof',
  message:'Inspect the repository and prepare a tested patch. Do not merge or deploy.',objective:'Prepare a tested repository patch',
  requestedScopes:['repository.read','repository.change.prepare'],riskLevel:'LOW',reversibility:'REVERSIBLE',estimatedCostUsd:2,confidence:0.95,
  constraints:['isolated workspace'],prohibitedActions:['merge','deploy'],completionCriteria:['tests pass','rollback exists'],createdAt:'2026-07-21T03:59:00.000Z',expiresAt:'2026-07-21T05:00:00.000Z',
};
const low = compileChatMission(base,grant,policy,now);
const high = compileChatMission({...base,missionId:'mission-proof-high',requestedScopes:['production.deploy'],riskLevel:'CRITICAL',reversibility:'IRREVERSIBLE',estimatedCostUsd:20},grant,policy,now);
const card = buildPushApprovalCard(high,policy);
const explain = recordApprovalDecision(card,{decisionId:'decision-explain',cardId:card.cardId,actorId:'reviewer-proof',option:'EXPLAIN',occurredAt:'2026-07-21T04:00:01.000Z'},new Date('2026-07-21T04:00:02.000Z'));
const approve = recordApprovalDecision(card,{decisionId:'decision-approve',cardId:card.cardId,actorId:'reviewer-proof',option:'YES',occurredAt:'2026-07-21T04:00:03.000Z',reason:'Existing scopes only'},new Date('2026-07-21T04:00:04.000Z'));
const material={
  version:'33.1',generatedAt:new Date().toISOString(),status:'passed',classification:'contract-prototype-shadow-only',
  assertions:{
    lowRiskAutonomousPreparation:low.status==='READY_FOR_AUTONOMOUS_PREPARATION'&&!low.approvalRequired,
    highRiskRequiresApproval:high.status==='AWAITING_APPROVAL'&&high.approvalRequired,
    pushOptionsComplete:JSON.stringify(card.options)===JSON.stringify(['YES','NO','CHANGE_CONDITIONS','EXPLAIN']),
    explainDoesNotApprove:explain.outcome==='EXPLANATION_REQUESTED'&&explain.approvedScopes.length===0,
    approvalScopeBound:JSON.stringify(approve.approvedScopes)===JSON.stringify(high.requestedScopes),
    noExternalEffects:[low,high,explain,approve].every((item)=>item.externalEffectsExecuted===0),
    shadowCeiling:low.promotionCeiling==='shadow'&&high.promotionCeiling==='shadow',
  },
  digests:{lowMission:low.missionDigest,highMission:high.missionDigest,approvalCard:card.cardDigest,explainDecision:explain.decisionDigest,approveDecision:approve.decisionDigest,authorityGrant:sha256(grant)},
  approvalReasons:high.approvalReasons,
  limitations:['No mobile push transport is implemented.','No external effect is authorized or executed.','Human comprehension and step-reduction studies remain G3 evidence.'],
  productionPromotion:'blocked',
};
material.status=Object.values(material.assertions).every(Boolean)?'passed':'failed';
material.reportDigest=sha256(material);
mkdirSync('release-evidence/v33.1',{recursive:true});
writeFileSync('release-evidence/v33.1/V33_1_CHAT_MISSION_PROOF.json',JSON.stringify(material,null,2)+'\n');
console.log(JSON.stringify(material,null,2));
if(material.status!=='passed')process.exit(1);
