import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createAuditEvent, probeAuditCompleteness, type AuditEvent, type AuditEventKind } from '../src/platform/audit-completeness.js';
import { ModelLifecycleWatchdog, type ModelLifecycleRecord } from '../src/ai/model-lifecycle-watchdog.js';
import { PaymentSafetyLedger, type PaymentIntent, type PaymentProviderEvent } from '../src/platform/payment-safety.js';
import { SemanticChangeDag, type SemanticChangeNode } from '../src/repository/semantic-change-dag.js';
import { evaluateUncertainty, type MeasurementEvidence, type UncertaintyRequirement } from '../src/platform/uncertainty-assurance.js';
import { validateWorkspaceContinuity } from '../src/governance/workspace-continuity.js';

const root = resolve(process.cwd());
const at = '2026-07-18T00:00:00.000Z';
const digest = 'a'.repeat(64);
const throws = (fn: () => unknown, text: string) => assert.throws(fn, new RegExp(text));

function event(kind: AuditEventKind, sequence: number, previousDigest: string | null, overrides: Partial<Omit<AuditEvent, 'digest'>> = {}): AuditEvent {
  const base = { sequence, eventId: `e-${sequence}`, operationId: 'op', tenantId: 'tenant', actorId: 'actor', kind, occurredAt: at, payloadDigest: digest, previousDigest };
  return createAuditEvent({ ...base, ...overrides });
}

function paymentEvent(kind: PaymentProviderEvent['kind'], index: number, overrides: Partial<PaymentProviderEvent> = {}): PaymentProviderEvent {
  return { providerEventId: `provider-${index}`, idempotencyKey: `idem-${index}`, intentId: 'pi', tenantId: 'tenant', providerId: 'provider', kind, amountMinor: 100, currency: 'USD', signatureVerified: true, observedAt: at, ...overrides };
}

function paymentIntent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return { intentId: 'pi', tenantId: 'tenant', amountMinor: 100, currency: 'USD', providerId: 'provider', ...overrides };
}

function model(overrides: Partial<ModelLifecycleRecord> = {}): ModelLifecycleRecord {
  return { modelId: 'm1', providerId: 'p1', status: 'ACTIVE', allowedPurposes: ['code'], evidenceRef: 'ev', ...overrides };
}

function uncertaintyRequirement(overrides: Partial<UncertaintyRequirement> = {}): UncertaintyRequirement {
  return { requirementId: 'r1', criticality: 'MEDIUM', toleranceMin: 0, toleranceMax: 10, minimumSamples: 2, allowedEvidenceClasses: ['OBSERVED', 'COMPUTED', 'SIMULATED'], ...overrides };
}

function measurement(overrides: Partial<MeasurementEvidence> = {}): MeasurementEvidence {
  return { measurementId: 'm1', requirementId: 'r1', evidenceClass: 'OBSERVED', estimate: 5, lowerBound: 4, upperBound: 6, unit: 'ms', sampleCount: 2, method: 'meter', evidenceRef: 'ev', ...overrides };
}

function dagNode(overrides: Partial<SemanticChangeNode> = {}): SemanticChangeNode {
  return { nodeId: 'n1', kind: 'code', summary: ' code ', dependsOn: [], files: ['./src\\a.ts'], evidenceObligations: [' test ', 'test'], risk: 'low', ...overrides };
}

test('source-remine audit branch matrix covers empty, read-only, custom, actor and terminal paths', () => {
  const empty = probeAuditCompleteness([], []);
  assert.equal(empty.coverage, 1);
  assert.equal(empty.root, null);
  const kinds: AuditEventKind[] = ['REQUESTED', 'AUTHORIZED', 'STARTED', 'COMPLETED'];
  let previous: string | null = null;
  const rows = kinds.map((kind, index) => { const row = event(kind, index + 1, previous, kind === 'AUTHORIZED' ? { actorId: 'approver' } : {}); previous = row.digest; return row; });
  assert.equal(probeAuditCompleteness([{ operationId: 'op', tenantId: 'tenant', actorId: 'actor', sideEffecting: false }], rows).status, 'PASS');
  const actorMismatch = rows.map((row) => row.kind === 'STARTED' ? { ...row, actorId: 'other' } : row);
  assert.ok(probeAuditCompleteness([{ operationId: 'op', tenantId: 'tenant', actorId: 'actor', sideEffecting: false, requiredKinds: ['REQUESTED'] }], actorMismatch).findings.some((x) => x.code === 'ACTOR_MISMATCH'));
  for (const terminalKind of ['FAILED', 'ROLLED_BACK'] as const) {
    previous = null;
    const failedRows = ['REQUESTED', 'AUTHORIZED', 'STARTED', terminalKind].map((kind, index) => { const row = event(kind as AuditEventKind, index + 1, previous); previous = row.digest; return row; });
    assert.ok(probeAuditCompleteness([{ operationId: 'op', tenantId: 'tenant', actorId: 'actor', sideEffecting: false, requiredKinds: ['REQUESTED', terminalKind] }], failedRows).coverage === 1);
  }
});

