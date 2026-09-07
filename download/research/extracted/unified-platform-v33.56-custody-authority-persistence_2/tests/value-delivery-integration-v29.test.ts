import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeterministicGovernedAgent } from '../src/agents/governed-agent.js';
import { FileAgentProposalStore } from '../src/agents/agent-proposal-store.js';
import type { GovernedModelAdapter, GovernedModelRequest, ModelAdapterInput, ModelAdapterOutput } from '../src/ai/governed-model-orchestrator.js';
import { FileModelRunStore, GovernedModelOrchestrator } from '../src/ai/governed-model-orchestrator.js';
import { GovernedEngineeringAssistant } from '../src/app/governed-engineering-assistant.js';
import { GovernedValueDeliveryCoordinator } from '../src/app/governed-value-delivery.js';
import type { AuthorityGrant } from '../src/contracts/canonical.js';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../src/contracts/crypto.js';
import { OperationalActionLedger } from '../src/operations/action-ledger.js';
import { FileGovernedAutomationStore, GovernedAutomationEngine } from '../src/operations/governed-automation.js';
const now = new Date('2026-07-17T15:00:00Z');
class Adapter implements GovernedModelAdapter { calls = 0; async invoke(input: ModelAdapterInput): Promise<ModelAdapterOutput> { this.calls += 1; const output = 'Prepare a bounded review and regression test.'; return { provider: 'fixture', model: 'value-v29', output, claims: [{ claimId: 'c1', statement: 'Failure evidence exists.', classification: 'SUPPORTED', evidenceRefs: ['evidence:test-failure'] }], workGraph: [{ nodeId: 'analysis', kind: 'ANALYSIS', summary: 'Analyze failure', dependsOn: [], payload: {} }, { nodeId: 'test', kind: 'TEST_PROPOSAL', summary: 'Propose regression test', dependsOn: ['analysis'], requestedTool: 'tests.propose', payload: { suite: 'critical' } }, { nodeId: 'change', kind: 'CHANGE_PROPOSAL', summary: 'Propose bounded repair', dependsOn: ['analysis'], requestedTool: 'change.propose', payload: { targetFile: 'src/target.ts', expectedFileDigest: sha256('before'), exactBefore: 'before', exactAfter: 'after', allowedFiles: ['src/target.ts'], requiredTests: ['target.test.ts'] } }, { nodeId: 'review', kind: 'REVIEW_REQUEST', summary: 'Independent review', dependsOn: ['test', 'change'], payload: {} }], usage: { inputChars: input.context.reduce((sum, item) => sum + item.content.length, 0), outputChars: output.length, latencyMs: 15 }, startedAt: new Date(now.getTime() - 15).toISOString(), finishedAt: now.toISOString(), limitations: ['fixture'] }; } }
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'value-delivery-v29-')); const registry = new KeyRegistry();
  const authority = generateSigningIdentity('authority'); const modelSigner = generateSigningIdentity('model'); const packetSigner = generateSigningIdentity('packet'); const automationSigner = generateSigningIdentity('automation'); const bundleSigner = generateSigningIdentity('bundle');
  for (const identity of [authority, modelSigner, packetSigner, automationSigner, bundleSigner]) registry.register(identity.keyId, identity.publicKey);
  const adapter = new Adapter(); const model = new GovernedModelOrchestrator(registry, modelSigner, adapter, new FileModelRunStore(join(root, 'model-runs')));
  const assistant = new GovernedEngineeringAssistant(model, new DeterministicGovernedAgent(new FileAgentProposalStore(join(root, 'agent-proposals'))), packetSigner);
  const automation = new GovernedAutomationEngine(registry, automationSigner, new FileGovernedAutomationStore(join(root, 'automations')));
  automation.activate({ ruleId: 'test-failure-value', tenantId: 'tenant-1', name: 'Route failures to governed review', triggerType: 'TEST_FAILURE', condition: { minimumSeverity: 'high' }, actions: [{ kind: 'PREPARE_REVIEW', title: 'Prepare governed engineering review', owner: 'Engineering Lead' }, { kind: 'PROPOSE_TESTS', title: 'Propose regression suite', owner: 'Test Lead' }, { kind: 'OPEN_OPERATIONAL_ACTION', title: 'Track repair evidence', owner: 'Operations Lead' }], maxActions: 3, createdBy: 'automation-owner', reviewerIds: ['reviewer-a', 'reviewer-b'] }, now);
  const grant: AuthorityGrant = { grantId: 'grant', tenantId: 'tenant-1', subjectId: 'repo:alpha', scopes: ['model.design'], issuedAt: new Date(now.getTime() - 1000).toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), issuer: 'kernel' };
  const modelRequest: GovernedModelRequest = { requestId: 'event-1', tenantId: 'tenant-1', subjectId: 'repo:alpha', requesterId: 'engineer', purpose: 'DESIGN', objective: 'Repair failing critical test', authority: signEnvelope(grant, authority), allowedTools: ['repository.read', 'tests.propose', 'change.propose'], context: [{ contextId: 'failure', source: 'test', trust: 'TRUSTED', priority: 10, content: 'critical test failed', evidenceRefs: ['evidence:test-failure'] }], budget: { maxContextChars: 100, maxOutputChars: 500, maxClaims: 3, maxGraphNodes: 8, maxToolProposals: 4, maxLatencyMs: 1000 }, createdAt: now.toISOString() };
  const coordinator = new GovernedValueDeliveryCoordinator(automation, assistant, bundleSigner);
  const event = { eventId: 'event-1', tenantId: 'tenant-1', subjectId: 'repo:alpha', triggerType: 'TEST_FAILURE' as const, severity: 'critical' as const, occurredAt: now.toISOString(), evidenceRoot: sha256('failure-evidence'), attributes: { lane: 'critical' } };
  const assistantRequest = { requestId: 'event-1', modelRequest, operationalDependencies: [{ id: 'postgres', state: 'blocked' as const, detail: 'not qualified', owner: 'runtime' }], operationalRisks: [{ id: 'failure', severity: 'high' as const, summary: 'critical test failed', affectedArea: 'release' }], failedTests: 1 };
  const valueBaseline = { manualSteps: 12, manualDecisionPoints: 8, medianMinutes: 30, errorOpportunities: 6 };
  const valueObservation = { sampleSize: 6, operatorSteps: 5, operatorDecisionPoints: 3, medianMinutes: 12, invalidActionsBlocked: 3, evidenceGapsDetected: 2, operatorOverrides: 1, completedRuns: 6, provenanceRefs: ['evidence:v29-local-pilot'], measurementKind: 'MEASURED_LOCAL' as const };
  return { coordinator, registry, adapter, event, assistantRequest, valueBaseline, valueObservation, automation, assistant, bundleSigner };
}

