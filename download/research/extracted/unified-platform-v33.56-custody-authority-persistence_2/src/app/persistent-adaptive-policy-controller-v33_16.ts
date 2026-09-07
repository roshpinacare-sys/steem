import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  KeyRegistry,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';
import {
  activateShortcutPassportV33_15,
  createShortcutRevocationV33_15,
  detectShortcutDriftV33_15,
  routeAdaptiveExecutionV33_15,
  verifyShortcutPassportV33_15,
  type ShortcutActivationV33_15,
  type ShortcutPassportV33_15,
  type ShortcutRevocationV33_15,
  type WorkflowBoundaryV33_15,
} from '../runtime/proof-carrying-adaptive-execution-v33_15.js';
import type {
  ApprovalDecisionRecord,
  PushApprovalCard,
} from '../product/chat-mission.js';

export type AdaptivePolicyRecordStatusV33_16 = 'PENDING_APPROVAL' | 'ACTIVE' | 'REVOKED' | 'EXPIRED';
export type AdaptiveControllerRouteV33_16 = 'FULL_GOVERNED_WORKFLOW' | 'QUALIFIED_SHORTCUT_SHADOW';

export interface ShortcutProjectionV33_16 {
  readonly projectedCostUnits: number;
  readonly projectedDurationMs: number;
  readonly projectedUserSteps: number;
  readonly evidenceScore: number;
  readonly projectionDigest: string;
}

export interface AdaptivePolicyRecordV33_16 {
  readonly version: '33.16';
  readonly recordId: string;
  readonly tenantId: string;
  readonly workflowType: string;
  readonly passport: SignedEnvelope<ShortcutPassportV33_15>;
  readonly projection: ShortcutProjectionV33_16;
  readonly approvalCard?: PushApprovalCard;
  readonly activation?: SignedEnvelope<ShortcutActivationV33_15>;
  readonly revocations: readonly SignedEnvelope<ShortcutRevocationV33_15>[];
  readonly status: AdaptivePolicyRecordStatusV33_16;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly externalEffectsExecuted: 0;
  readonly recordDigest: string;
}

export interface AdaptivePolicyEventV33_16 {
  readonly version: '33.16';
  readonly eventId: string;
  readonly sequence: number;
  readonly eventType:
    | 'SHORTCUT_REGISTERED'
    | 'APPROVAL_CARD_ISSUED'
    | 'ACTIVATED'
    | 'REVOKED'
    | 'EXPIRED'
    | 'ROUTED'
    | 'OUTCOME_RECORDED';
  readonly tenantId: string;
  readonly recordId?: string;
  readonly payloadDigest: string;
  readonly occurredAt: string;
  readonly previousEventDigest: string;
  readonly externalEffectsExecuted: 0;
  readonly eventDigest: string;
}

export interface AdaptiveExecutionAuditV33_16 {
  readonly version: '33.16';
  readonly auditId: string;
  readonly tenantId: string;
  readonly workflowType: string;
  readonly recordId?: string;
  readonly passportDigest?: string;
  readonly route: AdaptiveControllerRouteV33_16;
  readonly routeDecisionDigest: string;
  readonly expectedResultDigest?: string;
  readonly observedResultDigest: string;
  readonly resultMatched: boolean;
  readonly baselineCostUnits: number;
  readonly actualCostUnits: number;
  readonly costSavingsUnits: number;
  readonly baselineDurationMs: number;
  readonly actualDurationMs: number;
  readonly durationSavingsMs: number;
  readonly baselineUserSteps: number;
  readonly actualUserSteps: number;
  readonly userStepSavings: number;
  readonly measuredAt: string;
  readonly evidenceClass: 'LOCAL_MEASURED_EXECUTION';
  readonly externalEffectsExecuted: 0;
  readonly auditDigest: string;
}

export interface AdaptivePolicySnapshotV33_16 {
  readonly version: '33.16';
  readonly records: readonly AdaptivePolicyRecordV33_16[];
  readonly audits: readonly AdaptiveExecutionAuditV33_16[];
  readonly events: readonly AdaptivePolicyEventV33_16[];
  readonly generatedAt: string;
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export interface AdaptivePolicyTrustV33_16 {
  readonly passportRegistry: KeyRegistry;
  readonly trustedPassportIssuerIds: readonly string[];
  readonly activationRegistry: KeyRegistry;
  readonly trustedActivationSignerIds: readonly string[];
  readonly revocationRegistry: KeyRegistry;
  readonly trustedRevocationSignerIds: readonly string[];
  readonly approvalRegistry: KeyRegistry;
  readonly trustedApproverSignerIds: readonly string[];
}

export interface AdaptiveRoutingBudgetV33_16 {
  readonly maximumCostUnits: number;
  readonly maximumDurationMs: number;
  readonly maximumUserSteps: number;
}

export interface AdaptiveRoutingDecisionV33_16 {
  readonly version: '33.16';
  readonly decisionId: string;
  readonly tenantId: string;
  readonly workflowType: string;
  readonly route: AdaptiveControllerRouteV33_16;
  readonly reason:
    | 'QUALIFIED_CHEAPEST_EQUIVALENT_SHORTCUT'
    | 'NO_ACTIVE_SHORTCUT'
    | 'NO_BOUNDARY_MATCH'
    | 'BUDGET_REJECTED'
    | 'CONFLICTING_RESULT_DIGESTS';
  readonly selectedRecordId?: string;
  readonly selectedPassportDigest?: string;
  readonly consideredRecordIds: readonly string[];
  readonly projectedCostUnits?: number;
  readonly projectedDurationMs?: number;
  readonly projectedUserSteps?: number;
  readonly evaluatedAt: string;
  readonly authorityExpanded: false;
  readonly externalEffectsExecuted: 0;
  readonly decisionDigest: string;
}

export interface DriftObservationV33_16 {
  readonly passportDigest: string;
  readonly currentBoundary: WorkflowBoundaryV33_15;
  readonly inputClassDigest: string;
  readonly observedShortcutResultDigest?: string;
}

export interface DriftSweepReportV33_16 {
  readonly version: '33.16';
  readonly sweepId: string;
  readonly evaluatedRecordCount: number;
  readonly revokedRecordIds: readonly string[];
  readonly expiredRecordIds: readonly string[];
  readonly fallbackRoute: 'FULL_GOVERNED_WORKFLOW';
  readonly sweptAt: string;
  readonly externalEffectsExecuted: 0;
  readonly reportDigest: string;
}

export class PersistentAdaptivePolicyStoreV33_16 {
  readonly #path: string;
  readonly #lockPath: string;
  readonly #storeIdentity: SigningIdentity;
  readonly #storeRegistry: KeyRegistry;
  readonly #trustedStoreSignerIds: readonly string[];
  readonly #trust: AdaptivePolicyTrustV33_16;
  #snapshot: AdaptivePolicySnapshotV33_16;

