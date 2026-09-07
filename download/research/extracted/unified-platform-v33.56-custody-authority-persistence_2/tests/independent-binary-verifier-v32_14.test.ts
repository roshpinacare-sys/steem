import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectBinaryArtifactV32_14, type BinaryInspectionPolicyV32_14 } from '../src/binary/proof-carrying-binary-v32_14.js';

const policy: BinaryInspectionPolicyV32_14 = {
  policyId: 'independent-verifier', allowedKinds: ['WASM'], maximumBytes: 4096, chunkBytes: 256,
  rejectUnknown: true, rejectPolyglot: true, rejectExecutables: false, rejectActivePdf: true,
  rejectArchiveTraversal: true, maximumArchiveEntries: 10, maximumCompressionRatio: 20, maximumEntropy: 8,
};

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'upp-binary-verifier-'));
  const artifact = join(dir, 'module.wasm');
  const manifest = join(dir, 'manifest.json');
  const bytes = Buffer.from([0,97,115,109,1,0,0,0,1,1,0]);
  writeFileSync(artifact, bytes);
  writeFileSync(manifest, `${JSON.stringify(inspectBinaryArtifactV32_14('module.wasm', bytes, policy), null, 2)}\n`);
  return { dir, artifact, manifest };
}

test('independent Python verifier agrees on content chunks Merkle root and kind', () => {
  const f = fixture();
  try {
    const output = execFileSync('python3', ['verifier-only/v32.14/independent_binary_verifier.py', f.artifact, f.manifest], { encoding: 'utf8' });
    const result = JSON.parse(output) as { verdict: string; reasons: string[] };
    assert.equal(result.verdict, 'VERIFIED');
    assert.deepEqual(result.reasons, []);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('independent binary verifier rejects byte manifest chunk Merkle kind and duplicate-key substitution', () => {
  const f = fixture();
  try {
    writeFileSync(f.artifact, Buffer.from([0,97,115,109,1,0,0,1,1,1,0]));
    let result = spawnSync('python3', ['verifier-only/v32.14/independent_binary_verifier.py', f.artifact, f.manifest], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /content_digest_mismatch|chunk_digest/);

    const original = JSON.parse(readFileSync(f.manifest, 'utf8')) as Record<string, unknown>;
    writeFileSync(f.artifact, Buffer.from([0,97,115,109,1,0,0,0,1,1,0]));
    writeFileSync(f.manifest, JSON.stringify({ ...original, detectedKind: 'PDF' }));
    result = spawnSync('python3', ['verifier-only/v32.14/independent_binary_verifier.py', f.artifact, f.manifest], { encoding: 'utf8' });
    assert.match(result.stdout, /detected_kind_mismatch/);

    const text = JSON.stringify(original).replace('{', '{"schemaVersion":"evil",');
    writeFileSync(f.manifest, text);
    result = spawnSync('python3', ['verifier-only/v32.14/independent_binary_verifier.py', f.artifact, f.manifest], { encoding: 'utf8' });
    assert.match(result.stdout, /duplicate_json_key/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('independent verifier is verifier-only and cannot produce or approve binary evidence', () => {
  const source = readFileSync('verifier-only/v32.14/independent_binary_verifier.py', 'utf8');
  assert.doesNotMatch(source, /sign|approve|private_key|socket|requests|urllib/);
  assert.doesNotMatch(source, /write_text|write_bytes|open\([^)]*['\"]w/);
  assert.match(source, /VERIFIED|REJECTED/);
});