test('event-to-automation-to-AI-to-agent-to-operations integration produces one signed review bundle without effects', async () => {
  const h = setup(); const signed = await h.coordinator.prepare({ requestId: 'event-1', event: h.event, assistantRequest: h.assistantRequest, valueBaseline: h.valueBaseline, valueObservation: h.valueObservation }, now);
  assert.equal(h.registry.verify(signed), true); assert.equal(h.registry.verify(signed.payload.automationRun), true); assert.equal(h.registry.verify(signed.payload.engineeringReview!), true);
  assert.equal(signed.payload.externalEffectsExecuted, 0); assert.equal(signed.payload.executionState, 'REVIEW_REQUIRED'); assert.equal(signed.payload.automationRun.payload.actions.length, 3);
  assert.equal(signed.payload.engineeringReview?.payload.agentPlans.length, 1); assert.equal(signed.payload.valueReport.status, 'VALUE_DEMONSTRATED');
  assert.equal(OperationalActionLedger.restore({ actions: signed.payload.actionLedger.states.map((state) => state.action), events: signed.payload.actionLedger.events }).verify(), true);
  assert.ok(signed.payload.traceability.some((link) => link.relation === 'TRIGGERED')); assert.ok(signed.payload.traceability.some((link) => link.relation === 'SUPPORTED_BY'));
});

test('integrated bundle is deterministic across restart and avoids a second model call', async () => {
  const h = setup(); const request = { requestId: 'event-1', event: h.event, assistantRequest: h.assistantRequest, valueBaseline: h.valueBaseline, valueObservation: h.valueObservation };
  const first = await h.coordinator.prepare(request, now); const second = await h.coordinator.prepare(request, now);
  assert.equal(sha256(first), sha256(second)); assert.equal(h.adapter.calls, 1);
});

test('review-requiring automation cannot run without assistant input or with cross-tenant binding', async () => {
  const h = setup();
  await assert.rejects(h.coordinator.prepare({ requestId: 'event-1', event: h.event, valueBaseline: h.valueBaseline, valueObservation: h.valueObservation }, now), /assistant_request_required/);
  await assert.rejects(h.coordinator.prepare({ requestId: 'event-1', event: h.event, assistantRequest: { ...h.assistantRequest, modelRequest: { ...h.assistantRequest.modelRequest, tenantId: 'tenant-2' } }, valueBaseline: h.valueBaseline, valueObservation: h.valueObservation }, now), /binding_mismatch/);
});