  constructor(input: {
    readonly path: string;
    readonly storeIdentity: SigningIdentity;
    readonly storeRegistry: KeyRegistry;
    readonly trustedStoreSignerIds: readonly string[];
    readonly trust: AdaptivePolicyTrustV33_16;
    readonly now?: Date;
  }) {
    this.#path = resolve(nonEmpty(input.path, 'adaptive_store_path_required'));
    this.#lockPath = `${this.#path}.lock`;
    this.#storeIdentity = input.storeIdentity;
    this.#storeRegistry = input.storeRegistry;
    this.#trustedStoreSignerIds = unique(input.trustedStoreSignerIds, 'duplicate_store_signer');
    this.#trust = input.trust;
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    this.#snapshot = existsSync(this.#path)
      ? this.#read(input.now ?? new Date())
      : createSnapshot([], [], [], input.now ?? new Date());
    if (!existsSync(this.#path)) this.#persist(input.now ?? new Date());
  }

  get(recordId: string): AdaptivePolicyRecordV33_16 {
    const row = this.#snapshot.records.find((item) => item.recordId === recordId);
    if (row === undefined) throw new Error('adaptive_record_not_found');
    return structuredClone(row);
  }

  list(tenantId?: string): readonly AdaptivePolicyRecordV33_16[] {
    const rows = tenantId === undefined
      ? this.#snapshot.records
      : this.#snapshot.records.filter((item) => item.tenantId === nonEmpty(tenantId, 'tenant_id_required'));
    return structuredClone(rows);
  }

  audits(tenantId?: string): readonly AdaptiveExecutionAuditV33_16[] {
    return structuredClone(tenantId === undefined
      ? this.#snapshot.audits
      : this.#snapshot.audits.filter((item) => item.tenantId === nonEmpty(tenantId, 'tenant_id_required')));
  }

  events(): readonly AdaptivePolicyEventV33_16[] { return structuredClone(this.#snapshot.events); }

  putRecord(record: AdaptivePolicyRecordV33_16, eventType: AdaptivePolicyEventV33_16['eventType'], now = new Date()): AdaptivePolicyRecordV33_16 {
    verifyRecord(record, this.#trust, now);
    return this.#mutate((snapshot) => {
      const prior = snapshot.records.find((item) => item.recordId === record.recordId);
      if (prior !== undefined && prior.recordDigest === record.recordDigest) return { snapshot, value: prior };
      if (prior !== undefined && prior.tenantId !== record.tenantId) throw new Error('adaptive_record_tenant_conflict');
      const records = snapshot.records.filter((item) => item.recordId !== record.recordId).concat(record).sort(byRecordId);
      const event = appendEvent(snapshot.events, {
        eventType,
        tenantId: record.tenantId,
        recordId: record.recordId,
        payloadDigest: record.recordDigest,
        occurredAt: now.toISOString(),
      });
      return { snapshot: createSnapshot(records, snapshot.audits, [...snapshot.events, event], now), value: record };
    }, now);
  }

  appendAudit(audit: AdaptiveExecutionAuditV33_16, now = new Date()): AdaptiveExecutionAuditV33_16 {
    verifyAudit(audit);
    return this.#mutate((snapshot) => {
      const prior = snapshot.audits.find((item) => item.auditId === audit.auditId);
      if (prior !== undefined) {
        if (prior.auditDigest !== audit.auditDigest) throw new Error('adaptive_audit_id_conflict');
        return { snapshot, value: prior };
      }
      const audits = [...snapshot.audits, audit].sort((a, b) => a.auditId.localeCompare(b.auditId));
      const event = appendEvent(snapshot.events, {
        eventType: 'OUTCOME_RECORDED', tenantId: audit.tenantId,
        ...(audit.recordId === undefined ? {} : { recordId: audit.recordId }),
        payloadDigest: audit.auditDigest, occurredAt: now.toISOString(),
      });
      return { snapshot: createSnapshot(snapshot.records, audits, [...snapshot.events, event], now), value: audit };
    }, now);
  }

  recordRouting(decision: AdaptiveRoutingDecisionV33_16, now = new Date()): void {
    verifyRoutingDecision(decision);
    this.#mutate((snapshot) => {
      const event = appendEvent(snapshot.events, {
        eventType: 'ROUTED', tenantId: decision.tenantId,
        ...(decision.selectedRecordId === undefined ? {} : { recordId: decision.selectedRecordId }),
        payloadDigest: decision.decisionDigest, occurredAt: now.toISOString(),
      });
      return { snapshot: createSnapshot(snapshot.records, snapshot.audits, [...snapshot.events, event], now), value: undefined };
    }, now);
  }

