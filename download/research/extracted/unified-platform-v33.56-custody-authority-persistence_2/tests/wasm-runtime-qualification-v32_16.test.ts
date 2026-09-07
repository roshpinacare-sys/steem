import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { sha256 } from '../src/contracts/crypto.js';
import { qualifyWasmRuntimeV32_16, type WasmRuntimeQualificationPolicyV32_16 } from '../src/isolation/wasm-runtime-qualification-v32_16.js';

const here = dirname(fileURLToPath(import.meta.url));
const artifacts = join(here, '..', '..', 'isolation', 'wasm-core', 'artifacts');
const allowed = readFileSync(join(artifacts, 'allowed.wasm'));
const infinite = readFileSync(join(artifacts, 'infinite.wasm'));
const hiddenMemory = Buffer.from([0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00,0x05,0x03,0x01,0x00,0x01]);

function policy(overrides: Partial<WasmRuntimeQualificationPolicyV32_16> = {}): WasmRuntimeQualificationPolicyV32_16 {
  return {
    policyDigest: sha256('wasm-runtime-policy-v32.16'),
    maximumModuleBytes: 1024 * 1024,
    maximumMemoryBytes: 131072,
    maximumExecutionMs: 500,
    requiredRunExport: 'run',
    requiredMemoryExport: 'memory',
    allowedImports: ['cap.emit', 'cap.read_byte'],
    ...overrides,
  };
}

test('WASM runtime qualification executes a bounded module and measures visible memory', async () => {
  const report = await qualifyWasmRuntimeV32_16({ bytes: allowed, input: [3,5,7], policy: policy() });
  assert.equal(report.state, 'DRY_RUN_PASSED');
  assert.equal(report.output, 15);
  assert.equal(report.memoryBytes, 131072);
  assert.equal(report.productionQualified, false);
  assert.equal(report.findings.length, 0);
});

test('malformed WASM receives a stable parse finding before any timeout can race', async () => {
  const report = await qualifyWasmRuntimeV32_16({ bytes: Buffer.from('not-wasm'), input: [], policy: policy() });
  assert.equal(report.state, 'FAILED');
  assert.deepEqual(report.findings, ['wasm-runtime-binary-invalid']);
});

test('unexported memory is rejected because runtime accounting cannot observe it', async () => {
  const report = await qualifyWasmRuntimeV32_16({ bytes: hiddenMemory, input: [], policy: policy({ allowedImports: [] }) });
  assert.equal(report.state, 'FAILED');
  assert.equal(report.findings.includes('wasm-runtime-memory-export-invalid'), true);
});

test('infinite execution is terminated by a real worker timeout', async () => {
  const report = await qualifyWasmRuntimeV32_16({ bytes: infinite, input: [], policy: policy({ allowedImports: [], maximumExecutionMs: 50 }) });
  assert.equal(report.state, 'FAILED');
  assert.equal(report.findings.includes('wasm-runtime-timeout'), true);
});

test('memory over policy is rejected after measured execution', async () => {
  const report = await qualifyWasmRuntimeV32_16({ bytes: allowed, input: [1], policy: policy({ maximumMemoryBytes: 65536 }) });
  assert.equal(report.state, 'FAILED');
  assert.equal(report.findings.includes('wasm-runtime-memory-limit-exceeded'), true);
});

test('WASM runtime policy fails closed on unbounded and malformed limits', async () => {
  await assert.rejects(qualifyWasmRuntimeV32_16({ bytes: allowed, input: [], policy: policy({ maximumExecutionMs: 0 }) }), /wasm_runtime_policy_limits_invalid/);
  await assert.rejects(qualifyWasmRuntimeV32_16({ bytes: allowed, input: [], policy: policy({ maximumMemoryBytes: 512 * 1024 * 1024 }) }), /wasm_runtime_policy_limits_unbounded/);
});