test('automation without review action rejects unsolicited model invocation', async () => {
  const h = setup(); h.automation.activate({ ruleId: 'manual-only', tenantId: 'tenant-1', name: 'manual operational route', triggerType: 'MANUAL_REVIEW', condition: {}, actions: [{ kind: 'OPEN_OPERATIONAL_ACTION', title: 'Open action', owner: 'ops' }], maxActions: 1, createdBy: 'owner', reviewerIds: ['a', 'b'] }, now);
  const event = { ...h.event, eventId: 'event-2', triggerType: 'MANUAL_REVIEW' as const };
  await assert.rejects(h.coordinator.prepare({ requestId: 'event-2', event, assistantRequest: { ...h.assistantRequest, requestId: 'event-2', modelRequest: { ...h.assistantRequest.modelRequest, requestId: 'event-2' } }, valueBaseline: h.valueBaseline, valueObservation: h.valueObservation }, now), /unrequested_assistant/);
  const signed = await h.coordinator.prepare({ requestId: 'event-2', event, valueBaseline: h.valueBaseline, valueObservation: h.valueObservation }, now); assert.equal(signed.payload.engineeringReview, undefined); assert.equal(signed.payload.externalEffectsExecuted, 0);
});

test('coordinator rejects invalid request binding, time and unregistered review signer', async () => {
  const h = setup();
  await assert.rejects(h.coordinator.prepare({ requestId: 'other', event: h.event, assistantRequest: h.assistantRequest, valueBaseline: h.valueBaseline, valueObservation: h.valueObservation }, now), /event_binding/);
  await assert.rejects(h.coordinator.prepare({ requestId: 'event-1', event: h.event, assistantRequest: h.assistantRequest, valueBaseline: h.valueBaseline, valueObservation: h.valueObservation }, new Date(Number.NaN)), /time_invalid/);
  const unknownPacketSigner = generateSigningIdentity('unknown-packet'); const badAssistant = new GovernedEngineeringAssistant(h.assistant.model, h.assistant.agent, unknownPacketSigner); const bad = new GovernedValueDeliveryCoordinator(h.automation, badAssistant, h.bundleSigner);
  await assert.rejects(bad.prepare({ requestId: 'event-1', event: h.event, assistantRequest: h.assistantRequest, valueBaseline: h.valueBaseline, valueObservation: h.valueObservation }, now), /review_signature_invalid/);
});

test('incident and stale-evidence automations map to repair and verification actions without AI execution', async () => {
  const h = setup();
  h.automation.activate({ ruleId:'incident-route',tenantId:'tenant-1',name:'incident recertification route',triggerType:'INCIDENT_REPORTED',condition:{},actions:[{kind:'PROPOSE_RECERTIFICATION',title:'Create recertification proposal',owner:'Trust Lead'}],maxActions:1,createdBy:'owner-i',reviewerIds:['a','b']},now);
  h.automation.activate({ ruleId:'stale-route',tenantId:'tenant-1',name:'refresh stale evidence',triggerType:'EVIDENCE_STALE',condition:{},actions:[{kind:'REFRESH_EVIDENCE',title:'Refresh evidence',owner:'Evidence Lead'}],maxActions:1,createdBy:'owner-e',reviewerIds:['a','b']},now);
  const incident={...h.event,eventId:'incident-1',triggerType:'INCIDENT_REPORTED' as const}; const stale={...h.event,eventId:'stale-1',triggerType:'EVIDENCE_STALE' as const};
  const incidentBundle=await h.coordinator.prepare({requestId:'incident-1',event:incident,valueBaseline:h.valueBaseline,valueObservation:h.valueObservation},now);
  const staleBundle=await h.coordinator.prepare({requestId:'stale-1',event:stale,valueBaseline:h.valueBaseline,valueObservation:h.valueObservation},now);
  assert.equal(incidentBundle.payload.actionLedger.states[0]?.action.priority,1); assert.equal(incidentBundle.payload.actionLedger.states[0]?.action.category,'repair');
  assert.equal(staleBundle.payload.actionLedger.states[0]?.action.priority,3); assert.equal(staleBundle.payload.actionLedger.states[0]?.action.category,'verify');
  assert.equal(h.adapter.calls,0);
});

test('coordinator rejects an automation receipt signed by an unregistered key', async () => {
  const h = setup();
  const rogue = generateSigningIdentity('rogue-automation');
  const originalEvaluate = h.automation.evaluate.bind(h.automation);
  (h.automation as unknown as { evaluate: typeof h.automation.evaluate }).evaluate = ((event, at) => {
    const legitimate = originalEvaluate(event, at);
    return signEnvelope(legitimate.payload, rogue);
  }) as typeof h.automation.evaluate;
  await assert.rejects(
    h.coordinator.prepare({ requestId: 'event-1', event: h.event, assistantRequest: h.assistantRequest, valueBaseline: h.valueBaseline, valueObservation: h.valueObservation }, now),
    /automation_signature_invalid/,
  );
});
