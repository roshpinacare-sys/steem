import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DeterministicGovernedAgent } from '../dist/src/agents/governed-agent.js';
import { FileAgentProposalStore } from '../dist/src/agents/agent-proposal-store.js';
import { FileModelRunStore, GovernedModelOrchestrator } from '../dist/src/ai/governed-model-orchestrator.js';
import { GovernedEngineeringAssistant } from '../dist/src/app/governed-engineering-assistant.js';
import { GovernedValueDeliveryCoordinator } from '../dist/src/app/governed-value-delivery.js';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../dist/src/contracts/crypto.js';
import { FileGovernedAutomationStore, GovernedAutomationEngine } from '../dist/src/operations/governed-automation.js';
import { OperationalActionLedger } from '../dist/src/operations/action-ledger.js';

const ROOT = process.cwd();
const OUT = join(ROOT, 'evidence', 'generated'); mkdirSync(OUT, { recursive: true });
const now = new Date('2026-07-17T16:00:00Z');
const root = mkdtempSync(join(tmpdir(), 'v29-value-proof-'));
const registry = new KeyRegistry();
const authority = generateSigningIdentity('proof-authority');
const modelSigner = generateSigningIdentity('proof-model');
const packetSigner = generateSigningIdentity('proof-packet');
const automationSigner = generateSigningIdentity('proof-automation');
const bundleSigner = generateSigningIdentity('proof-bundle');
for (const identity of [authority, modelSigner, packetSigner, automationSigner, bundleSigner]) registry.register(identity.keyId, identity.publicKey);

class ProofAdapter {
  calls = 0;
  async invoke(input) {
    this.calls += 1;
    const output = 'Prepare bounded repair, regression tests, and independent review.';
    return {
      provider: 'fixture', model: 'governed-value-v29', output,
      claims: [{ claimId: 'claim-failure', statement: 'The test failure is supported by captured evidence.', classification: 'SUPPORTED', evidenceRefs: ['evidence:test-failure'] }],
      workGraph: [
        { nodeId: 'analysis', kind: 'ANALYSIS', summary: 'Analyze failure evidence', dependsOn: [], payload: {} },
        { nodeId: 'tests', kind: 'TEST_PROPOSAL', summary: 'Propose regression test', dependsOn: ['analysis'], requestedTool: 'tests.propose', payload: { suite: 'critical' } },
        { nodeId: 'change', kind: 'CHANGE_PROPOSAL', summary: 'Propose bounded code repair', dependsOn: ['analysis'], requestedTool: 'change.propose', payload: { targetFile: 'src/example.ts', expectedFileDigest: sha256('before'), exactBefore: 'before', exactAfter: 'after', allowedFiles: ['src/example.ts'], requiredTests: ['example.test.ts'] } },
        { nodeId: 'review', kind: 'REVIEW_REQUEST', summary: 'Request independent review', dependsOn: ['tests', 'change'], payload: {} },
      ],
      usage: { inputChars: input.context.reduce((sum, item) => sum + item.content.length, 0), outputChars: output.length, latencyMs: 18 },
      startedAt: new Date(now.getTime() - 18).toISOString(), finishedAt: now.toISOString(), limitations: ['deterministic-local-proof-adapter'],
    };
  }
}

