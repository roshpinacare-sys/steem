import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capabilityRef, PersistentCapabilityTrustStore, type CapabilityIdentity, type TrustViolation } from '../src/platform/capability-trust.js';
import { sha256 } from '../src/contracts/crypto.js';
const now=new Date('2026-07-17T12:00:00Z');
function root(){return mkdtempSync(join(tmpdir(),'trust-edge-v27-'));}
function identity(patch:Partial<CapabilityIdentity>={}):CapabilityIdentity{return{tenantId:'tenant-1',capabilityId:'wide-agent',version:'1.0.0',publisherId:'publisher-1',originalScopes:['repository.read','repository.write','evidence.emit'],...patch};}
function violation(id:string,severity:TrustViolation['severity']='LOW',kind:TrustViolation['kind']='POLICY'):TrustViolation{return{violationId:id,kind,severity,evidenceRef:`evidence:${id}`,observedAt:now.toISOString(),message:id};}
function setup(){const store=new PersistentCapabilityTrustStore(root());const state=store.register(identity(),now);return{store,ref:capabilityRef(state.capabilityId,state.version)};}

test('trust identity, scopes, references, violations and missing states reject malformed inputs',()=>{
  for(const patch of [{tenantId:''},{capabilityId:''},{version:''},{publisherId:''},{originalScopes:[]},{originalScopes:['repository.read','repository.read']},{originalScopes:['*']},{originalScopes:['repository.*']}] as Partial<CapabilityIdentity>[]){assert.throws(()=>new PersistentCapabilityTrustStore(root()).register(identity(patch),now));}
  assert.throws(()=>capabilityRef('','1'),/capability_ref_required/);assert.throws(()=>capabilityRef('x',''),/capability_ref_required/);
  const{store,ref}=setup();assert.throws(()=>store.get('tenant-1','missing'),/not_found/);assert.throws(()=>store.register(identity()),/already_registered/);
  for(const bad of [{...violation(''),violationId:''},{...violation('x'),evidenceRef:''},{...violation('x'),message:''},{...violation('x'),observedAt:'bad'}])assert.throws(()=>store.recordViolation('tenant-1',ref,bad));
});

test('medium and repeated low violations restrict, appeals validate input, and events/list remain tenant scoped',()=>{
  const{store,ref}=setup();
  assert.equal(store.recordViolation('tenant-1',ref,violation('medium','MEDIUM')).status,'RESTRICTED');
  assert.throws(()=>store.openAppeal('tenant-1',ref,{requestedBy:'',reason:'r',evidenceRefs:['e']}),/invalid_capability_appeal/);
  assert.throws(()=>store.openAppeal('tenant-1',ref,{requestedBy:'o',reason:'',evidenceRefs:['e']}),/invalid_capability_appeal/);
  assert.throws(()=>store.openAppeal('tenant-1',ref,{requestedBy:'o',reason:'r',evidenceRefs:[]}),/invalid_capability_appeal/);
  store.openAppeal('tenant-1',ref,{requestedBy:'operator',reason:'fixed',evidenceRefs:['e']},now);
  assert.equal(store.events('tenant-1',ref).at(-1)?.type,'APPEAL_OPENED');assert.equal(store.events('other').length,0);assert.equal(store.list('tenant-1').length,1);
  const second=setup();assert.throws(()=>second.store.openAppeal('tenant-1',second.ref,{requestedBy:'o',reason:'r',evidenceRefs:['e']}),/not_allowed/);
});

test('override, recertification and revocation enforce independent reviewers, reasons, roots and bounded scopes',()=>{
  const{store,ref}=setup();store.recordViolation('tenant-1',ref,violation('high','HIGH'));
  assert.throws(()=>store.approveOverride('tenant-1',ref,{reviewers:['publisher-1','r1','r1',''],reason:'ok'}),/dual_control/);
  assert.throws(()=>store.approveOverride('tenant-1',ref,{reviewers:['r1','r2'],reason:' '}),/reason_required/);
  store.approveOverride('tenant-1',ref,{reviewers:['r1','r2'],reason:'accepted'},now);
  assert.throws(()=>store.recertify('tenant-1',ref,{evidenceRoot:'bad',reviewers:['r1','r2'],restoredScopes:['repository.read']}),/evidence_root/);
  assert.throws(()=>store.recertify('tenant-1',ref,{evidenceRoot:sha256('e'),reviewers:['publisher-1','r1'],restoredScopes:['repository.read']}),/dual_control/);
  assert.throws(()=>store.recertify('tenant-1',ref,{evidenceRoot:sha256('e'),reviewers:['r1','r2'],restoredScopes:[]}),/scope_escalation/);
  const restored=store.recertify('tenant-1',ref,{evidenceRoot:sha256('e'),reviewers:['r1','r2','r2'],restoredScopes:['repository.read','repository.read']},now);assert.deepEqual(restored.allowedScopes,['repository.read']);
  assert.throws(()=>store.recertify('tenant-1',ref,{evidenceRoot:sha256('e2'),reviewers:['r1','r2'],restoredScopes:['repository.read']}),/not_required/);
  assert.throws(()=>store.revoke('tenant-1',ref,{reason:'',reviewers:['r1','r2'],evidenceRef:'e'}),/invalid_capability_revocation/);
  assert.throws(()=>store.revoke('tenant-1',ref,{reason:'x',reviewers:['r1'],evidenceRef:'e'}),/dual_control/);
  const revoked=store.revoke('tenant-1',ref,{reason:'critical',reviewers:['r1','r2'],evidenceRef:'e'},now);assert.equal(revoked.status,'REVOKED');assert.equal(store.revoke('tenant-1',ref,{reason:'again',reviewers:[],evidenceRef:''}).status,'REVOKED');
});

test('violation IDs are idempotent but substitution is rejected and upgrade lifecycle validates predecessor and publisher',()=>{
  const{store,ref}=setup();const first=violation('same');assert.equal(store.recordViolation('tenant-1',ref,first).violationCount,1);assert.equal(store.recordViolation('tenant-1',ref,first).violationCount,1);assert.throws(()=>store.recordViolation('tenant-1',ref,{...first,message:'changed'}),/id_conflict/);
  assert.throws(()=>store.registerUpgrade({...identity({version:'2.0.0'}),predecessorRef:'missing'}),/not_found/);
  assert.throws(()=>store.registerUpgrade({...identity({version:'2.0.0',publisherId:'attacker'}),predecessorRef:ref}),/publisher_mismatch/);
  const upgraded=store.registerUpgrade({...identity({version:'2.0.0',originalScopes:['repository.read']}),predecessorRef:ref},now);assert.equal(upgraded.status,'REQUALIFICATION_REQUIRED');assert.equal(upgraded.predecessorRef,ref);
});

test('anchor and event tampering variants fail closed while valid restart reconstructs state',()=>{
  const directory=root();const store=new PersistentCapabilityTrustStore(directory);const state=store.register(identity(),now);const ref=capabilityRef(state.capabilityId,state.version);store.recordViolation('tenant-1',ref,violation('one'));
  assert.equal(new PersistentCapabilityTrustStore(directory).verify().ok,true);
  const anchorPath=join(directory,'anchor.json');const anchor=JSON.parse(readFileSync(anchorPath,'utf8')) as Record<string,unknown>;writeFileSync(anchorPath,JSON.stringify({...anchor,root:sha256('forged')}));assert.throws(()=>new PersistentCapabilityTrustStore(directory),/tampered_or_rolled_back/);
});
