import assert from 'node:assert/strict';
import test from 'node:test';
import { SovereignDomainPackGenerator, type DomainSpecification } from '../src/platform/domain-pack-generator.js';

function spec(): DomainSpecification { return {
  domainId:'test-domain',version:'1.0.0',ontologyVersion:'1',entities:['entity','entity'],
  workflows:[{workflowId:'flow',goal:'Goal',actions:['read','read'],requiredScopes:['domain.read','domain.read'],evidenceClasses:['COMPUTED','COMPUTED']}],
  requirements:[{statement:'Must work',criticality:'HIGH',verificationModes:['TEST','TEST'],evidenceClasses:['COMPUTED','COMPUTED']}],
  uiNeeds:['review','review'],risks:['risk','risk'],assumptions:['assumption'],sourceRefs:['source','source'],
}; }

test('domain generator deduplicates generated contracts and requires a fresh draft', () => {
  const generator=new SovereignDomainPackGenerator(); const draft=generator.generate(spec());
  assert.deepEqual(draft.manifest.requiredCapabilities,['domain.test-domain.read']);
  assert.deepEqual(draft.manifest.requiredScopes,['domain.read']);
  assert.deepEqual(draft.manifest.emittedEvidenceClasses,['COMPUTED']);
  assert.deepEqual(draft.ontology.entities,['entity']);
  assert.deepEqual(draft.requirementTemplates[0]?.verificationModes,['TEST']);
  const approved=generator.approve(draft,[' ','r1','r1','r2']);
  assert.deepEqual(approved.approvedBy,['r1','r2']);
  assert.throws(()=>generator.approve(approved,['r1','r2']),/not_awaiting_approval/);
});

test('domain specification rejects every identity, completeness and duplicate-workflow boundary', () => {
  const generator=new SovereignDomainPackGenerator();
  for(const domainId of ['A','ab','-bad','bad_underscore']) assert.throws(()=>generator.generate({...spec(),domainId}),/invalid_domain_id/);
  assert.throws(()=>generator.generate({...spec(),version:' '}),/domain_version_required/);
  assert.throws(()=>generator.generate({...spec(),ontologyVersion:' '}),/domain_version_required/);
  for(const field of ['entities','workflows','requirements','uiNeeds','risks','sourceRefs'] as const) assert.throws(()=>generator.generate({...spec(),[field]:[]}),/incomplete_domain_specification/);
  assert.throws(()=>generator.generate({...spec(),workflows:[spec().workflows[0]!,spec().workflows[0]!]}),/duplicate_domain_workflow/);
});

test('domain workflows reject blank goals/actions/scopes/evidence and all privileged scope prefixes', () => {
  const generator=new SovereignDomainPackGenerator(); const base=spec().workflows[0]!;
  for(const workflow of [{...base,workflowId:' '},{...base,goal:' '},{...base,actions:[]},{...base,requiredScopes:[]},{...base,evidenceClasses:[]}]) assert.throws(()=>generator.generate({...spec(),workflows:[workflow]}),/invalid_domain_workflow/);
  for(const scope of ['domain.*','authority.grant','tenant.write','secret.read','release.promote','kernel.modify']) assert.throws(()=>generator.generate({...spec(),workflows:[{...base,requiredScopes:[scope]}]}),/domain_pack_unsafe_scope/);
  assert.throws(()=>generator.generate({...spec(),workflows:[{...base,evidenceClasses:['UNKNOWN' as never]}]}),/invalid_domain_evidence_class/);
});

test('domain requirements reject blank statement and missing verification or evidence', () => {
  const generator=new SovereignDomainPackGenerator(); const base=spec().requirements[0]!;
  for(const requirement of [{...base,statement:' '},{...base,verificationModes:[]},{...base,evidenceClasses:[]}]) assert.throws(()=>generator.generate({...spec(),requirements:[requirement]}),/invalid_domain_requirement/);
});