test('source-remine audit validation isolates every material boundary and sparse event path', () => {
  for (const [override, code] of [
    [{ sequence: 0 }, 'audit_event_sequence_invalid'], [{ sequence: 1.5 }, 'audit_event_sequence_invalid'],
    [{ eventId: '' }, 'audit_event_identity_invalid'], [{ operationId: '' }, 'audit_event_identity_invalid'], [{ tenantId: '' }, 'audit_event_identity_invalid'], [{ actorId: '' }, 'audit_event_identity_invalid'],
    [{ occurredAt: 'bad' }, 'audit_event_time_invalid'], [{ payloadDigest: 'bad' }, 'audit_payload_digest_invalid'], [{ previousDigest: 'bad' }, 'audit_previous_digest_invalid'],
  ] as const) throws(() => createAuditEvent({ ...{ sequence: 1, eventId: 'e', operationId: 'op', tenantId: 't', actorId: 'a', kind: 'REQUESTED' as const, occurredAt: at, payloadDigest: digest, previousDigest: null }, ...override }), code);
  for (const invalid of [
    { operationId: '', tenantId: 't', actorId: 'a', sideEffecting: false },
    { operationId: 'o', tenantId: '', actorId: 'a', sideEffecting: false },
    { operationId: 'o', tenantId: 't', actorId: '', sideEffecting: false },
  ]) throws(() => probeAuditCompleteness([invalid], []), 'audit_expected_operation_invalid');
  const sparse = new Array<AuditEvent>(1);
  const result = probeAuditCompleteness([], sparse);
  assert.equal(result.eventCount, 1);
});

test('source-remine payment branch matrix covers replay, failure, refund, reconciliation and lookup', () => {
  const ledger = new PaymentSafetyLedger();
  ledger.create(paymentIntent());
  throws(() => ledger.create(paymentIntent()), 'payment_intent_exists');
  const authorize = paymentEvent('AUTHORIZE', 1);
  assert.equal(ledger.apply(authorize).state, 'AUTHORIZED');
  assert.equal(ledger.apply(authorize).revision, 2);
  ledger.apply(paymentEvent('CAPTURE', 2));
  ledger.apply(paymentEvent('SETTLE', 3));
  assert.equal(ledger.reconcile('pi', 100).status, 'MATCH');
  assert.equal(ledger.apply(paymentEvent('REFUND', 4)).state, 'REFUNDED');
  throws(() => ledger.apply(paymentEvent('REFUND', 5)), 'payment_transition_invalid');
  const failedCreated = new PaymentSafetyLedger(); failedCreated.create(paymentIntent());
  assert.equal(failedCreated.apply(paymentEvent('FAIL', 6)).state, 'FAILED');
  const failedAuthorized = new PaymentSafetyLedger(); failedAuthorized.create(paymentIntent()); failedAuthorized.apply(paymentEvent('AUTHORIZE', 7));
  assert.equal(failedAuthorized.apply(paymentEvent('FAIL', 8)).state, 'FAILED');
  throws(() => ledger.get('missing'), 'payment_intent_not_found');
  throws(() => ledger.reconcile('pi', -1), 'provider_settlement_invalid');
  throws(() => ledger.reconcile('pi', 1.5), 'provider_settlement_invalid');
});

