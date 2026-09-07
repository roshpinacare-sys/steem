import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

function run(script:string,args:string[]=[]):Promise<{code:number|null;stdout:string;stderr:string}>{return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[`dist/src/cli/${script}.js`,...args],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error(`worker_timeout:${script}`));},10_000);child.stdout.on('data',c=>stdout+=String(c));child.stderr.on('data',c=>stderr+=String(c));child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});});}

test('trust violation worker reports usage and operational failures with distinct exits',async()=>{
  const usage=await run('trust-violation-worker');assert.equal(usage.code,64);assert.match(usage.stderr,/usage/);
  const root=mkdtempSync(join(tmpdir(),'trust-worker-v28-'));const failed=await run('trust-violation-worker',[root,'tenant','missing@1','violation']);assert.equal(failed.code,1);assert.match(failed.stderr,/not_found/);
});

test('replay and checkpoint workers reject incomplete or malformed input',async()=>{
  const replay=await run('replay-consume-worker');assert.notEqual(replay.code,0);assert.match(replay.stderr,/usage/);
  const checkpoint=await run('trust-checkpoint-worker');assert.notEqual(checkpoint.code,0);assert.match(checkpoint.stderr,/usage/);
  const root=mkdtempSync(join(tmpdir(),'checkpoint-worker-v28-'));const snapshot=join(root,'bad.json');writeFileSync(snapshot,'not-json');
  const malformed=await run('trust-checkpoint-worker',[join(root,'state.json'),snapshot,'tenant','channel']);assert.notEqual(malformed.code,0);assert.match(malformed.stderr,/JSON|Unexpected/);
});