const adapter = new ProofAdapter();
function buildSystem() {
  const model = new GovernedModelOrchestrator(registry, modelSigner, adapter, new FileModelRunStore(join(root, 'model-runs')));
  const assistant = new GovernedEngineeringAssistant(model, new DeterministicGovernedAgent(new FileAgentProposalStore(join(root, 'agent-proposals'))), packetSigner);
  const automation = new GovernedAutomationEngine(registry, automationSigner, new FileGovernedAutomationStore(join(root, 'automations')));
  return { automation, assistant, coordinator: new GovernedValueDeliveryCoordinator(automation, assistant, bundleSigner) };
}
const firstSystem = buildSystem();
const ruleDefinitions = [
  { ruleId: 'rule-test-failure', triggerType: 'TEST_FAILURE', actions: [
    { kind: 'PREPARE_REVIEW', title: 'Prepare governed engineering review', owner: 'Engineering Lead' },
    { kind: 'PROPOSE_TESTS', title: 'Propose regression tests', owner: 'Test Lead' },
    { kind: 'OPEN_OPERATIONAL_ACTION', title: 'Track repair evidence', owner: 'Operations Lead' },
  ] },
  { ruleId: 'rule-incident', triggerType: 'INCIDENT_REPORTED', actions: [{ kind: 'PROPOSE_RECERTIFICATION', title: 'Prepare recertification mission', owner: 'Trust Lead' }] },
  { ruleId: 'rule-stale', triggerType: 'EVIDENCE_STALE', actions: [{ kind: 'REFRESH_EVIDENCE', title: 'Refresh stale evidence', owner: 'Evidence Lead' }] },
  { ruleId: 'rule-dependency', triggerType: 'DEPENDENCY_BLOCKED', actions: [{ kind: 'OPEN_OPERATIONAL_ACTION', title: 'Escalate blocked dependency', owner: 'Runtime Lead' }] },
  { ruleId: 'rule-manual', triggerType: 'MANUAL_REVIEW', actions: [{ kind: 'PROPOSE_TESTS', title: 'Propose verification suite', owner: 'Test Lead' }] },
];
for (const def of ruleDefinitions) firstSystem.automation.activate({
  ruleId: def.ruleId, tenantId: 'tenant-proof', name: def.ruleId, triggerType: def.triggerType,
  condition: {}, actions: def.actions, maxActions: def.actions.length, createdBy: 'automation-owner', reviewerIds: ['reviewer-a','reviewer-b'],
}, now);

