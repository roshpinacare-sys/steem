import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AuthorityGrant } from '../src/contracts/canonical.js';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../src/contracts/crypto.js';
import {
  FileDeliberationStore, GovernedDeliberationCouncil, GovernedDeliberationRunner,
  type GovernedDeliberationRequest,
} from '../src/ai/governed-deliberation.js';
import {
  FileModelRunStore, GovernedModelOrchestrator,
  type GovernedModelAdapter, type ModelAdapterInput, type ModelAdapterOutput, type ModelWorkNode,
} from '../src/ai/governed-model-orchestrator.js';

const now = new Date('2026-07-17T15:00:00.000Z');
class RoleAdapter implements GovernedModelAdapter {
  calls = 0;
  constructor(readonly conflictRole?: string) {}
  async invoke(input: ModelAdapterInput): Promise<ModelAdapterOutput> {
    this.calls += 1;
    const role = /^\[([A-Z]+)\]/.exec(input.objective)?.[1] ?? 'UNKNOWN';
    const output = `${role} bounded analysis`;
    const kind = role === 'TEST' ? 'TEST_PROPOSAL' : role === 'OPERATIONS' ? 'OPERATIONAL_RECOMMENDATION' : role === 'ARCHITECTURE' ? 'CHANGE_PROPOSAL' : 'REVIEW_REQUEST';
    const requestedTool = kind === 'TEST_PROPOSAL' ? 'tests.propose' as const : kind === 'CHANGE_PROPOSAL' ? 'change.propose' as const : kind === 'OPERATIONAL_RECOMMENDATION' ? 'operations.recommend' as const : undefined;
    const startedAt = new Date(now.getTime() + this.calls * 10).toISOString();
    const payload: Record<string, unknown> = { userValue: role === 'PRODUCT' ? 10 : 8, riskReduction: role === 'SECURITY' ? 10 : 8, effort: 3, complexity: 3 };
    if (kind === 'TEST_PROPOSAL') payload.proofObligations = ['TEST','MUTATION'];
    const node: ModelWorkNode = {
      nodeId: `${role.toLowerCase()}-work`, kind, summary: `${role} high-value work`, dependsOn: [],
      ...(requestedTool === undefined ? {} : { requestedTool }), payload,
    };
    return {
      provider: 'fixture-sol', model: 'sol-5.6-fixture', output,
      claims: [{ claimId: 'shared-architecture-claim', statement: this.conflictRole === role ? 'Conflicting architecture conclusion.' : 'The campaign must remain proposal-only.', classification: 'SUPPORTED', evidenceRefs: [`evidence:${role.toLowerCase()}`] }],
      workGraph: [node],
      usage: { inputChars: input.context.reduce((sum, item) => sum + item.content.length, 0), outputChars: output.length, latencyMs: 20 },
      startedAt, finishedAt: new Date(Date.parse(startedAt) + 20).toISOString(), limitations: ['fixture-model-not-external-qualification'],
    };
  }
}
function setup(root = mkdtempSync(join(tmpdir(), 'deliberation-v30-')), adapter = new RoleAdapter()) {
  const authoritySigner = generateSigningIdentity('authority-v30'); const modelSigner = generateSigningIdentity('model-v30'); const councilSigner = generateSigningIdentity('council-v30');
  const registry = new KeyRegistry(); for (const signer of [authoritySigner, modelSigner, councilSigner]) registry.register(signer.keyId, signer.publicKey);
  const grant: AuthorityGrant = { grantId: 'grant-v30', tenantId: 'tenant-1', subjectId: 'repo:alpha', scopes: ['model.analyze','model.design','model.review','model.operations'], issuedAt: new Date(now.getTime()-1000).toISOString(), expiresAt: new Date(now.getTime()+60_000).toISOString(), issuer: 'kernel' };
  const model = new GovernedModelOrchestrator(registry, modelSigner, adapter, new FileModelRunStore(join(root, 'models')));
  const council = new GovernedDeliberationCouncil(registry, councilSigner, new FileDeliberationStore(join(root, 'council')));
  return { root, adapter, registry, authoritySigner, grant, modelSigner, councilSigner, runner: new GovernedDeliberationRunner(model, council), council };
}
function request(h: ReturnType<typeof setup>, patch: Partial<GovernedDeliberationRequest> = {}): GovernedDeliberationRequest {
  return {
    deliberationId: 'delib-1', tenantId: 'tenant-1', subjectId: 'repo:alpha', requesterId: 'operator-1', authority: signEnvelope(h.grant, h.authoritySigner),
    context: [{ contextId: 'program', source: 'program-state', trust: 'TRUSTED', priority: 10, content: 'Integrated pilot with external qualification blockers.', evidenceRefs: ['evidence:architecture','evidence:security','evidence:test','evidence:product','evidence:operations'] }],
    perRoleBudget: { maxContextChars: 5000, maxOutputChars: 1000, maxClaims: 5, maxGraphNodes: 10, maxToolProposals: 5, maxLatencyMs: 1000 },
    aggregateBudget: { maxRoles: 5, maxTotalInputChars: 25_000, maxTotalOutputChars: 5_000, maxTotalLatencyMs: 5_000 },
    roles: [
      { role: 'ARCHITECTURE', perspectiveId: 'architecture-perspective', purpose: 'DESIGN', objective: 'Design complete architecture', allowedTools: ['repository.read','evidence.read','change.propose'] },
      { role: 'SECURITY', perspectiveId: 'security-perspective', purpose: 'REVIEW', objective: 'Falsify security boundaries', allowedTools: ['evidence.read','tests.propose'] },
      { role: 'TEST', perspectiveId: 'test-perspective', purpose: 'ANALYZE', objective: 'Design adversarial tests', allowedTools: ['repository.read','tests.propose'] },
      { role: 'PRODUCT', perspectiveId: 'product-perspective', purpose: 'ANALYZE', objective: 'Maximize user value', allowedTools: ['evidence.read','operations.recommend'] },
      { role: 'OPERATIONS', perspectiveId: 'operations-perspective', purpose: 'OPERATIONS', objective: 'Qualify operations and recovery', allowedTools: ['evidence.read','operations.recommend'] },
    ], createdAt: now.toISOString(), ...patch,
  };
}

