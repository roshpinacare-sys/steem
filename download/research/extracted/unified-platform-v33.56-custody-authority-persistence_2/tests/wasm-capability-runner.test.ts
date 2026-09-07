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
const infinite = readFileSync(join(artifacts, 'infinite.wasm'));

function setup(bytes = allowed, timeoutMs = 500, imports?: readonly string[]) {
  const now = new Date('2026-07-16T12:00:00.000Z');
  const identity = generateSigningIdentity('wasm-publisher');
  const registry = new KeyLifecycleRegistry();
  registry.register(identity, {
    keyId: identity.keyId, familyId: 'wasm-publisher-family', purpose: 'capability-publisher', environment: 'test', tenantId: 'tenant-1',
    notBefore: new Date(now.getTime() - 1000).toISOString(), notAfter: new Date(now.getTime() + 3600_000).toISOString(),
  });
  const manifest: WasmCapabilityManifest = {
    capabilityId: 'repository-sum', version: '1.0.0', tenantId: 'tenant-1', moduleDigest: sha256Bytes(bytes),
    allowedImports: imports ?? (bytes === malicious ? ['env.host_secret'] : bytes === allowed ? ['cap.read_byte', 'cap.emit'] : []),
    timeoutMs, maxInputBytes: 16, maxMemoryBytes: 131072,
    declaredEffects: ['emit-result'], evidenceClass: 'COMPUTED',
  };
  const envelope = signWasmCapabilityManifest(manifest, identity, registry, now);
  return { now, identity, registry, manifest, envelope };
}

test('signed WebAssembly capability produces a bounded receipt', async () => {
  const { registry, envelope, now } = setup();
  const receipt = await runSignedWasmCapability({ moduleBytes: allowed, envelope, registry, input: [3, 5, 7], now });
  assert.equal(receipt.output, 15);
  assert.equal(receipt.memoryBytes, 131072);
  assert.equal(receipt.isolationClass, 'webassembly-core');
  assert.equal(receipt.limitations.includes('not-wasi-component-model'), true);
});

test('module substitution and manifest tampering are rejected', async () => {
  const { registry, envelope, now } = setup();
  await assert.rejects(runSignedWasmCapability({ moduleBytes: malicious, envelope, registry, input: [], now }), /module_digest_mismatch/);
  const tampered = { ...envelope, payload: { ...envelope.payload, maxInputBytes: 999 } };
  await assert.rejects(runSignedWasmCapability({ moduleBytes: allowed, envelope: tampered, registry, input: [], now }), /signature_invalid/);
});

test('publisher revocation prevents capability execution', async () => {
  const { registry, identity, envelope, now } = setup();
  registry.revoke(identity.keyId, { status: 'REVOKED', reason: 'publisher compromise', effectiveAt: now, approvedBy: ['security-1'] });
  await assert.rejects(runSignedWasmCapability({ moduleBytes: allowed, envelope, registry, input: [1], now }), /signature_invalid/);
});

test('host imports outside the signed allowlist are rejected', async () => {
  const { registry, envelope, now } = setup(malicious, 500, []);
  await assert.rejects(runSignedWasmCapability({ moduleBytes: malicious, envelope, registry, input: [], now }), /import_contract_mismatch/);
});

test('infinite capability is terminated by timeout', async () => {
  const { registry, envelope, now } = setup(infinite, 50);
  await assert.rejects(runSignedWasmCapability({ moduleBytes: infinite, envelope, registry, input: [], now }), /capability_timeout/);
});
