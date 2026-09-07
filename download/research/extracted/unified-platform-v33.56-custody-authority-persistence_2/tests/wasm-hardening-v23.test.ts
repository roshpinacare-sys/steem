import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { generateSigningIdentity, sha256Bytes } from '../src/contracts/crypto.js';
import { runSignedWasmCapability, signWasmCapabilityManifest, type WasmCapabilityManifest } from '../src/isolation/wasm-capability-runner.js';
import { KeyLifecycleRegistry } from '../src/security/key-lifecycle.js';

const here = dirname(fileURLToPath(import.meta.url));
const artifacts = join(here, '..', '..', 'isolation', 'wasm-core', 'artifacts');
const allowed = readFileSync(join(artifacts, 'allowed.wasm'));
const malicious = readFileSync(join(artifacts, 'malicious.wasm'));
const now = new Date('2026-07-17T10:00:00.000Z');

function signed(bytes: Buffer, overrides: Partial<WasmCapabilityManifest> = {}) {
  const identity = generateSigningIdentity(`publisher-${Math.random()}`);
  const registry = new KeyLifecycleRegistry();
  registry.register(identity, { keyId: identity.keyId, familyId: 'publisher-family', purpose: 'capability-publisher', environment: 'test', tenantId: 'tenant-1', notBefore: '2026-07-17T09:00:00.000Z', notAfter: '2026-07-18T09:00:00.000Z' });
  const manifest: WasmCapabilityManifest = {
    capabilityId: 'sum', version: '1.0.0', tenantId: 'tenant-1', moduleDigest: sha256Bytes(bytes),
    allowedImports: ['cap.read_byte','cap.emit'], timeoutMs: 500, maxModuleBytes: 1024 * 1024,
    maxInputBytes: 16, maxMemoryBytes: 131072, declaredEffects: ['emit-result'], evidenceClass: 'COMPUTED', ...overrides,
  };
  return { registry, envelope: signWasmCapabilityManifest(manifest, identity, registry, now) };
}

test('signed manifest cannot authorize unsupported host imports', async () => {
  const { registry, envelope } = signed(malicious, { allowedImports: ['env.host_secret'] });
  await assert.rejects(runSignedWasmCapability({ moduleBytes: malicious, envelope, registry, input: [], now }), /capability_host_import_forbidden/);
});

test('module byte limit is enforced before WebAssembly compilation', async () => {
  const { registry, envelope } = signed(allowed, { maxModuleBytes: allowed.byteLength - 1 });
  await assert.rejects(runSignedWasmCapability({ moduleBytes: allowed, envelope, registry, input: [], now }), /capability_module_limit_exceeded/);
});

test('duplicate import declarations and invalid effect contracts fail closed', async () => {
  const duplicate = signed(allowed, { allowedImports: ['cap.read_byte','cap.emit','cap.emit'] });
  await assert.rejects(runSignedWasmCapability({ moduleBytes: allowed, envelope: duplicate.envelope, registry: duplicate.registry, input: [], now }), /duplicate_capability_import/);
  const effect = signed(allowed, { declaredEffects: [] as unknown as readonly ['emit-result'] });
  await assert.rejects(runSignedWasmCapability({ moduleBytes: allowed, envelope: effect.envelope, registry: effect.registry, input: [], now }), /capability_effect_contract_invalid/);
});

test('bounded WebAssembly receipt reports the strengthened containment limitation', async () => {
  const { registry, envelope } = signed(allowed);
  const receipt = await runSignedWasmCapability({ moduleBytes: allowed, envelope, registry, input: [1,2,3], now });
  assert.equal(receipt.output, 6);
  assert.equal(receipt.limitations.includes('worker-timeout-and-resource-limits-are-runtime-containment-not-os-sandbox'), true);
});