  export(): AdaptivePolicySnapshotV33_16 { return structuredClone(this.#snapshot); }

  #read(now: Date): AdaptivePolicySnapshotV33_16 {
    let envelope: SignedEnvelope<AdaptivePolicySnapshotV33_16>;
    try { envelope = JSON.parse(readFileSync(this.#path, 'utf8')) as SignedEnvelope<AdaptivePolicySnapshotV33_16>; }
    catch { throw new Error('adaptive_store_parse_invalid'); }
    if (!this.#trustedStoreSignerIds.includes(envelope.issuerKeyId)) throw new Error('adaptive_store_signer_untrusted');
    if (!this.#storeRegistry.verifyAt(envelope, envelope.payload.generatedAt)) throw new Error('adaptive_store_signature_invalid');
    verifySnapshot(envelope.payload, this.#trust, now);
    return structuredClone(envelope.payload);
  }

  #mutate<T>(fn: (snapshot: AdaptivePolicySnapshotV33_16) => { snapshot: AdaptivePolicySnapshotV33_16; value: T }, now: Date): T {
    const lock = acquireLock(this.#lockPath);
    try {
      if (existsSync(this.#path)) this.#snapshot = this.#read(now);
      const result = fn(structuredClone(this.#snapshot));
      verifySnapshot(result.snapshot, this.#trust, now);
      this.#snapshot = result.snapshot;
      this.#persist(now);
      return structuredClone(result.value);
    } finally { releaseLock(lock, this.#lockPath); }
  }

  #persist(now: Date): void {
    this.#snapshot = { ...this.#snapshot, generatedAt: now.toISOString(), snapshotDigest: snapshotDigest(this.#snapshot.records, this.#snapshot.audits, this.#snapshot.events, now.toISOString()) };
    const envelope = signEnvelope(this.#snapshot, this.#storeIdentity);
    atomicReplace(this.#path, `${JSON.stringify(envelope, null, 2)}\n`);
  }
}

export class PersistentAdaptivePolicyControllerV33_16 {
  readonly #store: PersistentAdaptivePolicyStoreV33_16;
  readonly #trust: AdaptivePolicyTrustV33_16;
  readonly #activationSigner: SigningIdentity;
  readonly #revocationSigner: SigningIdentity;

  constructor(input: {
    readonly store: PersistentAdaptivePolicyStoreV33_16;
    readonly trust: AdaptivePolicyTrustV33_16;
    readonly activationSigner: SigningIdentity;
    readonly revocationSigner: SigningIdentity;
  }) {
    if (input.activationSigner.keyId === input.revocationSigner.keyId) throw new Error('activation_revocation_separation_required');
    this.#store = input.store;
    this.#trust = input.trust;
    this.#activationSigner = input.activationSigner;
    this.#revocationSigner = input.revocationSigner;
  }

  registerShortcut(input: {
    readonly passport: SignedEnvelope<ShortcutPassportV33_15>;
    readonly projectedCostUnits: number;
    readonly projectedDurationMs: number;
    readonly projectedUserSteps: number;
    readonly evidenceScore: number;
    readonly now?: Date;
  }): AdaptivePolicyRecordV33_16 {
    const now = input.now ?? new Date();
    if (!verifyShortcutPassportV33_15({ envelope: input.passport, registry: this.#trust.passportRegistry, trustedIssuerIds: this.#trust.trustedPassportIssuerIds, now })) throw new Error('adaptive_passport_invalid');
    const projection = createProjection(input);
    const record = createRecord({ passport: input.passport, projection, status: 'PENDING_APPROVAL', revocations: [], createdAt: now.toISOString(), updatedAt: now.toISOString() });
    return this.#store.putRecord(record, 'SHORTCUT_REGISTERED', now);
  }

  issueActivationApproval(input: {
    readonly recordId: string;
    readonly approverIds: readonly string[];
    readonly expiresAt: string;
    readonly now?: Date;
  }): PushApprovalCard {
    const now = input.now ?? new Date();
    const record = this.#store.get(input.recordId);
    if (record.status !== 'PENDING_APPROVAL') throw new Error('adaptive_record_not_pending_approval');
    const approverIds = unique(input.approverIds, 'duplicate_approver');
    if (approverIds.length === 0) throw new Error('adaptive_approver_required');
    const expiresAt = instant(input.expiresAt, 'adaptive_approval_expiry_invalid');
    if (expiresAt <= now.getTime() || expiresAt > Date.parse(record.passport.payload.expiresAt)) throw new Error('adaptive_approval_expiry_invalid');
    const missionDigest = sha256({
      action: 'ACTIVATE_PROOF_CARRYING_SHORTCUT',
      recordId: record.recordId,
      passportDigest: record.passport.payload.passportDigest,
      allowedScopes: record.passport.payload.allowedScopes,
      promotionCeiling: record.passport.payload.promotionCeiling,
    });
    const material = {
      version: '33.1' as const,
      cardId: `adaptive-approval-${record.passport.payload.passportDigest.slice(0, 24)}`,
      missionId: `adaptive-shortcut-${record.recordId}`,
      tenantId: record.tenantId,
      title: `Activate governed shortcut: ${record.workflowType}`.slice(0, 80),
      summary: `Enable a revocable shadow shortcut for ${record.workflowType}. It cannot expand authority and falls back to the full governed workflow.`.slice(0, 220),
      riskLevel: record.passport.payload.promotionCeiling === 'limited-revocable' ? 'LOW' as const : 'MEDIUM' as const,
      reversibility: 'REVERSIBLE' as const,
      estimatedCostUsd: 0,
      requestedScopes: record.passport.payload.allowedScopes,
      reasons: ['POLICY_REQUIRES_SCOPE_APPROVAL'] as const,
      approverIds,
      options: ['YES', 'NO', 'CHANGE_CONDITIONS', 'EXPLAIN'] as const,
      authorityGrantDigest: record.passport.payload.authorityGrantDigest,
      missionDigest,
      expiresAt: new Date(expiresAt).toISOString(),
    };
    const card: PushApprovalCard = { ...material, cardDigest: sha256(material) };
    const updated = createRecord({ ...record, approvalCard: card, updatedAt: now.toISOString() });
    this.#store.putRecord(updated, 'APPROVAL_CARD_ISSUED', now);
    return card;
  }

  activateFromSignedApproval(input: {
    readonly recordId: string;
    readonly decision: SignedEnvelope<ApprovalDecisionRecord>;
    readonly activationExpiresAt: string;
    readonly now?: Date;
  }): AdaptivePolicyRecordV33_16 {
    const now = input.now ?? new Date();
    const record = this.#store.get(input.recordId);
    if (record.approvalCard === undefined) throw new Error('adaptive_approval_card_missing');
    verifySignedApprovalDecision(input.decision, record.approvalCard, this.#trust, now);
    if (input.decision.payload.outcome !== 'APPROVED' || input.decision.payload.option !== 'YES') throw new Error('adaptive_activation_not_approved');
    const activation = activateShortcutPassportV33_15({
      passport: record.passport,
      passportRegistry: this.#trust.passportRegistry,
      trustedPassportIssuerIds: this.#trust.trustedPassportIssuerIds,
      approvedBy: input.decision.payload.actorId,
      approvedScopes: input.decision.payload.approvedScopes,
      signer: this.#activationSigner,
      expiresAt: input.activationExpiresAt,
      now,
    });
    const updated = createRecord({ ...record, activation, status: 'ACTIVE', updatedAt: now.toISOString() });
    return this.#store.putRecord(updated, 'ACTIVATED', now);
  }

  route(input: {
    readonly tenantId: string;
    readonly workflowType: string;
    readonly currentBoundary: WorkflowBoundaryV33_15;
    readonly inputClassDigest: string;
    readonly budget: AdaptiveRoutingBudgetV33_16;
    readonly now?: Date;
  }): AdaptiveRoutingDecisionV33_16 {
    const now = input.now ?? new Date();
    validateBudget(input.budget);
    if (input.currentBoundary.tenantId !== input.tenantId || input.currentBoundary.workflowType !== input.workflowType) throw new Error('adaptive_route_boundary_binding_invalid');
    const records = this.#store.list(input.tenantId).filter((item) => item.workflowType === input.workflowType && item.status === 'ACTIVE' && item.activation !== undefined);
    if (records.length === 0) return this.#finishDecision(decision(input, 'FULL_GOVERNED_WORKFLOW', 'NO_ACTIVE_SHORTCUT', [], now));
    const eligible = records.flatMap((record) => {
      const route = routeAdaptiveExecutionV33_15({
        passport: record.passport,
        passportRegistry: this.#trust.passportRegistry,
        trustedPassportIssuerIds: this.#trust.trustedPassportIssuerIds,
        activation: record.activation!,
        activationRegistry: this.#trust.activationRegistry,
        trustedActivationSignerIds: this.#trust.trustedActivationSignerIds,
        currentBoundary: input.currentBoundary,
        inputClassDigest: input.inputClassDigest,
        revocations: record.revocations,
        revocationRegistry: this.#trust.revocationRegistry,
        trustedRevocationSignerIds: this.#trust.trustedRevocationSignerIds,
        now,
      });
      return route.route === 'QUALIFIED_SHORTCUT_SHADOW' ? [{ record, route }] : [];
    });
    if (eligible.length === 0) return this.#finishDecision(decision(input, 'FULL_GOVERNED_WORKFLOW', 'NO_BOUNDARY_MATCH', records.map((x) => x.recordId), now));
    const withinBudget = eligible.filter(({ record }) => projectionWithinBudget(record.projection, input.budget));
    if (withinBudget.length === 0) return this.#finishDecision(decision(input, 'FULL_GOVERNED_WORKFLOW', 'BUDGET_REJECTED', eligible.map((x) => x.record.recordId), now));
    const results = new Set(withinBudget.map(({ record }) => record.passport.payload.projectedResultDigest));
    if (results.size !== 1) return this.#finishDecision(decision(input, 'FULL_GOVERNED_WORKFLOW', 'CONFLICTING_RESULT_DIGESTS', withinBudget.map((x) => x.record.recordId), now));
    withinBudget.sort(compareEligible);
    const selected = withinBudget[0]!.record;
    return this.#finishDecision(decision(input, 'QUALIFIED_SHORTCUT_SHADOW', 'QUALIFIED_CHEAPEST_EQUIVALENT_SHORTCUT', withinBudget.map((x) => x.record.recordId), now, selected));
  }

  sweepDrift(input: { readonly observations: readonly DriftObservationV33_16[]; readonly now?: Date }): DriftSweepReportV33_16 {
    const now = input.now ?? new Date();
    const byPassport = new Map(input.observations.map((item) => [item.passportDigest, item]));
    const revoked: string[] = [];
    const expired: string[] = [];
    for (const record of this.#store.list().filter((item) => item.status === 'ACTIVE' && item.activation !== undefined)) {
      let reason: ShortcutRevocationV33_15['reason'] | undefined;
      if (now.getTime() >= Date.parse(record.passport.payload.expiresAt) || now.getTime() >= Date.parse(record.activation!.payload.expiresAt)) reason = 'EXPIRED';
      else {
        const observation = byPassport.get(record.passport.payload.passportDigest);
        if (observation !== undefined) reason = detectShortcutDriftV33_15({ passport: record.passport, currentBoundary: observation.currentBoundary, inputClassDigest: observation.inputClassDigest, ...(observation.observedShortcutResultDigest === undefined ? {} : { observedShortcutResultDigest: observation.observedShortcutResultDigest }) });
      }
      if (reason === undefined) continue;
      const revocation = createShortcutRevocationV33_15({ passport: record.passport, reason, evidence: byPassport.get(record.passport.payload.passportDigest) ?? { reason }, signer: this.#revocationSigner, now });
      const status: AdaptivePolicyRecordStatusV33_16 = reason === 'EXPIRED' ? 'EXPIRED' : 'REVOKED';
      const updated = createRecord({ ...record, revocations: [...record.revocations, revocation], status, updatedAt: now.toISOString() });
      this.#store.putRecord(updated, reason === 'EXPIRED' ? 'EXPIRED' : 'REVOKED', now);
      (reason === 'EXPIRED' ? expired : revoked).push(record.recordId);
    }
    const material = {
      version: '33.16' as const,
      sweepId: `adaptive-drift-sweep-${randomUUID()}`,
      evaluatedRecordCount: this.#store.list().filter((item) => item.status === 'ACTIVE').length + revoked.length + expired.length,
      revokedRecordIds: revoked.sort(),
      expiredRecordIds: expired.sort(),
      fallbackRoute: 'FULL_GOVERNED_WORKFLOW' as const,
      sweptAt: now.toISOString(),
      externalEffectsExecuted: 0 as const,
    };
    return { ...material, reportDigest: sha256(material) };
  }

  recordOutcome(input: {
    readonly routingDecision: AdaptiveRoutingDecisionV33_16;
    readonly observedResultDigest: string;
    readonly baselineCostUnits: number;
    readonly actualCostUnits: number;
    readonly baselineDurationMs: number;
    readonly actualDurationMs: number;
    readonly baselineUserSteps: number;
    readonly actualUserSteps: number;
    readonly now?: Date;
  }): AdaptiveExecutionAuditV33_16 {
    verifyRoutingDecision(input.routingDecision);
    digest(input.observedResultDigest, 'observed_result_digest_invalid');
    for (const [name, value] of Object.entries({ baselineCostUnits: input.baselineCostUnits, actualCostUnits: input.actualCostUnits, baselineDurationMs: input.baselineDurationMs, actualDurationMs: input.actualDurationMs, baselineUserSteps: input.baselineUserSteps, actualUserSteps: input.actualUserSteps })) nonNegative(value, name);
    const now = input.now ?? new Date();
    const record = input.routingDecision.selectedRecordId === undefined ? undefined : this.#store.get(input.routingDecision.selectedRecordId);
    const expectedResultDigest = record?.passport.payload.projectedResultDigest;
    const resultMatched = expectedResultDigest === undefined || expectedResultDigest === input.observedResultDigest;
    const material = {
      version: '33.16' as const,
      auditId: `adaptive-audit-${randomUUID()}`,
      tenantId: input.routingDecision.tenantId,
      workflowType: input.routingDecision.workflowType,
      ...(record === undefined ? {} : { recordId: record.recordId, passportDigest: record.passport.payload.passportDigest }),
      route: input.routingDecision.route,
      routeDecisionDigest: input.routingDecision.decisionDigest,
      ...(expectedResultDigest === undefined ? {} : { expectedResultDigest }),
      observedResultDigest: input.observedResultDigest,
      resultMatched,
      baselineCostUnits: input.baselineCostUnits,
      actualCostUnits: input.actualCostUnits,
      costSavingsUnits: input.baselineCostUnits - input.actualCostUnits,
      baselineDurationMs: input.baselineDurationMs,
      actualDurationMs: input.actualDurationMs,
      durationSavingsMs: input.baselineDurationMs - input.actualDurationMs,
      baselineUserSteps: input.baselineUserSteps,
      actualUserSteps: input.actualUserSteps,
      userStepSavings: input.baselineUserSteps - input.actualUserSteps,
      measuredAt: now.toISOString(),
      evidenceClass: 'LOCAL_MEASURED_EXECUTION' as const,
      externalEffectsExecuted: 0 as const,
    };
    const audit = { ...material, auditDigest: sha256(material) };
    this.#store.appendAudit(audit, now);
    if (record !== undefined && !resultMatched && record.status === 'ACTIVE') {
      const revocation = createShortcutRevocationV33_15({ passport: record.passport, reason: 'RESULT_MISMATCH', evidence: audit, signer: this.#revocationSigner, now });
      this.#store.putRecord(createRecord({ ...record, revocations: [...record.revocations, revocation], status: 'REVOKED', updatedAt: now.toISOString() }), 'REVOKED', now);
    }
    return audit;
  }

  manualRevoke(recordId: string, reasonEvidence: unknown, now = new Date()): AdaptivePolicyRecordV33_16 {
    const record = this.#store.get(recordId);
    const revocation = createShortcutRevocationV33_15({ passport: record.passport, reason: 'MANUAL_REVOCATION', evidence: reasonEvidence, signer: this.#revocationSigner, now });
    const updated = createRecord({ ...record, revocations: [...record.revocations, revocation], status: 'REVOKED', updatedAt: now.toISOString() });
    return this.#store.putRecord(updated, 'REVOKED', now);
  }

  #finishDecision(value: AdaptiveRoutingDecisionV33_16): AdaptiveRoutingDecisionV33_16 { this.#store.recordRouting(value, new Date(value.evaluatedAt)); return value; }
}

function createProjection(input: { projectedCostUnits: number; projectedDurationMs: number; projectedUserSteps: number; evidenceScore: number }): ShortcutProjectionV33_16 {
  nonNegative(input.projectedCostUnits, 'projected_cost_units');
  nonNegative(input.projectedDurationMs, 'projected_duration_ms');
  nonNegative(input.projectedUserSteps, 'projected_user_steps');
  if (!Number.isFinite(input.evidenceScore) || input.evidenceScore < 0 || input.evidenceScore > 1) throw new Error('evidence_score_invalid');
  const material = { projectedCostUnits: input.projectedCostUnits, projectedDurationMs: input.projectedDurationMs, projectedUserSteps: input.projectedUserSteps, evidenceScore: input.evidenceScore };
  return { ...material, projectionDigest: sha256(material) };
}

function createRecord(input: Omit<AdaptivePolicyRecordV33_16, 'version' | 'recordId' | 'tenantId' | 'workflowType' | 'externalEffectsExecuted' | 'recordDigest'> & { passport: SignedEnvelope<ShortcutPassportV33_15> }): AdaptivePolicyRecordV33_16 {
  const material = {
    version: '33.16' as const,
    recordId: `adaptive-record-${input.passport.payload.passportDigest}`,
    tenantId: input.passport.payload.tenantId,
    workflowType: input.passport.payload.workflowType,
    passport: input.passport,
    projection: input.projection,
    ...(input.approvalCard === undefined ? {} : { approvalCard: input.approvalCard }),
    ...(input.activation === undefined ? {} : { activation: input.activation }),
    revocations: input.revocations,
    status: input.status,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, recordDigest: sha256(material) };
}

function verifyRecord(record: AdaptivePolicyRecordV33_16, trust: AdaptivePolicyTrustV33_16, now: Date): void {
  const historicalPassportTime = new Date(Math.min(Date.parse(record.passport.payload.expiresAt) - 1, Date.parse(record.passport.payload.issuedAt) + 1));
  if (!verifyShortcutPassportV33_15({ envelope: record.passport, registry: trust.passportRegistry, trustedIssuerIds: trust.trustedPassportIssuerIds, now: historicalPassportTime })) throw new Error('adaptive_record_passport_invalid');
  if (record.tenantId !== record.passport.payload.tenantId || record.workflowType !== record.passport.payload.workflowType || record.recordId !== `adaptive-record-${record.passport.payload.passportDigest}`) throw new Error('adaptive_record_binding_invalid');
  verifyProjection(record.projection);
  if (record.approvalCard !== undefined) verifyApprovalCard(record.approvalCard, record);
  if (record.activation !== undefined) {
    const activationTime = new Date(Math.min(Date.parse(record.activation.payload.expiresAt) - 1, Date.parse(record.activation.payload.activatedAt) + 1));
    const route = routeAdaptiveExecutionV33_15({ passport: record.passport, passportRegistry: trust.passportRegistry, trustedPassportIssuerIds: trust.trustedPassportIssuerIds, activation: record.activation, activationRegistry: trust.activationRegistry, trustedActivationSignerIds: trust.trustedActivationSignerIds, currentBoundary: boundaryFromPassport(record.passport.payload), inputClassDigest: record.passport.payload.inputClassDigest, now: activationTime });
    if (route.reason === 'ACTIVATION_INVALID' || route.reason === 'PASSPORT_INVALID') throw new Error('adaptive_record_activation_invalid');
  }
  for (const revocation of record.revocations) verifyRevocation(revocation, record, trust);
  if (record.status === 'PENDING_APPROVAL' && record.activation !== undefined) throw new Error('adaptive_record_status_invalid');
  if (record.status === 'ACTIVE' && record.activation === undefined) throw new Error('adaptive_record_status_invalid');
  if ((record.status === 'REVOKED' || record.status === 'EXPIRED') && record.revocations.length === 0) throw new Error('adaptive_record_status_invalid');
  if (record.externalEffectsExecuted !== 0) throw new Error('adaptive_record_external_effect_forbidden');
  if (Date.parse(record.updatedAt) < Date.parse(record.createdAt) || !Number.isFinite(Date.parse(record.updatedAt))) throw new Error('adaptive_record_time_invalid');
  const { recordDigest, ...material } = record;
  if (sha256(material) !== recordDigest) throw new Error('adaptive_record_digest_invalid');
  if (!Number.isFinite(now.getTime())) throw new Error('current_time_invalid');
}

function verifyProjection(projection: ShortcutProjectionV33_16): void {
  nonNegative(projection.projectedCostUnits, 'projected_cost_units'); nonNegative(projection.projectedDurationMs, 'projected_duration_ms'); nonNegative(projection.projectedUserSteps, 'projected_user_steps');
  if (!Number.isFinite(projection.evidenceScore) || projection.evidenceScore < 0 || projection.evidenceScore > 1) throw new Error('evidence_score_invalid');
  const { projectionDigest, ...material } = projection;
  if (sha256(material) !== projectionDigest) throw new Error('projection_digest_invalid');
}

function verifyApprovalCard(card: PushApprovalCard, record: AdaptivePolicyRecordV33_16): void {
  const { cardDigest, ...material } = card;
  if (sha256(material) !== cardDigest || card.tenantId !== record.tenantId || card.authorityGrantDigest !== record.passport.payload.authorityGrantDigest || !sameScopes(card.requestedScopes, record.passport.payload.allowedScopes)) throw new Error('adaptive_approval_card_invalid');
}

function verifySignedApprovalDecision(envelope: SignedEnvelope<ApprovalDecisionRecord>, card: PushApprovalCard, trust: AdaptivePolicyTrustV33_16, now: Date): void {
  const payload = envelope.payload;
  if (!trust.trustedApproverSignerIds.includes(envelope.issuerKeyId) || !trust.approvalRegistry.verifyAt(envelope, payload.occurredAt)) throw new Error('adaptive_approval_signature_invalid');
  const { decisionDigest, ...material } = payload;
  if (sha256(material) !== decisionDigest || payload.cardDigest !== card.cardDigest || payload.cardId !== card.cardId || payload.tenantId !== card.tenantId || payload.authorityGrantDigest !== card.authorityGrantDigest || payload.missionDigest !== card.missionDigest) throw new Error('adaptive_approval_binding_invalid');
  if (!card.approverIds.includes(payload.actorId) || payload.actorId !== envelope.issuerKeyId) throw new Error('adaptive_approval_actor_invalid');
  if (Date.parse(payload.occurredAt) > now.getTime() || now.getTime() >= Date.parse(card.expiresAt)) throw new Error('adaptive_approval_expired');
  if (payload.option === 'YES' && !sameScopes(payload.approvedScopes, card.requestedScopes)) throw new Error('adaptive_approval_scope_invalid');
}

function verifyRevocation(envelope: SignedEnvelope<ShortcutRevocationV33_15>, record: AdaptivePolicyRecordV33_16, trust: AdaptivePolicyTrustV33_16): void {
  const payload = envelope.payload;
  const { revocationDigest, ...material } = payload;
  if (!trust.trustedRevocationSignerIds.includes(envelope.issuerKeyId) || !trust.revocationRegistry.verifyAt(envelope, payload.revokedAt) || payload.passportDigest !== record.passport.payload.passportDigest || payload.tenantId !== record.tenantId || payload.fallbackRoute !== 'FULL_GOVERNED_WORKFLOW' || payload.externalEffectsExecuted !== 0 || sha256(material) !== revocationDigest) throw new Error('adaptive_revocation_invalid');
}

function createSnapshot(records: readonly AdaptivePolicyRecordV33_16[], audits: readonly AdaptiveExecutionAuditV33_16[], events: readonly AdaptivePolicyEventV33_16[], now: Date): AdaptivePolicySnapshotV33_16 {
  const generatedAt = now.toISOString();
  const material = { version: '33.16' as const, records: [...records].sort(byRecordId), audits: [...audits].sort((a, b) => a.auditId.localeCompare(b.auditId)), events: [...events].sort((a, b) => a.sequence - b.sequence), generatedAt, externalEffectsExecuted: 0 as const };
  return { ...material, snapshotDigest: sha256(material) };
}

function snapshotDigest(records: readonly AdaptivePolicyRecordV33_16[], audits: readonly AdaptiveExecutionAuditV33_16[], events: readonly AdaptivePolicyEventV33_16[], generatedAt: string): string {
  return sha256({ version: '33.16', records: [...records].sort(byRecordId), audits: [...audits].sort((a, b) => a.auditId.localeCompare(b.auditId)), events: [...events].sort((a, b) => a.sequence - b.sequence), generatedAt, externalEffectsExecuted: 0 });
}

function verifySnapshot(snapshot: AdaptivePolicySnapshotV33_16, trust: AdaptivePolicyTrustV33_16, now: Date): void {
  if (snapshot.version !== '33.16' || snapshot.externalEffectsExecuted !== 0 || snapshot.snapshotDigest !== snapshotDigest(snapshot.records, snapshot.audits, snapshot.events, snapshot.generatedAt)) throw new Error('adaptive_snapshot_invalid');
  const recordIds = new Set<string>();
  for (const record of snapshot.records) { if (recordIds.has(record.recordId)) throw new Error('adaptive_snapshot_duplicate_record'); recordIds.add(record.recordId); verifyRecord(record, trust, now); }
  const auditIds = new Set<string>();
  for (const audit of snapshot.audits) { if (auditIds.has(audit.auditId)) throw new Error('adaptive_snapshot_duplicate_audit'); auditIds.add(audit.auditId); verifyAudit(audit); }
  let previous = sha256('adaptive-policy-genesis-v33.16');
  snapshot.events.forEach((event, index) => { if (event.sequence !== index + 1 || event.previousEventDigest !== previous) throw new Error('adaptive_event_chain_invalid'); verifyEvent(event); previous = event.eventDigest; });
}

function appendEvent(events: readonly AdaptivePolicyEventV33_16[], input: { eventType: AdaptivePolicyEventV33_16['eventType']; tenantId: string; recordId?: string; payloadDigest: string; occurredAt: string }): AdaptivePolicyEventV33_16 {
  const material = { version: '33.16' as const, eventId: `adaptive-event-${randomUUID()}`, sequence: events.length + 1, eventType: input.eventType, tenantId: input.tenantId, ...(input.recordId === undefined ? {} : { recordId: input.recordId }), payloadDigest: input.payloadDigest, occurredAt: input.occurredAt, previousEventDigest: events.at(-1)?.eventDigest ?? sha256('adaptive-policy-genesis-v33.16'), externalEffectsExecuted: 0 as const };
  return { ...material, eventDigest: sha256(material) };
}
function verifyEvent(event: AdaptivePolicyEventV33_16): void { const { eventDigest, ...material } = event; if (event.externalEffectsExecuted !== 0 || sha256(material) !== eventDigest) throw new Error('adaptive_event_invalid'); }
function verifyAudit(audit: AdaptiveExecutionAuditV33_16): void { const { auditDigest, ...material } = audit; if (audit.externalEffectsExecuted !== 0 || audit.evidenceClass !== 'LOCAL_MEASURED_EXECUTION' || sha256(material) !== auditDigest) throw new Error('adaptive_audit_invalid'); }
function verifyRoutingDecision(value: AdaptiveRoutingDecisionV33_16): void { const { decisionDigest, ...material } = value; if (value.authorityExpanded || value.externalEffectsExecuted !== 0 || sha256(material) !== decisionDigest) throw new Error('adaptive_routing_decision_invalid'); }

function decision(input: { tenantId: string; workflowType: string }, route: AdaptiveControllerRouteV33_16, reason: AdaptiveRoutingDecisionV33_16['reason'], consideredRecordIds: readonly string[], now: Date, selected?: AdaptivePolicyRecordV33_16): AdaptiveRoutingDecisionV33_16 {
  const material = { version: '33.16' as const, decisionId: `adaptive-controller-route-${randomUUID()}`, tenantId: input.tenantId, workflowType: input.workflowType, route, reason, ...(selected === undefined ? {} : { selectedRecordId: selected.recordId, selectedPassportDigest: selected.passport.payload.passportDigest, projectedCostUnits: selected.projection.projectedCostUnits, projectedDurationMs: selected.projection.projectedDurationMs, projectedUserSteps: selected.projection.projectedUserSteps }), consideredRecordIds: [...consideredRecordIds].sort(), evaluatedAt: now.toISOString(), authorityExpanded: false as const, externalEffectsExecuted: 0 as const };
  return { ...material, decisionDigest: sha256(material) };
}

function compareEligible(a: { record: AdaptivePolicyRecordV33_16 }, b: { record: AdaptivePolicyRecordV33_16 }): number {
  return a.record.projection.projectedCostUnits - b.record.projection.projectedCostUnits
    || a.record.projection.projectedDurationMs - b.record.projection.projectedDurationMs
    || a.record.projection.projectedUserSteps - b.record.projection.projectedUserSteps
    || b.record.projection.evidenceScore - a.record.projection.evidenceScore
    || a.record.passport.payload.passportDigest.localeCompare(b.record.passport.payload.passportDigest);
}
function projectionWithinBudget(p: ShortcutProjectionV33_16, b: AdaptiveRoutingBudgetV33_16): boolean { return p.projectedCostUnits <= b.maximumCostUnits && p.projectedDurationMs <= b.maximumDurationMs && p.projectedUserSteps <= b.maximumUserSteps; }
function validateBudget(b: AdaptiveRoutingBudgetV33_16): void { nonNegative(b.maximumCostUnits, 'maximum_cost_units'); nonNegative(b.maximumDurationMs, 'maximum_duration_ms'); nonNegative(b.maximumUserSteps, 'maximum_user_steps'); }
function boundaryFromPassport(p: ShortcutPassportV33_15): WorkflowBoundaryV33_15 { return { tenantId: p.tenantId, workflowType: p.workflowType, authorityGrantDigest: p.authorityGrantDigest, allowedScopes: p.allowedScopes, policyDigest: p.policyDigest, inputSchemaDigest: p.inputSchemaDigest, toolchainDigest: p.toolchainDigest, modelSetDigest: p.modelSetDigest, riskClass: 'low', reversible: true }; }
function byRecordId(a: AdaptivePolicyRecordV33_16, b: AdaptivePolicyRecordV33_16): number { return a.recordId.localeCompare(b.recordId); }
function sameScopes(a: readonly string[], b: readonly string[]): boolean { return sha256([...a].sort()) === sha256([...b].sort()); }
function unique(values: readonly string[], code: string): readonly string[] { const rows = values.map((x) => nonEmpty(x, code)); if (new Set(rows).size !== rows.length) throw new Error(code); return [...rows].sort(); }
function digest(value: string, code: string): string { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(code); return value; }
function nonEmpty(value: string, code: string): string { const v = value.trim(); if (v === '') throw new Error(code); return v; }
function nonNegative(value: number, code: string): void { if (!Number.isFinite(value) || value < 0) throw new Error(`${code}_invalid`); }
function instant(value: string, code: string): number { const n = Date.parse(value); if (!Number.isFinite(n)) throw new Error(code); return n; }
function acquireLock(path: string): number { try { return openSync(path, 'wx', 0o600); } catch { throw new Error('adaptive_store_locked'); } }
function releaseLock(fd: number, path: string): void { closeSync(fd); try { unlinkSync(path); } catch { /* best effort */ } }
function atomicReplace(path: string, contents: string): void { const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`; const fd = openSync(temporary, 'wx', 0o600); try { writeFileSync(fd, contents, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); } try { renameSync(temporary, path); } catch (error) { try { unlinkSync(temporary); } catch { /* best effort */ } throw error; } }