const grant = { grantId: 'grant-proof', tenantId: 'tenant-proof', subjectId: 'repo:proof', scopes: ['model.design'], issuedAt: new Date(now.getTime()-1000).toISOString(), expiresAt: new Date(now.getTime()+60000).toISOString(), issuer: 'kernel' };
function assistantRequest(id) {
  return {
    requestId: id,
    modelRequest: { requestId: id, tenantId: 'tenant-proof', subjectId: 'repo:proof', requesterId: 'engineer', purpose: 'DESIGN', objective: 'Repair critical failure', authority: signEnvelope(grant, authority), allowedTools: ['repository.read','tests.propose','change.propose'], context: [{ contextId: 'failure', source: 'test', trust: 'TRUSTED', priority: 10, content: 'critical test failed' }], budget: { maxContextChars: 200, maxOutputChars: 800, maxClaims: 4, maxGraphNodes: 8, maxToolProposals: 4, maxLatencyMs: 1000 }, createdAt: now.toISOString() },
    operationalDependencies: [{ id: 'postgres', state: 'blocked', detail: 'external qualification unavailable', owner: 'runtime' }],
    operationalRisks: [{ id: 'failure', severity: 'high', summary: 'critical test failed', affectedArea: 'release' }], failedTests: 1,
  };
}
const baseline = { manualSteps: 12, manualDecisionPoints: 8, medianMinutes: 30, errorOpportunities: 6 };
const modeledObservation = { sampleSize: 6, operatorSteps: 5, operatorDecisionPoints: 3, medianMinutes: 12, invalidActionsBlocked: 5, evidenceGapsDetected: 3, operatorOverrides: 1, completedRuns: 6, provenanceRefs: ['model:v29-workflow-comparison','local:v29-run-receipts'], measurementKind: 'MODELED' };
const events = [
  ['test-failure','TEST_FAILURE','critical',true], ['incident','INCIDENT_REPORTED','critical',false], ['stale','EVIDENCE_STALE','high',false], ['dependency','DEPENDENCY_BLOCKED','high',false], ['manual','MANUAL_REVIEW','medium',false],
];
const scenarios=[];
for (const [suffix, triggerType, severity, needsAssistant] of events) {
  const id=`event-${suffix}`;
  const event={ eventId:id, tenantId:'tenant-proof', subjectId:'repo:proof', triggerType, severity, occurredAt:now.toISOString(), evidenceRoot:sha256(`evidence:${suffix}`), attributes:{ source:'v29-proof' } };
  const request={ requestId:id, event, ...(needsAssistant?{assistantRequest:assistantRequest(id)}:{}), valueBaseline:baseline, valueObservation:modeledObservation };
  const started=performance.now(); const signed=await firstSystem.coordinator.prepare(request,now); const durationMs=performance.now()-started;
  const ledgerOk=OperationalActionLedger.restore({ actions:signed.payload.actionLedger.states.map((s)=>s.action), events:signed.payload.actionLedger.events }).verify();
  if (!registry.verify(signed) || !registry.verify(signed.payload.automationRun) || signed.payload.externalEffectsExecuted!==0 || !ledgerOk) throw new Error(`scenario_verification_failed:${suffix}`);
  scenarios.push({ scenario:suffix, triggerType, durationMs:Number(durationMs.toFixed(3)), bundleDigest:sha256(signed), actionKinds:signed.payload.automationRun.payload.actions.map((a)=>a.kind), actionCount:signed.payload.automationRun.payload.actions.length, engineeringReviewCreated:signed.payload.engineeringReview!==undefined, modelCalls:adapter.calls, valueStatus:signed.payload.valueReport.status, measurementKind:signed.payload.valueReport.measurementKind, externalEffectsExecuted:signed.payload.externalEffectsExecuted, traceLinks:signed.payload.traceability.length, ledgerVerified:ledgerOk });
}
// Restart the complete orchestration layer and prove replay is deterministic and does not call the model again.
const restarted = buildSystem();
const replayEvent={ eventId:'event-test-failure', tenantId:'tenant-proof', subjectId:'repo:proof', triggerType:'TEST_FAILURE', severity:'critical', occurredAt:now.toISOString(), evidenceRoot:sha256('evidence:test-failure'), attributes:{source:'v29-proof'} };
const replayRequest={ requestId:'event-test-failure', event:replayEvent, assistantRequest:assistantRequest('event-test-failure'), valueBaseline:baseline, valueObservation:modeledObservation };
const callsBefore=adapter.calls; const replay=await restarted.coordinator.prepare(replayRequest,now); const replayCalls=adapter.calls-callsBefore;
const original=scenarios.find((s)=>s.scenario==='test-failure');
if (!original || original.bundleDigest!==sha256(replay) || replayCalls!==0) throw new Error('restart_replay_not_deterministic');
const totalActions=scenarios.reduce((s,x)=>s+x.actionCount,0);
const report={
  version:'29.0', status:'passed', classification:'governed-automation-and-value-delivery-local-proof',
  proofScope:{ tenantId:'tenant-proof', subjectId:'repo:proof', scenarios:scenarios.length, ruleTypes:ruleDefinitions.length },
  results:{ scenarios, totalActionsProposed:totalActions, externalEffectsExecuted:0, independentRuleReviewers:2, modelCalls:adapter.calls, restartReplayModelCalls:replayCalls, restartReplayDigestMatched:true, allReceiptsSigned:true, allLedgersVerified:true },
  valueEvidence:{ classification:'HYBRID_LOCAL_EXECUTION_WITH_MODELED_MANUAL_BASELINE', modeledBaseline:baseline, modeledObservation, claimedStatus:'PROMISING_NOT_HUMAN_VALIDATED', demonstratedMechanisms:['persistent-idempotent-routing','proposal-only-ai-review','signed-traceability','operational-action-ledger','automatic-evidence-gap-and-invalid-action-signals'], limitations:['Manual steps, decision points and minutes are modeled and are not human-pilot measurements.','Durations are local single-host measurements and are not production SLOs.','No external notification, repository mutation, approval or production promotion was executed.'] },
  proofRoot:sha256({ scenarios, totalActions, replayDigest:sha256(replay) }),
};
writeFileSync(join(OUT,'V29_VALUE_AUTOMATION_PROOF.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,scenarios:scenarios.length,totalActionsProposed:totalActions,externalEffectsExecuted:0,restartReplayModelCalls:replayCalls,proofRoot:report.proofRoot},null,2));
