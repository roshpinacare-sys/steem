import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('binary inspection CLI writes an atomic manifest accepted by independent verifier', () => {
  const dir = mkdtempSync(join(tmpdir(), 'upp-binary-cli-'));
  try {
    const artifact = join(dir, 'module.wasm'); const manifest = join(dir, 'manifest.json');
    writeFileSync(artifact, Buffer.from([0,97,115,109,1,0,0,0]));
    execFileSync('node', ['scripts/inspect-binary-v32_14.mjs', artifact, 'config/binary-inspection-policy-v32_14.json', manifest], { encoding: 'utf8' });
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { verdict: string; detectedKind: string };
    assert.equal(parsed.verdict, 'ACCEPT');
    assert.equal(parsed.detectedKind, 'WASM');
    execFileSync('python3', ['verifier-only/v32.14/independent_binary_verifier.py', artifact, manifest], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('binary inspection CLI rejects duplicate policy keys and does not preserve a stale PASS manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'upp-binary-cli-'));
  try {
    const artifact = join(dir, 'module.wasm'); const manifest = join(dir, 'manifest.json'); const badPolicy = join(dir, 'policy.json');
    writeFileSync(artifact, Buffer.from([0,97,115,109,1,0,0,0]));
    writeFileSync(manifest, '{"verdict":"ACCEPT"}\n');
    const policy = readFileSync('config/binary-inspection-policy-v32_14.json', 'utf8').replace('{', '{"policyId":"duplicate",');
    writeFileSync(badPolicy, policy);
    const result = spawnSync('node', ['scripts/inspect-binary-v32_14.mjs', artifact, badPolicy, manifest], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /strict_json_duplicate_key/);
    assert.equal(readFileSync(manifest, { encoding: 'utf8', flag: 'a+' }), '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