test('source-remine payment input matrix isolates intent, event and authority fields', () => {
  for (const [override, code] of [
    [{ intentId: '' }, 'payment_intent_identity_invalid'], [{ tenantId: '' }, 'payment_intent_identity_invalid'], [{ providerId: '' }, 'payment_intent_identity_invalid'],
    [{ amountMinor: 0 }, 'payment_amount_invalid'], [{ amountMinor: 1.5 }, 'payment_amount_invalid'], [{ currency: 'usd' }, 'payment_currency_invalid'],
  ] as const) throws(() => new PaymentSafetyLedger().create(paymentIntent(override)), code);
  const ledger = new PaymentSafetyLedger(); ledger.create(paymentIntent());
  for (const [override, code] of [
    [{ signatureVerified: false }, 'payment_webhook_signature_unverified'],
    [{ providerEventId: '' }, 'payment_event_identity_invalid'], [{ idempotencyKey: '' }, 'payment_event_identity_invalid'], [{ intentId: '' }, 'payment_event_identity_invalid'], [{ tenantId: '' }, 'payment_event_identity_invalid'], [{ providerId: '' }, 'payment_event_identity_invalid'],
    [{ observedAt: 'bad' }, 'payment_event_time_invalid'], [{ amountMinor: 0 }, 'payment_event_amount_invalid'], [{ amountMinor: 1.5 }, 'payment_event_amount_invalid'], [{ currency: 'usd' }, 'payment_event_currency_invalid'],
  ] as const) throws(() => ledger.apply(paymentEvent('AUTHORIZE', 20, override)), code);
  throws(() => ledger.apply(paymentEvent('AUTHORIZE', 30, { tenantId: 'other' })), 'payment_authority_boundary_mismatch');
  throws(() => ledger.apply(paymentEvent('AUTHORIZE', 31, { providerId: 'other' })), 'payment_authority_boundary_mismatch');
  throws(() => ledger.apply(paymentEvent('AUTHORIZE', 32, { amountMinor: 101 })), 'payment_amount_or_currency_mismatch');
  throws(() => ledger.apply(paymentEvent('AUTHORIZE', 33, { currency: 'EUR' })), 'payment_amount_or_currency_mismatch');
});

test('source-remine uncertainty branch matrix covers simulation pass, disallowed class and estimate failure', () => {
  assert.equal(evaluateUncertainty(uncertaintyRequirement(), measurement({ evidenceClass: 'SIMULATED' })).decision, 'SIMULATION_PASS');
  assert.equal(evaluateUncertainty(uncertaintyRequirement({ allowedEvidenceClasses: ['OBSERVED'] }), measurement({ evidenceClass: 'COMPUTED' })).decision, 'INCONCLUSIVE');
  const estimate = evaluateUncertainty(uncertaintyRequirement(), measurement({ estimate: 7, lowerBound: 4, upperBound: 6 }));
  assert.equal(estimate.decision, 'FAIL');
  assert.ok(estimate.reasons.includes('ESTIMATE_OUTSIDE_INTERVAL'));
});

test('source-remine uncertainty validation isolates requirement and evidence branches', () => {
  for (const [override, code] of [
    [{ requirementId: '' }, 'uncertainty_requirement_id_required'], [{ toleranceMin: Number.NaN }, 'uncertainty_tolerance_invalid'], [{ toleranceMax: Number.NaN }, 'uncertainty_tolerance_invalid'], [{ toleranceMin: 10 }, 'uncertainty_tolerance_invalid'],
    [{ minimumSamples: 0 }, 'uncertainty_sample_floor_invalid'], [{ minimumSamples: 1.5 }, 'uncertainty_sample_floor_invalid'], [{ allowedEvidenceClasses: [] }, 'uncertainty_evidence_class_required'],
  ] as const) throws(() => evaluateUncertainty(uncertaintyRequirement(override), measurement()), code);
  for (const [override, code] of [
    [{ measurementId: '' }, 'measurement_identity_invalid'], [{ requirementId: '' }, 'measurement_identity_invalid'], [{ unit: '' }, 'measurement_identity_invalid'], [{ method: '' }, 'measurement_identity_invalid'], [{ evidenceRef: '' }, 'measurement_identity_invalid'],
    [{ estimate: Number.NaN }, 'measurement_interval_invalid'], [{ lowerBound: Number.NaN }, 'measurement_interval_invalid'], [{ upperBound: Number.NaN }, 'measurement_interval_invalid'], [{ lowerBound: 7, upperBound: 6 }, 'measurement_interval_invalid'],
    [{ sampleCount: 0 }, 'measurement_sample_count_invalid'], [{ sampleCount: 1.5 }, 'measurement_sample_count_invalid'],
  ] as const) throws(() => evaluateUncertainty(uncertaintyRequirement(), measurement(override)), code);
});

