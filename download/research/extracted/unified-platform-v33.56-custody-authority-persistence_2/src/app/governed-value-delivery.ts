import { sha256, signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';
import type { EngineeringAssistantRequest, EngineeringReviewPacket } from './governed-engineering-assistant.js';
import { GovernedEngineeringAssistant } from './governed-engineering-assistant.js';
import { OperationalActionLedger } from '../operations/action-ledger.js';
import type { OperationalAction } from '../operations/operator-action-center.js';
import type { AutomationEvent, GovernedAutomationRun, ProposedAutomationAction } from '../operations/governed-automation.js';
import { GovernedAutomationEngine } from '../operations/governed-automation.js';
import { buildWorkflowValueReport, type WorkflowValueBaseline, type WorkflowValueObservation, type WorkflowValueReport } from '../operations/value-realization.js';

export interface GovernedValueDeliveryRequest {
  readonly requestId: string;
  readonly event: AutomationEvent;
  readonly assistantRequest?: EngineeringAssistantRequest;
  readonly valueBaseline: WorkflowValueBaseline;
  readonly valueObservation: WorkflowValueObservation;
}
export interface ValueDeliveryTraceLink {
  readonly from: string;
  readonly relation: 'TRIGGERED' | 'PROPOSED' | 'SUPPORTED_BY' | 'REQUIRES_REVIEW' | 'MEASURED_BY';
  readonly to: string;
}
export interface GovernedValueDeliveryBundle {
  readonly bundleId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly automationRun: SignedEnvelope<GovernedAutomationRun>;
  readonly engineeringReview?: SignedEnvelope<EngineeringReviewPacket>;
  readonly actionLedger: ReturnType<OperationalActionLedger['snapshot']>;
  readonly valueReport: WorkflowValueReport;
  readonly traceability: readonly ValueDeliveryTraceLink[];
  readonly executionState: 'REVIEW_REQUIRED';
  readonly promotionCeiling: 'research';
  readonly externalEffectsExecuted: 0;
  readonly generatedAt: string;
  readonly limitations: readonly string[];
  readonly bundleDigest: string;
}

export class GovernedValueDeliveryCoordinator {
  constructor(
    readonly automation: GovernedAutomationEngine,
    readonly assistant: GovernedEngineeringAssistant,
    readonly bundleSigner: SigningIdentity,
  ) {}
  async prepare(request: GovernedValueDeliveryRequest, now = new Date()): Promise<SignedEnvelope<GovernedValueDeliveryBundle>> {
    validateRequest(request, now);
    const automationRun = this.automation.evaluate(request.event, now);
    if (!this.automation.keyRegistry.verify(automationRun)) throw new Error('value_delivery_automation_signature_invalid');
    const needsReview = automationRun.payload.actions.some((action) => action.kind === 'PREPARE_REVIEW');
    let engineeringReview: SignedEnvelope<EngineeringReviewPacket> | undefined;
    if (needsReview) {
      if (request.assistantRequest === undefined) throw new Error('value_delivery_assistant_request_required');
      if (request.assistantRequest.requestId !== request.requestId || request.assistantRequest.modelRequest.tenantId !== request.event.tenantId || request.assistantRequest.modelRequest.subjectId !== request.event.subjectId) throw new Error('value_delivery_assistant_binding_mismatch');
      engineeringReview = await this.assistant.prepare(request.assistantRequest, now);
      if (!this.assistant.model.keyRegistry.verify(engineeringReview)) throw new Error('value_delivery_review_signature_invalid');
    } else if (request.assistantRequest !== undefined) throw new Error('value_delivery_unrequested_assistant_execution');
    const actions = automationRun.payload.actions.map(toOperationalAction);
    const ledger = new OperationalActionLedger(actions, now.toISOString());
    const valueReport = buildWorkflowValueReport(request.valueBaseline, request.valueObservation);
    const traceability = buildTraceability(request, automationRun.payload, engineeringReview?.payload, valueReport, actions);
    const material = {
      bundleId: `value-delivery:${sha256({ requestId: request.requestId, eventDigest: automationRun.payload.eventDigest }).slice(0, 24)}`,
      requestId: request.requestId, tenantId: request.event.tenantId, subjectId: request.event.subjectId,
      automationRun: structuredClone(automationRun),
      ...(engineeringReview === undefined ? {} : { engineeringReview: structuredClone(engineeringReview) }),
      actionLedger: ledger.snapshot(now), valueReport, traceability,
      executionState: 'REVIEW_REQUIRED' as const, promotionCeiling: 'research' as const, externalEffectsExecuted: 0 as const,
      generatedAt: now.toISOString(),
      limitations: [
        'automation-and-ai-produce-reviewable-proposals-only', 'no-external-notification-or-mutation-is-executed',
        'value-report-must-retain-measurement-classification', 'independent-human-review-remains-required',
      ],
    };
    const bundle: GovernedValueDeliveryBundle = { ...material, bundleDigest: sha256(material) };
    return signEnvelope(bundle, this.bundleSigner);
  }
}
function toOperationalAction(action: ProposedAutomationAction): OperationalAction {
  const priority: 1 | 2 | 3 | 4 = action.kind === 'PROPOSE_RECERTIFICATION' ? 1 : action.kind === 'OPEN_OPERATIONAL_ACTION' ? 2 : 3;
  const category: OperationalAction['category'] = action.kind === 'PROPOSE_RECERTIFICATION' ? 'repair' : action.kind === 'REFRESH_EVIDENCE' || action.kind === 'PROPOSE_TESTS' ? 'verify' : action.kind === 'PREPARE_REVIEW' ? 'monitor' : 'repair';
  return { id: action.actionId, priority, category, title: action.title, why: `Governed automation rule ${action.ruleId} matched; proposal remains review-only.`, owner: action.owner, completionEvidence: `Signed evidence closes ${action.actionId} without automatic external mutation.` };
}
function buildTraceability(request: GovernedValueDeliveryRequest, run: GovernedAutomationRun, review: EngineeringReviewPacket | undefined, value: WorkflowValueReport, actions: readonly OperationalAction[]): ValueDeliveryTraceLink[] {
  const links: ValueDeliveryTraceLink[] = [{ from: `event:${request.event.eventId}`, relation: 'TRIGGERED', to: `automation:${run.runId}` }, { from: `automation:${run.runId}`, relation: 'MEASURED_BY', to: `value:${value.reportDigest}` }];
  for (const action of actions) links.push({ from: `automation:${run.runId}`, relation: 'PROPOSED', to: `action:${action.id}` });
  if (review !== undefined) {
    links.push({ from: `automation:${run.runId}`, relation: 'REQUIRES_REVIEW', to: `review:${review.packetId}` });
    for (const claim of review.claims) for (const evidence of claim.evidenceRefs) links.push({ from: `claim:${claim.claimId}`, relation: 'SUPPORTED_BY', to: evidence });
  }
  return links.sort((a, b) => `${a.from}:${a.relation}:${a.to}`.localeCompare(`${b.from}:${b.relation}:${b.to}`));
}
function validateRequest(request: GovernedValueDeliveryRequest, now: Date): void {
  if (request.requestId.trim() === '') throw new Error('value_delivery_request_id_required');
  if (!Number.isFinite(now.getTime())) throw new Error('value_delivery_time_invalid');
  if (request.event.eventId !== request.requestId) throw new Error('value_delivery_event_binding_mismatch');
}