test('five bounded perspectives produce a signed proposal-only deliberation packet', async () => {
  const h = setup(); const packet = await h.runner.run(request(h), now);
  assert.equal(h.registry.verify(packet), true); assert.equal(packet.payload.synthesisState, 'READY_FOR_CAMPAIGN');
  assert.equal(packet.payload.perspectiveCount, 5); assert.equal(packet.payload.roleCoverage.length, 5); assert.equal(packet.payload.workNodes.length, 5);
  assert.equal(packet.payload.externalInteractionsExecuted, 0); assert.equal(packet.payload.externalMutationsExecuted, 0); assert.equal(packet.payload.externalEffectsExecuted, 0); assert.equal(packet.payload.executionState, 'REVIEW_REQUIRED');
  assert.equal(packet.payload.evidence.payload.proposalOnly, true); assert.equal(h.adapter.calls, 5);
});

test('deliberation reuses persisted model receipts and packet across restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deliberation-restart-v30-')); const h = setup(root); const first = await h.runner.run(request(h), now);
  const adapter = new RoleAdapter();
  const model = new GovernedModelOrchestrator(h.registry, h.modelSigner, adapter, new FileModelRunStore(join(root, 'models')));
  const council = new GovernedDeliberationCouncil(h.registry, h.councilSigner, new FileDeliberationStore(join(root, 'council')));
  const reopened = new GovernedDeliberationRunner(model, council); const second = await reopened.run(request(h), now);
  assert.equal(sha256(first), sha256(second)); assert.equal(adapter.calls, 0);
});

test('conflicting perspectives are surfaced and block ready-for-campaign status', async () => {
  const h = setup(undefined, new RoleAdapter('SECURITY')); const packet = await h.runner.run(request(h), now);
  assert.equal(packet.payload.synthesisState, 'CONFLICT_REVIEW_REQUIRED'); assert.equal(packet.payload.conflicts.length, 1);
  assert.deepEqual(packet.payload.conflicts[0]?.roles, ['ARCHITECTURE','OPERATIONS','PRODUCT','SECURITY','TEST']);
});

test('runner rejects duplicate roles, perspectives and aggregate budget abuse', async () => {
  const h = setup(); const base = request(h);
  await assert.rejects(h.runner.run({ ...base, roles: [base.roles[0]!, { ...base.roles[1]!, role: 'ARCHITECTURE' }] }, now), /role_or_perspective_duplicate/);
  await assert.rejects(h.runner.run({ ...base, roles: [base.roles[0]!, { ...base.roles[1]!, perspectiveId: base.roles[0]!.perspectiveId }] }, now), /role_or_perspective_duplicate/);
  await assert.rejects(h.runner.run({ ...base, aggregateBudget: { ...base.aggregateBudget, maxRoles: 2 } }, now), /role_count_invalid/);
  const tiny = { ...base, aggregateBudget: { ...base.aggregateBudget, maxTotalOutputChars: 1 } };
  await assert.rejects(h.runner.run(tiny, now), /aggregate_budget_exceeded/);
});

test('authority, receipt signature and identity substitution fail closed', async () => {
  const h = setup(); const badAuthority = generateSigningIdentity('bad-authority');
  await assert.rejects(h.runner.run({ ...request(h), authority: signEnvelope(h.grant, badAuthority) }, now), /signature_invalid/);
  const valid = await h.runner.run(request(h), now);
  const rogue = generateSigningIdentity('rogue');
  const submission = { role: 'ARCHITECTURE' as const, perspectiveId: 'rogue-perspective', receipt: signEnvelope(valid.payload.workNodes as never, rogue) as never };
  assert.throws(() => h.council.synthesize({ deliberationId: 'bad', tenantId: 'tenant-1', subjectId: 'repo:alpha', requesterId: 'operator-1', requiredRoles: ['ARCHITECTURE','SECURITY'], submissions: [submission], aggregateBudget: request(h).aggregateBudget, generatedAt: now.toISOString() }), /signature_invalid/);
});

test('file store detects tamper and request substitution', async () => {
  const h = setup(); await h.runner.run(request(h), now);
  await assert.rejects(h.runner.run(request(h, { context: [{ contextId: 'changed', source: 'x', trust: 'TRUSTED', priority: 1, content: 'different' }] }), now), /request_conflict/);
  const dir = join(h.root, 'council'); const file = join(dir, readdirSync(dir).find((name) => name.endsWith('.json'))!);
  const row = JSON.parse(readFileSync(file, 'utf8')); row.requestDigest = sha256('tamper'); writeFileSync(file, JSON.stringify(row));
  assert.throws(() => new FileDeliberationStore(dir).get('delib-1'), /store_tampered/);
});
