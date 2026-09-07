import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileAgentProposalStore, InMemoryAgentProposalStore, proposalDigest } from '../src/agents/agent-proposal-store.js';
import type { AgentPlan } from '../src/agents/types.js';
import { sha256 } from '../src/contracts/crypto.js';
function plan(patch:Partial<AgentPlan>={}):AgentPlan{const material={planId:'plan-1',requestId:'request-1',requestDigest:sha256('request'),policyDigest:sha256('policy'),tenantId:'tenant-1',requesterId:'requester',agentId:'agent',objective:'change',expectedFileDigest:sha256('before'),operations:[{kind:'exact-replacement' as const,file:'src/a.ts',beforeDigest:sha256('before'),afterDigest:sha256('after'),exactBefore:'before',exactAfter:'after'}],requiredTests:['a.test.ts'],contextFindings:[],unsupportedClaims:['review-required'],status:'PROPOSED' as const,...patch};return{...material,proposalDigest:sha256(material)} as AgentPlan;}

test('in-memory proposal store is idempotent and rejects missing IDs and substitution',()=>{
  const store=new InMemoryAgentProposalStore();assert.throws(()=>store.get('missing'),/not_found/);const first=plan();assert.equal(store.put(first).digest,store.put(first).digest);const changed=plan({objective:'attacker change'});assert.throws(()=>store.put(changed),/id_conflict/);assert.equal(proposalDigest(first),first.proposalDigest);
});

test('file proposal store validates root, plan IDs, persistence, key binding and tamper evidence',()=>{
  assert.throws(()=>new FileAgentProposalStore(' '),/root_required/);const root=mkdtempSync(join(tmpdir(),'proposal-edge-v27-'));const store=new FileAgentProposalStore(root);assert.throws(()=>store.get(''),/plan_id/);assert.throws(()=>store.get('missing'),/not_found/);const first=plan();store.put(first);assert.equal(new FileAgentProposalStore(root).get(first.planId).digest,store.get(first.planId).digest);assert.throws(()=>store.put(plan({objective:'changed'})),/id_conflict/);
  const file=join(root,readdirSync(root).find(name=>name.endsWith('.json'))!);const row=JSON.parse(readFileSync(file,'utf8')) as Record<string,unknown>;writeFileSync(file,JSON.stringify({...row,digest:'0'.repeat(64)}));assert.throws(()=>store.get(first.planId),/tampered/);
});

test('file proposal store rejects version, canonical proposal digest and storage-key substitutions independently',()=>{
  for(const mutate of [
    (row:any)=>({...row,version:2,digest:sha256({version:2,plan:row.plan})}),
    (row:any)=>{const plan={...row.plan,proposalDigest:'0'.repeat(64)};return{version:1,plan,digest:sha256({version:1,plan})};},
    (row:any)=>{const plan={...row.plan,planId:'other'};return{version:1,plan,digest:sha256({version:1,plan})};},
  ]){const root=mkdtempSync(join(tmpdir(),'proposal-tamper-v27-'));const store=new FileAgentProposalStore(root);const first=plan();store.put(first);const file=join(root,readdirSync(root).find(name=>name.endsWith('.json'))!);const row=JSON.parse(readFileSync(file,'utf8'));writeFileSync(file,JSON.stringify(mutate(row)));assert.throws(()=>store.get(first.planId));}
});
