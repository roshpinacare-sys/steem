import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tfaCapabilityToGrant, tfaPassportVerificationToEvidence, titaiPrincipalToGrant, titaiRunSummaryToEvidence } from '../src/contracts/adapters.js';
import { qodoReceiptToEvidence, yongzuanCertificationToCanonical, yongzuanRequirementToCanonical } from '../src/contracts/source-adapters-v20.js';
import { evaluateSlo, nearestRank } from '../src/operations/slo-qualification.js';
import { compareTestRuns, scheduleTestLanes, selectImpactedTests } from '../src/operations/test-optimization.js';
import { aggregatePilot, createHumanPilotProtocol, validateObservation, type PilotObservation } from '../src/product/human-pilot.js';
import { buildCycloneDxLikeSbom, buildSourceManifest, scanPotentialSecrets } from '../src/supply-chain/release-manifest.js';
import { CleanValidationWorkspace } from '../src/validation/clean-state.js';

const now = new Date('2026-07-17T12:00:00Z');
const digest = 'a'.repeat(64);

test('legacy adapters cover optional defaults, omissions and explicit limitations', () => {
  const principal = titaiPrincipalToGrant({ id: 'p', tenantId: 't' }, { scopes: ['read'] });
  assert.equal(principal.issuer, 'titai-kernel'); assert.equal(principal.workspaceId, undefined); assert.equal(principal.revokedAt, undefined);
  const capability = tfaCapabilityToGrant({ capabilityId: 'c', tenantId: 't', subjectId: 's', actions: ['read'], issuedAt: now.toISOString(), expiresAt: new Date(now.getTime()+1000).toISOString() });
  assert.equal(capability.evidenceRef, undefined); assert.equal(capability.revokedAt, undefined);
  const summary = titaiRunSummaryToEvidence({ state: 'partial', coverage: 0, reconstructable: false, gaps: ['missing'] }, 'r', 't', now);
  assert.deepEqual(summary.payload.gaps, ['missing']);
  const verification = tfaPassportVerificationToEvidence({ passportId: 'p', subject: 'subject', hash: digest, algorithm: 'Ed25519' }, { ok: false, checks: [] }, 't', now);
  assert.equal(verification.subject, 'subject'); assert.equal(verification.payload.verificationOk, false);
});

test('source adapters reject malformed requirements, certifications, budgets, tests and time', () => {
  assert.throws(() => yongzuanRequirementToCanonical({ id: '', tenantId: 't', description: 'x', metric: 'm', unit: 'u', operator: '==', target: 1, critical: false }), /invalid_yongzuan_requirement/);
  const nonCritical = yongzuanRequirementToCanonical({ id: 'r', tenantId: 't', description: 'x', metric: 'm', unit: 'u', operator: 'between', target: [1,2], critical: false, version: '2.0.0' });
  assert.equal(nonCritical.criticality, 'MEDIUM'); assert.equal(nonCritical.version, '2.0.0');
  const base = { certificationId: 'c', tenantId: 't', commitmentId: 'm', requirementResults: [{ requirementId: 'r', passed: false, evidenceClass: 'MEASURED' as const, evidenceDigest: digest }], limitations: [], reviewerIds: ['r1'] };
  assert.throws(() => yongzuanCertificationToCanonical({ ...base, status: 'FAIL', issuedAt: 'bad' }), /certification_time/);
  assert.throws(() => yongzuanCertificationToCanonical({ ...base, status: 'FAIL', issuedAt: now.toISOString(), reviewerIds: [] }), /reviewer_required/);
  assert.equal(yongzuanCertificationToCanonical({ ...base, status: 'PHYSICAL_PASS', issuedAt: now.toISOString() }).decision, 'PASS');
  assert.equal(yongzuanCertificationToCanonical({ ...base, status: 'INCONCLUSIVE', issuedAt: now.toISOString() }).decision, 'INCONCLUSIVE');
  const receipt = { receiptId:'q', tenantId:'t', repositoryId:'repo', planDigest:digest, changeDigest:digest, tests:[{id:'x',passed:true,evidenceDigest:digest}], budget:{operations:1,maxOperations:1}, circuitBreaker:'CLOSED' as const, createdAt:now.toISOString() };
  assert.throws(() => qodoReceiptToEvidence({ ...receipt, tests: [] }), /tests_not_passing/);
  assert.throws(() => qodoReceiptToEvidence({ ...receipt, createdAt: 'bad' }), /receipt_time/);
});

