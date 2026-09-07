import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningIdentity, KeyRegistry, sha256 } from '../src/contracts/crypto.js';
import {
  FileGovernedAutomationStore,
  GovernedAutomationEngine,
  InMemoryGovernedAutomationStore,
  type AutomationEvent,
  type GovernedAutomationStore,
} from '../src/operations/governed-automation.js';

const now = new Date('2026-07-17T15:00:00Z');
function harness(store: GovernedAutomationStore = new InMemoryGovernedAutomationStore()) {
  const signer = generateSigningIdentity('automation-runner'); const registry = new KeyRegistry(); registry.register(signer.keyId, signer.publicKey);
  return { engine: new GovernedAutomationEngine(registry, signer, store), registry, signer };
}
function activate(engine: GovernedAutomationEngine, patch: Partial<Parameters<GovernedAutomationEngine['activate']>[0]> = {}) {
  return engine.activate({ ruleId: 'rule-test-failure', tenantId: 'tenant-1', name: 'Route important test failures', triggerType: 'TEST_FAILURE', condition: { minimumSeverity: 'high', subjectPrefix: 'repo:', attributeEquals: { lane: 'critical' } }, actions: [{ kind: 'PREPARE_REVIEW', title: 'Prepare engineering review', owner: 'Engineering Review Lead' }, { kind: 'PROPOSE_TESTS', title: 'Propose regression tests', owner: 'Test Lead', payload: { suite: 'full' } }], maxActions: 2, createdBy: 'owner-1', reviewerIds: ['reviewer-2', 'reviewer-1'], ...patch }, now);
}
function event(patch: Partial<AutomationEvent> = {}): AutomationEvent { return { eventId: 'event-1', tenantId: 'tenant-1', subjectId: 'repo:alpha', triggerType: 'TEST_FAILURE', severity: 'critical', occurredAt: now.toISOString(), evidenceRoot: sha256('evidence'), attributes: { lane: 'critical', failed: '2' }, ...patch }; }

test('dual-reviewed automation produces signed proposal-only actions and modeled value signals', () => {
  const h = harness(); const rule = activate(h.engine); const signed = h.engine.evaluate(event(), now);
  assert.equal(h.registry.verify(signed), true); assert.equal(rule.reviewerIds.join(','), 'reviewer-1,reviewer-2');
  assert.equal(signed.payload.status, 'PROPOSAL_ONLY'); assert.equal(signed.payload.actions.length, 2);
  assert.ok(signed.payload.actions.every((action) => action.externalMutation === false && action.state === 'PROPOSAL_ONLY'));
  assert.equal(signed.payload.valueSignals.rulesMatched, 1); assert.equal(signed.payload.valueSignals.modeledManualRoutingDecisionsAvoided, 2);
  assert.ok(signed.payload.limitations.includes('automation-actions-are-proposals-not-effects'));
});

test('conditions and tenant boundaries prevent unrelated automation', () => {
  const h = harness(); activate(h.engine);
  assert.equal(h.engine.evaluate(event({ severity: 'medium' }), now).payload.actions.length, 0);
  assert.equal(h.engine.evaluate(event({ eventId: 'event-2', subjectId: 'service:alpha' }), now).payload.actions.length, 0);
  assert.equal(h.engine.evaluate(event({ eventId: 'event-3', tenantId: 'tenant-2' }), now).payload.matchedRuleIds.length, 0);
  assert.equal(h.engine.evaluate(event({ eventId: 'event-4', attributes: { lane: 'noncritical' } }), now).payload.actions.length, 0);
});

test('activation rejects self approval, weak quorum, duplicate actions and unsafe budgets', () => {
  const h = harness();
  assert.throws(() => activate(h.engine, { reviewerIds: ['reviewer-1'] }), /dual_review/);
  assert.throws(() => activate(h.engine, { reviewerIds: ['owner-1', 'reviewer-1'] }), /dual_review/);
  assert.throws(() => activate(h.engine, { maxActions: 0 }), /action_budget/);
  const duplicate = { kind: 'PROPOSE_TESTS' as const, title: 'same', owner: 'test' };
  assert.throws(() => activate(h.engine, { actions: [duplicate, duplicate], maxActions: 2 }), /action_duplicate/);
  assert.throws(() => activate(h.engine, { triggerType: 'INVALID' as never }), /trigger_invalid/);
});

