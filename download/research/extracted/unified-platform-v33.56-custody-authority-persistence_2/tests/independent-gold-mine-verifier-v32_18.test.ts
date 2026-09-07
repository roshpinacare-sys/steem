import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
test('independent v32.18 verifier accepts generated proof and rejects tamper or production overclaim',()=>{execFileSync('node',['scripts/cncf-gold-mine-extraction-proof-v32_18.mjs'],{env:{...process.env,V32_6_RUN_DIR:'evidence/generated'},stdio:'pipe'});const source='evidence/generated/V32_18_CNCF_GOLD_MINE_EXTRACTION_PROOF.json';const accepted=JSON.parse(execFileSync('python3',['verifier-only/v32.18/independent_gold_mine_verifier.py',source],{encoding:'utf8'}));assert.equal(accepted.status,'passed');const dir=mkdtempSync(join(tmpdir(),'v3218-'));const data=JSON.parse(readFileSync(source,'utf8'));data.productionQualified=true;const path=join(dir,'bad.json');writeFileSync(path,JSON.stringify(data));const rejected=spawnSync('python3',['verifier-only/v32.18/independent_gold_mine_verifier.py',path],{encoding:'utf8'});assert.notEqual(rejected.status,0);const result=JSON.parse(rejected.stdout);assert.equal(result.findings.includes('report-digest-invalid'),true);assert.equal(result.findings.includes('production-overclaim'),true);});