test('SLO and scheduler branches reject invalid input and distinguish empty, impacted, full, improved and regressed modes', () => {
  assert.throws(() => nearestRank([1], 0), /percentile_invalid/); assert.throws(() => nearestRank([Infinity], 99), /sample_invalid/);
  assert.throws(() => evaluateSlo({ metric:'a', samplesMs:[1], environment:'simulation' }, { metric:'b', percentile:95, maximumMs:1, minimumSamples:1 }), /metric_mismatch/);
  assert.throws(() => evaluateSlo({ metric:'a', samplesMs:[1], environment:'simulation' }, { metric:'a', percentile:95, maximumMs:0, minimumSamples:0 }), /threshold_invalid/);
  const empty = evaluateSlo({ metric:'a', samplesMs:[], environment:'simulation' }, { metric:'a', percentile:95, maximumMs:5, minimumSamples:2 }); assert.equal(empty.observedMs, null);
  assert.throws(() => scheduleTestLanes([], 0), /worker_count/); assert.throws(() => scheduleTestLanes([{id:'',durationMs:1,testFiles:['x']}],1), /lane_invalid/);
  const schedule = scheduleTestLanes([{id:'a',durationMs:10,testFiles:['a'],resources:['db']},{id:'b',durationMs:5,testFiles:['b'],resources:['db']}],2); assert.equal(schedule.makespanMs,15);
  assert.equal(selectImpactedTests({ tests:{'a.test':['src/a']},changedFiles:[] }).mode,'none');
  assert.equal(selectImpactedTests({ tests:{'a.test':['src/a']},changedFiles:[],mandatoryTests:['sentinel'] }).mode,'impacted');
  assert.equal(selectImpactedTests({ tests:{'a.test':['src/a']},changedFiles:['package.json'] }).mode,'full');
  assert.equal(selectImpactedTests({ tests:{'a.test':['src/a']},changedFiles:['docs/readme.md'] }).mode,'impacted');
  assert.equal(selectImpactedTests({ tests:{'a.test':['src/a']},changedFiles:['src/unknown'] }).mode,'full');
  assert.equal(compareTestRuns({baselineMs:100,currentMs:90,baselineTests:10,currentTests:10,failedTests:0}).status,'improved');
  assert.equal(compareTestRuns({baselineMs:100,currentMs:103,baselineTests:10,currentTests:10,failedTests:0}).status,'regressed');
  assert.equal(compareTestRuns({baselineMs:100,currentMs:101,baselineTests:10,currentTests:10,failedTests:0}).status,'unchanged');
  assert.equal(compareTestRuns({baselineMs:0,currentMs:1,baselineTests:10,currentTests:9,failedTests:1}).status,'invalid');
});

function obs(participantId:string, taskId:PilotObservation['taskId']='permission-review', override:Partial<PilotObservation>={}):PilotObservation{return {participantId,consented:true,role:'reviewer',taskId,completed:true,elapsedMs:10,criticalErrors:0,assistRequests:0,comprehensionCorrect:1,comprehensionTotal:1,stoppedForSafety:false,...override};}
test('human pilot validates every count branch and reports missing/incomplete/low-comprehension task evidence', () => {
  const protocol=createHumanPilotProtocol();
  assert.throws(()=>validateObservation(obs('')),/participant_required/);
  assert.throws(()=>validateObservation(obs('p','unknown' as never)),/task_unknown/);
  for(const patch of [{criticalErrors:-1},{assistRequests:1.2},{comprehensionCorrect:-1},{comprehensionTotal:-1}]) assert.throws(()=>validateObservation(obs('p','permission-review',patch)),/count_invalid/);
  const rows:PilotObservation[]=[]; for(let i=0;i<5;i++) rows.push(obs(`p${i}`,'permission-review',i===0?{completed:false,comprehensionCorrect:0,comprehensionTotal:0}:{}));
  const result=aggregatePilot(rows,protocol); assert.equal(result.status,'measured');
  assert.ok(result.taskResults?.find(r=>r.taskId==='permission-review')?.reasons.includes('incomplete_task'));
  assert.ok(result.taskResults?.find(r=>r.taskId==='permission-review')?.reasons.includes('comprehension_below_80_percent'));
  assert.ok(result.taskResults?.find(r=>r.taskId==='rollback')?.reasons.includes('not_all_participants_observed'));
});

test('release-manifest utilities cover excluded directories, unknown lock metadata and secret patterns', () => {
  const root=mkdtempSync(join(tmpdir(),'release-v27-')); mkdirSync(join(root,'src')); mkdirSync(join(root,'node_modules')); mkdirSync(join(root,'evidence/generated'),{recursive:true});
  writeFileSync(join(root,'src/a.ts'),'ok'); writeFileSync(join(root,'node_modules/ignored'),'ignore'); writeFileSync(join(root,'evidence/generated/ignored'),'ignore');
  const lock={lockfileVersion:3,packages:{'':{},'node_modules/a':{}}}; writeFileSync(join(root,'package-lock.json'),JSON.stringify(lock));
  const manifest=buildSourceManifest(root); assert.equal(manifest.files.some(f=>f.path.includes('node_modules')),false); assert.equal(manifest.files.some(f=>f.path.startsWith('evidence/generated')),false);
  const sbom=buildCycloneDxLikeSbom(join(root,'package-lock.json')); assert.equal(sbom.metadata.component.name,'unknown-application'); assert.equal(sbom.components[0]?.version,'unknown');
  writeFileSync(join(root,'secret.txt'),"token='abcdefghijklmnopqrstuvwxyz123456'"); assert.ok(scanPotentialSecrets(root).some(f=>f.rule==='generic-token-assignment'));
  const missing=join(root,'bad-lock.json'); writeFileSync(missing,'{}'); assert.throws(()=>buildCycloneDxLikeSbom(missing),/packages_missing/);
});

test('clean-state workspace validates corrupt locks, ownership, empty generated directories and idempotent release', () => {
  const root=mkdtempSync(join(tmpdir(),'clean-v27-')); const ws=new CleanValidationWorkspace(root);
  assert.throws(()=>ws.acquire(''),/run_id/); writeFileSync(join(root,'.validation-v22.lock'),'{}'); assert.throws(()=>ws.acquire('x',now),/lock_corrupt/);
  // Fresh workspace exercises empty generated removal and no-lock release.
  const other=mkdtempSync(join(tmpdir(),'clean-v27-empty-')); mkdirSync(join(other,'evidence/generated'),{recursive:true}); const clean=new CleanValidationWorkspace(other); clean.acquire('run',now); const prepared=clean.prepare(now); assert.equal(prepared.priorFileCount,0); clean.release(); clean.release(); assert.equal(clean.inspect().inProgress,true);
});