test('source-remine semantic DAG branch matrix isolates normalization, policy and rollback paths', () => {
  throws(() => new SemanticChangeDag([]), 'semantic_dag_empty');
  throws(() => new SemanticChangeDag([dagNode({ nodeId: 'bad id' })]), 'semantic_dag_node_id_invalid');
  throws(() => new SemanticChangeDag([dagNode({ summary: ' ' })]), 'semantic_dag_summary_required');
  throws(() => new SemanticChangeDag([dagNode(), dagNode()]), 'semantic_dag_duplicate_node');
  throws(() => new SemanticChangeDag([dagNode({ dependsOn: ['n1'] })]), 'semantic_dag_self_dependency');
  for (const file of ['', '/root', '../escape']) throws(() => new SemanticChangeDag([dagNode({ files: [file] })]), 'semantic_dag_file_path_invalid');
  const normalized = new SemanticChangeDag([dagNode()]);
  assert.deepEqual(normalized.snapshot()[0]?.files, ['src/a.ts']);
  assert.deepEqual(normalized.snapshot()[0]?.evidenceObligations, ['test']);
  throws(() => normalized.assess([], { maximumImpactedNodes: 1, maximumImpactedFiles: 1, sacredFiles: [], requireRollbackForRisk: [] }), 'semantic_dag_change_required');
  throws(() => normalized.assess(['missing'], { maximumImpactedNodes: 1, maximumImpactedFiles: 1, sacredFiles: [], requireRollbackForRisk: [] }), 'semantic_dag_unknown_change');
  throws(() => normalized.assess(['n1'], { maximumImpactedNodes: 0, maximumImpactedFiles: 1, sacredFiles: [], requireRollbackForRisk: [] }), 'semantic_dag_node_limit_invalid');
  throws(() => normalized.assess(['n1'], { maximumImpactedNodes: 1, maximumImpactedFiles: 1.5, sacredFiles: [], requireRollbackForRisk: [] }), 'semantic_dag_file_limit_invalid');
  throws(() => normalized.assess(['n1'], { maximumImpactedNodes: 2, maximumImpactedFiles: 0, sacredFiles: [], requireRollbackForRisk: [] }), 'semantic_dag_file_limit_invalid');
});

test('source-remine semantic DAG separately covers file blast radius and an explicit rollback node', () => {
  const graph = new SemanticChangeDag([
    dagNode({ nodeId: 'code', risk: 'high', files: ['a', 'b'] }),
    dagNode({ nodeId: 'rollback', kind: 'rollback', dependsOn: ['code'], files: ['rollback'] }),
  ]);
  const blocked = graph.assess(['code'], { maximumImpactedNodes: 3, maximumImpactedFiles: 1, sacredFiles: [], requireRollbackForRisk: [] });
  assert.deepEqual(blocked.failures, ['BLAST_RADIUS_FILE_LIMIT']);
  const pass = graph.assess(['code'], { maximumImpactedNodes: 3, maximumImpactedFiles: 3, sacredFiles: [], requireRollbackForRisk: ['high'] });
  assert.equal(pass.status, 'PASS');
  assert.equal(pass.rollbackRequired, true);
});