test('event validation fails closed on time, evidence, identity and attributes', () => {
  const h = harness(); activate(h.engine);
  assert.throws(() => h.engine.evaluate(event({ eventId: '' }), now), /eventId_required/);
  assert.throws(() => h.engine.evaluate(event({ evidenceRoot: 'bad' }), now), /evidence_root/);
  assert.throws(() => h.engine.evaluate(event({ occurredAt: new Date(now.getTime() + 120_000).toISOString() }), now), /time_invalid/);
  assert.throws(() => h.engine.evaluate(event({ attributes: { '': 'x' } }), now), /attributes_invalid/);
});

test('file store survives restart, detects event substitution and rejects tampering', () => {
  const root = mkdtempSync(join(tmpdir(), 'automation-v29-')); const h = harness(new FileGovernedAutomationStore(root)); activate(h.engine);
  const first = h.engine.evaluate(event(), now); const reopenedRegistry = new KeyRegistry(); reopenedRegistry.register(h.signer.keyId, h.signer.publicKey);
  const engine = new GovernedAutomationEngine(reopenedRegistry, h.signer, new FileGovernedAutomationStore(root)); const second = engine.evaluate(event(), now);
  assert.equal(sha256(first), sha256(second));
  assert.throws(() => engine.evaluate(event({ severity: 'high' }), now), /event_conflict/);
  const runFile = join(root, 'runs', readdirSync(join(root, 'runs'))[0]!); const row = JSON.parse(readFileSync(runFile, 'utf8')); row.signedRun.payload.subjectId = 'tampered'; writeFileSync(runFile, JSON.stringify(row));
  assert.throws(() => new FileGovernedAutomationStore(root).getRun('event-1'), /store_tampered|run_tampered/);
});

test('rule identifiers are immutable and rule files reject tampering', () => {
  const root = mkdtempSync(join(tmpdir(), 'automation-rule-v29-')); const store = new FileGovernedAutomationStore(root); const h = harness(store); activate(h.engine);
  assert.throws(() => activate(h.engine, { name: 'substituted name' }), /rule_id_conflict/);
  const ruleFile = join(root, 'rules', readdirSync(join(root, 'rules'))[0]!); const row = JSON.parse(readFileSync(ruleFile, 'utf8')); row.rule.name = 'tampered'; writeFileSync(ruleFile, JSON.stringify(row));
  assert.throws(() => store.rulesForTenant('tenant-1'), /store_tampered|rule_tampered/);
});

test('aggregate rule budgets fail closed before producing an oversized run', () => {
  const h = harness();
  for (let i = 0; i < 6; i += 1) activate(h.engine, { ruleId: `rule-${i}`, actions: [{ kind: 'OPEN_OPERATIONAL_ACTION', title: `action-${i}`, owner: 'ops' }], maxActions: 10, condition: {} });
  assert.throws(() => h.engine.evaluate(event(), now), /aggregate_action_budget/);
});

test('revoked automation signer invalidates persisted replay rather than silently reusing it', () => {
  const store = new InMemoryGovernedAutomationStore(); const h = harness(store); activate(h.engine); h.engine.evaluate(event(), now); h.registry.revoke(h.signer.keyId);
  assert.throws(() => h.engine.evaluate(event(), now), /signature_invalid/);
});

test('store and rule validation cover missing rows, blank roots, condition and template branches', () => {
  assert.throws(() => new FileGovernedAutomationStore(' '), /store_root_required/);
  const memory = new InMemoryGovernedAutomationStore(); assert.equal(memory.getRun('missing'), undefined); assert.deepEqual(memory.rulesForTenant('tenant-x'), []);
  assert.throws(() => memory.rulesForTenant(' '), /tenant_required/); assert.throws(() => memory.getRun(' '), /event_id_required/);
  const h = harness();
  assert.throws(() => activate(h.engine, { condition: { subjectPrefix: ' ' } }), /condition_subject/);
  assert.throws(() => activate(h.engine, { condition: { attributeEquals: { '': 'x' } } }), /condition_attribute/);
  assert.throws(() => activate(h.engine, { condition: { attributeEquals: { x: '' } } }), /condition_attribute/);
  assert.throws(() => activate(h.engine, { actions: [], maxActions: 1 }), /actions_invalid/);
  assert.throws(() => activate(h.engine, { actions: [{ kind: 'INVALID' as never, title: 'x', owner: 'o' }], maxActions: 1 }), /action_kind/);
  assert.throws(() => activate(h.engine, { actions: [{ kind: 'PROPOSE_TESTS', title: '', owner: 'o' }], maxActions: 1 }), /action_title/);
  assert.throws(() => activate(h.engine, { actions: [{ kind: 'PROPOSE_TESTS', title: 'x', owner: '' }], maxActions: 1 }), /action_owner/);
  assert.throws(() => h.engine.activate({ ruleId: 'r', tenantId: 't', name: 'n', triggerType: 'MANUAL_REVIEW', condition: {}, actions: [{ kind: 'PROPOSE_TESTS', title: 'x', owner: 'o' }], maxActions: 1, createdBy: 'c', reviewerIds: ['a','b'] }, new Date(Number.NaN)), /rule_time/);
});

