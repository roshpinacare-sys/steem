import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainPackRegistry } from '../src/platform/domain-pack.js';
import { SovereignDomainPackGenerator, type DomainSpecification } from '../src/platform/domain-pack-generator.js';

function jewelry(): DomainSpecification {
  return {
    domainId: 'jewelry-engineering', version: '1.0.0', ontologyVersion: '1.0',
    entities: ['design', 'material', 'stone', 'setting', 'manufacturing-plan'],
    workflows: [{ workflowId: 'design-to-certification', goal: 'Validate a manufacturable jewelry design', actions: ['analyze', 'simulate', 'certify'], requiredScopes: ['jewelry.design.read', 'jewelry.simulation.run', 'evidence.emit'], evidenceClasses: ['COMPUTED', 'SIMULATED', 'ATTESTED'] }],
    requirements: [{ statement: 'Manufacturing tolerances must be verified before shadow certification.', criticality: 'HIGH', verificationModes: ['TEST', 'SIMULATION', 'REVIEW'], evidenceClasses: ['SIMULATED', 'ATTESTED'] }],
    uiNeeds: ['design-review', 'tolerance-evidence'], risks: ['Simulation may not reflect physical manufacturing variation.'], assumptions: ['Material properties are supplied by a trusted catalog.'], sourceRefs: ['Yongzuan-v134'],
  };
}
function irrigation(): DomainSpecification {
  return {
    domainId: 'irrigation-control', version: '1.0.0', ontologyVersion: '1.0',
    entities: ['orchard', 'water-head', 'valve', 'program', 'flow-meter'],
    workflows: [{ workflowId: 'schedule-validation', goal: 'Validate a bounded irrigation schedule before operator approval', actions: ['calculate', 'conflict-check', 'schedule'], requiredScopes: ['irrigation.plan.read', 'irrigation.schedule.propose', 'evidence.emit'], evidenceClasses: ['COMPUTED', 'OBSERVED', 'ATTESTED'] }],
    requirements: [{ statement: 'No water head may activate conflicting valves concurrently.', criticality: 'SAFETY_CRITICAL', verificationModes: ['TEST', 'REVIEW'], evidenceClasses: ['COMPUTED', 'ATTESTED'] }],
    uiNeeds: ['schedule-review', 'conflict-explanation', 'recovery-preview'], risks: ['Incorrect flow assumptions can produce pressure loss.'], assumptions: ['Nominal and observed flow data are current.'], sourceRefs: ['Yongzuan-generalization', 'Motorola-ICC-domain-knowledge'],
  };
}

test('generator creates bounded jewelry pack scaffolding without authority ownership', () => {
  const draft = new SovereignDomainPackGenerator().generate(jewelry());
  assert.equal(draft.status, 'DRAFT_REQUIRES_HUMAN_APPROVAL');
  assert.equal(draft.manifest.authorityModel, 'canonical-kernel-only');
  assert.ok(draft.testSkeleton.some((item) => item.negativeCases.includes('simulation labeled measured')));
  assert.ok(draft.uncertainties.every((item) => item.length > 0));
  assert.deepEqual(draft.approvedBy, []);
});

test('generator supports a structurally different irrigation domain', () => {
  const draft = new SovereignDomainPackGenerator().generate(irrigation());
  assert.ok(draft.ontology.entities.includes('valve'));
  assert.ok(draft.manifest.requiredScopes.includes('irrigation.schedule.propose'));
  assert.ok(draft.requirementTemplates.some((item) => item.criticality === 'SAFETY_CRITICAL'));
  assert.ok(draft.uiSchema.every((surface) => surface.authoritative === false));
});

test('generated pack requires two human reviewers before registry admission', () => {
  const generator = new SovereignDomainPackGenerator();
  const draft = generator.generate(jewelry());
  assert.throws(() => generator.approve(draft, ['reviewer-1']), /dual_review/);
  const approved = generator.approve(draft, ['reviewer-1', 'reviewer-2']);
  assert.equal(approved.status, 'APPROVED_FOR_REGISTRATION');
  const registered = new DomainPackRegistry().registerApproved(approved);
  assert.equal(registered.manifestDigest.length, 64);
});

test('tampering with generated pack is detected before approval', () => {
  const generator = new SovereignDomainPackGenerator();
  const draft = generator.generate(jewelry());
  const tampered = { ...draft, uncertainties: [] };
  assert.throws(() => generator.approve(tampered, ['reviewer-1', 'reviewer-2']), /tampered/);
});

test('wildcard, kernel-owned scopes and incomplete specifications are rejected', () => {
  const generator = new SovereignDomainPackGenerator();
  assert.throws(() => generator.generate({ ...jewelry(), workflows: [{ ...jewelry().workflows[0]!, requiredScopes: ['*'] }] }), /unsafe_scope/);
  assert.throws(() => generator.generate({ ...jewelry(), workflows: [{ ...jewelry().workflows[0]!, requiredScopes: ['authority.grant'] }] }), /unsafe_scope/);
  assert.throws(() => generator.generate({ ...jewelry(), risks: [] }), /incomplete/);
});
