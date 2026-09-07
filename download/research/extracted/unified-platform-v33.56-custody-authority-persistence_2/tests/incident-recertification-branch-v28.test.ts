import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ContentAddressedArtifactStore } from '../src/artifacts/content-addressed-store.js';
import { evidenceDigest, type EvidenceRecord } from '../src/contracts/canonical.js';
import { PersistentCapabilityTrustStore } from '../src/platform/capability-trust.js';
import { IncidentToRecertificationPipeline, type GovernedIncident, type IncidentCategory } from '../src/platform/incident-recertification.js';

const now=new Date('2026-07-17T12:00:00.000Z');
function harness(){const root=mkdtempSync(join(tmpdir(),'incident-v28-'));const trust=new PersistentCapabilityTrustStore(join(root,'trust'));trust.register({tenantId:'tenant-1',capabilityId:'engine',version:'1.0.0',publisherId:'publisher',originalScopes:['repository.read','evidence.emit']},now);return new IncidentToRecertificationPipeline(trust,new ContentAddressedArtifactStore(join(root,'artifacts')));}
function incident(category:IncidentCategory='SCIENTIFIC_HONESTY_VIOLATION',overrides:Partial<GovernedIncident>={}):GovernedIncident{return{incidentId:`incident-${category}-${Math.random()}`,tenantId:'tenant-1',capabilityRef:'engine@1.0.0',category,severity:'MEDIUM',subject:'candidate',evidenceRefs:['e1'],affectedContracts:['contract'],affectedArtifacts:['artifact'],reportedBy:'operator',occurredAt:now.toISOString(),summary:'observed failure',...overrides};}
function chain(overrides:Partial<EvidenceRecord>={}):{rows:EvidenceRecord[];root:string}{const rows:EvidenceRecord[]=[];let previous:string|undefined;for(const kind of ['regression-test','runtime-monitor','artifact-integrity']){const base:EvidenceRecord={recordId:`${kind}-${Math.random()}`,tenantId:'tenant-1',kind,subject:'engine@1.0.0',payload:{passed:true},evidenceClass:'ATTESTED',method:'v28',environment:{runtime:'node'},createdAt:now.toISOString(),limitations:[],...overrides};const row=previous===undefined?base:{...base,previousDigest:previous};rows.push(row);previous=evidenceDigest(row);}return{rows,root:previous!};}

test('all incident mappings produce bounded failure knowledge including scientific honesty',()=>{
  const categories:IncidentCategory[]=['DUPLICATE_SIDE_EFFECT','TENANT_LEAKAGE','FALSE_COMPLETION_CLAIM','INVALID_WEBHOOK','ARTIFACT_TAMPERING','KEY_COMPROMISE','SCIENTIFIC_HONESTY_VIOLATION','TEST_DELETION','DATABASE_RECOVERY_INCIDENT','ROLLBACK_FAILURE'];
  for(const category of categories){const plan=harness().open(incident(category),now);assert.equal(plan.incidentId.startsWith(`incident-${category}`),true);assert.ok(plan.failureKnowledge.regressionTest.length>0);}
});

test('incident validation rejects every blank identity and invalid time',()=>{
  for(const field of ['incidentId','tenantId','capabilityRef','subject','reportedBy','summary'] as const) assert.throws(()=>harness().open(incident('INVALID_WEBHOOK',{[field]:' '}),now),/invalid_incident/);
  assert.throws(()=>harness().open(incident('INVALID_WEBHOOK',{occurredAt:'not-a-time'}),now),/invalid_incident_time/);
  assert.throws(()=>harness().open(incident('INVALID_WEBHOOK',{affectedContracts:[]}),now),/scope_and_evidence/);
});

test('recertification rejects unknown cases, broken chain and nonpassing evidence',()=>{
  const pipeline=harness(); const evidence=chain();
  assert.throws(()=>pipeline.recertify({caseId:'missing',evidenceRecords:evidence.rows,evidenceRoot:evidence.root,reviewerIds:['r1','r2'],restoredScopes:['repository.read']},now),/case_not_found/);
  const plan=pipeline.open(incident('INVALID_WEBHOOK'),now);
  const broken=chain(); broken.rows[1]={...broken.rows[1]!,previousDigest:'0'.repeat(64)};
  assert.throws(()=>pipeline.recertify({caseId:plan.caseId,evidenceRecords:broken.rows,evidenceRoot:broken.root,reviewerIds:['r1','r2'],restoredScopes:['repository.read']},now),/chain_invalid/);
  const failing=chain(); failing.rows[0]={...failing.rows[0]!,payload:{passed:false}};
  assert.throws(()=>pipeline.recertify({caseId:plan.caseId,evidenceRecords:failing.rows,evidenceRoot:failing.root,reviewerIds:['r1','r2'],restoredScopes:['repository.read']},now),/not_passing/);
  assert.throws(()=>pipeline.recertify({caseId:plan.caseId,evidenceRecords:[],evidenceRoot:'',reviewerIds:['r1','r2'],restoredScopes:['repository.read']},now),/evidence_missing/);
});

test('reviewers and restored scopes are normalized before recertification',()=>{
  const pipeline=harness();const plan=pipeline.open(incident('INVALID_WEBHOOK'),now);const evidence=chain();
  const result=pipeline.recertify({caseId:plan.caseId,evidenceRecords:evidence.rows,evidenceRoot:evidence.root,reviewerIds:[' ','r2','r1','r2'],restoredScopes:['repository.read','repository.read']},new Date(now.getTime()+1));
  assert.deepEqual(result.reviewerIds,['r1','r2']);
  assert.deepEqual(result.capabilityState.allowedScopes,['repository.read']);
});
