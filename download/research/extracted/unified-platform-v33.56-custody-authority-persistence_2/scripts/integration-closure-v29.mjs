import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '../dist/src/contracts/crypto.js';
const ROOT=process.cwd(); const OUT=join(ROOT,'evidence','generated'); mkdirSync(OUT,{recursive:true});
const proofPath=join(OUT,'V29_VALUE_AUTOMATION_PROOF.json');
if(!existsSync(proofPath)) throw new Error('value_automation_proof_missing');
const proof=JSON.parse(readFileSync(proofPath,'utf8'));
const architecture=JSON.parse(readFileSync(join(OUT,'V29_ARCHITECTURE_INTEGRITY.json'),'utf8'));
const files=new Map();
function content(path){ if(!files.has(path)) files.set(path,readFileSync(join(ROOT,path),'utf8')); return files.get(path); }
const edges=[
 {edgeId:'event-to-rule-evaluation',from:'AutomationEvent',to:'GovernedAutomationRule',implementation:'src/operations/governed-automation.ts',implementationMarker:'conditionMatches',test:'tests/governed-automation-v29.test.ts',testMarker:'conditions and tenant boundaries prevent unrelated automation',evidence:'V29_VALUE_AUTOMATION_PROOF.json'},
 {edgeId:'rule-to-signed-run',from:'GovernedAutomationRule',to:'Signed Automation Run',implementation:'src/operations/governed-automation.ts',implementationMarker:'signEnvelope(run',test:'tests/governed-automation-v29.test.ts',testMarker:'dual-reviewed automation produces signed proposal-only actions',evidence:'V29_AUTOMATION_MUTATION_RESULTS.json'},
 {edgeId:'run-to-ai-review',from:'Automation Run',to:'Governed Engineering Review',implementation:'src/app/governed-value-delivery.ts',implementationMarker:"action.kind === 'PREPARE_REVIEW'",test:'tests/value-delivery-integration-v29.test.ts',testMarker:'event-to-automation-to-AI-to-agent-to-operations integration',evidence:'V29_VALUE_AUTOMATION_PROOF.json'},
 {edgeId:'ai-review-to-agent-proposal',from:'Engineering Review',to:'Agent Plan',implementation:'src/app/governed-engineering-assistant.ts',implementationMarker:'this.agent.propose',test:'tests/value-delivery-integration-v29.test.ts',testMarker:'agentPlans.length',evidence:'V29_VALUE_AUTOMATION_PROOF.json'},
 {edgeId:'automation-to-operational-ledger',from:'Proposed Automation Action',to:'Operational Action Ledger',implementation:'src/app/governed-value-delivery.ts',implementationMarker:'new OperationalActionLedger',test:'tests/value-delivery-integration-v29.test.ts',testMarker:'OperationalActionLedger.restore',evidence:'V29_VALUE_AUTOMATION_PROOF.json'},
 {edgeId:'observation-to-value-report',from:'Workflow Observation',to:'Value Report',implementation:'src/operations/value-realization.ts',implementationMarker:'buildWorkflowValueReport',test:'tests/value-realization-v29.test.ts',testMarker:'modeled benefit remains promising',evidence:'V29_VALUE_AUTOMATION_PROOF.json'},
 {edgeId:'bundle-to-signed-traceability',from:'Review Bundle',to:'Signed Traceability',implementation:'src/app/governed-value-delivery.ts',implementationMarker:'return signEnvelope(bundle',test:'tests/value-delivery-integration-v29.test.ts',testMarker:"link.relation === 'SUPPORTED_BY'",evidence:'V29_VALUE_AUTOMATION_PROOF.json'},
 {edgeId:'persistence-to-restart-replay',from:'Persistent Stores',to:'Deterministic Restart Replay',implementation:'src/operations/governed-automation.ts',implementationMarker:'FileGovernedAutomationStore',test:'tests/value-delivery-integration-v29.test.ts',testMarker:'deterministic across restart and avoids a second model call',evidence:'V29_VALUE_AUTOMATION_PROOF.json'},
 {edgeId:'review-boundary-to-zero-effects',from:'Governed Review Boundary',to:'No External Effect',implementation:'src/app/governed-value-delivery.ts',implementationMarker:'externalEffectsExecuted: 0',test:'tests/value-delivery-integration-v29.test.ts',testMarker:'without effects',evidence:'V29_AUTOMATION_MUTATION_RESULTS.json'},
];
const records=edges.map((edge)=>{
 const implementationPresent=content(edge.implementation).includes(edge.implementationMarker);
 const testPresent=content(edge.test).includes(edge.testMarker);
 const evidencePresent=existsSync(join(OUT,edge.evidence));
 return {...edge,implementationPresent,testPresent,evidencePresent,status:implementationPresent&&testPresent&&evidencePresent?'CLOSED':'OPEN'};
});
const closed=records.filter((r)=>r.status==='CLOSED').length;
const architecturePath=architecture.capabilityClosure.find((x)=>x.capabilityId==='governed-automation-value-delivery');
const assertions={allEdgesClosed:closed===records.length,valueProofPassed:proof.status==='passed',zeroExternalEffects:proof.results.externalEffectsExecuted===0,restartReplayNoModelCall:proof.results.restartReplayModelCalls===0,architectureCapabilityClosed:architecturePath?.status==='CLOSED'};
const status=Object.values(assertions).every(Boolean)?'passed':'failed';
const report={version:'29.0',status,classification:'end-to-end-integration-edge-closure',edgesSpecified:records.length,edgesClosed:closed,assertions,records,graphDigest:sha256(records),limitations:['Integration closure proves local code/test/evidence connectivity; it does not qualify external infrastructure or human workflow value.','No external effect is executed by this proof.']};
writeFileSync(join(OUT,'V29_INTEGRATION_CLOSURE.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status,edgesSpecified:records.length,edgesClosed:closed,assertions},null,2));
if(status!=='passed') process.exit(1);
