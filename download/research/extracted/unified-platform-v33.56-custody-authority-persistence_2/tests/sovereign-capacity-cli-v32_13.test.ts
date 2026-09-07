import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const root='infra/sovereign-production-v32_13';
test('capacity CLI produces an atomic proposal-only plan and refuses duplicate-key input', () => {
  const dir=mkdtempSync(join(tmpdir(),'sovereign-capacity-cli-'));
  try {
    const output=join(dir,'plan.json');
    execFileSync('node',['scripts/plan-sovereign-capacity-v32_13.mjs',`${root}/runtime/capacity-snapshot.example.json`,`${root}/policies/capacity-policy.example.json`,`${root}/runtime/burst-offers.example.json`,output],{encoding:'utf8'});
    const plan=JSON.parse(readFileSync(output,'utf8')) as {status:string;proposalOnly:boolean;planDigest:string};
    assert.equal(plan.status,'PLANNED'); assert.equal(plan.proposalOnly,true); assert.match(plan.planDigest,/^[0-9a-f]{64}$/);
    const duplicate=join(dir,'duplicate.json');
    writeFileSync(duplicate,readFileSync(`${root}/runtime/capacity-snapshot.example.json`,'utf8').replace('"queueDepth": 0','"queueDepth": 0, "queueDepth": 1'));
    const failed=spawnSync('node',['scripts/plan-sovereign-capacity-v32_13.mjs',duplicate,`${root}/policies/capacity-policy.example.json`,`${root}/runtime/burst-offers.example.json`,join(dir,'bad.json')],{encoding:'utf8'});
    assert.notEqual(failed.status,0); assert.match(`${failed.stdout}${failed.stderr}`,/strict_json_duplicate_key/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
