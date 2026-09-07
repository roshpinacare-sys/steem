import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyNpmAudit } from '../src/supply-chain/advisory-audit.js';

test('npm advisory audit passes only with successful parseable zero-vulnerability metadata',()=>{
 const result=classifyNpmAudit({exitCode:0,stdout:JSON.stringify({metadata:{vulnerabilities:{info:0,low:0,moderate:0,high:0,critical:0,total:0}}}),stderr:''});
 assert.equal(result.status,'passed');assert.equal(result.total,0);assert.equal(result.blocker,undefined);
});
test('npm advisory audit fails closed when reported vulnerabilities exist',()=>{
 const result=classifyNpmAudit({exitCode:1,stdout:JSON.stringify({metadata:{vulnerabilities:{high:1,total:1}}}),stderr:''});
 assert.equal(result.status,'failed');assert.equal(result.total,1);
});
test('unavailable or malformed advisory endpoint is environment-blocked, never zero vulnerabilities',()=>{
 for(const input of [{exitCode:1,stdout:'',stderr:'502 Bad Gateway'},{exitCode:null,stdout:'not-json',stderr:'',error:'spawn failed'},{exitCode:1,stdout:'{}',stderr:''}]){
  const result=classifyNpmAudit(input);assert.equal(result.status,'environment-blocked');assert.equal(result.total,null);assert.ok(result.blocker);
 }
});
test('numeric vulnerability fields are retained while nonnumeric fields are ignored',()=>{
 const result=classifyNpmAudit({exitCode:0,stdout:JSON.stringify({metadata:{vulnerabilities:{total:0,high:0,note:'unknown'}}}),stderr:''});
 assert.deepEqual(result.vulnerabilities,{total:0,high:0});assert.equal(result.rawDigestEligible,true);
});