test('event validation covers trigger, severity, tenant, subject and blank attribute values', () => {
  const h = harness(); activate(h.engine);
  assert.throws(() => h.engine.evaluate(event({ tenantId: '' }), now), /tenantId_required/);
  assert.throws(() => h.engine.evaluate(event({ subjectId: '' }), now), /subjectId_required/);
  assert.throws(() => h.engine.evaluate(event({ triggerType: 'INVALID' as never }), now), /event_trigger/);
  assert.throws(() => h.engine.evaluate(event({ severity: 'invalid' as never }), now), /event_severity/);
  assert.throws(() => h.engine.evaluate(event({ occurredAt: 'bad' }), now), /event_time/);
  assert.throws(() => h.engine.evaluate(event({ attributes: { x: '' } }), now), /attributes_invalid/);
});

test('all five automation action kinds remain proposal-only and deterministic', () => {
  const h = harness(); h.engine.activate({ ruleId: 'all-actions', tenantId: 'tenant-1', name: 'all safe proposals', triggerType: 'MANUAL_REVIEW', condition: {}, actions: [
    { kind: 'PREPARE_REVIEW', title: 'review', owner: 'reviewer' },
    { kind: 'OPEN_OPERATIONAL_ACTION', title: 'operate', owner: 'ops' },
    { kind: 'PROPOSE_TESTS', title: 'tests', owner: 'test' },
    { kind: 'PROPOSE_RECERTIFICATION', title: 'recertify', owner: 'trust' },
    { kind: 'REFRESH_EVIDENCE', title: 'refresh', owner: 'evidence' },
  ], maxActions: 5, createdBy: 'owner', reviewerIds: ['a','b'] }, now);
  const signed = h.engine.evaluate(event({ eventId: 'all', triggerType: 'MANUAL_REVIEW', attributes: {} }), now);
  assert.deepEqual(signed.payload.actions.map((action) => action.kind).sort(), ['OPEN_OPERATIONAL_ACTION','PREPARE_REVIEW','PROPOSE_RECERTIFICATION','PROPOSE_TESTS','REFRESH_EVIDENCE']);
  assert.ok(signed.payload.actions.every((action) => action.payload.eventId === 'all' && action.externalMutation === false));
});

test('run record and store key substitutions are rejected independently', () => {
  const root = mkdtempSync(join(tmpdir(), 'automation-run-edges-v29-')); const h = harness(new FileGovernedAutomationStore(root)); activate(h.engine); h.engine.evaluate(event(), now);
  const runFile = join(root, 'runs', readdirSync(join(root, 'runs'))[0]!);
  const original = JSON.parse(readFileSync(runFile, 'utf8'));
  const keyMismatch = structuredClone(original); keyMismatch.signedRun.payload.eventId = 'other'; keyMismatch.signedRun.payload.runDigest = sha256(Object.fromEntries(Object.entries(keyMismatch.signedRun.payload).filter(([key]) => key !== 'runDigest'))); keyMismatch.digest = sha256({ version: keyMismatch.version, eventDigest: keyMismatch.eventDigest, signedRun: keyMismatch.signedRun }); writeFileSync(runFile, JSON.stringify(keyMismatch));
  assert.throws(() => new FileGovernedAutomationStore(root).getRun('event-1'), /store_key_mismatch/);
  writeFileSync(runFile, JSON.stringify(original)); const unsafe = structuredClone(original); unsafe.signedRun.payload.actions[0].externalMutation = true; unsafe.signedRun.payload.runDigest = sha256(Object.fromEntries(Object.entries(unsafe.signedRun.payload).filter(([key]) => key !== 'runDigest'))); unsafe.digest = sha256({ version: unsafe.version, eventDigest: unsafe.eventDigest, signedRun: unsafe.signedRun }); writeFileSync(runFile, JSON.stringify(unsafe));
  assert.throws(() => new FileGovernedAutomationStore(root).getRun('event-1'), /run_tampered/);
});
