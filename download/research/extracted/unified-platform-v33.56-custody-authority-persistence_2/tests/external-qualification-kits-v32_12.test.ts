import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { REQUIRED_EXTERNAL_GATE_IDS } from '../src/qualification/external-qualification-integrity-v32_12.js';
import { parseStrictJsonV32_12 } from '../src/validation/strict-json-v32_12.js';

test('all six external gates have complete fail-closed manifests, runbooks and synthetic fixtures', () => {
  for (const gateId of REQUIRED_EXTERNAL_GATE_IDS) {
    const root = `external-qualification/v32.12/${gateId}`;
    const manifest = parseStrictJsonV32_12(readFileSync(`${root}/manifest.json`, 'utf8')) as Record<string, unknown>;
    assert.equal(manifest.schemaVersion, '32.12'); assert.equal(manifest.gateId, gateId); assert.equal(manifest.status, 'not_executed');
    assert.ok(Array.isArray(manifest.negativeControls) && manifest.negativeControls.length >= 8);
    assert.ok(Array.isArray(manifest.acceptanceCriteria) && manifest.acceptanceCriteria.length >= 13);
    assert.match(String(manifest.verificationCommand), /trust-anchor\.json.*signed-trust-bundle\.json.*evidence-root.*replay-state\.json/);
    assert.equal((manifest.trustModel as Record<string, unknown>).evaluationClock, 'verifier-system-clock');
    const runbook = readFileSync(`${root}/RUNBOOK.md`, 'utf8');
    assert.match(runbook, /synthetic.*cannot satisfy/si);
    assert.match(runbook, /out-of-band pinned trust anchor/i);
    assert.match(runbook, /verifier-owned replay-state/i);
    for (const name of ['synthetic-unsigned-example.json', 'synthetic-signed-example.json']) {
      const fixture = parseStrictJsonV32_12(readFileSync(`${root}/${name}`, 'utf8')) as Record<string, unknown>;
      assert.equal(fixture.synthetic, true); assert.equal(fixture.evidenceClass, 'SIMULATED');
      assert.doesNotMatch(JSON.stringify(fixture), /PRIVATE KEY|BEGIN PRIVATE KEY/i);
    }
  }
});

test('preparation CLI creates only a not-executed synthetic record and refuses overwrite', () => {
  const out = mkdtempSync(join(tmpdir(), 'v32-12-qualification-plan-'));
  try {
    const manifest = 'external-qualification/v32.12/hsm-kms-custody/manifest.json';
    execFileSync('node', ['scripts/prepare-external-qualification-v32_12.mjs', manifest, out], { cwd: process.cwd() });
    const prepared = parseStrictJsonV32_12(readFileSync(join(out, 'hsm-kms-custody-preparation.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(prepared.status, 'not_executed'); assert.equal(prepared.synthetic, true); assert.equal(prepared.evidenceClass, 'SIMULATED');
    assert.throws(() => execFileSync('node', ['scripts/prepare-external-qualification-v32_12.mjs', manifest, out], { cwd: process.cwd(), stdio: 'pipe' }));
  } finally { rmSync(out, { recursive: true, force: true }); }
});


test('preparation CLI rejects incomplete invocation without creating output', () => {
  const result = spawnSync('node', ['scripts/prepare-external-qualification-v32_12.mjs'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /usage: prepare-external-qualification-v32_12\.mjs/);
});
