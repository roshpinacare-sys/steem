import assert from 'node:assert/strict';
import test from 'node:test';
import { signEnvelope } from '../src/contracts/crypto.js';
import { createHarness } from './helpers.js';

function request(id:string,scope='repository.read'){return{missionId:id,tenantId:'tenant-1',subjectId:'subject-1',builderId:'builder-1',scope,effectKey:`effect:${id}`,approvalRequired:false} as const;}

test('runtime engine rejects unregistered signatures and authority mismatch',()=>{
  const h=createHarness(); try{
    const foreign={...h.signedGrant,issuerKeyId:'missing-key'};
    assert.throws(()=>h.engine.createAuthorizedMission(foreign,request('bad-signature'),h.now),/grant_signature_invalid/);
    assert.throws(()=>h.engine.createAuthorizedMission(h.signedGrant,request('bad-scope','repository.write'),h.now),/authority_denied/);
    const workspaceBound=signEnvelope({...h.signedGrant.payload,workspaceId:'workspace-only'},h.issuer);
    assert.throws(()=>h.engine.createAuthorizedMission(workspaceBound,request('bad-workspace'),h.now),/authority_denied/);
  }finally{h.store.close();}
});

test('runtime engine delegates evidence and default-time execution paths',async()=>{
  const h=createHarness(); try{
    h.engine.createAuthorizedMission(h.signedGrant,request('defaults'),h.now);
    const liveNow=Date.now();
    const lease=h.engine.acquire('defaults','worker',30_000,liveNow);
    const outbox=h.engine.prepare(lease,{operation:'read'},liveNow); if(!outbox)throw new Error('outbox_expected');
    const receipt=await h.engine.execute(outbox,lease,async()=>({ok:true}));
    assert.equal(receipt.effectKey,'effect:defaults');
    const digest=h.engine.appendEvidence({recordId:'engine-evidence',tenantId:'tenant-1',kind:'test',subject:'defaults',payload:{passed:true},evidenceClass:'COMPUTED',method:'v28',environment:{},createdAt:h.now.toISOString(),limitations:[]});
    assert.match(digest,/^[a-f0-9]{64}$/);
  }finally{h.store.close();}
});