test('source-remine model lifecycle branch matrix covers blocked, retirement, deprecation and invalid clock', () => {
  assert.equal(new ModelLifecycleWatchdog([model({ status: 'BLOCKED' })]).evaluate({ modelId: 'm1', providerId: 'p1', purpose: 'code', environment: 'test' }).status, 'BLOCK');
  assert.equal(new ModelLifecycleWatchdog([model({ status: 'RETIRED' })]).evaluate({ modelId: 'm1', providerId: 'p1', purpose: 'code', environment: 'test' }).status, 'BLOCK');
  const scheduled = new ModelLifecycleWatchdog([model({ retiresAt: '2027-01-01T00:00:00Z' })]);
  assert.equal(scheduled.evaluate({ modelId: 'm1', providerId: 'p1', purpose: 'code', environment: 'test' }, new Date('2026-01-01')).status, 'ALLOW');
  const deprecated = new ModelLifecycleWatchdog([model({ status: 'DEPRECATED' })]);
  assert.equal(deprecated.evaluate({ modelId: 'm1', providerId: 'p1', purpose: 'code', environment: 'test' }).status, 'WARN');
  assert.equal(deprecated.evaluate({ modelId: 'm1', providerId: 'p1', purpose: 'code', environment: 'production' }).status, 'BLOCK');
  throws(() => deprecated.evaluate({ modelId: 'm1', providerId: 'p1', purpose: 'code', environment: 'test' }, new Date('bad')), 'model_lifecycle_time_invalid');
});

test('source-remine model lifecycle validation isolates duplicate, identity, purpose, time and replacement branches', () => {
  throws(() => new ModelLifecycleWatchdog([model(), model()]), 'model_lifecycle_duplicate');
  for (const [override, code] of [
    [{ modelId: '' }, 'model_lifecycle_record_invalid'], [{ providerId: '' }, 'model_lifecycle_record_invalid'], [{ evidenceRef: '' }, 'model_lifecycle_record_invalid'],
    [{ allowedPurposes: [] }, 'model_lifecycle_purpose_invalid'], [{ allowedPurposes: [''] }, 'model_lifecycle_purpose_invalid'],
    [{ deprecatedAt: 'bad' }, 'model_lifecycle_instant_invalid'], [{ retiresAt: 'bad' }, 'model_lifecycle_instant_invalid'],
    [{ deprecatedAt: '2027-01-01T00:00:00Z', retiresAt: '2026-01-01T00:00:00Z' }, 'model_lifecycle_window_invalid'], [{ replacementModelId: 'm1' }, 'model_lifecycle_self_replacement'],
  ] as const) throws(() => new ModelLifecycleWatchdog([model(override)]), code);
});

test('source-remine workspace continuity branch matrix detects every release-continuity family', () => {
  const missingState = mkdtempSync(join(tmpdir(), 'continuity-missing-state-'));
  assert.equal(validateWorkspaceContinuity(missingState).findings[0]?.code, 'PROGRAM_STATE_MISSING');
  rmSync(missingState, { recursive: true, force: true });

  const temporary = mkdtempSync(join(tmpdir(), 'continuity-branches-'));
  cpSync(join(root, 'governance-state'), join(temporary, 'governance-state'), { recursive: true });
  mkdirSync(join(temporary, 'scripts'));
  for (const name of ['CLAUDE.md', 'MASTER_DIRECTIVE.md', 'PROGRAM_CHARTER.md']) writeFileSync(join(temporary, name), 'incomplete');
  writeFileSync(join(temporary, 'scripts/validate-artifacts.mjs'), "const manifest={version: 'old'};");
  const statePath = join(temporary, 'governance-state/PROGRAM_STATE.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8')); state.version = 'invalid'; writeFileSync(statePath, JSON.stringify(state));
  const capPath = join(temporary, 'governance-state/CAPABILITY_REGISTRY.json');
  const cap = JSON.parse(readFileSync(capPath, 'utf8')); delete cap.version; delete cap.generatedAt; delete cap.updatedAt; writeFileSync(capPath, JSON.stringify(cap));
  unlinkSync(join(temporary, 'governance-state/RISK_REGISTRY.json'));
  const result = validateWorkspaceContinuity(temporary);
  for (const code of ['PROGRAM_VERSION_INVALID', 'ROOT_AUTHORITY_INVARIANT_MISSING', 'REGISTRY_VERSION_DRIFT', 'REGISTRY_TIMESTAMP_INVALID', 'REGISTRY_MISSING', 'ARTIFACT_MANIFEST_VERSION_STALE']) assert.ok(result.findings.some((finding) => finding.code === code), code);
  unlinkSync(join(temporary, 'scripts/validate-artifacts.mjs'));
  assert.ok(validateWorkspaceContinuity(temporary).findings.some((finding) => finding.code === 'ARTIFACT_VALIDATOR_MISSING'));
  rmSync(temporary, { recursive: true, force: true });
});
